/**
 * How a question becomes a vector.
 *
 * Task C's review surfaced the cost: `@huggingface/transformers` pulls
 * `onnxruntime-node` unpruned across platforms — about 240 MB installed. The
 * registry escapes that because the tracker dynamic-imports ONNX, so it never
 * loads at import time. An MCP server does not escape it: it ships to developer
 * machines and it is the thing that embeds.
 *
 * So the dependency is optional and the fallback is explicit rather than
 * silent:
 *
 *   local  — embed here, send only a vector. The registry never receives the
 *            question text. This is NOT privacy: embedding inversion recovers a
 *            large fraction of short inputs from vectors alone. What it buys is
 *            that the operator cannot read questions without deliberately
 *            running an inversion attack, and queries are not sitting in
 *            plaintext access logs.
 *
 *   remote — send the question text. The registry sees every question anyone
 *            asks, which is more sensitive than the artifacts themselves. The
 *            tool result says so on every call, because a user who did not
 *            install a 240 MB dependency should not have to infer what that
 *            cost them.
 */

export type EmbedMode = "local" | "remote";

export interface Embedder {
  mode: EmbedMode;
  model: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
}

export interface RemoteSearch {
  mode: "remote";
  /** Why the caller is sending text instead of a vector. */
  reason: string;
}

/**
 * Try to build a local embedder for the registry's declared tuple. Returns
 * null (with a reason) when the optional dependency is absent — never throws,
 * because an uninstalled optional dependency is a configuration, not a fault.
 */
export async function tryLocalEmbedder(tuple: {
  model: string;
  dim: number;
}): Promise<{ embedder: Embedder } | { embedder: null; reason: string }> {
  try {
    // Optional by design: @carpool/tracker pulls onnxruntime-node (~240 MB
    // unpruned across platforms). An MCP server ships to developer machines, so
    // this is a real tax and the import must be allowed to fail. The specifier
    // is built at runtime so TypeScript does not require the package present to
    // typecheck this app.
    const spec = "@carpool/tracker";
    const tracker = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
    const loader = (tracker as { localEmbedder?: unknown }).localEmbedder;
    if (typeof loader !== "function") {
      return { embedder: null, reason: "@carpool/tracker exports no localEmbedder" };
    }
    const e = (await (loader as (o: unknown) => Promise<{ model: string; dim: number; embed(t: string): Promise<Float32Array> }>)({
      model: tuple.model,
    }));
    if (e.dim !== tuple.dim || e.model !== tuple.model) {
      return {
        embedder: null,
        reason:
          `local embedder is (model="${e.model}", dim=${e.dim}) but this registry declares ` +
          `(model="${tuple.model}", dim=${tuple.dim}) — vectors from different models are not comparable`,
      };
    }
    return { embedder: { mode: "local", model: e.model, dim: e.dim, embed: (t) => e.embed(t) } };
  } catch (err) {
    return {
      embedder: null,
      reason: `local embedding unavailable (${(err as Error).message.split("\n")[0]})`,
    };
  }
}

/** base64 little-endian float32, the encoding GET /search accepts. */
export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

/**
 * The sentence appended to every search result when the question left this
 * machine as text. Stated plainly on each call rather than buried in a README
 * nobody opens twice.
 */
export const REMOTE_EMBED_NOTICE =
  "Note: this search sent your question text to the registry, which can read and log it. " +
  "Install the optional local embedding dependency to send only a vector instead " +
  "(~240 MB; reduces exposure, does not make queries private — embedding inversion is real).";
