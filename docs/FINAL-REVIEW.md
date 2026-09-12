# Final whole-branch review — `d2e74fb..0d34464` (Carpool v1 → v2)

*Reviewed 12 Sep 2026 against the diff, `progress.md`, `RESTRUCTURE.md` (+ review 3), `PHASE0.md`, `AB-MEASUREMENT.md`, and the tree on disk. **[V]** = verified by reading or running; **[?]** = stated but not run.*

> **Point-in-time document. Its test counts are stale and should not be quoted.**
> This review is pinned to `d2e74fb..0d34464`; the branch has moved. Specifically:
> "**238 tests / 29 files**" (§2) and "232 tests" (§4) were right when written and
> are now far below the suite's size — `pnpm test` prints the current count and the
> package breakdown on every run, and that output is the figure to quote. The
> per-package numbers in §6 are stale for the same reason. Three findings below have
> also been fixed since: the Node guard is chained into `build`, `test` **and**
> `typecheck` (so the "198 tests silently never run" bypass is closed, and `pnpm
> test` now names any package that produced no result at all); the `Dockerfile`
> copies all seven workspaces; and `rank()` has a production caller at
> `apps/registry/src/search.ts:210`, so the "`rank()` has no production caller"
> row in §4 is resolved. `bench/run.ts:9`'s citation of the deleted
> `bench/pairs.ts` is still open.

---

## 1. Verdict

**Not mergeable as "done".** Mergeable as "the rail and registry are built; the product surface is not".

The parts that were built carefully are built carefully: `PaymentGate` replays the issued quote, the settlement ledger's claim and void are both conditional, refunds are held back behind `available_at`, the anchor skips empty epochs, and the registry tests blank the repo-root `.env` before importing the server. None of the money-path defects below is a double-spend.

What blocks is that **the product does not work end to end and the headline numbers were never measured**:

- `apps/mcp` cannot publish (wrong field name, wrong author format) and crashes on any non-empty search result. Neither path has a test. The only end-to-end surface an agent would use is broken at both ends.
- `@carpool/tracker` — "the one genuinely new part" — is on no execution path. `/search` is a recency-ordered stub; the MCP's dynamic import of the tracker fails with `ERR_MODULE_NOT_FOUND` because it is not a dependency of `apps/mcp` at all **[V]**.
- `docs/AB-MEASUREMENT.md` and the README's headline block (`412s → 4.2s · 195,524 → 51 tokens · $2.14 → $0.31`) are the literals in `apps/bench/src/ab.test.ts`. The H1 commit contains `ab.ts`, `ab.test.ts` and the doc — no runner, no run log, no purchase, no transaction **[V]**. The README calls this "a real measurement against a real artifact, not an illustration."

### Minimum blocking list

| # | Fix | Where |
|---|---|---|
| C1 | Either run the A/B for real (publish → search → buy on a local registry, keep the JSONL and the settle tx) and put the evidence in `docs/evidence/`, or relabel README + AB-MEASUREMENT as an illustration with fixture numbers. The current text is false. | `docs/AB-MEASUREMENT.md`, `README.md:9-15` |
| C2 | `apps/mcp/src/publish.ts`: send `authorSig` (not `signature`); build `author` as `"<accountId>:<publicKeyHex>"`. Add a test that publishes through the real registry `app`. | `apps/mcp/src/publish.ts:41,57` |
| C3 | `apps/mcp/src/server.ts:43`: `m.ageDays` is undefined on every `/search` result → `TypeError`. Derive it from `decay.producedAt` (or emit it server-side) and test `renderCandidate` against a real `/search` payload. | `apps/mcp/src/server.ts:43`, `client.ts:28` |
| C4 | Decide the tracker: wire `TrackerIndex`+`rank()` into `GET /search` and make `@carpool/tracker` a real (optional) dependency of `apps/mcp`, **or** rewrite README/CONTRACT/tracker-README to say ranking is unwired and search is newest-first. Today the docs describe code that never runs. | `apps/registry/src/server.ts:131-155`, `apps/mcp/package.json`, `apps/mcp/src/embed.ts:57` |
| I1 | Settler: a failed on-chain batch strands its claimed rows; `reconcile()` marks a FAILED result as settled. Release claims on non-SUCCESS. | `packages/hedera-x402/src/settler.ts:140-143,173-181` |
| I5/I6 | `CONTRACT.md` is wrong on four wire shapes and the MCP was written to it. Fix the doc to the code and add the `x-carpool-body-hash` header the contract promises. | `CONTRACT.md:23-28,57,66,76`, `apps/registry/src/server.ts:238` |

Everything else in §2 is Important-but-not-blocking or parked with a ruling in §3.

---

## 2. Findings

### Critical

