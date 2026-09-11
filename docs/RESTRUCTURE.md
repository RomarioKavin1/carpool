# Carpool — restructure plan

The repo pivots. The name stays, the payment rail stays, the product changes.

- **Was:** provider-side price discrimination over cached API responses.
  Working, settled on Hedera testnet, 109 tests.
- **Is:** a market for research artifacts whose demand is **event-shaped**.

This document is the end-to-end plan for getting from one to the other.

---

## 1. The product

An event — a prize list drops, a protocol launches, an exploit happens, a
framework breaks compatibility — creates *synchronised* demand from many
independent parties for the same synthesis. Nobody coordinates. Everyone does
the same work the same week. Then it expires.

Carpool sells the work the moment it is finished. The next person's agent finds
it **before** it starts researching, buys it for a fraction of what redoing it
costs, and drops it straight into context.

The name earns itself: many people heading the same way, one vehicle instead of
forty, the driver gets paid, and the ride leaves whether or not you were on it.

**Constraints that define it:**

- Buyers are **agents**, not people. There is no browsing, no cart. Discovery
  happens inside an MCP call at the moment of need.
- Artifacts **decay**. Price is a function of age. Expiry is normal.
- The author produced the artifact **before any buyer existed**, so their return
  is uncapped and there is no cost to split between buyers.

---

## 2. File-level disposition

Every source, config and infra file. Nothing implicit — an omission here is a
red build.

### `packages/carpool-core` → split

| File | Disposition |
|---|---|
| `src/units.ts` (+ no test) | **move** → `hedera-x402` |
| `src/errors.ts`, `errors.test.ts` | **move** → `hedera-x402` |
| `src/policy.ts`, `policy.test.ts` | **split**: `canonicalHash` → `hedera-x402`; policy schema → rewritten as manifest schema |
| `src/types.ts` (`CLASSES`) | **delete** |
| `src/key.ts`, `key.test.ts` | **delete** |
| `src/pricing.ts`, `pricing.test.ts` | **delete** — replaced by decay |
| `src/workload.ts`, `workload.test.ts` | **move** → `apps/bench`, repurposed for load generation |
| `src/universe.json`, `universe.test.ts` | **delete** |
| `scripts/build-universe.ts`, `scripts/hit-ceiling.ts` | **delete** |
| `src/index.ts` | **rewrite** (new exports) |
| `package.json` | **rewrite** deps |

### `packages/carpool-express` → dissolved

| File | Disposition |
|---|---|
| `src/index.ts` (521 lines) | **split**: 402 flow → `hedera-x402/gate.ts`; pioneer/rider/`chooseRole`/`Upstreams`/`fetchWithRetry` → **delete** |
| `src/index.test.ts` | **delete** (asserts routes on the dead model) |
| `src/quotebinding.test.ts` | **port first** → `hedera-x402/gate.test.ts`. Its fake-facilitator harness is the only thing in the repo that exercises verify/settle. See §8. |
| `src/retry.test.ts` | **delete** with `fetchWithRetry` |
| `src/outbox.ts`, `outbox.test.ts` | **move** → `hedera-x402`; `OutboxOp` becomes an open string **and `replayOutbox`'s three-way literal dispatch becomes a handler map** |
| `src/bodystore.ts`, `bodystore.test.ts` | **move** → `apps/registry` (artifact bodies) |
| `src/ledger.ts` (`LedgerClient`) | **rewrite** in `apps/registry` — different endpoints |
| package itself | **deleted** from the workspace; remove from `pnpm-workspace.yaml`, `Dockerfile`, root scripts |

### `apps/settlement` → becomes `apps/registry`

| File | Disposition |
|---|---|
| `src/merkle.ts`, `merkle.test.ts` | **move** → `hedera-x402`, **generalised**: leaves become `string[]` of opaque hashes, not `[payee, amount][]`. A `payeeLeaves()` helper preserves the old shape. |
| `src/hedera.ts` | **move** → `hedera-x402` |
| `src/auth.ts`, `auth.test.ts` | **move** → `hedera-x402` |
| `src/db/index.ts` | **move** → `hedera-x402` (open/migrate helper) |
| `src/db/schema.ts` | **split**: `batch` DDL → `hedera-x402`; lineage/consumer/accrual → **delete**; artifact/purchase/royalty/peer → new |
| `src/settler.ts`, `settler.test.ts` | **move** → `hedera-x402`, **decoupled from `Ledger`** — see §8.2 |
| `src/anchor.ts` | **rewrite** → `hedera-x402/anchor.ts`, payload passed in, `loadConfig()` removed, decoupled from `settleEpoch` |
| `src/ledger.ts`, `ledger.test.ts` | **delete** — replaced by the artifact ledger |
| `src/config.ts` | **rewrite** — no `CLASSES`, no four-class policy |
| `src/server.ts` | **rewrite** — new routes |
| `src/scripts/{associate,create-accounts,create-topic,distribute}.ts` | **move** → `hedera-x402/scripts` unchanged |
| `src/scripts/doctor.ts` | **move + edit** (drops class checks) |
| `src/scripts/reset.ts` | **rewrite** for the new schema |

### `apps/fleet` → becomes `apps/bench`

7 tests, unnamed in the previous draft. `lib.ts` and `workload.test.ts` import
`cacheKey`/`zipfWorkload`; `agent.ts` is a working x402 **client** and is the
only one worth keeping.

