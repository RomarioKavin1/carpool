/**
 * The A/B runner. This is the thing that was missing.
 *
 * `docs/AB-MEASUREMENT.md` used to publish a results table that no code
 * produced: `computeAb`/`renderAb` had no caller outside their own unit test, so
 * the doc's figures were that test's fixture literals. This file is the caller.
 * Every buy-side number in the doc comes out of a run of this file.
 *
 * It is a `.test.ts` because that is how this repo drives the real registry
 * in-process — `apps/mcp/src/e2e.test.ts` established the pattern, and the
 * reason is the same: `apps/registry/src/testing/harness.ts` boots the REAL
 * registry app against a stub facilitator and a stub mirror node, with the
 * network-free hashed embedder injected. `pnpm --filter @carpool/bench ab:run`
 * runs just this file; `CARPOOL_AB_OUT=<path>` makes it write its report.
 *
 * ## What is real here and what is stubbed
 *
 * REAL in both modes: the registry app, its database, its `priceAt()` pricing,
 * the x402 PaymentGate, `publishArtifact()` from apps/mcp,
 * `RegistryClient.search()`, `payFetch()` including the pre-payment integrity
 * check, and the artifact — this repo's own ETHOnline 2026 prize analysis,
 * 45,896 bytes of it.
 *
 * **Default (no `CARPOOL_AB_LIVE_REGISTRY`)**: the x402 facilitator and the
 * Hedera mirror node are STUBBED and the registry is in-process, so nothing
 * settles on a real ledger and nothing crosses a real network. The buy-side
 * latency is then a FLOOR — the opposite direction from the redo-side floor —
 * and the report says so rather than passing it off as a wire measurement.
 *
 * **`CARPOOL_AB_LIVE_REGISTRY=<base>`**: the round trip runs against a registry
 * already listening on a real port with real Hedera credentials, the real
 * Blocky402 facilitator, real Hedera testnet and the registry's real ONNX
 * embedder, paid for by a real funded buyer account. Nothing is stubbed; the
 * latency is a wire measurement and `renderAb` prints its scope rather than the
 * floor caveat. This is how the figure in `docs/AB-MEASUREMENT.md` stopped being
 * stub-derived — see `docs/evidence/v2-full-feature-run/`, which holds the
 * transaction the recorded run paid with.
 *
 * The repo's earlier real-testnet evidence from v1 (60 paid requests, batch
 * `0.0.10475802@1789137942.760688301`) is not blended into these numbers.
 *
 * ## Why this skips instead of failing when inputs are absent
 *
 * The artifact and the producing session's transcript both live outside the
 * repo (the transcript is in a private `~/.claude` directory). A checkout
 * without them cannot run the measurement, and pretending otherwise is how
 * fabricated numbers get in. So: present → measure; absent → skip loudly,
 * naming the override. The doc states the run it was generated from.
 *
 * **But a skip must not be able to look like a pass.** That was the second
 * defect: this whole file lived under `describe.skipIf`, so on `ubuntu-latest`
 * with a bare checkout the repo's headline anti-fabrication check evaporated and
 * CI went green. Two changes fix it:
 *
 * - the half of the guard that needs no artifact and no transcript moved to
 *   `ab-doc.test.ts`, which **never** skips: it checks the document and the
 *   dashboard against the two committed records, and their arithmetic against
 *   each other;
 * - this file always writes a status file when `CARPOOL_AB_STATUS` is set, and
 *   `scripts/check-ab-status.mjs` (wired into CI) fails if that file is missing
 *   or says the measurement was not verified while `CARPOOL_AB_STRICT=1` asked
 *   for it. Absence of evidence now produces a specific, loud line rather than a
 *   green tick.
 *
 * `CARPOOL_AB_WRITE=1` makes a verified run rewrite `ab-measured.json` and the
 * generated figure block in `docs/AB-MEASUREMENT.md`, so the document's numbers
 * are produced by the run rather than transcribed after it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrivateKey } from "@x402/hedera";
import { freshness, priceAt, priceForRedoCost } from "@carpool/core";
import {
  newAuthor,
  startRegistry,
  type AuthorKeypair,
  type RegistryHarness,
} from "../../registry/src/testing/harness.js";
import { hashedEmbedder } from "../../registry/src/testing/hashedEmbedder.js";
import { approxTokens, computeAb, renderAb, type RedoCost } from "./ab.js";
import {
  PUBLISHED_OPUS_5_RATES,
  costUsd,
  measureSegment,
  parseTranscript,
  totalTokens,
} from "./provenance.js";
import {
  PRICE_BASE_FRACTION_OF_REDO,
  abDocFigures,
  checkDoc,
  checkRecords,
  extractFigureBlock,
  floorFor,
  priceRangeFromRecord,
  renderFigureBlock,
  type AbRecord,
} from "./docFigures.js";
import redoMeasured from "./redo-measured.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));

/** The artifact under measurement. Outside the repo, so overridable. */
const ARTIFACT_PATH =
  process.env.CARPOOL_AB_ARTIFACT ??
  resolve(here, "../../../../ethonline2026/ETHOnline-2026-research.md");

