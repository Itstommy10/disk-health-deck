import streamDeck from "@elgato/streamdeck";
import { sampler } from "./sampler.js";
import { sensors } from "./sensors.js";
import {
	PALETTE,
	renderActivity,
	renderOverview,
	renderBack,
	renderFan,
	renderHealth,
	renderNetwork,
	renderPlaceholder,
	renderIoBars,
	renderPower,
	renderTemp,
	renderUsageBar,
	renderUsageRing,
	setAlert,
	setLanguage,
	t,
} from "./render.js";

const logger = streamDeck.logger.createScope("disk-monitor");

// Un errore in un singolo aggiornamento non deve far cadere il plugin.
process.on("uncaughtException", (err) => logger.error(`eccezione non gestita: ${err.stack ?? err}`));
process.on("unhandledRejection", (err) => logger.error(`promise rifiutata: ${err}`));

/** Tasti attualmente visibili, per aggiornarli a ogni campione. */
const visible = new Map(); // context -> { action, settings, kind }

function remember(ev, kind) {
	visible.set(ev.action.id, { action: ev.action, settings: ev.payload.settings ?? {}, kind });
	draw(ev.action.id);
}

function forget(ev) {
	visible.delete(ev.action.id);
}

function updateSettings(ev) {
	const entry = visible.get(ev.action.id);
	if (entry) {
		entry.settings = ev.payload.settings ?? {};
		draw(ev.action.id);
	}
	const endpoint = ev.payload?.settings?.sensorEndpoint;
	if (endpoint !== undefined) sensors.setEndpointOverride(endpoint);
}

/**
 * Rotazione automatica: quando e' attiva il tasto mostra a turno tutti i
 * dischi (o tutti i sensori di potenza) invece di quello scelto a mano.
 * L'avanzamento e' scandito dai campioni, che arrivano una volta al secondo.
 */
let rotationTick = 0;
/** Alterna a ogni campione: fa pulsare la cornice dei tasti in allarme. */
let alertBlink = false;

/** Fase dello spinner e tasti che stanno ancora aspettando i dati. */
let spinnerPhase = 0;
let spinnerTimer = null;
const loadingKeys = new Set();

/**
 * Disegna il segnaposto animato. Stream Deck non anima le immagini dei tasti:
 * la rotazione si ottiene ridisegnando, con un solo timer per tutti i tasti in
 * attesa che si ferma appena l'ultimo riceve i dati.
 */
function drawLoading(context, action, text) {
	loadingKeys.add(context);
	action.setImage(renderPlaceholder(text, spinnerPhase));
	if (spinnerTimer) return;
	spinnerTimer = setInterval(() => {
		if (loadingKeys.size === 0) {
			clearInterval(spinnerTimer);
			spinnerTimer = null;
			return;
		}
		spinnerPhase = (spinnerPhase + 1) % 12;
		for (const key of [...loadingKeys]) {
			loadingKeys.delete(key);
			draw(key);
		}
	}, 125);
}

function rotationStep(entry, length) {
	if (length <= 1) return 0;
	const every = Math.max(1, Number(entry.settings.rotateEvery) || 5);
	return (Math.floor(rotationTick / every) + (entry.rotateShift ?? 0)) % length;
}

function isRotating(settings) {
	return settings.rotate === "on";
}

/**
 * Unita' da mostrare. Oltre alla lettera si puo' indicare una posizione
 * ("#1", "#2", ...): serve ai profili distribuiti col plugin, che devono
 * funzionare su macchine con lettere di unita' diverse.
 */
function resolveDrive(settings, entry) {
	const disks = sampler.latest?.disks ?? [];
	if (disks.length === 0) return null;
	if (entry && isRotating(settings)) return disks[rotationStep(entry, disks.length)].id;

	const wanted = settings.drive;
	const byPosition = /^#(\d+)$/.exec(wanted ?? "");
	if (byPosition) return disks[Math.min(disks.length, Number(byPosition[1])) - 1]?.id ?? disks[0].id;
	if (wanted && sampler.getDisk(wanted)) return wanted;
	return disks[0].id;
}

/**
 * Risolve un campo colore: preset della tavolozza, tinta RGB personalizzata
 * (cursori del Property Inspector) oppure `null` per il colore predefinito.
 */
