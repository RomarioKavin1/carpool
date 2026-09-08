import { z } from "zod";

/**
 * The free half of a research artifact — everything a buyer can see before
 * paying. The paid half is the body; only its hash and byte count live here.
 *
 * `author` is deliberately opaque: it identifies who to pay and whom to trust,
 * but nothing here says how. Parsing it as a Hedera account id (or any other
 * chain-specific shape) is a bug — see identity.ts, whose `AuthorIdentity`
 * interface is the only sanctioned way to turn `author` into a payee.
 */
export const ManifestSchema = z.object({
  /** swarm:<sha256 hex> — see magnet.ts. Content-addressed, not question-addressed. */
  magnet: z.string().regex(/^swarm:[0-9a-f]{64}$/, "magnet must be swarm:<64 hex>"),
  question: z.string().min(1),
  /** Canonicalised question: lowercase, collapsed whitespace, no trailing punctuation. */
  questionNorm: z.string().min(1),
  /** The event this artifact answers a question about, e.g. "ethonline-2026". */
  scope: z.string().min(1).optional(),
  abstract: z.string().min(1),
  sources: z.array(
    z.object({
      url: z.string().url(),
      fetchedAt: z.string().datetime({ offset: true }),
    }),
  ),
  provenance: z.object({
    model: z.string().min(1),
    durationSeconds: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
  }),
  decay: z.object({
    /** Zero and negative half-lives are rejected here — freshness would divide by <=0. */
    halfLifeDays: z.number().positive(),
    producedAt: z.string().datetime({ offset: true }),
  }),
  /** OPAQUE. Never parse as a Hedera id — see AuthorIdentity in identity.ts. */
  author: z.string().min(1),
  /** sha256 hex of the paid body. */
  bodyHash: z.string().regex(/^[0-9a-f]{64}$/, "bodyHash must be sha256 hex"),
  bodyBytes: z.number().int().nonnegative(),
  redacted: z.boolean(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Canonicalises a question into the exact string `questionNorm` above must
 * hold: lowercase, collapsed whitespace, no trailing punctuation.
 *
 * Lives here, next to the field it defines, and deliberately in the
 * dependency-free half of this package: `questionNorm` is part of the signed,
 * content-addressed manifest, so *every* participant must compute it the same
 * way or the content address forks. Before this, two implementations existed —
 * `@carpool/tracker`'s (which drags better-sqlite3 + an ONNX runtime through
 * its index module) and a hand-rolled copy in `apps/mcp/src/publish.ts` that
 * stripped `[.?!,;:]` where the tracker stripped `[\s.,!?;:'"()]`. The two
 * disagreed on any question ending in a quote or a bracket, and the magnet was
 * computed over whichever one the client happened to run. One function, no
 * heavy imports, so the registry can recompute and reject a mismatch (see
 * `POST /publish`) without depending on the tracker.
 *
 * Two questions that normalise to the same string are the same question for
 * exact-duplicate purposes. Near-duplicates are the embedding index's job.
 */
export function normalizeQuestion(q: string): string {
  const collapsed = q.toLowerCase().trim().replace(/\s+/g, " ");
  // Trailing punctuation/whitespace only — never touch the interior, where
  // "what's" or "e.g." carry meaning.
  return collapsed.replace(/[\s.,!?;:'"()]+$/g, "");
}

/** Parses and validates a manifest, throwing a readable message on failure. */
export function parseManifest(u: unknown): Manifest {
  const result = ManifestSchema.safeParse(u);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid manifest: ${issues}`);
  }
  return result.data;
}
