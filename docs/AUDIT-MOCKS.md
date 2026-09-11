# AUDIT-MOCKS — every test double in the tree, and whether it is isolating a unit or standing in for something nobody has proven

**Verdict: of 27 doubles, 19 are legitimate isolation, 4 were legitimate but undocumented as to what they did not cover, and 4 were masking — the stub was the only thing standing where real behaviour belonged, so the suite was asserting the stub. A fifth masking finding is an *absence*: the product's four MCP tool handlers had no double and no test, because the module could not be imported. All five are fixed and each fix has a falsification recorded below. Two gaps remain open and are now loud in the files that own them: the real ONNX embedder runs in no test, and `batch.tx_id` holds two transaction-id notations.**

Branch `feat/phase1-reproducibility`, Node 20.19.0. Suite before this pass **828 tests, 7/7 packages**; after **862 tests, 7/7 packages, 0 failures**, `pnpm typecheck` 11/11.

The question asked of every double was the one that matters:

> Is it isolating the code under test from something slow, costly or nondeterministic **that is proven elsewhere** — or is it the *only* thing standing where real behaviour should be?

The second kind is worse than no test, because a green suite then asserts that the double works. This repo has been bitten by it twice already, and both are the reference cases: `apps/bench/src/support/localRegistry.ts` (since deleted) accepted publishes with no `authorSig` verification, so a wire-shape defect that made `carpool_publish` 400 on **every** call survived 238 green tests; and `packages/hedera-x402/src/gate.test.ts`'s fake facilitator had no `/settle` route at all, so the whole paid path was dead code in the file that claimed to cover it, and four money mutants survived.

This pass found the same shape three more times, in places nobody had looked:

1. **The stub facilitator never looked at the payload.** Every paid request in every package goes through it, and it answered `isValid: true` / `success: true` without inspecting anything. `apps/mcp/src/pay.ts` builds a genuine signed Hedera transfer through `@x402/hedera`; nothing checked that it produced one, and a payload of `{ signature: "stub" }` — a literal string — was accepted exactly as readily. The registry would also serve a paid body for a payment **denominated in a token it does not accept**.
2. **No test had ever executed a line of `apps/mcp/src/server.ts`** — the product's entire agent-facing surface. `await server.connect(new StdioServerTransport())` at module scope made it unimportable. The `confirm` gate that is the whole consent story for publishing, the secret-stripping wiring, and `carpool_fetch` writing to a file rather than returning the body inline were covered by nothing.
3. **The fake `TransferTransaction` accepted transfer lists HTS rejects** — lists that do not net to zero, and lists longer than 10 entries. Both are consensus-level refusals, so a broken batch would have been recorded as paid while nothing moved on chain.

---

## 1. The doubles

`a` = legitimate isolation, real behaviour proven somewhere named · `b` = legitimate, was undocumented as to its blind spots · `c` = masking: the only coverage of that behaviour

### Doubles that stand in for a network participant

| # | file:line | replaces | class | real behaviour proven by | note |
|---|---|---|---|---|---|
| 1 | `apps/registry/src/testing/stubFacilitator.ts:240` `startStubFacilitator` | the Blocky402 x402 facilitator | **c → fixed** | `/supported` is byte-identical to the live response (verified this pass); the paid path by `docs/evidence/v2-first-testnet-run/05-purchase.json` and `v2-full-feature-run/00-smoke-buy.json` | was 4 independent hand-written copies, none of which inspected the payload. See §2.1 |
| 2 | `apps/registry/src/testing/stubFacilitator.ts:83` `REAL_SUPPORTED` | `GET /supported` | **a** | captured verbatim, `curl https://api.testnet.blocky402.com/supported`, 2026-09-12; re-diffed this pass, identical | three networks, hedera **third** — see §3.1 |
| 3 | `apps/registry/src/testing/stubFacilitator.ts:326` `startStubMirror` | Hedera mirror node `GET /api/v1/accounts/:id` | **b → documented** | `v2-full-feature-run/40-unpayable-purchase.json` (real account response, `_type: "ECDSA_SECP256K1"`) | serves one of the two endpoints the product calls, and a subset of the body. Blind spots now in the file |
| 4 | `packages/hedera-x402/src/settler.test.ts:192` `stubMirror` | mirror node `GET /api/v1/transactions` | **c → fixed** | `v2-full-feature-run/14-chunk-settlement-mirror.json` | returned a `transaction_id` notation the real mirror node never uses. See §2.4 |
| 5 | `packages/hedera-x402/src/audit-money.test.ts:60` `stubMirror` / `:57` `mirrorRecord` | same | **c → fixed** | same | second copy of #4, same defect, same fix |
| 6 | `packages/hedera-x402/src/gate.test.ts:92` express fake facilitator | the facilitator, for the gate's own replay logic | **b → hardened** | the real paid path, one layer up, by #1 | cannot import #1 (apps must not be a dependency of packages). Now serves the real `/supported` and applies the same equality check; pointer in each file |

