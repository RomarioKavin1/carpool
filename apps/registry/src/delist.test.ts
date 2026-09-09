/**
 * I8 — `POST /delist`: an author withdrawing their own artifact.
 *
 * `artifact.delisted_at` existed in the schema, was read by `isLive`, `listLive`,
 * `liveQuestions` and the payment gate's `quote`, and was written by **nothing**.
 * No route set it. Meanwhile `carpool_publish`'s tool description, the consent
 * hook's prompt, `apps/mcp/README.md` and `docs/RESTRUCTURE.md` all told the
 * author "delisting stops new sales" — an affordance the product did not have.
 *
 * What delist must and must not do, because money is in flight when it happens:
 *
 *   - **No rows are deleted.** The ledger's discipline is `voided_at` /
 *     `available_at` / `delisted_at` — a tombstone, never a DELETE. Removing the
 *     artifact row would take the refund path with it (`/refund` reads
 *     `purchase` and voids `payout`, and `refundUndelivered` re-reads the row
 *     inside its transaction), and would strand the manifest hash the HCS anchor
 *     has already committed to.
 *   - A purchase **inside its refund window stays refundable**. The buyer's
 *     120 seconds are theirs; the author cannot cancel them by withdrawing.
 *   - A royalty **not yet settled is still paid**. The sale happened. Delisting
 *     is about future sales.
 *   - A **new** purchase is impossible: `/search` stops returning it,
 *     `/manifest/:magnet` 410s, and `GET /artifact/:magnet` 410s instead of
 *     quoting a price nobody should pay.
 *   - It is **authenticated as the author** — same signature scheme as
 *     `/publish` (`src/identity.ts`), over a delist-specific message so a
 *     publish signature cannot be replayed as a withdrawal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@carpool/hedera-x402";
import { magnetOf, signManifest } from "@carpool/core";
import {
  newAuthor,
  publishFixture,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "./testing/harness.js";

let harness: RegistryHarness;
let author: AuthorKeypair;
let other: AuthorKeypair;

beforeAll(async () => {
  harness = await startRegistry({ similarityThreshold: 0.5 });
  author = newAuthor("0.0.1111");
  other = newAuthor("0.0.3333");
  // The one paid request in this file hand-rolls its PAYMENT-SIGNATURE header so
  // it can choose the transaction id it later looks the purchase up by. That
  // payload carries `{ signature: "stub" }`, which the real facilitator refuses —
  // so this file proves what delist does to money already in flight, and proves
  // nothing about whether a buyer's client can pay. See
  // `testing/stubFacilitator.ts` and `apps/mcp/src/e2e.test.ts`.
  harness.facilitator.requireSignedTransaction = false;
});

afterAll(() => harness?.close());

/** The delist message: sha256("<magnet>:delist"), signed by the author's key. */
function delistSig(privateKeyHex: string, magnet: string): string {
  return signManifest(privateKeyHex, sha256(`${magnet}:delist`));
}

async function postDelist(magnet: string, authorSig: string) {
  const res = await fetch(`${harness.base}/delist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ magnet, authorSig }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function publish(question: string, fx: Parameters<typeof publishFixture>[2] = { question }) {
  const out = await publishFixture(harness, author, { ...fx, question });
  expect(out.status, JSON.stringify(out.json)).toBe(200);
  return out.magnet;
}

describe("POST /delist — authentication", () => {
  it("404s an unknown magnet", async () => {
    const magnet = `swarm:${"f".repeat(64)}`;
    const out = await postDelist(magnet, delistSig(author.privateKeyHex, magnet));
    expect(out.status).toBe(404);
  });

  it("401s a signature from someone who is not the author", async () => {
    const magnet = await publish("Which mirror node endpoint returns an account key for delist-auth?");
    const out = await postDelist(magnet, delistSig(other.privateKeyHex, magnet));
    expect(out.status).toBe(401);
    // Still selling: a failed delist must change nothing.
    expect((await fetch(`${harness.base}/manifest/${encodeURIComponent(magnet)}`)).status).toBe(200);
  });

  it("401s a publish signature replayed as a delist", async () => {
    const magnet = await publish("How does x402 quote replay work for delist-replay?");
    // The /publish signature is over the manifest hash alone; delist is over
    // sha256("<magnet>:delist"), so one cannot stand in for the other.
    const publishSig = signManifest(author.privateKeyHex, magnet.slice("swarm:".length));
    expect((await postDelist(magnet, publishSig)).status).toBe(401);
  });

  it("400s a body missing the signature entirely", async () => {
    const magnet = await publish("What does a delist request body look like?");
    const res = await fetch(`${harness.base}/delist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/authorSig/);
  });
});

