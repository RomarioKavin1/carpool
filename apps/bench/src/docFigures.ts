/**
 * The doc-drift guard's primitives. Substring containment is not one of them.
 *
 * ## What was wrong with the guard this replaces
 *
 * `ab-run.test.ts` used to hold a hand-typed list of decimal strings and assert
 * `expect(doc).toContain(figure)` over it. Three things are wrong with that, and
 * the third one bit:
 *
 * 1. **A digit sequence is not a figure.** The list contained `"28"` for the
 *    source count. Two digits are satisfied by any occurrence anywhere in a 13 KB
 *    document — including hex inside the run's own magnet
 *    (`…257de528ce3e10…`). The guard passed with the doc claiming **143**
 *    sources, which is the exact fabricated figure commit `2bf4931` published
 *    and `9ef4062` retracted. Verified: the doc was set to "143 sources" and
 *    `pnpm ab:run` reported 4 passed (4).
 * 2. **Containment cannot see a wrong figure, only a missing one.** Even for a
 *    distinctive value, `toContain("2,357,943")` stays green when the doc *also*
 *    says 9,999,999 three lines down.
 * 3. **A hand-typed list is a second copy of the numbers.** A figure could be
 *    listed without having been computed, which is the fabrication mechanism
 *    itself, one level up.
 *
 * ## What this does instead
 *
 * Every figure is **derived** from a machine-written record — never typed here —
 * and every figure carries **labelled phrase templates**: the exact text the
 * document must use, with the value in it (`"{v} unique source URLs"`). The
 * checker then, for each template:
 *
 * - builds a regex with a **numeric capture group** where `{v}` is,
 * - requires at least one match (so an absent figure fails), and
 * - requires **every** match to carry this figure's value (so a wrong figure
 *   fails, and a coincidental digit run elsewhere cannot satisfy anything,
 *   because the label has to be there too).
 *
 * That third property is the one that makes "143 sources" a red build: the
 * phrase position is checked against the measured value rather than searched
 * for a substring.
 *
 * The blockquoted correction box at the top of the document is excluded from the
 * scan on purpose: it quotes the retracted figures deliberately, and
 * `RETRACTED_FIGURES` asserts they appear *only* there.
 *
 * ## And the block that cannot drift at all
 *
 * `renderFigureBlock()` generates the document's figure table from the same
 * derived values. `pnpm ab:run` (with `CARPOOL_AB_WRITE=1`) writes it; the guard
 * re-renders it and compares. A hand edit to that block is not "a figure the
 * guard forgot to list" — it is a diff.
 */
import { PRICE_SHARE_OF_REDO_COST, floorForPrice, priceForRedoCost } from "@carpool/core";

export type FigureKind =
  /** Read out of a record produced by a run: a transcript, or the gate's own charge. */
  | "measured"
  /** Measured tokens multiplied by a stated price list. The dollars are a price list. */
  | "stated-rates"
  /** Somebody chose it. An input to the comparison, not a result of it. */
  | "policy"
  /** Arithmetic over other figures on this page. */
  | "derived"
  /** Re-measuring produces a different value: it depends on the machine or the clock. */
  | "run-dependent";

export interface DocFigure {
  /** Stable identifier. Appears in the generated block and in failure messages. */
  key: string;
  /** The value formatted exactly as the document must print it. */
  value: string;
  kind: FigureKind;
  /** Where the value came from. Printed in the generated block. */
  source: string;
  /**
   * Phrases the document must contain, `{v}` standing for the value. Each is
   * checked as a labelled position, not as a substring — see the file docstring.
   * A figure with no phrase is a figure the prose does not have to state, and
   * `abDocFigures` never produces one.
   */
  phrases: string[];
}

/** Per-MTok price list. Carried, never defaulted — see provenance.ts. */
export interface FigureRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** The committed redo record: `apps/bench/src/redo-measured.json`. */
export interface RedoRecord {
  model: string;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  activeSeconds: number;
  elapsedSeconds: number;
  toolCalls: number;
  subagentCalls: number;
}