### Doubles that replace the Hedera SDK

| # | file:line | replaces | class | real behaviour proven by | note |
|---|---|---|---|---|---|
| 7 | `apps/registry/src/settlement.test.ts:83` `FakeTransferTransaction` | `TransferTransaction` | **c → fixed** | `v2-first-testnet-run/10-mirror-settlement-tx.json` (2 entries, net 0) and `v2-full-feature-run/14-chunk-settlement-mirror.json` (9 entries, net 0) | accepted lists HTS refuses. See §2.3 |
| 8 | `apps/registry/src/settlement.test.ts:105` `FakeTopicMessageSubmitTransaction` | HCS submit | **a** | `v2-first-testnet-run/11-mirror-hcs-messages.json`, one real consensus message with the anchored root | method-for-method what `anchor.ts` calls |
| 9 | `apps/registry/src/settlement.test.ts:74` `FakeClient` + `:125` `PrivateKey.fromStringECDSA` | operator client construction | **a** | `hedera.ts`'s `makeClient()` runs for real in every live run | exists only so `makeClient()` returns non-null without a key. Consequence: a malformed `CARPOOL_PRIVATE_KEY` is never validated in test |
| 10 | `packages/hedera-x402/src/anchor.test.ts:23` `FakeTopicMessageSubmitTransaction` | HCS submit | **a** | as #8 | records topic + message and can throw on receipt; `anchorEpoch`'s submit branch is asserted here rather than only in a consumer |
| 11 | `packages/hedera-x402/src/settler.test.ts:215` `settlerFor(…, submit)` — injected `SettlerDeps.submit` | `defaultSubmit`'s `execute`/`getReceipt` | **a** | `defaultSubmit` itself is tested directly at `settler.test.ts:605-633` with duck-typed rejections; end to end by both live runs | the `TransferTransaction` it builds is the **real** class — only submission is injected. Textbook |
| 12 | `packages/hedera-x402/src/audit-money.test.ts:39` `settlerFor` | same | **a** | same | |

### Deterministic replacements

| # | file:line | replaces | class | real behaviour proven by | note |
|---|---|---|---|---|---|
| 13 | `apps/registry/src/testing/hashedEmbedder.ts:55` `hashedEmbedder` | `localEmbedder()` → ONNX MiniLM | **b → documented, gap still open** | `v2-first-testnet-run/03-search.json` — one live query through `Xenova/all-MiniLM-L6-v2`, cosine 0.8097. That is the whole of it | contract now asserted in `apps/registry/src/embedder.test.ts`; blind spots in the file header. See §4.1 |
| 14 | `packages/carpool-tracker/src/embed.test.ts:12` `fakePipeline` + injected `loadPipeline` | `@huggingface/transformers` pipeline | **b → documented** | nothing executes the default `loadPipeline`; the model itself by #13's evidence file | legitimate (tests must not download 87 MB) and the file says so; what it leaves uncovered is now named in `embedder.test.ts` |
| 15 | `apps/registry/src/settlement.test.ts:47` `assertSubmittable` | HTS's own transfer-list validation | **a (new)** | both live runs' mirror JSON | added this pass; not a Hedera simulator — see §2.3 for what it still does not check |
| 16 | `packages/hedera-x402/src/settler.test.ts:171`, `audit-money.test.ts:68` `mirrorTxId` | the mirror node's id serialisation | **a (new)** | the two captured notations, §2.4 | |

### Injected fakes for a collaborator's interface

| # | file:line | replaces | class | real behaviour proven by | note |
|---|---|---|---|---|---|
| 17 | `packages/hedera-x402/src/gate.test.ts:172,177,181` `quote` / `onPaid` / `owe` | the product's ledger | **a** | the real implementations by `apps/registry/src/audit-onpaid-throw.test.ts`, which drives the real ledger through the real gate | `PaymentGate` is product-free by construction; these are its interface, not a stand-in for it |
| 18 | `apps/bench/src/load.test.ts:116` `neverCalled` injected `makePayFetch` | `payFetch` | **a** | `load.test.ts`'s own "drives real purchases against the real registry" test, plus `agent.test.ts` | deliberately unreachable: the probe fails first, so this exercises the driver's error path. Honestly named |
| 19 | `apps/registry/src/audit-onpaid-throw.test.ts:239,279,358,384,412` `vi.spyOn(ledger, "recordPurchase")` | a failing SQLite write | **a** | everything else in the path — gate, facilitator, routes, SQLite — is real | one spy, on the ledger the server actually uses, to inject the failure the audit named as likeliest |
| 20 | `apps/registry/src/audit-onpaid-throw.test.ts:364` `vi.spyOn(ledger, "recordOwedFailure")` | an outbox that cannot write | **a** | `recordOwedFailure` tested for real in `ledger.test.ts` | the only way to reach "nothing took the obligation" |
| 21 | `apps/registry/src/audit-money.test.ts:235`, `packages/hedera-x402/src/{audit-money,gate}.test.ts` `vi.spyOn(console, …)` | the console | **a** | n/a | in `gate.test.ts:495` it is the *assertion* (the `LEDGER WRITE LOST` alarm), not noise suppression |

