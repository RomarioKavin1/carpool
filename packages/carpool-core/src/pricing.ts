/**
 * The two defaults that have to agree, in one file, with the arithmetic that
 * ties them written down.
 *
 * They did not agree. `carpool_publish` priced at 15% of what the research cost
 * to produce; `carpool_fetch` (and `apps/bench`) capped a single payment at
 * 20,000 µUSDC. Solve for the break-even and the out-of-the-box product is a
 * buyer that can never buy: 20,000 / 0.15 / 1e6 = **$0.1333**, so any artifact
 * that cost more than thirteen cents to produce was priced above the cap of the
 * only client that could buy it. The A/B document's own worked example — a $2.14
 * research run, priced at 321,000 µUSDC — is 16× over. The x402 spend control
 * rejects client-side before a request is ever sent, so the failure did not even
 * arrive as an HTTP status; it arrived as an opaque local throw.
 *
 * The two numbers are not independent and must never again be edited apart, so
 * the cap is *derived* rather than chosen:
 *
 *     price(cost)  = max(MIN_PRICE, PRICE_SHARE × cost)      ← the author's side
 *     DEFAULT_CAP  = PRICE_SHARE × MAX_REDO_COST × 1e6       ← the buyer's side
 *
 * Pick a share and a most-expensive-research-run you want the default buyer to
 * be able to buy, and the cap follows. The relationship is asserted in
 * `pricing.test.ts`, so changing one constant without the other is a red test
 * rather than a silent return to an unbuyable product.
 *
 * Both remain overridable — the author prices per publish, the buyer sets
 * `CARPOOL_MAX_MICRO_USDC` — and a candidate above the buyer's cap is flagged
 * per line by `carpool_search` and named by `payFetch` on rejection. The
 * defaults only have to make the first run work.
 *
 * The 0.15 in the paragraph above is the share that shipped *with that bug*, and
 * it is history: the share is now 0.10 everywhere, which is a second decision
 * with its own reasoning — see `PRICE_SHARE_OF_REDO_COST` immediately below.
 */

/**
 * Share of the producer's own cost the default price asks for.
 *
 * **0.10.** One number, repo-wide. `apps/bench`'s `PRICE_BASE_FRACTION_OF_REDO`
 * is this constant, not a second copy of it.
 *
 * ## The contradiction this resolves (docs/AUDIT-CLAIMS.md M4)
 *
 * This constant was 0.15 and the A/B runner listed at 0.10, each presented as
 * the default, neither noting that the other existed. Both are defensible; what
 * is not defensible is shipping two, because the spend cap below is *derived*
 * from this share, so the repo's buyer-side default and its own worked example
 * were priced by different policies. The decision is recorded here rather than
 * left to whichever file a reader opens first.
 *
 * ## Why 0.10, and why 0.15 was rejected
 *
 * `docs/PHASE0.md` §5 derives the bar from `P(useful) · f · c ≥ p + v` with
 * `p = share · c`, partial usefulness `f ≈ 0.5` and verification cost
 * `v ≈ 0.05c`. Solve it and every bar below is a function of this one constant:
 *
 * | | share = 0.10 | share = 0.15 |
 * |---|---|---|
 * | break-even `P(useful) ≥ share` | 10% | 15% |
 * | operating target `(share + 0.05)/0.5` | **30%** | 40% |
 * | precision@1 needed at target, given measured `P(substitutable) = 0.42` | **71%** | **95%** |
 * | precision@1 needed at break-even | 24% | 36% |
 * | precision@1 needed at target with partial credit (0.42 + 0.58·0.4 = 0.652) | 46% | 61% |
 *
 * The 0.42 is measured (Phase 0, 36 adjudicated pairs, range 0.33–0.47 across
 * raters). So at 0.15 the product clears its own operating target only if
 * retrieval is **95% precision@1** — near-perfect, over open-domain research
 * questions, and unmeasured: `pnpm bench`'s 1.000 is a synthetic corpus with no
 * topically-close wrong answer in it, and says so in its own banner. A price
 * whose justification requires a retrieval result nobody has is the pitch
 * eroding, which is the failure mode that matters most here: Phase 0's other two
 * measured findings are that a free substitute appears within a median of
 * **0.5 days** and that people answer the same question at different *depths*.
 * The buyer is paying for a window measured in hours against a substitute that
 * is free. 15% of a full redo for that window asks too much of it; 10% leaves
 * the saving large enough to survive imperfect retrieval.
 *
 * The erosion is measurable on this repo's own example, and was measured while
 * deciding: re-running the A/B guard with the share at 0.15 drops the recorded
 * saving from **9.1× to 6.1×** (the artifact's price goes 397,041 → 595,562
 * µUSDC against a $3.97 redo floor). A third of the headline saving, bought with
 * a 50% larger cut of a number the author reports about themselves.
 *
 * Second reason, from the reason the rule exists at all: `estimatedCostUsd` is
 * **self-reported by the author**. Price is a fraction of it precisely because
 * that number is not trusted, and the fraction *is* the strength of the guard —
 * an author who doubles their claimed cost extracts 20% of the true cost at
 * 0.10 and 30% at 0.15. Halving the leverage of a false self-report is worth
 * more than the extra margin.
 *
 * Third, 0.10 is the share the one executed measurement in this repo was taken
 * under (`apps/bench/src/ab-measured.json`, `docs/AB-MEASUREMENT.md`). Choosing
 * 0.15 would mean regenerating a real measurement's figures because a policy
 * input moved — reprinting measured numbers to match a preference is the exact
 * shape of the defect this repo has already retracted twice.
 *
 * ## What 0.10 costs, stated rather than hidden
 *
 * The author side gets worse: at 0.10 it takes **10 sales at the base price** to
 * repay production, against ~7 at 0.15 — and fewer in practice than either,
 * because `priceAt()` decays the price toward `priceFloor`, so only the earliest
 * buyers pay anything near the base. With a measured median of 7.5 independent
 * free artifacts per event, the paid window is short and 10 sales may never
 * arrive. That is a real argument for 0.15 and it is rejected for one reason: it
 * is arithmetic over a quantity this repo has never measured. There is no sales
 * data anywhere in the tree. The buyer side has measurements (0.42, 0.5 days);
 * the supply side has none, so the share is set from the side that has evidence.
 *
 * **What would flip this.** A measured precision@1 ≥ 95% over a real corpus of
 * differently-authored artifacts on overlapping topics would make 0.15 clear the
 * operating target, and then the supply argument decides. Equally, observed
 * sales showing authors quitting below ~10 sales would argue for raising it.
 * Both are measurements, not edits; until one exists, this stays 0.10 and this
 * comment is the reason.
 */
