import { describe, expect, it } from "vitest";
import { scanForPublish } from "./scan.js";

const base = {
  question: "How does x402 settle on Hedera?",
  abstract: "A walkthrough of the exact scheme.",
  body: "The facilitator sponsors the fee.",
  sources: [{ url: "https://docs.hedera.com/x402", fetchedAt: "2026-09-01T00:00:00Z" }],
};

describe("pre-publish scan", () => {
  it("passes clean research through untouched", () => {
    const r = scanForPublish(base);
    expect(r.clean).toBe(true);
    expect(r.redacted.question).toBe(base.question);
    expect(r.redacted.body).toBe(base.body);
  });

  it("strips secrets rather than warning about them", () => {
    const r = scanForPublish({ ...base, body: "use sk-abcdefghijklmnop1234 to auth" });
    expect(r.clean).toBe(false);
    expect(r.redacted.body).not.toContain("sk-abcdefghijklmnop1234");
    expect(r.redacted.body).toContain("[redacted]");
    expect(r.findings[0]!.kind).toBe("secret");
  });

  it("catches a private key, which is the worst thing that could leak here", () => {
    const r = scanForPublish({ ...base, body: "a".repeat(10) + " " + "f".repeat(64) });
    expect(r.redacted.body).not.toContain("f".repeat(64));
  });

  it("strips the question too — it is usually the leakiest single line", () => {
    const r = scanForPublish({
      ...base,
      question: "How do I fix the auth bypass on payments.internal?",
    });
    expect(r.redacted.question).not.toContain("payments.internal");
    expect(r.findings.some((f) => f.where === "question")).toBe(true);
  });

  it("drops a source pointing at an internal host instead of half-redacting a URL", () => {
    const r = scanForPublish({
      ...base,
      sources: [
        { url: "https://wiki.corp/runbook", fetchedAt: "2026-09-01T00:00:00Z" },
        { url: "https://docs.hedera.com/x402", fetchedAt: "2026-09-01T00:00:00Z" },
      ],
    });
    expect(r.redacted.sources).toHaveLength(1);
    expect(r.redacted.sources[0]!.url).toContain("hedera.com");
  });

  it("removes local filesystem paths", () => {
    const r = scanForPublish({ ...base, body: "see /Users/someone/clients/acme/notes.md" });
    expect(r.redacted.body).not.toContain("/Users/someone");
  });

  it("honours caller-supplied never-publish terms case-insensitively", () => {
    const r = scanForPublish({ ...base, body: "Built this for Acme last week", neverPublish: ["acme"] });
    expect(r.redacted.body).not.toMatch(/acme/i);
    expect(r.findings.some((f) => f.kind === "private-repo")).toBe(true);
  });

  it("does not redact an innocent word that merely contains a term", () => {
    const r = scanForPublish({ ...base, body: "acmecorporation is unrelated", neverPublish: ["acme"] });
    expect(r.redacted.body).toContain("acmecorporation");
  });
});
