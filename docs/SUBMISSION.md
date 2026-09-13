# Carpool: ETHOnline 2026 submission

**Track: Hedera T1, AI & Agentic Payments on Hedera** ($6,000, 3 slots). That is
the only track this project claims. Section 2 says which others were considered
and why each was rejected.

Everything below is on **Hedera testnet with test USDC** (`0.0.429274`). The
transfers, fees and consensus timestamps are real. The asset is a test token.
**Nobody in this project is earning money.**

---

## 0. The short version, for four minutes

An AI agent about to spend twenty minutes researching something checks first
whether somebody already did that research, and buys it instead for a fraction
of the cost. The author who did the work gets paid on every sale. The same
computation stops being run independently by people who never knew about each
other.

One measured round trip, on the wire, against the real facilitator and real
Hedera testnet:

```
redoing it   2,357,943 tokens   $3.9704   630.9 s of active model time   (a FLOOR)
buying it            90 tokens   $0.4367   7.70 s total (0.01 s search + 7.69 s fetch)
```

The buy side is recorded on the wire: purchase
`0.0.7162784@1789220203.068787609`, 436,745 µUSDC, public on any mirror node.
The redo side is read out of the producing session's own transcript and is a
**floor**: four subagent transcripts were not retained, and the dollars price
measured tokens at a published rate card that sits *below* the 1M-context tier
the session was actually billed on. Both gaps run the same way, so the real
redo cost is higher than $3.9704.

Three things a judge should know before anything else:

1. **The demand premise is not established, and we published the negative
   result.** Carpool's own kill test (does an event make many independent people
   produce the same research?) returned **STOP** against its own stated rule:
   overlap 41.7% against a 50% bar, Cohen's kappa 0.26 against a 0.6 bar.
   `docs/PHASE0.md`. All 18 published figures recompute from committed raw rater
   labels.
2. **An earlier version of the headline numbers was fabricated**, and the
   retraction is in the README, in `docs/AB-MEASUREMENT.md` and in the product
   UI. What replaced it is a guard chain that cannot be satisfied by a
   coincidental digit run. Section 3.3 tells that story properly, including the
   part where the first fix also overclaimed.
3. **The payment rail is proven on chain, and the parts that are not are listed
   by name.** Two live testnet runs on 2026-09-12: 28 real x402 purchases across
   both, 26 settlement batches, 16 HCS anchors, a refund returned on chain, and
   a 13-payee epoch crossing the 9-payee chunk boundary in two transactions.
   Two standard-library verifiers re-check it live against the mirror node with
   **zero imports from this repository**. Section 5 lists what is still only
   shown in test.

---

## 1. Description

### The mechanism

Research is produced over and over by people who do not know about each other.
An event happens, a prize list drops, a protocol ships, an exploit lands, and
forty agents independently spend twenty minutes and two million tokens arriving
at the same synthesis. Nobody coordinates, because there is no way to move a
fraction of a cent between strangers and no place to look before starting.

Carpool is that place to look, and Hedera plus x402 is what makes the fraction
of a cent movable.

1. An author finishes some research. `carpool_publish` lists it: a signed
   **manifest** (the question, an abstract, every source, and what the author
   says it cost to produce) plus the body.
2. Someone else's agent, *before* it starts researching, calls `carpool_search`.
   It gets manifests back, **free**, because the manifest is the buyer's
   evidence and charging for evidence defeats the point.
3. The agent reads that evidence and decides. If it buys, `carpool_fetch` pays
   over x402 on Hedera and **writes the artifact to a file**, not into the
   context window, so the buyer chooses how much of it to read.
4. The author earns a royalty on every sale, uncapped. The price decays with
   age.

### The two design choices that carry the product

**Artifacts are content addressed and their price decays.**

```
freshness(t) = 0.5 ^ (ageDays / halfLifeDays)
price(t)     = floor + base * freshness(t)
```

Decay only, and no buyer-to-buyer refunds. The author produced the artifact
before any buyer existed, so there is no shared cost to split between buyers,
and capping the author's return would mean an artifact bought a thousand times
earns what one bought eight times earns. Buyer 40 pays less than buyer 1 because
they are buying something 38 days older, which is a real difference in the good.

**The registry, not the author, is the x402 payee.** A buyer has 120 seconds to
reject. Pay the author directly and the money is gone the instant it settles,
leaving nothing for a refund to reverse. So the registry is a custodian for at
most the refund window plus one settlement epoch, and `docs/RUNBOOK.md` states
the two exceptions it would be dishonest to omit: sub-dust balances carry
forward indefinitely by design, and while the settler is stopped nothing is
bounded at all.

### Why it matters, and the honest limit of that claim

The token figure is the one that is hard to argue with. 2,357,943 tokens to
produce against 90 tokens for the buyer's receipt, or 11,355 if the agent reads
the entire file. Even a full read saves 2,346,588 tokens against producing it.
96% of the redo tokens are cache traffic (2,143,694 cache reads plus 131,024
cache writes against 83,177 output tokens), which is what a long agentic session
actually costs and why counting only input plus output (83,225) understates the
segment by a factor of twenty-eight.

The limit: this is **one artifact, one question, one model**. A worked example of
the trade, not a population estimate. And half of the cost ratio is a policy
choice, not a discovery: the list price is 10% of the measured redo floor
(`PRICE_SHARE_OF_REDO_COST` in `packages/carpool-core/src/pricing.ts`), and at
15%, which this repository shipped in one of two places until the contradiction
was resolved, the same saving is **6.1x rather than 9.1x**. What is *not* a
choice is the charge: 436,745 µUSDC is what the x402 gate took. And a 9x saving on an artifact nobody
wants is worth nothing, which is exactly what Phase 0 failed to establish.
Phase 0's structural finding is more useful than its verdict: zero of 36
artifact pairs were unrelated and 21 of 36 were only *partial*. People do not
fail to answer the same question, they answer it at different depths, and the
median free substitute appears within half a day. That is why the tracker ranks
on depth rather than on similarity alone, and why half-lives default to one day.