/** The producing session's transcript. Absent → the recorded measurement is trusted but unverified. */
const TRANSCRIPT_PATH = process.env.CARPOOL_AB_TRANSCRIPT ?? redoMeasured.segment.transcript;

const QUESTION =
  "What are all the ETHOnline 2026 prize tracks, how do they compose, and what should we build?";

const ABSTRACT =
  "Every ETHOnline 2026 prize track across 11 sponsors, tabulated with a compose graph showing " +
  "which prizes stack, plus the continuity-pool finding and four candidate project ideas.";

// `PRICE_BASE_FRACTION_OF_REDO` is a POLICY CHOICE, not a measurement: list at
// 10% of the measured redo floor. It lives in `docFigures.ts` because the
// generated figure block derives `priceBase` from it — a number the document
// prints must not be able to disagree with the number the runner published at.
//
// It is no longer a number this file owns. It is `@carpool/core`'s
// `PRICE_SHARE_OF_REDO_COST`, re-exported: the runner used to list at 10% while
// the shipped `carpool_publish` rule priced at 15% and the buyer's spend cap was
// derived from that 15%, so the repo's own worked example was priced by a policy
// the product does not ship (docs/AUDIT-CLAIMS.md M4). Resolved to 0.10 — the
// reasoning, including why 0.15 was rejected and what measurement would flip it,
// is the block comment on `PRICE_SHARE_OF_REDO_COST` in
// `packages/carpool-core/src/pricing.ts`. `priceFraction.test.ts` asserts the
// identity, and this run now publishes through `priceForRedoCost()` — the shipped
// rule — instead of recomputing the same product inline.
//
// The price the report quotes is whatever `priceAt()` returns for that base at
// the artifact's age — the runner does not pick the output price. But it does
// pick this input, and 10% is a judgement call: low enough that buying is
// obviously worth it against redoing, high enough to be a real sale. Since the
// redo figure it is a fraction OF is itself a floor, the resulting ratio is
// conservative in the buyer's favour and generous in nobody's.

/** The committed record this run is checked against, and rewrites under CARPOOL_AB_WRITE=1. */
const AB_RECORD_PATH = resolve(here, "./ab-measured.json");

/**
 * The artifact directory the summary-token figure is measured against. A stated
 * input, recorded in `ab-measured.json` as `buy.artifactDir` and printed in the
 * document, because `apps/mcp/src/server.ts` puts the output path inside the text
 * `carpool_fetch` returns and its default (`os.tmpdir()/carpool-artifacts`) is a
 * different length on every machine. This is a value `CARPOOL_ARTIFACT_DIR` can
 * legitimately hold, so the figure is still "what the tool returns" — for a
 * deployment configured this way, which the document says.
 */
const SUMMARY_ARTIFACT_DIR = "/tmp/carpool-artifacts";
const AB_DOC_PATH = resolve(here, "../../../docs/AB-MEASUREMENT.md");

const artifactPresent = existsSync(ARTIFACT_PATH);
const transcriptPresent = existsSync(TRANSCRIPT_PATH);
const strict = process.env.CARPOOL_AB_STRICT === "1";

/**
 * `CARPOOL_AB_WRITE=1` ESTABLISHES the committed record instead of checking
 * against it: the comparisons that would otherwise compare this run to itself
 * are skipped, and say so. Every other run — including CI, which has no artifact
 * — verifies.
 */
const writing = process.env.CARPOOL_AB_WRITE === "1";
if (writing) {
  console.warn(
    "[ab-run] CARPOOL_AB_WRITE=1: rewriting apps/bench/src/ab-measured.json and the generated " +
      "figure block in docs/AB-MEASUREMENT.md from THIS run. The record-comparison assertions are " +
      "skipped for this run because they would be comparing the run to itself. Re-run without the " +
      "flag to verify.",
  );
}

/** The committed buy-side record, read from disk so a write in this process is visible. */
const recordedAb = (): AbRecord => JSON.parse(readFileSync(AB_RECORD_PATH, "utf8")) as AbRecord;

if (!artifactPresent) {
  console.warn(
    `[ab-run] SKIPPING the measurement: no artifact at ${ARTIFACT_PATH}. ` +
      "Set CARPOOL_AB_ARTIFACT to the file to measure. " +
      "docs/AB-MEASUREMENT.md is still guarded — see ab-doc.test.ts, which never skips.",
  );
}

/**
 * What this run was actually able to verify, written where a CI step can read
 * it. A skip that leaves no trace is indistinguishable from a pass, which is
 * exactly how "the repo's headline check" came to run on one laptop only.
 */