### Fixture factories — data, not behaviour

| # | file:line | what it builds | class | note |
|---|---|---|---|---|
| 22 | `apps/registry/src/testing/harness.ts:170` `publishFixture` | a signed manifest posted through the **real** `POST /publish` | **a** | builds the manifest the way an honest client must, and returns the real route's status. Not a stand-in for publish — it *uses* publish |
| 23 | `apps/registry/src/{server,audit-onpaid-throw}.test.ts` `signedManifest`, `{ledger,settlement,audit-money}.test.ts` `manifestFixture` | signed manifests | **a** | `questionNorm` derived, never hand-written, so they cannot build manifests no client would produce |
| 24 | `apps/dashboard/lib/fixtures.testonly.ts:28-144` (7 factories) | registry responses | **a** | the strongest guard in the repo: `fixtures-unreachable.test.ts:366` walks the module graph and proves no rendered file can reach them. `FIXTURE —` prefixes make a leak visible |
| 25 | `apps/bench/src/report.test.ts:5` `line` | buy-log lines | **a** | pure arithmetic over a value type |
| 26 | `apps/bench/src/provenance.test.ts:31` `transcript` | synthetic `.jsonl` transcripts | **a** | synthetic on purpose — the real transcript is a private file outside the repo; real numbers come from `measure-redo.ts` into `redo-measured.json` |
| 27 | `packages/hedera-x402/src/settler.test.ts:230` `pendingBatch` | a claimed batch | **a** | built by calling the real `accrue`/`claimBatch` |

Out of scope, noted: the live-run drivers were in `apps/registry/live/*.ts` while this audit ran and are now archived at `docs/evidence/v2-full-feature-run/drivers/`, in no package's `test` script and no longer in the product tree. `drivers/lib.ts`'s `fixture()` generates live-run content, not test doubles.

---

## 2. The five masking findings, and what was done

Four are doubles (#1, #4, #5, #7 above). The fifth, §2.2, is the absence of one.

Every fix has a test that fails without it. Note: cross-package mutations need `npx tsc` in the mutated package first — workspace deps resolve to `dist/`, so mutating `packages/*/src` alone changes nothing for `apps/*` tests. That is itself a trap worth knowing.

### 2.1 The stub facilitator inspected nothing

**Was:** four independent stub facilitators (`testing/harness.ts`, `server.test.ts`, `audit-onpaid-throw.test.ts`, `gate.test.ts`), each answering `isValid: true` / `success: true` without reading the payload. So:

- nothing checked that `apps/mcp/src/pay.ts` or `apps/bench/src/agent.ts` produce a **signed transaction**. They build one for real through `@x402/hedera`; a regression that stopped signing would leave the whole suite green and fail on the first real purchase;
- nothing enforced the `paymentPayload.accepted` ≡ `paymentRequirements` equality the real facilitator applies. `gate.ts`'s own doc comment says that equality is why the paid retry must never re-quote — a claim no test could falsify;
- the gate keys its replay cache on `(resourceKey, amount, payTo)` only, so `asset`, `scheme` and `network` were passed to the facilitator and trusted. The registry would serve a paid body and accrue a royalty for a payment denominated in a token it does not accept.

**Done:** one shared `apps/registry/src/testing/stubFacilitator.ts` used by the harness, `server.test.ts` and `audit-onpaid-throw.test.ts`. It enforces (i) the five-field equality (`refuseReason`, `stubFacilitator.ts:192`) and (ii) `payload.transaction` being base64 that decodes to ≥64 bytes (`requireSignedTransaction`, default **on**). It records every call so a test can assert on what the product sent. `gate.test.ts` cannot import it across the package boundary, so it carries the same equality check and a pointer.

Two test files hand-roll their `PAYMENT-SIGNATURE` header (to choose the transaction id they later chase). They now turn `requireSignedTransaction` off **explicitly, with the consequence written at the call site** — "nothing in this file is evidence that a buyer's client can pay" — rather than silently benefiting from a stub that did not look.

New assertions: `apps/mcp/src/e2e.test.ts` "the payload apps/mcp sends is one a facilitator would accept" (4 tests: nothing refused, both `/verify` and `/settle` reached, a signed transaction >200 bytes not a placeholder, and all five fields echoed); `apps/registry/src/server.test.ts` "refuses a payment whose payload names a different asset than the 402 issued".

**Failing before — the strict check biting on payloads the real facilitator refuses:**
```
 FAIL  src/reads.test.ts   AssertionError: expected 402 to be 200   (buy at src/reads.test.ts:68)
 FAIL  src/delist.test.ts > leaves a purchase inside its refund window refundable…
                           AssertionError: expected 402 to be 200
```
**Failing before — the wrong-asset hole, with the equality check disabled (the pre-fix state):**
```
=== PRE-FIX (stub ignores accepted vs requirements) ===
   × GET /artifact/:magnet — x402 flow > refuses a payment whose payload names a
     different asset than the 402 issued
   AssertionError: expected 200 to be 402
```
A 200 means the registry served the goods and recorded the sale. Also found and fixed: `audit-onpaid-throw.test.ts` was sending `accepted: { amount, payTo }` — dropping `scheme`, `network` and `asset` entirely — which the real facilitator refuses outright.

### 2.2 No test had ever run an MCP tool handler

**Was:** `apps/mcp/src/server.ts` — all four `carpool_*` tools — was unimportable, so zero lines of it had ever executed. `e2e.test.ts`'s describe blocks are named after the tools but call the layer beneath them. Both defects `e2e.test.ts` exists for were in or just under this layer and both survived a green suite (`carpool_search` threw a `TypeError` on every non-empty result; `carpool_publish` 400'd on every call).

