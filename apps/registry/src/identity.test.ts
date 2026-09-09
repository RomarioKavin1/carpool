import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { sha256 } from "@carpool/hedera-x402";
import { parseHederaAuthor, verifyBuyerRefund, type AccountKeyResolver } from "./identity.js";

function freshKeypair() {
  const priv = PrivateKey.generateECDSA();
  return { priv, privHex: priv.toStringRaw(), pubHex: priv.publicKey.toStringRaw() };
}

describe("parseHederaAuthor", () => {
  it("splits '<accountId>:<publicKeyHex>' into a HederaAuthor with a matching payout() and id()", () => {
    const { pubHex } = freshKeypair();
    const author = parseHederaAuthor(`0.0.5555:${pubHex}`);
    expect(author.payout()).toBe("0.0.5555");
    expect(author.id().toLowerCase()).toBe(pubHex.toLowerCase());
  });

  it("throws a readable error for an author string with no ':'", () => {
    expect(() => parseHederaAuthor("not-a-valid-author")).toThrow(/accountId.*publicKeyHex/);
  });
});

describe("verifyBuyerRefund", () => {
  const accountId = "0.0.9999";

  function resolverThatSays(controls: boolean): AccountKeyResolver {
    return { controls: async () => controls };
  }

  it("accepts a signature from the claimed key when the resolver confirms it controls the account", async () => {
    const { priv, pubHex } = freshKeypair();
    const messageHashHex = sha256("txid:magnet:refund");
    const signature = Buffer.from(priv.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");
    const ok = await verifyBuyerRefund(resolverThatSays(true), {
      accountId,
      publicKeyHex: pubHex,
      messageHashHex,
      signature,
    });
    expect(ok).toBe(true);
  });

  it("rejects even a valid signature when the resolver says the key does not control the account", async () => {
    const { priv, pubHex } = freshKeypair();
    const messageHashHex = sha256("txid:magnet:refund");
    const signature = Buffer.from(priv.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");
    const ok = await verifyBuyerRefund(resolverThatSays(false), {
      accountId,
      publicKeyHex: pubHex,
      messageHashHex,
      signature,
    });
    expect(ok).toBe(false);
  });

  it("rejects a signature produced by a different key even if the resolver is fooled", async () => {
    const signer = freshKeypair();
    const other = freshKeypair();
    const messageHashHex = sha256("txid:magnet:refund");
    const signature = Buffer.from(signer.priv.sign(Buffer.from(messageHashHex, "hex"))).toString("hex");
    // Attacker supplies their own public key, and a permissive resolver says it "controls" the account.
    const ok = await verifyBuyerRefund(resolverThatSays(true), {
      accountId,
      publicKeyHex: other.pubHex,
      messageHashHex,
      signature,
    });
    expect(ok).toBe(false);
  });
});
