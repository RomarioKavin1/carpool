/**
 * An ENS author inside an opened artifact's record column.
 *
 * Three facts, in the order a reader needs them: is this name really the
 * author (the badge, in words, never hue alone), where would the next sale's
 * royalty go (one row, linked to the account), and why (the three record checks).
 * The name's own ENSIP-5 profile follows, and only the records it actually has.
 *
 * No avatar image: rendering one would make every reader's browser fetch a URL
 * the name's owner chose. The record is shown as a link instead.
 *
 * Every value comes from `GET /identity`. While it loads the rows are a
 * skeleton; when it fails the rows say so. Nothing is filled in.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ADDR_CHECK,
  BINDING_LABEL,
  BINDING_MEANING,
  KEY_CHECK,
  SIG_CHECK,
  getIdentity,
  safeHttpsUrl,
  type EnsIdentity,
} from "../lib/ens";
import { acctUrl } from "../lib/format";
import { Badge, Caveat, KV, NoData, Out, Skeleton } from "./primitives";

export function EnsAuthorRecord({ author }: { author: string }) {
  const [identity, setIdentity] = useState<EnsIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setIdentity(null);
    setError(null);
    getIdentity(author, ac.signal)
      .then(setIdentity)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ac.abort();
  }, [author]);

  return <EnsAuthorView identity={identity} error={error} />;
}

export function EnsAuthorView({ identity, error }: { identity: EnsIdentity | null; error: string | null }) {
  if (error) {
    return (
      <Shell badge={<Badge>not checked</Badge>}>
        <KV k="name records" v={<NoData why={error}>registry did not answer</NoData>} />
      </Shell>
    );
  }
  if (!identity) {
    return (
      <Shell badge={null}>
        <div aria-busy="true" className="space-y-3 py-2.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Shell>
    );
  }

  const b = identity.binding;
  const tone = b.status === "verified" ? "credit" : "neutral";
  const p = identity.profile;
  const url = safeHttpsUrl(p.url);
  const avatar = safeHttpsUrl(p.avatar);

  return (
    <Shell
      name={identity.name}
      badge={
        <Badge tone={tone} title={BINDING_MEANING[b.status]}>
          {BINDING_LABEL[b.status]}
        </Badge>
      }
    >
      <KV
        k="next sale pays"
        title="Where a sale made now would send the author's royalty. Each sale decides this when it happens and keeps it."
        v={
          <span>
            <Out href={acctUrl(identity.payoutNow.account)}>{identity.payoutNow.account}</Out>
            <span className="text-ink-soft">
              {identity.payoutNow.source === "ens" ? " from the name" : " signed fallback"}
            </span>
          </span>
        }
      />
      <KV k="key record" v={KEY_CHECK[b.checks.key]} title="io.carpool.key" />
      <KV
        k="Hedera record"
        title="addr, coin type 3030"
        v={b.hederaAccount ? `${ADDR_CHECK[b.checks.hederaAddr]}, ${b.hederaAccount}` : ADDR_CHECK[b.checks.hederaAddr]}
      />
      <KV k="payout signature" v={SIG_CHECK[b.checks.payoutSig]} title="io.carpool.payout-sig" />
      {p.description ? <KV k="about" v={p.description} /> : null}
      {p.keywords ? <KV k="topics" v={p.keywords} /> : null}
      {p.url ? <KV k="link" v={url ? <Out href={url}>{new URL(url).host}</Out> : p.url} /> : null}
      {p["com.github"] ? <KV k="GitHub" v={p["com.github"]} /> : null}
      {avatar ? <KV k="avatar" v={<Out href={avatar}>open</Out>} /> : null}

      <Caveat summary="How a name is verified" className="mt-4">
        <p>The signed manifest names the ENS name. The name's records must name the signing key back.</p>
        <p>
          The Hedera record is paid only with the author's signature over it, so whoever controls the name
          cannot redirect money.
        </p>
        <p>Anything short of that pays the fallback account the author signed into the manifest.</p>
        {b.problems.length > 0 ? (
          <ul className="list-inside list-disc space-y-1">
            {b.problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        <p>
          Read from ENS on {identity.network}, {new Date(identity.checkedAt * 1000).toLocaleTimeString()}.
        </p>
      </Caveat>
    </Shell>
  );
}

function Shell({
  name,
  badge,
  children,
}: {
  name?: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6" aria-label="ENS name">
      <div className="flex items-baseline justify-between gap-3">
        <h5 className="text-sm font-medium text-ink">
          ENS name{name ? <span className="font-mono text-xs text-ink-soft"> {name}</span> : null}
        </h5>
        {badge}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}
