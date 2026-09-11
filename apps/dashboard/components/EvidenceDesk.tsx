/**
 * What reuse has, and has not, been shown to save.
 *
 * This is the screen most likely to be quoted out of context, so it is built to
 * be hard to misquote. Four rules:
 *
 * 1. **Every figure carries a provenance mark.** `live` came off this registry on
 *    the last read. `recorded` was measured once and is traceable to a file in
 *    this repository. `author-reported` was claimed by an author in a signed
 *    manifest and nobody audited it. `at stated rates` is a measured token count
 *    multiplied by a published price list.
 * 2. **Nothing is shown where nothing is known.** No panel falls back to a
 *    plausible-looking number. The two things the registry structurally cannot
 *    see, how many tokens a buyer's context absorbed and research redone
 *    elsewhere instead of bought here, say so in place of a value.
 * 3. **The caveats sit inside the columns they qualify.** The redo figure being a
 *    floor twice over, and the buy figure being one wire sample rather than a
 *    distribution, are printed under the numbers they are about. In a footer they
 *    would be true and unread.
 * 4. **The retraction stays on the page.** An earlier version of these figures
 *    was fabricated: unit-test fixtures transcribed into the documents as
 *    results. A reader cannot tell that from the numbers, so the correction is
 *    part of the screen rather than a footnote in a file nobody opens.
 */
"use client";

import type { RegistryState, WellKnown } from "../lib/api";
import { BUYER_TOKENS_UNOBSERVABLE, buildReuseTotals, claimedSavingUsd } from "../lib/economics";
import { fmtCount, fmtRatio, fmtUsd, fmtUsdFloat } from "../lib/format";
import {
  BUY,
  CORRECTION,
  LATENCY_CAVEAT,
  NOT_SHOWN,
  REDO,
  REDO_TOTAL_TOKENS,
  SOURCE_FILES,
  STATED_RATES,
  redoCostUsd,
} from "../lib/measured";
import { EVIDENCE_FILES, SETTLED, hashscanTopic, hashscanTx } from "../lib/evidence";
import { Band, Caveat, CornerMark, Disclosure, Figure, Mark, NoData, Out, Panel, Section, Term } from "./primitives";

