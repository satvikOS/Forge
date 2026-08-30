# forge::unifyFaces segfaults on two coaxial equal-radius walls that are stored differently

**Measured 2026-08-28, RE-MEASURED and largely CORRECTED 2026-08-29.** Deterministic,
minimal, and present in the pinned baseline binary every published score is measured
with. Fixed on branch `fix/unifyfaces-pcurve-guard`.

## What the first characterisation got wrong

The original version of this finding said the trigger was **"six or more distinct
enlarged concentric bores, order irrelevant"**, and inferred an indexing or capacity
error inside `IntUnifyFaces` from the fact that five bores were fine and the sixth
crashed. Instrumenting `unifyFaces` with a pcurve and surface-type census showed all
three parts of that were wrong:

* **The first five holes cut nothing.** Their centres (-92.74 ... -10.3) lie outside
  the plate's x footprint of [0, 113.35]. n=1..5 every one returns
  `volume 404478.219345`, `faceCount 6` -- that is the plate box, to ten significant
  figures (113.35 x 44.95 x 79.386 = 404478.219345). Only the sixth centre, 10.3, is
  inside the part. **The "count threshold" was five no-ops followed by the first real
  hole.**
* **`HOLE` takes a DIAMETER**, not a radius: `%body, dia, cx, cy, cz`. So the `HOLE`
  of "8.99" that was believed to *enlarge* a radius-4.495 cut is radius 4.495 --
  exactly the same wall. It enlarges nothing.
* **Order is not irrelevant.** `HOLE` then `CUT` at the same radius does NOT crash.

The lesson is the one this programme keeps relearning: the reproducer was minimised
by deleting lines until the crash went away, and *deleting a line that did nothing*
looked exactly like *crossing a threshold*. Nothing was measured about the shape the
surviving lines actually built.

## The real trigger

`ShapeUpgrade_UnifySameDomain::IntUnifyFaces` dereferences a NULL `Geom2d_Curve`
(a pcurve) when the body carries **two coaxial, EQUAL-RADIUS, seam-carrying
cylindrical walls that are STORED DIFFERENTLY**:

* one an analytic `Geom_CylindricalSurface` -- what `HOLE` builds;
* one a `Geom_SurfaceOfLinearExtrusion` of a circle -- what `CIRCLE`+`EXTRUDE`+`CUT`
  leaves behind.

OCCT judges the pair same-domain and merges a periodic analytic surface with a
periodic extrusion surface. The pcurve that merge needs does not exist.

Measured on a plate with ONE bore -- a 9-line reproducer, not 34:

    cut radius   hole radius            result
      4.495        4.4950  (exact)      SIGSEGV
      4.495        4.4900               rc=0, 10 faces
      4.495        4.5000               rc=0,  8 faces
      4.495       10.0000               rc=0,  8 faces
      5.0          5.0000  (exact)      SIGSEGV
      3.0          3.0000  (exact)      SIGSEGV

Two coaxial equal-radius **analytic** walls (`HOLE` then `CUT`) merge fine, so the
mixed representation is the load-bearing part, not the coincidence alone. Hole count
and hole position are both irrelevant.

## Why the planned fix would not have worked

The previous version of this finding proposed a null-pcurve pre-check on the input
shape. **Measured: the crashing input has `nullPcurves=0`** -- 9 faces, 42
face-edge pairs, no degenerate edges, two seams, and every pcurve present. The null
is produced INSIDE the merge. A pre-check on the input never fires.

`ShapeUpgrade_UnifySameDomain::KeepShapes` -- withholding just the offending pair so
every other merge in the body survives -- was also implemented and measured: **all
six crashing cases still SIGSEGV.** `KeepShapes` stops a face being merged AWAY; it
does not keep the traversal off it.

## What is shipped

`mixedCoaxialSameRadiusFaces()` in `forge-kernel/src/DirectEdit.cpp` detects the
configuration -- seam-carrying walls, analytic-vs-extrusion, parallel axes, coincident
axis lines, radii equal within `Precision::Confusion()` -- and `unifyFaces` returns
the body UNMERGED when it is present. Behaviour changes ONLY where the current
behaviour is a SIGSEGV.

The recovered solids are correct, not merely non-crashing: at all three radii the
volume matches the closed form `plate - pi*r^2*(h/2)` to under 0.002 mm^3, with
`valid=true` and `shellCount=1`.

Gate: `forge-kernel/test/unify_coaxial_guard_test.sh`, 3 crashers + 6 untouched
cases, asserted on a vector of observables (validity, volume, face AND edge count,
shells) because volume alone has already been shown insufficient in this programme.
Mutation-proved: removing the guard gives exactly 3 reds.

## Blast radius, measured

Three dylibs (no guard / this guard / an over-wide guard that fires on radius
coincidence alone), selected at run time with `DYLD_LIBRARY_PATH` -- copying the
`forge_verify` executable does NOT select a variant, see
`AN_AB_THAT_COMPARED_ONE_BINARY_TO_ITSELF.md`:

    comparison                    20 refused rows      150 corpus rows
    this guard vs no guard        1 (ho1139 rescued)   0
    this guard vs over-wide       4                    39   (26%)

The guard is inert on real parts except where the crash is. Widening it would stop
same-domain unification on a quarter of them, so the analytic-vs-extrusion test is
load-bearing rather than cosmetic.

## Effect on the run

The real row that hit this, `ho1139` (55 ops), goes from `rc=139` with no output on
the pinned binary to `rc=0` with a parseable result and `valid=true` on the fixed
build. Before the verifier respawn fix, a crash here silently invalidated every
following row; after it, the row is merely REFUSED -- which still drops it from the
paired set. `ho1139` is one of v5cap's 20 refusals in the final 600-row run.
