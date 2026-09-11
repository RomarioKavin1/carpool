# Design

> ## The text pass, and the rule it changed
>
> A real user, for the second time: *"there is just too much text, the ui is not
> structured, I'm not guided as to where I should click, I have no idea whats
> going on, reduce text be precise on point and make the ui ux better."*
>
> Measured in Chrome on the build they saw: `/` rendered **1,108 words** across 24
> paragraphs, **eleven of them over thirty words**, longest fifty, with 46 words
> above the fold. `/app` rendered **620**, four paragraphs over thirty, **six
> navigation items of identical weight** and **no primary action anywhere**.
>
> **The cause was this document, not carelessness.** "Every number says where it
> came from" is correct and stays. Demanding it *inline, everywhere, at full
> weight* is what produced two to four sentences of qualification under every
> panel, until the qualification outweighed the thing being qualified and the
> reader read neither. The drawings on `/` were built to carry the explanation and
> were narrated as well, so the page said everything twice.
>
> Four things changed. Nothing was deleted.
>
> 1. **The honesty stays; its placement changes.** Every caveat now lives in a
>    native `<details>` whose `<summary>` chip is visible beside what it
>    qualifies, so a reader reaches it in one action by pointer, keyboard or
>    screen reader. See *Disclosure* below.
> 2. **The budgets are a test, not a convention.** `apps/dashboard/lib/prose-budget.test.tsx`
>    renders the real components, walks the markup the way a browser walks the
>    DOM, and fails the build on a paragraph over 25 words, a section intro over
>    20, `/` over 350 visible words or the `/app` overview over 250. It also
>    asserts a **floor** on caveat words behind disclosure, because a budget on
>    its own rewards deleting a caveat exactly as much as disclosing one.
>
>    **The route budget counts the chrome and not the rows**, and the reason is
>    measured rather than tidy: identical code renders 242 visible words on `/app`
>    against a registry holding six artifacts and 425 against one holding
>    fourteen. A budget over the larger number would be a budget on how many
>    artifacts a stranger may publish. A table is scanned, not read; every `<p>`,
>    `<li>` and `<dd>` inside one is still bound by the 25-word rule.
> 3. **One primary action per surface.** `/` has one filled control above the
>    fold; `/app` has one, and it is search.
> 4. **The app navigation is two tiers**, not six peers. See *Page architecture*.
>
> After the pass, measured the same way against the same registry: `/` **1,108 →
> 686** words of `innerText`, **778 → 349** visible, longest paragraph **50 →
> 15**, eleven paragraphs over thirty words **→ zero**, 8.3 **→ 7.35** screens of
> scroll, 264 words of caveat now behind 6 disclosures. `/app` overview **434 →
> 314** `innerText`, **362 → 242** visible over six artifacts, **133** outside the
> table. Search 282 → 111, Activity 182 → 107, Measurement 1,830 → 412 visible
> with 1,043 words of caveat preserved, Take part 1,226 → 595 with 528 preserved.
>
> Zero paragraphs over 25 words on either route or on any of the five desks. Zero
> contrast failures, worst pair 4.74:1, measured on the live DOM with every
> disclosure open. Zero horizontal overflow at 360 · 390 · 414 · 768 · 1024 ·
> 1440, on both routes, with an artifact expanded and on each desk.

> ## What the previous pass changed, and why
>

> The user looked at the landing page and said: the font and the theme are good,
> now port the rest of the site to the same vibe, and redesign the whole thing
> using **klyro.security** as the only reference.
>
> That instruction **reverses two rules written below**, and they are marked where
> they appear rather than quietly deleted:
>
> 1. **"There is no `border-radius` above 2px anywhere."** Reversed. Radii are now
>    12px and 14px for panels, 8px for chips and 41px for pills, which are the
>    values measured off the reference page rather than chosen. See *Material*.
> 2. **"No cards."** Reversed. The reference is built out of rounded filled
>    panels, so this is too. What survives is the part of that rule that was about
>    craft rather than about boxes: panels are asymmetric and varied in size, never
>    a uniform grid of the same box, and never nested two deep for decoration.
>
> Three rules were **added**:
>
> 3. **Nothing is outlined by a border.** Measured on the reference: zero elements
>    with a non-zero border width. Separation is fill, whitespace, and hairlines
>    drawn as their own thing. Measured on this build after the pass: zero borders
>    on `/` and zero on `/app`.
> 4. **One ground for both routes.** `field` was the explainer's and `paper` was
>    the app's, which is most of why they read as two products. `field` is now the
>    ground of both, `paper` the raised panel on it, `plate` the inset, `ink` the
>    solid dark mass.
> 5. **One pair of type families for both routes**, with the reference's tight
>    negative tracking applied per step.
>
> What was deliberately **not** taken from the reference: its warm bone ground
> (`rgb(237,234,230)`), its coral accent (`rgb(255,59,68)`), its type (Funnel
> Display / Funnel Sans), its imagery, and its copy. The reasons are in *Color*
> and *Typography*.

