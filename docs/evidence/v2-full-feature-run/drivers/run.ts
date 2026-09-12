/**
 * TEMPORARY driver for the v2 full-feature testnet run. One subcommand per
 * feature under test; every subcommand writes its raw evidence into $OUT_DIR.
 *
 * Usage: OUT_DIR=... npx tsx live/run.ts <subcommand>
 */
import {
  accounts,
  api,
  balances,
  buy,
  note,
  publish,
  quote,
  refund,
  save,
  settle,
  sleep,
  snapshot,
  topicMessages,
  tx,
  usdcBalance,
} from "./lib.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT_DIR!;
const STATE = join(OUT, "_driver-state.json");
const st: Record<string, any> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const put = (k: string, v: unknown) => {
  st[k] = v;
  writeFileSync(STATE, JSON.stringify(st, null, 2));
};

const REGISTRY = "0.0.10475802";
const cmd = process.argv[2];

// ---------------------------------------------------------------------- smoke

async function smoke() {
  const a = await publish("author13", 13, "how a scratch ledger keeps a live run out of production state");
  put("smoke", { magnet: a.magnet, author: a.author.id });
  save("00-smoke-publish.json", { magnet: a.magnet, author: a.author.id, bodyHash: a.bodyHash });
  const m = await api(`/manifest/${encodeURIComponent(a.magnet)}`);
  save("00-smoke-manifest.json", m.body);
  const q = await quote(a.magnet);
  save("00-smoke-402.json", q);
  const before = await balances([accounts.buyer!.id, REGISTRY]);
  const bought = await buy(a.magnet, a.bodyHash);
  if (!bought.ok) throw new Error(`smoke buy failed: ${bought.error}`);
  put("smokeTx", bought.txId);
  await sleep(4000);
  const after = balances([accounts.buyer!.id, REGISTRY]);
  save("00-smoke-buy.json", {
    ok: bought.ok,
    paid: bought.paid,
    txId: bought.txId,
    verification: bought.verification,
    bodyBytes: bought.bodyBytes,
    latencyMs: Math.round(bought.latencyMs),
    balancesBefore: before,
    balancesAfter: await after,
    mirror: await tx(bought.txId),
  });
}

// ------------------------------------------------------- chunk boundary (>9)

/**
 * 12 distinct authors, one sale each, settled in ONE epoch: 13 distinct payees
 * (the 12 authors plus the registry's own tracker_fee rows), which is more than
 * MAX_PAYEES = 9, so `groupAndChunk` must produce two chunks and both must
 * settle. No live batch had ever paid more than one payee.
 */
async function chunksPublish() {
  const pubs: any[] = [];
  for (let i = 0; i < 12; i++) {
    const p = await publish(`author${i}`, i, `chunk-boundary payee ${i}: batching a Hedera token transfer list`);
    pubs.push({ i, magnet: p.magnet, author: p.author.id, bodyHash: p.bodyHash });
  }
  put("chunkPubs", pubs);
  save("10-chunk-publishes.json", pubs);
}

async function chunksBuy() {
  const pubs = st.chunkPubs as any[];
  const before = await balances([accounts.buyer!.id, REGISTRY, ...pubs.map((p) => p.author)]);
  const buys: any[] = [];
  for (const p of pubs) {
    const b = await buy(p.magnet, p.bodyHash);
    if (!b.ok) throw new Error(`chunk buy ${p.i} failed: ${b.error}`);
    buys.push({ i: p.i, magnet: p.magnet, author: p.author, paid: b.paid, txId: b.txId, verification: b.verification.state });
  }
  put("chunkBuys", buys);
  put("chunkBalancesBefore", before);
  save("11-chunk-purchases.json", { balancesBefore: before, buys });
  // The royalties are all `held` at this instant (inside their refund windows)
  // and the tracker fees `claimable` — the four-state proof for GET /payouts.
  save("12-payouts-during-window.json", (await api("/payouts", { operator: true })).body);
}

