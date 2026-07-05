// Generic "fetch, cache for a while, serve stale on error" wrapper for
// screen data sources. Motivating case: an ICS feed (src/sources/calendarEvents.ts)
// that shouldn't be refetched every poll but also shouldn't go blank the
// moment a feed is briefly unreachable.
//
// Semantics:
//   - A value younger than `intervalMs` is returned straight from cache.
//   - Otherwise `fetch()` runs. On success, the result is cached and returned.
//   - On failure: if a cached value exists (however stale), log a warning and
//     serve it -- screens should keep rendering through transient outages.
//     With no cache at all, the error propagates (display.ts's last-good-PNG
//     fallback handles that case at the render layer).
//   - Concurrent get() calls made while a refresh is in flight share that one
//     in-flight promise -- no stampede of duplicate fetches.
import type { FastifyBaseLogger } from "fastify";

export interface PolledSource<T> {
  get(log?: FastifyBaseLogger): Promise<T>;
}

export function polledSource<T>(opts: {
  /** Used only for log lines (e.g. "calendar: refresh failed, serving stale..."). */
  name: string;
  /** How long a cached value is considered fresh. */
  intervalMs: number;
  fetch: () => Promise<T>;
}): PolledSource<T> {
  let cache: { value: T; fetchedAt: number } | undefined;
  let inFlight: Promise<T> | undefined;

  async function refresh(log?: FastifyBaseLogger): Promise<T> {
    try {
      const value = await opts.fetch();
      cache = { value, fetchedAt: Date.now() };
      return value;
    } catch (err) {
      if (cache) {
        log?.warn(
          { err, source: opts.name },
          `${opts.name}: refresh failed, serving stale cached value`,
        );
        return cache.value;
      }
      throw err;
    }
  }

  return {
    get(log?: FastifyBaseLogger): Promise<T> {
      if (cache && Date.now() - cache.fetchedAt < opts.intervalMs) {
        return Promise.resolve(cache.value);
      }
      if (!inFlight) {
        inFlight = refresh(log).finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}
