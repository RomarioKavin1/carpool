<!--
Committed evidence for docs/PHASE0.md. This file was previously only in
.superpowers/sdd/RESTRUCTURE/, whose .gitignore is `*` — so PHASE0 cited a STOP
verdict against rater data that no clone of this repo contained. The numbers were
genuine and reproducible on the machine that ran them; they were not auditable by
anybody else, which is the same condition that let the fabricated A/B numbers
stand (see the correction box in docs/AB-MEASUREMENT.md).

Every published Phase 0 statistic recomputes from section 6's 36-pair table:
  Cohen's kappa   0.2642 -> 0.26   (p_o 0.6389 -> 0.64, p_e 0.5093 -> 0.51)
  overlap         A 17/36 = 0.472 · B 12/36 = 0.333 · adjudicated 15/36 = 0.417
  disagreements   13 · scored 0: none · scored 1: 21/36
  per-event       E1 .20 E2 .20 E3 .80 E4 .00 E5 .40 E6 1.00 E7 1.00 E8 .20
Recompute with: docs/evidence/recompute-phase0.py

Still NOT committed, and stated here rather than implied: the session-local
scratch files (artifacts.json, pairs.json, raterA.json, raterB.json,
adjudicated.json). Section 6's table is the record; those files are gone.
-->

# Task 0 working notes — convergence kill test
Run 2026-09-12 (JST). Tools: WebSearch + WebFetch only. No subagents, no git, no source touched.
Deliverable: docs/PHASE0.md. This file holds the raw material behind its numbers.

## 1. Event selection
Categories required by the brief → chosen event (all inside the last 6 months):

| Category | Event | Date | Why this one |
|---|---|---|---|
| Hackathon/grant prize | ETHGlobal New York 2026 prize list | 2026-06-06 (first coverage; prize page undated) | Largest ETHGlobal event in window; $225K+/17 sponsor tracks |
| Launch A | Tempo mainnet + Machine Payments Protocol | 2026-03-18 | Stripe/Paradigm L1; directly relevant to an agent-payments product |
| Launch B | Aave V4 on Ethereum mainnet | 2026-03-30 | Largest DeFi protocol's first full rework since V1 |
| Model release | GPT-5.5 | 2026-04-23 | Flagship release; chosen over Claude Opus 5 (2026-07-24) to avoid self-reference |
| Exploit/outage | KelpDAO rsETH bridge exploit | 2026-04-18 | Largest exploit of 2026 (~$292M) |
| Framework major | TypeScript 7.0 stable | 2026-07-08 | Native Go compiler; ecosystem-breaking (no compiler API) |
| Regulatory | EU Digital Omnibus on AI — provisional trilogue agreement | 2026-05-07 | Moved the AI Act high-risk deadline; heavy legal-alert coverage |
| Airdrop criteria | MegaETH Terminal Season 1 rules | 2026-04-28 | Only airdrop-criteria event in window with a firm date and a real allocation (2.5% MEGA) |
Rejected/considered: Claude Opus 5 (self-reference), Angular 22 (2026-06-03; TS7 was the bigger break), FinCEN/OFAC GENIUS NPRM (2026-04-08; Omnibus had a cleaner single date), Drift exploit (2026-04-01; Kelp larger), Solana Alpenglow (activates 2026-09-28, future), MetaMask/Polymarket/Base airdrops (no official criteria published), Cloudflare/GCP outages (smaller synthesis footprint than Kelp).

## 2. Artifact tables (verified in-window, fetched)
Date marked * = not printed on page; inferred from content (launch-day references). Word counts are the fetch model's estimates.

