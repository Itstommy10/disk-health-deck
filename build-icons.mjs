/**
 * Genera le icone PNG richieste dal Marketplace (il validatore rifiuta gli SVG).
 * Le forme sono poche e semplici, quindi le disegniamo pixel per pixel con un
 * piccolo rasterizzatore e le codifichiamo con zlib, senza dipendenze esterne.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = path.resolve("com.diskdeck.monitor.sdPlugin", "imgs");

const C = {
	bg: [11, 11, 18],
	track: [35, 40, 64],
	green: [44, 227, 138],
	cyan: [63, 216, 255],
	yellow: [255, 210, 63],
	orange: [255, 159, 46],
	red: [255, 77, 109],
	blue: [77, 140, 255],
	grey: [139, 147, 167],
};

/** Tela trasparente: le icone dell'elenco azioni non hanno sfondo. */
function blank(size) {
	return new Uint8Array(size * size * 4);
}

/** Tela RGBA con fondo scuro e angoli arrotondati. */
function canvas(size) {
	const px = new Uint8Array(size * size * 4);
	const r = size * 0.17;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const i = (y * size + x) * 4;
			// Distanza dal rettangolo arrotondato, per l'antialiasing dei bordi.
			const dx = Math.max(r - x, 0, x - (size - 1 - r));
			const dy = Math.max(r - y, 0, y - (size - 1 - r));
			const d = Math.hypot(dx, dy) - r;
			const a = Math.max(0, Math.min(1, 0.5 - d));
			px.set([C.bg[0], C.bg[1], C.bg[2], Math.round(a * 255)], i);
		}
	}
	return px;
}

/** Quando attivo, ogni colore viene disegnato in bianco (icone dell'elenco). */
let mono = false;

function blend(px, size, x, y, color, alpha) {
	if (mono) color = [255, 255, 255];
	if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
	const i = (y * size + x) * 4;
	const a = Math.min(1, alpha);
	for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + color[k] * a);
	px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
}

/** Riempie l'area dove `sdf` (distanza con segno) e' negativa. */
function fill(px, size, color, sdf) {
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			blend(px, size, x, y, color, Math.max(0, Math.min(1, 0.5 - sdf(x + 0.5, y + 0.5))));
		}
	}
}

const ring = (cx, cy, r, w, from = -Math.PI, to = Math.PI) => (x, y) => {
	const a = Math.atan2(y - cy, x - cx);
	if (a < from || a > to) return 1;
	return Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2;
};
const disc = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const box =
	(x0, y0, x1, y1, radius = 0) =>
	(x, y) => {
		const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
		const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
		return Math.hypot(dx, dy) - radius;
	};

function png(px, size) {
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filtro "none"
		Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
	}
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body) >>> 0);
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return c ^ 0xffffffff;
}