**Done:** the four handlers are named exports; the transport is connected only when the module is the process entry point (`import.meta.url === file://${process.argv[1]}`, the guard `apps/registry/src/server.ts` already uses). New `apps/mcp/src/server.test.ts` — **17 tests** — drives them through a real `McpServer` over `InMemoryTransport` with a real MCP `Client`, against the real registry via `testing/harness.ts`. So the zod `inputSchema`s, `listTools`, `isError` and the handlers all run exactly as an agent invokes them.

**Failing before (three mutations, each killed by the test that names the behaviour):**
```
MUTANT M9:  carpool_publish ignores the confirm gate
  × carpool_publish > does NOT publish without confirm: it returns the diff and says nothing happened
MUTANT M10: carpool_publish publishes the raw args, not scan.redacted
  × carpool_publish > STRIPS what the scanner found, rather than only warning about it in the preview
MUTANT M11: carpool_fetch returns the body inline
  × carpool_fetch > pays, writes the body to a FILE, and returns a summary rather than the body
```
And the same three against the **pre-existing** mcp suite with the new file excluded:
```
=== M9  against the PRE-EXISTING suite only ===   Tests  54 passed (54)
=== M10 against the PRE-EXISTING suite only ===   Tests  54 passed (54)
=== M11 against the PRE-EXISTING suite only ===   Tests  54 passed (54)
```
Bypassing the consent gate, dropping the secret-stripping, and returning the full body inline were all invisible.

### 2.3 The fake `TransferTransaction` accepted lists HTS rejects

**Was:** `execute` recorded any transfer list and returned SUCCESS. A real one is refused as `INVALID_ACCOUNT_AMOUNTS` if the token amounts do not sum to zero, and as `TOKEN_TRANSFER_LIST_SIZE_LIMIT_EXCEEDED` above 10 entries. `settleChunk` nets self-payouts out of the list and debits the payer `-moved`, deliberately not `-total`; getting that wrong yields a list that does not balance, which the fake happily "settled". Every pre-existing test batched payees none of whom was the payer, so `total === moved` throughout and the distinction was never exercised.

**Done:** `assertSubmittable` (`settlement.test.ts:47`) fails the test instead, and a new test reproduces the live run's exact shape — royalty to the author, the registry's own fee netted out, two entries balancing to zero, both payouts settled.

**Failing before:**
```
MUTANT M4: payer debited -total instead of -moved
settle: batch for payees 0.0.10475801, 0.0.9 failed with an ambiguous error
  (TransferTransaction would be refused as INVALID_ACCOUNT_AMOUNTS: token 0.0.1 nets -500,
   not 0 — [["0.0.1","0.0.10475801",109500],["0.0.1","0.0.9",-110000]])
  × POST /settle — the epoch loop > nets the registry's own fee out and submits a transfer that balances
      Tests  1 failed | 14 passed (15)
```
Still not checked by anything offline, and stated in the file: signatures, fees, account existence, balances, and token association. Those are proven only by the live runs.

### 2.4 The mirror stub used a transaction-id notation the real mirror node never returns

**Was:** every `mirrorRecord` returned `transaction_id: "0.0.9@111.222"`. The real mirror node returns `0.0.10475802-1789204986-055709931`. `reconcile()` writes that value straight into `batch.tx_id`, while `settle()` writes the SDK's `@` form — so **the same column holds two notations depending on which path recorded the batch**, and nothing in the suite could see it.