## Theme

**Light.** Forced by the scene, not chosen by taste.

> A hackathon judge, on a laptop, in a bright conference hall mid-afternoon,
> skimming their fortieth project of the day, wanting to know in thirty seconds
> whether this one is interesting.

Bright ambient light, a fast skim, no immersion. That sentence forces light, and
`PRODUCT.md` already commits to it: "a judge reads this on a laptop in a lit hall,
not in a dark room."

It also passes both reflex checks, which the previous dark build failed:

- **First-order reflex** for anything touching Hedera, x402 or agent payments is
  neon-on-black. Light refuses it.
- **Second-order reflex** is "crypto that isn't neon-on-black, so terminal-native
  dark mode." That is precisely what the previous version was. Light refuses that
  too.

And light is more authentically torrent than dark ever was: µTorrent, Azureus and
Transmission were light grey desktop applications. The theme change keeps the
metaphor and drops the cliché.

## Color

**Strategy: Restrained, over one committed ground.** Tinted neutrals plus one accent held under 10% of the
surface. Product register's floor, and correct here because the data must carry
the page, not the palette.

OKLCH throughout. No `#000`, no `#fff` anywhere. Every neutral is tinted toward
the blue-green brand hue (195) at chroma 0.006 to 0.020, which is enough to read
as deliberate and not enough to look coloured.

The ground is **cool-tinted, not warm paper.** Warm paper would read more
editorial, but it would also swallow `ember`, and `ember` is the one element of the
old design that worked. Cool ground keeps amber reading as heat.

**The reference's warm bone ground is refused, and this is the one place the two
briefs actually collide.** `rgb(237,234,230)` is what that page is built on. But
the user approved this theme in the same sentence that named the reference, and a
page cannot have two grounds. The cyan field wins; everything *compositional* from
the reference is taken on top of it.

