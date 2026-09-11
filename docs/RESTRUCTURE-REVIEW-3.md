# Restructure plan — hostile review #3 (sign-off round)

*Reviewed 12 Sep 2026 against `docs/RESTRUCTURE.md` (revised), `docs/RESTRUCTURE-REVIEW-2.md` §5, `docs/RESTRUCTURE-REVIEW-1.md`, and the repo on disk. Every code claim was re-checked by reading the named file. **[V]** = verified today by running or reading; **[?]** = not verified.*

---

## 1. Decision

**DO NOT SIGN OFF — but only just.** Nine of the ten criteria are met or met in substance. The plan is a real engineering plan now: the sequencing is copy → re-point → delete, the gate interface is right, the settlement interface has a named reference implementation, the money path is decided, the consent hook is not circular, and the evidence numbers are true (I re-took them; they match exactly).

What blocks is one sentence in **A7** that is not achievable as written, and it is the same sentence that failed in rounds one (B1) and two (S1 step 6): *"delete … the superseded `carpool-core` modules"*. `apps/settlement/src/config.ts:11-17` still imports `loadPolicy, policyHash, PolicyFile, QueryClass` and `ledger.ts:1-7` still imports `pioneerPrice, riderPrice, split, QueryClass` from `@carpool/core` **[V]**; `apps/settlement` is alive until Phase D. Deleting `types/pricing/policy` at A7 is a red build in the one workspace that must survive. The fix is two sentences (§7, B1).

Two further one-line gaps sit on the primary money flow and should be closed before Phase D, not before A1: nothing in the plan produces `royalty.payee` for an author (§12 forbids parsing `author` as a Hedera id and `AuthorIdentity` has no `payout()`), and the refund *amount* is never stated. Both are in the blocker list because a sign-off on a plan whose happy path cannot pay the author would be a sign-off on a story. Both are trivial edits.

**Phases A (after the A7 edit), B and 0 can start today.** Nothing else in this review needs to land before Phase D.

---