function pickColor(settings, key) {
	const choice = settings[key];
	if (!choice || choice === "auto") return null;
	if (choice === "custom") {
		const custom = settings[`${key}Rgb`];
		return /^#[0-9a-f]{6}$/i.test(custom ?? "") ? custom : null;
	}
	return PALETTE[choice] ?? null;
}

/** Opzioni grafiche comuni a tutti i tasti. */
function labelStyle(settings) {
	return {
		labelColor: pickColor(settings, "labelColor"),
		labelSize: Number(settings.labelSize) || null,
		subColor: pickColor(settings, "subColor"),
		subSize: Number(settings.subSize) || null,
		subOffset: Number(settings.subOffset) || 0,
		subLayout: settings.subLayout || "one",
		peakColor: pickColor(settings, "peakColor"),
		peakSize: Number(settings.peakSize) || null,
	};
}

/**
 * Decide se il tasto e' in allarme: spazio libero sotto la soglia, temperatura
 * sopra la soglia o vita residua sotto la soglia. Zero disattiva il controllo.
 */
function alertFor(kind, settings, data) {
	if (settings.alerts === "off") return false;
	const num = (v, fallback) => (v === undefined || v === "" ? fallback : Number(v));
	if (kind === "usage" && data.disk) {
		const limit = num(settings.alertFreeBelow, 10);
		const freePct = data.disk.size > 0 ? (data.disk.free / data.disk.size) * 100 : 100;
		return limit > 0 && freePct < limit;
	}
	if (kind === "temp" && data.temp != null) {
		const limit = num(settings.alertTempAbove, 60);
		return limit > 0 && data.temp >= limit;
	}
	if (kind === "health" && data.life != null) {
		const limit = num(settings.alertLifeBelow, 20);
		return limit > 0 && data.life <= limit;
	}
	return false;
}