---

## 2. Track fit

### Claimed: Hedera T1, AI & Agentic Payments ($6,000, 3 slots)

The track asks you to "stand up a live x402-gated service on testnet/mainnet and
build the platform that consumes it with real paid requests". Carpool is
literally that, in both halves:

| the track's words | what exists |
|---|---|
| a live x402-gated service on testnet | `GET /artifact/:magnet` on `apps/registry`, gated by `PaymentGate` in `packages/hedera-x402/src/gate.ts`, against the live Blocky402 facilitator `https://api.testnet.blocky402.com` |
| the platform that consumes it | `apps/mcp`: four MCP tools an agent actually calls, driven over a real stdio MCP session in the evidence run |
| **real paid requests** | 28 real x402 purchases on Hedera testnet across two runs on 2026-09-12, every transaction id public |
| micropayment / agent-marketplace shape | 2,500 µUSDC royalties, a 500 µUSDC tracker fee, batched settlement under Hedera's 10-entry transfer cap |

The unusual part for a hackathon entry is not the integration, it is that the
claims come with receipts and the failures come with names.

### Considered and rejected

Each rejection names the specific artifact that does not exist, rather than a
feeling about fit.

| track | why not |
|---|---|
| **Hedera T2, Improve the Hedera Harness** ($2,000) | No PR to any Hedera repository, and `packages/hedera-x402` was not written against that harness or inspired by it. We *did* find real rough edges worth a PR (see section 8), but finding them is not submitting them. |
| **Hedera T3, Tokenization of Anything** | No Asset Tokenization Studio, no deployed contract. Nothing to claim. |
| **Hedera T4, Continuity** ($1,000, 1 slot) | The repository's first commit is 2026-09-10, three days before this deadline, and the project has never been submitted to any previous hackathon. The v1 rail this pivoted from (`apps/settlement`, deleted in the restructure) was written in the same three days. Continuity would be false. |
| **Arc (Circle) T1/T2/T4** | Carpool uses Circle's **testnet USDC on Hedera**, not Arc. Nothing is deployed on Arc, and the research file flags Arc against Hedera as a direct conflict: two chains selling an identical agentic-payments story. |
| **Bazantic T1/T2/T3** | No Bazantic Gateway and no Recipe. T1 is also continuity-only, and its A/B has to isolate the Recipe as the only material difference, which ours does not do: ours compares redoing research against buying it. |
| **ENS T1/T2** | **Not integrated.** `AuthorIdentity` in `packages/carpool-core/src/identity.ts` is deliberately opaque so an `EnsAuthor` could exist later, and two comments in that file say so. A grep for ENS matches those comments and nothing else. A provisioned interface is not a build. |
| **The Graph** | **Not integrated.** Zero matches for subgraph, Substreams or Subgraph MCP anywhere in the tree. Retrieval is a local `sqlite-vec` index over `Xenova/all-MiniLM-L6-v2` embeddings. |
| World, 1inch, Uniswap, Ledger, Privy, Chainlink | No integration of any kind. |

---

## 3. How it was made

### 3.1 Architecture

Seven workspaces. The rule the layering enforces is that the payment rail knows
nothing about research and the product knows nothing about Hedera transaction
construction.

| workspace | what it is |
|---|---|
| `packages/hedera-x402` | The rail. x402 gate, batched HTS settlement, HCS anchoring, an outbox, a SQLite settlement ledger. Depends on nothing else in the repo. |
| `packages/carpool-core` | Manifest schema, the content-addressed magnet, decay and pricing, health, author identity. |
| `packages/carpool-tracker` | Retrieval. Local ONNX embedding, `sqlite-vec` index, depth-weighted ranking. The one genuinely new component. |
| `apps/registry` | The service. Free search and manifests, x402-gated fetch, publish, delist, refund, rate, settlement, operator routes. |
| `apps/mcp` | What agents use. `carpool_search`, `carpool_fetch`, `carpool_publish`, `carpool_delist`, plus the publish-consent `PreToolUse` hook. |
| `apps/dashboard` | Next.js. An explainer route and a live surface over registry data. |
| `apps/bench` | The load driver and the A/B harness, including every documentation guard. |

Suite as of today, 2026-09-13, on Node 20.19.0, fresh (not replayed from cache):

```
$ pnpm test:force
7 of 7 packages reported | 1024 tests executed | 0 failed | 0 file(s) did not load
FULL SUITE: 7/7 packages, 1024 tests, 0 failures.
```

### 3.2 The engineering decisions that were actually decisions

**The quote is replayed, never re-priced.** The facilitator compares
`payload.accepted.amount` and `.payTo` to the requirements by strict equality,
so a gate that re-prices on the paid retry breaks every concurrent payment.
`PaymentGate` keeps the requirements it issued in an LRU cache (default TTL 30 s)
and replays them. The wire run proves this in a way a loopback cannot: 7.69 s
elapsed between the unpaid 402 and the paid retry, and the charge is
`priceFloor + priceBase` exactly, the price at the instant the 402 was issued,
not the price about 3 µUSDC of decay later.

**`kind: "paid"` was not enough information.** The gate used to return only that
a payment settled, so a route could not tell "paid and recorded" from "paid, and
nothing in this system knows it". `apps/registry` served a 200 with the body for
a sale that had no purchase row, no royalty and no refund path. The gate now
returns `recorded` and `durable` separately, the route branches on them, and a
settled payment the ledger could not record writes an `owed_failure` row that
`GET /owed` and `POST /owed/replay` can see and fix. That path ran for real:
a 3,000 µUSDC payment `0.0.7162784@1789219616.600692271` whose `onPaid` threw,
recovered by replay, its royalty paid in batch 21.