describe("POST /delist — what it stops", () => {
  let magnet: string;

  // Pinned so the republish below rebuilds the identical manifest — `producedAt`
  // is inside the content address, so `new Date()` would mint a new magnet.
  const PRODUCED_AT = "2026-09-11T00:00:00.000Z";

  beforeAll(async () => {
    magnet = await publish("What is the ETHOnline 2026 prize pool for the delist test?", {
      question: "",
      producedAt: PRODUCED_AT,
      priceBase: 40_000,
      priceFloor: 4_000,
    });
    const out = await postDelist(magnet, delistSig(author.privateKeyHex, magnet));
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.alreadyDelisted).toBe(false);
    expect(typeof out.body.delistedAt).toBe("number");
  });

  it("drops it from browse", async () => {
    const rows = (await fetch(`${harness.base}/search`).then((r) => r.json())) as { magnet: string }[];
    expect(rows.map((r) => r.magnet)).not.toContain(magnet);
  });

  it("drops it from ranked search, on the question it answers best", async () => {
    const rows = (await fetch(
      `${harness.base}/search?q=${encodeURIComponent("ETHOnline 2026 prize pool for the delist test")}`,
    ).then((r) => r.json())) as { magnet: string }[];
    expect(rows.map((r) => r.magnet)).not.toContain(magnet);
  });

  it("410s its manifest rather than 404ing — it existed, and the anchor says so", async () => {
    const res = await fetch(`${harness.base}/manifest/${encodeURIComponent(magnet)}`);
    expect(res.status).toBe(410);
  });

  it("410s a purchase attempt instead of quoting a price nobody should pay", async () => {
    const res = await fetch(`${harness.base}/artifact/${encodeURIComponent(magnet)}`);
    expect(res.status).toBe(410);
  });

  it("keeps every row: the artifact, its body hash and its manifest hash are all still there", async () => {
    const state = (await fetch(`${harness.base}/state`).then((r) => r.json())) as any;
    const row = state.artifacts.find((a: any) => a.manifest.magnet === magnet);
    expect(row).toBeDefined();
    expect(row.live).toBe(false);
    expect(row.manifest.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    // The name of this test promises the manifest hash, so assert it rather than
    // its shape: the magnet IS sha256(manifest-without-magnet), so a delist that
    // disturbed the manifest would change this. It is the tombstone's whole
    // point that it does not.
    expect(row.manifest.magnet).toBe(magnet);
    expect(magnetOf(row.manifest)).toBe(magnet);
  });

  it("is idempotent: a retried delist reports the original timestamp rather than erroring", async () => {
    const again = await postDelist(magnet, delistSig(author.privateKeyHex, magnet));
    expect(again.status).toBe(200);
    expect(again.body.alreadyDelisted).toBe(true);
  });

  it("survives a republish of the same manifest — a delist is final for that magnet", async () => {
    // Content-addressed: the magnet *is* the content, so withdrawing it is a
    // final statement about that content. An author who wants to sell again
    // publishes new research, which is a new magnet.
    const again = await publishFixture(harness, author, {
      question: "What is the ETHOnline 2026 prize pool for the delist test?",
      producedAt: PRODUCED_AT,
      priceBase: 40_000,
      priceFloor: 4_000,
    });
    expect(again.magnet).toBe(magnet);
    expect(again.status).toBe(200);
    expect((await fetch(`${harness.base}/manifest/${encodeURIComponent(magnet)}`)).status).toBe(410);
  });

  it("still anchors: provenance is not a listing concern", async () => {
    // unanchoredManifests() deliberately ignores delisted_at — "this content
    // existed, unmodified, at a consensus time" remains true after a withdrawal.
    const { ledger } = await import("./server.js");
    expect(ledger.unanchoredManifests().map((a) => a.magnet)).toContain(magnet);
  });
});

describe("POST /delist — money already in flight", () => {
  it("leaves a purchase inside its refund window refundable, and pays the royalty that was already earned", async () => {
    const magnet = await publish("Which Hedera token id is testnet USDC, for the in-flight delist test?", {
      question: "",
      priceBase: 30_000,
      priceFloor: 3_000,
    });

    // Buy it through the real gate against the harness's stub facilitator.
    const quoteRes = await fetch(`${harness.base}/artifact/${encodeURIComponent(magnet)}`);
    expect(quoteRes.status).toBe(402);
    const quoted = (await quoteRes.json()) as { accepts: unknown[] };
    harness.facilitator.txId = "0.0.2222@delist-inflight-1";

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

    const { ledger } = await import("./server.js");
    const purchase = ledger.purchaseByTxId(harness.facilitator.txId)!;
    expect(purchase).toBeDefined();
    const royaltyBefore = ledger.settlement.amountOf(purchase.authorRoyaltyPayoutId!);
    expect(royaltyBefore).toBeGreaterThan(0);

    const out = await postDelist(magnet, delistSig(author.privateKeyHex, magnet));
    expect(out.status).toBe(200);

    // The sale stands: the royalty row is untouched, unvoided, and still owed.
    const row = ledger.sqlite
      .prepare(`SELECT amount, voided_at, settled_batch_id FROM payout WHERE id = ?`)
      .get(purchase.authorRoyaltyPayoutId) as { amount: number; voided_at: number | null; settled_batch_id: number | null };
    expect(row.amount).toBe(royaltyBefore);
    expect(row.voided_at).toBeNull();
    expect(row.settled_batch_id).toBeNull();

    // And the buyer's window is still theirs — the author cannot cancel it by
    // withdrawing the listing.
    expect(ledger.refundPurchase(ledger.getPurchase(purchase.id)!)).toMatchObject({ ok: true });
    const refund = ledger.sqlite
      .prepare(`SELECT amount, payee FROM payout WHERE reason = 'refund' AND ref = ?`)
      .get(String(purchase.id)) as { amount: number; payee: string };
    expect(refund.amount).toBe(royaltyBefore);
    expect(refund.payee).toBe(purchase.buyer);
  });
});
