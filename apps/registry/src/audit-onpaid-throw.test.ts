/**
 * ADVERSARIAL MONEY-PATH AUDIT — what the buyer and the ledger are left holding
 * when `onPaid` throws.
 *
 * The audit (docs/AUDIT-MONEY.md H1) found: the buyer settles on chain, gets a
 * **200 and the full body**, and afterwards `GET /state` has no purchase row,
 * `GET /payouts` is empty, `POST /refund` returns 404, and the only record — an
 * `owed_failure` row — was exposed by **no HTTP route at all**. Recovery meant
 * opening `ledger.sqlite` by hand. `splitSale`'s own doc comment promised a 502
 * naming the txId; no such branch existed.
 *
 * This file is the fix's witness, end to end through the real app. The decision it
 * pins, which is not the doc comment's:
 *
 *  - The buyer's money moved on chain, so **refusing the body takes the payment
 *    and gives nothing back**. The body is served whenever the obligation is
 *    durable, because a durable obligation is recoverable.
 *  - `owed_failure` is no longer a dead letter. It is served by `GET /owed`,
 *    replayed by `POST /owed/replay` and by every epoch, and a replay turns the
 *    settled payment into the purchase row, the author's royalty and the buyer's
 *    refund path it should have been in the first place.
 *  - When **nothing** took the obligation, the answer is a 502 naming the txId:
 *    serving then would be the one irreversible outcome (goods gone, author
 *    unpaid, nothing anywhere to replay).
 *
 * Its own file because `loadConfig()` caches on first import and this needs a
 * `TRACKER_FEE_MICRO_USDC` of its own.
 *
 * ## The trigger
 *
 * The audit reached the throw with `TRACKER_FEE_MICRO_USDC=-1`, which `config.ts`
 * accepted and which makes `splitSale` throw on every sale. That is now a
 * start-up error (the first test), so the throw is injected where the audit said
 * the *likeliest* real trigger was instead: a failing write inside
 * `recordPurchase`. One `vi.spyOn` on the ledger the server actually uses; every
 * other part of the path — gate, facilitator, routes, SQLite — is real.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { sha256 } from "@carpool/hedera-x402";
import { magnetOf, normalizeQuestion, signManifest, type Manifest } from "@carpool/core";
import { setEmbedder } from "./embedder.js";
import { hashedEmbedder, TEST_EMBEDDING_DIM, TEST_EMBEDDING_MODEL } from "./testing/hashedEmbedder.js";
import type { RegistryLedger } from "./ledger.js";
import {
  defaultFacilitatorControls,
  listen,
  portOf as port,
  startStubFacilitator,
  startStubMirror,
  type StubFacilitatorControls,
} from "./testing/stubFacilitator.js";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

const author = { priv: PrivateKey.generateECDSA() };
const AUTHOR_ACCOUNT = "0.0.1111";
const AUTHOR = `${AUTHOR_ACCOUNT}:${author.priv.publicKey.toStringRaw()}`;
const BUYER_ACCOUNT = "0.0.2222";
let txSeq = 0;

let facilitator: Server;
let mirror: Server;
let dataDir: string;
let app: import("express").Express;
let ledger: RegistryLedger;
let KEY: string;
let facilitatorControls: StubFacilitatorControls;

/**
 * The transaction id the stub facilitator settles with, per test.
 *
 * Written through `setSettleTxId` so the value the stub serves and the value the
 * assertions use cannot drift apart.
 */
let settleTxId = "0.0.2222@777.888";
function setSettleTxId(v: string): string {
  settleTxId = v;
  facilitatorControls.txId = v;
  return v;
}

function signedManifest(question: string, body = "the body content") {
  const base: Omit<Manifest, "magnet"> = {
    question,
    questionNorm: normalizeQuestion(question),
    scope: "audit",
    abstract: "a",
    sources: [{ url: "https://example.test", fetchedAt: "2026-09-01T00:00:00Z" }],
    provenance: {
      model: "m",
      durationSeconds: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0.1,
      toolCalls: 1,
    },
    decay: { halfLifeDays: 3650, producedAt: new Date().toISOString() },
    author: AUTHOR,
    bodyHash: sha256(body),
    bodyBytes: Buffer.byteLength(body, "utf8"),
    redacted: false,
  };
  const magnet = magnetOf(base);
  return {
    manifest: { ...base, magnet },
    body,
    authorSig: signManifest(author.priv.toStringRaw(), magnet.slice("swarm:".length)),
  };
}

