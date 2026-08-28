/**
 * Motore di disegno: genera le icone SVG dei tasti nello stile "dashboard neon".
 * Ogni funzione ritorna una data-URI pronta per `setImage`.
 */

const W = 144;
const H = 144;

const BG = "#0b0b12";
const PANEL = "#12121c";
const MUTED = "#8b93a7";
const DIM = "#5d6479";
const TRACK = "#232840";

export const PALETTE = {
	green: "#2ce38a",
	cyan: "#3fd8ff",
	yellow: "#ffd23f",
	orange: "#ff9f2e",
	red: "#ff4d6d",
	purple: "#c07bff",
	blue: "#4d8cff",
};

/**
 * Testi disegnati sui tasti. La lingua arriva da Stream Deck all'avvio; per
 * qualunque altra lingua si usa l'inglese.
 */
const STRINGS = {
	en: {
		free: "free",
		of: "of",
		on: "of",
		peak: "peak",
		max: "max",
		life: "LIFE",
		years: "yrs",
		na: "n/a",
		locale: "en-GB",
		disks: "Disks",
		disk: "Disk",
		reading: "reading...",
		noDisk: "no disk",
		noSensors: "sensors off",
		noTemp: "temp n/a",
		noSmart: "SMART n/a",
		noNet: "no network",
		noFan: "no fan",
		noSensor: "no sensor",
		cold: "COLD",
		nominal: "NOMINAL",
		warm: "WARM",
		hot: "HOT",
		critical: "CRITICAL",
	},
	it: {
		free: "liberi",
		of: "di",
		on: "su",
		peak: "picco",
		max: "max",
		life: "VITA",
		years: "anni",
		na: "n/d",
		locale: "it-IT",
		disks: "Dischi",
		disk: "Disco",
		reading: "lettura...",
		noDisk: "nessun disco",
		noSensors: "sensori off",
		noTemp: "temp. n/d",
		noSmart: "SMART n/d",
		noNet: "rete n/d",
		noFan: "ventola n/d",
		noSensor: "sensore n/d",
		cold: "FREDDO",
		nominal: "NOMINALE",
		warm: "TIEPIDO",
		hot: "CALDO",
		critical: "CRITICO",
	},
};

let lang = "en";

/** Imposta la lingua dei testi disegnati (codice a due lettere). */
export function setLanguage(code) {
	lang = STRINGS[String(code ?? "").slice(0, 2)] ? code.slice(0, 2) : "en";
}

/** Testo tradotto nella lingua corrente. */
export function t(key) {
	return STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}

/** Colore in base alla percentuale di riempimento. */
export function usageColor(pct) {
	if (pct >= 90) return PALETTE.red;
	if (pct >= 75) return PALETTE.orange;
	if (pct >= 60) return PALETTE.yellow;
	return PALETTE.green;
}

/** Byte -> stringa compatta (GB/TB). */
export function fmtBytes(v, digits = 1) {
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0;
	let n = Math.max(0, Number(v) || 0);
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${n.toFixed(n >= 100 || i <= 1 ? 0 : digits)} ${units[i]}`;
}

/** Byte/s -> stringa compatta. */
export function fmtRate(v) {
	return `${fmtBytes(v, 1)}/s`;
}

function esc(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function toDataUri(svg) {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Stato di allarme condiviso: quando e' acceso la cornice diventa rossa e
 * spessa, e il chiamante la fa lampeggiare alternando `alertOn`.
 */
let alertState = { on: false, blink: false };

export function setAlert(on, blink) {
	alertState = { on, blink };
}

/** Cornice comune: sfondo scuro, bordo neon, alone interno. */
function frame(accent, inner) {
	if (alertState.on) {
		const strong = alertState.blink;
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1b1016"/>
      <stop offset="100%" stop-color="#120a0e"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="${BG}"/>
  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="15" fill="url(#bg)" stroke="${PALETTE.red}" stroke-opacity="${strong ? 1 : 0.45}" stroke-width="${strong ? 5 : 3}"/>
  ${inner}
</svg>`;
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PANEL}"/>
      <stop offset="100%" stop-color="${BG}"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="${BG}"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="15" fill="url(#bg)" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>
  ${inner}
