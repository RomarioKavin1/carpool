/**
 * What one account published, sold, bought and was actually paid.
 *
 * ## This screen carries the product's central claim
 *
 * "The author who did the work gets paid" is the sentence the whole design has to
 * support. The registry serves payout rows with their state derived on its own
 * clock, a settled row names its batch, and the batch names a transaction anyone
 * can open. So "you were paid" is "here is the transaction".
 *
 * ## Identity, and the "you" this used to print
 *
 * This page has no session and no keys. It used to open on
 * `NEXT_PUBLIC_CARPOOL_AUTHOR`, baked in at deploy, and tag that account "you".
 * It was a seed account, not the viewer. Now the account comes from the viewer:
 * typed into the lookup, linked as `#earnings?account=0.0.x`, or read off a
 * wallet they connect (read-only, see lib/wallet.ts). With none of those, the
 * desk shows the author buyers paid most and says that is what it is.
 *
 * `GET /payouts` is fetched for exactly one payee at a time. The scoped form is
 * open; the unscoped table is operator-gated and this app cannot express the call.
 */
"use client";

import { useMemo } from "react";
import {
  type Batch,
  type Payout,
  type RegistryState,
  type WellKnown,
} from "../lib/api";
import { STATUS_MEANING, artifactStatus } from "../lib/derive";
import { summarizeAccount, type AccountSummary } from "../lib/account";
import { acctUrl, fmtAgo, fmtBytes, fmtDays, fmtMicro, fmtUsd, shortId, txUrl } from "../lib/format";
import {
  AUTHOR_ROYALTY,
  PAYOUT_STATE_MEANING,
  batchFor,
  batchesById,
  buildSeeders,
  findSeeder,
  totalPayouts,
  type Seeder,
} from "../lib/seeding";
import { AccountLookup } from "./AccountLookup";
import { PayoutBadge, RefundBadge } from "./ArtifactDetail";
import { DecayBarRow } from "./DecayBar";
import {
  Band,
  Button,
  Caveat,
  Mark,
  NoData,
  Out,
  Panel,
  Section,
  Skeleton,
  TableScroll,
  Td,
  Term,
  Th,
} from "./primitives";
import type { View } from "./Shell";

