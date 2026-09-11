/**
 * The frame: who this is, where you are, and whether the data on screen is
 * current.
 *
 * ## What changed in this pass
 *
 * Two things: the navigation became a hierarchy, and the masthead got one
 * dominant action instead of a paragraph and a second button.
 *
 * 1. **The navigation is a solid dark pill, and it now holds two items rather
 *    than six.** The reference's own nav is a small near-black rounded chip;
 *    here it holds `Browse` and `Search`, the current one marked by a `paper`
 *    chip inside it, with the four reference views in a visibly quieter row
 *    underneath. That is a familiar top-nav in an unfamiliar material, which is
 *    the right trade for a product surface: the affordance is the one every
 *    reader knows, and only the finish changed.
 * 2. **No borders anywhere.** The header used to end in a `border-b`; it now
 *    ends in a drawn hairline, and every region below opens on a crosshair
 *    instead of a full-width rule.
 * 3. **A dark mass on the overview**, as counterpoint to the light table. The
 *    registry's own identity and the connection state live in it, which is the
 *    one thing on this screen that is about the machine rather than about the
 *    data. It carries facts and one `Caveat` now, never prose and never a second
 *    button: it sits beside the route's primary action and must not compete with
 *    it for the reader's first fixation.
 *
 * The sticky status strip is still gone. It was the right idea on a desktop and
 * cost four permanent lines of an 844px phone.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { REGISTRY_URL, type RegistryHealth } from "../lib/api";
import type { FooterSummary } from "../lib/derive";
import { DROVE_ALONE_UNOBSERVABLE } from "../lib/economics";
import { fmtUsd } from "../lib/format";
import { Band, Button, Caveat, CornerMark, CrossRule, Frame, NoData, Panel } from "./primitives";

export type View = "overview" | "find" | "earnings" | "activity" | "evidence" | "join";

/**
 * ## The navigation, and why it is two tiers now
 *
 * It used to be six tabs of identical weight in one pill. Six peers is a menu,
 * not a hierarchy: it forces a newcomer to choose between things they have no
 * basis to rank, and it put "Take part" sixth of six, which is exactly backwards
 * for the one reader who does not yet know what any of this is.
 *
 * Most people arriving here want one of two things, and both of them are about
 * the artifacts rather than about the machine: see what is on sale, or ask
 * whether anything already answers their question. Those two are the primary
 * tier and they are the only items in the dark pill. `browse` is the default.
 *
 * Everything else is a reference view for somebody who already knows why they
 * came: an author checking a payout, an operator watching the feed, a reader
 * auditing the one measured comparison, and the setup instructions. They keep
 * their own labels and their own hashes and they sit in a visibly quieter row
 * underneath, with `join` first, because of the four it is the one a stranger is
 * most likely to need.
 *
 * Labels are nouns, not sentences. The sentence each one deserves is its `hint`.
 */
export const PRIMARY_VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "overview", label: "Browse", hint: "Everything this registry is holding, priced right now" },
  { id: "find", label: "Search", hint: "Ask whether anything here already answers a question" },
];

export const DESKS: { id: View; label: string; hint: string }[] = [
  { id: "join", label: "Take part", hint: "No sign-up: what to install, and the two variables each direction needs" },
  { id: "earnings", label: "Earnings", hint: "What one author published, sold and was actually paid" },
  { id: "activity", label: "Activity", hint: "Every sale and refund as it lands" },
  { id: "evidence", label: "Measurement", hint: "The one recorded comparison, and what it does not show" },
];

/** Every addressable view. `/app#<id>` opens any of them directly. */
export const ALL_VIEWS = [...PRIMARY_VIEWS, ...DESKS];

export type Connection = "connecting" | "live" | "offline" | "error";

function statusOf(connection: Connection) {
  return connection === "live"
    ? { word: "live", tone: "text-credit", mark: "bg-credit" }
    : connection === "connecting"
      ? { word: "connecting", tone: "text-ink-soft", mark: "bg-ink-faint" }
      : {
          word: connection === "offline" ? "not answering" : "refused",
          tone: "text-debit",
          mark: "bg-debit",
        };
}

