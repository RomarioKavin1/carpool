/**
 * Tests for the guard, not for the measurement.
 *
 * A guard that is never itself tested is how the last one came to be vacuous:
 * `expect(doc).toContain("28")` was never asked whether it could fail. Each case
 * below is a corruption the old guard passed, asserted here to produce a
 * specific, named failure.
 */
import { describe, expect, it } from "vitest";
import {
  abDocFigures,
  checkDoc,
  checkRecords,
  extractFigureBlock,
  parseFigureBlock,
  priceRangeFromRecord,
  renderFigureBlock,
  type AbRecord,
  type RedoRecord,
} from "./docFigures.js";

const RATES = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

const redo: RedoRecord = {
  model: "test/fixture-model",
  apiCalls: 25,
  inputTokens: 48,
  outputTokens: 83_177,
  cacheWriteTokens: 131_024,
  cacheReadTokens: 2_143_694,
  activeSeconds: 630.902,
  elapsedSeconds: 6059.039,
  toolCalls: 22,
  subagentCalls: 4,
};

const ab: AbRecord = {
  artifact: { bytes: 45_896, chars: 45_417, sources: 28, sha256: "a".repeat(64) },
  buy: {
    quotedMicroUsdc: 436_745,
    paidMicroUsdc: 436_745,
    priceBaseMicroUsdc: 397_041,
    priceFloorMicroUsdc: 39_704,
    halfLifeDays: 1,
    ageMsAtPurchaseUpperBound: 56,
    tokensIfFullyRead: 11_355,
    tokensForSummary: 85,
    artifactDir: "/tmp/carpool-artifacts",
    verification: "verified",
  },
};

const figures = abDocFigures(redo, ab, RATES);

/** A minimal document that satisfies every phrase, built from the figures themselves. */
function goodDoc(): string {
  const v = (key: string) => figures.find((f) => f.key === key)!.value;
  return [
    "# fixture",
    "",
    "> the correction box quotes 143 sources, 195,524 tokens, 37 tool calls, $2.14, $0.31, 412s, 4.2s",
    "",
    `the artifact is ${v("artifact.bytes")} bytes (${v("artifact.chars")} characters) with`,
    `**${v("artifact.sources")}** unique source URLs`,
    "",
    "```",
    `  wall clock                ${v("redo.activeSeconds")}s active`,
    `                             ${v("redo.elapsedSeconds")}s elapsed`,
    `  tokens                 ${v("redo.tokens.total")}    ${v("buy.tokensForSummary")} (summary)`,
    `                                        ${v("buy.tokensIfFullyRead")} (if fully read)`,
    `  saved: ${v("savings.usd")} (${v("savings.costRatio")}x cheaper)`,
    `    x · ${v("redo.tokens.input")} in · ${v("redo.tokens.output")} out · ${v("redo.tokens.cacheWrite")} cache write · ${v("redo.tokens.cacheRead")} cache read`,
    `    ${v("redo.toolCalls")} tool calls · ${v("artifact.sources")} sources · rows 8..222`,
    `    quoted ${v("buy.paidUsd")} · paid ${v("buy.paidUsd")} · priceBase ${v("buy.priceBaseMicroUsdc")} µUSDC · floor ${v("buy.priceFloorMicroUsdc")} µUSDC`,
    `    ${v("artifact.bytes")} bytes written · integrity verified`,
    `  REDO IS A FLOOR: ${v("redo.subagentCalls")} subagent dispatches spent tokens`,
    "```",
    "",
    `The gate charged **${v("buy.paidMicroUsdc")} µUSDC**, and the 56 usage rows collapse`,
    `to **${v("redo.apiCalls")}** API calls. The redo side costs **${v("redo.costUsd")}** at the stated rates.`,
    `Cache traffic is ${v("redo.cacheSharePercent")}% of the redo tokens: ${v("redo.tokens.cacheRead")} cache reads`,
    `and ${v("redo.tokens.cacheWrite")} cache writes against ${v("redo.tokens.output")} output tokens.`,
    `Counting only input+output — ${v("redo.tokens.inputPlusOutput")} — understates it.`,
    `${v("redo.costUsd")} → ${v("buy.paidUsd")} is ${v("savings.costRatio")}× on a floor-versus-actual comparison,`,
    `and ${v("redo.tokens.total")} redo tokens → ${v("buy.tokensForSummary")} summary tokens.`,
    `Even a full read saves ${v("savings.tokensFullRead")} tokens, and inline the buyer pays`,
    `the full ${v("buy.tokensIfFullyRead")} whether they needed it or not.`,
    `The cost is higher than ${v("redo.costUsd")} and ${v("redo.tokens.total")} tokens.`,
    "",
    renderFigureBlock(figures),
    "",
  ].join("\n");
}