## 2. Round-two sign-off criteria — walked

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **Sequencing.** Per-step file list, `package.json` edits, lockfile regen; no step red; dry run of the import graph finds no importer left pointing at a deleted path; `apps/bench` in a phase row. | **NOT MET (A7)** | A1–A6 are achievable (§5 below). A7 deletes "the superseded `carpool-core` modules" while `settlement/config.ts` and `settlement/ledger.ts` (+ `ledger.test.ts:1`) import from them **[V]** and settlement survives to Phase D. Also: the `package.json` files that gain `@carpool/hedera-x402: workspace:*` are not listed per step ("every importer in the surviving workspaces" — that is `packages/carpool-core`, `apps/settlement`, `apps/fleet`; three files at A6). `apps/bench` is in a phase row (B1) ✓. |
| 2 | **Gate.** `resourceKey(req)` pure and separate from `quote`; `owe()`; how the settle result reaches the handler; `onPaid` idempotent on `txId`; where `meta` travels on the wire; the four `quotebinding.test.ts` cases restated. | **MET in substance** | `resourceKey` pure/sync ✓; `quote(req, key)` separate ✓; `owe(op, ctx): boolean` ✓; `onPaid` "MUST be idempotent on `txId`" ✓; `settle: SettleResult` in `PaidContext` ✓ — but that reaches `onPaid`, not the *route handler* that delivers the body and must call `owe("refund", …)` on delivery failure; nothing says `req.payment = ctx`. `meta` on the wire: **not stated**. `PaymentRequirements.extra: Record<string, unknown>` is a required field and `PaymentRequired.extensions?` exists (`@x402/core@2.25.0` d.ts l.1366-1380 **[V]**) — one of them must be named. Four test cases: **not restated** in the plan text. None of these blocks A3: the original test file and the v1 flow are on disk. |
| 3 | **Settlement.** Reference `SettlementLedger` named with its file; the two double-claim tests to port; `mirrorUrl`/`memoPrefix` in `createSettler`. | **MET** (file path not given) | `SqliteSettlementLedger` named; "double-claim tests in `ledger.test.ts` … port into `hedera-x402/settler.test.ts` in step A4" ✓ (they are `ledger.test.ts:160-186`, two `it`s **[V]**); `mirrorUrl`, `memoPrefix` in deps ✓. The implementation's file is not named — cosmetic. |
| 4 | **Money.** Window in seconds; refund auth; `null`-payer rule; `tracker_fee` on refund; custody bound qualified for `DUST` and idle settler; `purchase.refund_reason` in §4. | **NOT MET (one column)** | 120 s ✓; signed by buyer over `(txId, magnet, "refund")`, signer = `purchase.buyer` ✓; `payer: null` → `owe()` + 502 ✓; `tracker_fee` retained ✓; `DUST` + stopped settler caveated ✓. **`purchase.refund_reason` is absent from §4** **[V]** (grep: 0 hits). Non-blocking: SQLite `ALTER TABLE ADD COLUMN` at D. Separately, the refund **amount** is unstated (§4 below). |
| 5 | **Consent.** `ask` interactive; `deny` on `agent_id` or non-prompting `permission_mode`; approval recorded in `PostToolUse`; `-p` behaviour of `ask` stated as unverified. | **MET in substance** | Circularity gone ✓; `agent_id` → deny ✓; `PostToolUse` records ✓; "ask" otherwise ✓. Three residuals: (a) the mode set is written as `{bypassPermissions, acceptEdits, or any non-prompting mode}` — `acceptEdits` auto-accepts *file edits* only; MCP tools still prompt in it, so denying there is over-broad (a user in `acceptEdits` can never publish); `dontAsk` and `auto` — the modes that actually never prompt — are not named. (b) The plan says `-p` has no field, but does not say "whether `ask` under `-p` is auto-denied is unverified". (c) The server-side `CARPOOL_PUBLISH=1` belt-and-braces flag (round one fix B10, "keep" in round two S4) is absent — grep: 0 hits. All Phase F. |
| 6 | **Consistency.** No S8 pair remains; `canonicalHash` one home; dependency direction in one sentence. | **MET** | All seven S8 pairs resolved **[V]**: `canonicalHash` in `hedera-x402`, re-exported (§3); direction stated in one paragraph (§3); `embedding_model` sentence gone; no "Red."; no deny-by-default; counts match disk; Phase C now "computed from the committed metrics file". New minor inconsistency: §2 says `settler.ts` **move** but under §8.1 settlement's own `settler.ts`/`anchor.ts`/`ledger.ts` are *not* orphaned at A6 (server.ts imports them) and so are not deleted at A7 — the move completes at D. Say so. |
| 7 | **Table.** Every path in the `find` has a row or a directory-level row with a verb. | **NOT MET (six paths)** | Diffed against `find` **[V]**. Missing: `LICENSE`, `.nvmrc`, `logs/` (all three were enumerated in round two S7), `.env` (gitignored, holds the operator keys — needs "keep local, rewrite vars with `.env.example`, never commit"), `apps/fleet/first-run.jsonl` (gitignored via `*.jsonl`), and `apps/settlement/data/ledger.sqlite` itself — the evidence section discusses it but gives it no verb or destination. Covered adequately: dashboard scaffolding ("keep the Tailwind/Next scaffolding"), `provider/data/outbox.jsonl` (workspace deleted), `docs/SWARM-IMPLEMENTATION-v1-superseded.md` (`docs/SWARM*.md`). None of the six breaks a build. |
| 8 | **Evidence.** Both processes stopped; counts match after `wal_checkpoint(TRUNCATE)`; archive format stated (JSON or binary, and why). | **NOT MET (format)** | Processes: none **[V]** (`ps`, `lsof` on `ledger.sqlite`, listening ports — nothing of ours). Counts after checkpoint: **lineage 52 · consumer 60 · accrual 26 · batch 1 · event 75 (pioneer 52, rider 8, anchor 13, batch_settled 1, lineage_closed 1)** — exact match **[V]**. Last anchor is event 75 at `1789145142399`; WAL is 0 B. **Archive format and destination are not stated anywhere** (grep `JSON`, `export`, `evidence/`: 0 hits). Phase D rewrites `reset.ts` for the new schema against the same `data/` directory — the export must happen before that. |
| 9 | **Definitions.** `freshness` is a formula; `/search` carries `embedding_model` with a 409 rule; `merkleProof` exported or deferred with a reason. | **PARTIALLY MET** | `freshness(t) = 0.5^(ageDays/halfLifeDays)` defined once in §5 ✓ (§4 writes `freshness(a)` — cosmetic). `/search` 409: §13 says 409 **"during"** a migration — time-based, not mismatch-based; the request still carries no `embedding_model`, so a stale client *after* the migration completes gets silently incomparable results. `merkleProof`: absent and not deferred (grep: 0 hits). Both are Phase C/E. |
| 10 | **Precondition.** `nvm use` → `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test` green on the current tree. | **MET in fact, not stated** | Ran it under Node 20.19.0 **[V]**: install (frozen) ok; build 7/7; typecheck 9/9; tests **109 passed** (core 40, express 33, fleet 7, settlement 29), zero failures. The plan does not mention `nvm`/the baseline; the machine's default Node is v26 and `check-node.mjs` rejects it, so anyone executing must `nvm use` first. One sentence in §8.1. |

