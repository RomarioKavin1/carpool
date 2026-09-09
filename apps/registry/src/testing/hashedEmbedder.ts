// Test-only support, mirroring apps/bench/src/support — excluded from the
// build (see tsconfig.json). Never imported by production code.
//
// A real embedder, just not a neural one: hashed bag-of-words, L2-normalised,
// so cosine similarity between two questions rises with the vocabulary they
// share. That is enough to exercise every property the registry's search path
// claims — the vec0 round trip, the similarity threshold, and the fact that
// `similarity * freshness * (0.5 + 0.5 * depth)` can reorder hits the index
// returned in similarity order — without downloading ~87 MB of ONNX weights or
// touching the network, which `pnpm test` must never do.
//
// It is deliberately NOT the production embedder. The tuple it declares is a
// distinct model name so that a test registry can never be mistaken for one
// serving MiniLM vectors: vectors from different models are not comparable and
// TrackerIndex enforces exactly that.
//
// ## What it does not cover — read this before trusting a search test
//
// This is the ONLY embedder any test in this repository runs. Nothing here — not
// `search.test.ts`, not `packages/carpool-tracker/src/embed.test.ts`, which
// injects its pipeline — executes `localEmbedder()`'s real ONNX path. So:
//
//  - **No test covers semantic matching.** Bag-of-words scores shared vocabulary.
//    A paraphrase, a synonym or a genuine near-miss is invisible to it, and
//    `search.test.ts`'s corpus is vocabulary-disjoint, so separating those
//    fixtures is trivial for any hash. A swapped or corrupted model checkpoint in
//    production fails nothing here.
//  - **It emits a vector the real model cannot.** A question with no `[a-z0-9]`
//    tokens yields the zero vector, not a unit one. Harmless (cosine 0 is below
//    every legal threshold) but it is a state production never reaches.
//  - **dim 64, not 384.** Everything dimension-dependent — vec0 width, the
//    `?vector=` wire encoding, `decodeVector`'s length check — is exercised at a
//    sixth of production's width.
//
// The contract it *does* share with the real embedder (declared width, unit
// length, determinism) is asserted in `../embedder.test.ts`, together with the
// divergence above. The one real-ONNX proof in the repository is captured, not
// executed: `docs/evidence/v2-first-testnet-run/03-search.json`, one live query
// through `Xenova/all-MiniLM-L6-v2` against a corpus of one. `docs/AUDIT-MOCKS.md`
// carries the rest of that gap as open.
import type { Embedder } from "../embedder.js";

export const TEST_EMBEDDING_MODEL = "carpool-test/hashed-bow";
export const TEST_EMBEDDING_DIM = 64;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashedEmbedder(dim = TEST_EMBEDDING_DIM, model = TEST_EMBEDDING_MODEL): Embedder {
  return {
    model,
    dim,
    async embed(text: string): Promise<Float32Array> {
      const v = new Float32Array(dim);
      const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const t of tokens) {
        const h = fnv1a(t);
        // Two slots per token with opposite signs (a signed hashing trick):
        // it keeps unrelated vocabularies close to orthogonal at small dim,
        // where a single-slot scheme collides often enough that two unrelated
        // questions can score above a 0.55 threshold.
        v[h % dim]! += 1;
        v[(h >>> 8) % dim]! -= 1;
      }
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm);
      if (norm === 0) return v;
      for (let i = 0; i < dim; i++) v[i]! /= norm;
      return v;
    },
  };
}
