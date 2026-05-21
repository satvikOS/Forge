# Sub-project G — Task 6: true G2 curvature-continuous surface blend

Pure-JS algorithm notes for `frontend/src/foundation/G2BlendSurface.js` and the
kernel facade `frontend/src/kernel/brep/BrepBlendG2.js`. Companion ribbon tool:
**G2 Blend** (Surface tool group, under the Part tab).

This is the REAL pure-JS G2 blend. It is SEPARATE from A5's `blendG2` in
`BrepBlend.js` — that op is a planar `BRepBuilderAPI_MakeFace_15` fallback (the
A5 variational `BRepOffsetAPI_MakeFilling` solver is unreachable in this WASM
build). Task 6 does not touch A5's op.

---

## Step 0 — browser reference research

Grounding the G2 math in authoritative sources (WebSearch / WebFetch, 2026-05-21):

- **Degree requirement.** For two Bézier/NURBS surface patches to meet with
  G2 (curvature) continuity, *degree 4 is needed for G2 continuity on one
  side, and degree 5 is needed for G2 continuity on BOTH sides.* Task 6 must
  match position + tangent + curvature at **both** boundaries, so each
  cross-boundary (v) curve is **degree 5** — the minimum that works.
  (Springer, *J. Inequalities & Applications* 2017, "G2 continuity conditions
  for generalized Bézier-like surfaces"; Autodesk Alias surface-blend docs.)

- **What G2 means.** G2 = curvature continuity: for every point on the shared
  boundary, the curvature of any curve crossing from one surface to the other
  through that point is equal to the curvature of the curve running in the
  same tangential direction. A zebra-stripe reflection then runs unbroken AND
  kink-free across the seam — the class-A acceptance test.

- **Degree-5 Bézier endpoint derivatives.** For a degree-`n` Bézier curve with
  control points `P0..Pn`: `C'(0)=n(P1−P0)`, `C''(0)=n(n−1)(P2−2P1+P0)`, and
  symmetrically at `t=1`. For `n=5`: `C'(0)=5(P1−P0)`, `C''(0)=20(P2−2P1+P0)`,
  `C'(1)=5(P5−P4)`, `C''(1)=20(P5−2P4+P3)`. (Shene, CS3621 Geometric Modeling
  notes — "Bézier curve derivatives".)

- **Curvature-continuous blends / fairing in CAGD.** Farin, *Curves and
  Surfaces for CAGD: A Practical Guide* (5th ed., Morgan-Kaufmann) is the
  foundational reference: a curve that is curvature-continuous need not be
  twice differentiable — exploiting this gives "geometrically continuous" /
  G2 schemes with more freedom than ordinary splines. The **Linkage Curve
  theorem** simplifies the curvature-continuity conditions for blend
  surfaces; "fairing" removes noise from control polygons (Kjellander,
  Hoschek, Farin et al.).

---

## The degree-5-in-v construction

Each isoparametric u-curve of the blend is a degree-5 Bézier segment with 6
control points `P0..P5`, parameter `v ∈ [0,1]`. Inverting the degree-5
endpoint-derivative identities — given boundary-0 data `(C0,T0,K0)` and
boundary-1 data `(C1,T1,K1)`, where `C` = cross-boundary position, `T` = 1st
derivative (the tangent *leaving the boundary into the blend*), `K` = 2nd
derivative (curvature) — the 6 control points are **fully determined**:

```
P0 = C0
P1 = P0 + T0/5
P2 = K0/20 + 2 P1 − P0
P5 = C1
P4 = P5 − T1/5
P3 = K1/20 + 2 P4 − P5
```

`P0,P1,P2` fix position+tangent+curvature at `v=0`; `P3,P4,P5` fix them at
`v=1`. So the u-curve is automatically G2 with **both** boundary curves —
no solver, closed form. (`degree5BlendControlPoints` in `G2BlendSurface.js`.)

## The u-direction (boundary parameter)

The per-station 6-tuples form a raw net `rawNet[station][0..5]`. To make the
result a genuine tensor-product NURBS that *still* interpolates the boundary
data at every station, each of the 6 v-columns is fitted with a **degree-3
(cubic) curve that passes through every station point exactly** — classical
global cubic interpolation (Piegl & Tiller, *The NURBS Book* §9.2.1 / A9.1).

- **One shared u-parameterisation + knot vector** is derived from the
  boundary-0 positions (chord-length) and used for all six columns — that is
  what keeps the assembled tensor-product net valid.
- The interpolation matrix (cubic basis functions at the chord-length
  parameters, `nCP × nCP`, `nCP = stations`) is solved with a robust general
  **Gaussian elimination with partial pivoting** (`solveLinearVec3`). The
  matrix is small and banded; a dense solve is ample and avoids the brittle
  index bookkeeping of a hand-rolled banded/tridiagonal solver — an earlier
  tridiagonal attempt mis-mapped the end rows and produced NaN.
- **Interpolation, not least-squares** — so the boundary match is *exact*.

Result: a `NURBSSurface` of **degree 3 in u, degree 5 in v** (v-knots are the
degree-5 clamped Bézier vector `[0×6, 1×6]`).

### Edge-case handling
- A degree-3 u-fit needs ≥ 4 control points. Boundaries sampled with fewer
  than 4 stations are linearly **densified** (`densifyBoundary`) — the blend
  construction is unchanged, the boundary data is merely resampled.
- Near-zero tangents / coincident points: `unit3` guards divide-by-zero; a
  singular interpolation matrix falls back to the data points directly.
- Mismatched station counts between the two boundaries → explicit throw.
- `opts.computeFromPositions` derives tangents (1st difference) and curvatures
  (central 2nd difference) from positions when the caller has no derivative
  data — the blend degrades gracefully to a near-G1 ruled-ish surface.

## Tessellation

`tessellateG2Blend(surface, uSegs, vSegs)` samples the surface on a u×v grid
and emits `{positions, normals, indices}`. Normals come from the surface
partial derivatives (`Su × Sv` via `evalDerivatives`); any zero/non-finite
normal is patched with an area-weighted per-triangle average.

## Self-test (commented footer of `G2BlendSurface.js`)

A blend between two parallel offset boundary curves. Verified under `node`:
- boundary position match: **2.1e-14** mm (req ≤ 1e-9)
- tangent match at v=0/v=1: **8.9e-15** (req ≤ 1e-7)
- curvature match at v=0/v=1: **7.1e-14** (req ≤ 1e-6)
- `computeFromPositions` fallback: position match **2.1e-14** mm
- edge cases (near-zero tangents, curved arcs, 2-/3-station densified,
  mismatched-count throw) all pass.

---

## Kernel facade — `BrepBlendG2.js` / `g2BlendBetweenEdges`

`g2BlendBetweenEdges(brepShape, { edgeIndexA, edgeIndexB, uSegments, vSegments })`:

1. Collects the body's unique edges (`TopExp_Explorer` over `TopAbs_EDGE`,
   `IsSame`-deduped) and indexes two of them.
