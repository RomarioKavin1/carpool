/**
 * The explainer's drawings. Five beats, hand-authored SVG, no animation library.
 *
 * ## How the motion works, and why it cannot hide the explanation
 *
 * Every animated element's RESTING state is its finished state. The start frame
 * exists only under `.beat[data-in="false"]`, and `components/Explainer.tsx`
 * writes that attribute only when `prefers-reduced-motion` is false. So three
 * different readers see three different things happen and the same thing drawn:
 *
 * - motion allowed, JS running: the beat plays once as it scrolls into view;
 * - reduced motion: the finished drawing, immediately, no transition;
 * - no JS at all, or a slow hydrate: the finished drawing, immediately.
 *
 * The classes are declared in `app/globals.css`. `fx-rise`, `fx-fade`, `fx-pop`,
 * `fx-wipe`, `fx-draw` and `fx-ship` animate forward into the resting state;
 * `fx-unwind` and `fx-vanish` are the two that run backwards, for the duplicated
 * work that beat 3 removes — their resting state is "gone", which is the correct
 * finished frame.
 *
 * `--i` is the stagger index (× 90ms). Fractions are fine and are used where a
 * run of sixteen elements would otherwise take a second and a half to land.
 *
 * ## Why the labels are in HTML and not in the SVG
 *
 * A 640-unit viewBox scaled into a 328px column is a factor of 0.51, which turns
 * 14px type into 7px. Every readable word and number on this page is HTML beside
 * the drawing rather than `<text>` inside it, so it stays at its real size, wraps,
 * and is selectable. The SVG carries shape and position only. The two exceptions
 * are none.
 */
import { SETTLED } from "../lib/evidence";

/** Shared stroke geometry, so six drawings cannot disagree about line weight. */
const HAIR = 1.5;
const LINE = 3;

/* ------------------------------------------------------------------ beat 1 */

/**
 * One agent's lane: the work it does, from nothing to done.
 *
 * `preserveAspectRatio="none"` is deliberate and safe here: everything in this
 * viewBox is a horizontal bar, so the only distortion an x-stretch can cause is
 * to bar length, which is what a bar is for. Nothing round, nothing diagonal.
 */
export function LaneTrack({ i }: { i: number }) {
  return (
    <svg
      viewBox="0 0 400 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-3 w-full"
    >
      <rect x="0" y="4" width="400" height="4" className="fill-plate" />
      <rect
        x="0"
        y="4"
        width="400"
        height="4"
        className="beat-fx fx-wipe fill-trace"
        style={{ "--i": i, "--dur": "1100ms" } as React.CSSProperties}
      />
      {/* The grind: identical steps, repeated. Drawn in the ground colour over
          the fill, so the bar reads as work done in passes rather than as a
          progress meter that happens to be blue. */}
      <g
        className="beat-fx fx-fade"
        style={{ "--i": i + 1, "--dur": "1100ms" } as React.CSSProperties}
      >
        {[...Array(9)].map((_, k) => (
          <rect key={k} x={38 + k * 40} y="4" width="4" height="4" className="fill-field" />
        ))}
      </g>
    </svg>
  );
}

/** The thing an agent ends up holding. Six of these are identical, which is beat 1. */
export function Result({ i, vanish = false }: { i: number; vanish?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path
        d="M8 1.5 14.5 8 8 14.5 1.5 8Z"
        className={`beat-fx fill-ink ${vanish ? "fx-vanish" : "fx-pop"}`}
        style={{ "--i": i } as React.CSSProperties}
      />
    </svg>
  );
}

