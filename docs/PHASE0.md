# Phase 0 — the kill test: does event-shaped demand converge?

**Status: measured. Recommendation: STOP.** The overlap fraction is below the
stop rule's 50% bar on every reading of the data (33–47%; adjudicated 42%), and
rater agreement (κ = 0.26) is below the 0.6 bar, so the labels cannot be
relied on to rescue it. Convergence count passes on the median (7.5) but fails
in the two categories closest to the product's own exemplar use case (hackathon
prize drop: 2; airdrop criteria: 4). Details, method and limitations below.

Measured 2026-09-12. Events span 2026-03-18 → 2026-07-08. Working notes with
every artifact, pair, and both raters' scores are committed at
[`docs/evidence/phase0-rater-data.md`](evidence/phase0-rater-data.md), and every
figure on this page recomputes from its section 6 table:

```
python3 docs/evidence/recompute-phase0.py
```

That script exits non-zero if any published figure stops reproducing. It exists
because this page previously cited the rater data at a path inside
`.superpowers/sdd/`, whose `.gitignore` is `*` — so the evidence for a STOP
verdict was in no clone of this repo. The session-local scratch files
(`artifacts.json`, `pairs.json`, `raterA.json`, `raterB.json`,
`adjudicated.json`) were never committed and are gone; the section 6 table is the
record.

---

## 1. Claim under test

When an event happens, many **independent** parties produce substantially the
same synthesis within a short window, then it expires. If true, one artifact
has many buyers. If false, there is no market.

This is a **supply-side** measurement: it counts free public substitutes. It
does not measure willingness to pay (§7 of RESTRUCTURE.md is the demand-side
A/B). Convergence is necessary, not sufficient. Public substitutes are also
competition.

## 2. Method (as executed)

- **Events:** 8, one per required category, all within the last six months.
- **Artifacts:** for each event, web search (WebSearch, multiple queries) for
  public artifacts — news, explainers, deep-dives, how-to guides, newsletters,
  community docs — then WebFetch of every candidate to confirm publication
  date, author/outlet, originality, type and length. Only artifacts with a
  confirmed date inside `[event, event + 14 days]` count. Official posts by the
  party to the event (Tempo, Aave, OpenAI, Kelp/LayerZero, Microsoft, the
  Council, ETHGlobal/sponsors, MegaETH) are excluded: they are the event, not a
  synthesis of it. Reposts and syndications collapse to one (e.g. the same
  MegaETH guide on Bitget/MEXC/cryptonews.net/BlockchainReporter counts once;
  KuCoin "flash" items that credit BlockBeats count as BlockBeats). Two
  different authors at the same outlet count as two.
- **Pairs:** all pairs within each event enumerated; **5 pairs per event sampled
  uniformly** with a fixed seed (`random.Random(20260912)`), all pairs where
  fewer than 5 exist. 36 pairs total. Sampling was done *before* any scoring.
- **Rubric (3-point):** 2 = a reader who set out to find Y would have been
  substantially served by X **and** vice versa; 1 = only one direction, or both
  partial; 0 = neither.
- **Raters:** two independent passes (see §6 for exactly what they were);
  disagreements adjudicated with a stated rule; Cohen's κ reported on the
  pre-adjudication labels.

## 3. The 8 events and per-event counts

| # | Category | Event | Date | Independent artifacts in 14d (verified) | Probable extra* | Median lag (days) | Adjudicated overlap (pairs=2 / sampled) |
|---|---|---|---|---|---|---|---|
| E1 | Protocol/product launch | Tempo mainnet + Machine Payments Protocol (Stripe/Paradigm) | 2026-03-18 | **10** | +1 | 0 | 1/5 |
| E2 | Protocol/product launch | Aave V4 live on Ethereum mainnet | 2026-03-30 | **10** | 0 | 0 | 1/5 |
| E3 | Model release | OpenAI GPT-5.5 | 2026-04-23 | **7** fetched (+2 date-in-URL: TechCrunch, Fortune) | +3 | 1 | 4/5 |
| E4 | Exploit/outage | KelpDAO rsETH bridge exploit (~$292M) | 2026-04-18 | **14** (capped; more exist) | +3 | 2 | 0/5 |
| E5 | Framework major version | TypeScript 7.0 stable (native Go compiler) | 2026-07-08 | **8** fetched (+1 date-in-URL: VS Magazine) | +2 | 2.5 | 2/5 |
| E6 | Regulatory/policy | EU Digital Omnibus on AI — provisional trilogue agreement | 2026-05-07 | **5** | +6 (paywalled/403, dates unconfirmed) | 0 | 5/5 |
| E7 | Hackathon/grant prize drop | ETHGlobal New York 2026 prize list ($225K+ / 17 sponsor tracks) | 2026-06-06† | **2** | +1 | 0 | 1/1 |
| E8 | Airdrop criteria | MegaETH Terminal Season 1 (2.5% of MEGA, points rules, KYC) | 2026-04-28 | **4** | +2 | 5.5 | 1/5 |

