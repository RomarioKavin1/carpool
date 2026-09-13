/**
 * `/` — the explainer. Five pictures and about four hundred words.
 *
 * ## Why this route exists at all
 *
 * The page this replaces explained the mechanism in paragraphs: a claim, a
 * two-column money comparison, three numbered steps, each of them several
 * sentences long. It was accurate and nobody read it. `PRODUCT.md`'s primary
 * user is a judge with thirty seconds and forty projects left, and thirty seconds
 * buys about sixty words of reading or five drawings.
 *
 * So the explanation is drawn. Text drops hard: one heading and one line per
 * beat, plus the numbers, plus what the numbers do not show. Everything that was
 * a paragraph is a shape moving, and everything that was a table is at `/app`.
 *
 * ## And then it dropped again
 *
 * That version still rendered 1,108 words, because the drawings carried the
 * explanation and the prose narrated them as well, so the page said everything
 * twice and the reader read neither. Two rules now hold, both enforced by
 * `lib/prose-budget.test.tsx`:
 *
 * - **The drawing is not narrated.** A line that describes what a shape is doing
 *   is deleted; a line that says something the shape cannot stays.
 * - **Every caveat is a `Caveat`**, which is a native `<details>` with a visible
 *   chip. The qualifications are unchanged and complete, one click away, and a
 *   floor in that test stops a later pass from cutting them to hit the budget.
 *
 * 349 visible words after the pass, longest paragraph 15, 264 words of caveat
 * behind six disclosures. The take-part section added 40 more, all labels, with
 * the install command in a `<pre>` the budget does not count as prose. One filled
 * control above the fold, and it goes to that section.
 *
 * ## Art direction
 *
 * The lane is unchanged and the composition is new.
 *
 * **The lane: a cyanotype plate, printed light.** Anna Atkins' photograms are the
 * reference for the DRAWINGS: one committed hue over the whole field, line work
 * rather than imagery, and the drawing IS the content. Hue 195, the same hue
 * every neutral in the palette is tinted toward. Four roles, each used for
 * exactly one thing: `field`/`plate` carry the ground, `trace` is an agent doing
 * work, `ember` is decay and still nothing else, `credit` is money moving.
 *
 * **The composition comes from the site the user named.** Six things, all of them
 * structural rather than chromatic:
 *
 * 1. Huge uppercase display type, staggered line by line, with the last line
 *    dropped to a lighter value so the phrase reads in two weights.
 * 2. Very tight negative tracking, which is that page's single most transferable
 *    property (-0.07em at display sizes, measured).
 * 3. Crosshair rules: a vertical hairline and a horizontal one meeting at a small
 *    solid square, both running past the content they bound.
 * 4. Rounded 12–14px panels, with no border and no shadow.
 * 5. Asymmetric splits: type on one side, a large panel on the other, never a
 *    symmetric grid.
 * 6. Particle fields of small squares as section transitions, and small corner
 *    markers (a triangle, a plus, a caret).
 *
 * What it deliberately is NOT, and each of these was a live option: that page's
 * warm bone ground (the cyan field is the approved theme and two grounds cannot
 * both be the ground), its coral accent (`ember` is decay and nothing else, so a
 * second warm hue would break the one rule this palette is built on), its type,
 * its imagery, and its copy. Also still refused: neon on black, terminal-native
 * dark, the editorial-typographic lane, a hero metric, and a grid of identical
 * cards.
 *
 * ## Numbers
 *
 * Every figure on this page comes out of `lib/measured.ts` or `lib/evidence.ts`,
 * both of which are checked against machine-written records on disk by their own
 * tests, and every one of them keeps the provenance stamp it carries in the app.
 * Nothing here is rounded into a prettier number: the pair is $3.97 against
 * $0.4367, one a floor computed at a published price list and the other what the
 * payment gate actually took, and saying which is which is the point.
 */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { priceAtFreshness } from "../lib/decay";
import { EVIDENCE_FILES, SETTLED, SETTLED_LIMITS, hashscanAccount, hashscanTx } from "../lib/evidence";
import { fmtCount, fmtUsd, fmtUsdFloat } from "../lib/format";
import { BUY, NOT_SHOWN, REDO, REDO_TOTAL_TOKENS, SOURCE_FILES, redoCostUsd } from "../lib/measured";
import { Caveat, CornerMark, CrossRule, Disclosure, Mark, Out, Panel, Particles } from "./primitives";
import { Command } from "./JoinDesk";
import { AgentMark, DecayArt, LaneTrack, PublishArt, Result, ReuseArt, SettlementArt } from "./explainer-art";

/**
 * The five beats, in order. `station` is the spine's name for it; `title` is the
 * staggered display headline, authored as the lines it breaks into rather than
 * left to the browser, because where a line breaks IS the composition here.
 */
