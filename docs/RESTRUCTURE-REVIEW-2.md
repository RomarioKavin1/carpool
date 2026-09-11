# Restructure plan — hostile review #2

*Reviewed 11 Sep 2026 (16:33 UTC) against the revised `docs/RESTRUCTURE.md`, `docs/RESTRUCTURE-REVIEW-1.md`, and the repo on disk. Every code claim below was re-checked by reading the named file; line numbers are as the files sit now. **[V]** = verified against an external source today; **[?]** = not verified.*

---

## 1. Verdict

**Closer, but not executable as written.** The revision fixes the *design* problems from round one — `payTo` is decided and correct, `merkle` is generalised, the health floor is real, the embedding tuple is registry-level, Phase 0 has a stop rule and κ, the privacy and MCP-cap claims are now honest. What it still gets wrong is the *sequencing*: §8.1 promises "green at every commit" and then specifies a step 1 that breaks five workspaces, a step 2 that is explicitly "Red", and a step 6 that deletes modules `apps/settlement` and `apps/fleet` still import while their rewrites live in Phase D and in a phase that does not exist. The `PaymentGate` interface has one structural error (the resource key is only obtainable by calling the thing the paid retry must not call) and the consent hook is circular (deny-by-default until an approval is recorded; the approval is recorded when the user answers a prompt; the prompt is never shown because it is denied).

Two facts on disk changed under the plan: the anchor count is **12, not 11**, because `apps/settlement/dist/server.js` (pid 64005, running since 23:41 last night) is still anchoring an empty epoch to HCS every 600 s — the last one landed at 16:31:39 UTC, two minutes before this review. The evidence numbers cannot be "true counts" while the process that writes them is alive.

**Shortest path to yes** (one focused editing pass, no new research):

1. §8.1 — rewrite as a sequence that is actually green: *copy* shared modules into `hedera-x402` and re-point every live importer (five `package.json` edits, lockfile regen per step) before deleting; fold steps 2+3 into one commit or drop the "every commit" rule; keep `types/pricing/key/workload` in `carpool-core` until Phase D has rewritten `settlement/config.ts`, `settlement/ledger.ts` and created `apps/bench`.
2. §8.3 — split `resolve(req)` into a pure `resourceKey(req): string` and an async `quote(resourceKey, req)`; restore the `owe()` outbox hook; state how the settle result reaches the route handler; require `onPaid` idempotent on `txId`.
3. §8.2 — name the reference `SettlementLedger` implementation (batch DDL + conditional claim + memo prefix) and port `ledger.test.ts` l.41-57 to it; add `mirrorUrl` and `memoPrefix` to `createSettler` deps.
4. §9 — replace "deny by default" with "`ask` when interactive, `deny` when `agent_id` is present or `permission_mode ∈ {bypassPermissions, dontAsk, auto}`", and move the approval-recording to a `PostToolUse` hook.
5. §8.4/§4 — state the window (SWARM.md says 120 s), add refund-request authentication, decide what a `null` payer does to `purchase.buyer NOT NULL`, void the `tracker_fee` row too or say it is retained, and qualify "custody bounded" for sub-DUST and idle-settler cases.
6. §2 — add the ~25 missing rows (list in §3 S7 below), reconcile `canonicalHash`'s home (§2 says `hedera-x402`, §3 says `carpool-core`), delete the `embedding_model` sentence from §13, define `freshness`.
7. Kill pid 64005 (and 64102, the provider), checkpoint, take the counts once, export to JSON, and write *those* numbers.

---

## 2. Round-one findings — judged

