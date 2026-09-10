# The NAFEMS "negative order of accuracy" is a division artefact, and it blocked a task

`T-015` was blocked on this sentence, which I wrote:

> all three observed orders of accuracy are NEGATIVE (−0.06, −0.18, −6.70), i.e. the
> error GROWS under h-refinement. That is a formulation error, not under-resolution.

Both halves are wrong, and the evidence needed to say so was already in the repo.

## 1. The source already says the numbers are not rates

`forge-kernel/reports/FEA_NAFEMS_GAP.md`, line 194, same commit day:

> Every sequence is non-monotone, so Richardson extrapolation / GCI (ASME V&V 20-2009)
> does not apply to any of them — **which is why the `p` values in §2 are noise rather
> than rates.**

`test/fea_nafems_convergence.mjs` prints the same warning at runtime:
`monotone error sequence: NO — Richardson extrapolation / GCI does NOT apply`.

`test/fea_nafems_baseline.txt` nevertheless records them as "observed orders of
accuracy", and my block note repeated that framing. A number carried one file further
than its caveat became the reason a task sat blocked.

## 2. What −6.70 actually is

`p = log(err_prev / err) / log(h_prev / h)`, computed pairwise on LE11's recorded sweep:

| targetEdge | tets | h_local | err % | h ratio | log(h ratio) | p |
| --- | --- | --- | --- | --- | --- | --- |
| 0.45 | 1134 | 0.16035 | 17.51 | — | — | — |
| 0.38 | 1203 | 0.16038 | 11.84 | 0.9998 | **−0.0002** | **−2091.63** |
| 0.34 | 1491 | 0.15626 | 17.17 | 1.0264 | +0.0260 | −14.28 |
| 0.26 | 2253 | 0.12317 | 43.18 | 1.2687 | +0.2380 | −3.88 |
| 0.20 | 2840 | 0.11548 | 39.09 | 1.0666 | +0.0645 | **+1.54** |
| 0.155 | 5130 | 0.11002 | 31.67 | 1.0496 | +0.0484 | **+4.35** |

The exponent ranges from **−2092 to +4.35** depending only on which consecutive pair is
chosen. The first denominator is −0.0002 because `h_local` went the *wrong way* — it
**increased** by 3e-5 m when `targetEdge` was cut from 0.45 to 0.38. Dividing a real
error change by that produces any magnitude you like. The two finest pairs are
**positive**.

−6.70 is not a property of the physics. It is `log(something) / log(almost 1)`.

## 3. Why h_local will not move: the already-proven root cause

`targetEdge` fell 2.9x and the tet count rose 4.5x, and `h_local` fell **1.46x**. The
mesh refines everywhere except where the answer is read.

That is the mechanism established in
`implementation/sacrosanct/findings/NAFEMS_GAP_IS_A_FROZEN_BOUNDARY.md` for LE1 and
LE10, and it is still present at HEAD — `forge-kernel/src/FeaTet.cpp:854`:

```cpp
std::size_t ntri = triangles.size();          // captured BEFORE the loop
for (std::size_t ti = 0; ti < ntri; ++ti) {
    if ((B - A).norm() > minLen) tryAdd((A + B) * 0.5);   // one midpoint, once
    ...
    if (area > minArea) tryAdd((A + B + C) * (1.0 / 3.0));
}
```

`tryAdd` appends to `bndPts` and never to `triangles`, so the boundary is densified
exactly once regardless of `targetEdge`. Measured there: the LE1/LE10 boundary node set
is byte-identical across a **69x** increase in tet count, and the stress-recovery patch
is frozen at 0.625 m. LE11 is the same defect seen through a different quantity — the
one the convergence study happens to divide by.

## 4. The formulation is exonerated, by measurement

On a structured exactly-conforming mesh with `meshShape` bypassed — same element, same
assembly, same CG solver, same nodal recovery — the error is monotone and converges:

    LE1   −72.13 → −59.36 → −44.71 → −26.16 → −14.51 → −10.22 → −7.32 %
    LE10  +81.22 → +63.68 → +48.27 → +25.27 → +12.81 → +10.69 %

and `test/fea_tet4_convergence.mjs` measures **p = 1.934 / 1.051** on the same element.
A formulation error does not converge at rate when you hand it a conforming mesh.

## 5. What this changes

`T-015`'s acceptance was "a root cause for the NEGATIVE order of accuracy, established
by a convergence study, before any mesher swap". That is now satisfied, and the answer
is in two parts:

1. There is no negative order of accuracy to explain. The sequences are non-monotone
   and the exponents are division artefacts; the harness says so itself.
2. The real defect is single-pass boundary densification in `meshShape`, already proven
   for LE1/LE10 and shown here to drive LE11 as well.

The task is no longer research. It is an implementable mesher change — make boundary
densification iterate to `targetEdge` instead of once — with a ready-made falsifiable
test: `h_local` at the probe must track `targetEdge`, and the boundary node count on the
`y=0` face must stop being byte-identical across refinements.

## 6. What this does NOT say

- It does not claim the mesher fix will close the 40–60 % gap. It predicts `h_local`
  will track `targetEdge`; the accuracy that follows has to be measured, not assumed.
- It does not re-open the LE1/LE10 root cause, which was already proven and is only
  corroborated here.
- LE11 remains environment-dependent: its ball+cone+cylinder fuse is REFUSED on the CI
  runner and succeeds on this machine (`NAFEMS_EXPECTED_BLOCKED_SET="LE11"`). Every
  LE11 number here is from the recorded local sweep, not from CI.
- The published-target gap itself is untouched by this note. Nothing here says the
  answers are right; it says the *reason* recorded for their being wrong was not.
