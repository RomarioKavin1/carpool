/**
 * The prose budget, enforced instead of intended.
 *
 * ## The failure this exists for
 *
 * A real user, twice: *"there is just too much text, the ui is not structured,
 * I'm not guided as to where I should click, I have no idea whats going on."*
 * Measured in Chrome on the build they saw, `/` rendered **1,108 words** of
 * `innerText` across 24 paragraphs, **eleven of them over thirty words**, the
 * longest fifty; `/app` rendered 620 with no primary action anywhere.
 *
 * The cause was not carelessness. This project has a hard and correct rule that
 * every number carries its provenance and its caveats, and earlier briefs
 * demanded that inline, everywhere, at full weight. Two to four sentences of
 * qualification under every panel is what 1,108 words looks like: the
 * qualification outweighed the thing being qualified and the reader read
 * neither.
 *
 * A convention cannot fail a build. This can, and it is modelled on the two
 * guards that already work here: `fixtures-unreachable.test.ts` walks the real
 * module graph rather than grepping for a string, and `tokens.test.ts` parses
 * the real OKLCH values rather than trusting a comment. So this renders the real
 * components and counts the words a reader actually sees.
 *
 * ## What "a word a reader sees" means here, precisely
 *
 * The routes are server-rendered by `renderToStaticMarkup`, and the resulting
 * markup is walked with the same four exclusions the browser applies:
 *
 * 1. `<script>`, `<style>` and `<svg>` subtrees. No drawing on either route
 *    carries a `<text>` element; every readable word is HTML beside the SVG,
 *    which `components/explainer-art.tsx` explains at length.
 * 2. `aria-hidden="true"` subtrees. Decoration: crosshairs, particle fields,
 *    corner marks, the decay axis.
 * 3. `.sr-only` subtrees. These are the screen-reader twin of a `title`, and
 *    counting them against a *visual* budget would create pressure to delete
 *    accessible caveat text, which rule 2 below forbids outright.
 * 4. Everything inside a closed `<details>` except its `<summary>`. This is the
 *    load-bearing one and it is not a loophole: Chrome's `innerText` excludes it
 *    too (verified in a browser), a `details` renders closed unless it carries
 *    `open`, and the summary chip stays visible and counted.
 *
 * Cross-checked against the live DOM in Chrome rather than assumed. Driven in a
 * browser against a registry holding six real artifacts, `/` measured **349**
 * visible words by DOM walk; this file's markup walk returns **349** for the same
 * route. They agree exactly.
 *
 * The one place they differ is `/app`, and only because the rows differ: the same
 * code measured 242 visible words against a registry holding six artifacts and
 * 425 against one holding fourteen. That is why the route budget counts the
 * chrome and not the rows: outside the table, that live page measures **133**,
 * and this file measures 132 over two fixture artifacts.
 *
 * ## The four rules
 *
 * 1. **No rendered paragraph over 25 words**, and no section intro over 20.
 *    `<p>`, `<li>`, `<dd>`, `<blockquote>` and `<figcaption>`, everywhere, on
 *    both routes and inside every desk.
 * 2. **Caveats move behind disclosure and are never deleted.** Every
 *    qualification lives in a `<details>` whose `<summary>` is visible beside
 *    what it qualifies, so a reader reaches it in one action. The floors below
 *    are the half of this rule that matters: a future pass cannot pass the word
 *    budget by cutting the honesty, because cutting it turns this suite red.
 * 3. **`/` under 350 visible words, the `/app` overview under 250.**
 * 4. **Section intros are one sentence or none**, enforced as a 20-word cap on
 *    the paragraphs that carry `data-lede`. A word count is measurable from the
 *    DOM; a sentence count needs a parser that would be wrong about "µUSDC." and
 *    "0.0.429274".
 *
 * ## The one duplication in this file, and why
 *
 * `/app` is a client component whose overview only exists after `useEffect` has
 * polled a registry, and `renderToStaticMarkup` runs no effects: rendering the
 * route itself yields the `Connecting` screen, which is not what is being
 * budgeted. So the overview is composed here from the same components
 * `app/app/page.tsx` composes it from, over `lib/fixtures.testonly.ts`. That
 * duplication is real and it can drift; what it cannot do is silently pass,
 * because a new prose region added to the route and not here is a region this
 * file visibly does not name.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ActivityDesk } from "../components/ActivityDesk";
import { EarningsDesk } from "../components/EarningsDesk";
import { EnsAuthorView } from "../components/EnsAuthor";
import { EvidenceDesk } from "../components/EvidenceDesk";
import { Explainer } from "../components/Explainer";
import { FindDesk } from "../components/FindDesk";
import { JoinDesk } from "../components/JoinDesk";
import { Button, Frame, Section } from "../components/primitives";
import {
  OverviewMasthead,
  PageFooter,
  RegistryTotals,
  TopBar,
} from "../components/Shell";
import { SwarmTable } from "../components/SwarmTable";
import { buildFooter, buildRows, sortRows } from "./derive";
import {
  fixtureArtifact,
  fixtureBatch,
  fixtureManifest,
  fixturePayout,
  fixturePurchase,
  fixtureState,
  FIXTURE_MAGNET_A,
  FIXTURE_MAGNET_B,
} from "./fixtures.testonly";
import type { RegistryHealth, WellKnown } from "./api";

/* ------------------------------------------------------------------ *
 * The walk
 * ------------------------------------------------------------------ */

