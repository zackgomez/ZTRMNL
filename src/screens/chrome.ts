// On-glass status bar prepended to every screen -- friendly name + MAC on
// the left, update-rate/wifi/battery on the right (battery rightmost).
// Satori HTML dialect rules apply here same as any screen (see README
// "Satori HTML dialect rules"): explicit display:flex on every element with
// more than one child AND every empty div, no HTML entities (literal '·'/
// '!' below).
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import type { RenderContext } from "./types.js";

// Height of the bar itself -- kept in sync with nas.ts's STATUS_BAR_HEIGHT
// import (nas.ts subtracts this from its content area; don't hardcode a
// second copy of this number anywhere else).
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
function batteryIcon(pct: number | undefined): string {
  const fillPct = pct ?? 0;
  const box = `<div style="display:flex;width:24px;height:14px;border:2px solid #000;"><div style="display:flex;height:100%;width:${fillPct}%;background:#000;"></div></div>`;
  const nub = `<div style="display:flex;width:3px;height:6px;background:#000;margin-left:1px;"></div>`;
  return `<div style="display:flex;align-items:center;">${box}${nub}</div>`;
}

/** 4 ascending signal-bars, filled #000 vs empty #fff (against the grey bar
 * background) based on how many bars `filled` calls for (0-4). */
function wifiBars(filled: number): string {
  const heights = [5, 9, 13, 17];
  const bars = heights
    .map((h, i) => {
      const margin = i < heights.length - 1 ? "margin-right:2px;" : "";
      const color = i < filled ? "#000" : "#ccc"; // empty bars: light-gray, visible on white
      return `<div style="display:flex;width:4px;height:${h}px;background:${color};${margin}"></div>`;
    })
    .join("");
  return `<div style="display:flex;align-items:flex-end;height:17px;">${bars}</div>`;
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
function wifiGroup(ctx: RenderContext): string {
  const { rssi, wifiBand } = ctx.telemetry;
  const filled = wifiBarsFilled(rssi);
  const label = wifiNetworkLabel(wifiBand);
  const weak = rssi !== undefined && rssi < -75;

  const labelHtml = label ? `<span style="margin-left:6px;">${label}</span>` : "";
  const weakHtml = weak
    ? `<span style="font-weight:700;margin-left:6px;">weak</span><div style="display:flex;align-items:center;justify-content:center;border:2px solid #000;width:14px;height:14px;margin-left:4px;"><span style="font-weight:700;font-size:12px;">!</span></div>`
    : "";

  return `<div style="display:flex;align-items:center;">${wifiBars(filled)}${labelHtml}${weakHtml}</div>`;
}

/** Battery cluster: drawn icon + "NN%" (or "?" when charge is unknown). */
function batteryGroup(ctx: RenderContext): string {
  const pct = batteryPct(ctx);
  const text = pct === undefined ? "?" : `${pct}%`;
  return `<div style="display:flex;align-items:center;">${batteryIcon(pct)}<span style="margin-left:6px;">${text}</span></div>`;
}

/**
 * Slim status bar for the top of every screen: `<friendly_id> · <mac>` on
 * the left; on the right, in order, `every <Xm>` · wifi (drawn bars + label
 * + weak warning) · battery (drawn icon + `NN%`), battery rightmost. All
 * values come from `ctx.telemetry` -- the CURRENT poll's parsed headers --
 * so the readings are as fresh as the wake that's rendering them, not a
 * stale sqlite snapshot from a prior poll.
 */
export function statusBar(ctx: RenderContext): string {
  const separator = `<span style="margin:0 8px;">·</span>`;
  const rightCluster = `<div style="display:flex;align-items:center;"><span>every ${rateLabel(ctx.refreshRate)}</span>${separator}${wifiGroup(ctx)}${separator}${batteryGroup(ctx)}</div>`;

  return `<div style="display:flex;width:100%;height:${STATUS_BAR_HEIGHT}px;flex-shrink:0;padding:0 32px;font-size:16px;font-family:'${FONT_FAMILY}';color:#000;background:${BAR_BG};border-bottom:2px solid #000;justify-content:space-between;align-items:center;"><span>${ctx.device.friendlyId} · ${ctx.device.mac}</span>${rightCluster}</div>`;
}
