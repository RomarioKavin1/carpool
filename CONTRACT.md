# Wire contract

What a client can rely on. Anything not here is an implementation detail.

Every shape below is derived from the code, not the other way round —
`apps/registry/src/server.ts`'s zod schemas and response literals are the
source. This document previously disagreed with the server on four shapes
(`trackerFee`, the publish signature field, the refund body, and a response
header that was never set) and `apps/mcp` was written to the document: its
publish 400'd on every call. If you change a shape, change it here in the same
commit, and add the assertion to `apps/mcp/src/e2e.test.ts`, which drives the
real registry in-process and is the only place the two apps are checked against
each other.

**Second correction, 2026-09-12: four more statements here were false**, and none
of them was the kind a zod schema can settle. An audit booted the registry through
`apps/registry/src/testing/harness.ts`, hit every route and diffed the actual
responses:

1. `refundState`'s stored column **does** move to `"refunded"`, and `refundedAt` is
   not an input to the derivation — this document claimed the opposite of both;
2. `/batches`' `status` was documented as one of three values and the code already
   wrote more than three;
3. `health` was listed in `(0, 1]` and is `[0, 1]` — a refunded single purchase
   serves `"health": 0`;
4. `/state` was described with `/search`'s flat shape and nests the manifest.

"Re-derived from the schemas" is not the same as "checked against a response", and
the difference is exactly these four. Each is now guarded by
`apps/bench/src/contractDoc.test.ts`, which reads the production sources off disk
and **derives** the `/batches` status vocabulary and the `/payouts` state set from
the code, so a value the code can produce and this document does not list fails
the build.

## Units, stated once

| Thing | Unit |
|---|---|
| Money | **µUSDC, integer.** No floats reach a price, fee or payout. |
| Timestamps in `/events` and `/state` | **seconds** |
| `freshness` | float in (0, 1] — `decay.ts:14` clamps a future `producedAt` to age 0, so it is never > 1 and never 0 |
| `health` | float in **[0, 1]** — `freshness × (1 − refundRate) × buyerTerm`, and one purchase that was refunded makes `refundRate` 1, so `"health": 0` is served by both `/state` and `/search`. Verified by booting the registry, not by reading the formula. |
| `ratings.count` / `.worth` / `.notWorth` / `.discounted` | **integers, counts of `rating` rows.** There is no average, ratio, percentage or star figure anywhere in the rating block, on any route — deliberately, see `POST /rate` |
| `ratings.verdict` | `"worth"`, `"mixed"`, `"not-worth"`, or **`null` below three ratings** — a label, never a number |
| `similarity`, `score` | float; similarity is cosine, in [-1, 1] |
| `depth` | float in [0, 1] |
| `ageDays`, `halfLifeDays` | float, days |

The seconds decision is load-bearing: an earlier dashboard sent milliseconds to
an endpoint that emits seconds, so its "since" cursor was three orders of
magnitude wrong and it silently re-fetched everything. Seconds is the contract.

## `GET /.well-known/carpool`

Read this first. It carries the registry's terms and, critically, its embedding
tuple.

```json
{ "embedding": { "model": "Xenova/all-MiniLM-L6-v2", "dim": 384 },
  "prices": { "trackerFeeMicroUsdc": 500 },
  "refundWindowSeconds": 120,
  "settlementAccount": "0.0.x",
  "asset": "0.0.429274",
  "network": "hedera:testnet",
  "anchorTopic": "0.0.777" }
```

The fee is `prices.trackerFeeMicroUsdc` — **not** a top-level `trackerFee`. The
unit is in the name because this is the number a `priceFloor` must clear.

`anchorTopic` is the HCS topic epochs are anchored to, or `null` when none is
configured. Published because it is what makes the anchor usable: an artifact's
`anchoredAt` on `GET /state` says *that* its manifest hash was timestamped at
consensus, and this says *where* to go and check. An anchor nobody can find is not
evidence.

**Every client must embed with this exact tuple.** Vectors from different models
are not comparable, which is why there is deliberately no `embedding_model`
column on an artifact — the tuple belongs to the registry, not to any one
artifact. A client that indexes with a different model produces rankings that
are meaningless rather than merely worse. `GET /search` enforces the `dim` half
of this (400 on a wrong-length vector); nothing on the wire can enforce the
`model` half, which is why it is served.

## `GET /search` — free, never gated

`?vector=<base64 float32le>` preferred, `?q=<text>` accepted, `?limit=<1..100>`
(default 20).

Returns a **JSON array of manifests, never a body**. The manifest is the buyer's
evidence — question, abstract, every source, and what the artifact cost its
author to produce. Charging for it would defeat the mechanism it exists to
support.

Each element is the full manifest (`magnet`, `question`, `questionNorm`,
`scope?`, `abstract`, `sources`, `provenance`, `decay`, `author`, `bodyHash`,
`bodyBytes`, `redacted`) plus:

| Field | Always | Meaning |
|---|---|---|
| `priceNow` | yes | µUSDC at this instant, `priceFloor + round(priceBase × freshness)` |
| `freshness` | yes | `0.5 ^ (ageDays / halfLifeDays)` |
| `health` | yes | freshness, refund rate and distinct buyers combined |
| `ratings` | yes | what the buyers who paid said — counts, up to three reasons, and a verdict that is `null` under three ratings. **Not** part of `health` |
| `ageDays` | yes | days since `decay.producedAt`, **server clock** |
| `score` | ranked only | `similarity × freshness × (0.5 + 0.5 × depth)` |
| `similarity` | ranked only | cosine similarity to the query vector |
| `depth` | ranked only | normalised independent-work signal from `provenance` + `sources` |

