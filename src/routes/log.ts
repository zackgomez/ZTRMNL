import type { FastifyInstance } from "fastify";
import { appendFileSync, mkdirSync } from "node:fs";
import { dataPath } from "../config.js";

const logFile = dataPath("device.log");
mkdirSync(dataPath(), { recursive: true });

export function registerLogRoute(app: FastifyInstance): void {
  // Device error/crash logs (JSON body). Accept, append, 204.
  app.post("/api/log", async (request, reply) => {
    const entry = { timestamp: new Date().toISOString(), body: request.body };
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
    reply.code(204);
    return null;
  });
}
