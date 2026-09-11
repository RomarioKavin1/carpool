// Create + fund Hedera testnet buyer accounts from the operator. Idempotent.
// Persists apps/bench/accounts.json (gitignored). Requires OPERATOR creds.
//
// Moved from apps/fleet/src/scripts/bootstrap.ts unchanged in behaviour —
// only the vocabulary ("fleet agent" -> "buyer") and the output path changed.
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import {
  Client,
  AccountCreateTransaction,
  TransferTransaction,
  Hbar,
  PrivateKey,
} from "@hiero-ledger/sdk";
import { USDC_TOKEN_ID_TESTNET } from "@carpool/core";

const COUNT = 13;
const USDC_FUND = 500_000; // 0.5 USDC (6 decimals)
const OUT = resolve(process.cwd(), "accounts.json");
const MIRROR =
  process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

interface Account {
  id: string;
  key: string;
}

function operatorClient(): { client: Client; opId: string } {
  const opId = process.env.OPERATOR_ACCOUNT_ID;
  const opKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!opId || !opKey || opId === "0.0.000000") {
    console.error(
      "OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY missing in env. " +
        "Set them (portal.hedera.com testnet account) and retry. Not fabricating accounts.",
    );
    process.exit(1);
  }
  const client = Client.forTestnet().setOperator(
    opId,
    PrivateKey.fromStringECDSA(opKey),
  );
  return { client, opId };
}

async function createAccount(client: Client): Promise<Account> {
  const priv = PrivateKey.generateECDSA();
  const receipt = await (
    await new AccountCreateTransaction()
      .setKeyWithoutAlias(priv.publicKey)
      .setInitialBalance(new Hbar(2))
      .setMaxAutomaticTokenAssociations(-1)
      .execute(client)
  ).getReceipt(client);
  const id = receipt.accountId?.toString();
  if (!id) throw new Error("account create receipt had no accountId");
  return { id, key: priv.toStringRaw() };
}

async function fundUsdc(
  client: Client,
  opId: string,
  to: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await (
    await new TransferTransaction()
      .addTokenTransfer(USDC_TOKEN_ID_TESTNET, opId, -amount)
      .addTokenTransfer(USDC_TOKEN_ID_TESTNET, to, amount)
      .execute(client)
  ).getReceipt(client);
}

/**
 * USDC balance of an account according to the mirror node, or null if the
 * account does not exist or is not associated with the token.
 */
async function usdcBalance(id: string): Promise<number | null> {
  const url = `${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${USDC_TOKEN_ID_TESTNET}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { tokens?: Array<{ balance: number }> };
  const row = json.tokens?.[0];
  return row ? row.balance : null;
}

async function main() {
  const force = process.argv.includes("--force");
  let accounts: Account[] = [];
  if (!force && existsSync(OUT)) {
    accounts = JSON.parse(readFileSync(OUT, "utf8")) as Account[];
  }

  const { client, opId } = operatorClient();

  // Top up any existing account the mirror node says is short. Row count in
  // accounts.json says nothing about whether an account still holds USDC —
  // a previous bench run spends it, and the next run then fails mid-flight
  // with a payment error that looks like a rails problem.
  if (accounts.length > 0) {
    console.log(
      `checking ${accounts.length} existing accounts against the mirror node…`,
    );
    const usable: Account[] = [];
    for (const a of accounts) {
      const bal = await usdcBalance(a.id);
      if (bal === null) {
        console.warn(
          `  ${a.id}: not found or not associated with USDC — dropping, a replacement will be created`,
        );
        continue;
      }
      if (bal < USDC_FUND) {
        const topUp = USDC_FUND - bal;
        await fundUsdc(client, opId, a.id, topUp);
        console.log(`  ${a.id}: ${bal} → ${USDC_FUND} µUSDC (+${topUp})`);
      } else {
        console.log(`  ${a.id}: ${bal} µUSDC — ok`);
      }
      usable.push(a);
    }
    accounts = usable;
  }

  for (let i = accounts.length; i < COUNT; i++) {
    const acct = await createAccount(client);
    await fundUsdc(client, opId, acct.id, USDC_FUND);
    accounts.push(acct);
    console.log(`[${i + 1}/${COUNT}] created ${acct.id} funded ${USDC_FUND} µUSDC`);
  }

  writeFileSync(OUT, JSON.stringify(accounts, null, 2) + "\n");
  console.log(`wrote ${accounts.length} accounts → ${OUT}`);
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