\* Candidates whose date is only known from a URL/title or that returned
403/402/timeout on fetch; not counted, not sampled.
† Prize page carries no publication date; the first third-party coverage
(2026-06-06) is used as the event date, so E7's lag is 0 by construction.

**Event sources (artifacts counted; the event's own announcement is not counted):**

- E1 Tempo — CoinDesk (Sandor), The Block (Danga), Ledger Insights, The Defiant,
  Bankless news (Inabinet), crypto.news (Folkler), MEXC Blog, Our Crypto Talk,
  Bankless analysis (Christopher, +6d), BlockBeats via KuCoin. Probable: Finextra.
- E2 Aave V4 — CoinDesk (Nijkerk), The Block (Kuhn), The Defiant, DL News
  (Gilbert), CoinCentral, Bitcoin.com News, crypto.news (via Bitget, +2d),
  COINTURK (+7d), Fibo Crypto (+1d), Coinpedia.
- E3 GPT-5.5 — Appwrite, BuildFastWithAI, MPG ONE, Digital Applied, JQ AI
  Systems, Nipralo, Simon Willison (newsletter), TechCrunch, Fortune. Probable:
  NLPlanet (Medium), eWeek, MarketingProfs.
- E4 Kelp — Hypernative, OpenZeppelin, CoinDesk (Sandor), DeFiprime, Chainalysis,
  Blockaid, Safeheron, QuillAudits, Tomas (Substack), Cryptocurrency Help,
  AMBCrypto, CoinDesk (Nijkerk), KuCoin Blog, Zengineer via TechFlow. Probable:
  Messari, Halborn, The Crypto Times.
- E5 TypeScript 7 — InfoWorld, Digital Applied, Developers Digest, TypeScript
  Book (gibbok), nafiskabbo gist, Coding Dunia, sudosecurity, Origami, Visual
  Studio Magazine. Probable: two Medium posts (July, day unconfirmed). **Out of
  window:** InfoQ, daily.dev, dev.to, PAS7, eCorpIT, ortamarco (days 20–37) and
  webhani, byteiota, Tech Insider (pre-release, RC period).
- E6 Omnibus — NicFab, Dastra, Timelex (all day 0), White & Case (via JDSupra,
  +8d), Praxikon (+8d). Unconfirmed date: Bird & Bird, HLC, Winston Taylor, IEU
  Monitoring, CDT bulletin, Lexology reposts. **Out of window:** Gibson Dunn
  (+20d), Mishcon (+21d), Covington (+21d), Dawiso (+28d), A&O Shearman (+29d),
  DLA Piper (+54d), CSA (+86d).
- E7 ETHGlobal NYC — Crypto Briefing, Value The Markets (both 06-06). Probable:
  KuCoin flash. Excluded as listings, not synthesis: Eventbrite, Arc House,
  Everstake events, Coinpedia events, GarysGuide, happeningnext,
  infosec-conferences, forkoff.xyz (an agency page about 2027). Excluded as
  sponsor material: Dynamic docs, ETHGlobal/sponsor X posts.
- E8 MegaETH — PlayToEarn (day 0), OpenSea Digest (+3d), BlockchainReporter
  guide (+8d; syndicated ×4), airdrops.io guide (+10d). Probable: AirdropAlert
  (undated), PVMihalache on Medium (May, 403).

## 4. The four metrics

| Metric | Bar | Measured | Verdict |
|---|---|---|---|
| **Convergence count** (median independent artifacts / event) | ≥ 5 | **7.5** verified (≈10 if probable candidates are included). Per-event: 10, 10, 7, 14, 8, 5, **2**, **4** | Passes on the median; **fails in 2 of 8 categories** (hackathon prize, airdrop criteria) and E6 sits exactly on the bar |
| **Overlap fraction** (share of uniformly sampled pairs scored 2) | ≥ 50% | Rater A **47.2%** (17/36) · Rater B **33.3%** (12/36) · **Adjudicated 41.7%** (15/36). Pair-bootstrap 95% CI on adjudicated: 25–58%; event-cluster bootstrap: 19–68% | **Fails** on every reading. No pair scored 0; 21/36 scored 1 (same facts, different depth) |
| **Window** (days from event to median artifact) | sets half-life | Per-event medians 0, 0, 1, 2, 2.5, 0, 0, 5.5 → **median 0.5 days, mean 1.4 days**. Second waves exist outside 14d (law-firm alerts at 20–29d; TS7 retrospectives at 20–37d) | Supply is front-loaded: half the free substitutes exist within ~1 day of the event |
| **Cohen's κ** (rater agreement, pre-adjudication) | ≥ 0.6 | **0.26** (p_o = 0.64, p_e = 0.51; linear- and quadratic-weighted κ also 0.26 because no rater used 0) | **Fails** — by the plan's own rule the labels are noise |

Per-event adjudicated overlap: E1 0.20, E2 0.20, E3 0.80, E4 0.00, E5 0.40,
E6 1.00, E7 1.00 (one pair), E8 0.20. Overlap is high only where the artifact
type is homogeneous (model-review posts; law-firm alerts; two near-identical
event write-ups). It collapses wherever briefs and deep-dives coexist, which is
the normal case.

### What the 13 disagreements were about

Every disagreement (pairs 1, 2, 6, 9, 10, 15, 18, 24, 25, 28, 33, 34, 36) is a
depth-asymmetry case: both artifacts state the same core facts, one is 3–10×
longer. Rater A tended to give 2 when the core was shared; Rater B gave 1
whenever "a substantial part of one is missing from the other". Adjudication
rule applied: 2 only if the *shorter* artifact would still satisfy a reader who
wanted the longer one — i.e. both directions, as the rubric says. That is why the
adjudicated number (42%) sits between the two raters. Under the most lenient
reading in the data (Rater A, 47%) the bar is still not met.

## 5. The precision bar, derived

Let `p` be the artifact price, `c` the cost of redoing the research, and
`P(useful)` the probability the purchased artifact actually answers the buyer's
question. Buying has non-negative expected value when

```
P(useful) · c − p ≥ 0   ⇔   P(useful) ≥ p / c
```

At the shipped `p = 0.10c`, **break-even is P(useful) ≥ 10%**. A comfortable
operating target needs headroom for (a) the buyer's verification cost `v` of
reading an artifact that turns out useless, (b) risk aversion, and (c) partial
usefulness: a "useful" artifact saves only a fraction `f` of `c`. With those,
`P(useful) · f · c ≥ p + v`; at `f ≈ 0.5` and `v ≈ 0.05c` that is
`P(useful) ≥ (0.10 + 0.05) / 0.5 = 30%`. **Operating target ≈ 30%.** This replaces the
earlier underived "precision@1 ≥ 70%".

> **The price fraction, resolved.** This section read `p ≈ 0.15c` until
> `docs/AUDIT-CLAIMS.md` M4 — the repo shipped 0.15 in `carpool_publish`'s price
> rule and 0.10 in the A/B runner, both as the default. It is now **0.10**
> everywhere, in one constant (`PRICE_SHARE_OF_REDO_COST`,
> `packages/carpool-core/src/pricing.ts`), which is also where the reasoning and
> the case against 0.15 are written down, and the buyer's default spend cap is
> derived from it. Every bar in this section is a function of that constant, so
> the old readings are recorded here rather than deleted: at 0.15 break-even was
> 15%, the operating target 40%, and the precision@1 bars 95% / 36% / 61%. The
> derivation itself did not change — only its one policy input.

**Tying it to this measurement.** `P(useful) = precision@1 × P(substitutable |
same event)`. Phase 0 measured the second factor: **0.42** for a full
substitute (score 2), range 0.33–0.47 across raters. Consequences:

- Even with **perfect** retrieval, P(full substitute) ≈ 0.42 — above the 30%
  operating target, but with a factor of only 1.4 to spare.
- To hold the 30% target with full substitutes requires precision@1 ≥ 0.30/0.42
  ≈ **71%**. To hold break-even (10%) requires precision@1 ≥ **24%**.
  (At 0.15 those bars were 95% and 36%: the 95% is the number that made the
  higher share untenable, since it asks for near-perfect retrieval over
  open-domain research questions and nothing has measured it.)
- Giving partial credit for score-1 pairs (they save some fraction `f` of `c`):
  P(useful-weighted) = 0.42 + 0.58·f. At f = 0.4 that is 0.65, and the 30%
  target then needs precision@1 ≥ **46%**.

So the economics need retrieval at **71%** precision@1 on full substitutes, or
**46%** if partial answers are worth 40% of a redo. Neither is established — this
repo has measured no real precision@1 at all (`pnpm bench`'s 1.000 is a synthetic
corpus with no topically-close wrong answer in it, and says so in its own banner)
— but both are bars retrieval systems reach, which the 95% the higher price
fraction demanded is not. That asymmetry is the substance of the M4 decision.

## 6. Limitations — read before quoting any number

1. **Raters are not two humans, and not two independent readings.** Rater A is
   the agent that ran this test (Claude, Fable 5.1), scoring each pair from
   structured five-bullet summaries of both artifacts. Rater B is the small
   model behind the WebFetch tool, given one artifact of the pair *in full* plus
   Rater A's neutral summary of the other, with the same rubric. The summaries
   were produced by a fixed prompt before pairs were sampled, so they are not
   biased toward the pairs — but Rater B's view of the second artifact is
   mediated by Rater A. This is weaker than the plan's "two different models"
   and much weaker than two humans. **κ = 0.26 means the overlap fraction is
   not a certified number; it is a point estimate from noisy labels.** The
   stop rule is applied to the measurement as taken, and every reading of it is
   below 50%, but a reader should treat the true value as somewhere in roughly
   25–60%, not as "42%".
2. **n = 36 pairs.** The 95% interval on the overlap fraction includes 50%.
   The result is "not shown to pass", not "shown to fail with high confidence".
   The plan's stop rule does not ask for a confidence interval; it asks whether
   the measurement clears the bar. It does not.
3. **Counts are lower bounds** capped by search recall and fetch failures
   (paywalls, 403s). Kelp was capped at 14; large events would count higher.
   Small events (E7, E8) were searched with the same effort and did not grow.
4. **Event-date choice matters.** For E7 the prize page carries no date; the
   first third-party coverage was used, which forces lag 0. For E5 an RC on
   2026-06-18 pulled many migration guides *before* GA and many retrospectives
   *after* day 14; the 14-day window sees the middle of a longer curve. For E6
   the bulk of law-firm analysis arrived at days 20–29, outside the window.
5. **Category-level failures are hidden by the median.** The two categories the
   product narrative leans on hardest — "a prize list drops" and "eligibility
   criteria change" — produced 2 and 4 public artifacts. Either those people
   research privately (the market's hope) or they don't research much (the
   market's problem). This test cannot tell which; nothing here shows they exist
   as buyers.
6. **Supply ≠ demand.** This measured free substitutes. Every counted artifact
   is free and, for the news-brief majority, published within a day. A paid
   artifact competes with them.
7. **Same-outlet authors counted as independent** (two CoinDesk pieces in E4,
   two Bankless pieces in E1). Collapsing them changes E1 to 9 and E4 to 13;
   the median is unchanged.

## 7. Recommendation against the stop rule

**Stop rule:** if convergence < 5 **or** overlap < 50% → STOP.

- Convergence = 7.5 (≥ 5) — passes, with two category failures.
- Overlap = 42% adjudicated, 33–47% by rater (< 50%) — **fails**.
- κ = 0.26 (< 0.6) — labels are noise; the overlap number cannot be promoted
  above the bar by any re-reading of the data.

**Recommendation: STOP.** Publish this as the negative result. Phases C onward
do not begin on the current premise.

What would change the answer — none of these is the current plan:
- A rubric that treats score-1 ("same facts, different depth") as a sale.
  That is a different product: selling the *deep* version to people who found
  the brief one. The data say that is where the overlap is (21 of 36 pairs).
- A demand-side measurement showing people pay for depth they already know
  exists for free.
- A two-human re-rating of the same 36 pairs with κ ≥ 0.6 landing above 50%.
  The interval allows it; the point estimate does not predict it.

## 8. Reproducibility

Event list, artifact URLs, dates, types, lengths, the seed, the 36 sampled
pairs, both raters' raw scores and the adjudicated scores are committed in
[`docs/evidence/phase0-rater-data.md`](evidence/phase0-rater-data.md) — §1 the
events, §2 the artifact tables with URLs, dates, types and word counts, §4 the
seed and the sampling procedure, §6 the 36 pairs with all three score columns.
Every figure on this page recomputes from that §6 table:

```
python3 docs/evidence/recompute-phase0.py
```

No corpus of questions was created or committed; only URLs and numbers.

**This section used to cite `.superpowers/sdd/RESTRUCTURE/task-0-report.md`.**
That path is gitignored (`.superpowers/sdd/.gitignore` is `*`, and `git ls-files
.superpowers` returns nothing), so the section titled Reproducibility pointed at
the one file no clone of this repo can contain — which is the exact defect commit
`b99e22a` existed to fix, left standing in the section most responsible for
fixing it. Everything that sentence listed is in the committed evidence file, so
the citation was unfollowable *and* unnecessary. The session-local scratch files
(`artifacts.json`, `pairs.json`, `raterA.json`, `raterB.json`,
`adjudicated.json`) were never committed and are gone; §6's table is the record.
