# RETRACTION: the "0.29 m frozen boundary" was cut-plane vertices, not mesh error

`LE10_ROOT_CAUSE_BOUNDARY_IS_OFF_THE_GEOMETRY.md` (commit `e234f649`) claimed a root
cause: boundary vertices near the probe sit up to **0.291263 m** off the true
ellipsoid, byte-identical across a 9.5x refinement. **That is wrong.** This note
retracts it and records what the corrected measurement says.

## What the number actually was

The worst vertex is at **(2.3121, 0.0000, 0.4500)**. Its `y` is exactly zero: it lies
on the **y = 0 symmetry cut plane** of the quarter model, a flat boundary face. Its
distance to the inner *ellipsoid* is 0.29 m because it was never meant to be on the
ellipsoid at all.

The first version of this measurement excluded the flat `z = 0` and `z = T` planes and
I wrote that exclusion up as the fix for an earlier confounded pass. It did not
exclude the `x = 0` and `y = 0` cut planes, which are equally flat and equally
legitimate. The value was byte-identical at every refinement because it is the *same
structural vertex on a flat face* — not because anything was frozen.

Two confounded passes, each corrected into another confounded pass, and the second one
produced 0.291263 against the first one's 0.29133 — nearly the same number for a
different wrong reason. That near-agreement is what made it convincing.

## The corrected measurement

Curved-surface vertices only — every flat face excluded (`z=0`, `z=T`, `x=0`, `y=0`):

| targetEdge | tets | curved verts near D | max \|dev\| | mean \|dev\| |
| --- | --- | --- | --- | --- |
| 0.30 | 2641 | 1 | 0.040594 | 0.040594 |
| 0.24 | 3996 | 2 | 0.051546 | 0.046070 |
| 0.20 | 6742 | 5 | 0.051546 | 0.034098 |
| 0.15 | 13020 | 10 | 0.051546 | 0.042230 |
| 0.115 | 25125 | 19 | 0.096381 | 0.055487 |

So the genuine deviation is **0.04–0.10 m, not 0.29**, and it does not converge — it
is worst at the finest level. That is still a real non-convergence, but it is a much
weaker claim than the retracted one, and the sample is **1 to 19 vertices**. A maximum
over one vertex is not a measurement.

## The fix built on the wrong cause, and it does nothing

`T-035` added an interior clearance: classify lattice points with
`max(mergeTol, 0.45 * targetEdge)` so points near the surface are `ON` rather than
`IN`, on the theory that exposed interior points were the steps. Measured, with and
without, on the corrected metric:

    max |dev|  WITHOUT  0.040594  0.051546  0.051546  0.051546  0.096381
    max |dev|  WITH     0.040594  0.051546  0.051546  0.051546  0.096381
    tets       WITHOUT     2641      3996      6742     13020     25125
    tets       WITH        2484      3836      6151     11934     23745

**Identical deviation at every level.** It removes 5–8 % of the elements and improves
nothing measurable. Not merged.

## Where that leaves LE10

The plateau is still real and still unexplained:

    targetEdge  0.30   0.24   0.20   0.15   0.115  0.09
    err %       49.43  35.14  35.99  35.46  35.91  34.20

What is still known and unaffected by this retraction:

* `h_local` at the probe now tracks `targetEdge` (0.22153 → 0.08312) after `T-025`.
* Nodal-averaging depth is refuted: measured d̄ shrinks 3.2x while the error implies a
  frozen ~0.106 m, disagreeing 4.4x.
* The same element, assembly, solver and recovery on a **structured conforming** mesh
  converge monotonically to **+10.69 %**. That control still points at the mesh.

What is NOT known: which property of the unstructured mesh causes it. "The boundary
does not converge to the geometry" survives as a *hypothesis* on a 19-vertex sample,
not as the established cause it was written up to be.

## The lesson, which cost two wrong measurements

Both bad passes came from measuring distance to a surface a vertex was never on. The
model is a quarter of an elliptic annulus: it has **six** boundary surface types, four
of them flat, and only two curved. An "error from the geometry" metric has to know
which surface each vertex belongs to before it can say anything — and when the answer
barely changes after correcting an obvious confound, that is a reason to look harder,
not a confirmation.
