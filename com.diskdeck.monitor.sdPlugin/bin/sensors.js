import os from "node:os";
import { execFile } from "node:child_process";

/**
 * Temperature dei dischi lette da LibreHardwareMonitor (web server JSON) con
 * ripiego su HWiNFO (Shared Memory Registry / VSB).
 *
 * LibreHardwareMonitor apre il listener su un indirizzo che non e' sempre
 * 127.0.0.1: proviamo localhost e tutti gli IPv4 della macchina.
 */

const PORTS = [8085, 8086, 8080];
const POLL_MS = 2000;
const POWER_HISTORY = 40;
const EXCLUDE = /(warning|critical|limit|distance|resolution|available|remaining|max|min)/i;

function candidateHosts() {
	const hosts = ["127.0.0.1", "localhost"];
	for (const list of Object.values(os.networkInterfaces())) {
		for (const ni of list ?? []) {
			if (ni.family === "IPv4" && !ni.internal) hosts.push(ni.address);
		}
	}
	return [...new Set(hosts)];
}

/** "81,0 W" -> 81 */
function parseWatt(value) {
	if (typeof value !== "string") return null;
	const m = value.replace(",", ".").match(/(-?\d+(?:\.\d+)?)\s*W$/i);
	return m ? Number(m[1]) : null;
}

