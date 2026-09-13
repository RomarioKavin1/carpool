import { createHash } from "node:crypto";
import { PrivateKey, PublicKey } from "@hiero-ledger/sdk";
import type { AuthorIdentity } from "./identity.js";

/**
 * An author identified by an ENS name.
 *
 * This is the `EnsAuthor` identity.ts promised. Its opaque `manifest.author`
 * spelling is `"ens:<name>:<fallbackAccountId>:<publicKeyHex>"`, and every
 * part of it is inside the signed, content-addressed manifest:
 *
 * - `name` is the ENS name the key holder claims. A manifest signature over a
 *   string that contains the name is the key-to-name half of the binding, and
 *   nobody without the private key can produce it.
 * - `publicKeyHex` is what `verify()` checks signatures against, offline. A
 *   publish or a delist never waits on an Ethereum RPC.
 * - `fallbackAccountId` is a Hedera account the author signed for. It is what
 *   `payout()` returns, and what a sale pays whenever the name cannot be
 *   verified at purchase time. It exists so that no ENS failure (resolver down,
 *   record deleted, name expired and re-registered by someone else) can ever
 *   leave a sale without a payee, or send it to one the author never approved.
 *
 * The `ens:` prefix is chosen so the Hedera parser fails closed on it: under
 * `"<accountId>:<publicKeyHex>"`, `ens` would be the account and the rest would
 * not parse as a key, so an older registry rejects the publish instead of
 * paying an account called `ens`.
 *
 * The name-to-key half, and the account a sale actually pays, come from the
 * name's records at the moment they are needed: see `checkEnsBinding` and
 * `resolveEnsPayout`.
 */
export class EnsAuthor implements AuthorIdentity {
  private readonly publicKey: PublicKey;

  constructor(
    readonly name: string,
    readonly fallbackAccount: string,
    publicKeyHex: string,
  ) {
    this.publicKey = PublicKey.fromStringECDSA(publicKeyHex);
  }

  id(): string {
    return this.publicKey.toStringRaw();
  }

  /** The author-signed fallback. The live, name-resolved payee is `resolveEnsPayout`. */
  payout(): string {
    return this.fallbackAccount;
  }

  async verify(manifestHash: string, sig: string): Promise<boolean> {
    return this.publicKey.verify(Buffer.from(manifestHash, "hex"), Buffer.from(sig, "hex"));
  }

  display(): string {
    return this.name;
  }
}

/** SLIP-44 coin type for HBAR, used as the ENSIP-9 `addr(node, coinType)` key. */
export const HBAR_COIN_TYPE = 3030;

/** Text record holding the raw compressed ECDSA public key (hex) that signs this author's manifests. */
export const ENS_KEY_RECORD = "io.carpool.key";

/** Text record holding the key's signature over `payoutAttestationHash(name, hederaAccount)`. */
export const ENS_PAYOUT_SIG_RECORD = "io.carpool.payout-sig";

/**
 * ENSIP-5 global and service keys read for an author's public profile. Standard
 * keys on purpose: an author who already filled in their ENS profile gets a
 * Carpool profile for free, and nothing here is Carpool-specific except the two
 * records above.
 */
export const ENS_PROFILE_KEYS = ["description", "url", "avatar", "keywords", "com.github"] as const;

const ACCOUNT_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * ENSIP-9 binary form of a Hedera account id: 20 bytes, shard as a big-endian
 * u32 then realm and number as big-endian u64. This is the encoding
 * ensdomains/address-encoder registers for coin type 3030 (src/coin/hbar.ts),
 * and it is also Hedera's own "long-zero" EVM address layout.
 */
export function encodeHederaAddr(accountId: string): Uint8Array {
  const m = ACCOUNT_RE.exec(accountId.trim());
  if (!m) throw new Error(`not a Hedera account id (shard.realm.num): ${accountId}`);
  const shard = BigInt(m[1]!);
  const realm = BigInt(m[2]!);
  const num = BigInt(m[3]!);
  if (shard >= 2n ** 32n || realm >= 2n ** 64n || num >= 2n ** 64n) {
    throw new Error(`Hedera account id out of range: ${accountId}`);
  }
  const buf = new ArrayBuffer(20);
  const view = new DataView(buf);
  view.setUint32(0, Number(shard));
  view.setBigUint64(4, realm);
  view.setBigUint64(12, num);
  return new Uint8Array(buf);
}

/** Inverse of `encodeHederaAddr` over a `0x` hex string. `null` for anything that is not 20 bytes. */
export function decodeHederaAddr(hex: string): string | null {
  const h = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(h)) return null;
  const bytes = Buffer.from(h, "hex");
  const view = new DataView(bytes.buffer, bytes.byteOffset, 20);
  return `${view.getUint32(0)}.${view.getBigUint64(4)}.${view.getBigUint64(12)}`;
}