**Score: 6 met / met-in-substance, 4 not met. Exactly one of the four (criterion 1, step A7) blocks execution.**

---

## 3. Independent verification

- **No server processes.** `ps aux | grep node` shows only a VS Code helper; `lsof` holds no handle on `ledger.sqlite` or `smoke.sqlite`; no `:8402/:8403/:8404/:3000` listeners **[V]**. `logs/settlement.log` last line is the startup banner from the killed process.
- **Counts** re-taken after `PRAGMA wal_checkpoint(TRUNCATE)` (result `0|0|0`, WAL now 0 B): match §2 exactly (table above). The single batch is `0.0.10475802@1789137942.760688301` / `SUCCESS` / memo `carpool:batch:1:8643b7b8` **[V]**. All 13 anchors carry the same root `27e4e54d…`; the last eleven have `batchTxIds: []` — consistent with the plan's "13 anchors for 1 batch" note.
- **Disposition table diff:** six paths without a row (criterion 7). Nothing else in the 113-file `find` is uncovered.
- **Git:** the tree is on branch `feat/phase1-reproducibility`, clean except that **`docs/` is entirely untracked** — the plan and all three reviews are uncommitted. Not a plan defect; commit them before A1 so the "green at every commit" history starts from the plan.
- **Baseline:** green (criterion 10).

---

## 4. Flow traces against the revised text

### Happy path — search, pay, receive, author paid after the window

