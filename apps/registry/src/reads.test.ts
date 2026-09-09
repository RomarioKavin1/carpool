/**
 * The read surface a dashboard needs in order to say true things about money.
 *
 * Four gaps, all of the same shape: the registry computed something with its own
 * clock or held it in a table, served a *subset*, and left every client to
 * re-derive the rest — or, worse, to stamp "not observable" where an author's
 * earnings should be.
 *
 *  1. **Payout rows were exposed nowhere.** `/state.purchases` served
 *     `{id, magnet, buyer, txId, paid, ts, refundState}` — no payout ids, no
 *     `settled_batch_id`, no `available_at`, no `voided_at`. So *settled versus
 *     claimable was unrenderable*: for a product whose entire claim is that
 *     authors get paid, whether an author had been paid was invisible.
 *  2. **`refundState` never left `"window"`.** `recordPurchase` writes `"window"`
 *     and nothing ever moves it, so the enum could not distinguish reversible
 *     from claimable and every client re-derived it from `ts + window`. A field
 *     whose value is always the same constant is worse than no field.
 *  3. **`/state` had no `ageDays` while `/search` did** — two surfaces over one
 *     table, one using the server's clock and one the browser's.
 *  4. **No batch read route**, so "your royalty was paid in batch X" had nothing
 *     behind it even though `batch.tx_id` is a public Hedera transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "./testing/harness.js";

let harness: RegistryHarness;
let author: AuthorKeypair;
const KEY = "a".repeat(32); // harness sets LEDGER_API_KEY to this

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.5 });
  author = newAuthor("0.0.1111");
  // This file hand-rolls its PAYMENT-SIGNATURE header (see `buy` below) instead
  // of driving apps/mcp's real x402 client, because what it is about is the
  // registry's READ surface — /payouts, /batches, /state, /events — and it needs
  // to choose each purchase's transaction id so the assertions can name one.
  //
  // The cost, stated rather than hidden: the payload it sends carries
  // `{ signature: "stub" }` where the real client sends a signed Hedera
  // SignedTransaction list, so the real facilitator would refuse it and NOTHING
  // in this file is evidence that a buyer can pay. That evidence is
  // `apps/mcp/src/e2e.test.ts` and `apps/bench/src/agent.test.ts`, which drive
  // the real client through the same stub with this check ON.
  harness.facilitator.requireSignedTransaction = false;
});

afterAll(() => harness?.close());

const get = async (path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(`${harness.base}${path}`, { headers });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

/** One real purchase through the real gate against the harness's stub facilitator. */
async function buy(magnet: string, txId: string) {
  const quote = await fetch(`${harness.base}/artifact/${encodeURIComponent(magnet)}`);
  expect(quote.status).toBe(402);
  const quoted = (await quote.json()) as { accepts: unknown[] };
  harness.facilitator.txId = txId;
  const paid = await fetch(`${harness.base}/artifact/${encodeURIComponent(magnet)}`, {
    headers: {
      "PAYMENT-SIGNATURE": Buffer.from(
        JSON.stringify({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          accepted: quoted.accepts[0],
          payload: { signature: "stub" },
        }),
        "utf8",
      ).toString("base64"),
    },
  });
  expect(paid.status).toBe(200);
}

let magnet: string;

beforeAll(async () => {
  const out = await publishFixture(harness, author, {
    question: "Which Hedera mirror node endpoint lists an account's token balances?",
    priceBase: 30_000,
    priceFloor: 3_000,
  });
  expect(out.status, JSON.stringify(out.json)).toBe(200);
  magnet = out.magnet;
  await buy(magnet, "0.0.2222@reads-1");
});

