// Calendar screen -- a two-column agenda fed by ICS feeds
// (src/sources/calendarEvents.ts): TODAY on the left, the next 4 days on the
// right. Same satori HTML dialect rules as nas.ts apply here (see README
// "Satori HTML dialect rules"): explicit display:flex on every element with
// more than one child (and every empty div), flex-direction defaults to
// row, no HTML entities (literal '·'/'■' below).
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import { getCalendarEvents, localMidnight, type CalEvent } from "../sources/calendarEvents.js";
import { statusBar, STATUS_BAR_HEIGHT } from "./chrome.js";
import { htmlScreen } from "./html.js";
import type { RenderContext } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// display:flex + flex-direction:column shorthand, matching nas.ts.
const col = "display:flex;flex-direction:column;";

const MAX_LEFT_ROWS = 8;
const MAX_LEFT_CHIPS = 3;
const MAX_RIGHT_EVENTS = 3;

function tzOf(): string | undefined {
  return config.timezone || undefined;
}

/** Y-M-D key (in the configured timezone) for day-bucketing -- en-CA gives
 * ISO ordering (YYYY-MM-DD) directly, so keys compare lexically like dates. */
function dateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tzOf(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Compact time label, e.g. "9:00a" / "2:30p". */
function compactTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzOf(),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  let hour = "";
  let minute = "";
  let dayPeriod = "";
  for (const p of parts) {
    if (p.type === "hour") hour = p.value;
    else if (p.type === "minute") minute = p.value;
    else if (p.type === "dayPeriod") dayPeriod = p.value;
  }
  const ampm = dayPeriod.toLowerCase().startsWith("a") ? "a" : "p";
  return `${hour}:${minute}${ampm}`;
}

/** Slice long titles with a literal ellipsis -- satori's text-overflow
 * support is limited, so truncation happens in TS rather than CSS. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Events overlapping the given calendar day (in the configured timezone).
 * All-day events use [start, end) date-key range (DTEND is exclusive);
 * timed events are bucketed by their start's calendar date. */
function eventsOnDay(events: CalEvent[], day: Date): CalEvent[] {
  const dayKey = dateKey(day);
  return events.filter((e) => {
    if (e.allDay) {
      const startKey = dateKey(e.start);
      const endKey = dateKey(e.end);
      return dayKey >= startKey && dayKey < endKey;
    }
    return dateKey(e.start) === dayKey;
  });
}

function leftDateHeader(day: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tzOf(), weekday: "long" }).format(day);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: tzOf(),
    month: "long",
    day: "numeric",
  }).format(day);
  return `${weekday} · ${monthDay}`;
}

function rightDateHeader(day: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tzOf(), weekday: "short" }).format(day);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    timeZone: tzOf(),
    month: "numeric",
    day: "numeric",
  }).format(day);
  return `${weekday} ${monthDay}`;
}

function buildLeftColumn(day: Date, dayEvents: CalEvent[]): string {
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay);

  const chips = allDay.slice(0, MAX_LEFT_CHIPS).map(
    (e) =>
      `<div style="display:flex;background:#ccc;border-radius:4px;padding:6px 10px;margin-bottom:6px;"><span style="font-size:16px;font-weight:700;">${truncate(e.title, 28)}</span></div>`,
  );
  if (allDay.length > MAX_LEFT_CHIPS) {
    chips.push(
      `<div style="display:flex;padding:2px 10px 6px;"><span style="font-size:14px;color:#888;">+${allDay.length - MAX_LEFT_CHIPS} more all-day</span></div>`,
    );
  }

  const rowCap = MAX_LEFT_ROWS;
  const shown = timed.slice(0, rowCap);
  const rows = shown.map(
    (e) =>
      `<div style="display:flex;align-items:center;height:34px;border-bottom:1px solid #ccc;"><span style="width:70px;margin-right:10px;flex-shrink:0;font-size:18px;font-weight:700;">${compactTime(e.start)}</span><span style="font-size:18px;">${truncate(e.title, 20)}</span></div>`,
  );
  if (timed.length > rowCap) {
    rows.push(
      `<div style="display:flex;align-items:center;height:30px;"><span style="font-size:16px;color:#888;">+${timed.length - rowCap} more</span></div>`,
    );
  }

  const nothingAtAll = allDay.length === 0 && timed.length === 0;
  const emptyMsg = nothingAtAll
    ? `<div style="display:flex;height:34px;align-items:center;"><span style="font-size:18px;color:#888;">No events today</span></div>`
    : "";

  return `<div style="${col}">
<div style="display:flex;margin-bottom:14px;"><span style="font-size:28px;font-weight:700;">${leftDateHeader(day)}</span></div>
<div style="${col}">${chips.join("")}</div>
<div style="${col}">${rows.join("")}${emptyMsg}</div>
</div>`;
}