1. `carpool_search` (free) → MCP embeds locally, sends vector → tracker returns manifests + `magnet` + `price(t)`. **OK.**
2. `carpool_fetch(magnet)` → `GET /artifact/:magnet` → gate: `resourceKey(req)` = magnet (pure) → no payment header → `quote(req, key)` → `{priceUnits: floor + P·freshness(t), payTo: settlementAccount, meta}` → 402 with requirements; `issued.set(key|amount|payTo)`. **OK.** `meta` placement on the wire unstated (criterion 2) — implementer picks `PaymentRequirements.extra`.
3. Paid retry → `resourceKey(req)` without quoting → `issued.get(key|accepted.amount|accepted.payTo)` → verify → settle → `PaidContext{payer, txId, paid, settle, meta}` → `onPaid`. **OK** — the binding is preserved because the key is derivable without `quote()`.
4. `onPaid` (registry): insert `purchase(buyer=payer, tx_id, paid, refund_state='window', refund_deadline=now+120s)`; insert `royalty(author_royalty, available_at=refund_deadline)`, `royalty(tracker_fee, available_at=?)`. **Breaks here:** `royalty.payee` for the author has no source. `artifact.author` is "opaque; never parsed as a Hedera id; payout resolves through the interface" (§12) and `AuthorIdentity` is `{id, verify, display}` — no `payout()`. Round one gap 1, round two §4.1, still open. **One-line fix** (§7 B2). `tracker_fee.available_at` is also unstated (should be `now` — it is not refundable).
5. Route handler delivers body, verifies `body_hash`. If delivery fails after settle the handler must `owe("refund", …)` — it needs `txId`, which only `onPaid` received. **Unstated** how the handler gets `PaidContext` (criterion 2). One line: `req.payment = ctx` before `next()`.
6. After 120 s: settler epoch → `unsettled()` (`settled_batch_id IS NULL AND voided_at IS NULL AND available_at <= now`) → `groupAndChunk` → `claimBatch` → `TransferTransaction` from the settlement account → `markSettled`. **OK** given step 4 is fixed. The v1 conditional claim (`ledger.ts:336-359`) ports to `SqliteSettlementLedger` — its `WHERE` must add `voided_at IS NULL`; the plan does not say so (nice-to-have, §7).

### Refund path — pay, reject inside 120 s, royalty voided, buyer repaid

1. Steps 1–5 as above. `purchase.refund_state='window'`, `refund_deadline = ts + 120 000`.
2. Buyer signs `(txId, magnet, "refund")` with the key that paid; registry checks signer = `purchase.buyer`. **Mechanism gap, non-blocking:** `purchase.buyer` is a Hedera account id (from `SettleResponse.payer`), the signature yields a public key; resolving one to the other needs a mirror-node `GET /accounts/{id}` lookup (round one gap 5, publish-side, same machinery). Implementable; say it once.
3. Registry, in one transaction: `now < refund_deadline` → set `royalty.voided_at` on the `author_royalty` row → set `purchase.refund_state='refunded'` → insert `royalty(reason='refund', payee=buyer, amount=?, available_at=now)`. **Breaks here: `amount` is never stated.** "The royalty row is voided and a `reason='refund'` payout to the buyer is accrued … `tracker_fee` is not refunded" admits two readings: refund = `paid − tracker_fee` (author share + settlement remainder), or refund = the author royalty only (registry keeps its remainder on a sale it reversed). Phase D's acceptance "refund inside the window returns funds" is satisfiable by either. **One-line fix** (§7 B3).
4. Race with the settler: `available_at = refund_deadline` and the refund check is `now < refund_deadline`, so with one clock the two are disjoint. Correct — provided the void is *conditional* (`… AND settled_batch_id IS NULL`) and the claim is conditional on `voided_at IS NULL`. Neither condition is written. Nice-to-have, one clause each.
5. Next epoch: refund row (if `≥ DUST`) is paid to the buyer from the settlement account, which still holds the funds because the author was never paid. **OK.** Sub-DUST refunds carry forward forever — stated honestly in §8.4.
6. `payer: null` variant: the gate settles, then 502s. The buyer has paid, there is no purchase row, and nobody knows whom to refund; `owe()` holds an outbox record for the operator. Honest but avoidable: `VerifyResponse.payer?` exists (`@x402/core` d.ts l.1395-1402 **[V]**), so the gate can refuse at *verify* time (402 "cannot identify payer") before any money moves. Improvement, Phase D.

---

## 5. A1–A7 — is each stated tree state achievable?

