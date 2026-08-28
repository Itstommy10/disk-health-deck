/* Property Inspector minimale e autonomo (nessuna dipendenza esterna). */
let ws = null;
let uuid = null;
let actionInfo = null;
let settings = {};
let drivesLoaded = false;
let retry = null;

function send(payload) {
	if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
}

function saveSettings() {
	send({ event: "setSettings", context: uuid, payload: settings });
}

function sendToPlugin(payload) {
	send({ event: "sendToPlugin", context: uuid, action: actionInfo.action, payload });
}

/** Riporta nei campi i valori salvati. */
function applySettings() {
	document.querySelectorAll("[data-setting]").forEach((el) => {
		const key = el.dataset.setting;
		const value = settings[key] ?? el.dataset.default;
		if (value !== undefined && value !== "") el.value = value;
		showValueOf(key, el.value);
	});
}

function showValueOf(key, value) {
	const out = document.querySelector(`[data-value-of="${key}"]`);
	if (out) out.textContent = value;
}

function bind() {
	document.querySelectorAll("[data-setting]").forEach((el) => {
		const key = el.dataset.setting;
		const commit = () => {
			settings[key] = el.value;
			showValueOf(key, el.value);
			saveSettings();
		};
		el.addEventListener("change", commit);
		el.addEventListener("input", commit);
	});
}

/** Popola una tendina generica di sensori (rete, ventole). */
function fillSensorList(setting, items, format) {
	const select = document.querySelector(`[data-setting="${setting}"]`);
	if (!select || items.length === 0) return;
	drivesLoaded = true;
	clearInterval(retry);
	const current = settings[setting] ?? select.value;
	select.innerHTML = "";
	for (const item of items) {
		const opt = document.createElement("option");
		opt.value = item.id;
		opt.textContent = format(item);
		opt.title = format(item);
		select.appendChild(opt);
	}
	select.value = current && [...select.options].some((o) => o.value === current) ? current : select.options[0].value;
	if (settings[setting] !== select.value) {
		settings[setting] = select.value;
		saveSettings();
	}
}

/** Popola la tendina dei sensori di potenza. */
function fillPowers(powers) {
	const select = document.querySelector('[data-setting="powerSensor"]');
	if (!select || powers.length === 0) return;
	drivesLoaded = true;
	clearInterval(retry);
	const current = settings.powerSensor ?? select.value;
	select.innerHTML = "";
	for (const p of powers) {
		const opt = document.createElement("option");
		opt.value = p.id;
		// Il nome del componente e' lungo: in elenco basta la sigla iniziale.
		const hw = p.hw.split(/\s+/).slice(0, 2).join(" ");
		opt.textContent = `${p.name} · ${hw}`;
		opt.title = `${p.name} — ${p.hw}`;
		select.appendChild(opt);
	}
	select.value = current && [...select.options].some((o) => o.value === current) ? current : select.options[0].value;
	if (settings.powerSensor !== select.value) {
		settings.powerSensor = select.value;
		saveSettings();
	}
}

function fillDrives(payload) {
	showStatus(payload);
	fillPowers(payload.powers ?? []);
	fillSensorList("netSensor", payload.nets ?? [], (n) => n.name);
	fillSensorList("fanSensor", payload.fans ?? [], (f) => `${f.name} · ${f.hw.split(/\s+/).slice(0, 2).join(" ")}`);
	const select = document.querySelector('[data-setting="drive"]');
	if (!select) return;
	const drives = payload.drives ?? [];
	if (drives.length === 0) return;
	drivesLoaded = true;
	clearInterval(retry);

	const current = settings.drive ?? select.value;
	const extra = select.dataset.total === "true" ? [{ id: "_Total", label: "Tutti i dischi" }] : [];
	// Le posizioni non dipendono dalle lettere: utili quando la stessa
	// configurazione deve funzionare su un altro computer.
	const positions = drives.map((_, i) => ({ id: `#${i + 1}`, label: `${i + 1}° disco (per posizione)` }));
	const needsTemp = document.querySelector('[data-setting="showValue"]') !== null;

	select.innerHTML = "";
	for (const d of [...extra, ...drives, ...positions]) {
		const opt = document.createElement("option");
		opt.value = d.id;
		const parts = [d.id.startsWith("#") ? "" : d.id].filter(Boolean);
		if (d.label) parts.push(d.label);
		// Il modello completo e' lungo: lo accorciamo per non allargare il pannello.
		if (d.model) parts.push(d.model.length > 20 ? `${d.model.slice(0, 20)}…` : d.model);
		opt.textContent = parts.join(" · ");
		opt.title = [d.id, d.label, d.model].filter(Boolean).join(" — ");
		if (needsTemp && d.hasTemp === false) opt.textContent += " · no sensore";
		select.appendChild(opt);
	}
	select.value = current && [...select.options].some((o) => o.value === current) ? current : select.options[0].value;
	if (settings.drive !== select.value) {
		settings.drive = select.value;
		saveSettings();
	}
}

