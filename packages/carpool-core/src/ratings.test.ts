import { describe, expect, it } from "vitest";
import {
  MAX_RATING_REASON_CHARS,
  MIN_RATINGS_FOR_VERDICT,
  summariseRatings,
  type RatingSummary,
} from "./ratings.js";
import { health } from "./health.js";

describe("summariseRatings — counts, never an average", () => {
  it("serves the two counts and their total", () => {
    expect(summariseRatings({ worth: 2, notWorth: 1 })).toMatchObject({
      count: 3,
      worth: 2,
      notWorth: 1,
    });
  });

  /**
   * The structural half of "never render an average the sample cannot support".
   *
   * A field called `average`, `score`, `ratio`, `percent` or `stars` is a field a
   * UI will print without its denominator, because it reads as already-computed.
   * The summary has none, so the only way to a percentage is to divide by
   * `count` — which puts the sample size in the caller's hand at exactly the
   * moment it decides whether a percentage is worth showing.
   */
  it("exposes no averaged, scored or percentage field, now or later", () => {
    const keys = Object.keys(summariseRatings({ worth: 7, notWorth: 1 }));
    const forbidden = keys.filter((k) => /avg|average|score|ratio|percent|star|mean|rate$/i.test(k));
    expect(
      forbidden,
      "a derived single number on this object is how `4.5 stars` off two ratings gets onto a screen",
    ).toEqual([]);
    expect(keys.sort()).toEqual(["count", "notWorth", "verdict", "worth"]);
  });

  it("refuses a fractional or negative count rather than coercing it", () => {
    expect(() => summariseRatings({ worth: 1.5, notWorth: 0 })).toThrow(/non-negative integer/);
    expect(() => summariseRatings({ worth: -1, notWorth: 0 })).toThrow(/non-negative integer/);
  });
});

describe("verdict — withheld until the sample can support it", () => {
  it("is null below MIN_RATINGS_FOR_VERDICT, however lopsided the ratings are", () => {
    expect(MIN_RATINGS_FOR_VERDICT).toBe(3);
    expect(summariseRatings({ worth: 0, notWorth: 0 }).verdict).toBeNull();
    expect(summariseRatings({ worth: 1, notWorth: 0 }).verdict).toBeNull();
    expect(summariseRatings({ worth: 2, notWorth: 0 }).verdict).toBeNull();
    expect(summariseRatings({ worth: 0, notWorth: 2 }).verdict).toBeNull();
  });

  it("says worth at a 2:1 majority and above", () => {
    expect(summariseRatings({ worth: 2, notWorth: 1 }).verdict).toBe("worth");
    expect(summariseRatings({ worth: 3, notWorth: 0 }).verdict).toBe("worth");
    expect(summariseRatings({ worth: 6, notWorth: 3 }).verdict).toBe("worth");
  });

  it("says not-worth at a 2:1 majority the other way", () => {
    expect(summariseRatings({ worth: 1, notWorth: 2 }).verdict).toBe("not-worth");
    expect(summariseRatings({ worth: 0, notWorth: 4 }).verdict).toBe("not-worth");
  });

  it("says mixed when the buyers disagree, instead of rounding to one of them", () => {
    expect(summariseRatings({ worth: 2, notWorth: 2 }).verdict).toBe("mixed");
    expect(summariseRatings({ worth: 3, notWorth: 2 }).verdict).toBe("mixed");
    expect(summariseRatings({ worth: 4, notWorth: 3 }).verdict).toBe("mixed");
  });

  /** The threshold is a share, so it does not drift with sample size. */
  it("keeps the same 2:1 threshold at larger samples", () => {
    expect(summariseRatings({ worth: 20, notWorth: 10 }).verdict).toBe("worth");
    expect(summariseRatings({ worth: 19, notWorth: 11 }).verdict).toBe("mixed");
  });
});

describe("ratings are a separate signal from health, deliberately", () => {
  /**
   * `health` is `freshness × (1 − refundRate) × buyerTerm`, documented in
   * CONTRACT.md and RESTRUCTURE §4 and rendered in the dashboard **with its terms
   * shown**. Ratings are not a fourth factor in it, and this pins that:
   *
   * - a rating term would have to be a number, and at n < 3 this module refuses
   *   to state even a label — multiplying a defensible score by a figure derived
   *   from a sample too small to support it would launder exactly the false
   *   precision the binary scale exists to prevent;
   * - `refundRate` already carries the strongest negative signal, in money, so a
   *   rating term would partly double-count it (a refunded purchase's rating is
   *   not even counted — see `RegistryLedger.ratingsFor`);
   * - `health` is computed for every artifact including the ones nobody has
   *   bought, and most artifacts will have no ratings for their whole decay
   *   window. A term that is a constant for most rows is not a signal.
   */
  it("health's inputs are freshness, refundRate and distinctBuyers only", () => {
    const withoutRatings = health({ freshness: 0.8, refundRate: 0.2, distinctBuyers: 3 });
    const withRatingsAttached = health({
      freshness: 0.8,
      refundRate: 0.2,
      distinctBuyers: 3,
      // Extra properties are ignored: nothing rating-shaped reaches the formula.
      ...({ worth: 9, notWorth: 0, verdict: "worth" } as unknown as Record<string, never>),
    });
    expect(withRatingsAttached).toBe(withoutRatings);
    expect(withoutRatings).toBeCloseTo(0.8 * 0.8 * (0.4 + 0.6 * (3 / 5)), 12);
  });
});

describe("the reason cap", () => {
  it("is short enough to ride inline on a search result", () => {
    expect(MAX_RATING_REASON_CHARS).toBe(280);
  });
});

/** Compile-time: the summary is exactly these four fields. */
const _shape: RatingSummary = { count: 0, worth: 0, notWorth: 0, verdict: null };
void _shape;
