// Money: all amounts are integer µUSDC (USDC on Hedera has 6 decimals → 1¢ = 10,000 units).
export const USDC_DECIMALS = 6;
export const USDC_TOKEN_ID_TESTNET = "0.0.429274";
export const CENT = 10_000; // µUSDC per US cent

import { createHash } from "node:crypto";

/** sha256 hex digest — the single hashing helper for the whole package. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
