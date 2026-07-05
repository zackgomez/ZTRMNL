import type { FastifyInstance } from "fastify";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { config, dataPath } from "../config.js";
import { store } from "../store.js";

const uploadsDir = dataPath("uploads");

function lastGoodImageUrl(): string {
  if (!existsSync(uploadsDir)) return "";
  const files = readdirSync(uploadsDir).filter((f) => f.endsWith(".png"));
  if (files.length === 0) return "";
  files.sort((a, b) => statSync(path.join(uploadsDir, b)).mtimeMs - statSync(path.join(uploadsDir, a)).mtimeMs);
  return `${config.baseUrl}/uploads/${files[0]}`;
}

export function registerSetupRoute(app: FastifyInstance): void {
  // Fired at pairing/reset only -- device has no token yet. Request header
  // `ID` = MAC, per spec. find-or-create by MAC so a repeat call (e.g. a
  // factory reset) re-lands the SAME api_key -- matches Terminus semantics.
  app.get("/api/setup", async (request, reply) => {
    const mac = request.headers["id"];
    if (typeof mac !== "string" || mac.length === 0) {
      reply.code(400);
      return { error: "missing required ID header (device MAC)" };
    }

    if (!config.allowNewDevices && !store.findByMac(mac)) {
      reply.code(404);
      return { error: "device not registered and allowNewDevices is false" };
    }

    const { device, created } = store.findOrCreate(mac);
    request.log.info(
      { mac: device.mac, friendlyId: device.friendly_id, created },
      created ? "device created via setup" : "device re-setup",
    );

    return {
      api_key: device.api_key,
      friendly_id: device.friendly_id,
      image_url: lastGoodImageUrl(),
      message: "Welcome to ZTRMNL",
    };
  });
}
