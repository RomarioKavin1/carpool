/**
 * `pnpm --filter @carpool/registry associate:account`
 *
 * Associates ANY Hedera testnet account with test USDC, so it can be paid a
 * royalty (author) or receive faucet USDC (buyer). `associate` only covers the
 * registry's own operator and carpool accounts.
 *
 *   HEDERA_ACCOUNT_ID=0.0.x HEDERA_PRIVATE_KEY=... pnpm --filter @carpool/registry associate:account
 *
 * The two variables are read from the process environment only: this script
 * deliberately does not load the repo `.env` (which holds the registry's own
 * keys), never takes a key as an argument, and never prints it.
 */
import { AccountId, Client, PrivateKey, TokenAssociateTransaction, TokenId } from "@hiero-ledger/sdk";
import {
  InputError,
  USDC_TESTNET,
  checkAccountKeyType,
  parseAccountId,
  parsePrivateKey,
} from "./associate-account-lib.js";

const MIRROR = "https://testnet.mirrornode.hedera.com";

interface MirrorAccount {
  key?: { _type?: string; key?: string };
  balance?: { balance?: number };
}

async function mirrorAccount(id: string): Promise<MirrorAccount | null> {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror node answered ${res.status} for account ${id}`);
  return (await res.json()) as MirrorAccount;
}

async function isAssociated(id: string, token: string): Promise<boolean> {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${token}`);
  if (!res.ok) throw new Error(`mirror node answered ${res.status} for ${id}'s tokens`);
  const json = (await res.json()) as { tokens?: unknown[] };
  return (json.tokens ?? []).length > 0;
}

async function main(): Promise<number> {
  const id = parseAccountId(process.env.HEDERA_ACCOUNT_ID);
  const parsed = parsePrivateKey(process.env.HEDERA_PRIVATE_KEY);
  const token = USDC_TESTNET;

  const account = await mirrorAccount(id);
  if (!account) {
    throw new InputError(`Account ${id} was not found on Hedera testnet. Check the id, and that it is a testnet account.`);
  }
  checkAccountKeyType(account.key?._type);

  const key = PrivateKey.fromStringECDSA(parsed.rawHex);
  const mirrorPub = (account.key?.key ?? "").toLowerCase();
  if (mirrorPub && key.publicKey.toStringRaw().toLowerCase() !== mirrorPub) {
    throw new InputError(`HEDERA_PRIVATE_KEY does not belong to ${id}. Use the private key shown for that account.`);
  }

  if (await isAssociated(id, token)) {
    console.log(`${id}: already associated with USDC ${token}. Nothing to do.`);
    return 0;
  }

  if ((account.balance?.balance ?? 0) <= 0) {
    throw new InputError(`${id} has no HBAR to pay the association fee (about $0.05). Fund it from portal.hedera.com.`);
  }

  const client = Client.forTestnet().setOperator(AccountId.fromString(id), key);
  try {
    const resp = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(id))
      .setTokenIds([TokenId.fromString(token)])
      .freezeWith(client)
      .sign(key)
      .then((tx) => tx.execute(client));
    console.log(`transaction: ${resp.transactionId.toString()}`);
    const rcpt = await resp.getReceipt(client);
    console.log(`status: ${rcpt.status.toString()}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
      console.log(`${id}: already associated with USDC ${token}. Nothing to do.`);
      return 0;
    }
    if (msg.includes("INSUFFICIENT_PAYER_BALANCE") || msg.includes("INSUFFICIENT_ACCOUNT_BALANCE")) {
      throw new InputError(`${id} does not have enough HBAR for the association fee. Fund it from portal.hedera.com.`);
    }
    if (msg.includes("INVALID_SIGNATURE")) {
      throw new InputError(`The network rejected the signature: HEDERA_PRIVATE_KEY is not ${id}'s key.`);
    }
    throw e;
  } finally {
    client.close();
  }

  // The receipt is authoritative; the mirror node lags it by a few seconds.
  for (let i = 0; i < 10; i++) {
    if (await isAssociated(id, token)) {
      console.log(`mirror node confirms ${id} is associated with USDC ${token}.`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`receipt succeeded; the mirror node has not caught up yet. Re-run in a minute to confirm.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(e instanceof InputError ? e.message : `failed: ${e.message}`);
    process.exit(1);
  },
);
