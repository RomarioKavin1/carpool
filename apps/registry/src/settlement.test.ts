import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { magnetOf, type Manifest } from "@carpool/core";
import { merkleRoot, payeeLeaves } from "@carpool/hedera-x402";

/**
 * Task E: the settle loop actually moves money and writes to HCS, so its
 * tests must not touch a network. Every Hedera transaction class the
 * settler/anchor construct is faked here — `execute` just records what it
 * was asked to submit and returns a canned receipt. `Client.forTestnet` and
 * `PrivateKey.fromStringECDSA` are faked too, so `server.ts`'s own
 * `makeClient()` produces one of these fakes instead of a real operator
 * client, with no change to `server.ts` itself.
 *
 * ## What the fake refuses, and why it has to
 *
 * `execute` used to accept **any** transfer list and report SUCCESS. A real
 * `TransferTransaction` does not: HTS rejects a token transfer list whose amounts
 * do not sum to zero (`INVALID_ACCOUNT_AMOUNTS`) and one with more than 10
 * transfer entries (`TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED`). Both are
 * consensus-level refusals, so a batch that broke either would be recorded here
 * as paid while nothing moved on chain — the exact failure mode the whole
 * `classifyLedgerResult` / `reconcile` machinery exists to survive, arriving in
 * the one place where no test could see it.
 *
 * Neither invariant was checked. `settleChunk` nets self-payouts out of the
 * transfer list (`toMove`) and debits the payer `-moved`, deliberately not
 * `-total`; getting that wrong produces a list that does not balance, which the
 * fake happily "settled". The real testnet run
 * (`docs/evidence/v2-first-testnet-run/10-mirror-settlement-tx.json`) is the
 * shape being asserted: `+109,500` to the author against `-109,500` from the
 * registry, two entries, netting to zero, with the registry's own 500 µUSDC fee
 * discharged without appearing in the transfer at all.
 *
 * `assertSubmittable` below therefore fails the test rather than recording an
 * impossible transfer. It is not a Hedera simulator: everything else about the
 * transaction (signatures, fees, account existence, balances) is still unchecked
 * here and proven only by that live run.
 */
const HTS_MAX_TRANSFER_ENTRIES = 10;

function assertSubmittable(xfers: [string, string, number][]): void {
  const byToken = new Map<string, number>();
  for (const [token, , amt] of xfers) byToken.set(token, (byToken.get(token) ?? 0) + amt);
  for (const [token, net] of byToken) {
    if (net !== 0) {
      throw new Error(
        `TransferTransaction would be refused as INVALID_ACCOUNT_AMOUNTS: token ${token} nets ${net}, ` +
          `not 0 — ${JSON.stringify(xfers)}`,
      );
    }
  }
  if (xfers.length > HTS_MAX_TRANSFER_ENTRIES) {
    throw new Error(
      `TransferTransaction would be refused as TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED: ` +
        `${xfers.length} entries, limit ${HTS_MAX_TRANSFER_ENTRIES} (MAX_PAYEES + the payer debit)`,
    );
  }
}
const fakeState: {
  transfers: { memo: string; xfers: [string, string, number][]; txId: string }[];
  topicMessages: { topicId: string; message: string }[];
} = { transfers: [], topicMessages: [] };
let txCounter = 0;

vi.mock("@hiero-ledger/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hiero-ledger/sdk")>();

  class FakeClient {
    static forTestnet() {
      return new FakeClient();
    }
    setOperator() {
      return this;
    }
  }

  class FakeTransferTransaction {
    private memo = "";
    private xfers: [string, string, number][] = [];
    setTransactionMemo(m: string) {
      this.memo = m;
      return this;
    }
    addTokenTransfer(token: string, acct: string, amt: number) {
      this.xfers.push([token, acct, amt]);
      return this;
    }
    async execute(_client: unknown) {
      assertSubmittable(this.xfers);
      const txId = `0.0.9@${++txCounter}.0`;
      fakeState.transfers.push({ memo: this.memo, xfers: this.xfers, txId });
      return {
        transactionId: { toString: () => txId },
        getReceipt: async () => ({ status: { toString: () => "SUCCESS" } }),
      };
    }
  }

  class FakeTopicMessageSubmitTransaction {
    private topicId = "";
    private message = "";
    setTopicId(t: string) {
      this.topicId = t;
      return this;
    }
    setMessage(m: string) {
      this.message = m;
      return this;
    }
    async execute(_client: unknown) {
      fakeState.topicMessages.push({ topicId: this.topicId, message: this.message });
      return { getReceipt: async () => ({}) };
    }
  }

  return {
    ...actual,
    Client: FakeClient,
    PrivateKey: { ...actual.PrivateKey, fromStringECDSA: () => ({}) },
    TransferTransaction: FakeTransferTransaction,
    TopicMessageSubmitTransaction: FakeTopicMessageSubmitTransaction,
  };
});