### E1 — Tempo mainnet + MPP (2026-03-18)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| T1 | CoinDesk / K. Sandor | 2026-03-18 | 0 | brief | 650 | https://www.coindesk.com/tech/2026/03/18/stripe-led-payments-blockchain-tempo-goes-live-with-protocol-for-ai-agents |
| T2 | The Block / B. Danga | 2026-03-18 | 0 | brief | 650 | https://www.theblock.co/post/394131/tempo-mainnet-goes-live-with-machine-payments-protocol-for-agents |
| T3 | Ledger Insights / staff | 2026-03-20 | 2 | brief+analysis (paywalled) | 280 | https://www.ledgerinsights.com/stripe-paradigm-launch-tempo-blockchain-alongside-machine-payments-standard/ |
| T4 | The Defiant / DefAInt | 2026-03-18 | 0 | brief | 450 | https://thedefiant.io/news/blockchains/tempo-launches-mainnet-unveils-machine-payments-protocol-with-stripe |
| T5 | Bankless news / J. Inabinet | 2026-03-18 | 0 | brief | 320 | https://www.bankless.com/read/news/stripe-deploys-tempo-blockchain-to-mainnet-introduces-machine-payments-protocol |
| T6 | crypto.news / A. Folkler | 2026-03-18 | 0 | brief w/ context | 1100 | https://crypto.news/stripe-and-paradigms-tempo-mainnet-goes-live-for-machine-payments/ |
| T7 | MEXC Blog / Shaunt | 2026-03-19 | 1 | deep-dive | 3800 | https://blog.mexc.com/news/tempo-mainnet-launch-machine-payments-protocol-unlocks-ai-powered-crypto-transactions-and-autonomous-commerce-in-2026/ |
| T8 | Our Crypto Talk / S. Thakur | 2026-03-19 | 1 | deep-dive | 2400 | https://ourcryptotalk.com/news/tempo-mainnet-live-on-stripe-machine-payments-protocol |
| T9 | Bankless analysis / D. Christopher | 2026-03-24 | 6 | deep-dive (critical) | 1800 | https://www.bankless.com/read/stripes-tempo-makes-its-case |
| T10 | BlockBeats via KuCoin Flash | 2026-03-18 | 0 | brief | 180 | https://www.kucoin.com/news/flash/tempo-launches-mainnet-and-machine-payment-protocol-mpp |

### E2 — Aave V4 on Ethereum mainnet (2026-03-30)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| A1 | CoinDesk / M. Nijkerk | 2026-03-30 | 0 | brief | 520 | https://www.coindesk.com/tech/2026/03/30/aave-rolls-out-v4-on-ethereum-aiming-to-expand-defi-into-real-world-credit-markets |
| A2 | The Block / D. Kuhn | 2026-03-30 | 0 | deep-dive (interview) | 1850 | https://www.theblock.co/post/395617/aave-v4-launches-ethereum-mainnet |
| A3 | The Defiant / yyctrader | 2026-03-30* | 0 | brief | 520 | https://thedefiant.io/news/defi/aave-v4-launches-on-ethereum-mainnet |
| A4 | DL News / A. Gilbert | 2026-03-30 | 0 | brief | 850 | https://www.dlnews.com/articles/defi/aave-launches-v4-on-ethereum/ |
| A5 | CoinCentral / Y. Werner | 2026-03-30 | 0 | brief/explainer | 490 | https://coincentral.com/aave-v4-launches-on-ethereum-with-new-hub-and-spoke-model/ |
| A6 | Bitcoin.com News / J. Redman | 2026-03-30 | 0 | explainer | 650 | https://news.bitcoin.com/aave-v4-launch-explained-hub-and-spoke-model-new-partners-and-what-changes-for-borrowers/ |
| A7 | crypto.news (via Bitget) | 2026-04-01 | 2 | brief | 850 | https://www.bitget.com/news/detail/12560605327202 |
| A8 | COINTURK / I. Peker | 2026-04-06 | 7 | explainer | 850 | https://en.coin-turk.com/aave-v4-introduces-hub-and-spoke-architecture-for-flexible-defi-liquidity-management/ |
| A9 | Fibo Crypto / Victor | 2026-03-31 | 1 | explainer/deep-dive | 2100 | https://fibo-crypto.fr/en/blog/aave-v4-mainnet-ethereum-hub-spoke-defi-2026/ |
| A10 | Coinpedia / R. Ansari | 2026-03-30 | 0 | news | 700 | https://coinpedia.org/news/aave-v4-goes-live-on-ethereum-mainnet-with-new-lending-architecture/ |