**Done:** `mirrorTxId` in both files serialises the way the real mirror node does, and a new test, `"the notation reconcile stores"`, pins it and names the inconsistency. Reverting one assertion to the `@` form produced exactly the contradiction, which is the proof:
```
 × the settlement lease (defect H4) > reconcile cannot run while a settle is mid-submit
   expected { tx_id: '0.0.1@9.9' } to match object { tx_id: '0.0.1-9-9' }
```
Not normalised in production: changing what is recorded on a money path is a product decision, not an audit's. **Open item — see §4.2.**

### 2.5 The stub facilitator made `payer` and the transaction id's account agree

**Was:** defaults `payer: "0.0.2222"` with `txId: "0.0.2222@1-1"`. Reality, twice captured: `purchase.buyer` is `0.0.10477413` / `0.0.10497426` while the transaction is `0.0.7162784@…` — Blocky402 declares `extra.feePayer` and submits the buyer's signed transfer itself. Any code taking the buyer from the transaction id would have looked correct in every test and attributed every real purchase to the facilitator.

**Done:** `DEFAULT_PAYER` / `DEFAULT_TX_ID` (`stubFacilitator.ts:110,124`) now differ the way the captured ones do, with the evidence cited, and `e2e.test.ts` asserts `purchase.buyer` is the reported payer and **not** the account in the transaction id.

**Failing before:**
```
MUTANT M3: buyer taken from the transaction id
  × records the buyer the facilitator reported, not the account inside the transaction id
  AssertionError: expected '0.0.7162784' to be '0.0.2222'
```
One knock-on, stated rather than absorbed: `buy.tokensForSummary` in `ab-measured.json` and `docs/AB-MEASUREMENT.md` is `approxTokens()` of the text `carpool_fetch` returns, which ends `Transaction: <txId>` — so a published figure moved with the *length of the stub's transaction id* (85 → 90). `ab-run.test.ts` now pins the old id rather than re-cutting a published measurement as a side effect, and says so: **85 understates a real purchase's summary cost by about 5 tokens, against 11,355 for reading the body.** No conclusion in the document moves, but the figure is a property of the stub as well as of the artifact.

---

## 3. Diffing the stubs against reality

The step nothing in the repo can do for itself. Ground truth: `docs/evidence/v2-first-testnet-run/`, `docs/evidence/v2-full-feature-run/` (read, not edited), and one live read-only `curl`.

### 3.1 Stub facilitator vs Blocky402

| property | real | stub | verdict |
|---|---|---|---|
| `GET /supported` body | `curl https://api.testnet.blocky402.com/supported`, 2026-09-12, HTTP 200 | `REAL_SUPPORTED` | **byte-identical** (re-diffed this pass by importing the constant and comparing to the live response) |
| networks advertised | `eip155:80002`, `solana:EtWT…`, `hedera:testnet` — hedera **third** | same, same order | matches. A single-kind stub could not distinguish "selects by network" from "takes `kinds[0]`"; `gate.test.ts` now asserts the issued 402 carries `network: hedera:testnet` and `extra.feePayer: 0.0.7162784`, never solana's |
| `/verify`,`/settle` request body | `{ x402Version, paymentPayload, paymentRequirements }` (`HTTPFacilitatorClient`, `@x402/core@2.25.0`; confirmed by logging the real request) | same | matches |
| `/settle` response fields read | `success`, `payer`, `transaction`, `network` | same | matches — the live runs produced a decodable `PAYMENT-RESPONSE` and a txId from exactly these |
| `payer` vs `transaction` account | **differ**: payer `0.0.10497426`, tx `0.0.7162784@…` | now differ | fixed, §2.5 |
| rejects an unsigned payload | yes | yes (`requireSignedTransaction`) | fixed, §2.1 |
| rejects `accepted` ≠ requirements | yes, strict equality | yes, five fields | fixed, §2.1 |
| everything else it rejects | signature validity, funding, association, quote expiry | **not reproduced** | honestly impossible offline; stated in the file. Proven only by the live runs |

### 3.2 Mocked `@hiero-ledger/sdk` vs the real SDK

