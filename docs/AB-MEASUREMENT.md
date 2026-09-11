# A/B — what does redoing research cost, versus buying it?

> ## Correction, 2026-09-12
>
> **Every figure in the previous version of this document was fabricated.** The
> table read `412s / 4.2s / $2.14 / $0.31 / 195,524 tokens / 37 tool calls /
> 143 sources`. Those were literals typed into a unit-test fixture
> (`apps/bench/src/ab.test.ts`), transcribed here and into the README as
> results. `computeAb()` and `renderAb()` had **no caller** outside that test, so
> no run of any kind produced them. Nothing was published, bought, or timed.
>
> The commit message on `2bf4931` ("H1: the A/B measurement, run on a real
> artifact", "Measured against this repo's own ETHOnline prize analysis") is
> wrong in the same way and cannot be edited — it is history. Treat it as
> retracted.
>
> Two of the old numbers were checkable and both failed: the doc claimed 143
> source links where the artifact has **28**, and the `$0.31` "produced by
> `priceAt()`" was the fixture's `priceMicroUsdc` field. One number was genuine
> and is unchanged below: the 11,355-token full read.
>
> Everything below this box comes from `apps/bench/src/ab-run.test.ts`, which
> boots the registry, publishes the artifact, and buys it back. Its output is
> pasted verbatim. The numbers are larger than the fabricated ones in the
> direction that favours the project, which is a reason for more precision about
> what was measured, not less.

> ## Correction to the correction, 2026-09-12: the drift guard did not work
>
> The commit that retracted the fabrication, `9ef4062`, said: *"a test asserts
> `docs/AB-MEASUREMENT.md` still quotes the figures the runner produces, so a doc
> cannot drift from the run in either direction."* **The second clause was
> false**, and that sentence is in the permanent record, so the correction goes
> here where a reader will find it.
>
> The test it referred to was a list of hand-typed strings checked with
> `expect(doc).toContain(figure)`. One entry was `"28"` for the source count —
> two digits, satisfied by hex inside the run's own magnet
> (`…257de528ce3e10…`). An audit set this document back to the retracted **143
> sources** and `pnpm ab:run` still reported 4 passed. The one figure the
> fabrication got wrong by a factor of five was the one figure the guard could
> not see. Substring containment cannot tell a figure from a coincidental digit
> run, and cannot see a *wrong* figure at all — only a missing one.
>
> What replaced it is described in "How this document is guarded" below:
> every figure is derived from a machine-written record, checked at its labelled
> position in the prose, and the figure table is generated rather than typed.
> Two further things that were also true and unsaid: the transcript check ran on
> one laptop and never in CI, and `apps/dashboard/lib/measured.ts` recorded
> `436,700` µUSDC for a charge of `436,745` — invisible because both render as
> `$0.4367`.

> ## Update, 2026-09-12: the buy side is now a wire measurement
>
> The buy-side figures below used to be measured against an **in-process registry
> and a stub facilitator**, and this document labelled them a floor for that
> reason. They are now measured against a registry listening on a real port with
> real Hedera credentials, the real Blocky402 facilitator, real Hedera testnet and
> the registry's real ONNX embedder, paid for by a funded buyer account. The
> transaction the recorded run paid with is public:
> `0.0.7162784@1789220203.068787609`.
>
> **What moved:** the latency (milliseconds → seconds), the time ratio with it, and
> the summary token count, because the receipt ends `Transaction: <txId>` and a
> real transaction id is longer than the stub's. **What did not move:** the price,
> the charge, the integrity check, the artifact figures, and every redo figure —
> the redo side is still a transcript measurement and was not re-run.
>
> The superseded stub reading is kept in "Read it carefully" below, because the
> ratio it produced was quoted and a reader deserves to see what replaced it.
> Raw evidence and an independent verifier: `docs/evidence/v2-full-feature-run/`.

**This is the demand-side gate.** Phase 0 measured the *supply* of free
substitutes and returned **STOP** (overlap 42% against a 50% bar, κ 0.26). That
is a proxy, and a noisy one. This measures the thing that actually decides
whether anybody pays.

## The artifact

This repo's own ETHOnline 2026 prize analysis —
`ethonline2026/ETHOnline-2026-research.md`, 45,896 bytes (45,417 characters),
**28** unique source URLs, counted with:

```bash
grep -oE 'https?://[^ )"]+' ETHOnline-2026-research.md | sort -u | wc -l
```

It is a real artifact: 30 prize tracks across 11 sponsors, a compose graph, and
the continuity-pool finding. It was written for a hackathon whose entrants all
needed the same understanding; how many of them there were is not recorded
anywhere in this repo, so no entrant count is claimed here.

It sits **outside** this repo, and so does the transcript of the session that
produced it. A checkout without them cannot run the measurement; the runner
skips that part and says so, and the guards that do not need them still run.

## Result

Verbatim output of `pnpm ab:run` on 2026-09-12, against the LIVE registry, the real
Blocky402 facilitator and real Hedera testnet
(`CARPOOL_AB_LIVE_REGISTRY=http://127.0.0.1:8403`):

```
A/B — What are all the ETHOnline 2026 prize tracks, how do they compose, and what should we build?
      swarm:7fd4b778f4aa46e41ad521a55ed1d5e9d6107f92fe659b6a0477ef76275ec6f1

                        REDO (measured, a floor)        BUY (measured, on the wire)
  wall clock                630.9s active                   7.70s
                             6059s elapsed                  0.01s search + 7.69s fetch
  tokens                 2,357,943                             90 (summary)
                                                           11,355 (if fully read)
  cost                     $3.9704                        $0.4367

  saved: $3.5337 (9.1x cheaper), 623s (82x faster)

  redo breakdown:
    claude-opus-5 · 48 in · 83,177 out · 131,024 cache write · 2,143,694 cache read
    22 tool calls · 28 sources · transcript rows 8..222
    priced at $/MTok: in 5 · out 25 · cache write 6.25 · cache read 0.5
  buy breakdown:
    quoted $0.4367 · paid $0.4367 · priceBase 397,041 µUSDC · floor 39,704 µUSDC
    45,896 bytes written · integrity verified

  REDO IS A FLOOR: 4 subagent dispatches spent tokens in transcripts that were not
  retained. The real production cost is strictly higher than the figure above.
  SEGMENT BOUNDARY: the same span also produced prize-map.html, four candidate project ideas. Someone
  redoing only this document would spend less. This is not a single-artifact cost.
  WIRE MEASUREMENT: real network, real facilitator, real Hedera settlement — the 402,
  the signed transfer, the facilitator's verify and settle, and consensus. It still
  EXCLUDES the settlement epoch that pays the author (a separate transfer, minutes to
  a day later) and the HBAR transaction fees nobody here is charged. One sample, one
  network path — not a percentile.
  The dollar figures are measured tokens at the rates printed above — a price list, not a fact.
  One artifact, one question, one model — a worked example, not a population estimate.

  registry: LIVE (http://127.0.0.1:8403), real Blocky402 facilitator, real Hedera testnet, embedder Xenova/all-MiniLM-L6-v2
  transaction: 0.0.7162784@1789220203.068787609 (real, on a mirror node)
  priceBase policy: 10% of the measured redo floor
  artifact: /Users/romariokavin/Documents/RandomClaudeSessions/ethonline2026/ETHOnline-2026-research.md
  generated: 2026-09-12T13:36:56.479Z
```

**Four lines of that block change on every run, and they are not claims.** The
magnet changes because `producedAt` goes into the content-addressed manifest, so
republishing the same bytes at a different time is a different artifact. The two
latencies and the time ratio change because they are wall-clock readings of one
network path on one afternoon — two consecutive runs of this same code recorded
5.58 s and 7.70 s. And the µUSDC charge can move by a µUSDC or two, because
`priceAt()` decays continuously: at a one-day half-life the price loses about
1 µUSDC for every 160 ms of the manifest's age. Everything else in the block is
deterministic, and the guards below treat the two groups differently.

The gate charged **436,745 µUSDC** in the recorded run — the integer, because
`$0.4367` hides a 50 µUSDC range and that is how a wrong value survived in the
dashboard for as long as it did.

**The wire run establishes something the loopback run could not: the quote does
not move between the 402 and the settlement.** 7.69 s elapsed between the unpaid
402 and the paid retry, and the charge is `priceFloor + priceBase` exactly — the
price at the instant the 402 was issued, not at the instant the payment landed
about 3 µUSDC of decay later. That is `PaymentGate` replaying the requirements it
issued rather than re-pricing, which CONTRACT.md promises and which a 2 ms
in-process round trip cannot distinguish from re-pricing.

## How this document is guarded

The chain is three links, and each one has a test:

```
artifact + transcript  →  two committed records  →  this document + the dashboard
   (one laptop)            (in every clone)              (in every clone)
```

1. **`apps/bench/src/redo-measured.json` ↔ the producing session's transcript.**
   `pnpm ab:run` re-derives every token count and timing from the transcript when
   it is present and **fails** if the record no longer matches. Drifting
   `outputTokens` by one fails it.
2. **`apps/bench/src/ab-measured.json` ↔ a real publish → search → pay → verify
   round trip.** Written by the run itself (`CARPOOL_AB_WRITE=1`), never typed.
   It carries the artifact's sha256, so "the artifact this document describes" is
   a statement about bytes — and, since this re-measurement, `registry.wire: true`
   plus the real transaction id, so "the figures came from a wire run" is a
   statement about a transaction anyone can look up on a mirror node.
3. **This document and `apps/dashboard/lib/measured.ts` ↔ those two records.**
   `apps/bench/src/ab-doc.test.ts` and `apps/dashboard/lib/measured.test.ts`
   check every figure here against the records, at its **labelled position** —
   `"**28** unique source URLs"`, not the digits `28` — and reject any other
   value found in that position. The figure table below is *generated* from the
   records, so it cannot drift at all; a hand edit to it is a diff. The records'
   arithmetic is also checked against itself: `priceBase` must be what the
   *shipped* price rule quotes for the redo dollars — `priceForRedoCost()` from
   `@carpool/core`, i.e. 10% of them — `priceFloor` must be
   `max(1,000, round(priceBase × 0.1))`, the charge must be
   `priceFloor + round(priceBase × freshness)` for the age recorded, and the
   full-read tokens must be `ceil(characters / 4)`.

**What CI can check, and what it cannot.** Link 3 needs nothing but the
repository, so it runs everywhere, including `ubuntu-latest`, and fails the
build. Links 1 and 2 need the artifact and the private transcript, so on any
other machine they **skip** — and a skip is not allowed to look like a pass:
`pnpm ab:run` writes a status file naming exactly what it verified,
`scripts/check-ab-status.mjs` fails CI if that file is missing or claims less
than it should, and `CARPOOL_AB_STRICT=1` turns the skip itself into a failure on
a machine that is supposed to have the inputs.

So this is the honest statement, and the one `9ef4062` should have made: **a
figure in this document cannot disagree with the committed records anywhere, and
cannot disagree with the artifact and the transcript on a machine that has
them.** A figure that is wrong in the records *and* consistently wrong here is
caught only where the inputs exist — which is why the records are machine-written
and hash-stamped rather than hand-maintained.

### Reproducing it

```bash
nvm use                                   # Node 20.19.0
pnpm install

# The buy side, in-process against a stub facilitator (no credentials needed).
# Fast, and a FLOOR: the report says so.
CARPOOL_AB_ARTIFACT=/path/to/ETHOnline-2026-research.md pnpm ab:run

# The buy side ON THE WIRE — what the figures above are. Needs a registry already
# running with real Hedera credentials (see docs/RUNBOOK.md) and a funded buyer.
CARPOOL_AB_ARTIFACT=/path/to/ETHOnline-2026-research.md \
CARPOOL_AB_LIVE_REGISTRY=http://127.0.0.1:8403 \
CARPOOL_AUTHOR_ACCOUNT_ID=0.0.x CARPOOL_AUTHOR_PRIVATE_KEY=… \
CARPOOL_BUYER_ACCOUNT_ID=0.0.y CARPOOL_BUYER_PRIVATE_KEY=… \
  pnpm ab:run

# Re-record it (rewrites ab-measured.json and the generated table below). Add
# CARPOOL_AB_LIVE_REGISTRY=… to re-record the wire figures rather than the stub ones.
CARPOOL_AB_ARTIFACT=/path/to/ETHOnline-2026-research.md CARPOOL_AB_WRITE=1 pnpm ab:run

# The redo side, from the producing session's own transcript.
pnpm measure:redo -- ~/.claude/projects/<project>/<session>.jsonl \
  --from 8 --to 222 \
  --start-anchor 'analyse all the prizes' \
  --end-anchor 'cat > ETHOnline-2026-research.md'
```

## Where each number comes from

Generated by the runner from the two records. `kind` is load-bearing: a
`policy` number is an input somebody chose, a `stated-rates` number is measured
tokens times a price list, and a `run-dependent` number is different on your
machine.

<!-- BEGIN GENERATED FIGURES: written by `pnpm ab:run` from apps/bench/src/{redo,ab}-measured.json.
     Hand edits fail `apps/bench/src/ab-doc.test.ts`. -->

| figure | value | kind | derived from |
|---|---|---|---|
| `redo.tokens.total` | 2,357,943 | measured | apps/bench/src/redo-measured.json: the four token buckets, summed |
| `redo.tokens.input` | 48 | measured | apps/bench/src/redo-measured.json: inputTokens |
| `redo.tokens.output` | 83,177 | measured | apps/bench/src/redo-measured.json: outputTokens |
| `redo.tokens.cacheWrite` | 131,024 | measured | apps/bench/src/redo-measured.json: cacheWriteTokens |
| `redo.tokens.cacheRead` | 2,143,694 | measured | apps/bench/src/redo-measured.json: cacheReadTokens |
| `redo.tokens.inputPlusOutput` | 83,225 | derived | apps/bench/src/redo-measured.json: inputTokens + outputTokens |
| `redo.cacheSharePercent` | 96 | derived | apps/bench/src/redo-measured.json: (cacheWrite + cacheRead) / total, rounded to a percent |
| `redo.apiCalls` | 25 | measured | apps/bench/src/redo-measured.json: apiCalls — distinct message ids, not usage rows |
| `redo.activeSeconds` | 630.9 | measured | apps/bench/src/redo-measured.json: activeSeconds (gaps ≤ 120 s, timestamps sorted) |
| `redo.elapsedSeconds` | 6059 | measured | apps/bench/src/redo-measured.json: elapsedSeconds |
| `redo.toolCalls` | 22 | measured | apps/bench/src/redo-measured.json: toolCalls |
| `redo.subagentCalls` | 4 | measured | apps/bench/src/redo-measured.json: subagentCalls — the reason every redo figure is a floor |
| `redo.costUsd` | $3.9704 | stated-rates | apps/bench/src/redo-measured.json tokens × the rates in the report |
| `artifact.sources` | 28 | measured | apps/bench/src/ab-measured.json: artifact.sources — unique https URLs in the artifact |
| `artifact.bytes` | 45,896 | measured | apps/bench/src/ab-measured.json: artifact.bytes |
| `artifact.chars` | 45,417 | measured | apps/bench/src/ab-measured.json: artifact.chars |
| `buy.priceBaseMicroUsdc` | 397,041 | policy | round(redo dollars × 0.1 × 1e6) |
| `buy.priceFloorMicroUsdc` | 39,704 | policy | max(1,000, round(priceBase × 0.1)) |
| `buy.paidMicroUsdc` | 436,745 | measured | apps/bench/src/ab-measured.json: buy.paidMicroUsdc — what the x402 gate took, to the µUSDC |
| `buy.paidUsd` | $0.4367 | derived | buy.paidMicroUsdc / 1e6, to four decimals |
| `buy.tokensForSummary` | 90 | measured | apps/bench/src/ab-measured.json: buy.tokensForSummary — approxTokens over the text carpool_fetch returns, with CARPOOL_ARTIFACT_DIR=/tmp/carpool-artifacts (the receipt names the file it wrote) |
| `buy.tokensIfFullyRead` | 11,355 | measured | apps/bench/src/ab-measured.json: buy.tokensIfFullyRead — ceil(artifact.chars / 4) |
| `savings.usd` | $3.5337 | derived | redo dollars − buy dollars |
| `savings.costRatio` | 9.1 | derived | redo dollars ÷ buy dollars |
| `savings.tokensFullRead` | 2,346,588 | derived | redo tokens − full-read tokens |

<!-- END GENERATED FIGURES -->

Two figures in that table deserve their own note.

**The 56 `usage` rows in the measured span collapse to **25** API calls** once
deduped by `message.id`. Summing rows instead of calls gives 5,431,568 tokens,
2.3× the real total — and its output figure alone (244,810) exceeds the whole
session's cumulative 127,733, which is how you know the naive sum is wrong
rather than merely different.

**The summary token count has a stated input, because it would otherwise not be
reproducible.** It is `approxTokens()` over the exact text `carpool_fetch`
returns, and that text names the file the artifact was written to — so its length
depends on the output directory. `apps/mcp/src/server.ts` uses
`process.env.CARPOOL_ARTIFACT_DIR ?? join(os.tmpdir(), "carpool-artifacts")`, and
`os.tmpdir()` is `/tmp` on Linux, a ~50-character `/var/folders/…` path on macOS,
and different again under `turbo run test`: the same code on this one laptop
produced **96** tokens standalone and 85 under turbo. A figure that moves with
the shell that invoked the test is not a figure, so the runner pins the directory
to `CARPOOL_ARTIFACT_DIR=/tmp/carpool-artifacts` — a value a deployment can hold —
records it in `ab-measured.json` as `buy.artifactDir`, and the figure above is the
receipt for a deployment configured that way.

It also depends on the **length of the transaction id**, which is the second half
of why this figure is 90 and the stub run's was 85: the receipt's last line is
`Transaction: <txId>`, and a real Hedera transaction id
(`0.0.7162784@1789220203.068787609`, 32 characters) is longer than the stub's
`0.0.2222@1-1`. Five tokens, against 11,355 for reading the body — it moves no
conclusion, and it is recorded rather than smoothed over because the earlier
figure was a property of a test double as much as of the artifact.

Two earlier versions of this figure were wrong in the other direction: the first
invented `/tmp/carpool/…`, a path the product never produces (83 tokens), and the
second used the bare `os.tmpdir()` default and so published a number that only
held on the machine and shell that recorded it. The argument does not move either
way: the summary is two orders of magnitude smaller than the artifact.

### The rates are an input, and they are not the rates that were billed

`costUsd(usage, rates)` takes the price list as an argument. The report prints
the one it used: Claude Opus 5's published list price as of 2026-09-12 — **$5
input / $25 output / $6.25 cache write / $0.50 cache read per MTok**. Re-derive
the dollar figure against whatever the rates are when you read this.

The session actually ran on the 1M-context tier, which Claude Code's own
accounting records as `claude-opus-5[1m]` with a `costUSD` roughly **1.19x** what
those published rates predict. The premium is not derivable from the record: the
first `cost-state` snapshot in that file implies a cumulative **1.187**, and the
increment between two snapshots implies a marginal **1.259** — a cumulative and a
marginal reading, not two like-for-like ones, and in neither case a flat factor.
So the redo side costs **$3.9704** at the stated rates and the true bill at the
tier billed is somewhat higher. It is left unmeasured rather than guessed.

### Why the full read is 11,355 and not 11,474

`approxTokens` divides **characters** by 4. The artifact is 45,417 characters in
45,896 UTF-8 bytes — the difference is em dashes, arrows and box drawing. A
reviewer reaching for `wc -c` gets 45,896 and computes 11,474. Characters are the
right denominator: a tokenizer sees code points, not bytes.

## Read it carefully

**The time ratio is still not a headline, and the number above is one sample.**
The old version of this document led with time at 98× and argued that wall-clock
is the durable half of the value. The argument holds; the numbers have moved
twice.

*What it used to say, and why it was not enough.* Before this run the buy side was
measured against an **in-process registry with a stub facilitator** — no network,
no Hedera settlement, no mirror-node round trip — and the reading was 0.02–0.03 s.
Three runs of that code gave ratios of 21,767×, 24,885× and 24,538×, and the
renderer stamped `(LOCAL, not a wire time)` onto the ratio itself rather than only
footnoting it, because a ratio is the thing that gets copied out of a report. That
was honest about what it was, and it was still a division over a loopback.

*What it says now.* 7.70 s, on the wire: a real 402, a real signed USDC transfer,
the real Blocky402 facilitator's verify and settle, and Hedera consensus. Almost
all of it is the paid retry (7.69 s of 7.70 s); the free search, including a real
ONNX embedding of the question, was 0.01 s. The ratio that falls out is 82×, and
it is **not** pinned by any guard, for the same reason as before: two consecutive
runs of this code recorded 5.58 s and 7.70 s, so pinning one would be pinning a
sample of a network. Across this run's other 24 purchases the same round trip
ranged from **3.2 s to 13.0 s**.

What the wire latency *does* establish: buying an artifact takes single-digit
seconds against a real facilitator and a real ledger, not milliseconds and not
minutes. What it still does **not** establish: (1) when the *author* is paid —
that is a separate settlement transfer in a later epoch, measured nowhere here;
(2) the HBAR transaction fees, which the facilitator's fee payer and the registry
carry and which this dollar figure excludes; (3) any distribution — one sample on
one machine's network path is not a percentile. The repo's earlier real-testnet
evidence from v1 — 60 paid requests settled, batch
`0.0.10475802@1789137942.760688301` — recorded no latency at all, so it is not
blended in.

**The defensible headline is cost and tokens.** $3.9704 → $0.4367 is 9.1× on a
floor-versus-actual comparison. 2,357,943 redo tokens → 90 summary tokens is the
one that is hard to argue with: the buyer's context absorbs a four-line receipt
instead of two million tokens of cache traffic.

**The two token rows are the product's own argument.** 90 tokens is what the
buyer's context absorbs from the fetch; 11,355 is what it absorbs if the agent
reads the whole file. Even a full read saves 2,346,588 tokens against producing
it — but the gap between those two is exactly why `carpool_fetch` writes a file
instead of returning the body inline. Return it inline and the buyer pays the
full 11,355 whether or not they needed it. `apps/bench/src/ab.test.ts` asserts
the saving goes **negative** for an artifact large enough to cost more to read
than to produce.

**Cache traffic is 96% of the redo tokens.** 2,143,694 cache reads and 131,024
cache writes against 83,177 output tokens. This is what a long agentic session
costs. Counting only `input_tokens` + `output_tokens` — 83,225 — understates the
segment by a factor of twenty-eight. It is also why the dollar ratio is smaller
than the token ratio: cache reads are cheap per token, and most of the tokens are
cache reads.

## What this does not show

**One artifact, one question, one model.** A worked example of the trade, not a
population estimate. Many artifacts would produce a distribution; this produces
a point.

**"Redo" is what *this* author spent**, not what a second person would spend.
Another researcher might be faster or slower; the same question in six months
against better models would cost less to redo, which narrows the gap.

**The redo figure is a floor, twice over.** Four `Agent` dispatches in the
measured segment spent tokens in subagent transcripts that were not retained —
`isSidechain` rows in that file: 0, and no `tasks/` directory survives for the
session. And the dollar figure prices measured tokens at published rates below
the tier actually billed. Both gaps run the same way: the real production cost is
**higher than $3.9704 and 2,357,943 tokens**.

**The buy figure is no longer a floor, and it is not a total either.** It is a
wire measurement — real registry, real facilitator, real Hedera testnet, real
embedder — so the latency is not understated any more. What it excludes is stated
rather than implied: the settlement epoch that pays the author (a second transfer,
minutes to a day later), and the HBAR network fees, which are real and which
nobody in this comparison is charged. Those fees are not small relative to a
2,500 µUSDC royalty: this run measured **0.0134 ℏ** for a settlement transfer to a
payee that already held USDC and **0.674 ℏ** for one that did not, because the
transfer creates the token association and the registry pays for it. See
`docs/evidence/v2-full-feature-run/README.md`.

**The segment is not one artifact.** Rows 8–222 span 101 minutes that also
produced `prize-map.html` and four candidate project ideas. Someone redoing
*only* this document would spend less than the segment did. The segment boundary
is stated rather than narrowed because narrowing it — picking the subset of turns
"really" attributable to the document — is a judgement call that would be easy to
make flatter and impossible to check. The honest version is the wider span with
the caveat attached.

**The price is a choice, not a discovery.** `priceBase` is 10% of the measured
redo floor; that fraction is a judgement call, stated in code as
`PRICE_BASE_FRACTION_OF_REDO`. What is *not* a choice is the charge: that is
whatever `priceAt()` returned for that base at the artifact's age with the
shipped one-day half-life, and what the x402 gate actually took. Set the fraction
higher and the ratio falls.

It is also, now, the *same* choice the product ships. This run listed at 10% while
`carpool_publish`'s own rule priced at 15% and the buyer's default spend cap was
derived from that 15% — two fractions for one decision, recorded as M4 in
`docs/AUDIT-CLAIMS.md`. Resolved to 10%: `PRICE_BASE_FRACTION_OF_REDO` is now
`@carpool/core`'s `PRICE_SHARE_OF_REDO_COST` rather than a second copy of it, and
this run publishes through `priceForRedoCost()` — so the price above is the price
the shipped tool would quote for the same self-reported cost, not a parallel
formula that happened to agree. The reasoning for 10% over 15%, and the
measurement that would reverse it, is the block comment on that constant in
`packages/carpool-core/src/pricing.ts`. The figures in this document did not move,
because 10% is what was measured under.

**The manifest's cost claim is still self-reported.** The runner publishes a
provenance block derived from the transcript, which is more than an author has to
do. In production nothing forces that: the guard is that the claim is published
in the manifest for the buyer to weigh, and that an inflated one is refundable
inside the window.

**It says nothing about whether the second buyer exists.** That is what Phase 0
tried to measure and failed to establish. A 9× saving on an artifact nobody wants
is worth nothing. Phase 0's structural finding — that people answer the same
question at different *depths*, with free substitutes appearing within half a
day — is the live risk, and it is why the tracker ranks on depth rather than
similarity alone.

## The honest summary

Buying is dramatically cheaper **when a suitable artifact exists**, and the token
gap is large enough that it does not depend on the dollar figure being precise.
Whether such an artifact exists often enough is unproven, and Phase 0 leaned
against it. This number makes the trade worth taking when the match is there; it
does not make the market.