| # | Finding | Judgement | Evidence |
|---|---|---|---|
| 1 | §2 complete disposition table | **Partially fixed** | Table now covers the 61 hand-written `.ts/.tsx` sources and the six infra files the review named. It does **not** cover: the six top-level `.md` files (`README`, `HANDOFF`, `CONTRACT`, `SUBMISSION`, `X402-RESEARCH`, `PLAN`) — the only docs row is `docs/*.md`, "SWARM*.md superseded"; `.env.example` (still `PROVIDER_*`); `.gitignore` (l.22-23 name `apps/fleet/accounts.json`, l.29 `**/data/bodies/`); `.dockerignore`; `.nvmrc`; `scripts/check-node.mjs` (Dockerfile l.16 `COPY`s it); `scripts/verify-clean-clone.sh`; all seven `tsconfig.json`; `apps/settlement/package.json` (must be renamed to `@carpool/registry`) and `apps/fleet/package.json`; `apps/fleet/accounts.json` (13 **private keys**, gitignored — where does it live when fleet becomes bench? `bootstrap.ts:19` writes to `process.cwd()/accounts.json`); `apps/settlement/data/smoke.sqlite`; `apps/dashboard/lib/api.ts` and `lib/fixture.ts` (both *mentioned*, neither given a verb); `logs/`. The author's summary item 1 says "(… docs)"; that is not true of the table. |
| 2 | `settler.ts` behind an interface, per-instance mutex | **Partially fixed** | `SettlementLedger` (§8.2) maps 1:1 onto the five `Ledger` methods `settler.ts` calls (`unsettledAccruals` l.72, `createBatch` l.81, `sumAccruals` l.96, `markSettled` l.88/100/115, `pendingBatches` l.133) — sufficient once `anchorEpoch` (l.121) is decoupled. Mutex per instance: stated. **Still missing:** no reference implementation is named anywhere — §2 deletes `ledger.ts` *and* `ledger.test.ts`, so the conditional-claim logic (`ledger.ts:336-359`) and its only tests ("concurrent settlement cannot double-claim", `ledger.test.ts:41-57`) have no stated destination; the memo format `carpool:batch:${id}:${root.slice(0,8)}` (l.346) that `reconcilePending` matches on (`settler.ts:147-151`) lives in the deleted file; `createSettler` deps have no `mirrorUrl` (hard-coded testnet, `settler.ts:138`) or `memoPrefix`; `settleEpochInner` still reads `process.env.CARPOOL_PRIVATE_KEY` (l.68); `hedera.ts` "moves" but is `Client.forTestnet()` only (l.11, 19). |
| 3 | `PaymentGate` interface | **Partially fixed, one part newly broken** | Fixed: `asset` parameter, `resourceKey` in the binding, `payer: string \| null` (`SettleResponse.payer?: string` confirmed optional in `@x402/core@2.25.0` d.ts l.1413), handler-map replay (§2 outbox row). **Newly broken:** `resolve(req)` returns `{resourceKey, priceUnits, payTo, meta}` in one async call. On the paid retry the gate must look up `issued.get(\`${resourceKey}\|${amt}\|${to}\`)` (v1 `index.ts:332`) *without* re-quoting — that is the whole regression `quotebinding.test.ts` guards ("does not re-quote … proved by taking the ledger away", l.126-157). In v1 the key is `cacheKey(cls, params)` (l.304), pure and local. Under the new interface the only way to obtain `resourceKey` is to call `resolve()`, which is the re-quote. The ported test cannot be written faithfully. **Still missing:** the `owe()` outbox hook (v1 calls it at l.441, 465, 493, 510 — the interface has no slot, yet §2 moves the outbox into the same package); how the settle result reaches the route handler (v1 continues inline; a reusable gate must attach `{payer, txId, paid, resourceKey, meta}` to the request or return it); the idempotency requirement on `onPaid` (review B3 asked for "MUST be idempotent on txId"; dropped); the meaning of `onPaidFailed` — the gate never knows delivery failed, the handler does, so the handler would be calling a callback it passed to someone else; `meta` "goes in the free 402 body" — `PaymentRequired` is `{x402Version, error?, resource: ResourceInfo, accepts, extensions?}` and `ResourceInfo` is `{url, description?, mimeType?, serviceName?, tags?, iconUrl?}` (d.ts l.1358-1365) — arbitrary meta must go in `extensions` or `PaymentRequirements.extra`, which the plan does not say; `resourceUrl(req)` (l.129-132) needs the Express request, unmentioned. |
| 4 | `payTo` decided | **Partially fixed** | The decision (settlement account) is correct and the consequences listed are the right ones. Trace: buyer pays registry → `purchase` row → `royalty` rows with `available_at = refund_deadline` → settler pays after. **Where it breaks:** (a) the window length is *still* not in the plan — SWARM.md l.297 says 120 s, RESTRUCTURE.md never gives a number, and "custody … at most the refund window plus one settlement epoch" has no value; (b) **refund-request authentication is absent** — any caller who knows a `tx_id` can void an author's royalty and trigger a payout to `buyer`; the payout goes to the real buyer so the attack is griefing, not theft, but it is free; (c) `payer` may be `null` (§8.3) but `purchase.buyer TEXT NOT NULL` (§4) and the refund payout needs an account — "the caller must handle" it is not a design; (d) only "the royalty row" (singular) is voided; the `tracker_fee` row's fate on refund is unstated; (e) "custody is bounded" is false for a refund below `DUST = 500` µUSDC (`settler.ts:7`, carried forward forever) and whenever the settler is idle (`server.ts:101-103`, no creds → never sweeps). Positive: a debit and a credit on the same account in one `TransferTransaction` works — batch 1 (`0.0.10475802@1789137942.760688301`, `SUCCESS`) paid 4,002 µUSDC of `carpool_fee` *to* `0.0.10475802` *from* `0.0.10475802`. |
| 5 | Phase A test-first | **Reworded but still broken** | See S1. Step 1 ("move … units, errors, db/index … Green") is not green: `units.ts` is imported by `hedera.ts:1`, `fleet/agent.ts:11`, `fleet/scripts/bootstrap.ts:15`, `carpool-express/index.ts:9`, `provider/server.ts:6`; `errors.ts` by `carpool-express/index.ts:5,8` and `provider/upstream.ts:2-6`; `db/index.ts` by `settlement/ledger.ts:10` and `scripts/reset.ts:4`; `auth.ts` by `server.ts:10`; `merkle.ts` by `settler.ts:4` and `anchor.ts:4`. A *move* deletes the source; every importer goes red unless it is re-pointed at `@carpool/hedera-x402` in the same commit — five `package.json` edits and a lockfile regen at step 1, not "one un-frozen install". Step 2 says **"Red."** — the acceptance row for A says "green at every commit". Step 6 deletes "the superseded core modules" (`types`, `pricing`, `key`) while `apps/settlement/src/config.ts:11-17` (`loadPolicy, policyHash, PolicyFile, QueryClass`) and `ledger.ts:1-7` (`pioneerPrice, riderPrice, split`) still import them — their rewrite is Phase D — and `apps/fleet/src/lib.ts:3` (`cacheKey, zipfWorkload, QueryClass`) still imports them and its rewrite (`apps/bench`) is in **no phase at all**. |
| 6 | Per-artifact `embedding_model` removed | **Fixed in §4, contradicted in §13** | §4 comment is correct. §13 still reads "**Embedding drift.** `embedding_model` is recorded so a change is detectable" — the column no longer exists. The `/search` request still has no `embedding_model` parameter and no 409-on-mismatch, so a stale client gets silently wrong results rather than a loud failure. |
| 7 | `health` floor | **Genuinely fixed** (the zero) | `0.4 + 0.6·min(1, distinctBuyers/5)` is fine. `freshness(a)` is still referenced and never defined (review B7 asked); `distinctBuyers` still does not exclude the author in the formula (§13 says it should); `peer` is still maintained counters, not a view. |
| 8 | `royalty.available_at` | **Genuinely fixed** in the schema; the settler filter is stated. Downstream problems are in #4. |
| 9 | Evidence archive | **Partially fixed, and the numbers are wrong again** | WAL checkpoint requirement: present and correct (the file is now 69,632 B main / 0 B WAL — someone already checkpointed). The plan's "true counts" say 11 anchors / 73 events. On disk now: **12 anchors / 74 events**, last anchor `2026-09-11 16:31:39 UTC`. `node dist/server.js` pid 64005 with cwd `apps/settlement` holds `ledger.sqlite` open and is anchoring an empty epoch every 600 s to real HCS testnet. Every reader of the plan will find a different number. The plan also still does not say what the archive *is* — a committed `.sqlite` (the review said don't) or a JSON export with HashScan links. |
| 10 | `merkle` → `string[]` | **Genuinely fixed.** `merkleProof` (review B8; needed for Phase E's "per-epoch root over manifest hashes" to be *checkable*) is still absent. |
| 11 | Phase 0 stop rule, κ, honesty | **Genuinely fixed** on all four points named. Not added: the lag metric (hours from event to first adequate public artifact — the paid window), and `p ≈ 0.15c` is still asserted while §5 says only `margin < 1`. |
| 12 | §9 / §10 / §12a / §12 | **§10, §12a, §12 fixed. §9 newly broken.** §9: "Deny by default unless the session has recorded an interactive approval … a flag the hook writes when the user answers the prompt." A `PreToolUse` hook fires *before* the prompt and cannot observe the answer **[V]**; if publish is denied absent the flag, the prompt is never shown and the flag is never written. Also unchanged from round one despite the author's claim: "A pre-publish scan **strips** secrets, private-repo paths and internal hostnames" (hostnames are not pattern-matchable); "Publish with edits" still names no editing surface. Positive the plan misses: hook input **does** carry `permission_mode` (`default \| plan \| acceptEdits \| auto \| dontAsk \| bypassPermissions`) **[V]** — `dontAsk`, `bypassPermissions` and `auto` are modes in which no human answers prompts, and the hook can deny on them. Whether an `"ask"` decision under `-p` is auto-denied is undocumented **[?]**. |

---

## 3. Still broken / newly broken — by severity

### S1. Phase A violates its own "green at every commit" rule at steps 1, 2 and 6

Detailed in #5 above. Concretely, as written:

- **Step 1** turns red in `apps/settlement`, `apps/fleet`, `apps/provider`, `apps/provider-two`, `packages/carpool-express` (the importers listed in #5). `turbo.json` `dependsOn: ["^build"]` makes one red workspace fail the root.
- **Step 2** is red by declaration.
- **Step 4** moves `settleEpoch` behind `createSettler({ledger: SettlementLedger …})`; `server.ts:72,108` call `settleEpoch(ledger, client, usdcId(), cfg.carpoolAccount)` with a v1 `Ledger` — needs an adapter class or `Ledger implements SettlementLedger` to compile. Unmentioned.
- **Step 5** decouples `anchorEpoch` from `settleEpochInner` (l.121) — `server.ts` must now call anchor itself. Unmentioned.
- **Step 6** deletes `types/pricing/key/workload` from core; `settlement/config.ts`, `settlement/ledger.ts` (alive until Phase D) and all of `apps/fleet` (alive until a phase that does not exist) go red.

**Fix.** Either (i) *copy* to `hedera-x402`, re-point importers, delete at the end — with a lockfile regen and a `workspace:*` dep added in each affected `package.json` at each step; or (ii) drop "every commit" to "every phase boundary" and say so. Keep the superseded core modules until D has consumed them. Add a phase for `apps/bench` (see S3). Merge steps 2 and 3 into one commit, or accept a red test in a commit and say so.

### S2. `PaymentGate.resolve()` conflates the resource key with the quote

Detailed in #3. The paid retry needs `resourceKey` *before* it can decide whether to quote; the interface makes the key an output of quoting. Fix:

```ts
resourceKey(req: Request): string | null;                       // pure, sync, no I/O
quote(key: string, req: Request): Promise<{ priceUnits; payTo; meta } | { notFound: true }>;
onPaid(ctx): Promise<void>;                                     // MUST be idempotent on txId
owe(op: string, txId: string, args: unknown): void;             // outbox; handler-map replay
```

and state that the gate attaches `req.payment = { resourceKey, payer, txId, paid, meta }` (or returns it) and *does not* deliver — delivery failure after payment is the handler's `owe("refund", txId, …)`, which is what `onPaidFailed` was reaching for. Say where `meta` goes on the wire (`PaymentRequired.extensions` or `PaymentRequirements.extra`).

### S3. `apps/bench` is in §2 and §3 and in no phase

`apps/fleet → apps/bench` has six dispositions in §2 and the target tree lists `bench/`, but the phase table (A–H, 0) never creates it. Phase 0's deliverable is `docs/PHASE0.md`; "Phase 0 tooling" lives in bench per §3, so Phase 0 needs bench, which needs the fleet rewrite, which is unscheduled. Meanwhile step A6 kills fleet's imports. **Fix:** add "bench" to Phase 0's acceptance ("`apps/bench` builds; `agent.ts` payer reused; `lib.ts`/`run.ts` rewritten; `accounts.json` path and gitignore updated") or make it Phase A step 6.5.

### S4. Consent hook is circular

Detailed in #12. **Fix:** `PreToolUse` on `mcp__carpool__carpool_publish`: `deny` if `agent_id` present or `permission_mode ∈ {bypassPermissions, dontAsk, auto}`; otherwise `ask`. `PostToolUse` on the same tool records the project-scoped approval (the tool ran, so the user allowed it). Say that `-p` behaviour of `ask` is undocumented and treat it as a residual risk. Keep the server-side `CARPOOL_PUBLISH=1` env flag as belt-and-braces.

### S5. The refund path has five unstated pieces

(a) window length; (b) refund-request authentication (signature by `buyer` over `tx_id`, or the x402 payer identity from a second paid call — pick one); (c) `null` payer vs `purchase.buyer NOT NULL` (either refuse to serve when `payer` is null — losing the sale — or record `buyer = ''` and mark the purchase non-refundable; both are defensible, neither is written); (d) `tracker_fee` on refund; (e) custody bound qualified for `DUST` and idle settler. Add `purchase.refund_reason TEXT` — "recorded against ratio" (§5) needs a reason to be meaningful.

### S6. `SettlementLedger` has no implementation and its tests are deleted

§8.2 defines the interface; §2 deletes `ledger.ts` and `ledger.test.ts`; nothing says where the conditional claim (`ledger.ts:336-359`), the memo format (l.346) and the two double-claim tests (`ledger.test.ts:41-67`) go. Without a reference implementation *in `hedera-x402`*, the registry's Phase D `SettlementLedger` is written fresh with no test that two concurrent runs cannot both claim a row. **Fix:** `hedera-x402/src/store/sqlite.ts` exporting `SqliteSettlementLedger(db, { memoPrefix, extraFilter? })` with the batch DDL; port the two tests; add `mirrorUrl`, `memoPrefix` to `createSettler` deps; `reconcilePending` becomes a method.

### S7. Disposition table gaps

Add rows for: `README.md` (rewrite), `HANDOFF.md` (delete — l.8 still says "no payment has ever settled"), `CONTRACT.md` (delete), `SUBMISSION.md` (rewrite or delete), `X402-RESEARCH.md` (keep → `docs/`), `PLAN.md` (rewrite), `LICENSE` (keep), `.env.example` (rewrite: drop `PROVIDER_*`, `PROVIDER_TWO_PORT`, `CARPOOL_BASE_URL`; add registry/buyer/tracker vars), `.gitignore` (edit l.22-23, 29), `.dockerignore` (keep), `.nvmrc` (keep), `scripts/check-node.mjs` (keep; Dockerfile copies it), `scripts/verify-clean-clone.sh` (keep), seven `tsconfig.json` (new ones for `hedera-x402`, `carpool-tracker`, `mcp`, `bench`, `registry`), `apps/settlement/package.json` (rename → `@carpool/registry`, deps), `apps/fleet/package.json` (rename → `@carpool/bench`), `apps/fleet/accounts.json` (relocate; gitignore path), `apps/settlement/data/smoke.sqlite` (delete), `apps/dashboard/lib/api.ts` (rewrite), `lib/fixture.ts` (delete or rewrite — `page.tsx:47` falls back to `SAMPLE_STATE`), `logs/` (delete). Also change `errors.ts` from "move → hedera-x402" to "delete" — upstream-failure classification has no caller in a package that has no upstream; and note that `db/index.ts:19` runs `schema.DDL` — the whole v1 DDL — so its "move" must take a DDL argument.

### S8. Internal contradictions

| A | B |
|---|---|
| §2: `canonicalHash` → `hedera-x402` | §3: `carpool-core/ … canonical hashing` |
| §2: `units.ts` → `hedera-x402` | §3: `carpool-core/ … decay pricing` (in µUSDC, needs `CENT`); dependency direction between the two packages still unstated — round one asked explicitly |
| §4 comment: "no per-artifact embedding model" | §13: "`embedding_model` is recorded so a change is detectable" |
| §8.1 preamble: "green at every commit" | §8.1 step 2: "Red." |
| §9: "`ask` is the default" | §9: "Deny by default unless the session has recorded an interactive approval" |
| §2 evidence: "73 events … 11 anchor" | disk: 74 / 12, and rising |
| Phase C acceptance: "Reproduces Phase 0 numbers" | §6: "Numbers only, never the corpus" — the corpus C would need is, by rule, not kept (fine if it is kept *locally and unpublished*; say so) |

### S9. A live settlement server is writing to the evidence and spending testnet HBAR

pid 64005 (`apps/settlement`, `dist/server.js`) and pid 64102 (`apps/provider`). Every 600 s the settler anchors `{batchTxIds: [], merkleRoot: 27e4e54d…}` to `HCS_TOPIC_ID`. Twelve so far, eleven of them empty. Stop both before taking counts; add to §2: "the evidence snapshot is taken with no server running".

### S10. Smaller but real

- `freshness(a)` undefined (presumably `0.5^(ageDays/halfLifeDays)`).
- `/search` has no `embedding_model` parameter / 409.
- `merkleProof` absent; Phase E's HCS provenance is unverifiable by a buyer without it.
- `hedera.ts` moved "unchanged" is testnet-only (`Client.forTestnet()` l.11, 19) while the gate takes `network: string`.
- `errors.ts` in `hedera-x402` is dead code.
- CI: "one un-frozen install" — it will be one per step that touches a `package.json`.
- Machine runs Node **v26.0.0**; `engines` says `<23` and `check-node.mjs` rejects it. Nothing in the plan can be *verified locally* on this machine without `nvm use`. Not a plan defect; a sign-off precondition.

---

## 4. Remaining gaps (from round one, still absent)

1. `AuthorIdentity.payout(): string` — `royalty.payee` must be a Hedera account and nothing produces one from an opaque `author`. Publish authentication (who may `POST /publish`; key resolution via mirror node) — still nothing.
2. Buyer key custody and spend caps in `mcp` — `fleet/agent.ts:19-43` has the exact pattern (`maxAmountPerPayment`); the plan moves the file and never says the MCP server uses it.
3. Rate-limit identity for free `/search` — "per account" with no payment and no auth is per-IP at best.
4. `half_life_days` unbounded.
5. `body_uri` storage: cap, retention on delist, backup, retention deposit — still "the lever", still no column, no phase.
6. Near-duplicate body check on publish.
7. Facilitator single dependency (Blocky402) and fallback URL.
8. Testnet resets erase HCS provenance — §12 still calls it "proof an artifact existed".
9. `SELECT vec_version()` startup check for sqlite-vec.
10. `estimatedCostUsd` refund "recorded against ratio" needs `purchase.refund_reason`.

---

## 5. Sign-off criteria

The plan is solid enough to execute when **all** of the following are true and checkable by reading the document and the repo:

1. **Sequencing.** §8.1 lists, per step, the files that move, the `package.json` files that gain `@carpool/hedera-x402: workspace:*`, and whether the lockfile is regenerated; no step is labelled red; a dry run of the step list against the import graph (grep `from "@carpool/core"` and `from "./…"` for each moved file) finds no importer left pointing at a deleted path. `apps/bench` appears in a phase row.
2. **Gate.** §8.3 separates `resourceKey(req)` (pure) from `quote(...)`; has an `owe()` hook; states how the settle result reaches the handler; requires `onPaid` idempotent on `txId`; names where `meta` travels on the wire. The four `quotebinding.test.ts` cases are restated against the new interface in the plan text, including "the key is derived without calling `quote()`".
3. **Settlement.** §8.2 names the reference `SettlementLedger` implementation and its file, the two double-claim tests to port, and adds `mirrorUrl`/`memoPrefix` to `createSettler`.
4. **Money.** §8.4 states the window in seconds, the refund authentication mechanism, the `null`-payer rule, the `tracker_fee` rule on refund, and qualifies the custody bound for `DUST` and idle settler. §4 has `purchase.refund_reason`.
5. **Consent.** §9 uses `ask` for interactive, `deny` for `agent_id` present or `permission_mode ∈ {bypassPermissions, dontAsk, auto}`, records approval in `PostToolUse`, and says `-p` behaviour of `ask` is unverified.
6. **Consistency.** No pair in S8 remains; `canonicalHash` has one home; the `hedera-x402 ↔ carpool-core` dependency direction is stated in one sentence.
7. **Table.** Every path in `find . -type f -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/dist/*' -not -path '*/.turbo/*' -not -path '*/.git/*' -not -path '*/data/bodies/*'` has a row or is covered by a directory-level row with a verb.
8. **Evidence.** Both server processes are stopped; the counts in §2 match `sqlite3 ledger.sqlite` after `wal_checkpoint(TRUNCATE)`; the plan says whether the archive is a JSON export or a binary, and if binary, why.
9. **Definitions.** `freshness(a)` is a formula; `/search` carries `embedding_model` with a 409 rule; `merkleProof` is in the `hedera-x402` export list or explicitly deferred with a reason.
10. **Precondition.** `nvm use` → `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm test` is green on the current tree before step A1 is attempted, so "green at every commit" has a green baseline.
