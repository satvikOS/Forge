# Sub-project G — Next-Horizon Capabilities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the six "next-horizon" capabilities documented at the end of Sub-project F: auto-trimming NURBS B-rep faces, class-A modelling workflow, true G2 (curvature-continuous) surface blends, NURBS surface-surface intersection (SSI), surface-pull-back in retopology, and Catmull-Clark subdivision for quad meshes. Recon-first to lock OCCT-binding scope; pure-JS items implemented from scratch using well-known algorithms.

**Architecture:** Two paths converge —
1. **OCCT-binding-dependent items** (NURBS SSI via `GeomAPI_IntSS`, surface-pull-back via `GeomAPI_ProjectPointOnSurf`, auto-trimming NURBS B-rep via `BRepBuilderAPI_MakeFace(surface, wire)` / `Geom_RectangularTrimmedSurface`) — recon-verified, ship as kernel ops behind `ArchDiscKernel.brep.*` + ribbon tools.
2. **Pure-JS items** (Catmull-Clark in `foundation/CatmullClarkSubdivision.js`; G2 blend NURBS fitting in `foundation/G2BlendSurface.js`; class-A workflow as a curvature-comb + zebra-stripe analysis + G2-blend integration tool) — implemented from scratch following standard algorithms; no OCCT-binding dependency.

Every reachable item: facade-exposed, ribbon-integrated, e2e-verified via real ribbon clicks + real param dialogs + a real-world artifact recipe + all-camera-angle/zoom capture. All directives in `MEMORY.md` feedback files (`feedback_sophisticated_integrations`, `feedback_complex_e2e_models`, `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_fully_sophisticated`, `feedback_no_floating_panels`) hold throughout.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference:** spec `docs/superpowers/specs/2026-05-18-occt-kernel-integration-foundation-design.md` §3.1 (G2 blending), §3.3 (advanced surfacing), §3.5 (convergent modelling, healing); the kernel program memory `project_occt_kernel`; existing foundation NURBS fragments (memory: `NURBSSurface`, `BlendSurface`, `SurfaceCurvature` already exist in `frontend/src/foundation/` — read them before building G2 blends).

---

## Important context for the implementer

