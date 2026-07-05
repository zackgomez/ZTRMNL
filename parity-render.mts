// Renders deterministic PNGs of every screen/state for refactor parity diffing.
// Usage: tsx parity-render.mts <outdir>
import { writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./src/config.js";
import { screens } from "./src/screens/index.js";
import { renderScreen, minify } from "./src/render.js";
import type { RenderContext } from "./src/screens/types.js";

(config as any).fixtureData = true;
(config as any).timezone = "America/New_York";

const outDir = process.argv[2];
const log = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child() { return this; }, level: "info" } as any;

const NOW = new Date("2026-07-05T14:37:22-04:00");

function ctx(telemetry: RenderContext["telemetry"]): RenderContext {
  return {
    width: 800, height: 480,
    device: { mac: "94:A9:90:8F:48:D4", friendlyId: "ZT-4HHIO3" },
    now: NOW,
    telemetry,
    refreshRate: 900,
    html: (m: string) => renderScreen(minify(m), 800, 480),
    log,
  };
}

const cases: Array<[string, RenderContext]> = [
  ["nas-full", ctx({ batteryVoltage: 3.9, percentCharged: 71, rssi: -60, wifiBand: 2.4 })],
  ["nas-empty-telemetry", ctx({})],
  ["nas-weak-wifi", ctx({ batteryVoltage: 3.5, rssi: -80 })],
  ["calendar-full", ctx({ percentCharged: 33, rssi: -50, wifiBand: 5 })],
];
for (const [name, c] of cases) {
  const screen = name.startsWith("nas") ? screens.nas : screens.calendar;
  const png = await screen.render(c);
  writeFileSync(path.join(outDir, `${name}.png`), png);
  console.log(name, png.length, "bytes");
}
