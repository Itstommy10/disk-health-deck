import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EventEmitter } from "node:events";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "sampler.ps1");
const HISTORY = 40;

/**
 * Tiene aperto un processo PowerShell che pubblica una riga JSON al secondo
 * con spazio e attivita' di ogni disco, e ne conserva lo storico per i grafici.
 */
class Sampler extends EventEmitter {
	#child = null;
	#buffer = "";
	#restartTimer = null;

	/** Ultimo campione ricevuto: { disks: [...], total: {...} } */
	latest = null;

	/** Storico per unita': id -> { read: number[], write: number[] } */
	history = new Map();

	start() {
		if (this.#child) return;
		this.#child = spawn(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		this.#child.stdout.setEncoding("utf8");
		this.#child.stdout.on("data", (chunk) => this.#onData(chunk));
		this.#child.stderr.setEncoding("utf8");
		this.#child.stderr.on("data", (err) => this.emit("error", String(err).trim()));
		this.#child.on("exit", () => {
			this.#child = null;
			this.#scheduleRestart();
		});
		this.#child.on("error", (err) => {
			this.emit("error", err.message);
			this.#child = null;
			this.#scheduleRestart();
		});
	}

	stop() {
		clearTimeout(this.#restartTimer);
		this.#child?.kill();
		this.#child = null;
	}

	#scheduleRestart() {
		clearTimeout(this.#restartTimer);
		this.#restartTimer = setTimeout(() => this.start(), 5000);
	}

	#onData(chunk) {
		this.#buffer += chunk;
		let idx;
		while ((idx = this.#buffer.indexOf("\n")) >= 0) {
			const line = this.#buffer.slice(0, idx).trim();
			this.#buffer = this.#buffer.slice(idx + 1);
			if (!line.startsWith("{")) continue;
			try {
				this.#apply(JSON.parse(line));
			} catch {
				/* riga incompleta o non valida: la ignoriamo */
			}
		}
		if (this.#buffer.length > 64_000) this.#buffer = "";
	}

	#apply(sample) {
		// PowerShell serializza un array di un solo elemento come oggetto singolo.
		const disks = Array.isArray(sample.disks) ? sample.disks : sample.disks ? [sample.disks] : [];
		sample.disks = disks;
		this.latest = sample;
		for (const d of disks) this.#push(d.id, d.read, d.write);
		this.#push("_Total", sample.total?.read ?? 0, sample.total?.write ?? 0);
		this.emit("sample", sample);
	}

	#push(id, read, write) {
		let h = this.history.get(id);
		if (!h) {
			h = { read: [], write: [] };
			this.history.set(id, h);
		}
		h.read.push(Number(read) || 0);
		h.write.push(Number(write) || 0);
		if (h.read.length > HISTORY) h.read.shift();
		if (h.write.length > HISTORY) h.write.shift();
	}

	/** Elenco unita' disponibili, per il Property Inspector. */
	drives() {
		return (this.latest?.disks ?? []).map((d) => ({ id: d.id, label: d.label }));
	}

	getDisk(id) {
		return (this.latest?.disks ?? []).find((d) => d.id === id) ?? null;
	}

	getHistory(id) {
		return this.history.get(id) ?? { read: [], write: [] };
	}
}

export const sampler = new Sampler();
