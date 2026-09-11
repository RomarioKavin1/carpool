import { describe, expect, it } from "vitest";
import {
  STATUS_MEANING,
  artifactStatus,
  buildFooter,
  buildRows,
  defaultDirFor,
  purchasesForMagnet,
  recentEvents,
  rowName,
  sortRows,
} from "./derive";
import type { ArtifactState, CarpoolEvent, Manifest, PeerState, PurchaseState, RegistryState } from "./api";

// These fixtures intentionally mirror the EXACT field names
// apps/registry/src/ledger.ts's state()/eventsSince() emit — see
// apps/registry/src/ledger.test.ts's "RegistryLedger.state" suite for the
// server side of this same contract. If the registry ever renames a field,
// these fixtures still type-check (they're plain object literals) but the
// assertions below read the OLD name and fail loudly instead of silently
// rendering a dash — which is the whole point of this file.

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    magnet: "swarm:" + "a".repeat(64),
    question: "What is the ETHOnline 2026 prize pool?",
    questionNorm: "what is the ethonline 2026 prize pool",
    scope: "ethonline-2026",
    abstract: "Total prize pool across all sponsor tracks.",
    sources: [{ url: "https://ethglobal.com/events/ethonline2026", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "claude-sonnet-5",
      durationSeconds: 120,
      inputTokens: 4000,
      outputTokens: 1200,
      estimatedCostUsd: 0.42,
      toolCalls: 6,
    },
    decay: { halfLifeDays: 3, producedAt: "2026-09-01T00:00:00Z" },
    author: "0.0.1111:" + "aa".repeat(33),
    bodyHash: "b".repeat(64),
    bodyBytes: 188_416, // 184K
    redacted: false,
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactState> = {}): ArtifactState {
  return {
    manifest: manifest(),
    live: true,
    priceBase: 100_000,
    priceFloor: 10_000,
    priceNow: 31_000, // µUSDC, → $0.031... used loosely below
    freshness: 0.8,
    health: 0.6,
    distinctBuyers: 47,
    refundRate: 0,
    // Added by the registry alongside GET /payouts: `ageDays` on the server's
    // clock (so /state and /search agree), and the two timestamps that separate
    // "withdrawn by its author" from "decayed". Fixture-only defaults.
    ageDays: 1,
    anchoredAt: null,
    delistedAt: null,
    ...overrides,
  };
}

function purchase(overrides: Partial<PurchaseState> = {}): PurchaseState {
  return {
    id: 1,
    magnet: "swarm:" + "a".repeat(64),
    buyer: "0.0.2222",
    txId: "0.0.2222@1-1",
    paid: 31_000,
    ts: 1_800_000_000,
    refundState: "window",
    // Added by the registry alongside GET /payouts: the refund deadline (so no
    // client re-derives `ts + refundWindowSeconds`) and the payout row ids that
    // join a purchase to GET /payouts. Fixture-only defaults.
    refundDeadline: 1_800_000_120,
    refundedAt: null,
    authorRoyaltyPayoutId: 1,
    trackerFeePayoutId: 2,
    ...overrides,
  };
}

function state(overrides: Partial<RegistryState> = {}): RegistryState {
  return {
    artifacts: [],
    purchases: [],
    peers: [],
    // Served by the registry so a client never hard-codes 120 — see
    // RegistryLedger.state(). Fixture-only default.
    refundWindowSeconds: 120,
    summary: { artifactCount: 0, purchaseCount: 0, gross: 0, refunded: 0 },
    ...overrides,
  };
}

describe("rowName", () => {
  it("joins scope and question when scope is present", () => {
    expect(rowName(artifact())).toBe("ethonline-2026 · What is the ETHOnline 2026 prize pool?");
  });

  it("falls back to the bare question when scope is absent", () => {
    const a = artifact({ manifest: manifest({ scope: undefined }) });
    expect(rowName(a)).toBe("What is the ETHOnline 2026 prize pool?");
  });
});

