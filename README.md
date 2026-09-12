# Carpool

**An agent about to spend twenty minutes researching something checks first whether someone already did it — and buys that instead.**

The author who did the work gets paid. The buyer skips the work. The same
computation stops being run by people who never knew about each other.

```
redoing it   2,357,943 tokens  ·  $3.9704  ·  630.9s of model time  — all three are floors
buying it           90 tokens  ·  $0.4367 actually charged (436,745 µUSDC)  ·  7.70s on the wire
```

The dollars are measured tokens at Claude Opus 5's published list price as of
2026-09-12 — **$5 input / $25 output / $6.25 cache write / $0.50 cache read per
MTok** — which is *below* the 1M-context tier the session was actually billed on,
so the redo dollars are a floor for that reason too.

Measured, not illustrated — but read the word "floor" before quoting it. The redo
side is read out of the producing session's own transcript and **understates** the
real cost: four subagent transcripts were not retained, and the dollars price
measured tokens at published rates below the tier actually billed. The buy side is
a real publish-search-pay-verify round trip **on the wire** — a registry with real
Hedera credentials, the real Blocky402 facilitator, real Hedera testnet, paid with
transaction `0.0.7162784@1789220203.068787609` — so the 7.70 s is a real purchase
and not a loopback. It is still one sample on one network path, it excludes the
later settlement transfer that pays the author and the HBAR fees, and
**this repo does not claim a wall-clock ratio.** Every figure in that box is
checked against a machine-written record by `apps/bench/src/ab-doc.test.ts` on
every test run.

[docs/AB-MEASUREMENT.md](docs/AB-MEASUREMENT.md) has the runner output verbatim,
the command to reproduce it, and a longer list of what it does *not* show.

> **The previous version of these figures was fabricated.** `412s / 4.2s / $2.14
> / $0.31 / 195,524 tokens / 143 sources` were unit-test fixture literals
> presented as results; nothing had been run. Commit `2bf4931`'s message repeats
> the false claim and is retracted. The correction box at the top of
> docs/AB-MEASUREMENT.md records what was wrong and how the numbers are produced
> now.
>
> **And the first fix overclaimed.** Commit `9ef4062` said a test made it
> impossible for the document to drift from the run "in either direction"; that
> test was a list of hand-typed substrings, one of which was the two digits
> `"28"`, and an audit put the retracted "143 sources" back into the document
> without turning the build red. The second correction box in
> docs/AB-MEASUREMENT.md says what the guard does now and — more usefully — what
> it still cannot check.

---

## Read this before anything else

**The demand premise is not established.** Carpool's kill test — does an event
make many independent people produce the same research? — returned **STOP**
against its own stated rule: overlap 42% against a 50% bar, Cohen's κ 0.26. It
is written up in full at [docs/PHASE0.md](docs/PHASE0.md).

Its structural finding is more useful than its verdict. Zero of 36 artifact
pairs were unrelated and 21 of 36 were only *partial*: **people do not fail to
answer the same question, they answer it at different depths**, and the median
free substitute appears within half a day. That is why the tracker ranks on
depth rather than similarity alone, and why half-lives default to one day.

So: the trade is worth taking when a suitable artifact exists. Whether it exists
often enough is unproven, and the evidence so far leans against it. Anything in
this README that reads like a claim should be read against that paragraph.

**v2 has now moved real money — once, on 2026-09-12.** One artifact published
through the real `POST /publish`, bought over x402 against the real Blocky402
facilitator, and settled and anchored through the real `@hiero-ledger/sdk` on
Hedera testnet:

| | |
|---|---|
| x402 purchase, 110,000 µUSDC buyer → registry | `0.0.7162784@1789202339.427560739` |
| settlement transfer, 109,500 µUSDC registry → author | `0.0.10475802@1789202482.460233839` |
| HCS anchor of that epoch's Merkle root | topic `0.0.10496824`, seq 1, consensus `1789202493.460038026` |

Both transactions are `SUCCESS` on the mirror node and the royalty lands in the
author's account, not in a log. The raw evidence — every mirror-node response
verbatim, the ledger rows, the paid body, and a standard-library
`verify.py` that re-checks all of it live and re-derives the anchored Merkle root
without importing anything from this repository — is in
[docs/evidence/v2-first-testnet-run/](docs/evidence/v2-first-testnet-run/). That
closes `docs/RESTRUCTURE.md`'s Phase D acceptance row.

