import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({
  path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")],
});
import cors from "cors";
import express, { type Request, type Response } from "express";
import {
  PaymentGate,
  corsOrigins,
  haveCreds,
  loadAuth,
  makeClient,
  requireKey,
  sha256,
  type PaidContext,
} from "@carpool/hedera-x402";
import {
  MAX_RATING_REASON_CHARS,
  magnetOf,
  normalizeQuestion,
  parseManifest,
  priceAt,
} from "@carpool/core";
import { findDuplicateQuestion } from "@carpool/tracker";
import { z } from "zod";
import { loadConfig, REFUND_WINDOW_SECONDS } from "./config.js";
import { openDb } from "./db/index.js";
import { RegistryLedger, rowToManifest, type ArtifactRatings } from "./ledger.js";
import { RegistrySearch, loadSearchOptions } from "./search.js";
import { createEpochRunner, createRegistrySettler } from "./settlement.js";
import { BodyStore } from "./store.js";
import { assertNormalisedEnsName, choosePayout } from "./ens.js";
import { registerEnsRoutes } from "./ens-routes.js";
import {
  mirrorNodeKeyResolver,
  parseAuthor,
  verifyBuyerAction,
  verifyBuyerRefund,
  type AccountKeyResolver,
} from "./identity.js";

const cfg = loadConfig();
const auth = loadAuth();
const { db, sqlite } = openDb(cfg.ledgerDbPath);
const ledger = new RegistryLedger(db, sqlite, {
  trackerFee: cfg.trackerFee,
  registryAccount: cfg.registryAccount,
  refundWindowSeconds: REFUND_WINDOW_SECONDS,
});
const store = new BodyStore(cfg.artifactStore);
const keyResolver: AccountKeyResolver = mirrorNodeKeyResolver(cfg.mirrorNodeUrl);
const search = new RegistrySearch(sqlite, ledger, cfg, loadSearchOptions());

/**
 * `makeClient()` is null without `CARPOOL_PRIVATE_KEY` (see config.ts's own
 * warning for the payTo-only half of this). Without it the registry can
 * still search/publish/quote — it just cannot pay anyone, so settlement
 * stays off rather than handing `Settler` a client it cannot use.
 *
 * Constructed once and shared by the epoch timer and `POST /settle` below:
 * `Settler`'s concurrency guard is per-instance, so two `Settler`s over the
 * same ledger could each read the same unclaimed rows and build two batches
 * before either claimed them.
 */
const hederaClient = makeClient();
const settler = hederaClient ? createRegistrySettler(cfg, ledger, hederaClient) : null;

/**
 * The one epoch runner for this process, shared by the timer below and
 * `POST /settle`. `Settler`'s guard covers the transfer; this one covers settle
 * *and* anchor together, which is what stops a timer tick colliding with a
 * dashboard click from writing two HCS messages for one epoch. Constructed once,
 * for the same reason the `Settler` is.
 */
const epoch = settler
  ? createEpochRunner({ settler, ledger, client: hederaClient, topicId: cfg.hcsTopicId })
  : null;

/**
 * Recover before serving. A settled payment that could not be recorded is queued
 * in `owed_failure`, and a restart is the likeliest moment for the cause to have
 * cleared (the other writer is gone, the disk is no longer full). Replaying here
 * rather than only on the epoch timer matters because without credentials there
 * *is* no epoch timer, and those rows would wait for a human who has not been
 * told yet.
 */
try {
  const r = ledger.replayOwedFailures();
  if (r.replayed > 0 || r.failed > 0 || r.unresolvable > 0) {
    console.log(
      `registry: startup owed_failure replay — ${r.replayed} recorded, ${r.failed} retryable, ` +
        `${r.unresolvable} need an operator (GET /owed)`,
    );
  }
} catch (e) {
  console.error(`registry: startup owed_failure replay failed: ${(e as Error).message}`);
}

if (!settler) {
  console.warn(
    "registry: CARPOOL_PRIVATE_KEY is not set — settlement is disabled; payouts will " +
      "accrue but nothing will be paid or anchored until credentials are configured.",
  );
} else {
  // Best-effort, non-blocking: pending batches with no txId are matched
  // against the mirror node by payer account (never network-wide — the last
  // 100 network-wide transactions span about five seconds, so a real batch
  // was never among them and crash recovery could not work; see
  // Settler#reconcile). A fresh database has no pending batches, so this is
  // a synchronous no-op in that case.
  settler
    .reconcile()
    .catch((e) => console.error(`registry: startup reconcile failed: ${(e as Error).message}`));

  // Epoch timer: settle everything owed, then anchor. `.unref()` so this
  // never keeps the process alive on its own (tests importing this module
  // must not hang on it).
  setInterval(() => {
    epoch!
      .run()
      .catch((e) => console.error(`registry: epoch settle failed: ${(e as Error).message}`));
  }, cfg.epochSeconds * 1000).unref();
}

const app: express.Express = express();

// Reads are cross-origin (the dashboard is a static client); writes are not.
// `exposedHeaders` is not decoration: a browser-side caller cannot read a
// non-safelisted response header without it, so `x-carpool-body-hash` (the
// integrity echo on a paid body) and `PAYMENT-RESPONSE` (which carries the
// transaction id) would be invisible to the dashboard and to any in-browser
// buyer even though the server sent them. Node-side clients (apps/mcp,
// apps/bench) are unaffected either way.
app.use(
  cors({
    origin: corsOrigins(),
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    exposedHeaders: ["x-carpool-body-hash", "PAYMENT-RESPONSE"],
  }),
);
// The spec caps the decoded body at 2 MB (enforced on the decoded content in
// store.write, not here). A non-ASCII body can JSON-escape to as much as ~6x
// its byte length (e.g. a control character becomes `\u00XX`, 6 ASCII bytes
// for 1), so a raw request-body limit anywhere near 2-3 MB 413s a body the
// spec explicitly permits. 16 MB covers that worst case (~12 MB) plus
// headroom for the manifest fields and JSON structure.
app.use(express.json({ limit: "16mb" }));