</svg>`;
}

/** Tiene una riga di testo dentro il riquadro, qualunque scostamento si chieda. */
function clampY(y, fontSize) {
	return Math.min(H - fontSize * 0.25 - 2, Math.max(fontSize, y));
}

function title(text, color = MUTED, y = 26, size = 13) {
	const spacing = size >= 16 ? 1 : 1.6;
	return `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" letter-spacing="${spacing}" fill="${color}">${esc(String(text).toUpperCase())}</text>`;
}

/**
 * Riga (o coppia di righe) con lo spazio occupato: "396 GB / 932 GB" oppure
 * l'usato sopra e il totale sotto.
 */
function subLines(used, total, cx, baseY, font, color, layout) {
	const text = (y, size, opacity, content) =>
		`<text x="${cx}" y="${y.toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="600" fill="${color}" fill-opacity="${opacity}">${esc(content)}</text>`;
	if (layout !== "two") {
		// Con la stessa unita' la si scrive una volta sola: "396 / 932 GB".
		const [usedNum, usedUnit] = used.split(" ");
		const [, totalUnit] = total.split(" ");
		return text(baseY, font, 1, usedUnit === totalUnit ? `${usedNum} / ${total}` : `${used} / ${total}`);
	}
	const small = Math.max(9, font - 2);
	return `${text(baseY - font, font, 1, used)}
  ${text(baseY, small, 0.7, `${t("of")} ${total}`)}`;
}

