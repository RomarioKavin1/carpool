import { createHash } from "node:crypto";

function h(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic Merkle root over opaque string leaves.
 *
 * Generalised from v1's `[payee, amount][]`: the anchor now carries artifact
 * manifest hashes as well as payout rows, and a tree that can only hash
 * "payee:amount" cannot express the former. `payeeLeaves` preserves the old
 * encoding exactly, so existing roots still reproduce.
 *
 * Leaves are sorted, so the root is order-independent. Leaf = sha256(leaf);
 * internal = sha256(left + right); an odd node is promoted. Empty set →
 * sha256("") as a sentinel.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return h("");
  const sorted = [...leaves].sort();
  let level = sorted.map((leaf) => h(leaf));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i]!;
      const r = level[i + 1];
      next.push(r === undefined ? l : h(l + r));
    }
    level = next;
  }
  return level[0]!;
}

/** The v1 encoding: `payee:amount`, sorted by payee then amount. */
export function payeeLeaves(rows: [string, number][]): string[] {
  return [...rows]
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1))
    .map(([payee, amount]) => `${payee}:${amount}`);
}
