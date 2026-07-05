import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerDisplayRoute } from "./routes/display.js";
import { registerSetupRoute } from "./routes/setup.js";
import { registerLogRoute } from "./routes/log.js";
import { buildAdminApp } from "./admin.js";
import { uploadsDir } from "./state.js";

// Two SEPARATE Fastify instances in one process: the device-facing app
// (config.port) and the admin UI (config.adminPort). Kept structurally
// distinct -- not two route-registrations on one app -- so admin routes are
// never reachable on the device port and vice versa. TLS/hostname routing
// (https://ztrmnl.zoumez.net -> adminPort) is handled outside by Caddy; both
// listeners here stay plain HTTP on 0.0.0.0.
const app = Fastify({ logger: true });

app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/uploads/",
});

registerDisplayRoute(app);
registerSetupRoute(app);
registerLogRoute(app);

const adminApp = buildAdminApp();

app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`ZTRMNL listening at ${address} (baseUrl configured as ${config.baseUrl})`);
});

adminApp.listen({ port: config.adminPort, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    adminApp.log.error(err);
    process.exit(1);
  }
  adminApp.log.info(`ZTRMNL admin UI listening at ${address}`);
});