function draw(context) {
	const entry = visible.get(context);
	if (!entry) return;
	const { action, settings, kind } = entry;
	const style = labelStyle(settings);
	// Ogni disegno riparte senza allarme: lo accende solo chi supera la soglia.
	setAlert(false, false);
	loadingKeys.delete(context);

	if (!sampler.latest && kind !== "power") {
		drawLoading(context, action, t("reading"));
		return;
	}

	if (kind === "network") {
		const list = sensors.listNets();
		const id = isRotating(settings)
			? list[rotationStep(entry, list.length)]?.id
			: settings.netSensor || list[0]?.id;
		const net = id ? sensors.getNet(id) : null;
		if (!net) {
			drawLoading(context, action, sensors.source ? t("noNet") : t("noSensors"));
			return;
		}
		action.setImage(
			renderNetwork({
				label: settings.title || net.name,
				down: net.down,
				up: net.up,
				history: sensors.getNetHistory(id),
				...style,
			}),
		);
		return;
	}

	if (kind === "fan") {
		const list = sensors.listFans();
		const id = isRotating(settings)
			? list[rotationStep(entry, list.length)]?.id
			: settings.fanSensor || list[0]?.id;
		const fan = id ? sensors.getFan(id) : null;
		if (!fan) {
			drawLoading(context, action, sensors.source ? t("noFan") : t("noSensors"));
			return;
		}
		action.setImage(
			renderFan({
				label: settings.title || fan.name,
				rpm: fan.rpm,
				history: sensors.getFanHistory(id),
				color: pickColor(settings, "accent"),
				maxBars: Number(settings.maxBars) || null,
				...style,
			}),
		);
		return;
	}

	if (kind === "power") {
		const list = sensors.listPowers();
		const id = isRotating(settings)
			? list[rotationStep(entry, list.length)]?.id
			: settings.powerSensor || list[0]?.id;
		const sensor = id ? sensors.getPower(id) : null;
		if (!sensor) {
			drawLoading(context, action, sensors.source ? t("noSensor") : t("noSensors"));
			return;
		}
		action.setImage(
			renderPower({
				label: settings.title || sensor.name,
				value: sensor.value,
				history: sensors.getPowerHistory(id),
				color: pickColor(settings, "accent"),
				maxBars: Number(settings.maxBars) || null,
				...style,
			}),
		);
		return;
	}

	if (kind === "overview") {
		// Al riepilogo serve anche la vita residua di ogni disco.
		const withHealth = sampler.latest.disks.map((d) => ({
			...d,
			life: sensors.lookup({ model: d.model, letter: d.id })?.life ?? null,
		}));
		action.setImage(
			renderOverview(withHealth, {
				title: settings.title,
				rowColor: pickColor(settings, "rowColor"),
				rowSize: Number(settings.rowSize) || null,
				pctColor: pickColor(settings, "pctColor"),
				pctSize: Number(settings.pctSize) || null,
				showHealth: settings.showHealth !== "off",
				...style,
			}),
		);
		return;
	}

	if (kind === "activity") {
		// In rotazione il ciclo comprende anche il totale, come prima voce.
		const disks = sampler.latest.disks ?? [];
		const rotating = isRotating(settings) && disks.length > 0;
		const step = rotating ? rotationStep(entry, disks.length + 1) : 0;
		const useTotal = rotating ? step === 0 : settings.drive === "_Total" || !settings.drive;
		const id = useTotal ? "_Total" : rotating ? disks[step - 1].id : resolveDrive(settings, entry);
		const hist = sampler.getHistory(id);
		const disk = useTotal ? null : sampler.getDisk(id);
		const read = useTotal ? (sampler.latest.total?.read ?? 0) : (disk?.read ?? 0);
		const write = useTotal ? (sampler.latest.total?.write ?? 0) : (disk?.write ?? 0);
		// Etichetta come nel tasto spazio disco: lettera piu' nome del volume.
		const vol = useTotal ? null : sampler.getDisk(id);
		const label =
			settings.title || (useTotal ? t("disk") : vol?.label ? `${vol.id} ${vol.label}` : id);
		if (settings.style === "bars") {
			// Istogramma: una serie sola, oppure lettura e scrittura impilate.
			const track = settings.ioTrack || "total";
			const stacked = track === "stacked";
			const pick = (r, w) => (track === "read" ? r : track === "write" ? w : r + w);
			const series = stacked
				? hist.read.map((r, i) => [r, hist.write[i] ?? 0])
				: hist.read.map((r, i) => pick(r, hist.write[i] ?? 0));
			const suffix = track === "read" ? " R" : track === "write" ? " W" : "";
			action.setImage(
				renderIoBars({
					label: settings.title || `${label}${suffix}`,
					value: stacked ? read + write : pick(read, write),
					history: series,
					stacked,
					color: pickColor(settings, "accent"),
					maxBars: Number(settings.maxBars) || null,
					...style,
				}),
			);
			return;
		}
		action.setImage(
			renderActivity({
				label,
				read,
				write,
				readHistory: hist.read,
				writeHistory: hist.write,
				...style,
			}),
		);
		return;
	}

	const id = resolveDrive(settings, entry);
	const disk = id ? sampler.getDisk(id) : null;
	if (!disk) {
		drawLoading(context, action, t("noDisk"));
		return;
	}

	if (kind === "health") {
		const reading = sensors.lookup({ model: disk.model, letter: disk.id });
		if (!reading || (reading.life == null && reading.hours == null)) {
			drawLoading(context, action, sensors.source ? `${disk.id} ${t("noSmart")}` : t("noSensors"));
			return;
		}
		setAlert(alertFor(kind, settings, reading), alertBlink);
		action.setImage(
			renderHealth({
				label: settings.title || disk.id,
				life: reading.life,
				hours: reading.hours,
				count: reading.count,
				...style,
			}),
		);
		return;
	}

	if (kind === "temp") {
		const reading = sensors.lookup({ model: disk.model, letter: disk.id });
		if (!reading) {
			drawLoading(context, action, sensors.source ? t("noTemp") : t("noSensors"));
			return;
		}
		setAlert(alertFor(kind, settings, reading), alertBlink);
		action.setImage(
			renderTemp({
				label: settings.title || disk.id,
				temp: reading.temp,
				peak: reading.peak,
				mode: settings.showValue === "no" ? "state" : "temp",
				...style,
			}),
		);
		return;
	}

	// kind === "usage"
	const used = disk.size - disk.free;
	const pct = disk.size > 0 ? (used / disk.size) * 100 : 0;
	const accent = pickColor(settings, "accent");
	const label = settings.title || (disk.label ? `${disk.id} ${disk.label}` : disk.id);
	setAlert(alertFor(kind, settings, { disk }), alertBlink);
	const payload = { label, pct, used, free: disk.free, size: disk.size, accent, centerMode: settings.centerMode, ...style };
	action.setImage(settings.style === "bar" ? renderUsageBar(payload) : renderUsageRing(payload));
}