if (auth.open) {
  console.warn(
    "registry: LEDGER_API_KEY is not set — POST /settle is OPEN. Acceptable only " +
      "on a local machine; set NODE_ENV=production to refuse to start without one.",
  );
}

/**
 * `requireKey` (the rail's shared-secret gate) protects only `POST /settle`
 * here, deliberately narrower than the rail's own doc comment ("the only
 * legitimate callers of the mutating routes are the provider middleware
 * instances"). `/publish` and `/refund` are end-user actions from arbitrary
 * authors and buyers who cannot hold the registry's operator secret without
 * defeating the point of a marketplace — each authenticates itself instead,
 * cryptographically: `/publish` via `author_sig` over the manifest,
 * `/refund` via the buyer's signature over `(txId, magnet, "refund")`, and
 * `/rate` via the buyer's signature over `(txId, magnet, "rate", verdict,
 * reasonHash)`. All three are per-request identity checks, which is a stronger
 * property than one shared secret everyone holds — and for `/rate` the
 * alternative is not a secret but an open endpoint, which is a spam endpoint.
 * `/settle` has no such identity of its own —
 * it is a pure operator action — so it keeps the shared-secret gate.
 */
const guard = requireKey(auth);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const h =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (res.headersSent) return;
      const status = e instanceof HttpError ? e.status : 400;
      res.status(status).json({ error: (e as Error).message });
    }
  };

// -------------------------------------------------------------- GET /search

/**
 * FREE, never gated. Manifests only — never a body — since they are the
 * buyer's evidence and are small by construction; charging for them would
 * defeat the mechanism.
 *
 * Two modes, and the difference is not cosmetic:
 *
 * - `?vector=<base64 f32le>` (preferred) or `?q=<text>` — **semantic ranking**
 *   through `@carpool/tracker`: cosine similarity over the vector index,
 *   scored `similarity * freshness * (0.5 + 0.5 * depth)`, hits below the
 *   similarity threshold and expired artifacts dropped. `vector` means the
 *   registry never receives the question text; `q` means it does, and the MCP
 *   tells the user so on every call that uses it.
 * - neither — **browse**: every live artifact, newest first. No ranking is
 *   claimed, because none happened.
 *
 * Each result is the manifest plus `priceNow`, `freshness`, `health` and
 * `ageDays`; the ranked mode adds `score`, `similarity` and `depth` so a buying
 * agent can see *why* something ranked rather than take the order on faith.
 */
app.get(
  "/search",
  h(async (req) => {
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.trunc(limitRaw))) : 20;
    const vector = typeof req.query.vector === "string" ? req.query.vector : undefined;
    const q = typeof req.query.q === "string" && req.query.q.trim() !== "" ? req.query.q : undefined;

    if (!vector && !q) {
      return ledger.listLive(limit).map((l) => ({ ...l.manifest, ...evidence(l) }));
    }
    const ranked = await search.query({ vector, q }, limit);
    return ranked.map((r) => ({
      ...r.manifest,
      ...evidence(r),
      score: r.score,
      similarity: r.similarity,
      depth: r.depth,
    }));
  }),
);

/**
 * The non-manifest half of a listing — what it costs, how alive it is, and what
 * the buyers who paid for it said.
 *
 * One function for `GET /search` and `GET /manifest/:magnet` both, which is what
 * makes CONTRACT.md's "the same shape one `GET /search` element has" true of the
 * manifest route rather than hoped for — including `ratings`, which a client
 * deciding whether to pay needs in the same response as the price.
 */
function evidence(l: {
  priceNow: number;
  freshness: number;
  health: number;
  ageDays: number;
  ratings: ArtifactRatings;
}) {
  return {
    priceNow: l.priceNow,
    freshness: l.freshness,
    health: l.health,
    ageDays: l.ageDays,
    // Counts and a gated label; there is deliberately no average, ratio or star
    // figure anywhere in this object. See @carpool/core's ratings.ts.
    ratings: l.ratings,
  };
}

/**
 * FREE. One artifact's manifest by magnet — the same shape `GET /search`
 * returns, for a buyer that already has a magnet and no search result.
 *
 * Exists because the buyer's integrity check needs `bodyHash` *before* it
 * pays, and the only honest source for it is the manifest, not a header on the
 * paid response. `apps/mcp` used to compare the delivered body against
 * `x-carpool-body-hash` — a value the same server that sent the body chose —
 * and printed "(verified against the manifest)" whether or not it was present.
 * It was not: nothing set that header. Manifests are free by contract, so
 * handing one out by magnet costs the mechanism nothing and gives the buyer an
 * expectation fixed before payment.
 */
app.get(
  "/manifest/:magnet",
  h((req, res) => {
    const magnet = req.params.magnet!;
    const row = ledger.getArtifact(magnet);
    if (!row) throw new HttpError(404, `no artifact ${magnet}`);
    const listing = ledger.liveListing(magnet);
    if (!listing) throw new HttpError(410, `artifact ${magnet} is delisted or expired`);
    res.json({ ...listing.manifest, ...evidence(listing) });
  }),
);

// ------------------------------------------------------- GET /artifact/:id

