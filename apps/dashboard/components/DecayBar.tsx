/**
 * The decay bar. The one element here doing conceptual work rather than
 * reporting a number, and the only thing in the interface allowed to be amber.
 *
 * Preserved wholesale, twice over now: it survived the previous rebuild because
 * it was the part that worked, and it survives this one unchanged in substance
 * because the brief that introduced the reference said so in as many words. The
 * `ember` fill, the half-life gradations, the hatched dead zone and the drain
 * head are all exactly what they were.
 *
 * Two things the reference did change. The track is a pill rather than a
 * rectangle, which is the one place its 41px radius applies to something that is
 * not a button (CSS clamps a radius to half the shorter side, so a 12px-tall bar
 * gets a 6px cap and a 24px-tall one gets 12px). And the track fill moved from
 * `well`, a grey, to `plate`, the cyan inset the whole product now uses — so the
 * empty half of the bar belongs to the same family as the ground it sits on.
 *
 * It is also given MORE room than before: the row form is wider, the panel form
 * runs the full width of an opened artifact, and the axis labels are legible type
 * instead of chrome.
 *
 * ## What makes it not a progress bar
 *
 * A torrent's progress bar fills toward completion. This one **drains** toward
 * expiry, and that inversion is instantly legible to anyone who has ever watched
 * a download, which is the right feeling for a product where every asset is
 * dying.
 *
 * Three things sit on top of "a bar with a percentage", because a bare fraction
 * cannot answer the question an author actually has ("how long have I got?"):
 *
 * 1. **Half-life gradations.** Hairlines at ½, ¼ and ⅛ freshness. Not
 *    decoration: each gap is exactly one half-life, so a reader sees how many
 *    halvings are left rather than a percentage whose rate of change they have
 *    to guess. A torrent client draws piece boundaries; here the pieces are
 *    half-lives.
 * 2. **The dead zone.** Below ⅛ (`@carpool/core`'s `isExpired` threshold, three
 *    half-lives) the track is hatched, so the end of the artifact's sellable
 *    life is visible from the day it is published.
 * 3. **The drain head.** A 2px edge at the fill boundary: the one moving part,
 *    so the eye goes to what is changing rather than to the bar.
 *
 * ## Every number here is the registry's
 *
 * `freshness` arrives computed by the registry, on the registry's clock, in the
 * same response as the price beside it. This component never re-derives it; the
 * CSS transition only interpolates between one poll's value and the next. The
 * expiry estimate is `3 × halfLifeDays − ageDays`: a subtraction between the
 * served age and a constant inside the signed manifest, both server-side, so the
 * countdown cannot drift from the price next to it.
 */
"use client";

import {
  EXPIRY_FRESHNESS,
  HALF_LIFE_TICKS,
  daysToExpiry,
  decayStage,
  halfLivesElapsed,
} from "../lib/decay";
import { fmtDays } from "../lib/format";
import { Caveat } from "./primitives";

const STAGE_FILL: Record<ReturnType<typeof decayStage>, string> = {
  fresh: "bg-ember-soft",
  halved: "bg-ember-mid",
  dying: "bg-ember",
  expired: "bg-ember",
};

const STAGE_WORD: Record<ReturnType<typeof decayStage>, string> = {
  fresh: "within the first half-life",
  halved: "past one half-life",
  dying: "past two half-lives",
  expired: "past three half-lives, expired",
};

/** The plain-language stage, so hue is never the only carrier of this meaning. */
export const STAGE_LABEL: Record<ReturnType<typeof decayStage>, string> = {
  fresh: "fresh",
  halved: "halved",
  dying: "dying",
  expired: "expired",
};

