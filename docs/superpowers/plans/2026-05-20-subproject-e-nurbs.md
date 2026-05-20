# Sub-project E — Fully Advanced NURBS Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sophisticated NURBS operation set to the ArchDisc kernel — build NURBS surfaces (Bézier + B-spline), refine via knot insertion, elevate degree, evaluate principal curvatures, and convert primitive faces to/from NURBS — exposed via real ribbon tools, verified by real-world artifact e2e tests.

**Architecture:** the kernel exposes a rich NURBS subsystem (`Geom_BSplineSurface`, `Geom_BezierSurface`, `BRepBuilderAPI_MakeFace` from a surface, `GeomLProp_SLProps` for curvature, etc.). This sub-project recon-verifies which bindings are reachable in the prebuilt `opencascade.js@2.0.0-beta.b5ff984`, then builds a sophisticated op set behind the `ArchDiscKernel` facade, wired into the workbench ribbon (Surface tab). All ops e2e-driven by real ribbon clicks + dialogs on real-world artifacts. Per all user directives: no hardcoded inputs, real artifact recipes, all-angles capture, sophisticated integrations.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference:** spec `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` §3.3 (Advanced Surfacing — N-Sided Patching, Lofting with Tangency, Sweeping along tortuous paths); kernel memory `project_occt_kernel` notes existing NURBS fragments in `foundation/` (`NURBSSurface`, `BlendSurface`, `SurfaceCurvature`); the canonical NURBS textbook references (Piegl & Tiller, "The NURBS Book"); ArchDisc memory files for directives (`feedback_sophisticated_integrations`, `feedback_complex_e2e_models`, `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_fully_sophisticated`, `feedback_no_floating_panels`).

---

## Important context for the implementer

- **Read first:** the spec, the D plan + result, and the verified-API notes `kernel-api-A0.md` through `kernel-api-B.md`.
- **the kernel NURBS classes likely reachable** (the recon confirms): `Geom_BSplineSurface` / `Geom_BSplineCurve` / `Geom_BezierSurface` / `Geom_BezierCurve` (construction); `GeomConvert` (convert any Geom_Surface to BSpline form); `BRepBuilderAPI_MakeFace_*(surface, ...)` (B-rep face from a NURBS surface); `BRep_Tool.Surface(face)` (extract the underlying Geom_Surface); `GeomLProp_SLProps` (point evaluation + principal curvatures, Gaussian, mean); `Geom_BSplineSurface.InsertUKnot`/`InsertVKnot` (refinement); `Geom_BSplineSurface.IncreaseDegree` (degree elevation).
- **Op pattern (unchanged):** every kernel op is `const oc = await getOCCT(); return withScope(() => { ...track() every transient the kernel object...; if (shape.IsNull()) throw ...; return new BrepShape(shape, meta); });`. NURBS surfaces themselves (`Geom_*`) wrap into a `BrepShape` only when they become a `TopoDS_Face` via `BRepBuilderAPI_MakeFace`. Pure-surface queries (curvature evaluation) return numeric data, not a BrepShape.
- **All directives in force.** No hardcoded inputs in handlers or e2e specs. Each test uses a real-world artifact recipe. Capture all camera angles + zooms.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepNurbs.js` | Create — `buildNurbsPatch`, `refineNurbs`, `elevateNurbsDegree`, `nurbsCurvature`, `faceToNurbs` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose the E ops on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports |
| `frontend/src/foundation/ToolParamSchemas.js` | Modify — schemas for `NURBS Patch`, `Refine NURBS`, `Elevate NURBS`, `NURBS Curvature` |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire E ribbon tools |
| `frontend/src/components/RibbonToolbar.jsx` + `WorkbenchMechanical.jsx` | Modify — add E ribbon entries (Surface tab) |
| `docs/superpowers/notes/kernel-api-E.md` | Create (Task 1) — verified API + REACHABLE/NOT_REACHABLE verdict per op |
| `e2e/brep-e-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-nurbs-electron.spec.js` | Create (Task 4) — Sub-project E e2e gate |

---

## Task 1: NURBS reconnaissance & reachability verdict

Empirically verify which the kernel NURBS bindings work in this `opencascade.js` build. Mirrors the prior recons.

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-e-recon-electron.spec.js`. Inside `win.evaluate(...)` investigate:

