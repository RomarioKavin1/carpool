/**
 * The embedder seam, and the stand-in that occupies it in every test.
 *
 * `embedder.ts` had no test file. Everything about the registry's search path is
 * exercised through `testing/hashedEmbedder.ts` — an FNV-1a bag-of-words vector —
 * and **nothing in this repository runs the real ONNX embedder**
 * (`localEmbedder()` → `@huggingface/transformers` → `Xenova/all-MiniLM-L6-v2`).
 * `packages/carpool-tracker/src/embed.test.ts` injects `loadPipeline`, so it does
 * not either. `pnpm test` must not download 87 MB of weights or touch a network,
 * so that is the right call — but it means the stand-in is the *only* embedder any
 * test has ever seen, and a stand-in that nothing compares against reality is how
 * a suite ends up asserting the stand-in.
 *
 * ## What the stand-in is NOT evidence of, and where the evidence is
 *
 * Not covered by any test, here or anywhere:
 *
 *  - **Semantic matching.** `hashedEmbedder` scores on shared vocabulary. It
 *    cannot rank a paraphrase, a synonym or a near-miss above an unrelated
 *    question, and `search.test.ts`'s fixtures are vocabulary-disjoint, so a
 *    bag-of-words hash separates them trivially. A swapped, truncated or
 *    corrupted model checkpoint in production would fail no test in this tree.
 *  - **The real model's tuple.** MiniLM is `(Xenova/all-MiniLM-L6-v2, 384)`; the
 *    stand-in declares `(carpool-test/hashed-bow, 64)` on purpose, so a test
 *    registry can never be mistaken for one serving MiniLM vectors.
 *  - **`localEmbedder()`'s default `loadPipeline`** — the dynamic
 *    `@huggingface/transformers` import, `env.cacheDir` / `env.allowRemoteModels`,
 *    and the cold-start cost — and **`embedder.ts`'s own tuple-mismatch guard**
 *    (`load()`, which throws when the loaded model's `(model, dim)` disagrees with
 *    the registry's declared one). `load()` takes no injection seam, so that throw
 *    is unreachable from a test: it is checked by reading, not by running.
 *
 * The one real-ONNX proof this repository has is captured, not executed:
 * `docs/evidence/v2-first-testnet-run/03-search.json` — a live registry ranking a
 * genuine question through `Xenova/all-MiniLM-L6-v2`, cosine `0.8097`, score
 * `0.7389`, against a corpus of one. That is a single data point on a single query
 * and it is the whole of it. `docs/AUDIT-MOCKS.md` carries this gap as an open
 * item rather than a closed one.
 *
 * ## What this file does check
 *
 * The part that *is* checkable offline: that the stand-in satisfies the contract
 * the real embedder satisfies, so the plumbing it exercises is plumbed the same
 * way — same declared width, unit-length vectors, deterministic — and that the one
 * place it provably behaves differently from a normalised neural embedder is known
 * and handled rather than discovered in production.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedder, setEmbedder, type Embedder } from "./embedder.js";
import { hashedEmbedder, TEST_EMBEDDING_DIM, TEST_EMBEDDING_MODEL } from "./testing/hashedEmbedder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

const l2 = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const cosine = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe("the contract every embedder in this repo must satisfy", () => {
  const e = hashedEmbedder();

  it("declares the width it produces, and produces exactly that", async () => {
    expect(e.dim).toBe(TEST_EMBEDDING_DIM);
    expect(e.model).toBe(TEST_EMBEDDING_MODEL);
    for (const text of ["a short question", "Another, with punctuation!", "x"]) {
      expect((await e.embed(text)).length, text).toBe(e.dim);
    }
    // The registry's vec0 table is opened at this width and vectors from
    // different models are not comparable, so a mismatch is a hard error rather
    // than a zero-pad — which is exactly what `localEmbedder()` throws for
    // (`embed.ts`, the dim check) and what `decodeVector` rejects on the wire.
  });

  it("returns unit-length vectors, as `normalize: true` makes the real one do", async () => {
    // `localEmbedder()` calls the pipeline with `{ pooling: "mean", normalize: true }`
    // (`packages/carpool-tracker/src/embed.ts`), so MiniLM's output is L2-normalised
    // and cosine similarity is a plain dot product. `rank()` and the vec0 index
    // both assume that. A stand-in producing unnormalised vectors would make every
    // similarity in every test a different quantity from the production one.
    for (const text of ["hedera mirror node token balances", "ethonline prize pool"]) {
      expect(l2(await e.embed(text)), text).toBeCloseTo(1, 5);
    }
  });

  it("is deterministic: the same text always gives the same vector", async () => {
    const a = await e.embed("the same question, twice");
    const b = await e.embed("the same question, twice");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("scores a question against itself at 1 and against an unrelated one below the default threshold", async () => {
    const q = await e.embed("which mirror node endpoint lists an account's token balances");
    expect(cosine(q, q)).toBeCloseTo(1, 5);
    const other = await e.embed("what is the ethonline 2026 prize pool across sponsor tracks");
    // 0.55 is `loadSearchOptions`'s default floor. Two unrelated questions must
    // sit below it or every test's "the ranked answer came first" is luck.
    expect(cosine(q, other)).toBeLessThan(0.55);
  });

  /**
   * The one place the stand-in provably differs from the real embedder.
   *
   * `hashedEmbedder` tokenises on `[^a-z0-9]+`, so a question with no
   * alphanumeric characters produces no tokens, a zero vector, and — because it
   * short-circuits on `norm === 0` — a vector of length 0 rather than 1. A
   * mean-pooled, L2-normalised transformer never returns that: MiniLM embeds the
   * CLS/EOS tokens of even an empty string and normalises to 1.
   *
   * This is written down, and asserted, because the difference is in the
   * *direction that matters*: the stand-in emits a degenerate vector the real
   * model cannot emit, so any code path that only works because the vector is
   * unit-length is exercised here under conditions production never sees. What
   * saves the registry is that cosine against a zero vector is 0, which is below
   * every legal threshold, so such a query returns nothing rather than ranking
   * arbitrarily — see `search.test.ts`'s "a question that matches nothing".
   */
  it("emits a ZERO vector for a token-free question — which the real model never does", async () => {
    const empty = await e.embed("!!! ??? ...");
    expect(empty.length).toBe(e.dim);
    expect(l2(empty), "not unit length: the contract above does not hold here").toBe(0);
    expect(Array.from(empty).every((x) => x === 0)).toBe(true);
    // And the consequence is safe: it cannot beat any threshold.
    const real = await e.embed("hedera mirror node token balances");
    expect(cosine(empty, real)).toBe(0);
  });
});