function drawAll() {
	for (const context of visible.keys()) draw(context);
	refreshInspectors();
}

/** Elenco unita' + stato dei sensori, per il Property Inspector. */
function drivesPayload() {
	return {
		event: "drives",
		drives: (sampler.latest?.disks ?? []).map((d) => ({
			id: d.id,
			label: d.label,
			model: d.model,
			hasTemp: sensors.lookup({ model: d.model, letter: d.id }) !== null,
		})),
		powers: sensors.listPowers(),
		nets: sensors.listNets(),
		fans: sensors.listFans(),
		sensorSource: sensors.source,
		sensorError: sensors.lastError,
	};
}

/**
 * Invia l'elenco al Property Inspector visibile. `streamDeck.ui` instrada da
 * solo verso il pannello aperto: l'oggetto `ev.action` degli eventi del
 * Property Inspector non espone il metodo.
 */
function refreshInspectors() {
	if (!streamDeck.ui.action) return;
	streamDeck.ui.sendToPropertyInspector(drivesPayload()).catch(() => {});
}

function onPiMessage(ev) {
	if (ev.payload?.event === "getDrives") refreshInspectors();
}

/** Handler condivisi da tutte le azioni. */
function baseAction(manifestId, kind) {
	return {
		manifestId,
		onWillAppear: (ev) => remember(ev, kind),
		onWillDisappear: forget,
		onDidReceiveSettings: updateSettings,
		onPropertyInspectorDidAppear: refreshInspectors,
		onSendToPlugin: onPiMessage,
	};
}

const LONG_PRESS_MS = 550;

/**
 * Un profilo per formato di dispositivo: i nomi corrispondono a quelli
 * dichiarati nel manifest, e il tipo arriva dal dispositivo che ha il tasto.
 * 0 = Stream Deck (5x3), 1 = Mini (3x2), 2 = XL (8x4), 7 = Stream Deck + (4x2).
 */
const PROFILES_BY_DEVICE = { 0: "Disks", 1: "Disks Mini", 2: "Disks XL", 7: "Disks Plus" };

function profileFor(device) {
	return PROFILES_BY_DEVICE[device?.type] ?? null;
}
const pressTimers = new Map();

/**
 * Pressione prolungata: apre il profilo "Dischi" distribuito con il plugin,
 * una schermata con tutti i dischi e il tasto per tornare indietro. Stream Deck
 * non consente ai plugin di attivare i profili creati dall'utente, quindi la
 * vista e' quella inclusa qui.
 */
function armLongPress(ev) {
	const entry = visible.get(ev.action.id);
	const device = ev.action.device;
	const profile = profileFor(device);
	const disabled = entry?.settings.longPress === "off" || !device?.id || !profile;
	// Anche quando la pressione lunga e' disattivata segniamo il tasto come
	// premuto: e' cosi' che il rilascio riconosce un tocco breve valido.
	pressTimers.set(
		ev.action.id,
		disabled
			? null
			: setTimeout(() => {
					pressTimers.set(ev.action.id, "consumed");
					streamDeck.profiles.switchToProfile(device.id, profile).catch((err) => logger.warn(`profilo: ${err}`));
				}, LONG_PRESS_MS),
	);
}

/** Il tocco breve agisce al rilascio, se la pressione lunga non e' scattata. */
function onShortPress(ev, run) {
	if (!pressTimers.has(ev.action.id)) return;
	const timer = pressTimers.get(ev.action.id);
	pressTimers.delete(ev.action.id);
	if (timer === "consumed") return; // siamo gia' passati al profilo
	if (timer) clearTimeout(timer);
	run(ev);
}