**Payouts batch at nine payees because Hedera's token transfer list caps at ten
entries including the debit.** The interesting part is what happens when the
registry's own `tracker_fee` row lands in a chunk: the payee is the payer, the
SDK nets the two entries to zero, and the transaction would cost a fee and let
the ledger claim a row was paid by a transfer that contains no such movement. So
`settleChunk` filters the payer out of the transfer list and discharges the row
anyway. On chain this is visible as a 13-payee epoch whose first chunk claimed
nine payees and moved eight, nine of the ten entries used.

**Two payout rows must sum to exactly what the sale took, and that is enforced
where they are written.** `splitSale` clamps the fee to `paid` rather than
flooring the royalty at zero, and the post-condition throws rather than logs. A
throw propagates out of `onPaid`, which writes a durable owed row and 502s the
buyer. A log line would have left an over-sum for the settler to pay out.

**Anchoring manifest hashes, not just payment batches.** Each epoch anchors one
Merkle root to HCS over every not-yet-anchored artifact's manifest hash *plus*
that epoch's payee leaves. The manifest half is the reason to use HCS here at
all: it timestamps that a specific artifact existed, unmodified, at a consensus
time, which is what makes "I published this first" checkable by anyone with a
mirror node. An empty epoch anchors nothing, because a root asserting that
nothing changed is not evidence. v1 anchored unconditionally and left a testnet
topic carrying 13 anchors for 1 batch, all with an identical root, twelve of
them over empty epochs, spending real HBAR every 600 seconds for two hours and
seven minutes to assert that nothing had happened.

**Settle and anchor are guarded together, one level above the settler.**
`Settler.settle()` de-duplicates concurrent callers by handing both the same
batches array, so both then read the same unanchored manifests and each submits
its own HCS message: two consensus messages and two real fees for one epoch,
from a timer tick colliding with a dashboard click. The guard is on the
`EpochRunner` that wraps both.

**`carpool_fetch` writes a file.** An MCP tool result is capped, and more
importantly returning the body inline would spend the buyer's context on the
whole document whether or not they need all of it. The context saving *is* the
product. The A/B numbers are the proof that this is not a detail: 90 tokens for
the receipt against 11,355 for the body.

**The buyer's integrity check is fixed before payment.** `carpool_fetch` fetches
the free manifest first and keeps its `bodyHash`; after paying it hashes the
delivered bytes and compares against that. The `x-carpool-body-hash` header on
the paid response comes from the same server as the body, so a registry serving
the wrong bytes would send a matching header. An earlier version read a header
the registry never set, so the comparison never ran, while printing "(verified
against the manifest)" on every purchase. A false security claim is the worst
kind of bug, and the tool now says **NOT VERIFIED** with a reason when it cannot
run the check.

**Publishing consent has no `allow`.** Publishing is the only irreversible act
here, an MCP server cannot tell it is running inside a subagent, so consent is a
client-side `PreToolUse` hook. The `Decision` type has no `allow` member at all:
a subagent is denied, a non-prompting permission mode is denied,
`CARPOOL_PUBLISH_MODE=off` is denied, a typo in that variable is denied,
unparseable input is denied, everything else asks. `src/consent.test.ts` spawns
the hook as a process and asserts its output equals `decideConsent`'s for every
case, because the previous design had two implementations of one security
decision that disagreed. The pre-publish scan also **strips** secrets,
connection strings, local paths and internal hostnames rather than warning about
them, because a warning is something a tired person clicks past at the end of a
long research run.

**Local embedding is not privacy, and the tool says so.** `carpool_search`
prefers to embed locally and send only a vector. That keeps questions out of
plaintext access logs. Embedding inversion recovers a large fraction of short
inputs from vectors alone, so the word confidentiality does not appear. When the
optional 240 MB ONNX peer dependency is absent the tool sends the question as
text and says so on **every** call, with the reason.

### 3.3 What went wrong, and what fixing it cost

This is the part of the project we would most want a judge to read.

**The headline numbers were fabricated.** `412s / 4.2s / $2.14 / $0.31 /
195,524 tokens / 143 sources` were literals typed into a unit-test fixture,
transcribed into `docs/AB-MEASUREMENT.md` and the README as results.
`computeAb()` and `renderAb()` had no caller outside that test, so no run of any
kind produced them. Nothing had been published, bought or timed. Commit
`2bf4931`'s message repeats the false claim and cannot be edited, so it is
recorded as retracted. Two of the old numbers were independently checkable and
both failed: the artifact has **28** source URLs, not 143, and the "$0.31
produced by `priceAt()`" was the fixture's own `priceMicroUsdc` field.

**Then the fix overclaimed.** The retraction commit `9ef4062` said a test made
it impossible for the document to drift from the run "in either direction". The
test was a list of hand-typed substrings checked with `toContain`. One entry was
`"28"`, two digits, satisfied by hex inside the run's own magnet. An audit put
the retracted **143 sources** back into the document and the runner still
reported four passes. The one figure the fabrication got wrong by a factor of
five was the one figure the guard could not see, because substring containment
cannot tell a figure from a coincidental digit run and cannot see a *wrong*
figure at all, only a missing one.

What replaced it is a three-link chain, and only the last link can run
everywhere:

```
artifact + private transcript  ->  two machine-written records  ->  this doc + the dashboard
        (one laptop)                   (in every clone)                (in every clone)
```

