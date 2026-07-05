import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export interface Config {
  /** Port ZTRMNL listens on. Production Terminus owns 2300 — do NOT collide. */
  port: number;
  /** Port the admin UI listens on -- a SEPARATE Fastify instance, never
   * reachable on `port` and vice versa. Fronted by Caddy (TLS/hostname
   * routing) at https://ztrmnl.zoumez.net; this port itself stays plain HTTP. */
  adminPort: number;
  /** Absolute base URL used to build image_url etc. */
  baseUrl: string;
  /** Seconds between device polls (returned as refresh_rate). */
  refreshRate: number;
  /** MAC address of the paired OG device. */
  deviceMac: string;
  /** Static API key handed back from /api/setup. */
  apiKey: string;
  /** friendly_id returned from /api/setup. */
  friendlyId: string;
  /** Human-readable wifi network name shown in the status bar's wifi
   * cluster. Empty string (the default) falls back to the band reported by
   * telemetry ("2.4G"/"5G") when present, else shows nothing. */
  wifiName: string;
  /** Influx base URL (e.g. http://192.168.1.49:8086) for the nas screen's
   * direct Flux queries. Empty string disables it (falls back to collectorUrl). */
  influxUrl: string;
  /** Influx org name (e.g. "zoumez"). */
  influxOrg: string;
  /** Read-only Influx API token, scoped to the metrics bucket. NEVER commit
   * a real value here -- this repo is public. Lives only in the gitignored
   * local config.json. */
  influxToken: string;
  /** @deprecated NAS collector endpoint, kept as a fallback while migrating
   * the nas screen to query InfluxDB directly via influxUrl/influxOrg/influxToken. */
  collectorUrl: string;
  /** Directory (relative to repo root, or absolute) for uploads/logs/state. */
  dataDir: string;
  /** Which screen registry entry to render (see src/screens/index.ts). */
  activeScreen: string;
  /** If true, nas screen reads reference/nas.json instead of hitting collectorUrl. */
  fixtureData: boolean;
  /**
   * Access-Token handling on /api/display:
   *   "off"     -- ignore the token entirely (Terminus' own behavior).
   *   "warn"    -- compare to the device's api_key, log on mismatch, serve anyway.
   *   "enforce" -- 401 on mismatch.
   */
  authMode: "off" | "warn" | "enforce";
  /** If false, /api/setup refuses to register a MAC it hasn't seen (404). */
  allowNewDevices: boolean;
}

export const defaultConfig: Config = {
  port: 2400,
  adminPort: 2401,
  baseUrl: "http://localhost:2400",
  refreshRate: 900,
  deviceMac: "94:A9:90:8F:48:D4",
  apiKey: "ztrmnl-dev-key",
  friendlyId: "ZTRMNL",
  wifiName: "",
  influxUrl: "",
  influxOrg: "",
  influxToken: "",
  collectorUrl: "http://192.168.1.43:8088/nas.json",
  dataDir: "data",
  activeScreen: "nas",
  fixtureData: false,
  authMode: "warn",
  allowNewDevices: true,
};

const configPath = path.join(repoRoot, "config.json");
const examplePath = path.join(repoRoot, "config.example.json");

// Always keep config.example.json in sync with the defaults so it's a
// reliable template (it's checked into git; config.json is not). This is a
// dev convenience, not a runtime requirement -- in a container where the app
// dir isn't writable by the runtime user, ignore the failure rather than
// crashing boot.
try {
  writeFileSync(examplePath, JSON.stringify(defaultConfig, null, 2) + "\n");
} catch (err) {
  console.warn(`Could not write ${examplePath}:`, err);
}

function loadUserConfig(): Partial<Config> {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to parse ${configPath}:`, err);
    return {};
  }
}

export const config: Config = { ...defaultConfig, ...loadUserConfig() };

/** Resolve dataDir (and subpaths) relative to the repo root. */
export function dataPath(...segments: string[]): string {
  const base = path.isAbsolute(config.dataDir)
    ? config.dataDir
    : path.join(repoRoot, config.dataDir);
  return path.join(base, ...segments);
}

export { repoRoot };