describe("GET /payouts — what an author was actually paid", () => {
  it("serves one payee's rows with the state that decides whether they have been paid", async () => {
    const { status, body } = await get(`/payouts?payee=${encodeURIComponent(author.accountId)}`);
    expect(status).toBe(200);
    expect(Array.isArray(body.payouts)).toBe(true);
    const royalty = body.payouts.find((p: any) => p.reason === "author_royalty");
    expect(royalty).toBeDefined();
    // Every field the dashboard had to invent or stamp "not observable" for.
    expect(royalty).toMatchObject({
      payee: author.accountId,
      reason: "author_royalty",
      ref: expect.any(String),
    });
    expect(typeof royalty.id).toBe("number");
    // The amount, not its type. `priceBase` 30_000 + `priceFloor` 3_000 at
    // freshness 1 is a 33_000 µUSDC sale; the harness's tracker fee is 500; so
    // the author's royalty is exactly 32_500 and always was — asserting
    // `typeof === "number"` under a heading that says "what an author was
    // actually paid" checked nothing about the money (docs/AUDIT-TESTS.md).
    expect(royalty.amount, "paid (33_000) − trackerFee (500)").toBe(32_500);
    const fee = body.payouts.find((p: any) => p.reason === "tracker_fee");
    expect(fee, "the registry's fee is not this author's row").toBeUndefined();
    expect(typeof royalty.availableAt).toBe("number");
    expect(royalty.voidedAt).toBeNull();
    expect(royalty.settledBatchId).toBeNull();
    // …and the derived state, on the server's clock, so two clients cannot
    // disagree about whether a royalty is claimable yet.
    expect(royalty.state).toBe("held");
  });

  it("scopes strictly: another account's rows are not in the response", async () => {
    const { body } = await get(`/payouts?payee=${encodeURIComponent(author.accountId)}`);
    expect(body.payouts.every((p: any) => p.payee === author.accountId)).toBe(true);
    // The registry's own tracker_fee row exists, and is not this author's.
    const { body: mine } = await get(`/payouts?payee=${encodeURIComponent(harness.registryAccount)}`);
    expect(mine.payouts.some((p: any) => p.reason === "tracker_fee")).toBe(true);
    expect(mine.payouts.every((p: any) => p.payee === harness.registryAccount)).toBe(true);
  });

  it("returns an empty list, not a 404, for an account with no payouts", async () => {
    const { status, body } = await get("/payouts?payee=0.0.999999");
    expect(status).toBe(200);
    expect(body.payouts).toEqual([]);
  });

  it("gates the UNSCOPED table behind the operator secret, while one payee's own rows are open", async () => {
    // One payee's earnings are already computable from /state (every purchase's
    // `paid` and `buyer`) plus the free manifest (which carries the payout
    // account) — so serving them discloses nothing new and removes the
    // arithmetic a client would otherwise get wrong. The WHOLE table is a
    // different object: it aggregates the registry's own fee take beside every
    // author's position, and is not derivable in one request.
    expect((await get("/payouts")).status).toBe(401);
    const { status, body } = await get("/payouts", { "x-carpool-key": KEY });
    expect(status).toBe(200);
    expect(body.payouts.length).toBeGreaterThan(1);
    expect(new Set(body.payouts.map((p: any) => p.payee)).size).toBeGreaterThan(1);
  });

  it("reports a claimed royalty as settled, naming the batch that paid it", async () => {
    const { ledger } = await import("./server.js");
    const before = await get(`/payouts?payee=${encodeURIComponent(harness.registryAccount)}`);
    const fee = before.body.payouts.find((p: any) => p.reason === "tracker_fee");
    expect(fee.state).toBe("claimable"); // tracker_fee is available immediately

    const claim = ledger.settlement.claimBatch("deadbeef", [fee.id]);
    expect(claim.claimed).toEqual([fee.id]);
    ledger.settlement.markSettled(claim.id, "0.0.9@settle-1.0", "SUCCESS");

    const after = await get(`/payouts?payee=${encodeURIComponent(harness.registryAccount)}`);
    const settled = after.body.payouts.find((p: any) => p.id === fee.id);
    expect(settled.settledBatchId).toBe(claim.id);
    expect(settled.state).toBe("settled");
  });

  it("reports a voided royalty as voided rather than omitting it", async () => {
    const out = await publishFixture(harness, author, {
      question: "What does a voided royalty look like on the payouts route?",
      priceBase: 30_000,
      priceFloor: 3_000,
    });
    expect(out.status).toBe(200);
    await buy(out.magnet, "0.0.2222@reads-void-1");

    const { ledger } = await import("./server.js");
    const purchase = ledger.purchaseByTxId("0.0.2222@reads-void-1")!;
    expect(ledger.refundPurchase(ledger.getPurchase(purchase.id)!)).toMatchObject({ ok: true });

    const { body } = await get(`/payouts?payee=${encodeURIComponent(author.accountId)}`);
    const voided = body.payouts.find((p: any) => p.id === purchase.authorRoyaltyPayoutId);
    expect(voided.state).toBe("voided");
    expect(typeof voided.voidedAt).toBe("number");
  });
});