| File | Disposition |
|---|---|
| `src/agent.ts` | **move** → `apps/bench` — x402 buyer, reused for load tests |
| `src/lib.ts`, `src/run.ts`, `src/workload.test.ts`, `src/summary.test.ts` | **rewrite** against artifacts |
| `src/manifest.ts` | **delete** (reads `/.well-known/x402` of the dead provider) |
| `src/scripts/bootstrap.ts` | **move** → `hedera-x402/scripts` |

### `apps/provider`, `apps/provider-two` → **delete entirely**

### `apps/dashboard` → rewritten

`lib/api.ts` reads `/state`, which ceases to exist; `lib/fixture.ts` is the
fixture the review found the dashboard actually rendering. Keep `lib/format.ts`
and the Tailwind/Next scaffolding; rewrite `app/page.tsx` as the torrent view.

### Infra — every one of these breaks if untouched

| File | Change |
|---|---|
| `pnpm-workspace.yaml` | drop `carpool-express`, `provider`, `provider-two`; add `hedera-x402`, `carpool-tracker`, `registry`, `mcp`, `bench` |
| `package.json` (root) | scripts reference `@carpool/provider`, `@carpool/settlement`, `@carpool/fleet` — all rewritten |
| `Dockerfile` | lines COPYing deleted `package.json` paths; multi-stage build targets |
| `docker-compose.yml` | `provider`, `provider-two`, `settlement` services |
| `.github/workflows/ci.yml` | docker job builds the above |
| `pnpm-lock.yaml` | **regenerate** — `--frozen-lockfile` fails the moment workspaces change. CI must run one un-frozen install on the restructure branch. |
| `carpool.policy.json` | **rewrite** as registry config (`ρ_a`, `ρ_t`, floors, embedding tuple) |
| `turbo.json`, `tsconfig.base.json` | verify task graph and paths after the moves |
| `docs/*.md` | `SWARM*.md` superseded; fold into this file or delete |

### Everything else in the tree

| File | Disposition |
|---|---|
| `README.md` | **rewrite** for the new product |
| `HANDOFF.md`, `SUBMISSION.md`, `CONTRACT.md` | **delete** — all describe the dead product |
| `X402-RESEARCH.md` | **keep**, move → `docs/` — its facilitator findings stay true |
| `PLAN.md` | **delete** — superseded by this file |
| `docs/SWARM*.md`, `docs/RESTRUCTURE-REVIEW-*.md` | **keep as history**, marked superseded |
| `.env.example` | **rewrite** — drop provider/class vars, add registry + embedding vars |
| `.gitignore`, `.dockerignore` | **edit** — drop `data/bodies`, add artifact store + index paths |
| `scripts/check-node.mjs` | **keep** unchanged |
| `scripts/verify-clean-clone.sh` | **keep**, update the workspace list it asserts |
| `tsconfig.json` × 7 (one per workspace) | **move/rewrite** with their packages; delete with deleted ones |
| `apps/settlement/package.json`, `apps/fleet/package.json` | **rewrite** (renamed apps) |
| `apps/provider*/package.json` | **delete** |
| `apps/fleet/accounts.json` | **do not migrate.** 13 private keys, gitignored. Regenerate in the new app; delete the file. |
| `apps/settlement/data/smoke.sqlite*` | **delete** — test fixture of a dead schema |
| `apps/settlement/data/ledger.sqlite*` | **checkpoint, then export** → `docs/evidence/` as a checkpointed copy plus a `README.md` naming the transaction ids. Not migrated to the new schema. |
| `LICENSE` | **keep** |
| `.nvmrc` | **keep** — and it is load-bearing: the machine default is Node 26, which `check-node.mjs` rejects. Every step below assumes `nvm use` has been run. |
| `logs/`, `apps/fleet/first-run.jsonl`, `.env` | **delete / do not migrate** — local run output and secrets, all gitignored |
| `apps/dashboard/lib/api.ts` | **rewrite** — reads `/state`, which ceases to exist |
| `apps/dashboard/lib/fixture.ts` | **delete** — the fixture the dashboard was actually rendering |
| `apps/dashboard/lib/format.ts`, `tailwind.config.ts`, `app/layout.tsx` | **keep** |
| `apps/dashboard/app/page.tsx` | **rewrite** as the torrent view |

### Evidence archive — corrected

`apps/settlement/data/ledger.sqlite` is **4 KB with 2 MB in an uncheckpointed
WAL**. Copying the file alone archives an empty database. Run
`PRAGMA wal_checkpoint(TRUNCATE)` first. **Take the counts with every server stopped.** They moved three times during
review (11 → 12 → 13 anchors) because `apps/settlement/dist/server.js` was still
running and anchoring an empty epoch to HCS every 600 s. Verified with the
process dead and the WAL checkpointed:

**52 lineages · 60 consumers · 26 accruals · 1 batch · 75 events
(52 pioneer, 8 rider, 13 anchor, 1 batch_settled, 1 lineage_closed)**.

Note for the record: **13 anchors for 1 batch.** `settleEpoch` anchors every
epoch whether or not anything settled, with a cumulative root that does not
change between them. A v1 defect; the rewritten `anchor.ts` must skip empty
epochs and anchor a per-epoch root.

---

