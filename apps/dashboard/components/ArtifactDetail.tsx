/**
 * One artifact, opened in place.
 *
 * ## Why there is no modal and no tab strip
 *
 * A modal would be the lazy answer: everything here is inspectable inline, the
 * table row it belongs to is worth keeping on screen, and a dialog would take
 * the reader out of the list they were scanning. So this renders inside the
 * table, in a row of its own directly beneath the one that was clicked.
 *
 * It also no longer splits itself into four ARIA tabs. The previous build's tab
 * strip was half-implemented (four `role="tab"`, zero `role="tabpanel"`, no
 * roving tabindex) and completing it was the right fix at the time, but a tab
 * strip inside an expanded table row is chrome hiding content from a reader who
 * has already asked to see it. One flowing disclosure with real headings is
 * fewer moving parts, fully keyboard-operable for free, and reads top to bottom.
 *
 * ## Plain words outside, exact words inside
 *
 * This IS the inside. `magnet`, `freshness`, `µUSDC`, `settledBatchId` and
 * `authorRoyaltyPayoutId` are allowed here and nowhere above it, and each one
 * carries its definition on the word itself rather than in a legend.
 *
 * ## Three panels, not eleven
 *
 * The reference is built out of few large panels of visibly different sizes, and
 * the failure mode when you port that to a dense detail view is card soup: nine
 * equal boxes in a grid, which is the one part of "no cards, ever" this pass
 * keeps. So an opened artifact is three panels and no more:
 *
 * 1. **A solid `ink` mass** carrying what the artifact IS — the question, its
 *    address, what it costs at this second, and the decay bar at full width. The
 *    only light-on-dark tokens used here are `paper`, `ink-lift` and
 *    `ember-soft`, all three of which `lib/tokens.test.ts` measures on `ink`.
 * 2. **A wide `paper` panel**: the long read. The abstract, the sources, the
 *    withdrawal notice when there is one, and every buyer.
 * 3. **A narrow `plate` panel**: the reference column. Health, the price rule,
 *    the record. Different width and different fill from (2), so the two read as
 *    two kinds of thing rather than as two cards.
 */
"use client";

import type { Batch, Payout, PurchaseState, RefundState, WellKnown } from "../lib/api";
import type { ArtifactState, RegistryState } from "../lib/api";
import { priceAtFreshness } from "../lib/decay";
import { STATUS_MEANING, artifactStatus, purchasesForMagnet } from "../lib/derive";
import {
  acctUrl,
  fmtAgo,
  fmtBytes,
  fmtCount,
  fmtDuration,
  fmtUsd,
  fmtUsdFloat,
  pct,
  shortId,
  txUrl,
} from "../lib/format";
import {
  PAYOUT_STATE_MEANING,
  REFUND_STATE_MEANING,
  batchFor,
  batchesById,
  parseAuthor,
  payoutsById,
  secondsUntilFinal,
} from "../lib/seeding";
import { DecayBarPanel } from "./DecayBar";
import { EnsAuthorRecord } from "./EnsAuthor";
import { parseEnsAuthorString } from "../lib/ens";
import { Badge, Band, Caveat, CornerMark, KV, Mark, NoData, Out, Panel, TableScroll, Td, Term, Th } from "./primitives";