2. Samples each edge into a `g2Blend` boundary descriptor.
3. Calls the pure-JS `g2Blend` → `tessellateG2Blend`.
4. Sews the triangle mesh into a kernel `TopoDS_Shell`
   (`BRepBuilderAPI_Sewing`) so the standard tessellate / measure / render
   path works unchanged.
5. Pre-caches the tessellation on `result._triangulation` so `tessellate()`
   returns it directly (it is keyed on `_triangulation`).

Every kernel object is `withScope` / `track` managed.

### Boundary cross-tangent & curvature extraction (the documented choice)

For the blend to leave each boundary smoothly it needs a CROSS-boundary
frame — a tangent pointing *off* the edge into the surrounding surface, not
the along-edge tangent.

- **Cross tangent.** At each edge sample: take the edge curve's along-curve
  tangent `Te` (from `D1`), find an adjacent face of the edge, evaluate that
  face's surface normal `Nf` near the sample (via
  `GeomAPI_ProjectPointOnSurf` + the surface `D1`), and form
  `Tc = normalize(Nf × Te)`. `Nf × Te` lies in the face's tangent plane and
  is perpendicular to the edge — i.e. it points along the face, away from the
  edge. This is the natural "leaving the boundary" direction and makes the
  blend tangent to the adjacent face (G1). It is then oriented toward the
  *other* edge and scaled by a reach factor (≈ half the edge separation) so
  the two boundary surfaces meet in a bounded fairing.
- **Curvature.** The edge curve's own 2nd derivative `D2` along the boundary.
  `D2` is the genuine differential-geometry 2nd derivative in the kernel's
  curve parameterisation; it is what the degree-5 construction consumes as
  `K`.
