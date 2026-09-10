import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({
  path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")],
});
import { AccountId, Client, PrivateKey, TokenAssociateTransaction, TokenId } from "@hiero-ledger/sdk";
import { usdcId } from "@carpool/hedera-x402";

/**
 * Explicitly associate each registry-owned account with the USDC token.
 *
 * Ported from apps/settlement; the only product-specific change is dropping
 * the "provider" account, which no longer exists in v2 — authors are paid
 * out to whatever account their own manifest names (see src/identity.ts),
 * not to one fixed provider account this registry controls.
 *
 * Auto-association is NOT equivalent: it creates the token relationship
 * lazily, on first receipt, but Circle's testnet faucet mints only to an
 * already-associated account. Costs $0.05 per account per token, once.
 */
const MIRROR = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

const ACCOUNTS: [label: string, idVar: string, keyVar: string][] = [
  ["operator", "OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY"],
  ["carpool", "CARPOOL_ACCOUNT_ID", "CARPOOL_PRIVATE_KEY"],
];

async function isAssociated(id: string, token: string): Promise<boolean> {
  const res = await fetch(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${token}`);
  if (!res.ok) return false;
  const json = (await res.json()) as { tokens?: unknown[] };
  return (json.tokens ?? []).length > 0;
}

async function main() {
  const token = usdcId();
  for (const [label, idVar, keyVar] of ACCOUNTS) {
    const id = process.env[idVar];
    const key = process.env[keyVar];
    if (!id || !key || id === "0.0.000000") {
      console.log(`${label}: not configured — skipping`);
      continue;
    }
    if (await isAssociated(id, token)) {
      console.log(`${label} ${id}: already associated with ${token}`);
      continue;
    }
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(id),
      PrivateKey.fromStringECDSA(key),
    );
    try {
      const resp = await new TokenAssociateTransaction()
        .setAccountId(AccountId.fromString(id))
        .setTokenIds([TokenId.fromString(token)])
        .execute(client);
      const rcpt = await resp.getReceipt(client);
      console.log(`${label} ${id}: associated — ${rcpt.status.toString()}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
        console.log(`${label} ${id}: already associated`);
      } else {
        console.error(`${label} ${id}: FAILED — ${msg}`);
      }
    } finally {
      client.close();
    }
  }
}

main().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