### E3 — GPT-5.5 release (2026-04-23)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| G1 | Appwrite / A. Deosthale | 2026-04-24 | 1 | deep-dive | 1800 | https://appwrite.io/blog/post/gpt-5-5-launch |
| G2 | BuildFastWithAI | 2026-04-24 | 1 | deep-dive | 3800 | https://www.buildfastwithai.com/blogs/gpt-5-5-review-2026 |
| G3 | MPG ONE / V. Morelli | 2026-04-23 | 0 | explainer | 2100 | https://mpgone.com/gpt-5-5-openai/ |
| G4 | Digital Applied | 2026-04-23 | 0 | deep-dive | 4200 | https://www.digitalapplied.com/blog/gpt-5-5-complete-guide-thinking-pro-1m-context |
| G5 | JQ AI Systems / J. Queiros | 2026-04-25 | 2 | deep-dive | 2400 | https://www.ai.joaoqueiros.com/blog/gpt-5-5-review-benchmarks-pricing |
| G6 | Nipralo | 2026-04-27 | 4 | deep-dive | 3200 | https://www.nipralo.com/blogs/gpt-5-5-review-2026 |
| G7 | Simon Willison newsletter (Apr digest) | 2026-04-24 | 1 | blog digest | 350 | https://github.com/simonw/monthly-newsletter-archive/blob/main/2026-04-april.md |

### E4 — KelpDAO rsETH bridge exploit (2026-04-18)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| K1 | Hypernative | 2026-04-20 | 2 | deep-dive | 3200 | https://www.hypernative.io/insights/blog/the-kelpdao-observation-layer-exploit-291m-released-on-a-message-that-never-existed |
| K2 | OpenZeppelin / J. Vora | 2026-04-23 | 5 | deep-dive | 2800 | https://www.openzeppelin.com/news/lessons-from-kelpdao-hack |
| K3 | CoinDesk / K. Sandor | 2026-04-19 | 1 | deep-dive news | 1100 | https://www.coindesk.com/business/2026/04/19/the-usd292-million-kelp-exploit-how-it-happened-and-what-it-means-for-defi |
| K4 | DeFiprime / N. Sawinyh | 2026-04-18 | 0 | deep-dive | 4200 | https://defiprime.com/kelpdao-rseth-exploit |
| K5 | Chainalysis | 2026-04-23 | 5 | deep-dive | 2400 | https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/ |
| K6 | Blockaid | 2026-04-19 | 1 | deep-dive | 3200 | https://blockaid.io/blog/how-a-single-layerzero-dvn-compromise-drained-292m-from-kelpdao |
| K7 | Safeheron | 2026-04-20 | 2 | deep-dive (treasury angle) | 3100 | https://safeheron.com/blog/kelp-exploit-post-mortem/ |
| K8 | QuillAudits / Anmol | 2026-04-20 | 2 | deep-dive | 2400 | https://www.quillaudits.com/blog/hack-analysis/kelp-dao-hack |
| K9 | Tomas Substack | 2026-04-24 | 6 | opinion/deep-dive | 3600 | https://silhuzz.substack.com/p/defis-cypherpunk-larp |
| K10 | Cryptocurrency Help / A. Sood | 2026-04-20 | 2 | explainer | 1100 | https://cryptocurrencyhelp.com/news/kelp-dao-hack-292m-stolen/ |
| K11 | AMBCrypto / I. Kumari | 2026-04-19 | 1 | brief | 509 | https://ambcrypto.com/biggest-defi-hack-of-2026-294mln-kelpdao-exploit-hits-20-chains/ |
| K12 | CoinDesk / M. Nijkerk | 2026-04-22 | 4 | explainer (bridges) | 1100 | https://www.coindesk.com/tech/2026/04/21/the-usd292-million-kelp-dao-exploit-shows-why-crypto-bridges-are-still-one-of-the-industry-s-weakest-links |
| K13 | KuCoin Blog | 2026-04-28 | 10 | deep-dive | 2800 | https://www.kucoin.com/blog/kelpdao-hack-2026-rseth-exploit-analysis |
| K14 | Zengineer via TechFlow | 2026-04-20 | 2 | deep-dive (AI-audit angle) | 3200 | https://www.techflowpost.com/en-US/article/31202 |

