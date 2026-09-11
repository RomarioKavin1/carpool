import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUY,
  CORRECTION,
  REDO,
  REDO_TOTAL_TOKENS,
  STATED_RATES,
  redoCostUsd,
} from "./measured";

/**
 * The drift guard.
 *
 * `lib/measured.ts` holds the only numbers in this app that are not read from
 * the registry at runtime, so it is the only place a stale or invented figure
 * could hide. These tests read the sources off disk and fail if any of them
 * moved.
 *
 * ## Two things this guard used to be unable to see
 *
 * 1. **A wrong µUSDC charge.** It asserted `(BUY.paidMicroUsdc/1e6).toFixed(4)
 *    === "0.4367"`, which is true of every value from 436,700 to 436,749. The
 *    recorded figure was 436,700 and the gate charged 436,745 — back-derived
 *    from the dollar rendering, and invisible to a dollar-shaped assertion.
 *    Every money comparison below is now integer µUSDC against
 *    `apps/bench/src/ab-measured.json`, which the runner writes.
 * 2. **A wrong figure in the doc.** It asserted `expect(doc).toContain(figure)`
 *    over a list that included the bare string `"83"` and the bare string
 *    `"28"`. Both are satisfied by digits anywhere in a 13 KB document,
 *    including hex inside the run's magnet — an audit put the retracted "143
 *    sources" into the doc and this suite stayed green. The doc is now checked
 *    by its **generated figure block**, parsed key by key, and every figure this
 *    app repeats has to equal the block's value for that key.
 *
 * The files live in sibling workspaces. They are read rather than imported so
 * that no second workspace lands in the browser bundle's module graph — which is
 * also why the block parser below is a local copy of the one in
 * `apps/bench/src/docFigures.ts` rather than an import. The format is two lines
 * of regex on purpose.
 */
const REPO = join(process.cwd(), "..", "..");
const REDO_JSON = join(REPO, "apps", "bench", "src", "redo-measured.json");
const AB_JSON = join(REPO, "apps", "bench", "src", "ab-measured.json");
const PROVENANCE_TS = join(REPO, "apps", "bench", "src", "provenance.ts");
const AB_DOC = join(REPO, "docs", "AB-MEASUREMENT.md");

/** Same format as `renderFigureBlock()` in apps/bench/src/docFigures.ts. */
function parseFigureBlock(doc: string): Map<string, string> {
  const start = doc.indexOf("<!-- BEGIN GENERATED FIGURES");
  const end = doc.indexOf("<!-- END GENERATED FIGURES -->");
  if (start < 0 || end < 0) {
    throw new Error(
      "docs/AB-MEASUREMENT.md has no generated figure block — the figures in lib/measured.ts have " +
        "nothing to be checked against. Run `CARPOOL_AB_WRITE=1 pnpm ab:run`.",
    );
  }
  const out = new Map<string, string>();
  for (const line of doc.slice(start, end).split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m) out.set(m[1]!, m[2]!);
  }
  if (out.size === 0) throw new Error("the generated figure block parsed to zero figures");
  return out;
}

const n0 = (n: number) => n.toLocaleString("en-US");
const doc = readFileSync(AB_DOC, "utf8");
const block = parseFigureBlock(doc);
const ab = JSON.parse(readFileSync(AB_JSON, "utf8")) as {
  artifact: { bytes: number; chars: number; sources: number; sha256: string };
  buy: Record<string, number | string>;
  latency: { searchSeconds: number; fetchSeconds: number; isLocalFloor: boolean };
  /** `wire: true` and a real transaction id since the buy side was re-measured on the wire. */
  registry: { embedder: string; facilitator: string; txId: string; wire: boolean };
};

describe("recorded redo figures match apps/bench/src/redo-measured.json", () => {
  it("the source file is present", () => {
    expect(existsSync(REDO_JSON), `${REDO_JSON} is gone — the recorded figures have no source`).toBe(
      true,
    );
  });

  it("every token, timing and count field still agrees", () => {
    const src = JSON.parse(readFileSync(REDO_JSON, "utf8")) as Record<string, number | string>;
    expect(REDO.model).toBe(src.model);
    expect(REDO.apiCalls).toBe(src.apiCalls);
    expect(REDO.inputTokens).toBe(src.inputTokens);
    expect(REDO.outputTokens).toBe(src.outputTokens);
    expect(REDO.cacheWriteTokens).toBe(src.cacheWriteTokens);
    expect(REDO.cacheReadTokens).toBe(src.cacheReadTokens);
    expect(REDO.activeSeconds).toBe(src.activeSeconds);
    expect(REDO.elapsedSeconds).toBe(src.elapsedSeconds);
    expect(REDO.toolCalls).toBe(src.toolCalls);
    expect(REDO.subagentCalls).toBe(src.subagentCalls);
  });

  it("the floor caveat is still true: subagent spend is excluded", () => {
    const src = JSON.parse(readFileSync(REDO_JSON, "utf8")) as { subagentCalls: number };
    // The UI states the redo cost is a floor BECAUSE these dispatches are
    // unmeasured. If they ever become zero, that sentence stops being true.
    expect(src.subagentCalls).toBeGreaterThan(0);
    expect(REDO.subagentCalls).toBe(src.subagentCalls);
  });

  it("the total the UI prints is the sum of its four buckets", () => {
    expect(REDO_TOTAL_TOKENS).toBe(2_357_943);
    expect(REDO_TOTAL_TOKENS).toBe(
      REDO.inputTokens + REDO.outputTokens + REDO.cacheWriteTokens + REDO.cacheReadTokens,
    );
  });
});

