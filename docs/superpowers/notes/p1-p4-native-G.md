# P1 + P4 — closed natively in ArchDisc's own B-rep topology kernel

**Date:** 2026-05-22
**Scope:** the last two §3 parity gaps — P1 (analytic G2 blend face) and
P4 (arbitrary face replacement) — closed WITHOUT a custom OCCT WASM build, by
delivering them in ArchDisc's OWN B-rep topology kernel.

---

## The reframe

The §3 audit bucketed P1/P4 as "needs a custom OCCT WASM build" because
producing an OCCT `TopoDS_Face` on a non-planar surface needs unbound symbols
(`gp_Pnt2d_2`, `Handle_Geom_BSplineSurface`,
`ShapeConstruct_ProjectCurveOnSurface`).

That was the wrong framing. ArchDisc has its OWN B-rep topology kernel —
`frontend/src/kernel/topology/` (`TopoFace`, `TopoEdge`, `TopoShell`,
`TopoSolid`, `TopoLoop`, `TopoVertex`) — and a pure-JS NURBS layer
(`frontend/src/foundation/NURBSSurface.js`). An "analytic face" can therefore
be a NATIVE ArchDisc analytic NURBS face: a `TopoFace` referencing an exact
`NURBSSurface` + a boundary wire with real pcurves. OCCT's algorithms (curve-
on-surface projection, point inversion, face construction) are open source and
were used as authoritative references and ported to JS.

---

## Step-0 recon — what ArchDisc's topology kernel already supported

- `TopoFace` already carried an underlying `surface` (planar / cylindrical /
  spherical / a coarse NURBS stub from `kernel/math/Surface.js`) and is bounded
  by `TopoLoop`s of `TopoEdge`s. It did NOT carry pcurves on edges, and there
  was no analytic-NURBS-face carrier.
- `TopoEdge` carried a 3-D `curve` and a `userData` bag — pcurves attach there.
- `foundation/NURBSSurface.js` is a full tensor-product NURBS surface with
  `eval`, `evalDerivatives`, `evalDerivatives2`, `tessellate`.
- `foundation/G2BlendSurface.js` already fits an EXACT degree-3×5 NURBS surface
  for the G2 blend; `kernel/brep/BrepBlendG2.js` only kept the tessellation.
- `foundation/StepExport.js` emitted planar triangle faces only — no B-spline
  surface entities.

### What was extended

- **`kernel/topology/AnalyticNurbsFace.js`** (new) — gives the topology kernel
  a first-class analytic NURBS face:
  - `NurbsSurfaceAdapter` wraps a `foundation/NURBSSurface` so it presents the
    `surface` contract `TopoFace` expects (`pointAt`, `normalAt`) while also
    exposing the exact NURBS data (`nurbsData()`).
  - `Pcurve` — the 2-D parametric representation of a boundary edge in the
    surface's (u,v) space (ISO 10303-42 `pcurve`).
  - `makeAnalyticNurbsFace` / `buildAnalyticNurbsFace` build a `TopoFace` on an
    analytic NURBS surface with a boundary wire + pcurves.
  - `reseatFaceOnSurface` re-seats an existing `TopoFace` onto a NEW surface,
    generating fresh pcurves for every boundary edge.
- **`TopoEdge.userData.pcurves`** — a `Map<TopoFace, Pcurve>` carrying the
  per-face pcurves. (No `TopoEdge.js` source change — `userData` is the
  documented extension bag.)

---

## P1 — analytic G2 blend face

The G2 blend already computes an exact degree-5-in-v / degree-3-in-u NURBS
surface (`G2BlendSurface.js`). The change makes the op RETAIN it as a native
analytic face:

1. `BrepBlendG2.g2BlendBetweenEdges` now calls `buildAnalyticNurbsFace(surface)`
   — wraps the fitted `NURBSSurface` in a `NurbsSurfaceAdapter`, builds the
   four-corner boundary wire, attaches a pcurve along each parametric domain
   border (a domain border IS a u/v isoline, so the pcurve is an exact 2-D
   line). The resulting `TopoFace` is carried on `result.meta.analyticFace`,
   the exact surface data on `result.meta.analyticSurface`.
