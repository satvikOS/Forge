# Forge Kernel Audit — Advanced Surfacing + Class-A + Continuity

> Generated 2026-06-24 by a grounded read of the live kernel at
> `forge-kernel/`. Every claim below cites a file/function actually read,
> not recall. Target: full industrial 1:1 parity with **ACIS advanced
> surfacing** + **Alias-grade Class-A** (G0–G3, curvature comb, zebra,
> matched/blended surfaces). Discipline = Bible §0: real impl only, no
> MVP/stub, OCCT stays the live default AND A/B oracle until each native op
> is A/B-proven, CI-green per increment, dynamic not static.

---

## 0. TL;DR

The **entire visible Class-A / advanced-surfacing surface of Forge is an OCCT
wrapper.** Three of the four files named in the audit brief —
`ClassASurfacing.cpp`, `LoftGuide.cpp`, `VarFillet.cpp` — contain **zero
native geometry**: they translate handles into OCCT `TopoDS_*` and call
`BRepLProp_*`, `BRepOffsetAPI_*`, `BRepFilletAPI_*`, `BRepBuilderAPI_Sewing`.
The fourth, `native/surfit/Surfit.cpp`, is genuinely native but is a **single
untrimmed B-spline patch fitter**, not a Class-A surfacing system.

The native B-rep substrate (`native/brep/`) has a real but **shallow** NURBS
stack: point eval, 1st/2nd derivatives, single-knot Boehm insertion, analytic
quadric surfaces, analytic surface–surface intersection for low-degree pairs,
and a discrete mesh-curvature field. What it **does not have** is the load-
bearing Class-A machinery: a **trimmed-NURBS B-rep face**, **G1/G2/G3 surface
matching/blending**, an **analytic curvature-comb / zebra on real surfaces**,
**rolling-ball variable-radius fillet surfaces**, **guided loft/sweep surface
generation (Coons/Gordon/N-sections)**, and the **surface-fairing / continuity-
solve** that is the actual product Alias/ICEM sell.

**Honest native share of this AREA today: ~10–15%** (a curve/surface
evaluator + a single-patch fitter + a mesh curvature field). The ~85% that an
engineer relies on for Class-A is OCCT-only. This AREA is **downstream of the
OCCT_ZERO_ROADMAP keystone (W3.1 trimmed-NURBS) and is explicitly listed there
as W3.10 — "the deepest single item," candidate to be migrated last.**

---

## 1. What Forge has TODAY (grounded)

### 1.1 The four brief files

| File | Native? | What it actually is |
|------|---------|---------------------|
| `src/ClassASurfacing.cpp` (572 LOC) | **OCCT-only** (20 OCCT includes) | All 6 entry points run on OCCT `BRepLProp`. See below. |
| `src/LoftGuide.cpp` (122 LOC) | **OCCT-only** (9 OCCT includes) | `BRepOffsetAPI_ThruSections`; "guides" degraded to vertex point-sections. |
| `src/VarFillet.cpp` (124 LOC) | **OCCT-only** (9 OCCT includes) | `BRepFilletAPI_MakeFillet` + `Law_Linear`/`Law_S` law. |
| `src/native/surfit/Surfit.cpp` (536 LOC) | **NATIVE** (0 OCCT) | Single untrimmed B-spline patch least-squares fit. |

**`ClassASurfacing.cpp` — diagnostics, all OCCT:**
- `zebraStripes` (L135) — `BRepAdaptor_Surface` + `BRepLProp_SLProps` normal on a UV grid, projected to a stripe bucket. *Diagnostic only — no surface is modified.*
- `curvatureComb` (L219) — `BRepLProp_CLProps` signed curvature + Frenet normal along an edge.
- `continuityCheck` (L273) — `BRepLProp_SLProps` on both sides of a shared edge + `GeomAPI_ProjectPointOnSurf` to re-find (u,v); aggregates worst-case G0 (position gap), G1 (normal angle), G2 (mean-curvature deviation %), G3 (a *hand-rolled torsion proxy* `(d1·n)·tEdge`, L381-391 — **not a true G3/curvature-derivative continuity measure**). The G3 metric is an approximation, flagged as such in its own comment.
- `gaussianAndMeanCurvature` (L411) — `GeomLProp_SLProps` K/H/κmin/κmax on a grid.
- `stitchG2` (L472) — `BRepBuilderAPI_Sewing` (a **G0 topological sew**, despite the name) + per-shared-edge `continuityCheck` report. It does **not** enforce or solve for G2 — it sews and *reports* continuity.
- `sweepWithGuides` (L538) — `BRepOffsetAPI_MakePipeShell` with guide wires via `SetMode`.