beforeAll(async () => {
  // The shared stub facilitator (testing/stubFacilitator.ts), not a fourth
  // hand-written copy. `requireSignedTransaction` is off because `publishAndPay`
  // below hand-rolls its PAYMENT-SIGNATURE header so each test can pick the
  // transaction id it then chases through /owed and /owed/replay — a payload the
  // real facilitator would refuse. `strictAccepted` stays on: the header echoes
  // the issued quote verbatim, as an honest client does.
  facilitatorControls = defaultFacilitatorControls();
  facilitatorControls.payer = BUYER_ACCOUNT;
  facilitatorControls.txId = settleTxId;
  facilitatorControls.requireSignedTransaction = false;
  const fac = await startStubFacilitator(facilitatorControls);
  facilitator = fac.server;

  // Knows no accounts: /refund's buyer-key lookup 404s, which is what this
  // file's refund assertions expect.
  const mir = await startStubMirror({});
  mirror = mir.server;

  dataDir = mkdtempSync(join(tmpdir(), "carpool-audit-onpaid-"));
  KEY = "b".repeat(32);
  process.env.LEDGER_DB = ":memory:";
  process.env.ARTIFACT_STORE = join(dataDir, "artifacts");
  process.env.CARPOOL_ACCOUNT_ID = "0.0.9999";
  process.env.CARPOOL_PRIVATE_KEY = "";
  process.env.HCS_TOPIC_ID = "";
  process.env.TRACKER_FEE_MICRO_USDC = "500";
  process.env.FACILITATOR_URL = `http://127.0.0.1:${port(facilitator)}`;
  process.env.MIRROR_NODE_URL = `http://127.0.0.1:${port(mirror)}`;
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.1";
  process.env.LEDGER_API_KEY = KEY;
  process.env.NODE_ENV = "test";
  process.env.EMBEDDING_MODEL = TEST_EMBEDDING_MODEL;
  process.env.EMBEDDING_DIM = String(TEST_EMBEDDING_DIM);
  setEmbedder(hashedEmbedder());
  ({ app, ledger } = await import("./server.js"));
});