export function TopBar({
  view,
  onView,
  connection,
  detail,
  pollSeconds,
}: {
  view: View;
  onView: (v: View) => void;
  connection: Connection;
  detail: string | null;
  pollSeconds: number;
}) {
  const status = statusOf(connection);

  return (
    <header className="sticky top-0 z-20 bg-field">
      <Frame>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-5">
          <button
            type="button"
            onClick={() => onView("overview")}
            className="flex min-w-0 items-baseline gap-3 rounded-sm text-left"
          >
            <span className="text-lg font-semibold tracking-[-0.05em] text-ink">carpool</span>
            <span className="hidden truncate text-sm text-ink-soft sm:inline">
              research somebody already did
            </span>
          </button>

          <p className="flex shrink-0 items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-xs ${status.mark}`}
            />
            <span role="status" className={status.tone}>
              {status.word}
            </span>
            <span className="hidden text-ink-soft md:inline">
              {connection === "live" ? `reading every ${pollSeconds}s` : (detail ?? "")}
            </span>
          </p>
        </div>

        {/*
          Two tiers, one nav. The dark pill holds the two things almost everyone
          came for; the quiet row under it holds the four reference views. The
          pill scrolls inside itself on a narrow screen, so the DOCUMENT never
          scrolls sideways — `-mx-5 px-5` lets that scroll reach the gutter
          instead of clipping against it.
        */}
        <nav aria-label="Sections" className="pb-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="-mx-5 min-w-0 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
              <ul className="flex min-w-max items-stretch gap-0.5 rounded-full bg-ink p-1">
                {PRIMARY_VIEWS.map((d) => (
                  <NavItem key={d.id} {...d} view={view} onView={onView} />
                ))}
              </ul>
            </div>

            {/* The way back out to the explainer. A route, not a view, and it says
                so by being the only item here that leaves this page. */}
            <Link
              href="/"
              title="The mechanism in five drawings, with the measured numbers"
              className="shrink-0 rounded-full px-3 py-1.5 text-sm text-ink-soft transition-colors duration-150 ease-out hover:bg-paper hover:text-ink"
            >
              How it works <span aria-hidden="true">&#8599;</span>
            </Link>
          </div>

          <ul className="-mx-5 mt-3 flex items-center gap-x-1 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
            {DESKS.map((d) => (
              <SubNavItem key={d.id} {...d} view={view} onView={onView} />
            ))}
          </ul>
        </nav>
      </Frame>
      <Frame>
        <div aria-hidden="true" className="h-px w-full bg-plate-line" />
      </Frame>
    </header>
  );
}

function NavItem({
  id,
  label,
  hint,
  view,
  onView,
}: {
  id: View;
  label: string;
  hint: string;
  view: View;
  onView: (v: View) => void;
}) {
  const active = view === id;
  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={() => onView(id)}
        aria-current={active ? "page" : undefined}
        title={hint}
        className={`block rounded-full px-3.5 py-1.5 text-sm transition-colors duration-150 ease-out ${
          active
            ? "focus-inset bg-paper font-medium text-ink"
            : "focus-light text-ink-lift hover:bg-wire hover:text-paper active:bg-wire"
        }`}
      >
        {label}
      </button>
    </li>
  );
}

/**
 * A reference view. Visibly quieter than the pill above it: no fill until it is
 * the current one, and then a `paper` chip rather than the pill's inversion, so
 * the two tiers can never be mistaken for one row of six.
 */
function SubNavItem({
  id,
  label,
  hint,
  view,
  onView,
}: {
  id: View;
  label: string;
  hint: string;
  view: View;
  onView: (v: View) => void;
}) {
  const active = view === id;
  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={() => onView(id)}
        aria-current={active ? "page" : undefined}
        title={hint}
        className={`block whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors duration-150 ease-out ${
          active
            ? "bg-paper font-medium text-ink"
            : "text-ink-soft hover:bg-paper hover:text-ink"
        }`}
      >
        {label}
      </button>
    </li>
  );
}

/**
 * The overview's masthead: a large display headline against a solid dark panel.
 *
 * This is the reference's asymmetric split, taken directly. The left half is the
 * loudest type on the route, staggered over three lines with the last dropped to
 * a lighter value; the right half is the one thing on this screen that is about
 * the machine rather than about the data, in the one material that is
 * unmistakably not a row of the table.
 *
 * It is deliberately not a hero-metric template: there is no dominant number and
 * no supporting stat cluster. The panel carries an address, a network and a poll
 * interval, which are facts about where the page is reading from.
 */