/**
 * A cheap structural check, not ENSIP-15 normalisation (which needs the
 * Unicode tables and lives with the registry's ENS client). It refuses the
 * cases that would make the author string ambiguous or obviously
 * un-normalised: a colon, whitespace, ASCII upper case, an empty label, or no
 * dot at all.
 */
function assertNameShape(name: string): void {
  if (name === "" || /[\s:]/.test(name) || !name.includes(".") || name.split(".").some((l) => l === "")) {
    throw new Error(`not an ENS name: ${JSON.stringify(name)}`);
  }
  if (/[A-Z]/.test(name)) {
    throw new Error(`ENS name must be normalised (ENSIP-15, lower case): ${JSON.stringify(name)}`);
  }
}

/** Builds the opaque author string for an ENS author. */
export function ensAuthorString(name: string, fallbackAccount: string, publicKeyHex: string): string {
  assertNameShape(name);
  if (!ACCOUNT_RE.test(fallbackAccount)) throw new Error(`fallback account must be shard.realm.num, got ${fallbackAccount}`);
  return `ens:${name}:${fallbackAccount}:${publicKeyHex}`;
}

/**
 * Parses an ENS author string. `null` when `opaque` is not in the ENS
 * convention at all (so a caller can try the Hedera one), and a throw when it
 * claims to be (`ens:` prefix) but is malformed.
 */
export function parseEnsAuthor(opaque: string): EnsAuthor | null {
  if (!opaque.startsWith("ens:")) return null;
  const parts = opaque.slice(4).split(":");
  if (parts.length !== 3) {
    throw new Error(`ENS author must be "ens:<name>:<fallbackAccountId>:<publicKeyHex>", got: ${opaque}`);
  }
  const [name, account, key] = parts as [string, string, string];
  assertNameShape(name);
  if (!ACCOUNT_RE.test(account)) {
    throw new Error(`ENS author's fallback account must be a Hedera account id (shard.realm.num), got: ${account}`);
  }
  return new EnsAuthor(name, account, key);
}

/**
 * The message an author signs to say "payouts for `name` may go to `account`".
 *
 * Domain-separated from manifest hashes and from the buyer messages
 * (`<txId>:<magnet>:refund`), and it names both the name and the account, so
 * the signature can neither be replayed onto another name nor re-pointed at
 * another account by whoever controls the name's records.
 */
export function payoutAttestationHash(name: string, account: string): string {
  return createHash("sha256").update(`carpool:ens-payout:v1:${name}:${account}`, "utf8").digest("hex");
}

/** Produces the `io.carpool.payout-sig` record value. Run by the author, offline. */
export function signPayoutAttestation(privKeyHex: string, name: string, account: string): string {
  const key = PrivateKey.fromStringECDSA(privKeyHex);
  return Buffer.from(key.sign(Buffer.from(payoutAttestationHash(name, account), "hex"))).toString("hex");
}

/**
 * The read-only view of ENS this module needs. The registry implements it with
 * viem over the Universal Resolver; tests implement it with a map.
 *
 * Both methods resolve `null` for "the name has no such record" and reject for
 * "could not find out". The difference matters: the first is a fact about the
 * name, the second is a fact about the network, and they are reported apart.
 */
export interface EnsRecordReader {
  text(name: string, key: string): Promise<string | null>;
  /** The raw `addr(node, 3030)` bytes as `0x` hex, or null when unset. */
  hederaAddr(name: string): Promise<string | null>;
}

export interface EnsBinding {
  name: string;
  /**
   * `verified`: all three checks pass right now.
   * `unbound`: the name answered, and at least one check failed.
   * `unreachable`: the name could not be read, so nothing is known either way.
   */
  status: "verified" | "unbound" | "unreachable";
  checks: {
    key: "match" | "mismatch" | "missing" | "unknown";
    hederaAddr: "present" | "malformed" | "missing" | "unknown";
    payoutSig: "valid" | "invalid" | "missing" | "unknown";
  };
  /** The decoded `addr(3030)` record, whether or not it is attested. */
  hederaAccount: string | null;
  /** One plain sentence per failed check. Empty when verified. */
  problems: string[];
}

export interface EnsReadOptions {
  /** Upper bound on the whole read. Default 3000 ms. */
  timeoutMs?: number;
}