## 3. Target structure

**Dependency direction, stated once:** `hedera-x402` depends on nothing in this
repo. `carpool-core` depends on `hedera-x402` only for `canonicalHash` and
`units`. `carpool-tracker` depends on `carpool-core`. Apps depend on packages.
No package imports an app. `canonicalHash` lives in **`hedera-x402`** and is
re-exported by `carpool-core` for convenience — it is not defined twice.

```
packages/
  hedera-x402/      402 flow · quote binding · settlement batching · HCS
                    anchoring · outbox · auth · mirror-node helpers · scripts
  carpool-core/     manifest · magnet · decay pricing · AuthorIdentity ·
                    canonical hashing
  carpool-tracker/  client-side embedding · sqlite-vec index · search
apps/
  registry/         HTTP: free search · x402-gated fetch · publish · storage
  mcp/              MCP server + PreToolUse consent hook
  dashboard/        torrent-style UI
  bench/            Phase 0 tooling · the A/B harness · load generation
```

---

## 4. Data model

```sql
CREATE TABLE artifact (
  magnet          TEXT PRIMARY KEY,   -- sha256(manifest). CONTENT-addressed.
  question        TEXT NOT NULL,      -- indexed, NOT unique
  question_norm   TEXT NOT NULL,
  scope           TEXT,               -- the event this pertains to
  abstract        TEXT NOT NULL,
  sources_json    TEXT NOT NULL,
  provenance_json TEXT NOT NULL,      -- model, tokens, seconds, cost, toolCalls
  author          TEXT NOT NULL,      -- opaque; resolved via AuthorIdentity
  author_sig      TEXT NOT NULL,
  manifest_hash   TEXT NOT NULL,
  body_hash       TEXT NOT NULL,
  body_bytes      INTEGER NOT NULL,
  body_uri        TEXT NOT NULL,
  -- NOTE: no per-artifact embedding model. sqlite-vec vec0 tables are
  -- fixed-dimension, and vectors from different models are not comparable, so
  -- the tuple (model, dim) is a property of the REGISTRY, not of an artifact.
  -- It lives in registry config and is served from /.well-known so every
  -- client embeds with the same model. Changing it is a re-index migration.
  price_base      INTEGER NOT NULL,   -- µUSDC
  price_floor     INTEGER NOT NULL,
  half_life_days  REAL NOT NULL,
  produced_at     INTEGER NOT NULL,
  redacted        INTEGER NOT NULL DEFAULT 0,
  delisted_at     INTEGER
);
CREATE INDEX idx_artifact_question ON artifact(question_norm);
CREATE INDEX idx_artifact_scope    ON artifact(scope);

CREATE TABLE purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  magnet TEXT NOT NULL, buyer TEXT NOT NULL,
  tx_id TEXT NOT NULL, paid INTEGER NOT NULL, ts INTEGER NOT NULL,
  refund_state TEXT NOT NULL DEFAULT 'none',   -- none | window | refunded
  refund_deadline INTEGER
);
CREATE UNIQUE INDEX idx_purchase_txid ON purchase(tx_id) WHERE tx_id <> '';

CREATE TABLE royalty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payee TEXT NOT NULL, amount INTEGER NOT NULL,
  reason TEXT NOT NULL,                -- author_royalty | tracker_fee | refund
  magnet TEXT, purchase_id INTEGER, settled_batch_id INTEGER,
  -- Held back until the buyer's refund window closes. Without this the settler
  -- pays the author within 600s and a refund has nothing to reverse.
  available_at INTEGER NOT NULL,
  voided_at INTEGER
);
CREATE INDEX idx_royalty_available ON royalty(available_at) WHERE settled_batch_id IS NULL AND voided_at IS NULL;

CREATE TABLE peer (
  account TEXT PRIMARY KEY,
  published INTEGER NOT NULL DEFAULT 0,
  purchased INTEGER NOT NULL DEFAULT 0,
  refunds_received INTEGER NOT NULL DEFAULT 0,
  refunds_issued INTEGER NOT NULL DEFAULT 0
);
```

`batch` comes from `hedera-x402` unchanged.

**Magnet is `sha256(manifest)`, not `sha256(question)`.** A question-keyed
primary key would let the first author lock everyone else out of a question
while a one-word paraphrase minted a fresh id — lockout and plagiarism in the
same line. Content addressing removes both, and lets several artifacts compete
on one question with the tracker ranking between them.

**Health, defined — with the new-artifact floor fixed:**

```
health(a) = freshness(a) · (1 − refundRate(a)) · (0.4 + 0.6 · min(1, distinctBuyers/5))
```

The previous form multiplied by `min(1, buyers/5)`, which is **0 for every
artifact with no buyers yet** — excluding precisely the first hours in which
event-shaped demand exists, and making a brand-new artifact look dead. The
floor term means an unbought artifact starts at 0.4 × freshness and earns the
rest.

---

## 5. Economics

```
freshness(t) = 0.5 ^ (ageDays / halfLifeDays)        -- ∈ (0, 1]
price(t)     = floor + P · freshness(t)
P            ≤ provenance.estimatedCostUsd × margin  (margin < 1)
```

`freshness` is the single decay term used by price (above), by `health` (§4)
and by the tracker's staleness filter (§8 Phase C). Defined once here.

