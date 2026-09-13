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
import { InputError, associateAccount } from "./associate-account-run.js";

associateAccount().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(e instanceof InputError ? e.message : `failed: ${e.message}`);
    process.exit(1);
  },
);
