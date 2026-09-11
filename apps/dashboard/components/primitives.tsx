/**
 * The shared vocabulary, rebuilt around the reference the user named.
 *
 * ## What changed, and what did not
 *
 * Two rules in `DESIGN.md` are reversed here, on the user's explicit
 * instruction, and `DESIGN.md` records the reversal rather than being left to
 * contradict this file:
 *
 * - **"No `border-radius` above 2px"** is gone. Radii are 12px and 14px for
 *   panels, 8px for chips and 41px for pills, which are the values measured off
 *   the reference page rather than guessed.
 * - **"No cards, ever"** is gone. The reference is built out of rounded panels,
 *   so this build is too. What survives from that rule is the part that was
 *   actually about craft: panels here are asymmetric and varied in size, never a
 *   uniform three-across grid of the same box, and they are never nested two
 *   deep for decoration.
 *
 * Everything else holds, and one rule is new:
 *
 * 1. **Nothing is outlined by a border.** The reference has no borders at all —
 *    measured, zero elements with a non-zero border width. Separation is fill,
 *    whitespace, and hairlines drawn as their own thing (`.hairline-b` in
 *    `app/globals.css` paints exactly the 1px edge a border would, and is not
 *    one). Every chip, button, input and band below is a fill.
 * 2. **Whitespace by sequencing.** Unchanged, and more of it: the jump from 96px
 *    between regions to 14px between rows is what makes a region read as a region
 *    without drawing a box around it.
 * 3. **Plain words outside, exact words inside.** `Term` is still the only thing
 *    allowed to introduce vocabulary, and it still carries its own definition.
 * 4. **Every number says where it came from.** `Mark` and `NoData` are not
 *    decoration; a figure without one is a defect.
 * 5. **Every interactive component ships all seven states.** default, hover,
 *    focus, active, disabled, loading, error. `Button` and `Field` are the only
 *    two shapes in the app, so "the save button looks different in two places"
 *    cannot happen.
 * 6. **No alpha on text or on a fill behind text.** Solid `*-wash` tokens
 *    instead, so every foreground/background pair can be enumerated and
 *    measured — now on the dark panels as well, which is why `lib/tokens.test.ts`
 *    grew a second contrast family rather than an exemption.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PROVENANCE_LABEL, PROVENANCE_MEANING, type Provenance } from "../lib/measured";

/* ------------------------------------------------------------------ layout */

/**
 * The page's horizontal frame. One element owns the side gutter, so the gutter
 * cannot disagree with itself between regions, and `minmax(0, …)` discipline
 * below can assume it.
 */
export function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1320px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

/**
 * The raised panel. The reference's central material: a filled rectangle with a
 * 12–14px radius sitting on the ground, with no stroke around it and no shadow
 * under it.
 *
 * Five tones, and each one means something rather than being a shade:
 *
 * - `raised` — `paper` on the `field` ground. The default surface for content.
 * - `inset` — `plate`. A region inside a raised panel, or a quiet region on the
 *   ground.
 * - `dark` — a solid `ink` mass. The counterpoint, used where a thing must be
 *   unmistakably a different kind of thing from the light rows around it. Only
 *   `paper`, `ink-lift` and `ember-soft` may carry type on it, and all three are
 *   measured on it in `lib/tokens.test.ts`.
 * - `ember` / `debit` / `credit` / `wire` — the wash fills, for a state that has
 *   to be readable as a state and not only as a sentence.
 *
 * No shadow on any of them, deliberately: the reference's panels do carry a soft
 * one, and the fill step from `field` (94.6% L) to `paper` (98.4%) already
 * separates them without a shadow colour that would have to be an alpha value,
 * which this palette does not allow.
 */