**`LoftGuide.cpp`:** `BRepOffsetAPI_ThruSections` (L72). Guide edges are sampled at their **midpoint only** and added as `AddVertex` point-sections (L92-111) — the header itself admits this is "the only built-in ThruSections affordance" and points true guide interpolation at `forge::part::loftWithGuides`.

**`VarFillet.cpp`:** `BRepFilletAPI_MakeFillet` (L59); samples a `Law_Linear`/`Law_S` at 9 points into a `Pnt2d` array (L107-112) because direct `Add(law,edge)` aborts in OCCT 7.9.3. Pure OCCT.

**`Features.cpp::loftWithGuides` (L1448-1472)** — the "true" guided loft — is `GeomFill_NSections` wrapped in a `Geom_BSplineSurface`. Also OCCT.

### 1.2 Native substrate that genuinely exists (credited)

- `native/brep/Nurbs.{hpp,cpp}` — Cox-de Boor basis (`findSpan`, `basisFunctions`), rational **curve + surface point evaluation**, Bézier de-Casteljau cross-check. **Point eval only.**
- `native/brep/NurbsCalculus.{hpp,cpp}` — `basisFunctionDerivatives` (DersBasisFuns A2.3), rational **curve & surface derivatives to 2nd order**, `curveTangent`/`curveCurvature`/`surfaceNormal`, and **single-knot, +1-multiplicity Boehm insertion** (`insertKnot`). Header explicitly TARGETS-but-does-not-build: surface principal/Gaussian/mean curvature from the 2nd fundamental form, r-fold insertion, **knot removal, degree elevation, refinement**.
- `native/brep/NurbsSurface.{hpp,cpp}` — self-validating surface wrapper, analytic 1st partials + normal (FD-checked), uniform-grid tessellation to a `HalfEdgeMesh` (open patch). No higher derivatives, **no trimming**, no isocurve extraction, no SSI, no fitting (header §"TARGETED").
- `native/brep/Surface.{hpp,cpp}` — tagged-union analytic surface (Plane/Cylinder/Cone/Sphere/Torus + NURBS fallback) with exact `evaluate`/`evaluateDeriv`/`normalAt`. The `Surface.hpp` header is explicit: **"No general trimmed-NURBS faces with arbitrary inner loops; the trim is a parameter rectangle."**
- `native/brep/SurfaceIntersect.{hpp,cpp}` — analytic SSI: closed-form plane/sphere/cylinder/cone pairs + Dandelin conics + marched skew cyl-cyl / offset cyl-sphere. **Torus-anything, cone-cone, and anything involving a NURBS face are honestly DEFERRED** (header §"STILL DEFERRED").
- `native/brep/Surfit.cpp` — see §1.3.
- `native/brep/Fillet.{hpp,cpp}` — **mesh** rolling-ball fillet on a half-edge triangle solid: convex sharp edges only; concave edges SKIPPED; per-edge radius selection. Explicitly **NOT** an analytic B-rep fillet (header L28-30: "we do NOT trim and re-parameterise NURBS faces against a rolling-ball blend surface").
- `native/mesh/Curvature.{hpp,cpp}` — discrete cotangent-Laplacian **mean H**, angle-defect **Gaussian K**, derived principal **k1/k2** per vertex (Gauss-Bonnet validated). A **mesh** field, not a surface analytic comb.
- `native/brep/Topology.hpp` — half-edge B-rep (Vertex/Edge/Coedge/Loop/Face/Shell/Solid) with Euler operators. **`Face` has one `outerLoop` only — "no inner hole loops yet" (L136)** — and trim is a parameter rectangle `(u0,u1)x(v0,v1)` or a single param-triangle (L150-162). **No inner trim loops, no p-curves.**

