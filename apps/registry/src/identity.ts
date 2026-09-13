import { HederaAuthor, parseEnsAuthor, type AuthorIdentity } from "@carpool/core";
import { PublicKey } from "@hiero-ledger/sdk";

/**
 * `manifest.author` is opaque by rule (see @carpool/core identity.ts) —
 * nothing may assume its shape except the registry that chose how to
 * interpret it. This registry's convention, since it pays authors over
 * Hedera: `"<payoutAccountId>:<publicKeyHex>"`.
 *
 * The account id is part of the opaque string (not a separate publish field)
 * because it is content the author is vouching for with the same signature
 * that vouches for the rest of the manifest — a publish that changed only
 * the payout account without re-signing would otherwise slip past
 * `verify()`.
 */
export function parseHederaAuthor(opaque: string): AuthorIdentity {
  const i = opaque.indexOf(":");
  if (i < 0) {
    throw new Error(
      `author must be "<accountId>:<publicKeyHex>" (this registry's Hedera convention), got: ${opaque}`,
    );
  }
  const accountId = opaque.slice(0, i);
  const publicKeyHex = opaque.slice(i + 1);
  return new HederaAuthor(publicKeyHex, accountId);
}

/**
 * Every author convention this registry accepts, in one place:
 *
 * - `"ens:<name>:<fallbackAccountId>:<publicKeyHex>"` is an `EnsAuthor`
 *   (@carpool/core ens.ts). Its `payout()` is the signed fallback; the payee a
 *   sale actually uses is decided at purchase time by `choosePayout` (ens.ts).
 * - anything else goes to `parseHederaAuthor`, unchanged.
 *
 * Signature checks (`verify`) are offline for both, so publish, delist and rate
 * never depend on an Ethereum RPC.
 */
export function parseAuthor(opaque: string): AuthorIdentity {
  return parseEnsAuthor(opaque) ?? parseHederaAuthor(opaque);
}

/**
 * Resolves whether a public key actually controls a Hedera account, via the
 * mirror node. Injected everywhere it's used so tests never touch the
 * network — see `mirrorNodeKeyResolver` for the real implementation and
 * `server.ts` / test files for the stub.
 */
export interface AccountKeyResolver {
  controls(accountId: string, publicKeyHex: string): Promise<boolean>;
}

function normaliseKeyHex(hex: string): string {
  return hex.trim().toLowerCase().replace(/^0x/, "");
}

/** Real resolver: GET /api/v1/accounts/{id} and compare the simple ECDSA key on file. */
export function mirrorNodeKeyResolver(mirrorUrl: string): AccountKeyResolver {
  return {
    async controls(accountId, publicKeyHex) {
      const res = await fetch(`${mirrorUrl}/api/v1/accounts/${accountId}`);
      if (!res.ok) return false;
      const json = (await res.json()) as { key?: { key?: string; _type?: string } };
      const onFile = json.key?.key;
      if (!onFile) return false;
      return normaliseKeyHex(onFile) === normaliseKeyHex(publicKeyHex);
    },
  };
}

/**
 * Verifies that a buyer authorised an action: `signature` (hex) must be produced
 * by `publicKeyHex` over `messageHashHex`, AND `publicKeyHex` must actually
 * control `accountId` (the recorded `purchase.buyer`) — the signature alone
 * proves nothing about whose account it is without that second check, since
 * anyone can generate a keypair and sign anything with it.
 *
 * Both halves, in that order, and the order is the cheap one: the mirror-node
 * lookup settles "is this key the buyer's" before any signature maths runs.
 *
 * Action-agnostic on purpose. The *message* is what separates one buyer action
 * from another (`sha256("<txId>:<magnet>:refund")` for `POST /refund`,
 * `sha256("<txId>:<magnet>:rate:…")` for `POST /rate`), and that domain separation
 * belongs to each route rather than in here — a helper that built the message
 * would be a helper that could be given the wrong verb. See `verifyBuyerRefund`
 * below, which is this function under the name its one caller reads best.
 */
export async function verifyBuyerAction(
  resolver: AccountKeyResolver,
  args: { accountId: string; publicKeyHex: string; messageHashHex: string; signature: string },
): Promise<boolean> {
  const controls = await resolver.controls(args.accountId, args.publicKeyHex);
  if (!controls) return false;
  const pk = PublicKey.fromStringECDSA(args.publicKeyHex);
  return pk.verify(Buffer.from(args.messageHashHex, "hex"), Buffer.from(args.signature, "hex"));
}

/**
 * `verifyBuyerAction` at the refund call site: `messageHashHex` must be
 * sha256("<txId>:<magnet>:refund") — see `POST /refund`, which builds it.
 */
export const verifyBuyerRefund = verifyBuyerAction;
