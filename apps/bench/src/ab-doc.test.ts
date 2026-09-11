/**
 * The doc guard that never skips.
 *
 * `ab-run.test.ts` needs the artifact and the producing session's transcript,
 * both outside the repo, so on `ubuntu-latest` with a bare checkout the whole
 * file skipped — and with it the repo's only check that
 * `docs/AB-MEASUREMENT.md` still says what was measured. CI reported
 * `42 passed | 4 skipped` and exited 0. A skip that looks like a pass is the
 * failure mode; this file is the part that needs nothing but the repository, so
 * it runs everywhere and fails everywhere.
 *
 * What it can honestly check without the artifact or the transcript:
 *
 * - the document states every figure the two committed records derive, at its
 *   labelled position, and states no other value in those positions;
 * - the generated figure block is exactly what the records render to;
 * - the records agree with each other's arithmetic — `priceBase` is 10% of the
 *   redo dollars, `priceFloor` is `max(1,000, round(priceBase × 0.1))`, the
 *   charge is `priceFloor + round(priceBase × freshness)` at the recorded age,
 *   the full read is `ceil(characters / 4)`;
 * - the records are records, not placeholders;
 * - the retraction is still on the page, and the retracted figures appear only
 *   inside it.
 *
 * What it cannot: whether the records match the artifact and the transcript.
 * That needs the inputs, and only `ab-run.test.ts` on a machine that has them
 * can say so. The document says which is which rather than implying both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLISHED_OPUS_5_RATES } from "./provenance.js";
import {
  abDocFigures,
  abReadmeFigures,
  checkDoc,
  checkRecords,
  extractFigureBlock,
  renderFigureBlock,
  type AbRecord,
} from "./docFigures.js";
import redoMeasured from "./redo-measured.json" with { type: "json" };
import abMeasured from "./ab-measured.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const AB_DOC = resolve(here, "../../../docs/AB-MEASUREMENT.md");

const record: AbRecord = abMeasured;
const doc = readFileSync(AB_DOC, "utf8");
const figures = abDocFigures(redoMeasured, record, PUBLISHED_OPUS_5_RATES);

describe("docs/AB-MEASUREMENT.md against the committed records", () => {
  it("states every derived figure at its labelled position, and no other value there", () => {
    const failures = checkDoc(doc, figures);
    expect(
      failures.map((f) => `${f.key}: ${f.message}`),
      "docs/AB-MEASUREMENT.md disagrees with apps/bench/src/{redo,ab}-measured.json",
    ).toEqual([]);
  });

  it("carries the generated figure block verbatim", () => {
    // Byte equality, not per-key: the block is output, so any hand edit — a
    // reordered row, a changed `kind`, a prettified number — is a diff.
    expect(extractFigureBlock(doc)).toBe(renderFigureBlock(figures));
  });

  it("derives at least twenty figures, so the guard cannot be quietly emptied", () => {
    // The guard this replaced was a seven-entry hand-typed list. A future edit
    // that drops figures out of `abDocFigures` would silently shrink the checked
    // surface back down, which is the same defect in a new place.
    expect(figures.length).toBeGreaterThanOrEqual(20);
    expect(figures.every((f) => f.phrases.length > 0)).toBe(true);
  });
});

describe("README.md against the same records", () => {
  // The fabricated figures reached the README too (`2bf4931` wrote both), and
  // until now nothing checked it. Its opening box states six of them.
  const readme = readFileSync(resolve(here, "../../../README.md"), "utf8");
  const readmeFigures = abReadmeFigures(redoMeasured, record, PUBLISHED_OPUS_5_RATES);

  it("states the six figures in its opening box, each at its labelled position", () => {
    const failures = checkDoc(readme, readmeFigures, { requireBlock: false });
    expect(
      failures.map((f) => `${f.key}: ${f.message}`),
      "README.md disagrees with apps/bench/src/{redo,ab}-measured.json",
    ).toEqual([]);
  });

  it("still carries both corrections and the floor caveats", () => {
    expect(readme).toContain("2bf4931");
    expect(readme).toContain("9ef4062");
    expect(readme).toMatch(/floors/);
    expect(readme).toMatch(/does not claim a wall-clock ratio/);
  });
});

describe("the committed records", () => {
  it("agree with each other's arithmetic, to the µUSDC", () => {
    expect(checkRecords(redoMeasured, record, PUBLISHED_OPUS_5_RATES)).toEqual([]);
  });

  it("are records, not the placeholder", () => {
    expect(
      record.artifact.sha256,
      "apps/bench/src/ab-measured.json is still the placeholder — run " +
        "`CARPOOL_AB_ARTIFACT=<artifact> CARPOOL_AB_WRITE=1 pnpm ab:run`",
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(record.buy.paidMicroUsdc).toBeGreaterThan(0);
    expect(record.buy.tokensForSummary).toBeGreaterThan(0);
    expect(record.artifact.sources).toBeGreaterThan(0);
    expect(record.buy.verification).toBe("verified");
  });
});

describe("the retraction", () => {
  it("is still on the page, naming both commits", () => {
    expect(doc).toMatch(/fabricated/);
    expect(doc, "2bf4931 published the fabricated figures").toContain("2bf4931");
    expect(doc, "9ef4062 retracted them and overclaimed the guard").toContain("9ef4062");
  });

  it("says the drift guard used to be vacuous, where a reader will see it", () => {
    // The false sentence is in a commit message and cannot be edited. The
    // correction has to live where the figures live.
    expect(doc).toMatch(/cannot drift from the run in either direction/);
    expect(doc).toMatch(/toContain/);
  });

  it("says which figures the guard deliberately does not pin, and why", () => {
    expect(doc).toMatch(/run-dependent/);
    expect(doc).toMatch(/not a wire time/);
  });

  it("says what CI can and cannot verify", () => {
    expect(doc).toMatch(/What CI can check, and what it cannot/);
  });
});