describe("setEmbedder / getEmbedder — the injection seam", () => {
  it("returns the override, and a second setEmbedder replaces the memoised one", async () => {
    const first = hashedEmbedder(64, "first/model");
    const second = hashedEmbedder(32, "second/model");
    const cfg = { embedding: { model: "irrelevant", dim: 0 } };
    try {
      setEmbedder(first);
      expect((await getEmbedder(cfg)).model).toBe("first/model");
      setEmbedder(second);
      // The memoised promise is cleared, or a second test in the same process
      // would silently keep the first test's embedder — and every harness-based
      // file in this package installs its own.
      expect((await getEmbedder(cfg)).model).toBe("second/model");
      expect((await getEmbedder(cfg)).dim).toBe(32);
    } finally {
      setEmbedder(null);
    }
  });

  it("does not consult the config while an override is installed", async () => {
    const injected: Embedder = hashedEmbedder(8, "injected/model");
    try {
      setEmbedder(injected);
      // A config naming a model that would need a 400 MB download. The override
      // has to win without `load()` ever being reached, which is the only reason
      // `pnpm test` does not hit the network.
      const got = await getEmbedder({ embedding: { model: "Xenova/all-MiniLM-L6-v2", dim: 384 } });
      expect(got).toBe(injected);
    } finally {
      setEmbedder(null);
    }
  });
});

/**
 * `Embedder` is declared twice — `packages/carpool-tracker/src/embed.ts` and
 * `apps/registry/src/embedder.ts` — textually identical, separately maintained,
 * with no shared import (`docs/AUDIT-TESTS.md`). The registry deliberately does
 * not import the tracker's type: `@carpool/tracker` is an optional peer and the
 * dynamic import in `load()` is the only coupling there is. Nothing in the type
 * system catches drift between the two, and drift would be found at runtime, in
 * production, as a vector of the wrong width.
 *
 * So it is checked the way `apps/dashboard/lib/decay.test.ts` checks core's
 * duplicated `0.125`: by reading the other file off disk.
 */
describe("the duplicated Embedder interface has not drifted", () => {
  const signature = (src: string): string => {
    const m = /export interface Embedder \{([\s\S]*?)\n\}/.exec(src);
    if (!m) throw new Error("no `export interface Embedder { ... }` found");
    return m[1]!
      .split("\n")
      .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "").trim())
      .filter(Boolean)
      .join("\n");
  };

  it("declares the same members in the tracker and in the registry", () => {
    const registry = signature(readFileSync(join(HERE, "embedder.ts"), "utf8"));
    const tracker = signature(
      readFileSync(join(REPO, "packages", "carpool-tracker", "src", "embed.ts"), "utf8"),
    );
    expect(registry).toBe(tracker);
    // Named, so a member disappearing is reported as itself rather than as a diff.
    expect(registry).toContain("model: string;");
    expect(registry).toContain("dim: number;");
    expect(registry).toContain("embed(text: string): Promise<Float32Array>;");
  });
});