describe("buildRows", () => {
  const now = 1_800_003_600; // exactly 1h after the fixture purchase's ts

  it("traces every column to a real field: SIZE→bodyBytes, HEALTH→health, LIFE→freshness, FARE→priceNow, SEED→distinctBuyers", () => {
    const s = state({ artifacts: [artifact()] });
    const [row] = buildRows(s, now);
    expect(row!.bodyBytes).toBe(188_416);
    expect(row!.health).toBe(0.6);
    expect(row!.freshness).toBe(0.8);
    expect(row!.priceNow).toBe(31_000);
    expect(row!.seed).toBe(47);
    expect(row!.live).toBe(true);
    expect(row!.redacted).toBe(false);
  });

  it("computes PEER as distinct buyers within the trailing window, not all-time", () => {
    const s = state({
      artifacts: [artifact()],
      purchases: [
        purchase({ id: 1, buyer: "0.0.1", ts: now - 100 }), // inside window
        purchase({ id: 2, buyer: "0.0.1", ts: now - 200 }), // same buyer again, inside window
        purchase({ id: 3, buyer: "0.0.2", ts: now - 3700 }), // just OUTSIDE the 1h window
      ],
    });
    const [row] = buildRows(s, now);
    expect(row!.peer).toBe(1); // one distinct buyer inside the window
    expect(row!.ratePerHour).toBe(2); // two purchase events inside the window
  });

  it("does not conflate purchases belonging to a different magnet", () => {
    const s = state({
      artifacts: [artifact()],
      purchases: [purchase({ magnet: "swarm:" + "f".repeat(64), ts: now - 10 })],
    });
    const [row] = buildRows(s, now);
    expect(row!.peer).toBe(0);
    expect(row!.ratePerHour).toBe(0);
  });

  it("still returns a dead (expired) artifact — a torrent view shows dead torrents, not just live ones", () => {
    const s = state({ artifacts: [artifact({ live: false, freshness: 0.02, health: 0.0 })] });
    const rows = buildRows(s, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.live).toBe(false);
  });

  it("is a legible empty state, not an error, when the registry has no artifacts", () => {
    expect(buildRows(state(), now)).toEqual([]);
  });

  it("orders richest health first", () => {
    const s = state({
      artifacts: [
        artifact({ manifest: manifest({ magnet: "swarm:" + "1".repeat(64) }), health: 0.2 }),
        artifact({ manifest: manifest({ magnet: "swarm:" + "2".repeat(64) }), health: 0.9 }),
      ],
    });
    const rows = buildRows(s, now);
    expect(rows.map((r) => r.magnet)).toEqual(["swarm:" + "2".repeat(64), "swarm:" + "1".repeat(64)]);
  });
});

describe("purchasesForMagnet", () => {
  it("filters to the given magnet and sorts newest first", () => {
    const s = state({
      purchases: [
        purchase({ id: 1, magnet: "swarm:" + "a".repeat(64), ts: 100 }),
        purchase({ id: 2, magnet: "swarm:" + "b".repeat(64), ts: 200 }),
        purchase({ id: 3, magnet: "swarm:" + "a".repeat(64), ts: 300 }),
      ],
    });
    const rows = purchasesForMagnet(s, "swarm:" + "a".repeat(64));
    expect(rows.map((r) => r.id)).toEqual([3, 1]);
  });
});

