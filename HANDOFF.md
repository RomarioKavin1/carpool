# Handoff

This file used to claim the project was "done, green, pushed" at a point when
`git clone && pnpm install && pnpm build` failed outright. It is kept only as a
pointer, so that nothing can claim a state the build does not have.

- **What this is, and what is unproven:** [README.md](README.md)
- **Wire contract:** [CONTRACT.md](CONTRACT.md)
- **Operations:** [docs/RUNBOOK.md](docs/RUNBOOK.md)
- **The kill test that returned STOP:** [docs/PHASE0.md](docs/PHASE0.md)
- **What buying saves versus redoing:** [docs/AB-MEASUREMENT.md](docs/AB-MEASUREMENT.md)
- **The two times v2 moved real money, both 2026-09-12:**
  [docs/evidence/v2-first-testnet-run/](docs/evidence/v2-first-testnet-run/) —
  one purchase and one settlement epoch, with a 19-check verifier; and
  [docs/evidence/v2-full-feature-run/](docs/evidence/v2-full-feature-run/) —
  27 purchases, 25 batches, 15 anchors, a refund settled on chain, 13 payees
  across two chunks, `reconcile()` recovering a real batch, and two processes
  racing one epoch to a single transfer, with a **61-check** verifier. Both
  verifiers import nothing from this repository. Everything *else* in the repo
  still runs against a stub facilitator.
- **Why the repo is shaped this way:** [docs/RESTRUCTURE.md](docs/RESTRUCTURE.md),
  with the three adversarial reviews that shaped it alongside it.

Current state is whatever `pnpm build && pnpm typecheck && pnpm test` says. Run
it rather than trusting a document, this one included.