`ageDays` is served rather than derived client-side so that the age, the
freshness and the price a buyer sees are all computed against one clock.

**Two modes, and the difference is not cosmetic.**

- With `vector` **or** `q`: **ranked**, through `@carpool/tracker` — cosine
  similarity over the vector index, then `similarity × freshness ×
  (0.5 + 0.5 × depth)`, dropping hits below the registry's similarity threshold
  (`SEARCH_SIMILARITY_THRESHOLD`, default 0.55, biased toward precision) and
  anything expired. `score`/`similarity`/`depth` are present.
- With **neither**: **browse** — every live artifact, newest first, capped at
  `limit`. `score`/`similarity`/`depth` are **absent**, because nothing was
  ranked. Do not read a browse as a search.

A `vector` whose length is not the declared `dim` is a **400**, naming both
dimensions. It is never zero-padded or truncated: that would return a ranking
computed over a vector nobody produced.

Sending `q` means the registry receives your question text and can log it —
it also embeds it server-side, which is the only way `q` can be ranked at all.
Sending `vector` means it does not. Neither is privacy: embedding inversion
recovers a large fraction of short inputs from vectors alone.

Embed `normalizeQuestion(question)`, not the raw string: the registry indexes
each artifact's `questionNorm`, so both sides of the comparison must run the
same normaliser (`@carpool/core`).

## `GET /manifest/:magnet` — free, never gated

One artifact's manifest, in exactly the shape one `GET /search` element has
(without `score`/`similarity`/`depth`). `404` unknown, `410` delisted or
expired.

This is where a buyer gets the `bodyHash` it will check the delivered body
against. A buyer that takes `bodyHash` from the paid response instead has no
integrity check — see below.

It carries the same `ratings` block `/search` does, for the same reason it carries
`bodyHash`: both are evidence a buyer wants *before* paying.

## `GET /artifact/:magnet` — x402-gated

- `404` unknown magnet · `410` delisted or expired — neither costs a facilitator
  round trip.
- `402` with the `PAYMENT-REQUIRED` header and a body of
  `{ x402Version, resource: { url }, accepts: [requirements] }`. The price is
  `accepts[0].amount` (string µUSDC) and the payee `accepts[0].payTo`.
  **The quote you are served is the quote that will be verified.** The
  facilitator compares `payload.accepted.amount` and `.payTo` by strict
  equality, so the registry replays the requirements it issued rather than
  re-pricing on the paid retry. Re-pricing is what breaks every concurrent
  payment.
- On success: the body as `text/plain; charset=utf-8`, the transaction id inside
  the `PAYMENT-RESPONSE` header (base64 JSON — decode it; the raw header is not
  a transaction id), and `x-carpool-body-hash`.
- `502` when payment settled but the artifact could not be delivered: no payer
  identified, the artifact vanished between quote and settle, or the stored body
  failed its own integrity check. The body is never served in any of these, and
  the reason says whether a refund was accrued.

**Verify the body — against the manifest, not against the header.**
`x-carpool-body-hash` is a convenience echo of `manifest.bodyHash` for a caller
that never fetched the manifest. It is not evidence: it comes from the same
server as the body, so a registry serving the wrong bytes would send a header
that matches them. Compare against the `bodyHash` you read from `GET /search`
or `GET /manifest/:magnet` **before** paying. A buyer who trusts a seller's
integrity check has no integrity check. If you cannot obtain that hash, say the
body is unverified — do not claim a check you did not run.

`payTo` is the **registry's settlement account**, never the author's — that is
what makes the refund window possible.

## `POST /publish`

```json
{ "manifest": { … }, "body": "…", "authorSig": "<hex>",
  "priceBase": 100000, "priceFloor": 10000 }
```

The signature field is **`authorSig`**, not `signature`.

- `authorSig` is the **author's** signature over the manifest hash (the magnet
  minus its `swarm:` prefix), hex.
- `manifest.author` is opaque to the protocol; **this registry's convention is
  `"<accountId>:<publicKeyHex>"`** or the ENS convention below, and it rejects anything else. The account id
  is inside the signed string on purpose: a publish that changed only the payout
  account without re-signing would otherwise verify. Derive the public key half
  from the signing key — a client that takes it from configuration can ship a
  manifest whose author cannot verify its own signature.
- **ENS authors:** `"ens:<name>:<fallbackAccountId>:<publicKeyHex>"`. `name`
  must already be ENSIP-15 normalised (the registry normalises and **rejects** a
  mismatch, `400`), `fallbackAccountId` is a Hedera `shard.realm.num`, and the
  signature is verified against `publicKeyHex` offline, so publishing never reads
  ENS. A malformed `ens:` author is a `400`. What the name's records must hold,
  and how a sale picks its payee, is in *ENS authors* below and in docs/ENS.md.
- `magnet` must equal `magnetOf(manifest)`; the registry recomputes it.
- `manifest.questionNorm` must equal `normalizeQuestion(manifest.question)`
  (`@carpool/core`); the registry **recomputes and rejects a mismatch** rather
  than correcting it, because `questionNorm` is inside the signed, content
  addressed manifest and it is also what the vector index is built from.