/** The agent itself. A square, because it is one process and not a person. */
export function AgentMark({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        fill="none"
        strokeWidth="2"
        className="beat-fx fx-pop stroke-ink-soft"
        style={{ "--i": i } as React.CSSProperties}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ beat 2 */

/** The first sixteen nibbles of the real magnet, as a filled/hollow grid. */
function nibbles(): boolean[] {
  const hex = SETTLED.magnet.replace(/^swarm:/, "").slice(0, 16);
  return [...hex].map((c) => parseInt(c, 16) >= 8);
}

/**
 * Beat 2. A body of work collapses through a hash and comes out as an address.
 *
 * The sixteen cells are not decorative: they are the first sixteen hex digits of
 * the artifact that actually sold, one cell per digit, filled when the digit is
 * ≥ 8. The same string is printed underneath in the page, so the drawing and the
 * text are the same fact twice.
 */
export function PublishArt() {
  const cells = nibbles();
  return (
    <svg viewBox="0 0 640 240" aria-hidden="true" className="h-auto w-full">
      {/* The body: what the author actually wrote. */}
      {[0, 1, 2, 3, 4, 5, 6].map((r) => (
        <line
          key={r}
          x1="24"
          y1={48 + r * 24}
          x2={24 + [186, 150, 202, 120, 178, 138, 96][r]!}
          y2={48 + r * 24}
          pathLength="100"
          strokeWidth={HAIR}
          strokeLinecap="square"
          className="beat-fx fx-draw stroke-ink-soft"
          style={{ "--i": r * 0.5, "--dur": "500ms" } as React.CSSProperties}
        />
      ))}

      {/* The hash. One wedge, drawn once: everything on the left becomes the one
          address on the right, and it only goes this way. */}
      <path
        d="M268 74 336 120 268 166"
        fill="none"
        pathLength="100"
        strokeWidth={LINE}
        strokeLinejoin="miter"
        className="beat-fx fx-draw stroke-trace"
        style={{ "--i": 4, "--dur": "600ms" } as React.CSSProperties}
      />

      {/* The artifact: one solid object, the only dark mass on the page. */}
      <rect
        x="368"
        y="56"
        width="248"
        height="128"
        rx="10"
        className="beat-fx fx-pop fill-ink"
        style={{ "--i": 5, "--origin": "center", "--dur": "620ms" } as React.CSSProperties}
      />
      {cells.map((on, k) => {
        const col = k % 8;
        const row = k < 8 ? 0 : 1;
        return (
          <rect
            key={k}
            x={388 + col * 26}
            y={84 + row * 40}
            width="18"
            height="18"
            fill={on ? "var(--paper)" : "none"}
            stroke="var(--paper)"
            strokeWidth={HAIR}
            className="beat-fx fx-pop"
            style={{ "--i": 6 + k * 0.28, "--origin": "center", "--dur": "420ms" } as React.CSSProperties}
          />
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ beat 3 */

/** Where each of the five buyers starts, and the curve it takes to the artifact. */
const REUSERS = [
  { y: 28, curve: "M64 28 C 232 28, 260 96, 404 116" },
  { y: 82, curve: "M64 82 C 232 82, 268 110, 404 128" },
  { y: 190, curve: "M64 190 C 232 190, 268 162, 404 144" },
  { y: 244, curve: "M64 244 C 232 244, 260 176, 404 156" },
  { y: 298, curve: "M64 298 C 244 298, 268 190, 404 164" },
] as const;

/** Where the artifact sits, in beat 3's coordinates. */
const OBJECT = { x: 404, y: 100, w: 212, h: 80 } as const;

/**
 * Beat 3. The five parallel paths stop being parallel.
 *
 * Two motions run against each other on purpose. The straight stubs are the work
 * beat 1 showed, and they RETRACT (`fx-unwind`, resting state: gone). The curves
 * are the ask, and they DRAW. The five duplicate results fade out as the five
 * payments arrive at the one that already exists. The finished frame is five
 * curves into one object, which is the whole product in one picture.
 */
export function ReuseArt() {
  const cells = nibbles().slice(0, 8);
  return (
    <svg viewBox="0 0 640 332" aria-hidden="true" className="h-auto w-full">
      {REUSERS.map((r, k) => (
        <g key={r.y}>
          {/* the work not done */}
          <line
            x1="64"
            y1={r.y}
            x2="300"
            y2={r.y}
            pathLength="100"
            strokeWidth={LINE}
            strokeDasharray="100"
            className="beat-fx fx-unwind stroke-trace"
            style={{ "--i": k * 0.4, "--dur": "700ms" } as React.CSSProperties}
          />
          {/* the duplicate result it would have produced */}
          <path
            d={`M316 ${r.y - 7} 323 ${r.y} 316 ${r.y + 7} 309 ${r.y}Z`}
            className="beat-fx fx-vanish fill-ink"
            style={{ "--i": k * 0.4, "--dur": "500ms" } as React.CSSProperties}
          />
          {/* the ask */}
          <path
            d={r.curve}
            fill="none"
            pathLength="100"
            strokeWidth={LINE}
            strokeLinecap="round"
            className="beat-fx fx-draw stroke-trace"
            style={{ "--i": 3 + k * 0.6, "--dur": "900ms" } as React.CSSProperties}
          />
          {/* the agent that asked */}
          <rect
            x="44"
            y={r.y - 8}
            width="16"
            height="16"
            fill="none"
            strokeWidth="2"
            className="stroke-ink-soft"
          />
          {/* What it paid: authored at the artifact, in its own slot, and
              starting back at the agent. Five slots rather than one point, so
              the finished frame shows five payments arriving and not a single
              square that five things flew into. */}
          <rect
            x={OBJECT.x - 20}
            y={OBJECT.y + 12 + k * 14}
            width="10"
            height="10"
            className="beat-fx fx-ship fill-credit"
            style={
              {
                "--i": 6 + k * 0.5,
                "--dur": "1000ms",
                "--fx-x": `${64 - (OBJECT.x - 20)}px`,
                "--fx-y": `${r.y - 5 - (OBJECT.y + 12 + k * 14)}px`,
              } as React.CSSProperties
            }
          />
        </g>
      ))}

      <rect
        x={OBJECT.x}
        y={OBJECT.y}
        width={OBJECT.w}
        height={OBJECT.h}
        rx="10"
        className="fill-ink"
      />
      {cells.map((on, k) => (
        <rect
          key={k}
          x={OBJECT.x + 18 + k * 24}
          y={OBJECT.y + 30}
          width="16"
          height="16"
          fill={on ? "var(--paper)" : "none"}
          stroke="var(--paper)"
          strokeWidth={HAIR}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ beat 4 */

/**
 * Beat 4. The decay bar, in the same visual language as the app's.
 *
 * Everything that makes `components/DecayBar.tsx` work is preserved: the axis is
 * linear in freshness, so the gradations at ½, ¼ and ⅛ are one halving apart BY
 * CONSTRUCTION and each gap is half the width of the one before it; below ⅛ the
 * track is hatched, so the end of the artifact's sellable life is visible from
 * the day it is published; and one 3-unit head marks the moving edge.
 *
 * The drain's keyframes are linear in time and geometric in width — equal thirds,
 * one halving each. That is the claim the beat is making, so the timing function
 * is not allowed to editorialise over it.
 */
export function DecayArt() {
  return (
    <svg
      viewBox="0 0 1000 56"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-14 w-full"
    >
      <defs>
        <pattern id="carpool-dead" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M-2 2 2 -2M0 10 10 0M8 12 12 8" strokeWidth="2.4" stroke="var(--hatch)" />
        </pattern>
      </defs>

      {/* the track: what is already gone. A shade off the plate rather than
          paper-bright, so the empty part of the bar recedes instead of reading
          as a second full bar pointing the other way. */}
      <rect
        x="1"
        y="14"
        width="998"
        height="28"
        strokeWidth="2"
        className="fill-field stroke-rule-firm"
      />
      {/* the fill: what is left to sell */}
      <rect
        x="0"
        y="14"
        width="1000"
        height="28"
        className="beat-fx fx-drain fill-ember"
      />
      {/* the dead zone, drawn OVER the fill: an artifact below ⅛ stops selling,
          and that boundary has to be visible on day zero, not only on day three */}
      <rect x="0" y="14" width="125" height="28" fill="url(#carpool-dead)" />
      <rect
        x="0"
        y="14"
        width="125"
        height="28"
        fill="none"
        strokeWidth="2"
        className="stroke-debit"
      />
      {/* the halvings */}
      {[500, 250, 125].map((x) => (
        <rect key={x} x={x - 1} y="14" width="2" height="28" className="fill-paper" />
      ))}
      <rect x="0" y="8" width="3" height="40" className="beat-fx fx-drain-head fill-ink" />
    </svg>
  );
}

/* ------------------------------------------------------------------ beat 5 */

/**
 * Beat 5. Two transfers and a hold, drawn flat.
 *
 * Deliberately the plainest drawing on the page. This is the one literal fact
 * here — money reached an account on a public ledger — and abstracting it into
 * a flourish would be the exact move this project's honesty rules exist to stop.
 * Three nodes, two segments, two payments that travel once.
 */
export function SettlementArt() {
  return (
    <svg viewBox="0 0 640 96" aria-hidden="true" className="h-auto w-full">
      <line
        x1="48"
        y1="48"
        x2="592"
        y2="48"
        pathLength="100"
        strokeWidth={HAIR}
        className="beat-fx fx-draw stroke-ink-faint"
        style={{ "--dur": "700ms" } as React.CSSProperties}
      />

      {/* buyer */}
      <rect x="24" y="32" width="32" height="32" rx="4" fill="none" strokeWidth="2" className="stroke-ink" />
      {/* the registry, and the 120-second hold it exists to make possible */}
      <rect x="288" y="24" width="64" height="48" rx="6" className="fill-ink" />
      <rect x="304" y="36" width="32" height="24" fill="none" strokeWidth="2" stroke="var(--paper)" />
      {/* author */}
      <rect x="584" y="32" width="32" height="32" rx="4" className="fill-credit" />

      {/* the buyer's payment, authored at the registry */}
      <rect
        x="276"
        y="40"
        width="16"
        height="16"
        className="beat-fx fx-ship fill-credit"
        style={{ "--i": 2, "--dur": "1000ms", "--fx-x": "-216px" } as React.CSSProperties}
      />
      {/* the settlement transfer, authored at the author */}
      <rect
        x="562"
        y="40"
        width="16"
        height="16"
        className="beat-fx fx-ship fill-credit"
        style={{ "--i": 6, "--dur": "1000ms", "--fx-x": "-210px" } as React.CSSProperties}
      />
    </svg>
  );
}
