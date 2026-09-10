import { describe, it, expect, vi } from "vitest";
import { DEFAULT_EMBEDDING_DIM, DEFAULT_EMBEDDING_MODEL, localEmbedder, type FeatureExtractionPipeline } from "./embed.js";

/**
 * No network in tests: every case here injects `loadPipeline`, bypassing
 * `@huggingface/transformers` (and therefore any model download) entirely.
 * The real pipeline is exercised only by `localEmbedder()`'s default path,
 * which production code calls and this suite deliberately never does — see
 * the package README for its measured (network-requiring) cost instead.
 */

function fakePipeline(data: number[] | Float32Array): FeatureExtractionPipeline {
  return async () => ({ data });
}

describe("localEmbedder", () => {
  it("defaults to Xenova/all-MiniLM-L6-v2 at dim 384", async () => {
    const loadPipeline = vi.fn(async () => fakePipeline(new Float32Array(384)));
    const embedder = await localEmbedder({ loadPipeline });
    expect(embedder.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(embedder.dim).toBe(DEFAULT_EMBEDDING_DIM);
    expect(loadPipeline).toHaveBeenCalledWith(DEFAULT_EMBEDDING_MODEL, expect.anything());
  });

  it("passes model, cacheDir and allowRemoteModels through to loadPipeline", async () => {
    const loadPipeline = vi.fn(async () => fakePipeline(new Float32Array(8)));
    await localEmbedder({ model: "custom/model", dim: 8, cacheDir: "/tmp/cache", allowRemoteModels: false, loadPipeline });
    expect(loadPipeline).toHaveBeenCalledWith("custom/model", { cacheDir: "/tmp/cache", allowRemoteModels: false });
  });

  it("returns embed() results as a Float32Array, converting from a plain number[]", async () => {
    const loadPipeline = async () => fakePipeline([1, 2, 3, 4]);
    const embedder = await localEmbedder({ dim: 4, loadPipeline });
    const out = await embedder.embed("hello");
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it("passes the pooling/normalize options the model expects on every embed() call", async () => {
    const extractor = vi.fn(async () => ({ data: new Float32Array(4) }));
    const embedder = await localEmbedder({ dim: 4, loadPipeline: async () => extractor });
    await embedder.embed("some question");
    expect(extractor).toHaveBeenCalledWith("some question", { pooling: "mean", normalize: true });
  });

  it("throws a clear error when the pipeline's output dimension does not match the configured dim", async () => {
    const loadPipeline = async () => fakePipeline(new Float32Array(384)); // real model's width
    const embedder = await localEmbedder({ dim: 128, loadPipeline });
    await expect(embedder.embed("hello")).rejects.toThrow(/384/);
    await expect(embedder.embed("hello")).rejects.toThrow(/128/);
  });
});