const gate = new PaymentGate({
  facilitatorUrl: cfg.facilitatorUrl,
  network: cfg.network,
  asset: cfg.asset,

  resourceKey: (req) => req.params.magnet!,

  async quote(_req, magnet) {
    const row = ledger.getArtifact(magnet);
    if (!row) return { notFound: true };
    if (!ledger.isLive(row)) return { gone: true };
    const manifest = rowToManifest(row);
    const priceUnits = priceAt({ priceBase: row.priceBase, priceFloor: row.priceFloor, decay: manifest.decay });
    return { priceUnits, payTo: cfg.registryAccount, meta: { magnet } };
  },

  /**
   * Must be idempotent on txId (retried from the gate's owe() path) —
   * `RegistryLedger.recordPurchase` checks `purchaseByTxId` first.
   *
   * `payer: null` and `purchase.buyer NOT NULL` collide: a settlement with no
   * identified payer cannot open a purchase row, so this throws instead of
   * inventing a buyer. `owe()` durably records it and the route handler
   * turns it into a 502 (see below) rather than serving the goods.
   */
  async onPaid(ctx: PaidContext) {
    const magnet = String(ctx.meta.magnet);
    if (ctx.payer === null) {
      throw new Error(`settlement ${ctx.txId} for ${magnet} returned no payer; cannot open a purchase row`);
    }
    const row = ledger.getArtifact(magnet);
    if (!row) throw new Error(`artifact ${magnet} vanished between quote and settle`);
    // A retried onPaid for a recorded sale changes nothing, so it must not pay
    // for an ENS read either (recordPurchase would return the prior row anyway).
    if (ledger.purchaseByTxId(ctx.txId)) return;
    // Resolved HERE, after settlement and immediately before the row is written,
    // and pinned into it: for an ENS author this is the name's attested Hedera
    // account right now, or the author-signed fallback if anything about the
    // name fails to verify. `choosePayout` never rejects for an ENS author, so an
    // ENS outage cannot turn a settled sale into an owed_failure. See ens.ts.
    const payout = await choosePayout(row.author);
    if (payout.via !== null) {
      console.log(`registry: sale ${ctx.txId} pays ${payout.account} (${payout.via}): ${payout.reason}`);
    }
    ledger.recordPurchase({
      magnet,
      buyer: ctx.payer,
      txId: ctx.txId,
      paid: ctx.paid,
      payoutAccount: payout.account,
      payoutVia: payout.via,
      refundWindowSeconds: REFUND_WINDOW_SECONDS,
    });
  },

  /**
   * The settled payment could not be recorded. Make it durable and replayable.
   *
   * `reason` is the actual failure the gate caught, not a fixed sentence: it is
   * what `GET /owed` shows an operator and what tells them whether the row is
   * waiting on a retry (a locked database) or on a person (no payer at all).
   */
  owe(op, ctx, reason) {
    return ledger.recordOwedFailure({
      op,
      txId: ctx.txId,
      payer: ctx.payer,
      paid: ctx.paid,
      resourceKey: ctx.resourceKey,
      reason,
    });
  },
});

app.get("/artifact/:magnet", async (req, res) => {
  const outcome = await gate.handle(req, res);
  if (outcome.kind !== "paid") return; // gate already wrote the response

  const { ctx } = outcome;

  // ------------------------------------------------------------------------
  // The payment settled. Did anything record it?
  //
  // `kind: "paid"` used to be the whole answer, so ANY onPaid failure other than
  // the two special-cased below fell through to the happy path and served a 200
  // with the body for a sale that had no purchase row, no royalty, no refund and
  // no route that could even see the `owed_failure` row (docs/AUDIT-MONEY.md H1).
  //
  // The rule now, and the reasoning for it: the buyer's money moved on chain, so
  // refusing them the body takes the payment and gives nothing back — the body is
  // served whenever the obligation is at least *durable*, because it is then
  // recoverable (the epoch loop and `POST /owed/replay` turn it into a real
  // purchase and royalty, and the buyer's refund window opens then). When nothing
  // anywhere has a record, serving would be the one irreversible outcome: goods
  // gone, author unpaid, nothing to replay. That gets a 502 naming the txId.
  // ------------------------------------------------------------------------
  if (ctx.payer === null) {
    // Unrecordable in principle, not transiently: `purchase.buyer` is NOT NULL
    // and there is no account to put in it, so no replay can ever fix this one.
    res.status(502).json({
      error:
        "payment settled but no payer was identified; the operator has a durable record of this " +
        "txId (GET /owed) and this cannot be replayed automatically",
      txId: ctx.txId,
      recorded: false,
    });
    return;
  }
  if (!outcome.recorded && !outcome.durable) {
    res.status(502).json({
      error:
        "payment settled and NOTHING recorded it — not a purchase row, not an owed-failure row. " +
        "Contact the operator with this transaction id before retrying; a retry may pay twice.",
      txId: ctx.txId,
      recorded: false,
    });
    return;
  }
  if (!outcome.recorded) {
    // Durable and replayable. The buyer gets what they paid for; the header (set
    // by the gate) and this log line are what say the ledger is catching up.
    console.error(
      `registry: serving ${ctx.resourceKey} for settled tx ${ctx.txId} with the purchase row ` +
        "DEFERRED — queued in owed_failure and replayed at the next epoch (GET /owed)",
    );
  }

  const magnet = String(ctx.meta.magnet);
  const row = ledger.getArtifact(magnet);
  if (!row) {
    res.status(502).json({ error: `artifact ${magnet} vanished after payment`, txId: ctx.txId });
    return;
  }

  try {
    const body = store.read(row.bodyHash);
    // CONTRACT.md has promised this header since it was written; nothing set
    // it. Set now so the document is true — but note what it is and is not:
    // it is a convenience echo of the manifest's own `bodyHash`, useful for a
    // caller that never fetched the manifest, and it is *not* an integrity
    // guarantee, because a compromised registry serving a tampered body would
    // send a matching header. The real check compares against the `bodyHash`
    // the buyer read from `GET /search` or `GET /manifest/:magnet` before
    // paying — see apps/mcp/src/pay.ts.
    res
      .status(200)
      .set("x-carpool-body-hash", row.bodyHash)
      .type("text/plain; charset=utf-8")
      .send(body);
  } catch (e) {
    // Stored body no longer matches body_hash: never served. Reverse the
    // payment (see refundUndelivered) and surface a 502 with what actually
    // happened — "refund_due issued" only when a purchase row existed to
    // reverse; if onPaid itself never managed to write one (a separate
    // failure, already durably recorded via owe()), say that instead of
    // claiming a refund that was never accrued.
    const purchaseRow = ledger.purchaseByTxId(ctx.txId);
    let detail: string;
    if (purchaseRow) {
      const result = ledger.refundUndelivered(purchaseRow);
      detail = result.ok ? "refund_due issued" : `refund not issued: ${result.reason}`;
    } else {
      detail = "no purchase record exists for this payment; nothing was accrued to reverse (see owed_failure)";
    }
    console.error(`body integrity check failed for ${magnet} (tx ${ctx.txId}): ${(e as Error).message}`);
    res.status(502).json({ error: `stored body failed its integrity check; ${detail}`, txId: ctx.txId });
  }
});