export function Panel({
  tone = "raised",
  radius = "lg",
  children,
  className = "",
  id,
}: {
  tone?: "raised" | "inset" | "dark" | "ember" | "debit" | "credit" | "wire" | "quiet";
  radius?: "md" | "lg" | "xl";
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const fill = {
    raised: "bg-paper text-ink",
    quiet: "bg-panel text-ink",
    inset: "bg-plate text-ink",
    dark: "bg-ink text-paper",
    ember: "bg-ember-wash text-ink",
    debit: "bg-debit-wash text-ink",
    credit: "bg-credit-wash text-ink",
    wire: "bg-wire-wash text-ink",
  }[tone];
  const r = { md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl" }[radius];
  return (
    <div id={id} className={`min-w-0 ${fill} ${r} ${className}`}>
      {children}
    </div>
  );
}

/**
 * The crosshair. A horizontal hairline with a vertical one crossing it at a
 * solid square node, both running past the content they bound.
 *
 * This replaces the full-width `border-t` that used to open every region. It
 * does the same job — here is a boundary — and it does it the way the reference
 * does, which is the single most portable structural idea on that page: the rule
 * is not the edge of a box, it is a mark on the ground that the content happens
 * to sit under.
 *
 * `at` places the node. Varying it between regions is the point: a crosshair in
 * the same place every time is a border with extra steps.
 */
export function CrossRule({ at = "16%", className = "" }: { at?: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`relative h-px w-full bg-plate-line ${className}`}>
      <span className="absolute bottom-px block h-7 w-px bg-plate-line" style={{ left: at }} />
      <span className="absolute top-px block h-4 w-px bg-plate-line" style={{ left: at }} />
      <span className="node absolute top-[-2.5px]" style={{ left: `calc(${at} - 2.5px)` }} />
    </div>
  );
}

/**
 * A corner marker. The reference puts a small solid triangle, a plus or a caret
 * at the corner of a panel — a printer's registration mark rather than an icon,
 * and it is what keeps a large empty panel from reading as an unfinished div.
 *
 * Decorative and `aria-hidden` by construction: it never carries meaning, so
 * nothing is lost when it is not announced.
 */
export function CornerMark({
  kind = "triangle",
  className = "",
}: {
  kind?: "triangle" | "plus" | "caret";
  className?: string;
}) {
  const d = {
    triangle: "M0 12 12 12 0 0Z",
    plus: "M5.25 0h1.5v5.25H12v1.5H6.75V12h-1.5V6.75H0v-1.5h5.25Z",
    caret: "M0 0 12 6 0 12Z",
  }[kind];
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-2 w-2 fill-ink-faint ${className}`}>
      <path d={d} />
    </svg>
  );
}

/**
 * A particle field: small squares scattered across a region, used as a section
 * transition.
 *
 * Three properties worth stating, because each is a failure this avoids:
 *
 * 1. **Deterministic.** The positions come from a fixed linear congruential
 *    sequence evaluated once at module scope, so the server and the client draw
 *    the same field and React never reports a hydration mismatch. `Math.random()`
 *    here would be a hydration error on every load.
 * 2. **Static.** The reference drifts its particles. That is decorative motion,
 *    which the product register bans outright, so these do not move on either
 *    route — which also means there is nothing for `prefers-reduced-motion` to
 *    have to remove.
 * 3. **`trace`, not a second warm accent.** The reference's particles are its
 *    coral. `ember` is decay and nothing else here, so the field is `trace`
 *    everywhere except the one place where the particles ARE decay, which is
 *    where `tone="ember"` is used.
 */
const PARTICLES: { x: number; y: number; s: number }[] = (() => {
  let seed = 1337;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return [...Array(44)].map(() => ({
    x: Math.round(next() * 1000) / 10,
    y: Math.round(next() * 1000) / 10,
    s: 2 + Math.round(next() * 4),
  }));
})();

export function Particles({
  tone = "trace",
  className = "",
  count = 44,
}: {
  tone?: "trace" | "ember";
  className?: string;
  count?: number;
}) {
  const fill = tone === "ember" ? "bg-ember" : "bg-trace";
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      {PARTICLES.slice(0, count).map((p, i) => (
        <span
          key={i}
          className={`absolute block rounded-[1px] ${fill}`}
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }}
        />
      ))}
    </div>
  );
}

/**
 * The staggered display headline: the reference's loudest typographic move and
 * the one that carries best.
 *
 * Two or three lines of huge tight-tracked uppercase, each one indented further
 * than the last, with the final line dropped to a lighter value so the phrase
 * reads in two weights without any of it being a different size. On the
 * reference the drop is to grey; here it is `ink-faint`, which is the same idea
 * in this palette and is measured on every surface it can land on.
 *
 * Uppercase is safe here and only here: these are three to six words. The brand
 * register's ban is on all-caps BODY copy, and nothing below `deck` size is set
 * this way.
 */
export function Deck({
  lines,
  size = "deck",
  id,
  className = "",
}: {
  lines: [string, string?, string?];
  size?: "deck" | "hero" | "beat";
  id?: string;
  className?: string;
}) {
  const step = { deck: "text-deck", hero: "text-hero", beat: "text-beat" }[size];
  const indent = ["", "pl-[4%] sm:pl-[9%]", "pl-[8%] sm:pl-[18%]"];
  const present = lines.filter(Boolean) as string[];
  return (
    <h1 id={id} className={`${step} font-semibold uppercase text-ink ${className}`}>
      {present.map((line, i) => (
        <span
          key={line}
          className={`block ${indent[i]} ${i === present.length - 1 && present.length > 1 ? "text-ink-faint" : ""}`}
        >
          {line}
        </span>
      ))}
    </h1>
  );
}

/**
 * A major page region. A crosshair, a tight uppercase label, a heading that is
 * allowed to be quiet because the space around it is doing the work.
 *
 * `lede` is one plain sentence saying what the region is for. It is not a
 * restatement of the heading: a reader who understood the heading should still
 * learn something from the lede or it should not be there.
 */
export function Section({
  id,
  eyebrow,
  title,
  deck,
  lede,
  right,
  node = "16%",
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  /**
   * The staggered uppercase display headline, one per route or desk.
   *
   * It is the loudest thing this design system has, so it is rationed: the
   * opening region of a view gets it and every subordinate region below stays at
   * `text-2xl` sentence case. The reference uses the form on every section; a
   * working surface cannot spend 120px of vertical on each of five regions, and
   * "one dominant idea per viewport" is the part of its pacing that actually
   * transfers here.
   *
   * When it is set, `title` is still required and is what a screen reader and the
   * document outline get, so the visual break points never become the accessible
   * name.
   */
  deck?: [string, string?, string?];
  lede?: ReactNode;
  right?: ReactNode;
  /** Where this region's crosshair node sits. Varied on purpose between regions. */
  node?: string;
  children: ReactNode;
  className?: string;
}) {
  const lines = deck ? (deck.filter(Boolean) as string[]) : null;
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <CrossRule at={node} />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-10">
        <div className="min-w-0">
          {eyebrow && <p className="label mb-4 text-2xs text-ink-faint">{eyebrow}</p>}
          {lines ? (
            <h2 aria-label={typeof title === "string" ? title : undefined} className="text-deck font-semibold uppercase text-ink">
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
          ) : (
            <h2 className="text-2xl font-semibold text-ink">{title}</h2>
          )}
          {lede && (
            <p data-lede="" className="measure mt-5 text-base text-ink-soft">
              {lede}
            </p>
          )}
        </div>
        {/*
          `max-w-full` is load-bearing next to `shrink-0`. A flex item that
          refuses to shrink sizes to its own max-content, so a sentence in this
          slot laid itself out at 681px inside a 390px viewport and scrolled the
          document sideways. The cap lets prose wrap while a button, whose
          max-content is small, is unaffected.
        */}
        {right && <div className="min-w-0 max-w-full shrink-0">{right}</div>}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

/**
 * A region on a different ground, for a state that must be readable as a state.
 * It is now a rounded filled panel rather than a full-width ruled band: the
 * reference separates by fill, and a wash fill at a 14px radius says "this
 * paragraph is a warning" more plainly than two hairlines around it did.
 */
export function Band({
  tone = "panel",
  children,
  className = "",
}: {
  tone?: "panel" | "well" | "ember" | "debit" | "credit" | "wire";
  children: ReactNode;
  className?: string;
}) {
  const map = { panel: "quiet", well: "inset", ember: "ember", debit: "debit", credit: "credit", wire: "wire" } as const;
  return (
    <Panel tone={map[tone]} className={className}>
      {children}
    </Panel>
  );
}

/* ------------------------------------------------------------- provenance */

/**
 * The one-word stamp saying where a number came from.
 *
 * Deliberately dull-looking. It sits next to figures that would otherwise read
 * as authoritative, and the point is that a reader can tell a measured token
 * count from a self-reported dollar estimate from a price list without reading a
 * footnote. `title` carries the longer meaning; the same text is in `sr-only`
 * so it is not hover-only.
 *
 * A fill rather than an outline now, at the reference's 8px chip radius. The
 * three fills are `credit-wash`, `debit-wash` and `plate`, each of which is a
 * surface in the palette's own contrast audit.
 */
export function Mark({ kind, note }: { kind: Provenance; note?: string }) {
  const tone =
    kind === "live"
      ? "bg-credit-wash text-credit"
      : kind === "unobservable"
        ? "bg-debit-wash text-debit"
        : "bg-plate text-ink-soft";
  const meaning = note ? `${PROVENANCE_MEANING[kind]} ${note}` : PROVENANCE_MEANING[kind];
  return (
    <span
      className={`label inline-block shrink-0 rounded-sm px-2 py-0.5 font-mono text-2xs leading-[15px] ${tone}`}
      title={meaning}
    >
      {PROVENANCE_LABEL[kind]}
      <span className="sr-only">: {meaning}</span>
    </span>
  );
}

/* ------------------------------------------------------------- disclosure */

/**
 * Progressive disclosure on the platform's own element.
 *
 * `<details>` is keyboard operable, findable by in-page search when open, and
 * announced as a disclosure by a screen reader, so there is nothing to
 * re-implement and nothing to get wrong. The marker is a caret rotated by the
 * open state: a 150ms transform, not a layout animation.
 */
export function Disclosure({
  summary,
  dark = false,
  children,
  className = "",
}: {
  summary: string;
  /** On a solid `ink` panel the chip flips to `paper`, which is the only pair measured there. */
  dark?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group ${className}`}>
      <summary
        className={`flex w-fit cursor-pointer list-none items-center gap-3 rounded-full px-4 py-2 text-sm transition-colors duration-150 ease-out [&::-webkit-details-marker]:hidden ${
          dark
            ? "focus-light bg-paper text-ink hover:bg-plate"
            : "bg-paper text-ink hover:bg-plate"
        }`}
      >
        <Caret />
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/**
 * The qualification, one click away and never deleted.
 *
 * ## The rule this exists to keep
 *
 * Every number on both routes carries its provenance and its caveats. Earlier
 * builds carried that inline at full weight, so two to four sentences of
 * qualification sat under every panel and the qualification outweighed the thing
 * being qualified: the landing page ran to 1,108 words and eleven paragraphs
 * over thirty words, and a reader read neither the figure nor the caveat.
 *
 * The honesty does not change. Its placement does. A caveat lives in a `details`
 * whose `summary` is always visible next to what it qualifies, so:
 *
 * - a reader who wants the qualification reaches it in **one action**, by
 *   pointer, keyboard or screen reader;
 * - the page **never states a number without a visible marker** that a
 *   qualification exists (this chip, plus the `Mark` stamp beside every figure);
 * - nothing is **deleted** to hit a word budget, which is the one failure worse
 *   than the wall of text this replaced. `lib/prose-budget.test.ts` asserts a
 *   floor on how many words of caveat the routes carry, so a future pass cannot
 *   pass the budget by cutting the qualifications.
 */
export function Caveat({
  summary = "What this does not show",
  dark = false,
  children,
  className = "",
}: {
  summary?: string;
  dark?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`caveat group ${className}`}>
      <summary
        className={`label flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm px-2 py-1 text-2xs transition-colors duration-150 ease-out [&::-webkit-details-marker]:hidden ${
          dark
            ? "focus-light bg-paper text-ink hover:bg-plate"
            : "bg-plate text-ink-soft hover:bg-well hover:text-ink"
        }`}
      >
        <Caret small />
        {summary}
      </summary>
      <div
        className={`measure mt-3 space-y-3 text-sm ${dark ? "text-ink-lift" : "text-ink-soft"}`}
      >
        {children}
      </div>
    </details>
  );
}

