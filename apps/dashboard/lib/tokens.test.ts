import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The palette's contrast claim, enforced instead of asserted.
 *
 * `tailwind.config.ts` states measured ratios in a comment. A comment cannot fail
 * a build, and this project has already shipped a 4.29:1 failure under a comment
 * claiming "every text token clears WCAG AA, with margin" — true of the solid
 * tokens that comment's author had audited, false of the alpha variants that were
 * also on screen.
 *
 * So this test parses the OKLCH values out of `app/globals.css` itself, converts
 * them to sRGB with the standard OKLab matrices, and checks every text token
 * against every surface it can appear on. If somebody lightens `--ember` by three
 * points to make the decay bar prettier, the suite goes red with the number.
 *
 * Two deliberate scope notes:
 *
 * - This covers the TOKENS. It cannot see a foreground and background that never
 *   occur together, nor one composed at runtime. The live-DOM audit (every
 *   rendered text node, background chain alpha-composited) is the other half and
 *   is run in a browser, not here.
 * - There are no alpha text colours in this build, by rule, which is what makes a
 *   token-level check meaningful at all. The assertion at the end of this file is
 *   what keeps that true.
 */

const RAW = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
/**
 * Comments stripped before anything is scanned. The file's own prose says "no
 * #000 and no #fff anywhere in this file", and a scanner that cannot tell a rule
 * from a sentence about a rule fails on the sentence.
 */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** Every `--name: oklch(L% C H)` declaration in the `:root` block. */
function tokens(css: string): Map<string, Oklch> {
  const out = new Map<string, Oklch>();
  const re = /--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/gi;
  for (const m of css.matchAll(re)) {
    out.set(m[1]!, { l: Number(m[2]) / 100, c: Number(m[3]), h: Number(m[4]) });
  }
  return out;
}

/** OKLCH to sRGB, via OKLab. The matrices are the ones in the CSS Color 4 spec. */
function toSrgb({ l: L, c: C, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(1, g)) * 255;
  }) as [number, number, number];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Oklch, bg: Oklch): number {
  const a = relativeLuminance(toSrgb(fg));
  const b = relativeLuminance(toSrgb(bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const T = tokens(CSS);

/**
 * Every LIGHT surface a dark text token can sit on. `rule`/`rule-firm` never
 * carry text, and neither does `plate-line`, which is a decorative grid on
 * `plate`.
 *
 * `field` and `plate` are the shared ground and the shared inset of both routes
 * now. They are in this list deliberately rather than exempted from it, and
 * putting them here is what caps how dark they are allowed to get.
 */
const SURFACES = [
  "paper",
  "panel",
  "well",
  "wire-wash",
  "ember-wash",
  "debit-wash",
  "credit-wash",
  "field",
  "plate",
];

/**
 * The other half of the audit, and it is new in this build.
 *
 * The redesign puts solid dark masses on both routes — the expanded artifact's
 * identity panel, the navigation pill, the primary button — so for the first
 * time this palette has light type on dark fills at more than one pair. The
 * temptation was to exempt those from the sweep on the grounds that "dark
 * foreground on dark surface" would obviously fail; that would be the same move
 * that let a 4.29:1 alpha variant ship under a comment claiming everything was
 * audited.
 *
 * So the audit has two families instead of one exemption. Every dark FILL that
 * carries type is here, and every token allowed to be type on it is measured
 * against it at the same 4.6:1 floor.
 *
 * - `ink` and `wire` are the two dark fills. `trace` is NOT here because it is
 *   never a fill under type: it is stroke colour in the explainer's drawings and
 *   a text colour elsewhere, and it is already swept against every light surface
 *   in the list above.
 * - `paper` is the only token allowed on BOTH dark fills.
 * - `ink-lift` and `ember-soft` are allowed on `ink` and on nothing else. On
 *   `wire` they measure 3.50:1 and 2.7:1, which is exactly why they are held to a
 *   narrower list rather than waved through.
 */
const DARK_SURFACES = ["ink", "wire"];
const ON_ANY_DARK = ["paper"];
const ON_INK_ONLY = ["ink-lift", "ember-soft"];

/**
 * The floor, from DESIGN.md: WCAG AA is 4.5:1 and this palette targets 4.6:1 so
 * that a rounding difference between two contrast implementations cannot be the
 * thing standing between the page and the standard.
 */
const FLOOR = 4.6;

describe("the palette parses", () => {
  it("finds every token the design system names", () => {
    for (const name of [
      "paper",
      "panel",
      "well",
      "rule",
      "rule-firm",
      "ink",
      "ink-soft",
      "ink-faint",
      "ink-lift",
      "ember",
      "ember-mid",
      "ember-soft",
      "credit",
      "debit",
      "wire",
      "wire-wash",
      "ember-wash",
      "debit-wash",
      "credit-wash",
      "hatch",
      "field",
      "plate",
      "plate-line",
      "trace",
    ]) {
      expect(T.has(name), `--${name} is missing from app/globals.css`).toBe(true);
    }
  });

  it("converts a known value correctly, so a broken matrix cannot pass the rest", () => {
    // oklch(24% 0.022 210) is #122225. If this drifts, every ratio below is noise.
    const [r, g, b] = toSrgb(T.get("ink")!).map(Math.round);
    expect([r, g, b]).toEqual([18, 34, 37]);
    // Pure-ish white against pure-ish black is ~21:1; a sanity check on the ratio.
    expect(contrast({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 })).toBeGreaterThan(20);
  });
});

describe("every text token clears the contrast floor on every surface it can appear on", () => {
  for (const fg of ["ink", "ink-soft", "ink-faint", "ember", "credit", "debit", "wire", "trace"]) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg}`, () => {
        const ratio = contrast(T.get(fg)!, T.get(bg)!);
        expect(
          ratio,
          `${fg} on ${bg} measures ${ratio.toFixed(2)}:1, under the ${FLOOR}:1 floor`,
        ).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});

describe("every light-on-dark pair the redesign introduced clears the same floor", () => {
  for (const fg of ON_ANY_DARK) {
    for (const bg of DARK_SURFACES) {
      it(`${fg} on ${bg}`, () => {
        const ratio = contrast(T.get(fg)!, T.get(bg)!);
        expect(
          ratio,
          `${fg} on ${bg} measures ${ratio.toFixed(2)}:1, under the ${FLOOR}:1 floor`,
        ).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
  for (const fg of ON_INK_ONLY) {
    it(`${fg} on ink`, () => {
      const ratio = contrast(T.get(fg)!, T.get("ink")!);
      expect(
        ratio,
        `${fg} on ink measures ${ratio.toFixed(2)}:1, under the ${FLOOR}:1 floor`,
      ).toBeGreaterThanOrEqual(FLOOR);
    });

    /**
     * The other direction of the same rule, stated as a test rather than as a
     * comment: these two are allowed on `ink` and nowhere else, and the reason
     * is that they do NOT clear the floor on the other dark fill. If somebody
     * later lightens `wire` far enough that they would, this goes red and the
     * narrow list can be widened on purpose instead of by accident.
     */
    it(`${fg} is correctly restricted to ink, because it fails on wire`, () => {
      expect(contrast(T.get(fg)!, T.get("wire")!)).toBeLessThan(FLOOR);
    });
  }
});

describe("the tokens DESIGN.md gives stronger targets for meet them on paper", () => {
  it("ink clears 12:1", () => {
    expect(contrast(T.get("ink")!, T.get("paper")!)).toBeGreaterThanOrEqual(12);
  });
  it("ink-soft clears 7:1", () => {
    expect(contrast(T.get("ink-soft")!, T.get("paper")!)).toBeGreaterThanOrEqual(7);
  });
});

describe("the explainer's one reversed pair", () => {
  /**
   * The published artifact is drawn on the landing as a solid `ink` plate with
   * `paper` type on it — the only place in either route where a text token sits
   * on a dark ground, so it is the only pair the SURFACES sweep above cannot
   * see. Held to `ink`'s own 12:1 target rather than to the 4.6 floor, because
   * it is the same two colours in the other order.
   */
  it("paper type on an ink plate clears 12:1", () => {
    const ratio = contrast(T.get("paper")!, T.get("ink")!);
    expect(ratio, `paper on ink measures ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(12);
  });

  it("trace does not out-shout ember, which is still the only warm hue", () => {
    // DESIGN.md's rule, extended to the new colour rather than exempted from it:
    // credit, debit and wire all sit at lower chroma than ember so that nothing
    // competes with the draining bar. `trace` is a fourth one of those.
    expect(T.get("trace")!.c).toBeLessThan(T.get("ember")!.c);
  });
});