// ------------------------------------------------------------- POST /publish

const PublishBody = z.object({
  manifest: z.record(z.string(), z.unknown()),
  body: z.string().min(1),
  authorSig: z.string().min(1),
  // See Task B carryover: priceAt does not enforce integer prices, so this
  // schema must — a float here would silently produce a non-integer µUSDC
  // amount downstream.
  priceBase: z.number().int().nonnegative(),
  priceFloor: z.number().int().nonnegative(),
});

app.post(
  "/publish",
  h(async (req) => {
    const parsed = PublishBody.parse(req.body);
    const manifest = parseManifest(parsed.manifest);

    const bodyBytes = Buffer.byteLength(parsed.body, "utf8");
    const actualBodyHash = sha256(parsed.body);
    if (actualBodyHash !== manifest.bodyHash) {
      throw new HttpError(400, `bodyHash mismatch: manifest says ${manifest.bodyHash}, body hashes to ${actualBodyHash}`);
    }
    if (bodyBytes !== manifest.bodyBytes) {
      throw new HttpError(400, `bodyBytes mismatch: manifest says ${manifest.bodyBytes}, body is ${bodyBytes} bytes`);
    }

    // A priceFloor below trackerFee lets a purchase's tracker_fee exceed
    // `paid`: recordPurchase's `Math.max(0, paid - trackerFee)` would then
    // silently zero the author's royalty while tracker_fee still accrues in
    // full, so the payout table can sum to more than the sale actually
    // received. GET /.well-known/carpool already publishes the fee, so an
    // author can price above it before publishing.
    if (parsed.priceFloor < cfg.trackerFee) {
      throw new HttpError(
        400,
        `priceFloor (${parsed.priceFloor}) must be at least the tracker fee (${cfg.trackerFee} µUSDC) — see GET /.well-known/carpool`,
      );
    }

    // Recompute the content address and reject a mismatch — magnetOf strips
    // magnet at runtime, so this is a real fixed-point check, not a
    // client-trusting one.
    const expectedMagnet = magnetOf(manifest);
    if (manifest.magnet !== expectedMagnet) {
      throw new HttpError(400, `magnet mismatch: manifest says ${manifest.magnet}, computed ${expectedMagnet}`);
    }
    const manifestHash = expectedMagnet.slice("swarm:".length);

    // `questionNorm` is inside the signed, content-addressed manifest, so the
    // registry cannot quietly correct it — overwriting it would break
    // `magnet === magnetOf(manifest)` and invalidate the author's signature.
    // Recompute and REJECT instead. Without this the registry stored whatever
    // string the client called a normalised question, the content address was
    // computed over that string, and two clients with slightly different
    // normalisers minted two different magnets for the same question — which
    // is exactly what had happened (apps/mcp carried its own copy that
    // stripped a different punctuation set). It is also what makes the vector
    // index trustworthy: the registry embeds `questionNorm`, so a hand-crafted
    // one would index an artifact under a topic it does not answer.
    const expectedNorm = normalizeQuestion(manifest.question);
    if (manifest.questionNorm !== expectedNorm) {
      throw new HttpError(
        400,
        `questionNorm mismatch: manifest says ${JSON.stringify(manifest.questionNorm)}, ` +
          `normalizeQuestion(question) is ${JSON.stringify(expectedNorm)} — questionNorm is part of the ` +
          `content address, so it must be computed with @carpool/core's normalizeQuestion`,
      );
    }

    let authorIdentity;
    try {
      authorIdentity = parseAuthor(manifest.author);
      if (manifest.author.startsWith("ens:")) assertNormalisedEnsName(authorIdentity.display());
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const sigOk = await authorIdentity.verify(manifestHash, parsed.authorSig);
    if (!sigOk) throw new HttpError(401, "author_sig does not verify against manifest_hash for manifest.author");

    // A *signal*, never a rejection: the design is content-addressed by
    // intent (see magnet.ts — several artifacts may answer one question and
    // the tracker ranks between them), so a duplicate question is legitimate.
    // Surfacing the existing magnet lets an author notice they are about to
    // compete with themselves.
    const duplicate = findDuplicateQuestion(
      manifest.question,
      ledger.liveQuestionTexts().filter((r) => r.magnet !== manifest.magnet),
    );

    // Embed and index BEFORE storing anything. An artifact that is stored but
    // not indexed is invisible to every semantic query while still being
    // quoted and sold by magnet — a worse state than a publish that failed
    // loudly and can be retried.
    try {
      await search.indexArtifact(manifest);
    } catch (e) {
      throw new HttpError(
        503,
        `published nothing: the registry could not embed this question for its search index ` +
          `(${(e as Error).message}). Nothing was stored; retry.`,
      );
    }

    store.write(manifest.bodyHash, parsed.body); // throws over the 2 MB cap or on a hash mismatch

    const { created } = ledger.publish(manifest, {
      authorSig: parsed.authorSig,
      manifestHash,
      priceBase: parsed.priceBase,
      priceFloor: parsed.priceFloor,
      bodyUri: `file://${cfg.artifactStore}/${manifest.bodyHash}`,
    });
    return { magnet: manifest.magnet, created, duplicateOf: duplicate?.magnet ?? null };
  }),
);

// -------------------------------------------------------------- POST /delist

const DelistBody = z.object({
  magnet: z.string().min(1),
  /**
   * The author's signature over `sha256("<magnet>:delist")`.
   *
   * Named `authorSig` to match `POST /publish`, the other route that
   * authenticates an author, and verified against the public key inside the
   * artifact's own stored `author` — so unlike `/refund` there is no key to send:
   * the registry already has the one the author signed their publish with, and it
   * is inside the content address.
   */
  authorSig: z.string().min(1),
});

/**
 * The author withdraws their artifact.
 *
 * `artifact.delisted_at` had readers from day one and no writer: no route set
 * it, so the affordance every document promised ("delisting stops new sales")
 * did not exist. This is that route, and what it does *not* do is the
 * interesting half — see `RegistryLedger.delist`. Nothing is deleted:
 *
 *  - a purchase inside its 120-second refund window stays refundable;
 *  - a royalty accrued but not yet settled is still paid, because the sale
 *    happened;
 *  - the manifest hash still anchors, because provenance is not a listing;
 *  - a buyer who already holds the body keeps it. The tool text says so, and it
 *    is the one thing a marketplace cannot take back.
 *
 * What stops is *new* sales: `/search` drops it (both modes), `/manifest/:magnet`
 * and `GET /artifact/:magnet` return 410 rather than quoting a price nobody
 * should pay.
 *
 * Signed over `sha256("<magnet>:delist")`, not over the manifest hash — a publish
 * signature must not be replayable as a withdrawal, and vice versa.
 */
app.post(
  "/delist",
  h(async (req) => {
    const parsed = DelistBody.parse(req.body);
    const row = ledger.getArtifact(parsed.magnet);
    if (!row) throw new HttpError(404, `no artifact ${parsed.magnet}`);

    const messageHashHex = sha256(`${parsed.magnet}:delist`);
    const signed = await parseAuthor(row.author).verify(messageHashHex, parsed.authorSig);
    if (!signed) {
      throw new HttpError(
        401,
        `authorSig does not verify as this artifact's author over sha256("${parsed.magnet}:delist")`,
      );
    }

    const result = ledger.delist(parsed.magnet)!;
    // Only on the transition, and only after the write: an idempotent retry must
    // not re-run side effects, and a failed authentication must not touch the
    // index at all.
    if (result.delisted) search.unindexArtifact(parsed.magnet);
    return {
      ok: true,
      magnet: parsed.magnet,
      delistedAt: result.delistedAt,
      alreadyDelisted: !result.delisted,
      note:
        "New sales are stopped. Purchases still inside their refund window remain refundable, royalties " +
        "already accrued will still be paid, and a buyer who already paid keeps their copy — that cannot " +
        "be recalled. This is final for this magnet: republishing the same manifest does not relist it.",
    };
  }),
);

// -------------------------------------------------------------- POST /refund

const RefundBody = z.object({
  txId: z.string().min(1),
  magnet: z.string().min(1),
  signature: z.string().min(1),
  /**
   * Not in the brief's literal body shape, but required to verify a
   * signature at all: the buyer's account id (recorded as `purchase.buyer`)
   * is a Hedera account number, not a public key, and there is no key on
   * that request to check the signature against otherwise. See
   * src/identity.ts's `verifyBuyerRefund` for how this is tied back to the
   * account on file via the mirror node.
   */
  buyerPublicKey: z.string().min(1),
});

app.post(
  "/refund",
  h(async (req) => {
    const parsed = RefundBody.parse(req.body);
    const p = ledger.purchaseByTxId(parsed.txId);
    if (!p) throw new HttpError(404, `no purchase recorded for tx ${parsed.txId}`);
    if (p.magnet !== parsed.magnet) throw new HttpError(400, "magnet does not match the purchase recorded for this tx");

    const messageHashHex = sha256(`${parsed.txId}:${parsed.magnet}:refund`);
    const signed = await verifyBuyerRefund(keyResolver, {
      accountId: p.buyer,
      publicKeyHex: parsed.buyerPublicKey,
      messageHashHex,
      signature: parsed.signature,
    });
    if (!signed) {
      throw new HttpError(401, "signature does not verify as the purchase's buyer");
    }

    const result = ledger.refundPurchase(p);
    if (!result.ok) throw new HttpError(409, result.reason);
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- POST /rate

const RateBody = z.object({
  /** The transaction that paid for the artifact. Identifies the purchase. */
  txId: z.string().min(1),
  magnet: z.string().min(1),
  /**
   * The whole scale: was this worth what you paid?
   *
   * A boolean rather than 1–5 — see `@carpool/core`'s `ratings.ts` for the
   * argument, in short: the samples are too small for a mean to mean anything,
   * `refundRate` already carries the graded negative signal in money, and a
   * reason carries more per rating at n = 2 than a star count does.
   */
  worth: z.boolean(),
  /**
   * Optional short prose. Rejected rather than truncated over the cap, because
   * the buyer signs the exact string that gets stored: a silently shortened
   * reason would be a stored statement whose signature does not cover it.
   */
  reason: z.string().max(MAX_RATING_REASON_CHARS).optional(),
  signature: z.string().min(1),
  /**
   * Required for exactly the reason `POST /refund` requires it: `purchase.buyer`
   * is a Hedera account id, not a key, so there is nothing on the request to
   * check the signature against otherwise. Tied back to the account on file via
   * the mirror node — see `verifyBuyerAction`.
   */
  buyerPublicKey: z.string().min(1),
});

/**
 * The message a rating is signed over.
 *
 * Domain-separated the way `POST /delist` is: `/delist` signs
 * `sha256("<magnet>:delist")` precisely so a `/publish` signature cannot be
 * replayed as a withdrawal, and this signs a `":rate:"` string so a `/refund`
 * signature — which the same buyer, over the same purchase, has every reason to
 * be holding — cannot be replayed as a rating, or the reverse. One key, several
 * actions, one message each.
 *
 * The **verdict is inside the signed message**, which the refund message has no
 * equivalent of because a refund has no content. Signing only
 * `(txId, magnet, "rate")` would leave `worth` unauthenticated: anyone who saw
 * one rating request could flip a buyer's "worth it" into "not worth it" and
 * re-post it. The reason is bound in too, as `sha256(reason)` rather than the
 * text itself — a nested hash keeps the message a fixed length however long the
 * prose is, and stops a reason that happens to contain `":"` from shifting how
 * the rest of the string reads.
 */
function ratingMessageHash(args: { txId: string; magnet: string; worth: boolean; reason: string }): string {
  return sha256(`${args.txId}:${args.magnet}:rate:${args.worth ? "worth" : "not-worth"}:${sha256(args.reason)}`);
}

/**
 * A buyer who paid rates the artifact they bought. **Authenticated by signature,
 * never open**, and bound to one purchase.
 *
 * Before this there was no rating of any kind: the only quality signals were
 * `freshness`, `refundRate` and `distinctBuyers`, all three of which say
 * something about the market rather than about whether the research answered the
 * question.
 *
 * ## Why it cannot be an open endpoint, and why a shared secret is not the answer
 *
 * An unauthenticated rating route is a spam endpoint — the cheapest attack on a
 * marketplace is to rate a competitor's artifact down a thousand times — and the
 * operator secret is worse than useless here, because the party acting is a buyer
 * who must not hold it (it also authorises `POST /settle`). So `/rate` follows
 * `/refund`, the other route where the actor is a paying stranger: the buyer signs,
 * sends `buyerPublicKey`, and the registry checks **both halves** — that the
 * signature is over this exact rating by that key, and that the key controls the
 * account recorded as `purchase.buyer`, via the mirror node. The proof of payment
 * is not a claim in the body; it is the purchase row the `txId` resolves to.
 *
 * ## One rating per purchase — the cost of a rating is the price of the artifact
 *
 * The uniqueness constraint is `UNIQUE(rating.purchase_id)` in the schema, not a
 * check here, and it is not `(buyer, magnet)`: each purchase cost real money at
 * the decaying price of that moment, so stuffing the ballot box costs exactly as
 * much as buying the artifact again — and a buyer who legitimately bought the same
 * artifact twice has two experiences and may say so twice. A rating is also not
 * editable (a second attempt is a `409`): it is a signed statement about one
 * receipt, and an amendable one would need its own replay-safe message and would
 * invite rate-down-then-revise games.
 *
 * ## An author may not rate their own artifact
 *
 * Checked after authentication, so a stranger learns nothing from the refusal that
 * `GET /manifest/:magnet` does not already tell them. Both halves of this
 * registry's author convention are compared — the payout account *and* the public
 * key — because they are two spellings of one identity and an author who bought
 * their own artifact from a second account still signs with a key the manifest
 * names.
 *
 * ## A refunded purchase may not rate
 *
 * See `RegistryLedger.recordRating` for the argument and `ratingsFor` for the
 * other half of the same rule (a rating that predates a refund is kept as a row
 * and stops being counted, so both orderings of the two requests agree).
 */
app.post(
  "/rate",
  h(async (req) => {
    const parsed = RateBody.parse(req.body);
    const reason = parsed.reason ?? "";
    // Control characters are refused rather than stripped: the stored string must
    // be byte-for-byte what the buyer signed, and this text is rendered on a
    // listing by clients that did not write it.
    if (/[\u0000-\u001f\u007f]/.test(reason)) {
      throw new HttpError(400, "reason must not contain control characters");
    }

    const p = ledger.purchaseByTxId(parsed.txId);
    if (!p) throw new HttpError(404, `no purchase recorded for tx ${parsed.txId}`);
    if (p.magnet !== parsed.magnet) {
      throw new HttpError(400, "magnet does not match the purchase recorded for this tx");
    }

    const messageHashHex = ratingMessageHash({
      txId: parsed.txId,
      magnet: parsed.magnet,
      worth: parsed.worth,
      reason,
    });
    const signed = await verifyBuyerAction(keyResolver, {
      accountId: p.buyer,
      publicKeyHex: parsed.buyerPublicKey,
      messageHashHex,
      signature: parsed.signature,
    });
    if (!signed) {
      throw new HttpError(
        401,
        'signature does not verify as the purchase\'s buyer over sha256("<txId>:<magnet>:rate:' +
          '<worth|not-worth>:<sha256(reason)>") — note that the verdict and the reason are inside the ' +
          "signed message, so a signature for one rating does not authorise another",
      );
    }

    // Authenticated. Now: is this the author rating their own work?
    const art = ledger.getArtifact(p.magnet);
    if (art) {
      const authorIdentity = parseAuthor(art.author);
      const sameAccount = authorIdentity.payout() === p.buyer;
      const sameKey = authorIdentity.id().toLowerCase() === parsed.buyerPublicKey.trim().toLowerCase().replace(/^0x/, "");
      if (sameAccount || sameKey) {
        throw new HttpError(
          403,
          "an artifact's author may not rate their own artifact — buying your own work is allowed " +
            "(nothing stops it, and the royalty nets out), but rating it is not",
        );
      }
    }

    const result = ledger.recordRating({
      purchaseId: p.id,
      magnet: p.magnet,
      rater: p.buyer,
      worth: parsed.worth,
      reason: reason === "" ? null : reason,
      signature: parsed.signature,
      raterPublicKey: parsed.buyerPublicKey,
    });
    if (!result.ok) {
      // `magnet-mismatch` is a 400 like the pre-transaction check above (it can
      // only fire on a purchase whose magnet changed underneath, which nothing
      // does); the other two are conflicts with a state this purchase is already in.
      throw new HttpError(result.code === "magnet-mismatch" ? 400 : 409, result.reason);
    }

    return {
      ok: true,
      magnet: p.magnet,
      ratingId: result.ratingId,
      // The artifact's ratings as they now stand, from the rows — so a client does
      // not have to re-fetch to show the effect of its own rating, and so what it
      // shows is a count and a verdict rather than a number it derived itself.
      ratings: ledger.ratingsFor(p.magnet),
      note:
        "Recorded against this purchase. One purchase carries one rating and it cannot be edited. " +
        "It is not folded into `health`, which keeps its three published terms; it is served beside " +
        "it, with the count, on /search, /manifest/:magnet and /state. If this purchase is refunded " +
        "inside its window the rating stops counting — the refund records the same dissatisfaction, " +
        "in money.",
    };
  }),
);

// --------------------------------------------------------------- POST /settle

/**
 * Triggers the same epoch loop as the timer above, over the one shared
 * `EpochRunner` — a dashboard click racing the timer (or another click) shares
 * one run rather than building a second batch from the same unclaimed rows, and
 * (see `EpochRunner`) rather than submitting a second HCS anchor for the epoch
 * the other caller already anchored.
 *
 * Without a configured client this is a no-op that reports as much, rather
 * than a 501: the route exists and is authenticated correctly either way,
 * there is simply nothing it can pay out yet.
 */
app.post(
  "/settle",
  guard,
  h(async () => {
    if (!epoch) {
      // No credentials, so nothing can be paid or anchored. The owed-failure
      // queue is still drainable — it needs no Hedera client, only this database —
      // and a registry running without credentials is exactly where an unrecorded
      // payment would otherwise sit untouched.
      return {
        batches: [],
        anchor: { anchored: false, skipped: "no-client" },
        replayed: ledger.replayOwedFailures(),
      };
    }
    return epoch.run();
  }),
);

// ------------------------------------------------- operator: money recovery

/**
 * Settled payments this registry has not recorded. **Operator-gated.**
 *
 * The read that did not exist. `owe()` wrote a durable row for every payment
 * whose `onPaid` threw and no route served it, so a sale that happened on chain
 * and nowhere in the product was invisible to `/state`, `/payouts`, `/batches`,
 * `/events` and `/health` alike, and recovery meant opening `ledger.sqlite` by
 * hand (docs/AUDIT-MONEY.md H1).
 *
 * Gated, unlike `/payouts?payee=`: these rows are not derivable from anything
 * public, each one is an open incident, and `lastError` is internal detail.
 * `?open=0` includes the ones already replayed, for an audit of what happened.
 */
app.get(
  "/owed",
  guard,
  h((req) => {
    const open = String(req.query.open ?? "1") !== "0";
    const rows = ledger.owedFailures({ open });
    // Conditional writes the rail refused, newest first. `markSettled` is
    // conditional on the batch not already having an outcome, so a late "it
    // succeeded" cannot overwrite a `FAILED:` whose rows were released and paid
    // by another batch — but the refused observation is not discarded either,
    // because that transaction may really have paid (docs/AUDIT-MONEY.md M4).
    // A row here means two transfers may exist for one batch: the one thing on
    // this endpoint that needs a mirror node rather than a replay.
    const conflicts = ledger.settlement.conflicts();
    return {
      owed: rows,
      conflicts,
      summary: {
        count: rows.length,
        microUsdc: rows.reduce((n, r) => n + r.paid, 0),
        needsOperator: rows.filter((r) => r.resolvedAt == null && r.replayAttempts > 0).length,
        batchConflicts: conflicts.length,
      },
    };
  }),
);

/**
 * Replay every unrecorded settled payment now. **Operator-gated.**
 *
 * The same pass the epoch loop runs, exposed so an operator who has just fixed
 * the cause does not have to wait up to `EPOCH_SECONDS` to find out whether it
 * worked. Safe to call repeatedly: `recordPurchase` is idempotent on txId.
 */
app.post(
  "/owed/replay",
  guard,
  h(() => {
    const result = ledger.replayOwedFailures();
    return { ...result, stillOpen: ledger.owedFailures({ open: true }).length };
  }),
);

const ResolveBatchBody = z.object({
  /**
   * `release` — you have checked a mirror node and the transfer moved nothing:
   * hand the payouts back so the next epoch retries them.
   * `paid` — it did move: record it against the batch with its transaction id.
   * `recheck` — you cannot tell yet: put it back in front of `reconcile()`.
   */
  action: z.enum(["release", "paid", "recheck"]),
  txId: z.string().min(1).optional(),
});

/**
 * Resolve a `NEEDS_OPERATOR:` batch. **Operator-gated.**
 *
 * The escape hatch H2 found missing. A transfer whose result the rail cannot
 * classify is neither settled nor released — that judgement is correct, since
 * settling strands the payees and releasing risks paying them twice — but it used
 * to be left `pending` with nothing but a `console.error`, which named an operator
 * role the system gave no tools to. These are the tools; `GET /batches` shows
 * which batches are waiting.
 *
 * Deliberately three explicit actions rather than one "fix it": only a person
 * looking at a mirror node knows which of them is true, and each is irreversible
 * in a different direction.
 */
app.post(
  "/batches/:id/resolve",
  guard,
  h((req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "batch id must be a positive integer");
    const body = ResolveBatchBody.parse(req.body ?? {});

    if (body.action === "release") {
      const r = ledger.settlement.operatorRelease(id);
      if (!r.ok) throw new HttpError(409, r.reason ?? "batch cannot be released");
      return {
        ok: true,
        action: "release",
        released: r.released,
        note:
          "The payouts are claimable again and the next epoch will retry them. If that transfer " +
          "did move value after all, those payees are now paid twice — check GET /batches.",
      };
    }
    if (body.action === "paid") {
      if (!body.txId) throw new HttpError(400, "action 'paid' requires the txId that paid it");
      const r = ledger.settlement.operatorMarkPaid(id, body.txId);
      if (!r.ok) throw new HttpError(409, r.reason ?? "batch cannot be marked paid");
      return {
        ok: true,
        action: "paid",
        txId: body.txId,
        note: "The batch's payouts stay claimed and will not be retried.",
      };
    }
    const r = ledger.settlement.operatorRecheck(id);
    if (!r.ok) throw new HttpError(409, r.reason ?? "batch cannot be rechecked");
    return {
      ok: true,
      action: "recheck",
      note: "Back to pending; the next reconcile will look for its record again.",
    };
  }),
);

/**
 * Return a parked payout to the queue. **Operator-gated.**
 *
 * A payout whose transfer failed on chain too many times is parked rather than
 * retried for ever — one un-associated author used to cost 144 transactions a day
 * indefinitely (docs/AUDIT-MONEY.md M5). The cause (an association, a new payout
 * account) is outside this system, so only a person can say it is fixed.
 */
app.post(
  "/payouts/:id/unpark",
  guard,
  h((req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "payout id must be a positive integer");
    if (!ledger.settlement.unpark(id)) {
      throw new HttpError(409, `payout ${id} is not parked (or has been voided)`);
    }
    return { ok: true, payoutId: id, note: "Claimable again; attempts reset to 0." };
  }),
);

// ------------------------------------------------------- GET /.well-known

app.get("/.well-known/carpool", (_req, res) => {
  res.json({
    embedding: cfg.embedding,
    prices: { trackerFeeMicroUsdc: cfg.trackerFee },
    refundWindowSeconds: REFUND_WINDOW_SECONDS,
    settlementAccount: cfg.registryAccount,
    asset: cfg.asset,
    network: cfg.network,
    /**
     * The HCS topic epochs are anchored to, or null when none is configured.
     *
     * A public topic id, and publishing it is what makes the anchor useful: an
     * artifact's `anchoredAt` on `GET /state` says *that* its manifest hash was
     * timestamped at consensus, and this says *where* to go and check. An anchor
     * nobody can find is not evidence.
     */
    anchorTopic: cfg.hcsTopicId && cfg.hcsTopicId !== "0.0.000000" ? cfg.hcsTopicId : null,
  });
});

// ------------------------------------------------------------- reads: state

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    creds: haveCreds(),
    authEnforced: !auth.open,
    registryAccount: cfg.registryAccount,
    network: cfg.network,
    asset: cfg.asset,
  });
});

