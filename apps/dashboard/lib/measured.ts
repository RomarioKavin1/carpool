/**
 * The one recorded A/B measurement, and the provenance vocabulary the whole
 * dashboard labels numbers with.
 *
 * ## Why this file exists at all
 *
 * Everything else in this app is read from the registry at runtime. This is
 * the exception: a single measured comparison of redoing research against
 * buying it, which happened once, on one artifact, on 2026-09-12, and cannot
 * be recomputed in a browser. `docs/AB-MEASUREMENT.md` is its record and
 * `apps/bench/src/redo-measured.json` is the machine-readable half.
 *
 * ## Why it is transcribed rather than imported
 *
 * A value-import of `../../bench/src/redo-measured.json` would make the
 * numbers un-driftable but would also pull a second workspace into the browser
 * bundle's module graph. `measured.test.ts` buys the same guarantee without
 * that: it reads `apps/bench/src/redo-measured.json`,
 * `apps/bench/src/ab-measured.json`, `apps/bench/src/provenance.ts` and
 * `docs/AB-MEASUREMENT.md` off disk and fails if any figure below no longer
 * matches its source — comparing **integers**, not rendered dollars, because a
 * four-decimal dollar comparison hid a wrong µUSDC charge here for two commits.
 * That test is the only reason a recorded number is allowed to sit in this app,
 * and unlike the runner it needs no external artifact, so it runs in CI.
 *
 * ## What this file must never grow
 *
 * A number with no source line. Every field below names where it came from and
 * what KIND of number it is, and the UI renders that kind next to the value.
 * The previous version of these figures was fabricated — unit-test fixtures
 * presented as results — which is why the correction notice ships in the UI
 * rather than only in the doc.
 */

/**
 * How much weight a number carries. Rendered, not decorative: the economics
 * view shows this beside every figure, and two numbers of different kinds are
 * never summed or divided into a ratio without saying so.
 */
export type Provenance =
  /** Computed from this registry's own API on the last poll. */
  | "live"
  /** Measured once and recorded in this repo. Traceable to a file. */
  | "recorded"
  /** Measured tokens priced at a stated list price. The tokens are real; the dollars are a price list. */
  | "stated-rates"
  /** A judgement call by whoever ran the measurement, not a discovery. */
  | "policy"
  /** Self-reported by the author inside a signed manifest. Nobody audited it. */
  | "author-reported"
  /** No source. Shown as an explanation of why, never as a value. */
  | "unobservable";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  live: "live",
  recorded: "recorded",
  "stated-rates": "at stated rates",
  policy: "policy",
  "author-reported": "author-reported",
  unobservable: "not observable",
};

export const PROVENANCE_MEANING: Record<Provenance, string> = {
  live: "Computed from this registry's own /state or /search on the last poll.",
  recorded: "Measured once and recorded in this repo. The source file is named beside it.",
  "stated-rates":
    "Measured token counts multiplied by a published price list. The tokens are measured; the dollars are only as right as the rates, and the session was billed on a higher tier.",
  policy: "Somebody chose this number. It is an input to the comparison, not a result of it.",
  "author-reported":
    "Claimed by the author inside the signed manifest. The registry does not verify it; a buyer weighs it and can refund inside the window.",
  unobservable: "The API does not serve this. Nothing is shown in its place.",
};

/** Claude Opus 5's published per-MTok list price as of 2026-09-12. */
export const STATED_RATES = {
  input: 5,
  output: 25,
  cacheWrite: 6.25,
  cacheRead: 0.5,
} as const;

/**
 * Source: `apps/bench/src/redo-measured.json`, produced by
 * `pnpm --filter @carpool/bench measure:redo` over rows 8–222 of the producing
 * session's own transcript.
 */
