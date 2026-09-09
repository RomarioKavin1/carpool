import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "@carpool/hedera-x402";
import { BodyStore, MAX_BODY_BYTES } from "./store.js";

let dir: string;
let store: BodyStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "carpool-registry-store-"));
  store = new BodyStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BodyStore", () => {
  it("writes and reads back content addressed by its own hash", () => {
    const content = "the answer is 42";
    const hash = sha256(content);
    store.write(hash, content);
    expect(store.has(hash)).toBe(true);
    expect(store.read(hash)).toBe(content);
  });

  it("rejects a write whose content does not hash to the given name", () => {
    expect(() => store.write(sha256("a"), "b")).toThrow(/does not hash to/);
  });

  it("rejects a body over the 2 MB cap", () => {
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect(() => store.write(sha256(big), big)).toThrow(/over the/);
  });

  it("has() is false for content never written", () => {
    expect(store.has(sha256("never written"))).toBe(false);
  });

  it("read() throws rather than return corrupted bytes", () => {
    const content = "original";
    const hash = sha256(content);
    store.write(hash, content);
    // Corrupt the file on disk directly, bypassing the store's own write path.
    writeFileSync(join(dir, hash), "tampered");
    expect(() => store.read(hash)).toThrow(/no longer hashes/);
  });

  it("rejects a path that isn't a sha256 hex digest, defensively", () => {
    expect(() => store.read("../../etc/passwd")).toThrow(/not a sha256 hex digest/);
  });
});