const BEATS = [
  {
    id: "waste",
    station: "the waste",
    title: ["Six agents grind", "the same question"],
    lead: "None of them knows the others exist.",
    node: "14%",
  },
  {
    id: "address",
    station: "the address",
    title: ["One of them", "publishes"],
    lead: "The address is the hash of the bytes. Nobody can swap what it points at.",
    node: "58%",
  },
  {
    id: "reuse",
    station: "the reuse",
    title: ["The other five", "ask first"],
    lead: "They find it, pay, and skip the work.",
    node: "31%",
  },
  {
    id: "decay",
    station: "the decay",
    title: ["Then it goes stale", "on a clock"],
    lead: "The price halves on the half-life its author chose. Three halvings and it stops selling.",
    node: "67%",
  },
  {
    id: "payout",
    station: "the payout",
    title: ["The money reaches", "the author"],
    lead: "Not a credit in a table. A transfer on a public ledger, with a receipt.",
    node: "22%",
  },
] as const;

/** How many agents beat 1 draws. An illustration, and said to be one on the page. */
const LANES = 6;

/**
 * The registry the landing's install command points at. Written out rather than
 * read from `REGISTRY_URL`, because that one is whatever this dashboard was built
 * against (localhost in development and in tests), and a command a stranger
 * copies off the public page has to reach the running registry.
 */
const PRODUCTION_REGISTRY_URL = "https://carpool-registry-production.up.railway.app";

/** The published npm package: nothing to clone or build. */
const INSTALL_COMMAND =
  "claude mcp add carpool \\\n" +
  `  -e CARPOOL_REGISTRY_URL=${PRODUCTION_REGISTRY_URL} \\\n` +
  "  -- npx -y carpool-mcp";

/** Step 03's commands: associate, then the author variables added to the install above. */
/** Step 02's commands: associate USDC, then the buyer variables added to the install above. */
const BUYER_COMMAND =
  "HEDERA_ACCOUNT_ID=0.0.x HEDERA_PRIVATE_KEY=<hex key> \\\n" +
  "  npx carpool-mcp associate\n\n" +
  "# add to claude mcp add, before --\n" +
  "  -e CARPOOL_BUYER_ACCOUNT_ID=0.0.x \\\n" +
  "  -e CARPOOL_BUYER_PRIVATE_KEY=<hex key> \\";

const AUTHOR_COMMAND =
  "# same account works; add before --\n" +
  "  -e CARPOOL_AUTHOR_ACCOUNT_ID=0.0.x \\\n" +
  "  -e CARPOOL_AUTHOR_PRIVATE_KEY=<hex key> \\";

const EVIDENCE_NOTE = `Source: ${EVIDENCE_FILES.dir}, re-checked against the mirror node by ${EVIDENCE_FILES.verifier}.`;