- **A0–F shipped.** Kernel modules under `frontend/src/kernel/brep/`. All ribbon handlers selection + dialog driven. e2e suite 63/63 green at the start of G.
- **Op pattern (kernel) unchanged.** Pure-JS modules in `foundation/` mirror `LoopSubdivision.js` / `IsotropicRemesh.js` shape.
- **Ribbon-handler pattern:** `_pickBodies(arity) → requestToolParams → ArchDiscKernel.brep.<op>(...) → addBrepShapeToScene → return {status, message}`.
- **e2e pattern:** drive via real ribbon clicks + dialogs (`e2e/helpers/uiWorkflow.js`) + all-angle capture (`e2e/helpers/orbitCapture.js`) + a real-world artifact recipe.
- **Honest-gap principle:** if a binding is unreachable, ship the rest and document the gap clearly; do not fake.
- Work on branch `archdisc`. Commit per task.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/foundation/CatmullClarkSubdivision.js` | Create — pure-JS Catmull-Clark for quad meshes (+ tri→quad converter) |
| `frontend/src/foundation/G2BlendSurface.js` | Create — pure-JS G2 surface fit from boundary tangent + curvature data |
| `frontend/src/foundation/SurfacePullback.js` | Create — vertex projection helper used by retopo (if pure-JS approximation chosen) |
| `frontend/src/kernel/brep/BrepNurbsSSI.js` | Create — NURBS surface-surface intersection (recon-gated) |
| `frontend/src/kernel/brep/BrepNurbsTrim.js` | Create — auto-trimming NURBS face construction (recon-gated) |
| `frontend/src/kernel/brep/BrepRetopo.js` | Modify — wire optional surface pull-back into the existing retopo pipeline |
| `frontend/src/kernel/brep/BrepSubdivide.js` | Modify (or sibling `BrepCatmullClark.js`) — Catmull-Clark facade entry |
| `frontend/src/kernel/brep/BrepBlendG2.js` | Create — kernel facade for the pure-JS G2 blend (separate from A5's planar-fill `blendG2`) |
| `frontend/src/kernel/brep/ArchDiscKernel.js`, `index.js` | Modify — facade + barrel for G ops |
| `frontend/src/foundation/ToolParamSchemas.js` | Modify — schemas for G ribbon tools |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — ribbon handlers |
| `frontend/src/components/RibbonToolbar.jsx`, `WorkbenchMechanical.jsx` | Modify — ribbon entries |
| `docs/superpowers/notes/occt-api-G.md` | Create (Task 1) — recon verdict per OCCT-dependent G item |
| `docs/superpowers/notes/catmull-clark-G.md`, `g2-blend-G.md` | Create — pure-JS algorithm notes |
| `e2e/brep-g-recon-electron.spec.js` | Create (Task 1) — recon |
| `e2e/brep-g-{ssi,trim,pullback,catmull,g2blend,classa}-electron.spec.js` | Create — per-op e2e gates |

---

## Task 1: Recon — OCCT-binding-dependent items

Empirical reachability verdict for the three OCCT-dependent capabilities. Pure-JS items don't need recon.

Items:

1. **NURBS SSI — `GeomAPI_IntSS`**. Build two NURBS surfaces (use the verified `Geom_BSplineSurface_1` from E recon, or build via `oc.Geom_BSplineSurface_1(...)` directly). Or simpler: extract two surfaces from two intersecting OCCT primitives — a `MakeCylinder` and a `MakeBox` produce a cylinder side surface and a box face that intersect. Use `BRep_Tool.Surface_2(face)` (E verified) to extract surfaces. Construct `new oc.GeomAPI_IntSS_*(s1, s2, tolerance)` (probe suffixes). Read intersection curves via `.NbLines()` + `.Line(i)`. Confirm at least one intersection curve is produced. Record the verified call sequence.

2. **Closest-point projection — `GeomAPI_ProjectPointOnSurf`**. Given a `Handle_Geom_Surface` (from `BRep_Tool.Surface_2`) and a `gp_Pnt` near but not on the surface, construct `new oc.GeomAPI_ProjectPointOnSurf_*(pnt, surface)` (probe suffixes). Read the nearest point via `.NearestPoint()`, parameters via `.Parameters()`. Used by retopo surface pull-back. Test with a `BRepPrimAPI_MakeCylinder_1(20,40).Shape()` cylinder face + a query point at `(25, 0, 20)` (5mm outside the radius=20 cylinder); the nearest point should be `(20, 0, 20)` (cylinder surface). Record.

3. **Auto-trimming NURBS face — `BRepBuilderAPI_MakeFace(surface, wire)`**. The standard A2/E pipeline used `BRepBuilderAPI_MakeFace_15(wire, true)` for a planar face from a wire. The deeper sig is `MakeFace_*(surface, wire, restrictionFlag)` — pass a NURBS surface AND a wire in the surface's parametric (u,v) domain to produce a TRIMMED face. Investigate the right suffix and parameter ordering. Test: build a rectangular `Geom_BSplineSurface_1` (40×40 patch), build a square wire in (u,v) parametric coords trimming to (0.2..0.8, 0.2..0.8), construct the face. Verify face area ≈ 0.36 × 1600 = 576 mm². If the parametric-wire path is too thorny in this binding, also try the simpler `Geom_RectangularTrimmedSurface_*` (rectangular trim in u-v ranges) — this is the easier auto-trim primitive. Record.

For each: verdict + verified COMPLETE copy-pasteable sequence (REACHABLE) or honest explanation (NOT_REACHABLE).

- [ ] **Step 1: Write recon spec `e2e/brep-g-recon-electron.spec.js`**

Pattern: `e2e/brep-e-recon-electron.spec.js`, `e2e/brep-f-recon-electron.spec.js`. `test.setTimeout(600000)`. `.delete()` every OCCT object. Spec PASSES when verdicts are recorded.

- [ ] **Step 2: Build + run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-g-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write `docs/superpowers/notes/occt-api-G.md`**

Per-item verdict + verified call sequences (REACHABLE) or honest explanation (NOT_REACHABLE). Add a "Sub-project G OCCT-dependent deliverable scope" section listing which ops Tasks 2/4/5 will build.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-g-recon-electron.spec.js docs/superpowers/notes/occt-api-G.md docs/superpowers/notes/occt-api-G-recon.json
git commit -m "test(kernel): G recon — NURBS SSI / surface projection / trimmed face reachability"
```

---

## Task 2: Catmull-Clark subdivision for quad meshes (pure JS)

