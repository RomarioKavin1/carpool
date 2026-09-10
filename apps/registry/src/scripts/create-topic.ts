import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { makeOperatorClient } from "@carpool/hedera-x402";

// Creates the HCS topic the settler (Task E) anchors epochs to. Prints
// HCS_TOPIC_ID for .env. Ported unchanged from apps/settlement — this script
// has no dependency on the ledger schema.
async function main() {
  const client = makeOperatorClient();
  if (!client) {
    console.error("OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY required");
    process.exit(1);
  }
  const resp = await new TopicCreateTransaction()
    .setTopicMemo("carpool registry anchor")
    .execute(client);
  const receipt = await resp.getReceipt(client);
  const topicId = receipt.topicId!.toString();
  console.log(`topic created\n\nHCS_TOPIC_ID=${topicId}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