/** Elements whose subtree is never read aloud and never read on screen. */
const SKIP_TAGS = new Set(["script", "style", "svg", "noscript", "template"]);

interface Block {
  readonly tag: string;
  readonly words: string[];
  readonly lede: boolean;
}

interface Counted {
  /** Every word a sighted reader can see without opening anything. */
  readonly visible: string[];
  /**
   * The same, minus every `<table>` subtree.
   *
   * A route's word budget has to be a statement about what its author wrote, and
   * on `/app` the table is written by whoever published to the registry: six
   * artifacts render 242 visible words and fourteen render 425, on identical
   * code. A budget over the larger number would be a budget on how many
   * artifacts a stranger may publish. Rows are scanned, not read, so they are
   * counted out of the route total and governed by the paragraph rule instead,
   * which still applies inside every cell.
   */
  readonly chrome: string[];
  /** Prose blocks, leaf-most only, so a `<p>` inside an `<li>` is not counted twice. */
  readonly blocks: Block[];
  /** Words sitting behind a closed `<details>`, excluding its summary. */
  readonly behindDisclosure: number;
  readonly disclosures: number;
}

const PROSE_TAGS = new Set(["p", "li", "dd", "blockquote", "figcaption"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  "#x27": "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  times: "×",
  rarr: "→",
  darr: "↓",
  larr: "←",
  middot: "·",
  mdash: "—",
  ndash: "–",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key]!;
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)));
    return whole;
  });
}

function words(text: string): string[] {
  const t = decode(text).replace(/\s+/g, " ").trim();
  return t === "" ? [] : t.split(" ");
}

interface Frame_ {
  readonly tag: string;
  /** Nothing in this subtree is visible to a sighted reader. */
  readonly hidden: boolean;
  /** Inside a closed `<details>`, outside its `<summary>`. */
  readonly disclosed: boolean;
  /** This element is a `<details>` with no `open` attribute. */
  readonly closedDetails: boolean;
  readonly lede: boolean;
  /** Words collected for the nearest enclosing prose block, if this is one. */
  readonly prose: string[] | null;
}