`frontend/src/foundation/CatmullClarkSubdivision.js`. Classical Catmull-Clark scheme:
- **Face point** F_i = average of the face's corner vertices.
- **Edge point** E_ij = average of the edge's 2 endpoint vertices + the 2 adjacent face points (4-element avg). For boundary edges: midpoint of the 2 endpoints.
- **Vertex point** V' = (F + 2R + (n-3)V) / n where F = avg of adjacent face points, R = avg of adjacent edge midpoints, n = vertex valence. For boundary vertices: simple boundary refinement.
- **Topology**: each original quad face → 4 sub-quads connecting (orig vertex → adjacent edge points → face point → other edge point).

Inputs accepted: `{vertices, quads}` (preferred) OR `{vertices, triangles}` (convert tris→quads first via dual-mesh approach or by pairing triangles sharing the longest edge — document the approach; the simpler path is `trianglesToQuads(mesh, threshold)` builds a quad mesh by merging coplanar triangle pairs within angle threshold).

Add `weldMesh` integration (re-use from `LoopSubdivision.js`).

Add per-edge sharpness support analogous to Hoppe piecewise-smooth Loop (creases for sharp features, prevents pinching).

Export `catmullClarkSubdivide(mesh, levels=1, sharpness=new Map())`, `catmullClarkStep(mesh, sharpness)`, `trianglesToQuads(triMesh, dihedralThresholdDeg=5)`.

- [ ] **Step 1: Build the algorithm**