### E5 — TypeScript 7.0 stable (2026-07-08)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| S1 | InfoWorld / P. Krill | 2026-07-13 | 5 | brief | 320 | https://www.infoworld.com/article/4196378/go-based-typescript-7-0-arrives.html |
| S2 | Digital Applied | 2026-07-16 | 8 | deep-dive (readiness) | 3200 | https://www.digitalapplied.com/blog/typescript-7-native-compiler-early-adopter-migration-readiness |
| S3 | Developers Digest | 2026-07-12 | 4 | how-to/deep-dive | 2100 | https://www.developersdigest.tech/blog/typescript-7-native-compiler-migration-guide |
| S4 | TypeScript Book (gibbok) | 2026-07-08 | 0 | announcement summary | 200 | https://gibbok.github.io/typescript-book/typescript-news/2026/typescript-7-released/ |
| S5 | GitHub gist / nafiskabbo | 2026-07-08 | 0 | how-to | 2100 | https://gist.github.com/nafiskabbo/01ccb4970515413076f3759486c39755 |
| S6 | Coding Dunia / M. Bennett | 2026-07-11 | 3 | how-to/deep-dive | 3800 | https://codingdunia.com/blog/typescript-7-migration-guide/ |
| S7 | sudosecurity / Landen | 2026-07-10 | 2 | analysis | 650 | https://sudosecurity.org/typescript-7-0-official-release/ |
| S8 | Origami | 2026-07-09 | 1 | blog | 1100 | https://origami.sa/en/blog/typescript-7-go-native-compiler-10x-faster/ |

### E6 — EU Digital Omnibus on AI provisional agreement (2026-05-07)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| R1 | NicFab / N. Fabiano | 2026-05-07 | 0 | deep-dive | 2800 | https://www.nicfab.eu/en/posts/digital-omnibus-ai-deal/ |
| R2 | Dastra / L. Sayssa | 2026-05-07 | 0 | explainer | 2100 | https://www.dastra.eu/en/blog/simpler-safer-stricter-where-it-counts-inside-the-eu-ai-omnibus-deal/60025 |
| R3 | Timelex / Torfs & Cools | 2026-05-07 | 0 | deep-dive | 1400 | https://www.timelex.eu/en/blog/ai-omnibus-deal-what-survived-trilogue |
| R4 | White & Case / Hickman & Mair (via JDSupra) | 2026-05-15 | 8 | legal analysis | 1100 | https://www.jdsupra.com/legalnews/eu-agrees-digital-omnibus-deal-to-4275721/ |
| R5 | Praxikon / Z. Ashkara | 2026-05-15 | 8 | analysis | 2100 | https://www.praxikon.com/en/posts/digital-omnibus-ai-act-may-2026-status-political-agreement |

### E7 — ETHGlobal New York 2026 prize list (2026-06-06)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| H1 | Crypto Briefing / editorial | 2026-06-06 | 0 | news | 550 | https://cryptobriefing.com/ethglobal-nyc-hackathon-june-2026/ |
| H2 | Value The Markets / P. Miller | 2026-06-06 | 0 | news | 550 | https://www.valuethemarkets.com/cryptocurrency/news/ethglobal-hackathon-2026-set-to-energize-new-york-developers |

