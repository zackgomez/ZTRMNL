import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export interface Config {
  /** Port ZTRMNL listens on. Production Terminus owns 2300 — do NOT collide. */
  port: number;
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
  /** NAS collector endpoint polled fresh on every render. */
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
  baseUrl: "http://localhost:2400",
  refreshRate: 900,
  deviceMac: "94:A9:90:8F:48:D4",
  apiKey: "ztrmnl-dev-key",
  friendlyId: "ZTRMNL",
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
// reliable template (it's checked into git; config.json is not).
writeFileSync(examplePath, JSON.stringify(defaultConfig, null, 2) + "\n");

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
