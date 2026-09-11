import { describe, expect, it } from "vitest";
import { assertSeconds, eventKey, initialCursor, mergeEvents, nextCursor } from "./events";
import { fixtureEvent } from "./fixtures.testonly";

describe("assertSeconds", () => {
  it("accepts a plausible unix-second timestamp", () => {
    expect(assertSeconds(1_800_000_000, "t")).toBe(1_800_000_000);
  });

  it("refuses milliseconds by magnitude — the exact bug that broke the old cursor", () => {
    expect(() => assertSeconds(1_800_000_000_000, "event.ts")).toThrow(/MILLISECONDS/);
  });

  it("refuses nonsense", () => {
    expect(() => assertSeconds(Number.NaN, "t")).toThrow();
    expect(() => assertSeconds(-1, "t")).toThrow();
  });
});

describe("nextCursor", () => {
  it("advances to the newest ts received, never to a local clock", () => {
    const events = [fixtureEvent({ id: 1, ts: 100 }), fixtureEvent({ id: 2, ts: 250 })];
    expect(nextCursor(events, 50)).toBe(250);
  });

  it("holds the cursor when a poll is empty", () => {
    expect(nextCursor([], 1_799_999_999)).toBe(1_799_999_999);
  });

  it("never moves backwards, even if the server returns an older row", () => {
    expect(nextCursor([fixtureEvent({ ts: 10 })], 500)).toBe(500);
  });

  it("throws rather than storing a millisecond cursor", () => {
    expect(() => nextCursor([fixtureEvent({ ts: 1_800_000_000_000 })], 0)).toThrow(/MILLISECONDS/);
  });
});

describe("mergeEvents", () => {
  it("dedupes a re-delivered event by type and id", () => {
    const a = fixtureEvent({ id: 7, ts: 100 });
    expect(mergeEvents([a], [a])).toHaveLength(1);
  });

  it("keeps a refund alongside the purchase it refers to", () => {
    const purchase = fixtureEvent({ id: 7, ts: 100, type: "purchase" });
    const refund = fixtureEvent({ id: 7, ts: 160, type: "refund" });
    const merged = mergeEvents([purchase], [refund]);
    expect(merged.map(eventKey)).toEqual(["refund-7", "purchase-7"]);
  });

  it("orders newest first and caps the feed", () => {
    const many = Array.from({ length: 10 }, (_, i) => fixtureEvent({ id: i, ts: 100 + i }));
    const merged = mergeEvents([], many, 3);
    expect(merged.map((e) => e.ts)).toEqual([109, 108, 107]);
  });

  it("breaks ts ties by id so the order is total across polls", () => {
    const merged = mergeEvents(
      [],
      [fixtureEvent({ id: 1, ts: 100 }), fixtureEvent({ id: 2, ts: 100 })],
    );
    expect(merged.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("initialCursor", () => {
  it("is a second-scale value, not a millisecond one", () => {
    const cursor = initialCursor(1_800_000_000_000, 3600);
    expect(cursor).toBe(1_800_000_000 - 3600);
    expect(() => assertSeconds(cursor, "initial")).not.toThrow();
  });
});
