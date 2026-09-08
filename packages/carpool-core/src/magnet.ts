import { createHash } from "node:crypto";
import type { Manifest } from "./manifest.js";

/**
 * Recursively key-sorted JSON value — the canonical form hashed by
 * `canonicalHash`. Array element order is preserved (arrays are ordered
 * data — `sources` order can matter); only object key order is normalised,
 * at every depth, including inside array elements.
 *
 * Only plain JSON-shaped values are canonicalised as objects — a `Date` (or
 * anything else with a `toJSON`) falls through to JSON.stringify's own
 * serialisation, unsorted, since it isn't a plain object. Not an issue for
 * `Manifest`, whose date fields are already ISO strings; would need handling
 * if a non-JSON value were ever hashed directly.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic sha256 over canonical JSON: keys sorted recursively, no
 * whitespace. Implemented here (not in @carpool/hedera-x402) — this is
 * content addressing for the v2 domain model, not the payment rail.
 */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/**
 * Content address for a manifest: sha256 of the canonical manifest, minus
 * the `magnet` field itself (which would otherwise reference its own hash).
 *
 * `Omit<Manifest,"magnet">` only strips the field at the type level — a full
 * `Manifest` (with `magnet` already set) is structurally assignable to it, so
 * the parameter type alone can't be trusted to keep `magnet` out of the hash.
 * Strip it at runtime too, so `m.magnet === magnetOf(m)` is a real fixed
 * point regardless of what the caller passes: this is exactly the check
 * Phase D's registry runs to verify a published artifact.
 *
 * Content-addressed, not question-addressed: keying on the question would
 * let the first author lock everyone else out of it while a one-word
 * paraphrase minted a fresh id. Several artifacts may answer the same
 * question; the tracker ranks between them by magnet, not by question.
 */
export function magnetOf(m: Omit<Manifest, "magnet">): string {
  const { magnet: _magnet, ...rest } = m as Manifest;
  return `swarm:${canonicalHash(rest)}`;
}