/**
 * A tokenizing walk over server-rendered markup.
 *
 * A real parser is not needed and would be a dependency: React escapes every
 * `<` in text to `&lt;`, so a `<` in this string is always a tag, and every
 * element it emits is either explicitly closed or a known void element.
 */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function countMarkup(html: string): Counted {
  const visible: string[] = [];
  const chrome: string[] = [];
  const blocks: Block[] = [];
  let behindDisclosure = 0;
  let disclosures = 0;

  const stack: Frame_[] = [];
  const top = () => stack[stack.length - 1];
  /** The prose block currently accumulating, if any. Leaf-most wins. */
  const openProse = (): Frame_ | undefined => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const f = stack[i]!;
      if (f.prose) return f;
    }
    return undefined;
  };

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>"])*)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const emitText = (raw: string) => {
    const w = words(raw);
    if (w.length === 0) return;
    const f = top();
    if (f?.hidden) return;
    if (f?.disclosed) {
      behindDisclosure += w.length;
      return;
    }
    visible.push(...w);
    // A `<pre>` is a command block, not prose: nobody reads `-e CARPOOL_ARTIFACT_DIR`
    // as a sentence, and counting a shell line as words would push a route to
    // shorten the command a reader has to paste. It still counts as visible.
    if (!stack.some((s) => s.tag === "table" || s.tag === "pre")) chrome.push(...w);
    const block = openProse();
    if (block) block.prose!.push(...w);
  };

  while ((match = tagRe.exec(html)) !== null) {
    emitText(html.slice(cursor, match.index));
    cursor = tagRe.lastIndex;

    const closing = match[1] === "/";
    const tag = match[2]!.toLowerCase();
    const attrs = match[3] ?? "";
    const selfClosing = attrs.trimEnd().endsWith("/");

    if (closing) {
      // Unwind to the matching open tag. React emits balanced markup, so the
      // match is always present; the loop guards against a stray closer anyway.
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.tag !== tag) continue;
        for (let k = stack.length - 1; k >= i; k -= 1) {
          const f = stack[k]!;
          if (f.prose && f.prose.length > 0 && !f.hidden && !f.disclosed) {
            blocks.push({ tag: f.tag, words: f.prose, lede: f.lede });
          }
        }
        stack.length = i;
        break;
      }
      continue;
    }

    const parent = top();
    const hidden =
      parent?.hidden === true ||
      SKIP_TAGS.has(tag) ||
      /\baria-hidden="true"/.test(attrs) ||
      /\bclass="[^"]*\bsr-only\b/.test(attrs);

    if (tag === "details") disclosures += 1;
    const closedDetails = tag === "details" && !/\bopen(\s|=|$)/.test(attrs);
    // A summary escapes its own closed details; everything else inside does not.
    const disclosed =
      tag !== "summary" && (parent?.disclosed === true || parent?.closedDetails === true);

    const frame: Frame_ = {
      tag,
      hidden,
      disclosed,
      closedDetails,
      lede: /\bdata-lede\b/.test(attrs),
      prose: PROSE_TAGS.has(tag) ? [] : null,
    };

    if (VOID.has(tag) || selfClosing) continue;
    stack.push(frame);
  }
  emitText(html.slice(cursor));

  return { visible, chrome, blocks, behindDisclosure, disclosures };
}

function measure(element: ReactElement): Counted {
  return countMarkup(renderToStaticMarkup(element));
}

/* ------------------------------------------------------------------ *
 * The surfaces under test
 * ------------------------------------------------------------------ */

const HEALTH: RegistryHealth = {
  ok: true,
  creds: true,
  authEnforced: true,
  registryAccount: "0.0.1111",
  network: "hedera:testnet",
  asset: "0.0.2222",
};

const WELL_KNOWN: WellKnown = {
  embedding: { model: "fixture-embedder", dim: 384 },
  prices: { trackerFeeMicroUsdc: 2000 },
  refundWindowSeconds: 120,
  settlementAccount: "0.0.1111",
  asset: "0.0.2222",
  network: "hedera:testnet",
  anchorTopic: "0.0.3333",
};