Per sale: **`ρ_a` author (uncapped) · `ρ_t` tracker · remainder to settlement.**

- **Decay only.** No buyer-to-buyer refunds: the author produced the artifact
  before any buyer existed, so there is no shared cost to split, and capping
  their return would mean an artifact bought a thousand times earns the same as
  one bought eight times.
- **`ρ_t` is not optional.** Search is free and burns embeddings, storage and
  bandwidth on every query. It is rate-limited per account.
- **`estimatedCostUsd` is self-reported**, therefore soft. Guards: it is in the
  manifest so a buyer can weigh it against source count and output length, and
  an inflated claim is refundable inside the window, recorded against ratio.

---

## 6. Phase 0 — gates the market, not the foundation

**Claim:** when an event happens, many independent parties produce substantially
the same synthesis within a short window.

Pick 8 events from the last 6 months across categories — a hackathon prize
drop, two protocol launches, a model release, an exploit, a framework major
version, a regulation, an airdrop criteria change. For each, collect public
artifacts published within 14 days covering the same ground, count **independent
authors**, and score pairwise substitutability on a three-point scale with two
raters.

| Metric | Meaning | Bar |
|---|---|---|
| Convergence count | Median independent artifacts per event = addressable buyers for one artifact | ≥ 5 |
| Overlap fraction | Share of pairs judged substitutable | ≥ 50% |
| Window | Days from event to median artifact | sets default half-life |
| Rater agreement | Cohen's κ between the two raters | ≥ 0.6, else the labels are noise |

**Stop rule: if convergence < 5 or overlap < 50%, stop and publish the negative
result.** Phases C onward do not begin.

**On raters.** This is a solo project, so "two raters" cannot mean the author
twice. Two independent passes by *different models* with the rubric, adjudicated
by the author only where they disagree, and κ reported. That is weaker than two
humans and must be labelled as such in `PHASE0.md`.

**What this does and does not measure.** It measures *supply of free
substitutes* — how many people independently produced the same thing. It does
**not** measure willingness to pay, and free public alternatives are in fact
competition. Convergence is necessary, not sufficient; §7's A/B is the demand-
side number and neither substitutes for the other.

**The precision bar is derived, not invented.** Buying is rational while
`P(useful) ≥ p/c`. At `p ≈ 0.15c` break-even is ~15%; operating target ~40%.
(Planned value. The shipped fraction is **0.10** — `AUDIT-CLAIMS.md` M4 — making
those 10% and 30%; see `docs/PHASE0.md` §5 and `pricing.ts`.)

**Deliverable:** `docs/PHASE0.md` — method, events, numbers, derivation.
**Numbers only, never the corpus.**

Phases A and B do not depend on this. Phase C onward do.

---

## 7. The measurement that is the proof

One number carries the pitch, the Bazantic submission and the sustainability
claim:

> How much does buying actually save versus redoing?

Run it against this repo's own ETHOnline prize analysis — a real artifact whose
cost side is recoverable from the session transcript.

```
Redoing:  N input, M output tokens · T seconds · $C
Buying:   n input, m output tokens · t seconds · $c
```

Until this exists, every claim about the product is a story.

---

## 8. Phases

| # | Phase | Depends | Acceptance |
|---|---|---|---|
| **A** | Extract `hedera-x402` | — | `gate.test.ts` green **before** `carpool-express` is deleted; package builds with no `carpool.policy.json` present; `pnpm build && pnpm typecheck && pnpm test` green at every commit |
| **B** | Rewrite `carpool-core` | — | Round-trip sign/verify; decay exact at 0–3 half-lives; magnet stable across key ordering |
| **0** | Convergence test | — | `docs/PHASE0.md` with the numbers and the derivation |
| **B1** | `apps/bench` replaces `apps/fleet` | B | x402 buyer runs against the registry; Zipf generator repurposed for load |
| **C** | `carpool-tracker` | 0, B | Retrieval metrics **within tolerance of Phase 0's**, computed from the committed metrics file and a regenerable event list — *not* from a committed corpus (§6); tracker receives vectors only |
| **D** | `registry` | A, B, C | Real paid fetch on testnet with a HashScan link ✓ **MET 2026-09-12 — see below** (`0.0.7162784@1789202339.427560739`); `body_hash` verified on read ✓; refund inside the window returns funds ✓ (stub facilitator only — not yet on chain) |
| **E** | Settlement wiring | A, D | Batch paying ≥3 payees; **anchor skipped on an empty epoch**; per-epoch root over manifest hashes |
| **F** | `mcp` + consent hook | D | Publish denied in a subagent, proven by test; search → judge → buy → inject completes |
| **G** | `dashboard` | D, E | Torrent view against real rows; decay bar drains live |
| **H** | Deploy + Bazantic | F, G | Public HTTPS; Gateway + Recipe; §7 A/B recorded |

**Phase D's first acceptance criterion was met on 2026-09-12**, by the run this
row now cites. Publish → search → buy → verify → `POST /settle` → anchor, against
the real Blocky402 facilitator and the real `@hiero-ledger/sdk` on Hedera
testnet: purchase `0.0.7162784@1789202339.427560739` (110,000 µUSDC to
`0.0.10475802`), settlement `0.0.10475802@1789202482.460233839` (109,500 µUSDC to
author `0.0.10475801`, batch 1, `SUCCESS`), anchor on topic `0.0.10496824`
sequence 1 at consensus `1789202493.460038026`. Phase E's criteria are partly
carried by the same run: the anchor was skipped on the following empty epoch and
the root was computed over this epoch's manifest hash plus its payout rows — but
the batch paid **one** payee, not ≥3, so that half of E is still only shown in
test. The raw evidence and an independent verifier are in
`docs/evidence/v2-first-testnet-run/`.

