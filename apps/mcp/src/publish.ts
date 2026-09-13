import {
  ensAuthorString,
  floorForPrice,
  magnetOf,
  normalizeQuestion,
  publicKeyHexOf,
  signManifest,
  type Manifest,
} from "@carpool/core";

export interface PublishInput {
  question: string;
  abstract: string;
  body: string;
  sources: { url: string; fetchedAt: string }[];
  provenance: Manifest["provenance"];
  scope?: string;
  halfLifeDays: number;
  priceMicroUsdc: number;
  redacted: boolean;
}

export interface PublishOk {
  ok: true;
  magnet: string;
  /** An existing live artifact answering the same normalised question, if any. */
  duplicateOf: string | null;
}

export async function publishArtifact(
  base: string,
  input: PublishInput,
): Promise<PublishOk | { ok: false; error: string }> {
  const accountId = process.env.CARPOOL_AUTHOR_ACCOUNT_ID;
  const key = process.env.CARPOOL_AUTHOR_PRIVATE_KEY;
  if (!accountId || !key) {
    return {
      ok: false,
      error:
        "no author credentials: set CARPOOL_AUTHOR_ACCOUNT_ID and CARPOOL_AUTHOR_PRIVATE_KEY. " +
        "Royalties are paid to this account.",
    };
  }

  /**
   * The registry's author convention is `"<accountId>:<publicKeyHex>"` (see
   * apps/registry/src/identity.ts, which throws on anything else). The public
   * key half is derived from the *signing* key rather than taken from
   * configuration, so `author` and `authorSig` cannot disagree: whatever key
   * signs the manifest hash is, by construction, the key the registry will
   * verify that signature against.
   *
   * This used to send the bare account id, which `parseHederaAuthor` rejected
   * outright — one of two independent reasons every publish 400'd.
   */
  let author: string;
  try {
    const publicKeyHex = publicKeyHexOf(key);
    /**
     * `CARPOOL_AUTHOR_ENS_NAME` publishes under an ENS name instead:
     * `"ens:<name>:<accountId>:<publicKeyHex>"` (@carpool/core ens.ts). The
     * account stays in the string as the author-signed fallback payee; the
     * registry pays the name's attested Hedera record instead whenever the name
     * verifies at purchase time. See docs/ENS.md for the records to set.
     */
    const ensName = process.env.CARPOOL_AUTHOR_ENS_NAME?.trim();
    if (ensName) {
      try {
        author = ensAuthorString(ensName, accountId, publicKeyHex);
      } catch (e) {
        return {
          ok: false,
          error: `CARPOOL_AUTHOR_ENS_NAME is not usable: ${(e as Error).message}. Unset it to publish under the account id alone.`,
        };
      }
    } else {
      author = `${accountId}:${publicKeyHex}`;
    }
  } catch (e) {
    return {
      ok: false,
      error:
        `CARPOOL_AUTHOR_PRIVATE_KEY is not a usable ECDSA private key ` +
        `(${(e as Error).message.split("\n")[0]}). The registry verifies publishes against the public key ` +
        `derived from it, so publishing cannot proceed without one.`,
    };
  }

  const { createHash } = await import("node:crypto");
  const bodyHash = createHash("sha256").update(input.body).digest("hex");

  const withoutMagnet = {
    question: input.question,
    // @carpool/core's normaliser, the same function the registry recomputes
    // and rejects a mismatch against. This file used to carry a private copy
    // that stripped a different punctuation set — and since questionNorm is
    // inside the content-addressed manifest, the two copies produced two
    // different magnets for one question.
    questionNorm: normalizeQuestion(input.question),
    scope: input.scope,
    abstract: input.abstract,
    sources: input.sources,
    provenance: input.provenance,
    decay: { halfLifeDays: input.halfLifeDays, producedAt: new Date().toISOString() },
    author,
    bodyHash,
    bodyBytes: Buffer.byteLength(input.body, "utf8"),
    redacted: input.redacted,
  };

  const magnet = magnetOf(withoutMagnet as Omit<Manifest, "magnet">);
  const manifest = { ...withoutMagnet, magnet } as Manifest;
  const authorSig = signManifest(key, magnet.replace(/^swarm:/, ""));

  const res = await fetch(`${base.replace(/\/$/, "")}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manifest,
      body: input.body,
      // `authorSig`, not `signature`: the registry's PublishBody schema
      // requires this name and zod rejected the request before any of the
      // cryptography ran.
      authorSig,
      priceBase: input.priceMicroUsdc,
      priceFloor: floorForPrice(input.priceMicroUsdc),
    }),
  });

  if (!res.ok) return { ok: false, error: `registry /publish → ${res.status}: ${await res.text()}` };
  const json = (await res.json()) as { magnet?: string; duplicateOf?: string | null };
  return { ok: true, magnet, duplicateOf: json.duplicateOf ?? null };
}