**Read the scope of that claim precisely.** That first run was *one* purchase and
*one* settlement epoch. A **second, full-feature run** the same day covered the
rest, on its own HCS topic `0.0.10497461`: **27 real x402 purchases, 25 settlement
batches, 15 anchors, 1,382,235 µUSDC of sales and 1,368,735 µUSDC of payouts,
closing to the µUSDC against the registry's balance on the mirror node.** It proved
on chain, for the first time: `POST /refund` inside the window with the buyer's
money returned and the author's royalty voided rather than paid; the refusal after
the window; **13 distinct payees in one epoch across two chunks**, past the
9-payee boundary; `reconcile()` recovering a real batch by memo after its receipt
was dropped; a consensus-reached failure classified `failed` with its payouts
returned to claimable, then parked, unparked and paid; the cross-process
`settle_lease` producing **one** transfer where two processes raced for one epoch;
all three `POST /batches/:id/resolve` actions; `POST /delist` with the existing
purchase still refundable; `GET /owed` and `POST /owed/replay`; and the
`carpool_*` MCP tools over a real stdio MCP session. Raw evidence and a
61-check repository-independent verifier:
[docs/evidence/v2-full-feature-run/](docs/evidence/v2-full-feature-run/).

What is *still* only shown in test: `EMPTY_CLAIM`,
`SUCCESS_BUT_MISSING_EXPECTED_OPERATION`, the `DUPLICATE_TRANSACTION` branch of
`reconcile`, a transfer list at the full 10 entries, and the body-integrity `502`.
Nothing here has been run at volume (27 purchases over two hours, sequential) or
against a hostile counterparty. The suite below is green on a clean run at Node
20.19.0 — `pnpm test` reports the whole denominator rather than a count of
successes, for reasons the Running it section explains — and the full publish →
search → pay → verify → refund → settle → anchor path also runs there against a
**stub x402 facilitator and a mocked Hedera SDK on 127.0.0.1**.

The predecessor rail's evidence remains genuine and remains **v1's**:
`apps/settlement`, deleted in this restructure, settled **60 paid requests** on
Hedera testnet in one batched `TransferTransaction` —
`0.0.10475802@1789137942.760688301`, 4 payees, `SUCCESS`, 1,591,862 tinybar of
fees — with 13 HCS anchors behind it, twelve of them over empty epochs. v2 shares
the SDK, the account and the token, and now has its own transaction ids.

## How it works

1. An author finishes some research. `carpool_publish` lists it — a signed
   **manifest** (question, abstract, every source, what it cost to produce) plus
   the body.
2. Someone else's agent, before starting its own research, calls
   `carpool_search`. It gets manifests back — **free**, because the manifest is
   the buyer's evidence and charging for it would defeat the point.
3. The agent reads that evidence and decides. If it buys, `carpool_fetch` pays
   over x402 on Hedera and **writes the artifact to a file** — not into the
   context window, so the buyer chooses how much of it to read.
4. The author earns a royalty on every sale, uncapped. The price falls as the
   artifact ages.

### Pricing

```
freshness(t) = 0.5 ^ (ageDays / halfLifeDays)
price(t)     = floor + base · freshness(t)
```

Decay only — **no buyer-to-buyer refunds.** The author produced the artifact
before any buyer existed, so there is no shared cost to split between buyers,
and capping the author's return would mean an artifact bought a thousand times
earns the same as one bought eight times. Buyer 40 pays less than buyer 1
because they are buying something 38 days older, which is a genuine difference
in the good.

A buyer has **120 seconds** to reject. That window is why the registry, not the
author, is the payee: pay the author directly and the money is gone the instant
it settles, leaving nothing for a refund to reverse.

## Layout

| | |
|---|---|
| `packages/hedera-x402` | The payment rail: x402 gate, batched settlement, HCS anchoring, outbox. Depends on nothing else here. |
| `packages/carpool-core` | Manifest, content-addressed magnet, decay, health, author identity. |
| `packages/carpool-tracker` | Retrieval — local embedding, `sqlite-vec` index, depth-weighted ranking. |
| `apps/registry` | The service: free search, x402-gated fetch, publish, refund, settlement. |
| `apps/mcp` | What agents actually use. Four tools (search, fetch, publish, delist) plus the consent hook. |
| `apps/dashboard` | A torrent client, because the information shape is identical. |
| `apps/bench` | Load driver and the A/B harness. |