afterAll(() => {
  facilitator.close();
  mirror.close();
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Publish, then pay through the real gate. Returns the paid response. */
async function publishAndPay(question: string) {
  const server = await listen(app);
  const base = `http://127.0.0.1:${port(server)}`;
  try {
    const { manifest, body, authorSig } = signedManifest(question);
    const pub = await fetch(`${base}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, body, authorSig, priceBase: 0, priceFloor: 10_000 }),
    });
    expect(pub.status, JSON.stringify(await pub.clone().json())).toBe(200);

    const unpaid = await fetch(`${base}/artifact/${manifest.magnet}`);
    expect(unpaid.status).toBe(402);
    const reqs = ((await unpaid.json()) as any).accepts[0];

    const paid = await fetch(`${base}/artifact/${manifest.magnet}`, {
      headers: {
        "PAYMENT-SIGNATURE": b64({
          x402Version: 2,
          scheme: "exact",
          network: "hedera:testnet",
          // The whole issued quote, verbatim. This used to send only
          // `{ amount, payTo }` — the two fields `PaymentGate` keys its replay
          // cache on — dropping scheme, network and asset. The real facilitator
          // compares all five to the requirements by strict equality and would
          // have refused it; the stub that let it through was not looking.
          accepted: reqs,
          payload: { signedTransaction: "deadbeef" },
        }),
      },
    });
    return { paid, magnet: manifest.magnet, body, base, server };
  } catch (e) {
    server.close();
    throw e;
  }
}

const authed = (path: string, init: RequestInit = {}, base: string) =>
  fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), "x-carpool-key": KEY } });

describe("a money constant that cannot be right is refused at start-up", () => {
  it("TRACKER_FEE_MICRO_USDC=-1 no longer loads", async () => {
    const { loadConfig, resetConfig } = await import("./config.js");
    const saved = process.env.TRACKER_FEE_MICRO_USDC;
    process.env.TRACKER_FEE_MICRO_USDC = "-1";
    resetConfig();
    try {
      // A negative fee makes `splitSale` throw on every single sale — i.e. every
      // purchase becomes a settled payment the registry cannot record. `int()`
      // truncated and range-checked nothing, so `-1` was simply accepted
      // (docs/AUDIT-MONEY.md L3). Refusing to start is the only safe answer.
      expect(() => loadConfig()).toThrow(/TRACKER_FEE_MICRO_USDC must be at least 0/);
      process.env.TRACKER_FEE_MICRO_USDC = "500";
      process.env.EPOCH_SECONDS = "0";
      resetConfig();
      expect(() => loadConfig(), "and a zero epoch spins setInterval").toThrow(
        /EPOCH_SECONDS must be at least 1/,
      );
    } finally {
      delete process.env.EPOCH_SECONDS;
      process.env.TRACKER_FEE_MICRO_USDC = saved;
      resetConfig();
      expect(loadConfig().trackerFee).toBe(500);
    }
  });
});

describe("onPaid throws (a concurrent writer makes recordPurchase fail)", () => {
  it("serves the body, defers the record, and exposes it on GET /owed", async () => {
    setSettleTxId(`0.0.2222@${++txSeq}.1`);
    const boom = "SQLITE_BUSY: database is locked";
    const spy = vi.spyOn(ledger, "recordPurchase").mockImplementationOnce(() => {
      throw new Error(boom);
    });

    const { paid, magnet, base, server } = await publishAndPay(`audit onpaid throw ${txSeq}`);
    try {
      expect(spy).toHaveBeenCalledTimes(1);

      // The buyer paid on chain. Refusing the body would take the money and give
      // nothing, so the body is served — and the deferral is stated, not hidden.
      expect(paid.status).toBe(200);
      expect(await paid.text()).toBe("the body content");
      expect(paid.headers.get("x-payment-record")).toBe("deferred");

      // THE FIX. `owed_failure` was written by owe() and read by nothing: no
      // route mentioned the txId, so recovery meant opening SQLite by hand.
      const owed = await (await authed("/owed", {}, base)).json() as any;
      expect(owed.summary).toMatchObject({ count: 1, microUsdc: 10_000 });
      expect(owed.owed[0]).toMatchObject({
        op: "onPaid",
        txId: settleTxId,
        payer: BUYER_ACCOUNT,
        paid: 10_000,
        resourceKey: magnet,
        // The real error, not a fixed sentence — it is what tells an operator
        // whether this is waiting on a retry or on a person.
        reason: boom,
        resolvedAt: null,
        purchaseId: null,
      });

      // …and it is gated, because an open incident is not public information.
      expect((await fetch(`${base}/owed`)).status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("POST /owed/replay turns it into the purchase, the royalty and a refund path", async () => {
    setSettleTxId(`0.0.2222@${++txSeq}.1`);
    vi.spyOn(ledger, "recordPurchase").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    const { paid, magnet, base, server } = await publishAndPay(`audit onpaid replay ${txSeq}`);
    try {
      expect(paid.status).toBe(200);
      vi.restoreAllMocks();

      // Before: the audit's three findings, still true at this instant.
      const before = (await (await fetch(`${base}/state`)).json()) as any;
      expect(before.purchases.some((p: any) => p.txId === settleTxId)).toBe(false);
      const refund404 = await fetch(`${base}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txId: settleTxId, magnet, signature: "00", buyerPublicKey: "00" }),
      });
      expect(refund404.status, "no purchase to refund yet").toBe(404);

      // The replay, which is what makes the record recoverable rather than lost.
      // (The previous test left its own unrecorded payment open in this same
      // in-memory database, so the count covers both — which is the point: the
      // replay is a queue drain, not a single-row operation.)
      const replay = (await (await authed("/owed/replay", { method: "POST" }, base)).json()) as any;
      expect(replay).toMatchObject({ failed: 0, unresolvable: 0, stillOpen: 0 });
      expect(replay.replayed).toBeGreaterThanOrEqual(1);

      // After: a real purchase, the author's royalty, the registry's fee.
      const after = (await (await fetch(`${base}/state`)).json()) as any;
      const purchase = after.purchases.find((p: any) => p.txId === settleTxId);
      expect(purchase, "the sale exists in the product now").toBeDefined();
      expect(purchase.paid).toBe(10_000);
      expect(purchase.buyer).toBe(BUYER_ACCOUNT);
      expect(purchase.refundState, "with a refund window, opened at replay time").toBe("window");

      const payouts = (await (await authed("/payouts", {}, base)).json()) as any;
      const royalty = payouts.payouts.find(
        (r: any) => r.reason === "author_royalty" && r.ref === String(purchase.id),
      );
      expect(royalty, "the author is owed for a sale that happened").toBeDefined();
      expect(royalty.amount).toBe(9_500);
      expect(royalty.payee).toBe(AUTHOR_ACCOUNT);
      const fee = payouts.payouts.find(
        (r: any) => r.reason === "tracker_fee" && r.ref === String(purchase.id),
      );
      expect(fee.amount).toBe(500);

      // And the buyer can reach /refund — it gets as far as checking their
      // signature (401) instead of denying the purchase exists (404).
      const refundNow = await fetch(`${base}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txId: settleTxId, magnet, signature: "00", buyerPublicKey: "00" }),
      });
      expect(refundNow.status).toBe(401);

      // The queue is closed, and says which purchase closed it.
      const owed = (await (await authed("/owed?open=0", {}, base)).json()) as any;
      const row = owed.owed.find((r: any) => r.txId === settleTxId);
      expect(row).toMatchObject({ purchaseId: purchase.id, lastError: null });
      expect(row.resolvedAt).toBeGreaterThan(0);

      // Replaying again is a no-op: recordPurchase is idempotent on txId, so this
      // can be run by every epoch and by an operator without paying twice.
      const again = (await (await authed("/owed/replay", { method: "POST" }, base)).json()) as any;
      expect(again).toMatchObject({ replayed: 0, failed: 0, unresolvable: 0 });
      const finalState = (await (await fetch(`${base}/state`)).json()) as any;
      expect(finalState.purchases.filter((p: any) => p.txId === settleTxId)).toHaveLength(1);
      const finalPayouts = (await (await authed("/payouts", {}, base)).json()) as any;
      expect(
        finalPayouts.payouts.filter((r: any) => r.ref === String(purchase.id)),
        "two rows for one sale, not four",
      ).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it("refuses to serve the body when NOTHING took the obligation", async () => {
    setSettleTxId(`0.0.2222@${++txSeq}.1`);
    vi.spyOn(ledger, "recordPurchase").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    // The durable record is the whole basis for serving the goods. Without it a
    // 200 would be irreversible: the buyer has the body, the author is unpaid,
    // and there is nothing anywhere to replay.
    vi.spyOn(ledger, "recordOwedFailure").mockReturnValue(false);

    const { paid, base, server } = await publishAndPay(`audit onpaid nothing ${txSeq}`);
    try {
      expect(paid.status).toBe(502);
      const body = (await paid.json()) as any;
      expect(body.error).toMatch(/NOTHING recorded it/);
      expect(body.txId, "and it names the transaction to take to the operator").toBe(settleTxId);
      expect(body.recorded).toBe(false);

      vi.restoreAllMocks();
      const owed = (await (await authed("/owed", {}, base)).json()) as any;
      expect(owed.owed.some((r: any) => r.txId === settleTxId), "nothing was queued").toBe(false);
    } finally {
      server.close();
    }
  });

  it("a replay that cannot work says why instead of retrying for ever", async () => {
    setSettleTxId(`0.0.2222@${++txSeq}.1`);
    vi.spyOn(ledger, "recordPurchase").mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    const { paid, magnet, base, server } = await publishAndPay(`audit onpaid unresolvable ${txSeq}`);
    try {
      expect(paid.status).toBe(200);
      vi.restoreAllMocks();

      // The author withdraws the artifact *and* it is removed from the table
      // entirely: there is then no author to pay, which no retry can fix.
      ledger.sqlite.prepare(`DELETE FROM artifact WHERE magnet = ?`).run(magnet);

      const replay = (await (await authed("/owed/replay", { method: "POST" }, base)).json()) as any;
      expect(replay).toMatchObject({ replayed: 0, failed: 0, unresolvable: 1 });

      const owed = (await (await authed("/owed", {}, base)).json()) as any;
      const row = owed.owed.find((r: any) => r.txId === settleTxId);
      expect(row.lastError).toMatch(/no longer exists, so there is no author to pay/);
      expect(row.replayAttempts).toBe(1);
      expect(row.resolvedAt, "still open, and still visible").toBeNull();
      expect(owed.summary.needsOperator).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
    }
  });

  it("a settlement with no transaction id is deferred rather than recorded three times", async () => {
    setSettleTxId("");
    const spy = vi.spyOn(ledger, "recordPurchase");
    const { paid, base, server } = await publishAndPay(`audit onpaid no txid ${++txSeq}`);
    try {
      // `txId` is the key onPaid de-duplicates on, /refund is found by, and the
      // unique index covers. The gate does not even attempt onPaid without one.
      expect(spy).not.toHaveBeenCalled();
      expect(paid.status, "the buyer's money still moved, so they get the body").toBe(200);
      expect(paid.headers.get("x-payment-record")).toBe("deferred");

      const owed = (await (await authed("/owed", {}, base)).json()) as any;
      const row = owed.owed.find((r: any) => r.op === "settle-no-tx-id");
      expect(row).toMatchObject({ txId: "", paid: 10_000, payer: BUYER_ACCOUNT });
      expect(row.reason).toMatch(/no transaction id/);

      // And a replay will not invent one: this is a row that needs a person.
      const replay = (await (await authed("/owed/replay", { method: "POST" }, base)).json()) as any;
      expect(replay.unresolvable).toBeGreaterThanOrEqual(1);
      const after = (await (await authed("/owed", {}, base)).json()) as any;
      expect(after.owed.find((r: any) => r.op === "settle-no-tx-id").lastError).toMatch(
        /no transaction id/,
      );
    } finally {
      setSettleTxId("0.0.2222@777.888");
      server.close();
    }
  });
});