Every figure is derived from those records, checked at its **labelled position**
in the prose rather than anywhere in the file, and the figure table is generated
by the runner rather than typed. Corrupting each of the 25 document figures and
each of the 6 README figures one at a time produces 31 named failures, and
`apps/bench/src/docFigures.test.ts` keeps that matrix in the suite. Where the
inputs are absent the runner writes a status file, `scripts/check-ab-status.mjs`
fails CI if it is missing or claims less than it should, and
`CARPOOL_AB_STRICT=1` turns the skip itself into a failure on a machine that is
supposed to have them. A silent skip is no longer possible. An announced one
is, and the document says so.

**The evidence for the STOP verdict was in no clone of the repository.**
`docs/PHASE0.md` cited its rater data at a gitignored path inside `.superpowers/sdd/`,
whose `.gitignore` is `*`. The session-local scratch files were never committed
and are gone. The recovered record is `docs/evidence/phase0-rater-data.md`, and
`docs/evidence/recompute-phase0.py` derives all 18 published figures from its
raw labels and exits non-zero if any stops reproducing. A guard test now fails
if any live document cites a gitignored path as a location of evidence.

**Four test doubles were not isolating anything, they were the only thing
standing where real behaviour belonged.** The stub facilitator answered
`isValid: true` without ever inspecting the payload, so a payload of
`{ signature: "stub" }`, a literal string, was accepted exactly as readily as a
genuine signed Hedera transfer, and the registry would have served a paid body
for a payment denominated in a token it does not accept. No test had executed a
single line of `apps/mcp/src/server.ts`, the entire agent-facing surface,
because a top-level `await server.connect(...)` made the module unimportable.
The fake `TransferTransaction` accepted transfer lists that do not net to zero
and lists longer than ten entries, both consensus-level refusals, so a broken
batch would have been recorded as paid while nothing moved on chain. Of 27
doubles in the tree, 19 were legitimate, 4 were legitimate but undocumented as
to their blind spots, and 4 were masking. All five findings (the fifth being an
absence of any double at all) are fixed, each with a recorded falsification.

**A green suite was hiding a third of itself.** Turbo stops scheduling
dependents on the first failure, so a red run printed `Tasks: 4 successful, 8
total` while 236 of 506 tests were never started and nothing said so. `pnpm
test` is now `scripts/run-tests.mjs`: it derives the expected package set from
the workspace, runs with `--continue`, and ends in either `FULL SUITE: 7/7
packages, N tests, 0 failures` or a `PARTIAL RUN` banner naming every package
that produced no result. It also says when a package was replayed from turbo's
cache, because a cached green is a valid green but not a fresh execution.

**The money-path audit's high findings were all about what happens when
something goes wrong, not about the arithmetic** (`docs/AUDIT-MONEY.md`: the
conditional claim and void were already sound, and none of the defects was a
double spend). Three of them now have a route that has run on a public ledger.
A purchase whose `onPaid` threw served the body for free with no purchase row,
no royalty and no way to refund; there is now a durable `owed_failure` row, a
502 instead of a 200, `GET /owed` and `POST /owed/replay`, and that recovery ran
for real. An unclassifiable ledger result code used to strand its payees for
ever; there is now a `NEEDS_OPERATOR:` status and `POST /batches/:id/resolve`,
and all three of its actions ran against real batches (escalated by reconcile
exhaustion, because an unclassifiable result code itself never occurred, which
section 5 says rather than glosses). A permanently failing
cause used to re-submit for ever while one bad payee blocked its whole chunk;
there is now an attempt counter, a park and `POST /payouts/:id/unpark`, and the
whole sequence ran on chain: five real `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`
failures, parked at attempt 5, unparked after the operator associated the
account, paid in batch 12. Every probe test the audit wrote is still in the
suite, so each defect was reproduced rather than hypothesised.

**Two traps that produce a green that is not.** On Node 26 `better-sqlite3`
fails to load, and only in the packages that touch SQLite, so the rest of the
run still passes; the version guard is chained into `build`, `test` and
`typecheck` rather than left to install time. And a test once inherited the
repo-root `.env` operator key (dotenv fills gaps, it does not clear them) and
fired a real testnet precheck on every run.

**Two numbers were quietly wrong and both are instructive.** The registry README
stated a 25 MB model download where the measured figure is **87 MB**, and 25 MB
was the number governing the exact cold-cache failure that paragraph existed to
prevent. And the dashboard recorded `436,700` µUSDC for a charge of `436,745`,
invisible for two commits because both render as `$0.4367`. The µUSDC guard now
compares integers.

---

## 4. How each sponsor is implemented

### Hedera

**HTS token transfers for settlement.** `packages/hedera-x402/src/settler.ts`
builds one `TransferTransaction` per chunk from `@hiero-ledger/sdk`, groups
claimed payout rows by payee, chunks at `MAX_PAYEES = 9`, filters the payer out
of the transfer list, and writes a `carpool:batch:<id>:<root8>` memo that
`reconcile()` can later match on. Real transfers:

| what | transaction |
|---|---|
| the first settlement that paid an author, 109,500 µUSDC to `0.0.10475801` | `0.0.10475802@1789202482.460233839` |
| 13 payees in one epoch, chunk 1 (9 entries: 8 payees plus the debit) | `0.0.10475802@1789204986.055709931` |
| the same epoch, chunk 2 (6 entries) | `0.0.10475802@1789204990.217343218` |
| a refund returned on chain, registry -5,000 to buyer +5,000 | `0.0.10475802@1789205157.179586999` |
| a payout paid after park, unpark and explicit association | `0.0.10475802@1789218547.837417951` |
| a batch recovered by `reconcile()` after its receipt was dropped | `0.0.10475802-1789218820-213817468` |
| an operator asserting `paid` about a transfer that really paid | `0.0.10475802@1789219371.117722461` |
| a released batch's payee paid for real in the next epoch | `0.0.10475802@1789219592.445683655` |
| the contested epoch: two processes raced, one transfer exists | `0.0.10475802@1789219790.496048550` |

