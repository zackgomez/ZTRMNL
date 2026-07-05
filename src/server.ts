import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config, dataPath } from "./config.js";
import { registerDisplayRoute } from "./routes/display.js";
import { registerSetupRoute } from "./routes/setup.js";
import { registerLogRoute } from "./routes/log.js";
import { mkdirSync } from "node:fs";

const uploadsDir = dataPath("uploads");
mkdirSync(uploadsDir, { recursive: true });

const app = Fastify({ logger: true });

app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/uploads/",
});

registerDisplayRoute(app);
registerSetupRoute(app);
registerLogRoute(app);

app.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`ZTRMNL listening at ${address} (baseUrl configured as ${config.baseUrl})`);
});
