import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import {
  ENS_KEY_RECORD,
  ENS_PAYOUT_SIG_RECORD,
  EnsAuthor,
  HBAR_COIN_TYPE,
  checkEnsBinding,
  decodeHederaAddr,
  encodeHederaAddr,
  ensAuthorString,
  parseEnsAuthor,
  payoutAttestationHash,
  resolveEnsPayout,
  signPayoutAttestation,
  type EnsRecordReader,
} from "./ens.js";
import { signManifest } from "./identity.js";

function keypair() {
  const priv = PrivateKey.generateECDSA();
  return { privHex: priv.toStringRaw(), pubHex: priv.publicKey.toStringRaw() };
}

/** An in-memory resolver: `records[name]` is what the name's resolver would return. */
function mockReader(
  records: Record<string, { texts?: Record<string, string>; hbar?: string | null }>,
  opts: { fail?: boolean; hangMs?: number } = {},
): EnsRecordReader & { calls: number } {
  const r = {
    calls: 0,
    async text(name: string, key: string) {
      r.calls++;
      if (opts.hangMs) await new Promise((res) => setTimeout(res, opts.hangMs));
      if (opts.fail) throw new Error("rpc down");
      return records[name]?.texts?.[key] ?? null;
    },
    async hederaAddr(name: string) {
      r.calls++;
      if (opts.hangMs) await new Promise((res) => setTimeout(res, opts.hangMs));
      if (opts.fail) throw new Error("rpc down");
      const acct = records[name]?.hbar;
      return acct ? `0x${Buffer.from(encodeHederaAddr(acct)).toString("hex")}` : null;
    },
  };
  return r;
}

describe("ENSIP-9 Hedera address encoding (coin type 3030)", () => {
  it("uses SLIP-44 coin type 3030", () => {
    expect(HBAR_COIN_TYPE).toBe(3030);
  });

  it("matches ensdomains/address-encoder's hbar vectors byte for byte", () => {
    // Vectors copied from ensdomains/address-encoder src/coin/hbar.test.ts.
    expect(Buffer.from(encodeHederaAddr("255.255.1024")).toString("hex")).toBe(
      "000000ff00000000000000ff0000000000000400",
    );
    expect(decodeHederaAddr("0x000000ff00000000000000ff0000000000000400")).toBe("255.255.1024");
    expect(decodeHederaAddr("0xffffffffffffffffffffffffffffffffffffffff")).toBe(
      `${2n ** 32n - 1n}.${2n ** 64n - 1n}.${2n ** 64n - 1n}`,
    );
  });

  it("round-trips a real testnet account id", () => {
    expect(decodeHederaAddr(`0x${Buffer.from(encodeHederaAddr("0.0.10475802")).toString("hex")}`)).toBe("0.0.10475802");
  });

  it("returns null for anything that is not exactly 20 bytes, rather than guessing", () => {
    expect(decodeHederaAddr("0x")).toBeNull();
    expect(decodeHederaAddr("0x0102")).toBeNull();
    expect(decodeHederaAddr(`0x${"00".repeat(21)}`)).toBeNull();
    expect(decodeHederaAddr("not hex")).toBeNull();
  });

  it("refuses to encode a malformed account id", () => {
    expect(() => encodeHederaAddr("0.0")).toThrow();
    expect(() => encodeHederaAddr("a.b.c")).toThrow();
  });
});

