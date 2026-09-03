/**
 * Genera i profili distribuiti col plugin, uno per formato di Stream Deck:
 * la vista a schermo intero che si apre tenendo premuto un tasto.
 *
 * I tasti non citano lettere di unita' ma posizioni ("#1", "#2", ...), cosi'
 * lo stesso profilo funziona su qualsiasi PC; dove le posizioni non bastano si
 * usa la rotazione automatica, che copre tutti i dischi con un tasto solo.
 *
 *   node build-profile.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PLUGIN = "com.diskdeck.monitor";
const PLUGIN_DIR = path.resolve("com.diskdeck.monitor.sdPlugin");

/** Formati supportati: nome del profilo, modello, griglia e identificativo. */
const LAYOUTS = [
	{ name: "Disks", model: "20GBA9901", columns: 5, rows: 3, uuid: "7D1F0C4A-3B62-4E51-9E88-2F5A6C0D91B3" },
	{ name: "Disks XL", model: "20GAT9901", columns: 8, rows: 4, uuid: "7D1F0C4A-3B62-4E51-9E88-2F5A6C0D91B4" },
	{ name: "Disks Mini", model: "20GAI9901", columns: 3, rows: 2, uuid: "7D1F0C4A-3B62-4E51-9E88-2F5A6C0D91B5" },
	{ name: "Disks Plus", model: "20GBD9901", columns: 4, rows: 2, uuid: "7D1F0C4A-3B62-4E51-9E88-2F5A6C0D91B6" },
];

const key = (uuid, name, settings) => ({
	Name: name,
	Settings: settings,
	State: 0,
	States: [
		{
			FFamily: "",
			FSize: "13",
			FStyle: "",
			FUnderline: "off",
			Image: "",
			Title: "",
			TitleAlignment: "middle",
			TitleColor: "#ffffff",
			TitleShow: "",
		},
	],
	UUID: uuid,
});

const rotate = { rotate: "on", rotateEvery: "5", longPress: "off" };
const fixed = { longPress: "off" };

/**
 * Costruisce la griglia adattandola allo spazio: i tasti per singolo disco
 * riempiono le prime colonne, i tasti d'insieme occupano quel che resta e il
 * tasto per tornare indietro sta sempre nell'ultima posizione.
 */
function buildActions({ columns, rows }) {
	const actions = {};
	const free = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) free.push(`${col},${row}`);
	}
	const back = free.pop();

	const take = (cell) => {
		const i = free.indexOf(cell);
		if (i >= 0) free.splice(i, 1);
		return cell;
	};
	const place = (cell, uuid, name, settings) => {
		actions[take(cell)] = key(uuid, name, settings);
	};

	// Una colonna per disco: spazio in alto e, dove c'e' una riga in piu', la
	// temperatura sotto. Tre righe libere significano tre dischi visibili.
	const diskColumns = Math.max(1, Math.min(columns - 1, 6));
	for (let col = 0; col < diskColumns; col++) {
		const drive = `#${col + 1}`;
		place(`${col},0`, `${PLUGIN}.usage`, "Disk Space", { ...fixed, drive, style: "ring" });
		if (rows >= 3) place(`${col},1`, `${PLUGIN}.temp`, "Disk Temperature", { ...fixed, drive, showValue: "si" });
		if (rows >= 4) {
			place(`${col},2`, `${PLUGIN}.activity`, "Disk Activity", {
				...fixed,
				drive,
				style: "bars",
				ioTrack: "stacked",
			});
		}
	}

	// Tasti d'insieme, in ordine di utilita': quelli che ruotano da soli
	// coprono tutti i dischi e tutti i sensori anche su griglie piccole.
	const extras = [
		[`${PLUGIN}.overview`, "Disk Overview", {}],
		[`${PLUGIN}.health`, "Disk Health", { ...rotate }],
		// L'attivita' in rotazione serve solo dove non c'e' gia' per disco.
		...(rows >= 4 ? [] : [[`${PLUGIN}.activity`, "Disk Activity", { ...rotate, style: "bars", ioTrack: "stacked" }]]),
		[`${PLUGIN}.network`, "Network", { ...rotate }],
		[`${PLUGIN}.fan`, "Fan", { ...rotate }],
		[`${PLUGIN}.power`, "Power", { ...rotate }],
		// La temperatura a rotazione e' l'ultima: sulle griglie alte ogni disco
		// ha gia' il suo tasto, quindi entra solo se avanza spazio.
		...(rows >= 3 ? [] : [[`${PLUGIN}.temp`, "Disk Temperature", { ...rotate, showValue: "si" }]]),
	];
	for (const [uuid, name, settings] of extras) {
		const cell = free.shift();
		if (!cell) break;
		actions[cell] = key(uuid, name, settings);
	}

	actions[back] = key(`${PLUGIN}.back`, "Back", {});
	return actions;
}

for (const layout of LAYOUTS) {
	const work = path.resolve("build", `${layout.uuid}.sdProfile`);
	const out = path.join(PLUGIN_DIR, `${layout.name}.streamDeckProfile`);

	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
	fs.writeFileSync(
		path.join(work, "manifest.json"),
		JSON.stringify({
			Actions: buildActions(layout),
			DeviceModel: layout.model,
			Name: layout.name,
			Version: "1.0",
		}),
	);
	// Ogni posizione della griglia ha la sua cartella, anche quando e' vuota.
	for (let col = 0; col < layout.columns; col++) {
		for (let row = 0; row < layout.rows; row++) {
			fs.mkdirSync(path.join(work, `${col},${row}`, "CustomImages"), { recursive: true });
		}
	}

	// Compress-Archive accetta solo l'estensione .zip: comprimiamo e rinominiamo.
	const zip = `${out}.zip`;
	fs.rmSync(out, { force: true });
	fs.rmSync(zip, { force: true });
	if (process.platform === "win32") {
		execFileSync("powershell.exe", [
			"-NoProfile",
			"-Command",
			`Compress-Archive -Path '${work}' -DestinationPath '${zip}' -Force`,
		]);
	} else {
		// Fuori da Windows (CI, macOS, Linux) usiamo `zip`, mantenendo la cartella radice come Compress-Archive.
		execFileSync("zip", ["-qr", zip, path.basename(work)], { cwd: path.dirname(work) });
	}
	fs.renameSync(zip, out);
	console.log(`${layout.name}: griglia ${layout.columns}x${layout.rows} (${layout.model})`);
}