/** "89,0 %" o "25473,000" -> numero */
function parseNum(value) {
	if (typeof value !== "string") return null;
	const m = value.replace(/\./g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
	return m ? Number(m[0]) : null;
}

/** "23,1 KB/s" -> byte al secondo */
function parseRate(value) {
	if (typeof value !== "string") return null;
	const m = value.replace(",", ".").match(/(-?\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\/s/i);
	if (!m) return null;
	const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[2].toLowerCase()];
	return Number(m[1]) * mult;
}

/** "44,0 °C" -> 44 */
function parseTemp(value) {
	if (typeof value !== "string") return null;
	const m = value.replace(",", ".").match(/(-?\d+(?:\.\d+)?)\s*°?\s*C/i);
	return m ? Number(m[1]) : null;
}

/** Normalizza un modello per il confronto: "Samsung SSD 990 PRO 2TB" -> "samsungssd990pro2tb" */
export function normalizeModel(s) {
	return String(s ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/** Parole significative di un modello, per il confronto approssimato. */
function tokens(s) {
	return new Set(
		String(s ?? "")
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((t) => t.length > 1 && !/^(ssd|hdd|nvme|with|the)$/.test(t)),
	);
}

/** Quota dei token del primo insieme presenti anche nel secondo. */
function overlap(a, b) {
	if (a.size === 0) return 0;
	let hits = 0;
	for (const t of a) if (b.has(t)) hits++;
	return hits / a.size;
}

export class Sensors {
	/** modello normalizzato -> { model, temp, source } */
	byModel = new Map();
	/** lettera "C:" -> temperatura, quando la fonte espone direttamente l'unita' */
	byLetter = new Map();
	/** id sensore -> { id, name, hw, value } per le potenze (CPU, GPU, ...). */
	powers = new Map();
	/** id sensore -> ultimi valori, per i grafici. */
	powerHistory = new Map();
	/** id -> { id, name, down, up } per le interfacce di rete. */
	nets = new Map();
	netHistory = new Map();
	/** id -> { id, name, hw, rpm, duty } per le ventole. */
	fans = new Map();
	fanHistory = new Map();
	source = null;
	lastError = null;

	#timer = null;
	#endpoint = null;
	#override = null;

	/** Forza un endpoint LibreHardwareMonitor (es. "192.168.1.10:8085"). */
	setEndpointOverride(value) {
		const v = String(value ?? "").trim();
		this.#override = v || null;
		this.#endpoint = null;
	}

	start() {
		if (this.#timer) return;
		const tick = () => this.refresh().catch(() => {});
		tick();
		this.#timer = setInterval(tick, POLL_MS);
		this.#timer.unref?.();
	}

	stop() {
		clearInterval(this.#timer);
		this.#timer = null;
	}

	async refresh() {
		if (await this.#fromLibre()) return;
		await this.#fromHwinfo();
	}

	/** Elenco dei sensori trovati, per il Property Inspector. */
	list() {
		return [...this.byModel.values()].map(({ model, temp }) => ({ model, temp }));
	}

	/**
	 * Temperatura di un disco: prima per modello, poi per lettera di unita'.
	 * @returns { temp, peak, model } oppure null.
	 */
	lookup({ model, letter }) {
		const key = model ? normalizeModel(model) : "";

		// 1. Corrispondenza esatta sul modello.
		if (key && this.byModel.has(key)) return this.byModel.get(key);

		// 2. Disco riconosciuto dalla lettera del sensore (es. DISK_C_TEMP).
		if (letter) {
			const byLetter = this.byLetter.get(letter.replace(":", "").toUpperCase());
			if (byLetter) return byLetter;
		}

		// 3. Corrispondenza approssimata: i nomi differiscono spesso nel taglio
		//    ("990 PRO 2TB" contro "990 PRO with Heatsink 1TB").
		if (model) {
			const wanted = tokens(model);
			let best = null;
			let bestScore = 0;
			for (const entry of this.byModel.values()) {
				const score = overlap(wanted, tokens(entry.model));
				if (score > bestScore) {
					bestScore = score;
					best = entry;
				}
			}
			if (bestScore >= 0.5) return best;
		}
		return null;
	}

	/** Aggiunge un valore (o una coppia) allo storico indicato. */
	#pushSeries(store, id, value) {
		let h = store.get(id);
		if (!h) {
			h = [];
			store.set(id, h);
		}
		h.push(value);
		if (h.length > POWER_HISTORY) h.shift();
	}

	listNets() {
		return [...this.nets.values()].map(({ id, name }) => ({ id, name }));
	}

	listFans() {
		return [...this.fans.values()].map(({ id, name, hw }) => ({ id, name, hw }));
	}

	getNet(id) {
		return this.nets.get(id) ?? null;
	}

	getNetHistory(id) {
		return this.netHistory.get(id) ?? [];
	}

	getFan(id) {
		return this.fans.get(id) ?? null;
	}

	getFanHistory(id) {
		return this.fanHistory.get(id) ?? [];
	}

	#pushPower(id, value) {
		let h = this.powerHistory.get(id);
		if (!h) {
			h = [];
			this.powerHistory.set(id, h);
		}
		h.push(value);
		if (h.length > POWER_HISTORY) h.shift();
	}

	/** Elenco dei sensori di potenza, per il Property Inspector. */
	listPowers() {
		return [...this.powers.values()].map(({ id, name, hw }) => ({ id, name, hw }));
	}

	getPower(id) {
		return this.powers.get(id) ?? null;
	}

	getPowerHistory(id) {
		return this.powerHistory.get(id) ?? [];
	}

	async #fetchJson(url) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 2500);
		try {
			const res = await fetch(url, { signal: ctrl.signal });
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	async #discoverEndpoint() {
		if (this.#override) return `http://${this.#override.replace(/^https?:\/\//, "")}/data.json`;
		if (this.#endpoint) return this.#endpoint;

		// Sondiamo tutte le combinazioni host/porta in parallelo: in sequenza
		// servirebbero decine di secondi prima del primo dato utile.
		const urls = [];
		for (const host of candidateHosts()) {
			for (const port of PORTS) urls.push(`http://${host}:${port}/data.json`);
		}
		const hits = await Promise.all(
			urls.map(async (url) => ((await this.#fetchJson(url))?.Children ? url : null)),
		);
		this.#endpoint = hits.find(Boolean) ?? null;
		return this.#endpoint;
	}

	async #fromLibre() {
		const url = await this.#discoverEndpoint();
		if (!url) return false;
		const data = await this.#fetchJson(url);
		if (!data?.Children) {
			this.#endpoint = null;
			return false;
		}

		const found = new Map();
		const letters = new Map();

		// Interfacce di rete: velocita' istantanea di download e upload.
		const nets = new Map();
		const isNet = (n) => /nic|network/i.test(n.ImageURL ?? "");
		const collectNet = (node) => {
			let down = null;
			let up = null;
			const walk = (n) => {
				const rate = parseRate(n.Value);
				if (rate !== null) {
					if (/download/i.test(n.Text ?? "")) down = rate;
					if (/upload/i.test(n.Text ?? "")) up = rate;
				}
				(n.Children ?? []).forEach(walk);
			};
			walk(node);
			if (down !== null || up !== null) {
				const name = String(node.Text).trim();
				nets.set(name, { id: name, name, down: down ?? 0, up: up ?? 0 });
			}
		};

		// Ventole: giri al minuto, con la percentuale di regolazione se c'e'.
		const fans = new Map();
		const collectFans = (node, hw) => {
			const rpm = /^\s*-?\d/.test(node.Value ?? "") && /RPM/i.test(node.Value ?? "") ? parseNum(node.Value) : null;
			if (rpm !== null) {
				const name = String(node.Text).trim();
				const id = `${hw}/${name}`;
				fans.set(id, { id, name, hw, rpm });
			}
			(node.Children ?? []).forEach((c) => collectFans(c, hw));
		};

		for (const hardware of data.Children?.[0]?.Children ?? []) {
			if (isNet(hardware)) collectNet(hardware);
			collectFans(hardware, String(hardware.Text).trim());
		}
		this.nets = nets;
		this.fans = fans;
		for (const [id, n] of nets) this.#pushSeries(this.netHistory, id, [n.down, n.up]);
		for (const [id, f] of fans) this.#pushSeries(this.fanHistory, id, f.rpm);

		// Le potenze stanno su qualunque componente: le raccogliamo tutte.
		const powers = new Map();
		const collectPowers = (node, hw) => {
			const watt = parseWatt(node.Value);
			if (watt !== null && !EXCLUDE.test(node.Text ?? "")) {
				const id = `${hw}/${node.Text}`;
				powers.set(id, { id, name: String(node.Text).trim(), hw, value: watt });
			}
			(node.Children ?? []).forEach((c) => collectPowers(c, hw));
		};
		for (const hardware of data.Children?.[0]?.Children ?? []) {
			collectPowers(hardware, String(hardware.Text).trim());
		}
		this.powers = powers;
		for (const [id, p] of powers) this.#pushPower(id, p.value);

		const isDisk = (n) => /hdd|ssd|nvme/i.test(n.ImageURL ?? "");
		const visitDisk = (node) => {
			const nodeLetters = [];
			// `main` = sensore principale (il primo esposto), `peak` = punto piu' caldo.
			let main = null;
			let peak = null;
			const walk = (n) => {
				const t = parseTemp(n.Value);
				if (t !== null && !EXCLUDE.test(n.Text ?? "")) {
					// Alcune schede madri nominano il sensore DISK_C_TEMP: usiamolo.
					const m = /DISK[_\s-]?([A-Z])[_\s-]?TEMP/i.exec(n.Text ?? "");
					if (m) nodeLetters.push(m[1].toUpperCase());
					if (main === null) main = t;
					if (peak === null || t > peak) peak = t;
				}
				(n.Children ?? []).forEach(walk);
			};
			walk(node);
			// Dati SMART esposti da LibreHardwareMonitor: vita residua e uso.
			const health = {};
			const scanHealth = (n) => {
				const text = n.Text ?? "";
				if (/^life$/i.test(text) || /remaining life/i.test(text)) health.life = parseNum(n.Value);
				else if (/power on hours/i.test(text)) health.hours = parseNum(n.Value);
				else if (/power on count/i.test(text)) health.count = parseNum(n.Value);
				else if (/^used space$/i.test(text)) health.usedSpace = parseNum(n.Value);
				(n.Children ?? []).forEach(scanHealth);
			};
			scanHealth(node);
			if (main !== null || health.life !== undefined) {
				const entry = {
					model: String(node.Text).trim(),
					temp: main,
					peak,
					...health,
					source: "lhm",
				};
				found.set(normalizeModel(node.Text), entry);
				for (const letter of nodeLetters) letters.set(letter, entry);
			}
		};

		const scan = (node) => {
			if (isDisk(node)) visitDisk(node);
			else (node.Children ?? []).forEach(scan);
		};
		scan(data);

		if (found.size === 0) return false;
		this.byModel = found;
		this.byLetter = letters;
		this.source = "LibreHardwareMonitor";
		this.lastError = null;
		return true;
	}

	/** HWiNFO: legge la Shared Memory Registry (Gadget/VSB) da HKCU\Software\HWiNFO64\VSB. */
	#fromHwinfo() {
		return new Promise((resolve) => {
			execFile(
				"reg.exe",
				["query", "HKCU\\Software\\HWiNFO64\\VSB", "/s"],
				{ windowsHide: true, timeout: 4000 },
				(err, stdout) => {
					if (err) {
						this.lastError = "nessuna fonte sensori disponibile";
						return resolve(false);
					}
					const entries = new Map(); // indice -> { sensor, label, value }
					for (const line of stdout.split(/\r?\n/)) {
						const m = /^\s{4}(Sensor|Label|Value)(\d+)\s+REG_SZ\s+(.*)$/.exec(line);
						if (!m) continue;
						const [, key, idx, raw] = m;
						const e = entries.get(idx) ?? {};
						e[key.toLowerCase()] = raw.trim();
						entries.set(idx, e);
					}
					const found = new Map();
					const letters = new Map();
					for (const e of entries.values()) {
						const temp = parseTemp(e.value);
						if (temp === null) continue;
						const text = `${e.sensor ?? ""} ${e.label ?? ""}`;
						if (!/hdd|ssd|nvme|disk|disco|drive/i.test(text)) continue;
						if (EXCLUDE.test(e.label ?? "")) continue;
						const m = /DISK[_\s-]?([A-Z])[_\s-]?TEMP/i.exec(text);
						if (m) letters.set(m[1].toUpperCase(), temp);
						const model = (e.sensor ?? e.label ?? "disco").replace(/^[^:]*:\s*/, "").trim();
						found.set(normalizeModel(model), { model, temp, source: "hwinfo" });
					}
					if (found.size === 0) {
						this.lastError = "HWiNFO non espone temperature disco nella Shared Memory Registry";
						return resolve(false);
					}
					this.byModel = found;
					this.byLetter = letters;
					this.source = "HWiNFO";
					this.lastError = null;
					resolve(true);
				},
			);
		});
	}
}

export const sensors = new Sensors();