**Phase E's other half was met the same day, by a second run.**
`docs/evidence/v2-full-feature-run/` — 27 real x402 purchases, 25 settlement
batches and 15 HCS anchors on its own topic `0.0.10497461` — includes an epoch
that paid **13 distinct payees across two chunks**
(`0.0.10475802@1789204986.055709931`, 9 transfer-list entries, and
`0.0.10475802@1789204990.217343218`, 6), so the ≥3-payee half of E is no longer
test-only, and the 26-leaf root over that epoch's twelve manifest hashes and
fourteen payout rows is anchored at sequence 2 and re-derived by the run's own
verifier. The same run proved `POST /refund` on chain in both directions (money
returned in batch 4, refused after the window), `reconcile()` recovering a real
`pending` batch by memo, a consensus-reached failure classified `failed` with its
rows returned to claimable and then parked and unparked, all three
`POST /batches/:id/resolve` actions, `POST /delist`, `GET /owed` +
`POST /owed/replay`, and — the one that mattered most — the cross-process
`settle_lease`: two processes entering `settle()` in the same millisecond over one
`ledger.sqlite` produced **one** transfer and **one** credit, 2,500 µUSDC and not
5,000. `verify.py` re-checks all of it in 61 live mirror-node checks with zero
imports from this repository.

**What is still stub-only, stated so nobody reads the rows too widely.**
`EMPTY_CLAIM`, `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`, the
`DUPLICATE_TRANSACTION` branch of `reconcile`, a transfer list at the full 10
entries, and the body-integrity `502` with `refundUndelivered` behind it have
never run on chain. Neither has anything at volume: 27 purchases over two hours,
sequential. And every purchase, refund, settlement batch and HCS anchor in the
*tests* still runs against a stub x402 facilitator and a mocked
`@hiero-ledger/sdk`, in-process on 127.0.0.1:
`apps/registry/src/settlement.test.ts` fakes `Client`, `TransferTransaction` and
`TopicMessageSubmitTransaction` wholesale, and `src/testing/harness.ts` blanks
`CARPOOL_PRIVATE_KEY` before importing the server precisely so that no live
client can be built.

The *earlier* testnet evidence in this repository remains **v1's**:
`apps/settlement` (deleted by this restructure) settled 60 paid requests, one
batched `TransferTransaction` `0.0.10475802@1789137942.760688301` (4 payees,
`SUCCESS`, memo `carpool:batch:1:8643b7b8`, 1,591,862 tinybar in fees) and 13 HCS
anchors on topic `0.0.10475805` — the same 13-for-1 anchoring incident §8 cites
as the reason v2 skips empty epochs. It is genuine and it is not evidence about
v2's code; v2 now has its own, on its own topic.

### 8.1 Phase A — copy, re-point, then delete

The previous draft said "move" and claimed the tree stayed green. It does not:
`units`, `errors`, `db/index`, `auth` and `merkle` each have live importers
across five workspaces (`settlement/hedera.ts`, `settlement/ledger.ts`,
`settlement/server.ts`, `settlement/settler.ts`, `fleet/agent.ts`,
`carpool-express/index.ts`, `provider/upstream.ts`). Moving a file out from
under them is a red build, and step 2 was explicitly labelled "Red." while the
acceptance row demanded green at every commit.

The correct shape is **copy → re-point → delete**, never move:

| Step | Action | Tree state |
|---|---|---|
| A1 | Create `packages/hedera-x402`. **Copy** (do not move) `units`, `errors`, `merkle`, `hedera`, `auth`, `db/index` + their tests. Regenerate the lockfile. | green — duplicated, nothing re-pointed |
| A2 | Port `quotebinding.test.ts`'s fake-facilitator harness to `gate.test.ts` against the §8.3 interface. Mark it `describe.skip` until A3. | green |
| A3 | Implement `PaymentGate` by lifting the flow out of `carpool-express/src/index.ts`. Un-skip `gate.test.ts`. | green |
| A4 | Extract `SettlementLedger` (§8.2) and copy `settler.ts` across. Port the double-claim tests from `ledger.test.ts` into `hedera-x402`. | green |
| A5 | Rewrite `anchor.ts` in the new package: payload as an argument, **skip empty epochs**, per-epoch root. | green |
| A6 | Re-point every importer in the surviving workspaces to `@carpool/hedera-x402`. Regenerate the lockfile. | green — originals now unreferenced |
| A7 | **One commit**: delete `carpool-express`, `apps/provider`, `apps/provider-two`, and **only those originals A6 actually orphaned** — together with `pnpm-workspace.yaml`, root `package.json` scripts, `Dockerfile`, `docker-compose.yml`, `ci.yml` and a regenerated lockfile. | green |

**Rule: `pnpm install && pnpm build && pnpm typecheck && pnpm test` passes at
every step, including A2 (the new test is skipped, not failing).** Regenerate
the lockfile in the same commit as any workspace change — `--frozen-lockfile`
fails the moment the workspace list moves.

