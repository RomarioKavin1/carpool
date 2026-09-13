/**
 * ENS authors, as the dashboard sees them.
 *
 * The registry does every check (apps/registry/src/ens.ts, `GET /identity`);
 * this file only recognises the author string and turns the registry's answer
 * into words. Nothing here reads Ethereum, and nothing here decides whether a
 * name is verified: a dashboard that re-derived that would be a second opinion
 * nobody asked for, and it could disagree with the one that moves money.
 *
 * Kept out of lib/api.ts and lib/seeding.ts on purpose, so this feature does not
 * touch files other work is changing.
 */
import type { IdentityView } from "../../registry/src/ens";
import { REGISTRY_URL } from "./api";

export type EnsIdentity = Extract<IdentityView, { kind: "ens" }>;
export type EnsBindingView = EnsIdentity["binding"];

export interface EnsAuthorParts {
  name: string;
  fallbackAccount: string;
  publicKey: string;
}

/**
 * `"ens:<name>:<fallbackAccountId>:<publicKeyHex>"` or null. Shape only; the
 * registry already verified the signature before it stored the artifact.
 */
export function parseEnsAuthorString(raw: string): EnsAuthorParts | null {
  if (!raw.startsWith("ens:")) return null;
  const parts = raw.slice(4).split(":");
  if (parts.length !== 3) return null;
  const [name, fallbackAccount, publicKey] = parts as [string, string, string];
  if (!name.includes(".") || !/^\d+\.\d+\.\d+$/.test(fallbackAccount) || !/^[0-9a-fA-F]{8,}$/.test(publicKey)) {
    return null;
  }
  return { name, fallbackAccount, publicKey };
}

export const BINDING_LABEL: Record<EnsBindingView["status"], string> = {
  verified: "verified",
  unbound: "not verified",
  unreachable: "not checked",
};

export const BINDING_MEANING: Record<EnsBindingView["status"], string> = {
  verified: "The name's records name this author's key and a Hedera account the key signed for.",
  unbound: "The name answered, and at least one record does not match this author.",
  unreachable: "The registry could not read the name, so nothing is known either way.",
};

type Checks = EnsBindingView["checks"];

export const KEY_CHECK: Record<Checks["key"], string> = {
  match: "matches the signing key",
  mismatch: "names a different key",
  missing: "not set",
  unknown: "not read",
};

export const ADDR_CHECK: Record<Checks["hederaAddr"], string> = {
  present: "set",
  malformed: "not a Hedera account",
  missing: "not set",
  unknown: "not read",
};

export const SIG_CHECK: Record<Checks["payoutSig"], string> = {
  valid: "signed by the author",
  invalid: "not signed by the author",
  missing: "not set",
  unknown: "not read",
};

/** A profile URL is only rendered as a link when it is plain https. Anything else is shown as text. */
export function safeHttpsUrl(v: string | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function getIdentity(author: string, signal?: AbortSignal): Promise<EnsIdentity> {
  const path = `/identity?author=${encodeURIComponent(author)}`;
  const res = await fetch(`${REGISTRY_URL}${path}`, { signal, cache: "no-store", headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as (IdentityView & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status} from ${path}`);
  if (body.kind !== "ens") throw new Error("the registry does not read this author as an ENS name");
  return body;
}
