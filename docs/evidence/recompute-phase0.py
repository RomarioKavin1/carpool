#!/usr/bin/env python3
"""Recompute every published Phase 0 statistic from the raw rater labels.

docs/PHASE0.md reports a STOP verdict: overlap 41.7% against a 50% bar, Cohen's
kappa 0.26 against a 0.6 bar. Those are the numbers that killed the original
thesis, so they are the numbers most worth being able to check. This reads
section 6 of docs/evidence/phase0-rater-data.md and derives all of them.

Run:  python3 docs/evidence/recompute-phase0.py
Exits non-zero if any published figure no longer reproduces.
"""
import re
import sys
from pathlib import Path

DATA = Path(__file__).with_name("phase0-rater-data.md")

# What docs/PHASE0.md publishes. Any drift here should fail loudly.
PUBLISHED = {
    "pairs": 36, "a_two": 17, "b_two": 12, "adj_two": 15,
    "kappa": 0.26, "p_o": 0.64, "p_e": 0.51,
    "disagreements": 13, "adj_zero": 0, "adj_one": 21,
    "per_event": {"E1": 0.20, "E2": 0.20, "E3": 0.80, "E4": 0.00,
                  "E5": 0.40, "E6": 1.00, "E7": 1.00, "E8": 0.20},
}
ROW = re.compile(r"^\|\s*(\d+)\s*\|\s*(E\d)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([012])\s*\|\s*([012])\s*\|\s*([012])\s*\|")


def main() -> int:
    rows = []
    for line in DATA.read_text(encoding="utf-8").splitlines():
        m = ROW.match(line)
        if m:
            rows.append((m.group(2), int(m.group(5)), int(m.group(6)), int(m.group(7))))
    if not rows:
        print(f"no pair rows found in {DATA}", file=sys.stderr)
        return 1

    n = len(rows)
    a = [r[1] for r in rows]
    b = [r[2] for r in rows]
    adj = [r[3] for r in rows]

    # Cohen's kappa, unweighted. PHASE0 notes the weighted variants agree
    # because no rater ever used 0.
    p_o = sum(x == y for x, y in zip(a, b)) / n
    p_e = sum((a.count(c) / n) * (b.count(c) / n) for c in (0, 1, 2))
    kappa = (p_o - p_e) / (1 - p_e)

    per_event: dict[str, list[int]] = {}
    for event, _, _, ad in rows:
        per_event.setdefault(event, []).append(ad)

    fails = []

    def check(label, got, want, places=2):
        ok = round(got, places) == round(want, places)
        print(f"  {'ok ' if ok else 'FAIL'}  {label:34s} {got:.4f}  published {want}")
        if not ok:
            fails.append(label)

    print(f"{n} pairs from {DATA.name}\n")
    check("pairs", n, PUBLISHED["pairs"], 0)
    check("rater A scored 2", a.count(2), PUBLISHED["a_two"], 0)
    check("rater B scored 2", b.count(2), PUBLISHED["b_two"], 0)
    check("adjudicated scored 2", adj.count(2), PUBLISHED["adj_two"], 0)
    check("observed agreement p_o", p_o, PUBLISHED["p_o"])
    check("expected agreement p_e", p_e, PUBLISHED["p_e"])
    check("Cohen's kappa", kappa, PUBLISHED["kappa"])
    check("disagreements", sum(x != y for x, y in zip(a, b)), PUBLISHED["disagreements"], 0)
    check("adjudicated scored 0", adj.count(0), PUBLISHED["adj_zero"], 0)
    check("adjudicated scored 1", adj.count(1), PUBLISHED["adj_one"], 0)
    print()
    for event in sorted(per_event):
        scores = per_event[event]
        check(f"per-event overlap {event}", scores.count(2) / len(scores), PUBLISHED["per_event"][event])

    print(f"\noverlap: A {a.count(2)/n:.3f} · B {b.count(2)/n:.3f} · adjudicated {adj.count(2)/n:.3f}")
    print(f"stop rule: overlap {adj.count(2)/n:.3f} < 0.50 and kappa {kappa:.2f} < 0.6 — STOP, as published")
    if fails:
        print(f"\n{len(fails)} published figure(s) no longer reproduce: {', '.join(fails)}", file=sys.stderr)
        return 1
    print("\nall published Phase 0 figures reproduce from the raw labels")
    return 0


if __name__ == "__main__":
    sys.exit(main())
