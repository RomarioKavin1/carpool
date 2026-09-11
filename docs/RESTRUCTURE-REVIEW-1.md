# Restructure plan — hostile review #1

*Reviewed 12 Sep 2026 against `docs/RESTRUCTURE.md`, the repo on disk, and `docs/SWARM-REVIEW.md`. Every code claim was checked by reading the named file; line numbers refer to the files as they sit now. External claims are marked **[V]** (verified against a source today) or **[?]** (not verified).*

---

## 1. Verdict

**Not executable as written.** The plan is a good product document and a poor engineering plan: the §2 inventory names 15 of the 60 real source files and is silent on the other 45, including three whole workspaces (`apps/settlement`'s server/config/db, `apps/fleet`, `apps/dashboard`) and the package the extraction is coming out of (`packages/carpool-express`). Executing Phase A step 5 ("delete the old apps and the superseded core modules") as literally specified leaves `pnpm build` red on at least four workspaces, the Dockerfile unable to `COPY`, CI's docker job failing, and every root `package.json` script dangling. None of that is hard to fix; all of it is unmentioned, and a plan whose riskiest phase is "moves working code" cannot leave the move-list two-thirds incomplete.

Three deeper problems are design-level rather than inventory-level:

1. **The payment rail has no unit coverage after the extraction.** Every test that exercises the 402 → verify → settle path (`quotebinding.test.ts` ×4, `index.test.ts` routes ×5) is written against `carpool(opts)` with a `PolicyFile` and a `QueryClass` URL. The plan deletes those without saying what replaces them; Phase A's only acceptance is a live testnet smoke. The regression `quotebinding.test.ts` exists for — re-quoting on the paid retry under a moving price — is *more* likely in v2 (decay ticks continuously) and would land untested.
2. **Client-side embedding and per-artifact `embedding_model` are not reconcilable as specified.** A sqlite-vec `vec0` table has one fixed dimension **[V]**; a query vector is only meaningful against artifacts embedded by the *same* model, version and quantisation. So the tracker must *mandate* one model and every client must ship it; `embedding_model` per row is then a constant, not a per-artifact attribute, and "the tracker never receives query text" also needs a caveat: vec2text recovers ~92% of 32-token inputs exactly from dense embeddings **[V]**, and a research question is about 32 tokens.
3. **The money path has an unstated decision that everything downstream depends on:** who is `payTo`? If the buyer pays the author directly (Carpool's pioneer model), the registry never holds funds and the refund window in Phase D is unfundable. If the buyer pays the settlement account (Carpool's rider model), the registry is custodian of every sale for an epoch and royalties must be *held back* past the refund deadline — the settler as written (`EPOCH_SECONDS=600`, accrue-at-purchase) will pay authors before a 120 s window closes only by luck of timing, and there is no royalty reversal path in the schema.

The plan is fixable in a day of writing. The parts that are right — content-addressed magnet, decay-only, `ρ_t`, the PreToolUse hook (now genuinely enforceable, see §4), keeping the quote-binding pattern — are right for the reasons given.

---

## 2. Blocking problems (ordered by severity)

### B1. Phase A step 5 breaks the monorepo; the plan does not list what it breaks

**What breaks.** After deleting `apps/provider`, `apps/provider-two`, `types.ts`, `key.ts`, `pricing.ts`, `universe.json`, `workload.ts`, `settlement/src/ledger.ts`:

| Workspace | Why it no longer builds | Plan mentions it? |
|---|---|---|
| `apps/settlement` | `server.ts:6-9` imports `./config.js` (imports `loadPolicy`, `QueryClass` from core — deleted), `./ledger.js` (deleted), `./settler.js` (moved). `config.ts:11-17` imports `loadPolicy, policyHash, PolicyFile, QueryClass`. `db/schema.ts` and `db/index.ts` are not in any move/delete list. `scripts/reset.ts:4` imports `../db/index.js`. `scripts/doctor.ts` is not in the "move as-is" list (only `associate`, `create-accounts`, `distribute`, `create-topic` are). | Only `ledger.ts`, `settler.ts`, `anchor.ts`, `hedera.ts`, `auth.ts`, `merkle.ts`, four scripts. **`server.ts`, `config.ts`, `db/*`, `doctor.ts`, `reset.ts` are unmentioned.** |
| `apps/fleet` | `lib.ts:3` imports `cacheKey, zipfWorkload, QueryClass, WorkItem`; `agent.ts:11` imports `USDC_TOKEN_ID_TESTNET`; `scripts/bootstrap.ts:15` likewise. All deleted or moved. 7 tests. | **Never mentioned anywhere in the plan.** §3's `bench/` ("load generation") is presumably its successor; not stated. |
| `apps/dashboard` | Does not import core, but `lib/api.ts` reads `/state`, `/events`, `/settle` from the settlement server that no longer exists; `lib/fixture.ts` carries a `SAMPLE_STATE` of lineages/consumers. Builds, serves nothing. | §3 lists `dashboard/ torrent-style UI` as a target; §2 never says whether the existing app is rewritten in place or deleted. |
| `packages/carpool-express` | `index.ts` is gutted for the extraction; `ledger.ts` (`LedgerClient`, posts to `/ledger/quote|pioneer|rider|refund-due`) and `bodystore.ts` (keyed by lineage id) are v1-only and unmentioned. `package.json` also declares `@x402/express` which nothing imports. | Named only as the *source* of the extraction. **Its own fate is unstated.** |
| Root | `package.json` scripts `dev:provider`, `fleet`, `bootstrap:fleet`, `reset:ledger`, `preflight` reference deleted workspaces. `Dockerfile:20-24` `COPY apps/provider/package.json`, `apps/provider-two/package.json`, `apps/fleet/package.json` — a missing source path fails the build. `docker-compose.yml` defines `provider` and `provider-two` services. `.github/workflows/ci.yml` runs `pnpm build && typecheck && test` on Node 20.19/22.x *and* a `docker/build-push-action` job — both red. `carpool.policy.json`, `.env.example` (`PROVIDER_*`), `README.md`, `HANDOFF.md`, `CONTRACT.md`, `SUBMISSION.md`, `X402-RESEARCH.md`, `PLAN.md` all describe v1. | `carpool.policy.json` appears only in Phase A's acceptance ("no `carpool.policy.json` present"). Nothing else. |

`turbo.json` `build.dependsOn: ["^build"]` means one red workspace fails the root build. `pnpm install --frozen-lockfile` (CI and Dockerfile) fails the moment a workspace `package.json` changes without regenerating `pnpm-lock.yaml`.

**Fix.** Replace §2 with a complete file-level disposition: every one of the 60 `.ts` + 2 `.tsx` source files, every `package.json`, the Dockerfile, compose, CI, root scripts, and every top-level `.md`, each tagged *move / rewrite / delete / keep*. State explicitly: `apps/settlement`, `apps/fleet`, `apps/provider*`, `packages/carpool-express` are **deleted as workspaces** once their survivors have moved; `apps/dashboard` is **rewritten in place** (or deleted and recreated); `pnpm-lock.yaml` is regenerated; Dockerfile/compose/CI are rewritten for `registry`, `mcp`, `dashboard`.

### B2. The settler cannot move without a store interface, and `batch` does not "come from hedera-x402 unchanged" — no batch code is in anything that moves

**What breaks.** `settler.ts:3` imports `type { Ledger } from "./ledger.js"` and uses `ledger.unsettledAccruals()` (l.72), `ledger.createBatch(root, ids)` (l.81), `ledger.sumAccruals(ids)` (l.96), `ledger.markSettled(id, txId, status)` (l.88, 100, 115), `ledger.pendingBatches()` (l.133). `anchorEpoch` (l.121) uses `ledger.allBatchTxIds()`, `allAccruals()`, `lineageCount()`, `consumerCount()`, `event()`. The plan deletes `ledger.ts` and says `batch` "comes from `hedera-x402` unchanged" (§4) — but the `batch` DDL is in `apps/settlement/src/db/schema.ts:68-71` (not moved), the memo format `carpool:batch:${id}:${root.slice(0,8)}` is in `ledger.ts:346` (deleted), the conditional-claim transaction that the settler's correctness note (l.77-79, "R14") depends on is `ledger.ts:336-359` (deleted), and `reconcilePending` matches mirror-node transactions *by that memo* (`settler.ts:147-151`). Also `settleEpochInner` reads `process.env.CARPOOL_PRIVATE_KEY` directly (l.68) and the concurrency mutex is a **module-level `let settling`** (l.41) — a package-level singleton, not per-instance.

**Fix.** Phase A step 2 must define, in `hedera-x402`, a `SettlementStore` interface (`unsettledAccruals`, `createBatch`, `sumAccruals`, `markSettled`, `pendingBatches`) and ship a reference SQLite implementation carrying the `batch` DDL and the conditional claim, with `ledger.test.ts`'s "concurrent settlement cannot double-claim" tests (12 tests, l.160-186) ported to it. Make the memo prefix a constructor option (`memoPrefix`), the credentials an argument, the mutex an instance field. `reconcilePending` must take `mirrorUrl` and the memo prefix as parameters (it hard-codes testnet, l.138).

### B3. The proposed `PaymentGate` interface does not cover what `index.ts` actually does

`buildRequirements` (l.244-258) closes over `server` (an `x402ResourceServer` with `ExactHederaScheme` registered for `hedera:*`, l.187-190), `network` (l.185), and **hard-codes `USDC_TOKEN_ID_TESTNET` as the asset** (l.253) — mainnet is impossible without an edit. `send402` (l.260-274) closes over nothing but needs the absolute `resourceUrl(req)` (l.129-132), which is computed from an Express `Request`. The `issued` LRU (l.226-229) is keyed `${cacheKey}|${amount}|${payTo}` (l.176-178) — the caller's *resource key* is part of the binding and the plan's interface (price fn, payee resolver, ledger callbacks) has no slot for it. `ensureInit` (l.234-242) is a one-shot facilitator `/supported` fetch with drop-on-failure; the 402 path returns 503 when it fails (l.371-377). The paid path (l.406-422) yields `payer = s.payer ?? "unknown"` — a real value the ledger will receive; `purchase.buyer TEXT NOT NULL` would store `"unknown"` and `distinctBuyers` would count it. After settle, *every* failure to deliver must produce a refund obligation via `owe("refund_due", …)` (l.432-445, 485-497) — for v2 that is "body missing / hash mismatch after payment", and it is the outbox's real job; the plan's "generalise `OutboxOp` to an open string" ignores that `replayOutbox` (`outbox.ts:77-98`) *dispatches* on the three literal ops and its `OutboxLedger` interface (l.66-70) names them — generalising the type without changing replay to a handler map is a type change with no behaviour.

What the interface must also decide and does not: **`payTo`.** Carpool pays the provider directly for pioneers and the settlement account for riders (l.360-363). §5's "`ρ_a` author · `ρ_t` tracker · remainder to settlement" only works if the *whole* sale lands at the settlement account and the author is paid by batch. That makes the registry a custodian and makes refunds possible; author-direct `payTo` makes refunds impossible. The plan never says which.

**Fix.** Specify the gate as:

```ts
interface PaymentGateOptions {
  facilitatorUrl: string; network: Network; asset: string;   // no testnet constant
  quote(req): Promise<{ resourceKey: string; amount: number; payTo: string; meta?: unknown }>;
  onSettled(ctx: { resourceKey; amount; payTo; payer: string | null; txId; meta }): Promise<void>; // MUST be idempotent on txId
  owe(op: string, txId: string, args: unknown): void;        // outbox hook
  quoteTtlMs?: number;
}
```

with `payer: string | null` (never `"unknown"`), the issued-LRU keyed on `resourceKey|amount|payTo`, and the express `Router` as one thin adapter over a transport-agnostic core so a Fastify/raw-http registry is possible later. State in §5: **all sales settle to the settlement account; authors are paid in batches after the refund deadline.**

### B4. Zero surviving tests on the payment rail

Test disposition against the plan (109 today):

| File | Tests | Under the plan | Survives as-is? |
|---|---|---|---|
| `carpool-express/quotebinding.test.ts` | 4 | The only tests of 402 issue → paid-retry binding → verify-against-issued. Built on `carpool({policy, …})` + `/v1/pool.apy?pool=`. | **No — must be rewritten against `PaymentGate`.** |
| `carpool-express/index.test.ts` | 11 | `chooseRole` ×3, `cacheKey` ×3, routes ×5 — all `QueryClass`. | No |
| `carpool-express/retry.test.ts` | 4 | `fetchWithRetry` over `Upstreams`. Plan: "no upstream". | No |
| `carpool-express/outbox.test.ts` | 7 | 6 generic; "routes each op to the right ledger call" is pioneer/rider-specific. | 6 with edits |
| `carpool-express/bodystore.test.ts` | 7 | `bodystore.ts` unmentioned; v2 store is content-addressed. | No |
| `core/policy.test.ts` | 10 | `loadPolicy` ×4 and shipped-file ×4 die; `policyHash` ×2 adapt to `canonicalHash`. | 2 |
| `core/key.test.ts`, `pricing.test.ts` | 12 | Deleted modules. | No |
| `core/universe.test.ts`, `workload.test.ts` | 13 | "Moves to bench". | Moves if bench exists |
| `core/errors.test.ts` | 5 | `errors.ts` moves to `hedera-x402` per §2 — but see U3. | 5 |
| `settlement/ledger.test.ts` | 12 | `ledger.ts` deleted. Includes the *only* tests of `createBatch` conditional claim (defect C) and txId idempotency (defect I). | No — **these guard settlement double-pay** |
| `settlement/auth.test.ts`, `merkle.test.ts`, `settler.test.ts` | 17 | Move. | 17 |
| `fleet/*.test.ts` | 7 | Workspace unmentioned. | ? |

Surviving unchanged: **≈30 of 109**, none of which touches a 402 header, a facilitator call, a settle result, or a batch claim. Phase A's acceptance ("a smoke test settles a real testnet payment") is a live test that cannot run in CI (needs `.env` with funded ECDSA keys) and cannot express "does not re-quote on the paid retry".

**Fix.** Make Phase A step 4 *test-first*: port `quotebinding.test.ts`'s fake facilitator (`/supported`, `/verify` recording `paymentRequirements`) to `hedera-x402/src/gate.test.ts` against `PaymentGate` **before** deleting `index.ts`, and port `ledger.test.ts` l.160-186 to the `SettlementStore` reference implementation. Add to the acceptance row: "`gate.test.ts` proves paid retry verifies against issued requirements after the price function returns a different value".

### B5. Client-side embedding vs per-artifact `embedding_model`

**What breaks.** `vec0` declares one dimension per table and rejects mismatches **[V]**; changing model means rebuilding the table **[V]**. Cosine between vectors from *different* models is noise, and even the same architecture at different quantisation (`q8` vs `fp32`) or different library versions gives different vectors. So:

- The tracker must publish exactly one `(model, revision, dtype, dimension)` tuple. Every MCP client must run *that* tuple. `embedding_model` per artifact row is then a constant until a migration, and the column's stated purpose ("a model change must be detectable") is satisfied by a single tracker-level value plus a required `embedding_model` parameter on `/search` that returns 409 on mismatch. The plan has no such parameter.
- Migration: the tracker *does* hold `question` and `abstract` in plaintext (§4 schema), so it can re-embed artifacts server-side. That is fine — but it means artifact embedding is server-side and only *query* embedding is client-side. Say so, or the "client-side embedding" in Phase C's acceptance is ambiguous about which half.
- Cost: `Xenova/all-MiniLM-L6-v2` quantised ≈ 23 MB, 384-d **[V]**; `onnxruntime-node` installs at ≈ 257 MB **[V]**; first call downloads the model to `node_modules/@huggingface/transformers/.cache` and lazy-loads the pipeline on first request **[V]**, so the first `swarm_search` in a session costs seconds and a network fetch. An MCP server that is auto-started per Claude Code session pays that every session unless the cache dir is pinned. None of this is in Phase C or F.
- Privacy: dense embeddings are invertible — vec2text reports ~92% exact recovery for 32-token inputs **[V]**. "The tracker never receives question text" is true and "the tracker cannot read the question" is false. The plan states the first and implies the second (§10: "more sensitive than the artifacts").

**Fix.** §10: "The tracker mandates one embedding tuple, served at `GET /tracker/config`. Clients embed queries locally with that tuple and send `{vector, embedding_model}`; mismatch is a 409. Artifacts are embedded server-side from the manifest's `question`+`abstract`. A model change is a tracker-side re-embed plus a config bump; stale clients fail loudly." Add: "Vectors are invertible; this is a *logging* protection (the tracker stores no vectors from queries and never logs them), not cryptographic privacy." Pin the model to a `models/` dir shipped with the MCP package and warm it at server start.

### B6. The refund window is not implementable against the schema and settler as specified

`royalty` rows accrue at purchase (that is the only place §5 lets them come from); `settleEpoch` sweeps every unsettled row every `EPOCH_SECONDS` (600 s default, `server.ts:96`). A 120 s window (the number is in `SWARM.md` §8; `RESTRUCTURE.md` never states the length) will usually close before the sweep but not always, and nothing enforces it. On refund there is no way to *reverse* an author royalty: `royalty.reason` is `author_royalty | tracker_fee`; there is no `refund` payout reason, no `status`/`reversed` column, no `hold_until`. `purchase.refund_state` (`none | window | refunded`) is adequate for `refundRate`, but "refund honoured" in Phase D's acceptance needs money to move back to the buyer from an account that holds it — see B3's `payTo` question.

**Fix.** Add `royalty.available_at INTEGER NOT NULL` (= `purchase.refund_deadline`); settler selects `WHERE settled_batch_id IS NULL AND available_at <= now`. Add `reason = 'refund'` rows payable to the buyer, and on refund set the matching royalty rows' `settled_batch_id = -1` (void) or add `voided INTEGER`. State the window length in the plan.

### B7. `health` zeroes every new artifact

`health(a) = freshness · (1 − refundRate) · min(1, distinctBuyers/5)`. With zero buyers the third term is 0, so every artifact is unrankable until five distinct accounts have bought it blind. Event-shaped demand is front-loaded; the formula excludes exactly the hours the product exists for. `freshness` and `refundRate` are computable from `artifact` and `purchase`; `distinctBuyers` is computable but should exclude `buyer = author` (§13 says so; the formula does not). The `peer` table's maintained counters duplicate what `purchase` already derives and will drift.

**Fix.** Use a prior: `(distinctBuyers + 1) / 6`, or make health a *tie-breaker* among candidates above a similarity threshold rather than a multiplier. Derive `peer` as a view. Define `freshness` (presumably `0.5^(age/halfLife)`) in the plan; it is referenced, not defined.

### B8. `anchor.ts` — the fix is necessary but not sufficient

Verified dependencies of `anchor.ts` (36 lines): `loadConfig()` → `cfg.policyHashHex` (l.19, 26); `process.env.HCS_TOPIC_ID` (l.14); `ledger.allBatchTxIds()`, `allAccruals()`, `lineageCount()`, `consumerCount()` (l.22-25); `ledger.event("anchor", message)` (l.34); `merkleRoot` (l.23). "Take the payload as an argument" removes `loadConfig` and the four ledger reads but leaves: (a) the write-back `ledger.event` — the anchor records itself; a pure function needs to *return* the message for the caller to persist; (b) the coupling — `settleEpochInner` calls `anchorEpoch` internally (`settler.ts:121`), so Phase E's "root covers the epoch's manifest hashes" is an anchor of a *different thing at a different time* (publish-time provenance, not settlement) and must be decoupled from `settleEpoch`; (c) `merkle.ts` is listed "unchanged" but its signature is `merkleRoot(leaves: [string, number][])` with leaf `sha256("payee:amount")` (l.13, 18) — it cannot take manifest hashes without abusing `amount`; (d) the live DB shows what "unchanged" behaviour actually does: **10 anchor events (the plan says six), all ten carrying the identical root `27e4e54d…`, nine of them with `batchTxIds: []`** — a cumulative root anchored every 600 s over empty epochs. Porting it "parameterised" ports that.

**Fix.** `hedera-x402` exports `merkleRoot(leaves: string[])` (leaf = `sha256(leaf)`) and `anchor(client, topicId, payload: object): Promise<{ txId, sequence }>` — no ledger argument, no env read. Skip empty epochs. Provide `merkleProof(leaves, leaf)` — HCS provenance is only checkable if a buyer can obtain the inclusion path (the earlier review said this; the plan dropped it). Note HCS chunks are 1024 bytes, default max 20 **[V]** — anchor roots, never lists.

### B9. Phase 0 measures the supply of free substitutes, not willingness to pay

Counting "independent authors who published public artifacts within 14 days" is measurable (search + dedupe by author; discovery-biased toward what ranks). But ≥5 free public write-ups on an event is evidence that a *free* substitute exists — the opposite of a purchase signal. The market's buyer is the agent that runs *before* those posts are indexed, or that values a machine-consumable body over a blog post; the metric does not see either. "Two raters" on a solo project is one rater and a friend; `SWARM.md` §3 said "report agreement", `RESTRUCTURE.md` dropped it — add Cohen's κ or the second rater is decoration. The break-even derivation uses `p ≈ 0.15c`, but §5 lets authors set `P ≤ cost × margin` with `margin` unspecified, so 0.15 is asserted, not derived from the plan's own pricing. And `SWARM.md` had a stop rule ("or stop and publish the negative result"); `RESTRUCTURE.md` §6 has bars in a table and no consequence.

**Fix.** Keep the convergence count as a *necessary* condition and add one *sufficient*-side measurement that is actually about paying: a lag distribution (event → first adequate public artifact, in hours) — the window in which a paid artifact has no free competitor — and the §7 A/B on a real question, which is the closest thing to WTP the project can produce. Restore the stop rule and κ. Derive `p/c` from a stated `margin`.

### B10. Consent hook: enforceable for subagents, not for "outside interactive sessions"

Good news the plan can lean on: PreToolUse input now carries `agent_id` ("Present only when the hook fires inside a subagent call") and `agent_type`, hooks fire for MCP tools inside subagents, MCP tools match as `mcp__<server>__<tool>`, and deny is exit 2 or `permissionDecision: "deny"` **[V]**. So "`swarm_publish` blocked inside a subagent, proven by test" is achievable. But the docs list **no field for print mode (`-p`), background, or scheduled runs** **[V]**; §9's "blocks publish outside interactive sessions" overstates what the hook can see. Also unchanged from the earlier review: "strips secrets, private-repo paths and internal hostnames" — secrets and repo paths are pattern-matchable; hostnames and client names are NER, and no component or budget exists for it. "Publish with edits" needs an editing surface; MCP elicitation is not named.

**Fix.** §9: "Denied when `agent_id` is present. Non-interactive sessions cannot be detected by hook input; the MCP server additionally refuses publish unless `CARPOOL_PUBLISH=1` is set in the *interactive* profile only." Split the scanner into "blocking: secret shapes (secretlint), absolute paths, `.git` remotes that are non-public" and "user-maintained never-publish list for names/hosts". Name elicitation with a refuse-if-unavailable fallback.

### B11. MCP output cap defeats the headline example

Claude Code limits MCP tool results to 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`) **[V]**. The plan's own UI mock (§11) shows the ETHOnline prize map at **184K** — roughly 45k tokens. `swarm_fetch` → "drops it straight into context" is truncated for the plan's flagship artifact. Bodies capped at 2 MB (`SWARM.md` §8) are 500k tokens.

**Fix.** Phase F: fetch writes the body to a scratch file and returns `{path, abstract, sections[]}`; add a `swarm_read(magnet, section)` tool; count the *read* tokens in the §7 A/B.

### B12. The evidence archive will copy an empty database

`apps/settlement/data/ledger.sqlite` is **4,096 bytes**; `ledger.sqlite-wal` is **1,998,232 bytes**; `PRAGMA journal_mode` = `wal`. Every row (52 lineages, 60 consumers, 26 accruals, 1 batch, 10 anchors) is in the uncheckpointed WAL. "Move `ledger.sqlite` to `docs/evidence/`" moves the header. Also the numbers in §2 are wrong: **10** anchors, not six; the one batch paid **4** payees.

**Fix.** `sqlite3 ledger.sqlite "PRAGMA wal_checkpoint(TRUNCATE)"` first, or — better — export `batch`, `consumer(tx_id, payer, paid, ts)` and the ten anchor messages to `docs/evidence/*.json` with HashScan links, and do not commit a binary. Correct the counts.

---

## 3. Inventory errors

| Plan says | Filesystem says |
|---|---|
| "65 TypeScript files" | 65 `.ts` includes 5 generated files under `apps/dashboard/.next/types/` (build output, gitignored) and `next-env.d.ts`. Real hand-written sources: **59 `.ts` + 2 `.tsx`**. "Roughly a third survives" — the §2 table names 15 files, 9 of them "move as-is"; the rest of the third is unnamed. |
| `settlement/src/scripts/*` — "`associate`, `create-accounts`, `distribute`, `create-topic` … move as-is" | Directory has **six** scripts: also `doctor.ts` (preflight; only depends on `hedera.ts`) and `reset.ts` (depends on deleted `db/`). Neither is dispositioned. |
| `settlement/src/anchor.ts` "anchors a cumulative root over `(payee, amount)`" | Correct. Omits: it also anchors `lineageCount`, `consumerCount`, `policyHash`, `batchTxIds`, and writes an `event` row. |
| "`batch` comes from `hedera-x402` unchanged" | No file that moves contains `batch`. DDL is `apps/settlement/src/db/schema.ts:68-71`; claim logic is `ledger.ts:336-359` (deleted). |
| `settlement/src/merkle.ts` "Unchanged" | Typed `[string, number][]`, leaf `payee:amount`. Cannot carry manifest hashes unchanged. |
| `carpool-core/src/policy.ts` "Canonical JSON hashing → `canonicalHash()`" | `canonical` is module-private (`policy.ts:53`, not exported); `policyHash` is the export and the file imports `ALL_CLASSES` from deleted `types.ts` for its zod schema. It is a 12-line extraction, not a move. §2 puts it in `hedera-x402`; §3 lists "canonical hashing" under `carpool-core`. **Both cannot be true without a dependency between the two packages, whose direction is unstated.** |
| `carpool-core/src/units.ts` → `hedera-x402` | Then `carpool-core`'s decay pricing (µUSDC) depends on `hedera-x402` for `CENT`/`USDC_DECIMALS`, or duplicates them. Direction unstated. |
| `carpool-core/src/errors.ts` → `hedera-x402` "Upstream error classification" | `errors.ts` classifies *upstream fetch* failures for `fetchWithRetry`. The same plan says "No roles, no upstream." Nothing in `hedera-x402` would import it. |
| "`apps/settlement/data/ledger.sqlite` — 60 settled payments, one HTS batch, six HCS anchors" | 60 ✓, 1 batch ✓ (`0.0.10475802@1789137942.760688301`, 4 payees), **10** anchors, 9 with empty `batchTxIds`. |
| Delete list: "pioneer/rider, `chooseRole`, `Upstreams`" | Also dies and is unlisted: `fetchWithRetry`, `LedgerClient` (`carpool-express/src/ledger.ts`), `MemoryBodyStore`/`FileBodyStore` (`bodystore.ts`), `IssuedQuote.cls/key/maxAge`, `parseClass`, `toParams`, `parseMaxAge`, `X-Carpool-Quote`/`X-Carpool-Age`/`X-Carpool-Max-Age` headers, `/v1/quote`, `/.well-known/x402` (in `apps/provider/src/server.ts:60-73`). |
| Target `apps/bench/` — "Phase 0 tooling · the A/B harness · load generation" | No existing workspace is mapped to it. `apps/fleet` (7 tests, 13-account bootstrap, `accounts.json` with **private keys**, gitignored) is the obvious source and is never named. |
| `AuthorIdentity { id(); verify(); display() }` | Identical to `SWARM.md` §10. The earlier review's point that it needs `payout(): string` for "payout resolves through the interface" to be possible is unaddressed; `royalty.payee` must be a Hedera account id and nothing produces one. |

---

## 4. Unsupported or impossible claims

| Claim | Where | Evidence |
|---|---|---|
| Bazantic: "target T3 … The A/B must keep the Recipe as the only material difference" | §12, §7 | The same-prompt/same-model A/B with video is **Track 1's** requirement ("Help an Agent Use Your Hackathon Project", Continuity-only, 2×$500) **[V]**. **Track 3 "Agentify a New API"** ($500/$300/$200) requires: a previously unavailable API integrated into Bazantic, a working Gateway and Recipe, and reusability **[V]**. Doing the A/B is fine as the §7 measurement; it is not what T3 judges. |
| A Bazantic Gateway can front the x402-gated registry | §8 Phase H, §12 | Bazantic's own site: developers "provide an API specification and Baz AI builds your full agent stack"; "Agents pay through x402 and MPP" — **Bazantic is the paywall**, and it names no chains **[V]**. A Bazantic Gateway in front of a Hedera-x402 endpoint is either double-paywalled or requires Bazantic to pay Hedera x402 upstream, which is unverified **[?]**. Phase H's acceptance may be unsatisfiable as designed; needs a spike. |
| "An MCP server cannot detect it is inside a subagent … so the rule is enforced client-side by a PreToolUse hook that blocks publish outside interactive sessions" | §9 | First half correct. Hook *can* see `agent_id` **[V]**; hook *cannot* see `-p`/background/scheduled **[V]**. "Outside interactive sessions" is not enforceable as stated. |
| "Embed client-side … the tracker never receives question text. This costs a local embedding model and is worth it." | §10 | Cost is 23 MB model + ~257 MB `onnxruntime-node` + seconds of cold start per MCP process **[V]**; benefit is weaker than stated (inversion, B5). Worth it — but say what it costs and what it buys. |
| "`health` … computable" (implicit) | §4 | Computable, and zero for every new artifact (B7). |
| "Delisting stops new sales and cannot recall copies already bought" | §9 | True. Omits the registry's *own* copy at `body_uri` — retained? deleted? `redacted`/`delisted_at` exist; retention policy does not. |
| "`estimatedCostUsd` … an inflated claim is refundable inside the window, recorded against ratio" | §5 | `peer.refunds_issued` exists; nothing in §4 records *why*. Ratio-as-reputation needs a `reason` on refund. |
| "A pre-publish scan **strips** secrets, private-repo paths and internal hostnames" | §9 | Hostnames/client names are not pattern-matchable (earlier review 2.4, **[V]** then). No component in §3 owns this. |
| "the Zipf generator moves to `bench` and is repurposed for load testing" | §2 | `workload.ts` is 100% `QueryClass`/`UNIVERSE`-shaped (`workload.ts:63-69, 104-130`). Only `mulberry32` and `zipfCumulative/zipfPick` (≈30 lines) are reusable. |
| sqlite-vec "index" (implicit: works with this repo's stack) | §3 | sqlite-vec 0.1.9, pre-1.0 **[V]**; documented **silent** failure where the extension loads but registers no functions against a newer bundled SQLite **[V]**. Repo pins `better-sqlite3@11.10.0`; Node on this machine is **v26.0.0** while `.nvmrc` says 20.19.0 and `scripts/check-node.mjs` rejects >22. Add `SELECT vec_version()` at startup. |

---

## 5. Gaps — absent from the plan entirely

1. **Buyer key custody and spend caps.** `swarm_fetch` pays, so the MCP server holds an ECDSA key and USDC. Carpool's fleet already has the pattern (`apps/fleet/src/agent.ts:19-43`, `maxAmountPerPayment`). Not mentioned. Also how a user funds the account (Circle faucet, 20 USDC/2 h).
2. **Rate limiting "per account" on a free, unauthenticated endpoint.** Search has no payment, hence no payer identity. Needs a signed request or key, and a table/store for counters. Neither exists in §4.
3. **`hedera-x402` ↔ `carpool-core` dependency direction** (see §3). `hedera-x402` must not import `carpool-core` or it is not product-independent.
4. **The `SettlementStore` interface** the settler needs (B2).
5. **Publish authentication.** Who may `POST /publish`? `auth.ts` is a shared secret for one operator's own middleware; publishers are strangers. Signature over `manifest_hash` by `author` needs key resolution (mirror node `GET /accounts/{id}` → key; rotation; multi-sig) — the earlier review's gap 8, still open.
6. **`half_life_days` unbounded**; a 3650-day half-life never expires. Earlier review gap 9, still open.
7. **`body_uri` storage design**: cap, quota per author, retention on delist, backup, who pays. §13 says "retention deposit is the lever" — no `deposit` column, no phase.
8. **Documentation disposition.** `README.md`, `HANDOFF.md` (still says "no payment has ever settled"), `CONTRACT.md`, `SUBMISSION.md`, `X402-RESEARCH.md` (keep — it is the valuable part), `PLAN.md`. Phase A's own rule in `PLAN.md` §0.5 ("no document referring to a state that no longer exists") is violated by the plan itself.
9. **Near-duplicate body check on publish.** Earlier review 2.2 fix (b); `SWARM.md` §6 "the tracker ranks between them" implies it; `RESTRUCTURE.md` drops it. Without it a plagiarist republishes a bought body under a fresh manifest.
10. **Merkle inclusion proof endpoint** (B8).
11. **`freshness` definition** (B7).
12. **Refund window length and funding** (B6).
13. **Facilitator dependency.** Every paid fetch goes through Blocky402 (`api.testnet.blocky402.com`, feePayer `0.0.7162784`). One third party's uptime is the registry's uptime; no fallback is configured (`X402-RESEARCH.md` names `x402.org/facilitator` as one). Not a v2 regression, but the plan calls the rail "proven" without saying proven-through-whom.
14. **Testnet resets.** HCS provenance on testnet is not durable (earlier review, **[V]** then). Fine for a demo; §12 calls it "proof an artifact existed" without the caveat.

### SWARM-REVIEW follow-through — fixed, reworded, or dropped

| Earlier finding | Status in `RESTRUCTURE.md` |
|---|---|
| 2.1 Phase 0 measures self-repeat | **Changed** to public cross-author convergence. New defects: B9. Stop rule and κ **dropped** relative to `SWARM.md`. |
| 2.2 magnet = sha256(question) | **Fixed** (sha256(manifest), `scope` column). Near-dup body check **dropped**. |
| 2.3 reuse is a fork | **Genuinely changed** — now an extraction because v1 is deleted. Under-scoped (B1–B4). |
| 2.4 consent cited not implemented | PreToolUse hook **now feasible and correctly placed**. Scanner, elicitation, edit surface: **reworded, not designed**. |
| 2.5 pricing anchor | `ρ_t` **added**; refund window **kept but unfunded** (B6); listing bond → "retention deposit" **mentioned, not modelled**. |
| 2.6 no deployment | Phase H **exists as one line**. No OpenAPI, key custody, rate limits. |
| Gaps: key custody, MCP output cap, copyright, sig verification, half-life bound, centralisation, HANDOFF.md | **All still absent.** |
| `AuthorIdentity` needs `payout()` | **Unchanged interface.** |

---

## 6. What is sound

- **Content-addressed magnet with non-unique `question_norm` and a `scope` column** — correct fix to the lockout/plagiarism pair, and the reasoning in §4 is right.
- **Decay-only, no buyer-to-buyer refunds.** The argument ("no shared cost to split") is correct and the consequence ("a thousand sales earn more than eight") is the right one to optimise for.
- **`ρ_t` as a mandatory payee** with free search — correct, and the reason (search burns embeddings/storage) is the real one.
- **Keeping the issued-quote binding.** `index.ts:212-229`'s comment is the exact hazard v2 has, amplified: with `price(t)` continuous, *every* paid retry sees a different fresh price. The plan is right that this is the thing to extract, not re-invent.
- **PreToolUse hook for subagent denial** — the correct layer, and now verifiably implementable (`agent_id`).
- **`groupAndChunk` / `MAX_PAYEES=9` / `DUST`** are pure, tested, and transfer. `auth.ts` transfers verbatim. The four Hedera scripts transfer with a `PROVIDER_*` → generic rename.
- **HCS anchoring manifest hashes** is a better use of HCS than receipting batches — the plan is right — provided it is decoupled from settlement and a proof path exists (B8).
- **Phase ordering** A → B → 0 → C → D → E → F → G → H with A/B independent of 0 is correct; Phase 0 cannot block the extraction and should not.
- **"Numbers only, never the corpus"** for Phase 0. Right.
- **Dropping World.** Right, and for the right reason.
- **The torrent-client UI mapping** with the inverted bar is the strongest design idea in the document.

---

## 7. Concrete corrections to the plan text

1. **§2 — replace the three tables with a full disposition table** covering all 59 `.ts` + 2 `.tsx` sources, every `package.json`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`, `carpool.policy.json`, `.env.example`, and the seven top-level `.md` files. Add rows: `apps/settlement/src/{server,config}.ts` → delete; `apps/settlement/src/db/*` → `hedera-x402/src/store/sqlite.ts` (batch DDL + conditional claim, memo prefix configurable); `scripts/doctor.ts` → move (rename env vars); `scripts/reset.ts` → delete; `apps/fleet` → `apps/bench` (keep `agent.ts` payer pattern and `bootstrap.ts`; delete `lib.ts` workload slicing); `apps/dashboard` → rewrite in place; `packages/carpool-express` → delete after step 4; `carpool-express/src/{ledger,bodystore}.ts` → delete; `HANDOFF.md`, `SUBMISSION.md`, `CONTRACT.md` → delete; `README.md`, `PLAN.md` → rewrite; `X402-RESEARCH.md` → keep, move to `docs/`.
2. **§2 "Extract" table** — change `merkle.ts` "Unchanged" to "Generalise leaf type to `string[]`; add `merkleProof`". Change `errors.ts` row to "Delete (no upstream)". Change `policy.ts` row to "Extract the 12-line `canonical()` into `carpool-core/src/canonical.ts`; delete `loadPolicy`/`PolicyFile`". Add a row: "`settler.ts` depends on a `SettlementStore` interface defined in `hedera-x402`; port `ledger.test.ts` l.160-186 to its reference implementation." Add a sentence: "**Dependency direction: `hedera-x402` imports nothing from `carpool-core`.** `carpool-core` may import `hedera-x402` for µUSDC units, or duplicate the four constants." Fix "six HCS anchors" → "ten, nine of them empty".
3. **§2 "Archive"** — "Checkpoint the WAL, then export `batch`, `consumer`, and the anchor `event` rows to `docs/evidence/ledger-2026-09-11.json` with HashScan links. Do not commit the `.sqlite`."
4. **§4 schema** — add `royalty.available_at INTEGER NOT NULL`, `royalty.voided INTEGER NOT NULL DEFAULT 0`, `reason` ∈ `author_royalty | tracker_fee | refund`; add `purchase.refund_reason TEXT`; add `CHECK (half_life_days BETWEEN 0.5 AND 90)`; add `artifact.body_max_bytes` policy constant (2 MB) in text; replace `peer` with a view; add a `tracker_config(embedding_model, embedding_dim, revision, dtype)` single-row table and drop `embedding_model`/`embedding_dim` from `artifact` (or keep as denormalised copies that must equal the config row). Define `freshness(a) = 0.5^(ageDays/halfLifeDays)`. Change health's third term to `(distinctBuyersExcludingAuthor + 1) / 6`.
5. **§5 Economics** — add: "**Every sale settles to the settlement account.** Author royalties become payable at `purchase.refund_deadline`; the settler never sweeps a royalty before then. Refund window: 120 s from delivery. `margin` = 0.15 (so `p ≈ 0.15c` in §6 follows from here)." Add: "Publish requires a valid `author_sig`; `AuthorIdentity` gains `payout(): string` (a Hedera account id) and `resolveKey(): Promise<PublicKey>` via mirror node."
6. **§6 Phase 0** — restore "Gate: convergence ≥ 5 and overlap ≥ 50% *or stop and publish the negative result*." Add metric row: "**Lag** — hours from event to first adequate public artifact; the paid window." Add "Report Cohen's κ between raters." Note that convergence measures free-substitute supply and is necessary, not sufficient.
7. **§8 Phase A detail** — reorder: 1 (clean moves) → 2 (`SettlementStore` interface + reference impl + ported claim tests) → 3 (`merkleRoot(string[])`, `anchor(client, topic, payload)` decoupled from settle) → 4 (`gate.test.ts` written first against the fake facilitator from `quotebinding.test.ts`, then `PaymentGate` until green) → 5 (delete, then fix Dockerfile/compose/CI/root scripts, regenerate lockfile) → 6 (`pnpm build && typecheck && test` green on Node 20.19 and 22.x, docker build green). Acceptance row for A: add "`gate.test.ts` ≥ 4 tests including paid-retry-after-price-change; CI green."
8. **§8 Phase A step 4 interface** — replace "price function, payee resolver, ledger callbacks" with the option type in B3 (asset parameter, `resourceKey` in the binding, `payer: string | null`, idempotent `onSettled`, `owe` hook with handler-map replay).
9. **§9 Consent** — replace "outside interactive sessions" with "when hook input carries `agent_id`; non-interactive runs are refused server-side via an env flag set only in the interactive profile". Split the scanner into blocking pattern checks and a user never-publish list. Name MCP elicitation as the yes/no surface with refuse-if-unavailable.
10. **§10 Search privacy** — rewrite per B5: tracker mandates the embedding tuple; `/search` requires `embedding_model`, 409 on mismatch; artifacts embedded server-side; vectors are invertible, so the guarantee is "not logged", not "unreadable". Add cost: ~280 MB install, model pinned in the MCP package, warm on start.
11. **§8 Phase F** — add "`swarm_fetch` returns `{path, abstract, sections}` and writes the body to the scratch dir; `swarm_read(magnet, section)` pages it. Bodies > 20k tokens are never returned inline." Add "Buyer key: `CARPOOL_BUYER_KEY` + `maxAmountPerPayment` + per-session budget, using the `apps/fleet/src/agent.ts` pattern."
12. **§12 Bazantic** — "Track 3 requires a Gateway + Recipe for a previously unavailable, reusable API; it does not require an A/B. The A/B in §7 is our own measurement and also satisfies Track 1's method if the Continuity condition is ever met. **Spike first:** confirm a Bazantic Gateway can front an endpoint that itself returns x402 on `hedera:testnet`; if it cannot, the Gateway wraps the *free* `/search` + `/artifact/:magnet/manifest` endpoints only and payment stays native." Name the Hedera track being targeted ("AI & Agentic Payments on Hedera", $6,000 / 3 × $2,000 **[V]**).
13. **§8 Phase H** — expand to: hosting target, TLS, `/openapi.json`, publish rate limits, settlement-key custody note, facilitator fallback URL, `SELECT vec_version()` health check.
14. **§13 Known-unsolved** — add: embeddings are invertible; testnet resets erase HCS provenance; the facilitator is a single third-party dependency; the registry is the sole copy of every body.