**C1 — The A/B numbers are test fixtures presented as a measurement.** [V]
`git show 2bf4931 --stat` → `ab.ts`, `ab.test.ts`, `AB-MEASUREMENT.md`; nothing else. Every number the doc labels "measured here" is a literal in `ab.test.ts:4-22` (`durationSeconds: 412`, `estimatedCostUsd: 2.14`, `priceMicroUsdc: 310_000`, `latencyMs: 4_200`). Cross-checks that fail independently:
- "Buy price ($0.31) — `priceAt()` at one day old with the shipped defaults": the shipped rule (`apps/mcp/src/server.ts:179-182`, `publish.ts:59`) gives base 321,000 / floor 32,100 µUSDC, so `priceAt` at one day is **$0.193** and at zero days **$0.353**. $0.31 is neither.
- "$0.31 is 15% of the redo cost": 15% of $2.14 is $0.321.
- "Full-read tokens (11,355)": `approxTokens` over the named 45,896-byte file is **11,474**; over the fixture body (`"x".repeat(184_000)`) it is 46,000.
  - *Retracted 2026-09-12 — this sub-finding was itself wrong.* `approxTokens` divides `text.length`, i.e. **characters**, by 4. The file is 45,417 characters in 45,896 UTF-8 bytes (em dashes, arrows, box drawing), so the function returns **11,355**. 11,474 is `wc -c` ÷ 4. 11,355 was the one number in the old doc that was genuine, and it stands unchanged. See the note on `approxTokens` in `apps/bench/src/ab.ts`.
- "Source count (143) — counted from the artifact": a direct count of `http(s)://` in the file gives 28. Whatever produced 143 is not in the repo.
- "Buy latency (4.2s) — search + fetch round trip": no round trip could have been made with the shipped code (C2, C3, I4).
The ledger's own framing — "H: the A/B is no longer a nice-to-have; it is the gate that Phase 0 failed to be" — makes this the most consequential defect on the branch. **Fix:** run it, or relabel it. There is no third option that keeps "real measurement" in the README.