describe("the fixture document is itself clean", () => {
  it("passes with no failures, so every failure below is caused by its corruption", () => {
    expect(checkDoc(goodDoc(), figures)).toEqual([]);
  });
});

describe("corrupting one figure at a time", () => {
  // The table the old guard could not produce: each figure, corrupted alone, and
  // the specific complaint it must raise.
  const corruptions: Array<[string, string, string]> = [
    ["artifact.sources", "**28** unique source URLs", "**143** unique source URLs"],
    ["redo.tokens.total", "2,357,943 redo tokens", "9,999,999 redo tokens"],
    ["redo.tokens.output", "83,177 out ·", "83,178 out ·"],
    ["redo.tokens.cacheWrite", "· 131,024 cache write", "· 999,999 cache write"],
    ["redo.tokens.cacheRead", "· 2,143,694 cache read", "· 1 cache read"],
    ["redo.activeSeconds", "630.9s active", "60.0s active"],
    ["redo.elapsedSeconds", "6059s elapsed", "60s elapsed"],
    ["redo.toolCalls", "22 tool calls", "777 tool calls"],
    ["redo.subagentCalls", "4 subagent dispatches", "0 subagent dispatches"],
    ["redo.costUsd", "**$3.9704** at the stated rates", "**$2.1400** at the stated rates"],
    ["redo.apiCalls", "to **25** API calls", "to **56** API calls"],
    ["redo.cacheSharePercent", "Cache traffic is 96%", "Cache traffic is 42%"],
    ["artifact.bytes", "45,896 bytes written", "1 bytes written"],
    ["artifact.chars", "(45,417 characters)", "(1 characters)"],
    ["buy.priceBaseMicroUsdc", "priceBase 397,041 µUSDC", "priceBase 1 µUSDC"],
    ["buy.priceFloorMicroUsdc", "floor 39,704 µUSDC", "floor 1 µUSDC"],
    ["buy.paidMicroUsdc", "charged **436,745 µUSDC**", "charged **436,700 µUSDC**"],
    ["buy.paidUsd", "quoted $0.4367 · paid $0.4367", "quoted $0.0100 · paid $0.0100"],
    ["buy.tokensForSummary", "85 (summary)", "8300 (summary)"],
    ["buy.tokensIfFullyRead", "11,355 (if fully read)", "1 (if fully read)"],
    ["savings.usd", "saved: $3.5337 (", "saved: $0.0001 ("],
    ["savings.costRatio", "(9.1x cheaper)", "(99.0x cheaper)"],
    ["savings.tokensFullRead", "saves 2,346,588 tokens", "saves 1 tokens"],
    ["redo.tokens.inputPlusOutput", "— 83,225 — understates", "— 1 — understates"],
    ["redo.tokens.input", "48 in ·", "1 in ·"],
  ];

  for (const [key, from, to] of corruptions) {
    it(`fails on ${key}, naming it`, () => {
      const doc = goodDoc();
      expect(doc, `the fixture does not contain "${from}"`).toContain(from);
      const failures = checkDoc(doc.replace(from, to), figures);
      expect(failures.length, `corrupting ${key} produced no failure`).toBeGreaterThan(0);
      expect(failures.map((f) => f.key)).toContain(key);
    });
  }

  it("covers every figure the runner derives", () => {
    // So a figure cannot be added to the block without a corruption test that
    // proves the guard can see it.
    expect(new Set(corruptions.map(([k]) => k))).toEqual(new Set(figures.map((f) => f.key)));
  });
});