`vite build` after each helper. Test entry: confirm a 6-quad cube mesh → 1 CC step → 24-quad mesh; volume preserved (sphere-like convergence).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/foundation/CatmullClarkSubdivision.js docs/superpowers/notes/catmull-clark-G.md
git commit -m "feat(subdivision): Catmull-Clark subdivision for quad meshes + tri→quad converter"
```

---

## Task 3: NURBS SSI op (kernel facade — recon-gated)

If Task 1 marked `GeomAPI_IntSS` REACHABLE: implement `nurbsSSI(brepShape, faceIndexA, brepShapeB, faceIndexB)` — extract two surfaces from two BrepShapes (via `BRep_Tool.Surface_2(face)`), run IntSS, return the intersection curves as a `{curves: [{points: [[x,y,z],...], degree, ...}]}` descriptor. Facade method + ribbon tool **"NURBS SSI"** (arity 2 — select two bodies). Param dialog: faceIndexA, faceIndexB.

If NOT_REACHABLE: skip honestly.

- [ ] **Build + facade + schema + handler + e2e + commit.**

---

## Task 4: Surface pull-back in retopology (extend Sub-project D)

Modify `frontend/src/foundation/IsotropicRemesh.js` to accept an optional `surfaceOracle({x,y,z}) → {x,y,z}` callback that, given a vertex position, returns the nearest point on the original B-rep surface. After each tangential relax step, project every non-boundary vertex through the oracle.

Modify `frontend/src/kernel/brep/BrepRetopo.js` to build the `surfaceOracle` from the input `brepShape`: extract every face via `TopExp_Explorer_2` over `TopAbs_FACE`, get each face's surface via `BRep_Tool.Surface_2`, and for each query point use `GeomAPI_ProjectPointOnSurf` (recon-verified) to project onto each face; pick the closest. Returns the closest-point.

Add a `pullBack: boolean` opt to `retopoShape` (default true if Task 1 marked projection REACHABLE; false otherwise). Add to the `Retopo Surface` schema.

Update the existing `Retopo Surface` ribbon handler to pass `pullBack`.

- [ ] **Build + e2e (extend retopo gate to include pull-back active vs inactive comparison) + commit.**

---

## Task 5: Auto-trimming NURBS B-rep face (kernel — recon-gated)

If Task 1 marked face-with-trim-wire REACHABLE: implement `trimmedNurbsFace(opts)` — build a NURBS surface (reuse E's `buildNurbsPatch`-style), build a parametric trim wire (e.g. a square wire in u,v), produce a trimmed face via `BRepBuilderAPI_MakeFace_*(surface, wire, ...)`. Facade entry + ribbon tool **"Trimmed NURBS Patch"** (arity 0). Dialog: patch size, trim min, trim max.

Honest note: if the parametric trim wire path is unreachable, ship the simpler `Geom_RectangularTrimmedSurface` path (u-v range trim) as a fallback and document.

- [ ] **Build + facade + schema + handler + e2e (artifact: "windowed sail panel") + commit.**

---

## Task 6: True G2 surface blend (pure JS, no OCCT dependency)

`frontend/src/foundation/G2BlendSurface.js`. Algorithm: given two boundary curves with sampled position, tangent, and curvature data along each, fit a bicubic NURBS surface that interpolates positions at both boundaries AND matches tangent + curvature continuity (G2). Standard technique: a degree-5 NURBS surface in v (so each isoparametric u-curve has 6 control points: 3 fixed by position + tangent + curvature at v=0, 3 at v=1, fully determined by the boundary data); degree 3 in u with control-points-from-boundary-fitting.

Read existing fragments `frontend/src/foundation/NURBSSurface.js`, `BlendSurface.js`, `SurfaceCurvature.js` first — they likely have building blocks (NURBS evaluation, control-point storage). Extend or reuse.

Export `g2Blend(boundary0, boundary1, opts)` where each boundary is `{points: [[x,y,z],...], tangents: [[tx,ty,tz],...], curvatures: [[kx,ky,kz],...]}` (or compute tangent+curvature from positions via finite-difference if opts.computeFromPositions=true).

Tessellate the resulting NURBS surface to a triangle mesh for rendering (re-use the existing OCCT tessellation path is wrong here — this is pure JS; sample the surface at a u-v grid and emit triangles).

Kernel facade `frontend/src/kernel/brep/BrepBlendG2.js` — `g2BlendBetweenEdges(brepShape, edgeIdxA, edgeIdxB, opts)`: extract two edges from a B-rep (via `TopExp_Explorer_2` + `oc.TopoDS.Edge_1`), sample positions + tangents along each, compute curvatures, call `g2Blend` from the pure-JS module. Return a `BrepShape` wrapping the tessellated result (use the existing `addBrepShapeToScene` rendering path; mesh-only, not a true B-rep face — documented limitation).

Ribbon tool **"G2 Blend (curvature-continuous)"** (arity 1 — operate on a body, pick two edges via dialog).

- [ ] **Build + facade + schema + handler + e2e (artifact: "smooth fairing between two faces of a notched plate") + commit.**

---

## Task 7: Class-A modelling workflow

Combine Sub-project E's `nurbsCurvature` + zebra-stripe analysis + the new G2 blend (Task 6) into a workflow:
- New ribbon tool **"Class-A Analyze"** (arity 1, single body): tessellate the body, sample principal curvatures at a u-v grid via the surface's curvature evaluator (E's `nurbsCurvature` or a generic sampler), colour the rendered mesh by Gaussian curvature (red = positive, blue = negative, white = zero — used in production class-A modelling), set `window.__lastClassAAnalysis = { gaussianRange, meanRange, samples }` for e2e readback.
- New ribbon tool **"Zebra Stripes"** (arity 1, single body): render zebra stripes overlay via a striped environment map — light-direction-dependent stripes reveal G1/G2 continuity flaws. Pure-JS: a fragment shader or post-process that maps the surface normal to a striped pattern via a high-contrast cosine function. Build a separate Three.js material that does this.

These are visualization tools more than geometry tools, but they're the CORE of a class-A workflow. Together with G2 blends + curvature evaluation, they cover the §3.1 class-A intent.

- [ ] **Build + 2 facade entries + 2 ribbon tools + 2 e2e tests + commit.**

---

## Task 8: Wiring + full-suite gate + honest outcome

Make sure barrel/facade/ribbon entries are coherent for every G op shipped. Run the FULL brep+UX suite:

```
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-b-recon-electron.spec.js e2e/brep-e-recon-electron.spec.js e2e/brep-f-recon-electron.spec.js e2e/brep-g-recon-electron.spec.js e2e/subdivide-recon-electron.spec.js e2e/retopo-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/brep-b-advanced-electron.spec.js e2e/subdivide-surface-electron.spec.js e2e/retopo-surface-electron.spec.js e2e/brep-nurbs-electron.spec.js e2e/brep-final-electron.spec.js e2e/brep-g-*-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js e2e/catmull-clark-electron.spec.js --project=chromium
```

All must pass. Append "Sub-project G — honest outcome" sections to each of the relevant notes (catmull-clark-G.md, g2-blend-G.md, occt-api-G.md) detailing measured values, dropped ops, and honest limitations.

---

## Self-review notes

- Each item recon-first where applicable (3 OCCT-dependent items); pure-JS items have their own algorithm doc notes for traceability.
- Hardcoded inputs forbidden anywhere — every handler/test drives via real ribbon clicks + dialogs + real-world artifact.
- Honest gaps openly documented per item — no silent fakery.
- After G: remaining open frontier (genuinely needs a different OCCT WASM build or a different geometry kernel) is auto-trimming complex B-rep with G2 fillets producing a true class-A B-rep solid; explicit roadmap item beyond this.
