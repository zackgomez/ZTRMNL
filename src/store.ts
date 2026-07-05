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
  /** 0 until the device has presented this api_key on a poll (or TOFU-adopted its own). */
  token_confirmed: 0 | 1;
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
  /** Mark the stored api_key as confirmed (device presented it on a poll). */
  confirmToken(mac: string): void;
  /** TOFU: replace the never-confirmed api_key with the token the device
   *  actually presented, and mark it confirmed. */
  adoptToken(mac: string, token: string): void;
  /** All registered devices, most-recently-created first. Admin UI only. */
  listDevices(): Device[];
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
        last_seen TEXT,
        token_confirmed INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Migrate pre-TOFU databases in place (ALTER is a no-op error if the
    // column already exists -- cheaper than a migrations framework at this scale).
    try {
      this.db.exec("ALTER TABLE devices ADD COLUMN token_confirmed INTEGER NOT NULL DEFAULT 0");
    } catch {
      /* column already exists */
    }
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
      token_confirmed: 0,
    };
    this.db
      .prepare(
        `INSERT INTO devices (mac, api_key, friendly_id, screen, model, width, height, fw_version, created_at, last_seen, token_confirmed)
         VALUES (@mac, @api_key, @friendly_id, @screen, @model, @width, @height, @fw_version, @created_at, @last_seen, @token_confirmed)`,
      )
      .run(device);
    return { device, created: true };
  }

  confirmToken(mac: string): void {
    this.db
      .prepare("UPDATE devices SET token_confirmed = 1 WHERE mac = ?")
      .run(normalizeMac(mac));
  }

  adoptToken(mac: string, token: string): void {
    this.db
      .prepare("UPDATE devices SET api_key = ?, token_confirmed = 1 WHERE mac = ? AND token_confirmed = 0")
      .run(token, normalizeMac(mac));
  }

  listDevices(): Device[] {
    return this.db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all() as Device[];
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
