// Calendar screen -- a two-column agenda fed by ICS feeds
// (src/sources/calendarEvents.ts): TODAY on the left, the next 4 days on the
// right. Authored as JSX via reactScreen; satori's flexbox rules apply (see
// README "Satori HTML dialect rules").
import type { CSSProperties, ReactNode } from "react";
import { config } from "../config.js";
import { FONT_FAMILY } from "../render.js";
import { getCalendarEvents, type CalEvent } from "../sources/calendarEvents.js";
import { localMidnight } from "../time.js";
import { StatusBar, STATUS_BAR_HEIGHT } from "./chrome.js";
import { reactScreen } from "./react.js";
import type { RenderContext } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// display:flex + flex-direction:column shorthand, matching nas.tsx.
const col: CSSProperties = { display: "flex", flexDirection: "column" };

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

function LeftColumn({ day, dayEvents }: { day: Date; dayEvents: CalEvent[] }): ReactNode {
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay);
  const shown = timed.slice(0, MAX_LEFT_ROWS);
  const nothingAtAll = allDay.length === 0 && timed.length === 0;

  return (
    <div style={col}>
      <div style={{ display: "flex", marginBottom: "14px" }}>
        <span style={{ fontSize: "28px", fontWeight: 700 }}>{leftDateHeader(day)}</span>
      </div>
      <div style={col}>
        {allDay.slice(0, MAX_LEFT_CHIPS).map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              background: "#ccc",
              borderRadius: "4px",
              padding: "6px 10px",
              marginBottom: "6px",
            }}
          >
            <span style={{ fontSize: "16px", fontWeight: 700 }}>{truncate(e.title, 28)}</span>
          </div>
        ))}
        {allDay.length > MAX_LEFT_CHIPS ? (
          <div style={{ display: "flex", padding: "2px 10px 6px" }}>
            <span style={{ fontSize: "14px", color: "#888" }}>
              {`+${allDay.length - MAX_LEFT_CHIPS} more all-day`}
            </span>
          </div>
        ) : null}
      </div>
      <div style={col}>
        {shown.map((e, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", height: "34px", borderBottom: "1px solid #ccc" }}
          >
            <span style={{ width: "70px", marginRight: "10px", flexShrink: 0, fontSize: "18px", fontWeight: 700 }}>
              {compactTime(e.start)}
            </span>
            <span style={{ fontSize: "18px" }}>{truncate(e.title, 26)}</span>
          </div>
        ))}
        {timed.length > MAX_LEFT_ROWS ? (
          <div style={{ display: "flex", alignItems: "center", height: "30px" }}>
            <span style={{ fontSize: "16px", color: "#888" }}>{`+${timed.length - MAX_LEFT_ROWS} more`}</span>
          </div>
        ) : null}
        {nothingAtAll ? (
          <div style={{ display: "flex", height: "34px", alignItems: "center" }}>
            <span style={{ fontSize: "18px", color: "#888" }}>No events today</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RightSection({ day, dayEvents }: { day: Date; dayEvents: CalEvent[] }): ReactNode {
  // Total displayed lines (events + a possible "+N more") never exceeds
  // MAX_RIGHT_EVENTS, so every section's height is bounded -- 4 sections
  // must fit in the content area without silent satori clipping.
  const overflow = dayEvents.length > MAX_RIGHT_EVENTS;
  const shown = overflow ? dayEvents.slice(0, MAX_RIGHT_EVENTS - 1) : dayEvents;

  return (
    <div style={{ ...col, marginBottom: "8px" }}>
      <div style={{ display: "flex", borderBottom: "2px solid #ccc", paddingBottom: "2px", marginBottom: "4px" }}>
        <span style={{ fontSize: "16px", fontWeight: 700 }}>{rightDateHeader(day)}</span>
      </div>
      <div style={col}>
        {shown.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", height: "18px" }}>
            <span style={{ width: "44px", marginRight: "8px", flexShrink: 0, fontSize: "13px", fontWeight: 700 }}>
              {e.allDay ? "" : compactTime(e.start)}
            </span>
            <span style={{ fontSize: "13px" }}>{`${e.allDay ? "■ " : ""}${truncate(e.title, 28)}`}</span>
          </div>
        ))}
        {overflow ? (
          <div style={{ display: "flex", height: "18px", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#888" }}>{`+${dayEvents.length - shown.length} more`}</span>
          </div>
        ) : null}
        {dayEvents.length === 0 ? (
          <div style={{ display: "flex", height: "18px", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "#888" }}>No events</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Markup({ events, ctx }: { events: CalEvent[]; ctx: RenderContext }): ReactNode {
  const contentHeight = ctx.height - STATUS_BAR_HEIGHT;
  const todayStart = localMidnight(ctx.now, tzOf());

  const frame: CSSProperties = {
    height: `${ctx.height}px`,
    width: `${ctx.width}px`,
    ...col,
    fontFamily: FONT_FAMILY,
    background: "#fff",
    color: "#000",
  };

  if (events.length === 0) {
    return (
      <div style={frame}>
        <StatusBar ctx={ctx} />
        <div
          style={{
            height: `${contentHeight}px`,
            width: `${ctx.width}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: "28px", color: "#888" }}>No upcoming events</span>
        </div>
      </div>
    );
  }

  const days = [1, 2, 3, 4].map((i) => new Date(todayStart.getTime() + i * DAY_MS));

  return (
    <div style={frame}>
      <StatusBar ctx={ctx} />
      <div style={{ height: `${contentHeight}px`, width: `${ctx.width}px`, padding: "20px 24px", display: "flex" }}>
        <div style={{ width: "45%", flexShrink: 0, height: "100%", ...col }}>
          <LeftColumn day={todayStart} dayEvents={eventsOnDay(events, todayStart)} />
        </div>
        <div style={{ flex: 1, marginLeft: "24px", height: "100%", ...col }}>
          {days.map((day, i) => (
            <RightSection key={i} day={day} dayEvents={eventsOnDay(events, day)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const calendarScreen = reactScreen({
  name: "calendar",
  async render(ctx: RenderContext): Promise<ReactNode> {
    const events = await getCalendarEvents(ctx.log);
    return <Markup events={events} ctx={ctx} />;
  },
});