### E8 — MegaETH Terminal Season 1 (airdrop criteria) (2026-04-28)
| id | outlet / author | date | lag | type | ~words | url |
|---|---|---|---|---|---|---|
| M1 | PlayToEarn / Thomas | 2026-04-28 | 0 | news | 2200 | https://playtoearn.com/news/megaeth-launches-terminal-points-platform-as-season-1-kicks-off-ahead-of-april-30-mega-tge |
| M2 | OpenSea Digest | 2026-05-01 | 3 | newsletter section | 280 | https://opensea.io/blog/articles/opensea-digest-april-30-2026 |
| M3 | BlockchainReporter (syndicated to Bitget/MEXC/cryptonews.net) | 2026-05-06 | 8 | guide | 2200 | https://www.bitget.com/news/detail/12560605398834 |
| M4 | airdrops.io blog | 2026-05-08 | 10 | guide | 3400 | https://airdrops.io/blog/the-complete-megaeth-airdrop-farming-guide-2026/ |

### Candidates seen but NOT counted (with reason)
- E1: Finextra (403, date unconfirmed); Everstake explainer (2026-07-22, out of window); tempo.xyz blog (official); CryptoRank pre-launch piece.
- E2: Aave blog (official); jamesbachini.com (522, undated); MEXC news 994249 (410); eco.com support doc (undated); The Crypto Times 04-18 (+19d); KuCoin flash (repost, unfetched); TradingView copy of Coinpedia (syndication).
- E3: openai.com (official); Wikipedia (living doc); NLPlanet Medium 04-27, eWeek 04-24, MarketingProfs 04-24 (403; dates from URL/title → "probable"); WaveSpeed ×2 (undated).
- E4: LayerZero statement, Kelp statements (parties); Messari (403), Halborn (429), The Crypto Times (timeout), The Block 04-20 (unfetched) → probable; capped at 14.
- E5: devblogs.microsoft.com (official); Visual Studio Magazine 07-08 (403; date in URL → counted as verified-by-URL, not sampled); Medium ×2 "Jul 2026" (403, day unknown → probable); InfoQ 08-03, daily.dev 08-03, dev.to 08-03, PAS7 07-31, eCorpIT 07-28, ortamarco 08-14 (out of window, late); webhani 06-10, byteiota 06-03, Tech Insider RC piece, Digital Applied RC piece (pre-GA).
- E6: Consilium press release (official); Bird & Bird ×2 (402), HLC, Winston Taylor, IEU Monitoring, CDT (403), Lexology ×2 (fetch failed) → dates unconfirmed; Gibson Dunn 05-27, Mishcon 05-28, Covington 05-28, Dawiso 06-04, A&O 06-05, DLA 06-30, CSA 08-01 (out of window); Holland & Knight (April, pre-event).
- E7: ETHGlobal event/prize pages and sponsor X posts (official/sponsor); Dynamic docs (sponsor, 404); Eventbrite, Arc House, Everstake events, Coinpedia events, GarysGuide, happeningnext, infosec-conferences (calendar listings, not synthesis); forkoff.xyz (agency sales page about ETHNYC 2027); KuCoin flash (fetch returned empty twice → probable).
- E8: medium.com/@megaeth (official, 403); AirdropAlert (undated, status "closed"); coinlaunch.space (403); cryptorank drophunting (403); PVMihalache Medium (403, "May 2026"); BingX guide (2025, pre-event); coingabbar (June, +43d); Bitget/MEXC/cryptonews.net/CryptoWorldHeadline copies of the BlockchainReporter guide (syndication → 1).