const listen = (a: express.Express): Promise<Server> =>
  new Promise((r) => {
    const s = a.listen(0, () => r(s));
  });
const port = (s: Server) => (s.address() as AddressInfo).port;

const AUTHOR_ACCOUNT = "0.0.1111";
const AUTHOR_PUBKEY = "aa".repeat(33); // shape only — never verified: ledger.publish() is called directly

function manifestFixture(overrides: Partial<Manifest> = {}, seed = "the body content"): Manifest {
  const base: Omit<Manifest, "magnet"> = {
    question: `What is the ETHOnline 2026 prize pool? (${seed})`,
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
    decay: { halfLifeDays: 30, producedAt: new Date().toISOString() },
    author: `${AUTHOR_ACCOUNT}:${AUTHOR_PUBKEY}`,
    bodyHash: "b".repeat(64),
    bodyBytes: 2048,
    redacted: false,
    ...overrides,
  };
  return { ...base, magnet: magnetOf(base) };
}

let dataDir: string;
let app: express.Express;
let ledger: import("./ledger.js").RegistryLedger;
let epoch: import("./settlement.js").EpochRunner;
let LEDGER_API_KEY: string;

async function postSettle(): Promise<{ status: number; body: any }> {
  const server = await listen(app);
  const base = `http://127.0.0.1:${port(server)}`;
  const res = await fetch(`${base}/settle`, { method: "POST", headers: { "x-carpool-key": LEDGER_API_KEY } });
  const body = await res.json();
  server.close();
  return { status: res.status, body };
}