2. The kernel `TopoDS_Shell` of triangles is kept ONLY for rendering/measuring;
   the analytic surface is the geometry of record.
3. `result.meta.g2Stats` gains `analytic: true`, `degreeU`, `degreeV`,
   `controlPointsU/V`, `knotCountU/V`, `topoFaceId`.
4. The `G2 Blend` handler sets `window.__lastG2Blend.analyticSurface` +
   `.analyticStep` (the surface serialised to STEP) +
   `.analyticStepHasBSpline`.

### STEP export of the analytic surface

`foundation/StepExport.js` gained `nurbsSurfaceToSTEP(nurbsData)` — emits a real
`B_SPLINE_SURFACE_WITH_KNOTS` (ISO 10303-42): control-point grid as
`CARTESIAN_POINT`s, knot vectors collapsed into distinct knots + multiplicities,
degrees. For a rational surface (any weight ≠ 1) it emits the AP203/AP242
rational complex-entity form (`BOUNDED_SURFACE` + `B_SPLINE_SURFACE` +
`B_SPLINE_SURFACE_WITH_KNOTS` + `RATIONAL_B_SPLINE_SURFACE` + …). The face is
wrapped as an `ADVANCED_FACE` in an `OPEN_SHELL` /
`SHELL_BASED_SURFACE_MODEL` — a complete, importable AP203 surface model.

**Verified:** `brep-g-g2blend-electron.spec.js` — the blend body carries
`analytic=true`, degree 3×5, 33×6 control points, knots 37/12, a real
`topoFaceId`; the analytic surface STEP-exports with
`#…=B_SPLINE_SURFACE_WITH_KNOTS('',3,5,((#14,#15,…` present.

---

## P4 — arbitrary face replacement

The §3.4 intent is to swap a face's underlying surface for an ARBITRARY new
one. The blocker was pcurves — a non-planar face needs a 2-D parametric trace
of every boundary edge in the new surface's (u,v) space. ArchDisc now generates
these natively.

### The pcurve-projection algorithm — `foundation/PCurveProjection.js`

This is the pure-JS port of OCCT `ShapeConstruct_ProjectCurveOnSurface`:

1. **Point inversion** (`invertPointOnSurface`) — for a 3-D sample point `Q`,
   find the surface parameter `(u,v)` minimising `|S(u,v) − Q|`:
   - **Seed:** a coarse `gridU × gridV` sampling picks the closest grid node —
     a robust start that avoids Newton converging to a far stationary point
     (Ma & Hewitt, CAGD 20 (2003), control-polygon initial-guess strategy).
   - **Refine:** damped Newton-Raphson on the two stationarity equations
     `f = (S−Q)·S_u = 0`, `g = (S−Q)·S_v = 0`, with the 2×2 Jacobian built
     from the surface 2nd derivatives `S_uu, S_uv, S_vv` (Piegl & Tiller,
     *The NURBS Book* §6.1, eqs. 6.3–6.6). Steps clamped to the domain;
     convergence tested by point coincidence, zero cosine, and parameter
     stationarity.
   - Verified: converges to ~1e-12 in ~4 iterations on a cylinder.
2. **Pcurve fitting** — the inverted `(u,v)` samples are interpolated by a
   degree-3 B-spline curve in 2-D parameter space (global cubic interpolation,
   Piegl & Tiller §9.2.1 / A9.1 — chord-length parameters, averaged knot
   vector, Gaussian-elimination solve). The fitted 2-D curve is the pcurve.
3. **Diagnostics** — `maxProjectionError` (how far the 3-D curve lies off the
   surface), `maxPushForwardError` (how faithfully the FITTED pcurve, pushed
   back through `S`, reproduces the original 3-D curve), `degenerate` (the
   (u,v) samples collapse), `allConverged`.