| Step | Achievable? | Notes |
|---|---|---|
| A1 copy `units, errors, merkle, hedera, auth, db/index` + tests into a new workspace; lockfile | **Yes, with edits the word "copy" hides.** | `hedera.ts:1` imports `USDC_TOKEN_ID_TESTNET` from `@carpool/core` — the copy must import `./units.js` or `hedera-x402` violates "depends on nothing in this repo". `db/index.ts:5,19,24` imports `./schema.js` and runs `schema.DDL` — the copy cannot compile without `schema.ts`, which is *not* copied; it must take a DDL/schema argument (round two S7 said this; the plan does not). The new workspace needs `package.json` + `tsconfig.json` (covered by the "seven tsconfig" row). Green after those edits. |
| A2 `gate.test.ts` `describe.skip` | **Yes.** | Requires `express`, `@x402/core`, `@x402/hedera`, `lru-cache` in the new package's deps — implied. |
| A3 `PaymentGate` lifted from `carpool-express/index.ts` | **Yes.** | v1's `owe` at l.441/465/493/510, `issued` at l.332/380, `resourceUrl` at l.129 are all on disk to lift from. |
| A4 `SettlementLedger` + copy `settler.ts` + port double-claim tests | **Yes, if the copy drops `anchorEpoch`.** | `settler.ts:2` imports `./anchor.js`, which does not exist in `hedera-x402` until A5. The A4 copy must already be "decoupled from anchor" (§2 says so for the settler row) — state it in the step. `settler.test.ts` (4 tests) copies clean. |
| A5 rewrite `anchor.ts` | **Yes.** | Pure function; nothing imports it yet. |
| A6 re-point importers; lockfile | **Yes.** | Importers of the six copied modules: `carpool-core/{key,policy}.ts` (`./units.js`), `settlement/{hedera,ledger,server,settler,anchor}.ts`, `settlement/scripts/*.ts` (`../hedera.js`), `fleet/{agent,scripts/bootstrap}.ts` (`USDC_TOKEN_ID_TESTNET`). Three `package.json` gain the dep: `packages/carpool-core`, `apps/settlement`, `apps/fleet`. `merkle` re-point needs `payeeLeaves()` (stated). Settlement's `settler.ts`/`anchor.ts`/`ledger.ts` stay and keep working against the re-pointed copies. |
| A7 delete `carpool-express`, `provider*`, "superseded core modules", orphaned originals, infra | **NO.** | `carpool-express` + `provider*`: fine (only they import each other). Orphaned originals (`core/units.ts`, `settlement/{hedera,auth,merkle,db/index}.ts` + tests): fine. **"Superseded core modules" = `types/key/pricing/workload/universe/policy` per §2: `settlement/config.ts:11-17` and `ledger.ts:1-7`, `ledger.test.ts:1` still import them [V] → `@carpool/settlement` red → `turbo` root red.** `apps/fleet` (`lib.ts:3`, `workload.test.ts:2`) likewise, unless fleet is deleted in the same commit — the sentence "`apps/fleet` survives until A7" suggests it is, in which case `agent.ts` (disposition: move → `bench`, created in B1) is deleted before its destination exists. |

**Fix for A7 (two sentences):** "A7 deletes only what A6 orphaned. `types.ts`, `key.ts`, `pricing.ts`, `policy.ts`, `workload.ts`, `universe.json` and their tests are deleted in Phase D (with `settlement/config.ts` and `ledger.ts`) and Phase B1 (with `apps/fleet`); `apps/fleet` survives until B1."

---

## 6. Regressions from rounds one and two

- **`CARPOOL_PUBLISH=1` server-side flag** — proposed in round one (B10 fix), "keep … as belt-and-braces" in round two (S4). Absent from the current §9. Whether it was ever in the text or only in the reviews I cannot verify (draft two is gone); either way it is the only defence-in-depth against a client with no hooks installed, and it is one line.
- **Nothing else regressed.** Every item round two marked "genuinely fixed" is still fixed: `payTo` decision, `merkle` → `string[]`, health floor, `available_at`, Phase 0 stop rule + κ, §10/§12/§12a honesty, `asset` parameter, `payer: string | null`.
- **Unchanged since round one, not regressed:** "strips … internal hostnames" (§9) is still not pattern-matchable; "Publish with edits" still names no editing surface; `errors.ts` still "moves" to `hedera-x402` where nothing will import it after A7 (`upstream.ts`, `carpool-express/index.ts` are its only callers **[V]**); `hedera.ts` still moves "unchanged" with `Client.forTestnet()` while the gate takes `network: string`.

