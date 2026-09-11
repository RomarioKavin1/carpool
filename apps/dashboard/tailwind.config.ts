import type { Config } from "tailwindcss";

/**
 * The token system, rewritten from DESIGN.md's table. Five decisions, all
 * deliberate, and all of them reversals of the previous build.
 *
 * 1. **The ground is cool-tinted paper, not deep blue-green ink.** DESIGN.md
 *    derives light from the scene — a judge on a laptop in a bright hall,
 *    skimming their fortieth project — and light also refuses both reflexes
 *    that anything touching Hedera falls into: neon-on-black first, and
 *    terminal-native dark mode second. The second one is what this dashboard
 *    used to be. Light is also more authentically torrent than dark ever was:
 *    µTorrent, Azureus and Transmission were light grey desktop applications.
 *
 * 2. **OKLCH, and no `#000`/`#fff` anywhere.** Every neutral carries chroma
 *    0.006–0.020 toward the brand hue (195 for surfaces, 210 for ink), which is
 *    enough to read as deliberate and not enough to look coloured.
 *
 * 3. **`ember` is decay and nothing else.** Inherited from the previous system
 *    and the single most important rule here. It is the only warm hue and the
 *    only colour on the decay bar. Headings, badges and hovers reach for `ink`
 *    or `wire` — the moment a second thing is amber, the draining bar stops
 *    meaning anything on sight.
 *
 * 4. **Lightness is set by MEASURED contrast, not by the table's first draft.**
 *    DESIGN.md gives both an L value and a target ratio for each text token, and
 *    on this ground the two disagree: at the tabled L values `ink-soft` measures
 *    6.77:1 against a stated ≥7:1, `ink-faint` 4.07:1 against ≥4.6:1, and
 *    `ember` 4.26:1 against ≥4.6:1. The ratio is the requirement and the L value
 *    was an estimate of it, so five tokens are darker here than the table says:
 *    ink-soft 46→43, ink-faint 58→51, ember 58→52, credit 48→46, debit 50→48,
 *    wire 48→45. Measured against every surface they can appear on (paper,
 *    panel, well and the four washes) the worst case is now 4.69:1.
 *
 * 5. **No alpha variants on text, ever.** The previous build shipped a 4.29:1
 *    failure because `text-mute/70` was not in its own audit. Tints that used to
 *    be `bg-wire/10` are solid `*-wash` tokens instead, so every foreground /
 *    background pair on screen is a pair of named solid colours and can be
 *    enumerated rather than sampled.
 *
 * 6. **One ground for both routes, and a dark mass on top of it.** `--field` was
 *    the explainer's cyan ground and `--paper` was the app's near-white; the two
 *    routes therefore looked like two products, which is the thing this pass was
 *    asked to fix. `field` is now the GROUND of both, `paper` is the RAISED panel
 *    on it, `plate` is the inset inside a panel, and `ink` is a solid dark fill
 *    used as a panel and not only as text. That last one is new, and it brings
 *    one new token (`ink-lift`) and a second contrast family with it: see
 *    `lib/tokens.test.ts`, which now measures light-on-dark as well as
 *    dark-on-light rather than exempting the dark panels from the audit.
 *
 * Measured ratios, worst surface for each: ink 13.44:1, ink-soft 6.61:1,
 * ink-faint 4.69:1, ember 4.70:1, credit 5.48:1, debit 5.83:1, wire 6.11:1,
 * trace 5.58:1. On the dark family: paper 15.65:1 on ink and 6.49:1 on trace,
 * ink-lift 7.70:1 on ink, ember-soft 6.63:1 on ink.
 * `rule`/`rule-firm` are hairlines and never carry text.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /**
       * ONE pair of families across both routes.
       *
       * This is the change the user asked for in as many words: the landing's
       * type was approved, and `/app` was still on the system stack, so the two
       * routes looked like two products. Archivo and Martian Mono are now loaded
       * once in `app/layout.tsx` and carry everything.
       *
       * The sans/mono split is unchanged and still semantic: Archivo is the human
       * claim, Martian Mono is the machine readout. `display` and `plate` remain
       * as aliases so the explainer's existing markup keeps reading the way its
       * own comments describe.
       *
       * Every fallback after the variable is a real installed face, so both
       * routes are legible before the fonts land and if they never land.
       */
      fontFamily: {
        sans: [
          "var(--font-display)",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-plate)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
        display: [
          "var(--font-display)",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        plate: [
          "var(--font-plate)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      /**
       * Fixed rem scale, ratio ≈1.2. Not fluid: users read this at consistent
       * DPI and a heading that shrinks in a narrow column looks worse, not
       * better. BODY IS 16px. The old scale put body at 13px with chrome at
       * 10–11px, which is most of why the page felt crammed — it was crammed.
       */
      /**
       * The scale is unchanged. The TRACKING is not, and that is the single most
       * transferable thing about the reference's typography: it sets 57px display
       * at -4.02px and 22px text at -0.88px, which is -0.070em and -0.040em, and
       * the tightness is what makes its type read as one drawn mass rather than
       * as letters in a row.
       *
       * So every step carries a negative default here rather than each call site
       * remembering a bracket value: -0.06em at display sizes, easing to -0.01em
       * at the chrome sizes where tight tracking starts costing legibility. The
       * reference's own -0.07em at 14px is for short uppercase labels only, and
       * `.label` in `app/globals.css` is where that lives.
       */
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.9375rem", letterSpacing: "-0.005em" }], // 11/15 — chrome labels only, never body
        xs: ["0.78125rem", { lineHeight: "1.0625rem", letterSpacing: "-0.01em" }], // 12.5/17 — dense table meta
        sm: ["0.875rem", { lineHeight: "1.25rem", letterSpacing: "-0.012em" }], // 14/20 — labels, secondary
        base: ["1rem", { lineHeight: "1.5625rem", letterSpacing: "-0.018em" }], // 16/25 — BODY
        lg: ["1.1875rem", { lineHeight: "1.6875rem", letterSpacing: "-0.022em" }], // 19/27
        xl: ["1.4375rem", { lineHeight: "1.8125rem", letterSpacing: "-0.03em" }], // 23/29
        "2xl": ["1.8125rem", { lineHeight: "2.125rem", letterSpacing: "-0.04em" }], // 29/34
        "3xl": ["2.25rem", { lineHeight: "2.4375rem", letterSpacing: "-0.05em" }], // 36/39
        "4xl": ["2.875rem", { lineHeight: "3rem", letterSpacing: "-0.058em" }], // 46/48
        /**
         * Fluid, and only where one idea owns a viewport: the explainer's beats
         * and each route's single opening headline. The fixed scale above is a
         * product-register decision about a dense app read at consistent DPI; a
         * single-idea-per-fold narrative is the case the brand register keeps
         * `clamp()` for, and a 46px cap would leave the opening line looking like
         * a paragraph on a 1440px screen.
         *
         * Line height drops to 0.90 at `hero` and `beat`, which is the reference's
         * own ratio (51.66/57.40) and is what lets two stacked display lines read
         * as one block rather than as two sentences.
         */
        beat: ["clamp(1.75rem, 4.2vw, 3rem)", { lineHeight: "0.94", letterSpacing: "-0.055em" }],
        "beat-lead": ["clamp(1.1875rem, 1.9vw, 1.5rem)", { lineHeight: "1.4", letterSpacing: "-0.022em" }],
        hero: ["clamp(2.375rem, 7vw, 5rem)", { lineHeight: "0.9", letterSpacing: "-0.065em" }],
        /** The app's one display headline per view. Smaller than `hero`: a
            working surface cannot spend a whole fold on its own title. */
        deck: ["clamp(1.875rem, 3.6vw, 2.75rem)", { lineHeight: "0.94", letterSpacing: "-0.055em" }],
      },
      /**
       * Rounded, on the user's explicit instruction, and measured off the
       * reference rather than guessed: 12px and 14px dominate its panels, 8px its
       * small chips, 41px its pills. This reverses DESIGN.md's old "nothing
       * rounder than 2px" rule, which is recorded there rather than left to
       * contradict this file.
       *
       * `full` resolves to 41px rather than 9999px on purpose: CSS clamps a
       * radius to half the shorter side, so 41px is a true pill on anything up to
       * 82px tall and a 41px round on anything larger — which is the reference's
       * actual behaviour, and it keeps a tall panel from turning into a capsule.
       */
      borderRadius: {
        none: "0",
        xs: "4px",
        sm: "8px",
        DEFAULT: "12px",
        md: "12px",
        lg: "14px",
        xl: "18px",
        "2xl": "24px",
        full: "41px",
      },
      colors: {
        paper: "var(--paper)",
        panel: "var(--panel)",
        well: "var(--well)",
        rule: "var(--rule)",
        "rule-firm": "var(--rule-firm)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        ember: "var(--ember)",
        "ember-mid": "var(--ember-mid)",
        "ember-soft": "var(--ember-soft)",
        credit: "var(--credit)",
        debit: "var(--debit)",
        wire: "var(--wire)",
        // Solid tints, not alpha. See decision 5 above.
        "wire-wash": "var(--wire-wash)",
        "ember-wash": "var(--ember-wash)",
        "debit-wash": "var(--debit-wash)",
        "credit-wash": "var(--credit-wash)",
        /** Secondary type on a solid `ink` mass, and nowhere else. 7.70:1. */
        "ink-lift": "var(--ink-lift)",
        /**
         * The shared ground, the inset inside a panel, the decorative grid on it,
         * and the one colour that means "an agent doing work".
         * Both grounds are in `lib/tokens.test.ts`'s SURFACES list, so every
         * text token is measured against them; `trace` is in that test's
         * foreground list AND in its dark-surface list, because it is both a
         * colour type is set in and a fill type is set on.
         */
        field: "var(--field)",
        plate: "var(--plate)",
        "plate-line": "var(--plate-line)",
        trace: "var(--trace)",
        hatch: "var(--hatch)",
      },
      /**
       * 150–250ms, ease-out with an exponential curve. No bounce, no elastic.
       * `drain` is slower because it is the only motion that IS the data: the
       * decay bar interpolating between one poll's freshness and the next.
       */
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
      transitionDuration: { drain: "900ms" },
    },
  },
  plugins: [],
} satisfies Config;
