# Wiring the DRAFT engine to `cylinderPCurve` — scoped, 2026-09-03

`cylinderPCurve` is built, linked and measured (62 checks, 0 failed, on the drafted
plane meeting a cylinder at 1–30°). **Nothing calls it.** This is what calling it
requires, located at the call sites rather than estimated.

## The gap, from the engine's own words

`forge-kernel/reports/DRAFT_NATIVE_ENGINE.md` §5: *"The entire remaining gap to OCCT is
73 parts, and every one is a drafted plane meeting a CYLINDER."* Native DRAFT is
**372/565 = 65.8%** against OCCT's **497/565 = 88.0%**, 0 disagreements. The 68 parts
neither engine drafts are 62 bspline+cylinder, 2 bspline, 2 cylinder, 2 cone — nothing is
owed there.

## CORRECTION, 2026-09-03: it is THREE sites, not two

This document first said "exactly two sites defer". **That was wrong**, and it was wrong in
the direction that matters — the site it missed is the one that actually ATTACHES the
pcurve. `grep -n 'defer("' src/native/brep/NativeDraftLocal.cpp` filtered to the
pcurve/non-planar reasons returns **664, 956 and 1022**.

`:1022` sits in the FACE rebuild:

```cpp
if (!planar) {
    for (TopExp_Explorer ex(oldF, TopAbs_EDGE); ex.More(); ex.Next())
        if (rebuiltNotRetrim.Contains(ex.Current().Oriented(TopAbs_FORWARD)))
            return defer("a non-planar face would need a new pcurve for a rebuilt edge");
}
```

A non-planar face may be rebuilt today **only** when every changed edge is a pure re-trim,
because then the pcurves are the same curves on the same surface and only their range
moves — which `EmptyCopied` already carried. A *new* curve needs a *new* pcurve, and the
engine will not make that approximation silently.

★**And that site is where the fitted pcurve has to land.** The face rebuild does
`nf = oldF.EmptyCopied()` — the cylinder's SURFACE is unchanged — and then re-adds each
wire with `edgeFor(...)` swapping in the rebuilt edges. So nothing about the face changes;
what is missing is the pcurve of the new edge **on** that face, attached with
`BRep_Builder::UpdateEdge(newEdge, pcurve2d, nf, tol)`.

## Three sites defer, and they name the same cause

| site | what it does |
|---|---|
| `NativeDraftLocal.cpp:664` | the **capability precondition**, checked BEFORE anything is solved: any wall edge with a non-planar neighbour defers |
| `NativeDraftLocal.cpp:956` | the **wall-edge rebuild**: `outwardPlaneOf(f, pl)` fails on a curved face, so it defers |
| `NativeDraftLocal.cpp:1022` | the **face rebuild**: a non-planar face with a rebuilt (not re-trimmed) edge defers — **this is where the fitted pcurve must be attached** |

The precondition is deliberate and must stay deliberate — its own comment says it is
"detected here, at its cause, so the defer reason names the capability gap instead of the
downstream symptom it produces three stages later (a vertex that misses one of its own
planes)". **Relaxing 664 without building the edge at 956 would produce exactly that
symptom: a half-drafted part that looks plausible.** The two edits are one change.

## ★ The vertex solve is ALREADY DONE — this is the finding that resizes the work

`NativeDraftLocal.cpp:816`:

```cpp
if (!have && planes.size() >= 2 && quadrics.size() == 1) {
    if (planeSystemLine(planes, L) && lineMeetQuadric(L, quadrics[0], oldP, cand)) { ... }
```

`lineMeetQuadric` (line ~488) solves a line against a cylinder / sphere / cone in **closed
form**, returning the root nearest the original vertex. So the vertices bounding a wall
edge that runs on a cylinder are **already solved** by the two-planes-plus-one-quadric
path. The blocker was never the vertex; it is only the EDGE and its pcurve.

## What is actually left

1. **`:664`** — allow a curved neighbour when `classifySurface(...) == SurfKind::Cylinder`
   and nothing else. Cone, sphere, torus and spline keep deferring, by name.
2. **`:936–956`** — a cylinder branch beside the plane/plane one. Today it collects two
   `Plane`s and calls `planeSystemLine` for a straight edge. The branch must instead:
   `planeCylinderSection(rotatedWallNormal, d, cylAx, r)` for the exact ellipse; check the
   two already-solved vertices lie on it, to the same `resTol` and with the same
   cross-check discipline the line path uses ("what makes the line a cross-check of the
   vertex solve rather than a restatement of it"); build the edge on that ellipse; and
   carry the fitted pcurve from `cylinderPCurve` forward to site 3.
3. **`:1022`** — stop deferring when the only rebuilt edges on that non-planar face are ones
   site 2 handled, and attach their pcurves with
   `BRep_Builder::UpdateEdge(newEdge, pcurve2d, nf, tol)`. The surface is untouched
   (`EmptyCopied`); only the pcurve is new.

## ★ It is a CONTRACT CHANGE, and it must be declared as one

The report is explicit: a sinusoidal `v(u) = a + b·cos u + c·sin u` has no `Geom2d` conic,
so it **must be approximated**, and that moves the engine from *"exact or defer"* to
*"exact except for a bounded pcurve deviation"* — *"a decision and not a detail"*.
Whatever lands must therefore carry the bound as a declared, measured tolerance, not a
silent one. `cylinderPCurve` already reports `maxDev3d` **out of sample** (its audit set is
deliberately offset from every sample the fit sees), so the bound is available to assert on
per edge rather than assumed globally.

## What would make it real

A **PAIRED** native-vs-OCCT pass rate re-measured on the same 565 parts, reported the way
#177 reported 372/565 — never a projection from "73 parts are cylinders". Until that
number exists, the correct statement remains: **`OCCT_CLOSURE` = 14, ZERO of 14 dropped**,
and this changes DRAFT capability only, since TKGeomAlgo is already a free rider.