function buildRightSection(day: Date, dayEvents: CalEvent[]): string {
  // Total displayed lines (events + a possible "+N more") never exceeds
  // MAX_RIGHT_EVENTS, so every section's height is bounded -- 4 sections
  // must fit in the content area without silent satori clipping.
  const overflow = dayEvents.length > MAX_RIGHT_EVENTS;
  const shown = overflow ? dayEvents.slice(0, MAX_RIGHT_EVENTS - 1) : dayEvents;
  const lines = shown.map((e) => {
    const timeLabel = e.allDay ? "" : compactTime(e.start);
    const titlePrefix = e.allDay ? "■ " : "";
    return `<div style="display:flex;align-items:baseline;height:18px;"><span style="width:44px;margin-right:8px;flex-shrink:0;font-size:13px;font-weight:700;">${timeLabel}</span><span style="font-size:13px;">${titlePrefix}${truncate(e.title, 28)}</span></div>`;
  });
  if (overflow) {
    lines.push(
      `<div style="display:flex;height:18px;align-items:center;"><span style="font-size:13px;color:#888;">+${dayEvents.length - shown.length} more</span></div>`,
    );
  }
  if (dayEvents.length === 0) {
    lines.push(
      `<div style="display:flex;height:18px;align-items:center;"><span style="font-size:13px;color:#888;">No events</span></div>`,
    );
  }

  return `<div style="${col}margin-bottom:8px;">
<div style="display:flex;border-bottom:2px solid #ccc;padding-bottom:2px;margin-bottom:4px;"><span style="font-size:16px;font-weight:700;">${rightDateHeader(day)}</span></div>
<div style="${col}">${lines.join("")}</div>
</div>`;
}

function buildMarkup(events: CalEvent[], ctx: RenderContext): string {
  const contentHeight = ctx.height - STATUS_BAR_HEIGHT;
  const todayStart = localMidnight(ctx.now, tzOf());

  if (events.length === 0) {
    return `
<div style="height:${ctx.height}px;width:${ctx.width}px;${col}font-family:'${FONT_FAMILY}';background:#fff;color:#000;">
${statusBar(ctx)}
<div style="height:${contentHeight}px;width:${ctx.width}px;display:flex;align-items:center;justify-content:center;">
  <span style="font-size:28px;color:#888;">No upcoming events</span>
</div>
</div>`;
  }

  const today = eventsOnDay(events, todayStart);
  const leftHtml = buildLeftColumn(todayStart, today);

  const rightSections: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const day = new Date(todayStart.getTime() + i * DAY_MS);
    rightSections.push(buildRightSection(day, eventsOnDay(events, day)));
  }

  return `
<div style="height:${ctx.height}px;width:${ctx.width}px;${col}font-family:'${FONT_FAMILY}';background:#fff;color:#000;">
${statusBar(ctx)}
<div style="height:${contentHeight}px;width:${ctx.width}px;padding:20px 24px;display:flex;">
  <div style="width:45%;flex-shrink:0;height:100%;${col}">${leftHtml}</div>
  <div style="flex:1;margin-left:24px;height:100%;${col}">${rightSections.join("")}</div>
</div>
</div>`;
}

export const calendarScreen = htmlScreen({
  name: "calendar",
  async renderHTML(ctx: RenderContext): Promise<string> {
    const events = await getCalendarEvents(ctx.log);
    return buildMarkup(events, ctx);
  },
});
