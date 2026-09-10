#!/usr/bin/env -S tsx
/**
 * `pnpm bench` — a SYNTHETIC PIPELINE SMOKE TEST, not a Phase 0 validation
 * and not a retrieval result over real artifacts. Read this banner before
 * reading the numbers it prints.
 *
 * What's real: the 8 events, their dates, and every artifact's outlet, type,
 * publication lag and approximate length (`bench/events.ts`), plus the 36
 * adjudicated pair judgments (`bench/pairs.ts`) — all numbers already
 * committed in this repo's own `docs/PHASE0.md` / task-0-report.md. No
 * article text is committed or fetched — a corpus of other people's writing
 * is exactly what the brief forbids, and Phase 0's own report is proof it's
 * unnecessary to reproduce here.
 *
 * What's synthetic, and why the result is not a retrieval measurement:
 * every artifact's embedded text is `${event.topic} ... ${outlet}, a
 * ${type}` — i.e. **every artifact in an event shares the identical topic
 * string**, and the 8 topics are mutually unrelated by construction (Tempo
 * mainnet vs. GPT-5.5 vs. an EU trilogue agreement share no vocabulary).
 * That guarantees the threshold sweep below can never encounter a false
 * positive: there is no artifact anywhere in the corpus that is topically
 * *close but wrong*, which is the only kind of error precision@1 could
 * catch. So when the sweep prints `(synthetic) precision@1: 1.000`, it is
 * not clearing the bar `docs/PHASE0.md §5` derives ("precision@1 ≥ 71% to
 * hold the operating target with full substitutes"; it read 95% while the
 * price fraction was 0.15 — see AUDIT-CLAIMS M4) — it is showing that
 * `TrackerIndex.search` + MiniLM can match a paraphrase of a keyword string
 * to itself among 8 unrelated topics, which is the least any embedding
 * pipeline should be able to do. Treat every number below as confirming the
 * wiring (embedder → index → threshold sweep → rank) runs end to end, and
 * nothing more. Measuring real precision/recall needs real, differently-
 * authored artifacts on overlapping topics — which is exactly the corpus
 * this package is not allowed to commit — so that measurement has to happen
 * against production traffic, not in this bench.
 *
 * Network: this script downloads the embedding model on first run (see the
 * package README for the measured cost) — that is why it is `pnpm bench`,
 * never part of `pnpm test`.
 */
import { createHash } from "node:crypto";
import { localEmbedder } from "../src/embed.js";
import { TrackerIndex } from "../src/index.js";
import { normalizeQuestion } from "../src/normalize.js";
import { DEFAULT_HALF_LIFE_DAYS } from "../src/defaults.js";
import type { Hit } from "../src/rank.js";
import type { Manifest } from "@carpool/core";
import Database from "better-sqlite3";
import { EVENTS, type BenchArtifact, type BenchEvent } from "./events.js";

const DAY_MS = 86_400_000;

function magnetFor(id: string): string {
  return `swarm:${createHash("sha256").update(id).digest("hex")}`;
}

/** A short, synthetic, per-event description — see the file banner for why this isn't the real article, and why it makes precision@1 trivially 1.0. */
function syntheticText(event: BenchEvent, artifact: BenchArtifact): string {
  return `${event.topic}. Source: ${artifact.outlet}, a ${artifact.type} covering ${event.name}.`;
}

function manifestFor(event: BenchEvent, artifact: BenchArtifact): Manifest {
  const producedAt = new Date(Date.parse(`${event.date}T00:00:00Z`) + artifact.lagDays * DAY_MS).toISOString();
  const outputTokens = Math.round(artifact.wordCount * 1.3);
  return {
    magnet: magnetFor(`${event.id}:${artifact.id}`),
    question: event.query,
    // Exercises the real function, not a bypass — see Task C fix round 1:
    // this used to be `event.query.toLowerCase()`, which built questionNorm
    // without ever calling normalizeQuestion.
    questionNorm: normalizeQuestion(event.query),
    scope: event.id,
    abstract: syntheticText(event, artifact),
    sources: [{ url: artifact.url, fetchedAt: producedAt }],
    provenance: {
      model: "bench-synthetic",
      durationSeconds: Math.round(artifact.wordCount * 0.6),
      inputTokens: Math.round(outputTokens / 2),
      outputTokens,
      estimatedCostUsd: 0,
      toolCalls: Math.round(artifact.wordCount / 100),
    },
    decay: { halfLifeDays: DEFAULT_HALF_LIFE_DAYS, producedAt },
    author: `bench:${artifact.outlet}`,
    bodyHash: createHash("sha256").update(syntheticText(event, artifact)).digest("hex"),
    bodyBytes: syntheticText(event, artifact).length,
    redacted: false,
  };
}

