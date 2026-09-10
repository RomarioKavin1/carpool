import { sha256, signManifest } from "@carpool/core";

/**
 * Withdraw an artifact from sale.
 *
 * The counterpart the product did not have. `carpool_publish`'s description, the
 * consent prompt and three READMEs all told the author "delisting stops new
 * sales", and `artifact.delisted_at` was written by nothing: there was no route
 * and no client path. An affordance promised in the sentence that asks for
 * consent has to exist, or the consent was obtained under a false description.
 *
 * Authenticated the way `/publish` is — a signature from the author's key — over
 * `sha256("<magnet>:delist")` rather than over the manifest hash, so a publish
 * signature cannot be replayed as a withdrawal. No public key is sent: the
 * registry already holds the author's, inside the artifact's content-addressed
 * `author` field.
 */
export interface DelistOk {
  ok: true;
  magnet: string;
  /** Unix seconds. */
  delistedAt: number;
  /** True when it was already withdrawn — a retry, not a second withdrawal. */
  alreadyDelisted: boolean;
  /** The registry's own statement of what withdrawal does and does not undo. */
  note: string;
}

export async function delistArtifact(
  base: string,
  magnet: string,
): Promise<DelistOk | { ok: false; error: string }> {
  const key = process.env.CARPOOL_AUTHOR_PRIVATE_KEY;
  if (!key) {
    return {
      ok: false,
      error:
        "no author credentials: set CARPOOL_AUTHOR_PRIVATE_KEY. Only the author who published an " +
        "artifact can withdraw it, and the registry checks that against the key inside the manifest.",
    };
  }

  let authorSig: string;
  try {
    authorSig = signManifest(key, sha256(`${magnet}:delist`));
  } catch (e) {
    return {
      ok: false,
      error:
        `CARPOOL_AUTHOR_PRIVATE_KEY is not a usable ECDSA private key ` +
        `(${(e as Error).message.split("\n")[0]}).`,
    };
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/delist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ magnet, authorSig }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401) {
      return {
        ok: false,
        error:
          `the registry does not accept this key as ${magnet}'s author (401). Only the publishing ` +
          `account can withdraw an artifact. ${detail}`,
      };
    }
    if (res.status === 404) return { ok: false, error: `no such artifact: ${magnet}` };
    return { ok: false, error: `registry /delist → ${res.status}: ${detail}` };
  }
  const json = (await res.json()) as Omit<DelistOk, "ok">;
  return { ok: true, ...json };
}