> **RESOLVED 2026-09-12 — run, not relabelled.** `apps/bench/src/ab-run.test.ts` boots the real registry in-process, publishes the real artifact through the real `publishArtifact()`, searches through the real client, and buys through the real `payFetch()`; `apps/bench/src/provenance.ts` recovers the redo cost from the producing session's recorded `usage` blocks. `docs/AB-MEASUREMENT.md` is regenerated from that runner's verbatim output and opens with a correction box; `README.md` carries the retraction. Two findings above are confirmed exactly as written (143 → 28 sources; `$0.31` was the fixture's `priceMicroUsdc`); the 11,474 sub-finding is retracted as incorrect (see above). One defect this review did not catch: the naive per-row `usage` sum overstates a segment by ~2.3x, because one API response is written as several content-block rows that each repeat the same usage block.

**C2 — `carpool_publish` is rejected by the registry on two independent grounds.** [V]
`apps/mcp/src/publish.ts:57` posts `signature`; `apps/registry/src/server.ts:264` requires `authorSig` (`z.string().min(1)`) → zod throws → 400. Independently, `publish.ts:41` sets `author: accountId`; `apps/registry/src/identity.ts:17-22` requires `"<accountId>:<publicKeyHex>"` → throws → 400. The MCP never derives or sends the public key at all. No test imports `publish.ts`. **Fix:** `author = \`${accountId}:${PrivateKey.fromStringECDSA(key).publicKey.toStringRaw()}\``, rename the field, and add a test that drives the registry `app` from `server.test.ts`'s harness.

**C3 — `carpool_search` throws on every non-empty result.** [V]
`apps/mcp/src/server.ts:43` renders `m.ageDays.toFixed(1)`; `GET /search` (`apps/registry/src/server.ts:147-153`) returns `{...manifest, priceNow, freshness, health}` — no `ageDays`. `undefined.toFixed` → `TypeError` → the tool errors whenever there is something to buy. The `ManifestSummary` type (`client.ts:28`) declares a field the server never sends. **Fix:** compute `ageDays = (Date.now() - Date.parse(decay.producedAt)) / 86_400_000` in the client; test `renderCandidate` against an actual `/search` response body.

**C4 — The tracker is not on any execution path, and the docs say it is.** [V]
- `grep -rn "@carpool/tracker"` outside the package itself: `apps/mcp/src/embed.ts:57` (dynamic import) and prose. `apps/registry` does not import it. `rank()`, `depth()`, `TrackerIndex`, `normalizeQuestion`, `findDuplicateQuestion`, `DEFAULT_HALF_LIFE_DAYS`, `MAX_HALF_LIFE_DAYS` are called by tests and `pnpm bench` only.
- `apps/mcp/package.json` lists no `@carpool/tracker` dependency, optional or otherwise. `cd apps/mcp && node -e "import('@carpool/tracker')"` → `ERR_MODULE_NOT_FOUND` **[V]**. So the "optional dependency" ruling in the ledger (Task F) was implemented as *no* dependency: local embedding never happens and every search is the "remote text" path.
- `GET /search` ignores both `vector` and `q` (`server.ts:137-141`, README "STUB until Phase C"). So the text the MCP sends after apologising for sending it is not read either.
- README.md:29-30 ("the tracker ranks on depth rather than similarity alone"), AB-MEASUREMENT.md:72-73, and `packages/carpool-tracker/README.md:6-13` ("the part that decides whether the product works") describe behaviour the running system does not have.
**Fix:** wire it (the plan's Phase D row depends on C; Phase C's README says "that's for the task that wires this package in" and no task did) or say plainly that ranking is unwired. Moving `normalizeQuestion` into `@carpool/core` (it is a pure string function) removes the ONNX excuse for both the registry and the MCP, which currently reimplements it divergently (`publish.ts:68-70` strips `[.?!,;:]` where the tracker strips `[\s.,!?;:'"()]`).

### Important

**I1 — A failed settlement batch strands its payees, and `reconcile()` marks failures as settled.** [V by reading]
`settler.ts:110` claims rows, `:140-141` executes and `getReceipt`s. `TransactionResponse.getReceipt` throws `ReceiptStatusError` on any non-SUCCESS status (`@hiero-ledger/sdk` `TransactionResponse.cjs:105`) — e.g. `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` because one author's `payout()` account (`identity.ts:24`, never validated at publish) has no USDC association. Then: the batch stays `pending` with `tx_id NULL` and **all rows in that chunk (up to 9 payees) stay claimed**; `run()` aborts so later chunks are not paid this epoch; `reconcile()` only runs at boot (`server.ts:63-66`); and when it does run it matches the failed tx by memo and calls `markSettled(b.id, tx, match.result)` (`settler.ts:180`) with **no check that `result` is SUCCESS** — the rows are now permanently "settled" and nobody was paid. **Fix:** in `run()` catch `ReceiptStatusError`, release the claim (`UPDATE payout SET settled_batch_id = NULL WHERE settled_batch_id = ?`, batch → `FAILED:<status>`) and continue; in `reconcile()` only mark settled on `result === "SUCCESS"`, release otherwise; run reconcile at the start of every epoch, not only at boot; validate `AccountId.fromString(payout())` at publish (the parked Task-B minor). Secondary: `batch.root` and the memo are computed from the *provisional* amounts before the claim (`:110-113`), so when `claimed ⊂ requested` the stored root does not describe the leaves that were paid or anchored.

**I2 — `runSettleEpoch` is not single-flight; a timer/`POST /settle` collision anchors twice.** [V by reading]
`Settler.settle()` de-duplicates by returning the running promise, so two concurrent callers receive the *same* `batches` array. `runSettleEpoch` (`settlement.ts:70-88`) then calls `anchorEpoch` from each caller with identical leaves → two HCS messages, two fees, for one epoch. `settlement.test.ts:229` "two concurrent POST /settle calls produce one batch" asserts batches, not anchors. This is exactly the class of leak the RUNBOOK warns about. **Fix:** wrap `runSettleEpoch` in the same running-promise guard, or make `markAnchored` happen inside `settle()`'s critical section and skip anchoring when `unanchored.length === 0 && batches.length === 0`.

**I3 — The "payout table can never exceed receipts" guard lives only at publish time.** [V]
`server.ts:294` rejects `priceFloor < cfg.trackerFee` at publish, but `trackerFee` is env (`TRACKER_FEE_MICRO_USDC`). Raise it after artifacts exist and `recordPurchase` (`ledger.ts:266,290-296`) accrues `tracker_fee = cfg.trackerFee` in full while `royalty = max(0, paid − fee)` is zero → payouts sum to more than `paid`. **Fix:** `const fee = Math.min(this.cfg.trackerFee, args.paid)` in `recordPurchase` and the two refund paths; one test.

**I4 — The default price rule and the default spend cap are mutually exclusive.** [V]
`carpool_publish` prices at `max(1,000, 0.15 × estimatedCostUsd × 1e6)`; `carpool_fetch` (`pay.ts:19`) and bench (`agent.ts:31`) cap at 20,000 µUSDC. Any artifact that cost more than **$0.133** to produce is unbuyable with defaults, and the doc's own $0.31 example is 15× the cap. The x402 client's spend control rejects before the request is sent, so the tool reports a generic failure. **Fix:** raise the default cap (or express it as a multiple of the quoted price) and have `carpool_search` say "over your cap" per candidate.

**I5 — The MCP's integrity check is dead code and the tool output claims a verification that never happens.** [V]
`pay.ts:80` reads `x-carpool-body-hash`; the registry never sets it (`server.ts:238`). So the block at `:81-95` never runs — yet `server.ts:133` tells the agent "`sha256 … (verified against the manifest)`". Also `pay.ts:78` reports `res.headers.get("PAYMENT-RESPONSE")` — a base64 blob — as the "Transaction:"; bench decodes it correctly (`agent.ts:59-68`), the MCP does not. **Fix:** `res.setHeader("x-carpool-body-hash", row.bodyHash)` in the 200 path (one line), compare in `pay.ts` against the manifest's `bodyHash` from the search result, decode the payment response, and drop "(verified…)" until it is.

**I6 — `CONTRACT.md` disagrees with the code on four wire shapes, and the MCP was written to the contract.** [V]
| Contract says | Code does |
|---|---|
| `/.well-known/carpool` → `trackerFee: 500` | `prices: { trackerFeeMicroUsdc }`, plus `asset`, `network` (`server.ts:393-401`) |
| `POST /publish` `{ manifest, body, signature, … }` | `authorSig` (`server.ts:264`) |
| `POST /refund` `{ txId, magnet, signature }` | also requires `buyerPublicKey` (`server.ts:340`) |
| `200` carries `x-carpool-body-hash` | never set |
| `?vector=` preferred, `?q=` accepted | both ignored |
`apps/mcp/src/client.ts:7` types `trackerFee` per the contract. **Fix:** correct the document and add one contract test both apps import.

**I7 — The consent decision that is tested is not the one that runs.** [V]
`consent.ts` (`decideConsent`, five tests) is imported by nothing but its test. The hook that Claude Code actually executes, `hooks/pre-publish.mjs`, reimplements a subset: no `approvedProjects`, no `auto`, no project scoping. `consent.ts:12-15` and `apps/mcp/README.md:69-72` describe an approval "recorded in `PostToolUse`" — no PostToolUse hook exists anywhere. The plan's Phase F acceptance ("publish denied in a subagent, proven by test") is proven for a function the hook does not call. **Fix:** have the hook `import("../dist/consent.js")` and delete the `auto`/`approvedProjects`/PostToolUse story, or implement it. Also `README.md:513` "Keys are never logged" is true **[V]** — `pay.ts`/`publish.ts` read env and never print it.

**I8 — There is no delist.** [V]
`artifact.delisted_at` is written nowhere (`grep delistedAt` → schema, `isLive`, the `INSERT … null`). No route sets it. Yet `carpool_publish`'s tool text, the consent hook, `apps/mcp/README.md:40-42` and `RESTRUCTURE.md:603` all say "delisting stops new sales". An author has no way to stop selling. **Fix:** `POST /delist { magnet, signature }` (author-signed over `magnet + ":delist"`), or remove the affordance from every string that promises it.

**I9 — v2 has never moved real money, and the docs imply it has.** [V] — **RESOLVED 2026-09-12**
Phase D's acceptance row is "Real paid fetch on testnet with a HashScan link". No HashScan link, transaction id, or run log for v2 exists in `docs/`, the READMEs, or the task reports. Every v2 purchase/settle has run against stub facilitators and a mocked SDK. README.md:32 "the machinery works" and the RUNBOOK's confident custody section read as though it had. **Fix:** one real testnet publish → buy → `POST /settle` with the tx ids in `docs/evidence/`, or say "unproven on-chain" in the README.

> **Resolved by the first option, on 2026-09-12.** One real run against the real Blocky402 facilitator and the real `@hiero-ledger/sdk`: purchase `0.0.7162784@1789202339.427560739` (110,000 µUSDC), settlement `0.0.10475802@1789202482.460233839` (109,500 µUSDC to author `0.0.10475801`), HCS anchor on topic `0.0.10496824` seq 1. Evidence, including a repository-independent verifier, in `docs/evidence/v2-first-testnet-run/`. **And closed the same day by a second, full-feature run:** `POST /refund` on chain in both directions, an epoch paying **13 payees across two chunks**, `reconcile()` recovering a real batch, a consensus-reached failure classified `failed` and its rows parked then unparked and paid, all three `POST /batches/:id/resolve` actions, `GET /owed` + `POST /owed/replay`, and the cross-process `settle_lease` producing one transfer where two processes raced. 27 purchases, 25 batches, 15 anchors, and a 61-check repository-independent verifier in `docs/evidence/v2-full-feature-run/`. What remains stub-only is now a much shorter list — `EMPTY_CLAIM`, `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`, the `DUPLICATE_TRANSACTION` reconcile branch, a 10-entry transfer list, the body-integrity `502` — and README.md, CONTRACT.md, docs/RUNBOOK.md, docs/RESTRUCTURE.md §8, docs/SWARM.md and `apps/registry/README.md` each say so.

**I10 — Dockerfile likely cannot build.** [?]
`Dockerfile:17-22` copies `package.json` for five workspaces then `pnpm install --frozen-lockfile`; `pnpm-workspace.yaml` globs `packages/*` and `apps/*`, and the lockfile has importers for `packages/carpool-tracker` and `apps/mcp`. A frozen install with two importers missing from disk fails with `ERR_PNPM_OUTDATED_LOCKFILE`. Not run. **Fix:** copy all seven `package.json`s. (`.dockerignore` correctly excludes `.env`, `data/` **[V]**.)

### Minor (should-fix unless marked leave)

- `packages/hedera-x402/src/errors.ts` — dead: zero importers **[V]**; review 3 already said delete.
- `hedera.ts:26-28` `haveCreds()` constructs a fresh `Client.forTestnet()` on every `GET /health` and never closes it — a timer/socket per health check once credentials are set. Cache the client or check env only.
- `server.ts:118-128` `h()` maps every non-`HttpError` throw to **400**, including SQLite failures.
- `apps/mcp/src/server.ts:155` accepts `fetchedAt: z.string()`; the registry requires an offset datetime, so a publish with a bare date 400s with an unhelpful message.
- `MAX_HALF_LIFE_DAYS` is enforced nowhere; the tracker README says "something has to say what short means for a publish path or MCP client to use" — nothing uses it, and `carpool_publish` accepts any positive half-life.
- README.md:73 says `hedera-x402` ships an "outbox". It ships an `owe()` callback; the durable table (`owed_failure`) is in the registry and nothing replays it.
- `apps/registry/src/db/schema.ts:31-35` / README "exactly-once by construction" for anchoring is at-least-once (parked Task-E minor is correct); soften the sentence.
- `packages/carpool-tracker/bench/run.ts:9` cites `bench/pairs.ts`, which does not exist (parked C minor) **[V]**.
- `carpool_fetch` writes paid content to `os.tmpdir()/carpool-artifacts` — world-readable on shared hosts. Prefer `~/.carpool/artifacts` with 0700.
- `tracker/src/index.ts:122-137,140-145` `upsert`/`remove` are two statements outside a transaction (parked): wrap in `db.transaction`.

### Secrets audit — clean, with two notes
Tracked files contain no keys (`git ls-files | grep -E '\.env|sqlite'` → `.env.example` only) **[V]**. `.dockerignore` excludes `.env`/`data` **[V]**. `create-accounts.ts:85-88` prints the new `CARPOOL_PRIVATE_KEY` to stdout once, by design and labelled. `apps/bench/src/scripts/bootstrap.ts:135` writes 13 raw private keys to `accounts.json` (gitignored). Error paths print `e.message` only. The local `.env` still carries v1 `PROVIDER_*` keys and `SETTLEMENT_PORT`; nothing reads them, but the vars are dead and should be pruned from the operator's file.

### Network / idle-process audit
- Registry epoch timer (`server.ts:71-75`): `.unref()`, 600 s, settles only rows with `available_at <= now`, anchors only with non-empty leaves **[V]**. The I2 double-anchor is the one remaining paid leak.
- `server.test.ts:104-127` blanks `CARPOOL_PRIVATE_KEY`/`HCS_TOPIC_ID` *before* a dynamic `import("./server.js")` **[V]** — ordering is correct. `settlement.test.ts:26` mocks `@hiero-ledger/sdk` wholesale and restores env in `afterAll` **[V]**.
- `apps/bench` tests inject `makePayFetch` and bind a stub facilitator on 127.0.0.1 **[V]**. `pnpm bench` (tracker) downloads an 87 MB model — documented, not part of `pnpm test`.
- `settler.reconcile()` at boot reaches the mirror node only when `pending()` is non-empty **[V]**.

---

## 3. Triage of the parked findings

| Parked finding (ledger) | Ruling | Why |
|---|---|---|
| **#1 `ledger.ts:111` stores author-supplied `questionNorm`; `normalizeQuestion`/`findDuplicateQuestion` unwired** | **must-fix** | `questionNorm` is inside the signed, content-addressed manifest, so the registry cannot *overwrite* it without breaking `magnet === magnetOf(manifest)`. Correct fix: at `POST /publish`, **reject** when `manifest.questionNorm !== normalizeQuestion(manifest.question)` (400), and move `normalizeQuestion` into `@carpool/core` so neither the registry nor the MCP needs the ONNX-bearing tracker for a string function. Then run `findDuplicateQuestion` over live artifacts in the same `scope` — as a *signal* (surface the existing magnet in the response), not a rejection, since the design is content-addressed by intent. Folds into C4. |
| **#2 `@carpool/core` blanket re-exports `@carpool/hedera-x402`** | **should-fix** (same PR as C2/C3) | No runtime defect today — the dashboard already works around it — but it makes core's semver surface the whole rail and drags express/better-sqlite3/drizzle into `apps/mcp`, which ships to developer machines. Ten-line fix: drop `export * from "@carpool/hedera-x402"` (`core/src/index.ts:1`); `apps/registry` already imports both directly; `bench/agent.ts:20` and `bootstrap.ts:18` take `USDC_TOKEN_ID_TESTNET` from core → switch to `@carpool/hedera-x402`, already a bench dependency. |
| B: `priceAt` non-integer inputs | leave | Registry schema enforces `.int()` **[V]**. |
| B: `HederaAuthor` does not validate `accountId` | **should-fix** | It is the input to I1: an unparseable/unassociated payout account poisons a whole batch. `AccountId.fromString` at publish, plus a mirror-node association check behind the injected resolver. |
| B: `canonicalize` hashes `Date` as `{}` | leave | Manifest dates are strings. |
| D: `peer.account` keyed inconsistently; `refunds_issued` never incremented | should-fix | Dashboard "rode" and peer rows are wrong for any author who also buys; `refunds_issued` is a column the schema and tests pin but nothing writes. Small. |
| D: concurrent `/refund` 409 reason misleading | leave | Cosmetic; the outcome is correct. |
| D: `/search` ignores `vector`/`q` | **must-fix** | This *is* C4. |
| D: `refundUndelivered` returns `ok:true` with `refundAmount 0` and the route says "issued" | should-fix | Return `{ ok:false, reason:"nothing left to void" }` when both voids fail; one line and one test. |
| E: anchor-then-mark crash window; "exactly-once" overclaims | should-fix (wording) | Code direction (duplicate, never lost) is right; the sentence in `schema.ts:31-35` and the registry README is not. |
| C: `upsert`/`remove` untransacted | should-fix | Three lines; an orphaned `vec0` row after a crash is otherwise permanent. |
| C: recall@5 capped at 5/n; threshold 0.55 from 8 queries | leave | Labelled synthetic everywhere it appears **[V]**. |
| C: `tsconfig` excludes `bench/**` from typecheck | should-fix | It will rot; the stale `pairs.ts` comment is the first symptom. |
| C: `embed.test.ts` first two cases assert only stub args | see §6 | |
| C: `@huggingface/transformers` hard dep → F must decide | **must-fix** | F "decided" by not depending on the tracker at all (C4). |
| C: `bench/run.ts:9` cites deleted `bench/pairs.ts` | should-fix | One line. |
| G: ARIA tabs, refund row shows `paid` not `paid − fee`, "rode" tooltip, double `onSelect`, `$0.0310` vs `$0.31` | leave, except the refund-row amount (should-fix: it mislabels money) | |
| B1 not independently reviewed | reviewed here | `apps/bench` is sound; `report.ts`'s `hitRatePct` is "purchases / requests" and the comment says so. Nothing blocking. |
| G fix round not re-reviewed | reviewed here | The three fixes are present in the tree (`derive.test.ts` rename pins, reduced-motion clock in `refresh()`); nothing blocking. |

---

## 4. Honesty audit

| Claim | Where | Code says | Severity |
|---|---|---|---|
| "That is a real measurement against a real artifact, not an illustration" | README.md:13; AB-MEASUREMENT.md throughout | Fixture literals; no run artefact; three of six "where each number comes from" rows do not reproduce (C1). **Resolved 2026-09-12: a runner now exists and both documents are regenerated from it, with the fabrication recorded rather than swapped out** | **Critical** → resolved |
| "the tracker ranks on depth rather than similarity alone" | README.md:29-30, AB-MEASUREMENT.md:72-73, tracker README:6-13 | `rank()` has no production caller; `/search` is newest-first (C4) | **Critical** |
| "Three tools" that work: search → judge → buy → publish | README.md:77, mcp README:3-7; plan Phase F acceptance | search crashes on results (C3); publish is 400'd (C2); local embedding cannot load (C4) | **Critical** |
| `/.well-known` shape, `/publish` field, `/refund` body, `x-carpool-body-hash`, `?vector` "preferred" | CONTRACT.md:23-28,38,57,66,76 | All five differ from `server.ts` (I6) | Important |
| "sha256 … (verified against the manifest)" | `apps/mcp/src/server.ts:133` tool output | No comparison is performed (I5) | Important |
| "The approval is recorded in `PostToolUse`" | mcp README:71, consent.ts:13 | No PostToolUse hook exists (I7) | Important |
| "Delisting stops new sales" | mcp tool text, hook, README, plan | No delist path (I8) | Important |
| ~~"Real paid fetch on testnet with a HashScan link" (Phase D acceptance) / "the machinery works"~~ | RESTRUCTURE.md:375; README.md:32 | **Row closed 2026-09-12:** v2 ran it — purchase `0.0.7162784@1789202339.427560739`, settlement `0.0.10475802@1789202482.460233839`, anchor topic `0.0.10496824`. Evidence in `docs/evidence/v2-first-testnet-run/`. **Refund and multi-payee batches were then proven on chain by the full-feature run of the same day** — `docs/evidence/v2-full-feature-run/`, 27 purchases, 13 payees in one epoch across two chunks, a refund settled on chain. | — (was Important) |
| "$0.31 is 15% of the redo cost" / "priceAt() at one day old" | AB-MEASUREMENT.md:36,75 | 15% of 2.14 = 0.321; `priceAt` at one day = 0.193 | Important |
| ~~"Full-read tokens 11,355"~~ | AB-MEASUREMENT.md:24,39 | **Row retracted 2026-09-12: 11,355 is correct.** `approxTokens` counts characters (45,417), not bytes (45,896); 11,474 is `wc -c` ÷ 4 | — (was Minor; not a defect) |
| "143 source links" | AB-MEASUREMENT.md:13 | 28 `http(s)://` URLs in the file; 143 not reproducible | Minor |
| hedera-x402 provides an "outbox" | README.md:73 | An `owe()` hook; the table is in the registry; nothing replays it | Minor |
| "anchoring … exactly-once by construction" | schema.ts:31-35, registry README:84-86 | At-least-once (duplicate on crash between anchor and mark) | Minor |
| `precision@1 = 1.000` labelled synthetic | tracker README:200,215; bench/run.ts:23,170-176; progress.md | **Labelled "(synthetic)" on every line it is printed and every place it is quoted [V]** | — (correct) |
| PHASE0 numbers (42%, κ 0.26, 7.5, 0.5 d, CIs) | README, AB doc, tracker defaults | Consistent with `PHASE0.md` §3-4 and with each other **[V]**; the doc states its own limitations properly | — (correct) |
| "232 tests, 7 packages" | progress.md | 238 tests, 7 packages (§6) — stale, not wrong in direction | Minor |
| "Keys are never logged" | mcp README:99 | True for `apps/mcp` **[V]** | — (correct) |
| "Node 20.19.0; the preinstall guard rejects 26" | README.md:84 | `scripts/check-node.mjs` rejects `> 22` **[V]** | — (correct) |

---

## 5. What is genuinely good

- **`PaymentGate.handle` (`gate.ts:148-243`)** replays the *issued* requirements on the paid retry and never re-quotes; the test at `gate.test.ts:93` proves it by removing the quote source and watching the paid retry still succeed. That is the right way to test the property, and it is the bug that broke v1's concurrent payments.
- **`SqliteSettlementLedger`** makes both `claimBatch` and `void` conditional (`settled_batch_id IS NULL AND voided_at IS NULL`) and `ledger.test.ts:199-225` tests the boundary second where a claim and a refund are both legal. `refundUndelivered` re-reads the purchase row *inside* the transaction rather than trusting the caller's snapshot. `purchase(tx_id)` is UNIQUE so `onPaid` idempotency does not rest on a read-then-write. Money is integer µUSDC everywhere I traced it; the one hole is I3 and it is one `Math.min`.
- **Anchoring**: empty epochs are skipped by default with the v1 incident named in the comment (`anchor.ts:27-34`); `artifact.anchored_at` as the epoch cursor is genuinely crash-safe in the correct direction.
- **`server.test.ts:104-127`** blanks the operator key explicitly before a *dynamic* import, with a comment that explains dotenv's fill-gaps semantics; `settlement.test.ts` mocks the SDK class-by-class and restores `process.env` in `afterAll`. This is exactly the discipline the second incident called for, and it is done right.
- **`BodyStore.read` re-hashes on every read** and the 502-plus-`refund_due` path on mismatch (`server.ts:236-257`) is honest about the three sub-cases instead of claiming a refund it did not accrue.
- **The tracker bench's synthetic labelling** is thorough: a 35-line banner, `(synthetic)` on every printed line, a closing reminder, and the README repeats why the corpus cannot produce a false positive.
- **`PHASE0.md`** reports both raters, both bootstrap CIs, the per-category failures the median hides, and calls its own labels noise. It is the most honest document on the branch.
- **`apps/dashboard/lib/derive.ts:89-97`** types `droveAlone` as the literal `null` rather than inventing a number, and the ledger's fabrication walk confirms every column traces to a real field.
- **`scan.ts` strips rather than warns**, and `diff.ts` leads with the question — the right ordering for a consent dialog.
- The **ledger (`progress.md`)** records each ruling with a "cost if wrong" line and twice admits the brief was wrong rather than the implementer. That is why this review could be specific.

---

## 6. Test quality

Suite re-run for this review (`vitest run` per package, Node 20.19.0): **238 tests / 29 files, all green** — hedera-x402 40 · core 45 · tracker 45 · registry 52 · bench 21 · mcp 13 · dashboard 22. The ledger's "232" is stale. No network traffic was observed; the only log lines were the expected `CARPOOL_PRIVATE_KEY is not set`, `epoch anchor skipped (empty)` ×4, and one deliberate `onPaid failed for 0.0.0@no-payer-1` **[V]**.

**Two operational notes.** (1) Under this machine's default Node 26, `pnpm -r exec vitest run` fails in `settler.test.ts` on the better-sqlite3 ABI and aborts, so **198 tests silently never run**; `pnpm test` (turbo) is gated by `check-node.mjs` only at *install*, not at test time — worth a one-line guard in `turbo.json`/`test` script. (2) `EPOCH_SECONDS` is *not* blanked by `server.test.ts` and is filled from the real `.env`; harmless only because the timer is `.unref()`ed.

### Tests that would pass with the body deleted or that assert nothing

| File:line | Defect | Severity |
|---|---|---|
| `packages/hedera-x402/src/settler.test.ts` (whole file) | Named for `Settler` but never constructs one; `Settler.run()`/`reconcile()` have **zero coverage in their own package**. Every I1 branch is untested. | Important |
| `apps/registry/src/server.test.ts:32-33,264-265` | `verifyOk`/`settleOk` are declared and reset but never set `false`; `gate.ts:206` and `:210-213` (verify-failed / settle-failed 402) look covered and are not. | Important |
| `apps/registry/src/ledger.test.ts:285-296` | `recordOwedFailure` asserts only `ok === true`; passes with `return true` as the body. This is the last-resort record for money that already moved. | Important |
| `apps/bench/src/load.test.ts:63-65` | Titled "non-ok response" but targets `127.0.0.1:1` → ECONNREFUSED, so `load.ts:62`'s `!res.ok` branch never executes; bare `rejects.toThrow()`. | Important |
| `packages/hedera-x402/src/anchor.test.ts:29-39` | Both cases under `describe("anchorEpoch")` call only `merkleRoot`; `:37` is a bare `not.toThrow`. `anchorEpoch` itself is covered only via the registry's mocked-SDK suite. | Minor |
| `packages/carpool-tracker/src/embed.test.ts:17-29,39-44` | Three of five cases assert only the injected stub's call args (`expect.anything()` at `:22`). Confirms the parked C minor. | Minor |
| `apps/registry/src/settlement.test.ts:214,219` | Expected root computed with the `merkleRoot` under test; acceptable only because `merkle.test.ts` pins it by hand. | Minor |
| `packages/carpool-core/src/manifest.test.ts:43-60,72-74` | `toThrow()` with no matcher; "round-trips" asserts only `not.toThrow`. | Minor |
| `packages/carpool-core/src/magnet.test.ts:64-66` | "deterministic" passes for a constant return. | Minor |
| `packages/carpool-tracker/src/rank.test.ts:36-43,176-183` | Title says "one source", fixture passes `sources: []`; expected scores rebuilt from the same `depth()`/`freshness()` that `rank()` composes. | Minor |
| `apps/bench/src/load.test.ts:69-110` | Never asserts the `concurrency` semaphore its comment claims to test. | Minor |
| `apps/mcp/src/scan.test.ts:27-30` | Asserts redaction but never the `findings` entry; the abstract sweep is untested. | Minor |
| `apps/mcp` | `server.ts`, `client.ts`, `pay.ts`, `publish.ts` have **no tests at all** — which is how C2 and C3 shipped. | Important |

### Money-path branches with no covering test
`settler.ts`: `execute`/`getReceipt` throwing after `claimBatch`; non-SUCCESS receipt; both `EMPTY_CLAIM` paths; all of `reconcile()` including the mirror-fetch failure. `gate.ts`: `buildRequirements` → 503; malformed `PAYMENT-SIGNATURE`; `ensureInit` retry; LRU TTL expiry; `onPaid` throwing with no `owe()` (the `LEDGER WRITE LOST` path). `server.ts`: `bodyBytes` mismatch; stored-body integrity failure → both `refundUndelivered` sub-branches; "vanished after payment"; `/refund` 404 and magnet mismatch; fee-raised-after-publish (I3); timer-vs-`POST /settle` (I2). `ledger.ts`: "no royalty payout to void"; `recordOwedFailure` catch; `refundUndelivered` partial-void arithmetic. `settlement.ts`: anchor skipped (`no-topic`/`no-client`) leaving artifacts unanchored for the next epoch.

### Well-built tests, named
`ledger.test.ts:199-224` (refund vs. claim at the deadline second, both orderings, row counts asserted); `gate.test.ts:93-117` (no-re-quote proved by removing the quote source); `settlement.test.ts:229-248` (two concurrent `/settle` → one transfer, asserted against the fake SDK's submission log); `merkle.test.ts:8-38` (every expectation hand-computed with `node:crypto`, including odd-leaf promotion and the empty sentinel); `store.test.ts:42-48` (corrupts the file on disk bypassing the store's own write path); `decay.test.ts:51-60` (non-dyadic half-life so `round` is distinguishable from `floor`/`ceil`/`trunc`, 7071 derived by hand).