describe("the stated rates match apps/bench/src/provenance.ts", () => {
  it("PUBLISHED_OPUS_5_RATES has not been repriced under us", () => {
    const src = readFileSync(PROVENANCE_TS, "utf8");
    const block = src.slice(src.indexOf("PUBLISHED_OPUS_5_RATES"));
    for (const [field, value] of Object.entries(STATED_RATES)) {
      expect(block, `provenance.ts no longer states ${field}: ${value}`).toMatch(
        new RegExp(`${field}:\\s*${String(value).replace(".", "\\.")}`),
      );
    }
  });

  it("the dollar figure the UI shows is those rates applied to those tokens", () => {
    // The same arithmetic as costUsd() in provenance.ts, and the same value the
    // doc's verbatim runner output prints.
    expect(redoCostUsd().toFixed(4)).toBe("3.9704");
  });
});

describe("recorded buy figures match apps/bench/src/ab-measured.json, to the µUSDC", () => {
  it("the money fields are the integers the gate recorded, not a rounded dollar figure", () => {
    expect(BUY.paidMicroUsdc).toBe(ab.buy.paidMicroUsdc);
    expect(BUY.quotedMicroUsdc).toBe(ab.buy.quotedMicroUsdc);
    expect(BUY.priceBaseMicroUsdc).toBe(ab.buy.priceBaseMicroUsdc);
    expect(BUY.priceFloorMicroUsdc).toBe(ab.buy.priceFloorMicroUsdc);
    expect(BUY.quotedMicroUsdc).toBe(BUY.paidMicroUsdc); // the quote served is the quote verified
  });

  it("the charge is priceAt()'s own arithmetic, which is what makes 436,700 impossible", () => {
    // priceFloor + round(priceBase × 0.5^(ageDays/halfLifeDays)), with the age
    // the run recorded. A dollar-shaped assertion cannot do this: 436,700 and
    // 436,745 both render as $0.4367, and the difference is the whole of the
    // rounding this formula does.
    const buy = ab.buy as {
      priceBaseMicroUsdc: number;
      priceFloorMicroUsdc: number;
      halfLifeDays: number;
      ageMsAtPurchaseUpperBound: number;
    };
    const oldest = Math.pow(
      0.5,
      buy.ageMsAtPurchaseUpperBound / (buy.halfLifeDays * 86_400_000),
    );
    const min = buy.priceFloorMicroUsdc + Math.round(buy.priceBaseMicroUsdc * oldest);
    const max = buy.priceFloorMicroUsdc + buy.priceBaseMicroUsdc;
    expect(BUY.paidMicroUsdc).toBeGreaterThanOrEqual(min);
    expect(BUY.paidMicroUsdc).toBeLessThanOrEqual(max);
    // The window has to stay tight enough to do the job it exists for: rejecting
    // the 436,700 this file recorded for two commits while the gate charged
    // 436,745, invisible because both render as $0.4367. A wire round trip is
    // seconds rather than milliseconds, so the window is tens of µUSDC rather
    // than one or two — asserting a fixed width would have been asserting that
    // the measurement stayed a loopback. Assert the property instead.
    expect(436_700, "the window must still exclude the figure this test was written for").toBeLessThan(
      min,
    );
    expect(max - min, "and must stay far narrower than the 45 µUSDC error it caught").toBeLessThan(45);
  });

  it("the artifact fields are the recorded artifact's", () => {
    expect(BUY.bodyBytes).toBe(ab.artifact.bytes);
    expect(BUY.bodyChars).toBe(ab.artifact.chars);
    expect(REDO.sources).toBe(ab.artifact.sources);
    expect(BUY.tokensIfFullyRead).toBe(ab.buy.tokensIfFullyRead);
    expect(BUY.tokensForSummary).toBe(ab.buy.tokensForSummary);
    expect(BUY.integrity).toBe(ab.buy.verification);
  });

  it("the latencies are the recorded ones, and the record says which kind they are", () => {
    expect(BUY.searchSeconds).toBe(ab.latency.searchSeconds);
    expect(BUY.fetchSeconds).toBe(ab.latency.fetchSeconds);
    // `false` since the wire re-measurement: the record, this app and the document
    // have to agree about that, because the caveat the UI renders depends on it.
    expect(ab.latency.isLocalFloor).toBe(false);
    expect(ab.registry.wire, "a non-floor latency must come from a wire run").toBe(true);
    expect(ab.registry.txId, "and name the transaction it paid with").toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });
});

