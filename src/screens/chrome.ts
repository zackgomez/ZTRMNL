// On-glass status bar prepended to every screen -- friendly name + MAC on
// the left, battery/RSSI/refresh-rate on the right. Satori HTML dialect
// rules apply here same as any screen (see README "Satori HTML dialect
// rules"): explicit display:flex, no HTML entities (literal '·' below).
import { FONT_FAMILY } from "../render.js";
import type { RenderContext } from "./types.js";

// Rough LiPo discharge curve endpoints used only when the device sends a
// raw voltage but no pre-computed percentage.
const BATTERY_EMPTY_V = 3.4;
const BATTERY_FULL_V = 4.1;

function batteryLabel(ctx: RenderContext): string {
  const { percentCharged, batteryVoltage } = ctx.telemetry;
  let pct: number | undefined;
  if (percentCharged !== undefined) {
    pct = Math.round(percentCharged);
  } else if (batteryVoltage !== undefined) {
    const raw =
      ((batteryVoltage - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V)) * 100;
    pct = Math.round(Math.min(100, Math.max(0, raw)));
  }
  return pct === undefined ? "bat ?" : `bat ${pct}%`;
}

function rateLabel(seconds: number): string {
  return seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

/**
 * Slim status bar for the top of every screen: `<friendly_id> · <mac>` on
 * the left, `bat <NN>% · <RSSI>dBm · every <Xm>` on the right. All values
 * come from `ctx.telemetry` -- the CURRENT poll's parsed headers -- so the
 * battery reading is as fresh as the wake that's rendering it, not a stale
 * sqlite snapshot from a prior poll.
 */
export function statusBar(ctx: RenderContext): string {
  const { rssi } = ctx.telemetry;
  const rightParts = [batteryLabel(ctx)];
  if (rssi !== undefined) rightParts.push(`${rssi}dBm`);
  rightParts.push(`every ${rateLabel(ctx.refreshRate)}`);

  return `<div style="display:flex;width:100%;height:28px;flex-shrink:0;padding:0 32px;font-size:16px;font-family:'${FONT_FAMILY}';color:#000;border-bottom:2px solid #000;justify-content:space-between;align-items:center;"><span>${ctx.device.friendlyId} · ${ctx.device.mac}</span><span>${rightParts.join(" · ")}</span></div>`;
}
