/**
 * The registry's embedder: one per process, resolved lazily.
 *
 * Why the *registry* embeds at all, given that §10 of docs/RESTRUCTURE.md puts
 * embedding on the client:
 *
 * - **At publish time there is nothing to protect.** `manifest.question` is in
 *   the request body, in the signed manifest, and served free from
 *   `GET /search` forever after. The registry reading it to build an index
 *   entry leaks nothing it was not already given. The alternative — accepting a
 *   client-supplied vector on `POST /publish` — is strictly worse: a vector
 *   cannot be checked against the question it claims to represent, so any
 *   author could index their artifact under someone else's topic and there is
 *   no signature or content address that would catch it. The registry
 *   recomputing the vector from the `questionNorm` it has already validated
 *   (see `POST /publish`) is the only version of publish-time indexing that
 *   cannot be gamed.
 *
 * - **At query time the client still embeds.** `GET /search?vector=` never
 *   reaches this module; only the `?q=` fallback does, which is exactly the
 *   path whose privacy cost the MCP already announces to the user on every
 *   call. This preserves the property that matters: a client that can embed
 *   locally never sends question text.
 *
 * The default implementation is `@carpool/tracker`'s `localEmbedder()` — an
 * ONNX sentence-transformer, imported dynamically so `onnxruntime-node` is
 * never loaded by a process that only publishes, quotes and settles, and never
 * during a test. `setEmbedder()` is the injection seam tests use; nothing in
 * production calls it.
 */
import type { Config } from "./config.js";

export interface Embedder {
  model: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
}

let override: Embedder | null = null;
let cached: Promise<Embedder> | null = null;

/**
 * Test/embed-host seam. Pass `null` to fall back to the real ONNX embedder.
 * Clears the memoised promise so a second test can install a different one.
 */
export function setEmbedder(e: Embedder | null): void {
  override = e;
  cached = null;
}

/**
 * The process's embedder, memoised. A *failed* load is not memoised: the
 * common cause is a cold model cache with no network, and a registry that
 * permanently disabled its own search because one request happened while the
 * machine was offline would be worse than one that retries.
 */
export function getEmbedder(cfg: Pick<Config, "embedding">): Promise<Embedder> {
  if (override) return Promise.resolve(override);
  if (cached) return cached;
  cached = load(cfg).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

async function load(cfg: Pick<Config, "embedding">): Promise<Embedder> {
  // Dynamic so onnxruntime-node stays unloaded until something actually needs
  // a vector. @carpool/tracker's own embed.ts defers the @huggingface import
  // one level further, so even this import does not pull the runtime in.
  const { localEmbedder } = await import("@carpool/tracker");
  const e = await localEmbedder({ model: cfg.embedding.model, dim: cfg.embedding.dim });
  if (e.dim !== cfg.embedding.dim || e.model !== cfg.embedding.model) {
    throw new Error(
      `embedder is (model="${e.model}", dim=${e.dim}) but this registry declares ` +
        `(model="${cfg.embedding.model}", dim=${cfg.embedding.dim}) — vectors from different models ` +
        `are not comparable; see GET /.well-known/carpool`,
    );
  }
  return e;
}