### 1.3 `Surfit.cpp` — the one native surfacing op, scoped honestly

`fitNurbsSurface` (L307): PCA base-plane parameterization (cyclic-Jacobi 3×3 eigensolve) → rotating-calipers in-plane frame to kill diamond overhang → clamped-knot least-squares (`solveSPD` Cholesky + GE fallback) → closest-point (footpoint, grid-seed + clamped Gauss-Newton) reparameterization iteration → best-Chamfer surface. `chamferDistance` (L256) reports honest bidirectional residual. Its own `R.reason` (L528) states the ceiling: **"single NURBS patch over a base-plane parameterization (trimming / multi-patch are follow-ups)."** This is a *reverse-engineering scan-fit*, **not** a Class-A construction tool.

---

## 2. The gap vs the target (ACIS surfacing + Alias Class-A)

Concrete missing features/operators/data-structures. Grouped by subsystem.

### 2.A Data structures (foundational — blocks everything below)
1. **No trimmed-NURBS B-rep face.** `Face` carries one outer loop and a *rectangular/triangular* parameter trim only; **no inner trim loops, no boundary p-curves** (`Topology.hpp` L136-162). ACIS/Alias faces are NURBS surfaces with arbitrary nested 2D trim loops in parameter space. This is the single missing structure that makes everything else "lite."
2. **No NURBS surface as a first-class face geometry on native solids.** `SurfaceKind::Nurbs` exists as a *fallback* on the analytic union but there is no trimmed, oriented, sewn NURBS shell.
3. **No curve-on-surface / p-curve type.** Needed for trim loops, fillet spine projection, matched-edge continuity.
4. **No surface "history"/feature lineage** for surfacing ops (the native Booleans already lack Modified/Generated/IsDeleted per OCCT_ZERO_ROADMAP W1.3; surfacing inherits this gap).

