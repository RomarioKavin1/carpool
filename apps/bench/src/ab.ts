/**
 * The A/B measurement: what does redoing research cost, versus buying it?
 *
 * Phase 0 returned STOP. It measured the *supply* of free substitutes — how
 * many people independently produce the same synthesis — and found overlap of
 * 42% against a 50% bar with kappa 0.26. That is a proxy for demand, and a
 * noisy one. This is the demand-side number, and after Phase 0 it is the real
 * gate: no launch claim should go out ahead of it.
 *
 * ## This file computes and renders. It does not know any numbers.
 *
 * That separation is the fix for how this shipped the first time. The original
 * version of this file had no caller outside its own unit test, so the only
 * numbers that ever flowed through it were the test's fixtures — and those
 * fixtures were transcribed into `docs/AB-MEASUREMENT.md` and the README as
 * measurements. Nothing was measured. See the note at the top of
 * docs/AB-MEASUREMENT.md.
 *
 * The real caller is `ab-run.test.ts`, which boots the registry, publishes the
 * artifact, buys it, and passes what it observed to `computeAb`. Fixtures in
 * `ab.test.ts` remain fixtures: they exercise the arithmetic and are never a
 * source for any document.
 *
 * ## What is measured, exactly
 *
 * **Redo cost** is read out of the producing session's own transcript by
 * `provenance.ts` — recorded per-turn `usage` blocks and timestamps. It is a
 * FLOOR, in two directions that both understate it: subagent transcripts were
 * not retained, and the dollar figure prices measured tokens at a stated rate
 * card which may not be the one billed. `RedoCost` carries `subagentCalls` and
 * `rates` so neither gap can be quoted away.
 *
 * **Buy cost** is measured by an actual purchase: the price `priceAt()` quoted,
 * the amount the x402 gate took, the round trip, and the tokens the buyer's
 * context absorbs. `latencyIsLocalFloor` says which kind of latency it is, and
 * `renderAb` refuses to print the ratio without the matching statement:
 *
 * - **true** — the registry ran in-process against a stub facilitator, so the
 *   number excludes real network and real Hedera settlement and is a FLOOR, in
 *   the opposite direction from the redo-side floor.
 * - **false** — a WIRE measurement against a real registry, the real facilitator
 *   and real Hedera. Not a floor, and not a total either: it excludes the
 *   settlement epoch that pays the author and the HBAR fees, and it is one
 *   sample on one network path. `renderAb` prints that scope statement, because
 *   the first thing anybody does with a latency is extrapolate it.
 *
 * ## What it does not show
 *
 * One artifact, one question, one model. It is a worked example of the trade,
 * not a population estimate. Running it across many artifacts would produce a
 * distribution; this produces a data point.
 */
import { totalTokens, type Rates, type TokenUsage } from "./provenance.js";

export interface RedoCost extends TokenUsage {
  model: string;
  /** Wall clock with human-latency gaps stripped — the machine time. */
  activeSeconds: number;
  /** Wall clock including the human. The honest denominator for "how long did this take". */
  elapsedSeconds: number;
  /** `inputTokens…cacheReadTokens` priced at `rates`. */
  estimatedCostUsd: number;
  /** The price list `estimatedCostUsd` was computed against. Never a constant. */
  rates: Rates;
  toolCalls: number;
  /**
   * Dispatches whose own token spend is NOT in this object. Non-zero means
   * every token and dollar here is a floor.
   */
  subagentCalls: number;
  /** Unique source URLs in the artifact, counted from the file. */
  sources: number;
  /**
   * Other deliverables the measured segment also produced. The segment is a
   * span of one session, not a clean single-artifact reproduction: someone
   * redoing only this document would spend less.
   */
  alsoProduced: string[];
  /** Where the numbers came from, so a reader can re-run the same range. */
  segment: { transcript: string; fromRow: number; toRow: number };
}

export interface BuyCost {
  /** What the 402 response quoted, in µUSDC. Whatever `priceAt()` returned. */
  quotedMicroUsdc: number;
  /** What the payment actually took. Equal to the quote unless the gate re-priced. */
  paidMicroUsdc: number;
  /** The `priceBase` the runner published at, and why, belong in the doc — this is the input. */
  priceBaseMicroUsdc: number;
  priceFloorMicroUsdc: number;
  /** Free manifest search. */
  searchLatencyMs: number;
  /** Paid fetch, including the unpaid 402 probe and the integrity check. */
  fetchLatencyMs: number;
  /** Search + fetch round trip, excluding the buyer's own reading. */
  latencyMs: number;
  /** Bytes written to disk. */
  bodyBytes: number;
  /** Tokens the buyer's context absorbs if it reads the WHOLE artifact. */
  tokensIfFullyRead: number;
  /** Tokens absorbed by the summary the fetch tool actually returns. */
  tokensForSummary: number;
  /** Whether the delivered body matched a hash the buyer held before paying. */
  verification: "verified" | "unverified";
  /**
   * True when the round trip was measured against an in-process registry and a
   * stub facilitator: no real network, no real Hedera settlement. The latency is
   * then a floor on buying, and must not be presented as a wire measurement.
   */
  latencyIsLocalFloor: boolean;
}

