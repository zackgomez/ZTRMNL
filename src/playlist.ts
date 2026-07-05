// Playlist-as-a-file screen rotation. See README "Playlist" for the format
// and rationale; this module owns loading/validating playlist.json and the
// wall-clock slot math that turns "now" into (screen, refresh_rate).
//
// The rotation is deliberately stateless: no cursor is persisted in sqlite.
// Instead every poll re-derives its slot from wall-clock time anchored at
// the device's local midnight (src/time.ts's localMidnight), so a missed
// wake, a manual refresh, or a server restart can never desync the
// rotation -- the schedule is a pure function of `now`.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { config, repoRoot } from "./config.js";
import { resolveScreen, screens, type Screen } from "./screens/index.js";
import type { Device } from "./store.js";
import { localMidnight } from "./time.js";

const playlistPath = path.join(repoRoot, "playlist.json");

/** A poll never waits less than this many seconds, even if the wall-clock
 * math says the next slot boundary is imminent -- a device waking a few
 * seconds early must not be told to immediately re-wake. */
const MIN_REFRESH_SECONDS = 60;

interface RawPlaylistEntry {
  screen?: unknown;
  refresh?: unknown;
  count?: unknown;
}

interface RawPlaylist {
  refresh?: unknown;
  entries?: unknown;
}

/** One playlist entry after validation/defaulting: a registered screen name,
 * its resolved refresh (seconds) and count (consecutive wakes), and the
 * span (count * refresh) it occupies in the cycle. */
interface PlaylistEntry {
  screen: string;
  refresh: number;
  count: number;
  span: number;
}

interface LoadedPlaylist {
  entries: PlaylistEntry[];
  cycleSeconds: number;
}

/** Cache keyed by the file's mtime -- re-parsed only when mtime changes (a
 * stat() per poll is cheap; polls are 15min apart anyway). `null` loaded
 * means "file present but no valid entries" (parse error or all dropped),
 * which is still worth caching so we don't re-log every poll. */
let cache: { mtimeMs: number; loaded: LoadedPlaylist | null } | null = null;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Parse+validate the raw JSON into a LoadedPlaylist, dropping invalid
 * entries with a logged warning. Returns null if nothing valid remains. */
function validate(raw: unknown, log?: FastifyBaseLogger): LoadedPlaylist | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    log?.warn({ playlistPath }, "playlist.json: not a JSON object -- playlist inactive");
    return null;
  }
  const doc = raw as RawPlaylist;
  const fileRefresh = isPositiveInt(doc.refresh) ? doc.refresh : undefined;
  if (doc.refresh !== undefined && fileRefresh === undefined) {
    log?.warn(
      { refresh: doc.refresh },
      "playlist.json: top-level refresh isn't a positive integer -- ignoring, falling back to config.refreshRate",
    );
  }

  if (!Array.isArray(doc.entries)) {
    log?.warn({ playlistPath }, "playlist.json: entries isn't an array -- playlist inactive");
    return null;
  }

  const entries: PlaylistEntry[] = [];
  for (const [i, rawEntry] of (doc.entries as RawPlaylistEntry[]).entries()) {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      log?.warn({ index: i, rawEntry }, "playlist.json: entry isn't an object -- dropped");
      continue;
    }
    const screenName = rawEntry.screen;
    if (typeof screenName !== "string" || !screens[screenName]) {
      log?.warn(
        { index: i, screen: screenName },
        "playlist.json: entry names an unregistered screen -- dropped",
      );
      continue;
    }
    if (rawEntry.refresh !== undefined && !isPositiveInt(rawEntry.refresh)) {
      log?.warn(
        { index: i, screen: screenName, refresh: rawEntry.refresh },
        "playlist.json: entry refresh isn't a positive integer -- dropped",
      );
      continue;
    }
    if (rawEntry.count !== undefined && !isPositiveInt(rawEntry.count)) {
      log?.warn(
        { index: i, screen: screenName, count: rawEntry.count },
        "playlist.json: entry count isn't a positive integer -- dropped",
      );
      continue;
    }
    const refresh = (rawEntry.refresh as number | undefined) ?? fileRefresh ?? config.refreshRate;
    const count = (rawEntry.count as number | undefined) ?? 1;
    entries.push({ screen: screenName, refresh, count, span: refresh * count });
  }

  if (entries.length === 0) {
    log?.warn({ playlistPath }, "playlist.json: no valid entries -- playlist inactive");
    return null;
  }

  const cycleSeconds = entries.reduce((sum, e) => sum + e.span, 0);
  return { entries, cycleSeconds };
}