**HCS consensus topics for the Merkle audit anchor.**
`packages/hedera-x402/src/anchor.ts` submits one `TopicMessageSubmitTransaction`
per non-empty epoch; `packages/hedera-x402/src/merkle.ts` builds the root over
sorted leaves with odd-node promotion. Topic **`0.0.10496824`** holds the first
run's single anchor, sequence 1, consensus `1789202493.460038026`, root
`aa11de684c48ef7fbf0f60c7a314c753e878ed0e7031318a563679c1a465bb0c` over three
leaves. Topic **`0.0.10497461`** holds the full-feature run's **15** anchors,
one per non-empty epoch, every root distinct. The largest of them,
sequence 2, roots 26 leaves: 12 manifest hashes plus 14 payee leaves. Both
verifiers re-derive these roots from their own Merkle implementation rather than
importing the production one, so a bug in the repository cannot make an anchor
verify against itself.

An honest gap, documented in `CONTRACT.md`: `AnchorResult` carries no
transaction id and no consensus timestamp. The HCS receipt is fetched and
discarded, so the registry cannot tell a reader where its own anchor is. Every
anchor timestamp in this submission came from the mirror node.

**Mirror node for reconciliation and for identity.**
`Settler#reconcile()` runs at boot and matches pending batches with no confirmed
`tx_id` against the mirror node **by payer account**. v1 queried network-wide,
where the last 100 transactions span about five seconds, so a real batch was
never among them and recovery silently never worked. And
`apps/registry/src/identity.ts`'s `AccountKeyResolver` looks up the key on file
for an account, because `purchase.buyer` is a Hedera account id rather than a
public key: without that lookup anyone could generate a keypair, sign anything,
and void an author's royalty through `POST /refund`.

**Accounts, scripts and the fee finding.**
`apps/registry/src/scripts/` includes `create-accounts`, `associate`,
`create-topic`, `distribute` and a read-only `preflight`. The registry
settlement account is `0.0.10475802`; the operator is `0.0.10474951`. Section 6
is the economic finding these scripts produced.

### x402

The HTTP 402 payment gate is `packages/hedera-x402/src/gate.ts`, written
directly against `@x402/core` (`x402ResourceServer`, `HTTPFacilitatorClient`,
the header codecs) and `@x402/hedera`'s `ExactHederaScheme` on the server side.
The client side is `apps/mcp/src/pay.ts` and `apps/bench/src/agent.ts`, using
`@x402/fetch`'s `wrapFetchWithPayment` and `x402Client` with
`createClientHederaSigner`. (`@x402/express` is declared as a devDependency of
`packages/hedera-x402` and is not imported by anything: the gate is written
against the core resource server over an Express `Request`/`Response` pair
directly. Stated rather than left to a reader's inference from
`package.json`.)

The facilitator is the **live Blocky402 testnet facilitator**,
`https://api.testnet.blocky402.com`. Nothing about the paid path is local: the
402, the requirements, the buyer's signed transfer, the facilitator's verify and
settle, and Hedera consensus. Real purchases:

| what | transaction |
|---|---|
| v2's first real purchase, 110,000 µUSDC | `0.0.7162784@1789202339.427560739` |
| the purchase the published A/B buy figure was measured from, 436,745 µUSDC | `0.0.7162784@1789220203.068787609` |
| a purchase made by the MCP tools over a real stdio MCP session | `0.0.7162784@1789219831.957808823` |
| a payment whose `onPaid` threw, recovered through `GET /owed` and replay | `0.0.7162784@1789219616.600692271` |

The payer on every purchase is `0.0.7162784`, not the buyer, because Blocky402
declares `extra.feePayer` on `hedera:testnet` and submits the buyer's signed
transfer itself. The *token* transfer inside it is the buyer's. Worth knowing
before anyone looks up a transaction id and concludes it is the wrong account.

Also worth stating because it is where the x402 spend control actually bites:
`CARPOOL_MAX_MICRO_USDC` rejects **client side, before a request is sent**, so a
cap set below the price rule's own output is not a warning, it is a buyer that
can never buy. The cap and the publish price share are derived from one constant
in `packages/carpool-core/src/pricing.ts` for that reason; they used to
contradict each other.

23 purchases in the full-feature run were timed end to end through the shipped
`payFetch`: **min 3.23 s, median 5.97 s, max 13.00 s**. The A/B's 7.70 s is one
sample from that distribution, and no ratio derived from it is pinned by any
guard.

### Circle USDC

Every price, fee, royalty and refund in this project is denominated in Circle's
Hedera testnet USDC, token **`0.0.429274`**, in integer µUSDC. No float reaches
a price, a fee or a payout. `GET /.well-known/carpool` serves the asset and the
network so a client never hard-codes them.

Real amounts, all confirmed on the mirror node: 1,382,235 µUSDC of sales and
1,368,735 µUSDC of payouts in the full-feature run, closing to the µUSDC against
the registry's balance at the time. Most of those were fixture sales at 3,000
µUSDC, which splits into a 2,500 µUSDC author royalty and the flat 500 µUSDC
tracker fee the registry keeps and never refunds, because the search and the
delivery did happen. Exactly: 24 sales at 3,000 plus the three A/B sales at
436,745 each. v2's very first sale, in the earlier run, was 110,000.

**The faucet trap, which is a real Circle integration finding and is in
`docs/RUNBOOK.md`:** Circle's faucet mints only to an account that is
**already associated** with the token. `maxAutomaticTokenAssociations` does not
satisfy it, because auto-association creates the relationship lazily on first
receipt and the faucet checks for an existing one *before* it sends. It then
declines silently: no transfer, no error, no explanation. Hence `pnpm --filter
@carpool/registry associate` before the faucet, and hence the ordering in
`docs/GETTING-STARTED.md`. The artifact that sold in v2's first real purchase is
that finding written up, which is a fair test of whether the product sells
anything anyone would want.

