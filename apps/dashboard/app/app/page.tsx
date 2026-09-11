/**
 * `/app` — the working surface: one poll loop, two primary views, four
 * secondary desks, and the honest connection states.
 *
 * ## The sequence, and what moved out of it
 *
 * This used to be `/`, and it opened with the explanation: a plain-language
 * claim, a two-column money comparison, the settlement proof, and three numbered
 * steps of prose. All of that is now drawn rather than written, at `/`, and this
 * route starts where density is allowed:
 *
 * 1. **The swarm.** The real table, spacious rows, the decay bar as the signature
 *    element.
 * 2. **Detail on demand**, expanding in place inside the table.
 * 3. **Search** beside it in the primary pill, because browsing and asking are
 *    the two things almost everyone came to do, and **earnings, activity, the
 *    measurement and how to take part** in a quieter row underneath, so none of
 *    them competes with the table.
 *
 * Nothing was deleted with the prose. The settlement transactions and the
 * retraction both live on the measurement desk, which `/` links straight into by
 * hash, and the mechanism the prose described is what the five drawings on `/`
 * animate. One orientation line stays at the top of the table for a reader who
 * arrived here directly.
 *
 * Two rendered routes now, not one, and `lib/fixtures-unreachable.test.ts`'s
 * pinned entry-point list was updated deliberately to say so: it walks the module
 * graph from `app/layout.tsx`, `app/page.tsx` and `app/app/page.tsx`, and a
 * third entry point that the pin did not name would have turned that suite red
 * rather than passing quietly.
 *
 * ## The poll loop
 *
 * `/state` is the primary read and drives the connection indicator: if it
 * answers, the page is live. `/events`, `/health` and the public configuration
 * are secondary and each fails into its own local empty or error state rather
 * than blanking the screen, because a stalled event feed is not an offline
 * registry and showing it as one is a lie about which part broke.
 *
 * `nowMs` is set once per poll rather than on its own ticking interval. It is not
 * cosmetic: `buildRows` uses it as the trailing-window clock for current demand
 * and sales per hour, and the refund countdowns use it. A separate ticker that
 * stopped, in a throttled background tab or on a reduced-motion path that skipped
 * it, would silently freeze "in the last hour" at whatever it was on mount, which
 * is exactly the quietly wrong number this page exists to avoid.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getBatches,
  getEvents,
  getHealth,
  getPayouts,
  getState,
  getWellKnown,
  SELF_AUTHOR_ACCOUNT,
  type Batch,
  type CarpoolEvent,
  type Payout,
  type RegistryHealth,
  type RegistryState,
  type WellKnown,
} from "../../lib/api";
import {
  buildFooter,
  buildRows,
  recentEvents,
  sortRows,
  type SortDir,
  type SortKey,
} from "../../lib/derive";
import { initialCursor, mergeEvents, nextCursor } from "../../lib/events";
import { buildSeeders, findSeeder, parseAuthor } from "../../lib/seeding";
import { ActivityDesk } from "../../components/ActivityDesk";
import { EarningsDesk } from "../../components/EarningsDesk";
import { EvidenceDesk } from "../../components/EvidenceDesk";
import { FindDesk } from "../../components/FindDesk";
import { JoinDesk } from "../../components/JoinDesk";
import { Button, Frame, Particles, Section } from "../../components/primitives";
import {
  ALL_VIEWS,
  BackToOverview,
  Connecting,
  EmptySwarm,
  OverviewMasthead,
  PageFooter,
  RegistryError,
  RegistryOffline,
  RegistryTotals,
  StaleBanner,
  TopBar,
  type Connection,
  type View,
} from "../../components/Shell";
import { SwarmTable } from "../../components/SwarmTable";

const POLL_MS = 3000;
/** How far back the first event read looks. Seconds: /events speaks seconds. */
const EVENT_LOOKBACK_SECONDS = 6 * 3600;

