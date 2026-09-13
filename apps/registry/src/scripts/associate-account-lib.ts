/**
 * Input validation for `associate:account`, kept free of network and SDK calls
 * so it can be unit tested. See `associate-account.ts` for the command itself.
 */

export const USDC_TESTNET = "0.0.429274";

/** DER prefix of a secp256k1 (ECDSA) private key, as the Hedera portal exports it. */
const ECDSA_DER_PREFIX = "3030020100300706052b8104000a04220420";
/** DER prefix of an ED25519 private key. */
const ED25519_DER_PREFIX = "302e020100300506032b657004220420";

export type KeyKind = "ecdsa" | "ed25519" | "raw";

export interface ParsedKey {
  /** `raw` is 32 bytes with no type marker: ECDSA or ED25519 cannot be told apart from the bytes alone. */
  readonly kind: KeyKind;
  /** The 32-byte private key, lowercase hex, no prefix. */
  readonly rawHex: string;
}

export class InputError extends Error {}

export function parseAccountId(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) throw new InputError("HEDERA_ACCOUNT_ID is not set. Pass it as an environment variable, e.g. HEDERA_ACCOUNT_ID=0.0.12345");
  if (!/^0\.0\.\d+$/.test(v)) {
    throw new InputError(`HEDERA_ACCOUNT_ID must look like 0.0.12345 (got a value of length ${v.length})`);
  }
  return v;
}

/** Never echoes the key, not even partially. */
export function parsePrivateKey(value: string | undefined): ParsedKey {
  let v = (value ?? "").trim();
  if (!v) throw new InputError("HEDERA_PRIVATE_KEY is not set. Pass it as an environment variable, never as an argument.");
  if (v.startsWith("0x") || v.startsWith("0X")) v = v.slice(2);
  v = v.toLowerCase();
  if (!/^[0-9a-f]+$/.test(v)) {
    throw new InputError("HEDERA_PRIVATE_KEY is not hex. Copy the HEX encoded private key from portal.hedera.com.");
  }
  if (v.startsWith(ED25519_DER_PREFIX) && v.length === ED25519_DER_PREFIX.length + 64) {
    throw ed25519Error();
  }
  if (v.startsWith(ECDSA_DER_PREFIX) && v.length === ECDSA_DER_PREFIX.length + 64) {
    return { kind: "ecdsa", rawHex: v.slice(ECDSA_DER_PREFIX.length) };
  }
  if (v.length === 64) return { kind: "raw", rawHex: v };
  throw new InputError(
    `HEDERA_PRIVATE_KEY has ${v.length} hex characters; expected 64 (raw) or a DER-encoded ECDSA key.`,
  );
}

/**
 * The mirror node reports the account's key type as `ECDSA_SECP256K1`,
 * `ED25519` or `ProtobufEncoded` (a key list). Only the first can pay via x402.
 */
export function checkAccountKeyType(mirrorKeyType: string | undefined): void {
  if (mirrorKeyType === "ECDSA_SECP256K1") return;
  if (mirrorKeyType === "ED25519") throw ed25519Error();
  throw new InputError(
    `This account's key is ${mirrorKeyType ?? "unknown"}, not a single ECDSA key. Create an ECDSA testnet account at portal.hedera.com.`,
  );
}

function ed25519Error(): InputError {
  return new InputError(
    "This is an ED25519 key. Carpool needs ECDSA: the x402 Hedera signer fails on ED25519. " +
      "Create an ECDSA testnet account at portal.hedera.com and use that one.",
  );
}
