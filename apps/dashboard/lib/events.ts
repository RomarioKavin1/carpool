/**
 * The /events cursor, in SECONDS, and the feed it fills.
 *
 * This is the units mismatch that already cost this project once: /events
 * emits and accepts unix **seconds**, an earlier dashboard sent milliseconds,
 * and `since` was three orders of magnitude too large — so every poll matched
 * nothing, the cursor never advanced, and the feed silently re-fetched the same
 * window forever. CONTRACT.md now states seconds as the contract.
 *
 * Two defences live here rather than in a comment:
 *
 * 1. `nextCursor()` takes the cursor from the events themselves — the maximum
 *    `ts` actually received — never from a local clock. A clock-derived cursor
 *    skips any event whose server timestamp is a second behind the browser's.
 * 2. `assertSeconds()` catches the millisecond bug by magnitude: a unix
 *    timestamp in seconds is ~1.8e9 and in milliseconds ~1.8e12, so anything
 *    past the year 5000 is milliseconds and is refused loudly instead of
 *    silently producing an empty feed.
 */
import type { CarpoolEvent } from "./api";

/** Seconds. Any unix timestamp past this is milliseconds by mistake. */
export const SECONDS_SANITY_CEILING = 100_000_000_000; // year 5138

export function assertSeconds(ts: number, what: string): number {
  if (!Number.isFinite(ts) || ts < 0) throw new Error(`${what}: not a unix timestamp (${ts})`);
  if (ts > SECONDS_SANITY_CEILING) {
    throw new Error(
      `${what}: ${ts} looks like MILLISECONDS. /events speaks seconds — see CONTRACT.md.`,
    );
  }
  return Math.floor(ts);
}

/** A stable identity for an event. A refund and its purchase share `id`. */
export function eventKey(e: CarpoolEvent): string {
  return `${e.type}-${e.id}`;
}

/**
 * The `since` value for the next poll: the newest `ts` we actually received,
 * or `fallback` when the poll was empty. `/events?since=` is EXCLUSIVE, so
 * passing back the maximum ts received cannot re-deliver anything and cannot
 * skip anything either.
 */
export function nextCursor(events: CarpoolEvent[], fallback: number): number {
  let max = fallback;
  for (const e of events) {
    const ts = assertSeconds(e.ts, "event.ts");
    if (ts > max) max = ts;
  }
  return max;
}

/**
 * Fold a poll's events into the feed: newest first, deduplicated by key, and
 * capped. Incoming wins on a key collision — a refund event arriving for a
 * purchase already in the list is a different key, so this only ever collapses
 * a genuine re-delivery.
 */
export function mergeEvents(
  existing: CarpoolEvent[],
  incoming: CarpoolEvent[],
  cap = 200,
): CarpoolEvent[] {
  const byKey = new Map<string, CarpoolEvent>();
  for (const e of existing) byKey.set(eventKey(e), e);
  for (const e of incoming) byKey.set(eventKey(e), e);
  return [...byKey.values()].sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, cap);
}

/** The opening cursor: `lookbackSeconds` before now, in seconds. */
export function initialCursor(nowMs: number, lookbackSeconds: number): number {
  return Math.max(0, Math.floor(nowMs / 1000) - lookbackSeconds);
}
