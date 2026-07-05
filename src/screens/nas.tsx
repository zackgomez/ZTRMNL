// NAS status screen -- near-verbatim port of reference/nas_template.html
// (originally a Liquid template rendered by Terminus), now authored as JSX
// via reactScreen. Satori's flexbox rules apply (see README "Satori HTML
// dialect rules"): every element with >1 child and every empty div gets
// explicit display:flex; flex-direction defaults to row.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { CSSProperties, ReactNode } from "react";
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import { fetchNasMetrics, type NasData } from "../sources/nasMetrics.js";
import { StatusBar, STATUS_BAR_HEIGHT } from "./chrome.js";
import { reactScreen } from "./react.js";
import type { RenderContext } from "./types.js";

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
const col: CSSProperties = { display: "flex", flexDirection: "column" };

/** One zpool block: name + percent, fill bar, used/total + health/frag. */
function Pool(props: {
  name: string;
  pct: number;
  used: string;
  total: string;
  health: string;
  frag: string;
  marginBottom?: string;
}): ReactNode {
  return (
    <div style={{ ...col, ...(props.marginBottom ? { marginBottom: props.marginBottom } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "34px", fontWeight: 700 }}>{props.name}</span>
        <span style={{ fontSize: "36px", fontWeight: 700 }}>{`${props.pct}%`}</span>
      </div>
      <div
        style={{
          display: "flex",
          height: "34px",
          border: "2px solid #000",
          borderRadius: "5px",
          overflow: "hidden",
          margin: "4px 0",
        }}
      >
        <div style={{ display: "flex", height: "100%", width: `${props.pct}%`, background: "#888" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "18px" }}>
        <span>{`${props.used} / ${props.total}`}</span>
        <span>{`${props.health} · frag ${props.frag}`}</span>
      </div>
    </div>
  );
}

const statCell: CSSProperties = { flex: 1, ...col, alignItems: "center", padding: "0 10px" };
const statDivider: CSSProperties = { borderLeft: "2px solid #888" };

function Markup({ d, ctx }: { d: NasData; ctx: RenderContext }): ReactNode {
  const contentHeight = ctx.height - STATUS_BAR_HEIGHT;
  return (
    <div
      style={{
        height: `${ctx.height}px`,
        width: `${ctx.width}px`,
        ...col,
        fontFamily: FONT_FAMILY,
        background: "#fff",
        color: "#000",
      }}
    >
      <StatusBar ctx={ctx} />
      <div
        style={{
          height: `${contentHeight}px`,
          width: `${ctx.width}px`,
          padding: "16px 32px",
          ...col,
          justifyContent: "space-between",
        }}
      >
        <div style={col}>
          <Pool
            name="tank"
            pct={d.tank_pct}
            used={d.tank_used}
            total={d.tank_total}
            health={d.tank_health}
            frag={d.tank_frag}
            marginBottom="14px"
          />
          <Pool
            name="fastpool"
            pct={d.fastpool_pct}
            used={d.fastpool_used}
            total={d.fastpool_total}
            health={d.fastpool_health}
            frag={d.fastpool_frag}
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "2px solid #000",
            borderBottom: "2px solid #000",
            padding: "16px 0",
          }}
        >
          <div style={statCell}>
            <div style={{ fontSize: "48px", fontWeight: 700, lineHeight: 1 }}>{d.load1}</div>
            <div style={{ fontSize: "19px", marginTop: "6px" }}>load 1m</div>
            <div style={{ fontSize: "16px" }}>{`${d.load5} / ${d.load15}`}</div>
          </div>
          <div style={{ ...statCell, ...statDivider }}>
            <div style={{ fontSize: "48px", fontWeight: 700, lineHeight: 1 }}>{`${d.mem_pct}%`}</div>
            <div style={{ fontSize: "19px", marginTop: "6px" }}>memory</div>
            <div style={{ fontSize: "16px" }}>{`${d.ncpus} cores`}</div>
          </div>
          <div style={{ ...statCell, ...statDivider }}>
            <div style={{ display: "flex", alignItems: "baseline", fontWeight: 700, lineHeight: 1 }}>
              <span style={{ fontSize: "48px" }}>{d.cpu_w}</span>
              <span style={{ fontSize: "26px" }}>W</span>
            </div>
            <div style={{ fontSize: "19px", marginTop: "6px" }}>CPU power</div>
            <div style={{ fontSize: "16px" }}>{`${d.cpu_w_avg}W avg/1h`}</div>
          </div>
          <div style={{ ...statCell, justifyContent: "center", ...statDivider }}>
            <div style={{ fontSize: "40px", lineHeight: 1 }}>{d.internet === "up" ? "●" : "○"}</div>
            <div style={{ fontSize: "19px", marginTop: "8px" }}>{`internet ${d.internet}`}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "22px", fontWeight: 700 }}>
          <span>NAS</span>
          <span>{`up ${d.uptime_d} · ${d.updated}`}</span>
        </div>
      </div>
    </div>
  );
}

export const nasScreen = reactScreen({
  name: "nas",
  async render(ctx: RenderContext): Promise<ReactNode> {
    const data = await fetchData();
    return <Markup d={data} ctx={ctx} />;
  },
});