async function chunksSettle() {
  const pubs = st.chunkPubs as any[];
  const before = await balances([REGISTRY, ...pubs.map((p) => p.author)]);
  const res = await settle("two chunks, 13 payees");
  save("13-settle-two-chunks.json", { balancesBefore: before, response: res.body });
  await sleep(6000);
  const after = await balances([REGISTRY, ...pubs.map((p) => p.author)]);
  const batches = (await api("/batches")).body;
  const payouts = (await api("/payouts", { operator: true })).body;
  const txs: Record<string, any> = {};
  for (const b of batches.batches) if (b.txId) txs[b.txId] = await tx(b.txId);
  save("14-chunk-settlement-mirror.json", { balancesAfter: after, batches, txs });
  save("15-chunk-payouts-after.json", payouts);
  put("chunkBalancesAfter", after);
}

// ------------------------------------------------------------------- refunds

/** A real purchase, a real refund inside the window, and the money back on chain. */
async function refundPublish() {
  const p = await publish("author12", 12, "refunding an x402 purchase inside its window");
  put("refundArtifact", { magnet: p.magnet, author: p.author.id, bodyHash: p.bodyHash });
  save("20-refund-publish.json", { magnet: p.magnet, author: p.author.id });
}

async function refundInWindow() {
  const a = st.refundArtifact;
  const before = await balances([accounts.buyer!.id, REGISTRY, a.author]);
  const b = await buy(a.magnet, a.bodyHash);
  if (!b.ok) throw new Error(`refund-case buy failed: ${b.error}`);
  put("refundTx", b.txId);
  put("refundPaid", b.paid);
  put("refundBalancesBefore", before);
  const payoutsBefore = (await api("/payouts", { operator: true })).body;
  put("refundPayoutsBefore", payoutsBefore);
  const r = await refund(b.txId, a.magnet);
  put("refundResponse", { status: r.status, body: r.body });
  await refundRecord();
}

/** Writes the refund evidence from the ledger's current state plus the mirror node. */
async function refundRecord() {
  const a = st.refundArtifact;
  const purchase = (await api("/state")).body.purchases.find((p: any) => p.txId === st.refundTx);
  const payoutsAfter = (await api("/payouts", { operator: true })).body;
  save("21-refund-in-window.json", {
    purchase: { txId: st.refundTx, paid: st.refundPaid, magnet: a.magnet, royaltyPayee: a.author },
    balancesBeforePurchase: st.refundBalancesBefore,
    purchaseMirror: await tx(st.refundTx),
    payoutsBeforeRefund: st.refundPayoutsBefore,
    refundResponse: st.refundResponse,
    payoutsAfterRefund: payoutsAfter,
    statePurchaseAfterRefund: purchase,
    /** The refund is refused a second time: the purchase is already reversed. */
    refundAgain: await refund(st.refundTx, a.magnet).then((x) => ({ status: x.status, body: x.body })),
    events: (await api("/events?since=0")).body,
  });
}

/**
 * A second purchase of the same artifact whose window is allowed to close, so
 * `POST /refund` must refuse it afterwards.
 */
async function refundSecondBuy() {
  const a = st.refundArtifact;
  const b2 = await buy(a.magnet, a.bodyHash);
  if (!b2.ok) throw new Error(`second buy failed: ${b2.error}`);
  put("refundLateTx", b2.txId);
  put("refundLateAt", Date.now());
  save("22-second-purchase-for-late-refund.json", {
    txId: b2.txId,
    paid: b2.paid,
    at: new Date().toISOString(),
    mirror: await tx(b2.txId),
  });
}

async function refundSettle() {
  const a = st.refundArtifact;
  const before = await balances([accounts.buyer!.id, REGISTRY, a.author]);
  const res = await settle("pay the refund row to the buyer");
  await sleep(6000);
  const after = await balances([accounts.buyer!.id, REGISTRY, a.author]);
  const batches = (await api("/batches")).body;
  const txs: Record<string, any> = {};
  for (const b of batches.batches) if (b.txId) txs[b.txId] = await tx(b.txId);
  save("23-refund-settled-on-chain.json", {
    balancesBefore: before,
    settle: res.body,
    balancesAfter: after,
    batches,
    txs,
    payouts: (await api("/payouts", { operator: true })).body,
  });
}

