import { PrivateKey, PublicKey } from "@hiero-ledger/sdk";

/**
 * Seam between the manifest's opaque `author` field and whatever actually
 * verifies and pays an author. `author` on the manifest is a bare string by
 * rule — nothing may parse it as a Hedera id, an ENS name, or anything else
 * chain-shaped — so `payout()` exists because nothing else can produce
 * `royalty.payee`: a settler needs an account to pay, and the only place
 * that account may come from is this interface.
 *
 * `EnsAuthor` (an author identified by an ENS name, paid out via whatever
 * account that name resolves to) lands later behind this same interface,
 * without a manifest schema migration.
 */
export interface AuthorIdentity {
  /** Opaque identifier stored on the artifact as `manifest.author`. */
  id(): string;
  /** The account royalties are paid to. May differ from id(). */
  payout(): string;
  /** Verifies `sig` (hex) over `manifestHash` (hex) was produced by this identity. */
  verify(manifestHash: string, sig: string): Promise<boolean>;
  /** Human-readable label for UIs — not guaranteed unique or stable. */
  display(): string;
}

/** Author identity backed by a Hedera ECDSA keypair; id() and payout() both derive from it. */
export class HederaAuthor implements AuthorIdentity {
  private readonly publicKey: PublicKey;
  private readonly accountId: string;

  constructor(publicKeyHex: string, accountId: string) {
    this.publicKey = PublicKey.fromStringECDSA(publicKeyHex);
    this.accountId = accountId;
  }

  id(): string {
    return this.publicKey.toStringRaw();
  }

  payout(): string {
    return this.accountId;
  }

  async verify(manifestHash: string, sig: string): Promise<boolean> {
    return this.publicKey.verify(Buffer.from(manifestHash, "hex"), Buffer.from(sig, "hex"));
  }

  display(): string {
    return `${this.accountId} (${this.id().slice(0, 12)}…)`;
  }
}

/** Signs a manifest hash (hex) with an ECDSA private key (hex); pairs with HederaAuthor#verify. */
export function signManifest(privKeyHex: string, manifestHash: string): string {
  const key = PrivateKey.fromStringECDSA(privKeyHex);
  return Buffer.from(key.sign(Buffer.from(manifestHash, "hex"))).toString("hex");
}

/**
 * Raw ECDSA public key hex for a private key hex — the exact spelling
 * `HederaAuthor`/`PublicKey.fromStringECDSA` accept back.
 *
 * Exists so a publishing client can build an `author` string that is
 * *self-consistent with the signature it is about to produce*. A client that
 * knows only its account id cannot: `apps/registry`'s author convention is
 * `"<accountId>:<publicKeyHex>"` (see its identity.ts), the public key half is
 * what `verify()` checks the signature against, and getting it from anywhere
 * other than the signing key is how you ship a manifest whose author cannot
 * verify its own signature.
 */
export function publicKeyHexOf(privKeyHex: string): string {
  return PrivateKey.fromStringECDSA(privKeyHex).publicKey.toStringRaw();
}