## 3. Counts, lags
- E1: n=10 lags=[0, 0, 0, 0, 0, 0, 1, 1, 2, 6] median lag=0.0
- E2: n=10 lags=[0, 0, 0, 0, 0, 0, 0, 1, 2, 7] median lag=0.0
- E3: n=7 lags=[0, 0, 1, 1, 1, 2, 4] median lag=1
- E4: n=14 lags=[0, 1, 1, 1, 2, 2, 2, 2, 2, 4, 5, 5, 6, 10] median lag=2.0
- E5: n=8 lags=[0, 0, 1, 2, 3, 4, 5, 8] median lag=2.5
- E6: n=5 lags=[0, 0, 0, 8, 8] median lag=0
- E7: n=2 lags=[0, 0] median lag=0.0
- E8: n=4 lags=[0, 3, 8, 10] median lag=5.5
- counts=[10, 10, 7, 14, 8, 5, 2, 4] → median 7.5; with URL-dated (+2 E3, +1 E5) → median 9.0; with probable → ≈10
- per-event median lags [0, 0, 1, 2, 2.5, 0, 0, 5.5] → median of medians 0.5, mean 1.38

## 4. Pair sampling
Seed `random.Random(20260912)`; per event `rng.sample(all_pairs, min(5, len(all_pairs)))` iterating events E1..E8 in order. 36 pairs.

## 5. Rubric and raters
Rubric given to both raters verbatim: 2 = a reader who set out to find Y would have had their need substantially met by X, AND a reader who set out to find X would have been substantially met by Y. 1 = only one direction holds, or both hold only partially (core facts shared but a substantial part of one is missing from the other). 0 = neither would serve the other.

- Rater A = this agent (Claude, Fable 5.1), scoring from the five-bullet neutral summaries of both artifacts (summaries produced by a fixed prompt during verification, before sampling). Scores were written to raterA.json and time-stamped (02:34 JST) before Rater B ran.
- Rater B = the WebFetch tool's small model: fetched artifact X of the pair in full, was given Rater A's neutral summary of Y (type, length, five facts) and the rubric, and returned SCORE=<0|1|2> plus one sentence. Rater B never saw Rater A's scores.
- Adjudication rule (applied by the author to the 13 disagreements): 2 only if the shorter artifact would still satisfy a reader who wanted the longer one, i.e. both directions genuinely hold; a >3× length gap with material missing → 1.

