import { USDC_TOKEN_ID_TESTNET } from "./units.js";
import { Client, PrivateKey } from "@hiero-ledger/sdk";

const PLACEHOLDER = "0.0.000000";

/** Testnet client operated by the carpool settlement account. null if creds missing. */
export function makeClient(): Client | null {
  const id = process.env.CARPOOL_ACCOUNT_ID;
  const key = process.env.CARPOOL_PRIVATE_KEY;
  if (!id || id === PLACEHOLDER || !key) return null;
  return Client.forTestnet().setOperator(id, PrivateKey.fromStringECDSA(key));
}

/** Operator client (creates topics/accounts). null if creds missing. */
export function makeOperatorClient(): Client | null {
  const id = process.env.OPERATOR_ACCOUNT_ID;
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (!id || id === PLACEHOLDER || !key) return null;
  return Client.forTestnet().setOperator(id, PrivateKey.fromStringECDSA(key));
}

export function usdcId(): string {
  return process.env.USDC_TOKEN_ID || USDC_TOKEN_ID_TESTNET;
}

export function haveCreds(): boolean {
  return !!process.env.CARPOOL_PRIVATE_KEY && makeClient() != null;
}