/** Al rilascio del tasto commuta un'impostazione fra due valori. */
function toggleOnKeyUp(key, a, b) {
	return (ev) =>
		onShortPress(ev, () => {
			const entry = visible.get(ev.action.id);
			// Con la rotazione attiva il tasto salta all'elemento successivo.
			if (entry && isRotating(entry.settings)) {
				entry.rotateShift = (entry.rotateShift ?? 0) + 1;
				draw(ev.action.id);
				return;
			}
			const settings = { ...(entry?.settings ?? {}) };
			settings[key] = settings[key] === a ? b : a;
			ev.action.setSettings(settings);
			if (entry) entry.settings = settings;
			draw(ev.action.id);
		});
}

/** Anello in percentuale -> anello in GB -> barra -> di nuovo percentuale. */
function cycleUsageView(ev) {
	onShortPress(ev, () => {
		const entry = visible.get(ev.action.id);
		// Con la rotazione attiva il tasto salta al disco successivo.
		if (entry && isRotating(entry.settings)) {
			entry.rotateShift = (entry.rotateShift ?? 0) + 1;
			draw(ev.action.id);
			return;
		}
		const settings = { ...(entry?.settings ?? {}) };
		if (settings.style === "bar") {
			settings.style = "ring";
			settings.centerMode = "pct";
		} else if (settings.centerMode === "gb") {
			settings.style = "bar";
		} else {
			settings.centerMode = "gb";
		}
		ev.action.setSettings(settings);
		if (entry) entry.settings = settings;
		draw(ev.action.id);
	});
}

const usage = {
	...baseAction("com.diskdeck.monitor.usage", "usage"),
	// Tap: percentuale, spazio usato, barra.
	onKeyDown: armLongPress,
	onKeyUp: cycleUsageView,
};

const temp = {
	...baseAction("com.diskdeck.monitor.temp", "temp"),
	// Tap: alterna gradi e stato testuale.
	onKeyDown: armLongPress,
	onKeyUp: toggleOnKeyUp("showValue", "no", "si"),
};

const activity = {
	...baseAction("com.diskdeck.monitor.activity", "activity"),
	// Tap: alterna il grafico a linee e l'istogramma.
	onKeyDown: armLongPress,
	onKeyUp: toggleOnKeyUp("style", "bars", "lines"),
};
const health = baseAction("com.diskdeck.monitor.health", "health");
const network = baseAction("com.diskdeck.monitor.network", "network");
const fan = baseAction("com.diskdeck.monitor.fan", "fan");

const power = {
	...baseAction("com.diskdeck.monitor.power", "power"),
	// Tap: passa al sensore successivo quando la rotazione e' attiva.
	onKeyDown: armLongPress,
	onKeyUp: (ev) =>
		onShortPress(ev, () => {
			const entry = visible.get(ev.action.id);
			if (!entry || !isRotating(entry.settings)) return;
			entry.rotateShift = (entry.rotateShift ?? 0) + 1;
			draw(ev.action.id);
		}),
};
const overview = baseAction("com.diskdeck.monitor.overview", "overview");

const back = {
	manifestId: "com.diskdeck.monitor.back",
	onWillAppear: (ev) => ev.action.setImage(renderBack()),
	onKeyDown: (ev) => {
		// Senza nome di profilo Stream Deck riattiva quello precedente.
		const device = ev.action.device?.id;
		if (device) streamDeck.profiles.switchToProfile(device).catch((err) => logger.warn(`profilo: ${err}`));
	},
};

streamDeck.actions.registerAction(back);
streamDeck.actions.registerAction(usage);
streamDeck.actions.registerAction(activity);
streamDeck.actions.registerAction(overview);
streamDeck.actions.registerAction(temp);
streamDeck.actions.registerAction(power);
streamDeck.actions.registerAction(health);
streamDeck.actions.registerAction(network);
streamDeck.actions.registerAction(fan);

let firstSample = true;
sampler.on("sample", (sample) => {
	rotationTick++;
	alertBlink = !alertBlink;
	if (firstSample) {
		firstSample = false;
		logger.info(`primo campione: ${sample.disks.map((d) => d.id).join(" ")} — sensori: ${sensors.source ?? "non disponibili"}`);
	}
	drawAll();
});
sampler.on("error", (msg) => logger.warn(`sampler: ${msg}`));

streamDeck.connect().then(() => {
	setLanguage(streamDeck.info?.application?.language ?? "en");
	sampler.start();
	sensors.start();
	logger.info("disk monitor avviato");
});
