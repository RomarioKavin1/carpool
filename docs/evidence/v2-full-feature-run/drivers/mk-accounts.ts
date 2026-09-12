/**
 * TEMPORARY driver for the v2 full-feature testnet run — not part of the product.
 *
 * Creates the accounts the run needs, from the operator:
 *   - one buyer, funded with USDC out of the operator's balance
 *   - N author payout accounts (unlimited automatic token association)
 *   - one deliberately UNPAYABLE author: zero automatic association slots and no
 *     USDC relationship, which is what makes a settlement transfer to it reach
 *     consensus and fail (NO_REMAINING_AUTOMATIC_ASSOCIATIONS /
 *     TOKEN_NOT_ASSOCIATED_TO_ACCOUNT) rather than fail a precheck.
 *
 * Writes ids AND private keys to the path in $ACCOUNTS_OUT, which must be
 * outside the repository. Only account ids are printed.
 */
import {
  AccountCreateTransaction,
  Hbar,
  PrivateKey,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { makeOperatorClient, usdcId } from "@carpool/hedera-x402";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const OUT = process.env.ACCOUNTS_OUT;
if (!OUT) throw new Error("ACCOUNTS_OUT is required");
if (OUT.includes("/carpool/")) throw new Error("refusing to write keys inside the repository");

const AUTHORS = Number(process.env.AUTHOR_COUNT ?? 20);
const BUYER_USDC = Number(process.env.BUYER_USDC ?? 2_000_000); // µUSDC

interface Acct {
  id: string;
  key: string;
  publicKey: string;
  label: string;
}

const client = makeOperatorClient();
if (!client) throw new Error("OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY required");

async function create(label: string, hbar: number, autoAssoc: number): Promise<Acct> {
  const priv = PrivateKey.generateECDSA();
  const resp = await new AccountCreateTransaction()
    .setKeyWithoutAlias(priv.publicKey)
    .setInitialBalance(new Hbar(hbar))
    .setMaxAutomaticTokenAssociations(autoAssoc)
    .setAccountMemo(`carpool full-feature run ${label}`)
    .execute(client);
  const id = (await resp.getReceipt(client)).accountId?.toString();
  if (!id) throw new Error(`${label}: no accountId on receipt`);
  return { id, key: priv.toStringRaw(), publicKey: priv.publicKey.toStringRaw(), label };
}

const existing: Record<string, Acct> = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {};

const save = () => writeFileSync(OUT, JSON.stringify(existing, null, 2), { mode: 0o600 });

async function ensure(label: string, hbar: number, autoAssoc: number): Promise<Acct> {
  if (existing[label]) {
    console.log(`${label}: ${existing[label]!.id} (already created)`);
    return existing[label]!;
  }
  const a = await create(label, hbar, autoAssoc);
  existing[label] = a;
  save();
  console.log(`${label}: ${a.id}`);
  return a;
}

const buyer = await ensure("buyer", 2, -1);
for (let i = 0; i < AUTHORS; i++) await ensure(`author${i}`, 0.2, -1);
// Zero automatic-association slots, never associated: a token transfer to this
// account reaches consensus and moves nothing.
await ensure("unpayable", 1.5, 0);

// Fund the buyer with USDC from the operator. The transfer itself creates the
// buyer's USDC relationship (it has an automatic slot free), which is the one
// case where automatic association is sufficient — see the artifact the first
// run sold.
const already = await fetch(
  `${process.env.MIRROR_NODE_URL}/api/v1/accounts/${buyer.id}/tokens?token.id=${usdcId()}`,
)
  .then((r) => r.json() as Promise<{ tokens?: { balance: number }[] }>)
  .then((j) => j.tokens?.[0]?.balance ?? 0)
  .catch(() => 0);

if (already < BUYER_USDC) {
  const need = BUYER_USDC - already;
  const resp = await new TransferTransaction()
    .addTokenTransfer(usdcId(), process.env.OPERATOR_ACCOUNT_ID!, -need)
    .addTokenTransfer(usdcId(), buyer.id, need)
    .setTransactionMemo("carpool full-feature run: fund buyer")
    .execute(client);
  const r = await resp.getReceipt(client);
  console.log(`funded buyer ${buyer.id} with ${need} µUSDC — ${r.status.toString()} ${resp.transactionId!.toString()}`);
} else {
  console.log(`buyer ${buyer.id} already holds ${already} µUSDC`);
}

client.close();
console.log(`\nwrote ${Object.keys(existing).length} account(s) to ${OUT}`);