/** A registry with enough shape that every branch of the overview renders. */
function state() {
  return fixtureState({
    artifacts: [
      fixtureArtifact(),
      fixtureArtifact({
        manifest: fixtureManifest({ magnet: FIXTURE_MAGNET_B, question: "FIXTURE — second" }),
        live: false,
        freshness: 0.09,
      }),
    ],
    purchases: [fixturePurchase()],
  });
}

const NOW_MS = Date.UTC(2026, 8, 13, 12, 0, 0);

function noop() {
  /* the budget measures markup, never behaviour */
}

/**
 * The `/app` overview, composed the way `app/app/page.tsx` composes it. See the
 * note at the top of this file for why it is rebuilt rather than rendered.
 */
function AppOverview() {
  const s = state();
  const rows = buildRows(s, Math.floor(NOW_MS / 1000));
  const sorted = sortRows(rows, "health", "desc");
  const live = rows.filter((r) => r.live).length;
  return (
    <div>
      <TopBar view="overview" onView={noop} connection="live" detail={null} pollSeconds={3} />
      <Frame>
        <OverviewMasthead
          connection="live"
          detail={null}
          pollSeconds={3}
          health={HEALTH}
          artifactCount={s.artifacts.length}
          liveCount={live}
          onView={noop}
        />
      </Frame>
      <Frame>
        <Section
          id="swarm"
          node="22%"
          eyebrow="The swarm"
          title="Everything on this registry"
          lede="Open any row for the detail. Each gap in the life bar is one halving."
          right={<Button onClick={noop}>Every column</Button>}
        >
          <SwarmTable
            rows={sorted}
            state={s}
            wellKnown={WELL_KNOWN}
            nowMs={NOW_MS}
            opened={null}
            onOpen={noop}
            sort={{ key: "health", dir: "desc" }}
            onSort={noop}
            showEveryColumn={false}
            payoutsFor={null}
            batches={[]}
          />
          <RegistryTotals footer={buildFooter(s)} health={HEALTH} />
        </Section>
      </Frame>
      <PageFooter health={HEALTH} />
    </div>
  );
}

const DESK_SURFACES: [string, () => ReactElement][] = [
  ["find", () => <FindDesk wellKnown={WELL_KNOWN} />],
  [
    "earnings",
    () => (
      <EarningsDesk
        state={state()}
        wellKnown={WELL_KNOWN}
        nowMs={NOW_MS}
        account={null}
        onAccount={noop}
        payouts={[]}
        payoutsError={null}
        batches={[]}
        selectedAuthor={null}
        onSelectAuthor={noop}
        onOpenArtifact={noop}
        onView={noop}
      />
    ),
  ],
  [
    "earnings · an author looked up",
    () => (
      <EarningsDesk
        state={state()}
        wellKnown={WELL_KNOWN}
        nowMs={NOW_MS}
        account="0.0.1111"
        onAccount={noop}
        payouts={[fixturePayout({ state: "settled", settledBatchId: 1 })]}
        payoutsError={null}
        batches={[fixtureBatch()]}
        selectedAuthor={null}
        onSelectAuthor={noop}
        onOpenArtifact={noop}
        onView={noop}
      />
    ),
  ],
  [
    "earnings · an account that published nothing",
    () => (
      <EarningsDesk
        state={state()}
        wellKnown={WELL_KNOWN}
        nowMs={NOW_MS}
        account="0.0.2222"
        onAccount={noop}
        payouts={[]}
        payoutsError={null}
        batches={[]}
        selectedAuthor={null}
        onSelectAuthor={noop}
        onOpenArtifact={noop}
        onView={noop}
      />
    ),
  ],
  [
    "activity",
    () => (
      <ActivityDesk
        events={[]}
        cursorSeconds={Math.floor(NOW_MS / 1000)}
        error={null}
        pollSeconds={3}
        eventLookbackSeconds={21600}
      />
    ),
  ],
  ["evidence", () => <EvidenceDesk state={state()} wellKnown={WELL_KNOWN} />],
  ["join", () => <JoinDesk wellKnown={WELL_KNOWN} health={HEALTH} onView={noop} />],
  [
    "ens author",
    () => (
      <EnsAuthorView
        error={null}
        identity={{
          kind: "ens",
          author: `ens:carpool-author.eth:0.0.1111:${"02" + "ab".repeat(32)}`,
          name: "carpool-author.eth",
          fallbackAccount: "0.0.1111",
          publicKey: "02" + "ab".repeat(32),
          binding: {
            name: "carpool-author.eth",
            status: "unbound",
            checks: { key: "missing", hederaAddr: "missing", payoutSig: "missing" },
            hederaAccount: null,
            problems: [
              "carpool-author.eth has no io.carpool.key text record",
              "carpool-author.eth has no Hedera address record (coin type 3030)",
              "carpool-author.eth has no io.carpool.payout-sig text record",
            ],
          },
          payoutNow: { account: "0.0.1111", source: "fallback" },
          profile: { description: "Writes about ENS" },
          network: "sepolia",
          checkedAt: Math.floor(NOW_MS / 1000),
        }}
      />
    ),
  ],
];

