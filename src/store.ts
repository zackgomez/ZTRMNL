import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dataPath } from "./config.js";

/** One paired device, mirroring the `devices` table columns. */
export interface Device {
  mac: string;
  api_key: string;
  friendly_id: string;
  screen: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  fw_version: string | null;
  created_at: string;
  last_seen: string | null;
}

/** Fields recordable from a poll's telemetry via touch(). */
export interface TouchFields {
  fwVersion?: string;
  width?: number;
  height?: number;
  model?: string;
}

/** Storage contract for device identity/auth. Routes use only this -- no SQL. */
export interface DeviceStore {
  findByMac(mac: string): Device | undefined;
  findOrCreate(mac: string): { device: Device; created: boolean };
  touch(mac: string, fields: TouchFields): void;
}

/** MACs are the primary key; normalize to uppercase on the way in. */
function normalizeMac(mac: string): string {
  return mac.toUpperCase();
}

/** api_key: 32 hex chars (matches Terminus' opaque token shape). */
function newApiKey(): string {
  return randomBytes(16).toString("hex");
}

/** friendly_id: "ZT-" + 6 uppercase alphanumerics. */
function newFriendlyId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  return `ZT-${suffix}`;
}

export class SqliteDeviceStore implements DeviceStore {
  private db: Database.Database;

  constructor(dbFile: string) {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        mac TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        friendly_id TEXT NOT NULL,
        screen TEXT,
        model TEXT,
        width INTEGER,
        height INTEGER,
        fw_version TEXT,
        created_at TEXT NOT NULL,
        last_seen TEXT
      )
    `);
  }

  findByMac(mac: string): Device | undefined {
    return this.db
      .prepare("SELECT * FROM devices WHERE mac = ?")
      .get(normalizeMac(mac)) as Device | undefined;
  }

  findOrCreate(mac: string): { device: Device; created: boolean } {
    const normalized = normalizeMac(mac);
    const existing = this.findByMac(normalized);
    if (existing) return { device: existing, created: false };

    const device: Device = {
      mac: normalized,
      api_key: newApiKey(),
      friendly_id: newFriendlyId(),
      screen: null,
      model: null,
      width: null,
      height: null,
      fw_version: null,
      created_at: new Date().toISOString(),
      last_seen: null,
    };
    this.db
      .prepare(
        `INSERT INTO devices (mac, api_key, friendly_id, screen, model, width, height, fw_version, created_at, last_seen)
         VALUES (@mac, @api_key, @friendly_id, @screen, @model, @width, @height, @fw_version, @created_at, @last_seen)`,
      )
      .run(device);
    return { device, created: true };
  }

  touch(mac: string, fields: TouchFields): void {
    const normalized = normalizeMac(mac);
    const sets: string[] = ["last_seen = @last_seen"];
    const params: Record<string, unknown> = {
      mac: normalized,
      last_seen: new Date().toISOString(),
    };
    if (fields.fwVersion !== undefined) {
      sets.push("fw_version = @fw_version");
      params.fw_version = fields.fwVersion;
    }
    if (fields.width !== undefined) {
      sets.push("width = @width");
      params.width = fields.width;
    }
    if (fields.height !== undefined) {
      sets.push("height = @height");
      params.height = fields.height;
    }
    if (fields.model !== undefined) {
      sets.push("model = @model");
      params.model = fields.model;
    }
    this.db.prepare(`UPDATE devices SET ${sets.join(", ")} WHERE mac = @mac`).run(params);
  }
}

/** Single shared store instance for the whole server. */
export const store: DeviceStore = new SqliteDeviceStore(dataPath("ztrmnl.db"));
