import { describe, expect, it } from "vitest";
import {
  AUTHOR_ROYALTY,
  batchFor,
  batchesById,
  buildSeeders,
  findSeeder,
  parseAuthor,
  payoutsById,
  secondsUntilFinal,
  totalPayouts,
} from "./seeding";
import {
  FIXTURE_MAGNET_A,
  FIXTURE_MAGNET_B,
  fixtureArtifact,
  fixtureBatch,
  fixtureManifest,
  fixturePayout,
  fixturePurchase,
  fixtureState,
} from "./fixtures.testonly";

const NOW = 1_800_000_000;

describe("parseAuthor", () => {
  it("splits this registry's <accountId>:<publicKeyHex> convention", () => {
    const id = parseAuthor(`0.0.1234:${"ab".repeat(32)}`);
    expect(id.payoutAccount).toBe("0.0.1234");
    expect(id.publicKey).toBe("ab".repeat(32));
  });

  it("keeps the raw string and refuses to guess when the shape does not match", () => {
    // manifest.author is opaque to the protocol. An author that is not this
    // registry's convention must NOT be rendered as a payout account — and
    // without one there is no ?payee= scope to ask GET /payouts for.
    for (const raw of ["did:key:z6Mk", "0.0.1234", "not-an-account:zzzz", ":abcdef01"]) {
      const id = parseAuthor(raw);
      expect(id.raw).toBe(raw);
      expect(id.payoutAccount).toBeNull();
      expect(id.publicKey).toBeNull();
    }
  });
});

describe("secondsUntilFinal", () => {
  it("counts down only while the registry says the window is open", () => {
    expect(
      secondsUntilFinal({ refundState: "window", refundDeadline: NOW + 45 }, NOW),
    ).toBe(45);
  });

  it("is null once the registry says closed — never a negative countdown", () => {
    // The point of the served `refundState`: the client does not decide this
    // from `ts + refundWindowSeconds` against its own clock any more.
    expect(secondsUntilFinal({ refundState: "closed", refundDeadline: NOW - 5 }, NOW)).toBeNull();
    expect(secondsUntilFinal({ refundState: "refunded", refundDeadline: NOW + 60 }, NOW)).toBeNull();
  });

  it("floors at zero rather than going negative on a stale poll", () => {
    expect(secondsUntilFinal({ refundState: "window", refundDeadline: NOW - 3 }, NOW)).toBe(0);
  });

  it("is null when the registry served no deadline", () => {
    expect(secondsUntilFinal({ refundState: "window", refundDeadline: null }, NOW)).toBeNull();
  });
});

describe("totalPayouts", () => {
  const rows = [
    fixturePayout({ id: 1, amount: 100, state: "held" }),
    fixturePayout({ id: 2, amount: 200, state: "claimable" }),
    fixturePayout({ id: 3, amount: 400, state: "settled", settledBatchId: 7 }),
    fixturePayout({ id: 4, amount: 800, state: "voided", voidedAt: NOW }),
    fixturePayout({ id: 5, amount: 500, state: "settled", reason: "tracker_fee", settledBatchId: 7 }),
  ];

  it("sums the four states straight off the rows", () => {
    const t = totalPayouts(rows, AUTHOR_ROYALTY);
    expect(t.held).toBe(100);
    expect(t.claimable).toBe(200);
    expect(t.settled).toBe(400);
    expect(t.voided).toBe(800);
    expect(t.rows).toBe(4);
  });

  it("earned excludes voided, and final excludes held", () => {
    const t = totalPayouts(rows, AUTHOR_ROYALTY);
    expect(t.earned).toBe(700); // held + claimable + settled
    expect(t.final).toBe(600); // claimable + settled — no longer reversible
  });

  it("filters by reason, so the tracker's cut is never counted as an author's", () => {
    expect(totalPayouts(rows, AUTHOR_ROYALTY).settled).toBe(400);
    expect(totalPayouts(rows, "tracker_fee").settled).toBe(500);
    expect(totalPayouts(rows).settled).toBe(900); // unfiltered
  });

  it("is all zeros for an empty set — not a null, because zero rows really is zero money", () => {
    const t = totalPayouts([], AUTHOR_ROYALTY);
    expect(t).toMatchObject({ held: 0, claimable: 0, settled: 0, voided: 0, earned: 0, rows: 0 });
  });

  it("never recomputes an amount — a royalty of paid−fee would disagree after a fee change", () => {
    // The registry writes `amount` once, at accrual, against the fee in force
    // then. Re-deriving it from today's fee is the bug this replaced.
    const t = totalPayouts([fixturePayout({ amount: 12_345, state: "settled" })], AUTHOR_ROYALTY);
    expect(t.settled).toBe(12_345);
  });
});

describe("payoutsById / batchesById / batchFor", () => {
  const payout = fixturePayout({ id: 9, state: "settled", settledBatchId: 3 });
  const batches = batchesById([fixtureBatch({ id: 3, txId: "0.0.1@2.3" })]);

  it("joins a settled payout to the batch that paid it", () => {
    expect(batchFor(payout, batches)?.txId).toBe("0.0.1@2.3");
  });

  it("is null for a payout that is not settled — there is no batch to name", () => {
    expect(batchFor(fixturePayout({ state: "claimable" }), batches)).toBeNull();
    expect(batchFor(fixturePayout({ state: "held" }), batches)).toBeNull();
  });

  it("is null when the batch was not fetched, so the UI can say which it is", () => {
    expect(batchFor(payout, batchesById([]))).toBeNull();
  });

  it("is null for an undefined payout rather than throwing", () => {
    expect(batchFor(undefined, batches)).toBeNull();
  });

  it("indexes payouts by id for the purchase join", () => {
    expect(payoutsById([payout]).get(9)?.amount).toBe(payout.amount);
  });
});