function Track({
  freshness,
  height,
  showTicks,
}: {
  freshness: number;
  height: string;
  showTicks: boolean;
}) {
  const f = Math.max(0, Math.min(1, freshness));
  const stage = decayStage(f);
  return (
    <span className={`relative block ${height} w-full overflow-hidden rounded-full bg-plate`}>
      {/* The fill. Drains right to left as freshness falls. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 transition-[width] duration-drain ease-out ${STAGE_FILL[stage]}`}
        style={{ width: `${f * 100}%` }}
      />
      {/*
        The dead zone, drawn OVER the fill rather than under it. Under it, the
        hatching was invisible on everything that had not already expired, which
        is the exact opposite of the point: the end of an artifact's sellable life
        has to be visible on the day it is published, not only on the day it
        arrives.
      */}
      <span
        aria-hidden="true"
        className="dead-zone absolute inset-y-0 left-0"
        style={{ width: `${EXPIRY_FRESHNESS * 100}%` }}
      />
      {/* The drain head: the one moving part. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-[2px] bg-ember transition-[left] duration-drain ease-out"
        style={{ left: `calc(${f * 100}% - 1px)` }}
      />
      {showTicks &&
        HALF_LIFE_TICKS.map((t) => (
          <span
            key={t}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-paper"
            style={{ left: `${t * 100}%` }}
          />
        ))}
    </span>
  );
}

/**
 * The table-row form. Wider and taller than the old one (128px, 12px) because
 * the whole point of this redesign is that the column reads as one picture
 * across thirty rows, and the stage word travels with it so the meaning is never
 * carried by hue alone.
 */
export function DecayBarRow({ freshness, dark = false }: { freshness: number; dark?: boolean }) {
  const f = Math.max(0, Math.min(1, freshness));
  const stage = decayStage(f);
  return (
    <span className="flex items-center gap-3">
      <span
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)}
        aria-label={`freshness remaining, ${STAGE_WORD[stage]}`}
        className="block w-28 shrink-0 sm:w-32"
      >
        <Track freshness={f} height="h-3" showTicks />
      </span>
      <span
        className={`tnum w-8 shrink-0 text-right font-mono text-xs ${dark ? "text-ink-lift" : "text-ink-soft"}`}
      >
        {Math.round(f * 100)}%
      </span>
    </span>
  );
}

/**
 * The opened form: the bar at full width with its half-life axis labelled, the
 * elapsed half-lives, and the expiry estimate in plain words.
 */
export function DecayBarPanel({
  freshness,
  halfLifeDays,
  ageDays,
  /**
   * Set when this sits on the solid `ink` panel an expanded artifact opens with.
   * Only the three light-on-dark tokens the palette audit measures on `ink` are
   * used: `paper`, `ink-lift` and `ember-soft`.
   */
  dark = false,
}: {
  freshness: number;
  halfLifeDays: number;
  /** Days since producedAt, on the REGISTRY's clock. Served, never derived here. */
  ageDays: number;
  dark?: boolean;
}) {
  const f = Math.max(0, Math.min(1, freshness));
  const elapsed = halfLivesElapsed(f);
  const daysLeft = daysToExpiry(ageDays, halfLifeDays);
  const stage = decayStage(f);
  const soft = dark ? "text-ink-lift" : "text-ink-soft";
  const strong = dark ? "text-paper" : "text-ink";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-3">
        <h4 className={`label text-2xs ${dark ? "text-ink-lift" : "text-ink-faint"}`}>
          How much life is left
        </h4>
        <p className={`tnum font-mono text-sm ${soft}`}>
          <span className={strong}>{(f * 100).toFixed(1)}% fresh</span>
          {Number.isFinite(elapsed) ? `, ${elapsed.toFixed(2)} half-lives in` : ", expired"}
        </p>
      </div>

      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)}
        aria-label={`freshness remaining, ${STAGE_WORD[stage]}`}
      >
        <Track freshness={f} height="h-6" showTicks />
      </div>

      {/* The axis. Positions are the half-life boundaries the ticks mark. */}
      <div className={`relative mt-2 h-5 select-none font-mono text-xs ${soft}`} aria-hidden="true">
        <span className="absolute left-0">gone</span>
        {HALF_LIFE_TICKS.map((t, i) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${t * 100}%` }}>
            {["½", "¼", "⅛"][i]}
          </span>
        ))}
        <span className="absolute right-0">new</span>
      </div>

      <p className={`measure mt-5 text-base ${soft}`}>
        Each tick is one halving of the half-life its author set:{" "}
        <span className={`font-mono ${strong}`}>
          {halfLifeDays} {halfLifeDays === 1 ? "day" : "days"}
        </span>
        . Hatched below ⅛ is expired.
      </p>
      <Caveat summary="Why the gaps shrink" dark={dark} className="mt-3">
        <p>
          The scale is linear in freshness, so every gap is half the width of the one before it. The
          decay is in the spacing, not in the colour.
        </p>
      </Caveat>
      <p className={`measure mt-2 text-base ${soft}`}>
        It is <span className={`tnum font-mono ${strong}`}>{fmtDays(ageDays)}</span> old on the
        registry&rsquo;s clock
        {daysLeft > 0 ? (
          <>
            {" "}
            and crosses ⅛ in <span className={`tnum font-mono ${strong}`}>{fmtDays(daysLeft)}</span>.
          </>
        ) : (
          <>
            {" "}
            and crossed ⅛ <span className={`tnum font-mono ${strong}`}>{fmtDays(-daysLeft)}</span> ago.
          </>
        )}{" "}
        Age, freshness and price come off the same clock, so the three on this screen cannot
        contradict each other.
      </p>
    </div>
  );
}