export interface AbResult {
  magnet: string;
  question: string;
  redo: RedoCost;
  buy: BuyCost;
  savings: {
    /** Dollars saved, buying versus redoing. */
    usd: number;
    /** Multiple: redo cost / buy price. */
    costRatio: number;
    /** Seconds saved. The binding constraint, and the one that does not fall with model prices. */
    secondsSaved: number;
    /** Multiple: redo machine-time / buy wall-clock. */
    timeRatio: number;
    /** Tokens saved if the buyer reads the whole artifact. */
    tokensSavedFullRead: number;
  };
}

/**
 * Rough token count. Deliberately crude and labelled as such: a real count
 * needs the buyer's own tokenizer, and this harness has no business guessing
 * which model will read the file. ~4 chars/token is the usual English
 * approximation and is within about 15% for prose.
 *
 * It counts **characters**, not bytes, which is why the measured full-read
 * figure for the ETHOnline artifact is 11,355 and not 11,474: the file is
 * 45,417 characters in 45,896 UTF-8 bytes (em dashes, arrows, box drawing).
 * A reviewer who reaches for `wc -c` will get the byte figure. Characters are
 * the right denominator here — a tokenizer sees code points, not bytes.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Every token bucket the redo spent, summed. */
export function redoTotalTokens(r: RedoCost): number {
  return totalTokens(r);
}