describe("buildFooter", () => {
  it("derives published/purchased/ratio from summary, and gross straight from summary.gross", () => {
    const s = state({ summary: { artifactCount: 12, purchaseCount: 47, gross: 14_200_000, refunded: 2 } });
    const footer = buildFooter(s);
    expect(footer.published).toBe(12);
    expect(footer.purchased).toBe(47);
    expect(footer.ratio).toBeCloseTo(12 / 47, 6);
    expect(footer.grossUusdc).toBe(14_200_000);
  });

  it("ratio is 0, not NaN or Infinity, when nothing has been purchased yet", () => {
    const footer = buildFooter(state({ summary: { artifactCount: 3, purchaseCount: 0, gross: 0, refunded: 0 } }));
    expect(footer.ratio).toBe(0);
  });

  it("'rode' counts distinct peer accounts that have purchased at least once", () => {
    const peers: PeerState[] = [
      { account: "0.0.1", published: 1, purchased: 0, refundsReceived: 0, refundsIssued: 0 }, // author only
      { account: "0.0.2", published: 0, purchased: 3, refundsReceived: 0, refundsIssued: 0 },
      { account: "0.0.3", published: 0, purchased: 1, refundsReceived: 1, refundsIssued: 0 },
    ];
    const footer = buildFooter(state({ peers }));
    expect(footer.rode).toBe(2);
  });

  it("never fabricates 'drove alone' — always null, the registry has no such field", () => {
    expect(buildFooter(state()).droveAlone).toBeNull();
  });
});

describe("recentEvents", () => {
  it("sorts newest-first and caps at the limit, without inventing fields", () => {
    const events: CarpoolEvent[] = [
      { id: 1, ts: 100, type: "purchase", data: { magnet: "m1", buyer: "b1", txId: "t1", paid: 10 } },
      { id: 2, ts: 300, type: "refund", data: { magnet: "m1", buyer: "b1", txId: "t1", paid: 10 } },
      { id: 3, ts: 200, type: "purchase", data: { magnet: "m2", buyer: "b2", txId: "t2", paid: 20 } },
    ];
    const out = recentEvents(events, 2);
    expect(out.map((e) => e.id)).toEqual([2, 3]);
  });
});

describe("sortRows", () => {
  const rows = buildRows(
    state({
      artifacts: [
        artifact({
          manifest: manifest({ magnet: "swarm:" + "1".repeat(64), question: "Zebra" }),
          health: 0.2,
          freshness: 0.9,
          distinctBuyers: 3,
          priceNow: 90_000,
        }),
        artifact({
          manifest: manifest({ magnet: "swarm:" + "2".repeat(64), question: "Apple" }),
          health: 0.9,
          freshness: 0.1,
          distinctBuyers: 50,
          priceNow: 10_000,
        }),
      ],
    }),
    1_800_003_600,
  );

  it("sorts numeric columns descending first, which is what clicking SEED means", () => {
    expect(sortRows(rows, "seed", "desc").map((r) => r.seed)).toEqual([50, 3]);
    expect(sortRows(rows, "seed", "asc").map((r) => r.seed)).toEqual([3, 50]);
  });

  it("sorts LIFE by freshness and FARE by priceNow", () => {
    expect(sortRows(rows, "freshness", "desc")[0]!.freshness).toBe(0.9);
    expect(sortRows(rows, "priceNow", "asc")[0]!.priceNow).toBe(10_000);
  });

  it("sorts NAME alphabetically, not by health", () => {
    expect(sortRows(rows, "name", "asc")[0]!.name).toContain("Apple");
  });

  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.magnet);
    sortRows(rows, "seed", "asc");
    expect(rows.map((r) => r.magnet)).toEqual(before);
  });

  it("is a total order, so a poll that changes nothing never reshuffles rows", () => {
    const tied = buildRows(
      state({
        artifacts: [
          artifact({ manifest: manifest({ magnet: "swarm:" + "b".repeat(64) }), health: 0.5, freshness: 0.5 }),
          artifact({ manifest: manifest({ magnet: "swarm:" + "a".repeat(64) }), health: 0.5, freshness: 0.5 }),
        ],
      }),
      1_800_003_600,
    );
    const once = sortRows(tied, "health", "desc").map((r) => r.magnet);
    const twice = sortRows(tied, "health", "desc").map((r) => r.magnet);
    expect(once).toEqual(twice);
    expect(once[0]).toBe("swarm:" + "a".repeat(64)); // magnet breaks the tie
  });
});

describe("defaultDirFor", () => {
  it("opens text ascending and numbers descending", () => {
    expect(defaultDirFor("name")).toBe("asc");
    expect(defaultDirFor("health")).toBe("desc");
    expect(defaultDirFor("priceNow")).toBe("desc");
  });
});

