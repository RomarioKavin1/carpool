import { describe, expect, it } from "vitest";
import type { SearchHit } from "./api";
import { SCORE_FORMULA, rankingOf, searchMode } from "./search";
import { fixtureManifest } from "./fixtures.testonly";

/** A browse element: the four evidence fields, and no ranking fields at all. */
function browseHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    ...fixtureManifest(),
    priceNow: 60_000,
    freshness: 0.5,
    health: 0.2,
    ageDays: 1,
    ...overrides,
  };
}

function rankedHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return browseHit({ score: 0.42, similarity: 0.81, depth: 0.6, ...overrides });
}

describe("rankingOf", () => {
  it("returns the three fields when the registry ranked", () => {
    expect(rankingOf(rankedHit())).toEqual({ score: 0.42, similarity: 0.81, depth: 0.6 });
  });

  it("returns null for a browse element, which omits them", () => {
    expect(rankingOf(browseHit())).toBeNull();
  });

  it("is all-or-nothing: a partial ranking is no ranking", () => {
    expect(rankingOf(browseHit({ score: 0.4, similarity: 0.9 }))).toBeNull();
    expect(rankingOf(browseHit({ score: 0.4, depth: 0.5 }))).toBeNull();
  });

  it("rejects non-finite values rather than rendering NaN as a rank", () => {
    expect(rankingOf(rankedHit({ score: Number.NaN }))).toBeNull();
    expect(rankingOf(rankedHit({ similarity: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it("accepts a legitimately negative similarity — cosine is in [-1, 1]", () => {
    expect(rankingOf(rankedHit({ similarity: -0.2 }))?.similarity).toBe(-0.2);
  });

  it("accepts a zero score", () => {
    expect(rankingOf(rankedHit({ score: 0 }))?.score).toBe(0);
  });
});

describe("searchMode", () => {
  it("is ranked only when every element carries a full ranking", () => {
    expect(searchMode([rankedHit(), rankedHit()])).toBe("ranked");
  });

  it("is browse when the ranking fields are absent", () => {
    expect(searchMode([browseHit(), browseHit()])).toBe("browse");
  });

  it("refuses to claim a ranking when the response is mixed", () => {
    expect(searchMode([rankedHit(), browseHit()])).toBe("browse");
  });

  it("treats an empty response as browse — zero hits are no evidence of ranking", () => {
    expect(searchMode([])).toBe("browse");
  });
});

describe("SCORE_FORMULA", () => {
  it("still states the registry's formula", () => {
    expect(SCORE_FORMULA).toBe("similarity × freshness × (0.5 + 0.5 × depth)");
  });
});
