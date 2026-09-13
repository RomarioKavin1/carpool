// Prints the ENS records a name owner sets to become a verified Carpool author,
// computed offline from the author's Hedera key. Sends nothing anywhere.
//
//   CARPOOL_AUTHOR_PRIVATE_KEY=<ecdsa hex> \
//   pnpm --filter @carpool/registry ens:records <name.eth> <payoutAccountId>
//
// The owner then sets these in the ENS App (or any wallet) on the name's
// resolver. Rotating the payout account later means re-running this with the
// new account and updating two records; nothing is republished.
import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import {
  ENS_KEY_RECORD,
  ENS_PAYOUT_SIG_RECORD,
  HBAR_COIN_TYPE,
  encodeHederaAddr,
  publicKeyHexOf,
  signPayoutAttestation,
} from "@carpool/core";
import { assertNormalisedEnsName } from "../ens.js";

const [name, account] = process.argv.slice(2);
const key = process.env.CARPOOL_AUTHOR_PRIVATE_KEY;
if (!name || !account || !key) {
  console.error("usage: CARPOOL_AUTHOR_PRIVATE_KEY=<hex> ens:records <name.eth> <payoutAccountId>");
  process.exit(2);
}
assertNormalisedEnsName(name);
const pub = publicKeyHexOf(key);
console.log(
  JSON.stringify(
    {
      name,
      records: {
        [`addr(${HBAR_COIN_TYPE})`]: {
          value: account,
          bytes: `0x${Buffer.from(encodeHederaAddr(account)).toString("hex")}`,
          note:
            "ensdomains/address-encoder formats coin type 3030 as shard.realm.num; a tool that writes raw bytes needs the 20-byte value",
        },
        [`text:${ENS_KEY_RECORD}`]: pub,
        [`text:${ENS_PAYOUT_SIG_RECORD}`]: signPayoutAttestation(key, name, account),
      },
      optionalProfile: ["description", "url", "avatar", "keywords", "com.github"],
      authorString: `ens:${name}:<fallbackAccountId>:${pub}`,
      publishWith: `CARPOOL_AUTHOR_ENS_NAME=${name}`,
    },
    null,
    2,
  ),
);
