/**
 * Genera le immagini per la pagina prodotto del Marketplace (1920x960 PNG):
 * una copertina e tre schede, composte con i tasti veri disegnati dal plugin e
 * i dati reali della macchina, poi catturate con Edge in modalita' headless.
 *
 *   node build-gallery.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as R from "./com.diskdeck.monitor.sdPlugin/bin/render.js";
import { sampler } from "./com.diskdeck.monitor.sdPlugin/bin/sampler.js";
import { sensors } from "./com.diskdeck.monitor.sdPlugin/bin/sensors.js";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = path.resolve("marketplace");
const W = 1920;
const H = 960;

/** Aspetta che sampler e sensori abbiano abbastanza storico per i grafici. */
async function collect() {
	sensors.start();
	sampler.start();
	await new Promise((resolve) => {
		let n = 0;
		sampler.on("sample", () => {
			if (++n >= 12) resolve();
		});
	});
	sampler.stop();
	sensors.stop();
}

const page = (title, subtitle, body, center = false) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    background: radial-gradient(120% 90% at 20% 0%, #1b2136 0%, #0a0b12 60%, #06070c 100%);
    font-family: "Segoe UI", Arial, sans-serif; color: #e8ecf5;
    display: flex; flex-direction: column; justify-content: center;
    align-items: ${center ? "center" : "flex-start"};
    text-align: ${center ? "center" : "left"};
    padding: 0 110px;
  }
  h1 { font-size: 68px; font-weight: 700; letter-spacing: -1px; }
  h1 span { color: #2ce38a; }
  p.sub { font-size: 29px; color: #98a1b8; margin-top: 16px; max-width: 1250px; line-height: 1.45; }
  .keys { display: flex; gap: 30px; margin-top: 60px; }
  .keys img { width: 244px; height: 244px; border-radius: 26px; }
  .grid { display: grid; grid-template-columns: repeat(5, 132px); gap: 14px; }
  .grid img { width: 132px; height: 132px; border-radius: 16px; }
  .row { display: flex; align-items: center; gap: 90px; margin-top: 12px; }
  ul { margin-top: 34px; list-style: none; }
  li { font-size: 27px; color: #c3cbdb; margin-bottom: 20px; padding-left: 34px; position: relative; }
  li::before { content: ""; position: absolute; left: 0; top: 10px; width: 12px; height: 12px; border-radius: 50%; background: #2ce38a; }
  li b { color: #ffffff; font-weight: 600; }
  .foot { position: absolute; bottom: 52px; left: 0; right: 0; text-align: center; font-size: 20px; color: #5d6479; letter-spacing: 2px; }
</style></head><body>
  <h1>${title}</h1>
  <p class="sub">${subtitle}</p>
  ${body}
  <div class="foot">DISK HEALTH DECK</div>
</body></html>`;

const keys = (images, cls = "keys") =>
	`<div class="${cls}">${images.map((src) => `<img src="${src}">`).join("")}</div>`;

async function main() {
	await collect();
	R.setLanguage("en");
	fs.mkdirSync(OUT, { recursive: true });

	const disks = sampler.latest.disks;
	const first = disks[0];
	const smart = (d) => sensors.lookup({ model: d.model, letter: d.id });
	const withHealth = disks.map((d) => ({ ...d, life: smart(d)?.life ?? null }));
	const ring = (d) =>
		R.renderUsageRing({
			label: d.label ? `${d.id} ${d.label}` : d.id,
			pct: ((d.size - d.free) / d.size) * 100,
			used: d.size - d.free,
			size: d.size,
		});
	const temp = (d) => {
		const s = smart(d);
		return R.renderTemp({ label: d.id, temp: s?.temp ?? 40, peak: s?.peak, mode: "temp" });
	};
	const health = (d) => {
		const s = smart(d);
		return R.renderHealth({ label: d.id, life: s?.life, hours: s?.hours, count: s?.count });
	};
	const io = (d) => {
		const h = sampler.getHistory(d.id);
		let series = h.read.map((r, i) => [r, h.write[i] ?? 0]);
		let value = d.read + d.write;
		// Se il disco e' fermo il grafico resterebbe piatto: per la vetrina
		// mostriamo un andamento realistico invece di una riga vuota.
		if (series.reduce((a, [r, w]) => a + r + w, 0) < 1024 * 1024) {
			const M = 1024 * 1024;
			series = Array.from({ length: 24 }, (_, i) => [
				(4 + 9 * Math.abs(Math.sin(i / 2.3))) * M,
				(1 + 4 * Math.abs(Math.cos(i / 1.7))) * M,
			]);
			value = series.at(-1)[0] + series.at(-1)[1];
		}
		return R.renderIoBars({ label: d.id, value, history: series, stacked: true });
	};

	const netId = sensors.listNets().find((n) => sensors.getNet(n.id).down + sensors.getNet(n.id).up > 0)?.id;
	const fanId = sensors.listFans().find((f) => sensors.getFan(f.id).rpm > 0)?.id;
	const powerId = sensors.listPowers()[0]?.id;

	const shots = [
		{
			file: "01-cover.png",
			center: true,
			title: 'Your disks, <span>on the keys</span>',
			sub: "Free space, SMART health, live I/O and temperature — one key each, updated every second.",
			body: keys([ring(first), health(disks[1] ?? first), temp(disks[2] ?? first), io(first), R.renderOverview(withHealth)]),
		},
		{
			file: "02-health.png",
			title: "Know before a disk <span>fails</span>",
			sub: "Remaining life, power-on hours and start count, straight from SMART. No other disk plugin shows them.",
			body: `<div class="row">${keys(disks.slice(0, 3).map(health))}<ul>
        <li><b>Remaining life</b> as a ring, green to red</li>
        <li><b>Hours in service</b>, also in years</li>
        <li>Health dot on the <b>overview key</b></li>
      </ul></div>`,
		},
		{
			file: "03-alerts.png",
			title: "The key <span>calls you</span>",
			sub: "Set a threshold and the frame flashes red: low free space, overheating, worn-out drive.",
			body: (() => {
				R.setAlert(true, true);
				const a = R.renderUsageRing({ label: "C: SYSTEM", pct: 96, used: 960e9, size: 1000e9 });
				const b = R.renderTemp({ label: "D:", temp: 71, peak: 78, mode: "temp" });
				R.setAlert(true, false);
				const c = R.renderHealth({ label: "E:", life: 14, hours: 48210, count: 9004 });
				R.setAlert(false, false);
				return `<div class="row">${keys([a, b, c])}<ul>
          <li>Free space below <b>10%</b></li>
          <li>Temperature above <b>60 °C</b></li>
          <li>Remaining life under <b>20%</b></li>
        </ul></div>`;
			})(),
		},
		{
			file: "04-more.png",
			center: true,
			title: "More than <span>disks</span>",
			sub: "Network throughput, fan speed and power draw from the same sensors. Nine actions, four ready-made profiles.",
			body: keys([
				netId
					? R.renderNetwork({
							label: "Network",
							down: sensors.getNet(netId).down,
							up: sensors.getNet(netId).up,
							history: sensors.getNetHistory(netId),
						})
					: R.renderPlaceholder("network", 3),
				fanId
					? R.renderFan({ label: sensors.getFan(fanId).name, rpm: sensors.getFan(fanId).rpm, history: sensors.getFanHistory(fanId) })
					: R.renderPlaceholder("fan", 3),
				powerId
					? R.renderPower({
							label: sensors.getPower(powerId).name,
							value: sensors.getPower(powerId).value,
							history: sensors.getPowerHistory(powerId),
						})
					: R.renderPlaceholder("power", 3),
				io(disks[1] ?? first),
				R.renderUsageBar({
					label: first.id,
					pct: ((first.size - first.free) / first.size) * 100,
					used: first.size - first.free,
					free: first.free,
					size: first.size,
				}),
			]),
		},
	];

	for (const shot of shots) {
		const html = path.join(OUT, shot.file.replace(".png", ".html"));
		fs.writeFileSync(html, page(shot.title, shot.sub, shot.body, shot.center === true));
		execFileSync(EDGE, [
			"--headless=new",
			"--disable-gpu",
			`--window-size=${W},${H}`,
			`--screenshot=${path.join(OUT, shot.file)}`,
			"--hide-scrollbars",
			"--virtual-time-budget=2000",
			`file:///${html.replace(/\\/g, "/")}`,
		]);
		fs.rmSync(html);
		console.log(`${shot.file} pronto`);
	}
	process.exit(0);
}

main();
