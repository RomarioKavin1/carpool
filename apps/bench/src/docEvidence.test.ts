/**
 * Evidence a clone cannot open is not evidence.
 *
 * This repo has had the same defect three times: a document citing figures whose
 * source was not in the repository. Once it was a unit-test fixture
 * (`docs/AB-MEASUREMENT.md`, retracted in `9ef4062`); once it was Phase 0's rater
 * data inside `.superpowers/sdd/`, whose `.gitignore` is `*` (fixed in
 * `b99e22a`); and then the *same* `.superpowers` path survived in
 * `docs/PHASE0.md` §8 — the section titled **Reproducibility** — because nothing
 * checked it.
 *
 * So this checks it. Deliberately narrow: it does not try to resolve every path
 * mentioned in every document, because the review documents are full of
 * basenames (`ledger.ts`), globs (`docs/SWARM*.md`) and honest references to v1
 * paths that no longer exist. A guard with a hundred false positives gets
 * deleted. What it enforces instead is the one rule that has actually been broken:
 *
 * 1. every evidence file the live documents cite as a *location of data* exists;
 * 2. no document cites the gitignored scratch directories as a location of data —
 *    a mention is allowed only alongside the word "gitignored", which is how the
 *    corrected text explains the history.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Paths the live documents point a reader at for evidence. Each must be openable. */
const EVIDENCE_FILES = [
  "docs/evidence/phase0-rater-data.md",
  "docs/evidence/recompute-phase0.py",
  "apps/bench/src/redo-measured.json",
  "apps/bench/src/ab-measured.json",
  "docs/AB-MEASUREMENT.md",
  "docs/PHASE0.md",
  // v2's first real testnet run (2026-09-12). README.md, CONTRACT.md,
  // docs/RUNBOOK.md, docs/RESTRUCTURE.md, docs/SWARM.md and
  // apps/registry/README.md all now cite transaction ids; these are the files a
  // reader goes to in order to check them, including a verifier that re-derives
  // the anchored Merkle root without importing anything from this repository.
  "docs/evidence/v2-first-testnet-run/README.md",
  "docs/evidence/v2-first-testnet-run/verify.py",
  "docs/evidence/v2-first-testnet-run/10-mirror-settlement-tx.json",
  "docs/evidence/v2-first-testnet-run/11-mirror-hcs-messages.json",
];

/**
 * Directories whose contents are gitignored, so nothing in them is in any clone.
 * `.superpowers/sdd/.gitignore` is `*`; `~/.claude` is outside the repo entirely.
 */
const UNCLONEABLE = [".superpowers/", ".claude/projects/"];

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", "dist", ".turbo"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

const docs = markdownFiles(REPO);

describe("cited evidence is in the repository", () => {
  it.each(EVIDENCE_FILES)("%s exists", (rel) => {
    expect(
      existsSync(join(REPO, rel)),
      `${rel} is cited as evidence by a document in this repo and is not here`,
    ).toBe(true);
  });

  it("finds documents to check, so a broken walk cannot pass silently", () => {
    expect(docs.length).toBeGreaterThan(10);
  });

  it("docs/PHASE0.md points at the committed rater data and the recompute script", () => {
    const phase0 = readFileSync(join(REPO, "docs", "PHASE0.md"), "utf8");
    expect(phase0).toContain("docs/evidence/phase0-rater-data.md");
    expect(phase0).toContain("docs/evidence/recompute-phase0.py");
  });

  it("the rater data still contains the 36-pair table every figure recomputes from", () => {
    const data = readFileSync(join(REPO, "docs", "evidence", "phase0-rater-data.md"), "utf8");
    // 36 rows of `| n | … |` in section 6. Cheap, and it fails if the table is
    // ever trimmed to prose.
    const rows = [...data.matchAll(/^\|\s*\d+\s*\|/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(36);
  });
});

describe("the embedding model's download size is one measured number, stated once", () => {
  /**
   * `apps/registry/README.md` said "~25 MB of ONNX weights" where the measurement
   * is 87 MB — an estimate from `docs/RESTRUCTURE.md` that Phase C measured and
   * only half the repo updated, leaving two documents contradicting each other
   * about the figure that governs `POST /publish`'s cold-cache 503.
   *
   * This does not re-measure: a real download happens on no CI runner (every test
   * here uses the hashed embedder), and a guard that silently skips when the cache
   * is absent is the failure mode this branch is about. It checks the weaker
   * property that is checkable everywhere — the documents agree, and the retracted
   * estimate is gone — and the READMEs carry the `du` command and the byte counts
   * so the number can be re-derived by hand.
   */
  const MEASURED = "87 MB";

  it.each(["apps/registry/README.md", "packages/carpool-tracker/README.md"])(
    "%s states the measured size",
    (rel) => {
      expect(readFileSync(join(REPO, rel), "utf8")).toContain(MEASURED);
    },
  );

  it("no document still states the retracted ~25 MB estimate for the model", () => {
    const offenders = docs.filter((f) => {
      const text = readFileSync(f, "utf8");
      return /~?25 MB/.test(text) && /model|ONNX|weights/i.test(text) && !/used to say|estimate/i.test(text);
    });
    expect(
      offenders.map((f) => f.replace(`${REPO}/`, "")),
      "the model download is 87 MB; 25 MB was a pre-measurement estimate",
    ).toEqual([]);
  });
});

describe("no document cites a gitignored path as the location of evidence", () => {
  for (const prefix of UNCLONEABLE) {
    it(`${prefix} is only ever mentioned as history, never as a source`, () => {
      const offenders: string[] = [];
      for (const file of docs) {
        const text = readFileSync(file, "utf8");
        for (const line of text.split("\n")) {
          if (!line.includes(prefix)) continue;
          // A blockquote is a quotation, not a citation: the audits and the
          // correction boxes quote the broken sentence in order to retract it.
          if (line.trimStart().startsWith(">")) continue;
          // A `~/`-rooted path is self-evidently the reader's own machine, not a
          // claim about this repository — `pnpm measure:redo -- ~/.claude/...` is
          // an instruction, not a citation.
          if (line.includes(`~/${prefix.replace(/\/$/, "")}`) || line.includes(`~/${prefix}`)) continue;
          // Allowed: sentences that exist to say the path is unusable, and the
          // audit/history entries that record the defect rather than repeat it.
          const explains =
            /gitignor|never committed|no clone|not in the repo|outside this repo|private|used to|FALSE|retracted|no longer/i.test(
              line,
            );
          if (!explains) offenders.push(`${file.replace(`${REPO}/`, "")}: ${line.trim()}`);
        }
      }
      expect(
        offenders,
        `these lines cite ${prefix}, which is in no clone of this repo, without saying so. ` +
          "If the file is evidence, commit it under docs/evidence/ and cite that instead — " +
          "see docs/PHASE0.md §8 for the sentence this rule exists because of.",
      ).toEqual([]);
    });
  }
});