const status = {
  artifactPath: ARTIFACT_PATH,
  artifactPresent,
  transcriptPath: TRANSCRIPT_PATH,
  transcriptPresent,
  /** True only when the committed redo record was re-derived from the transcript in THIS run. */
  redoReDerived: false,
  /** True only when the real publish → search → pay → verify round trip ran in THIS run. */
  roundTripRan: false,
  strict,
  node: process.version,
  finishedAt: "",
};

function writeStatus(): void {
  status.finishedAt = new Date().toISOString();
  const out = process.env.CARPOOL_AB_STATUS;
  if (out) writeFileSync(out, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

let harness: RegistryHarness;
let author: AuthorKeypair;

/**
 * The base URL of a registry that is ALREADY RUNNING with real credentials, or
 * undefined for the in-process stub run.
 *
 * `docs/AB-MEASUREMENT.md`'s buy-side latency was labelled a floor because it was
 * measured against `startRegistry()` — an in-process app, a stub facilitator, a
 * stub mirror node and a network-free embedder. Setting this points the same
 * publish → search → pay → verify round trip at a real registry on a real port,
 * against the real Blocky402 facilitator and real Hedera testnet, so the number
 * is a wire measurement.
 *
 * It changes three recorded figures and nothing else: the latencies (seconds, not
 * milliseconds), `buy.paidMicroUsdc` (the manifest is older by the time a real
 * round trip prices it, and `priceAt()` decays continuously), and
 * `buy.tokensForSummary` (the receipt ends `Transaction: <txId>`, and a real
 * transaction id is longer than the stub's). `latencyIsLocalFloor` is then false,
 * and `renderAb` prints the wire scope statement instead of the floor caveat.
 *
 * Everything the run verifies about the artifact, the price rule, the integrity
 * check and the document is unchanged: the same assertions run either way.
 */
const LIVE = process.env.CARPOOL_AB_LIVE_REGISTRY;
/** The registry's declared embedding model, for the report line. Live runs only. */
let liveEmbedder = "";
/** Where the round trip is driven. A real port when LIVE, the harness otherwise. */
const registryBase = () => LIVE ?? harness.base;

/**
 * Never skipped. Its job is to make the *absence* of a measurement visible: it
 * writes the status file CI reads, and under `CARPOOL_AB_STRICT=1` (the release
 * checklist, and any machine that claims to have the inputs) it fails rather
 * than skipping.
 */
// File-level, not inside the describe: a hook inside the first block fires
// before the measurement block has run, which recorded "nothing was verified" on
// a run that verified everything. Exactly the reporting failure this file is
// about, in the reporting itself.
afterAll(writeStatus);

describe("A/B run: what this machine could verify", () => {
  it("records whether the inputs were present, and refuses to skip quietly under CARPOOL_AB_STRICT=1", () => {
    if (!strict) {
      // Not a pass for the measurement — a pass for *having said so*. The
      // status file and the console warning above are the report.
      expect(typeof artifactPresent).toBe("boolean");
      return;
    }
    expect(artifactPresent, `CARPOOL_AB_STRICT=1 but no artifact at ${ARTIFACT_PATH}`).toBe(true);
    expect(transcriptPresent, `CARPOOL_AB_STRICT=1 but no transcript at ${TRANSCRIPT_PATH}`).toBe(
      true,
    );
  });
});

describe.skipIf(!artifactPresent)("A/B: redo the research, or buy it", () => {
  let body: string;
  let redo: RedoCost;
  let report: string;
  /** What this run measured, in the shape `ab-measured.json` commits. Null until the buy runs. */
  let liveRecord: AbRecord | null = null;
  /** Age bound the gate priced at, for the µUSDC window in the record comparison. */
  let ageMsAtPurchaseUpperBound = 0;

  beforeAll(async () => {
    body = readFileSync(ARTIFACT_PATH, "utf8");

    if (LIVE) {
      // A WIRE measurement. `base` is a registry already running on a real port
      // with real credentials, pointed at the real Blocky402 facilitator and real
      // Hedera testnet; the author and buyer are real funded accounts supplied in
      // the environment. Nothing is stubbed, so nothing needs pinning — see the
      // `LIVE` docstring for why the recorded figures move.
      for (const v of [
        "CARPOOL_AB_LIVE_REGISTRY",
        "CARPOOL_AUTHOR_ACCOUNT_ID",
        "CARPOOL_AUTHOR_PRIVATE_KEY",
        "CARPOOL_BUYER_ACCOUNT_ID",
        "CARPOOL_BUYER_PRIVATE_KEY",
      ]) {
        if (!process.env[v]) throw new Error(`CARPOOL_AB_LIVE_REGISTRY is set but ${v} is not`);
      }
      const wk = (await (await fetch(`${LIVE}/.well-known/carpool`)).json()) as {
        embedding: { model: string };
      };
      liveEmbedder = wk.embedding.model;
      process.env.CARPOOL_MAX_MICRO_USDC ??= "5000000";
      return;
    }

    harness = await startRegistry({ similarityThreshold: 0.4, embedder: hashedEmbedder() });
    author = newAuthor("0.0.1111");

    // NOT pinned, deliberately. `buy.tokensForSummary` is `approxTokens()` of the
    // text `carpool_fetch` returns, and that text ends `Transaction: <txId>` — so
    // the published figure moves with the *length of the transaction id*.
    //
    // This line used to read `harness.facilitator.txId = "0.0.2222@1-1"`, pinning
    // the stub to a 12-character id so that the then-committed figure of 85 stayed
    // reproducible. That was the right call while the record was a stub
    // measurement and the alternative was re-cutting a published number as a side
    // effect of a test-double change. It is the wrong call now: the record is a
    // WIRE measurement, so the figure is 90, and the honest way to keep the
    // default stub run reproducing it is to leave the stub reporting a
    // real-length transaction id — which `DEFAULT_TX_ID` already is, the real
    // captured `0.0.7162784@1789202339.427560739`, 32 characters, exactly as long
    // as the id the wire run actually paid with.
    //
    // The consequence, stated plainly: this figure is a property of the receipt's
    // shape as well as of the artifact, and both modes now produce the same 90
    // because both report an id of the same length as a real one. A stub that went
    // back to `0.0.2222@1-1` would produce 85 and this file would fail, which is
    // the guard working.

    const buyerKey = PrivateKey.generateECDSA();
    process.env.CARPOOL_AUTHOR_ACCOUNT_ID = author.accountId;
    process.env.CARPOOL_AUTHOR_PRIVATE_KEY = author.privateKeyHex;
    // The stub facilitator reports 0.0.2222 as the payer, so this matches what
    // the registry records as `purchase.buyer`.
    process.env.CARPOOL_BUYER_ACCOUNT_ID = "0.0.2222";
    process.env.CARPOOL_BUYER_PRIVATE_KEY = buyerKey.toStringRaw();
    process.env.HEDERA_NETWORK = "hedera:testnet";
    process.env.USDC_TOKEN_ID = "0.0.429274";
    // pay.ts reads its per-payment spend cap at module scope, and the default
    // 20,000 µUSDC is far below this artifact's price. Set before importing it.
    process.env.CARPOOL_MAX_MICRO_USDC = "5000000";
  });

  afterAll(() => harness?.close());

  it("measures the redo cost from the producing session's own transcript", () => {
    const sources = new Set(body.match(/https?:\/\/[^ )"]+/g) ?? []).size;

    // The recorded measurement is only allowed to stand if it still reproduces.
    // When the transcript is on this machine, re-measure and demand agreement —
    // that is what stops `redo-measured.json` from decaying into a fixture.
    if (transcriptPresent) {
      status.redoReDerived = true;
      const rows = parseTranscript(TRANSCRIPT_PATH);
      const live = measureSegment(rows, redoMeasured.segment.fromRow, redoMeasured.segment.toRow);
      expect(
        {
          inputTokens: live.inputTokens,
          outputTokens: live.outputTokens,
          cacheWriteTokens: live.cacheWriteTokens,
          cacheReadTokens: live.cacheReadTokens,
          toolCalls: live.toolCalls,
          subagentCalls: live.subagentCalls,
          apiCalls: live.apiCalls,
        },
        "redo-measured.json no longer matches the transcript it claims to come from — " +
          "re-run `pnpm --filter @carpool/bench measure:redo` and update it",
      ).toEqual({
        inputTokens: redoMeasured.inputTokens,
        outputTokens: redoMeasured.outputTokens,
        cacheWriteTokens: redoMeasured.cacheWriteTokens,
        cacheReadTokens: redoMeasured.cacheReadTokens,
        toolCalls: redoMeasured.toolCalls,
        subagentCalls: redoMeasured.subagentCalls,
        apiCalls: redoMeasured.apiCalls,
      });
      expect(live.activeSeconds).toBeCloseTo(redoMeasured.activeSeconds, 1);
      expect(live.elapsedSeconds).toBeCloseTo(redoMeasured.elapsedSeconds, 1);
    } else {
      console.warn(
        `[ab-run] transcript absent at ${TRANSCRIPT_PATH} — the recorded redo measurement is ` +
          "used unverified. Set CARPOOL_AB_TRANSCRIPT to re-derive it.",
      );
    }

    const usage = {
      inputTokens: redoMeasured.inputTokens,
      outputTokens: redoMeasured.outputTokens,
      cacheWriteTokens: redoMeasured.cacheWriteTokens,
      cacheReadTokens: redoMeasured.cacheReadTokens,
    };

    redo = {
      ...usage,
      model: redoMeasured.model,
      activeSeconds: redoMeasured.activeSeconds,
      elapsedSeconds: redoMeasured.elapsedSeconds,
      estimatedCostUsd: costUsd(usage, PUBLISHED_OPUS_5_RATES),
      rates: PUBLISHED_OPUS_5_RATES,
      toolCalls: redoMeasured.toolCalls,
      subagentCalls: redoMeasured.subagentCalls,
      sources,
      alsoProduced: redoMeasured.alsoProduced,
      segment: redoMeasured.segment,
    };

    // The claim the old doc got wrong by a factor of five (143 against 28). It
    // is checked against the committed record rather than a literal, and the
    // record carries the artifact's sha256 — so "the artifact the doc describes"
    // is a checkable statement about bytes, not about a URL count that a
    // different file could coincidentally share.
    if (!writing) {
      const recorded = recordedAb();
      expect(
        createHash("sha256").update(body).digest("hex"),
        `the artifact at ${ARTIFACT_PATH} is not the one apps/bench/src/ab-measured.json records. ` +
          "Re-run with CARPOOL_AB_WRITE=1 if it legitimately changed; every artifact figure in " +
          "docs/AB-MEASUREMENT.md then has to be regenerated with it.",
      ).toBe(recorded.artifact.sha256);
      expect(sources, "the doc must quote the source count the artifact actually has").toBe(
        recorded.artifact.sources,
      );
    }
    expect(redo.subagentCalls, "a zero here would mean the floor caveat could be dropped").toBeGreaterThan(0);
    expect(totalTokens(redo)).toBeGreaterThan(0);
  });

  it("publishes the real artifact through the real publish path, and buys it back", async () => {
    const { publishArtifact } = await import("../../mcp/src/publish.js");
    const { RegistryClient } = await import("../../mcp/src/client.js");
    const { payFetch } = await import("../../mcp/src/pay.js");

    // The shipped rule, called — `priceForRedoCost` IS
    // `max(MIN_PRICE, round(cost × 1e6 × PRICE_BASE_FRACTION_OF_REDO))`, so this
    // run lists at the price `carpool_publish` would have quoted for the same
    // self-reported cost, rather than at a parallel formula that agrees by luck.
    const priceBase = priceForRedoCost(redo.estimatedCostUsd);
    const published = await publishArtifact(registryBase(), {
      question: QUESTION,
      abstract: ABSTRACT,
      body,
      // The artifact's own sources, as the manifest is meant to carry them.
      sources: [...new Set(body.match(/https?:\/\/[^ )"]+/g) ?? [])].map((url) => ({
        url,
        fetchedAt: "2026-09-09T00:00:00Z",
      })),
      provenance: {
        model: redo.model,
        durationSeconds: Math.round(redo.activeSeconds),
        inputTokens: redo.inputTokens + redo.cacheWriteTokens + redo.cacheReadTokens,
        outputTokens: redo.outputTokens,
        estimatedCostUsd: redo.estimatedCostUsd,
        toolCalls: redo.toolCalls,
      },
      scope: "ethonline-2026",
      halfLifeDays: 1, // DEFAULT_HALF_LIFE_DAYS — the shipped default
      priceMicroUsdc: priceBase,
      redacted: false,
    });
    if (!published.ok) throw new Error(published.error);

    const client = new RegistryClient(registryBase());

    const searchStart = performance.now();
    const { results } = await client.search(QUESTION, 5, null);
    const searchLatencyMs = performance.now() - searchStart;

    const hit = results.find((r) => r.magnet === published.magnet);
    expect(hit, "the real search must find the artifact that was just published").toBeDefined();

    // What priceAt() actually returns for the manifest as published — not a
    // number this runner chose. Bracketed rather than compared to a single value:
    // `priceAt()` decays CONTINUOUSLY, so the quote the gate issues is whatever
    // the price was on the gate's clock, somewhere between this search and the end
    // of the paid fetch. In-process that interval is a millisecond or two and the
    // bracket is one µUSDC wide; over a real network it is seconds, and at this
    // artifact's base a second is ~3 µUSDC. Asserting equality with a single
    // sample would therefore be asserting that the round trip took no time, which
    // is exactly the thing a wire measurement is meant to stop claiming.
    const priceFloor = floorFor(priceBase);
    const priceAtInstant = (ms: number) =>
      priceAt({ priceBase, priceFloor, decay: { halfLifeDays: 1, producedAt: hit!.decay.producedAt } }, ms);
    const priceCeiling = priceAtInstant(Date.now()); // oldest it can be quoted at is now, so this is the max

    const fetchStart = performance.now();
    const bought = await payFetch(registryBase(), published.magnet, hit!.bodyHash);
    const fetchLatencyMs = performance.now() - fetchStart;
    // Sampled AFTER the purchase, so it is an upper bound on the age the gate
    // priced at — the gate's own clock is not observable from here. It is what
    // makes the recorded µUSDC charge checkable to a µUSDC or two later, from a
    // machine that has neither the artifact nor the transcript.
    ageMsAtPurchaseUpperBound = Date.now() - Date.parse(hit!.decay.producedAt);
    const priceFloorAtEnd = priceAtInstant(Date.now());

    expect(bought.error).toBeUndefined();
    expect(bought.ok).toBe(true);
    expect(bought.body, "the bytes delivered must be the artifact").toBe(body);
    expect(bought.verification.state).toBe("verified");
    // The quote is the registry's own `priceAt()` output at some instant inside
    // the window this call measured, and the charge is that quote replayed — the
    // gate never re-prices on the paid retry (`PaymentGate`'s issued cache).
    expect(
      bought.paid,
      `the gate charged ${bought.paid} µUSDC; priceAt() over the interval this call measured ` +
        `allows [${priceFloorAtEnd}, ${priceCeiling}]`,
    ).toBeGreaterThanOrEqual(priceFloorAtEnd);
    expect(bought.paid).toBeLessThanOrEqual(priceCeiling);
    expect(hit!.priceNow, "the search quote must be from the same decay curve").toBeLessThanOrEqual(
      priceCeiling + 1,
    );
    expect(hit!.priceNow).toBeGreaterThanOrEqual(priceFloorAtEnd);

    // The summary the fetch tool actually hands the agent. Assembled from the
    // same pieces apps/mcp/src/server.ts assembles it from, so the token count
    // is of a real tool result rather than an invented sentence.
    //
    // The summary is assembled through the shipped expression, with the output
    // directory as a STATED INPUT — for the same reason the rate card is one.
    //
    // `server.ts`'s `OUT_DIR` is `process.env.CARPOOL_ARTIFACT_DIR ?? join(tmpdir(),
    // "carpool-artifacts")`, and the receipt contains the path it wrote. Two
    // versions of this line have been wrong about that: the first invented
    // `/tmp/carpool/…`, which the product never produces (83 tokens), and the
    // second used the bare `os.tmpdir()` default, which is `/tmp` on Linux, a
    // ~50-character `/var/folders/…` path on macOS, and *different again* under
    // turbo — 96 tokens standalone against 85 under `turbo run test` on this same
    // machine. A published figure that moves with the shell that invoked the test
    // is not a figure. So the directory is pinned to the value a deployment sets
    // `CARPOOL_ARTIFACT_DIR` to, the record stores it, and the document states it.
    const { renderIntegrity, usd } = await import("../../mcp/src/render.js");
    const outDir = SUMMARY_ARTIFACT_DIR;
    const outPath = join(outDir, `${published.magnet.replace(/^swarm:/, "").slice(0, 16)}.md`);
    const summary =
      `Bought ${published.magnet} for ${usd(bought.paid)}.\n` +
      `Written to: ${outPath}\n` +
      `${Buffer.byteLength(bought.body, "utf8")} bytes · ${renderIntegrity(bought, hit!.bodyHash)}\n` +
      `Transaction: ${bought.txId}\n\n` +
      `Read the file for the research. You did not have to run it.`;

    const result = computeAb({
      magnet: published.magnet,
      question: QUESTION,
      redo,
      buy: {
        quotedMicroUsdc: bought.paid,
        paidMicroUsdc: bought.paid,
        priceBaseMicroUsdc: priceBase,
        priceFloorMicroUsdc: priceFloor,
        searchLatencyMs,
        fetchLatencyMs,
        verification: bought.verification.state,
        latencyIsLocalFloor: !LIVE,
      },
      body,
      summary,
    });

    // The buyer's context absorbs the summary, not the body. If that ever
    // stopped being overwhelmingly true, `carpool_fetch` writing a file instead
    // of returning the body inline would have lost its justification.
    expect(result.buy.tokensForSummary).toBeLessThan(result.buy.tokensIfFullyRead / 50);
    expect(result.buy.tokensIfFullyRead).toBe(approxTokens(body));
    expect(result.savings.usd).toBeGreaterThan(0);
    expect(freshness({ decay: { halfLifeDays: 1, producedAt: hit!.decay.producedAt } })).toBeCloseTo(1, 2);

    report = [
      renderAb(result),
      "",
      LIVE
        ? `  registry: LIVE (${LIVE}), real Blocky402 facilitator, real Hedera testnet, embedder ${liveEmbedder}`
        : `  registry: in-process (${harness.base}), stub facilitator, embedder ${harness.embedding.model}`,
      LIVE ? `  transaction: ${bought.txId} (real, on a mirror node)` : `  transaction: ${bought.txId} (stub)`,
      `  priceBase policy: ${(PRICE_BASE_FRACTION_OF_REDO * 100).toFixed(0)}% of the measured redo floor`,
      `  artifact: ${ARTIFACT_PATH}`,
      `  generated: ${new Date().toISOString()}`,
    ].join("\n");

    console.log(`\n${report}\n`);
    if (process.env.CARPOOL_AB_OUT) {
      writeFileSync(process.env.CARPOOL_AB_OUT, `${report}\n`, "utf8");
    }

    status.roundTripRan = true;

    // The machine-readable half of this run. Committed, so that a checkout with
    // neither the artifact nor the transcript can still check the document and
    // the dashboard against what a run produced — the chain is
    //   artifact + transcript → this record → docs + dashboard,
    // and each link has a guard. Without it the buy-side figures were checkable
    // on exactly one laptop.
    liveRecord = {
      artifact: {
        bytes: Buffer.byteLength(body, "utf8"),
        chars: body.length,
        sources: redo.sources,
        sha256: createHash("sha256").update(body).digest("hex"),
      },
      buy: {
        quotedMicroUsdc: bought.paid,
        paidMicroUsdc: bought.paid,
        priceBaseMicroUsdc: priceBase,
        priceFloorMicroUsdc: priceFloor,
        halfLifeDays: 1,
        ageMsAtPurchaseUpperBound,
        tokensIfFullyRead: result.buy.tokensIfFullyRead,
        tokensForSummary: result.buy.tokensForSummary,
        artifactDir: SUMMARY_ARTIFACT_DIR,
        verification: result.buy.verification,
      },
    };

    if (writing) {
      writeFileSync(
        AB_RECORD_PATH,
        `${JSON.stringify(
          {
            _what:
              "The measured buy side of docs/AB-MEASUREMENT.md, written by this run — not typed. " +
              "Produced by `CARPOOL_AB_WRITE=1 pnpm ab:run` with the artifact present. " +
              "ab-doc.test.ts checks the document and apps/dashboard against this file on every " +
              "machine, including CI, where the artifact and transcript are absent.",
            _command:
              "CARPOOL_AB_ARTIFACT=<artifact> CARPOOL_AB_WRITE=1 CARPOOL_AB_STRICT=1 pnpm ab:run",
            _measuredAt: new Date().toISOString(),
            _artifactPath: ARTIFACT_PATH,
            _magnet: published.magnet,
            _runDependent:
              "buy.paidMicroUsdc/quotedMicroUsdc move by a µUSDC or two with the age at purchase; " +
              "buy.tokensForSummary contains the output path, so it varies with os.tmpdir(); " +
              "the magnet and the latencies differ on every run. Everything else is deterministic.",
            _floor: LIVE
              ? "WIRE: a registry on a real port, the real Blocky402 facilitator, real Hedera " +
                "testnet, the registry's real ONNX embedder. The latency includes the 402, the " +
                "signed transfer, the facilitator's verify and settle, and consensus. It EXCLUDES " +
                "the settlement epoch that pays the author and the HBAR fees nobody here is " +
                "charged. One sample on one network path."
              : "In-process registry, stub facilitator, stub mirror node, network-free embedder. " +
                "No real network, no Hedera settlement. The latency is a floor.",
            ...liveRecord,
            latency: {
              searchSeconds: Number((searchLatencyMs / 1000).toFixed(3)),
              fetchSeconds: Number((fetchLatencyMs / 1000).toFixed(3)),
              isLocalFloor: !LIVE,
            },
            registry: LIVE
              ? {
                  embedder: liveEmbedder,
                  facilitator: process.env.FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
                  base: LIVE,
                  network: process.env.HEDERA_NETWORK ?? "hedera:testnet",
                  txId: bought.txId,
                  wire: true,
                }
              : {
                  embedder: harness.embedding.model,
                  facilitator: "stub",
                  txId: bought.txId,
                  wire: false,
                },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    // A wire round trip is seconds, not milliseconds: publish (a real ONNX embed
    // of the question, then a 45 KB body over HTTP), a free search, the unpaid
    // 402, a signed Hedera transfer, the facilitator's verify and settle, and
    // consensus. vitest's 5 s default is a stub-run budget. Kept tight for the
    // stub run, where a slow one means something is wrong.
  }, LIVE ? 300_000 : 5_000);

  it.skipIf(writing)("agrees with apps/bench/src/ab-measured.json, to the µUSDC", () => {
    // The committed record is what every other guard checks against, so this run
    // has to still produce it. Deterministic fields are compared exactly; the two
    // that physically cannot be are compared with a stated tolerance and a
    // message that says why, rather than being left unchecked.
    expect(liveRecord, "the round trip did not run, so there is nothing to compare").not.toBeNull();
    const live = liveRecord!;
    const recorded = recordedAb();
    expect(live.artifact).toEqual(recorded.artifact);
    expect(live.buy.priceBaseMicroUsdc).toBe(recorded.buy.priceBaseMicroUsdc);
    expect(live.buy.priceFloorMicroUsdc).toBe(recorded.buy.priceFloorMicroUsdc);
    expect(live.buy.tokensIfFullyRead).toBe(recorded.buy.tokensIfFullyRead);
    expect(live.buy.verification).toBe(recorded.buy.verification);
    expect(live.buy.quotedMicroUsdc).toBe(live.buy.paidMicroUsdc);

    // priceAt() decays continuously: at a 1-day half-life the charge loses a
    // µUSDC roughly every 160 ms of the manifest's age, so a re-run cannot be
    // expected to reproduce the recorded integer exactly. It must land in the
    // window this run's own age bound allows — which is still tight enough to
    // reject the 436,700 the dashboard used to record for a 436,745 charge.
    const range = priceRangeFromRecord({ ...recorded.buy, ageMsAtPurchaseUpperBound });
    expect(
      live.buy.paidMicroUsdc,
      `the gate charged ${live.buy.paidMicroUsdc} µUSDC; priceFloor + round(priceBase × freshness) ` +
        `allows [${range.min}, ${range.max}] for a manifest at most ${ageMsAtPurchaseUpperBound} ms old`,
    ).toBeGreaterThanOrEqual(range.min);
    expect(live.buy.paidMicroUsdc).toBeLessThanOrEqual(range.max);

    // Exact, because the output directory is pinned. If it were not, this figure
    // would move with os.tmpdir() and with the shell that invoked the test.
    expect(live.buy.artifactDir).toBe(recorded.buy.artifactDir);
    expect(
      live.buy.tokensForSummary,
      `summary tokens ${live.buy.tokensForSummary} against the recorded ` +
        `${recorded.buy.tokensForSummary}, for the same artifact directory ` +
        `(${recorded.buy.artifactDir}). Something changed in the text carpool_fetch returns.`,
    ).toBe(recorded.buy.tokensForSummary);
  });

  it("refuses to render a floor as a total", () => {
    // renderAb must carry every caveat the result's own flags claim. A report
    // that dropped one would be the old failure in a new costume.
    expect(report).toMatch(/REDO IS A FLOOR/);
    // Whichever side the buy figure is on, the report must say so. A stub run
    // carries the floor caveat; a wire run carries the scope statement — and a
    // wire run must NOT carry the floor caveat, which is how the old figure came
    // to be read as a latency claim.
    if (LIVE) {
      expect(report).toMatch(/WIRE MEASUREMENT: real network, real facilitator, real Hedera settlement/);
      expect(report).toMatch(/EXCLUDES the settlement epoch/);
      expect(report).not.toMatch(/BUY IS A FLOOR TOO/);
      expect(report).not.toMatch(/LOCAL, not a wire time/);
    } else {
      expect(report).toMatch(/BUY IS A FLOOR TOO/);
    }
    expect(report).toMatch(/SEGMENT BOUNDARY/);
    expect(report).toMatch(/a price list, not a fact/);
  });

  it("keeps docs/AB-MEASUREMENT.md in step with what THIS run measured", () => {
    // The old version of this test was a list of hand-typed substrings, and it
    // passed with the document claiming the retracted "143 sources" — see the
    // docstring of docFigures.ts. This one derives every expected figure from
    // this run's own numbers and checks each one at its LABELLED position in the
    // prose, so a wrong figure fails and a coincidental digit run in the magnet
    // satisfies nothing.
    expect(liveRecord).not.toBeNull();
    const figures = abDocFigures(redoMeasured, liveRecord!, PUBLISHED_OPUS_5_RATES);

    if (writing) {
      const doc = readFileSync(AB_DOC_PATH, "utf8");
      writeFileSync(
        AB_DOC_PATH,
        doc.replace(extractFigureBlock(doc), renderFigureBlock(figures)),
        "utf8",
      );
    }

    const doc = readFileSync(AB_DOC_PATH, "utf8");
    const failures = checkDoc(doc, figures);
    expect(
      failures.map((f) => `${f.key}: ${f.message}`),
      "docs/AB-MEASUREMENT.md no longer states what this run measured. " +
        "Re-run `CARPOOL_AB_WRITE=1 pnpm ab:run` to regenerate the figure block, then fix the prose.",
    ).toEqual([]);

    // The two records also have to agree with each other's arithmetic.
    expect(checkRecords(redoMeasured, liveRecord!, PUBLISHED_OPUS_5_RATES)).toEqual([]);

    // And the correction has to stay on the page.
    expect(doc).toMatch(/fabricated/);
    expect(doc).toMatch(/2bf4931/);
    expect(doc).toMatch(/9ef4062/);
  });
});
