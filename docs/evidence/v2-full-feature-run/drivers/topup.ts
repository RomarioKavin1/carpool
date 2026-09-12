/**
 * TEMPORARY driver: top the registry's settlement account up with HBAR from the
 * operator, so a settlement transfer cannot fail for want of a network fee
 * halfway through the run. HBAR only — no USDC, no product state.
 */
import { Hbar, TransferTransaction } from "@hiero-ledger/sdk";
import { makeOperatorClient } from "@carpool/hedera-x402";

const amount = Number(process.argv[2] ?? 15);
const to = process.env.CARPOOL_ACCOUNT_ID!;
const from = process.env.OPERATOR_ACCOUNT_ID!;
const client = makeOperatorClient();
if (!client) throw new Error("operator credentials required");

const resp = await new TransferTransaction()
  .addHbarTransfer(from, new Hbar(-amount))
  .addHbarTransfer(to, new Hbar(amount))
  .setTransactionMemo("carpool full-feature run: settler hbar top-up")
  .execute(client);
const rcpt = await resp.getReceipt(client);
console.log(JSON.stringify({ from, to, hbar: amount, status: rcpt.status.toString(), txId: resp.transactionId!.toString() }));
client.close();
