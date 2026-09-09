import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { merkleRoot, payeeLeaves } from "./merkle.js";

const h = (s: string) => createHash("sha256").update(s).digest("hex");

describe("merkleRoot", () => {
  it("single leaf = hash of that leaf", () => {
    expect(merkleRoot(payeeLeaves([["0.0.1", 100]]))).toBe(h("0.0.1:100"));
  });

  it("two leaves = hash of concatenated leaf hashes (sorted)", () => {
    const a = h("0.0.1:100");
    const b = h("0.0.2:200");
    expect(merkleRoot(payeeLeaves([["0.0.1", 100], ["0.0.2", 200]]))).toBe(h(a + b));
  });

  it("is order-independent (sorted by payee)", () => {
    const r1 = merkleRoot(payeeLeaves([["0.0.3", 3], ["0.0.1", 1], ["0.0.2", 2]]));
    const r2 = merkleRoot(payeeLeaves([["0.0.1", 1], ["0.0.2", 2], ["0.0.3", 3]]));
    expect(r1).toBe(r2);
  });

  it("changes when any input changes", () => {
    const base = merkleRoot(payeeLeaves([["0.0.1", 100], ["0.0.2", 200]]));
    expect(merkleRoot(payeeLeaves([["0.0.1", 101], ["0.0.2", 200]]))).not.toBe(base);
    expect(merkleRoot(payeeLeaves([["0.0.1", 100], ["0.0.3", 200]]))).not.toBe(base);
  });

  it("odd leaf count promotes the last node", () => {
    const l = [h("0.0.1:1"), h("0.0.2:2"), h("0.0.3:3")];
    const expected = h(h(l[0] + l[1]) + l[2]);
    expect(merkleRoot(payeeLeaves([["0.0.1", 1], ["0.0.2", 2], ["0.0.3", 3]]))).toBe(expected);
  });

  it("empty set is a stable sentinel", () => {
    expect(merkleRoot(payeeLeaves([]))).toBe(h(""));
  });
});
