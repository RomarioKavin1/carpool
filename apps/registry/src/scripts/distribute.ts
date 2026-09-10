import { config as _c } from "dotenv";
import { resolve as _r } from "node:path";
_c({ path: [_r(process.cwd(), ".env"), _r(process.cwd(), "../../.env")] });
import { AccountId, Client, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { usdcId } from "@carpool/hedera-x402";

/**
 * Move USDC from the faucet inbox to where it is actually needed. Ported
 * unchanged in spirit from apps/settlement; still funds `operator` (fleet
 * bootstrap + headroom) and `carpool` (the registry's settlement account —
 * needed as a float since a refund can fall due before any sale has settled
 * into it).
 *
 * Circle rate-limits per address per 2 hours, so mints land in a dedicated
 * account with an unburned window and are swept from there.
 */
const USDC = usdcId();
const M = process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";

// µUSDC. Fleet bootstrap funds 13 agents at 0.5 USDC each = 6.5 USDC.
const TO_OPERATOR = 12_000_000; // fleet funding + headroom
const TO_CARPOOL = 5_000_000; // refund float

async function balance(id: string): Promise<number> {
  const res = await fetch(`${M}/api/v1/accounts/${id}/tokens?token.id=${USDC}`);
  if (!res.ok) return 0;
  const j = (await res.json()) as { tokens?: Array<{ balance: number }> };
  return j.tokens?.[0]?.balance ?? 0;
}

async function main() {
  const from = process.env.FAUCET_ACCOUNT_ID;
  const key = process.env.FAUCET_PRIVATE_KEY;
  const operator = process.env.OPERATOR_ACCOUNT_ID!;
  const carpool = process.env.CARPOOL_ACCOUNT_ID!;
  if (!from || !key) throw new Error("FAUCET_ACCOUNT_ID / FAUCET_PRIVATE_KEY required");

  const have = await balance(from);
  console.log(`faucet inbox ${from}: ${(have / 1e6).toFixed(2)} USDC`);
  const total = TO_OPERATOR + TO_CARPOOL;
  if (have < total) {
    throw new Error(`need ${(total / 1e6).toFixed(2)} USDC, have ${(have / 1e6).toFixed(2)}`);
  }

  const client = Client.forTestnet().setOperator(
    AccountId.fromString(from),
    PrivateKey.fromStringECDSA(key),
  );
  const resp = await new TransferTransaction()
    .addTokenTransfer(USDC, from, -total)
    .addTokenTransfer(USDC, operator, TO_OPERATOR)
    .addTokenTransfer(USDC, carpool, TO_CARPOOL)
    .setTransactionMemo("carpool: distribute faucet mint")
    .execute(client);
  const rcpt = await resp.getReceipt(client);
  client.close();

  console.log(`  -> operator ${operator}: ${(TO_OPERATOR / 1e6).toFixed(2)} USDC`);
  console.log(`  -> carpool  ${carpool}: ${(TO_CARPOOL / 1e6).toFixed(2)} USDC`);
  console.log(`status ${rcpt.status.toString()}  tx ${resp.transactionId!.toString()}`);
}

main().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
