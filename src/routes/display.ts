import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { resolveScreen, type Screen, type RenderContext } from "../screens/index.js";
import { renderScreen, minify, PANEL_WIDTH, PANEL_HEIGHT } from "../render.js";
import { parseTelemetry, recordTelemetry } from "../telemetry.js";
import { store, type Device } from "../store.js";
import { uploadsDir, getLastGoodFilename, setLastGoodFilename } from "../state.js";

const RENDER_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`render timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Build the RenderContext for one poll: panel dims + device identity from
 * the sqlite row (falling back to the default panel size), an injected
 * clock, and an html() helper that minifies + renders at those dims. */
function buildRenderContext(device: Device, log: RenderContext["log"]): RenderContext {
  const width = device.width ?? PANEL_WIDTH;
  const height = device.height ?? PANEL_HEIGHT;
  return {
    width,
    height,
    device: { mac: device.mac, friendlyId: device.friendly_id },
    now: new Date(),
    html: (markup: string) => renderScreen(minify(markup), width, height),
    log,
  };
}

/** Render the given screen, write it to uploads/ named by content hash, and
 * remember it as the new last-good image. Returns the filename. */
async function renderAndStore(screen: Screen, ctx: RenderContext): Promise<string> {
  const png = await withTimeout(screen.render(ctx), RENDER_TIMEOUT_MS);
  const hash = createHash("sha256").update(png).digest("hex").slice(0, 12);
  const filename = `${hash}.png`;
  const filePath = path.join(uploadsDir, filename);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, png);
  }
  setLastGoodFilename(filename);
  return filename;
}

export function registerDisplayRoute(app: FastifyInstance): void {
  app.get("/api/display", async (request, reply) => {
    const deviceId = request.headers["id"];
    if (typeof deviceId !== "string" || deviceId.length === 0) {
      reply.code(400);
      return { error: "missing required ID header (device MAC)" };
    }

    // Terminus parity: /api/display never auto-registers. An unknown MAC
    // means the device never paired (or the DB was wiped) -- 404.
    const device = store.findByMac(deviceId);
    if (!device) {
      reply.code(404);
      return { error: "unknown device (call /api/setup first)" };
    }

    // Token check per config.authMode. Terminus itself never validates the
    // Access-Token, so "off" mirrors upstream; "warn"/"enforce" are ours.
    // TOFU: until a device's stored api_key has been confirmed by a poll,
    // adopt whatever non-empty token the device actually presents -- covers
    // migration from Terminus/cloud, where the device holds a token we
    // never issued (Terminus BYOS mints none at all).
    const rawToken = request.headers["access-token"];
    const presented = typeof rawToken === "string" && rawToken.length > 0 ? rawToken : null;
    if (config.authMode !== "off") {
      if (presented === device.api_key) {
        if (!device.token_confirmed) store.confirmToken(device.mac);
      } else if (presented && !device.token_confirmed) {
        store.adoptToken(device.mac, presented);
        request.log.info({ mac: device.mac }, "adopted device-presented token (TOFU)");
      } else {
        if (config.authMode === "enforce") {
          reply.code(401);
          return { error: "invalid or missing Access-Token" };
        }
        request.log.warn(
          { mac: device.mac, hasToken: presented !== null },
          "Access-Token mismatch/absent (serving anyway; authMode=warn)",
        );
      }
    }

    // Fire-and-forget telemetry recording -- must never block/fail the poll.
    const telemetry = parseTelemetry(request.headers as Record<string, unknown>);
    recordTelemetry(telemetry, request.log).catch((err) =>
      request.log.error(err, "telemetry recording failed"),
    );

    // Fire-and-forget: record last_seen + latest device facts from telemetry.
    try {
      store.touch(device.mac, {
        fwVersion: telemetry.fwVersion,
        width: telemetry.width,
        height: telemetry.height,
        model: telemetry.model,
      });
    } catch (err) {
      request.log.error(err, "store.touch failed");
    }

    const t0 = performance.now();
    let filename: string | null = null;
    try {
      // Per-device screen assignment with global fallback.
      const ctx = buildRenderContext(device, request.log);
      filename = await renderAndStore(resolveScreen(device.screen), ctx);
      // filename included so log analysis can join this line to the device's
      // subsequent GET /uploads/<filename> (pipelining-savings evaluation).
      request.log.info({ ms: Math.round(performance.now() - t0), filename }, "render ok");
    } catch (err) {
      request.log.error(err, "render failed, falling back to last-good image");
      filename = getLastGoodFilename();
    }

    if (!filename) {
      // No render ever succeeded and there's no cached image to fall back
      // to (e.g. first-ever request on a fresh install with a broken
      // screen). Nothing sane to serve -- surface a 503 rather than lying
      // about image_url.
      reply.code(503);
      return { error: "no image available (first render failed and no cached image exists)" };
    }

    return {
      filename,
      image_url: `${config.baseUrl}/uploads/${filename}`,
      image_url_timeout: 0,
      refresh_rate: config.refreshRate,
      update_firmware: false,
      firmware_url: null,
      firmware_version: null,
      reset_firmware: false,
      special_function: "sleep",
      temperature_profile: "default",
      touchbar_mode: "tap",
      maximum_compatibility: false,
    };
  });
}