| property | real | fake | verdict |
|---|---|---|---|
| methods called on `TransferTransaction` | `setTransactionMemo`, `addTokenTransfer`, `execute` | all three, chainable | matches `settler.ts:543-545` exactly |
| `execute` result shape | `{ transactionId: TransactionId, getReceipt(client) → { status: Status } }`, both with `toString()` | same | matches what `defaultSubmit` reads |
| transaction id notation | `0.0.10475802@1789204986.055709931` | `0.0.9@N.0` | same form ✓ (and distinct from the mirror node's, §2.4) |
| token transfer list nets to zero | **required**; every captured transfer nets exactly 0 | now enforced | fixed, §2.3 |
| max transfer entries | 10; largest observed real batch is **9** (8 payees + payer), consistent with `MAX_PAYEES = 9` | now enforced | fixed, §2.3 |
| `TopicMessageSubmitTransaction` | `setTopicId`, `setMessage`, `execute`, `getReceipt` | same; no `transactionId` | matches — `anchor.ts` discards the receipt, which is why `AnchorResult` carries no tx id or consensus timestamp (already a known finding in `v2-first-testnet-run/README.md`) |
| `PrivateKey.fromStringECDSA` | parses and validates | returns `{}` | divergence, low value: a malformed `CARPOOL_PRIVATE_KEY` is never validated in test. Noted at `settlement.test.ts:125` |

### 3.3 `hashedEmbedder` vs real ONNX MiniLM

| property | real (`localEmbedder()`) | stand-in | verdict |
|---|---|---|---|
| declared width | 384 (`Xenova/all-MiniLM-L6-v2`) | 64 (`carpool-test/hashed-bow`) | **deliberate** — a distinct model name so a test registry can never be mistaken for one serving MiniLM vectors. Everything dimension-dependent runs at a sixth of production's width |
| produces exactly `dim` | yes, and throws otherwise (`embed.ts` dim check) | yes | asserted, `embedder.test.ts` |
| normalisation | L2, via `{ pooling: "mean", normalize: true }` | L2 | asserted to `toBeCloseTo(1, 5)` |
| self-similarity | 1 | 1 | asserted |
| unrelated questions below the 0.55 default floor | expected | asserted | asserted |
| token-free input | a unit vector (CLS/EOS are still embedded) | **the zero vector** | real divergence, now asserted and explained. Fails safe: cosine 0 is below every legal threshold |
| semantic matching | yes | **no** — bag-of-words | **open gap, §4.1** |

`@carpool/tracker`'s `Embedder` and the registry's are textually identical, separately maintained, with no shared import. `embedder.test.ts` now reads both off disk and compares the members — the pattern `apps/dashboard/lib/decay.test.ts` uses for core's duplicated `0.125`. Falsified: adding a parameter to one side fails it by name.

### 3.4 Registry responses vs captured ones

`v2-full-feature-run` re-confirms behaviour the stubs reproduce: `SETTLED_NO_TRANSFER` with `batch.txId` null and `moved: 0` (`01-settle-fee-only.json`); `refundState` derived to `closed` while the stored column does not move (`24-refund-after-window.json`); delist 410s on both `/manifest` and `/artifact` with a refund still honoured afterwards (`30-delist.json`); a two-chunk epoch at `MAX_PAYEES` with the payer netted out (`13`, `14`). No disagreement found with what the harness-driven tests assert.

---

## 4. Gaps that remain open

Stated, not hidden. Each is loud in the file that owns it.

### 4.1 The real ONNX embedder runs in no test

`hashedEmbedder` is the only embedder any test in this repository has ever run. `packages/carpool-tracker/src/embed.test.ts` injects `loadPipeline`, so it does not run one either, and `localEmbedder()`'s default path — the dynamic `@huggingface/transformers` import, `env.cacheDir`, `env.allowRemoteModels`, cold start — executes nowhere. `embedder.ts`'s own tuple-mismatch guard in `load()` has no injection seam and is therefore unreachable from a test; it is checked by reading.

Consequence: **no test covers semantic matching.** A paraphrase, a synonym or a genuine near-miss is invisible to a bag-of-words hash, and `search.test.ts`'s corpus is vocabulary-disjoint so separating it is trivial. A swapped, truncated or corrupted model checkpoint in production fails nothing here.

The only real-ONNX proof is captured, not executed: `v2-first-testnet-run/03-search.json`, one live query, cosine 0.8097, against a corpus of one.

Not closed because `pnpm test` must not download 87 MB or touch the network — the right call, and the reason the gap is structural rather than an oversight. Closing it needs a deliberate opt-in suite (`CARPOOL_TEST_REAL_EMBEDDER=1`) with a pinned checkpoint and a warmed cache, and near-miss pairs whose expected ordering is written down. Documented in `testing/hashedEmbedder.ts` and `embedder.test.ts`.

### 4.2 `batch.tx_id` holds two transaction-id notations

`settle()` writes `0.0.x@sec.nanos`; `reconcile()` writes the mirror node's `0.0.x-sec-nanos` for the same transaction. Nothing normalises, so which one a row carries depends on how the batch was confirmed, and a consumer building a HashScan link or comparing two ids for equality has to handle both. Both forms are captured real values. Asserted and named in `settler.test.ts`; not normalised, because changing what is recorded on a money path is a product decision.

### 4.3 Two further stated limits

- **`startStubMirror` serves one of two endpoints.** `Settler.reconcile()` reads `GET /api/v1/transactions`; the harness's mirror does not serve it. Nothing routed through the harness has a pending batch at boot, so reconcile never fetches there, and `settler.test.ts` covers that endpoint with its own stub. Recorded at `stubFacilitator.ts:326`.
- **Key lists are never exercised.** The real mirror node returns `_type: "ProtobufEncoded"` with a protobuf blob in `key.key` for a multi-key account; `mirrorNodeKeyResolver` then fails its hex comparison and the refund is refused. Fails closed, reasoned about, asserted nowhere.

---

## 5. Coverage matrix

**Real-stack** = the production code path runs, against the real registry app (`testing/harness.ts` boots it in-process) or on Hedera testnet. The facilitator and mirror node are stubbed in all in-process rows — that is §3.1's subject and is not re-flagged per row.

### Registry routes — 17 of 17

| route | real-stack proof | on testnet | double-only? |
|---|---|---|---|
| `GET /search` | `registry/search.test.ts` (15), `mcp/e2e.test.ts`, `mcp/server.test.ts`, `bench/{agent,load}.test.ts` | `03-search.json` (real ONNX) | no |
| `GET /manifest/:magnet` | `registry/{server,delist}.test.ts`, `mcp/server.test.ts` | `02-manifest.json`, `30-delist.json` | no |
| `GET /artifact/:magnet` | `registry/{server,reads,delist,audit-onpaid-throw}.test.ts`, `mcp/{e2e,server}.test.ts`, `bench/agent.test.ts` | `04-402-*`, `05-purchase.json`, `00-smoke-*` | no |
| `POST /publish` | `registry/{server,delist,ledger,audit-money}.test.ts`, `harness.publishFixture`, `mcp/{e2e,server}.test.ts`, `bench/*` | `01-publish.json`, `10-chunk-publishes.json` | no |
| `POST /delist` | `registry/delist.test.ts` (13), `mcp/{e2e,server}.test.ts` | `30-delist.json`, `31-delist-state.json` | no |
| `POST /refund` | `registry/{server,delist,ledger,audit-money,audit-onpaid-throw}.test.ts` | `21`, `23`, `24-refund-after-window.json` | no |
| `POST /settle` | `registry/settlement.test.ts` (15), `audit-onpaid-throw.test.ts` | `09`, `18`, `01-settle-fee-only.json`, `13-settle-two-chunks.json` | no |
| `GET /owed` | `registry/{settlement,audit-onpaid-throw}.test.ts` | `15-owed.json` | no |
| `POST /owed/replay` | `registry/audit-onpaid-throw.test.ts` | — | no (real ledger + real gate) |
| `POST /batches/:id/resolve` | `registry/settlement.test.ts` (4 actions + 2 rejects) | — | no |
| `POST /payouts/:id/unpark` | `registry/settlement.test.ts` | — | no |
| `GET /.well-known/carpool` | `registry/{server,reads}.test.ts`, `mcp/e2e.test.ts` | used by every live run | no |
| `GET /health` | `registry/server.test.ts` | live-run log line | thin — one test, `ok` + `authEnforced` |
| `GET /state` | `registry/{reads,delist,audit-onpaid-throw}.test.ts`, `mcp/{e2e,server}.test.ts` | `06`, `16`, `31` | no |
| `GET /payouts` | `registry/{reads,settlement,audit-onpaid-throw}.test.ts` | `07`, `13`, `14`, `12-payouts-during-window.json` | no |
| `GET /batches` | `registry/{reads,settlement}.test.ts` | `12-batches.json`, `01-settle-fee-only.json` | no |
| `GET /events` | **`registry/reads.test.ts` — added this pass** | `17-events.json` | **was route-only-untested**; see below |

`GET /events` was the one route with no HTTP test at all: `ledger.test.ts:451` calls `eventsSince()` directly and `apps/dashboard/lib/events.test.ts` works on hand-built fixtures, so the route's `since` parsing, its status and the fact that the handler is wired to `eventsSince` were covered by nothing, while the dashboard's activity rail polls exactly it. Two tests added. Falsified twice:
```
MUTANT: /events drops the NaN guard on ?since=   → × treats since as exclusive, and a junk since as 0
MUTANT: /events ignores ?since=                  → × treats since as exclusive, and a junk since as 0
      Tests  1 failed | 15 passed (16)      (both mutants)
```

### MCP tools — 4 of 4

| tool | handler exercised as an agent invokes it | layer beneath | double-only? |
|---|---|---|---|
| `carpool_search` | **`mcp/server.test.ts`** — 4 tests via `McpServer` + `InMemoryTransport`: renders every candidate, states the remote-embed exposure, the no-hits branch, the spend-cap branch | `e2e.test.ts`, `render.test.ts` | no (**was**: handler never executed) |
| `carpool_fetch` | **`mcp/server.test.ts`** — 3 tests: pays, writes a file, returns no body inline, txId decoded; failure is `isError`; settlement failure serves nothing | `e2e.test.ts` (`payFetch`) | no (**was**: handler never executed) |
| `carpool_publish` | **`mcp/server.test.ts`** — 5 tests: the `confirm` gate (and the registry confirming nothing happened), the 10 % price rule, publish-on-confirm verified against the stored manifest, the duplicate note, secrets actually stripped from the served bytes | `e2e.test.ts`, `scan.test.ts`, `consent.test.ts` | no (**was**: handler never executed) |
| `carpool_delist` | **`mcp/server.test.ts`** — 3 tests: withdraws and states what it does not undo, idempotent, refusal is `isError` | `e2e.test.ts` | no (**was**: handler never executed) |
| the tool surface itself | **`mcp/server.test.ts`** — `listTools` names and descriptions; zod schema violations come back as `isError` with the field named, before any handler runs | — | no (**was**: nothing) |

The consent hook (`CARPOOL_PUBLISH_MODE`, subagent refusal) is `consent.test.ts`, which parameterises every rule over both `decideConsent` and the executed hook — the right pattern, unchanged.

### Anything still double-only

Nothing in the matrix. The residue is not double-only coverage but **unexercised real code**: §4.1 (the ONNX embedder and `embedder.ts`'s `load()`), §4.3, `GET /health`'s thin single test, and everything a facilitator does that cannot be reproduced offline (§3.1's last row), which has exactly the live runs behind it and nothing else.

---

## 6. The doubles that are well built

Worth naming, because the fix for a bad double is usually to copy one of these.

- **`apps/registry/src/testing/harness.ts`** — the single best decision in the test tree. It boots the **real** registry app in-process, so `apps/mcp` and `apps/bench` are tested against a registry that actually verifies signatures, recomputes `magnetOf`, checks `bodyHash` and rejects duplicates. It replaced a hand-written stand-in that did none of those and under which the `signature`/`authorSig` defect survived 238 green tests. Eight test files across three packages drive it.
- **`packages/hedera-x402/src/settler.test.ts`'s injected `submit`** — the model of proportionate isolation. The `TransferTransaction` is the **real** class, built by the real `settleChunk`; only the network call is injected, and `defaultSubmit` is then tested separately against duck-typed SDK rejections. The seam is exactly as wide as the network and no wider.
- **`apps/dashboard/lib/fixtures.testonly.ts` + `fixtures-unreachable.test.ts`** — the only double in the repo with a *proof* that it cannot leak: a module-graph walk from every rendered entry point, plus every bypass a prior audit invented re-attempted against it. `FIXTURE —` prefixes mean a leak would be visible on screen.
- **`apps/registry/src/audit-onpaid-throw.test.ts`** — one `vi.spyOn` on the ledger the server actually uses, injecting the one failure that cannot be provoked otherwise. Gate, facilitator, routes and SQLite are all real. The minimum viable double.
- **`apps/registry/src/testing/hashedEmbedder.ts`** — an honest stand-in: a *real* embedder, just not a neural one, declaring a deliberately distinct `(model, dim)` so a test registry can never be mistaken for one serving MiniLM vectors. Its problem was never what it does, only that nothing wrote down what it does not.
- **`packages/hedera-x402/src/gate.test.ts`'s `quote`/`onPaid`/`owe`** — not stand-ins at all. `PaymentGate` is product-free by construction and these are its interface; the real implementations behind them are driven by `audit-onpaid-throw.test.ts`.
- **`apps/bench/src/load.test.ts:116`'s `neverCalled`** — a fake that is *designed* to be unreachable, with the reason at the call site, sitting next to a test that drives real purchases through the real gate. Both halves stated.
- **`apps/dashboard/lib/decay.test.ts:22`** — reads core's source off disk to check a duplicated constant it deliberately cannot import. Cheap, honest, and the template `embedder.test.ts` now reuses for the duplicated `Embedder` interface.

Nothing was deleted. Every double above is doing work; the five (c)s were fixed by making the double *stricter* or by adding the real-stack test it was standing in for, never by removing it.

---

## 7. Reproducing

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use   # 20.19.0
pnpm typecheck        # 11/11
pnpm test:force       # 862 tests, 7/7 packages, 0 failures
```

Files changed by this pass: `apps/registry/src/testing/{stubFacilitator.ts (new),harness.ts,hashedEmbedder.ts}`, `apps/registry/src/{embedder.test.ts (new),server.test.ts,settlement.test.ts,reads.test.ts,delist.test.ts,audit-onpaid-throw.test.ts}`, `apps/mcp/src/{server.ts,server.test.ts (new),e2e.test.ts}`, `apps/bench/src/ab-run.test.ts`, `packages/hedera-x402/src/{gate.test.ts,settler.test.ts,audit-money.test.ts}`.

One production change, and only one: `apps/mcp/src/server.ts`'s handlers became named exports and its transport connects only when the module is the process entry point. No behaviour changed — the tool names, descriptions, schemas and handler bodies are untouched.