/** Re-read+validate playlist.json if its mtime changed since the last poll;
 * otherwise return the cached result. Returns null if the file is missing,
 * unparseable, or has zero valid entries (all logged once per mtime change,
 * not per poll). */
function loadPlaylist(log?: FastifyBaseLogger): LoadedPlaylist | null {
  if (!existsSync(playlistPath)) {
    if (cache !== null) {
      log?.info({ playlistPath }, "playlist.json removed -- falling back to activeScreen");
    }
    cache = null;
    return null;
  }

  let mtimeMs: number;
  try {
    mtimeMs = statSync(playlistPath).mtimeMs;
  } catch {
    // Vanished between existsSync and statSync -- treat as absent.
    cache = null;
    return null;
  }

  if (cache !== null && cache.mtimeMs === mtimeMs) {
    return cache.loaded;
  }

  let loaded: LoadedPlaylist | null;
  try {
    const raw = JSON.parse(readFileSync(playlistPath, "utf-8"));
    loaded = validate(raw, log);
  } catch (err) {
    log?.warn({ err, playlistPath }, "playlist.json: failed to parse -- playlist inactive");
    loaded = null;
  }
  cache = { mtimeMs, loaded };
  return loaded;
}

/** Given a loaded playlist and the current instant, find which entry's
 * segment `now` falls in and how many seconds remain until the next slot
 * boundary. Wall-clock derived and stateless -- see module doc comment. */
function pickSlot(
  playlist: LoadedPlaylist,
  now: Date,
): { screen: string; refreshRate: number } | null {
  const { entries, cycleSeconds } = playlist;
  if (cycleSeconds <= 0) return null;

  const anchor = localMidnight(now, config.timezone || undefined);
  const rawElapsed = (now.getTime() - anchor.getTime()) / 1000;
  // now shouldn't precede midnight, but a proper (always-non-negative)
  // modulo keeps this safe regardless (e.g. right at a DST fold).
  const elapsed = ((rawElapsed % cycleSeconds) + cycleSeconds) % cycleSeconds;

  let cumulative = 0;
  for (const entry of entries) {
    if (elapsed < cumulative + entry.span) {
      const elapsedInSegment = elapsed - cumulative;
      const remaining = entry.refresh - (elapsedInSegment % entry.refresh);
      return { screen: entry.screen, refreshRate: Math.max(MIN_REFRESH_SECONDS, Math.ceil(remaining)) };
    }
    cumulative += entry.span;
  }
  // Unreachable given cycleSeconds == sum(spans), but fall back to the last
  // entry rather than throwing on any floating-point edge case.
  const last = entries[entries.length - 1];
  return last ? { screen: last.screen, refreshRate: Math.max(MIN_REFRESH_SECONDS, last.refresh) } : null;
}

/** Resolve what to serve for this poll: per-device sqlite override, else the
 * active playlist slot, else the global activeScreen/refreshRate config.
 * See README "Playlist" for the precedence rationale. */
export function resolvePoll(
  device: Device,
  now: Date,
  log?: FastifyBaseLogger,
): { screen: Screen; refreshRate: number } {
  if (device.screen) {
    return { screen: resolveScreen(device.screen), refreshRate: config.refreshRate };
  }

  const playlist = loadPlaylist(log);
  if (playlist) {
    const slot = pickSlot(playlist, now);
    if (slot) {
      return { screen: resolveScreen(slot.screen), refreshRate: slot.refreshRate };
    }
  }

  return { screen: resolveScreen(config.activeScreen), refreshRate: config.refreshRate };
}