export function EvidenceDesk({
  state,
  wellKnown,
}: {
  state: RegistryState;
  wellKnown: WellKnown | null;
}) {
  const totals = buildReuseTotals(state, {
    trackerFeeMicroUsdc: wellKnown?.prices.trackerFeeMicroUsdc ?? null,
  });
  const claimed = claimedSavingUsd(totals);
  const redoUsd = redoCostUsd();
  const buyUsd = BUY.paidMicroUsdc / 1e6;

  return (
    <div className="flex flex-col gap-24">
      <Section
        eyebrow="What we measured"
        title="The argument is not that research is cheap"
        deck={["The argument is not", "that research is cheap"]}
        node="24%"
        lede="It is that the same research is produced over and over by people who do not know about each other."
      >
        <Caveat summary="How to read every number here">
          <p>
            Each figure is read from this registry on the last poll, claimed by an author in a signed
            manifest, or measured once and recorded in this repository. Its stamp says which.
          </p>
          <p>Where the registry cannot see something, this page says so instead of estimating.</p>
        </Caveat>
      </Section>

      <Section
        eyebrow="This registry, now"
        title="What reuse has actually absorbed here"
        node="58%"
        right={<Mark kind="live" note="Read from the registry's own state on the last poll." />}
      >
        {totals.keptSales === 0 ? (
          <div>
            <p className="measure text-base text-ink-soft">
              Nothing has been bought here yet, so there is no reuse to total.
            </p>
            <p className="mt-3 text-sm text-ink-soft">
              {state.artifacts.length} artifact{state.artifacts.length === 1 ? "" : "s"} published,{" "}
              {state.purchases.length} purchase{state.purchases.length === 1 ? "" : "s"} recorded.
            </p>
            <Caveat summary="Why this is blank and not seeded" className="mt-4">
              <p>
                A demo figure here is the exact mistake this project has already made once and
                retracted. It fills in on the first real sale.
              </p>
            </Caveat>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-4">
              <Figure
                label="research not redone"
                kind="live"
                value={fmtCount(totals.keptSales)}
                sub={`across ${totals.artifactsSold} artifact${totals.artifactsSold === 1 ? "" : "s"}`}
                caveat={`Each is an agent that read someone else's work instead of producing it. ${totals.refundedSales} refunded sale${totals.refundedSales === 1 ? " is" : "s are"} excluded.`}
              />
              <Figure
                label="buyers paid"
                kind="live"
                value={fmtUsd(totals.paidUusdc, 4)}
                sub="gross over kept sales"
                caveat={
                  totals.netPaidUusdc === null
                    ? "The figure net of refunds needs the registry's flat fee, which has not been read yet."
                    : `${fmtUsd(totals.netPaidUusdc, 4)} net of refunds. A refund returns what was paid minus the flat fee, so a refunded sale still costs the buyer that fee.`
                }
              />
              <Figure
                label="claimed cost to produce"
                kind="author-reported"
                value={fmtUsdFloat(totals.authorClaimedUsd, 4)}
                note="Summed from each signed manifest's own cost claim, over the artifacts actually bought."
                sub="what the authors say it cost them"
                caveat="The registry does not verify it. A buyer weighs it before paying and can refund inside the window."
              />
              <Figure
                label="claimed tokens to produce"
                kind="author-reported"
                value={fmtCount(totals.authorClaimedTokens)}
                note="Input plus output tokens from each signed manifest, summed over kept sales."
                sub="input plus output only"
                caveat="The manifest has no cache buckets, which is where about 96% of a long agentic session's tokens actually go."
              />
            </div>

            {claimed && (
              <p className="hairline-t measure-wide mt-8 pt-6 text-base text-ink-soft">
                Against {fmtUsd(totals.paidUusdc, 4)} paid, that is{" "}
                <span className="tnum font-mono text-ink">{fmtUsdFloat(claimed.savedUsd, 4)}</span> of
                claimed production cost avoided
                {claimed.ratio !== null ? (
                  <>
                    , or <span className="tnum font-mono text-ink">{fmtRatio(claimed.ratio)}</span> on
                    author-reported dollars against money that actually moved
                  </>
                ) : null}
                .
              </p>
            )}
            {claimed && (
              <Caveat summary="Why the ratio is not the headline" className="mt-4">
                <p>
                  It divides two different kinds of number into each other, which is why both
                  operands are printed above it.
                </p>
              </Caveat>
            )}

            {totals.mostReused && (
              <p className="measure-wide mt-4 text-base text-ink-soft">
                Most reused: <span className="text-ink">{totals.mostReused.question}</span>,{" "}
                <span className="tnum font-mono text-ink">{totals.mostReused.sales}</span> sale
                {totals.mostReused.sales === 1 ? "" : "s"}.
              </p>
            )}

            {totals.salesUnmatched > 0 && (
              <p className="measure-wide mt-4 text-sm text-ink-soft">
                {totals.salesUnmatched} sale{totals.salesUnmatched === 1 ? "" : "s"} reference an
                artifact the registry no longer serves, so no production cost is attributed to{" "}
                {totals.salesUnmatched === 1 ? "it" : "them"}.
              </p>
            )}
          </>
        )}

        <div className="hairline-t mt-12 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 pt-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Unobservable
            label="tokens the buyers absorbed"
            why={BUYER_TOKENS_UNOBSERVABLE}
            body="Decided inside the buying agent."
            more="The fetch writes the body to a file rather than returning it, so the buyer chooses how much to read and the registry never learns."
          />
          <Unobservable
            label="duplicates not prevented"
            why="Nothing the registry serves observes research that was redone elsewhere instead of bought here. It sees purchases, not the duplicates it failed to prevent."
            body="The other half of the thesis."
            more="An earlier phase failed to establish it: 42% overlap against a 50% bar, with rater agreement too low to trust, and a verdict of stop."
          />
        </div>
      </Section>

      <Section
        eyebrow="One artifact, one question, once"
        title="The measured round trip"
        node="12%"
        right={<p className="text-sm text-ink-soft">2026-09-12</p>}
      >
        <p className="measure text-base text-ink-soft">
          One real comparison exists: this repository&rsquo;s own prize analysis, published and then
          bought back.
        </p>
        <Caveat summary="Where each side comes from" className="mt-3">
          <p>The redo side is read out of the producing session&rsquo;s own transcript.</p>
          <p>The buy side is a real publish, search, pay and verify round trip.</p>
        </Caveat>

        {/*
          The two sides are panels with DIFFERENT fills rather than two columns
          of prose. Two columns are the argument, and the earlier review found
          that below 768px they stacked into one undifferentiated run of figures
          with nothing marking the boundary. A `paper` panel against a `plate`
          one carries the split at every width, which is also the reference's own
          answer: separation by fill, not by a rule between columns.
        */}
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel tone="raised" className="px-5 py-5 sm:px-7 sm:py-6">
            <h3 className="hairline-b pb-3 text-xl font-medium text-ink">
              Doing it again
            </h3>
            <div className="mt-4">
              <Figure
                label="tokens"
                kind="recorded"
                note={`Summed per-turn usage over rows ${REDO.segment.fromRow} to ${REDO.segment.toRow} of the producing session's transcript. Source: ${SOURCE_FILES.redo}`}
                value={fmtCount(REDO_TOTAL_TOKENS)}
                sub={`${fmtCount(REDO.inputTokens)} in, ${fmtCount(REDO.outputTokens)} out`}
                caveat={`Plus ${fmtCount(REDO.cacheWriteTokens)} cache write and ${fmtCount(REDO.cacheReadTokens)} cache read. Cache traffic is 96% of it: counting only input plus output understates the segment twenty-eight-fold.`}
              />
              <Figure
                label="dollars"
                kind="stated-rates"
                note={`Those tokens at $${STATED_RATES.input} / $${STATED_RATES.output} / $${STATED_RATES.cacheWrite} / $${STATED_RATES.cacheRead} per million. Source: ${SOURCE_FILES.rates}`}
                value={fmtUsdFloat(redoUsd)}
                sub="measured tokens at a price list"
                caveat="The session actually ran on the long-context tier, billed roughly 1.19 times these rates, so this is the floor's floor."
              />
              <Figure
                label="model time"
                kind="recorded"
                note="Row timestamps in the same segment. Active means gaps of 120 seconds or less."
                value={`${REDO.activeSeconds.toFixed(1)}s`}
                sub={`${REDO.toolCalls} tool calls, ${REDO.sources} sources`}
                caveat={`${fmtCount(REDO.elapsedSeconds)}s elapsed including the human. Active means gaps of 120 seconds or less.`}
              />
            </div>
            <Caveat summary="A floor, twice over" className="mt-6">
              <p>
                {REDO.subagentCalls} subagent dispatches spent tokens in transcripts that were not
                retained, and the same span also produced {REDO.alsoProduced.join(" and ")}.
              </p>
              <p>
                So somebody redoing only the document would spend less than this, and the real
                production cost was higher.
              </p>
            </Caveat>
          </Panel>

          <Panel tone="inset" className="px-5 py-5 sm:px-7 sm:py-6">
            <h3 className="hairline-b pb-3 text-xl font-medium text-ink">Buying it</h3>
            <div className="mt-4">
              <Figure
                label="price charged"
                kind="recorded"
                note={`What the price rule quoted and the payment gate took. Source: ${SOURCE_FILES.buy}`}
                value={fmtUsdFloat(buyUsd)}
                sub={`${fmtCount(BUY.paidMicroUsdc)} µUSDC exactly`}
                caveat={`Four decimal places of dollars hide a 50 µUSDC range, and that is where the price rule's rounding lives. The asking price was ${fmtCount(BUY.priceBaseMicroUsdc)} µUSDC with a floor of ${fmtCount(BUY.priceFloorMicroUsdc)}: 10% of the measured redo floor, which is a judgement call and not a discovery. Set it to 15% and the multiple falls to 6.1 times.`}
              />
              <Figure
                label="tokens into the buyer's context"
                kind="recorded"
                note={`Counted over what the fetch tool actually returns. Source: ${SOURCE_FILES.doc}`}
                value={fmtCount(BUY.tokensForSummary)}
                sub={`${fmtCount(BUY.tokensIfFullyRead)} if it reads the whole file`}
                caveat={`The file is ${fmtCount(BUY.bodyBytes)} bytes. That gap is exactly why the fetch writes a file instead of returning the body inline.`}
              />
              <Figure
                label="contents checked"
                kind="recorded"
                value={BUY.integrity}
                note="The delivered body was compared against the hash the buyer already held, from the free manifest rather than from the paid response."
                sub="against the hash from the free manifest"
                caveat="A buyer that takes the hash out of the paid response has no integrity check at all: it comes from the same server as the bytes."
              />
            </div>
            <Caveat summary="A wire measurement, not a total" className="mt-6">
              <p>{LATENCY_CAVEAT}</p>
            </Caveat>
          </Panel>
        </div>

        <div className="hairline-t mt-12 pt-8">
          <p className="measure-wide text-lg text-ink">
            {fmtCount(REDO_TOTAL_TOKENS)} tokens became {fmtCount(BUY.tokensForSummary)}, and{" "}
            {fmtUsdFloat(redoUsd)} became {fmtUsdFloat(buyUsd)}: {fmtRatio(redoUsd / buyUsd)} on cost,
            on a floor against an actual.
          </p>
          <Caveat summary="How to read that pair" className="mt-4">
            <p>
              The token row is the hard one to argue with: the buyer&rsquo;s context absorbs a
              four-line receipt instead of two million tokens of cache traffic.
            </p>
            <p>
              The dollar ratio is smaller because cache reads are cheap and most of the tokens are
              cache reads.
            </p>
            <p>No wall-clock ratio is claimed anywhere on this site.</p>
          </Caveat>
        </div>
      </Section>

      <Section
        eyebrow="On a public ledger"
        title="The one run where the money actually moved"
        node="45%"
        lede="The only end-to-end proof this project has, and it is one sale."
      >
        {/*
          The one solid dark mass on this desk, and it is here rather than
          anywhere else for the reason `PRODUCT.md` gives: the money is the proof.
          Only `paper` and `ink-lift` carry type on it, both measured on `ink` in
          `lib/tokens.test.ts`.
        */}
        <Panel tone="dark" className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-7">
          <CornerMark kind="plus" className="absolute right-4 top-4 fill-ink-lift" />
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <dt className="label text-2xs text-ink-lift">the buyer paid</dt>
              <dd className="tnum mt-2 font-mono text-2xl text-paper">
                {fmtUsd(SETTLED.paidMicroUsdc, 4)}
              </dd>
              <dd className="mt-3 min-w-0 break-words font-mono text-xs [overflow-wrap:anywhere] sm:text-sm">
                <Out
                  href={hashscanTx(SETTLED.purchaseTxId)}
                  className="focus-light !text-paper !decoration-ink-lift hover:!decoration-paper"
                >
                  {SETTLED.purchaseTxId}
                </Out>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="label text-2xs text-ink-lift">the author received</dt>
              <dd className="tnum mt-2 font-mono text-2xl text-paper">
                {fmtUsd(SETTLED.authorPaidMicroUsdc, 4)}
              </dd>
              <dd className="mt-3 min-w-0 break-words font-mono text-xs [overflow-wrap:anywhere] sm:text-sm">
                <Out
                  href={hashscanTx(SETTLED.settlementTxId)}
                  className="focus-light !text-paper !decoration-ink-lift hover:!decoration-paper"
                >
                  {SETTLED.settlementTxId}
                </Out>
              </dd>
            </div>
          </dl>
        </Panel>
        <p className="measure-wide mt-8 text-base text-ink-soft">
          The difference, {fmtUsd(SETTLED.trackerFeeMicroUsdc, 4)}, is the registry&rsquo;s flat fee.
        </p>
        <Caveat summary="How this is checked" className="mt-4">
          <p>
            The epoch was{" "}
            <Term
              word="anchored"
              means="The epoch's Merkle root was submitted to a Hedera Consensus Service topic, so the set of artifacts and payouts it covered is timestamped by the network."
            />{" "}
            to topic{" "}
            <Out href={hashscanTopic(SETTLED.anchorTopic)} className="font-mono">
              {SETTLED.anchorTopic}
            </Out>
            , message {SETTLED.anchorSeq}.
          </p>
          <p>
            Every figure here is re-derived from the mirror node by a standard-library verifier in{" "}
            <code className="font-mono text-ink">
              {EVIDENCE_FILES.dir}
              {EVIDENCE_FILES.verifier}
            </code>
            , which imports nothing from this repository, so a bug in the production tree cannot make
            the evidence verify against itself.
          </p>
        </Caveat>
      </Section>

      <Section
        eyebrow="Correction"
        title="The previous version of these figures was fabricated"
        node="70%"
      >
        <Band tone="debit" className="px-6 py-6">
          <p className="measure text-base text-ink">
            The table used to read{" "}
            <span className="font-mono text-sm text-debit">{CORRECTION.fabricated}</span>.
          </p>
          <p className="measure mt-3 text-base text-ink-soft">
            None of it came from a run. This notice is permanent.
          </p>
          <Disclosure summary="Both corrections, in full" className="mt-5">
            <div className="measure space-y-3 text-sm text-ink-soft">
              <p>{CORRECTION.what}</p>
              <p>{CORRECTION.checkable}</p>
              <p>{CORRECTION.guard}</p>
            </div>
          </Disclosure>
        </Band>
        <p className="measure mt-6 text-sm text-ink-soft">
          It is why every number here carries a mark, and why an empty panel stays empty.
        </p>
      </Section>

      <Section eyebrow="Limits" title="What none of this shows" node="33%">
        <p className="measure text-base text-ink-soft">
          {NOT_SHOWN.length} limits, none of them shortened.
        </p>
        <Disclosure summary={`Read all ${NOT_SHOWN.length}`} className="mt-5">
          <ul className="max-w-[80ch]">
            {NOT_SHOWN.map((line) => (
              <li key={line} className="hairline-b py-4 text-sm text-ink-soft last:shadow-none">
                {line}
              </li>
            ))}
          </ul>
        </Disclosure>
        <p className="measure mt-6 text-sm text-ink-soft">
          Full write-up: <code className="font-mono text-ink">{SOURCE_FILES.doc}</code>. Figures:{" "}
          <code className="font-mono text-ink">{SOURCE_FILES.redo}</code> and{" "}
          <code className="font-mono text-ink">{SOURCE_FILES.buy}</code>.
        </p>
      </Section>
    </div>
  );
}

function Unobservable({
  label,
  why,
  body,
  more,
}: {
  label: string;
  why: string;
  body: React.ReactNode;
  /** The rest of the reason, one action away rather than inline. */
  more: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-soft">{label}</span>
        <Mark kind="unobservable" note={why} />
      </div>
      <p className="mt-1 text-xl">
        <NoData why={why}>no source</NoData>
      </p>
      <p className="measure mt-2 text-base text-ink-soft">{body}</p>
      <Caveat summary="Why not" className="mt-3">
        <p>{more}</p>
        <p>{why}</p>
      </Caveat>
    </div>
  );
}