export const PRICE_SHARE_OF_REDO_COST = 0.1;

/**
 * Floor on the default price, µUSDC. Research that cost under $0.01 to produce
 * (0.01 × 0.10 × 1e6 = 1,000) would otherwise be priced below the registry's own
 * tracker fee (500 µUSDC), and `POST /publish` rejects a `priceFloor` under that
 * fee. The threshold moves with `PRICE_SHARE_OF_REDO_COST`: it was ~$0.0067 at
 * 0.15.
 */
export const MIN_PRICE_MICRO_USDC = 1_000;

/** The default `priceFloor` as a share of `priceBase` — where decay bottoms out. */
export const PRICE_FLOOR_SHARE = 0.1;

/**
 * The most expensive research run the *default* buyer can buy without being
 * asked to raise anything. Independent of the share above: this is a statement
 * about how expensive a research run can be, not about what it costs to buy.
 *
 * $5 is chosen against what a long agentic research session actually costs: the
 * one artifact this repo has measured cost $3.97 of model time by its own
 * transcript (a floor — see docs/AB-MEASUREMENT.md), so a default that could not
 * buy it would fail on the only real example in the tree. $5 covers it with
 * headroom while keeping the implied automatic spend under a dollar per purchase.
 */
export const DEFAULT_MAX_REDO_COST_USD = 5;

/**
 * Default per-payment spend cap, µUSDC — **derived** from the two above, never
 * chosen independently. 0.10 × $5 = $0.50 = 500,000 µUSDC. (It was 750,000 while
 * the share was 0.15; the ceiling on what the default buyer can buy — a $5 redo —
 * did not move, only the price asked for it.)
 */
export const DEFAULT_CAP_MICRO_USDC = Math.round(
  DEFAULT_MAX_REDO_COST_USD * 1e6 * PRICE_SHARE_OF_REDO_COST,
);

/** The default price for research that cost `estimatedCostUsd` to produce, µUSDC. */
export function priceForRedoCost(estimatedCostUsd: number): number {
  return Math.max(
    MIN_PRICE_MICRO_USDC,
    Math.round(estimatedCostUsd * 1e6 * PRICE_SHARE_OF_REDO_COST),
  );
}

/** The default `priceFloor` for a given base price, µUSDC. */
export function floorForPrice(priceMicroUsdc: number): number {
  return Math.max(MIN_PRICE_MICRO_USDC, Math.round(priceMicroUsdc * PRICE_FLOOR_SHARE));
}

/**
 * The most expensive research run a buyer with this cap can buy at the default
 * price rule. What `carpool_search` and `payFetch` tell the agent when a
 * candidate is over the cap, so the message is actionable rather than a number.
 */
export function maxBuyableRedoCostUsd(capMicroUsdc: number): number {
  return capMicroUsdc / 1e6 / PRICE_SHARE_OF_REDO_COST;
}

/** This process's per-payment cap: `CARPOOL_MAX_MICRO_USDC`, else the derived default. */
export function capMicroUsdc(env: { CARPOOL_MAX_MICRO_USDC?: string } = process.env): number {
  const raw = env.CARPOOL_MAX_MICRO_USDC;
  if (raw == null || raw.trim() === "") return DEFAULT_CAP_MICRO_USDC;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CAP_MICRO_USDC;
  return Math.trunc(n);
}