- `bodyHash` and `bodyBytes` must match the posted `body`.
- `priceBase`/`priceFloor` are non-negative **integers**.
- `priceFloor` must be ≥ `prices.trackerFeeMicroUsdc`, or a sale could pay out
  more than it took in.
- Body capped at **2 MB** on decoded content.

Response: `{ "magnet": "swarm:…", "created": true, "duplicateOf": null }`.
`duplicateOf` is a **signal, not a rejection** — the magnet of a live artifact
whose question normalises to the same string. Several artifacts may answer one
question by design; the tracker ranks between them.

Failures: `400` (schema, magnet, questionNorm, bodyHash, bodyBytes, priceFloor),
`401` (`authorSig` does not verify), `503` (the registry could not embed the
question for its index — **nothing was stored**; retry).

## `POST /delist`

```json
{ "magnet": "swarm:…", "authorSig": "<hex>" }
```

The author withdraws their own artifact from sale.

- `authorSig` is the author's signature over **`sha256("<magnet>:delist")`**,
  hex — deliberately *not* over the manifest hash, so a `/publish` signature
  cannot be replayed as a withdrawal, or the reverse.
- No public key is sent, unlike `/refund`: the registry already holds the
  author's, inside the artifact's content-addressed `author` field.

Response:

```json
{ "ok": true, "magnet": "swarm:…", "delistedAt": 1789137942,
  "alreadyDelisted": false, "note": "…" }
```

`delistedAt` is unix **seconds**. `alreadyDelisted: true` means a retry found it
already withdrawn and reports the original timestamp — idempotent, not an error.

**What stops:** `GET /search` drops it in both modes, `GET /manifest/:magnet` and
`GET /artifact/:magnet` return **410**. No new sale is possible.

**What does not stop, and this is the contract:**

- a purchase still inside `refundWindowSeconds` **stays refundable**;
- a royalty already accrued **is still paid** — the sale happened;
- the artifact's `manifest_hash` **still anchors** to HCS. Provenance ("this
  content existed, unmodified, at a consensus time") is not a listing;
- a buyer who already paid **keeps their copy**. Nothing can recall it, and every
  string that offers a withdrawal says so.

Nothing is deleted: `delisted_at` is a tombstone, like `voided_at` on a payout.
It is also **final for that magnet** — republishing the identical manifest does
not relist it, because the magnet *is* the content and withdrawing it is a
statement about that content. Publish new research to sell again.