**A7 cannot delete the superseded `carpool-core` modules.** `types.ts`,
`key.ts`, `pricing.ts`, `policy.ts`, `workload.ts` and `universe.json` still
have live importers in code that outlives Phase A: `settlement/src/config.ts`
imports `loadPolicy`, `policyHash`, `PolicyFile` and `QueryClass`;
`settlement/src/ledger.ts` imports `pioneerPrice`, `riderPrice` and `split`;
and `apps/fleet` imports `cacheKey` and `zipfWorkload`. Settlement survives
until **Phase D** rewrites it, and fleet until **Phase B1** replaces it.

So the deletions are scheduled, not bundled:

| Module | Deleted in |
|---|---|
| `types.ts`, `key.ts`, `pricing.ts`, `policy.ts` | **Phase D**, with the settlement rewrite |
| `workload.ts`, `universe.json`, `universe.test.ts` | **Phase B1**, with the fleet → bench replacement |
| `carpool-express`, `apps/provider`, `apps/provider-two` | A7 |

Two smaller ordering facts, for whoever executes A1 and A4:

- A1 copies `db/index.ts` but **not** `db/schema.ts` (which is being split), so
  the copy must take its DDL as an argument rather than importing it.
- A4 copies `settler.ts` before A5 creates the new `anchor.ts`, so the copied
  settler must drop its `anchorEpoch` call; anchoring is re-attached in A5 as a
  separate step, which is also what decouples it from `settleEpoch`.

### 8.2 `settler.ts` cannot simply move

It is typed against the `Ledger` class being deleted — `unsettledAccruals`,
`createBatch`, `sumAccruals`, `markSettled`, `pendingBatches` — the `batch` DDL
lives in un-moved `db/schema.ts`, the conditional-claim logic and memo prefix
live in deleted `ledger.ts`, and the concurrency mutex is a module-level
singleton.

Extract behind an interface the package owns:

```ts
export interface SettlementLedger {
  unsettled(): { id: number; payee: string; amount: number }[];
  claimBatch(root: string, ids: number[]): { id: number; memo: string; claimed: number[] };
  sum(ids: number[]): number;
  markSettled(id: number, txId: string, status: string): void;
  pending(): { id: number; memo: string }[];
}
export function createSettler(deps: {
  ledger: SettlementLedger;
  client: Client;
  token: string;
  payer: string;
  mirrorUrl: string;      // reconcile needs it; v1 hard-coded testnet
  memoPrefix: string;     // v1 hard-coded "carpool:batch:"
}): Settler;
```

`hedera-x402` ships **`SqliteSettlementLedger`** as the reference
implementation over the shared `batch` DDL, so the package is usable without
the registry. The double-claim tests in `apps/settlement/src/ledger.test.ts`
(the only coverage of conditional claiming) **port into
`hedera-x402/settler.test.ts` in step A4** rather than being deleted with
`ledger.ts`.

The mutex becomes per-`Settler` instance state, not a module singleton.

### 8.3 `PaymentGate` — interface

Three corrections to the previous draft: `resolve()` conflated the cache key
with the quote, the outbox hook was dropped, and idempotency was unstated.

**`resourceKey` must be pure and separate from pricing.** The paid retry has to
find the issued requirements *without re-quoting* — that is the whole point of
the quote binding, and the regression `quotebinding.test.ts` exists to catch. If
the key only comes back from the same async call that computes the price, the
retry path has to re-price to learn its own key.

```ts
export interface PaymentGateOptions {
  facilitatorUrl: string;
  network: string;
  asset: string;
  quoteTtlMs?: number;                          // default 30_000

  /** Pure and synchronous. Must not touch the ledger or the network. */
  resourceKey(req: Request): string;

  /** Priced separately, and only on the un-paid path. */
  quote(req: Request, key: string): Promise<
    | { priceUnits: number; payTo: string; meta: Record<string, unknown> }
    | { notFound: true }
    | { gone: true }                            // delisted / expired
  >;

  /**
   * The payment settled. MUST be idempotent on `txId` — it is retried from the
   * outbox, and the caller's own ledger de-duplicates on the same id.
   */
  onPaid(ctx: PaidContext): Promise<void>;

  /** Settled, but the caller could not record it. Returns false if not durable. */
  owe(op: string, ctx: PaidContext): boolean;
}

export interface PaidContext {
  resourceKey: string;
  /** null when the facilitator returns no payer. Never the string "unknown". */
  payer: string | null;
  txId: string;
  paid: number;
  settle: SettleResult;                         // the raw facilitator result
  meta: Record<string, unknown>;
}
```

`owe()` is not optional decoration — v1 calls it on four distinct post-payment
failure paths. Without it the gate silently loses records of settled
transactions, which is the defect Carpool v1 was specifically fixed to remove.

### 8.4 `payTo` — decided

The previous draft never decided this, and the two options are not equivalent.

- **Author-direct** makes refunds impossible: the money is gone the moment it
  settles, and the registry cannot return it.
- **Settlement-account** makes the registry a custodian for one epoch, which is
  what makes a refund window possible at all.

**Decision: `payTo` is the registry's settlement account.** Consequences that
must be built, not assumed:

- Royalties are **held back** until `refund_deadline` passes. The settler must
  skip royalty rows whose purchase is still inside its window.