const ALL_SURFACES: [string, () => ReactElement][] = [
  ["/", () => <Explainer />],
  ["/app overview", () => <AppOverview />],
  ...DESK_SURFACES,
];

/* ------------------------------------------------------------------ *
 * The budgets
 * ------------------------------------------------------------------ */

/**
 * A rendered paragraph may not exceed this. Twenty-five words is roughly two
 * short sentences; the build this replaced had eleven paragraphs over thirty on
 * the landing page alone.
 */
const MAX_PARAGRAPH_WORDS = 25;

/** A section intro is one sentence, or none. */
const MAX_LEDE_WORDS = 20;

/**
 * Total visible words per route, counting the chrome and not the registry's own
 * rows. `/` has no rows, so the two counts are the same number there.
 */
const ROUTE_BUDGET: Record<string, number> = {
  // 350, plus the 40 words the "Get Carpool" take-part section and its two
  // buttons render: step numbers, 1-5 word labels and the copy control. The
  // command itself is a <pre> and is not counted (see `emitText`). No caveat
  // was cut to make room; the floor below is unchanged.
  // Plus 10 for step 03's author onboarding: three short sub-steps (portal,
  // associate, author variables), the command block's label and copy control,
  // and the one line on when a royalty lands. The commands are a <pre>. It
  // replaced two lines that named the requirements without saying how.
  "/": 400,
  "/app overview": 250,
};

/**
 * The non-deletion floors, and the reason they are the important half of this
 * file. Moving a caveat behind a `<details>` removes it from the visible count,
 * so a budget on its own rewards deleting caveats exactly as much as disclosing
 * them. These say how much qualification each surface must still carry, and they
 * are set just under what it carries today so that trimming a sentence is fine
 * and gutting a panel is not.
 */
const CAVEAT_FLOOR: Record<string, number> = {
  "/": 230,
  "/app overview": 30,
  find: 90,
  earnings: 30,
  "earnings · an account that published nothing": 40,
  activity: 15,
  evidence: 900,
  join: 450,
  "ens author": 40,
};