---

## 7. Minimum edit list

### Blockers — edit before the phase named; the plan is not signed off until all three are in

| # | Blocks | Edit |
|---|---|---|
| **B1** | **A7 (i.e. before A1 begins)** | §8.1 A7: delete only the A6-orphaned originals. Move `types/key/pricing/policy/workload/universe` deletion to Phase D (settlement) and B1 (fleet). Change "`apps/fleet` survives until A7" to "until B1". Two sentences. |
| **B2** | Phase D | §12 `AuthorIdentity` gains `payout(): string` (a Hedera account id, resolved once at publish and pinned into `royalty.payee` at purchase time, so a later key change does not move money). One line in the interface, one sentence in §8.4. |
| **B3** | Phase D | §8.4: state the refund amount. Recommended: `paid − tracker_fee`, i.e. the author royalty *and* the settlement remainder are returned; only `ρ_t` is kept. One sentence. |

### Must land before the named phase — not blocking today

- **Before D:** `purchase.refund_reason TEXT` in §4 (criterion 4). `req.payment = PaidContext` before `next()` (criterion 2). `meta` → `PaymentRequirements.extra` (required field; exists) (criterion 2). Conditional void (`settled_batch_id IS NULL`) and conditional claim (`voided_at IS NULL`) — one clause each. `tracker_fee.available_at = now`. Refuse at verify when `VerifyResponse.payer` is absent instead of settling then 502-ing. Evidence archive: "export `batch`, `consumer`, and the 13 anchor `event` rows to `docs/evidence/ledger-2026-09-12.json` with HashScan links before `reset.ts` is rewritten; do not commit the `.sqlite`" (criterion 8). Port `ledger.test.ts:122-158` (tx-id idempotency) to the registry's `purchase` insert — it is the test for "`onPaid` idempotent on `txId`".
- **Before C:** `/search` request carries `embedding_model`; 409 on mismatch, always, not only during a migration (criterion 9).
- **Before E:** `merkleProof(leaves, leaf)` in the `hedera-x402` export list, or one sentence deferring it with a reason (criterion 9).
- **Before F:** replace `{bypassPermissions, acceptEdits, or any non-prompting mode}` with `{bypassPermissions, dontAsk, auto}` — `acceptEdits` still prompts for MCP tools; add "whether `ask` is auto-denied under `-p` is unverified"; reinstate `CARPOOL_PUBLISH=1` (criterion 5).

### Nice-to-haves — do not send the author on these

- Table rows: `LICENSE` keep · `.nvmrc` keep · `logs/` delete · `.env` keep-local/rewrite/never-commit · `apps/fleet/first-run.jsonl` delete · `apps/settlement/data/ledger.sqlite` export-then-delete (criterion 7).
- §8.1: name the three `package.json` files at A6; add "run under `nvm use` (20.19.0); baseline is 109 tests green" (criterion 10); note that A1's `db/index` copy takes a DDL argument and A4's `settler` copy has no anchor call; note that settlement's `settler/anchor/ledger` are deleted at D, not A7.
- §8.3: restate the four `quotebinding.test.ts` cases against the new interface (criterion 2).
- §2: `errors.ts` → delete (dead in `hedera-x402`); `hedera.ts` → take `network` from options.
- §4/§5: `freshness(a)` → `freshness(t)`; `SqliteSettlementLedger` file path.
- Commit `docs/` — the plan is untracked.

---

## 8. Decision

**DO NOT SIGN OFF.**

Three edits, none longer than two sentences, stand between this document and execution: **B1** (A7 deletes only what A6 orphaned — must be in before A1), **B2** (`AuthorIdentity.payout()` — before D), **B3** (refund amount — before D). With B1 applied, Phases A, B and 0 are executable today from this text; B2 and B3 can be written while A runs. Everything else in §7 is scheduled to a later phase and is not a condition of starting.