- `royalty` gains `available_at INTEGER NOT NULL`; the settler's `unsettled()`
  filters on `available_at <= now`.
- A refund is a **reversal**: the royalty row is voided and a
  `reason = 'refund'` payout to the buyer is accrued.
- **Refund window: 120 seconds** from delivery. Stated here because the
  previous draft referenced a window it never sized.
- **Refunds must be authenticated.** A `tx_id` is public on the mirror node, so
  a refund request carrying only a tx id lets anyone void an author's royalty.
  The request must be signed by the buyer's key over
  `(txId, magnet, "refund")`, and the signer must match `purchase.buyer`.
- **`payer: null` and `purchase.buyer NOT NULL` collide.** A settlement with no
  payer cannot open a purchase row. The gate records it via `owe()` for
  operator attention and returns 502; it does not invent a buyer.
- **`tracker_fee` is not refunded.** The search and delivery happened. Only
  `author_royalty` is voided.
- **The refund amount is `paid − tracker_fee`**, stated explicitly because
  "void the royalty and accrue a refund" admits two readings. The buyer gets
  back what they paid less the tracker's cut; the author gets nothing; the
  tracker keeps its fee. Both the void and the settler's claim must be
  **conditional** (void only where `settled_batch_id IS NULL`, claim only where
  `voided_at IS NULL`) so a refund landing as the settler runs cannot double-spend.
- **Custody bound, honestly:** at most the refund window plus one settlement
  epoch — *except* for balances under `DUST` (500 µUSDC), which carry forward
  indefinitely by design, and except while the settler is stopped. Both are
  stated rather than papered over.

## 9. Consent — non-negotiable

An MCP server **cannot detect it is inside a subagent**. The rule is enforced
client-side by a **`PreToolUse` hook**, shipped in Phase F with tests.

**Scoped to what a hook can actually see.** Hook input carries an agent
identifier, so *subagent* invocation is genuinely detectable and deniable. There
is no reliable field distinguishing a non-interactive (`-p`) or background run.
So the rule is:

The previous draft was circular: it said deny-by-default unless the hook has
recorded an approval, and that the hook writes the flag "when the user answers
the prompt". A `PreToolUse` hook fires **before** the prompt and cannot see the
answer, so deny-by-default means the prompt never appears and no approval is
ever recorded.

What the hook can actually decide:

> **Superseded by what was built, 2026-09-12.** The `auto` mode, the recorded
> prior approval, the `allow` outcome and the `PostToolUse` hook below were never
> implemented and are now removed rather than implemented. The requirement is
> **auto-listing always asks permission first, and can be turned off**, so
> `Decision` in `apps/mcp/src/consent.ts` has no `allow` member at all: no mode,
> permission mode or recorded history publishes without a human answering a
> prompt. Modes are `ask` (default) and `off`, read from `CARPOOL_PUBLISH_MODE`,
> and an unrecognised value is refused rather than treated as the default.
>
> No `PostToolUse` hook ever existed to record an approval, which is the other
> reason: the paragraph below described machinery nobody had written. The
> `PreToolUse` hook now *imports* `decideConsent` instead of reimplementing a
> subset of it — the two had drifted to the point where the tested function could
> return `allow` while the executed hook always asked. `src/consent.test.ts`
> spawns the hook as a process and asserts its output equals `decideConsent`'s.

| Condition | Decision |
|---|---|
| `agent_id` present (subagent) | **deny** |
| a non-prompting `permission_mode` (`bypassPermissions`, `acceptEdits`, `dontAsk`, `auto`) | **deny** — publishing must never be auto-approved |
| `CARPOOL_PUBLISH_MODE=off` | **deny** — the off switch |
| `CARPOOL_PUBLISH_MODE` anything but `ask`/`off` | **deny** — a typo in the off switch must not publish |
| unparseable input, or `dist/consent.js` absent | **deny** — fails closed |
| otherwise | **ask** — the only route to a publish |

Do not write "blocked outside interactive sessions" in the README. The hook
cannot see `-p` or background invocation; there is no documented field for it.
Write what it does: denies subagents, denies non-prompting permission modes,
otherwise asks.

- Two states: **off / ask**. `ask` is the default. (The original three included
  `auto`; see the superseded box above — there is no state that publishes without
  asking.)
- A pre-publish scan **strips** secrets, private-repo paths and internal
  hostnames rather than warning about them.
- The diff leads with **the question as it would be published** — often the
  leakiest single line.
- **Publish with edits**, not yes/no: the common case is 90% generally useful
  and 10% specific.
- Delisting stops new sales and **cannot recall copies already bought**. Say so
  plainly.

---

## 10. Search privacy — reduced, not solved

The tracker would otherwise see every question anyone asks, which is more
sensitive than the artifacts. The MCP server embeds **client-side** and sends
only the vector.

**Do not claim this is private.** Embedding inversion is a real attack —
published work recovers a large fraction of short inputs from their vectors
alone. Client-side embedding removes casual logging of plaintext questions; it
does not defeat an adversary holding the vectors.

What it actually buys, stated honestly:

- The registry operator cannot read questions without deliberately running an
  inversion attack.
- Queries are not sitting in plaintext access logs.

Constraints it imposes:

- **One embedding model for the whole registry**, served from `/.well-known`
  (§4). Vectors from different models are not comparable.