export function ArtifactDetail({
  artifact,
  state,
  wellKnown,
  nowMs,
  payouts,
  batches,
}: {
  artifact: ArtifactState;
  state: RegistryState;
  wellKnown: WellKnown | null;
  nowMs: number;
  /**
   * `GET /payouts?payee=` for THIS artifact's author, or null when the author
   * string does not parse into a payout account (so there is no scope to ask
   * for) or the call has not landed. Never a stand-in for computed amounts.
   */
  payouts: Payout[] | null;
  batches: Batch[];
}) {
  const m = artifact.manifest;
  const purchases = purchasesForMagnet(state, m.magnet);

  const status = artifactStatus(artifact);

  return (
    <div>
      {/* 1 — the dark mass: what this artifact is, and how long it has left. */}
      <Panel tone="dark" className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-7">
        <CornerMark kind="plus" className="absolute right-4 top-4 fill-ink-lift" />
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2 pr-6">
          <h3 className="min-w-0 text-lg font-medium text-paper">{m.question}</h3>
          {status === "withdrawn" && (
            <Badge tone="onDark" title={STATUS_MEANING.withdrawn}>
              withdrawn
            </Badge>
          )}
          {status === "expired" && (
            <Badge tone="onDark" title={STATUS_MEANING.expired}>
              expired
            </Badge>
          )}
        </div>
        <p
          className="mt-2 break-words font-mono text-xs text-ink-lift [overflow-wrap:anywhere]"
          title="The magnet: sha256 over the signed manifest. The address IS the contents."
        >
          {m.magnet}
        </p>

        <dl className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
          <DarkFigure label="price right now" value={fmtUsd(artifact.priceNow)} />
          <DarkFigure
            label="buyers, all time"
            value={String(artifact.distinctBuyers)}
          />
          <DarkFigure label="health" value={artifact.health.toFixed(3)} />
        </dl>

        <div className="mt-9">
          <DecayBarPanel
            dark
            freshness={artifact.freshness}
            halfLifeDays={m.decay.halfLifeDays}
            ageDays={artifact.ageDays}
          />
        </div>
      </Panel>

      {/* `items-start` matters: without it the grid stretches both panels to the
          taller one's height, and an artifact nobody has bought yet left 600px of
          empty white under a three-line paragraph. */}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)]">
        {/* 2 — the long read. */}
        <Panel tone="raised" className="min-w-0 px-5 py-6 sm:px-7">
          <section>
            <h4 className="label text-2xs text-ink-faint">What the author says it is</h4>
            <p className="measure mt-3 whitespace-pre-line text-base text-ink">{m.abstract}</p>
            <Caveat summary="Who wrote this, and who checked it" className="mt-4">
              <p>The author wrote it. The registry does not check it.</p>
              <p>
                The summary, the sources and the cost claim are free by contract: they are the
                buyer&rsquo;s evidence, and charging for evidence would defeat the mechanism.
              </p>
            </Caveat>
            <Sources artifact={artifact} />
          </section>

          <Withdrawn artifact={artifact} />

          <section className="mt-10">
            <h4 className="label text-2xs text-ink-faint">
              Who has bought it <span className="tnum">({purchases.length})</span>
            </h4>
            <Buyers
              purchases={purchases}
              payouts={payouts}
              batches={batches}
              nowMs={nowMs}
              distinctBuyers={artifact.distinctBuyers}
            />
          </section>
        </Panel>

        {/* 3 — the reference column. */}
        <Panel tone="inset" className="min-w-0 px-5 py-6 sm:px-6">
          <Health artifact={artifact} />

          <section className="mt-9">
            <h4 className="label text-2xs text-ink-faint">How the price is set</h4>
            <Pricing artifact={artifact} wellKnown={wellKnown} />
          </section>

          <section className="mt-9">
            <h4 className="label text-2xs text-ink-faint">The record</h4>
            <Record artifact={artifact} wellKnown={wellKnown} />
          </section>
        </Panel>
      </div>
    </div>
  );
}

/** A headline number on the dark panel. `ink-lift` label, `paper` value. */
function DarkFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label text-2xs text-ink-lift">{label}</dt>
      <dd className="tnum mt-1.5 font-mono text-xl text-paper">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ health */

function Health({ artifact }: { artifact: ArtifactState }) {
  const buyerTerm = 0.4 + 0.6 * Math.min(1, artifact.distinctBuyers / 5);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="label text-2xs text-ink-faint">Health</h4>
        <Mark kind="live" note="Computed by the registry from the three terms shown." />
      </div>
      {/* The number itself is on the dark panel above. Repeating it at 29px here
          would be the same fact twice on one screen; what this section adds is
          what the number is made of. */}
      <p className="mt-3 text-base text-ink-soft">
        Freshness, refund rate and distinct buyers, in one number.
      </p>
      <p className="tnum mt-3 font-mono text-xs text-ink-soft">
        <Term word="freshness" means="The fraction of this artifact's original value left, halving once per half-life." />{" "}
        {artifact.freshness.toFixed(3)} × (1 − refunds {pct(artifact.refundRate, 0)}) × (0.4 + 0.6 ×
        min(1, {artifact.distinctBuyers}/5) = {buyerTerm.toFixed(2)})
      </p>
      <Caveat summary="Why the buyer term floors at 0.4" className="mt-3">
        <p>Brand new research with no buyers yet is not unhealthy. It is new.</p>
      </Caveat>
    </section>
  );
}

/* ----------------------------------------------------------------- sources */

