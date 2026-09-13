import { describe, expect, it } from "vitest";
import { PrivateKey } from "@hiero-ledger/sdk";
import { ensAuthorString, magnetOf, type Manifest } from "@carpool/core";
import { openDb } from "./db/index.js";
import { RegistryLedger } from "./ledger.js";
import { parseAuthor } from "./identity.js";
import { choosePayout, loadEnsConfig } from "./ens.js";

const PUB = PrivateKey.generateECDSA().publicKey.toStringRaw();
const ENS_AUTHOR = ensAuthorString("replayed.eth", "0.0.1111", PUB);

function manifest(author: string): Manifest {
  const base: Omit<Manifest, "magnet"> = {
    question: "replayed ens sale",
    questionNorm: "replayed ens sale",
    abstract: "a",
    sources: [],
    provenance: { model: "m", durationSeconds: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0, toolCalls: 0 },
    decay: { halfLifeDays: 30, producedAt: "2027-01-15T00:00:00.000Z" },
    author,
    bodyHash: "b".repeat(64),
    bodyBytes: 10,
    redacted: false,
  };
  return { ...base, magnet: magnetOf(base) };
}

describe("owed_failure replay for an ENS author", () => {
  it("pays the author-signed fallback and records it as ens-fallback, never an unattested account", () => {
    const { db, sqlite } = openDb(":memory:");
    const ledger = new RegistryLedger(db, sqlite, { trackerFee: 500, registryAccount: "0.0.9", now: () => 1_800_000_000 });
    const m = manifest(ENS_AUTHOR);
    ledger.publish(m, { authorSig: "sig", manifestHash: m.magnet.slice(7), priceBase: 100_000, priceFloor: 10_000, bodyUri: "file:///x" });
    ledger.recordOwedFailure({ op: "onPaid", txId: "0.0.2@replay-ens", payer: "0.0.2", paid: 50_000, resourceKey: m.magnet, reason: "db locked" });

    expect(ledger.replayOwedFailures()).toEqual({ replayed: 1, failed: 0, unresolvable: 0 });
    const p = ledger.purchaseByTxId("0.0.2@replay-ens")!;
    expect(p.payoutVia).toBe("ens-fallback:replayed.eth");
    const royalty = ledger.payouts().find((r) => r.id === p.authorRoyaltyPayoutId)!;
    expect(royalty.payee).toBe("0.0.1111");
    expect(royalty.amount).toBe(49_500);
  });
});

describe("parseAuthor", () => {
  it("dispatches ens: strings to EnsAuthor and everything else to the Hedera convention", () => {
    expect(parseAuthor(ENS_AUTHOR).display()).toBe("replayed.eth");
    expect(parseAuthor(ENS_AUTHOR).payout()).toBe("0.0.1111");
    expect(parseAuthor(`0.0.5555:${PUB}`).payout()).toBe("0.0.5555");
  });
});

describe("choosePayout", () => {
  it("is exactly the Hedera payout, with via null, for a Hedera author, and never calls the reader", async () => {
    const reader = {
      text: async () => {
        throw new Error("must not be called");
      },
      hederaAddr: async () => {
        throw new Error("must not be called");
      },
    };
    expect(await choosePayout(`0.0.5555:${PUB}`, reader)).toMatchObject({ account: "0.0.5555", via: null });
  });
});

describe("loadEnsConfig", () => {
  it("defaults to Sepolia, where the ENSv2 beta is deployed, with a 3 s bound", () => {
    expect(loadEnsConfig({})).toEqual({ chain: "sepolia", rpcUrl: undefined, timeoutMs: 3000 });
  });

  it("accepts mainnet and off, and refuses anything else", () => {
    expect(loadEnsConfig({ CARPOOL_ENS_CHAIN: "mainnet" }).chain).toBe("mainnet");
    expect(loadEnsConfig({ CARPOOL_ENS_CHAIN: "OFF" }).chain).toBe("off");
    expect(() => loadEnsConfig({ CARPOOL_ENS_CHAIN: "namechain" })).toThrow(/sepolia, mainnet or off/);
  });

  it("refuses a timeout too small to ever succeed", () => {
    expect(() => loadEnsConfig({ CARPOOL_ENS_TIMEOUT_MS: "5" })).toThrow(/at least 100/);
  });
});