**The reference's coral accent is refused too, and for a harder reason.**
`rgb(255,59,68)` maps onto a warm hue this palette already has, and that hue is
spoken for: `ember` is decay and nothing else. A second warm accent would mean the
draining bar stops meaning anything on sight, which is the single most valuable
thing this interface does. Everything the coral does structurally on the reference
is done here by something already in the palette: the crosshair nodes are solid
`ink` (which is what that page's own nodes are, measured), the step numbering and
the spine are `trace`, and the particle fields are `trace` everywhere except the
one field that opens the decay beat, where the particles literally are decay.
**No new accent was introduced.**

```
--paper      oklch(98.4%  0.006  195)   page ground
--panel      oklch(96.4%  0.008  195)   raised region, table header
--well       oklch(93.2%  0.011  195)   bar track, inset, hovered row
--rule       oklch(88.0%  0.014  195)   hairline
--rule-firm  oklch(ascending 78.0% 0.020 195)  emphasised rule, bar edge

--ink        oklch(24.0%  0.022  210)   primary text
--ink-soft   oklch(46.0%  0.018  210)   secondary text
--ink-faint  oklch(58.0%  0.015  210)   tertiary, chrome labels only

--ink-lift   oklch(76.0%  0.028  200)   secondary type on an `ink` panel, there only
--ember      oklch(58.0%  0.150   62)   DECAY AND NOTHING ELSE
--credit     oklch(48.0%  0.105  165)   money in, published
--debit      oklch(50.0%  0.150   15)   money out, refunded
--wire       oklch(48.0%  0.120  250)   links, selection, focus
```

**`ember` is decay and only decay.** Inherited from the previous system and the
single most important rule here. The moment a second thing is amber, the draining
bar stops meaning anything on sight. Headings, badges and hovers reach for `ink`
or `wire`.

`credit`, `debit` and `wire` sit at lower chroma than `ember` so money-in,
money-out and links never out-shout decay.

### Semantic states

Standardised once, used everywhere. No component ships with half of these.

Every one of these is now a **fill change or a ring**, never a border, because
nothing in this build is outlined.

`hover` → one fill step down (`paper` → `panel` on a row, `paper` → `plate` on a
control). `focus` → 2px `--wire` outline ring, offset 1px, never a hue-only
change. `active` → the fill steps down again (`plate` → `well`, or a primary
button returns from its `wire` hover to `ink`, so a press reads as a darkening).
`selected` → `--wire-wash` fill on a row; on the navigation pill, a `paper` chip
inside the `ink` bar. `disabled` → `--plate` fill with `--ink-faint` text.
`loading` → skeleton in `--plate`, never a centred spinner. `error` → `--debit`
text on a `--debit-wash` fill plus a 2px `--debit` outline on an input, never
colour alone.

### Contrast, measured not assumed

Every pair below must be measured on the implemented page, including
alpha-composited text. A previous build shipped a 4.29:1 failure because only
solid tokens were audited. Targets on `--paper`: `ink` ≥ 12:1, `ink-soft` ≥ 7:1,
`ink-faint` ≥ 4.6:1 and used only at 14px and above, `ember`/`credit`/`debit`/
`wire` ≥ 4.6:1. Hue never carries meaning alone.

**Two contrast families now, not one exemption.** The redesign puts solid dark
masses on both routes, so for the first time this palette sets light type on dark
fills in more than one place. `lib/tokens.test.ts` was extended rather than
loosened:

- **Light surfaces × dark foregrounds**, unchanged: nine surfaces
  (`paper`, `panel`, `well`, the four `*-wash` tints, `field`, `plate`) against
  eight foregrounds.
- **Dark surfaces × light foregrounds**, new: `ink` and `wire` are the only fills
  that carry type, `paper` is the only token allowed on both, and `ink-lift` and
  `ember-soft` are allowed on `ink` and nowhere else. The test asserts the
  restriction in both directions: it fails if either clears the floor on `ink`,
  and it *also* fails if either stops failing on `wire`, so the narrow list can
  only be widened deliberately.

Measured on the live DOM after this pass, every distinct colour/size/background
triple on both routes, backgrounds alpha-composited up the ancestor chain:
**0 failures, worst pair 4.72:1** (`ink-faint` at 11px on a `plate` panel).

## Typography

Two families, each with a job, **and both of them on both routes now.** Product
register says one family is often right; the exception is earned here because the
whole product is about telling a machine readout apart from a human claim.

- **Sans** for prose, headings, labels, buttons: **Archivo** (Omnibus-Type), a
  nineteenth-century American grotesque with a width axis, drawn for signage and
  for small sizes. It is a working UI face at 12–16px and a display face at 46px.
- **Mono** for every number, id, magnet, amount, and the decay readout: **Martian
  Mono** (Evil Martian), a wide semi-monospace drawn for technical readouts rather
  than for code. This is the torrent DNA and it stays. Tabular figures on.

Both are self-hosted through `next/font` in `app/layout.tsx`, so neither route
makes a runtime request to a font CDN, and both stacks fall back to installed
faces.

**This reverses the previous split**, which scoped these two to `/` and left
`/app` on the system stack. That was defensible on its own terms and it is what
made the two routes look like two products, which is the thing this pass was asked
to fix. The product register's warning about display faces in UI labels does not
bite: Archivo is a grotesque drawn for small sizes and Martian Mono ships tabular
figures. What is borrowed from the reference is the tracking, not a decorative
face.

The serif is still **dropped.** It was carrying "human claim versus machine
readout", and the sans/mono split carries that distinction more legibly.

### Tracking is the transferable half of the reference's typography

Measured on that page: 57.4px display at -4.02px (**-0.070em**), 22px text at
-0.88px (-0.040em), 18px at -0.36px (-0.020em), and a display line-height of 0.90.
Tight tracking is its signature, and unlike its palette it costs this project
nothing.

So every step of the scale carries a negative default in `tailwind.config.ts`
rather than each call site remembering a bracket value: **-0.058em at 4xl easing
to -0.005em at 2xs**, with the fluid display steps at -0.055em and the hero at
-0.065em, line-height 0.90.

One inversion worth naming: the previous build set uppercase chrome labels
letter-spaced **open** (`tracking-[0.16em]`), which is the reflex. The reference
does the opposite, and `.label` in `app/globals.css` follows it at **-0.04em**.
A tight uppercase micro-label looks stamped; an open one looks like AI
scaffolding.

**Fixed rem scale, ratio ≈1.2.** No fluid clamps, with two exceptions: the
explainer's `beat`/`hero` steps, and one `deck` step per `/app` view, which is the
one display headline a working surface gets. A page that gives one idea a whole
viewport is the case the brand register keeps `clamp()` for.

```
2xs   11px / 15   chrome labels only, never body
xs    12.5px / 17 dense table meta
sm    14px / 20   labels, secondary
base  16px / 25   BODY — was 13px, this is the single biggest change
lg    19px / 27
xl    23px / 30
2xl   29px / 35
3xl   36px / 42   the opening claim
4xl   46px / 52   one number, when it is the point
```

The old scale topped out at 26px and put body at 13px. Everything felt crammed
because it *was* crammed: a newcomer-facing page cannot ask someone to read 13px
in a lit hall.

Prose caps at 68ch. Tables may run to 120ch+.

## Material

The part this pass rebuilt, and all of it is measured off the reference rather
than estimated.

**Four surfaces, in one relationship.** `field` is the ground of both routes,
`paper` is the raised panel on it, `plate` is the inset inside a panel or a quiet
region on the ground, `ink` is the solid dark mass. That is the reference's own
bone / white / near-black relationship mapped onto the hue this project already
committed to.

**Radii: 14px for panels, 8px for chips, 41px for pills, 12px where a panel sits
inside another.** Measured on the reference: 12px ×17, 14px ×13, 8px ×11, 41px ×7.
`rounded-full` resolves to 41px rather than 9999px, because CSS clamps a radius to
half the shorter side, so 41px is a true pill on anything up to 82px tall and a
41px round on anything larger, which is what that page actually does.

~~**No cards.**~~ **Reversed on the user's instruction.** Panels are the material.
What survives is the ban on **identical card grids**: every panel on both routes
is sized differently from its neighbour, the two-column splits are 1.25/0.75 or
1.3/0.7 rather than 50/50, and no region is a three-across row of the same box.

~~**No `border-radius` above 2px.**~~ **Reversed**, as above.

**No borders, and no shadows.** The reference has zero elements with a non-zero
border width, and this build matches that: measured after the pass, **0 borders on
`/` and 0 on `/app`**. Separation is fill, whitespace, and hairlines drawn as
their own thing (`.hairline-b` paints an inset 1px edge, which is not a border and
costs no extra node per row). Shadows are refused too, which is one place this
build differs from the reference on purpose: its panels carry a soft drop shadow,
and a shadow colour would have to be an alpha value, which this palette does not
allow anywhere. The fill step from `field` at 94.6% lightness to `paper` at 98.4%
separates them without one.

**The crosshair rule system.** A horizontal hairline with a vertical one crossing
it at a small solid square node, both running past the content they bound. It
replaces the full-width `border-t` that used to open every region, and it does the
same job without being the edge of a box. The node's position varies between
regions on purpose: a crosshair in the same place every time is a border with
extra steps.

**Particle fields** of small squares mark section transitions. Deterministic (a
fixed sequence evaluated once at module scope, so the server and the client draw
the same field), **static** (the reference drifts its particles; decorative motion
is a product-register ban), and `trace` rather than a second warm accent.

**Corner markers** (a triangle, a plus, a caret) sit at the corner of a large
panel. A printer's registration mark rather than an icon; `aria-hidden` by
construction because they never carry meaning.

**The staggered display headline.** Two or three lines of huge tight-tracked
uppercase, each indented further than the last, with the final line dropped to
`ink-faint` so the phrase reads in two weights without any of it changing size.
Uppercase is allowed here and only here: these are three to six words, and the
ban is on all-caps *body* copy.

**And it is rationed to one per view.** The reference uses the form on every
section; a working surface cannot spend 120px of vertical on each of five
regions, and "one dominant idea per viewport" is the part of that pacing that
actually transfers. So `/` opens on it, and each of `/app`'s five views opens on
it once; every subordinate region below stays at `text-2xl` sentence case. When
it is used, the `<h2>` still carries the unbroken sentence as its accessible
name, so where a line breaks never becomes what a screen reader reads.

## Layout

**Whitespace by sequencing, not subtraction.** Nothing real is removed. It arrives
in an order.

Vertical rhythm on an 8px base, deliberately uneven: **96px** between major
sections, **32px** inside a section, **14px** between table rows. Same padding
everywhere is monotony; the jump from 96 to 14 is what makes a section read as a
section without drawing a box around it.

**Asymmetric splits, never a symmetric grid.** Type on one side against a large
panel on the other, at 1.25/0.75 or 1.3/0.7, alternating which side is heavier.
The reference does this everywhere and it is the single cheapest way to stop a
two-column layout reading as a template.

Grid tracks are **always** `minmax(0, …)`, never bare `1fr` or implicit `auto`. A
bare track floors at its item's min-content width, and `min-w-0` on the item does
not lower the track: that is exactly how three grids came to scroll the whole
document sideways at 390px in the previous build.

### Page architecture

Newcomer first, expert one scroll or one click away. It is now two routes rather
than one page, because the first two items below were prose and the prose was the
part nobody read.

**`/` — the explainer.** The claim and how it works, drawn instead of written:
five folds, one idea each, in SVG, ending on the real transaction that paid a
real author and one call into the app. Its art direction is the next section, and
**it is now the app's too**, which is the whole point of this pass.

**`/app` — the working surface, and its navigation is two tiers.**

Six tabs of identical weight was a menu, not a hierarchy. It forced a newcomer to
rank six things they had no basis to rank, and it put *Take part* sixth of six,
which is backwards for the one reader who does not yet know what any of this is.

- **Primary, in the dark pill: `Browse` and `Search`.** The two things almost
  everyone arriving here wants, and both are about the artifacts rather than
  about the machine. `Browse` is the default.
- **Secondary, in a visibly quieter row underneath: `Take part`, `Earnings`,
  `Activity`, `Measurement`.** Reference views for somebody who already knows why
  they came. `Take part` leads them, because of the four it is the one a stranger
  is most likely to need. They keep their own hashes, so `/app#evidence` still
  opens the correction the explainer links to.

Labels are nouns. The sentence each one deserves is its `title`.

1. **The swarm.** The real table, spacious rows, the decay bar as the signature
   element. This is where density starts being allowed, and it is the first thing
   on the route.
2. **Detail on demand.** An artifact expands in place. Not a modal: modals are
   usually laziness and everything here is inspectable inline.
3. **The primary action is `Search this registry`**, a filled `ink` pill at
   `text-lg` in the masthead, with everything else on that screen demoted to a
   text link or a fact. Looking is already free and needs no click; searching is
   the step that turns looking into buying, it costs nothing, and it needs no key
   and no account. The diagnostic panel beside it lost its second button and its
   three sentences and now carries four labelled facts and one `Caveat`.

The money proof and the retraction did not move out of the app when the prose
did: both live on the measurement desk, in full, and `/` quotes them.

Responsive behaviour is structural: columns collapse, the table gains horizontal
scroll inside its own container, secondary panels stack. Type sizes do not shrink,
except the three fluid display steps, which are the one idea per viewport.

Verified after this pass, in injected same-origin iframes because
`resize_window` pins `innerWidth` at 750: **360 · 390 · 414 · 768 · 1024 · 1440**
on both routes, with an artifact expanded and with each of the four desks open.
Horizontal document overflow at every width: **zero**.

## The explainer route

~~`/` and `/app` share the token file and share no art direction.~~ **They now
share both.** That sentence was the previous build's deliberate choice and it is
exactly what the user rejected: the app was restrained light paper on the system
type stack, the explainer was a committed cyan field in Archivo and Martian Mono,
and a reader crossing between them saw two products. One ground, one pair of
families, one panel material, one rule system. What is still different is
*pacing*, not palette: `/` gives one idea a whole viewport for five folds, and
`/app` gives one display headline per view and then lets density start.

**What it is.** Five folds, one idea each, drawn in hand-authored SVG and driven
by scroll position: the waste (many agents answering one question), the address
(a published artifact named by the hash of its own bytes), the reuse (the
parallel paths converging), the decay (the price halving to the hatched dead
zone), the payout (two transactions on Hedera testnet). About four hundred words
in total. The prose version of the same explanation used to sit at the top of the
app and nobody read it.

**Lane, named before anything was picked: a cyanotype plate, printed light.**
Anna Atkins' photograms: one committed hue over the whole field, line work
instead of imagery, the drawing IS the content. It refuses the two reflexes this
project keeps having to refuse (neon on black first, terminal-native dark
second), and it refuses the one the previous landing was two decisions away from,
the editorial-typographic lane that `brand.md` lists as flooded.

**Colour: Full palette, four roles, hue 195, and it is now the whole product's
rather than this route's.** The ground is committed rather than neutral, and the
saturation lives in the line work because the grounds are capped by contrast.

```
--field       oklch(94.6% 0.044 195)   the page ground
--plate       oklch(92.6% 0.062 195)   the ground a drawing sits on
--plate-line  oklch(85%   0.050 195)   graph paper, decorative only
--trace       oklch(45%   0.115 215)   an agent doing work
```

`ember` is still decay and still nothing else: it appears on exactly one fold.
`credit` is money moving, `ink` is the artifact itself (the only solid dark mass
on the page, carrying `paper` type), and `trace` sits at lower chroma than
`ember` by the same rule `credit`, `debit` and `wire` follow.

Both grounds are in `lib/tokens.test.ts`'s SURFACES list rather than exempt from
it, which is what caps how dark they may go: at `plate`'s lightness the worst
text pair (`ink-faint`) measures 4.69:1. Measured on the rendered page, every
distinct colour/size pair on this route clears **4.98:1**, worst case.

**Type: Archivo and Martian Mono**, self-hosted through `next/font`, and the
procedure that chose them is written out in `app/layout.tsx`, which is where they
moved to in this pass, because they now carry `/app` as well.

**Composition, from the reference.** The lane above (cyanotype linework) is what
the *drawings* are. What the *page* is came from klyro.security: the staggered
two-weight uppercase hero, crosshair rules between beats with the node moved each
time, each beat's header split asymmetrically with the lead line dropped into the
narrow column, the drawings held in rounded 14px panels with a corner mark, a
particle field opening the decay beat, and the settlement receipts on the one
solid `ink` mass in the narrative because that is the page's strongest fact.

**Motion: the resting state of every animated element is the finished frame.**
The start frame exists only under `.beat[data-in="false"]`, an attribute the
client writes only when `prefers-reduced-motion` is false. So reduced motion, a
failed hydrate and a stalled observer all produce the same complete drawing,
and a watchdog finishes any beat the observer leaves armed. Nothing animates a
layout property; the decay bar's keyframes are linear in time and geometric in
width, because equal thirds being one halving each is the claim that fold makes.

## Components

Signature element: **the decay bar**, and it survives this pass intact. A progress bar inverted into a drain, with
gradations one halving apart by construction and a hatched dead zone below the
0.125 expiry threshold, so the end of an artifact's sellable life is visible from
publication. It is the one thing the previous build got right and it is preserved
and given more room. Two things the reference changed, neither of them the
substance: the track is a pill rather than a rectangle (the one place the 41px
radius applies to something that is not a button), and the track fill moved from
`well`, a grey, to `plate`, so the empty half of the bar belongs to the same
family as the ground. The `ember` fill, the half-life gradations, the hatched
dead zone and the drain head are exactly what they were.

**Extending the language to a data surface.** The reference has no tables, so
this is where it had to be extended rather than copied:

- A table is **the content of one large rounded `paper` panel** on the `field`
  ground, not a grid ruled onto the page. The panel's radius clips the header
  strip, which is why the scroll container carries it.
- **Rows are separated by whitespace, not rules.** Every `border-b` is gone; a row
  is 14px of padding plus a hover fill, and the decay bar gives each row a
  horizontal anchor to track along.
- **An expanded artifact opens a different ground underneath it.** The expansion
  row is `field`, and the first thing in it is a solid `ink` panel carrying what
  the artifact is, what it costs, and the decay bar at full width. Below that, two
  panels of different widths and different fills: a wide `paper` one for the long
  read, a narrow `plate` one for the reference column. Three panels, not eleven,
  because nine equal boxes in a grid is the failure mode this port invites.
- The clicked row itself stays light, on `wire-wash`. Making it dark too was the
  first draft and it was wrong: `wire` is this palette's selection colour, and the
  dark mass reads better as "here is the thing you opened" than as "this row is
  now a different kind of row".
- **The A/B comparison is two panels with different fills** rather than two
  columns of prose, which is also what fixes the earlier review's finding that
  below 768px the two sides stacked into one undifferentiated run of figures.

Every interactive component ships default, hover, focus, active, disabled,
loading, error. Skeletons in `--well` for loading. Empty states teach the
interface rather than saying "nothing here".

**Removed:** custom `::-webkit-scrollbar` styling. Reinventing a standard
affordance for flavour is a product-register ban, and it was doing no work.

### Disclosure

Two components, both native `<details>`, both in `components/primitives.tsx`.

- **`Caveat`** is the qualification. Its summary is a tight uppercase chip at
  `2xs` on `plate` (or `paper` on an `ink` panel, the only pair measured there),
  defaulting to the words *What this does not show*. It sits immediately under
  the figure, panel or table it qualifies.
- **`Disclosure`** is the longer aside: a pill at `sm` on `paper`. It holds the
  things that were always lists rather than sentences, such as the four
  settlement limits, the seven items of `NOT_SHOWN` and both retraction
  paragraphs.

Three properties, and each one is a rule rather than a preference:

1. **A number is never stated without a visible marker that a qualification
   exists.** The `Mark` provenance stamp sits beside every figure and the
   `Caveat` chip sits under every panel that has one.
2. **One action, every input method.** `<details>` is keyboard operable and
   announced as a disclosure without a line of JavaScript, so there is nothing
   to re-implement and nothing to get wrong. The marker is a caret rotated by
   `group-open`: a 150ms transform, not a layout animation, and covered by the
   existing `prefers-reduced-motion` blanket.
3. **Nothing is deleted to hit a budget.** The floors in
   `lib/prose-budget.test.ts{x}` are set just under what each surface carries
   today, so trimming a sentence is fine and gutting a panel turns the suite red.
   Deleting a caveat to pass a word budget is the one failure mode worse than the
   wall of text this replaced.

One side effect worth naming: two `Band tone="ember"` caution blocks on the
measurement desk became `Caveat`s, which removes two places where amber meant
something other than decay. `ember` is decay and nothing else, and the palette is
now one step closer to that being literally true.

## Motion

150–250ms, `ease-out` with an exponential curve. No bounce, no elastic, no
orchestrated page-load sequence.

Motion conveys state only: the one-shot flash on a value that changed since the
last poll, the decay bar's drain, a disclosure opening. Nothing animates for
decoration, and no CSS layout property is animated.

`prefers-reduced-motion: reduce` removes the flash and the drain and leaves every
value in place. Verified in the compiled CSS rule, not asserted.

**The explainer route is the exception, and it is one on purpose.** Its motion is
the explanation, not a state change, and it runs for two to three seconds a fold.
The rule that keeps it honest is different in kind: the finished frame is the
resting frame, so removing the motion removes nothing but the motion. Same
exponential ease, same ban on animating layout, same reduced-motion guarantee,
verified the same way.

## Every number says where it came from

Carried over from `PRODUCT.md` and non-negotiable: measured, author-reported, a
floor, or not observable. This project has retracted one fabricated measurement
already. An unsourced number on screen is a defect, and a plausible stand-in is
worse than an empty state.
