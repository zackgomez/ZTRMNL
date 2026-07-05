// "Last-good image" state: the most recently rendered PNG, kept around so a
// render failure can still serve *something* (the device must never see a
// blank/broken poll). Owned here so both the device routes (read/write) and
// the admin UI (read-only) share one source of truth.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { dataPath } from "./config.js";

export const uploadsDir = dataPath("uploads");
mkdirSync(uploadsDir, { recursive: true });

let lastGoodFilename: string | null = null;

export function getLastGoodFilename(): string | null {
  return lastGoodFilename;
}

export function setLastGoodFilename(filename: string): void {
  lastGoodFilename = filename;
}

function seedLastGoodFromDisk(): void {
  if (!existsSync(uploadsDir)) return;
  const files = readdirSync(uploadsDir).filter((f) => f.endsWith(".png"));
  if (files.length === 0) return;
  // Most-recently-written file wins.
  files.sort((a, b) => statSync(path.join(uploadsDir, b)).mtimeMs - statSync(path.join(uploadsDir, a)).mtimeMs);
  lastGoodFilename = files[0];
}

seedLastGoodFromDisk();
