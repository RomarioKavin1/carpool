import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Payout, RegistryState } from "./api";
import {
  hashFor,
  mirrorBaseFor,
  parseAccountInput,
  readHash,
  resolveEvmAddress,
  summarizeAccount,
} from "./account";
import { connectInjected, caipChainFor, hederaAccountsFromSession, type Eip1193 } from "./wallet";

const CAPTURED = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "railway-registry.captured.json"), "utf8"),
) as { responses: Record<string, { body: unknown }> };
const STATE = CAPTURED.responses["/state"]!.body as RegistryState;
const rowsFor = (payee: string) =>
  (CAPTURED.responses[`/payouts?payee=${payee}`]!.body as { payouts: Payout[] }).payouts;

describe("parseAccountInput", () => {
  it("accepts a Hedera id, trims it, and drops a checksum and leading zeros", () => {
    expect(parseAccountInput(" 0.0.10475801 ")).toEqual({ kind: "account", id: "0.0.10475801" });
    expect(parseAccountInput("0.0.10475801-vfmkw")).toEqual({ kind: "account", id: "0.0.10475801" });
    expect(parseAccountInput("0.0.007")).toEqual({ kind: "account", id: "0.0.7" });
  });

  it("recognises a 20-byte EVM address, lowercased", () => {
    expect(parseAccountInput("0x01B130C17533C6BD283064460A47A61DDF260D72")).toEqual({
      kind: "evm",
      address: "0x01b130c17533c6bd283064460a47a61ddf260d72",
    });
  });

  it("calls a blank empty and everything else invalid, with a reason", () => {
    expect(parseAccountInput("   ").kind).toBe("empty");
    for (const bad of ["0.0", "0.0.x", "10475801", "0.0.1.2", "0x1234", "hello", "0.0.123-ab"]) {
      const r = parseAccountInput(bad);
      expect(r.kind, bad).toBe("invalid");
    }
  });
});

describe("the shareable link", () => {
  it("reads the account off #earnings?account=", () => {
    expect(readHash("#earnings?account=0.0.10475801")).toEqual({ view: "earnings", account: "0.0.10475801" });
    expect(readHash("#earnings")).toEqual({ view: "earnings", account: null });
    expect(readHash("#evidence")).toEqual({ view: "evidence", account: null });
  });

  it("ignores an account in the link that is not one", () => {
    expect(readHash("#earnings?account=<script>")).toEqual({ view: "earnings", account: null });
  });

  it("round-trips", () => {
    const h = hashFor("earnings", "0.0.10477413");
    expect(h).toBe("#earnings?account=0.0.10477413");
    expect(readHash(h).account).toBe("0.0.10477413");
    expect(hashFor("earnings", null)).toBe("#earnings");
    expect(hashFor("overview", "0.0.1")).toBe("");
  });
});

describe("summarizeAccount over the captured registry", () => {
  it("the seed author: 14 published, 1 sale, 4,278 µUSDC paid, 3,778 µUSDC royalty settled", () => {
    const s = summarizeAccount(STATE, "0.0.10475801", rowsFor("0.0.10475801"));
    expect(s.published).toBe(14);
    expect(s.sales).toBe(1);
    expect(s.grossUusdc).toBe(4278);
    expect(s.royalties).toMatchObject({ settled: 3778, held: 0, claimable: 0, voided: 0, rows: 1 });
    expect(s.parked).toBe(0);
  });

  it("the buyer: published nothing, bought one artifact for 4,278 µUSDC, no royalty rows", () => {
    const s = summarizeAccount(STATE, "0.0.10477413", rowsFor("0.0.10477413"));
    expect(s.seeders).toEqual([]);
    expect(s.published).toBe(0);
    expect(s.bought).toBe(1);
    expect(s.spentUusdc).toBe(4278);
    expect(s.royalties?.rows).toBe(0);
  });

  it("an account nobody has heard of reads as empty, not as an error", () => {
    const s = summarizeAccount(STATE, "0.0.1", null);
    expect(s).toMatchObject({ published: 0, bought: 0, royalties: null });
  });
});

describe("resolveEvmAddress", () => {
  const base = mirrorBaseFor("hedera:testnet")!;

  it("maps a mirror node hit to its account id", async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ account: "0.0.10477413" }));
    await expect(resolveEvmAddress("0xabc", base, f)).resolves.toEqual({ kind: "account", id: "0.0.10477413" });
    expect(String(f.mock.calls[0]![0])).toBe(`${base}/api/v1/accounts/0xabc`);
  });

  it("distinguishes not-found from unreachable", async () => {
    const miss = vi.fn(async () => Response.json({}, { status: 404 }));
    await expect(resolveEvmAddress("0xabc", base, miss)).resolves.toEqual({ kind: "not-found" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(resolveEvmAddress("0xabc", base, down)).resolves.toMatchObject({ kind: "error" });
  });

  it("knows no mirror for a network it was not told about", () => {
    expect(mirrorBaseFor("hedera:testnet")).toMatch(/testnet\.mirrornode\.hedera\.com$/);
    expect(mirrorBaseFor("eip155:296")).toBeNull();
    expect(mirrorBaseFor(null)).toBeNull();
  });
});

describe("wallet: what is read, and only that", () => {
  it("takes Hedera accounts on the registry's chain from a WalletConnect session", () => {
    const namespaces = {
      hedera: {
        accounts: ["hedera:testnet:0.0.10475801", "hedera:mainnet:0.0.999", "hedera:testnet:0.0.10475801"],
      },
      eip155: { accounts: ["eip155:296:0x01b130c17533c6bd283064460a47a61ddf260d72"] },
    };
    expect(hederaAccountsFromSession(namespaces, "hedera:testnet")).toEqual(["0.0.10475801"]);
    expect(hederaAccountsFromSession({}, "hedera:testnet")).toEqual([]);
  });

  it("only names a Hedera chain it recognises", () => {
    expect(caipChainFor("hedera:testnet")).toBe("hedera:testnet");
    expect(caipChainFor("hedera:fakenet")).toBeNull();
  });

  it("an injected wallet is asked for accounts and nothing else", async () => {
    const request = vi.fn(async () => ["0x01B130C17533C6BD283064460A47A61DDF260D72"]);
    const provider: Eip1193 = { request };
    const resolve = vi.fn(async () => ({ kind: "account" as const, id: "0.0.10477413" }));
    const result = await connectInjected(provider, "https://mirror.example", resolve);
    expect(result).toEqual({ kind: "account", id: "0.0.10477413", via: "browser wallet" });
    expect(request.mock.calls.map((c) => (c as unknown as [{ method: string }])[0].method)).toEqual([
      "eth_requestAccounts",
    ]);
    expect(resolve).toHaveBeenCalledWith("0x01b130c17533c6bd283064460a47a61ddf260d72", "https://mirror.example");
  });

  it("reports an address with no Hedera alias instead of inventing an account", async () => {
    const provider: Eip1193 = { request: async () => ["0x77dcbf885c5cdd742e84db3a5dcc3201d20d31f1"] };
    const result = await connectInjected(provider, "https://m", async () => ({ kind: "not-found" }));
    expect(result).toEqual({ kind: "evm-unresolved", address: "0x77dcbf885c5cdd742e84db3a5dcc3201d20d31f1" });
  });

  it("treats a rejected prompt as cancelled", async () => {
    const provider: Eip1193 = {
      request: async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      },
    };
    await expect(connectInjected(provider, "https://m")).resolves.toEqual({ kind: "cancelled" });
  });
});