export const REDO = {
  question:
    "What are all the ETHOnline 2026 prize tracks, how do they compose, and what should we build?",
  model: "claude-opus-5",
  apiCalls: 25,
  inputTokens: 48,
  outputTokens: 83_177,
  cacheWriteTokens: 131_024,
  cacheReadTokens: 2_143_694,
  activeSeconds: 630.902,
  elapsedSeconds: 6059.039,
  toolCalls: 22,
  /** Non-zero ⇒ every token and dollar here is a floor. Four subagent transcripts were not retained. */
  subagentCalls: 4,
  /** Unique source URLs in the artifact, counted with grep over the file. */
  sources: 28,
  /** The measured span also produced these, so it is not a single-artifact cost. */
  alsoProduced: ["prize-map.html", "four candidate project ideas"],
  segment: { fromRow: 8, toRow: 222 },
} as const;

export const REDO_TOTAL_TOKENS =
  REDO.inputTokens + REDO.outputTokens + REDO.cacheWriteTokens + REDO.cacheReadTokens;

/** The same arithmetic as `costUsd()` in apps/bench/src/provenance.ts. */
export function redoCostUsd(rates: typeof STATED_RATES = STATED_RATES): number {
  return (
    (REDO.inputTokens * rates.input +
      REDO.outputTokens * rates.output +
      REDO.cacheWriteTokens * rates.cacheWrite +
      REDO.cacheReadTokens * rates.cacheRead) /
    1_000_000
  );
}

/**
 * Source: `apps/bench/src/ab-measured.json`, written by the run itself, and the
 * verbatim `pnpm ab:run` block in `docs/AB-MEASUREMENT.md`. A real publish →
 * search → pay → verify round trip **on the wire**: a registry with real Hedera
 * credentials, the real Blocky402 facilitator, real Hedera testnet and the
 * registry's real ONNX embedder, paid with transaction
 * `0.0.7162784@1789220203.068787609`. It was previously measured against an
 * in-process registry and a stub facilitator, which is why the latency below used
 * to be milliseconds and is now seconds; the price, the charge and the integrity
 * check did not move.
 *
 * ## Why the µUSDC integer is here and not just the dollars
 *
 * This block used to record `paidMicroUsdc: 436_700`. The gate charged
 * **436,745**. The wrong figure was back-derived from the four-decimal dollar
 * rendering, and `measured.test.ts` could not see it because
 * `(436_700/1e6).toFixed(4)` and `(436_745/1e6).toFixed(4)` are both `"0.4367"`:
 * a guard written in dollars is blind to a 50 µUSDC range, which is where the
 * whole of `priceAt()`'s rounding lives. The test now compares integers against
 * `ab-measured.json` and recomputes the charge from `priceFloor + round(priceBase
 * × freshness)`.
 */
export const BUY = {
  quotedMicroUsdc: 436_745,
  paidMicroUsdc: 436_745,
  /**
   * 10% of the measured redo floor. A policy choice, not a discovery — and now the
   * *same* choice the shipped price rule makes: `@carpool/core`'s
   * `PRICE_SHARE_OF_REDO_COST` was 0.15 while this run listed at 0.10, which is
   * `docs/AUDIT-CLAIMS.md` M4. Resolved to 0.10, so this figure is what
   * `carpool_publish` would quote for the same self-reported cost.
   */
  priceBaseMicroUsdc: 397_041,
  priceFloorMicroUsdc: 39_704,
  bodyBytes: 45_896,
  /** approxTokens divides CHARACTERS by 4, which is why this is 11,355 and not 11,474. */
  bodyChars: 45_417,
  tokensIfFullyRead: 11_355,
  /**
   * What `carpool_fetch` actually returns into the buyer's context: a four-line
   * receipt. The receipt names the file it wrote, so this figure depends on the
   * output directory: the runner pins it to
   * `CARPOOL_ARTIFACT_DIR=/tmp/carpool-artifacts` and records that alongside the
   * count, because the shipped default is `os.tmpdir()/carpool-artifacts` and
   * `os.tmpdir()` differs by OS — and, on this laptop, between a standalone
   * `vitest` run and `turbo run test` (96 against 85). An earlier 83 came from a
   * runner that invented `/tmp/carpool/…`, which the MCP server never writes.
   */
  tokensForSummary: 90,
  integrity: "verified",
  /**
   * Seconds, on the wire, and different on every run — see LATENCY_CAVEAT. The
   * fetch is the paid retry: a real 402, a signed USDC transfer, the facilitator's
   * verify and settle, and Hedera consensus.
   */
  searchSeconds: 0.009,
  fetchSeconds: 7.687,
} as const;

