# LE10's plateau: the surface the stress is read from is 0.29 m off the geometry, frozen

`T-026` asked for a root cause established by measurement before any code change —
the standard `T-015` was held to. This establishes one.

## The plateau

After the boundary-densification fix, LE10 stops improving:

    targetEdge  0.30   0.24   0.20   0.15   0.115  0.09
    err %       49.43  35.14  35.99  35.46  35.91  34.20
    tets         2641   3996   6742  13020  25125  45098

`h_local` at the probe now tracks properly (0.22153 → 0.08312), so the *spacing* is
no longer frozen. Something else is.

## The measurement

Boundary vertices on the **lateral** surfaces within 0.35 m of D = (2, 0, 0.6),
measured against the ellipsoid each belongs to. Top and bottom plane vertices are
excluded: an ellipsoid distance is meaningless for them, and including them
confounds the result — a first pass that did include them reported a max of 0.29133
that was simply a top-plane vertex correctly sitting radially outside the inner
surface.

| targetEdge | tets | lateral verts near D | **max \|dev\|** | mean \|dev\| |
| --- | --- | --- | --- | --- |
| 0.30 | 2641 | 4 | **0.291263** | 0.108363 |
| 0.24 | 3996 | 7 | **0.291263** | 0.097795 |
| 0.20 | 6742 | 11 | **0.291263** | 0.076316 |
| 0.15 | 13020 | 20 | **0.291263** | 0.084393 |
| 0.115 | 25125 | 37 | **0.291289** | 0.088861 |

**The maximum deviation is byte-identical across a 9.5x refinement.** The mean does
not converge either — 0.108, 0.098, 0.076, 0.084, 0.089, wobbling with no trend.

The inner ellipse has semi-axes 2.0 x 1.0. A vertex 0.29 m off it is ~15 % of the
minor axis, and `nodeSyy` at D is recovered from tets incident to exactly that
surface.

## Why the densification fix did not touch this

Two different defects with the same symptom. The first was **spacing** — boundary
points did not get closer together as `targetEdge` fell, because densification ran
once. That is fixed: the point count near D grows 4 → 37.

This is **position** — the points are denser and still not *on* the geometry. The
Bowyer-Watson fill has no boundary recovery and the domain is carved by centroid
classification, so interior lattice points get exposed on the surface as steps.
Adding more of them makes a finer staircase, not a smoother ellipse.

## What makes this causal rather than correlated

Same element, same assembly, same CG solver, same nodal recovery, on a **structured
exactly-conforming** mesh with `meshShape` bypassed: LE10 converges monotonically to
**+10.69 %**. The only thing that differs is the mesh's fidelity to the geometry.

Unstructured, boundary frozen 0.29 m off: **plateaus at ~35 %**.

## What is NOT established

The quantitative link. "The boundary is 0.29 m off" and "the error is 35 %" are both
measured; deriving the second from the first is not attempted here, and a fix should
be judged by measurement rather than by that inference. A conforming-boundary mesher
is the test, and it is a code change — which is why it comes after this note rather
than inside it.

Also unexplained, and recorded because it is odd: the recovery patch at D holds only
3–7 incident tets at **every** level, including at 45,098. D sits where the inner
elliptical surface meets the top face, so a small patch is expected — but a stress
concentration recovered from three constant-strain tets is thin regardless of where
the surface is.