export function EarningsDesk({
  state,
  wellKnown,
  nowMs,
  account,
  onAccount,
  payouts,
  payoutsError,
  batches,
  selectedAuthor,
  onSelectAuthor,
  onOpenArtifact,
  onView,
}: {
  state: RegistryState;
  wellKnown: WellKnown | null;
  nowMs: number;
  /** The account the viewer looked up, linked or connected; null when none. */
  account: string | null;
  onAccount: (account: string | null) => void;
  /** `GET /payouts?payee=` for the account on screen, or null until it lands. */
  payouts: Payout[] | null;
  payoutsError: string | null;
  batches: Batch[];
  /** A raw author string picked from the list, for an author with no parseable account. */
  selectedAuthor: string | null;
  onSelectAuthor: (rawAuthor: string | null) => void;
  onOpenArtifact: (magnet: string) => void;
  onView: (view: View) => void;
}) {
  const seeders = useMemo(() => buildSeeders(state, payouts ?? []), [state, payouts]);
  const summary = useMemo(
    () => (account ? summarizeAccount(state, account, payouts) : null),
    [state, account, payouts],
  );
  // With no account, the open author is the one picked from the list, else the
  // one buyers paid most. Never labelled as the viewer's.
  const fallback = account ? null : (findSeeder(seeders, selectedAuthor) ?? seeders[0] ?? null);

  const pick = (s: Seeder) => {
    if (s.identity.payoutAccount) onAccount(s.identity.payoutAccount);
    else {
      onAccount(null);
      onSelectAuthor(s.identity.raw);
    }
  };

  return (
    <Section
      eyebrow="Author earnings"
      title="What an account published, sold and was paid"
      deck={["What an account published,", "sold and was paid"]}
      node="19%"
      lede="Paste a Hedera account or connect a wallet. Every figure is read from the registry."
    >
      <AccountLookup account={account} network={wellKnown?.network ?? null} onAccount={onAccount} />

      {seeders.length > 0 && (
        <div className="mt-10">
          <h3 className="label text-2xs text-ink-faint">Authors on this registry</h3>
          <AuthorPicker
            seeders={seeders}
            activeAccount={account}
            activeSeeder={fallback}
            onPick={pick}
          />
        </div>
      )}

      {summary ? (
        summary.seeders.length === 0 ? (
          <NothingPublished
            summary={summary}
            payouts={payouts}
            payoutsError={payoutsError}
            batches={batches}
            fee={wellKnown?.prices.trackerFeeMicroUsdc ?? null}
            onView={onView}
          />
        ) : (
          <AuthorBody
            seeders={summary.seeders}
            payee={summary.account}
            headline={summary.account}
            nowMs={nowMs}
            wellKnown={wellKnown}
            payouts={payouts}
            payoutsError={payoutsError}
            batches={batches}
            onOpenArtifact={onOpenArtifact}
          />
        )
      ) : fallback ? (
        <>
          <p className="mt-10 text-sm text-ink-soft">
            {selectedAuthor
              ? "Showing the author you picked."
              : "Showing the author buyers paid most. Look up any account above."}
          </p>
          <Caveat summary="Why not yours" className="mt-3">
            <p>
              This page has no session, so it cannot tell which account is yours. Name one above, link
              it, or connect a wallet.
            </p>
          </Caveat>
          <AuthorBody
            seeders={[fallback]}
            payee={fallback.identity.payoutAccount}
            headline={fallback.identity.payoutAccount ?? shortId(fallback.identity.raw, 10, 6)}
            nowMs={nowMs}
            wellKnown={wellKnown}
            payouts={payouts}
            payoutsError={payoutsError}
            batches={batches}
            onOpenArtifact={onOpenArtifact}
          />
        </>
      ) : (
        <Panel tone="raised" className="mt-10 px-5 py-6 sm:px-7">
          <h3 className="text-xl font-medium text-ink">Nobody has published anything yet</h3>
          <p className="measure mt-3 text-base text-ink-soft">
            An author appears the moment their first artifact is published.
          </p>
          <div className="mt-5">
            <Button variant="primary" onClick={() => onView("join")}>
              How to publish
            </Button>
          </div>
          <Caveat summary="How authors are grouped" className="mt-5">
            <p>
              The registry groups by the exact author string, so one account signing with two different
              keys is two authors and not one.
            </p>
          </Caveat>
        </Panel>
      )}
    </Section>
  );
}

/**
 * The author list. A horizontal row of choices rather than a sidebar: a sidebar
 * of eleven accounts beside a wide table is the layout that made this screen
 * feel like a control panel. Picking one writes its account into the lookup and
 * the link, the same as typing it.
 */