/** The committed buy-side record: `apps/bench/src/ab-measured.json`. */
export interface AbRecord {
  artifact: { bytes: number; chars: number; sources: number; sha256: string };
  buy: {
    quotedMicroUsdc: number;
    paidMicroUsdc: number;
    priceBaseMicroUsdc: number;
    priceFloorMicroUsdc: number;
    halfLifeDays: number;
    /**
     * How old the manifest was when the gate priced it, in ms — an UPPER bound,
     * sampled after the purchase returned. The gate quotes on its own clock
     * inside `payFetch`, so the exact instant is not observable from outside;
     * the bound is, and it is enough to pin the charge to a µUSDC or two. See
     * `priceRangeFromRecord`.
     */
    ageMsAtPurchaseUpperBound: number;
    tokensIfFullyRead: number;
    tokensForSummary: number;
    /**
     * The artifact directory the summary figure was measured against. A stated
     * input: `carpool_fetch`'s receipt contains the path it wrote, and the shipped
     * default (`os.tmpdir()/carpool-artifacts`) has a different length on every
     * machine — 96 tokens on macOS standalone, 85 under turbo, on one laptop.
     */
    artifactDir: string;
    verification: string;
  };
}

const n0 = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(4)}`;

/**
 * The µUSDC window a recorded charge must fall in, from `priceAt()`'s own
 * arithmetic: `priceFloor + round(priceBase × 0.5^(ageDays / halfLifeDays))`.
 *
 * `max` is the charge at age 0 (freshness 1); `min` is the charge at the
 * recorded age bound. On a sub-second round trip the two are within a µUSDC or
 * two of each other, which is the resolution this guard needs: the dashboard
 * once recorded 436,700 µUSDC for a charge of 436,745 and nothing could see it,
 * because both render as `$0.4367`. 436,700 needs an age of ~15 s and is outside
 * any window a local round trip can produce.
 */
export function priceRangeFromRecord(buy: AbRecord["buy"]): { min: number; max: number } {
  const oldest = Math.pow(
    0.5,
    buy.ageMsAtPurchaseUpperBound / (buy.halfLifeDays * 86_400_000),
  );
  return {
    min: buy.priceFloorMicroUsdc + Math.round(buy.priceBaseMicroUsdc * oldest),
    max: buy.priceFloorMicroUsdc + buy.priceBaseMicroUsdc,
  };
}

/** The same arithmetic as `costUsd()` in provenance.ts. */
export function redoCostUsd(redo: RedoRecord, rates: FigureRates): number {
  return (
    (redo.inputTokens * rates.input +
      redo.outputTokens * rates.output +
      redo.cacheWriteTokens * rates.cacheWrite +
      redo.cacheReadTokens * rates.cacheRead) /
    1_000_000
  );
}

export function redoTotalTokens(redo: RedoRecord): number {
  return redo.inputTokens + redo.outputTokens + redo.cacheWriteTokens + redo.cacheReadTokens;
}

/**
 * The fraction of the measured redo floor the runner lists at — **the shipped
 * price rule's own share, re-exported, not a second copy of it.**
 *
 * It used to be an independent `0.1` literal here while
 * `@carpool/core`'s `PRICE_SHARE_OF_REDO_COST` said `0.15`: two numbers for one
 * decision, both presented as the default, recorded as M4 in
 * `docs/AUDIT-CLAIMS.md`. Resolved to 0.10 — the reasoning, and why 0.15 was
 * rejected, is the block comment on `PRICE_SHARE_OF_REDO_COST` in
 * `packages/carpool-core/src/pricing.ts`, which is also where the spend cap is
 * derived from it. Aliased rather than deleted because the runner's name for it
 * says what it is a fraction *of*, which the core name does not.
 *
 * The alias is what makes the contradiction unrepresentable: there is nothing
 * left here to edit apart. `priceFraction.test.ts` asserts the identity anyway,
 * so re-hardcoding a literal is a red test rather than a silent fork.
 */
export const PRICE_BASE_FRACTION_OF_REDO = PRICE_SHARE_OF_REDO_COST;

/**
 * `priceFloor` as the runner publishes it: `PRICE_FLOOR_SHARE` of the base, never
 * below `MIN_PRICE_MICRO_USDC`. Delegates to `@carpool/core`'s `floorForPrice`
 * for the same reason as above — this was a character-identical reimplementation
 * of it (`max(1_000, round(base × 0.1))`), and a duplicated policy number is a
 * contradiction waiting for one of the two copies to be edited.
 */
export function floorFor(priceBase: number): number {
  return floorForPrice(priceBase);
}

/**
 * Figures the retraction removed. They must appear in the correction box and
 * nowhere else — the box is a blockquote, so `checkDoc` strips it before
 * scanning. Sourced from the box itself, i.e. from `2bf4931`'s published table.
 */
export const RETRACTED_FIGURES: readonly string[] = [
  "195,524",
  "143 sources",
  "143 source",
  "37 tool calls",
  "$2.14",
  "$0.31",
  "412s",
  "4.2s",
];

/**
 * Every figure the document is allowed to state, derived from the two committed
 * records. Nothing in here is a literal: change a record and the expectation
 * moves with it, which is the property the old string list did not have.
 */
export function abDocFigures(redo: RedoRecord, ab: AbRecord, rates: FigureRates): DocFigure[] {
  const totalTokens = redoTotalTokens(redo);
  const costUsd = redoCostUsd(redo, rates);
  const paidUsd = ab.buy.paidMicroUsdc / 1e6;
  const inPlusOut = redo.inputTokens + redo.outputTokens;
  const cacheTokens = redo.cacheWriteTokens + redo.cacheReadTokens;

  const REDO_JSON = "apps/bench/src/redo-measured.json";
  const AB_JSON = "apps/bench/src/ab-measured.json";

  return [
    {
      key: "redo.tokens.total",
      value: n0(totalTokens),
      kind: "measured",
      source: `${REDO_JSON}: the four token buckets, summed`,
      phrases: ["{v} redo tokens", "and {v} tokens"],
    },
    {
      key: "redo.tokens.input",
      value: n0(redo.inputTokens),
      kind: "measured",
      source: `${REDO_JSON}: inputTokens`,
      phrases: ["{v} in ·"],
    },
    {
      key: "redo.tokens.output",
      value: n0(redo.outputTokens),
      kind: "measured",
      source: `${REDO_JSON}: outputTokens`,
      phrases: ["{v} out ·", "against {v} output tokens"],
    },
    {
      key: "redo.tokens.cacheWrite",
      value: n0(redo.cacheWriteTokens),
      kind: "measured",
      source: `${REDO_JSON}: cacheWriteTokens`,
      phrases: ["· {v} cache write"],
    },
    {
      key: "redo.tokens.cacheRead",
      value: n0(redo.cacheReadTokens),
      kind: "measured",
      source: `${REDO_JSON}: cacheReadTokens`,
      phrases: ["· {v} cache read"],
    },
    {
      key: "redo.tokens.inputPlusOutput",
      value: n0(inPlusOut),
      kind: "derived",
      source: `${REDO_JSON}: inputTokens + outputTokens`,
      phrases: ["— {v} — understates"],
    },
    {
      key: "redo.cacheSharePercent",
      value: `${Math.round((cacheTokens / totalTokens) * 100)}`,
      kind: "derived",
      source: `${REDO_JSON}: (cacheWrite + cacheRead) / total, rounded to a percent`,
      phrases: ["Cache traffic is {v}% of the redo tokens"],
    },
    {
      key: "redo.apiCalls",
      value: n0(redo.apiCalls),
      kind: "measured",
      source: `${REDO_JSON}: apiCalls — distinct message ids, not usage rows`,
      phrases: ["to **{v}** API calls"],
    },
    {
      key: "redo.activeSeconds",
      value: redo.activeSeconds.toFixed(1),
      kind: "measured",
      source: `${REDO_JSON}: activeSeconds (gaps ≤ 120 s, timestamps sorted)`,
      phrases: ["{v}s active"],
    },
    {
      key: "redo.elapsedSeconds",
      value: redo.elapsedSeconds.toFixed(0),
      kind: "measured",
      source: `${REDO_JSON}: elapsedSeconds`,
      phrases: ["{v}s elapsed"],
    },
    {
      key: "redo.toolCalls",
      value: n0(redo.toolCalls),
      kind: "measured",
      source: `${REDO_JSON}: toolCalls`,
      phrases: ["{v} tool calls"],
    },
    {
      key: "redo.subagentCalls",
      value: n0(redo.subagentCalls),
      kind: "measured",
      source: `${REDO_JSON}: subagentCalls — the reason every redo figure is a floor`,
      phrases: ["{v} subagent dispatches"],
    },
    {
      key: "redo.costUsd",
      value: usd(costUsd),
      kind: "stated-rates",
      source: `${REDO_JSON} tokens × the rates in the report`,
      phrases: ["**{v}** at the stated rates", "higher than {v} and"],
    },
    {
      key: "artifact.sources",
      value: n0(ab.artifact.sources),
      kind: "measured",
      source: `${AB_JSON}: artifact.sources — unique https URLs in the artifact`,
      phrases: ["**{v}** unique source URLs", "· {v} sources ·"],
    },
    {
      key: "artifact.bytes",
      value: n0(ab.artifact.bytes),
      kind: "measured",
      source: `${AB_JSON}: artifact.bytes`,
      phrases: ["{v} bytes (", "{v} bytes written"],
    },
    {
      key: "artifact.chars",
      value: n0(ab.artifact.chars),
      kind: "measured",
      source: `${AB_JSON}: artifact.chars`,
      phrases: ["({v} characters)"],
    },
    {
      key: "buy.priceBaseMicroUsdc",
      value: n0(ab.buy.priceBaseMicroUsdc),
      kind: "policy",
      source: `round(redo dollars × ${PRICE_BASE_FRACTION_OF_REDO} × 1e6)`,
      phrases: ["priceBase {v} µUSDC"],
    },
    {
      key: "buy.priceFloorMicroUsdc",
      value: n0(ab.buy.priceFloorMicroUsdc),
      kind: "policy",
      source: "max(1,000, round(priceBase × 0.1))",
      phrases: ["floor {v} µUSDC"],
    },
    {
      key: "buy.paidMicroUsdc",
      value: n0(ab.buy.paidMicroUsdc),
      kind: "measured",
      source: `${AB_JSON}: buy.paidMicroUsdc — what the x402 gate took, to the µUSDC`,
      phrases: ["charged **{v} µUSDC**"],
    },
    {
      key: "buy.paidUsd",
      value: usd(paidUsd),
      kind: "derived",
      source: "buy.paidMicroUsdc / 1e6, to four decimals",
      phrases: ["quoted {v} · paid {v}"],
    },
    {
      key: "buy.tokensForSummary",
      value: n0(ab.buy.tokensForSummary),
      kind: "measured",
      source:
        `${AB_JSON}: buy.tokensForSummary — approxTokens over the text carpool_fetch returns, ` +
        `with CARPOOL_ARTIFACT_DIR=${ab.buy.artifactDir} (the receipt names the file it wrote)`,
      phrases: ["{v} (summary)", "→ {v} summary tokens"],
    },
    {
      key: "buy.tokensIfFullyRead",
      value: n0(ab.buy.tokensIfFullyRead),
      kind: "measured",
      source: `${AB_JSON}: buy.tokensIfFullyRead — ceil(artifact.chars / 4)`,
      phrases: ["{v} (if fully read)", "the full {v} whether"],
    },
    {
      key: "savings.usd",
      value: usd(costUsd - paidUsd),
      kind: "derived",
      source: "redo dollars − buy dollars",
      phrases: ["saved: {v} ("],
    },
    {
      key: "savings.costRatio",
      value: (costUsd / paidUsd).toFixed(1),
      kind: "derived",
      source: "redo dollars ÷ buy dollars",
      phrases: ["({v}x cheaper)", "is {v}× on a floor-versus-actual comparison"],
    },
    {
      key: "savings.tokensFullRead",
      value: n0(totalTokens - ab.buy.tokensIfFullyRead),
      kind: "derived",
      source: "redo tokens − full-read tokens",
      phrases: ["saves {v} tokens"],
    },
  ];
}

/**
 * The subset of figures `README.md` quotes, with the phrases it quotes them in.
 *
 * The README was the *other* surface the fabricated numbers reached (`2bf4931`
 * put them in both), and nothing has ever checked it. It states six figures in
 * its opening box; each is checked at its labelled position by the same
 * `checkDoc` the document gets, so the README cannot drift from the record
 * either. It deliberately does not carry the generated block — it is a front
 * page, not a data table — so `checkDoc` is called on a figure list whose
 * `phrases` are README-shaped.
 */
export function abReadmeFigures(
  redo: RedoRecord,
  ab: AbRecord,
  rates: FigureRates,
): DocFigure[] {
  const byKey = new Map(abDocFigures(redo, ab, rates).map((f) => [f.key, f]));
  const phrasesByKey: Record<string, string[]> = {
    "redo.tokens.total": ["redoing it {v} tokens"],
    "redo.costUsd": ["tokens · {v} ·"],
    "redo.activeSeconds": ["{v}s of model time"],
    "buy.tokensForSummary": ["buying it {v} tokens"],
    "buy.paidUsd": ["{v} actually charged"],
    "buy.paidMicroUsdc": ["({v} µUSDC)"],
  };
  return Object.entries(phrasesByKey).map(([key, phrases]) => {
    const figure = byKey.get(key);
    if (!figure) throw new Error(`abReadmeFigures: no such figure ${key}`);
    return { ...figure, phrases };
  });
}

const BEGIN = "<!-- BEGIN GENERATED FIGURES";
const END = "<!-- END GENERATED FIGURES -->";

/**
 * The document's figure table, generated. `pnpm ab:run CARPOOL_AB_WRITE=1`
 * writes it and the guard re-renders and compares, so this block cannot drift
 * from the records by construction — only the prose around it can, which is
 * what the phrase checks are for.
 */
export function renderFigureBlock(figures: DocFigure[]): string {
  const rows = figures.map((f) => `| \`${f.key}\` | ${f.value} | ${f.kind} | ${f.source} |`);
  return [
    `${BEGIN}: written by \`pnpm ab:run\` from apps/bench/src/{redo,ab}-measured.json.`,
    "     Hand edits fail `apps/bench/src/ab-doc.test.ts`. -->",
    "",
    "| figure | value | kind | derived from |",
    "|---|---|---|---|",
    ...rows,
    "",
    END,
  ].join("\n");
}

