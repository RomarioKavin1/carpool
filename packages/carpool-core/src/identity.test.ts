import { describe, it, expect } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { HederaAuthor, signManifest } from "./identity.js";
import { canonicalHash } from "./magnet.js";

const ACCOUNT_ID = "0.0.1234";

function freshKeypair() {
  const priv = PrivateKey.generateECDSA();
  return { privHex: priv.toStringRaw(), pubHex: priv.publicKey.toStringRaw() };
}

describe("HederaAuthor + signManifest", () => {
  it("verify() accepts a signature signManifest produced for the same key and hash", async () => {
    const { privHex, pubHex } = freshKeypair();
    const manifestHash = canonicalHash({ question: "does the pool exist" });
    const sig = signManifest(privHex, manifestHash);
    const author = new HederaAuthor(pubHex, ACCOUNT_ID);
    await expect(author.verify(manifestHash, sig)).resolves.toBe(true);
  });

  it("verify() rejects a signature over a different manifest hash", async () => {
    const { privHex, pubHex } = freshKeypair();
    const sig = signManifest(privHex, canonicalHash({ question: "a" }));
    const author = new HederaAuthor(pubHex, ACCOUNT_ID);
    await expect(author.verify(canonicalHash({ question: "b" }), sig)).resolves.toBe(false);
  });

  it("verify() rejects a signature produced by a different key", async () => {
    const signer = freshKeypair();
    const other = freshKeypair();
    const manifestHash = canonicalHash({ question: "does the pool exist" });
    const sig = signManifest(signer.privHex, manifestHash);
    const author = new HederaAuthor(other.pubHex, ACCOUNT_ID);
    await expect(author.verify(manifestHash, sig)).resolves.toBe(false);
  });

  it("id() is derived from the public key, not the account id", () => {
    const { pubHex } = freshKeypair();
    const author = new HederaAuthor(pubHex, ACCOUNT_ID);
    expect(author.id()).not.toBe(ACCOUNT_ID);
    expect(author.id().toLowerCase()).toBe(pubHex.toLowerCase());
  });

  it("payout() returns the account id, independent of id()", () => {
    const { pubHex } = freshKeypair();
    const author = new HederaAuthor(pubHex, ACCOUNT_ID);
    expect(author.payout()).toBe(ACCOUNT_ID);
  });

  it("display() includes the payout account", () => {
    const { pubHex } = freshKeypair();
    const author = new HederaAuthor(pubHex, ACCOUNT_ID);
    expect(author.display()).toContain(ACCOUNT_ID);
  });
});