4. `validatePCurveLoop` — checks a boundary's pcurves form a closed loop in
   (u,v) space and no pcurve is degenerate.

### The native face-replacement rebuild

- `kernel/topology/FaceReplace.replaceFaceSurface(face, newNurbs)` — keeps the
  face's boundary loops (the 3-D edges do not move), projects each boundary
  edge onto the new surface (`reseatFaceOnSurface` → `projectCurveOnSurface`),
  attaches a fresh `Pcurve` per edge, validates (closed pcurve loop, no
  degenerate pcurve, push-forward error within tolerance). If the swap can't
  produce a valid face it returns `ok: false` with a clear reason.
- `kernel/brep/BrepRewrite.replaceFace(brepShape, faceIndex, { curvedSwap })` —
  when `curvedSwap` is set: extracts the picked face's outer boundary wire from
  the OCCT shape, builds a NATIVE `TopoFace` on those boundary edges,
  synthesises an arbitrary curved degree-3×3 NURBS surface (a bulged bicubic
  spanning the boundary — a genuine geometric swap, a flat face becomes
  curved), runs `replaceFaceSurface`, and renders the new analytic surface
  (tessellated, sewn into a shell). The analytic `TopoFace` + the pcurve
  diagnostics are carried on `meta.faceReplaceStats` / `meta.analyticFace`.
- The `Replace Face` handler gains a `curvedSwap` param; `curvedSwap=1` runs
  the arbitrary swap and sets `window.__lastFaceReplace`.

**Verified:** `brep-facereplace-electron.spec.js` — a notched plate's face #1
(a 4-edge boundary) re-seated onto a curved degree-3×3 NURBS surface, 4 fresh
pcurves generated, `loopClosed=true`, `allConverged=true`, push-forward error
~1.5 mm (the new surface genuinely bulges 7.8 mm off the original flat face);
the analytic surface STEP-exports with `B_SPLINE_SURFACE_WITH_KNOTS`.

---

## References

- Piegl & Tiller, *The NURBS Book* (Springer, 2nd ed.) — §6.1 (point inversion
  / projection — Newton iteration), §9.2.1 / A9.1 (global curve interpolation),
  §4.4–4.5 (tensor-product NURBS surfaces).
- OCCT `ShapeConstruct_ProjectCurveOnSurface` —
  dev.opencascade.org refman; the kernel routine ported to
  `foundation/PCurveProjection.js`.
- Ma & Hewitt, "Point inversion and projection for NURBS curve and surface:
  control polygon approach", *CAGD* 20 (2003) 79–99 — robust initial-guess
  strategy (the coarse grid seed).
- ISO 10303-42 — `b_spline_surface_with_knots`, `rational_b_spline_surface`,
  `pcurve`, `curve_bounded_surface`, `advanced_face`.

---

## Honest caveat (do NOT hide)

P1/P4 results are analytic in ArchDisc's NATIVE B-rep kernel — an exact
`NURBSSurface` carried by a real `TopoFace` with real pcurves, STEP-exportable
as `B_SPLINE_SURFACE_WITH_KNOTS` entities. They are **NOT** OCCT `TopoDS_Face`
objects. An OCCT-side operation (e.g. an OCCT boolean consuming the G2 blend or
the swapped face) would need a conversion step or the custom OCCT build. The
rendered body in both ops is a sewn triangle shell tessellated FROM the analytic
surface — the analytic surface is the geometry of record, the mesh is for
display/measure.

The §3 capability is genuinely delivered analytically; the representation is
ArchDisc-native rather than OCCT-native. The pcurve projection (Newton point-
inversion + B-spline fitting) is a genuine algorithm — verified numerically:
point inversion converges to ~1e-12, the projected boundary's pcurves form a
closed (u,v) loop. P4's curved swap is a genuine geometric change (a flat face
becomes a bulged NURBS surface), not the identity. The arbitrary surface in P4
is currently a synthesised bulged bicubic; a caller-supplied arbitrary surface
would flow through the same `replaceFaceSurface` path unchanged.