/** Extracts the generated block, or throws — an absent block is a failure, never a pass. */
export function extractFigureBlock(doc: string): string {
  const start = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      "docs/AB-MEASUREMENT.md has no generated figure block — run `CARPOOL_AB_WRITE=1 pnpm ab:run`. " +
        "A missing block is a failure: it is the only part of the doc that cannot drift.",
    );
  }
  return doc.slice(start, end + END.length);
}

/** Parses the generated block into key → value. Used by guards that do not render it. */
export function parseFigureBlock(doc: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of extractFigureBlock(doc).split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m) out.set(m[1]!, m[2]!);
  }
  if (out.size === 0) throw new Error("the generated figure block parsed to zero figures");
  return out;
}

/** The blockquoted correction box quotes the retracted figures on purpose. */
function withoutCorrectionBox(doc: string): string {
  return doc
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A labelled numeric position: the phrase, with a capture group where the value
 * goes. `$` and `,` and `.` are allowed inside the capture so `$3.9704` and
 * `2,357,943` are single tokens, and a trailing `×`/`x` is left to the phrase.
 */
function phraseRegex(phrase: string, valuePattern = "\\$?[0-9][0-9,.]*"): RegExp {
  // Whitespace in a phrase matches any whitespace, newlines included: the prose
  // is hard-wrapped at 80 columns and a guard that broke when a sentence was
  // reflowed would be edited away rather than satisfied.
  const parts = phrase.split("{v}").map((p) => escape(p).replace(/\s+/g, "\\s+"));
  return new RegExp(parts.join(`(${valuePattern})`), "g");
}

export interface DocCheckFailure {
  key: string;
  message: string;
}

/**
 * Checks a document against derived figures. Returns every failure rather than
 * throwing on the first, so a corrupted doc names all of its problems.
 *
 * Three checks per figure, in the order they catch things:
 * 1. the phrase must be present at all (a deleted figure fails),
 * 2. every occurrence of the phrase must carry this figure's value (a *wrong*
 *    figure fails — this is the one containment could not do), and
 * 3. the generated block must agree with the derived value.
 */
export function checkDoc(
  doc: string,
  figures: DocFigure[],
  opts: {
    /**
     * Whether the document must carry the generated figure block.
     * `docs/AB-MEASUREMENT.md` does; `README.md` does not — it is a front page,
     * and its figures are checked at their labelled positions only.
     */
    requireBlock?: boolean;
  } = {},
): DocCheckFailure[] {
  const requireBlock = opts.requireBlock ?? true;
  const failures: DocCheckFailure[] = [];
  const prose = withoutCorrectionBox(doc);

  let block: Map<string, string> | null = null;
  try {
    block = parseFigureBlock(doc);
  } catch (e) {
    if (requireBlock) failures.push({ key: "<block>", message: (e as Error).message });
  }

  for (const f of figures) {
    for (const phrase of f.phrases) {
      // Every `{v}` in the phrase becomes its own capture group, so a phrase that
      // states the figure twice ("quoted {v} · paid {v}") checks both positions.
      const found = [...prose.matchAll(phraseRegex(phrase))].flatMap((m) => m.slice(1) as string[]);
      const shown = phrase.replace("{v}", f.value);
      if (found.length === 0) {
        failures.push({
          key: f.key,
          message: `the doc does not state ${f.key} = ${f.value}: expected the phrase "${shown}". ` +
            "Substring presence of the digits is not enough — the label has to be there too.",
        });
        continue;
      }
      const wrong = found.filter((v) => v !== f.value);
      if (wrong.length > 0) {
        failures.push({
          key: f.key,
          message: `the doc states ${JSON.stringify(wrong)} where ${f.key} = ${f.value} belongs ` +
            `(phrase "${phrase}"). The measurement says ${f.value}; the doc is wrong, or the ` +
            "record moved and the doc was not regenerated.",
        });
      }
    }
    if (block) {
      const inBlock = block.get(f.key);
      if (inBlock === undefined) {
        failures.push({ key: f.key, message: `the generated block has no row for ${f.key}` });
      } else if (inBlock !== f.value) {
        failures.push({
          key: f.key,
          message: `the generated block says ${f.key} = ${inBlock}, the records derive ${f.value} — ` +
            "re-run `CARPOOL_AB_WRITE=1 pnpm ab:run` rather than editing the block",
        });
      }
    }
  }

  if (block) {
    const keys = new Set(figures.map((f) => f.key));
    for (const key of block.keys()) {
      if (!keys.has(key)) {
        failures.push({ key, message: `the generated block has a row nothing derives: ${key}` });
      }
    }
  }

  for (const retracted of RETRACTED_FIGURES) {
    if (prose.includes(retracted)) {
      failures.push({
        key: "<retracted>",
        message: `"${retracted}" is one of the fabricated figures 9ef4062 retracted. It may appear ` +
          "in the correction box (a blockquote) and nowhere else.",
      });
    }
  }

  return failures;
}

/**
 * The arithmetic tying the two committed records together. This is what a
 * checkout with no artifact and no transcript can still verify — see G2 in
 * docs/AUDIT-CLAIMS.md and the "What CI can and cannot check" section of
 * docs/AB-MEASUREMENT.md.
 */
export function checkRecords(redo: RedoRecord, ab: AbRecord, rates: FigureRates): string[] {
  const problems: string[] = [];
  const costUsd = redoCostUsd(redo, rates);

  // The shipped rule itself, not a re-derivation of it: `priceForRedoCost` is
  // what `carpool_publish` charges, so the recorded run is checked against the
  // policy the product actually ships rather than against a formula that happens
  // to match it. (They differ in one place, in the rule's favour: below $0.01 of
  // redo cost the inline formula fell under the registry's 500 µUSDC tracker fee
  // and `priceForRedoCost` clamps to MIN_PRICE_MICRO_USDC.)
  const expectedBase = priceForRedoCost(costUsd);
  if (ab.buy.priceBaseMicroUsdc !== expectedBase) {
    problems.push(
      `priceBase is ${ab.buy.priceBaseMicroUsdc} µUSDC but ${PRICE_BASE_FRACTION_OF_REDO} of the ` +
        `measured redo floor is ${expectedBase} µUSDC`,
    );
  }
  const expectedFloor = floorFor(ab.buy.priceBaseMicroUsdc);
  if (ab.buy.priceFloorMicroUsdc !== expectedFloor) {
    problems.push(
      `priceFloor is ${ab.buy.priceFloorMicroUsdc} µUSDC, not max(1000, round(priceBase × 0.1)) = ${expectedFloor}`,
    );
  }
  // The charge, to the µUSDC. `paidMicroUsdc` was back-derived from a
  // four-decimal dollar rendering once (436,700 for a charge of 436,745) and
  // nothing could see it, because both render as $0.4367. This can.
  const range = priceRangeFromRecord(ab.buy);
  if (ab.buy.paidMicroUsdc < range.min || ab.buy.paidMicroUsdc > range.max) {
    problems.push(
      `paid ${ab.buy.paidMicroUsdc} µUSDC is outside priceFloor + round(priceBase × freshness) = ` +
        `[${range.min}, ${range.max}] for an artifact at most ` +
        `${ab.buy.ageMsAtPurchaseUpperBound} ms old with a ${ab.buy.halfLifeDays}-day half-life`,
    );
  }
  if (ab.buy.quotedMicroUsdc !== ab.buy.paidMicroUsdc) {
    problems.push(
      `quoted ${ab.buy.quotedMicroUsdc} µUSDC ≠ paid ${ab.buy.paidMicroUsdc} µUSDC — the gate re-priced`,
    );
  }
  if (ab.buy.tokensIfFullyRead !== Math.ceil(ab.artifact.chars / 4)) {
    problems.push(
      `tokensIfFullyRead ${ab.buy.tokensIfFullyRead} ≠ ceil(${ab.artifact.chars} chars / 4) = ` +
        `${Math.ceil(ab.artifact.chars / 4)} — approxTokens counts characters, not bytes`,
    );
  }
  if (ab.artifact.chars > ab.artifact.bytes) {
    problems.push(
      `artifact.chars ${ab.artifact.chars} > artifact.bytes ${ab.artifact.bytes}: impossible for UTF-8`,
    );
  }
  if (redo.subagentCalls <= 0) {
    problems.push("subagentCalls is 0, so the doc's 'the redo figure is a floor' clause is not true");
  }
  if (!ab.buy.artifactDir || !ab.buy.artifactDir.startsWith("/")) {
    problems.push(
      `buy.artifactDir is ${JSON.stringify(ab.buy.artifactDir)}; the summary token figure is only ` +
        "reproducible against a stated absolute directory",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(ab.artifact.sha256)) {
    problems.push(`artifact.sha256 is not a sha256: ${ab.artifact.sha256}`);
  }
  return problems;
}