describe("GET /batches — where a royalty was paid", () => {
  it("serves the batch rows, including the public Hedera transaction id", async () => {
    const { status, body } = await get("/batches");
    expect(status).toBe(200);
    const batch = body.batches.find((b: any) => b.txId === "0.0.9@settle-1.0");
    expect(batch).toBeDefined();
    expect(batch).toMatchObject({ status: "SUCCESS", root: "deadbeef" });
    expect(typeof batch.id).toBe("number");
    expect(typeof batch.ts).toBe("number");
    expect(typeof batch.memo).toBe("string");
  });

  it("is open, because a batch is a transaction anyone can already read on a mirror node", async () => {
    expect((await get("/batches")).status).toBe(200);
  });
});

/**
 * `GET /events` — the route, not the function behind it.
 *
 * `ledger.test.ts:451` calls `ledger.eventsSince()` directly and
 * `apps/dashboard/lib/events.test.ts` operates on hand-built fixtures, so until
 * this block **no test issued an HTTP request to `/events` at all**: the route's
 * own `since` parsing, its status code, and the fact that the handler is wired to
 * `eventsSince` rather than to something else were covered by nothing. The
 * dashboard's activity rail polls exactly this, and the only end-to-end evidence
 * it works is one captured file from one live run
 * (`docs/evidence/v2-first-testnet-run/17-events.json`).
 */