Failures: `404` (no such artifact), `400` (schema), `401` (`authorSig` does not
verify as this artifact's author).

## `POST /refund`

```json
{ "txId": "…", "magnet": "swarm:…", "signature": "<hex>",
  "buyerPublicKey": "<hex>" }
```

`buyerPublicKey` is required and is not optional decoration: `purchase.buyer` is
a Hedera *account id*, not a key, so there would be nothing to check the
signature against. The registry verifies both halves — that `signature` is over
`sha256("<txId>:<magnet>:refund")` by that key, **and** that the key controls
the recorded buyer's account, via the mirror node. A `txId` is public on the
mirror node, so an unsigned refund route would let anyone void an author's
royalty.

Allowed only inside `refundWindowSeconds`. Refunds **`paid − trackerFee`**: the
search and the delivery happened, so the tracker's cut is not returned.

Response `{ "ok": true }`. Failures: `404` (no such purchase), `400` (magnet does
not match the purchase), `401` (signature), `409` (already refunded, window
closed, or the royalty was already claimed by a settlement batch).

## `POST /rate`

```json
{ "txId": "…", "magnet": "swarm:…", "worth": true, "reason": "optional, ≤ 280 chars",
  "signature": "<hex>", "buyerPublicKey": "<hex>" }
```

A buyer who paid says whether the artifact was **worth what they paid**. That is
the whole scale, and it is a deliberate choice over five stars:

- the samples are tiny (most artifacts are bought a handful of times inside a
  half-life measured in days) and a mean of one or two ordinal scores is noise
  with a decimal point on it — this document's own preamble is about a number
  that looked more certain than it was;
- `refundRate` already carries the graded **negative** signal, in money, and it
  is already a term in `health`;
- at n = 2, one sentence of reason is worth more to a buying agent than any
  average.

**Authentication is a buyer signature, like `POST /refund` and for the same
reason** — the actor is a paying stranger who must not hold the operator secret,
and an open rating route is a spam route. `signature` is over

```
sha256("<txId>:<magnet>:rate:<worth|not-worth>:<sha256(reason)>")      reason "" when absent
```

and `buyerPublicKey` is required because `purchase.buyer` is an account id, not a
key. The registry verifies both halves: that the signature is over *this* message
by that key, **and** that the key controls the recorded buyer's account, via the
mirror node. Proof of payment is never a claim in the body — it is the `purchase`
row `txId` resolves to.

Three things are inside that message on purpose. `":rate:"` is domain separation:
a `/refund` signature (`sha256("<txId>:<magnet>:refund")`), which the same buyer
over the same purchase has every reason to be holding, cannot be replayed as a
rating, or the reverse — the same rule `POST /delist` follows. The **verdict** is
in it, so nobody can flip a buyer's "worth it" into "not worth it" in flight. And
the **reason** is bound in as `sha256(reason)` rather than as text, so the message
is a fixed length however long the prose is and a reason containing `":"` cannot
shift how the rest of the string parses.

**One rating per purchase** — `UNIQUE(rating.purchase_id)`, a database
constraint rather than a check in a handler. Each purchase cost real money at the
decaying price of its moment, so a second ballot costs a second purchase. It is
deliberately **not** one per `(buyer, magnet)`: a buyer who legitimately bought the
same artifact twice had two experiences and may say so twice. A rating is also not
editable; a second attempt on the same purchase is a `409`, whichever verdict it
carries.

**An author may not rate their own artifact.** Both halves of this registry's
`"<accountId>:<publicKeyHex>"` author convention are compared, so buying from a
second account does not help if the signature is by the key the manifest names.
`403`, checked after authentication.

**A refunded purchase's rating does not count, and that is stated rather than
implied.** Rating a purchase that is already refunded is a `409`; a rating written
*before* a refund lands keeps its row (nothing here is deleted) and drops out of
the counts into `ratings.discounted`. One rule, both orderings, one answer: the
refund already records the dissatisfaction in money — it voids the royalty and
moves `refundRate` — and counting it again as a rating would let one sale move two
signals that look independent.

Response:

```json
{ "ok": true, "magnet": "swarm:…", "ratingId": 7,
  "ratings": { "count": 3, "worth": 2, "notWorth": 1, "verdict": "worth",
               "discounted": 0,
               "reasons": [ { "worth": true, "reason": "…", "ts": 1789137942 } ] },
  "note": "…" }
```

Failures: `400` (schema, a `reason` over 280 chars — **rejected, never truncated**,
because the buyer signed the exact string that gets stored — control characters in
`reason`, or a `magnet` that does not match the purchase), `401` (the signature
does not verify as this purchase's buyer over this exact rating), `403` (the
author of the artifact), `404` (no purchase for that `txId`), `409` (already rated,
or the purchase was refunded).

### What ratings do **not** do: `health` is unchanged

`health` keeps its three published terms —
`freshness × (1 − refundRate) × (0.4 + 0.6 · min(1, distinctBuyers/5))` — and the
ratings are served **beside** it, never folded in. That was a decision, not an
omission:

1. a fourth factor would have to be a *number*, and below three ratings the
   registry refuses to state even a label; multiplying a defensible score by a
   figure derived from one or two opinions is the false precision the binary scale
   exists to avoid, inside a value the dashboard prints with its terms shown;
2. `refundRate` already carries the strongest negative signal, so a rating term
   would partly double-count it;
3. `health` is computed for **every** artifact, and most will carry no ratings for
   their whole decay window. A term that is constant for most rows is not a
   signal — it is a way of making unrated artifacts look worse than they are,
   which is the mistake the 0.4 buyer floor already exists to correct.

### Where ratings are served

The same block appears on `GET /search` (both modes), `GET /manifest/:magnet` and
`GET /state`, and it is **counts plus a label, never an average**:

```json
"ratings": { "count": 2, "worth": 2, "notWorth": 0, "verdict": null,
             "discounted": 0, "reasons": [ { "worth": true, "reason": "…", "ts": 1789137942 } ] }
```

There is no `average`, `ratio`, `percent` or `stars` field on any surface, so the
only route to a percentage is to divide by `count` — which puts the sample size in
the client's hand at the moment it decides whether a percentage is worth printing.
`verdict` is `null` until three ratings exist and is then `"worth"` / `"mixed"` /
`"not-worth"` at a 2:1 share, so a unanimous two is served as `count: 2,
verdict: null` and **never** as `100%`. `reasons` carries at most the three most
recent, newest first, and only from ratings that count.

## `GET /state`, `GET /events`, `GET /health`

Open, unauthenticated, safe for a browser. `/events?since=<seconds>`, exclusive,
returning `{ id, ts, type: "purchase" | "refund", data: { magnet, buyer, txId,
paid } }`. A refund carries its own timestamp rather than reusing the purchase's
— otherwise a poller using `since = lastTs` would never see it.

`/health` reports `{ ok, creds, authEnforced, registryAccount, network, asset }`.

`/state` serves, per artifact, a **nested** object: the manifest under a
`manifest` key, beside `live`, `priceBase`, `priceFloor`, `priceNow`, `freshness`,
`health`, `distinctBuyers`, `refundRate`, **`ratings`** (the block described under
`POST /rate` — counts, reasons and a `null`-under-three `verdict`, beside `health`
and not inside it), **`ageDays`** (the server's clock — the
same value `/search` sends over the same table, so two surfaces cannot print
contradicting ages), **`anchoredAt`** (unix seconds, NULL until the manifest hash
has been in a successful HCS anchor; pair it with `anchorTopic` from
`/.well-known/carpool` to go and check) and **`delistedAt`** (NULL while on sale —
`live` folds withdrawal and expiry together, this separates them).

```json
{ "artifacts": [ { "manifest": { "magnet": "swarm:…", "question": "…", … },
  "live": true, "priceBase": 30000, "priceFloor": 3000, "priceNow": 33000,
  "freshness": 1, "health": 0.4, "distinctBuyers": 0, "refundRate": 0,
  "ratings": { "count": 0, "worth": 0, "notWorth": 0, "verdict": null,
               "discounted": 0, "reasons": [] },
  "ageDays": 0, "anchoredAt": null, "delistedAt": null } ] }
```

**This is not the shape `/search` uses**, and the document used to describe both
with the same sentence. `/search` spreads the manifest to the top level of each
result (`result.magnet`); `/state` nests it (`state.artifacts[0].manifest.magnet`,
`ledger.ts:895–931`). Two surfaces, two shapes, stated separately — using one
phrasing for both is the failure mode this document's own preamble was written
about.

`/state` also serves two top-level keys this document long omitted:
**`peers`** (the `peer` table, whose `account` holds the full opaque author string
for authors but a bare account id for buyers, so it cannot be joined to
`/payouts.payee`) and **`summary`** (`{ artifactCount, purchaseCount, gross,
refunded, ratingCount }`, where `refunded` counts the stored `refundState` column
and `ratingCount` is the number of `rating` **rows** — the size of the table,
including any whose purchase was later refunded and which therefore count towards
no artifact's totals. Named for the row rather than for a judgement so it cannot be
read as "this many buyers approved").

Per purchase: `{ id, magnet, buyer, txId, paid, ts, refundState, refundDeadline,
refundedAt, authorRoyaltyPayoutId, trackerFeePayoutId, rated, payoutVia }`, plus a top-level
`refundWindowSeconds` so nothing has to hard-code 120. **`rated`** is a boolean:
whether this purchase has spent its one rating (`POST /rate` allows exactly one per
purchase), served so a client does not have to POST and read a `409` to find out.
**`payoutVia`** is how the royalty's payee was chosen when the sale happened, pinned
with it: `null` for a Hedera author, `"ens:<name>"` when the name verified and its
Hedera record was paid, `"ens-fallback:<name>"` when the author-signed fallback was.

**`refundState` is derived, and is `"refunded" | "window" | "closed"`.** The
derivation is `effectiveRefundState` (`ledger.ts:763–770`) and it reads exactly
two fields: the stored `refundState` column and `refundDeadline`, against *this
server's* clock —

```
refundState === "refunded"                  → "refunded"
refundDeadline != null && now <= deadline    → "window"      (inclusive)
otherwise                                    → "closed"      (NULL deadline included)
```

`refundedAt` is **served alongside it and never consulted**. The stored column is
written `"window"` at purchase and **does move**: `refundPurchase`
(`ledger.ts:618`) and `refundUndelivered` (`:676`) both write `"refunded"`, and
`/state`'s `summary.refunded` counts off the stored column (`:960`). What never
happens is a move from `"window"` to `"closed"` — no job flips it when the
deadline passes, which is why that half is derived on read. `"closed"` means the
window expired without a refund: the royalty is now claimable by the settler. Do
not re-derive this from `ts + refundWindowSeconds` client-side; that is a second
clock.

(This paragraph previously said the column "never moves" and that the served
value came "from `refundedAt` plus the deadline". Both were wrong, and both were
found by booting the registry and refunding a purchase rather than by reading the
schema a second time.)

`authorRoyaltyPayoutId` / `trackerFeePayoutId` are the join keys into
`GET /payouts`.

## `GET /payouts`

`?payee=<accountId>` — **open**. Without a `payee`, the whole table, and
**shared-secret gated** (`x-carpool-key`, the same guard as `POST /settle`).

```json
{ "payouts": [ { "id": 12, "payee": "0.0.1111", "amount": 29500,
  "reason": "author_royalty", "ref": "7", "availableAt": 1789138062,
  "voidedAt": null, "settledBatchId": null, "attempts": 0,
  "parkedAt": null, "state": "held" } ],
  "parked": [ ] }
```

`state` is `held | claimable | settled | voided`, derived on the server's clock:
`held` = accrued and not payable yet; `claimable` = owed, and the next epoch will
pay it; `settled` = a batch claimed it, and `settledBatchId` names which; `voided`
= a refund reversed it and it will never be paid. Voided rows are served rather
than hidden — omitting them would make a refunded sale look like a sale that never
happened. `voided` is checked before `settled`, because `void()` is conditional on
the row not already being claimed and reporting "voided" is the safe direction to
be wrong in.

`reason` is `author_royalty | tracker_fee | refund | refund_due`; `ref` is the
`purchase.id` as a string.

**`held` covers two different situations, and `parkedAt` is what separates them.**
A row is `held` either because it is inside its refund window (`availableAt` is the
refund deadline) **or** because it is *parked*: its transfer failed on chain
`attempts` times for a cause that will not clear on its own — an account not
associated with USDC, a deleted account — so the rail stopped spending a
transaction fee per epoch on it and handed it to a person. `parkedAt` is unix
seconds, non-NULL exactly for the second case, and `GET /payouts` also lists those
rows separately in a top-level **`parked`** array so a client does not have to
filter for them.

A parked row deliberately reports `held` rather than `claimable`: before
`parked_at` existed it reported `claimable` for ever, telling every reader "the
next settlement epoch will pay it" about a row nothing was going to pay. `held`
does not promise payment. There is no fifth `"parked"` state, and that is a
deliberate omission rather than an oversight — `PayoutState` is re-exported into
`apps/dashboard`, where it is keyed exhaustively, so widening it is a change to
that app. **Do not switch on `state` alone for a payee-facing "will this be
paid?"**: a `held` row with a non-NULL `parkedAt` will not be paid until somebody
calls `POST /payouts/:id/unpark` (operator-gated).

The state set, like the `/batches` statuses, is derived from the code by
`apps/bench/src/contractDoc.test.ts`: a state the registry can serve and this
section does not list fails the build.

**Why the scoped form is open.** Every input is already public — `/state` serves
every purchase's `paid` and `buyer`, every free manifest carries `author` (which
*is* the payout account under the Hedera convention; for an ENS author the payee is
public ENS data or the fallback inside `author`), and
`/.well-known/carpool` publishes the tracker fee — so one payee's earnings are
already computable by anyone with a browser. Serving them discloses nothing new
and removes the arithmetic, which is where clients get it wrong. What it adds is
the **state**, which nothing else can supply: a payment rail that cannot tell a
payee whether they have been paid is not a payment rail.