describe("ENS author strings", () => {
  const { pubHex } = keypair();

  it("round-trips ens:<name>:<fallbackAccount>:<publicKeyHex>", () => {
    const s = ensAuthorString("alice.eth", "0.0.1234", pubHex);
    expect(s).toBe(`ens:alice.eth:0.0.1234:${pubHex}`);
    const a = parseEnsAuthor(s)!;
    expect(a).toBeInstanceOf(EnsAuthor);
    expect(a.name).toBe("alice.eth");
    expect(a.fallbackAccount).toBe("0.0.1234");
    expect(a.payout()).toBe("0.0.1234");
    expect(a.id().toLowerCase()).toBe(pubHex.toLowerCase());
    expect(a.display()).toBe("alice.eth");
  });

  it("returns null for the Hedera convention, so the two never collide", () => {
    expect(parseEnsAuthor(`0.0.1234:${pubHex}`)).toBeNull();
  });

  it("throws on an ens: string that is malformed, instead of paying a garbage account", () => {
    expect(() => parseEnsAuthor(`ens:alice.eth:${pubHex}`)).toThrow(/ens:<name>/);
    expect(() => parseEnsAuthor(`ens:alice.eth:alice:${pubHex}`)).toThrow(/account/);
    expect(() => parseEnsAuthor(`ens:Alice.eth:0.0.1:${pubHex}`)).toThrow(/normali/);
    expect(() => parseEnsAuthor(`ens:alice:0.0.1:${pubHex}`)).toThrow(/name/);
    expect(() => parseEnsAuthor(`ens:alice.eth:0.0.1:nothex`)).toThrow();
  });

  it("verifies a manifest signature against the embedded key, with no network", async () => {
    const kp = keypair();
    const a = parseEnsAuthor(ensAuthorString("alice.eth", "0.0.1234", kp.pubHex))!;
    const hash = "ab".repeat(32);
    expect(await a.verify(hash, signManifest(kp.privHex, hash))).toBe(true);
    expect(await a.verify(hash, signManifest(keypair().privHex, hash))).toBe(false);
  });
});