export default function Page() {
  const [state, setState] = useState<RegistryState | null>(null);
  const [events, setEvents] = useState<CarpoolEvent[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const [wellKnown, setWellKnown] = useState<WellKnown | null>(null);
  const [health, setHealth] = useState<RegistryHealth | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /**
   * When `/state` last actually answered. NOT `nowMs`: the stale banner says the
   * figures below are "as of" a time, and `nowMs` advances on every poll whether
   * or not the poll succeeded, so the banner's clock ticked forward beside data
   * that had not moved since the outage began.
   */
  const [lastGoodMs, setLastGoodMs] = useState<number | null>(null);

  const [view, setView] = useState<View>("overview");
  /**
   * A desk can be opened directly by hash: `/app#evidence` is where the
   * explainer's correction link points, and `#earnings` is the one an author
   * would bookmark. Read once, on mount, and only for a hash that names a real
   * desk, so an unknown fragment leaves the overview alone instead of landing a
   * reader on nothing. Not in `useState`'s initialiser: this component renders on
   * the server first, where there is no location to read.
   */
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (ALL_VIEWS.some((d) => d.id === id)) setView(id as View);
  }, []);
  /** The magnet whose detail is expanded in the swarm table, or null. */
  const [opened, setOpened] = useState<string | null>(null);
  const [showEveryColumn, setShowEveryColumn] = useState(false);
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "health", dir: "desc" });

  /**
   * Payout rows, keyed by payee.
   *
   * `GET /payouts` is open only in its scoped form, so this app fetches one payee
   * at a time and never the table. `payeesRef` holds whichever payees are
   * actually on screen: the opened artifact's author, and the selected author on
   * the earnings desk. A payee with no entry has not been read; an entry of `[]`
   * means the registry returned no rows.
   */
  const [payouts, setPayouts] = useState<Record<string, Payout[]>>({});
  const [payoutsError, setPayoutsError] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const payeesRef = useRef<string[]>([]);

  // Seconds, exclusive. Taken from the newest event received, never from a clock.
  const cursor = useRef<number>(initialCursor(Date.now(), EVENT_LOOKBACK_SECONDS));
  const [cursorShown, setCursorShown] = useState<number>(cursor.current);

  const refresh = useCallback(async () => {
    const startedMs = Date.now();
    setNowMs(startedMs);
    try {
      const s = await getState();
      setState(s);
      setLastGoodMs(startedMs);
      setConnection("live");
      setConnectionDetail(null);
    } catch (e) {
      const err = e as ApiError;
      setConnection(err.offline ? "offline" : "error");
      setConnectionDetail(err.message);
      return; // the secondary reads are pointless against a registry that just refused
    }

    try {
      const incoming = await getEvents(cursor.current);
      cursor.current = nextCursor(incoming, cursor.current);
      setCursorShown(cursor.current);
      if (incoming.length > 0) setEvents((prev) => mergeEvents(prev, incoming));
      setEventError(null);
    } catch (e) {
      setEventError((e as Error).message);
    }

    // Payouts and batches are fetched only for the payees on screen. The batch
    // list is joined to a settled payout row, so polling it with no payout row
    // rendered would be a read nothing consumes.
    const payees = payeesRef.current;
    if (payees.length === 0) return;
    try {
      const fetched = await Promise.all(payees.map((payee) => getPayouts(payee)));
      setPayouts((prev) => {
        const next = { ...prev };
        payees.forEach((payee, i) => {
          next[payee] = fetched[i]!;
        });
        return next;
      });
      setPayoutsError(null);
    } catch (e) {
      setPayoutsError((e as Error).message);
    }
    try {
      setBatches(await getBatches());
    } catch {
      /* batches only let a paid row name the transaction that paid it */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  // Static-ish reads. Retried on each poll until they land, then left alone: the
  // public configuration carries protocol constants and the health route carries
  // whether the registry has credentials at all, neither of which changes under a
  // running process.
  useEffect(() => {
    if (connection !== "live") return;
    if (!wellKnown) getWellKnown().then(setWellKnown).catch(() => setWellKnown(null));
    if (!health) getHealth().then(setHealth).catch(() => setHealth(null));
  }, [connection, wellKnown, health]);

  const rows = useMemo(
    () => (state ? buildRows(state, Math.floor(nowMs / 1000)) : []),
    [state, nowMs],
  );
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const footer = useMemo(() => (state ? buildFooter(state) : null), [state]);

  // An expansion that no longer names anything closes itself, rather than holding
  // a magnet the registry has stopped serving.
  useEffect(() => {
    if (opened && !rows.some((r) => r.magnet === opened)) setOpened(null);
  }, [rows, opened]);

  const openedArtifact = state?.artifacts.find((a) => a.manifest.magnet === opened) ?? null;

  /** Open an artifact from another desk: switch to the overview and expand it. */
  const openArtifact = useCallback((magnet: string) => {
    setOpened(magnet);
    setView("overview");
    // Scroll is not an animation and is not gated by reduced motion here, because
    // `scroll-behavior: auto` is what the reduced-motion block already forces.
    requestAnimationFrame(() => {
      document.getElementById("swarm")?.scrollIntoView({ block: "start" });
    });
  }, []);

  // Which payees the screen is currently showing rows for. Only these are
  // fetched, and only in the scoped form.
  const artifactPayee = openedArtifact
    ? parseAuthor(openedArtifact.manifest.author).payoutAccount
    : null;
  /**
   * The payee the earnings desk needs, computed with the SAME rule
   * `EarningsDesk` uses to decide which author is open, so the two cannot
   * disagree about who is on screen.
   *
   * It used to be an independent search against `selectedAuthor ??
   * SELF_AUTHOR_ACCOUNT`. With no author selected and no operator author
   * configured that comparand is null, and an author whose string does not follow
   * this registry's convention also parses to a null payout account, so the
   * search matched the first unparseable author and yielded a payee of null.
   * Nothing was then fetched, and the payouts panel, the one the view exists for,
   * sat on a loading message for ever. One derivation, shared, is the only
   * version of this that cannot drift.
   */
  const earningsPayee = useMemo(() => {
    if (!state) return null;
    const seeders = buildSeeders(state);
    const current =
      findSeeder(seeders, selectedAuthor) ??
      findSeeder(seeders, SELF_AUTHOR_ACCOUNT) ??
      seeders[0] ??
      null;
    return current?.identity.payoutAccount ?? null;
  }, [state, selectedAuthor]);

  const wantedPayees = useMemo(() => {
    const set = new Set<string>();
    if (artifactPayee) set.add(artifactPayee);
    if (view === "earnings" && earningsPayee) set.add(earningsPayee);
    return [...set];
  }, [artifactPayee, earningsPayee, view]);

  // The poll reads this ref rather than closing over state, so changing the
  // selection never has to rebuild the interval.
  useEffect(() => {
    payeesRef.current = wantedPayees;
    const unread = wantedPayees.filter((p) => payouts[p] === undefined);
    if (unread.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const fetched = await Promise.all(unread.map((payee) => getPayouts(payee)));
        if (cancelled) return;
        setPayouts((prev) => {
          const next = { ...prev };
          unread.forEach((payee, i) => {
            next[payee] = fetched[i]!;
          });
          return next;
        });
        setPayoutsError(null);
        setBatches(await getBatches().catch(() => []));
      } catch (e) {
        if (!cancelled) setPayoutsError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantedPayees, payouts]);

  const liveCount = rows.filter((r) => r.live).length;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        view={view}
        onView={setView}
        connection={connection}
        detail={connectionDetail}
        pollSeconds={POLL_MS / 1000}
      />

      <main className="flex-1">
        {connection === "connecting" && !state && <Connecting />}
        {connection === "offline" && !state && <RegistryOffline detail={connectionDetail} />}
        {connection === "error" && !state && <RegistryError detail={connectionDetail ?? "unknown"} />}

        {state && connection !== "live" && (
          <StaleBanner detail={connectionDetail} lastGoodMs={lastGoodMs} />
        )}

        {state && view === "overview" && (
          <>
            {/*
              The masthead: one dominant idea per viewport, which is the
              reference's pacing rule and the opposite of what this route used to
              do. It opened on a single line of orientation prose and then went
              straight into a table, which read as a fragment of a page rather
              than as the top of one.
            */}
            <Frame className="pt-14 sm:pt-20">
              <OverviewMasthead
                connection={connection}
                detail={connectionDetail}
                pollSeconds={POLL_MS / 1000}
                health={health}
                artifactCount={state.artifacts.length}
                liveCount={liveCount}
                onView={setView}
              />
            </Frame>

            {/*
              The transition between the masthead and the table. Static squares,
              not drifting ones: the reference animates its particle fields and
              decorative motion is a product-register ban, so this is the shape
              without the movement. `trace`, never `ember`: nothing but decay is
              allowed to be amber.
            */}
            <Frame className="pointer-events-none relative mt-16 h-24 sm:h-28">
              <Particles count={30} className="opacity-70" />
            </Frame>

            <Frame>
              <Section
                id="swarm"
                node="22%"
                eyebrow="The swarm"
                title={
                  <>
                    Everything on this registry{" "}
                    <span className="font-normal text-ink-soft">
                      ({rows.length}, {liveCount} on sale)
                    </span>
                  </>
                }
                lede={
                  state.artifacts.length === 0
                    ? "Nothing is published here yet."
                    : "Open any row for the detail. Each gap in the life bar is one halving."
                }
                right={
                  /* No column toggle over an empty table: a control that cannot
                     change anything is worse than no control. */
                  state.artifacts.length === 0 ? undefined : (
                    <Button
                      onClick={() => setShowEveryColumn((v) => !v)}
                      aria-pressed={showEveryColumn}
                    >
                      {showEveryColumn ? "Fewer columns" : "Every column"}
                    </Button>
                  )
                }
              >
                {state.artifacts.length === 0 ? (
                  <EmptySwarm onView={setView} />
                ) : (
                  <>
                    <SwarmTable
                      rows={sorted}
                      state={state}
                      wellKnown={wellKnown}
                      nowMs={nowMs}
                      opened={opened}
                      onOpen={setOpened}
                      sort={sort}
                      onSort={setSort}
                      showEveryColumn={showEveryColumn}
                      payoutsFor={artifactPayee ? payouts[artifactPayee] ?? null : null}
                      batches={batches}
                    />
                    <div className="mt-6">
                      <RegistryTotals footer={footer} health={health} />
                    </div>
                  </>
                )}
              </Section>
            </Frame>
          </>
        )}

        {state && view !== "overview" && (
          <Frame className="pt-8">
            <BackToOverview onView={setView} />
            <div className="mt-8">
              {view === "find" && <FindDesk wellKnown={wellKnown} />}
              {view === "earnings" && (
                <EarningsDesk
                  state={state}
                  wellKnown={wellKnown}
                  nowMs={nowMs}
                  payouts={earningsPayee ? payouts[earningsPayee] ?? null : null}
                  payoutsError={payoutsError}
                  batches={batches}
                  selectedAuthor={selectedAuthor}
                  onSelectAuthor={setSelectedAuthor}
                  onOpenArtifact={openArtifact}
                />
              )}
              {view === "activity" && (
                <ActivityDesk
                  // The store holds 200; this renders the newest 80. Both caps are
                  // here rather than in the component, so a panel never quietly
                  // becomes the source of truth for how much history exists.
                  events={recentEvents(events, 80)}
                  cursorSeconds={cursorShown}
                  error={eventError}
                  pollSeconds={POLL_MS / 1000}
                  eventLookbackSeconds={EVENT_LOOKBACK_SECONDS}
                />
              )}
              {view === "evidence" && <EvidenceDesk state={state} wellKnown={wellKnown} />}
              {view === "join" && (
                <JoinDesk wellKnown={wellKnown} health={health} onView={setView} />
              )}
            </div>
          </Frame>
        )}
      </main>

      <PageFooter health={health} />
    </div>
  );
}
