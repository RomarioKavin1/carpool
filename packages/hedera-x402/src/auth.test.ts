import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { loadAuth, requireKey, corsOrigins } from "./auth.js";

const KEY = "a".repeat(32);

function appWith(auth: ReturnType<typeof loadAuth>) {
  const app = express();
  app.use(express.json());
  app.post("/ledger/rider", requireKey(auth), (_req, res) => {
    res.json({ minted: true });
  });
  app.get("/state", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

async function call(app: express.Express, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  try {
    return await fetch(`http://127.0.0.1:${port}/ledger/rider`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ lineage: "l1", payer: "0.0.evil", paid: 7000 }),
    });
  } finally {
    server.close();
  }
}

describe("ledger auth boundary", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.LEDGER_API_KEY;
    delete process.env.NODE_ENV;
    delete process.env.DASHBOARD_ORIGIN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("rejects a write with no key when a key is configured", async () => {
    process.env.LEDGER_API_KEY = KEY;
    const res = await call(appWith(loadAuth()));
    expect(res.status).toBe(401);
  });

  it("rejects a write with the wrong key", async () => {
    process.env.LEDGER_API_KEY = KEY;
    const res = await call(appWith(loadAuth()), { "x-carpool-key": "b".repeat(32) });
    expect(res.status).toBe(401);
  });

  it("accepts a write with the right key", async () => {
    process.env.LEDGER_API_KEY = KEY;
    const res = await call(appWith(loadAuth()), { "x-carpool-key": KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minted: true });
  });

  it("refuses to start in production without a key", () => {
    process.env.NODE_ENV = "production";
    expect(() => loadAuth()).toThrow(/required in production/);
  });

  it("rejects a key short enough to guess", () => {
    process.env.LEDGER_API_KEY = "short";
    expect(() => loadAuth()).toThrow(/at least 32/);
  });

  it("stays open with no key outside production, for local dev", async () => {
    const auth = loadAuth();
    expect(auth.open).toBe(true);
    const res = await call(appWith(auth));
    expect(res.status).toBe(200);
  });

  it("restricts read origins when DASHBOARD_ORIGIN is set", () => {
    expect(corsOrigins()).toBe(true);
    process.env.DASHBOARD_ORIGIN = "https://a.example, https://b.example";
    expect(corsOrigins()).toEqual(["https://a.example", "https://b.example"]);
  });
});