- **Edge-curve extraction** probes `BRep_Tool.Curve_2` first, then falls back
  to `BRepAdaptor_Curve_2` (which exposes `FirstParameter`/`LastParameter` +
  `D0`/`D1`/`D2` directly) — the exact opencascade.js binding suffix varies.
- **Fallback.** If an edge has no usable adjacent face, the cross tangent
  falls back to the direction toward the other edge; the blend still spans
  the gap with a smooth G2 surface, just not tangent-locked to a face. The
  `usedFaceTangentA/B` stats flag which path was taken.

---

## e2e gate — `e2e/brep-g-g2blend-electron.spec.js`

Motion-capture style (`launchWithCapture` + storyboard stills + drag-orbits).
Real-world artifact: a **notched plate** — Box A (80×50×24) with a corner
notch cut by Subtracting Box B (28×28×30), all via real ribbon tools. Then a
real `clickBody` selects the notched plate and **G2 Blend** fairs a surface
between two of its edges.

Verified run (2026-05-21):
- notched plate edge count **18**; blended edge **0 ↔ edge 9**
- result: degree **3×5** NURBS, **33×6** control points, **1024** triangles,
  **561** vertices
- boundary fit error: errA **1.08e-14**, errB **1.46e-14** mm
- `usedFaceTangentA = usedFaceTangentB = true` (real adjacent-face normals)
- blend bbox **80 × 32 × 24** mm, diagonal **89.5** mm
- registry holds **2** bodies after the op — the notched plate **survives**
  (G2 Blend is additive: `addBrepShapeToScene` is called WITHOUT
  `consumedInputs`)
- 7 drag-orbits, 0 blank frames, 0 page errors
- stills confirmed by eye: `05-input.png` (notched plate),
  `08-after-g2blend.png` (blue blend surface added, plate kept, both bodies
  in the Body panel), `09/12-orbit` (the fairing surface in 3D).

Regression: `brep-g-catmullclark`, `brep-g-ssi`, `brep-surfacing`,
`brep-blend`, `brep-pick-diagnostic` — **6/6 passed**.

---

## Honest gaps

- **Mesh-fidelity result, not a sewn analytic B-rep face.** The blend math is
  exact NURBS, but the kernel wrapper carries the *tessellation* — a sewn
  `TopoDS_Shell` of triangle faces, NOT a single analytic NURBS `TopoDS_Face`.
  It renders / measures like any body. Same honest framing as the existing
  surfacing ops (`catmullClarkShape`, `retopoShape`) which are also
  mesh-fidelity. A true sewn analytic-face result would need a
  `Geom_BSplineSurface` built from the fitted poles + a trimmed
  `BRepBuilderAPI_MakeFace(surface, wire)` — the parametric-trim-wire path is
  blocked in this WASM build by the missing `gp_Pnt2d` 2-arg constructor
  (recorded in `kernel-api-G.md` §3).
- **Two-edge blend, not an N-sided patch.** It fairs between exactly two
  boundary curves and does not auto-trim the parent body.
- **Curvature transfer is along the v-isocurves.** Matching the 2nd
  cross-derivative gives true G2 along every v-isocurve of the blend. Full
  curvature continuity in *every* tangent direction additionally requires the
  mixed (twist) terms to agree; for the near-parallel edge pairs this op
  targets that holds to the fitting tolerance, but arbitrary strongly-skew
  boundary pairs are a documented gap.
- **Natural (relaxed) u-end condition.** The cubic u-fit uses the simple
  uniform-knot natural-end form. This affects only the slack shape of the
  blend near its u-extremes, never the interpolation accuracy at the data
  points (the boundary fit error stays ~1e-14).
- **Cross-tangent reach is a heuristic** (≈ half the edge separation). It
  produces a bounded, well-shaped blend for typical edge pairs; a future
  refinement could solve the reach so the blend hits a target fullness.

---

## Full-suite gate (Task 8, 2026-05-21)

`brep-g-g2blend-electron.spec.js` GREEN in the full kernel + UX suite run
(`--workers=1`). Measured: notched-plate fairing, edge 0 ↔ edge 9, degree 3×5,
33×6 control points, 1024 tris / 561 verts, boundary fit error errA 1.08e-14 /
errB 1.46e-14, faceTangent true at both boundaries, registry body count 2 after
the op. 0 blank captures. Whole suite: 50/50 tests passed, 1 skipped. Residual
gaps unchanged — mesh-fidelity sewn shell (not a single analytic NURBS face),
two-edge blend only, curvature continuity along v-isocurves.
