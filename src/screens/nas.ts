// NAS status screen -- near-verbatim port of reference/nas_template.html
// (originally a Liquid template rendered by Terminus) to a JS template
// string interpolated directly, per the satori HTML dialect rules:
//   1. Every element with >1 child needs explicit display:flex (satori has
//      no block layout; flex-direction defaults to row).
//   2. Empty divs also need display:flex (satori-html gives them
//      children: [], and satori requires explicit display for array
//      children -- this includes the bar-fill divs below).
//   3. Whitespace between tags must be stripped (text nodes count as
//      children -> violates rule 1); see render.ts's minify().
//   4. HTML entities are not supported -- use literal UTF-8 chars
//      ('·', '●', '○') instead of &middot;/&#9679;/&#9675;.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import { fetchNasMetrics, type NasData } from "../sources/nasMetrics.js";
import { statusBar } from "./chrome.js";
import { htmlScreen } from "./html.js";
import type { RenderContext } from "./types.js";

// Height reserved at the top of every screen for the on-glass status bar
// (see chrome.ts) -- kept in sync with statusBar()'s own height:28px.
const STATUS_BAR_HEIGHT = 28;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "..", "reference", "nas.json");

export type { NasData };

async function fetchData(): Promise<NasData> {
  if (config.fixtureData) {
    return JSON.parse(readFileSync(fixturePath, "utf-8"));
  }
  if (config.influxUrl) {
    return fetchNasMetrics(config);
  }
  // Legacy fallback while migrating off the standalone collector daemon.
  const res = await fetch(config.collectorUrl, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) {
    throw new Error(`collector fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as NasData;
}

// display:flex + flex-direction:column shorthand, matching render.mjs.
const col = "display:flex;flex-direction:column;";

function buildMarkup(d: NasData, ctx: RenderContext): string {
  const contentHeight = ctx.height - STATUS_BAR_HEIGHT;
  const raw = `
<div style="height:${ctx.height}px;width:${ctx.width}px;${col}font-family:'${FONT_FAMILY}';background:#fff;color:#000;">
${statusBar(ctx)}
<div style="height:${contentHeight}px;width:${ctx.width}px;padding:16px 32px;${col}justify-content:space-between;">

  <div style="${col}">
    <div style="${col}margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:34px;font-weight:700;">tank</span>
        <span style="font-size:36px;font-weight:700;">${d.tank_pct}%</span>
      </div>
      <div style="display:flex;height:34px;border:2px solid #000;border-radius:5px;overflow:hidden;margin:4px 0;">
        <div style="display:flex;height:100%;width:${d.tank_pct}%;background:#888;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;">
        <span>${d.tank_used} / ${d.tank_total}</span>
        <span>${d.tank_health} · frag ${d.tank_frag}</span>
      </div>
    </div>

    <div style="${col}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:34px;font-weight:700;">fastpool</span>
        <span style="font-size:36px;font-weight:700;">${d.fastpool_pct}%</span>
      </div>
      <div style="display:flex;height:34px;border:2px solid #000;border-radius:5px;overflow:hidden;margin:4px 0;">
        <div style="display:flex;height:100%;width:${d.fastpool_pct}%;background:#888;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;">
        <span>${d.fastpool_used} / ${d.fastpool_total}</span>
        <span>${d.fastpool_health} · frag ${d.fastpool_frag}</span>
      </div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;border-top:2px solid #000;border-bottom:2px solid #000;padding:16px 0;">
    <div style="flex:1;${col}align-items:center;padding:0 10px;">
      <div style="font-size:48px;font-weight:700;line-height:1;">${d.load1}</div>
      <div style="font-size:19px;margin-top:6px;">load 1m</div>
      <div style="font-size:16px;">${d.load5} / ${d.load15}</div>
    </div>
    <div style="flex:1;${col}align-items:center;padding:0 10px;border-left:2px solid #888;">
      <div style="font-size:48px;font-weight:700;line-height:1;">${d.mem_pct}%</div>
      <div style="font-size:19px;margin-top:6px;">memory</div>
      <div style="font-size:16px;">${d.ncpus} cores</div>
    </div>
    <div style="flex:1;${col}align-items:center;padding:0 10px;border-left:2px solid #888;">
      <div style="display:flex;align-items:baseline;font-weight:700;line-height:1;">
        <span style="font-size:48px;">${d.cpu_w}</span><span style="font-size:26px;">W</span>
      </div>
      <div style="font-size:19px;margin-top:6px;">CPU power</div>
      <div style="font-size:16px;">${d.cpu_w_avg}W avg/1h</div>
    </div>
    <div style="flex:1;${col}align-items:center;justify-content:center;padding:0 10px;border-left:2px solid #888;">
      <div style="font-size:40px;line-height:1;">${d.internet === "up" ? "●" : "○"}</div>
      <div style="font-size:19px;margin-top:8px;">internet ${d.internet}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:700;">
    <span>NAS</span>
    <span>up ${d.uptime_d} · ${d.updated}</span>
  </div>

</div>
</div>`;
  return raw;
}

export const nasScreen = htmlScreen({
  name: "nas",
  async renderHTML(ctx: RenderContext): Promise<string> {
    const data = await fetchData();
    return buildMarkup(data, ctx);
  },
});