async function refundLate() {
  const a = st.refundArtifact;
  const elapsed = (Date.now() - st.refundLateAt) / 1000;
  const r = await refund(st.refundLateTx, a.magnet);
  save("24-refund-after-window.json", {
    txId: st.refundLateTx,
    secondsSincePurchase: Math.round(elapsed),
    refundWindowSeconds: 120,
    status: r.status,
    body: r.body,
    statePurchase: (await api("/state")).body.purchases.find((p: any) => p.txId === st.refundLateTx),
  });
}

// -------------------------------------------------------------------- delist

async function delistCase() {
  const { delistArtifact } = await import("../../mcp/src/delist.js");
  const p = await publish("author19", 19, "what delisting does and does not undo");
  const b = await buy(p.magnet, p.bodyHash);
  if (!b.ok) throw new Error(`delist-case buy failed: ${b.error}`);
  put("delistTx", b.txId);
  put("delistArtifact", { magnet: p.magnet, author: p.author.id });

  const searchBefore = (await api(`/search?q=${encodeURIComponent("what delisting does and does not undo")}`)).body;

  process.env.CARPOOL_AUTHOR_ACCOUNT_ID = p.author.id;
  process.env.CARPOOL_AUTHOR_PRIVATE_KEY = p.author.key;
  const out = await delistArtifact(BASEURL(), p.magnet);
  note("delist", out);
  const retry = await delistArtifact(BASEURL(), p.magnet);

  const afterManifest = await api(`/manifest/${encodeURIComponent(p.magnet)}`);
  const afterArtifact = await fetch(`${BASEURL()}/artifact/${encodeURIComponent(p.magnet)}`);
  const searchAfter = (await api(`/search?q=${encodeURIComponent("what delisting does and does not undo")}`)).body;
  const browse = (await api("/search")).body;

  // The contract's load-bearing half: a purchase inside its window stays refundable.
  const r = await refund(b.txId, p.magnet);

  save("30-delist.json", {
    magnet: p.magnet,
    purchase: { txId: b.txId, paid: b.paid },
    searchHitBefore: searchBefore.filter((x: any) => x.magnet === p.magnet).length,
    delistResponse: out,
    idempotentRetry: retry,
    manifestAfter: { status: afterManifest.status, body: afterManifest.body },
    artifactAfter: { status: afterArtifact.status, body: await afterArtifact.json().catch(() => null) },
    searchHitAfter: searchAfter.filter?.((x: any) => x.magnet === p.magnet).length ?? 0,
    browseIncludes: Array.isArray(browse) ? browse.some((x: any) => x.magnet === p.magnet) : null,
    refundAfterDelist: { status: r.status, body: r.body },
    statePurchase: (await api("/state")).body.purchases.find((x: any) => x.txId === b.txId),
    stateArtifact: (() => null)(),
  });
  const state = (await api("/state")).body;
  save("31-delist-state.json", state.artifacts.find((x: any) => x.manifest.magnet === p.magnet));
}

function BASEURL() {
  return process.env.CARPOOL_BASE ?? "http://127.0.0.1:8403";
}

// --------------------------------------------------- unpayable payee: fail/park

