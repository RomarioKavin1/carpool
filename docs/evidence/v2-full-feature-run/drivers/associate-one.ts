/**
 * TEMPORARY driver: associate one run account with USDC.
 *
 * This is the out-of-band fix an operator makes before calling
 * `POST /payouts/:id/unpark` — the cause of a parked payout (no token
 * relationship on the payee's account) is outside the registry, which is exactly
 * why only a person can say it is fixed.
 *
 *   npx tsx live/associate-one.ts <accounts.json label>
 */
import { AccountId, Client, PrivateKey, TokenAssociateTransaction, TokenId } from "@hiero-ledger/sdk";
import { usdcId } from "@carpool/hedera-x402";
import { readFileSync } from "node:fs";

const label = process.argv[2]!;
const accounts = JSON.parse(readFileSync(process.env.ACCOUNTS_JSON!, "utf8"));
const a = accounts[label];
if (!a) throw new Error(`no account labelled ${label}`);

const client = Client.forTestnet().setOperator(
  AccountId.fromString(a.id),
  PrivateKey.fromStringECDSA(a.key),
);
const resp = await new TokenAssociateTransaction()
  .setAccountId(AccountId.fromString(a.id))
  .setTokenIds([TokenId.fromString(usdcId())])
  .execute(client);
const rcpt = await resp.getReceipt(client);
console.log(
  JSON.stringify({
    account: a.id,
    token: usdcId(),
    status: rcpt.status.toString(),
    txId: resp.transactionId!.toString(),
  }),
);
client.close();