describe("prose budget", () => {
  it.each(ALL_SURFACES)("%s renders no paragraph over 25 words", (_name, render) => {
    const { blocks } = measure(render());
    const over = blocks
      .filter((b) => b.words.length > MAX_PARAGRAPH_WORDS)
      .map((b) => `<${b.tag}> ${b.words.length}w: ${b.words.join(" ").slice(0, 120)}`);
    expect(over).toEqual([]);
  });

  it.each(ALL_SURFACES)("%s keeps every section intro to one sentence", (_name, render) => {
    const { blocks } = measure(render());
    const over = blocks
      .filter((b) => b.lede && b.words.length > MAX_LEDE_WORDS)
      .map((b) => `${b.words.length}w: ${b.words.join(" ")}`);
    expect(over).toEqual([]);
  });

  it.each(Object.entries(ROUTE_BUDGET))("%s stays under %i visible words", (name, budget) => {
    const render = ALL_SURFACES.find(([n]) => n === name)![1];
    const { chrome } = measure(render());
    expect(
      chrome.length,
      `${name} renders ${chrome.length} visible words outside its tables, budget ${budget}`,
    ).toBeLessThanOrEqual(budget);
  });

  it.each(Object.entries(CAVEAT_FLOOR))(
    "%s still carries at least %i words of caveat behind disclosure",
    (name, floor) => {
      const render = ALL_SURFACES.find(([n]) => n === name)![1];
      const { behindDisclosure, disclosures } = measure(render());
      expect(disclosures).toBeGreaterThan(0);
      expect(
        behindDisclosure,
        `${name} carries ${behindDisclosure} caveat words, floor ${floor}. ` +
          "Deleting a caveat to hit a word budget is the one failure mode worse than a wall of text.",
      ).toBeGreaterThanOrEqual(floor);
    },
  );

  it("never states a disclosure without a visible summary to open it", () => {
    for (const [name, render] of ALL_SURFACES) {
      const html = renderToStaticMarkup(render());
      const details = html.match(/<details\b/g)?.length ?? 0;
      const summaries = html.match(/<summary\b/g)?.length ?? 0;
      expect(summaries, `${name}: ${details} details, ${summaries} summaries`).toBe(details);
    }
  });

  it("opens every disclosure closed, so the budget measures what a reader sees", () => {
    for (const [name, render] of ALL_SURFACES) {
      const html = renderToStaticMarkup(render());
      expect(html, name).not.toMatch(/<details[^>]*\bopen\b/);
    }
  });
});

describe("the walk itself", () => {
  it("counts visible text and skips decoration, screen-reader text and svg", () => {
    const { visible } = countMarkup(
      '<div><p>one two</p><span aria-hidden="true">three four</span>' +
        '<span class="label sr-only">five six</span><svg><path d="M0 0"/>seven</svg></div>',
    );
    expect(visible).toEqual(["one", "two"]);
  });

  it("counts a table as visible but not as chrome", () => {
    const { visible, chrome } = countMarkup(
      "<p>chrome words</p><table><tbody><tr><td>a registry row</td></tr></tbody></table>",
    );
    expect(visible.length).toBe(5);
    expect(chrome).toEqual(["chrome", "words"]);
  });

  it("counts a summary but not the caveat behind it", () => {
    const { visible, behindDisclosure, disclosures } = countMarkup(
      "<details><summary>open me</summary><p>four hidden caveat words</p></details>",
    );
    expect(visible).toEqual(["open", "me"]);
    expect(behindDisclosure).toBe(4);
    expect(disclosures).toBe(1);
  });

  it("attributes each word to the leaf-most prose block that holds it", () => {
    // The outer block keeps only its own direct words, so a long run of text in
    // an `li` that also wraps a `<p>` is still caught rather than excused by the
    // nesting.
    const { blocks } = countMarkup("<li>outer <p>inner words</p></li>");
    expect(blocks.map((b) => [b.tag, b.words.length])).toEqual([
      ["p", 2],
      ["li", 1],
    ]);
  });

  it("decodes the entities React emits", () => {
    const { visible } = countMarkup("<p>it&rsquo;s 3 &times; 4 &amp; more</p>");
    expect(visible.join(" ")).toBe("it’s 3 × 4 & more");
  });

  it("marks a lede block", () => {
    const { blocks } = countMarkup('<p data-lede="">a b c</p><p>d e</p>');
    expect(blocks.map((b) => b.lede)).toEqual([true, false]);
  });
});