function Caret({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`${small ? "h-1.5 w-1.5" : "h-2 w-2"} shrink-0 fill-current transition-transform duration-150 ease-out group-open:rotate-90`}
    >
      <path d="M0 0 12 6 0 12Z" />
    </svg>
  );
}

/**
 * An honest blank. Used wherever a number would be if the API served one. Never
 * a zero, never a bare dash: a plausible stand-in is worse than an empty state,
 * and this project has already retracted one fabricated measurement.
 */
export function NoData({ why, children }: { why: string; children?: ReactNode }) {
  return (
    <span className="text-ink-faint" title={why}>
      <span
        aria-hidden="true"
        className="cursor-help underline decoration-dotted decoration-ink-faint underline-offset-4"
      >
        {children ?? "not observable"}
      </span>
      <span className="sr-only">not observable: {why}</span>
    </span>
  );
}

/**
 * A figure with its label, its unit and its provenance.
 *
 * Not a card, and pointedly so: the impeccable ban on identical card grids is
 * the one part of "no cards, ever" that survives this pass intact, and four
 * figures in a row is exactly where a lazy build would draw four identical
 * boxes. They are separated by whitespace and by a tight uppercase label, and
 * nothing is drawn around them.
 */
export function Figure({
  label,
  value,
  sub,
  caveat,
  caveatSummary,
  kind,
  note,
  tone = "text-ink",
  size = "lg",
}: {
  label: string;
  value: ReactNode;
  /** One short line at most. Anything longer is a `caveat`, not a `sub`. */
  sub?: ReactNode;
  /** The qualification, behind a visible chip. Never inline, never deleted. */
  caveat?: ReactNode;
  caveatSummary?: string;
  kind: Provenance;
  note?: string;
  tone?: string;
  size?: "lg" | "xl";
}) {
  return (
    <div className="min-w-0 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label text-2xs text-ink-faint">{label}</span>
        <Mark kind={kind} note={note} />
      </div>
      <div className={`tnum mt-2 font-mono ${size === "xl" ? "text-2xl" : "text-xl"} ${tone}`}>
        {value}
      </div>
      {sub && <p className="measure mt-2 text-sm text-ink-soft">{sub}</p>}
      {caveat && (
        <Caveat summary={caveatSummary ?? "Caveat"} className="mt-3">
          {caveat}
        </Caveat>
      )}
    </div>
  );
}