### 2.B Class-A continuity & analysis (the Alias core)
5. **No native G1/G2/G3 continuity *evaluator* on surfaces.** All of `continuityCheck` is OCCT `BRepLProp`. Native has surface 1st partials (NurbsSurface) and curve curvature, but no surface 2nd fundamental form / principal-curvature evaluator (NurbsCalculus.hpp lists it as TARGETED-not-built).
6. **No native zebra-stripe analysis on real surfaces** (`zebraStripes` is OCCT `BRepLProp_SLProps`).
7. **No native surface curvature comb / porcupine on surfaces** (only `BRepLProp_CLProps` on edges, OCCT).
8. **No true G3 (curvature-derivative / G3 torsion) continuity** even in the OCCT path — the existing G3 is a hand-rolled `(d1·n)·tEdge` proxy (`ClassASurfacing.cpp` L381-391).
9. **No highlight-line / reflection-line analysis** (Alias' second core diagnostic alongside zebra). Absent entirely, OCCT and native.
10. **No isophote / draft-angle-shaded surface diagnostic** tied to surfaces.

### 2.C Class-A construction & matching (what Alias is FOR)
11. **No surface *matching* operator** — match a free-edge of surface A to surface B at G0/G1/G2/G3 by re-solving A's boundary control rows. This is *the* Class-A verb; entirely missing (OCCT and native). `stitchG2` only *sews + reports*; it does not solve.
12. **No surface *fairing*/continuity *solver*** (minimize curvature variation / strain energy subject to G2 boundary constraints). Surfit fits points; it cannot fair or constrain continuity.
13. **No blend/fillet *surface* with continuity control** — variable-radius rolling-ball **surface** with G2/curvature-continuous setback, conic/Chordal blends, and trim-back. VarFillet is OCCT `BRepFilletAPI`; native `Fillet.cpp` is a convex-only *mesh* fillet that skips concave edges (no setback, no G2, no analytic blend surface).
14. **No Coons / Gordon / bi-cubically-blended boundary patch** (4-sided surface from 4 boundary curves with tangent ribbons). Required for filling and matching. Absent.
15. **No N-sided / multi-sided patch fill** (the "fill hole with G1/G2 to all neighbours" verb). Absent.
16. **No guided/multi-section loft *surface* with tangent & curvature control natively** — `loftWithGuides` is OCCT `GeomFill_NSections`; `LoftGuide.cpp` degrades guides to single midpoints.
17. **No swept surface natively with guide-rail / two-rail / pipe-shell continuity** — `sweepWithGuides` is OCCT `BRepOffsetAPI_MakePipeShell`.
18. **No surface offset / variable-offset with self-intersection trimming** (native offset is mesh-level only — OCCT_ZERO_ROADMAP W3.2/W3.7). Class-A needs analytic surface offset for thickness/blend.
19. **No surface extension / extrapolation** (extend a patch tangentially/curvature-continuously by N units — a daily Alias verb). Absent.
20. **No knot-line / control-net rebuild / rebuild-to-degree** (rebuild a dirty surface to bi-cubic single-span / target spans with deviation control). Native lacks knot removal, degree elevation, refinement (NurbsCalculus.hpp TARGETED).
21. **No align/rebuild/symmetry/planarize-row** Class-A control-net editing verbs.

### 2.D NURBS algebra prerequisites (block 2.C)
22. **No degree elevation.** 23. **No knot removal.** 24. **No knot refinement (r-fold / global).** 25. **No surface–surface intersection involving NURBS faces** (SSI defers all NURBS pairs). 26. **No global NURBS interpolation** (interpolate a curve/surface *through* points/curves — distinct from Surfit's approximation). 27. **No curve projection / pull-back onto a surface** to build p-curves (only `GeomAPI_ProjectPointOnSurf`, OCCT). 28. **No isocurve / section-curve extraction** from a native surface.

### 2.E Robustness/interop the target assumes
29. **No trimmed-NURBS STEP read** (OCCT_ZERO_ROADMAP W3.1 keystone) — so Forge cannot even *load* a real Class-A part natively to operate on it. 30. **No sewing/healing into a manifold NURBS shell** natively (W3.4). 31. **No tolerant-edge model** (Class-A surfaces meet at tolerant edges; native has exact-double edges only).

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Each step keeps OCCT as the live default + A/B oracle until the native op is
proven, flips behind a per-op flag, ships CI-green, and is validated
**dynamically** (varied inputs, not a fixed fixture). LOC is rough native C++.

> **Ordering principle:** this entire AREA sits *behind* the OCCT_ZERO_ROADMAP
> keystone. Phases C0–C2 are the NURBS-algebra + trimmed-face prerequisites
> that make any Class-A claim real; doing the Class-A verbs before them only
> reproduces the current "lite" state in native code.

### Phase C0 — NURBS algebra completion (unblocks all matching/rebuild)
- **C0.1 Surface 2nd fundamental form + principal/Gaussian/mean curvature** (native, `NurbsCalculus`). Already have S_uu/S_uv/S_vv assembly; add (E,F,G)/(L,M,N) → κ1,κ2,K,H. **Verify:** A/B vs OCCT `GeomLProp_SLProps` on random rational patches (K,H,κ within 1e-6) + analytic sphere/cylinder/torus known answers. ~300 LOC.
- **C0.2 Degree elevation + knot insertion (r-fold) + knot removal + refinement** (native, `NurbsCalculus`). **Verify:** geometry-invariance A/B — elevated/refined surface must evaluate identically (≤1e-9) to original at a dense (u,v) grid; cross-check control-count deltas vs `Geom_BSplineSurface::IncreaseDegree`/`InsertUKnot`. ~600 LOC.
- **C0.3 Isocurve extraction + curve/point projection onto surface (footpoint)** (native). Surfit already has a footpoint Gauss-Newton; promote + generalize to curve pull-back (p-curve sampling). **Verify:** A/B vs `GeomAPI_ProjectPointOnSurf` / `Geom_Surface::UIso` (point coincidence ≤1e-7) on varied surfaces. ~350 LOC.

### Phase C1 — Trimmed-NURBS B-rep face (THE structural unlock)
- **C1.1 Trimmed face data structure**: `Face` gains inner loops + per-coedge p-curves; surface geometry = `NurbsSurface`; UV trim region = nested 2D loops, not a rectangle. **Verify:** point-in-trim classification A/B vs OCCT `BRepClass_FaceClassifier` on random trims; tessellation respects trim (no triangles outside the loop) checked against an OCCT `BRepMesh` reference silhouette. ~700 LOC (structure) + tessellator update.
- **C1.2 NURBS-aware SSI + edge imprint** (extend `SurfaceIntersect` to NURBS×analytic and NURBS×NURBS via robust subdivision/Newton marching). **Verify:** marched curve residual ≤1e-9 on both surfaces; A/B vs OCCT `GeomAPI_IntSS` curve count + sampled-point Hausdorff. ~900 LOC.
- **C1.3 Sew + heal trimmed NURBS faces into a manifold shell** (depends on OCCT_ZERO_ROADMAP W3.4). **Verify:** Euler/genus signature + closed-2-manifold validate vs OCCT `BRepBuilderAPI_Sewing` topology hash. ~500 LOC.

> **Gate note:** C1 is co-dependent with OCCT_ZERO_ROADMAP **W3.1 (trimmed-
> NURBS STEP read)** and **W3.4 (healing/sewing)**. Build the trimmed-NURBS
> surface read+eval ONCE and share it; do not fork.

### Phase C2 — Native Class-A diagnostics (A/B against OCCT today)
- **C2.1 Native surface continuity evaluator G0/G1/G2/G3** (real curvature-derivative G3, not the `(d1·n)·tEdge` proxy). Reimplements `continuityCheck` on native surfaces using C0.1. **Verify:** A/B vs the *existing* OCCT `continuityCheck` on matched/mismatched patch pairs (G0 mm, G1 deg, G2/G3 % within tight tol); plus known-answer (two halves of one sphere → G2=0). ~400 LOC.
- **C2.2 Native zebra + reflection-line + highlight-line on surfaces** (project normal/reflected-eye-ray into stripe/line buckets on a UV grid). **Verify:** A/B vs OCCT `zebraStripes` bucket field (≥99% bucket agreement on a dense grid) + visual regression render. ~350 LOC.
- **C2.3 Native surface curvature comb / porcupine** (κ along isocurves + across). **Verify:** A/B vs OCCT `BRepLProp_CLProps` comb tips on extracted isocurves (≤1e-6). ~250 LOC.

### Phase C3 — Class-A construction & matching (the product)
- **C3.1 Coons / Gordon bicubic boundary patch** from 4 boundary curves + tangent ribbons. **Verify:** boundary interpolation exact (≤1e-9 at boundary samples); A/B vs OCCT `GeomFill_BSplineCurves`/`GeomFill_Coons` interior Hausdorff. ~500 LOC.
- **C3.2 Surface MATCH operator** — re-solve A's boundary control rows to hit G0/G1/G2/G3 against B (constrained least-squares on control net, leaning on C0.1/C0.2). **Verify:** post-match `continuityCheck` (C2.1) reports target continuity within tol AND deviation from original ≤ user limit; A/B parity of the *continuity metric* vs OCCT measuring the same matched edge. ~700 LOC. **This is the keystone Class-A verb.**
- **C3.3 Surface FAIR / continuity solve** — minimize curvature-variation energy s.t. fixed boundary + continuity constraints. **Verify:** energy strictly decreases, boundary continuity preserved, max deviation bounded; dynamic over varied patches. ~600 LOC.
- **C3.4 Guided multi-section loft + 2-rail/pipe sweep surfaces** (native), with tangent/curvature section conditions. Replaces `loftWithGuides`/`sweepWithGuides`/`LoftGuide`. **Verify:** A/B vs OCCT `GeomFill_NSections` / `BRepOffsetAPI_MakePipeShell` sampled-surface Hausdorff + section interpolation exactness. ~900 LOC.
- **C3.5 Analytic variable-radius rolling-ball FILLET surface** with G2 setback + trim-back (the real VarFillet). Hardest item; needs C1.2 (spine = SSI of offset surfaces) + C1.3 (trim/heal). **Verify:** A/B vs OCCT `BRepFilletAPI_MakeFillet` (volume + COM + topology signature + fillet-surface Hausdorff) across a varied edge/dihedral/radius-law sweep. ~1500 LOC.
- **C3.6 Surface offset / extend / rebuild** verbs. **Verify:** offset A/B vs OCCT `BRepOffset_MakeOffset` (mass + Hausdorff); extend continuity-checked; rebuild deviation-bounded. ~700 LOC.

### Phase C4 — Flip + freeze
Per OCCT_ZERO_ROADMAP §1/§6: only after every op above passes A/B + the
CADGenBench/golden corpus, flip native-default; keep OCCT compiled as oracle;
**freeze an OCCT-built golden-output corpus of surfacing results BEFORE any
deletion** (the oracle-removal paradox applies hardest here, since most
surfacing ops are not closed-form A/B-checkable post-deletion).

**Total rough native LOC for full parity in this AREA: ~11,000–12,500.**

---

## 4. The single biggest blocker + critical path

**Biggest blocker: there is no trimmed-NURBS B-rep face (§2.A item 1).** Every
real Class-A verb — match, fair, blend-fillet, fill, trimmed loft/sweep —
operates on *trimmed NURBS faces sewn into a shell*. Forge's native `Face`
supports a single outer loop and a rectangular/triangular parameter trim only
(`Topology.hpp` L136-162), and `Surface.hpp` states plainly there are "no
general trimmed-NURBS faces with arbitrary inner loops." Until that structure
exists (Phase C1), any native Class-A op can only reproduce the current
OCCT-wrapper "lite" behavior in C++. This is the same keystone the
**OCCT_ZERO_ROADMAP calls W3.1 (trimmed-NURBS read/eval) and W3.10
(ClassA/LoftGuide/VarFillet — "the deepest single item")**; the two must share
one trimmed-NURBS surface implementation, not fork it.

**Critical path:**
```
C0.2 (degree-elevate/knot-remove/refine)  ─┐
C0.1 (surface 2nd-form curvature)          ─┼─► C1.1 (trimmed NURBS face) ─► C1.2 (NURBS SSI/imprint) ─► C1.3 (sew/heal)
C0.3 (iso/projection → p-curves)           ─┘                                                              │
                                                                                                           ▼
                          C2.1 native G0–G3 evaluator ◄── (gates) ── C3.2 surface MATCH (keystone verb) ──► C3.5 rolling-ball fillet surface (last/hardest)
```
The chain `C0.* → C1.1 → C3.2` is the minimum to make "Forge has native
Class-A" a *true* statement. `C3.5` (analytic variable-radius fillet surface)
is correctly flagged in OCCT_ZERO_ROADMAP as STEP-grade hard and the candidate
to keep OCCT-only longest — schedule it last and behind a documented A/B gate.

### Risks specific to this AREA
- **Coincidental mass/curvature parity** is a weak oracle for surfacing —
  add **topology signature + boundary-continuity metric + sampled-surface
  Hausdorff** to every A/B gate, never just K/H or volume.
- **Most surfacing ops are not closed-form** → A/B vs OCCT is the *only*
  truth source; the golden-corpus freeze (Phase C4) is mandatory before any
  OCCT deletion, more so than for the analytic primitives.
- **Surfit's PCA parameterization** is a scan-fit, not a construction
  parameterization — do not let it leak into the Class-A verbs as a
  "fitter stands in for matcher" shortcut (Bible §0: no small-function
  stand-ins).
