/**
 * `POST /rate` — a buyer who actually paid saying whether it was worth it.
 *
 * Before this there was no rating of any kind in the system: four tables
 * (`artifact`, `purchase`, `peer`, `owed_failure`) and three quality signals
 * (`freshness`, `refundRate`, `distinctBuyers`), none of which is a judgement of
 * whether the research answered the question. What this file pins:
 *
 *  - **Only a buyer who paid may rate, and they prove it cryptographically.** The
 *    proof of payment is not a claim in the body — it is the `purchase` row the
 *    `txId` resolves to — and the caller proves it is that purchase's buyer with a
 *    signature checked against the key the mirror node says controls the account,
 *    exactly as `POST /refund` does. An open rating endpoint is a spam endpoint.
 *  - **The signed message is domain-separated and covers the content.** A
 *    `/refund` signature cannot be replayed as a rating (or the reverse), and a
 *    rating's verdict and reason are inside the signed message, so neither can be
 *    altered in flight.
 *  - **One rating per purchase**, enforced by a UNIQUE index rather than by a
 *    check somebody can forget. Two legitimate purchases of the same artifact are
 *    two ratings; a second attempt on one purchase is a 409, not an edit.
 *  - **An author may not rate their own artifact**, by payout account or by key.
 *  - **A refunded purchase's rating does not count**, whichever order the refund
 *    and the rating arrive in.
 *  - **What is served is counts, never an average**, and the count rides on every
 *    surface that carries a price.
 *  - **Nothing about money moves.** The purchase row, both payout rows and the
 *    refund path behave exactly as they did before the rating existed.
 *
 * Like the other files in here that hand-roll a `PAYMENT-SIGNATURE` header, the
 * payload it sends carries `{ signature: "stub" }` so it can choose each
 * purchase's transaction id — the real facilitator refuses that, so nothing here
 * is evidence that a buyer's client can pay (that is `apps/mcp/src/e2e.test.ts`).
 * What it is evidence of is what the registry's own routes do afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { sha256 } from "@carpool/hedera-x402";
import { MAX_RATING_REASON_CHARS, MIN_RATINGS_FOR_VERDICT, signManifest } from "@carpool/core";
import {
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "./testing/harness.js";

let harness: RegistryHarness;
let author: AuthorKeypair;
/** Three buyers, because a verdict needs three ratings and they must be real purchases. */
let buyerA: AuthorKeypair;
let buyerB: AuthorKeypair;
let buyerC: AuthorKeypair;

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.5 });
  author = newAuthor("0.0.1111");
  buyerA = newAuthor("0.0.2222");
  buyerB = newAuthor("0.0.3333");
  buyerC = newAuthor("0.0.4444");
  // The stub mirror node answers "does this key control this account?" — the half
  // of the check a signature alone cannot make (identity.ts's verifyBuyerAction).
  for (const b of [buyerA, buyerB, buyerC]) harness.mirrorKeys[b.accountId] = b.publicKeyHex;
  harness.facilitator.requireSignedTransaction = false;
});

afterAll(() => harness?.close());

let seq = 0;
const nextTx = (label: string) => `0.0.2222@rate-${label}-${++seq}`;

async function publish(question: string, extra: Record<string, unknown> = {}): Promise<string> {
  const out = await publishFixture(harness, author, { question, priceBase: 30_000, priceFloor: 3_000, ...extra });
  expect(out.status, JSON.stringify(out.json)).toBe(200);
  return out.magnet;
}