/** Disegni delle singole icone, in coordinate normalizzate 0..1. */
const ICONS = {
	plugin: (px, s) => {
		fill(px, s, C.track, ring(s / 2, s / 2, s * 0.3, s * 0.12));
		fill(px, s, C.green, ring(s / 2, s / 2, s * 0.3, s * 0.12, -Math.PI, Math.PI * 0.25));
	},
	"action-usage": (px, s) => {
		fill(px, s, C.track, ring(s / 2, s / 2, s * 0.3, s * 0.12));
		fill(px, s, C.green, ring(s / 2, s / 2, s * 0.3, s * 0.12, -Math.PI, Math.PI * 0.25));
	},
	"action-health": (px, s) => {
		fill(px, s, C.track, ring(s / 2, s / 2, s * 0.3, s * 0.12));
		fill(px, s, C.green, ring(s / 2, s / 2, s * 0.3, s * 0.12, -Math.PI, Math.PI * 0.55));
		fill(px, s, C.green, box(s * 0.38, s * 0.47, s * 0.62, s * 0.53, s * 0.02));
		fill(px, s, C.green, box(s * 0.47, s * 0.38, s * 0.53, s * 0.62, s * 0.02));
	},
	"action-activity": (px, s) => {
		const pts = [0.62, 0.38, 0.52, 0.28, 0.46, 0.34, 0.24];
		pts.forEach((h, i) => {
			const x = s * (0.1 + i * 0.12);
			fill(px, s, C.cyan, box(x, s * h, x + s * 0.07, s * 0.78, s * 0.02));
		});
	},
	"action-overview": (px, s) => {
		[
			[0.26, C.green, 0.72],
			[0.46, C.yellow, 0.48],
			[0.66, C.red, 0.88],
		].forEach(([y, color, w]) => {
			fill(px, s, C.track, box(s * 0.16, s * y, s * 0.84, s * (y + 0.11), s * 0.055));
			fill(px, s, color, box(s * 0.16, s * y, s * (0.16 + 0.68 * w), s * (y + 0.11), s * 0.055));
		});
	},
	"action-temp": (px, s) => {
		[
			[0.2, C.red, 0.25],
			[0.38, C.orange, 0.3],
			[0.56, C.yellow, 0.35],
			[0.74, C.green, 1],
		].forEach(([y, color, a]) => {
			fill(px, s, C.track, box(s * 0.18, s * y, s * 0.82, s * (y + 0.12), s * 0.03));
			for (let yy = 0; yy < s; yy++)
				for (let xx = 0; xx < s; xx++) {
					const d = box(s * 0.18, s * y, s * 0.82, s * (y + 0.12), s * 0.03)(xx + 0.5, yy + 0.5);
					if (d < 0) blend(px, s, xx, yy, color, a);
				}
		});
	},
	"action-power": (px, s) => {
		[0.5, 0.3, 0.62, 0.24, 0.44].forEach((h, i) => {
			const x = s * (0.12 + i * 0.16);
			fill(px, s, C.orange, box(x, s * h, x + s * 0.1, s * 0.8, s * 0.02));
		});
	},
	"action-network": (px, s) => {
		[
			[C.cyan, [0.6, 0.36, 0.46, 0.24]],
			[C.orange, [0.82, 0.7, 0.76, 0.62]],
		].forEach(([color, hs]) => {
			hs.forEach((h, i) => {
				const x = s * (0.12 + i * 0.21);
				fill(px, s, color, box(x, s * h, x + s * 0.14, s * (h + 0.07), s * 0.03));
			});
		});
	},
	"action-fan": (px, s) => {
		for (let i = 0; i < 3; i++) {
			const a = (i * 2 * Math.PI) / 3;
			fill(px, s, C.blue, disc(s / 2 + Math.cos(a) * s * 0.2, s / 2 + Math.sin(a) * s * 0.2, s * 0.15));
		}
		if (!mono) fill(px, s, C.bg, disc(s / 2, s / 2, s * 0.09));
		fill(px, s, C.blue, ring(s / 2, s / 2, s * 0.09, s * 0.04));
	},
	"action-back": (px, s) => {
		fill(px, s, C.grey, (x, y) => {
			// Chevron: due bracci a 45 gradi che partono dal centro-sinistra.
			const cx = s * 0.42;
			const cy = s * 0.5;
			const arm = Math.min(Math.abs(x - cx - Math.abs(y - cy)), 99);
			const inRange = Math.abs(y - cy) < s * 0.22 && x > cx - s * 0.02 && x < s * 0.68;
			return inRange ? arm - s * 0.055 : 1;
		});
	},
};
ICONS.category = ICONS.plugin;

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
const write = (name, size, px) => {
	fs.writeFileSync(path.join(OUT, `${name}.png`), png(px, size));
	count++;
};

for (const [name, draw] of Object.entries(ICONS)) {
	const isAction = name.startsWith("action");

	// Elenco azioni e categoria: monocromatiche bianche su fondo trasparente,
	// come richiesto dalle linee guida del Marketplace.
	for (const [suffix, size] of [
		["", isAction ? 20 : 28],
		["@2x", isAction ? 40 : 56],
	]) {
		if (name === "plugin") continue;
		const px = blank(size);
		mono = true;
		draw(px, size);
		mono = false;
		write(`${name}${suffix}`, size, px);
	}

	// Icona del prodotto: 256 e 512, a colori.
	if (name === "plugin") {
		for (const [suffix, size] of [
			["", 256],
			["@2x", 512],
		]) {
			const px = canvas(size);
			draw(px, size);
			write(`${name}${suffix}`, size, px);
		}
	}

	// Icona del tasto: a colori, con lo sfondo scuro del cruscotto.
	if (isAction) {
		for (const [suffix, size] of [
			["", 72],
			["@2x", 144],
		]) {
			const px = canvas(size);
			draw(px, size);
			write(`${name}-key${suffix}`, size, px);
		}
	}
}
// Icona per la pagina prodotto del Marketplace: 288x288, a colori.
const STORE = path.resolve("marketplace");
fs.mkdirSync(STORE, { recursive: true });
const store = canvas(288);
// Anello della capacita' con il segno della salute al centro: dice in un colpo
// solo di cosa si occupa il plugin.
fill(store, 288, C.track, ring(144, 144, 88, 30));
fill(store, 288, C.green, ring(144, 144, 88, 30, -Math.PI, Math.PI * 0.42));
fill(store, 288, C.green, box(102, 136, 186, 152, 6));
fill(store, 288, C.green, box(136, 102, 152, 186, 6));
fs.writeFileSync(path.join(STORE, "icon-288.png"), png(store, 288));

console.log(`generate ${count} icone in ${path.relative(process.cwd(), OUT)} + icon-288.png in marketplace/`);