function Sources({ artifact }: { artifact: ArtifactState }) {
  const sources = artifact.manifest.sources;
  if (sources.length === 0) {
    return <p className="mt-4 text-sm text-ink-soft">The author recorded no sources.</p>;
  }
  return (
    <div className="mt-6">
      <h5 className="label text-2xs text-ink-faint">
        {sources.length} source{sources.length === 1 ? "" : "s"} the author names
      </h5>
      <ol className="mt-2">
        {sources.map((s, i) => (
          <li
            key={`${s.url}-${i}`}
            className="hairline-b flex items-baseline gap-3 py-2.5 last:shadow-none"
          >
            <span className="tnum w-5 shrink-0 text-right font-mono text-xs text-ink-faint">
              {i + 1}
            </span>
            <Out href={s.url} className="min-w-0 flex-1 truncate text-sm">
              {s.url}
            </Out>
            <span className="tnum shrink-0 font-mono text-xs text-ink-soft">
              {new Date(s.fetchedAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Withdrawn({ artifact }: { artifact: ArtifactState }) {
  if (artifactStatus(artifact) !== "withdrawn") return null;
  return (
    <Band tone="debit" className="mt-8 px-5 py-5">
      <h4 className="label text-2xs text-debit">Withdrawn by its author</h4>
      <p className="measure mt-2 text-base text-ink">
        No new sale is possible, and this is final for this address.
      </p>
      <Caveat summary="What did not stop" className="mt-3">
        <p>
          Purchases still inside their refund window stay refundable, royalties already accrued are
          still paid, and every buyer who already paid keeps their copy. Nothing can recall it.
        </p>
        <p>
          The address is the contents, so republishing the same bytes does not relist them.
        </p>
        <p>
          There is no button for this here: withdrawal is signed with the author&rsquo;s own key, and
          this page holds none.
        </p>
      </Caveat>
    </Band>
  );
}

/* ----------------------------------------------------------------- buyers */

function Buyers({
  purchases,
  payouts,
  batches,
  nowMs,
  distinctBuyers,
}: {
  purchases: PurchaseState[];
  payouts: Payout[] | null;
  batches: Batch[];
  nowMs: number;
  distinctBuyers: number;
}) {
  if (purchases.length === 0) {
    return (
      <>
        <p className="measure mt-3 text-base text-ink-soft">Nobody has bought this yet.</p>
        <Caveat summary="Not a mark against it" className="mt-3">
          <p>
            Research is published before anyone has had time to want it, which is why the health
            score floors its buyer term rather than starting at zero.
          </p>
        </Caveat>
      </>
    );
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  const byId = payoutsById(payouts ?? []);
  const byBatch = batchesById(batches);
  return (
    <div className="mt-3">
      <p className="text-sm text-ink-soft">
        {purchases.length} purchase{purchases.length === 1 ? "" : "s"} by {distinctBuyers} account
        {distinctBuyers === 1 ? "" : "s"}.
      </p>
      <TableScroll tone="inset" note="This table scrolls sideways.">
        <table className="w-full min-w-[740px] border-collapse text-sm">
          <caption className="sr-only">
            Buyers of this artifact: when, what they paid, whether the sale can still be reversed,
            and the royalty it accrued for the author.
          </caption>
          <thead className="bg-paper">
            <tr>
              <Th>buyer</Th>
              <Th>bought</Th>
              <Th right>paid</Th>
              <Th title="Derived by the registry on its own clock, never from a browser clock.">
                sale
              </Th>
              <Th right title="The author_royalty payout row this sale accrued, joined by authorRoyaltyPayoutId.">
                author&rsquo;s share
              </Th>
              <Th>paid out?</Th>
              <Th>transaction</Th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => {
              const royalty =
                p.authorRoyaltyPayoutId == null ? undefined : byId.get(p.authorRoyaltyPayoutId);
              const batch = batchFor(royalty, byBatch);
              return (
                <tr key={p.id} className="transition-colors duration-150 ease-out hover:bg-paper">
                  <Td>
                    <Out href={acctUrl(p.buyer)} className="font-mono text-xs">
                      {shortId(p.buyer, 10, 4)}
                    </Out>
                  </Td>
                  <Td dim title={new Date(p.ts * 1000).toLocaleString()}>
                    {fmtAgo(p.ts, nowMs)}
                  </Td>
                  <Td right className="font-mono">
                    {fmtUsd(p.paid)}
                  </Td>
                  <Td>
                    <RefundBadge purchase={p} nowSeconds={nowSeconds} />
                  </Td>
                  <Td right className="font-mono">
                    {royalty ? (
                      fmtUsd(royalty.amount)
                    ) : (
                      <NoData
                        why={
                          payouts === null
                            ? "The payout rows for this artifact's author have not been read, so the royalty this sale accrued is unknown. It is never recomputed from paid minus the fee here."
                            : "No author_royalty payout row came back for this purchase's authorRoyaltyPayoutId."
                        }
                      >
                        not read
                      </NoData>
                    )}
                  </Td>
                  <Td>
                    <PayoutBadge payout={royalty} batch={batch} />
                  </Td>
                  <Td>
                    <Out href={txUrl(p.txId)} className="font-mono text-xs">
                      {shortId(p.txId, 8, 4)}
                    </Out>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

/**
 * Whether this sale can still be undone. `refundState` is derived by the
 * registry on its own clock, and `closed` is a real third state with its own
 * affordance: telling an author their money is still reversible when it is not
 * is the specific lie the old two-state rendering told.
 */
export function RefundBadge({
  purchase,
  nowSeconds,
}: {
  purchase: Pick<PurchaseState, "refundState" | "refundDeadline" | "refundedAt">;
  nowSeconds: number;
}) {
  const left = secondsUntilFinal(purchase, nowSeconds);
  const tone: Record<RefundState, "ember" | "neutral" | "debit"> = {
    window: "ember",
    closed: "neutral",
    refunded: "debit",
  };
  const word: Record<RefundState, string> = {
    window: "reversible",
    closed: "final",
    refunded: "refunded",
  };
  return (
    <Badge tone={tone[purchase.refundState]} title={REFUND_STATE_MEANING[purchase.refundState]}>
      {word[purchase.refundState]}
      {left !== null && <span className="tnum"> {fmtDuration(left)}</span>}
    </Badge>
  );
}

/**
 * The payout row's own `state`, read and not derived, plus the batch that paid
 * it. `settled` is the state this dashboard could not show at all until
 * `GET /payouts` existed, and it is the one that matters most: for a product
 * whose claim is that authors get paid, "here is the transaction" is the claim
 * demonstrated rather than asserted.
 */
export function PayoutBadge({ payout, batch }: { payout: Payout | undefined; batch: Batch | null }) {
  if (!payout) {
    return (
      <NoData why="No payout row has been read for this sale. GET /payouts is scoped to one payee at a time, and this artifact's author is not the payee that was fetched.">
        not read
      </NoData>
    );
  }
  const tone = { held: "ember", claimable: "wire", settled: "credit", voided: "debit" } as const;
  const word = {
    held: "held",
    claimable: "owed",
    settled: "paid",
    voided: "reversed",
  } as const;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <Badge tone={tone[payout.state]} title={PAYOUT_STATE_MEANING[payout.state]}>
        {word[payout.state]}
      </Badge>
      {payout.state === "settled" &&
        (batch?.txId ? (
          <Out href={txUrl(batch.txId)} className="font-mono text-xs">
            batch {batch.id}
          </Out>
        ) : (
          <NoData
            why={
              batch === null
                ? "The batch that claimed this row has not been read from GET /batches."
                : "The batch exists but its transfer id has not been recorded yet, so there is no transaction to link to."
            }
          >
            {batch === null ? "batch unknown" : `batch ${batch.id}`}
          </NoData>
        ))}
    </span>
  );
}

/* ---------------------------------------------------------------- pricing */

function Pricing({
  artifact,
  wellKnown,
}: {
  artifact: ArtifactState;
  wellKnown: WellKnown | null;
}) {
  const nextHalving = priceAtFreshness(artifact, artifact.freshness / 2);
  const fee = wellKnown?.prices.trackerFeeMicroUsdc ?? null;
  const noWellKnown = "The registry's public configuration has not been read yet.";
  return (
    <div className="mt-3">
      <KV
        k="right now"
        v={fmtUsd(artifact.priceNow)}
        title="priceFloor + round(priceBase × freshness), on the registry's clock"
      />
      <KV
        k="after one more halving"
        v={<span className="text-ember">{fmtUsd(nextHalving)}</span>}
        title="floor + round(base × freshness ÷ 2). Exact, because that is the whole of the price rule."
      />
      <KV k="what the author asked" v={fmtUsd(artifact.priceBase)} />
      <KV
        k="never falls below"
        v={fmtUsd(artifact.priceFloor)}
        title="The floor must clear the registry's flat fee, or a sale could pay the author nothing."
      />
      <KV
        k="registry keeps"
        v={fee === null ? <NoData why={noWellKnown}>not read</NoData> : fmtUsd(fee)}
        title="Taken from every sale and never returned, because the search and the delivery happened."
      />
      <KV
        k="refund window"
        v={
          wellKnown === null ? (
            <NoData why={noWellKnown}>not read</NoData>
          ) : (
            fmtDuration(wellKnown.refundWindowSeconds)
          )
        }
      />
      <Caveat summary="Why later buyers pay less" className="mt-4">
        <p>Only decay, never a rebate to earlier buyers.</p>
        <p>
          The author produced this before any buyer existed, so there is no shared cost to split. The
          fortieth buyer pays less because the research is forty days older, which is a real
          difference in the thing being bought.
        </p>
      </Caveat>
    </div>
  );
}

/* ----------------------------------------------------------------- record */

function Record({ artifact, wellKnown }: { artifact: ArtifactState; wellKnown: WellKnown | null }) {
  const m = artifact.manifest;
  const author = parseAuthor(m.author);
  const ens = parseEnsAuthorString(m.author);
  const p = m.provenance;
  const status = artifactStatus(artifact);
  return (
    <div className="mt-3">
      <KV
        k="address"
        v={<span className="text-xs">{m.magnet}</span>}
        title="The magnet: sha256 over the signed manifest. The address IS the contents, so it cannot be swapped for something else."
      />
      <KV
        k="author"
        v={
          ens ? (
            <span className="text-xs">{ens.name}</span>
          ) : author.payoutAccount ? (
            <Out href={acctUrl(author.payoutAccount)}>{author.payoutAccount}</Out>
          ) : (
            <span className="text-xs">{shortId(m.author, 12, 8)}</span>
          )
        }
        title="manifest.author. The protocol treats it as opaque; this registry reads <account>:<publicKey> or ens:<name>:<fallbackAccount>:<publicKey>."
      />
      <KV k="body" v={`${fmtBytes(m.bodyBytes)}, sha256 ${shortId(m.bodyHash, 8, 6)}`} />
      <KV k="half-life" v={`${m.decay.halfLifeDays} ${m.decay.halfLifeDays === 1 ? "day" : "days"}`} />
      <KV k="produced" v={new Date(m.decay.producedAt).toLocaleString()} />
      <KV
        k="listing"
        title={STATUS_MEANING[status]}
        v={
          <span
            className={
              status === "live" ? "text-credit" : status === "withdrawn" ? "text-debit" : "text-ember"
            }
          >
            {status === "live" ? "on sale" : status}
            {artifact.delistedAt != null && (
              <span className="text-ink-soft"> {new Date(artifact.delistedAt * 1000).toLocaleString()}</span>
            )}
          </span>
        }
      />
      <KV
        k="timestamped on chain"
        title="anchoredAt on /state: when this manifest hash was included in a successful HCS anchor. The registry keeps no per-anchor record, so there is no sequence number and no consensus timestamp to show."
        v={
          artifact.anchoredAt == null ? (
            <NoData why="Not yet included in a successful anchor. An epoch with nothing new anchors nothing, so this stays empty until one runs that includes this hash.">
              not yet
            </NoData>
          ) : (
            <span>
              {new Date(artifact.anchoredAt * 1000).toLocaleString()}
              {wellKnown?.anchorTopic ? (
                <span className="text-ink-soft"> topic {wellKnown.anchorTopic}</span>
              ) : null}
            </span>
          )
        }
      />
      <KV k="redacted" v={m.redacted ? "yes" : "no"} />
      {ens ? <EnsAuthorRecord author={m.author} /> : null}

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h5 className="text-sm font-medium text-ink">What the author says it cost them</h5>
        <Mark
          kind="author-reported"
          note="Inside the signed manifest. The registry never verifies it; a buyer weighs it and can refund inside the window."
        />
      </div>
      <div className="mt-2">
        <KV k="model" v={p.model} />
        <KV k="tokens" v={`${fmtCount(p.inputTokens)} in, ${fmtCount(p.outputTokens)} out`} />
        <KV k="dollars" v={fmtUsdFloat(p.estimatedCostUsd, 4)} />
        <KV k="time" v={`${fmtCount(p.durationSeconds)}s, ${p.toolCalls} tool calls`} />
      </div>
    </div>
  );
}