async function unpayablePublish() {
  const p = await publish("unpayable", 90, "a payout to an account with no USDC association");
  put("unpayable", { magnet: p.magnet, author: p.author.id, bodyHash: p.bodyHash });
  const b = await buy(p.magnet, p.bodyHash);
  if (!b.ok) throw new Error(`unpayable buy failed: ${b.error}`);
  put("unpayableTx", b.txId);
  // Discharge this purchase's tracker_fee row immediately (payee == payer, so no
  // transfer), leaving the unpayable royalty as the ONLY claimable row when its
  // refund window closes. `markFailed` releases a whole chunk, so isolating the
  // payee is what makes the next settle's outcome a statement about this payee.
  const feeOnly = await settle("discharge the fee row before the royalty is claimable");
  save("40b-unpayable-fee-only-settle.json", feeOnly.body);
  save("40-unpayable-purchase.json", {
    magnet: p.magnet,
    payee: p.author.id,
    txId: b.txId,
    paid: b.paid,
    payeeUsdcRelationship: await (await fetch(
      `${process.env.MIRROR_NODE_URL}/api/v1/accounts/${p.author.id}/tokens?token.id=${process.env.USDC_TOKEN_ID}`,
    )).json(),
    payeeAccount: await (await fetch(`${process.env.MIRROR_NODE_URL}/api/v1/accounts/${p.author.id}`)).json(),
  });
}

async function unpayableSettle() {
  const u = st.unpayable;
  const attempts: any[] = [];
  for (let n = 1; n <= 5; n++) {
    const res = await settle(`unpayable attempt ${n}`);
    await sleep(4000);
    const payouts = (await api("/payouts", { operator: true })).body;
    const row = payouts.payouts.find((p: any) => p.payee === u.author);
    const batches = (await api("/batches")).body;
    attempts.push({ attempt: n, settle: res.body, payoutRow: row, newestBatch: batches.batches[0] });
    note("unpayable-attempt", { n, state: row?.state, attempts: row?.attempts, parkedAt: row?.parkedAt, batch: batches.batches[0]?.status });
    if (row?.parkedAt != null) break;
  }
  const payouts = (await api("/payouts", { operator: true })).body;
  const failedBatches = (await api("/batches")).body.batches.filter((b: any) => b.status.startsWith("FAILED:"));
  const txs: Record<string, any> = {};
  for (const b of failedBatches) if (b.txId) txs[b.txId] = await tx(b.txId);
  save("41-unpayable-failed-and-parked.json", { attempts, parked: payouts.parked, failedBatches, failedTxs: txs });
  put("parkedPayoutId", payouts.parked[0]?.id);
}

async function unparkAndPay() {
  const id = st.parkedPayoutId;
  const u = st.unpayable;
  const bad = await api(`/payouts/999999/unpark`, { method: "POST", operator: true });
  const unauth = await api(`/payouts/${id}/unpark`, { method: "POST" });
  const ok = await api(`/payouts/${id}/unpark`, { method: "POST", operator: true });
  const twice = await api(`/payouts/${id}/unpark`, { method: "POST", operator: true });
  const after = (await api("/payouts", { operator: true })).body;
  save("42-unpark.json", {
    payoutId: id,
    unknownId: { status: bad.status, body: bad.body },
    withoutOperatorSecret: { status: unauth.status, body: unauth.body },
    unpark: { status: ok.status, body: ok.body },
    unparkTwice: { status: twice.status, body: twice.body },
    payoutAfter: after.payouts.find((p: any) => p.id === id),
    parkedAfter: after.parked,
  });
  note("unparked", { id, row: after.payouts.find((p: any) => p.id === id) });
}

async function unpayableFixedSettle() {
  const u = st.unpayable;
  const before = await usdcBalance(u.author);
  const res = await settle("after the operator fixed the cause");
  await sleep(6000);
  const after = await usdcBalance(u.author);
  const batches = (await api("/batches")).body;
  const txs: Record<string, any> = {};
  for (const b of batches.batches.slice(0, 3)) if (b.txId) txs[b.txId] = await tx(b.txId);
  save("43-unpayable-paid-after-fix.json", {
    payee: u.author,
    balanceBefore: before,
    settle: res.body,
    balanceAfter: after,
    batches: batches.batches.slice(0, 4),
    txs,
    payout: (await api("/payouts", { operator: true })).body.payouts.find((p: any) => p.payee === u.author),
  });
}