/** Riga in fondo al pannello con la fonte dei sensori. */
function showStatus(payload) {
	const status = document.querySelector("[data-status]");
	if (status) {
		if (payload.sensorSource) {
			status.className = "status ok";
			status.textContent = `Sensori: ${payload.sensorSource}`;
		} else {
			status.className = "status warn";
			status.textContent = `Sensori non disponibili${payload.sensorError ? ` — ${payload.sensorError}` : ""}`;
		}
	}
}


/* --- Regolazione RGB dei colori personalizzati ------------------------- */

const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

function toHex([r, g, b]) {
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function fromHex(value) {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
	if (!m) return [64, 160, 255];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Costruisce i tre cursori R/G/B associati a una tendina colore. */
function buildRgbGroup(box) {
	const key = box.dataset.rgbFor;
	const storeKey = `${key}Rgb`;
	const rgb = fromHex(settings[storeKey]);

	box.innerHTML = `
		<input class="swatch" type="color" title="Scegli il colore">
		<div class="sliders">
			<div class="ch"><span>R</span><input type="range" min="0" max="255" data-ch="0"></div>
			<div class="ch"><span>G</span><input type="range" min="0" max="255" data-ch="1"></div>
			<div class="ch"><span>B</span><input type="range" min="0" max="255" data-ch="2"></div>
		</div>
		<input class="hex" type="text" maxlength="7">`;

	const swatch = box.querySelector(".swatch");
	const hexField = box.querySelector(".hex");
	const ranges = [...box.querySelectorAll("input[type=range]")];

	const paint = () => {
		const value = toHex(rgb);
		swatch.value = value;
		hexField.value = value;
		ranges.forEach((el, i) => (el.value = rgb[i]));
	};

	const commit = () => {
		settings[storeKey] = toHex(rgb);
		saveSettings();
	};

	ranges.forEach((el) => {
		el.addEventListener("input", () => {
			rgb[Number(el.dataset.ch)] = Number(el.value);
			paint();
			commit();
		});
	});

	// Selettore nativo: aggiorna cursori e campo esadecimale mentre si trascina.
	swatch.addEventListener("input", () => {
		rgb.splice(0, 3, ...fromHex(swatch.value));
		paint();
		commit();
	});

	hexField.addEventListener("change", () => {
		const parsed = fromHex(hexField.value);
		rgb.splice(0, 3, ...parsed);
		paint();
		commit();
	});

	paint();
}

/** Mostra i cursori solo quando la tendina e' su "Personalizzato". */
function syncRgbVisibility() {
	document.querySelectorAll("[data-rgb-for]").forEach((box) => {
		const select = document.querySelector(`[data-setting="${box.dataset.rgbFor}"]`);
		box.classList.toggle("on", select?.value === "custom");
	});
}

function setupRgb() {
	document.querySelectorAll("[data-rgb-for]").forEach(buildRgbGroup);
	document.querySelectorAll("[data-rgb-for]").forEach((box) => {
		const select = document.querySelector(`[data-setting="${box.dataset.rgbFor}"]`);
		select?.addEventListener("change", syncRgbVisibility);
	});
	syncRgbVisibility();
}

/**
 * I pannelli sono scritti in inglese; con Stream Deck in italiano ogni testo
 * viene sostituito usando il dizionario caricato a fianco.
 */
async function localize(language) {
	if (!String(language ?? "").startsWith("it")) return;
	let dict;
	try {
		dict = await (await fetch("i18n-it.json")).json();
	} catch {
		return; // dizionario assente: restiamo in inglese
	}
	const swap = (node) => {
		const text = node.textContent.trim();
		if (dict[text]) node.textContent = dict[text];
	};
	document.querySelectorAll("label, option, .hint, summary").forEach(swap);
	document.querySelectorAll("[placeholder]").forEach((el) => {
		if (dict[el.placeholder]) el.placeholder = dict[el.placeholder];
	});
}

window.connectElgatoStreamDeckSocket = (port, inUUID, registerEvent, info, inActionInfo) => {
	uuid = inUUID;
	localize(JSON.parse(info)?.application?.language);
	actionInfo = JSON.parse(inActionInfo);
	settings = actionInfo.payload?.settings ?? {};
	ws = new WebSocket(`ws://127.0.0.1:${port}`);

	ws.onopen = () => {
		send({ event: registerEvent, uuid: inUUID });
		applySettings();
		bind();
		setupRgb();
		sendToPlugin({ event: "getDrives" });
		// Il campionamento parte con qualche secondo di ritardo: insistiamo.
		retry = setInterval(() => {
			if (drivesLoaded) return clearInterval(retry);
			sendToPlugin({ event: "getDrives" });
		}, 1500);
	};

	ws.onmessage = (e) => {
		const msg = JSON.parse(e.data);
		if (msg.event === "didReceiveSettings") {
			settings = msg.payload?.settings ?? {};
			applySettings();
			syncRgbVisibility();
		} else if (msg.event === "sendToPropertyInspector" && msg.payload?.event === "drives") {
			fillDrives(msg.payload);
		}
	};
};
