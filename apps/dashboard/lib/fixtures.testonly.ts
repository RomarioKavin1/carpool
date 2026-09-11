/**
 * ███ TEST-ONLY FIXTURES. NOT REACHABLE FROM THE RENDERED APP. ███
 *
 * Every value in here is obviously synthetic — magnets of repeated hex digits,
 * accounts `0.0.1111`, questions that name themselves as fixtures. Nothing in
 * `app/` or `components/` may import this file, and `fixtures-unreachable.test.ts`
 * fails the suite if anything does.
 *
 * The reason this rule is enforced by a test rather than by convention: an
 * earlier version of this dashboard shipped `lib/fixture.ts` and rendered it,
 * while reading field names the real ledger never emitted — so "live mode"
 * quietly showed dashes and the demo showed invented rows. The fix is not
 * better discipline, it is a test that fails.
 */
import type {
  ArtifactState,
  Batch,
  CarpoolEvent,
  Manifest,
  Payout,
  PurchaseState,
  RegistryState,
} from "./api";

export const FIXTURE_MAGNET_A = `swarm:${"a".repeat(64)}`;
export const FIXTURE_MAGNET_B = `swarm:${"b".repeat(64)}`;

export function fixtureManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    magnet: FIXTURE_MAGNET_A,
    question: "FIXTURE — a synthetic question, never rendered",
    questionNorm: "fixture — a synthetic question, never rendered",
    scope: "fixture-scope",
    abstract: "FIXTURE abstract.",
    sources: [{ url: "https://example.invalid/fixture", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "fixture-model",
      durationSeconds: 100,
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUsd: 1.5,
      toolCalls: 3,
    },
    decay: { halfLifeDays: 1, producedAt: "2026-09-01T00:00:00Z" },
    author: `0.0.1111:${"aa".repeat(33)}`,
    bodyHash: "c".repeat(64),
    bodyBytes: 1024,
    redacted: false,
    ...overrides,
  };
}

export function fixtureArtifact(overrides: Partial<ArtifactState> = {}): ArtifactState {
  return {
    manifest: fixtureManifest(),
    live: true,
    priceBase: 100_000,
    priceFloor: 10_000,
    priceNow: 60_000,
    freshness: 0.5,
    health: 0.2,
    distinctBuyers: 1,
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

export function fixturePurchase(overrides: Partial<PurchaseState> = {}): PurchaseState {
  return {
    id: 1,
    magnet: FIXTURE_MAGNET_A,
    buyer: "0.0.2222",
    txId: "0.0.2222@1-1",
    paid: 60_000,
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

export function fixtureEvent(overrides: Partial<CarpoolEvent> = {}): CarpoolEvent {
  return {
    id: 1,
    ts: 1_800_000_000,
    type: "purchase",
    data: { magnet: FIXTURE_MAGNET_A, buyer: "0.0.2222", txId: "0.0.2222@1-1", paid: 60_000 },
    ...overrides,
  };
}

export function fixtureState(overrides: Partial<RegistryState> = {}): RegistryState {
  const artifacts = overrides.artifacts ?? [fixtureArtifact()];
  const purchases = overrides.purchases ?? [];
  return {
    artifacts,
    purchases,
    peers: overrides.peers ?? [],
    // Served by the registry so a client never hard-codes 120 — see
    // RegistryLedger.state(). Fixture-only default.
    refundWindowSeconds: overrides.refundWindowSeconds ?? 120,
    summary: overrides.summary ?? {
      artifactCount: artifacts.length,
      purchaseCount: purchases.length,
      gross: purchases.reduce((s, p) => s + p.paid, 0),
      refunded: purchases.filter((p) => p.refundState === "refunded").length,
    },
  };
}

/**
 * A `GET /payouts` row. Amounts and ids are obviously synthetic; `state` is
 * whatever the test wants, because the whole point of the route is that the
 * registry decides it and the client reads it.
 */
export function fixturePayout(overrides: Partial<Payout> = {}): Payout {
  return {
    id: 1,
    payee: "0.0.1111",
    amount: 59_500,
    reason: "author_royalty",
    ref: "1",
    availableAt: 1_800_000_120,
    voidedAt: null,
    settledBatchId: null,
    state: "held",
    ...overrides,
  };
}

/** A `GET /batches` row. */
export function fixtureBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: 1,
    txId: "0.0.1111@1800000000.000000001",
    status: "SUCCESS",
    ts: 1_800_000_200,
    root: "d".repeat(64),
    memo: "carpool:batch:1:deadbeef",
    ...overrides,
  };
}