### Not integrated, and not claimed

**ENS** and **The Graph** are not integrated. See section 2 for the grep
results. No roadmap item in this repository is presented as a build.

---

## 5. What is proven, and what is not

### Proven on Hedera testnet, 2026-09-12

Two runs. The first: one purchase, one settlement epoch, one author, one anchor,
on topic `0.0.10496824`. The second, on its own fresh topic `0.0.10497461`:
**27 purchases, 25 batches, 15 anchors**, and specifically

- `POST /refund` inside the window, the buyer's money returned on chain and the
  author's royalty **voided rather than paid**: the refunded author
  `0.0.10497456` holds 0 µUSDC and has **no USDC relationship at all**, so no
  transfer ever reached it;
- `409 refund window has closed` 206 s after a purchase with a 120 s window;
- **13 distinct payees in one epoch across two chunks**, past the 9-payee
  boundary, each credited exactly 2,500 µUSDC;
- `reconcile()` recovering a real batch by memo after its receipt was dropped,
  with exactly one mirror-node record carrying that memo;
- five real `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` transfers, each reaching consensus
  with an empty transfer list and a real 1,337,809 tinybar fee, classified
  `failed`, their payouts returned to claimable, then parked, unparked and paid;
- the cross-process settle lease: two processes entering `settle()` at the same
  millisecond over one `ledger.sqlite` produced **one** transfer and **one**
  credit, 2,500 µUSDC and not 5,000;
- all three `POST /batches/:id/resolve` actions against real `NEEDS_OPERATOR:`
  batches, including a `release` whose memo the mirror node holds **no** record
  for, which is what made the release correct;
- `POST /delist`, with the existing purchase still refundable afterwards;
- `GET /owed` and `POST /owed/replay`;
- seven of the eight `BATCH_STATUS` values served by a live ledger;
- the `carpool_*` MCP tools driven over a real stdio session by the official
  `@modelcontextprotocol/sdk` client.

### Verify it without trusting us

```bash
python3 docs/evidence/v2-first-testnet-run/verify.py    # 19 checks
python3 docs/evidence/v2-full-feature-run/verify.py     # 60 checks
python3 docs/evidence/recompute-phase0.py               # 18 figures
nvm use && pnpm install && pnpm build && pnpm typecheck && pnpm test
```

Both verifiers are standard library only, **import nothing from this
repository**, fetch every fact live from `testnet.mirrornode.hedera.com`, and
re-implement the Merkle rules instead of calling ours.

Re-run today, 2026-09-13, with these results, stated exactly:

- first run: **19 of 19 pass**.
- full-feature run: **60 of 60 pass**. It used to be 59 of 61, and the two
  failures were one thing worth recording: `verify.py` read the registry's
  **live** USDC balance and asserted it still equalled the snapshot taken when
  the run closed. That passed on the day and then broke for good, because the
  registry account is long-lived and every later sale moves it. The check was
  really asserting "nobody has used this account since", which is not a property
  of the run and not something the run can promise. The money identity is now
  checked against the run's own recorded numbers, and the live balance is printed
  as an informational note with its drift. A verifier that decays into a failure
  while the thing it verifies stays true is worse than no verifier, because the
  next reader disbelieves the other 60 checks too.
- Phase 0: all 18 figures reproduce, and the script's own last line still reads
  `stop rule: overlap 0.417 < 0.50 and kappa 0.26 < 0.6 - STOP, as published`.
- suite: 1024 tests, 7 of 7 packages, 0 failures, fresh.

### Not proven, and it belongs here

- **`EMPTY_CLAIM`.** Never reached on chain. Its one plausible route was the
  concurrency race, and the settle lease refused the loser *before* it could
  claim anything, which is the correct behaviour and is why the status did not
  occur. Test only.
- **`SUCCESS_BUT_MISSING_EXPECTED_OPERATION`**, and `NEEDS_OPERATOR` arising
  from an unclassifiable ledger result code rather than from reconcile
  exhaustion. Both need the network to return a status these runs never saw.
- **`reconcile`'s `DUPLICATE_TRANSACTION` branch**, the one case where a
  mirror-node record must not be read as a failure. Producing it means making
  the network see one transaction id twice.
- **A transfer list at the full 10 entries.** Every multi-payee epoch in the run
  happened to include the registry's own fee row, which nets out, so the largest
  list submitted was 9.
- **The body-integrity `502`** and the `refundUndelivered` path behind it.
- **Anything at volume.** 27 purchases over about two hours, sequential. The
  concurrency test is two processes, not ten. Nothing has run against a hostile
  counterparty.
- **Demand.** Phase 0 returned STOP and nothing since has re-tested it.
- Two of the six batch-level scenarios were reached by injecting
  `SettlerDeps.submit`, a seam the shipped code already exposes, rather than by a
  real crash. Everything downstream of the injection is real: the transfer, the
  mirror-node queries, the escalation, the operator's decision, and the transfer
  that finally paid. The trigger is not.
- Every purchase, refund, batch and anchor in this repository's **tests** runs
  against a stub facilitator and a mocked Hedera SDK on 127.0.0.1. Only the two
  evidence runs are real.

---

## 6. The finding no test could have produced

**The first payout to a new author costs about 50x the fee of every later one,
and the registry pays it.**

| transfer | payees | fee |
|---|---|---|
| batch 2, 8 payees, none had ever held USDC | 8 | 538,941,422 tinybar = 5.389 HBAR |
| batch 3, 5 payees, none had ever held USDC | 5 | 337,291,196 tinybar = 3.373 HBAR |
| batch 12, 1 payee, explicitly associated moments earlier | 1 | 1,337,809 tinybar = 0.0134 HBAR |