app.get("/state", h(() => ledger.state()));

/**
 * FREE when scoped to one `payee`; operator-gated for the whole table.
 *
 * This is the read the rail never had. `payout` rows were written by
 * `recordPurchase` and the two refund paths, claimed by the settler, and served
 * by *nothing* — so whether an author had actually been paid was invisible, and
 * the dashboard had to render "settled → not observable" where earnings belong.
 * For a product whose entire claim is that authors get paid, that was the hole
 * worth closing first.
 *
 * **Why `?payee=` is open.** Every input to it is already public: `GET /state`
 * serves every purchase's `paid` and `buyer`, every free manifest carries
 * `author` (which *is* the payout account under this registry's convention), and
 * `/.well-known/carpool` publishes the tracker fee. One payee's earnings are
 * therefore already computable by anyone with a browser, so serving them
 * discloses nothing new — it removes the arithmetic, which is where a client gets
 * it wrong. What it adds is the state (`availableAt`, `voidedAt`,
 * `settledBatchId`), which nothing else can supply.
 *
 * A signature over the payee account was considered and rejected: it buys no
 * confidentiality for data that is derivable, at the cost of a key in a browser.
 * The operator secret would be worse — it is the same secret that authorises
 * `POST /settle`, and a static dashboard must not hold it.
 *
 * **Why the unscoped table is not open.** It aggregates the registry's own
 * `tracker_fee` take beside every author's position, in one request, which is
 * business data rather than anyone's receipt and is not derivable that cheaply.
 * No end-user surface needs it; an operator does. So it takes the same
 * shared-secret guard as `POST /settle`.
 *
 * Note the boundary neither half crosses: the HCS anchor commits a Merkle *root*
 * over payout leaves and never the leaves. That commitment stays a commitment.
 */