- Cost on the client: a small ONNX sentence-transformer, roughly 25 MB of
  weights plus a runtime dependency that is an order of magnitude larger.
  Measure this in Phase C before committing — it is a real install-size tax on
  an MCP server.

If the size cost proves unacceptable, the honest fallback is server-side
embedding with a stated retention policy, not a privacy claim that does not
hold.

---

## 11. UI — torrent client, done properly

The metaphor is load-bearing once the progress bar is **inverted**: in a torrent
it fills toward completion; here it drains toward expiry.

| Torrent | Carpool |
|---|---|
| Progress bar | **Decay — runs backwards** |
| ↓ speed | Purchases per hour |
| ETA | Time to expiry |
| Seeds / peers | Holders / current demand |
| **Files tab** | **Source list** |
| ▲/▼/ratio status bar | published / purchased / ratio |
| Pieces grid, priority, bandwidth caps | dropped — no analogue |

```
  NAME                            SIZE   HEALTH   SEED  PEER   RATE    LIFE     FARE
▸ ETHOnline 2026 · prize map      184K   ████░░    47     3   12/h   ████▒░   $0.31
  x402 on Hedera · setup           92K   ██░░░░   118     1    2/h   █▒░░░░   $0.09
────────────────────────────────────────────────────────────────────────────────────
▲ 12 published   ▼ 47 purchased   ratio 0.26   $14.20      47 rode · 265 drove alone
```

Detail tabs: **Info** (manifest) · **Peers** (buyers) · **Files** (sources) ·
**Trackers**.

Treatment: dense, monospace, dark, one accent colour reserved for decay. **Not**
skeuomorphic nostalgia — the information architecture of a torrent client with
the restraint of a terminal tool. Motion only where something is changing: the
LIFE bar draining, the FARE ticking down.

---

## 12. Sponsors

**Hedera** — association, facilitator-sponsored fees, batched HTS settlement
under the 10-entry limit, mirror-node verification. All proven; scripts move
into `hedera-x402` unchanged. **HCS earns a better role than before:** it
timestamps manifest hashes, which is provenance — proof an artifact existed,
unmodified, at a consensus time.

**Bazantic** — target **T3 "Agentify a New API"**. T1 is Continuity-only and
capped at $500.

Two corrections to the previous draft:

- The "Recipe is the only material difference" rule belongs to **T1**, not T3.
  The A/B is still the right experiment — it is §7's number and it is the most
  honest demonstration — but present it as evidence, not as a T3 requirement.
- **Bazantic is itself a paywall and names no chains.** Whether a Bazantic
  Gateway can front an endpoint that is *already* x402-gated on Hedera is
  **unverified**. Establish this in Phase H before building toward it; if it
  cannot, the fallback is a Bazantic-native relay account that pays Hedera on
  the caller's behalf, so every listed call still produces a verifiable testnet
  transaction.

**ENS** — provisioned, not built:

```ts
export interface AuthorIdentity {
  /** Opaque, stored on the artifact. Never parsed as a Hedera account id. */
  id(): string;
  /** The account royalties are actually paid to. */
  payout(): string;
  verify(manifestHash: string, sig: string): Promise<boolean>;
  display(): string;
}
```

`payout()` exists because nothing else produces `royalty.payee`: `author` is
opaque by rule, so the settler cannot derive a payee from it. **The payout
address is resolved once, at purchase, and pinned into `royalty.payee`** — not
resolved at settlement time. Otherwise an author who re-points their ENS name
between purchase and payout redirects money already owed to someone else.

`HederaAuthor` now, `EnsAuthor` later. `artifact.author` stays opaque and is
never parsed as a Hedera id; payout resolves through the interface.

**World** — dropped. A biometric step in front of a developer tool is friction
that buys nothing at this scale.

---

## 12a. MCP output limits

An MCP tool result is capped (25k tokens in Claude Code). A 184 KB artifact does
not fit in one `carpool_fetch` response.

- `carpool_fetch` returns the artifact **written to a file** plus a summary and
  the path, not the body inline. This is how large results are handled elsewhere
  in the harness and it keeps the context cost under the buyer's control.
- `carpool_search` returns manifests only — abstract, sources, provenance,
  price — which are small by construction.
- The buyer's agent reads what it needs from the file. The token saving in §7 is
  measured against that flow, not against pasting 184 KB into context.

---

## 13. Known-unsolved

Stated rather than hidden.

- **Self-purchase** to inflate health costs an author only `ρ_t` plus fees.
  Mitigated (distinct buyers, exclude accounts funded by the author, rate-limit
  publishes) — not solved.
- **Body availability.** Author deletes storage → artifact delisted, remaining
  royalties frozen. A retention deposit is the lever; it is not a guarantee.
- **Embedding drift.** The (model, dim) tuple is registry-wide and served from
  `/.well-known` (§4) — it is **not** a per-artifact column. A change is a
  re-index migration, not a background job, and during it `/search` returns
  **409** with the new tuple so clients re-embed rather than silently querying
  with incomparable vectors.
- **Cold start.** Seeded by the author's own history, opt-in. Nothing clever.
- **Competitive contexts.** Selling a hackathon prize analysis helps rivals.
  Probably fine — the analysis is not the edge — but it is a real objection in
  hackathons, trading and grants.