// vitest can run multiple test files inside the same worker process, and
// process.env is real process state — not isolated per file. Every key this
// file sets is saved here and restored in afterAll so a leaked
// CARPOOL_PRIVATE_KEY (in particular) can't flip server.test.ts's "no creds"
// assumptions depending on file scheduling order.
const ENV_KEYS = [
  "LEDGER_DB",
  "ARTIFACT_STORE",
  "CARPOOL_ACCOUNT_ID",
  "CARPOOL_PRIVATE_KEY",
  "TRACKER_FEE_MICRO_USDC",
  "FACILITATOR_URL",
  "MIRROR_NODE_URL",
  "HEDERA_NETWORK",
  "USDC_TOKEN_ID",
  "HCS_TOPIC_ID",
  "LEDGER_API_KEY",
  "NODE_ENV",
  "EPOCH_SECONDS",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  dataDir = mkdtempSync(join(tmpdir(), "carpool-registry-settle-"));
  LEDGER_API_KEY = "a".repeat(32);
  process.env.LEDGER_DB = ":memory:";
  process.env.ARTIFACT_STORE = join(dataDir, "artifacts");
  process.env.CARPOOL_ACCOUNT_ID = "0.0.9";
  // Never used for real crypto — Client/PrivateKey are mocked above — but
  // must be present so makeClient() doesn't treat creds as missing.
  process.env.CARPOOL_PRIVATE_KEY = "fake";
  process.env.TRACKER_FEE_MICRO_USDC = "500";
  // Unused in this file: no /artifact purchase flow and a fresh in-memory DB
  // has no pending batches at boot, so reconcile() never actually fetches.
  process.env.FACILITATOR_URL = "http://127.0.0.1:1";
  process.env.MIRROR_NODE_URL = "http://127.0.0.1:1";
  process.env.HEDERA_NETWORK = "hedera:testnet";
  process.env.USDC_TOKEN_ID = "0.0.1";
  process.env.HCS_TOPIC_ID = "0.0.777";
  process.env.LEDGER_API_KEY = LEDGER_API_KEY;
  process.env.NODE_ENV = "test";
  process.env.EPOCH_SECONDS = "600";

  const mod = await import("./server.js");
  app = mod.app;
  ledger = mod.ledger;
  // The registry only builds an EpochRunner when it has credentials; this
  // file sets a (mocked) CARPOOL_PRIVATE_KEY precisely so it does.
  epoch = mod.epoch!;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("POST /settle — the epoch loop", () => {
  it("an empty epoch anchors nothing", async () => {
    const { status, body } = await postSettle();
    expect(status).toBe(200);
    expect(body.batches).toEqual([]);
    expect(body.anchor).toEqual({ anchored: false, skipped: "empty" });
    expect(fakeState.topicMessages).toHaveLength(0);
  });

  it("a non-empty epoch anchors once, with a root covering that epoch's leaves", async () => {
    const manifest = manifestFixture({}, "artifact-for-anchor-test");
    const manifestHash = manifest.magnet.slice("swarm:".length);
    ledger.publish(manifest, {
      authorSig: "sig",
      manifestHash,
      priceBase: 100_000,
      priceFloor: 10_000,
      bodyUri: "file:///x",
    });
    expect(ledger.unanchoredManifests().map((a) => a.magnet)).toContain(manifest.magnet);

    const { status, body } = await postSettle();
    expect(status).toBe(200);
    expect(body.batches).toEqual([]); // no payouts accrued — this epoch is provenance-only
    expect(body.anchor.anchored).toBe(true);
    expect(body.anchor.root).toBe(merkleRoot([manifestHash]));
    expect(fakeState.topicMessages).toHaveLength(1);
    expect(fakeState.topicMessages[0]!.topicId).toBe("0.0.777");

    const submitted = JSON.parse(fakeState.topicMessages[0]!.message);
    expect(submitted.merkleRoot).toBe(merkleRoot([manifestHash]));
    expect(submitted.leafCount).toBe(1);

    // Marked anchored — a second run has nothing left to say about it.
    expect(ledger.unanchoredManifests().map((a) => a.magnet)).not.toContain(manifest.magnet);
    const again = await postSettle();
    expect(again.body.anchor).toEqual({ anchored: false, skipped: "empty" });
    expect(fakeState.topicMessages).toHaveLength(1); // no second anchor for an unchanged epoch
  });

  it("two concurrent POST /settle calls produce one batch", async () => {
    const before = fakeState.transfers.length;
    ledger.settlement.accrue({ payee: "0.0.501", amount: 5_000, reason: "tracker_fee" });
    ledger.settlement.accrue({ payee: "0.0.502", amount: 7_000, reason: "tracker_fee" });
    expect(ledger.settlement.unsettled()).toHaveLength(2);

    const [a, b] = await Promise.all([postSettle(), postSettle()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // Only one real transfer was submitted, however many HTTP calls raced —
    // Settler's concurrency guard is per-instance and server.ts constructs
    // exactly one, shared by every caller.
    expect(fakeState.transfers.length - before).toBe(1);
    expect(ledger.settlement.unsettled()).toHaveLength(0);

    const transfer = fakeState.transfers[fakeState.transfers.length - 1]!;
    const payees = transfer.xfers.filter(([, acct]) => acct !== "0.0.9").map(([, acct]) => acct);
    expect(new Set(payees)).toEqual(new Set(["0.0.501", "0.0.502"]));
  });

  /**
   * The real testnet run's batch, reproduced offline.
   *
   * `docs/evidence/v2-first-testnet-run/`: one sale split into an author royalty
   * (`0.0.10475801`, 109,500) and the registry's own tracker fee (`0.0.10475802`,
   * 500) — and the registry *is* the batch payer, so its fee is netted out and the
   * submitted transfer is two entries, `+109,500 / -109,500`, balancing to zero
   * (`10-mirror-settlement-tx.json`). Both payouts still end up settled against
   * the batch.
   *
   * This is the case where `total` (110,000, the discharged obligation) and
   * `moved` (109,500, what the transfer carries) differ, and therefore the case
   * that decides whether the transfer HTS receives balances at all. Every
   * pre-existing test in this file batches payees that are none of them the payer,
   * so `total === moved` throughout and the distinction was never exercised.
   */
  it("nets the registry's own fee out and submits a transfer that balances, as the live run did", async () => {
    const AUTHOR_PAYEE = "0.0.10475801";
    const before = fakeState.transfers.length;
    const royalty = ledger.settlement.accrue({
      payee: AUTHOR_PAYEE,
      amount: 109_500,
      reason: "author_royalty",
    });
    // Payee === payer: server.ts's CARPOOL_ACCOUNT_ID in this file is 0.0.9.
    const fee = ledger.settlement.accrue({ payee: "0.0.9", amount: 500, reason: "tracker_fee" });

    const { status, body } = await postSettle();
    expect(status).toBe(200);
    expect(body.batches).toHaveLength(1);
    // The obligation discharged, and the subset of it that actually moved.
    expect(body.batches[0].total).toBe(110_000);
    expect(body.batches[0].moved).toBe(109_500);
    expect(body.batches[0].payees).toBe(2);

    expect(fakeState.transfers.length - before).toBe(1);
    const transfer = fakeState.transfers[fakeState.transfers.length - 1]!;
    // Two entries: the author credited and the payer debited. Not three — a
    // self-transfer entry pair would cost a fee to move nothing and would leave
    // the ledger naming a transaction whose transfer list has no such movement.
    expect(transfer.xfers).toHaveLength(2);
    expect(transfer.xfers.reduce((s, [, , amt]) => s + amt, 0), "the list must balance").toBe(0);
    expect(transfer.xfers.find(([, acct]) => acct === AUTHOR_PAYEE)?.[2]).toBe(109_500);
    expect(transfer.xfers.find(([, acct]) => acct === "0.0.9")?.[2]).toBe(-109_500);

    // …and the fee row is settled all the same, without a transfer of its own.
    for (const id of [royalty, fee]) {
      const row = ledger.sqlite
        .prepare("SELECT settled_batch_id FROM payout WHERE id = ?")
        .get(id) as { settled_batch_id: number | null };
      expect(row.settled_batch_id, `payout ${id} settled`).toBe(body.batches[0].id);
    }
  });

  it("a royalty inside its refund window is not paid", async () => {
    const farFuture = Math.floor(Date.now() / 1000) + 10_000;
    const id = ledger.settlement.accrue({
      payee: "0.0.999",
      amount: 8_500,
      reason: "author_royalty",
      availableAt: farFuture,
    });

    const { body } = await postSettle();
    expect(body.batches).toEqual([]);
    expect(fakeState.transfers.some((t) => t.xfers.some(([, acct]) => acct === "0.0.999"))).toBe(false);

    const row = ledger.sqlite.prepare("SELECT settled_batch_id FROM payout WHERE id = ?").get(id) as {
      settled_batch_id: number | null;
    };
    expect(row.settled_batch_id).toBeNull();
  });
});

/**
 * I2 — the epoch loop is single-flight.
 *
 * `Settler.settle()` de-duplicates concurrent callers by handing both the *same*
 * `batches` array, which is right for the transfer and wrong for the anchor:
 * both callers then read the same `unanchoredManifests()` (nothing is marked
 * until `anchorEpoch` resolves), built the same leaves, and each submitted its
 * own HCS message. Two consensus messages, two real fees, for one epoch — a
 * timer tick landing on a dashboard click.
 *
 * Driven through the exported `EpochRunner` rather than two `POST /settle`s: the
 * race is a property of that one shared object, and two HTTP round trips do not
 * reliably overlap (the existing "two concurrent POST /settle calls" test above
 * passes even with the bug present, because in practice the first request
 * finishes before the second arrives — which is exactly why this defect survived
 * a suite that appeared to cover it).
 */
describe("EpochRunner — settle and anchor are single-flight together", () => {
  it("two callers racing one epoch produce one anchor, not two", async () => {
    const manifest = manifestFixture({}, "artifact-for-double-anchor-test");
    const manifestHash = manifest.magnet.slice("swarm:".length);
    ledger.publish(manifest, {
      authorSig: "sig",
      manifestHash,
      priceBase: 100_000,
      priceFloor: 10_000,
      bodyUri: "file:///x",
    });
    ledger.settlement.accrue({ payee: "0.0.601", amount: 6_000, reason: "tracker_fee" });

    const topicsBefore = fakeState.topicMessages.length;
    const transfersBefore = fakeState.transfers.length;

    const [a, b] = await Promise.all([epoch.run(), epoch.run()]);

    expect(fakeState.transfers.length - transfersBefore).toBe(1);
    expect(fakeState.topicMessages.length - topicsBefore).toBe(1);

    // One run, so both callers see the same result — not one real anchor and
    // one phantom "skipped: empty" for an epoch that did anchor.
    expect(a).toBe(b);
    expect(a.anchor.anchored).toBe(true);
    expect(a.anchor.root).toBe(merkleRoot([manifestHash, ...payeeLeaves(a.batches.flatMap((x) => x.leaves))]));
    expect(ledger.unanchoredManifests().map((x) => x.magnet)).not.toContain(manifest.magnet);
  });

  it("still skips an epoch in which nothing was published and nothing settled", async () => {
    const topicsBefore = fakeState.topicMessages.length;
    const result = await epoch.run();
    expect(result.batches).toEqual([]);
    expect(result.anchor).toEqual({ anchored: false, skipped: "empty" });
    expect(fakeState.topicMessages.length - topicsBefore).toBe(0);
  });

  it("releases the guard, so a later epoch is a fresh run rather than a replayed result", async () => {
    const first = await epoch.run();
    const manifest = manifestFixture({}, "artifact-after-the-guard-cleared");
    ledger.publish(manifest, {
      authorSig: "sig",
      manifestHash: manifest.magnet.slice("swarm:".length),
      priceBase: 100_000,
      priceFloor: 10_000,
      bodyUri: "file:///x",
    });
    const second = await epoch.run();
    expect(second).not.toBe(first);
    expect(second.anchor.anchored).toBe(true);
  });
});

/**
 * H2/M5 — the operator surface.
 *
 * An unclassifiable transfer result and a permanently-failing payout are both
 * states the rail can reach and neither could be acted on: the batch sat
 * `pending` behind a `console.error`, the payout was re-submitted every epoch for
 * ever, and no route reported either. These are the routes that close that, over
 * HTTP, with the operator secret, against the real app.
 */
describe("operator routes for money that needs a human", () => {
  const req = async (path: string, init: RequestInit = {}) => {
    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-carpool-key": LEDGER_API_KEY,
          ...(init.headers ?? {}),
        },
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    } finally {
      server.close();
    }
  };

  /** A batch whose transfer came back with a result the rail cannot classify. */
  function strandedBatch(payee: string, amount: number) {
    const payoutId = ledger.settlement.accrue({ payee, amount, reason: "author_royalty" });
    const batch = ledger.settlement.claimBatch("root", [payoutId]);
    ledger.settlement.markNeedsOperator(batch.id, "0.0.9@stranded.1", "SOME_FUTURE_STATUS", "test");
    return { payoutId, batchId: batch.id };
  }

  it("GET /batches names the batches waiting on a decision", async () => {
    const { batchId } = strandedBatch("0.0.701", 7_000);
    const { status, body } = await req("/batches");
    expect(status).toBe(200);
    expect(body.needsOperator, "pulled out, not left for a client to string-match").toContain(
      batchId,
    );
    const row = body.batches.find((b: any) => b.id === batchId);
    expect(row.status).toBe("NEEDS_OPERATOR:SOME_FUTURE_STATUS");
    expect(row.txId, "the id an operator looks up on a mirror node").toBe("0.0.9@stranded.1");
  });

  it("POST /batches/:id/resolve release hands the payouts back", async () => {
    const { batchId, payoutId } = strandedBatch("0.0.702", 7_000);
    expect(ledger.settlement.unsettled().some((r) => r.id === payoutId)).toBe(false);

    const { status, body } = await req(`/batches/${batchId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action: "release" }),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "release", released: [payoutId] });
    expect(body.note, "and it says what the operator has just taken responsibility for").toMatch(
      /paid twice/,
    );
    expect(ledger.settlement.unsettled().some((r) => r.id === payoutId)).toBe(true);

    // Not twice, and not against a batch that is not waiting on anybody.
    expect((await req(`/batches/${batchId}/resolve`, { method: "POST", body: JSON.stringify({ action: "release" }) })).status).toBe(409);
  });

  it("POST /batches/:id/resolve paid records the transfer, and demands its id", async () => {
    const { batchId, payoutId } = strandedBatch("0.0.703", 7_000);
    const missing = await req(`/batches/${batchId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action: "paid" }),
    });
    expect(missing.status, "no fabricated transaction ids").toBe(400);

    const { status, body } = await req(`/batches/${batchId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action: "paid", txId: "0.0.9@operator.1" }),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "paid", txId: "0.0.9@operator.1" });
    expect(ledger.batches().find((b) => b.id === batchId)).toMatchObject({
      status: "SETTLED_BY_OPERATOR",
      txId: "0.0.9@operator.1",
    });
    expect(
      ledger.settlement.unsettled().some((r) => r.id === payoutId),
      "a paid row is not handed back",
    ).toBe(false);
  });

  it("POST /batches/:id/resolve recheck puts it back in front of reconcile", async () => {
    const { batchId } = strandedBatch("0.0.704", 7_000);
    const { status, body } = await req(`/batches/${batchId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action: "recheck" }),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: "recheck" });
    expect(ledger.batches().find((b) => b.id === batchId)).toMatchObject({
      status: "pending",
      txId: null,
      reconcileAttempts: 0,
    });
  });

  it("rejects an unknown action, a bad id, and an unauthenticated caller", async () => {
    const { batchId } = strandedBatch("0.0.705", 7_000);
    expect((await req(`/batches/${batchId}/resolve`, { method: "POST", body: JSON.stringify({ action: "obliterate" }) })).status).toBe(400);
    expect((await req(`/batches/nope/resolve`, { method: "POST", body: JSON.stringify({ action: "recheck" }) })).status).toBe(400);

    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    try {
      const res = await fetch(`${base}/batches/${batchId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      });
      expect(res.status, "releasing money is an operator action").toBe(401);
    } finally {
      server.close();
    }
  });

  it("POST /payouts/:id/unpark returns a parked payout to the queue", async () => {
    // A payee whose transfer fails for a cause that will never clear on its own.
    // maxAttempts defaults to 5, so five failed batches park it.
    const payoutId = ledger.settlement.accrue({
      payee: "0.0.706",
      amount: 7_000,
      reason: "author_royalty",
    });
    for (let i = 0; i < 5; i++) {
      const b = ledger.settlement.claimBatch("root", [payoutId]);
      ledger.settlement.markFailed(b.id, `0.0.9@park.${i}`, "NO_REMAINING_AUTOMATIC_ASSOCIATIONS");
    }
    expect(ledger.settlement.parked().map((r) => r.id)).toContain(payoutId);
    expect(ledger.settlement.unsettled().some((r) => r.id === payoutId)).toBe(false);

    // And it is visible as such, rather than looking claimable for ever: listed
    // under `parked`, with the attempt count, and NOT reported as a row the next
    // epoch is going to pay.
    const view = await req(`/payouts?payee=0.0.706`);
    expect(view.body.parked.map((p: any) => p.id)).toEqual([payoutId]);
    expect(view.body.payouts[0]).toMatchObject({ attempts: 5, amount: 7_000, state: "held" });
    expect(view.body.payouts[0].parkedAt).toBeGreaterThan(0);

    const { status, body } = await req(`/payouts/${payoutId}/unpark`, { method: "POST" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, payoutId });
    expect(ledger.settlement.unsettled().some((r) => r.id === payoutId)).toBe(true);
    expect((await req(`/payouts/${payoutId}/unpark`, { method: "POST" })).status, "not twice").toBe(
      409,
    );
  });
});

describe("GET /owed also surfaces a refused conditional write (M6)", () => {
  it("shows the transaction markSettled would have had to discard", async () => {
    const payoutId = ledger.settlement.accrue({
      payee: "0.0.707",
      amount: 7_000,
      reason: "author_royalty",
    });
    const b1 = ledger.settlement.claimBatch("rootone", [payoutId]);
    // Released, then re-claimed and paid by a second batch — the H4 interleaving.
    expect(ledger.settlement.markFailed(b1.id, "0.0.9@one.1", "INSUFFICIENT_TOKEN_BALANCE")).toEqual(
      [payoutId],
    );
    const b2 = ledger.settlement.claimBatch("roottwo", [payoutId]);
    expect(ledger.settlement.markSettled(b2.id, "0.0.9@two.2", "SUCCESS")).toBe(true);

    // A reconcile pass that snapshotted `pending()` before the release now finds a
    // SUCCESS record for b1's memo. It must not overwrite the failure — that is
    // the only in-database evidence the rows were handed on — and it must not
    // throw the observed transaction away either.
    expect(ledger.settlement.markSettled(b1.id, "0.0.9@three.3", "SUCCESS")).toBe(false);
    expect(ledger.batches().find((b) => b.id === b1.id)!.status).toBe(
      "FAILED:INSUFFICIENT_TOKEN_BALANCE",
    );

    const server = await listen(app);
    const base = `http://127.0.0.1:${port(server)}`;
    try {
      const res = await fetch(`${base}/owed`, { headers: { "x-carpool-key": LEDGER_API_KEY } });
      const body = (await res.json()) as any;
      expect(body.summary.batchConflicts).toBeGreaterThanOrEqual(1);
      expect(body.conflicts[0]).toMatchObject({
        batch_id: b1.id,
        observed_tx_id: "0.0.9@three.3",
        observed_status: "SUCCESS",
        had_status: "FAILED:INSUFFICIENT_TOKEN_BALANCE",
        had_tx_id: "0.0.9@one.1",
      });
    } finally {
      server.close();
    }
  });
});