export function computeAb(input: {
  magnet: string;
  question: string;
  redo: RedoCost;
  buy: Omit<BuyCost, "bodyBytes" | "tokensIfFullyRead" | "tokensForSummary" | "latencyMs">;
  body: string;
  summary: string;
}): AbResult {
  const buyUsd = input.buy.paidMicroUsdc / 1e6;
  const latencyMs = input.buy.searchLatencyMs + input.buy.fetchLatencyMs;
  const buySeconds = latencyMs / 1000;
  const tokensIfFullyRead = approxTokens(input.body);
  const redoTokens = totalTokens(input.redo);

  return {
    magnet: input.magnet,
    question: input.question,
    redo: input.redo,
    buy: {
      ...input.buy,
      latencyMs,
      bodyBytes: Buffer.byteLength(input.body, "utf8"),
      tokensIfFullyRead,
      tokensForSummary: approxTokens(input.summary),
    },
    savings: {
      usd: input.redo.estimatedCostUsd - buyUsd,
      costRatio: buyUsd > 0 ? input.redo.estimatedCostUsd / buyUsd : Infinity,
      // Machine time, not elapsed: elapsed includes the author reading their
      // own screen, which a buyer does not inherit and which would flatter the
      // ratio by an order of magnitude.
      secondsSaved: input.redo.activeSeconds - buySeconds,
      timeRatio: buySeconds > 0 ? input.redo.activeSeconds / buySeconds : Infinity,
      tokensSavedFullRead: redoTokens - tokensIfFullyRead,
    },
  };
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const n0 = (n: number) => n.toLocaleString("en-US");

export function renderAb(r: AbResult): string {
  const L: string[] = [];
  L.push(`A/B — ${r.question}`);
  L.push(`      ${r.magnet}`);
  L.push("");
  // The buy column's own header says which kind of number it holds. A wire
  // measurement is not a floor and must not be labelled one; a loopback one is,
  // and the label is the first thing a reader sees.
  L.push(
    r.buy.latencyIsLocalFloor
      ? "                        REDO (measured, a floor)        BUY (measured, a floor)"
      : "                        REDO (measured, a floor)        BUY (measured, on the wire)",
  );
  L.push(
    `  wall clock            ${`${r.redo.activeSeconds.toFixed(1)}s`.padStart(10)} active` +
      `              ${`${(r.buy.latencyMs / 1000).toFixed(2)}s`.padStart(10)}`,
  );
  L.push(
    `                        ${`${r.redo.elapsedSeconds.toFixed(0)}s`.padStart(10)} elapsed` +
      `             ${`${(r.buy.searchLatencyMs / 1000).toFixed(2)}s`.padStart(10)} search` +
      ` + ${(r.buy.fetchLatencyMs / 1000).toFixed(2)}s fetch`,
  );
  L.push(
    `  tokens                ${n0(totalTokens(r.redo)).padStart(10)}` +
      `                     ${n0(r.buy.tokensForSummary).padStart(10)} (summary)`,
  );
  L.push(
    `                        ${"".padStart(10)}` +
      `                     ${n0(r.buy.tokensIfFullyRead).padStart(10)} (if fully read)`,
  );
  L.push(
    `  cost                  ${usd(r.redo.estimatedCostUsd).padStart(10)}` +
      `                     ${usd(r.buy.paidMicroUsdc / 1e6).padStart(10)}`,
  );
  L.push("");
  // The time ratio is marked at the point of use, not only in a caveat further
  // down, because a ratio is the thing that gets copied out of a report. Against
  // a loopback registry the denominator is compute time with no wire and no
  // settlement in it, so the number is not a claim about buying over a network.
  const timeMark = r.buy.latencyIsLocalFloor ? "x faster (LOCAL, not a wire time)" : "x faster";
  L.push(
    `  saved: ${usd(r.savings.usd)} (${r.savings.costRatio.toFixed(1)}x cheaper), ` +
      `${r.savings.secondsSaved.toFixed(0)}s (${r.savings.timeRatio.toFixed(0)}${timeMark})`,
  );
  L.push("");
  L.push("  redo breakdown:");
  L.push(
    `    ${r.redo.model} · ${n0(r.redo.inputTokens)} in · ${n0(r.redo.outputTokens)} out · ` +
      `${n0(r.redo.cacheWriteTokens)} cache write · ${n0(r.redo.cacheReadTokens)} cache read`,
  );
  L.push(
    `    ${r.redo.toolCalls} tool calls · ${r.redo.sources} sources · ` +
      `transcript rows ${r.redo.segment.fromRow}..${r.redo.segment.toRow}`,
  );
  L.push(
    `    priced at $/MTok: in ${r.redo.rates.input} · out ${r.redo.rates.output} · ` +
      `cache write ${r.redo.rates.cacheWrite} · cache read ${r.redo.rates.cacheRead}`,
  );
  L.push("  buy breakdown:");
  L.push(
    `    quoted ${usd(r.buy.quotedMicroUsdc / 1e6)} · paid ${usd(r.buy.paidMicroUsdc / 1e6)} · ` +
      `priceBase ${n0(r.buy.priceBaseMicroUsdc)} µUSDC · floor ${n0(r.buy.priceFloorMicroUsdc)} µUSDC`,
  );
  L.push(`    ${n0(r.buy.bodyBytes)} bytes written · integrity ${r.buy.verification}`);
  L.push("");

  // Both sides are floors, in opposite directions. Printing the ratio without
  // both caveats is the overclaim this whole file exists to stop.
  if (r.redo.subagentCalls > 0) {
    L.push(
      `  REDO IS A FLOOR: ${r.redo.subagentCalls} subagent dispatches spent tokens in transcripts that were not`,
    );
    L.push("  retained. The real production cost is strictly higher than the figure above.");
  }
  if (r.redo.alsoProduced.length > 0) {
    L.push(
      `  SEGMENT BOUNDARY: the same span also produced ${r.redo.alsoProduced.join(", ")}. Someone`,
    );
    L.push("  redoing only this document would spend less. This is not a single-artifact cost.");
  }
  if (r.buy.latencyIsLocalFloor) {
    L.push("  BUY IS A FLOOR TOO, the other way: in-process registry, stub facilitator. No real");
    L.push("  network, no real Hedera settlement. A wire measurement would be slower.");
  } else {
    // A wire number has to say what it covers, for the same reason a floor has to
    // say it is one. Without this the report would print a real latency with no
    // statement of scope, and the first thing anybody does with a latency is
    // extrapolate it. What it includes and what it still excludes, in the report
    // itself rather than only in a document beside it.
    L.push("  WIRE MEASUREMENT: real network, real facilitator, real Hedera settlement — the 402,");
    L.push("  the signed transfer, the facilitator's verify and settle, and consensus. It still");
    L.push("  EXCLUDES the settlement epoch that pays the author (a separate transfer, minutes to");
    L.push("  a day later) and the HBAR transaction fees nobody here is charged. One sample, one");
    L.push("  network path — not a percentile.");
  }
  L.push("  The dollar figures are measured tokens at the rates printed above — a price list, not a fact.");
  L.push("  One artifact, one question, one model — a worked example, not a population estimate.");
  return L.join("\n");
}
