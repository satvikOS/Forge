# What fixing the frozen boundary actually bought, and what it did not

`forge::fea::tet::meshShape` densified the CAD surface in ONE pass, so boundary
spacing floored at the facet size and did not track `targetEdge`. Two commits fix it:
recursive densification, then longest-edge bisection after 4-way subdivision was
measured to over-refine slender geometry 14x.

All numbers below are before/after on the SAME test, from two builds of the same
worktree — the baseline is a git-pinned checkout at `38177d4b`, not a reverted file,
because an earlier attempt to swap the source in place raced the compiler and could
have produced a "baseline" built from the fixed code.

## The cantilever, four observables

`test/fea_smoke.cjs`, a 0.1 x 0.01 x 0.01 m steel beam, 100 N at the tip.

| | baseline | with fix | reference |
| --- | --- | --- | --- |
| nodes on the clamped face | **11** | **51** | — |
| mesh | 1874 nodes / 10224 tets | 5106 / 20436 | — |
| tip displacement | 17.624 um (**−91.2 %**) | 184.146 um (**−7.9 %**) | 200.0 um |
| peak von Mises | 28.70 MPa (**−52.2 %**) | 56.35 MPa (**−6.1 %**) | 60.0 MPa |
| 1st bending mode | 2661.6 Hz (**+226.4 %**) | 848.6 Hz (**+4.1 %**) | 815.4 Hz |

The mechanism is legible in the log. The clamped face carried **11 nodes**, because
its node set was the frozen one. A cantilever restrained at 11 points instead of 51 is
enormously over-stiff, which is exactly what a displacement 11x too small and a first
mode 3.3x too high report. Stress and modal frequency are independent of each other
and of the displacement; all three move together and land within 8 %.

The reference frequency is computed here, not taken from the test: Euler-Bernoulli
`f1 = (1.875104^2 / 2pi) sqrt(EI / rho A L^4)` = 815.4 Hz with E = 200 GPa (the value
the test's own quoted formula uses) and rho = 7850.

## NAFEMS LE1: from −61.5 % to −3.46 %

| targetEdge | tets | h_local | sigma_yy | err % |
| --- | --- | --- | --- | --- |
| 0.30 | 1599 | 0.16549 | −3.657 | −103.95 |
| 0.22 | 3113 | 0.11543 | 24.524 | −73.54 |
| 0.17 | 4757 | 0.10339 | 69.996 | −24.49 |
| 0.12 | 8893 | 0.07639 | 73.299 | −20.93 |
| 0.09 | 21576 | 0.05889 | 69.346 | −25.19 |
| 0.065 | 35875 | 0.04771 | 84.167 | −9.20 |
| 0.05 | 75755 | 0.03889 | 99.444 | +7.28 |
| **0.04** | 119173 | 0.03388 | **89.494** | **−3.46** |
| 0.032 | 131875 | 0.03070 | 87.439 | −5.68 (budget bound) |

`h_local` falls 0.16549 -> 0.03388, a 4.9x reduction. Before the fix it was frozen —
the committed baseline records LE1 at **35.671 MPa, −61.5 %**, against a ±5 % band.
At targetEdge 0.04 this is **−3.46 %, inside the band**.

## What it did NOT fix

**LE10 plateaus at ~35 %.** Its `h_local` now tracks properly (0.22153 -> 0.08312) and
its `p` values are small and interpretable instead of division artefacts, but the
error stops moving:

    0.3   49.43 | 0.24  35.14 | 0.2  35.99 | 0.15  35.46 | 0.115  35.91 | 0.09  34.20

Improved from the committed +60.5 %, and then flat. A second error source that the
boundary fix does not reach.

**Acceptance criterion (c) is NOT met.** I required the harness to report
`monotone error sequence: YES` before any `p` is quoted. It reports **NO** for both
LE1 and LE10. LE1's sequence oscillates around the target as it converges
(−103.95, −73.54, −24.49, −20.93, −25.19, −9.20, +7.28, −3.46) rather than descending
monotonically — the envelope converges, the sequence does not. That is a real result
and the criterion stands unmet; it is not being restated as a pass.

**LE11 could not be measured.** Its ball+cone+cylinder fuse is refused by the native
boolean path in this build, unrelated to anything here.

## An instrument finding, free with the above

`fea_smoke` printed **"PASS — Tet4 FEA cantilever within engineering plausibility
band"** on BOTH runs — including the one with a −91.2 % displacement error and a
+226 % first mode. Its band is wide enough that the defect this whole task is about
was invisible to it. It is a smoke test, not an accuracy gate, and nothing should
read it as one.
