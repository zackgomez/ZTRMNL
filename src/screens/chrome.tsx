// On-glass status bar prepended to every screen -- friendly name + MAC on
// the left, update-rate/wifi/battery on the right (battery rightmost).
// JSX component consumed by reactScreen screens (see src/screens/react.tsx);
// satori's flexbox rules apply same as any screen (explicit display:flex on
// every element with more than one child and every empty div).
import type { ReactNode } from "react";
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import type { RenderContext } from "./types.js";

// Height of the bar itself -- screens subtract this from their content area;
// don't hardcode a second copy of this number anywhere else.
export const STATUS_BAR_HEIGHT = 32;

// Bar background. The device's 2-bit quantizer buckets 8-bit gray as
// <43 -> black, <128 -> dark-gray(85), <213 -> light-gray(170), else white.
// White bg: the panel only has 4 tones (0/85/170/255) and 170 reads darker
// on glass than expected -- so white bar, black bottom border for separation.
// #ddd/#eee (221/238) would snap to white -- don't use those here.
const BAR_BG = "#fff";

// Rough LiPo discharge curve endpoints used only when the device sends a
// raw voltage but no pre-computed percentage.
const BATTERY_EMPTY_V = 3.4;
const BATTERY_FULL_V = 4.1;

/** Battery charge percentage (0-100), or undefined if neither
 * percent-charged nor a voltage reading is available. */
function batteryPct(ctx: RenderContext): number | undefined {
  const { percentCharged, batteryVoltage } = ctx.telemetry;
  if (percentCharged !== undefined) {
    return Math.round(percentCharged);
  }
  if (batteryVoltage !== undefined) {
    const raw =
      ((batteryVoltage - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100;
    return Math.round(Math.min(100, Math.max(0, raw)));
  }
  return undefined;
}

function rateLabel(seconds: number): string {
  return seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

/** Drawn battery icon: 24x14px box with a 2px #000 border + a 3px-wide nub
 * on the right, and an interior fill div whose width% is the charge. Empty
 * (0-width fill) when charge is unknown. */
function BatteryIcon({ pct }: { pct: number | undefined }): ReactNode {
  const fillPct = pct ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", width: "24px", height: "14px", border: "2px solid #000" }}>
        <div style={{ display: "flex", height: "100%", width: `${fillPct}%`, background: "#000" }} />
      </div>
      <div style={{ display: "flex", width: "3px", height: "6px", background: "#000", marginLeft: "1px" }} />
    </div>
  );
}

/** 4 ascending signal-bars, filled #000 vs empty light-gray (visible on the
 * white bar background) based on how many bars `filled` calls for (0-4). */
function WifiBars({ filled }: { filled: number }): ReactNode {
  const heights = [5, 9, 13, 17];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: "17px" }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: "4px",
            height: `${h}px`,
            background: i < filled ? "#000" : "#ccc",
            ...(i < heights.length - 1 ? { marginRight: "2px" } : {}),
          }}
        />
      ))}
    </div>
  );
}

/** Number of filled wifi bars (0-4) for a given RSSI reading; no RSSI means
 * no reading at all -- render all bars empty. */
function wifiBarsFilled(rssi: number | undefined): number {
  if (rssi === undefined) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

/** Wifi network label: config.wifiName when set, else the band reported by
 * telemetry ("2.4G"/"5G") when present, else nothing. */
function wifiNetworkLabel(wifiBand: number | undefined): string {
  if (config.wifiName) return config.wifiName;
  if (wifiBand === undefined) return "";
  if (wifiBand === 2.4) return "2.4G";
  if (wifiBand === 5) return "5G";
  return `${wifiBand}G`;
}

/** Wifi cluster: drawn signal bars + network label + (if RSSI is present
 * and weak) a bold "weak" tag and a small drawn warning box. */
function WifiGroup({ ctx }: { ctx: RenderContext }): ReactNode {
  const { rssi, wifiBand } = ctx.telemetry;
  const filled = wifiBarsFilled(rssi);
  const label = wifiNetworkLabel(wifiBand);
  const weak = rssi !== undefined && rssi < -75;

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <WifiBars filled={filled} />
      {label ? <span style={{ marginLeft: "6px" }}>{label}</span> : null}
      {weak ? (
        <span style={{ fontWeight: 700, marginLeft: "6px" }}>weak</span>
      ) : null}
      {weak ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #000",
            width: "14px",
            height: "14px",
            marginLeft: "4px",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "12px" }}>!</span>
        </div>
      ) : null}
    </div>
  );
}

/** Battery cluster: drawn icon + "NN%" (or "?" when charge is unknown). */
function BatteryGroup({ ctx }: { ctx: RenderContext }): ReactNode {
  const pct = batteryPct(ctx);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <BatteryIcon pct={pct} />
      <span style={{ marginLeft: "6px" }}>{pct === undefined ? "?" : `${pct}%`}</span>
    </div>
  );
}

function Sep(): ReactNode {
  return <span style={{ margin: "0 8px" }}>·</span>;
}

/** Render time as 24h `HH:MM` in the configured timezone. On glass this is
 * effectively a "rendered at" stamp: it ages up to refresh_rate seconds
 * until the next wake repaints it. */
function clockLabel(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * Slim status bar for the top of every screen: `<friendly_id> · <mac>` on
 * the left; the render-time clock (24h, config.timezone) dead center; on
 * the right, in order, `every <Xm>` · wifi (drawn bars + label + weak
 * warning) · battery (drawn icon + `NN%`), battery rightmost. The side
 * clusters sit in mirrored flex:1 wrappers so the clock stays centered
 * regardless of how wide either side is. All values come from `ctx` -- the
 * CURRENT poll's parsed headers and injected clock -- so the readings are
 * as fresh as the wake that's rendering them, not a stale sqlite snapshot
 * from a prior poll.
 */
export function StatusBar({ ctx }: { ctx: RenderContext }): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: `${STATUS_BAR_HEIGHT}px`,
        flexShrink: 0,
        padding: "0 32px",
        fontSize: "16px",
        fontFamily: FONT_FAMILY,
        color: "#000",
        background: BAR_BG,
        borderBottom: "2px solid #000",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
        <span>{`${ctx.device.friendlyId} · ${ctx.device.mac}`}</span>
      </div>
      <span style={{ fontWeight: 700 }}>{clockLabel(ctx.now)}</span>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
        <span>{`every ${rateLabel(ctx.refreshRate)}`}</span>
        <Sep />
        <WifiGroup ctx={ctx} />
        <Sep />
        <BatteryGroup ctx={ctx} />
      </div>
    </div>
  );
}