// ----------------------------------------------- a case needing one payee only

/**
 * Publish, sell, and discharge the tracker_fee row immediately, so that when the
 * refund window closes the ONLY claimable payout in the whole ledger is this
 * artifact's royalty. Every batch-level test below needs its own batch, and
 * `settle()` claims everything that is payable.
 */
async function isolatedCase(label: string, authorLabel: string, i: number, topic: string) {
  const p = await publish(authorLabel, i, topic);
  const b = await buy(p.magnet, p.bodyHash);
  if (!b.ok) throw new Error(`${label} buy failed: ${b.error}`);
  const feeOnly = await settle(`${label}: discharge the fee row`);
  put(label, {
    magnet: p.magnet,
    payee: p.author.id,
    purchaseTx: b.txId,
    paid: b.paid,
    boughtAt: Date.now(),
  });
  save(`${label}-00-purchase.json`, {
    magnet: p.magnet,
    payee: p.author.id,
    purchase: { txId: b.txId, paid: b.paid, verification: b.verification },
    purchaseMirror: await tx(b.txId),
    feeOnlySettle: feeOnly.body,
  });
}

// ------------------------------------------------- reconcile: the real branches

/** Snapshot of everything a batch-level claim needs, from the wire and the chain. */
async function batchSnapshot(name: string, payee: string, extra: Record<string, unknown> = {}) {
  const batches = (await api("/batches")).body;
  const txs: Record<string, any> = {};
  for (const b of batches.batches.slice(0, 4)) if (b.txId) txs[b.txId] = await tx(b.txId);
  save(name, {
    ...extra,
    payeeUsdcBalance: await usdcBalance(payee),
    batches,
    payouts: (await api("/payouts", { operator: true })).body,
    mirrorTxs: txs,
  });
  return batches;
}

async function reconcileSnap() {
  const which = process.argv[3]!;
  const payee = st[which]?.payee ?? process.argv[4]!;
  await batchSnapshot(`${which}-${process.argv[5] ?? "snap"}.json`, payee);
}

/** `POST /batches/:id/resolve` — an operator answering for a NEEDS_OPERATOR batch. */
async function resolveBatch() {
  const which = process.argv[3]!;
  const action = process.argv[4]!;
  const batches = (await api("/batches")).body;
  const id = batches.needsOperator[0];
  if (id == null) throw new Error(`no NEEDS_OPERATOR batch to ${action}`);
  const batch = batches.batches.find((b: any) => b.id === id);

  // An operator does not guess: they look the batch's memo up on the mirror node
  // and act on what is there. This is that lookup, recorded.
  const payerTxs = await (
    await fetch(
      `${process.env.MIRROR_NODE_URL}/api/v1/transactions?account.id=${REGISTRY}&limit=100&order=desc`,
    )
  ).json();
  const byMemo = (payerTxs.transactions ?? []).filter(
    (t: any) => t.memo_base64 && Buffer.from(t.memo_base64, "base64").toString("utf8") === batch.memo,
  );

  const body: Record<string, unknown> = { action };
  if (action === "paid") {
    const paidRecord = byMemo.find((t: any) => t.result === "SUCCESS");
    if (!paidRecord) throw new Error(`no SUCCESS record for memo ${batch.memo}; refusing to assert 'paid'`);
    body.txId = paidRecord.transaction_id.replace("-", "@").replace(/-(\d+)$/, ".$1");
  }

  const badAction = await api(`/batches/${id}/resolve`, {
    method: "POST",
    operator: true,
    body: JSON.stringify({ action: "paid" }),
  });
  const unauth = await api(`/batches/${id}/resolve`, { method: "POST", body: JSON.stringify(body) });
  const out = await api(`/batches/${id}/resolve`, { method: "POST", operator: true, body: JSON.stringify(body) });
  const again = await api(`/batches/${id}/resolve`, { method: "POST", operator: true, body: JSON.stringify(body) });
  note("resolve", { id, action, status: out.status, body: out.body });
  save(`${which}-resolve-${action}.json`, {
    batch,
    operatorsMirrorLookup: {
      memo: batch.memo,
      url: `/api/v1/transactions?account.id=${REGISTRY}&limit=100&order=desc`,
      matchesForThisMemo: byMemo.map((t: any) => ({
        transaction_id: t.transaction_id,
        result: t.result,
        consensus_timestamp: t.consensus_timestamp,
        token_transfers: t.token_transfers,
      })),
    },
    request: body,
    /** `action: "paid"` with no txId must be a 400 and must not touch the batch. */
    paidWithoutTxId: { status: badAction.status, body: badAction.body },
    withoutOperatorSecret: { status: unauth.status, body: unauth.body },
    response: { status: out.status, body: out.body },
    repeatedAfterResolve: { status: again.status, body: again.body },
    batchesAfter: (await api("/batches")).body,
    payoutsAfter: (await api("/payouts", { operator: true })).body,
  });
}