const normKey = (hex: string) => hex.trim().toLowerCase().replace(/^0x/, "");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`ENS read timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Checks the name-to-key half of an ENS author's binding, live. Never throws.
 *
 * Three records have to agree with the manifest's own `author` string:
 *
 * 1. `io.carpool.key` equals the key in the author string. The name owner says
 *    "this key speaks for me"; the manifest signature already says the reverse.
 * 2. `addr(node, 3030)` decodes to a Hedera account.
 * 3. `io.carpool.payout-sig` is that key's signature over
 *    `payoutAttestationHash(name, account)`.
 *
 * The third is what the first two cannot do alone. A public key is public, so
 * anyone who gains control of the name's records (a transfer, an expiry and
 * re-registration, or an ENSv2 role grant on the resolver) can copy it into the
 * key record and point the address record at themselves. They cannot sign the
 * new account with the author's private key, and an old attestation names the
 * old account.
 */
export async function checkEnsBinding(
  author: EnsAuthor,
  reader: EnsRecordReader,
  opts: EnsReadOptions = {},
): Promise<EnsBinding> {
  const name = author.name;
  let keyRec: string | null;
  let sigRec: string | null;
  let addrRec: string | null;
  try {
    [keyRec, sigRec, addrRec] = await withTimeout(
      Promise.all([
        Promise.resolve().then(() => reader.text(name, ENS_KEY_RECORD)),
        Promise.resolve().then(() => reader.text(name, ENS_PAYOUT_SIG_RECORD)),
        Promise.resolve().then(() => reader.hederaAddr(name)),
      ]),
      opts.timeoutMs ?? 3000,
    );
  } catch (e) {
    return {
      name,
      status: "unreachable",
      checks: { key: "unknown", hederaAddr: "unknown", payoutSig: "unknown" },
      hederaAccount: null,
      problems: [`could not read ${name} from ENS: ${(e as Error).message.split("\n")[0]}`],
    };
  }

  const problems: string[] = [];

  let key: EnsBinding["checks"]["key"];
  if (!keyRec || keyRec.trim() === "") {
    key = "missing";
    problems.push(`${name} has no ${ENS_KEY_RECORD} text record`);
  } else if (normKey(keyRec) === normKey(author.id())) {
    key = "match";
  } else {
    key = "mismatch";
    problems.push(`${name}'s ${ENS_KEY_RECORD} is a different key from the one that signed this manifest`);
  }

  let hederaAddr: EnsBinding["checks"]["hederaAddr"];
  let hederaAccount: string | null = null;
  if (!addrRec || addrRec === "0x") {
    hederaAddr = "missing";
    problems.push(`${name} has no Hedera address record (coin type ${HBAR_COIN_TYPE})`);
  } else {
    hederaAccount = decodeHederaAddr(addrRec);
    if (hederaAccount) hederaAddr = "present";
    else {
      hederaAddr = "malformed";
      problems.push(`${name}'s Hedera address record is not a 20-byte ENSIP-9 account encoding`);
    }
  }

  let payoutSig: EnsBinding["checks"]["payoutSig"];
  if (!sigRec || sigRec.trim() === "") {
    payoutSig = "missing";
    problems.push(`${name} has no ${ENS_PAYOUT_SIG_RECORD} text record`);
  } else {
    let ok = false;
    if (hederaAccount) {
      try {
        ok = await author.verify(payoutAttestationHash(name, hederaAccount), normKey(sigRec));
      } catch {
        ok = false;
      }
    }
    payoutSig = ok ? "valid" : "invalid";
    if (!ok) {
      problems.push(
        `${name}'s ${ENS_PAYOUT_SIG_RECORD} is not this author's signature over its current Hedera address record`,
      );
    }
  }

  const verified = key === "match" && hederaAddr === "present" && payoutSig === "valid";
  return {
    name,
    status: verified ? "verified" : "unbound",
    checks: { key, hederaAddr, payoutSig },
    hederaAccount,
    problems,
  };
}

export interface EnsPayoutDecision {
  /** The Hedera account this sale pays. */
  account: string;
  /** `ens`: the name's attested addr record. `fallback`: the author-signed account in `manifest.author`. */
  source: "ens" | "fallback";
  /** Why, in one sentence. Logged at purchase time. */
  reason: string;
}

/**
 * The payee for one sale by an ENS author, decided at purchase time. Never
 * rejects.
 *
 * Pays the name's Hedera account only when `checkEnsBinding` says `verified`
 * at this moment; every other outcome pays the fallback account the author
 * signed into the manifest. The asymmetry is the point: a false `verified`
 * would move money to someone the author never approved, while a false
 * fallback moves it to an account the author did approve, just not their
 * latest one.
 */
export async function resolveEnsPayout(
  author: EnsAuthor,
  reader: EnsRecordReader,
  opts: EnsReadOptions = {},
): Promise<EnsPayoutDecision> {
  let binding: EnsBinding;
  try {
    binding = await checkEnsBinding(author, reader, opts);
  } catch (e) {
    return {
      account: author.fallbackAccount,
      source: "fallback",
      reason: `ENS check failed unexpectedly (${(e as Error).message}); paid the author-signed fallback`,
    };
  }
  if (binding.status === "verified" && binding.hederaAccount) {
    return {
      account: binding.hederaAccount,
      source: "ens",
      reason: `${author.name} is verified and its Hedera record is attested`,
    };
  }
  return {
    account: author.fallbackAccount,
    source: "fallback",
    reason:
      binding.status === "unreachable"
        ? `${author.name} was unreachable at purchase time; paid the author-signed fallback`
        : `${author.name} is not verified (${binding.problems.join("; ")}); paid the author-signed fallback`,
  };
}