describe("every figure this app repeats is the figure the doc's generated block states", () => {
  // Parsed key by key. The previous version of this test was a list of
  // substrings that included the bare "83" and the bare "28", either of which
  // any 13 KB document satisfies by accident.
  const expected: Array<[string, string]> = [
    ["redo.tokens.total", n0(REDO_TOTAL_TOKENS)],
    ["redo.tokens.input", n0(REDO.inputTokens)],
    ["redo.tokens.output", n0(REDO.outputTokens)],
    ["redo.tokens.cacheWrite", n0(REDO.cacheWriteTokens)],
    ["redo.tokens.cacheRead", n0(REDO.cacheReadTokens)],
    ["redo.apiCalls", n0(REDO.apiCalls)],
    ["redo.activeSeconds", REDO.activeSeconds.toFixed(1)],
    ["redo.elapsedSeconds", REDO.elapsedSeconds.toFixed(0)],
    ["redo.toolCalls", n0(REDO.toolCalls)],
    ["redo.subagentCalls", n0(REDO.subagentCalls)],
    ["redo.costUsd", `$${redoCostUsd().toFixed(4)}`],
    ["artifact.sources", n0(REDO.sources)],
    ["artifact.bytes", n0(BUY.bodyBytes)],
    ["artifact.chars", n0(BUY.bodyChars)],
    ["buy.priceBaseMicroUsdc", n0(BUY.priceBaseMicroUsdc)],
    ["buy.priceFloorMicroUsdc", n0(BUY.priceFloorMicroUsdc)],
    ["buy.paidMicroUsdc", n0(BUY.paidMicroUsdc)],
    ["buy.paidUsd", `$${(BUY.paidMicroUsdc / 1e6).toFixed(4)}`],
    ["buy.tokensForSummary", n0(BUY.tokensForSummary)],
    ["buy.tokensIfFullyRead", n0(BUY.tokensIfFullyRead)],
    ["savings.costRatio", (redoCostUsd() / (BUY.paidMicroUsdc / 1e6)).toFixed(1)],
    ["savings.usd", `$${(redoCostUsd() - BUY.paidMicroUsdc / 1e6).toFixed(4)}`],
    ["savings.tokensFullRead", n0(REDO_TOTAL_TOKENS - BUY.tokensIfFullyRead)],
  ];

  for (const [key, value] of expected) {
    it(`${key} = ${value}`, () => {
      expect(
        block.get(key),
        `docs/AB-MEASUREMENT.md's generated block has no ${key}, or states something else`,
      ).toBe(value);
    });
  }

  it("checks a figure for every money and token field the UI renders", () => {
    expect(expected.length).toBeGreaterThanOrEqual(20);
  });

  it("characters, not bytes, are the token denominator", () => {
    expect(Math.ceil(BUY.bodyChars / 4)).toBe(BUY.tokensIfFullyRead);
    expect(BUY.bodyChars).toBeLessThan(BUY.bodyBytes);
  });
});

describe("the correction stays on the page and in the UI", () => {
  it("is still on the page it cites", () => {
    expect(doc).toMatch(/fabricated/);
    expect(doc).toContain(CORRECTION.fabricated.split(" / ")[0]!); // "412s"
  });

  it("names the retracted commit and the commit that overclaimed the guard", () => {
    expect(doc).toContain("2bf4931");
    expect(doc).toContain("9ef4062");
  });

  it("the latency says which kind of number it is, and the superseded one is still named", () => {
    // The buy side WAS a loopback floor and is now a wire measurement
    // (docs/evidence/v2-full-feature-run/). Two things have to stay true rather
    // than one: the figure this app renders is the wire figure the record holds,
    // and the document still names the stamp the superseded figure carried — the
    // old number was quoted, so a reader has to be able to find what replaced it.
    expect(BUY.fetchSeconds).toBe(ab.latency.fetchSeconds);
    expect(ab.latency.isLocalFloor, "the record says this is a wire measurement").toBe(false);
    expect(BUY.fetchSeconds, "a wire purchase is seconds, not milliseconds").toBeGreaterThan(1);
    expect(doc).toMatch(/LOCAL, not a wire time/);
    expect(doc).toMatch(/WIRE MEASUREMENT: real network, real facilitator, real Hedera settlement/);
  });
});