export const LATENCY_CAVEAT =
  "7.70 s is a wire measurement: a real 402, a real signed USDC transfer, the real Blocky402 " +
  "facilitator's verify and settle, and Hedera consensus. It is NOT a total and NOT a " +
  "distribution: it excludes the later settlement transfer that pays the author and the HBAR " +
  "network fees, and it is one sample on one network path. It changes on every run: two " +
  "consecutive runs gave 5.58 s and 7.70 s, and across 24 other purchases in the same session " +
  "the same round trip ranged from 3.2 s to 13.0 s. This repo claims no wall-clock ratio. " +
  "Before this re-measurement the figure was 0.02 s against an in-process registry and a stub " +
  "facilitator, which understated a real purchase by two orders of magnitude.";


/**
 * The retraction, carried into the UI. Source: the correction box at the top of
 * docs/AB-MEASUREMENT.md. It stays on this screen permanently: the figures
 * this view exists to show were once fabricated, and a reader has no way to
 * know that from the numbers alone.
 */
export const CORRECTION = {
  date: "2026-09-12",
  fabricated: "412s / 4.2s / $2.14 / $0.31 / 195,524 tokens / 37 tool calls / 143 sources",
  what:
    "Those were literals typed into a unit-test fixture and transcribed into the docs as results. " +
    "computeAb() and renderAb() had no caller outside that test, so no run of any kind produced them. " +
    "Nothing was published, bought, or timed.",
  checkable:
    "Two of the old numbers were checkable and both failed: the doc claimed 143 source links where " +
    "the artifact has 28, and the $0.31 said to come from priceAt() was a fixture field.",
  /**
   * The second correction: the guard that was supposed to stop this from
   * recurring did not work, and the commit that announced it said it did. Shipped
   * in the UI for the same reason the first one is — a reader cannot see a guard.
   */
  guard:
    "The fix for the above claimed more than it did. Commit 9ef4062 said a test made it impossible " +
    "for the doc to drift from the run in either direction; that test was a list of hand-typed " +
    "substrings, one of which was the two digits \"28\", and an audit put the retracted \"143 " +
    "sources\" back into the doc without turning the build red. The guard now derives every figure " +
    "from a machine-written record and checks it at its labelled position, and the figure this page " +
    "records for the charge is the µUSDC integer rather than a four-decimal dollar amount, because the " +
    "dollars hid a 45 µUSDC error here (436,700 recorded against 436,745 charged).",
} as const;

/** The doc's own list of what the measurement does not establish, condensed. */
export const NOT_SHOWN: readonly string[] = [
  "One artifact, one question, one model. A worked example of the trade, not a population estimate.",
  "Redo is what this author spent, not what a second person would spend. The same question against better models costs less to redo.",
  "The redo figure is a floor twice over: four subagent transcripts were not retained, and the dollars price measured tokens below the tier actually billed.",
  "The buy figure is a wire measurement, not a floor and not a total: it excludes the settlement transfer that pays the author and the HBAR network fees. Those fees are real: 0.0134 ℏ for a settlement transfer to a payee that already holds USDC, 0.674 ℏ for one that does not, because the transfer creates the token association and the registry pays for it.",
  "The measured span also produced prize-map.html and four candidate project ideas, so it is not the cost of one document.",
  "priceBase is 10% of the measured redo floor, a judgement call, now the one the whole repo makes (it was 0.15 in the shipped price rule and 0.10 here). Set the fraction higher and the ratio falls: at 0.15 this saving is 6.1×, not 9.1×.",
  "It says nothing about whether a second buyer exists. Phase 0 tried to measure that and returned STOP.",
] as const;

export const SOURCE_FILES = {
  redo: "apps/bench/src/redo-measured.json",
  buy: "apps/bench/src/ab-measured.json",
  rates: "apps/bench/src/provenance.ts (PUBLISHED_OPUS_5_RATES)",
  doc: "docs/AB-MEASUREMENT.md",
} as const;