app.get(
  "/payouts",
  (req, res, next) => {
    const payee = typeof req.query.payee === "string" ? req.query.payee.trim() : "";
    if (payee !== "") return next(); // scoped: open
    return guard(req, res, next); // unscoped: operator only
  },
  h((req) => {
    const payee = typeof req.query.payee === "string" && req.query.payee.trim() !== "" ? req.query.payee.trim() : undefined;
    const payouts = ledger.payouts({ payee });
    return {
      payouts,
      // Rows the rail has stopped attempting: owed, and waiting on a person
      // (`POST /payouts/:id/unpark`). Listed separately because they are the
      // one thing here that will not resolve on its own, and because `state`
      // reports them as `held` — see `PayoutState` for why it does not yet have
      // a `parked` member of its own.
      parked: payouts.filter((p) => p.parkedAt != null),
    };
  }),
);

/**
 * FREE. Settlement batches, newest first.
 *
 * Open without qualification, unlike the unscoped `/payouts`: a batch's `txId` is
 * a Hedera transaction that anyone can already read on a mirror node, and being
 * able to check it is the entire point of batching payouts and anchoring roots.
 * Withholding the id while publishing the root would be theatre. The amounts are
 * not here — they are in `/payouts`, per payee.
 */
app.get(
  "/batches",
  h(() => {
    const batches = ledger.batches();
    return {
      batches,
      // Pulled out rather than left for a client to string-match: a batch in this
      // list is a set of payees who are neither paid nor queued, and it is the
      // one thing on this endpoint that needs somebody to act.
      needsOperator: batches.filter((b) => b.status.startsWith("NEEDS_OPERATOR:")).map((b) => b.id),
    };
  }),
);

/**
 * There is no `event` table in v2 (docs/RESTRUCTURE.md §4 specifies exactly
 * `artifact`, `purchase`, `peer` for this package) — this feed is derived
 * from `purchase` rows (purchase + refund), which is what a live dashboard
 * actually needs. `since` is a unix-second purchase timestamp, exclusive.
 */
app.get(
  "/events",
  h((req) => {
    const since = Number(req.query.since ?? 0) || 0;
    return ledger.eventsSince(since);
  }),
);

// ENS identity reads: GET /identity and GET /ens/:name. Read-only; see ens-routes.ts.
registerEnsRoutes(app, ledger);

const PORT = cfg.port;

// Only listen when run directly (not when imported by tests/scripts).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`@carpool/registry on :${PORT}`);
  });
}

/**
 * `epoch` is exported for the settlement tests, which have to race the *same*
 * runner the timer and `POST /settle` use — the I2 double-anchor is a property
 * of that one shared object, and two HTTP requests are not a reliable way to
 * make two runs overlap (they interleave at the mercy of the event loop, and in
 * practice one finishes before the other starts).
 */
export { app, ledger, store, epoch };