## 6. Pair scores
| # | event | X | Y | A | B | adj | note |
|---|---|---|---|---|---|---|---|
| 1 | E1 | T1 | T5 | 2 | 1 | 2 | two briefs; B docked for Stripe-expansion context → adj 2 (both cover launch) |
| 2 | E1 | T8 | T10 | 1 | 2 | 1 | 180w flash vs 2400w deep-dive; B said 2 → adj 1 |
| 3 | E1 | T4 | T8 | 1 | 1 | 1 |  |
| 4 | E1 | T2 | T7 | 1 | 1 | 1 |  |
| 5 | E1 | T1 | T9 | 1 | 1 | 1 |  |
| 6 | E2 | A1 | A3 | 2 | 1 | 2 | two briefs; B docked for governance detail → adj 2 |
| 7 | E2 | A7 | A8 | 1 | 1 | 1 |  |
| 8 | E2 | A9 | A10 | 1 | 1 | 1 |  |
| 9 | E2 | A6 | A8 | 2 | 1 | 1 | launch explainer vs mechanics explainer → adj 1 |
| 10 | E2 | A8 | A10 | 1 | 2 | 1 | B said 2; news vs mechanics → adj 1 |
| 11 | E3 | G5 | G7 | 1 | 1 | 1 |  |
| 12 | E3 | G4 | G5 | 2 | 2 | 2 |  |
| 13 | E3 | G1 | G4 | 2 | 2 | 2 |  |
| 14 | E3 | G2 | G3 | 2 | 2 | 2 |  |
| 15 | E3 | G5 | G6 | 2 | 1 | 2 | two full reviews; different extra benchmarks → adj 2 |
| 16 | E4 | K6 | K14 | 1 | 1 | 1 |  |
| 17 | E4 | K6 | K9 | 1 | 1 | 1 |  |
| 18 | E4 | K8 | K10 | 1 | 2 | 1 | B said 2; 2400w tx-level post-mortem vs 1100w explainer → adj 1 |
| 19 | E4 | K12 | K13 | 1 | 1 | 1 |  |
| 20 | E4 | K8 | K11 | 1 | 1 | 1 |  |
| 21 | E5 | S1 | S3 | 1 | 1 | 1 |  |
| 22 | E5 | S4 | S8 | 1 | 1 | 1 |  |
| 23 | E5 | S4 | S5 | 1 | 1 | 1 |  |
| 24 | E5 | S1 | S4 | 2 | 1 | 2 | two ~300w announcement summaries → adj 2 |
| 25 | E5 | S2 | S6 | 2 | 1 | 2 | two migration-readiness pieces → adj 2 |
| 26 | E6 | R3 | R5 | 2 | 2 | 2 |  |
| 27 | E6 | R3 | R4 | 2 | 2 | 2 |  |
| 28 | E6 | R1 | R2 | 2 | 1 | 2 | two day-0 deal explainers → adj 2 |
| 29 | E6 | R1 | R5 | 2 | 2 | 2 |  |
| 30 | E6 | R2 | R3 | 2 | 2 | 2 |  |
| 31 | E7 | H1 | H2 | 2 | 2 | 2 |  |
| 32 | E8 | M2 | M3 | 1 | 1 | 1 |  |
| 33 | E8 | M3 | M4 | 2 | 1 | 2 | two farming guides → adj 2 |
| 34 | E8 | M1 | M2 | 1 | 2 | 1 | B said 2; 280w digest vs 2200w news → adj 1 |
| 35 | E8 | M2 | M4 | 1 | 1 | 1 |  |
| 36 | E8 | M1 | M4 | 2 | 1 | 1 | news vs how-to guide → adj 1 |

## 7. Metrics
- p_o = 0.639, p_e = 0.509, **Cohen's κ = 0.264** (linear/quadratic weighted also 0.264; no 0s used).
- Overlap: A 17/36 = 0.472 · B 12/36 = 0.333 · adjudicated 15/36 = **0.417**.
- Pair bootstrap 95% CI (adjudicated): 0.25–0.58; (Rater A): 0.31–0.64. Event-cluster bootstrap (adjudicated): 0.19–0.68.
- Per-event adjudicated overlap: E1 0.20, E2 0.20, E3 0.80, E4 0.00, E5 0.40, E6 1.00, E7 1.00 (1 pair), E8 0.20.
- Convergence median 7.5 (verified) / ≈10 (with probable). Window median 0.5 d (mean 1.4 d).

## 8. Observations that did not fit the metric table
- Zero pairs scored 0: everyone writes about the same facts. 21/36 scored 1: the difference is depth, not topic. The "same synthesis" claim is half-true.
- Supply is same-day. Half of the free substitutes exist within ~1 day; a paid artifact would be selling against them from hour one.
- The two categories nearest the product's founding story (prize drop, airdrop criteria) have almost no public synthesis. Either that research is private (the hoped-for market) or nobody does it; this test cannot distinguish, and the plan should not assume the former.
- Law-firm alerts (E6) mostly land at days 20–29; TS7 retrospectives at days 20–37. A 14-day window undercounts slow-moving categories and any half-life default derived from the 0.5-day median would expire artifacts before the second wave of readers arrives.
- Fetch failures were frequent (paywalls, 403s). A production tracker built on public fetch would have the same recall problem.

## 9. Files
- Scratch (session-local, not committed): artifacts.json, pairs.json, raterA.json, raterB.json, adjudicated.json under the session scratchpad.
- Deliverable: docs/PHASE0.md.