/** A plain bounded settle, recorded, for the step after a release. */
async function settleAndRecord() {
  const which = process.argv[3]!;
  const name = process.argv[4]!;
  const payee = st[which].payee;
  const before = await usdcBalance(payee);
  const res = await settle(`${which}: ${name}`);
  await sleep(6000);
  await batchSnapshot(`${which}-${name}.json`, payee, {
    payeeUsdcBalanceBefore: before,
    settleResponse: res.body,
  });
}

// ------------------------------------------------- owed_failure and its replay

/**
 * A REAL settled payment the registry cannot record, and the recovery path.
 *
 * The failure is injected in the *data*, not in the code: the artifact's
 * content-addressed `author` column is overwritten with a string
 * `parseHederaAuthor` refuses, which is what `onPaid` calls to work out who to
 * pay. The x402 payment then settles on chain for real, `onPaid` throws, the
 * gate's `owe()` writes the durable row, and the buyer is served the body with
 * `X-Payment-Record: deferred`. Restoring the column is the operator fixing the
 * cause; `POST /owed/replay` is the half of `owe()` that used to be missing.
 */
async function owedBreak() {
  const { default: Database } = await import("better-sqlite3");
  const p = await publish("author17", 17, "a settled payment the ledger could not record");
  put("owed", { magnet: p.magnet, payee: p.author.id, author: p.author.label });
  const good = `${p.author.id}:${p.author.publicKey}`;
  put("owedAuthorString", good);

  const db = new Database(process.env.LEDGER_DB!);
  const broken = "BROKEN-author-string-with-no-colon";
  db.prepare(`UPDATE artifact SET author = ? WHERE magnet = ?`).run(broken, p.magnet);
  const now = db.prepare(`SELECT author FROM artifact WHERE magnet = ?`).get(p.magnet) as any;
  db.close();
  note("owed-break", { magnet: p.magnet, authorColumnNow: now.author });

  const b = await buy(p.magnet, p.bodyHash);
  put("owedTx", b.txId);
  const owed = (await api("/owed", { operator: true })).body;
  const owedUnauth = await api("/owed");
  save("60-owed-failure.json", {
    magnet: p.magnet,
    intendedPayee: p.author.id,
    authorColumnOverwrittenWith: broken,
    buyResult: {
      ok: b.ok,
      paid: b.paid,
      txId: b.txId,
      verification: b.verification,
      bodyBytes: b.bodyBytes,
      error: b.error,
    },
    purchaseMirror: await tx(b.txId),
    owedWithoutOperatorSecret: { status: owedUnauth.status, body: owedUnauth.body },
    owed,
    statePurchaseForThisTx: (await api("/state")).body.purchases.find((x: any) => x.txId === b.txId) ?? null,
    payoutsForThisPayee: (await api(`/payouts?payee=${p.author.id}`)).body,
  });
}