Requiring a signature to read one's own payouts was considered and rejected: no
confidentiality is gained over derivable data, at the cost of a key in a browser.
The operator secret would be worse — it also authorises `POST /settle`.

**Why the unscoped form is not open.** It aggregates the registry's own
`tracker_fee` take beside every author's position in one request. That is business
data rather than anyone's receipt, it is not derivable that cheaply, and no
end-user surface needs it.

Neither form crosses the boundary the anchor draws: HCS carries a Merkle **root**
over payout leaves, never the leaves.

## `GET /batches`

Open. `{ "batches": [ { "id", "txId", "status", "ts", "root", "memo",
"reconcileAttempts" } ], "needsOperator": [ id ] }`,
newest first. `txId` is NULL until the transfer's id is recorded, and once set is
a public Hedera transaction anyone can read on a mirror node — which is the point
of batching and anchoring at all, so withholding it while publishing the root
would be theatre. Amounts are not here; they are in `/payouts`, per payee.

**`status` is a string, and eight kinds of value reach it.** Do not switch on
three. The vocabulary is `BATCH_STATUS` in `packages/hedera-x402/src/settler.ts`;
this table is checked against it by `apps/bench/src/contractDoc.test.ts`.

| value | written by | means |
|---|---|---|
| `pending` | `claimBatch` | claimed, not yet submitted or not yet confirmed |
| `EMPTY_CLAIM` | `settleChunk` | the batch claimed no rows (another run won them), so nothing was submitted |
| a raw ledger result code | `markSettled` (and `reconcile`) | the transfer moved value. Usually `SUCCESS`, but the success allow-list also admits **`SUCCESS_BUT_MISSING_EXPECTED_OPERATION`**, which is then the served status verbatim |
| `FAILED:<result>` | `markFailed` | reached consensus and moved nothing; the rows went back to claimable, or were parked after too many attempts (see `/payouts`' `parked`) |
| `SETTLED_NO_TRANSFER` | `settleChunk` | every payee in the batch **was the payer**, so the transfer would have netted to zero: nothing was submitted, no fee was spent, and the payouts are discharged. `txId` stays NULL, because there is no transaction to check — which is the honest answer, and is why this is not reported as `SUCCESS` |
| `NEEDS_OPERATOR:<result>` | `markNeedsOperator` | the transfer returned a result this build cannot classify, so neither settling (which would strand the payees) nor releasing (which risks paying them twice) is safe. **Nobody is paid and nothing is queued until a human answers.** `txId` is recorded so it can be looked up on a mirror node; `POST /batches/:id/resolve` is the answer |
| `RELEASED_BY_OPERATOR:<previous>` | `POST /batches/:id/resolve` (`release`) | an operator asserted the transfer moved nothing; the rows are claimable again |
| `SETTLED_BY_OPERATOR` | `POST /batches/:id/resolve` (`paid`) | an operator asserted the transfer paid, naming the transaction in `txId` |

A client that treats anything other than `SUCCESS` as a failure mis-handles
`SUCCESS_BUT_MISSING_EXPECTED_OPERATION` (paid, reported as unpaid),
`EMPTY_CLAIM` and `SETTLED_NO_TRANSFER` (nothing owed, reported as unpaid), and
`SETTLED_BY_OPERATOR` (paid). The document used to list only the first,
third-as-`SUCCESS`, and fourth.

`GET /batches` also serves **`needsOperator`**: the ids of the batches whose
status begins `NEEDS_OPERATOR:`, pulled out so a client does not have to
string-match for the one value on this endpoint that means somebody has to act.

There is **no anchor route**: HCS messages are submitted and not stored, so the
registry keeps no per-anchor record (no topic sequence number, no consensus
timestamp). `artifact.anchoredAt` on `/state` plus `anchorTopic` on
`/.well-known/carpool` is everything it can honestly serve. A real anchor log
needs a new table and does not exist.

## `POST /settle`

Shared-secret gated (`x-carpool-key`). Returns `{ batches, anchor }`; with no
configured Hedera client it is a no-op that says so
(`{ batches: [], anchor: { anchored: false, skipped: "no-client" } }`) rather
than a 501 — the route exists and is authenticated either way, there is simply
nothing it can pay out yet.

Everything else that mutates is authenticated by signature instead, because a
signature proves *who* acted while a secret proves only that the caller knows
it.

## Operator routes — `GET /owed`, `POST /owed/replay`, `POST /batches/:id/resolve`, `POST /payouts/:id/unpark`

All four are **shared-secret gated** (`x-carpool-key`, the same guard as
`POST /settle`), because all four are a person answering a question the rail
cannot answer for itself. They exist because three money-path failures had no
operator path at all: a settled payment the ledger write lost, a transfer whose
result cannot be classified, and a payout whose transfer will never succeed.

**`GET /owed`** — `{ owed: [...], conflicts: [...], summary: { count, microUsdc,
needsOperator, batchConflicts } }`, newest first. `?open=0` includes resolved
rows; the default is open only. An `owed` row is a payment the facilitator settled
whose ledger write failed: `{ id, ts, op, txId, payer, paid, resourceKey, reason,
resolvedAt, purchaseId, replayAttempts, lastError }`. A `conflicts` row is a
*refused* conditional write — `markSettled` declining to overwrite a batch that
already has an outcome — which means two transfers may exist for one batch and
needs a mirror node rather than a replay. `summary.microUsdc` is the total of
`paid` across open rows: money taken and not recorded.

**`POST /owed/replay`** — runs the same replay pass the epoch loop runs, so an
operator who has just fixed the cause does not wait up to `EPOCH_SECONDS` to find
out whether it worked. Returns `{ replayed, failed, unresolvable, stillOpen }`.
`unresolvable` counts rows that can never be replayed (the artifact is gone, for
instance); they stay open and stay visible.

**`POST /batches/:id/resolve`** — `{ action: "release" | "paid" | "recheck",
txId? }`. Only for a batch whose status begins `NEEDS_OPERATOR:`; anything else is
a `409`. `release` asserts the transfer moved nothing and hands the payouts back
(status becomes `RELEASED_BY_OPERATOR:<previous>`); `paid` asserts it moved and
records it with `txId` (status `SETTLED_BY_OPERATOR`); `recheck` puts the batch
back in front of `reconcile()`. `action: "paid"` without a `txId` is a `400`; so is
a non-integer or non-positive id; a batch that is not `NEEDS_OPERATOR:` is a `409`
with the reason.

**`POST /payouts/:id/unpark`** — returns one parked payout to the queue and resets
its `attempts` to 0. `409` if the row is not parked (or has been voided), `400` on
a malformed id. It does not retry the transfer itself; the next epoch does. The
response is `{ ok, payoutId, note }`.

Each of the three `resolve` actions and this one returns a `note` naming the
consequence in plain language — including, for `release`, that a transfer which
did move value after all has now paid its payees twice. That sentence is in the
response rather than only in this document on purpose: the operator reading it is
the only party who can check.

## ENS authors: `GET /identity`, `GET /ens/:name`

Both free and read-only. Neither is on a money path: a sale resolves its own payee
when it happens and never reads what these return. The ENS network is
`CARPOOL_ENS_CHAIN` (`sepolia` by default, `mainnet`, or `off`), read through
viem's Universal Resolver; `CARPOOL_ENS_RPC_URL` and `CARPOOL_ENS_TIMEOUT_MS`
(default 3000, minimum 100) are optional.

**How a sale by an ENS author picks its payee.** In `onPaid`, after settlement and
immediately before the purchase row is written, the registry reads three records
of `name`:

| record | must hold |
|---|---|
| text `io.carpool.key` | `publicKeyHex` from `author` (`0x` and case ignored) |
| `addr(node, 3030)` | a Hedera account, ENSIP-9 binary (20 bytes: shard u32, realm u64, num u64, big endian) |
| text `io.carpool.payout-sig` | the author key's signature, hex, over `sha256("carpool:ens-payout:v1:<name>:<account>")` |

All three agree: the royalty pays that account and `payoutVia` is `ens:<name>`.
Anything else (a record missing or wrong, a malformed address, the resolver
erroring, or the read exceeding the timeout) pays `fallbackAccountId` and
`payoutVia` is `ens-fallback:<name>`. This never fails the sale. A retried
`onPaid` for a recorded `txId` reads nothing. An `owed_failure` replay always pays
the fallback, since replay is synchronous. A refund voids the royalty row that was
pinned, whatever the name says later.

`GET /identity?author=<manifest.author>` returns, for a Hedera author,
`{ kind: "hedera", author, payoutAccount, publicKey }`; for an ENS author,
`{ kind: "ens", author, name, fallbackAccount, publicKey, binding, payoutNow, profile, network, checkedAt }`
where `binding` is `{ name, status, checks: { key, hederaAddr, payoutSig }, hederaAccount, problems }`,
`status` is `verified | unbound | unreachable`, `payoutNow` is
`{ account, source: "ens" | "fallback" }` for a sale made now, and `profile` holds
whichever of the ENSIP-5 text records `description`, `url`, `avatar`, `keywords`,
`com.github` are set. Answers other than `unreachable` are memoised for 30 s.
`400` without `author` or for an author neither convention parses.

`GET /ens/:name` returns `{ name, network, keyRecord, binding, profile, artifacts,
unverifiedClaims }`. `artifacts` lists live artifacts whose author claims `name`
**and** was signed by the key in `io.carpool.key`, each as `{ magnet, question,
abstract, scope, priceNow, ageDays, producedAt }`; `unverifiedClaims` counts live
artifacts claiming `name` under any other key. `binding` is null when nothing is
listed. `400` for a name that is not normalised, `503` when `io.carpool.key` cannot
be read.

## Settlement and provenance

Payouts batch at **≤ 9 payees** per transfer — Hedera's token-transfer list caps
at 10 entries including the debit. Sub-dust balances carry forward.

Each epoch anchors a Merkle root to HCS over that epoch's **manifest hashes**
and payout rows. An empty epoch anchors nothing: an anchor asserting that
nothing changed is not evidence, and a cumulative root that never changes cannot
witness anything. One epoch is settled and anchored at a time: `POST /settle` and
the epoch timer share a single-flight runner, so a timer tick colliding with a
click produces one transfer and one HCS message, not two.

**What has actually been run, and by which version.** On **2026-09-12** this
settlement section moved value on a public ledger for the first time. One epoch,
against the real Blocky402 facilitator and the real `@hiero-ledger/sdk`:

- x402 purchase `0.0.7162784@1789202339.427560739` — 110,000 µUSDC of
  `0.0.429274` from buyer `0.0.10477413` to the registry's settlement account
  `0.0.10475802`, `SUCCESS`;
- settlement transfer `0.0.10475802@1789202482.460233839` — batch 1, memo
  `carpool:batch:1:f25a8a34`, `SUCCESS`, 109,500 µUSDC to author `0.0.10475801`,
  with the batch's own 500 µUSDC `tracker_fee` row netted out of the transfer
  list as a self-transfer and discharged in the same batch (so `SUCCESS` with a
  transaction id, *not* `SETTLED_NO_TRANSFER` — that status is what a fee-only
  epoch produces, and this epoch was not one);
- HCS anchor on topic `0.0.10496824`, sequence 1, consensus
  `1789202493.460038026`, Merkle root
  `aa11de684c48ef7fbf0f60c7a314c753e878ed0e7031318a563679c1a465bb0c` over three
  leaves — the artifact's manifest hash and the two payout rows.

`docs/evidence/v2-first-testnet-run/` holds the mirror-node responses verbatim
and a verifier that re-derives that root from its own Merkle implementation.

**A second run, the same day, took the claim past one epoch.** On its own topic
`0.0.10497461`: 27 purchases, 25 batches, 15 anchors, and every shape this
document describes that the first run could not reach —

- `POST /refund` inside the window: the royalty voided, the buyer's own refund row
  accrued and then **paid on chain** in batch 4
  `0.0.10475802@1789205157.179586999` (registry −5,000 → buyer +5,000), and the
  author of the refunded sale left holding nothing. `409 refund window has closed`
  after it;
- **13 distinct payees in one epoch, over two chunks** —
  `0.0.10475802@1789204986.055709931` (9 transfer-list entries: 8 payees plus the
  payer debit, the registry's own fee row netted out) and
  `0.0.10475802@1789204990.217343218` (6). The ≤ 9-payee rule and the 10-entry cap
  are now facts about a transaction rather than about a test;
- `FAILED:TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` five times over, each with an empty
  transfer list and a real fee, the rows returned to claimable each time and
  **parked** at `maxAttempts`; then `POST /payouts/:id/unpark` and a payment;
- `SETTLED_BY_OPERATOR` and `RELEASED_BY_OPERATOR:NEEDS_OPERATOR:UNCONFIRMED`,
  both from real `POST /batches/:id/resolve` calls on real `NEEDS_OPERATOR:`
  batches, one of which had genuinely paid and one of which the mirror node held
  no record for;
- `reconcile()` confirming a real batch by memo after a dropped receipt;
- `GET /owed` and `POST /owed/replay` over a real settled payment the ledger
  could not record;
- **the cross-process `settle_lease`**: two processes entering `settle()` in the
  same millisecond over one `ledger.sqlite` produced one transfer and one credit.

`docs/evidence/v2-full-feature-run/` holds it, with a 61-check verifier that
imports nothing from this repository.

**What is still only shown in test**, stated so this section is not read too
widely: `EMPTY_CLAIM`; `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`; the
`DUPLICATE_TRANSACTION` branch of `reconcile`; a transfer list at the full 10
entries; and the `502` from a body-integrity failure with `refundUndelivered`
behind it. Nothing has run at volume. Every purchase, refund, batch and anchor in
this repository's *tests* still runs against a stub facilitator and a mocked
Hedera SDK, in-process on 127.0.0.1.

One further thing a reader of this section should know, because it is a
divergence from what this document promises: **`GET /batches` can serve a `txId`
in two different spellings.** A batch confirmed by `markSettled` from an SDK
receipt carries `0.0.x@secs.nanos`; one confirmed by `reconcile()` carries the
mirror node's `0.0.x-secs-nanos`, because `reconcile` writes the mirror node's
`transaction_id` through unchanged. Both name the same transaction and both are
public, but a client that string-compares them, or builds a URL from them, has to
handle both. Observed on batch 14 of the full-feature run.

The repository also holds genuine **v1** testnet evidence — 60 paid requests
settled, one batched `TransferTransaction`
(`0.0.10475802@1789137942.760688301`, 4 payees, `SUCCESS`, memo
`carpool:batch:1:8643b7b8`), 13 HCS anchors on topic `0.0.10475805`, 1,591,862
tinybar in fees — produced by v1's `apps/settlement`, which this contract
replaced. It is real, and it is not v2's. See `docs/RESTRUCTURE.md` §8 Phase D.