/**
 * The exact word, with its plain-language meaning attached.
 *
 * `PRODUCT.md`'s third principle: plain words outside, exact words inside. A
 * newcomer must never have to learn `magnet`, `freshness` or `settledBatchId` to
 * read a headline, but the moment they open a detail the precise word should be
 * there with its definition, not instead of it.
 */
export function Term({ word, means }: { word: string; means: string }) {
  return (
    <span className="whitespace-nowrap">
      <abbr
        title={means}
        className="cursor-help font-mono text-[0.95em] no-underline decoration-dotted decoration-ink-faint underline-offset-4 [text-decoration-line:underline]"
      >
        {word}
      </abbr>
    </span>
  );
}

/* -------------------------------------------------------------- key/value */

/**
 * One labelled value. The hairline between rows is drawn with an inset shadow
 * rather than a border: a list of twelve facts needs a separator to be readable,
 * and the rule against borders is a rule against boxes drawn around things, not
 * against a drawn line between two rows.
 */
export function KV({ k, v, title, dark = false }: { k: string; v: ReactNode; title?: string; dark?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-2.5 text-sm last:shadow-none ${
        dark ? "hairline-b-field" : "hairline-b"
      }`}
    >
      <span className={`shrink-0 ${dark ? "text-ink-lift" : "text-ink-soft"}`} title={title}>
        {k}
      </span>
      {/*
        `overflow-wrap: anywhere`, and the distinction from the other two options
        is load-bearing in both directions.

        `break-all` breaks ordinary prose at whatever character it happens to
        reach, which rendered a normalised question as `…"units, stated once"
        establ / ish`. `break-words` fixes that but does NOT lower an element's
        min-content width, so a 71-character magnet inside a table cell set the
        table's intrinsic minimum to the width of that string: measured at 390px,
        expanding an artifact pushed `documentElement.scrollWidth` to 708 and the
        whole document scrolled 598px sideways.

        `anywhere` respects word boundaries when they exist AND counts toward
        min-content, so it is the only one of the three that satisfies both.
      */}
      <span
        className={`tnum min-w-0 text-right font-mono [overflow-wrap:anywhere] ${
          dark ? "text-paper" : "text-ink"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- tables */

/**
 * A column heading. Tight uppercase at chrome size, on the header strip's own
 * fill rather than above a rule.
 */
export function Th({
  children,
  right,
  title,
  onClick,
  active,
  dir,
  className = "",
}: {
  children: ReactNode;
  right?: boolean;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
  className?: string;
}) {
  const label = (
    <>
      {children}
      {active && (
        <span aria-hidden="true" className="ml-1 text-wire">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </>
  );
  return (
    <th
      scope="col"
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : onClick ? "none" : undefined
      }
      className={`label whitespace-nowrap px-3 py-3 text-2xs ${
        right ? "text-right" : "text-left"
      } ${active ? "text-ink" : "text-ink-soft"} ${className}`}
      title={title}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="rounded-xs transition-colors duration-150 ease-out hover:text-ink hover:underline"
        >
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function Td({
  children,
  right,
  dim,
  title,
  className = "",
  colSpan,
}: {
  children: ReactNode;
  right?: boolean;
  dim?: boolean;
  title?: string;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-3.5 align-middle ${right ? "tnum whitespace-nowrap text-right" : ""} ${
        dim ? "text-ink-soft" : ""
      } ${className}`}
      title={title}
    >
      {children}
    </td>
  );
}

/**
 * A table that may scroll horizontally INSIDE this container. The page may not.
 *
 * The table now lives inside a raised `paper` panel on the `field` ground, which
 * is the extension of the reference's language that this build had to invent:
 * the page has tables and the reference has none, so a table is treated as the
 * content of one large rounded panel rather than as a ruled grid on the page.
 * The panel's own radius clips the header strip's corners, which is why the
 * scroll container carries it.
 *
 * The affordance is explicit rather than assumed: at a width where the table is
 * wider than its container there is no way to know it scrolls, and on a phone the
 * price column was 565px off screen with nothing saying so.
 */
export function TableScroll({
  children,
  note,
  /**
   * A cap for tables whose columns have no natural slack-taker. Without it a
   * six-column ledger stretched to 1320px and opened 300px of gap between two
   * numeric columns, which reads as a layout accident rather than as air.
   */
  max,
  /**
   * Which fill the table's panel carries. `inset` is for a table nested inside
   * another raised panel, where a `paper` panel on a `paper` panel would be
   * invisible — the nesting is a content distinction, not a decorative one, and
   * a fill step is how it is made legible.
   */
  tone = "raised",
}: {
  children: ReactNode;
  note?: string;
  max?: string;
  tone?: "raised" | "inset";
}) {
  return (
    <div className={max ?? ""}>
      {/*
        The affordance goes ABOVE the table, not below it. Below a
        thirty-eight-row table it is three screens past the point where a reader
        needed it, which is the same as not having one.
      */}
      {note && (
        <p className="mb-2 text-sm text-ink-soft lg:hidden">
          <span aria-hidden="true">↔ </span>
          {note}
        </p>
      )}
      <div className={`overflow-x-auto rounded-lg ${tone === "inset" ? "bg-plate" : "bg-paper"}`}>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- controls */

/**
 * The only button shape in this app. Three weights, seven states, one geometry —
 * and the geometry is now a 41px pill, which is the reference's own button
 * radius measured off the page.
 *
 * Every weight is a FILL. None of them is outlined, which is what keeps the
 * control vocabulary consistent with the panels it sits on.
 *
 * `loading` renders the label plus a live region rather than replacing the
 * label with a spinner: a control that changes width while you are aiming at it
 * is worse than one that waits.
 */
export function Button({
  variant = "secondary",
  loading = false,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed";
  const tone = {
    primary:
      "bg-ink text-paper hover:bg-wire active:bg-ink disabled:bg-plate disabled:text-ink-faint disabled:hover:bg-plate",
    secondary:
      "bg-paper text-ink hover:bg-plate active:bg-well disabled:bg-panel disabled:text-ink-faint disabled:hover:bg-panel",
    quiet:
      "bg-transparent text-ink-soft hover:bg-paper hover:text-ink active:bg-plate disabled:text-ink-faint disabled:hover:bg-transparent",
  }[variant];
  return (
    <button type="button" className={`${base} ${tone} ${className}`} {...rest}>
      {children}
      {loading && (
        <span className="text-2xs font-normal" role="status">
          working…
        </span>
      )}
    </button>
  );
}

/**
 * The only text input shape. Labelled, never placeholder-only.
 *
 * The invalid state is a 2px `debit` outline plus a `debit-wash` fill, not a
 * border: an outline is a ring drawn outside the box the way the focus ring is,
 * which keeps the two states in the same visual grammar and keeps the control
 * itself a plain fill.
 */
export function Field({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-ink-soft">
          {hint}
        </p>
      )}
      <input
        id={id}
        value={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-2 block w-full min-w-0 rounded-full px-4 py-2.5 text-base text-ink placeholder:text-ink-faint ${
          invalid ? "bg-debit-wash outline outline-2 outline-debit" : "bg-paper"
        }`}
      />
    </div>
  );
}

/**
 * A status word. Never colour alone: the word itself carries the meaning, the
 * fill carries a second signal, and the title carries the explanation.
 */
export function Badge({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "ember" | "credit" | "debit" | "wire" | "onDark";
  title?: string;
  children: ReactNode;
}) {
  const cls = {
    neutral: "bg-plate text-ink-soft",
    ember: "bg-ember-wash text-ember",
    credit: "bg-credit-wash text-credit",
    debit: "bg-debit-wash text-debit",
    wire: "bg-wire-wash text-wire",
    /** The one variant for a badge sitting on a solid `ink` panel. `paper` is a
        surface in the palette audit and `ink` a foreground, so the pair is
        already measured; `ink-lift` is NOT a surface and never carries type. */
    onDark: "bg-paper text-ink",
  }[tone];
  return (
    <span
      className={`label inline-block shrink-0 whitespace-nowrap rounded-sm px-2 py-0.5 font-mono text-2xs leading-[15px] ${cls}`}
      title={title}
    >
      {children}
    </span>
  );
}

/** A quiet horizontal meter. Used for health, never for decay. */
export function Meter({
  value,
  label,
  width = "w-20",
}: {
  value: number;
  label: string;
  width?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-label={label}
        className={`relative block h-1.5 ${width} shrink-0 overflow-hidden rounded-full bg-plate`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-ink-soft transition-[width] duration-500 ease-out"
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
      <span className="tnum w-6 shrink-0 text-right font-mono text-xs text-ink-soft">
        {Math.round(clamped * 100)}
      </span>
    </span>
  );
}

/** External link, always marked as leaving. */
export function Out({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`text-wire underline decoration-plate-line underline-offset-4 transition-colors duration-150 ease-out hover:decoration-wire ${className}`}
    >
      {children}
    </a>
  );
}

/** Skeleton in `--plate`, never a centred spinner. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded-sm bg-plate ${className}`} />;
}