export function OverviewMasthead({
  connection,
  detail,
  pollSeconds,
  health,
  artifactCount,
  liveCount,
  onView,
}: {
  connection: Connection;
  detail: string | null;
  pollSeconds: number;
  health: RegistryHealth | null;
  artifactCount: number;
  liveCount: number;
  onView: (v: View) => void;
}) {
  const status = statusOf(connection);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="min-w-0">
        <p className="label mb-5 text-2xs text-ink-faint">The live registry</p>
        <h1 className="text-deck font-semibold uppercase text-ink">
          <span className="block">Research</span>
          <span className="block pl-[4%] sm:pl-[9%]">on sale,</span>
          <span className="block pl-[8%] text-ink-faint sm:pl-[18%]">priced by age</span>
        </h1>
        <p className="measure mt-7 text-base text-ink-soft">
          {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"} below, {liveCount} still
          on sale. Prices fall as they age.
        </p>

        {/*
          The one primary action on this route, and the reason it is search
          rather than anything else: looking is already free and needs no click
          (the table is one scroll down), and searching is the step that turns
          looking into buying. It costs nothing, needs no key and no account, and
          it is the moment this product is actually useful to a stranger.
        */}
        <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
          <button
            type="button"
            onClick={() => onView("find")}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-7 py-3.5 text-lg font-medium text-paper transition-colors duration-150 ease-out hover:bg-wire active:bg-ink"
          >
            Search this registry
            <span aria-hidden="true">&rarr;</span>
          </button>
          <button
            type="button"
            onClick={() => onView("join")}
            className="focus-light rounded-xs text-sm text-wire underline decoration-plate-line underline-offset-4 transition-colors duration-150 ease-out hover:decoration-wire"
          >
            Or publish something of your own
          </button>
        </div>
      </div>

      {/*
        Facts about where this page is reading from, and nothing else. It used to
        carry three sentences and a second button, which made the diagnostic
        panel compete with the headline beside it for the reader's first fixation.
        The sentence it lost ("this page holds no key") is now one line, under a
        disclosure, next to the label it qualifies.
      */}
      <Panel tone="dark" radius="lg" className="relative min-w-0 overflow-hidden px-6 py-6 sm:px-8">
        <CornerMark kind="plus" className="absolute right-4 top-4 fill-ink-lift" />
        <p className="label text-2xs text-ink-lift">Reading from</p>
        <p className="mt-2 break-words font-mono text-sm text-paper [overflow-wrap:anywhere]">
          {REGISTRY_URL}
        </p>

        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5">
          <div className="min-w-0">
            <dt className="label text-2xs text-ink-lift">state</dt>
            <dd className="mt-1.5 flex items-center gap-2 text-sm text-paper">
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-xs ${status.mark}`}
              />
              {status.word}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label text-2xs text-ink-lift">polling</dt>
            <dd className="tnum mt-1.5 font-mono text-sm text-paper">every {pollSeconds}s</dd>
          </div>
          <div className="min-w-0">
            <dt className="label text-2xs text-ink-lift">network</dt>
            <dd className="mt-1.5 font-mono text-sm text-paper">
              {connection === "live" && health ? health.network : "not read"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label text-2xs text-ink-lift">usdc</dt>
            <dd className="tnum mt-1.5 font-mono text-sm text-paper">
              {connection === "live" && health ? health.asset : "not read"}
            </dd>
          </div>
        </dl>

        <Caveat summary="This page holds no key" dark className="mt-7">
          <p>It reads the registry&rsquo;s open routes and nothing else.</p>
          <p>
            It cannot publish, buy, settle or refund on your behalf. Doing any of those needs a key
            of your own, and there is no sign-up for one.
          </p>
          {connection !== "live" && detail && <p>{detail}</p>}
        </Caveat>
      </Panel>
    </div>
  );
}

/**
 * The registry's own totals, read in the place they mean something rather than
 * pinned to the window edge. `drove alone` keeps its "not observable" stamp:
 * nothing in /state or /events observes research that was redone elsewhere
 * instead of bought here, and a plausible stand-in there would be the exact
 * mistake this project retracted.
 */
export function RegistryTotals({
  footer,
  health,
}: {
  footer: FooterSummary | null;
  health: RegistryHealth | null;
}) {
  if (!footer) return null;
  return (
    <Panel tone="raised" className="px-5 py-5 sm:px-7">
      {/* Labels are nouns. The sentence each one would otherwise be is its `title`. */}
      <dl className="flex flex-wrap items-baseline gap-x-10 gap-y-4 text-sm">
        <Total label="published" value={String(footer.published)} title="Artifacts on sale or expired." />
        <Total label="bought" value={String(footer.purchased)} title="Purchases recorded by this registry." />
        <Total label="paid in" value={fmtUsd(footer.grossUusdc, 2)} title="Gross paid by buyers." />
        <Total
          label="reused"
          value={String(footer.rode)}
          title="Agents that bought an answer instead of producing it."
        />
        <div className="min-w-0">
          <dt className="label text-2xs text-ink-faint" title="Agents that redid the research elsewhere instead of buying it here.">
            redone elsewhere
          </dt>
          <dd className="mt-1 font-mono text-base">
            <NoData why={DROVE_ALONE_UNOBSERVABLE}>not observable</NoData>
          </dd>
        </div>
        {health && !health.creds && (
          <div className="min-w-0">
            <dt className="label text-2xs text-ink-faint">settlement</dt>
            <dd
              className="mt-1 text-base text-ember"
              title="This registry started without CARPOOL_PRIVATE_KEY, so the settler was never constructed. Royalties still accrue in the payout table; nothing is transferred to an author or anchored."
            >
              off
            </dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}

function Total({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="label text-2xs text-ink-faint" title={title}>
        {label}
      </dt>
      <dd className="tnum mt-1 font-mono text-base text-ink">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------- connection states */

/**
 * Three genuinely different states, because collapsing them into one "error" is
 * what makes a dashboard useless the first time a judge opens it with nothing
 * running.
 */
export function RegistryOffline({ detail }: { detail: string | null }) {
  return (
    <Centered heading={["Nothing", "is running", "yet"]}>
      <p className="text-base text-ink-soft">
        Nothing is listening on <code className="font-mono text-ink">{REGISTRY_URL}</code>. Start one:
      </p>
      <Panel tone="dark" className="mt-5 overflow-x-auto px-5 py-4">
        <pre className="font-mono text-sm text-paper">pnpm --filter @carpool/registry dev</pre>
      </Panel>
      <p className="mt-5 text-sm text-ink-soft">This page keeps polling and fills in on its own.</p>
      {/*
        The desks are behind `state`, so the join desk cannot be linked from here:
        there is no state to render it beside. The document is reachable without a
        running service, which is the only thing that is true in this state.
      */}
      <Caveat summary="Where it reads from" className="mt-6">
        <p>
          Point it elsewhere with{" "}
          <code className="font-mono text-ink">NEXT_PUBLIC_SETTLEMENT_URL</code>.
        </p>
        <p>
          Only open routes are read: /state, /events, /search, /health, /.well-known/carpool and the
          payee-scoped /payouts. This page holds no key and cannot publish, settle or refund
          anything.
        </p>
        <p>
          Starting from nothing, including where keys come from:{" "}
          <code className="font-mono text-ink">docs/GETTING-STARTED.md</code>.
        </p>
        {detail && !detail.includes(REGISTRY_URL) ? <p>{detail}</p> : null}
      </Caveat>
    </Centered>
  );
}

export function RegistryError({ detail }: { detail: string }) {
  return (
    <Centered heading={["The registry", "refused", "the read"]}>
      <p className="text-base text-ink-soft">
        <code className="font-mono text-ink">{REGISTRY_URL}</code> answered, and said:
      </p>
      <Band tone="debit" className="mt-4 px-5 py-4">
        <p className="font-mono text-sm text-debit">{detail}</p>
      </Band>
      <p className="mt-4 text-sm text-ink-soft">
        Its own message, unchanged. Polling continues.
      </p>
    </Centered>
  );
}

export function Connecting() {
  return (
    <Centered heading={["Reading", "the registry"]}>
      <p className="text-base text-ink-soft">
        Asking <code className="font-mono text-ink">{REGISTRY_URL}</code> what it holds.
      </p>
    </Centered>
  );
}

/**
 * The stale banner. Its clock is `lastGoodMs`, set only when /state actually
 * answers. A timestamp that advances beside figures that have not moved is the
 * quietly wrong number this whole dashboard exists to avoid.
 */
export function StaleBanner({
  detail,
  lastGoodMs,
}: {
  detail: string | null;
  lastGoodMs: number | null;
}) {
  return (
    <Frame className="pt-6">
      <Band tone="ember" className="px-5 py-4 sm:px-7">
        <p role="alert" className="measure-wide text-base text-ink">
          <strong className="font-semibold">Showing the last good read.</strong>{" "}
          {lastGoodMs === null
            ? "Nothing below has refreshed."
            : `Unchanged since ${new Date(lastGoodMs).toLocaleTimeString()}.`}{" "}
          Polling continues.
        </p>
        <Caveat summary="What the registry said" className="mt-3">
          <p>{detail ?? "The registry stopped answering."}</p>
        </Caveat>
      </Band>
    </Frame>
  );
}

/**
 * No artifacts. A working, legible state, and the first one every fresh registry
 * is in.
 *
 * It is also the best teaching moment the app has, which the first version of it
 * wasted: an empty table is the one screen where the reader has nothing to read
 * and every reason to ask what they are supposed to do. So it now says what the
 * two things a person can do about it are, and the answer to "how do I publish
 * something" is one click away instead of nowhere.
 *
 * Not centred any more. Centred text is right for two lines of reassurance and
 * wrong the moment the panel has to carry a next step: the eye returns to a
 * different left edge on every line, and the control ends up floating in the
 * middle of a large empty panel with nothing anchoring it.
 */
export function EmptySwarm({ onView }: { onView: (v: View) => void }) {
  return (
    <Panel tone="raised" className="relative overflow-hidden">
      <div className="graph-paper">
        <div className="max-w-[62ch] px-6 py-14 sm:px-10">
          <h3 className="text-xl font-semibold text-ink">Nothing is on sale yet</h3>
          <p className="mt-3 text-base text-ink-soft">
            The registry is up and answering. It simply holds nothing.
          </p>
          {/*
            A pill and a text link, not two pills. `Button variant="secondary"` is
            a `paper` fill, and this panel is `paper`, so a second button here was
            a control with no visible edge at all: it read as a sentence somebody
            had left lying next to the real one.
          */}
          <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3">
            <Button variant="primary" onClick={() => onView("join")}>
              Publish the first one
              <span aria-hidden="true">&rarr;</span>
            </Button>
            <button
              type="button"
              onClick={() => onView("find")}
              className="focus-light rounded-xs text-sm text-wire underline decoration-plate-line underline-offset-4 transition-colors duration-150 ease-out hover:decoration-wire"
            >
              Or search it, free
            </button>
          </div>
          <Caveat summary="What appears here" className="mt-7">
            <p>
              An artifact appears on the next read after an author publishes one, and starts losing
              value from the moment they say they produced it.
            </p>
            <p>
              There is no sign-up in either direction: identity is a Hedera keypair, and the same one
              publishes and buys.
            </p>
          </Caveat>
        </div>
      </div>
      <CornerMark kind="triangle" className="absolute bottom-3 left-3" />
    </Panel>
  );
}

/**
 * The full-screen states, given the same asymmetric split and staggered headline
 * the overview gets, so an empty registry is recognisably the same product as a
 * full one rather than a plain error page.
 */
function Centered({ heading, children }: { heading: [string, string?, string?]; children: ReactNode }) {
  const lines = heading.filter(Boolean) as string[];
  return (
    <Frame className="py-20">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <h2 className="text-deck font-semibold uppercase text-ink">
          {lines.map((line, i) => (
            <span
              key={line}
              className={`block ${i === 1 ? "pl-[4%] sm:pl-[9%]" : i === 2 ? "pl-[8%] sm:pl-[18%]" : ""} ${
                i === lines.length - 1 && lines.length > 1 ? "text-ink-faint" : ""
              }`}
            >
              {line}
            </span>
          ))}
        </h2>
        <Panel tone="raised" className="min-w-0 px-6 py-7 sm:px-8">
          {children}
        </Panel>
      </div>
    </Frame>
  );
}

/** The page footer. Not sticky, not chrome: the last thing, said once. */
export function PageFooter({ health }: { health: RegistryHealth | null }) {
  return (
    <footer className="mt-24">
      <Frame>
        <CrossRule at="72%" />
        <div className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3 py-8 text-sm text-ink-soft">
          <p className="measure">
            Read from one registry&rsquo;s open routes, or quoted from a record in this repository.
            Nothing is filled in.
          </p>
          <p className="font-mono">
            {REGISTRY_URL}
            {health ? ` · ${health.network} · usdc ${health.asset}` : ""}
          </p>
        </div>
      </Frame>
    </footer>
  );
}

/** A back link out of a desk, so the secondary sections have an obvious exit. */
export function BackToOverview({ onView }: { onView: (v: View) => void }) {
  return (
    <Button variant="quiet" onClick={() => onView("overview")} className="-ml-3">
      <span aria-hidden="true">←</span> Browse
    </Button>
  );
}