**0.674 HBAR per never-associated payee against 0.0134 HBAR for an associated
one.** The cause is HIP-904 automatic association: accounts are created with
`setMaxAutomaticTokenAssociations(-1)`, so the *payout transfer* creates the
token relationship and the association fee is charged to the transaction payer,
which is the registry, not the author.

Hedera prices fees in USD, so the dollar figure does not depend on the HBAR
price: 0.674 ℏ at the $0.0749 HashScan showed on 13 Sep 2026 is about **$0.05**,
which is exactly the documented association fee. Onboarding one author therefore
costs the registry about **$0.05 to deliver a $0.0025 royalty**: 20x the payout,
and about 100x the 500 µUSDC the registry earned on that sale. (An earlier draft
assumed $0.20 per HBAR and said $0.135; that was wrong.) `docs/RUNBOOK.md` said association costs $0.05 per account per token,
once, which is true and says nothing about *who pays* when it happens
automatically. Nothing in the repository priced this before, because no live
batch had ever paid a payee that had not already been funded by hand.

It is bounded, once per author for ever, but it inverts the unit economics of
the first sale. `verify.py` checks it as a first-class assertion, including that
the registry is the payer. A registry paying arbitrary self-declared accounts
should either require the author to associate themselves, which costs the payee
$0.05 once, or price the first payout accordingly.

Two smaller findings from the same runs, reported rather than patched inside an
evidence run: `GET /batches` can serve a Hedera transaction id in **two
spellings**, because `markSettled` writes the SDK's `0.0.x@secs.nanos` and
`reconcile` writes the mirror node's `0.0.x-secs-nanos` straight through, so a
client that builds a URL or string-compares ids handles one and mishandles the
other. And a settled purchase survived the test that failed on it: an A/B
attempt hit a 5,000 ms vitest timeout mid-purchase, the test reported failure,
and the payment settled anyway and was recorded correctly. A timeout in a test
harness does not cancel money already in flight.

---

## 7. Demo script, four minutes

Works against a public deployment or locally. Replace `<DEPLOYED_URL>` with the
public dashboard URL; where a registry base URL is needed use
`<DEPLOYED_REGISTRY_URL>` or `http://127.0.0.1:8403` locally.

Three browser tabs and one terminal, arranged before recording:

- **Tab A**: `<DEPLOYED_URL>` (locally: `http://localhost:3000`), the explainer
  route, with `<DEPLOYED_URL>/app` one click away.
- **Tab B**: `https://hashscan.io/testnet/transaction/0.0.10475802@1789202482.460233839`,
  the settlement transfer that paid an author 109,500 µUSDC.
- **Tab C**: `https://hashscan.io/testnet/topic/0.0.10497461`, the anchor topic
  with its 15 roots.
- **Terminal**: an agent session with the `carpool` MCP server registered
  (`docs/GETTING-STARTED.md` section 0) and `CARPOOL_BUYER_ACCOUNT_ID` /
  `CARPOOL_BUYER_PRIVATE_KEY` set on a **USDC-associated, funded** ECDSA
  account. Locally, warm the embedder first (`pnpm --filter @carpool/registry
  warm-embedder`), because a cold ONNX cache is an 87 MB download and
  `POST /publish` embeds before it stores anything.

Check the two things that break a live demo, before recording:

```bash
curl -s -i "$CARPOOL_REGISTRY_URL/artifact/<magnet>" | head -1
```

`402 Payment Required` is a healthy registry quoting a price, and the buyer's
keys are then the only variable. `503` is the **registry's** facilitator, which
only its operator can fix, and the error text points at the wrong party: a buyer
reading "facilitator unavailable" will reasonably conclude their own setup is
wrong. `410` means delisted or expired and no configuration will buy it. If the
buy beat cannot be made live, run it against a local registry on 8403 and say so
on camera: the two recorded testnet runs are the on-chain claim either way.

| time | show | say |
|---|---|---|
| 0:00 to 0:25 | Tab A, top of the explainer | "An agent about to spend twenty minutes researching something checks first whether somebody already did it, and buys that instead. The author who did the work gets paid on every sale. This is Hedera testnet and test USDC, so nobody here is earning real money." |
| 0:25 to 1:00 | Terminal: ask the agent to `carpool_search` a question you were about to research | "Search is free and needs no account, because the manifest is the buyer's evidence and charging for evidence defeats the point. What comes back is the question, the abstract, every source, what the author says it cost to produce, and what it costs right now. The question was embedded on this machine, so the registry never received the text." |
| 1:00 to 2:00 | Terminal: `carpool_fetch <magnet>` | "Now it buys. Unpaid request, HTTP 402 with the quote, a signed USDC transfer on Hedera, the live Blocky402 facilitator verifies and settles, and the body comes back. Single-digit seconds: the median across 23 timed purchases was 5.97 s. The tool wrote the artifact to a **file**, not into the context window, and it hashed the bytes against the hash it took from the free manifest **before** paying, because a hash header from the same server that served the body is not evidence." |
| 2:00 to 2:30 | Tab B, then Tab C, then Tab A `/app` earnings desk | "The author is paid by a **second** transfer in a later settlement epoch, not by the purchase, because the buyer has 120 seconds to refund and the registry has to still be holding the money. So this half is the recorded run rather than the live one: this settlement transfer on HashScan is the one that put 109,500 µUSDC into an author's account, and this HCS topic holds one Merkle root per non-empty epoch over that epoch's manifest hashes and payee rows. The manifest half is provenance: it timestamps that an artifact existed, unmodified, at a consensus time." |
| 2:30 to 3:10 | Tab A `/app`, the "What we measured" desk | "One recorded comparison. $3.97 to redo against $0.4367 to buy. The redo side is a **floor**: four subagent transcripts were not retained and the dollars use a rate card below the tier that was actually billed. The buy side is on the wire, 7.69 s, and here is the transaction. The token row is the one I would defend hardest: 2.36 million tokens to produce against 90 tokens for the receipt." |
| 3:10 to 3:40 | Terminal: `python3 docs/evidence/v2-full-feature-run/verify.py` (or scroll pre-recorded output) | "60 checks, zero imports from the repository, every fact fetched live from the mirror node, and it re-implements our Merkle rules instead of calling them. It proves the refund on chain, 13 payees across two chunks past the 9-payee cap, five consensus-reached failures, and two processes racing one epoch to a single transfer. All 60 pass, and the one check that used to decay has been rewritten: it asserted a live balance still matched a snapshot, which stopped being true the moment the account was used again." |
| 3:40 to 4:00 | Tab A, still the "What we measured" desk: its correction notice and its "what this does not show" list | "The last thing is the part most submissions leave out, and it is on the page rather than in a footnote. An earlier version of these figures was **fabricated**, unit-test fixtures transcribed as results, and the retraction ships in this UI. And our own kill test for whether many people independently produce the same research returned **STOP**: 41.7% overlap against a 50% bar, kappa 0.26 against 0.6, with all 18 figures recomputing from committed raw labels in `docs/PHASE0.md`. The rail is proven. The market is not. A judge who finds a buried negative result should trust nothing else on the page, so we did not bury it." |