/** One real purchase through the real gate: 402, then the paid retry. */
async function buy(magnet: string, buyer: AuthorKeypair, txId: string): Promise<void> {
  const quote = await fetch(`${harness.base}/artifact/${encodeURIComponent(magnet)}`);
  expect(quote.status).toBe(402);
  const quoted = (await quote.json()) as { accepts: unknown[] };
  harness.facilitator.payer = buyer.accountId;
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

/**
 * The rating message, built the way an honest client must:
 * sha256("<txId>:<magnet>:rate:<worth|not-worth>:<sha256(reason)>").
 *
 * Written out here rather than imported from the server so that a change to the
 * message on either side is a red test rather than two files agreeing with each
 * other by construction.
 */
function rateMessage(args: { txId: string; magnet: string; worth: boolean; reason?: string }): string {
  return sha256(
    `${args.txId}:${args.magnet}:rate:${args.worth ? "worth" : "not-worth"}:${sha256(args.reason ?? "")}`,
  );
}

function rateSig(privateKeyHex: string, args: { txId: string; magnet: string; worth: boolean; reason?: string }): string {
  return signManifest(privateKeyHex, rateMessage(args));
}

async function postRate(body: Record<string, unknown>) {
  const res = await fetch(`${harness.base}/rate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** An honest, fully-signed rating from a buyer who paid. */
async function rate(
  buyer: AuthorKeypair,
  args: { txId: string; magnet: string; worth: boolean; reason?: string },
) {
  return postRate({
    txId: args.txId,
    magnet: args.magnet,
    worth: args.worth,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    signature: rateSig(buyer.privateKeyHex, args),
    buyerPublicKey: buyer.publicKeyHex,
  });
}

async function getJson(path: string) {
  const res = await fetch(`${harness.base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

// ---------------------------------------------------------------------------

describe("POST /rate — only a buyer who paid, and they must prove it", () => {
  it("404s a transaction id no purchase was recorded for", async () => {
    const magnet = await publish("Which mirror node endpoint returns an account key, for rate-404?");
    const txId = "0.0.2222@never-settled";
    const out = await rate(buyerA, { txId, magnet, worth: true });
    expect(out.status).toBe(404);
    expect(String(out.body.error)).toMatch(/no purchase recorded/);
  });

  it("400s when the magnet does not match the purchase the tx paid for", async () => {
    const bought = await publish("What does the x402 PAYMENT-REQUIRED header carry, for rate-mismatch?");
    const other = await publish("Which Hedera token id is testnet USDC, for rate-mismatch-other?");
    const txId = nextTx("mismatch");
    await buy(bought, buyerA, txId);
    const out = await rate(buyerA, { txId, magnet: other, worth: true });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toMatch(/magnet does not match/);
  });

  it("401s a signature by a key that does not control the recorded buyer's account", async () => {
    const magnet = await publish("How long is the refund window, for rate-impostor?");
    const txId = nextTx("impostor");
    await buy(magnet, buyerA, txId);

    const impostor = PrivateKey.generateECDSA();
    const out = await postRate({
      txId,
      magnet,
      worth: false,
      signature: signManifest(impostor.toStringRaw(), rateMessage({ txId, magnet, worth: false })),
      buyerPublicKey: impostor.publicKey.toStringRaw(),
    });
    expect(out.status).toBe(401);
    // And nothing was recorded off a failed authentication.
    const { body } = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(body.ratings.count).toBe(0);
  });

  it("400s a body with no verdict at all — `worth` is the whole scale, not an option", async () => {
    const magnet = await publish("What is a magnet, for rate-schema?");
    const txId = nextTx("schema");
    await buy(magnet, buyerA, txId);
    const out = await postRate({
      txId,
      magnet,
      signature: rateSig(buyerA.privateKeyHex, { txId, magnet, worth: true }),
      buyerPublicKey: buyerA.publicKeyHex,
    });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toMatch(/worth/);
  });

  it("records the rating and serves the count back, for a buyer who paid", async () => {
    const magnet = await publish("Which account does payTo name, for rate-happy?");
    const txId = nextTx("happy");
    await buy(magnet, buyerA, txId);

    const out = await rate(buyerA, { txId, magnet, worth: true, reason: "answered it in three lines" });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ ok: true, magnet });
    expect(typeof out.body.ratingId).toBe("number");
    // The count comes back with it, and no average does.
    expect(out.body.ratings).toMatchObject({ count: 1, worth: 1, notWorth: 0, verdict: null, discounted: 0 });
    expect(out.body.ratings.reasons).toEqual([
      { worth: true, reason: "answered it in three lines", ts: expect.any(Number) },
    ]);

    // The row is real, and it kept the buyer's own signature as evidence.
    const { ledger } = await import("./server.js");
    const purchase = ledger.purchaseByTxId(txId)!;
    const row = ledger.ratingForPurchase(purchase.id)!;
    expect(row).toMatchObject({ magnet, rater: buyerA.accountId, worth: 1, purchaseId: purchase.id });
    expect(row.signature).toMatch(/^[0-9a-f]+$/);
    expect(row.raterPublicKey).toBe(buyerA.publicKeyHex);
  });
});

describe("POST /rate — replay protection: one signature, one action, one verdict", () => {
  let magnet: string;
  let txId: string;

  beforeAll(async () => {
    magnet = await publish("Which HCS topic are epochs anchored to, for rate-replay?");
    txId = nextTx("replay");
    await buy(magnet, buyerA, txId);
  });

  it("401s a /refund signature replayed as a rating", async () => {
    // `POST /refund` signs sha256("<txId>:<magnet>:refund"). The same buyer, the
    // same purchase, a different action — and the registry must not accept it, for
    // the reason POST /delist signs its own message rather than the manifest hash.
    const refundSig = signManifest(buyerA.privateKeyHex, sha256(`${txId}:${magnet}:refund`));
    const out = await postRate({
      txId,
      magnet,
      worth: true,
      signature: refundSig,
      buyerPublicKey: buyerA.publicKeyHex,
    });
    expect(out.status).toBe(401);
  });

  it("401s a rating signature replayed as a refund — the separation cuts both ways", async () => {
    const ratingSig = rateSig(buyerA.privateKeyHex, { txId, magnet, worth: true });
    const res = await fetch(`${harness.base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId, magnet, signature: ratingSig, buyerPublicKey: buyerA.publicKeyHex }),
    });
    expect(res.status).toBe(401);
    // And the purchase is still refundable by a correctly signed refund, so the
    // rejected replay cost the buyer nothing.
    const { ledger } = await import("./server.js");
    expect(ledger.effectiveRefundState(ledger.purchaseByTxId(txId)!)).toBe("window");
  });

  it("401s a verdict flipped in flight — `worth` is inside the signed message", async () => {
    const out = await postRate({
      txId,
      magnet,
      worth: false, // posted
      signature: rateSig(buyerA.privateKeyHex, { txId, magnet, worth: true }), // signed
      buyerPublicKey: buyerA.publicKeyHex,
    });
    expect(out.status).toBe(401);
  });

  it("401s an altered reason — the reason is bound in as sha256(reason)", async () => {
    const out = await postRate({
      txId,
      magnet,
      worth: true,
      reason: "actually it was terrible",
      signature: rateSig(buyerA.privateKeyHex, { txId, magnet, worth: true, reason: "it was good" }),
      buyerPublicKey: buyerA.publicKeyHex,
    });
    expect(out.status).toBe(401);
  });

  it("401s a rating signature replayed onto a different purchase of the same artifact", async () => {
    const otherTx = nextTx("replay-other");
    await buy(magnet, buyerB, otherTx);
    const out = await postRate({
      txId: otherTx,
      magnet,
      worth: true,
      // Signed for buyerA's purchase, presented for buyerB's.
      signature: rateSig(buyerA.privateKeyHex, { txId, magnet, worth: true }),
      buyerPublicKey: buyerB.publicKeyHex,
    });
    expect(out.status).toBe(401);
  });
});

describe("POST /rate — one rating per purchase, and it is a constraint", () => {
  it("409s a second rating of the same purchase, including one that changes its mind", async () => {
    const magnet = await publish("What is questionNorm for, in the one-per-purchase test?");
    const txId = nextTx("once");
    await buy(magnet, buyerA, txId);

    expect((await rate(buyerA, { txId, magnet, worth: true })).status).toBe(200);

    const same = await rate(buyerA, { txId, magnet, worth: true });
    expect(same.status).toBe(409);
    expect(String(same.body.error)).toMatch(/already rated/);

    // Not an edit either: a correctly signed opposite verdict is still refused.
    const flipped = await rate(buyerA, { txId, magnet, worth: false });
    expect(flipped.status).toBe(409);

    const { body } = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(body.ratings).toMatchObject({ count: 1, worth: 1, notWorth: 0 });
  });

  it("counts two ratings from one buyer who bought the same artifact twice", async () => {
    // The reason the unique index is on `purchase_id` and not on `(rater, magnet)`:
    // two purchases are two experiences, each paid for at the price of its moment.
    const magnet = await publish("Does a second purchase earn a second rating?");
    const first = nextTx("twice-a");
    const second = nextTx("twice-b");
    await buy(magnet, buyerA, first);
    await buy(magnet, buyerA, second);

    expect((await rate(buyerA, { txId: first, magnet, worth: true })).status).toBe(200);
    const out = await rate(buyerA, { txId: second, magnet, worth: false, reason: "stale the second time" });
    expect(out.status).toBe(200);
    expect(out.body.ratings).toMatchObject({ count: 2, worth: 1, notWorth: 1, verdict: null });
  });

  it("is enforced by the database, not only by the route", async () => {
    const magnet = await publish("Is the one-rating rule a UNIQUE index?");
    const txId = nextTx("unique");
    await buy(magnet, buyerA, txId);
    expect((await rate(buyerA, { txId, magnet, worth: true })).status).toBe(200);

    const { ledger } = await import("./server.js");
    const purchaseId = ledger.purchaseByTxId(txId)!.id;
    // Straight past every check in the route and in recordRating.
    expect(() =>
      ledger.sqlite
        .prepare(
          `INSERT INTO rating (purchase_id, magnet, rater, worth, reason, ts, signature, rater_public_key)
           VALUES (?, ?, ?, 1, NULL, 1, 'x', 'y')`,
        )
        .run(purchaseId, magnet, buyerA.accountId),
    ).toThrow(/UNIQUE constraint failed: rating\.purchase_id/);
  });
});

describe("POST /rate — an author may not rate their own artifact", () => {
  it("403s the author buying and rating their own work", async () => {
    const magnet = await publish("Can an author rate their own artifact?");
    // The author buys their own artifact from the account the manifest names.
    harness.mirrorKeys[author.accountId] = author.publicKeyHex;
    const txId = nextTx("self");
    await buy(magnet, author, txId);

    const out = await rate(author, { txId, magnet, worth: true, reason: "excellent work, if I say so myself" });
    expect(out.status).toBe(403);
    expect(String(out.body.error)).toMatch(/may not rate their own artifact/);

    const { body } = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(body.ratings.count).toBe(0);
    const { ledger } = await import("./server.js");
    expect(ledger.ratingForPurchase(ledger.purchaseByTxId(txId)!.id)).toBeNull();
  });

  it("403s the author buying from a second account but signing with the manifest's key", async () => {
    // Both halves of `"<accountId>:<publicKeyHex>"` are one identity, so the key
    // alone gives it away even when the payout account does not.
    const magnet = await publish("Can an author rate their own artifact from another account?");
    const sockpuppet = "0.0.5555";
    harness.mirrorKeys[sockpuppet] = author.publicKeyHex;
    const txId = nextTx("self-key");
    await buy(magnet, { ...author, accountId: sockpuppet }, txId);

    const out = await rate({ ...author, accountId: sockpuppet }, { txId, magnet, worth: true });
    expect(out.status).toBe(403);
  });
});

describe("POST /rate — what a refunded purchase may do", () => {
  /**
   * The decision, and it is explicit: **a refunded purchase's rating does not
   * count.** The refund already records the buyer's dissatisfaction in money — it
   * voids the author's royalty and moves `refundRate`, which is a term in
   * `health` — so counting it a second time as a rating would let one sale move
   * two apparently independent signals, and since a refunded buyer's rating is
   * realistically only ever negative the counts would inherit the refund's bias
   * while looking like separate evidence.
   *
   * One rule, enforced at both ends so the arrival order cannot change the answer.
   */
  async function refund(buyer: AuthorKeypair, txId: string, magnet: string) {
    const signature = signManifest(buyer.privateKeyHex, sha256(`${txId}:${magnet}:refund`));
    const res = await fetch(`${harness.base}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txId, magnet, signature, buyerPublicKey: buyer.publicKeyHex }),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  it("refuses to rate a purchase that was already refunded", async () => {
    const magnet = await publish("May a refunded buyer rate, for refund-then-rate?");
    const txId = nextTx("refunded-first");
    await buy(magnet, buyerA, txId);
    expect((await refund(buyerA, txId, magnet)).status).toBe(200);

    const out = await rate(buyerA, { txId, magnet, worth: false, reason: "took my money back" });
    expect(out.status).toBe(409);
    expect(String(out.body.error)).toMatch(/refunded/);
  });

  it("keeps a rating written before a refund as a row, and stops counting it", async () => {
    const magnet = await publish("What happens to a rating when the sale is reversed?");
    const txId = nextTx("rated-first");
    await buy(magnet, buyerA, txId);
    expect((await rate(buyerA, { txId, magnet, worth: false, reason: "not what I asked" })).status).toBe(200);

    let read = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(read.body.ratings).toMatchObject({ count: 1, notWorth: 1, discounted: 0 });

    // The refund still works after a rating — the rating touched no money.
    expect((await refund(buyerA, txId, magnet)).status).toBe(200);

    read = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(read.body.ratings).toMatchObject({ count: 0, worth: 0, notWorth: 0, discounted: 1, verdict: null });
    // Discounted, never deleted: the row is still there to be audited.
    const { ledger } = await import("./server.js");
    expect(ledger.ratingForPurchase(ledger.purchaseByTxId(txId)!.id)).not.toBeNull();
    // And the reason went with it — a discounted rating is not quoted on a listing.
    expect(read.body.ratings.reasons).toEqual([]);
  });
});

describe("ratings on the read surface — the count is impossible to ignore", () => {
  let magnet: string;

  beforeAll(async () => {
    magnet = await publish("Which registry surfaces carry an artifact's ratings?");
    const txA = nextTx("read-a");
    const txB = nextTx("read-b");
    await buy(magnet, buyerA, txA);
    await buy(magnet, buyerB, txB);
    expect((await rate(buyerA, { txId: txA, magnet, worth: true, reason: "saved me twenty minutes" })).status).toBe(200);
    expect((await rate(buyerB, { txId: txB, magnet, worth: true })).status).toBe(200);
  });

  /** No average, no percentage, no stars — anywhere, on any surface. */
  function expectNoDerivedNumber(ratings: Record<string, unknown>) {
    const forbidden = Object.keys(ratings).filter((k) => /avg|average|score|ratio|percent|star|mean/i.test(k));
    expect(forbidden, "a single derived number is how `4.5 stars` off two ratings reaches a screen").toEqual([]);
    expect(Object.keys(ratings).sort()).toEqual([
      "count",
      "discounted",
      "notWorth",
      "reasons",
      "verdict",
      "worth",
    ]);
  }

  it("serves them on a browse GET /search, beside the price", async () => {
    const { body } = await getJson(`/search?limit=100`);
    const hit = (body as any[]).find((r) => r.magnet === magnet)!;
    expect(hit).toBeDefined();
    expect(hit.ratings).toMatchObject({ count: 2, worth: 2, notWorth: 0, verdict: null });
    expect(hit.ratings.reasons).toEqual([{ worth: true, reason: "saved me twenty minutes", ts: expect.any(Number) }]);
    expectNoDerivedNumber(hit.ratings);
    // The price it is deciding against is in the same object.
    expect(typeof hit.priceNow).toBe("number");
  });

  it("serves them on a ranked GET /search too", async () => {
    const { body } = await getJson(`/search?q=${encodeURIComponent("Which registry surfaces carry an artifact's ratings?")}&limit=20`);
    const hit = (body as any[]).find((r) => r.magnet === magnet)!;
    expect(hit, "the ranked path must serve the same evidence as the browse path").toBeDefined();
    expect(hit.ratings).toMatchObject({ count: 2, worth: 2 });
  });

  it("serves them on GET /manifest/:magnet — the detail a buyer reads before paying", async () => {
    const { body } = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(body.ratings).toMatchObject({ count: 2, worth: 2, notWorth: 0, verdict: null, discounted: 0 });
    expectNoDerivedNumber(body.ratings);
  });

  it("serves them on GET /state, per artifact, beside health and its terms", async () => {
    const { body } = await getJson("/state");
    const row = body.artifacts.find((a: any) => a.manifest.magnet === magnet)!;
    expect(row.ratings).toMatchObject({ count: 2, worth: 2 });
    expectNoDerivedNumber(row.ratings);
    // `health` is unchanged by ratings — three terms, as documented.
    expect(row.health).toBeCloseTo(row.freshness * (1 - row.refundRate) * (0.4 + 0.6 * Math.min(1, row.distinctBuyers / 5)), 10);
  });

  it("says on GET /state which purchases have spent their one rating", async () => {
    const { body } = await getJson("/state");
    const rated = body.purchases.filter((p: any) => p.magnet === magnet);
    expect(rated.length).toBe(2);
    expect(rated.every((p: any) => p.rated === true)).toBe(true);
    // And the summary counts rating ROWS, named so it cannot read as approval.
    expect(typeof body.summary.ratingCount).toBe("number");
    expect(body.summary.ratingCount).toBeGreaterThanOrEqual(2);
  });

  it("withholds a verdict below three ratings and states one at three", async () => {
    // Two worth-it ratings, and still no verdict: a unanimous sample of two is an
    // anecdote, and "100%" off two is the number this API refuses to make possible.
    let read = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(read.body.ratings, "a unanimous two must not be served as a verdict").toMatchObject({
      count: 2,
      worth: 2,
      verdict: null,
    });
    // The threshold is the registry's, not this test's re-implementation of it.
    expect(MIN_RATINGS_FOR_VERDICT).toBe(3);

    const txC = nextTx("read-c");
    await buy(magnet, buyerC, txC);
    expect((await rate(buyerC, { txId: txC, magnet, worth: true })).status).toBe(200);

    read = await getJson(`/manifest/${encodeURIComponent(magnet)}`);
    expect(read.body.ratings).toMatchObject({ count: 3, worth: 3, verdict: "worth" });
  });

  it("carries at most three reasons, newest first", async () => {
    const m = await publish("How many reasons ride along on a listing?");
    const buyers = [buyerA, buyerB, buyerC, buyerA];
    for (const [i, b] of buyers.entries()) {
      const tx = nextTx(`reasons-${i}`);
      await buy(m, b, tx);
      expect((await rate(b, { txId: tx, magnet: m, worth: true, reason: `reason ${i}` })).status).toBe(200);
    }
    const { body } = await getJson(`/manifest/${encodeURIComponent(m)}`);
    expect(body.ratings.count).toBe(4);
    expect(body.ratings.reasons.length).toBe(3);
    const timestamps = body.ratings.reasons.map((r: any) => r.ts);
    expect([...timestamps].sort((a: number, b: number) => b - a)).toEqual(timestamps);
  });
});

describe("POST /rate — the reason is validated, never quietly rewritten", () => {
  let magnet: string;
  let txId: string;

  beforeAll(async () => {
    magnet = await publish("What are the limits on a rating's reason?");
    txId = nextTx("reason-limits");
    await buy(magnet, buyerA, txId);
  });

  it("400s a reason over the cap rather than truncating what the buyer signed", async () => {
    const tooLong = "x".repeat(MAX_RATING_REASON_CHARS + 1);
    const out = await rate(buyerA, { txId, magnet, worth: true, reason: tooLong });
    expect(out.status).toBe(400);
    // Nothing stored, so the buyer's one rating is not spent on a rejected request.
    const { ledger } = await import("./server.js");
    expect(ledger.ratingForPurchase(ledger.purchaseByTxId(txId)!.id)).toBeNull();
  });

  it("400s a reason carrying control characters", async () => {
    const out = await rate(buyerA, { txId, magnet, worth: false, reason: "line one\nline two" });
    expect(out.status).toBe(400);
    expect(String(out.body.error)).toMatch(/control character/);
  });

  it("accepts exactly the cap, and stores it byte-for-byte as signed", async () => {
    const exact = "y".repeat(MAX_RATING_REASON_CHARS);
    const out = await rate(buyerA, { txId, magnet, worth: true, reason: exact });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const { ledger } = await import("./server.js");
    expect(ledger.ratingForPurchase(ledger.purchaseByTxId(txId)!.id)!.reason).toBe(exact);
  });
});

describe("POST /rate — the money paths are untouched", () => {
  it("changes no purchase column, no payout row and no refundability", async () => {
    const magnet = await publish("Does rating an artifact move any money?");
    const txId = nextTx("money");
    await buy(magnet, buyerA, txId);

    const { ledger } = await import("./server.js");
    const before = ledger.purchaseByTxId(txId)!;
    const royaltyBefore = ledger.settlement.amountOf(before.authorRoyaltyPayoutId!);
    const feeBefore = ledger.settlement.amountOf(before.trackerFeePayoutId!);
    const payoutsBefore = ledger.payouts();

    expect((await rate(buyerA, { txId, magnet, worth: false, reason: "thin" })).status).toBe(200);

    const after = ledger.purchaseByTxId(txId)!;
    // Every column of the purchase row, unchanged — a rating is an opinion about a
    // sale, not a change to one.
    expect(after).toEqual(before);
    expect(ledger.settlement.amountOf(after.authorRoyaltyPayoutId!)).toBe(royaltyBefore);
    expect(ledger.settlement.amountOf(after.trackerFeePayoutId!)).toBe(feeBefore);
    expect(ledger.payouts()).toEqual(payoutsBefore);
    // splitSale's invariant still holds over this sale.
    expect(royaltyBefore! + feeBefore!).toBe(before.paid);
    // And the refund window is still open and still reversible.
    expect(ledger.effectiveRefundState(after)).toBe("window");
  });
});