describe("checkEnsBinding: the two-way binding", () => {
  const kp = keypair();
  const NAME = "alice.eth";
  const ROTATED = "0.0.7777";
  const author = parseEnsAuthor(ensAuthorString(NAME, "0.0.1234", kp.pubHex))!;
  const goodRecords = (account = ROTATED, signer = kp.privHex, key = kp.pubHex) => ({
    [NAME]: {
      texts: {
        [ENS_KEY_RECORD]: key,
        [ENS_PAYOUT_SIG_RECORD]: signPayoutAttestation(signer, NAME, account),
      },
      hbar: account,
    },
  });

  it("is verified only when key record, Hedera addr record and payout attestation all agree", async () => {
    const b = await checkEnsBinding(author, mockReader(goodRecords()));
    expect(b.status).toBe("verified");
    expect(b.hederaAccount).toBe(ROTATED);
    expect(b.checks).toEqual({ key: "match", hederaAddr: "present", payoutSig: "valid" });
    expect(b.problems).toEqual([]);
  });

  it("accepts 0x-prefixed and upper-case key records", async () => {
    const recs = goodRecords();
    recs[NAME]!.texts[ENS_KEY_RECORD] = `0x${kp.pubHex.toUpperCase()}`;
    expect((await checkEnsBinding(author, mockReader(recs))).status).toBe("verified");
  });

  it("an impersonator who copies the public key but lacks the private key cannot attest a payout", async () => {
    // mallory controls the name's records (e.g. bought it after it expired) and
    // copies the public key, which is public, but has to sign with their own key.
    const mallory = keypair();
    const b = await checkEnsBinding(author, mockReader(goodRecords("0.0.6666", mallory.privHex)));
    expect(b.status).toBe("unbound");
    expect(b.checks.payoutSig).toBe("invalid");
    expect(b.hederaAccount).toBe("0.0.6666");
  });

  it("a copied attestation for the old account does not authorise a new addr record", async () => {
    const recs = goodRecords();
    recs[NAME]!.hbar = "0.0.6666"; // new owner points addr at themselves, keeps the old signature
    const b = await checkEnsBinding(author, mockReader(recs));
    expect(b.status).toBe("unbound");
    expect(b.checks.payoutSig).toBe("invalid");
  });

  it("a key record for a different key is a mismatch", async () => {
    const b = await checkEnsBinding(author, mockReader(goodRecords(ROTATED, kp.privHex, keypair().pubHex)));
    expect(b.status).toBe("unbound");
    expect(b.checks.key).toBe("mismatch");
  });

  it("a name with no carpool records is unbound with every problem named", async () => {
    const b = await checkEnsBinding(author, mockReader({}));
    expect(b.status).toBe("unbound");
    expect(b.checks).toEqual({ key: "missing", hederaAddr: "missing", payoutSig: "missing" });
    expect(b.problems.length).toBe(3);
    expect(b.hederaAccount).toBeNull();
  });

  it("an attestation signed over a different name does not transfer", async () => {
    const recs = goodRecords();
    recs[NAME]!.texts[ENS_PAYOUT_SIG_RECORD] = signPayoutAttestation(kp.privHex, "bob.eth", ROTATED);
    expect((await checkEnsBinding(author, mockReader(recs))).checks.payoutSig).toBe("invalid");
  });

  it("an unreachable resolver is 'unreachable', never 'unbound' and never a throw", async () => {
    const b = await checkEnsBinding(author, mockReader(goodRecords(), { fail: true }));
    expect(b.status).toBe("unreachable");
    expect(b.hederaAccount).toBeNull();
  });

  it("a resolver that hangs past the timeout is 'unreachable'", async () => {
    const b = await checkEnsBinding(author, mockReader(goodRecords(), { hangMs: 200 }), { timeoutMs: 20 });
    expect(b.status).toBe("unreachable");
  });

  it("the attestation message is domain-separated and names both the name and the account", () => {
    expect(payoutAttestationHash("alice.eth", "0.0.1")).not.toBe(payoutAttestationHash("alice.eth", "0.0.2"));
    expect(payoutAttestationHash("alice.eth", "0.0.1")).not.toBe(payoutAttestationHash("bob.eth", "0.0.1"));
    expect(payoutAttestationHash("alice.eth", "0.0.1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveEnsPayout: money never follows an unverified name", () => {
  const kp = keypair();
  const NAME = "alice.eth";
  const FALLBACK = "0.0.1234";
  const author = parseEnsAuthor(ensAuthorString(NAME, FALLBACK, kp.pubHex))!;
  const records = (account: string, signer = kp.privHex) => ({
    [NAME]: {
      texts: {
        [ENS_KEY_RECORD]: kp.pubHex,
        [ENS_PAYOUT_SIG_RECORD]: signPayoutAttestation(signer, NAME, account),
      },
      hbar: account,
    },
  });

  it("pays the name's current Hedera account when the binding is verified", async () => {
    const p = await resolveEnsPayout(author, mockReader(records("0.0.7777")));
    expect(p).toMatchObject({ account: "0.0.7777", source: "ens" });
  });

  it("follows a rotation with no republish: the next resolution pays the new account", async () => {
    const recs = records("0.0.7777");
    const reader = mockReader(recs);
    expect((await resolveEnsPayout(author, reader)).account).toBe("0.0.7777");
    Object.assign(recs, records("0.0.8888"));
    expect((await resolveEnsPayout(author, reader)).account).toBe("0.0.8888");
  });

  it("falls back to the author-signed account when the resolver is down", async () => {
    const p = await resolveEnsPayout(author, mockReader(records("0.0.7777"), { fail: true }));
    expect(p).toMatchObject({ account: FALLBACK, source: "fallback" });
    expect(p.reason).toMatch(/unreachable/);
  });

  it("falls back when the name has no Hedera record", async () => {
    const recs = records("0.0.7777");
    recs[NAME]!.hbar = null;
    const p = await resolveEnsPayout(author, mockReader(recs));
    expect(p).toMatchObject({ account: FALLBACK, source: "fallback" });
  });

  it("falls back, and does NOT pay the new account, when the attestation is forged", async () => {
    const p = await resolveEnsPayout(author, mockReader(records("0.0.6666", keypair().privHex)));
    expect(p).toMatchObject({ account: FALLBACK, source: "fallback" });
  });

  it("falls back on a hang past the timeout", async () => {
    const p = await resolveEnsPayout(author, mockReader(records("0.0.7777"), { hangMs: 200 }), { timeoutMs: 20 });
    expect(p.account).toBe(FALLBACK);
  });

  it("never rejects, even if the reader throws synchronously", async () => {
    const reader: EnsRecordReader = {
      text() {
        throw new Error("boom");
      },
      hederaAddr() {
        throw new Error("boom");
      },
    };
    await expect(resolveEnsPayout(author, reader)).resolves.toMatchObject({ account: FALLBACK });
  });
});
