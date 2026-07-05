import type { FastifyBaseLogger } from "fastify";

/** Everything a screen needs to render one poll's response, built fresh per request. */
export interface RenderContext {
  /** Panel dimensions in pixels (from the device row, falling back to the 800x480 default). */
  width: number;
  height: number;
  /** Identity of the polling device (from the sqlite device row). */
  device: { mac: string; friendlyId: string };
  /** Injected clock -- screens should read the time from here, not `new Date()`, so renders are testable. */
  now: Date;
  /** Subset of this poll's parsed telemetry headers -- freshest possible
   * reading since renders happen on demand inside the poll itself. All
   * optional: a device may omit any of these headers. */
  telemetry: {
    batteryVoltage?: number;
    percentCharged?: number;
    rssi?: number;
    wifiBand?: number;
  };
  /** Seconds between polls, as this poll's response will report it (config.refreshRate). */
  refreshRate: number;
  /** Turn an HTML string into a finished 2-bit PNG buffer (minifies internally -- see render.ts). */
  html(markup: string): Promise<Buffer>;
  /** Fastify's per-request logger. */
  log: FastifyBaseLogger;
}

export interface Screen {
  name: string;
  /** Render this screen to a finished PNG buffer (already quantized). */
  render(ctx: RenderContext): Promise<Buffer>;
}
