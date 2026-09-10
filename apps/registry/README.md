# @carpool/registry

The service that actually sells artifacts. Replaces `apps/settlement`
(deleted in the same commit as this package was added).

An author publishes the manifest of research they already did — question,
abstract, sources, provenance, a price that decays — plus the paid body. A
buyer's agent searches for free, reads the manifest for free, and pays over
x402 to unlock the body. On a settled purchase the registry accrues a royalty
to the author (held back for a refund window) and a flat fee to itself.

## Endpoints

| Route | Auth | Notes |
|---|---|---|
| `GET /search` | none | Free. Manifests only, never a body. Two modes: with `?vector=` (base64 f32le, preferred — the question text never arrives) or `?q=` (embedded server-side), results are **ranked** by `@carpool/tracker` — cosine similarity over the sqlite-vec index, scored `similarity × freshness × (0.5 + 0.5 × depth)`, hits below `SEARCH_SIMILARITY_THRESHOLD` (default 0.55) and expired artifacts dropped, and `score`/`similarity`/`depth` returned. With neither, it **browses**: live artifacts newest first, and those three fields are absent because nothing was ranked. A `vector` of the wrong dimension is a 400, never zero-padded. `?limit=` default 20, max 100. Every result also carries `priceNow`, `freshness`, `health`, `ageDays`. |
| `GET /manifest/:magnet` | none | Free. One artifact's manifest, the same shape one `/search` element has. 404 unknown, 410 delisted/expired. This is where a buyer gets the `bodyHash` it checks the paid body against — see CONTRACT.md on why a header is not evidence. |
| `GET /artifact/:magnet` | x402 | Gated by `PaymentGate` (`@carpool/hedera-x402`). 404 unknown magnet, 410 delisted/expired, 402 to quote, then the body once payment settles, with `x-carpool-body-hash` echoing the manifest's hash. 502 (never a body) when payment settled but delivery could not happen. |
| `POST /publish` | `author_sig` | Body `{ manifest, body, authorSig, priceBase, priceFloor }`. Validates the manifest, recomputes `normalizeQuestion(question)` and **rejects a `questionNorm` mismatch** (it is inside the signed content address, so it cannot be corrected — and it is what the vector index is built from), verifies `authorSig` against `manifest_hash` via `AuthorIdentity`, recomputes `magnetOf` and rejects a mismatch, embeds the question into the vector index, then stores the body content-addressed. Returns `{ magnet, created, duplicateOf }` — `duplicateOf` is a *signal*, never a rejection: the design is content-addressed and several artifacts may answer one question. 503 (nothing stored) if the question could not be embedded. Rejects `priceFloor < trackerFee` (see "Money"). Republishing the same magnet reprices instead of duplicating (price isn't part of the signed content — see "Author identity" below). |
| `POST /delist` | `author_sig` | Body `{ magnet, authorSig }` — the author's signature over `sha256("<magnet>:delist")`, verified against the public key inside the artifact's own `author` field (no key is sent, unlike `/refund`). Deliberately a different message from `/publish`'s so neither signature can be replayed as the other. Stops **new** sales only: nothing is deleted, purchases inside their refund window stay refundable, accrued royalties are still paid, and the manifest hash still anchors. Idempotent (`alreadyDelisted`), and final for that magnet — republishing the same manifest does not relist it. 404 unknown, 401 signature. |
| `POST /refund` | buyer signature | Body `{ txId, magnet, signature, buyerPublicKey }`. Only inside the refund window; voids the author's royalty and pays the buyer back `paid − trackerFee`. |
| `POST /settle` | shared secret | Runs the same epoch loop as the `EPOCH_SECONDS` timer (default 600s): settle everything owed via the one shared `Settler`, then anchor the epoch to HCS (`src/settlement.ts`). A no-op reporting `{ batches: [], anchor: { anchored: false, skipped: "no-client" } }` when `CARPOOL_PRIVATE_KEY` is unset. |
| `GET /.well-known/carpool` | none | `{ embedding: {model, dim}, prices: { trackerFeeMicroUsdc }, refundWindowSeconds, settlementAccount, asset, network }`. Every client must embed with the same model — the tuple is a property of the registry, not of an artifact. |
| `GET /payouts` | **none** when `?payee=` is given; **shared secret** for the whole table | `{ payouts: [{ id, payee, amount, reason, ref, availableAt, voidedAt, settledBatchId, state }] }`, newest first. `state` is `held \| claimable \| settled \| voided`, derived on this server's clock. **The read the rail never had**: payout rows were written and claimed and served by nothing, so whether an author had been paid was invisible and the dashboard rendered "settled → not observable" where earnings belong. Scoped is open because every input is already public (`/state` gives every `paid` and `buyer`, the free manifest gives the payout account, `/.well-known` gives the fee) — serving it discloses nothing new and removes arithmetic clients get wrong; what it adds is the *state*, which nothing else can supply. Unscoped is gated because it aggregates the registry's own fee take beside every author's position, which is business data and is not derivable that cheaply. Neither crosses the anchor's boundary: HCS carries the Merkle *root* over payout leaves, never the leaves. |
| `GET /batches` | none | `{ batches: [{ id, txId, status, ts, root, memo }] }`, newest first. Open without qualification: `txId` is a public Hedera transaction, and being able to check it is the entire point of batching payouts and anchoring roots — withholding the id while publishing the root would be theatre. Amounts live in `/payouts`, per payee. |
| `GET /health`, `GET /state`, `GET /events` | none | Reads for the dashboard. `/health` reports whether `POST /settle` is actually gated. All timestamps (`purchase.ts`, a refund's own event time, `?since=`) are unix **seconds** — see "Known unit mismatch" below. `/state` also serves `ageDays` (the same clock `/search` uses over the same table — two surfaces deriving age against two clocks print ages that contradict the freshness beside them), `anchoredAt`, `delistedAt`, each purchase's `refundDeadline` / `refundedAt` / payout ids, and a top-level `refundWindowSeconds`. Its `refundState` is **derived** — `refunded \| window \| closed` — because the stored column is written `"window"` at purchase and nothing ever moves it, so the enum alone could not tell reversible from claimable and every client re-derived it from `ts + window` against a browser clock. Derived, not swept: a timer flipping the column at each deadline would be a write path and a failure mode bought to compute a pure function of two columns already in the row, and it would still be wrong for any read between the deadline and the sweep. |

## Money

`payTo` on every quote is **this registry's own settlement account**, never
the author's. Author-direct would make a refund impossible — the money is
gone the instant it settles on the author's account, and there is nothing
left for `/refund` to reverse. Routing through the registry instead makes it
a **custodian for at most the refund window (120s) plus one settlement
epoch** — the price of a refund window existing at all — except:

- balances under `DUST` (500 µUSDC, from `@carpool/hedera-x402`), which carry
  forward indefinitely by design rather than being settled at a loss, and
- while the settler (Task E) is stopped.

On a settled purchase, two rows land in the rail's `payout` table
(`SqliteSettlementLedger.accrue`; `royalty` is not a separate table — this
*is* it):

| Row | payee | amount | available_at |
|---|---|---|---|
| `author_royalty` | `AuthorIdentity.payout()`, resolved **at purchase** and pinned into the row | `paid − trackerFee` | `now + 120s` |
| `tracker_fee` | the registry account | `TRACKER_FEE_MICRO_USDC` (flat, default 500 µUSDC) | `now` |

`payout()` is resolved at purchase, never re-resolved at settlement, so an
author who re-points their identity in between cannot redirect money already
owed to the old one.

**The two rows sum to exactly `paid`, and that is enforced where they are
written** (`splitSale` in `src/ledger.ts`): the fee is clamped to `paid`, not the
royalty floored at zero, and the post-condition `fee + royalty === paid` throws
rather than logs — a throw propagates out of `onPaid`, so the gate's `owe()`
writes a durable `owed_failure` row and the buyer gets a 502 naming the txId,
whereas a log line would leave an over-sum for the settler to pay out.
`POST /publish` still rejects `priceFloor < trackerFee`, and it is a good early
warning in the wrong place to be the *only* guard: `trackerFee` is env
(`TRACKER_FEE_MICRO_USDC`), so raising it after artifacts are live used to make
every subsequent sale of them accrue the fee in full against a royalty clamped to
zero — two rows worth more than the sale.

A refund voids `author_royalty` and accrues a `reason: 'refund'` payout to
the buyer for **that row's own amount, read from the row** rather than recomputed
as `paid − trackerFee` — recomputing it means a fee changed between purchase and
refund silently changes the refund (raised: the buyer gets less than was taken
from the author and the registry keeps the difference; lowered: more than the sale
received). The tracker's cut is never refunded,
since the search and delivery already happened. Both the void and the
settler's claim are conditional on the row not already being claimed, so a
refund racing the settler cannot double-spend (the boundary case — a claim
and a refund both legal at `now == refundDeadline` — is under test in
`ledger.test.ts`). If the *stored body* fails its own hash check
post-payment (corruption, not buyer's remorse), `refundUndelivered` reverses
whichever of the two payout rows can still be voided and refunds exactly
that much — idempotent, so a retried delivery attempt (Task E adds replay)
never double-accrues.

## Settlement (`src/settlement.ts`)

One `Settler` (`@carpool/hedera-x402`) is constructed once at startup, over
`ledger.settlement` (a `SqliteSettlementLedger`), and shared by an
`EPOCH_SECONDS` timer (default 600) and `POST /settle` — `Settler`'s
concurrency guard is per-instance, so two callers sharing the same instance
share one run rather than building two batches from the same unclaimed rows.

One `EpochRunner` wraps it, constructed once for the same reason, and carries the
**same guard around settle *and* anchor together**. `Settler.settle()` alone is
not enough: it de-duplicates concurrent callers by handing both the *same*
`batches` array, so both then read the same `unanchoredManifests()` (nothing is
marked until `anchorEpoch` resolves) and each submitted its own HCS message — two
consensus messages and two real fees for one epoch, from a timer tick colliding
with a dashboard click. That is the same class of paid leak as v1's
thirteen-anchors-for-one-batch incident, and it is why the guard is one level up.
Without `CARPOOL_PRIVATE_KEY` there is no client to pay anyone with, so
settlement stays off and `POST /settle` reports
`{ batches: [], anchor: { anchored: false, skipped: "no-client" } }` instead
of attempting anything.

Each run does two things, in order, from the caller — never inside `Settler`
itself:

1. **Settle** everything `unsettled()` returns (which already excludes a
   royalty inside its refund window — see "Money" above).
2. **Anchor** the epoch to HCS (`anchorEpoch`), with leaves = manifest hashes
   of every artifact never yet anchored (`artifact.anchored_at IS NULL`,
   tracked as a durable per-artifact flag rather than a time window so a
   crash between settling and anchoring can never lose or double-count one)
   plus `payeeLeaves` over this run's settled payouts. An epoch with new
   publishes but no sales still anchors (the manifest hashes alone make the
   leaf set non-empty); a genuinely idle epoch anchors nothing.

This is a deliberate departure from v1, which anchored unconditionally at the
end of every settle run and rooted over every accrual ever — the live testnet
topic it left behind carries 13 anchors for 1 batch, all with an identical
root. Anchoring manifest hashes (not just payment batches) is also the point
of using HCS here at all: it timestamps that an artifact existed, unmodified,
at a consensus time, which is what makes "I published this first" checkable
by anyone with a mirror node.

At boot, `Settler#reconcile()` runs once, best-effort and non-blocking:
pending batches with no confirmed `tx_id` (a crash between submitting and
recording) are matched against the mirror node **by payer account** — v1
queried network-wide, where the last 100 transactions span about five
seconds, so a real batch was never among them.

## What has run on a real ledger

This README asserts on-ledger checkability in several places above — a `txId`
anyone can look up, an anchor that reached consensus, "two real fees". Here is
exactly how much of that has happened, because for most of this file's life the
answer was *none of it*: every `txId` v2 had produced came from a mocked
`@hiero-ledger/sdk`.

**One epoch, 2026-09-12,** against the real Blocky402 facilitator and the real
SDK on Hedera testnet:

| | |
|---|---|
| x402 purchase, 110,000 µUSDC `0.0.10477413` → `0.0.10475802` | `0.0.7162784@1789202339.427560739` |
| settlement transfer, 109,500 µUSDC → author `0.0.10475801` | `0.0.10475802@1789202482.460233839` — batch 1, `SUCCESS`, memo `carpool:batch:1:f25a8a34` |
| HCS anchor, root `aa11de68…bb0c` over 3 leaves | topic `0.0.10496824`, seq 1, consensus `1789202493.460038026` |

That batch also held the registry's own 500 µUSDC `tracker_fee` row, whose payee
is the batch payer: `settleChunk` netted it out of the transfer list and
discharged it in the same batch, which is why the batch reads `SUCCESS` with a
transaction id rather than `SETTLED_NO_TRANSFER`. The following idle `POST /settle`
answered `{"anchored":false,"skipped":"empty"}` and the topic still holds one
message — the empty-epoch guard described above, on the real network.

A **second, full-feature run** on the same day closed the gaps that one left, on
its own topic `0.0.10497461`: 27 real purchases, 25 batches, 15 anchors.
`POST /refund` ran on chain inside the window (the buyer's money returned in batch
4, the author's royalty voided and never paid) and was refused after it; one epoch
paid **13 distinct payees across two chunks**, crossing the 9-payee boundary;
`reconcile()` recovered a real `pending` batch by memo after its receipt was
dropped; five real `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` transfers were classified
`failed` and their rows returned to claimable, then parked, unparked and paid; and
two processes entering `settle()` in the same millisecond over one `ledger.sqlite`
produced **one** transfer and **one** credit. All three
`POST /batches/:id/resolve` actions ran against real batches.

**Still not run on chain, and this README should not be read as claiming
otherwise:** `EMPTY_CLAIM`, `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`, the
`DUPLICATE_TRANSACTION` branch of `reconcile`, a transfer list at the full 10
entries, and the body-integrity `502` with `refundUndelivered` behind it. Nothing
has run at volume. Every purchase, refund, batch and anchor in this package's
*tests* still runs against a stub facilitator and a faked
`Client`/`TransferTransaction`/`TopicMessageSubmitTransaction`, in-process on
127.0.0.1 (`src/settlement.test.ts`, `src/testing/harness.ts`, which blanks
`CARPOOL_PRIVATE_KEY` so no live client can be built by accident).

Raw evidence, mirror-node responses verbatim, and standard-library verifiers that
re-derive the anchored Merkle roots without importing anything from this
repository: `docs/evidence/v2-first-testnet-run/` (19 checks) and
`docs/evidence/v2-full-feature-run/` (61 checks).

Earlier testnet evidence in this repository — 60 paid requests, batch
`0.0.10475802@1789137942.760688301`, 13 anchors on topic `0.0.10475805` — is
**v1's** `apps/settlement`, deleted in the restructure. Real, and not this
package's.

## Author identity

A manifest's `author` field is opaque by rule (`@carpool/core`'s
`identity.ts`) — nothing outside an `AuthorIdentity` implementation may
assume its shape. This registry pays over Hedera, so it defines its own
convention (`src/identity.ts`): `author = "<payoutAccountId>:<publicKeyHex>"`.
The account id rides inside the same opaque string that `author_sig` covers
(via the manifest hash), so a publish that changed only the payout account
without re-signing would fail verification — it isn't a side-channel field an
attacker can swap in independently.

## Auth model — a deliberate narrowing

The rail's `requireKey` (`LEDGER_API_KEY`, header `x-carpool-key`) gates only
`POST /settle` here. `apps/settlement`'s equivalent gated every mutating
route uniformly, which was correct for a single operator-controlled provider
middleware; it is wrong for a marketplace where `/publish` and `/refund` are
actions by arbitrary independent authors and buyers who cannot hold the
registry's operator secret without defeating the point of publishing being
open at all. Both authenticate themselves cryptographically instead —
`/publish` via `author_sig` over the manifest, `/refund` via the buyer's
signature over `(txId, magnet, "refund")` — which is a *per-request* identity
check, a stronger property than one shared secret everyone holds. `/settle`
has no identity of its own to check; it stays behind the shared secret.

`GET /refund`'s signature check needs one more step than it looks: the buyer
is recorded as a Hedera **account id** (from the x402 settlement), not a
public key, so a signature alone proves nothing about whose account it is —
anyone can generate a keypair and sign anything. `src/identity.ts`'s
`AccountKeyResolver` closes that gap with a mirror-node lookup of the key on
file for the account (injected everywhere, so tests never touch the
network — see `mirrorNodeKeyResolver` vs. the stubs in `*.test.ts`).

## Storage

Content-addressed blobs on disk under `ARTIFACT_STORE` (default
`./data/artifacts`), filename = `body_hash`. Capped at 2 MB; a publish over
the cap is rejected, not truncated. Every read re-verifies the hash — a body
that no longer matches is never served (see "Money" above for what happens
instead).

## `/events` timestamps are unix seconds

`purchase.ts` and a refund's own event time (`purchase.refunded_at`) are unix
**seconds**, matching the rail's `payout`/`batch` tables and `?since=` on
`GET /events`. `apps/dashboard/lib/api.ts`'s `getEvents(sinceSeconds)` sends
seconds too — Task G's dashboard rewrite settled this rather than growing a
second (millisecond) unit convention on the client side.

## Scripts

Ported from `apps/settlement`, minus the "provider" account (v2 has no fixed
data provider — every author is paid to whatever account their own manifest
names):

- `pnpm --filter @carpool/registry create-accounts` — creates the registry's
  settlement account.
- `pnpm --filter @carpool/registry associate` — explicit USDC association
  (the Circle testnet faucet ignores auto-association).
- `pnpm --filter @carpool/registry create-topic` — HCS anchor topic (Task E).
- `pnpm --filter @carpool/registry distribute` — sweeps a faucet mint to the
  operator and registry accounts.
- `pnpm --filter @carpool/registry preflight` (`doctor.ts`) — read-only
  environment/account/facilitator check.
- `pnpm --filter @carpool/registry reset` — wipes `artifact`/`purchase`/
  `peer`/`owed_failure`/the rail's `payout`/`batch` tables for a clean demo.
- `pnpm --filter @carpool/registry warm-embedder` — **run this once before a
  demo.** Wiring the vector index in gave the registry a first-use cost: the
  embedding model is **87 MB** downloaded on a cold cache, and `POST /publish`
  embeds *before* it stores anything, so on a cold cache with no network it
  returns 503 and stores nothing.

  Measured, not estimated: `du -sh` on
  `node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2`
  after a cold embed on 2026-09-12 gives **87 MB** — 90,387,606 bytes of
  `onnx/model.onnx` (86 MiB) plus a 712 KB `tokenizer.json` and two small JSON
  files, 91,100,283 bytes in total. `packages/carpool-tracker/README.md` states
  the same 87 MB from the same measurement.

  This paragraph used to say **~25 MB**, which was wrong by 62 MB. The figure
  originated at `docs/RESTRUCTURE.md:668` as a pre-measurement estimate flagged
  "Measure this in Phase C before committing"; Phase C measured it and updated the
  tracker README, and this one kept the estimate and stated it as fact. It is not
  cosmetic: 25 MB is the number governing the exact cold-cache failure this
  paragraph exists to prevent. Two code comments in this package repeat the old
  estimate (`src/scripts/warm-embedder.ts`, `src/testing/hashedEmbedder.ts`) and
  should be corrected to 87 MB with them. This loads the model once so the
  first real request does not. It is deliberately not on the boot path — a
  registry that only quotes, pays and settles should never load an ONNX runtime,
  and importing `@carpool/tracker` does not (the runtime is behind a dynamic
  import, verified: zero onnxruntime modules in the require cache after
  `import("@carpool/tracker")`).

## Env

See the repo root `.env.example`. New to this package: `ARTIFACT_STORE`,
`REGISTRY_PORT` (renamed from `SETTLEMENT_PORT`), `TRACKER_FEE_MICRO_USDC`,
`MIRROR_NODE_URL`, `EMBEDDING_MODEL` / `EMBEDDING_DIM` (the tuple every client
must embed with — changing either against an existing database is a re-index
migration, not a config tweak), `SEARCH_SIMILARITY_THRESHOLD` (cosine floor for
a ranked `/search` hit, default 0.55), `EPOCH_SECONDS` (settlement epoch timer,
default 600), `HCS_TOPIC_ID` (settlement anchor topic).