1. **`Geom_BSplineSurface` construction.** Build a NURBS surface from a 4×4 control-point grid (degree 3 in both u and v, with appropriate clamped knot vectors `[0,0,0,0,1,1,1,1]`). Determine: the constructor (try `new oc.Geom_BSplineSurface_1(...)` with arity probes — Embind throws BindingError on wrong-arity; introspect overloads). the kernel's typical signature is `Geom_BSplineSurface(Poles, UKnots, VKnots, UMults, VMults, UDegree, VDegree, [UPeriodic], [VPeriodic])`. Build the poles as `TColgp_Array2OfPnt` and the knots/mults as `TColStd_Array1OfReal` / `TColStd_Array1OfInteger`. Determine the the kernel array constructors' exact arity + index conventions (the kernel uses 1-based indexing). Record the verified COMPLETE call sequence.

2. **`BRepBuilderAPI_MakeFace` from a NURBS surface.** Use the BSplineSurface from item 1; call `new oc.BRepBuilderAPI_MakeFace_*(surface, tolerance)` — find the right `_N` suffix that takes a `Geom_Surface` (likely `_8` or `_11`; introspect). Get a `TopoDS_Face`. Confirm it's non-null, measurable (area > 0 via `GProp_GProps` + `BRepGProp.SurfaceProperties`). Record the verified sequence.

3. **`Geom_BSplineSurface.InsertUKnot` + `InsertVKnot`** for refinement. On the BSpline from item 1, insert a knot at u=0.5 with multiplicity 1, tolerance 1e-6. Verify the surface's `NbUKnots()` / `NbVKnots()` increased. Record.

4. **`Geom_BSplineSurface.IncreaseDegree`** for degree elevation. Elevate u and v degrees from 3 to 4. Verify `UDegree()` and `VDegree()` reflect the change; pole grid grows. Record.

5. **`GeomLProp_SLProps`** for curvature evaluation. Sample the surface at (u, v) = (0.5, 0.5). Determine the constructor (`new oc.GeomLProp_SLProps_*(surface, U, V, N=2, tolerance)`; try multiple suffixes). Get principal curvatures via `.MaxCurvature() / .MinCurvature()`, Gaussian via `.GaussianCurvature()`, mean via `.MeanCurvature()`, normal via `.Normal()` (returns `gp_Dir`). For a flat 4×4 control grid at z=0 with linear z-gradient, Gaussian and mean curvature should be 0 (planar). Verify. Record.

6. **`BRep_Tool.Surface(face)`** to extract a `Geom_Surface` from a `TopoDS_Face`. Take a primitive `BRepPrimAPI_MakeCylinder_1(20, 40).Shape()`, explore its faces, pick a curved face, extract its surface. Check whether the extracted handle is a `Geom_CylindricalSurface` (analytic) or a `Geom_BSplineSurface` (NURBS) by introspecting its prototype / class name. Record what comes out.