async function owedReplay() {
  const { default: Database } = await import("better-sqlite3");
  const o = st.owed;
  const replayBeforeFix = await api("/owed/replay", { method: "POST", operator: true });
  const owedAfterFailedReplay = (await api("/owed", { operator: true })).body;

  const db = new Database(process.env.LEDGER_DB!);
  db.prepare(`UPDATE artifact SET author = ? WHERE magnet = ?`).run(st.owedAuthorString, o.magnet);
  db.close();
  note("owed-fixed", { magnet: o.magnet });

  const replay = await api("/owed/replay", { method: "POST", operator: true });
  note("owed-replay", replay.body);
  save("61-owed-replay.json", {
    replayBeforeTheCauseWasFixed: { status: replayBeforeFix.status, body: replayBeforeFix.body },
    owedAfterThatAttempt: owedAfterFailedReplay,
    authorColumnRestoredTo: `${o.payee}:<the author's own public key>`,
    replayAfterFix: { status: replay.status, body: replay.body },
    owedAfterReplay: (await api("/owed", { operator: true })).body,
    owedIncludingResolved: (await api("/owed?open=0", { operator: true })).body,
    statePurchase: (await api("/state")).body.purchases.find((x: any) => x.txId === st.owedTx) ?? null,
    payoutsForPayee: (await api(`/payouts?payee=${o.payee}`)).body,
  });
}

async function owedSettle() {
  const o = st.owed;
  const before = await usdcBalance(o.payee);
  const res = await settle("pay the replayed royalty");
  await sleep(6000);
  await batchSnapshot("62-owed-royalty-paid.json", o.payee, {
    payeeUsdcBalanceBefore: before,
    settleResponse: res.body,
  });
}

// -------------------------------------------------------------- empty epoch

async function emptyEpoch() {
  const before = (await topicMessages()).length;
  const res = await settle("idle epoch");
  await sleep(5000);
  const after = (await topicMessages()).length;
  save("70-empty-epoch.json", {
    topic: process.env.HCS_TOPIC_ID,
    messagesBefore: before,
    settleResponse: res.body,
    messagesAfter: after,
  });
}

// ------------------------------------------------------------------ snapshots

async function snap() {
  await snapshot(`${process.argv[3] ?? "90-snapshot"}.json`);
}

async function topic() {
  const msgs = await topicMessages();
  save("80-mirror-hcs-messages.json", { topic: process.env.HCS_TOPIC_ID, count: msgs.length, messages: msgs });
  save("81-mirror-topic.json", await (await fetch(`${process.env.MIRROR_NODE_URL}/api/v1/topics/${process.env.HCS_TOPIC_ID}`)).json());
}

// ---------------------------------------------------------------------- main

const table: Record<string, () => Promise<void>> = {
  smoke,
  "chunks-publish": chunksPublish,
  "chunks-buy": chunksBuy,
  "chunks-settle": chunksSettle,
  "refund-publish": refundPublish,
  "refund-in-window": refundInWindow,
  "refund-record": refundRecord,
  "refund-second-buy": refundSecondBuy,
  "refund-settle": refundSettle,
  "refund-late": refundLate,
  delist: delistCase,
  "unpayable-publish": unpayablePublish,
  "unpayable-settle": unpayableSettle,
  unpark: unparkAndPay,
  "unpayable-fixed": unpayableFixedSettle,
  "empty-epoch": emptyEpoch,
  snapshot: snap,
  topic,
  // isolated <label> <authorLabel> <i> <topic>
  isolated: () =>
    isolatedCase(process.argv[3]!, process.argv[4]!, Number(process.argv[5]), process.argv.slice(6).join(" ")),
  "batch-snap": reconcileSnap,
  resolve: resolveBatch,
  "settle-record": settleAndRecord,
  "owed-break": owedBreak,
  "owed-replay": owedReplay,
  "owed-settle": owedSettle,
};

const fn = table[cmd!];
if (!fn) throw new Error(`unknown subcommand ${cmd}; have: ${Object.keys(table).join(", ")}`);
await fn();
console.log(`\n[done] ${cmd}`);