/** Arco di cerchio (percorso SVG) per il quadrante. */
function arc(cx, cy, r, startDeg, endDeg) {
	const p = (deg) => {
		const a = ((deg - 90) * Math.PI) / 180;
		return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
	};
	const [x1, y1] = p(startDeg);
	const [x2, y2] = p(endDeg);
	const large = endDeg - startDeg > 180 ? 1 : 0;
	return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Tasto "spazio disco": anello graduato con percentuale al centro.
 */
export function renderUsageRing({ label, pct, used, size, accent, labelColor, labelSize, subColor, subSize, subOffset, subLayout, centerMode }) {
	const color = accent || usageColor(pct);
	const START = -135;
	const SWEEP = 270;
	const end = START + (SWEEP * Math.min(100, Math.max(0, pct))) / 100;
	// L'apertura di 270 gradi lascia libero il fondo del riquadro: la riga con
	// lo spazio occupato si infila li' sotto, appena staccata dalle estremita'.
	const cx = 72;
	const cy = 76;
	const r = 39;
	const stroke = 10;
	// Il testo deve stare dentro il diametro interno dell'anello con un buon
	// margine: "100%" e' un carattere piu' largo di "43%", quindi rimpicciolisce.
	const showBytes = centerMode === "gb";
	const pctText = showBytes ? fmtBytes(used, 0) : `${Math.round(pct)}%`;
	const pctFont = pctText.length >= 6 ? 17 : pctText.length >= 4 ? 20 : 23;
	const subFont = Number(subSize) || 12;
	// La riga si alza al crescere del carattere, per non finire sul bordo;
	// `subOffset` permette poi di spostarla a piacere (negativo = piu' in alto).
	const subY = clampY(H - 6 - subFont * 0.3 + (Number(subOffset) || 0), subFont);
	const inner = `
  ${title(label, labelColor || MUTED, 24, labelSize || 13)}
  <path d="${arc(cx, cy, r, START, START + SWEEP)}" fill="none" stroke="${TRACK}" stroke-width="${stroke}" stroke-linecap="round"/>
  ${pct > 0.5 ? `<path d="${arc(cx, cy, r, START, end)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" filter="url(#glow)"/>` : ""}
  <text x="${cx}" y="${cy + pctFont * 0.35}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${pctFont}" font-weight="700" fill="${color}">${pctText}</text>
  ${
		showBytes
			? // Al centro ci sono i byte: sotto restano percentuale e capacita'.
				`<text x="${cx}" y="${subY.toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${subFont}" font-weight="600" fill="${subColor || DIM}">${Math.round(pct)}% ${t("of")} ${esc(fmtBytes(size, 1))}</text>`
			: subLines(fmtBytes(used, 1), fmtBytes(size, 1), cx, subY, subFont, subColor || DIM, subLayout)
	}`;
	return toDataUri(frame(color, inner));
}

/**
 * Variante a barra orizzontale con valore libero grande. Qui lo spazio sta
 * sempre su due righe: la barra colorata occupa gia' la fascia centrale.
 */
export function renderUsageBar({ label, pct, used, free, size, accent, labelColor, labelSize, subColor, subSize, subOffset }) {
	const color = accent || usageColor(pct);
	const barW = 108;
	const x = (W - barW) / 2;
	const subFont = Number(subSize) || 12;
	const shift = Number(subOffset) || 0;
	const freeY = clampY(114 + (subFont - 12) * 0.4 + shift, subFont);
	const totalY = clampY(133 + (subFont - 12) * 0.4 + shift, subFont);
	const inner = `
  ${title(label, labelColor || MUTED, 26, labelSize || 13)}
  <text x="${W / 2}" y="66" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="28" font-weight="700" fill="${color}">${Math.round(pct)}%</text>
  <rect x="${x}" y="80" width="${barW}" height="14" rx="7" fill="${TRACK}"/>
  ${pct > 0 ? `<rect x="${x}" y="80" width="${Math.max(6, (barW * Math.min(100, pct)) / 100).toFixed(1)}" height="14" rx="7" fill="${color}" filter="url(#glow)"/>` : ""}
  <text x="${W / 2}" y="${freeY.toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${subFont}" font-weight="600" fill="${subColor || MUTED}">${esc(fmtBytes(free, 1))} ${t("free")}</text>
  <text x="${W / 2}" y="${totalY.toFixed(1)}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${subFont - 1}" font-weight="600" fill="${subColor || DIM}" fill-opacity="0.75">${t("on")} ${esc(fmtBytes(size, 1))}</text>`;
	return toDataUri(frame(color, inner));
}

function sparkPath(values, x0, y0, w, h, max, close) {
	if (values.length === 0) return "";
	const n = Math.max(2, values.length);
	const step = w / (n - 1);
	const pts = values.map((v, i) => {
		const px = x0 + i * step;
		const py = y0 + h - (h * Math.min(1, v / (max || 1)));
		return `${px.toFixed(1)},${py.toFixed(1)}`;
	});
	const line = `M ${pts.join(" L ")}`;
	if (!close) return line;
	const lastX = (x0 + (values.length - 1) * step).toFixed(1);
	return `${line} L ${lastX},${y0 + h} L ${x0.toFixed(1)},${y0 + h} Z`;
}

/**
 * Tasto "attivita' disco": grafico lettura/scrittura in tempo reale.
 */
export function renderActivity({ label, read, write, readHistory, writeHistory, labelColor, labelSize, legend }) {
	const readColor = PALETTE.cyan;
	const writeColor = PALETTE.orange;
	const peak = Math.max(1024 * 512, ...readHistory, ...writeHistory);
	const gx = 12;
	const gy = 72;
	const gw = W - 24;
	const gh = 56;
	const inner = `
  <defs>
    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${readColor}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${readColor}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${title(label, labelColor || MUTED, 22, labelSize || 13)}
  <text x="12" y="44" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" fill="${readColor}">${legend?.[0] ?? "R"} ${esc(fmtRate(read))}</text>
  <text x="12" y="62" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" fill="${writeColor}">${legend?.[1] ?? "W"} ${esc(fmtRate(write))}</text>
  <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" fill="#0d1119" stroke="${TRACK}" stroke-width="1"/>
  <path d="${sparkPath(readHistory, gx, gy, gw, gh, peak, true)}" fill="url(#rg)" stroke="none"/>
  <path d="${sparkPath(readHistory, gx, gy, gw, gh, peak, false)}" fill="none" stroke="${readColor}" stroke-width="2" stroke-linejoin="round"/>
  <path d="${sparkPath(writeHistory, gx, gy, gw, gh, peak, false)}" fill="none" stroke="${writeColor}" stroke-width="2" stroke-linejoin="round"/>
  <text x="${W - 12}" y="${gy - 4}" text-anchor="end" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="600" fill="${DIM}">${t("peak")} ${esc(fmtRate(peak))}</text>`;
	return toDataUri(frame(readColor, inner));
}

/**
 * Tasto "riepilogo": una barra compatta per ogni disco.
 */
export function renderOverview(disks, opts = {}) {
	const { title: heading, labelColor, labelSize, rowColor, rowSize, pctColor, pctSize, showHealth } = opts;
	// Con la salute attiva ogni riga si apre con un pallino: verde se il disco
	// sta bene, grigio se non espone il dato SMART.
	const dot = showHealth !== false;
	// Fino a sei dischi: oltre i quattro classici le righe si stringono da sole.
	const rows = disks.slice(0, 6);
	const dense = rows.length > 4;
	const rowFont = Number(rowSize) || (dense ? 10 : 12);
	const pctFont = Number(pctSize) || (dense ? 8 : 9);
	const top = dense ? 36 : 44;
	const gap = rows.length > 0 ? Math.min(22, (H - top - 10) / rows.length) : 22;
	const textX = dot ? 20 : 10;
	const barX = dot ? 42 : 34;
	const barW = dot ? 88 : 96;
	const body = rows
		.map((d, i) => {
			const y = top + i * gap;
			const pct = d.size > 0 ? ((d.size - d.free) / d.size) * 100 : 0;
			const color = usageColor(pct);
			const life = d.life;
			const lifeColor =
				life == null
					? "#39405a"
					: life >= 80
						? PALETTE.green
						: life >= 50
							? PALETTE.yellow
							: life >= 20
								? PALETTE.orange
								: PALETTE.red;
			return `
  ${dot ? `<circle cx="10" cy="${y + 5.5}" r="4" fill="${lifeColor}"/>` : ""}
  <text x="${textX}" y="${y + 9}" font-family="Segoe UI,Arial,sans-serif" font-size="${rowFont}" font-weight="700" fill="${rowColor || MUTED}">${esc(d.id)}</text>
  <rect x="${barX}" y="${y}" width="${barW}" height="${dense ? 9 : 11}" rx="5.5" fill="${TRACK}"/>
  <rect x="${barX}" y="${y}" width="${Math.max(4, (barW * pct) / 100).toFixed(1)}" height="${dense ? 9 : 11}" rx="5.5" fill="${color}"/>
  <text x="${barX + barW}" y="${y - 2}" text-anchor="end" font-family="Segoe UI,Arial,sans-serif" font-size="${pctFont}" font-weight="600" fill="${pctColor || DIM}">${Math.round(pct)}%</text>`;
		})
		.join("");
	const inner = `${title(heading || t("disks"), labelColor || MUTED, 24, labelSize || 13)}${body}`;
	return toDataUri(frame(PALETTE.blue, inner));
}

const SPINNER_STEPS = 12;

/**
 * Icona mostrata quando i dati non sono ancora disponibili. Stream Deck non
 * anima le immagini dei tasti: la rotazione si ottiene ridisegnando il tasto a
 * ogni passo, con `phase` che avanza dall'esterno.
 */
export function renderPlaceholder(text, phase = 0) {
	const cx = W / 2;
	const cy = 62;
	const r = 24;
	const ticks = Array.from({ length: SPINNER_STEPS }, (_, i) => {
		// Distanza dal segmento in testa: piu' e' lontano, piu' e' spento.
		const back = (i - phase + SPINNER_STEPS * 2) % SPINNER_STEPS;
		const opacity = Math.max(0.12, 1 - back / (SPINNER_STEPS - 2));
		const angle = (i / SPINNER_STEPS) * 360;
		return `<rect x="${cx - 2}" y="${cy - r}" width="4" height="9" rx="2" fill="${PALETTE.cyan}" fill-opacity="${opacity.toFixed(2)}" transform="rotate(${angle} ${cx} ${cy})"/>`;
	}).join("\n  ");
	const inner = `
  ${ticks}
  <text x="${cx}" y="${H - 26}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="12" font-weight="600" fill="${MUTED}">${esc(text)}</text>`;
	return toDataUri(frame(DIM, inner));
}

/** Fasce termiche usate dal tasto temperatura: soglia inferiore, colore, stato. */
const THERMAL_BANDS = [
	{ from: 0, color: PALETTE.cyan, state: "cold" },
	{ from: 30, color: PALETTE.green, state: "nominal" },
	{ from: 48, color: PALETTE.yellow, state: "warm" },
	{ from: 60, color: PALETTE.orange, state: "hot" },
	{ from: 70, color: PALETTE.red, state: "critical" },
];

/** Indice della fascia corrispondente alla temperatura. */
function thermalBand(temp) {
	let i = 0;
	for (let k = 0; k < THERMAL_BANDS.length; k++) {
		if (temp >= THERMAL_BANDS[k].from) i = k;
	}
	return i;
}

/**
 * Tasto "temperatura disco": scala a barre impilate nello stile del riquadro
 * THERMAL del cruscotto di riferimento, con i gradi oppure lo stato testuale.
 */
export function renderTemp({ label, temp, peak, mode = "temp", labelColor, labelSize, peakColor, peakSize }) {
	const idx = thermalBand(temp);
	const band = THERMAL_BANDS[idx];
	const color = band.color;

	// La scala occupa tutta la meta' inferiore: sopra resta lo spazio per
	// l'etichetta e per il valore, che non serve piu' di una trentina di pixel.
	const barH = 11.5;
	const gap = 4;
	const barW = 100;
	const x = (W - barW) / 2;
	const bottom = H - 8;
	const barsTop = bottom - (THERMAL_BANDS.length * barH + (THERMAL_BANDS.length - 1) * gap);
	const bars = THERMAL_BANDS.map((b, k) => {
		const y = bottom - (k + 1) * barH - k * gap;
		const on = k <= idx;
		const isCurrent = k === idx;
		// Anche le fasce non raggiunte restano leggibili: fondo scuro ma bordo
		// nel colore della fascia, cosi' si vede sempre l'intera scala.
		const fill = on ? b.color : "#12101a";
		const opacity = on ? (isCurrent ? 1 : 0.3) : 1;
		return `<rect x="${x}" y="${y.toFixed(1)}" width="${barW}" height="${barH}" rx="2.5" fill="${fill}" fill-opacity="${opacity}" stroke="${b.color}" stroke-opacity="${on ? 0.9 : 0.45}" stroke-width="1"${isCurrent ? ' filter="url(#glow)"' : ""}/>`;
	}).join("\n  ");

	// Un solo contenuto principale: i gradi oppure lo stato testuale.
	const hasPeak = peak != null && Math.round(peak) > Math.round(temp);
	const big = (y, size, text) =>
		`<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700" fill="${color}" filter="url(#glow)">${text}</text>`;

	// Una riga sola: "43° / 62°" oppure lo stato. Tenerla singola lascia tutto
	// lo spazio residuo alla scala.
	let main;
	if (mode === "state") {
		main = big(barsTop - 10, t(band.state).length > 8 ? 18 : 21, t(band.state));
	} else if (hasPeak) {
		// Il picco prende il colore della propria fascia: se il disco tocca i 70°
		// il secondo numero e' rosso anche mentre la temperatura attuale e' verde.
		const peakTint = peakColor || THERMAL_BANDS[thermalBand(peak)].color;
		const peakFont = Number(peakSize) || 26;
		main = big(
			barsTop - 10,
			26,
			`${Math.round(temp)}°<tspan fill="${peakTint}" fill-opacity="0.85" font-size="${peakFont}"> / ${Math.round(peak)}°</tspan>`,
		);
	} else {
		main = big(barsTop - 10, 32, `${Math.round(temp)}°`);
	}

	const inner = `
  ${title(label, labelColor || MUTED, 22, labelSize || 13)}
  ${main}
  ${bars}`;
	return toDataUri(frame(color, inner));
}

/**
 * Tasto "potenza": valore istantaneo grande e istogramma dello storico, nello
 * stile del riquadro POWER del cruscotto di riferimento.
 */
export function renderPower({ label, value, history, color, labelColor, labelSize, peakColor, peakSize, maxBars }) {
	const digits = value >= 100 ? 0 : 1;
	return renderMeter({
		label,
		valueText: `${value.toFixed(digits)}W`,
		history,
		color: color || PALETTE.orange,
		peakText: (peak) => `${t("peak")} ${peak.toFixed(0)}W`,
		floor: 5,
		maxBars,
		labelColor,
		labelSize,
		peakColor,
		peakSize,
	});
}

/**
 * Tasto "I/O disco a barre": stessa grafica del tasto potenza, con i byte al
 * secondo al posto dei watt.
 */
export function renderIoBars({ label, value, history, color, labelColor, labelSize, peakColor, peakSize, maxBars, stacked }) {
	return renderMeter({
		label,
		valueText: fmtRate(value),
		history,
		color: color || PALETTE.cyan,
		peakText: (peak) => `${t("peak")} ${fmtRate(peak)}`,
		floor: 512 * 1024,
		maxBars,
		stacked,
		labelColor,
		labelSize,
		peakColor,
		peakSize,
	});
}

/**
 * Grafica comune ai tasti "a istogramma": valore istantaneo grande e storico a
 * colonne sfumate, nello stile del riquadro POWER del cruscotto di riferimento.
 */
function renderMeter({
	label,
	valueText,
	history,
	color,
	peakText,
	floor,
	labelColor,
	labelSize,
	peakColor,
	peakSize,
	maxBars,
	stacked,
}) {
	const gx = 10;
	const gy = 80;
	const gw = W - 20;
	const gh = 52;
	// Solo gli ultimi campioni: con troppe colonne diventano filiformi.
	const limit = Math.max(4, Number(maxBars) || 20);
	// In modalita' impilata ogni elemento e' un array di segmenti (lettura, scrittura).
	const rows = (stacked ? history : history.map((v) => [v])).slice(-limit);
	const totals = rows.map((parts) => parts.reduce((a, b) => a + b, 0));
	// La scala segue il massimo recente, con un minimo per non amplificare il rumore.
	const peak = Math.max(floor, ...totals) * 1.1;
	const bw = rows.length > 0 ? gw / rows.length : gw;
	const cw = Math.max(2, bw - Math.min(2.5, bw * 0.25));
	const columns = rows
		.map((parts, i) => {
			const x = gx + i * bw + (bw - cw) / 2;
			let bottom = gy + gh;
			return parts
				.map((v, k) => {
					const h = k === 0 ? Math.max(1.5, gh * Math.min(1, v / peak)) : gh * Math.min(1, v / peak);
					if (h <= 0) return "";
					bottom -= h;
					return `<rect x="${x.toFixed(1)}" y="${bottom.toFixed(1)}" width="${cw.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="url(#pw${k})"/>`;
				})
				.join("");
		})
		.join("\n  ");

	const valueFont = valueText.length > 8 ? 20 : valueText.length > 6 ? 24 : 28;
	const inner = `
  <defs>
    <linearGradient id="pw0" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="pw1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PALETTE.orange}"/>
      <stop offset="100%" stop-color="${PALETTE.orange}" stop-opacity="0.5"/>
    </linearGradient>
  </defs>
  ${title(label, labelColor || MUTED, 24, labelSize || 13)}
  <text x="${W / 2}" y="56" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${valueFont}" font-weight="700" fill="${color}" filter="url(#glow)">${esc(valueText)}</text>
  <text x="${W - 12}" y="${gy - 9}" text-anchor="end" font-family="Segoe UI,Arial,sans-serif" font-size="${Number(peakSize) || 10}" font-weight="600" fill="${peakColor || DIM}">${esc(peakText(peak))}</text>
  <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="5" fill="#0d1119" stroke="${TRACK}" stroke-width="1"/>
  ${columns}`;
	return toDataUri(frame(color, inner));
}

/** Tasto "indietro" della vista dischi. */
export function renderBack() {
	const inner = `
  <path d="M 86 40 L 58 72 L 86 104" fill="none" stroke="${MUTED}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${W / 2}" y="132" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1.4" fill="${DIM}">INDIETRO</text>`;
	return toDataUri(frame(MUTED, inner));
}

/**
 * Tasto "salute disco": vita residua ad anello con ore di servizio e numero di
 * accensioni, i dati SMART che anticipano un guasto.
 */
export function renderHealth({ label, life, hours, count, labelColor, labelSize, subColor, subSize }) {
	// Senza dato SMART il disco non e' malato: resta neutro, non rosso.
	const color =
		life == null
			? MUTED
			: life >= 80
				? PALETTE.green
				: life >= 50
					? PALETTE.yellow
					: life >= 20
						? PALETTE.orange
						: PALETTE.red;
	const START = -135;
	const SWEEP = 270;
	const cx = 72;
	const cy = 76;
	const r = 39;
	const stroke = 10;
	const pct = life == null ? null : Math.max(0, Math.min(100, life));
	const years = hours != null ? hours / 24 / 365 : null;
	const subFont = Number(subSize) || 11;
	const center = pct == null ? t("na") : `${Math.round(pct)}%`;
	const inner = `
  ${title(label, labelColor || MUTED, 24, labelSize || 13)}
  <path d="${arc(cx, cy, r, START, START + SWEEP)}" fill="none" stroke="${TRACK}" stroke-width="${stroke}" stroke-linecap="round"/>
  ${pct ? `<path d="${arc(cx, cy, r, START, START + (SWEEP * pct) / 100)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" filter="url(#glow)"/>` : ""}
  <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${center.length > 3 ? 20 : 23}" font-weight="700" fill="${color}">${center}</text>
  <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="600" fill="${DIM}">${t("life")}</text>
  <text x="${cx}" y="${H - 10}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${subFont}" font-weight="600" fill="${subColor || DIM}">${hours != null ? `${Math.round(hours).toLocaleString(t("locale"))} h · ${years.toFixed(1)} ${t("years")}` : ""}${count != null && hours == null ? `${count} avvii` : ""}</text>`;
	return toDataUri(frame(color, inner));
}

/**
 * Tasto "rete": download e upload in tempo reale, con lo stesso grafico a linee
 * dell'attivita' disco.
 */
export function renderNetwork({ label, down, up, history, labelColor, labelSize }) {
	return renderActivity({
		label,
		read: down,
		write: up,
		readHistory: history.map(([d]) => d),
		writeHistory: history.map(([, u]) => u),
		labelColor,
		labelSize,
		legend: ["D", "U"],
	});
}

/**
 * Tasto "ventola": giri al minuto con lo storico a istogramma.
 */
export function renderFan({ label, rpm, history, color, labelColor, labelSize, peakColor, peakSize, maxBars }) {
	return renderMeter({
		label,
		valueText: `${Math.round(rpm)} RPM`,
		history,
		color: color || PALETTE.blue,
		peakText: (peak) => `${t("max")} ${Math.round(peak)}`,
		floor: 600,
		maxBars,
		labelColor,
		labelSize,
		peakColor,
		peakSize,
	});
}