## Joining it

Everything below this heading is for somebody building the monorepo. If you want
to *use* it, as an author or a buyer or both, that is
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md), and the one thing it opens
with is worth repeating here: **there is no sign-up.** No Carpool account, no
email, no password. Identity is a Hedera keypair, and the same one usually sits
at both ends, because author and buyer are the two directions of one mechanism
rather than two products.

Three roles, and only the third needs this repository running as a service:

| role | what it needs |
|---|---|
| **buyer** | nothing at all to search. `CARPOOL_BUYER_ACCOUNT_ID` / `_PRIVATE_KEY` and test USDC to buy |
| **author** | `CARPOOL_AUTHOR_ACCOUNT_ID` / `_PRIVATE_KEY` for royalties, plus the publish consent hook |
| **registry operator** | [docs/RUNBOOK.md](docs/RUNBOOK.md) |

The dashboard says the same thing at `/app#join`, against whatever registry it is
reading.

## Running it

```bash
nvm use                      # Node 20.19.0; the preinstall guard rejects 26
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

`pnpm test` is `scripts/run-tests.mjs`, not a bare `turbo run test`, and the
difference is a reporting one. Turbo stops scheduling dependents on the first
failure, so a red run in one package used to print `Tasks: 4 successful, 8 total`
while **236 of 506 tests were never started** and nothing said so. The wrapper
derives the expected package set from the workspace, runs with `--continue`, and
ends in one of two lines: `FULL SUITE: 7/7 packages, N tests, 0 failures` or a
`PARTIAL RUN` banner naming every package that produced no result. It also says
when a package was replayed from turbo's cache rather than run — a cached green is
a valid green but not a fresh execution, and `pnpm test:force` is the fresh one.

Two related traps, both of which have produced a "green" that was not:

- **The Node version.** On Node 26 `better-sqlite3` fails to load, and only in the
  packages that touch SQLite, so the rest of the run still passes. `nvm use`, and
  the guard in `scripts/check-node.mjs` is chained into `build`, `test` and
  `typecheck` rather than left to install time.
- **The A/B measurement.** Its inputs (an artifact and a private transcript) are
  outside the repo, so on any other machine the measurement half skips. `pnpm
  ab:verify` prints exactly what was verified and what was not; CI runs it and
  fails if the runner leaves no status behind. The document and dashboard guards
  need neither input and run everywhere — see
  [docs/AB-MEASUREMENT.md](docs/AB-MEASUREMENT.md), "How this document is
  guarded".

For a live registry you need a Hedera testnet identity — see
[docs/RUNBOOK.md](docs/RUNBOOK.md). One thing that will otherwise waste an
afternoon: **Circle's faucet mints only to an account already associated with
USDC.** `maxAutomaticTokenAssociations` is not enough, because association is
lazy and the faucet checks before it sends. Run
`pnpm --filter @carpool/registry associate` first.

## Things that are not solved

- **Self-purchase.** Buying your own artifact to inflate its health costs only
  the tracker fee. Distinct-buyer counting and rate limits raise the price; they
  do not close it.
- **Body availability.** An author who deletes their storage cannot deliver; the
  registry 502s and accrues a refund. `carpool_delist` is the deliberate version
  of the same act — it stops new sales without breaking the sales in flight. A
  retention deposit is the lever for the accidental version, not a guarantee.
- **Thin tracker margin.** Search is free and burns embeddings and bandwidth on
  every query; the fee is 500 µUSDC a sale.
- **Cold start.** An empty tracker sells nothing, so nobody publishes.
- **Competitive contexts.** Selling a hackathon prize analysis helps your
  rivals. Probably fine — the analysis is not the edge — but it is real.
- **Local embedding is not privacy.** It keeps questions out of plaintext logs.
  Embedding inversion recovers a large fraction of short inputs from vectors
  alone.

## Sustainability

Stated last, deliberately. The saving is real and measurable — 2.36 million
tokens per avoided duplicate, on the one artifact measured — but the honest
framing is not carbon, it is that **the same computation is being run by people who do not know about each
other**. Multiply the number above by however many of them there are. That
multiplier is exactly what Phase 0 failed to establish, which is why this
section is a consequence rather than a claim.
