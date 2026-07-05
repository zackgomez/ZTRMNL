// Read-only admin/status UI: a SECOND, separate Fastify instance (see
// server.ts) so admin routes are never reachable on the device port and vice
// versa. No auth of its own -- TLS/hostname routing and any access control
// live outside this process (Caddy reverse-proxies
// https://ztrmnl.zoumez.net -> this port; this port itself stays plain HTTP).
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config, repoRoot } from "./config.js";
import { store } from "./store.js";
import { screens } from "./screens/index.js";
import { uploadsDir, getLastGoodFilename } from "./state.js";

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as {
  version: string;
};

// Fields never shown in the raw -- covers influxToken today and anything
// secret-shaped added later (apiKey, etc).
const SECRET_FIELD_RE = /token|key|secret|password/i;

function escapeHtml(value: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value).replace(/[&<>"']/g, (c) => map[c]!);
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (parts.length === 0 || secs) parts.push(`${secs}s`);
  return parts.join(" ");
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  return `${formatDuration(ms / 1000)} ago`;
}

function renderConfigRows(): string {
  return Object.entries(config)
    .map(([key, value]) => {
      let cell: string;
      if (key === "calendarIcsUrls") {
        // URL-shaped secret (Google's "secret address in iCal format") --
        // show a count, never the values themselves.
        const count = Array.isArray(value) ? value.length : 0;
        cell = count > 0 ? `set (${count})` : "unset";
      } else if (SECRET_FIELD_RE.test(key)) {
        cell = value ? "set" : "unset";
      } else {
        cell = escapeHtml(JSON.stringify(value));
      }
      return `<tr><td>${escapeHtml(key)}</td><td>${cell}</td></tr>`;
    })
    .join("\n");
}

function renderDeviceRows(): string {
  const devices = store.listDevices();
  if (devices.length === 0) {
    return `<tr><td colspan="9">(no devices registered)</td></tr>`;
  }
  return devices
    .map((d) => {
      const screen = d.screen ? escapeHtml(d.screen) : `(default: ${escapeHtml(config.activeScreen)})`;
      const dims = d.width != null && d.height != null ? `${d.width}x${d.height}` : "?";
      const lastSeen = d.last_seen ? `${escapeHtml(d.last_seen)} (${ago(d.last_seen)})` : "never";
      return `<tr>
  <td>${escapeHtml(d.mac)}</td>
  <td>${escapeHtml(d.friendly_id)}</td>
  <td>${screen}</td>
  <td>${escapeHtml(d.model ?? "?")}</td>
  <td>${dims}</td>
  <td>${escapeHtml(d.fw_version ?? "?")}</td>
  <td>${d.token_confirmed ? "yes" : "no"}</td>
  <td>${escapeHtml(d.created_at)}</td>
  <td>${lastSeen}</td>
</tr>`;
    })
    .join("\n");
}

function renderScreenRows(): string {
  return Object.keys(screens)
    .map(
      (name) =>
        `<tr><td>${escapeHtml(name)}</td><td>${name === config.activeScreen ? "yes (global default)" : ""}</td></tr>`,
    )
    .join("\n");
}

function renderCurrentImage(): string {
  const filename = getLastGoodFilename();
  if (!filename) return `<p class="muted">(no image rendered yet)</p>`;
  return `<img src="/current.png" alt="current display image">\n<p class="muted">${escapeHtml(filename)}</p>`;
}

function renderPage(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ZTRMNL admin</title>
<style>
  body { font-family: ui-monospace, "DejaVu Sans Mono", Consolas, monospace; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #111; color: #ddd; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1rem; margin-top: 2rem; border-bottom: 1px solid #444; padding-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  td, th { border: 1px solid #333; padding: 0.3rem 0.5rem; text-align: left; vertical-align: top; }
  .muted { color: #888; }
  img { max-width: 100%; border: 1px solid #444; image-rendering: pixelated; }
  code { color: #9cf; }
</style>
</head>
<body>
<h1>ZTRMNL admin</h1>

<h2>Service</h2>
<table>
  <tr><td>uptime</td><td>${formatDuration(process.uptime())}</td></tr>
  <tr><td>node</td><td>${escapeHtml(process.version)}</td></tr>
  <tr><td>package version</td><td>${escapeHtml(pkg.version)}</td></tr>
  <tr><td>render engine</td><td>satori/resvg/sharp, 2-bit grayscale</td></tr>
  <tr><td>server time</td><td>${escapeHtml(new Date().toISOString())}</td></tr>
</table>

<h2>Config</h2>
<table>
  <tr><th>key</th><th>value</th></tr>
  ${renderConfigRows()}
</table>

<h2>Devices</h2>
<table>
  <tr><th>mac</th><th>friendly_id</th><th>screen</th><th>model</th><th>dims</th><th>fw_version</th><th>token_confirmed</th><th>created_at</th><th>last_seen</th></tr>
  ${renderDeviceRows()}
</table>

<h2>Screens</h2>
<table>
  <tr><th>name</th><th>global default</th></tr>
  ${renderScreenRows()}
</table>

<h2>Current image</h2>
${renderCurrentImage()}

</body>
</html>
`;
}

export function buildAdminApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderPage());
  });

  app.get("/current.png", async (_request, reply) => {
    const filename = getLastGoodFilename();
    if (!filename) {
      reply.code(404);
      return { error: "no image available" };
    }
    const filePath = path.join(uploadsDir, filename);
    if (!existsSync(filePath)) {
      reply.code(404);
      return { error: "last-good image file is missing on disk" };
    }
    reply.type("image/png").send(readFileSync(filePath));
  });

  app.get("/healthz", async () => ({ ok: true, uptime: process.uptime() }));

  return app;
}