If the cut has to be shorter, drop the 3:10 verifier beat and mention it in Q&A.
Do not drop 3:40.

---

## 8. What we would do next

Grounded in items already open in the repository, not invented.

1. **Price or move the first-payout association cost.** Either require an author
   to associate USDC themselves before their first royalty, which moves $0.05
   once to the party that benefits, or charge the first sale for it. Today the
   registry spends about $0.05 of HBAR to deliver $0.0025 of USDC to a new
   author, which is section 6.
2. **Normalise the two transaction-id spellings**, with a test pinning both the
   `markSettled` and the `reconcile` path, and document that `txId` has one
   shape.
3. **Reuse-proof the remaining balance checks.** The buyer and the single-sale
   authors are still asserted by live balance. They hold today because nothing
   has spent from them, but they are the same trap the registry balance was, and
   the fix is the same: assert the transactions, not the balance.
4. **Close the four test-only branches** deliberately rather than by waiting for
   the network: `EMPTY_CLAIM`, `SUCCESS_BUT_MISSING_EXPECTED_OPERATION`,
   `reconcile`'s `DUPLICATE_TRANSACTION`, and the body-integrity `502` with
   `refundUndelivered`. Three need a fault injector at the mirror-node boundary;
   the 502 needs a corrupted stored body.
5. **Give the anchor a record.** `AnchorResult` discards the HCS receipt, so the
   registry cannot say where its own anchor is. A per-anchor row with the topic
   sequence number and consensus timestamp, and a read route for it.
6. **Enforce reconcile spacing.** `RECONCILE_ATTEMPTS_BEFORE_OPERATOR` is three
   passes, which the constant's own docstring reads as half an hour at the 600 s
   epoch default. Nothing enforces the spacing, and in the evidence run three
   passes ran in 2.5 s and escalated a batch that had already paid.
7. **Measure retrieval for real.** Phase 0's derivation says the economics need
   precision@1 of about 71% on full substitutes, or 46% if partial answers are
   worth 40% of a redo. This repository has measured **no** real precision@1:
   `pnpm bench` reports 1.000 on a synthetic corpus with no topically close
   wrong answer in it, and says so in its own banner.
8. **Re-run the kill test in the shape the data actually suggested.** 21 of 36
   pairs were "same facts, different depth". Selling the deep version to people
   who already found the brief one is a different product from the one Phase 0
   tested, and it is where the overlap is. That is a demand-side measurement,
   not a build.
9. **Run at rate.** Nothing here says what happens at volume, under a real epoch
   timer, or against a counterparty trying to break it.

Not on this list, deliberately: ENS and The Graph. `AuthorIdentity` was designed
so an `EnsAuthor` could exist, and that is a design accommodation rather than a
plan, so it does not belong in a roadmap that a reader might mistake for a
claim.

---

## 9. Where everything is

| | |
|---|---|
| what it is, and what is unproven | `README.md` |
| product intent and users | `PRODUCT.md` |
| wire contract, every route and every status value | `CONTRACT.md` |
| the A/B, its corrections, and how the document is guarded | `docs/AB-MEASUREMENT.md` |
| the kill test that returned STOP | `docs/PHASE0.md`, `docs/evidence/phase0-rater-data.md`, `docs/evidence/recompute-phase0.py` |
| operations, custody, restart, backup and the traps | `docs/RUNBOOK.md` |
| installing the MCP server, both roles, and what broke when it was followed | `docs/GETTING-STARTED.md` |
| first real testnet run, raw, with a 19-check verifier | `docs/evidence/v2-first-testnet-run/` |
| full-feature testnet run, raw, with a 61-check verifier | `docs/evidence/v2-full-feature-run/` |
| why the repo is shaped this way | `docs/RESTRUCTURE.md` |
| the audits that produced section 3.3 | `docs/AUDIT-CLAIMS.md`, `docs/AUDIT-MOCKS.md`, `docs/AUDIT-MONEY.md`, `docs/AUDIT-TESTS.md`, `docs/FINAL-REVIEW.md` |

The predecessor rail's evidence is genuine and is **v1's**: `apps/settlement`,
deleted in this restructure, settled 60 paid requests in one batched
`TransferTransaction` (`0.0.10475802@1789137942.760688301`, 4 payees, `SUCCESS`,
1,591,862 tinybar of fees) with 13 HCS anchors on topic `0.0.10475805`, twelve of
them over empty epochs. v2 shares the SDK, the account and the token, and now
has its own transaction ids.