export function Explainer() {
  const { register, active } = useBeatObserver();
  const redoUsd = redoCostUsd();

  return (
    <div className="snap-page min-h-screen bg-field text-ink">
      {/* The opening fold: masthead and hero share one screen, so the first
          thing a reader sees is a whole composition rather than part of one. */}
      <div className="snap-section flex min-h-[100svh] flex-col">
        <Masthead />
        <Hero />
      </div>

      {/* The narrative. `narrative` also names the view timeline the spine's fill
          runs on, which is the one scroll-position-driven thing here and costs no
          JavaScript at all. */}
      <div className="narrative mx-auto w-full max-w-[1320px] px-5 pb-8 sm:px-8">
        <div className="lg:grid lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-12">
          <Spine active={active} />

          <div className="min-w-0">
            {/* ---------------------------------------------------- beat 1 */}
            <Beat n={0} register={register}>
              <Panel tone="raised" className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
                <CornerMark kind="caret" className="absolute right-4 top-4" />
                <ol>
                  {[...Array(LANES)].map((_, k) => (
                    <li
                      key={k}
                      className="hairline-b grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-3.5 last:shadow-none sm:gap-x-5"
                    >
                      <AgentMark i={k * 0.3} />
                      <LaneTrack i={k * 0.3} />
                      <Result i={LANES * 0.3 + k * 0.3} />
                      <span className="tnum font-mono text-2xs text-ink-soft sm:text-xs">
                        {fmtUsdFloat(redoUsd, 2)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>

              <Readout>
                <Fig
                  value={fmtUsdFloat(redoUsd, 2)}
                  unit="to answer it once"
                  kind="stated-rates"
                  note={`${fmtCount(REDO_TOTAL_TOKENS)} measured tokens at a published price list. Source: ${SOURCE_FILES.redo}`}
                />
                <Fig
                  value={`${REDO.activeSeconds.toFixed(1)} s`}
                  unit="of model time"
                  kind="recorded"
                  note={`Read out of the producing session's own transcript. Source: ${SOURCE_FILES.redo}`}
                />
              </Readout>
              <Caveat className="mt-7">
                <p>
                  Both figures are floors. Four subagent transcripts were not retained, and the dollars price measured
                  tokens below the tier actually billed.
                </p>
                <p>Six lanes is an illustration, not a count.</p>
                <p>{NOT_SHOWN[6]}</p>
              </Caveat>
            </Beat>

            {/* ---------------------------------------------------- beat 2 */}
            <Beat n={1} register={register}>
              <Plate>
                <PublishArt />
              </Plate>
              <p className="mt-6 break-words font-mono text-xs text-ink [overflow-wrap:anywhere] sm:text-sm">
                {SETTLED.magnet}
              </p>
              <p className="mt-6 max-w-[68ch] text-sm text-ink-soft">
                Question, abstract and sources are free. Only the body costs money.
              </p>
            </Beat>

            {/* ---------------------------------------------------- beat 3 */}
            <Beat n={2} register={register}>
              <Plate>
                <ReuseArt />
              </Plate>

              <Readout>
                <Fig
                  value={fmtUsdFloat(redoUsd, 2)}
                  unit="to redo it"
                  kind="stated-rates"
                  note={`A floor twice over. Source: ${SOURCE_FILES.redo}`}
                />
                <Fig
                  value={fmtUsd(BUY.paidMicroUsdc, 4)}
                  unit="to buy it"
                  kind="recorded"
                  note={`What the x402 gate actually charged, on the wire: ${BUY.paidMicroUsdc} µUSDC. Source: ${SOURCE_FILES.buy}`}
                  tone="text-credit"
                />
                <Fig
                  value={String(BUY.tokensForSummary)}
                  unit="tokens into the buyer's context"
                  kind="recorded"
                  note={`The fetch writes the artifact to a file and returns a four-line receipt. Source: ${SOURCE_FILES.buy}`}
                />
                <Fig
                  value={`${BUY.fetchSeconds.toFixed(2)} s`}
                  unit="on the wire"
                  kind="recorded"
                  note={`One sample on one network path, and it moves on every run. The full caveat, including the range across the other purchases in that session, is on the measurement page. Source: ${SOURCE_FILES.buy}`}
                />
              </Readout>
              <Caveat className="mt-7">
                <p>
                  Two kinds of number, printed together on purpose. One is a floor from a price list; the other is what
                  the gate took from a real account.
                </p>
                <p>
                  This repository claims no wall-clock ratio. The listed price was a judgement call at a tenth of the
                  measured redo floor.
                </p>
              </Caveat>
            </Beat>

            {/*
              The one particle field set in `ember` rather than `trace`, and the
              only reason it is allowed to be amber is that here the particles ARE
              decay: it opens the beat where the price starts falling. Everywhere
              else on both routes the field is `trace`.
            */}
            {/* ---------------------------------------------------- beat 4 */}
            <Beat
              n={3}
              register={register}
              prelude={
                <div aria-hidden="true" className="relative mb-8 h-16 sm:h-20">
                  <Particles tone="ember" count={26} className="opacity-70" />
                </div>
              }
            >
              <Plate>
                <DecayArt />
                {/* The axis, in the app's own terms: linear in freshness, so each
                    gap is one halving and each is half the width of the last. */}
                <div aria-hidden="true" className="relative mt-2 h-4 select-none font-mono text-2xs text-ink-soft">
                  {/* Below 640px the ⅛ mark lands 43px in and this word is 38px
                      wide, so the two collide exactly where the bar is most
                      interesting. The ladder underneath names both ends anyway. */}
                  <span className="absolute left-0 hidden sm:inline">gone</span>
                  {[
                    [0.5, "½"],
                    [0.25, "¼"],
                    [0.125, "⅛"],
                  ].map(([at, glyph]) => (
                    <span
                      key={String(at)}
                      className="absolute -translate-x-1/2"
                      style={{ left: `${(at as number) * 100}%` }}
                    >
                      {glyph}
                    </span>
                  ))}
                  <span className="absolute right-0">new</span>
                </div>
              </Plate>

              <PriceLadder />
              <p className="mt-7 max-w-[68ch] text-sm text-ink-soft">Hatched below an eighth is expired.</p>
              <Caveat summary="Why a day" className="mt-4">
                <p>The hatching is drawn from the day an artifact is published, not from the day it dies.</p>
                <p>
                  Research goes stale. A free substitute usually turns up within about half a day, which is why
                  half-lives default to one.
                </p>
              </Caveat>
            </Beat>

            {/* ---------------------------------------------------- beat 5 */}
            <Beat n={4} register={register}>
              <Plate>
                <SettlementArt />
                <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-2xs text-ink-soft sm:text-xs">
                  <span>buyer</span>
                  <span className="text-center">registry, 120 s hold</span>
                  <span className="text-right">author</span>
                </div>
              </Plate>

              <Readout>
                <Fig
                  value={fmtUsd(SETTLED.paidMicroUsdc, 4)}
                  unit="paid at the gate"
                  kind="recorded"
                  note={EVIDENCE_NOTE}
                />
                <Fig
                  value={fmtUsd(SETTLED.trackerFeeMicroUsdc, 4)}
                  unit="kept by the registry"
                  kind="recorded"
                  note={`The flat search-and-delivery fee, taken at the sale and never refunded. ${EVIDENCE_NOTE}`}
                />
                <Fig
                  value={fmtUsd(SETTLED.authorPaidMicroUsdc, 4)}
                  unit="reached the author"
                  kind="recorded"
                  note={EVIDENCE_NOTE}
                  tone="text-credit"
                />
              </Readout>

              {/*
                The receipts, on the one solid dark mass in the narrative. This is
                the page's strongest fact (`PRODUCT.md`: "the money is the proof")
                and the material says so: everything else here is drawn on light
                plates, and this is the thing that actually happened.
              */}
              <Panel tone="dark" className="relative mt-9 overflow-hidden px-5 py-6 sm:px-8 sm:py-7">
                <CornerMark kind="plus" className="absolute right-4 top-4 fill-ink-lift" />
                <p className="label text-2xs text-ink-lift">On Hedera testnet, {SETTLED.date}</p>
                <dl className="mt-5">
                  <DarkRow k="settlement transfer">
                    <Out
                      href={hashscanTx(SETTLED.settlementTxId)}
                      className="focus-light !text-paper !decoration-ink-lift hover:!decoration-paper"
                    >
                      {SETTLED.settlementTxId}
                    </Out>
                  </DarkRow>
                  <DarkRow k="x402 purchase">
                    <Out
                      href={hashscanTx(SETTLED.purchaseTxId)}
                      className="focus-light !text-paper !decoration-ink-lift hover:!decoration-paper"
                    >
                      {SETTLED.purchaseTxId}
                    </Out>
                  </DarkRow>
                  <DarkRow k="author's account">
                    <Out
                      href={hashscanAccount(SETTLED.author)}
                      className="focus-light !text-paper !decoration-ink-lift hover:!decoration-paper"
                    >
                      {SETTLED.author}
                    </Out>
                  </DarkRow>
                </dl>
              </Panel>

              <p className="mt-7 max-w-[68ch] text-sm text-ink-soft">
                Both are <span className="text-ink">SUCCESS</span> on the mirror node.
              </p>
              <Caveat summary="Why two transactions" className="mt-4">
                <p>The registry holds the buyer&rsquo;s payment for two minutes so a refund can still reverse it.</p>
                <p>Paying the author is therefore a second transaction, not part of the first.</p>
              </Caveat>
            </Beat>
          </div>
        </div>
      </div>

      <GetCarpool register={register} />
      <Limits register={register} />
      <CallToApp register={register} />
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function Masthead() {
  return (
    <header className="hero-in mx-auto w-full max-w-[1320px] px-5 pt-5 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-2xl font-bold leading-none tracking-[-0.06em] text-ink sm:text-3xl">carpool</p>
        {/*
          A real button, but the SECONDARY one: a paper pill rather than ink. The
          hero holds the one filled ink control on this page; two ink pills
          saying the same thing, 160px apart, is two primary actions and
          therefore none.
        */}
        {/* One dark pill and one light: taking part is the newcomer's action, the
            registry is the one a returning reader wants. */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/app"
            className="pill-motion inline-flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 text-sm font-medium text-ink hover:bg-plate"
          >
            Live registry <span aria-hidden="true">&rarr;</span>
          </Link>
          <a
            href="#get"
            className="pill-motion inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-wire"
          >
            Get Carpool
          </a>
        </div>
      </div>
    </header>
  );
}

/**
 * The opening. One claim, three staggered lines, and a great deal of air.
 *
 * Tall on purpose, twice over: the reference gives one idea a whole viewport and
 * nothing else, and this beat has to push beat 1 below the fold, because a beat
 * that is already on screen when the observer wires up is left in its finished
 * state rather than being snapped back to frame one and replayed. Nothing on this
 * page is ever allowed to flash from complete to empty.
 *
 * The vertical rule dropping out of the bottom of the headline is the reference's
 * own move: a hairline from the chrome running down into the page, ending on a
 * solid node, marking where the reading starts.
 */
function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col justify-center px-5 pb-12 pt-12 sm:px-8 sm:pb-16 sm:pt-16">
      <h1 className="text-hero font-semibold uppercase text-ink">
        <span className="hero-in block" style={{ "--i": 1 } as CSSProperties}>
          Research
        </span>
        <span className="hero-in block pl-[4%] sm:pl-[9%]" style={{ "--i": 2 } as CSSProperties}>
          nobody should
        </span>
        <span className="hero-in block pl-[8%] text-ink-faint sm:pl-[18%]" style={{ "--i": 3 } as CSSProperties}>
          do twice
        </span>
      </h1>

      {/*
        One filled action above the fold, "Get Carpool", and the registry beside
        it as the light secondary pill. The second pill that used to sit beside it said "How it
        works" and pointed at the section directly below, which is a button for
        scrolling: it cost a first-time reader a decision and bought nothing.
      */}
      <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <p
          data-lede=""
          className="hero-in max-w-[54ch] text-beat-lead text-ink-soft"
          style={{ "--i": 4 } as CSSProperties}
        >
          An agent buys the research instead of redoing it, and the author gets paid.
        </p>
        <div className="hero-in flex flex-wrap items-start gap-3 lg:justify-end" style={{ "--i": 5 } as CSSProperties}>
          {/* `#get` scrolls smoothly through the page's own `scroll-behavior`,
              which reduced motion already turns off. */}
          <a
            href="#get"
            className="pill-motion inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-lg font-medium text-paper hover:bg-wire"
          >
            Get Carpool
            <span aria-hidden="true">&darr;</span>
          </a>
          <Link
            href="/app"
            className="pill-motion inline-flex items-center gap-2 rounded-full bg-paper px-7 py-3.5 text-lg font-medium text-ink hover:bg-plate"
          >
            Open the live registry
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="hero-in relative mt-10 h-16 sm:mt-12 sm:h-20"
        style={{ "--i": 6 } as CSSProperties}
      >
        <span className="absolute left-[6%] top-0 block h-full w-px bg-plate-line" />
        <span className="node absolute bottom-0 left-[6%] -translate-x-[2.5px]" />
        <Particles count={18} className="opacity-60" />
      </div>
    </section>
  );
}

/**
 * The spine. Five stations, and a fill that tracks scroll position through a
 * view timeline rather than a scroll listener: no rAF loop, no per-frame DOM
 * write, and it is gone entirely under `prefers-reduced-motion: reduce`.
 *
 * The active station is the observer's, not the timeline's, because it is state
 * and not motion: it says which beat you are reading, and that is as useful to a
 * reader who has asked for no animation as to anyone else. It is marked with a
 * solid square rather than only a colour change, which is the same node the
 * crosshairs use and the same rule the rest of this build follows: never hue
 * alone.
 */
function Spine({ active }: { active: number }) {
  return (
    <nav aria-label="The five steps" className="sticky top-0 hidden h-fit pt-24 lg:block">
      <ol className="relative pl-5">
        <span aria-hidden="true" className="absolute left-0 top-1.5 block h-[calc(100%-0.75rem)] w-px bg-plate-line">
          <span className="spine-fill block h-full w-px bg-trace" />
        </span>
        {BEATS.map((b, i) => (
          <li key={b.id} className="relative py-2.5">
            {active === i && (
              /* The `ol` carries `pl-5`, so the spine's own hairline is 20px to
                 the left of this `li`'s content box. -22.5px centres the 6px node
                 on it. */
              <span aria-hidden="true" className="node absolute -left-[22.5px] top-[13px]" />
            )}
            <a
              href={`#${b.id}`}
              aria-current={active === i ? "true" : undefined}
              className={`block rounded-xs text-2xs leading-[15px] transition-colors duration-150 ease-out hover:text-ink ${
                active === i ? "text-ink" : "text-ink-faint"
              }`}
            >
              <span className="tnum font-mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="label block pt-1">{b.station}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------- beats */

/**
 * One fold, one idea.
 *
 * The header is an asymmetric split: the staggered display headline on the left,
 * the one line of lead sitting under it on the right and aligned to the baseline
 * of the block rather than to its top. That offset is the composition — a
 * symmetric two-column header would be the thing the reference is not.
 *
 * The lead is one line by rule: if it needs two, the drawing is not doing its
 * job.
 */
function Beat({
  n,
  register,
  prelude,
  children,
}: {
  n: number;
  register: (el: HTMLElement | null) => void;
  prelude?: ReactNode;
  children: ReactNode;
}) {
  const beat = BEATS[n]!;
  return (
    <section
      id={beat.id}
      ref={register}
      data-beat={n}
      className="beat snap-section flex min-h-[100svh] scroll-mt-6 flex-col justify-center py-12 sm:py-16"
    >
      {prelude}
      <CrossRule at={beat.node} className="beat-fx fx-wipe mb-12" />

      <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <div className="beat-fx fx-rise min-w-0">
          <p className="label mb-5 text-2xs text-ink-faint">
            <span className="tnum font-mono">{String(n + 1).padStart(2, "0")}</span>{" "}
            <span className="pl-2">{beat.station}</span>
          </p>
          <h2 className="text-beat font-semibold uppercase text-ink">
            <span className="block">{beat.title[0]}</span>
            <span className="block pl-[5%] text-ink-faint sm:pl-[11%]">{beat.title[1]}</span>
          </h2>
        </div>
        <p
          data-lede=""
          className="beat-fx fx-rise max-w-[46ch] text-base text-ink-soft lg:pb-2"
          style={{ "--i": 1 } as CSSProperties}
        >
          {beat.lead}
        </p>
      </div>

      <div className="mt-12">{children}</div>
    </section>
  );
}

/**
 * The ground a drawing sits on. A rounded panel now rather than a bordered
 * rectangle, on `plate` with the graph-paper grid still in it — the drawing is
 * still a cyanotype, it is just held in the reference's material.
 */
function Plate({ children }: { children: ReactNode }) {
  return (
    <Panel tone="inset" className="blueprint relative overflow-hidden p-5 sm:p-8">
      <CornerMark kind="triangle" className="absolute bottom-3 left-3" />
      {children}
    </Panel>
  );
}

/** Figures, in a row that wraps. Not a card grid: no boxes, one hairline each. */
function Readout({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-9 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
      {children}
    </dl>
  );
}

function Fig({
  value,
  unit,
  kind,
  note,
  tone = "text-ink",
}: {
  value: string;
  unit: string;
  kind: "recorded" | "stated-rates";
  note: string;
  tone?: string;
}) {
  return (
    <div className="hairline-t min-w-0 pt-4">
      <dt className="flex items-baseline justify-between gap-3">
        <span className="label text-2xs text-ink-faint">{unit}</span>
        <Mark kind={kind} note={note} />
      </dt>
      <dd className={`tnum mt-2 font-mono text-lg ${tone}`}>{value}</dd>
    </div>
  );
}

/** One receipt, on the dark panel. `ink-lift` label, `paper` value. */
function DarkRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="hairline-b-field flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 last:shadow-none">
      <dt className="shrink-0 text-sm text-ink-lift">{k}</dt>
      <dd className="min-w-0 break-words font-mono text-xs text-paper [overflow-wrap:anywhere] sm:text-sm">
        {children}
      </dd>
    </div>
  );
}

/**
 * The four prices, one per halving, from the price rule the registry ships:
 * `priceFloor + round(priceBase × freshness)`. The inputs are the listed base and
 * floor of the artifact that actually sold, so the first row is the charge the
 * gate took and the other three are what it would have taken later.
 *
 * This is a ladder rather than four labels pinned to the bar above it because at
 * 360px the ⅛ and ¼ labels are 41px apart and a price is 56px wide. Positioned
 * labels would collide exactly where the decay is most interesting.
 */
function PriceLadder() {
  const a = {
    priceBase: BUY.priceBaseMicroUsdc,
    priceFloor: BUY.priceFloorMicroUsdc,
  };
  const rows = [
    { f: 1, when: "published", i: 0 },
    { f: 0.5, when: "one half-life later", i: 10 },
    { f: 0.25, when: "two half-lives", i: 19 },
    { f: 0.125, when: "three halvings", i: 28 },
  ];
  return (
    <dl className="mt-8">
      {rows.map((r) => (
        <div
          key={r.f}
          className="beat-fx fx-rise hairline-b flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
          style={{ "--i": r.i, "--dur": "600ms" } as CSSProperties}
        >
          <dt className="text-sm text-ink-soft">{r.when}</dt>
          <dd className={`tnum font-mono text-sm ${r.f === 0.125 ? "text-ember" : "text-ink"}`}>
            {fmtUsd(priceAtFreshness(a, r.f), 4)}
          </dd>
        </div>
      ))}
      <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-soft">
        <Mark
          kind="recorded"
          note={`The rule the registry ships, over the listed base and floor of the artifact that sold: ${BUY.priceBaseMicroUsdc} and ${BUY.priceFloorMicroUsdc} µUSDC. Source: ${SOURCE_FILES.buy}`}
        />
        <span className="font-mono">priceFloor + round(priceBase &times; freshness)</span>
      </p>
    </dl>
  );
}

/* ------------------------------------------------------------------ closing */

/**
 * Taking part, on the landing. Three steps drawn as a command and two short
 * rows, not explained: the full guide, with every trap and caveat, is `/app#join`
 * and this links there once. The facts are `docs/GETTING-STARTED.md`'s: search
 * needs nothing, publishing needs an ECDSA account that is associated with USDC.
 *
 * Asymmetric like everything else here: the command is the wide column because
 * it is the step that is actually work.
 */
function GetCarpool({ register }: { register: (el: HTMLElement | null) => void }) {
  return (
    <section
      id="get"
      ref={register}
      className="beat snap-section mx-auto flex min-h-[100svh] w-full max-w-[1320px] flex-col justify-center px-5 py-16 sm:px-8"
    >
      <CrossRule at="62%" className="beat-fx fx-wipe mb-12" />
      <div className="beat-fx fx-rise min-w-0">
        <p className="label mb-5 text-2xs text-ink-faint">Take part</p>
        <h2 className="text-deck font-semibold uppercase text-ink">
          <span className="block">Get Carpool</span>
          <span className="block pl-[5%] text-ink-faint sm:pl-[11%]">in three steps</span>
        </h2>
      </div>

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <div className="beat-fx fx-rise min-w-0" style={{ "--i": 1 } as CSSProperties}>
          <Step n="01" title="Install" />
          <Command label="npx" text={INSTALL_COMMAND} />
          <p className="mt-3 text-sm text-ink-soft">
            <a
              href="https://github.com/RomarioKavin1/carpool"
              target="_blank"
              rel="noreferrer"
              className="text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
            >
              Contributors: GitHub
            </a>
          </p>
        </div>

        <ol className="beat-fx fx-rise min-w-0 self-end" style={{ "--i": 2 } as CSSProperties}>
          <li className="hairline-b py-5">
            <Step n="02" title="Buy with USDC" />
            <p className="mt-2 pl-8 text-sm text-ink-soft">
              Search is free. To buy:{" "}
              <a
                href="https://portal.hedera.com"
                target="_blank"
                rel="noreferrer"
                className="text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
              >
                testnet account
              </a>
              , associate, then{" "}
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
              >
                test USDC
              </a>
              .
            </p>
            <Command label="associate, then connect" text={BUYER_COMMAND} />
          </li>
          <li className="hairline-b py-5">
            <Step n="03" title="Publish and earn" />
            <p className="mt-2 pl-8 text-sm text-ink-soft">Same associated account works.</p>
            <Command label="connect" text={AUTHOR_COMMAND} />
            <p className="mt-3 text-sm text-ink-soft">Paid after the refund window, hourly.</p>
          </li>
          <li className="pt-6">
            <Link
              href="/app#join"
              className="text-sm text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
            >
              Full setup guide <span aria-hidden="true">&rarr;</span>
            </Link>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Step({ n, title }: { n: string; title: string }) {
  return (
    <p className="flex items-baseline gap-x-3">
      <span className="tnum w-5 shrink-0 font-mono text-sm text-ink-faint">{n}</span>
      <span className="text-xl font-medium text-ink">{title}</span>
    </p>
  );
}

/**
 * What the page does not show. It is on the landing rather than only on the
 * measurement desk because a reader has no way to tell from the numbers alone
 * what they leave out.
 *
 * Given the asymmetric split the reference uses for everything: the headline on
 * the left in a narrow column, the list it introduces on the right in a wide
 * one, so the two halves are visibly unequal rather than a split of the page in
 * half.
 */
function Limits({ register }: { register: (el: HTMLElement | null) => void }) {
  const lines = [SETTLED_LIMITS[0]!, SETTLED_LIMITS[1]!, NOT_SHOWN[0]!, NOT_SHOWN[2]!];
  return (
    <section
      ref={register}
      className="beat snap-section mx-auto flex min-h-[100svh] w-full max-w-[1320px] flex-col justify-center px-5 py-16 sm:px-8"
    >
      <CrossRule at="40%" className="beat-fx fx-wipe mb-14" />
      <div className="beat-fx fx-rise grid grid-cols-[minmax(0,1fr)] gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="relative min-w-0">
          <h2 className="text-deck font-semibold uppercase text-ink">
            <span className="block">What none</span>
            <span className="block pl-[6%] text-ink-faint sm:pl-[14%]">of this shows</span>
          </h2>
          {/* The column under this headline is deliberately empty, and a field of
              squares is what says so. Without it the negative space reads as a
              layout that ran out of content rather than as a composition. */}
          <div aria-hidden="true" className="relative mt-10 hidden h-48 lg:block">
            <span className="absolute left-[10%] top-0 block h-24 w-px bg-plate-line" />
            <span className="node absolute left-[10%] top-24 -translate-x-[2.5px]" />
            <Particles count={20} className="opacity-60" />
          </div>
        </div>
        <Panel tone="raised" className="min-w-0 px-5 py-5 sm:px-7 sm:py-6">
          <p className="text-base text-ink">One artifact, one sale, one settlement.</p>
          {/*
            The limits are four sentences long each and they are not negotiable,
            so they are one click away rather than shortened. Deleting a caveat
            to hit a word budget is the failure this whole pass is guarding
            against.
          */}
          <Disclosure summary={`Read all ${lines.length}`} className="mt-4">
            <ul>
              {lines.map((line) => (
                <li key={line} className="hairline-b py-3.5 text-sm text-ink-soft last:shadow-none">
                  {line}
                </li>
              ))}
            </ul>
          </Disclosure>
        </Panel>
      </div>
    </section>
  );
}

function CallToApp({ register }: { register: (el: HTMLElement | null) => void }) {
  return (
    <footer
      ref={register}
      className="beat snap-section mx-auto flex min-h-[100svh] w-full max-w-[1320px] flex-col justify-center px-5 pb-20 pt-10 sm:px-8 sm:pb-24"
    >
      <div aria-hidden="true" className="relative h-24 sm:h-28">
        <Particles count={22} className="opacity-60" />
      </div>

      <Panel tone="dark" className="beat-fx fx-rise relative overflow-hidden px-6 py-10 sm:px-12 sm:py-14">
        <CornerMark kind="triangle" className="absolute bottom-4 left-4 fill-ink-lift" />
        <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-x-12 gap-y-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="min-w-0">
            <h2 className="text-deck font-semibold uppercase text-paper">
              <span className="block">Now watch it</span>
              <span className="block pl-[5%] text-ink-lift sm:pl-[12%]">happen for real</span>
            </h2>
            <p className="mt-8 max-w-[52ch] text-base text-ink-lift">All of it, on a running registry.</p>
            <p className="mt-4 max-w-[52ch] text-base text-ink-lift">Nothing to sign up for.</p>
          </div>
          {/*
            Two destinations, ranked rather than paired: a solid pill for the one
            most readers want next, an underlined line for the one a smaller
            number want much more. A second pill beside the first would read as a
            choice nobody asked to make.
          */}
          <div className="flex flex-col gap-4 lg:items-end">
            <Link
              href="/app"
              className="pill-motion focus-inset inline-flex items-center gap-2 self-start rounded-full bg-paper px-5 py-2.5 text-sm font-medium text-ink hover:bg-plate lg:self-auto"
            >
              Open the live registry
              <span aria-hidden="true">&rarr;</span>
            </Link>
            <Link
              href="/app#join"
              className="focus-light self-start text-sm text-ink-lift underline decoration-ink-lift underline-offset-4 transition-colors duration-150 ease-out hover:text-paper hover:decoration-paper lg:self-auto"
            >
              Or how to take part
            </Link>
          </div>
        </div>
      </Panel>

      <p className="mt-10 max-w-[76ch] text-xs text-ink-soft">
        Every figure is quoted from a record in this repository.
      </p>
      <Caveat summary="Not live data" className="mt-4">
        <p>
          Nothing on this page is read from a running registry. The drawings are of the mechanism, not of
          anybody&rsquo;s data.
        </p>
      </Caveat>
    </footer>
  );
}

/* --------------------------------------------------------------- the wiring */

/**
 * One observer for all five beats.
 *
 * Three properties worth stating, because each of them is a failure this avoids:
 *
 * 1. **It never writes an attribute under reduced motion.** `data-in` is the only
 *    thing that can put a beat in its start frame, so a reader who has asked for
 *    no animation gets the finished drawings and no observer callbacks at all.
 * 2. **A beat already on screen is left finished.** Setting it to frame one after
 *    the server-rendered HTML has painted would flash complete → empty → animate.
 *    So the initial pass only arms beats that are still below the fold.
 * 3. **It writes to the DOM, not to React state.** Five attribute writes total,
 *    one per beat per entry, instead of a re-render per intersection. The active
 *    station is the one piece of real state here and changes at most five times.
 */
function useBeatObserver() {
  const els = useRef<HTMLElement[]>([]);
  const [active, setActive] = useState(0);

  const register = (el: HTMLElement | null) => {
    if (el && !els.current.includes(el)) els.current.push(el);
  };

  useEffect(() => {
    const nodes = els.current;
    if (nodes.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canObserve = typeof IntersectionObserver === "function";

    if (!reduce && canObserve) {
      const armAt = window.innerHeight * 0.85;
      for (const el of nodes) {
        if (el.getBoundingClientRect().top > armAt) el.dataset.in = "false";
      }
    }

    /**
     * The backstop, and it earns its place: an armed beat is sitting on frame
     * one, so an observer that stops delivering does not merely skip an
     * animation, it leaves half a drawing on screen. Measured in an injected
     * iframe, Chrome delivered entries for two beats and then stopped, and the
     * remaining three stayed on their start frame through a full scroll.
     *
     * So every two seconds, any beat still armed and now within the viewport is
     * finished by hand. It reads five rectangles, it stops the moment nothing is
     * pending, and when the observer is working it never has anything to do.
     */
    const finishVisible = () => {
      let pending = 0;
      for (const el of nodes) {
        if (el.dataset.in !== "false") continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.dataset.in = "true";
        else pending += 1;
      }
      if (pending === 0) window.clearInterval(watchdog);
    };
    const watchdog = window.setInterval(finishVisible, 2000);

    if (!canObserve) return () => window.clearInterval(watchdog);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          if (!reduce) el.dataset.in = "true";
          const n = Number(el.dataset.beat);
          if (Number.isInteger(n)) setActive(n);
        }
      },
      { threshold: 0.22, rootMargin: "0px 0px -20% 0px" },
    );
    for (const el of nodes) io.observe(el);
    return () => {
      window.clearInterval(watchdog);
      io.disconnect();
    };
  }, []);

  return { register, active };
}