7. **`GeomConvert.SurfaceToBSplineSurface`** to convert ANY `Geom_Surface` (e.g. the cylinder's analytic surface) to a NURBS form. Find the right method (likely a static on `oc.GeomConvert` or a Handle-style API). Record. This lets us NURBS-ify analytic primitives for downstream NURBS ops.

For each item record `REACHABLE` (with the verified call sequence + measurements) or `NOT_REACHABLE` (with the error and what was tried). `expect(...)` only that each item has a verdict — green = investigation complete.

- [ ] **Step 2: Build + run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-e-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write `docs/superpowers/notes/kernel-api-E.md`**

For each of items 1–7: the `REACHABLE`/`NOT_REACHABLE` verdict; for reachable ones the COMPLETE verified copy-pasteable call sequence; for not-reachable ones an honest explanation. Add a "Sub-project E deliverable scope" section listing which ops Tasks 2-4 will build.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-e-recon-electron.spec.js docs/superpowers/notes/kernel-api-E.md docs/superpowers/notes/kernel-api-E-recon.json
git commit -m "test(kernel): E recon — NURBS reachability verdict per op"
```

---

## Tasks 2-4 (executed AFTER Task 1's verdict)

The remaining tasks follow the established pattern. They are described briefly here; full detail is added once Task 1's verdict is known.

### Task 2 — `BrepNurbs.js`

Implement the NURBS ops Task 1 confirmed reachable. Likely set:
- **`buildNurbsPatch(controlPoints, opts)`** — given a 4×4 (or N×M) control-point grid, build a clamped-cubic NURBS surface + `BRepBuilderAPI_MakeFace`. Returns a `BrepShape` wrapping the face. Opts: `uDegree=3`, `vDegree=3`, `tolerance=1e-6`.
- **`refineNurbs(brepShape, opts)`** — extract the face's underlying NURBS via `BRep_Tool.Surface`; if not already BSpline use `GeomConvert.SurfaceToBSplineSurface`; insert knots at u=0.25/0.5/0.75 and v=0.25/0.5/0.75 (or per opts); rebuild face. Returns a refined `BrepShape`.
- **`elevateNurbsDegree(brepShape, opts)`** — extract, elevate to `opts.uDegree`/`opts.vDegree` (or +1 each by default); rebuild face. Returns elevated `BrepShape`.
- **`nurbsCurvature(brepShape, u, v)`** — extract surface, sample via `GeomLProp_SLProps`, return `{ gaussian, mean, kMin, kMax, normal: [x,y,z] }`.
- **`faceToNurbs(brepShape, faceIndex)`** — extract face N, convert to BSpline surface, rebuild as a single NURBS face. Returns the NURBS face as a `BrepShape`.

### Task 3 — Facade + barrel + ribbon

Add `buildNurbsPatch`, `refineNurbs`, `elevateNurbsDegree`, `nurbsCurvature`, `faceToNurbs` to `index.js` barrel and `ArchDiscKernel.js` facade. Add `ToolParamSchemas` for each. Wire ribbon tools in the Surface tab (or Part tab Surface group, per where Subdivide/Retopo live):
- **`NURBS Patch`** (arity 0 — builds from internal default control grid + dialog params for grid size).
- **`Refine NURBS`** (arity 1 — operates on selected NURBS face).
- **`Elevate NURBS`** (arity 1).
- **`NURBS Curvature`** (arity 1 — opens dialog for u,v sample point; reports curvature values in status).
- **`Face to NURBS`** (arity 1 — operates on selected body, converts face N to a NURBS face).

### Task 4 — e2e gate

Real-world artifacts:
- **`NURBS Patch`** — "sail-like fairing patch" — clickRibbonTab 'Part' → 'NURBS Patch' → fillDialog (defaults).
- **`Refine NURBS`** — "refined fairing patch" — chain: NURBS Patch → select → Refine NURBS.
- **`Elevate NURBS`** — same chain ending with Elevate NURBS.
- **`NURBS Curvature`** — sample curvature at the centre of a NURBS Patch — assert flat patch gives ≈0 curvature.
- **`Face to NURBS`** — buildPrimitive 'Cylinder' → select → Face to NURBS → assert the result has a NURBS face replacing one cylindrical face.

All e2e tests use real ribbon clicks + dialogs + the orbitCapture all-angles sweep. Numeric assertions tightened around real measured values once the suite runs.

After Tasks 2-4 ship, append a "Sub-project E — honest outcome" section to `docs/superpowers/notes/kernel-api-E.md`: shipped ops + measured values + any honest gaps.

---

## Self-review notes

- All directives covered: recon-first to establish reachability; no hardcoded inputs; real-world artifacts; all-angles capture; sophisticated integrations.
- Honest gaps will be documented per Task 4 — any NOT_REACHABLE NURBS ops get an honest explanation (e.g. if `GeomLProp_SLProps` is unbound, the curvature op is replaced or skipped with documentation).
- Deferred: NURBS surface-surface intersection (SSI); trim-curve editing; class-A modelling workflow; NURBS fitting to point clouds. These are major future sub-projects per the spec.