describe("GET /events", () => {
  it("serves a purchase and its refund as separate events, oldest first, open", async () => {
    const { status, body } = await get("/events?since=0");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);

    const purchase = body.find((e: any) => e.type === "purchase" && e.data.txId === "0.0.2222@reads-1");
    expect(purchase, "the first purchase this file made").toBeDefined();
    // The four fields apps/dashboard reads off `data`. `paid` is the sale
    // (priceBase 30_000 + priceFloor 3_000 at freshness ~1).
    expect(purchase.data).toMatchObject({
      magnet,
      buyer: harness.facilitator.payer,
      txId: "0.0.2222@reads-1",
      paid: 33_000,
    });
    expect(typeof purchase.id).toBe("number");
    expect(typeof purchase.ts).toBe("number");

    // The refunded purchase from the /payouts block above appears twice — once
    // as the sale, once as the reversal — which is what lets a feed reader show
    // a refund without re-reading /state.
    const refundTx = "0.0.2222@reads-void-1";
    const both = body.filter((e: any) => e.data.txId === refundTx).map((e: any) => e.type);
    expect(both.sort()).toEqual(["purchase", "refund"]);

    const timestamps = body.map((e: any) => e.ts);
    expect(timestamps, "oldest first, so `since` can page forward").toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("treats since as exclusive, and a junk since as 0 rather than an error", async () => {
    const all = (await get("/events?since=0")).body as any[];
    expect(all.length).toBeGreaterThan(1);
    const last = Math.max(...all.map((e) => e.ts));

    // Exclusive: nothing at or before the cursor comes back a second time.
    const after = (await get(`/events?since=${last}`)).body as any[];
    expect(after.every((e: any) => e.ts > last)).toBe(true);

    // A cursor before everything returns everything.
    const first = Math.min(...all.map((e) => e.ts));
    expect(((await get(`/events?since=${first - 1}`)).body as any[]).length).toBe(all.length);

    // `Number(...) || 0` — a dashboard sending an empty or malformed cursor gets
    // the whole feed rather than a 400 or a NaN comparison that returns nothing.
    for (const q of ["", "abc", "NaN"]) {
      const res = await get(`/events?since=${q}`);
      expect(res.status, `since=${JSON.stringify(q)}`).toBe(200);
      expect((res.body as any[]).length).toBe(all.length);
    }
  });
});

describe("GET /state — the fields it computed and did not serve", () => {
  it("serves ageDays on the server's clock, like /search does over the same table", async () => {
    const { body } = await get("/state");
    const row = body.artifacts.find((a: any) => a.manifest.magnet === magnet);
    expect(typeof row.ageDays).toBe("number");
    expect(Number.isFinite(row.ageDays)).toBe(true);

    const hits = (await get("/search")).body as any[];
    const hit = hits.find((h) => h.magnet === magnet);
    // Same table, same clock: within a second of each other, never a browser's.
    expect(Math.abs(row.ageDays - hit.ageDays)).toBeLessThan
      (1 / 86_400);
  });

  it("serves anchoredAt and delistedAt, so provenance and withdrawal are visible", async () => {
    const { body } = await get("/state");
    const row = body.artifacts.find((a: any) => a.manifest.magnet === magnet);
    expect("anchoredAt" in row).toBe(true);
    expect("delistedAt" in row).toBe(true);
    expect(row.anchoredAt).toBeNull(); // no HCS client in the harness
    expect(row.delistedAt).toBeNull();
  });

  it("serves refundDeadline and the payout ids, so nothing has to be re-derived", async () => {
    const { body } = await get("/state");
    const p = body.purchases.find((x: any) => x.txId === "0.0.2222@reads-1");
    expect(typeof p.refundDeadline).toBe("number");
    expect(p.refundDeadline).toBe(p.ts + body.refundWindowSeconds);
    expect(typeof p.authorRoyaltyPayoutId).toBe("number");
    expect(typeof p.trackerFeePayoutId).toBe("number");
  });

  it("serves a refundState that actually transitions, instead of the constant 'window'", async () => {
    const { ledger } = await import("./server.js");
    const { body: fresh } = await get("/state");
    const open = fresh.purchases.find((x: any) => x.txId === "0.0.2222@reads-1");
    expect(open.refundState).toBe("window");

    // Walk the clock past the deadline. The stored column does not change — it
    // is the durable record of whether a refund HAPPENED — but the served state
    // is a function of that plus the clock, and must say "closed".
    const row = ledger.getPurchase(open.id)!;
    ledger.sqlite
      .prepare(`UPDATE purchase SET ts = ?, refund_deadline = ? WHERE id = ?`)
      .run(row.ts - 10_000, row.refundDeadline! - 10_000, row.id);

    const { body: later } = await get("/state");
    const closed = later.purchases.find((x: any) => x.id === open.id);
    expect(closed.refundState).toBe("closed");
    expect(ledger.getPurchase(open.id)!.refundState).toBe("window"); // stored column untouched
  });

  it("still reports a refunded purchase as refunded, whatever the clock says", async () => {
    const { body } = await get("/state");
    const refunded = body.purchases.find((x: any) => x.txId === "0.0.2222@reads-void-1");
    expect(refunded.refundState).toBe("refunded");
  });

  it("publishes refundWindowSeconds and the anchor topic, so a client need not hard-code either", async () => {
    const { body } = await get("/.well-known/carpool");
    expect(typeof body.refundWindowSeconds).toBe("number");
    expect("anchorTopic" in body).toBe(true);
    expect(body.anchorTopic).toBeNull(); // harness blanks HCS_TOPIC_ID
  });
});