describe("buildSeeders", () => {
  const AUTHOR_ONE = `0.0.1111:${"aa".repeat(33)}`;
  const AUTHOR_TWO = `0.0.9999:${"bb".repeat(33)}`;

  const state = fixtureState({
    artifacts: [
      fixtureArtifact({
        manifest: fixtureManifest({ magnet: FIXTURE_MAGNET_A, author: AUTHOR_ONE }),
        anchoredAt: 1_800_000_500,
      }),
      fixtureArtifact({
        manifest: fixtureManifest({ magnet: FIXTURE_MAGNET_B, author: AUTHOR_TWO }),
        live: false,
        delistedAt: 1_800_000_400,
      }),
    ],
    purchases: [
      fixturePurchase({
        id: 1,
        magnet: FIXTURE_MAGNET_A,
        paid: 60_000,
        refundState: "closed",
        authorRoyaltyPayoutId: 11,
      }),
      fixturePurchase({
        id: 2,
        magnet: FIXTURE_MAGNET_A,
        paid: 40_000,
        refundState: "window",
        authorRoyaltyPayoutId: 12,
      }),
      fixturePurchase({
        id: 3,
        magnet: FIXTURE_MAGNET_A,
        paid: 20_000,
        refundState: "refunded",
        refundedAt: NOW,
        authorRoyaltyPayoutId: 13,
      }),
      fixturePurchase({ id: 4, magnet: FIXTURE_MAGNET_B, paid: 10_000, authorRoyaltyPayoutId: 14 }),
    ],
  });

  const payoutsForOne = [
    fixturePayout({ id: 11, amount: 59_500, state: "settled", settledBatchId: 3, ref: "1" }),
    fixturePayout({ id: 12, amount: 39_500, state: "held", ref: "2" }),
    fixturePayout({ id: 13, amount: 19_500, state: "voided", voidedAt: NOW, ref: "3" }),
  ];

  it("groups by the raw author string, not by the parsed account", () => {
    const seeders = buildSeeders(state);
    expect(seeders.map((s) => s.identity.raw).sort()).toEqual([AUTHOR_ONE, AUTHOR_TWO].sort());
  });

  it("joins each sale to the payout row it accrued, by authorRoyaltyPayoutId", () => {
    const one = findSeeder(buildSeeders(state, payoutsForOne), "0.0.1111")!;
    const byPurchase = new Map(one.saleRows.map((r) => [r.purchase.id, r.royalty]));
    expect(byPurchase.get(1)?.state).toBe("settled");
    expect(byPurchase.get(1)?.amount).toBe(59_500);
    expect(byPurchase.get(2)?.state).toBe("held");
    expect(byPurchase.get(3)?.state).toBe("voided");
  });

  it("leaves the royalty undefined when no payout set was fetched — never a computed stand-in", () => {
    const one = findSeeder(buildSeeders(state), "0.0.1111")!;
    expect(one.saleRows.every((r) => r.royalty === undefined)).toBe(true);
  });

  it("leaves it undefined for a payee whose rows were not the ones fetched", () => {
    // Payouts are scoped to one payee at a time, so another author's sales
    // join nothing. That must read as "not read", not as "zero".
    const two = findSeeder(buildSeeders(state, payoutsForOne), "0.0.9999")!;
    expect(two.saleRows[0]!.royalty).toBeUndefined();
  });

  it("counts sales, refunds and still-reversible sales from the served refundState", () => {
    const one = findSeeder(buildSeeders(state), "0.0.1111")!;
    expect(one.sales).toBe(3);
    expect(one.grossUusdc).toBe(120_000);
    expect(one.refundedSales).toBe(1);
    expect(one.reversibleSales).toBe(1); // only the one still in "window"
  });

  it("separates withdrawn from merely not-live, and counts anchored manifests", () => {
    const seeders = buildSeeders(state);
    const one = findSeeder(seeders, "0.0.1111")!;
    const two = findSeeder(seeders, "0.0.9999")!;
    expect(one.anchoredArtifacts).toBe(1);
    expect(one.withdrawnArtifacts).toBe(0);
    expect(two.withdrawnArtifacts).toBe(1);
    expect(two.liveArtifacts).toBe(0);
    expect(two.anchoredArtifacts).toBe(0);
  });

  it("orders by what buyers paid, which does not move when the payout scope changes", () => {
    expect(buildSeeders(state)[0]!.identity.payoutAccount).toBe("0.0.1111");
    expect(buildSeeders(state, payoutsForOne)[0]!.identity.payoutAccount).toBe("0.0.1111");
  });

  it("returns no seeders for an empty registry rather than throwing", () => {
    expect(buildSeeders(fixtureState({ artifacts: [], purchases: [] }))).toEqual([]);
  });
});

describe("findSeeder", () => {
  const seeders = buildSeeders(fixtureState({ artifacts: [fixtureArtifact()], purchases: [] }));

  it("matches on the payout account or the raw author string", () => {
    expect(findSeeder(seeders, "0.0.1111")).not.toBeNull();
    expect(findSeeder(seeders, seeders[0]!.identity.raw)).not.toBeNull();
  });

  it("is null for an unknown key or no key", () => {
    expect(findSeeder(seeders, "0.0.4040")).toBeNull();
    expect(findSeeder(seeders, null)).toBeNull();
  });
});
