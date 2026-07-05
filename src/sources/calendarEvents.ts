// ICS fetch/parse/merge for the calendar screen (src/screens/calendar.ts).
// Wrapped in a polledSource (src/sources/polled.ts) so screens don't refetch
// every poll and keep rendering through a transient feed outage.
//
// Recurrence is handled by node-ical's own `expandRecurringEvent`, not
// hand-rolled rrule math: it already expands `.rrule` occurrences within a
// window, skips `.exdate` entries, and swaps in `.recurrences` (RECURRENCE-ID
// overrides) per occurrence -- re-deriving that logic here would just be a
// worse copy of what the library ships and tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
// node-ical is CommonJS with no top-level "type" field, and cjs-module-lexer
// (Node's static named-export detector for CJS-from-ESM) only manages to
// find `fromURL` on it -- so `sync`/`expandRecurringEvent` must come off the
// default import (== module.exports) at runtime, not as named imports.
import nodeIcal, { type VEvent, type ParameterValue } from "node-ical";
const { sync, expandRecurringEvent } = nodeIcal;
import { config } from "../config.js";
import { polledSource } from "./polled.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "..", "..", "reference", "calendar.ics");

export interface CalEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC instant of local midnight for `now`, as seen in `timeZone` (IANA name,
 * e.g. "America/New_York"). Empty/undefined timeZone uses the server's system
 * timezone. Computed via the standard Intl offset trick (format `now` in the
 * target zone, diff against its UTC-labelled reinterpretation) rather than
 * pulling in a tz database dependency -- good enough for a day-granularity
 * calendar window, not claiming DST-transition-instant precision. */
export function localMidnight(now: Date, timeZone: string | undefined): Date {
  if (!timeZone) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) parts[p.type] = p.value;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asIfUTC - now.getTime();
  const midnightAsIfUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(midnightAsIfUTC - offsetMs);
}

function textOf(value: ParameterValue<string> | undefined): string {
  if (value === undefined || value === null) return "(untitled)";
  return typeof value === "string" ? value : value.val;
}

/** Expand every VEVENT in a parsed ICS document into CalEvents overlapping
 * [windowStart, windowEnd]. `expandOngoing: true` so a multi-day event that
 * started before windowStart but runs into it still shows up. */
function expandEvents(icsText: string, windowStart: Date, windowEnd: Date): CalEvent[] {
  const data = sync.parseICS(icsText);
  const out: CalEvent[] = [];
  for (const item of Object.values(data)) {
    if (!item || item.type !== "VEVENT") continue;
    const event = item as VEvent;
    const instances = expandRecurringEvent(event, {
      from: windowStart,
      to: windowEnd,
      expandOngoing: true,
    });
    for (const inst of instances) {
      out.push({
        title: textOf(inst.summary),
        start: inst.start,
        end: inst.end,
        allDay: inst.isFullDay,
      });
    }
  }
  return out;
}

/** Fetch+parse+merge every configured ICS feed (or the fixture) for the
 * window [today's local midnight, +7 days], sorted by start. Exported
 * separately from the polledSource wrapper so the recurrence-handling unit
 * check can call it directly with an explicit window. */
export async function fetchCalendarEvents(now: Date = new Date()): Promise<CalEvent[]> {
  const windowStart = localMidnight(now, config.timezone || undefined);
  const windowEnd = new Date(windowStart.getTime() + 8 * DAY_MS - 1);

  const icsTexts = config.fixtureData
    ? [readFileSync(fixturePath, "utf-8")]
    : await Promise.all(
        config.calendarIcsUrls.map(async (url) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) {
            throw new Error(`calendar ICS fetch failed: ${res.status} ${res.statusText}`);
          }
          return res.text();
        }),
      );

  const events = icsTexts.flatMap((text) => expandEvents(text, windowStart, windowEnd));
  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}

const source = polledSource<CalEvent[]>({
  name: "calendar",
  intervalMs: config.calendarPollSeconds * 1000,
  fetch: () => fetchCalendarEvents(),
});

/** Cached, stale-tolerant accessor for the calendar screen. */
export function getCalendarEvents(log?: FastifyBaseLogger): Promise<CalEvent[]> {
  return source.get(log);
}