function AuthorPicker({
  seeders,
  activeAccount,
  activeSeeder,
  onPick,
}: {
  seeders: Seeder[];
  activeAccount: string | null;
  activeSeeder: Seeder | null;
  onPick: (s: Seeder) => void;
}) {
  return (
    <div className="-mx-5 mt-3 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
      <ul className="flex min-w-max items-stretch gap-2 pb-1" role="list">
        {seeders.map((s) => {
          const active = activeAccount
            ? s.identity.payoutAccount === activeAccount
            : s === activeSeeder;
          return (
            <li key={s.identity.raw}>
              <button
                type="button"
                onClick={() => onPick(s)}
                aria-current={active ? "true" : undefined}
                className={`flex h-full w-full flex-col items-start gap-0.5 rounded-md px-4 py-2.5 text-left transition-colors duration-150 ease-out ${
                  active
                    ? "bg-ink text-paper"
                    : "bg-paper text-ink-soft hover:bg-plate hover:text-ink"
                }`}
              >
                <span className="max-w-[26ch] truncate font-mono text-sm">
                  {s.identity.payoutAccount ?? shortId(s.identity.raw, 10, 6)}
                </span>
                <span className="tnum font-mono text-xs">
                  {s.artifacts.length} published, {fmtMicro(s.grossUusdc)} paid
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The account has no artifact here. Say what it did do, and how it would earn. */
function NothingPublished({
  summary,
  payouts,
  payoutsError,
  batches,
  fee,
  onView,
}: {
  summary: AccountSummary;
  payouts: Payout[] | null;
  payoutsError: string | null;
  batches: Batch[];
  fee: number | null;
  onView: (view: View) => void;
}) {
  const hasRows = payouts !== null && payouts.length > 0;
  return (
    <div className="mt-12 space-y-8">
      <Panel tone="raised" className="px-5 py-6 sm:px-7">
        <h3 className="text-xl font-medium text-ink">
          <span className="font-mono [overflow-wrap:anywhere]">{summary.account}</span> has published
          nothing on this registry
        </h3>
        <p className="measure mt-3 text-base text-ink-soft">
          {summary.bought > 0
            ? `It bought ${summary.bought} ${summary.bought === 1 ? "artifact" : "artifacts"} here, paying ${fmtMicro(summary.spentUusdc)} in total.`
            : "It has not bought anything here either."}
        </p>
        <p className="measure mt-2 text-base text-ink-soft">
          It earns once an artifact it publishes names it as the author.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button variant="primary" onClick={() => onView("join")}>
            How to publish
          </Button>
          <Out href={acctUrl(summary.account)} className="text-sm">
            This account on HashScan
          </Out>
        </div>
        <Caveat summary="Why an account can read empty" className="mt-6">
          <p>
            Earnings follow the author field of a published manifest. Take part shows the two variables
            that set it.
          </p>
          <p>This reads one registry. The same account may have published to a different one.</p>
          <p>A mistyped id is a different, valid account, so check the digits first.</p>
        </Caveat>
      </Panel>
      {(payoutsError || hasRows) && (
        <Payouts
          royalties={payouts === null ? null : totalPayouts(payouts, AUTHOR_ROYALTY)}
          payouts={payouts}
          payoutsError={payoutsError}
          payee={summary.account}
          batches={batchesById(batches)}
          fee={fee}
        />
      )}
    </div>
  );
}

function AuthorBody({
  seeders,
  payee,
  headline,
  wellKnown,
  nowMs,
  payouts,
  payoutsError,
  batches,
  onOpenArtifact,
}: {
  seeders: Seeder[];
  payee: string | null;
  headline: string;
  wellKnown: WellKnown | null;
  nowMs: number;
  payouts: Payout[] | null;
  payoutsError: string | null;
  batches: Batch[];
  onOpenArtifact: (magnet: string) => void;
}) {
  const byBatch = batchesById(batches);
  const royalties = payouts === null ? null : totalPayouts(payouts, AUTHOR_ROYALTY);
  const sum = (f: (s: Seeder) => number) => seeders.reduce((n, s) => n + f(s), 0);
  const published = sum((s) => s.artifacts.length);

  return (
    <div className="mt-8">
      <h3 className="font-mono text-2xl text-ink [overflow-wrap:anywhere]">{headline}</h3>
      <dl className="mt-5 flex flex-wrap items-baseline gap-x-10 gap-y-4 text-base">
        <Stat label="published" value={String(published)} note={`${sum((s) => s.liveArtifacts)} still on sale`} />
        <Stat
          label="sales"
          value={String(sum((s) => s.sales))}
          note={`${sum((s) => s.refundedSales)} refunded, ${sum((s) => s.reversibleSales)} still reversible`}
        />
        <Stat
          label="paid by buyers"
          value={fmtMicro(sum((s) => s.grossUusdc))}
          note={`${fmtUsd(sum((s) => s.grossUusdc), 4)}, refunds included`}
        />
        <Stat
          label="timestamped on chain"
          value={`${sum((s) => s.anchoredArtifacts)} of ${published}`}
          note="hashes in a successful anchor"
        />
      </dl>

      <div className="mt-10">
        <Payouts
          royalties={royalties}
          payouts={payouts}
          payoutsError={payoutsError}
          payee={payee}
          batches={byBatch}
          fee={wellKnown?.prices.trackerFeeMicroUsdc ?? null}
        />
      </div>

      {seeders.map((seeder) => (
        <SeederTables
          key={seeder.identity.raw}
          seeder={seeder}
          keyLabel={seeders.length > 1 ? seeder.identity.publicKey : null}
          nowMs={nowMs}
          payouts={payouts}
          byBatch={byBatch}
          onOpenArtifact={onOpenArtifact}
        />
      ))}
    </div>
  );
}

function SeederTables({
  seeder,
  keyLabel,
  nowMs,
  payouts,
  byBatch,
  onOpenArtifact,
}: {
  seeder: Seeder;
  /** Set when one account published under several keys, so the tables say which. */
  keyLabel: string | null;
  nowMs: number;
  payouts: Payout[] | null;
  byBatch: Map<number, Batch>;
  onOpenArtifact: (magnet: string) => void;
}) {
  const nowSeconds = Math.floor(nowMs / 1000);

  return (
    <div>
      <div className="hairline-t mt-16 pt-8">
        <h3 className="text-xl font-medium text-ink">
          On the wire
          {keyLabel && (
            <span className="ml-2 font-mono text-sm font-normal text-ink-soft">
              key {shortId(keyLabel, 8, 6)}
            </span>
          )}
        </h3>
        <div className="mt-6">
          <TableScroll note="This table scrolls sideways; the page does not.">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <caption className="sr-only">
                This author&rsquo;s artifacts, their sales and what buyers paid.
              </caption>
              <thead className="bg-plate">
                <tr>
                  <Th className="w-full min-w-[22ch]">what it answers</Th>
                  <Th right>size</Th>
                  <Th right>age</Th>
                  <Th right>sales</Th>
                  <Th right>paid by buyers</Th>
                  <Th>life left</Th>
                  <Th right>price now</Th>
                </tr>
              </thead>
              <tbody>
                {seeder.artifacts.map(({ artifact, sales, grossUusdc, refundedSales }) => {
                  const status = artifactStatus(artifact);
                  return (
                    <tr key={artifact.manifest.magnet} className="transition-colors duration-150 ease-out hover:bg-panel">
                      <Td className="max-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenArtifact(artifact.manifest.magnet)}
                          className="block w-full truncate text-left text-wire underline decoration-rule-firm underline-offset-4 hover:decoration-wire"
                          title="Open this artifact in the overview"
                        >
                          {artifact.manifest.question}
                        </button>
                        {status !== "live" && (
                          <span
                            className={`text-xs ${status === "withdrawn" ? "text-debit" : "text-ember"}`}
                            title={STATUS_MEANING[status]}
                          >
                            {status}
                          </span>
                        )}
                      </Td>
                      <Td right dim>
                        {fmtBytes(artifact.manifest.bodyBytes)}
                      </Td>
                      <Td right dim>
                        {fmtDays(artifact.ageDays)}
                      </Td>
                      <Td right className="font-mono">
                        {sales}
                        {refundedSales > 0 && (
                          <span className="text-debit" title={`${refundedSales} refunded`}>
                            {" "}
                            −{refundedSales}
                          </span>
                        )}
                      </Td>
                      <Td right className="font-mono">
                        {fmtUsd(grossUusdc, 4)}
                      </Td>
                      <Td>
                        <DecayBarRow freshness={artifact.freshness} />
                      </Td>
                      <Td right className="font-mono">
                        {fmtUsd(artifact.priceNow)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      </div>

      <div className="hairline-t mt-16 pt-8">
        <h3 className="text-xl font-medium text-ink">Every sale, newest first</h3>
        {seeder.saleRows.length === 0 ? (
          <p className="measure mt-3 text-base text-ink-soft">
            No sales yet, so there is nothing held, owed, paid or reversed.
          </p>
        ) : (
          <div className="mt-6">
            <TableScroll max="max-w-[900px]" note="This table scrolls sideways; the page does not.">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <caption className="sr-only">
                  Every sale of this author&rsquo;s artifacts, newest first, with the royalty each
                  one accrued and whether it has been paid.
                </caption>
                <thead className="bg-plate">
                  <tr>
                    <Th>when</Th>
                    <Th>buyer</Th>
                    <Th right>buyer paid</Th>
                    <Th title="Derived by the registry on its own clock.">sale</Th>
                    <Th right>author&rsquo;s share</Th>
                    <Th>paid out?</Th>
                  </tr>
                </thead>
                <tbody>
                  {seeder.saleRows.map((row) => (
                    <tr key={row.purchase.id} className="transition-colors duration-150 ease-out hover:bg-panel">
                      <Td dim title={new Date(row.purchase.ts * 1000).toLocaleString()}>
                        {fmtAgo(row.purchase.ts, nowMs)}
                      </Td>
                      <Td>
                        <Out href={acctUrl(row.purchase.buyer)} className="font-mono text-xs">
                          {shortId(row.purchase.buyer, 9, 4)}
                        </Out>
                      </Td>
                      <Td right className="font-mono">
                        {fmtMicro(row.purchase.paid)}
                      </Td>
                      <Td>
                        <RefundBadge purchase={row.purchase} nowSeconds={nowSeconds} />
                      </Td>
                      <Td right className="font-mono">
                        {row.royalty ? (
                          fmtMicro(row.royalty.amount)
                        ) : (
                          <NoData
                            why={
                              payouts === null
                                ? "The payout rows for this payee have not answered yet. The amount is read off the payout row, never recomputed from the price minus the fee."
                                : "No author_royalty row came back for this purchase's authorRoyaltyPayoutId."
                            }
                          >
                            not read
                          </NoData>
                        )}
                      </Td>
                      <Td>
                        <PayoutBadge payout={row.royalty} batch={batchFor(row.royalty, byBatch)} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        )}
      </div>
    </div>
  );
}


function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="label text-2xs text-ink-faint">{label}</dt>
      <dd className="tnum mt-1.5 font-mono text-xl text-ink">{value}</dd>
      <dd className="mt-1 text-sm text-ink-soft">{note}</dd>
    </div>
  );
}

/**
 * The four payout states, read off `GET /payouts`. Held and owed are money in
 * motion; paid is money that moved and can be checked on a public explorer;
 * reversed is money a refund took back, shown rather than hidden so a refunded
 * sale does not look like a sale that never happened.
 */
function Payouts({
  royalties,
  payouts,
  payoutsError,
  payee,
  batches,
  fee,
}: {
  royalties: ReturnType<typeof totalPayouts> | null;
  payouts: Payout[] | null;
  payoutsError: string | null;
  payee: string | null;
  batches: Map<number, Batch>;
  fee: number | null;
}) {
  if (payee === null) {
    return (
      <Panel tone="raised" className="px-5 py-6 sm:px-7">
        <h3 className="text-xl font-medium text-ink">There is no payout account to ask about</h3>
        <p className="measure mt-3 text-base text-ink-soft">
          This author&rsquo;s identifier does not follow this registry&rsquo;s{" "}
          <Term
            word="<account>:<publicKey>"
            means="This registry's own convention for the manifest's author field. The protocol treats that field as opaque."
          />{" "}
          convention.
        </p>
        <Caveat summary="Why nothing is guessed" className="mt-4">
          <p>
            There is no account to scope the payout query by. The protocol treats the author string
            as opaque, and guessing a payee out of it would be inventing one.
          </p>
        </Caveat>
      </Panel>
    );
  }

  if (payoutsError) {
    return (
      <Band tone="debit" className="px-5 py-5">
        <h3 className="label text-2xs text-debit">The payout rows did not answer</h3>
        <p className="mt-2 font-mono text-sm text-ink">{payoutsError}</p>
        <p className="mt-2 text-sm text-ink-soft">Nothing is shown in their place.</p>
        <Caveat summary="Why nothing is estimated" className="mt-3">
          <p>The amounts and the states live on those rows and are not recomputed here.</p>
        </Caveat>
      </Band>
    );
  }

  if (royalties === null || payouts === null) {
    return (
      <Panel tone="raised" className="px-5 py-6 sm:px-7">
        <h3 className="text-xl font-medium text-ink">Reading this author&rsquo;s payout rows</h3>
        <div className="mt-4 flex flex-wrap gap-8">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-7 w-28" />
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  const settledRows = payouts.filter((p) => p.reason === AUTHOR_ROYALTY && p.state === "settled");
  const settledBatchIds = [...new Set(settledRows.map((r) => r.settledBatchId!))];
  const trackerTake = totalPayouts(payouts, "tracker_fee");
  const parked = payouts.filter((p) => p.reason === AUTHOR_ROYALTY && p.parkedAt != null).length;

  if (royalties.rows === 0) {
    return (
      <Panel tone="raised" className="px-5 py-6 sm:px-7">
        <h3 className="text-xl font-medium text-ink">Nothing earned yet</h3>
        <p className="measure mt-3 text-base text-ink-soft">
          No royalty rows exist for <span className="font-mono text-ink">{payee}</span>.
        </p>
        <Caveat summary="Empty, not unread" className="mt-4">
          <p>
            A row accrues the moment a sale settles, so this fills in on the first purchase. Nothing
            has been earned; it is not that nothing could be read.
          </p>
        </Caveat>
      </Panel>
    );
  }

  return (
    <Panel tone="raised" className="px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3 className="text-xl font-medium text-ink">Earned, and how much has actually moved</h3>
        <p className="flex items-center gap-3 text-sm text-ink-soft">
          {royalties.rows} royalty row{royalties.rows === 1 ? "" : "s"}
          <Mark
            kind="live"
            note={`Read from the registry's payout table scoped to ${payee}, with each row's state derived on the registry's clock.`}
          />
        </p>
      </div>

      <p className="measure-wide mt-4 text-lg text-ink">
        <span className="tnum font-mono" title={fmtUsd(royalties.earned, 4)}>{fmtMicro(royalties.earned)}</span> earned, of which{" "}
        <span className="tnum font-mono" title={fmtUsd(royalties.settled, 4)}>{fmtMicro(royalties.settled)}</span> has actually been paid
        out
        {settledBatchIds.length === 0
          ? " in no batch yet"
          : ` in ${settledBatchIds.length} ${settledBatchIds.length === 1 ? "batch" : "batches"}`}
        {royalties.voided > 0 && (
          <>
            , and <span className="tnum font-mono">{fmtMicro(royalties.voided)}</span> was taken back
            by refunds
          </>
        )}
        .
      </p>

      {settledBatchIds.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {settledBatchIds.map((batchId) => {
            const batch = batches.get(batchId) ?? null;
            return (
              <li key={batchId} className="text-ink-soft">
                batch {batchId}:{" "}
                {batch?.txId ? (
                  <Out href={txUrl(batch.txId)} className="font-mono">
                    {shortId(batch.txId, 12, 6)}
                  </Out>
                ) : (
                  <NoData
                    why={
                      batch === null
                        ? "This batch id was not in the registry's batch list."
                        : `The batch is ${batch.status} and its transfer id has not been recorded, so there is no transaction to open.`
                    }
                  >
                    {batch === null ? "not in the batch list" : batch.status}
                  </NoData>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <dl className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-4">
        <PayoutState label="held" plain="waiting for the refund window" value={royalties.held} state="held" tone="text-ember" />
        <PayoutState label="owed" plain="no longer reversible, not yet transferred" value={royalties.claimable} state="claimable" tone="text-wire" />
        <PayoutState label="paid" plain="a transfer moved it" value={royalties.settled} state="settled" tone="text-credit" />
        <PayoutState label="reversed" plain="a refund took it back" value={royalties.voided} state="voided" tone="text-debit" />
      </dl>

      {parked > 0 && (
        <p className="mt-6 text-sm text-ink">
          {parked} {parked === 1 ? "row is" : "rows are"} parked after a failed transfer. The registry
          reports parked rows as held until the operator retries them.
        </p>
      )}

      <Caveat summary="How a sale splits" className="mt-8">
        <p>
          Two rows accrue per sale and add up to exactly what the buyer paid: the author&rsquo;s
          royalty, held until the refund window closes, and the registry&rsquo;s flat fee, available
          at once and never returned.
        </p>
        {fee !== null && (
          <p>
            That fee is <span className="tnum font-mono text-ink">{fmtUsd(fee)}</span> a sale, and
            every artifact&rsquo;s price floor has to clear it.
          </p>
        )}
        {trackerTake.rows > 0 && (
          <p>
            This account also holds {trackerTake.rows} fee row{trackerTake.rows === 1 ? "" : "s"},
            because it is the registry&rsquo;s own settlement account. The royalty totals above
            exclude them.
          </p>
        )}
      </Caveat>
    </Panel>
  );
}

function PayoutState({
  label,
  plain,
  value,
  state,
  tone,
}: {
  label: string;
  plain: string;
  value: number;
  state: keyof typeof PAYOUT_STATE_MEANING;
  tone: string;
}) {
  return (
    <div className="pt-1">
      <dt className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        <Mark kind="live" note={PAYOUT_STATE_MEANING[state]} />
      </dt>
      <dd className={`tnum mt-1 font-mono text-xl ${tone}`} title={fmtUsd(value, 4)}>
        {fmtMicro(value)}
      </dd>
      <dd className="mt-1 text-sm text-ink-soft">{plain}</dd>
    </div>
  );
}
