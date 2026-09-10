/**
 * Client-side embedding.
 *
 * The MCP client embeds the question locally and sends only the vector to
 * the registry, so on that path `GET /search` never receives question text
 * (see apps/registry/src/server.ts).
 *
 * Precisely: that holds for `?vector=`, not for `?q=`. A client with no local
 * embedder sends the text and the registry embeds it server-side — which is
 * the only way `q` can be ranked at all, and is why apps/mcp states the
 * exposure on every call that takes that path rather than leaving it implied.
 *
 * Do NOT read that as a privacy guarantee. Embedding inversion recovers a
 * large fraction of short inputs from the vector alone. What this actually
 * buys: the registry operator cannot read questions without deliberately
 * running an inversion attack, and queries are not sitting in plaintext
 * access logs. That is a real reduction in casual exposure, not
 * confidentiality — never describe it as private in stronger terms than that
 * (see this package's README, "Privacy claim, precisely").
 *
 * One embedding model for the whole registry: vectors from different models
 * are not comparable, so `(model, dim)` is a property of the registry
 * (served from `GET /.well-known/carpool`), never a per-artifact column.
 */
export interface Embedder {
  model: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
}

/** feature-extraction pipeline shape, narrowed to what this file calls. */
export interface FeatureExtractionPipeline {
  (text: string, opts: { pooling: "mean"; normalize: true }): Promise<{ data: Float32Array | number[] }>;
}

export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_EMBEDDING_DIM = 384;

export interface LocalEmbedderOptions {
  /** Defaults to Xenova/all-MiniLM-L6-v2 — see README for the measured install/latency cost. */
  model?: string;
  /** Defaults to 384 (all-MiniLM-L6-v2's output width). */
  dim?: number;
  /** Where @huggingface/transformers caches downloaded model files. */
  cacheDir?: string;
  /**
   * Honoured as `env.allowRemoteModels`. Set to `false` to force a
   * previously-cached model and fail closed rather than reach the network —
   * this is how a CI environment (or this package's own tests, which must
   * never touch the network) would run it if they ran it at all.
   */
  allowRemoteModels?: boolean;
  /**
   * Test seam: bypasses `@huggingface/transformers` entirely. Production
   * callers never set this — `localEmbedder()` loads the real ONNX pipeline.
   * Tests set it to a fake so `embed.ts`'s own wrapping logic (dimension
   * check, Float32Array conversion) is exercised without the runtime or a
   * network call.
   */
  loadPipeline?: (model: string, opts: { cacheDir?: string; allowRemoteModels?: boolean }) => Promise<FeatureExtractionPipeline>;
}

async function defaultLoadPipeline(
  model: string,
  opts: { cacheDir?: string; allowRemoteModels?: boolean },
): Promise<FeatureExtractionPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  if (opts.cacheDir !== undefined) env.cacheDir = opts.cacheDir;
  if (opts.allowRemoteModels !== undefined) env.allowRemoteModels = opts.allowRemoteModels;
  const extractor = await pipeline("feature-extraction", model);
  return extractor as unknown as FeatureExtractionPipeline;
}

/**
 * A small ONNX sentence-transformer, run locally via `@huggingface/transformers`.
 * See this package's README for measured model size, install size, cold-start
 * and per-query latency — a real tax on an MCP server, not a footnote.
 */
export async function localEmbedder(opts: LocalEmbedderOptions = {}): Promise<Embedder> {
  const model = opts.model ?? DEFAULT_EMBEDDING_MODEL;
  const dim = opts.dim ?? DEFAULT_EMBEDDING_DIM;
  const load = opts.loadPipeline ?? defaultLoadPipeline;
  const extractor = await load(model, { cacheDir: opts.cacheDir, allowRemoteModels: opts.allowRemoteModels });

  return {
    model,
    dim,
    async embed(text: string): Promise<Float32Array> {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
      if (data.length !== dim) {
        throw new Error(
          `embedder "${model}" produced a ${data.length}-dim vector but was configured for dim=${dim} — ` +
            `pass the correct dim, or this model does not match the registry's declared tuple`,
        );
      }
      return data;
    },
  };
}