interface Corpus {
  event: BenchEvent;
  artifact: BenchArtifact;
  manifest: Manifest;
}

async function main(): Promise<void> {
  console.log("Loading local embedder (first run downloads the model — see README for cost)...");
  const embedder = await localEmbedder();

  const corpus: Corpus[] = [];
  for (const event of EVENTS) {
    for (const artifact of event.artifacts) {
      corpus.push({ event, artifact, manifest: manifestFor(event, artifact) });
    }
  }
  console.log(`(synthetic) corpus: ${corpus.length} synthetic artifacts across ${EVENTS.length} mutually-unrelated topics.`);
  console.log(
    "This is a pipeline smoke test, not a Phase 0 validation or a real retrieval result — see the file banner above the imports.\n",
  );

  const index = new TrackerIndex(new Database(":memory:"), { model: embedder.model, dim: embedder.dim });
  for (const c of corpus) {
    const vec = await embedder.embed(syntheticText(c.event, c.artifact));
    index.upsert(c.manifest.magnet, vec);
  }
  const eventOfMagnet = new Map(corpus.map((c) => [c.manifest.magnet, c.event.id] as const));

  // ---- retrieval precision@1 / recall@5 across a threshold sweep ----
  // (synthetic — see file banner: this corpus cannot contain a false
  // positive by construction, so precision@1 here measures topical
  // separability of 8 unrelated keyword strings, not retrieval quality.)
  const K = 10;
  const queryVecByEvent = new Map<string, Float32Array>();
  for (const event of EVENTS) queryVecByEvent.set(event.id, await embedder.embed(event.query));

  const thresholds = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05); // 0.05..0.95

  interface Row {
    threshold: number;
    precisionAt1: number;
    recallAt5: number;
  }
  const rows: Row[] = [];

  for (const threshold of thresholds) {
    let hitsAt1 = 0;
    let recallSum = 0;
    for (const event of EVENTS) {
      const relevant = new Set(event.artifacts.map((a) => magnetFor(`${event.id}:${a.id}`)));
      const queryVec = queryVecByEvent.get(event.id)!;
      const hits: Hit[] = index.search(queryVec, K).filter((h) => h.score >= threshold);

      if (hits.length > 0 && eventOfMagnet.get(hits[0]!.magnet) === event.id) hitsAt1++;

      const top5 = hits.slice(0, 5);
      const relevantInTop5 = top5.filter((h) => relevant.has(h.magnet)).length;
      recallSum += relevantInTop5 / relevant.size;
    }
    rows.push({ threshold, precisionAt1: hitsAt1 / EVENTS.length, recallAt5: recallSum / EVENTS.length });
  }

  // Bias toward precision over recall (brief: "a miss is cheap ... a false
  // positive costs them money and trust"): restrict to the thresholds
  // achieving the best precision@1, then the best recall@5 among those, then
  // — since ties are common on a small event set — take the *highest*
  // surviving threshold. That last step matters: a tie means precision and
  // recall are flat across a range, and the highest threshold in a flat
  // range is the one with the most headroom before the next real
  // false-positive shows up, which is exactly the side to err on.
  const maxPrecision = Math.max(...rows.map((r) => r.precisionAt1));
  const atMaxPrecision = rows.filter((r) => r.precisionAt1 === maxPrecision);
  const maxRecall = Math.max(...atMaxPrecision.map((r) => r.recallAt5));
  const atMaxRecall = atMaxPrecision.filter((r) => r.recallAt5 === maxRecall);
  const chosen = atMaxRecall.reduce((best, r) => (r.threshold > best.threshold ? r : best), atMaxRecall[0]!);

  console.log("(synthetic) threshold  precision@1  recall@5");
  for (const r of rows) {
    console.log(`(synthetic) ${r.threshold.toFixed(2).padEnd(9)}  ${r.precisionAt1.toFixed(3).padEnd(11)}  ${r.recallAt5.toFixed(3)}`);
  }

  console.log(`\n(synthetic) precision@1: ${chosen.precisionAt1.toFixed(3)}`);
  console.log(`(synthetic) recall@5: ${chosen.recallAt5.toFixed(3)}`);
  console.log(`(synthetic) chosen threshold: ${chosen.threshold.toFixed(2)}`);
  console.log(
    "\n(synthetic) reminder: this corpus has zero within-corpus topic overlap by construction, so it cannot " +
      "produce a false positive. precision@1 = 1.000 here does not mean retrieval clears any bar from " +
      "docs/PHASE0.md §5 — see the file banner.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