describe("buildRows carries the pricing and decay inputs the detail panel needs", () => {
  it("passes priceBase, priceFloor, refundRate, decay and author through unchanged", () => {
    const [row] = buildRows(state({ artifacts: [artifact()] }), 1_800_003_600);
    expect(row!.priceBase).toBe(100_000);
    expect(row!.priceFloor).toBe(10_000);
    expect(row!.refundRate).toBe(0);
    expect(row!.decay).toEqual({ halfLifeDays: 3, producedAt: "2026-09-01T00:00:00Z" });
    expect(row!.author).toBe("0.0.1111:" + "aa".repeat(33));
  });
});

describe("artifactStatus", () => {
  it("separates withdrawn-by-its-author from decayed-past-⅛", () => {
    // `live` folds both together. `delistedAt` is served precisely so a client
    // can tell a decision apart from the passage of time.
    expect(artifactStatus({ live: true, delistedAt: null })).toBe("live");
    expect(artifactStatus({ live: false, delistedAt: null })).toBe("expired");
    expect(artifactStatus({ live: false, delistedAt: 1_800_000_000 })).toBe("withdrawn");
  });

  it("reports withdrawn even if the registry still called it live", () => {
    // Withdrawal is the author's statement and is final for that magnet;
    // expiry is not. If the two ever disagree, the statement wins.
    expect(artifactStatus({ live: true, delistedAt: 1_800_000_000 })).toBe("withdrawn");
  });

  it("has a meaning string for every status", () => {
    for (const status of ["live", "withdrawn", "expired"] as const) {
      expect(STATUS_MEANING[status].length).toBeGreaterThan(0);
    }
  });

  it("says withdrawal does not recall a copy already bought", () => {
    // The contract's load-bearing sentence; the UI repeats it, so the string
    // is asserted rather than left to drift.
    expect(STATUS_MEANING.withdrawn).toMatch(/keeps their copy/);
    expect(STATUS_MEANING.withdrawn).toMatch(/still refundable|stay refundable/);
  });
});

describe("buildRows carries the served age and the two tombstones", () => {
  it("passes ageDays, delistedAt and anchoredAt through, and derives status", () => {
    const s = state({
      artifacts: [artifact({ ageDays: 2.5, delistedAt: 1_800_000_400, anchoredAt: 1_800_000_500 })],
    });
    const [row] = buildRows(s, 1_800_003_600);
    expect(row!.ageDays).toBe(2.5);
    expect(row!.delistedAt).toBe(1_800_000_400);
    expect(row!.anchoredAt).toBe(1_800_000_500);
    expect(row!.status).toBe("withdrawn");
  });

  it("never recomputes ageDays from producedAt — the registry's value is passed verbatim", () => {
    // A deliberately impossible age for the fixture's producedAt: if anything
    // re-derived it, this would come back as the real elapsed time instead.
    const [row] = buildRows(state({ artifacts: [artifact({ ageDays: 999 })] }), 1_800_003_600);
    expect(row!.ageDays).toBe(999);
  });
});

describe("sorting by age", () => {
  const rows = buildRows(
    state({
      artifacts: [
        artifact({ manifest: manifest({ magnet: "swarm:" + "3".repeat(64) }), ageDays: 9 }),
        artifact({ manifest: manifest({ magnet: "swarm:" + "4".repeat(64) }), ageDays: 1 }),
      ],
    }),
    1_800_003_600,
  );

  it("opens newest first, because that is what clicking 'age' means", () => {
    expect(defaultDirFor("ageDays")).toBe("asc");
    expect(sortRows(rows, "ageDays", defaultDirFor("ageDays")).map((r) => r.ageDays)).toEqual([1, 9]);
  });

  it("still sorts oldest first when asked", () => {
    expect(sortRows(rows, "ageDays", "desc").map((r) => r.ageDays)).toEqual([9, 1]);
  });
});
