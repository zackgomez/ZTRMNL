// Small timezone-aware date helpers shared across screens/sources and the
// playlist scheduler (src/playlist.ts). No tz database dependency -- see
// localMidnight's doc comment for the trick used.

/** UTC instant of local midnight for `now`, as seen in `timeZone` (IANA name,
 * e.g. "America/New_York"). Empty/undefined timeZone uses the server's system
 * timezone. Computed via the standard Intl offset trick (format `now` in the
 * target zone, diff against its UTC-labelled reinterpretation) rather than
 * pulling in a tz database dependency -- good enough for day-granularity
 * windowing (calendar screen) and wall-clock playlist anchoring, not claiming
 * DST-transition-instant precision. */
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
