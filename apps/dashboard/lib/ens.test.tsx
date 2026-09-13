import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnsAuthorView } from "../components/EnsAuthor";
import { BINDING_LABEL, parseEnsAuthorString, safeHttpsUrl, type EnsIdentity } from "./ens";

const KEY = "02" + "ab".repeat(32);

/** A `GET /identity` answer in the registry's exact shape (IdentityView), test-only. */
function identity(over: Partial<EnsIdentity> = {}): EnsIdentity {
  return {
    kind: "ens",
    author: `ens:carpool-author.eth:0.0.1111:${KEY}`,
    name: "carpool-author.eth",
    fallbackAccount: "0.0.1111",
    publicKey: KEY,
    binding: {
      name: "carpool-author.eth",
      status: "verified",
      checks: { key: "match", hederaAddr: "present", payoutSig: "valid" },
      hederaAccount: "0.0.7777",
      problems: [],
    },
    payoutNow: { account: "0.0.7777", source: "ens" },
    profile: { description: "Writes about ENS", keywords: "ens, hedera", url: "https://example.org/me" },
    network: "sepolia",
    checkedAt: 1_789_300_000,
    ...over,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("parseEnsAuthorString", () => {
  it("reads the registry's ENS convention", () => {
    expect(parseEnsAuthorString(`ens:alice.eth:0.0.12:${KEY}`)).toEqual({
      name: "alice.eth",
      fallbackAccount: "0.0.12",
      publicKey: KEY,
    });
  });

  it("is null for the Hedera convention and for anything malformed", () => {
    expect(parseEnsAuthorString(`0.0.12:${KEY}`)).toBeNull();
    expect(parseEnsAuthorString(`ens:alice.eth:${KEY}`)).toBeNull();
    expect(parseEnsAuthorString(`ens:alice:0.0.12:${KEY}`)).toBeNull();
    expect(parseEnsAuthorString(`ens:alice.eth:alice:${KEY}`)).toBeNull();
  });
});

describe("safeHttpsUrl", () => {
  it("links https only", () => {
    expect(safeHttpsUrl("https://example.org")).toBe("https://example.org/");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.org")).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });
});

describe("EnsAuthorView", () => {
  it("verified: says so in words, and names the account the next sale pays and where it came from", () => {
    const t = text(renderToStaticMarkup(<EnsAuthorView identity={identity()} error={null} />));
    expect(t).toContain("verified");
    expect(t).not.toContain("not verified");
    expect(t).toContain("0.0.7777 from the name");
    expect(t).toContain("matches the signing key");
    expect(t).toContain("signed by the author");
    expect(t).toContain("Writes about ENS");
    expect(t).toContain("example.org");
  });

  it("unbound: never shows a name-derived payee, and lists every problem behind the disclosure", () => {
    const html = renderToStaticMarkup(
      <EnsAuthorView
        identity={identity({
          binding: {
            name: "carpool-author.eth",
            status: "unbound",
            checks: { key: "missing", hederaAddr: "present", payoutSig: "invalid" },
            hederaAccount: "0.0.6666",
            problems: ["no io.carpool.key text record", "payout signature does not verify"],
          },
          payoutNow: { account: "0.0.1111", source: "fallback" },
          profile: {},
        })}
        error={null}
      />,
    );
    const t = text(html);
    expect(t).toContain(BINDING_LABEL.unbound);
    expect(t).toContain("0.0.1111 signed fallback");
    expect(t).toContain("not signed by the author");
    expect(html).toContain("<details");
    expect(t).toContain("payout signature does not verify");
    expect(t).not.toContain("about");
  });

  it("renders no image for an avatar record, only a link", () => {
    const html = renderToStaticMarkup(
      <EnsAuthorView identity={identity({ profile: { avatar: "https://avatars.example/a.png" } })} error={null} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://avatars.example/a.png"');
  });

  it("loading is a skeleton with no figures, and a failure says the registry did not answer", () => {
    const loading = text(renderToStaticMarkup(<EnsAuthorView identity={null} error={null} />));
    expect(loading).not.toMatch(/0\.0\.\d/);
    const failed = text(renderToStaticMarkup(<EnsAuthorView identity={null} error="HTTP 503" />));
    expect(failed).toContain("registry did not answer");
    expect(failed).not.toMatch(/0\.0\.\d/);
  });

  it("uses no em dash anywhere it renders", () => {
    const html = renderToStaticMarkup(<EnsAuthorView identity={identity()} error={null} />);
    expect(html).not.toContain("—");
  });
});
