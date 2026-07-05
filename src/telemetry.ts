import type { FastifyBaseLogger } from "fastify";

/** Parsed subset of Schemas::Firmware::Header (see spec's device API contract table). */
export interface Telemetry {
  id: string | undefined; // MAC, required by the device API (not by this parser)
  batteryVoltage: number | undefined;
  fwVersion: string | undefined;
  width: number | undefined;
  height: number | undefined;
  imageCached: boolean | undefined;
  model: string | undefined;
  percentCharged: number | undefined;
  refreshRate: number | undefined;
  rssi: number | undefined;
  sensors: string | undefined;
  temperatureProfile: boolean | undefined;
  updateSource: string | undefined;
  usbConnected: boolean | undefined;
  wakeTime: number | undefined;
  wifiBand: number | undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v !== "string") return undefined;
  return v === "true" || v === "1";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Parse device telemetry headers. NOTE: Fastify lowercases all incoming
 * header names, so `Battery-Voltage` arrives as `headers["battery-voltage"]`.
 */
export function parseTelemetry(headers: Record<string, unknown>): Telemetry {
  return {
    id: str(headers["id"]),
    batteryVoltage: num(headers["battery-voltage"]),
    fwVersion: str(headers["fw-version"]),
    width: num(headers["width"]),
    height: num(headers["height"]),
    imageCached: bool(headers["image-cached"]),
    model: str(headers["model"]),
    percentCharged: num(headers["percent-charged"]),
    refreshRate: num(headers["refresh-rate"]),
    rssi: num(headers["rssi"]),
    sensors: str(headers["sensors"]),
    temperatureProfile: bool(headers["temperature-profile"]),
    updateSource: str(headers["update-source"]),
    usbConnected: bool(headers["usb-connected"]),
    wakeTime: num(headers["wake-time"]),
    wifiBand: num(headers["wifi-band"]),
  };
}

/**
 * Record one poll's telemetry. Fire-and-forget from the route handler.
 *
 * TODO(influx): push to InfluxDB `metrics` bucket (tag host=trmnl) at
 * 192.168.1.49:8086 per the spec's Telemetry section, so battery/RSSI/
 * wake-time history shows up in Grafana. For now just log a summary line.
 */
export async function recordTelemetry(
  telemetry: Telemetry,
  logger: FastifyBaseLogger,
): Promise<void> {
  logger.info(
    {
      id: telemetry.id,
      batteryVoltage: telemetry.batteryVoltage,
      percentCharged: telemetry.percentCharged,
      rssi: telemetry.rssi,
      wakeTime: telemetry.wakeTime,
      fwVersion: telemetry.fwVersion,
    },
    "telemetry",
  );
}