describe("the rules that keep a token-level audit meaningful", () => {
  it("there is no #000 and no #fff anywhere in the stylesheet", () => {
    expect(CSS).not.toMatch(/#000\b|#000000\b|#fff\b|#ffffff\b/i);
  });

  it("every colour in the stylesheet is OKLCH, so nothing sits outside this audit", () => {
    const hex = CSS.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hex, `non-OKLCH colours found: ${hex.join(", ")}`).toEqual([]);
    const rgbish = CSS.match(/\brgba?\(/gi) ?? [];
    expect(rgbish, "rgb()/rgba() colours are outside the OKLCH audit").toEqual([]);
  });

  it("the custom scrollbar rules are gone and stay gone", () => {
    // Reinventing a standard affordance for flavour is a product-register ban.
    expect(CSS).not.toMatch(/::-webkit-scrollbar\s*\{/);
  });

  it("prefers-reduced-motion is gated in the stylesheet, not only in a comment", () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS);
    expect(block, "no prefers-reduced-motion block in app/globals.css").not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/animation:\s*none/);
    expect(body).toMatch(/transition-duration:\s*1ms\s*!important/);
    expect(body).toMatch(/animation-duration:\s*1ms\s*!important/);
  });

  it("screen-reader-only text is pinned so it cannot widen the document", () => {
    // Tailwind's .sr-only is position:absolute with no offsets, so inside a table
    // its containing block resolves past the scroll container to `body` and it is
    // laid out at its static position. Measured at 390px with an artifact open,
    // three invisible labels made the document scroll 598px sideways.
    expect(CSS).toMatch(/\.sr-only\s*\{[^}]*left:\s*0[^}]*\}/);
  });
});

describe("no text colour carries alpha", () => {
  it("the stylesheet defines no alpha colour tokens at all", () => {
    // A tint behind text is a solid `*-wash` token by rule. The previous build's
    // 4.29:1 failure was an alpha variant that no audit covered, and the rule that
    // prevents it is enforceable in one line.
    const alpha = CSS.match(/oklch\([^)]*\/[^)]*\)/gi) ?? [];
    expect(alpha, `alpha OKLCH values found: ${alpha.join(", ")}`).toEqual([]);
  });
});
