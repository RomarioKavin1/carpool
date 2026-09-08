# Product

## Register

product

Hybrid, resolved deliberately. The surface is an app UI over live registry data, so
design serves the product. But its first job is explanatory: a stranger must
understand a mechanism they have never seen before, in about thirty seconds, before
any table means anything to them. So the top of the page does brand-register work
(teach the idea) and everything below it does product-register work (show the real
state). Where the two conflict, comprehension wins above the fold and density wins
below it.

## Users

**Primary: a newcomer with thirty seconds.** A hackathon judge with forty projects
to get through, or someone who followed a link. They have never heard of Carpool.
They do not know what a magnet is, what decay means, or why an artifact has a
health score. If they leave still thinking "it's a marketplace, I guess", the page
has failed regardless of how correct the data is.

Secondary, and they must be able to get to their view quickly without being the
default:

- **An author** checking what they were actually paid, and whether it settled.
- **An operator** watching the swarm: live activity, settlement health, anchors.

The newcomer is never an expert in the domain. The author and operator are.
Language that serves the experts by default will lose the newcomer, so the page
should read plainly and let the precise machine vocabulary appear on demand.

## Product Purpose

An AI agent about to spend twenty minutes researching something checks first
whether somebody already did that research, and buys it instead for a fraction of
the cost. The author who did the work gets paid per sale. The same computation
stops being run independently by people who never knew about each other.

Artifacts are content-addressed and their price decays as they age, because
research goes stale and a free substitute usually appears within half a day.

Success for this interface: a stranger can state the idea back in their own words
after half a minute, and an author can see that real money reached their account.

## Brand Personality

Plain-spoken, exact, unhurried.

It explains itself in ordinary words and then shows its working. It never claims
more than it measured, and it says which numbers are floors, which are estimates,
and which it cannot observe at all. Confidence comes from showing the transaction,
not from adjectives.

Tone: a good engineer explaining their own system to a smart outsider. Neither
salesy nor cryptic.

## Anti-references

All four were named explicitly by the user as things this must not look like:

- **Generic SaaS dashboard.** Cards in a grid, KPI tiles, gradient accents,
  rounded everything. Already rejected once in this project.
- **Crypto / web3 dark neon.** Neon on black, glows, glassmorphism, blockchain
  gradients. The default reflex for anything touching Hedera or x402, and
  therefore the first thing to avoid.
- **Sparse marketing landing page.** Big hero, three feature columns, plenty of
  air and no real data. Whitespace without substance.
- **The current dense terminal look.** Everything visible at once, tiny type, no
  breathing room. The user's words: "very crammed", "doesn't work well".

The last two together are the binding constraint: **whitespace with substance.**
Air is not achieved by removing information, it is achieved by sequencing it.

## Design Principles

1. **Teach before you show.** The first thing on the page is the idea in plain
   language with one concrete comparison. Nobody reads a table they have no reason
   to care about.
2. **Whitespace by sequencing, not by subtraction.** Everything real stays
   available. It arrives in an order, at a rhythm, instead of all at once. Density
   is earned by scrolling or asking, never imposed on arrival.
3. **Plain words outside, exact words inside.** "It costs $0.0025 instead of
   $3.97" on the surface; `magnet`, `freshness`, `µUSDC`, `settledBatchId` when
   someone opens a detail. Never make the newcomer learn the vocabulary to read
   the headline.
4. **Every number says where it came from.** Measured, author-reported, a floor,
   or not observable. This project has already retracted one fabricated
   measurement; an unsourced number on screen is a defect, and a plausible
   stand-in is worse than an empty state.
5. **The money is the proof.** The strongest thing this product can show is a real
   transaction that paid a real author. That belongs in the open, linked to a
   public explorer, not buried three panels deep.

## Accessibility & Inclusion

- WCAG 2.2 AA as the floor, contrast **measured** rather than assumed, including
  alpha-composited text (a previous pass shipped a 4.29:1 failure precisely
  because only solid tokens were audited).
- Never encode meaning in hue alone. Decay, health and payout state must each be
  readable through text, position or shape as well as colour, for colour-blind
  readers and for anyone glancing at a projector.
- Full keyboard operability for search, table navigation and any disclosure; a
  visible focus style that is not a hue-only change.
- `prefers-reduced-motion` genuinely honoured, verified in the compiled CSS rather
  than asserted.
- Legible at a distance and under bright ambient light: a judge reads this on a
  laptop in a lit hall, not in a dark room.
