import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({
  path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")],
});
import { AccountCreateTransaction, Hbar, PrivateKey } from "@hiero-ledger/sdk";
import { makeOperatorClient, usdcId } from "@carpool/hedera-x402";

/**
 * Creates the `carpool` (registry settlement) account from the operator.
 *
 * Ported from apps/settlement; drops the "provider" account, which v2 has no
 * equivalent of — v1 had one fixed data provider, v2 has many independent
 * authors, each paid out to whatever account their own manifest names.
 *
 * Created with setMaxAutomaticTokenAssociations(-1) so it accepts USDC
 * without a TokenAssociateTransaction for transfers it did not initiate
 * itself — association still matters for the Circle faucet, see associate.ts.
 *
 * Idempotent: an account already present in .env (and real on the mirror
 * node) is left alone. Pass --force to create a fresh one anyway.
 */
const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
const PLACEHOLDER = "0.0.000000";
const HBAR_FUND = 20;

async function accountExists(id: string | undefined): Promise<boolean> {
  if (!id || id === PLACEHOLDER) return false;
  const res = await fetch(`${MIRROR}/api/v1/accounts/${id}`);
  return res.ok;
}

async function usdcBalance(id: string): Promise<number> {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${usdcId()}`);
  if (!res.ok) return 0;
  const json = (await res.json()) as { tokens?: Array<{ balance: number }> };
  return json.tokens?.[0]?.balance ?? 0;
}

async function create(
  client: NonNullable<ReturnType<typeof makeOperatorClient>>,
  label: string,
): Promise<{ id: string; key: string }> {
  const priv = PrivateKey.generateECDSA();
  const resp = await new AccountCreateTransaction()
    .setKeyWithoutAlias(priv.publicKey)
    .setInitialBalance(new Hbar(HBAR_FUND))
    .setMaxAutomaticTokenAssociations(-1)
    .setAccountMemo(`carpool ${label}`)
    .execute(client);
  const id = (await resp.getReceipt(client)).accountId?.toString();
  if (!id) throw new Error(`${label}: create receipt had no accountId`);
  return { id, key: priv.toStringRaw() };
}

async function main() {
  const force = process.argv.includes("--force");
  const client = makeOperatorClient();
  if (!client) {
    console.error("OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY required in .env");
    process.exit(1);
  }

  const out: string[] = [];
  const existing = process.env.CARPOOL_ACCOUNT_ID;
  if (!force && (await accountExists(existing))) {
    console.log(`carpool: ${existing} already exists — leaving alone`);
  } else {
    const acct = await create(client, "carpool");
    console.log(`carpool: created ${acct.id} with ${HBAR_FUND} ℏ, auto-association on`);
    out.push(`CARPOOL_ACCOUNT_ID=${acct.id}`, `CARPOOL_PRIVATE_KEY=${acct.key}`);
  }

  // Seed the carpool account with a USDC float: a refund can fall due before
  // any sale has settled into it, and a zero balance makes that transfer fail.
  const opUsdc = await usdcBalance(process.env.OPERATOR_ACCOUNT_ID!);
  if (opUsdc === 0) {
    console.log(
      "\nOperator holds no USDC — skipping the carpool float.\n" +
        `Get testnet USDC (token ${usdcId()}) from https://faucet.circle.com,\n` +
        "then re-run this script to seed it.",
    );
  }

  if (out.length > 0) {
    console.log("\nAdd these to .env:\n");
    console.log(out.join("\n"));
    console.log("\nThese are secrets. They are printed once and not written to disk.");
  }
  client.close();
}

main().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