describe("what the old substring guard could not do", () => {
  it("is not satisfied by the digits appearing inside the run's own magnet", () => {
    const doc = goodDoc()
      .replace("**28** unique source URLs", "**143** unique source URLs")
      .replace("· 28 sources ·", "· 143 sources ·");
    // The magnet really does contain "28" in hex: this is the exact string the
    // old `expect(doc).toContain("28")` was satisfied by.
    const withMagnet = doc.replace(
      "# fixture",
      "# fixture\nswarm:bfc4cc5fb7907c75ce544365d57e22baab5f257de528ce3e10759fe99e6aedf3",
    );
    const failures = checkDoc(withMagnet, figures);
    expect(failures.map((f) => f.key)).toContain("artifact.sources");
  });

  it("rejects a retracted figure re-entering the prose", () => {
    const doc = goodDoc().replace("rows 8..222", "rows 8..222 · 143 sources");
    expect(checkDoc(doc, figures).map((f) => f.key)).toContain("<retracted>");
  });

  it("tolerates the retracted figures inside the blockquoted correction box", () => {
    expect(goodDoc()).toContain("143 sources");
    expect(checkDoc(goodDoc(), figures)).toEqual([]);
  });

  it("fails when a figure is deleted rather than changed", () => {
    const doc = goodDoc().replace("**28** unique source URLs", "many unique source URLs");
    const failures = checkDoc(doc, figures).filter((f) => f.key === "artifact.sources");
    expect(failures[0]!.message).toMatch(/does not state/);
  });

  it("fails when the generated block is hand-edited", () => {
    const doc = goodDoc().replace("| `artifact.sources` | 28 |", "| `artifact.sources` | 143 |");
    expect(checkDoc(doc, figures).map((f) => f.message).join("\n")).toMatch(
      /generated block says artifact\.sources = 143/,
    );
  });

  it("fails when the generated block is missing entirely", () => {
    const doc = goodDoc().replace(extractFigureBlock(goodDoc()), "");
    expect(checkDoc(doc, figures).map((f) => f.key)).toContain("<block>");
  });

  it("fails when the block carries a figure nothing derives", () => {
    const doc = goodDoc().replace(
      "<!-- END GENERATED FIGURES -->",
      "| `invented.figure` | 7 | measured | nowhere |\n<!-- END GENERATED FIGURES -->",
    );
    expect(checkDoc(doc, figures).map((f) => f.key)).toContain("invented.figure");
  });

  it("is tolerant of the prose being reflowed, since 80-column wrapping moves phrases", () => {
    const doc = goodDoc().replace("**28** unique source URLs", "**28**\nunique source URLs");
    expect(checkDoc(doc, figures)).toEqual([]);
  });
});

describe("parsing and rendering the block", () => {
  it("round-trips every figure", () => {
    const parsed = parseFigureBlock(renderFigureBlock(figures));
    expect(parsed.size).toBe(figures.length);
    for (const f of figures) expect(parsed.get(f.key)).toBe(f.value);
  });

  it("throws rather than returning nothing when there is no block", () => {
    expect(() => parseFigureBlock("# a doc with no block")).toThrow(/no generated figure block/);
  });
});

describe("checkRecords", () => {
  it("passes on the committed shape", () => {
    expect(checkRecords(redo, ab, RATES)).toEqual([]);
  });

  it("catches a µUSDC charge that was back-derived from a four-decimal dollar figure", () => {
    // 436,700 and 436,745 both render as $0.4367. This is the defect that
    // survived in apps/dashboard/lib/measured.ts.
    const problems = checkRecords(
      redo,
      { ...ab, buy: { ...ab.buy, quotedMicroUsdc: 436_700, paidMicroUsdc: 436_700 } },
      RATES,
    );
    expect(problems.join("\n")).toMatch(/outside priceFloor \+ round/);
  });

  it("catches a priceBase that is no longer 10% of the measured redo floor", () => {
    const problems = checkRecords(
      redo,
      { ...ab, buy: { ...ab.buy, priceBaseMicroUsdc: 500_000 } },
      RATES,
    );
    expect(problems.join("\n")).toMatch(/priceBase is 500000/);
  });

  it("catches a quote that is not what was paid", () => {
    const problems = checkRecords(redo, { ...ab, buy: { ...ab.buy, quotedMicroUsdc: 1 } }, RATES);
    expect(problems.join("\n")).toMatch(/the gate re-priced/);
  });

  it("catches bytes counted where characters belong", () => {
    const problems = checkRecords(
      redo,
      { ...ab, buy: { ...ab.buy, tokensIfFullyRead: 11_474 } },
      RATES,
    );
    expect(problems.join("\n")).toMatch(/approxTokens counts characters, not bytes/);
  });

  it("catches a zero subagent count, which would falsify the floor caveat", () => {
    expect(checkRecords({ ...redo, subagentCalls: 0 }, ab, RATES).join("\n")).toMatch(
      /is not true/,
    );
  });
});

describe("priceRangeFromRecord", () => {
  it("is a window of a µUSDC or two for a sub-second round trip", () => {
    const { min, max } = priceRangeFromRecord(ab.buy);
    expect(max).toBe(436_745);
    expect(max - min).toBeLessThanOrEqual(2);
  });

  it("would have to be a 15-second round trip to admit 436,700", () => {
    // States the sensitivity as an assertion rather than as a comment: the
    // guard's resolution is the whole point of recording µUSDC.
    const at15s = priceRangeFromRecord({ ...ab.buy, ageMsAtPurchaseUpperBound: 15_000 });
    expect(at15s.min).toBeLessThanOrEqual(436_700);
    expect(priceRangeFromRecord({ ...ab.buy, ageMsAtPurchaseUpperBound: 1_000 }).min).toBeGreaterThan(
      436_700,
    );
  });
});
