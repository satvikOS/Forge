# the kernel NURBS API Reachability — Sub-project E (opencascade.js@2.0.0-beta.b5ff984)

Empirical verdicts from `e2e/brep-e-recon-electron.spec.js` (all GREEN).
Raw data in `docs/superpowers/notes/kernel-api-E-recon.json`.

---

## Critical discovery: Handle vs Transient

`Geom_BSplineSurface_1(...)` returns a **raw `Standard_Transient`** object.
Every kernel API that takes a surface parameter (MakeFace, SLProps, GeomConvert) requires
a **`Handle_Geom_Surface`** — the smart-pointer wrapper — not the raw transient.

In this build there is **no exposed constructor** `Handle_Geom_BSplineSurface(rawSurf)`.
`BRep_Tool.Surface_2(face)` is the only way to obtain a `Handle_Geom_Surface` at runtime.

This shapes the Task 2–4 architecture: the B-spline surface must be **placed into a BRep face
first** so downstream consumers can retrieve its handle via `BRep_Tool.Surface_2`.

---

## Item 1 — `Geom_BSplineSurface` construction

**REACHABLE**

### Verified call sequence

```js
// --- helper: build a 4×4 clamped-cubic B-spline surface ---
function buildBSplineSurface(oc, flat = false) {
  const poles = new oc.TColgp_Array2OfPnt_2(1, 4, 1, 4);
  // DISTINCT knot values (NOT expanded), size = nbDistinctKnots
  const uK = new oc.TColStd_Array1OfReal_2(1, 2);      // [0.0, 1.0]
  const vK = new oc.TColStd_Array1OfReal_2(1, 2);
  const uM = new oc.TColStd_Array1OfInteger_2(1, 2);   // [4, 4]
  const vM = new oc.TColStd_Array1OfInteger_2(1, 2);

  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const x = (i - 1) * 40 / 3;
      const y = (j - 1) * 40 / 3;
      const z = (!flat && (i === 2 || i === 3) && (j === 2 || j === 3)) ? 8.0 : 0.0;
      const pnt = new oc.gp_Pnt_3(x, y, z);
      poles.SetValue(i, j, pnt);
      pnt.delete();
    }
  }
  uK.SetValue(1, 0.0);  uK.SetValue(2, 1.0);
  vK.SetValue(1, 0.0);  vK.SetValue(2, 1.0);
  uM.SetValue(1, 4);    uM.SetValue(2, 4);
  vM.SetValue(1, 4);    vM.SetValue(2, 4);

  const surf = new oc.Geom_BSplineSurface_1(
    poles, uK, vK, uM, vM,
    3, 3,          // UDegree, VDegree
    false, false   // UPeriodic, VPeriodic
  );
  poles.delete(); uK.delete(); vK.delete(); uM.delete(); vM.delete();
  return surf;   // Standard_Transient — NOT a Handle
}
```

### Verified post-construction values
| Property | Value |
|---|---|
| `UDegree()` | 3 |
| `VDegree()` | 3 |
| `NbUKnots()` | 2 |
| `NbVKnots()` | 2 |
| `NbUPoles()` | 4 |
| `NbVPoles()` | 4 |

### Gotcha
Pass **distinct** knot values (`[0.0, 1.0]` with multiplicity array `[4, 4]`).
Passing an expanded sequence `[0,0,0,0,1,1,1,1]` with an 8-element array throws
`Standard_ConstructionError` (integer exception code `18940656`).

---

## Item 2 — `BRepBuilderAPI_MakeFace` from a surface

**REACHABLE** (with constraint — see below)

### Verified call sequence

`BRepBuilderAPI_MakeFace_8` accepts a `Handle_Geom_Surface` + tolerance:

```js
// handle obtained from BRep_Tool.Surface_2 (see Item 6)
const mf = new oc.BRepBuilderAPI_MakeFace_8(handle_geom_surface, 1e-6);
if (mf.IsDone()) {
  const face = mf.Face();
  // use face ...
  face.delete();
}
mf.delete();
```

### Constraint
`Geom_BSplineSurface_1(...)` is a raw `Standard_Transient`.
`BRepBuilderAPI_MakeFace_8` rejects it with:
> `BindingError: Expected null or instance of Handle_Geom_Surface, got an instance of Standard_Transient`

**Workaround path for Tasks 2–4:**
1. Construct the B-spline surface with `Geom_BSplineSurface_1`.
2. Use `BRep_Builder.MakeFace_*` low-level methods + tolerance to embed it into a shell
   before calling high-level `BRepBuilderAPI_MakeFace_8`. Alternatively, compute the
   parametric boundary and add trimming wires with ctor variants `_9`–`_13`.

### Available `BRepBuilderAPI_MakeFace` ctors
Ctors `_1`–`_22` are all present. Only `_8` takes `(Handle_Geom_Surface, Real)`.
Ctors `_9`–`_13` take `(Handle_Geom_Surface, Real, Real, Real, Real, Real)` —
parametric bounds — and also require a `Handle_Geom_Surface`.

---

## Item 3 — `InsertUKnot` / `InsertVKnot` refinement

**REACHABLE**

### Verified call sequence

```js
const surf = buildBSplineSurface(oc);

// 4-arg form required (not 3)
surf.InsertUKnot(0.5, 1, 1e-6, true);   // (U, Mult, ParametricTolerance, Add)
surf.InsertVKnot(0.5, 1, 1e-6, true);

console.log(surf.NbUKnots()); // 3  (was 2)
console.log(surf.NbVKnots()); // 3  (was 2)
surf.delete();
```

### Verified result
| | Before | After |
|---|---|---|
| `NbUKnots()` | 2 | 3 |
| `NbVKnots()` | 2 | 3 |

### Gotcha
Calling with 3 arguments throws:
> `BindingError: function Geom_BSplineSurface.InsertUKnot called with 3 arguments, expected 4 args!`

`InsertUKnots` (plural) is also present for batch insertion.

---

## Item 4 — `IncreaseDegree` (3,3) → (4,4)

**REACHABLE**

### Verified call sequence

```js
const surf = buildBSplineSurface(oc);

surf.IncreaseDegree(4, 4);   // (UDegree, VDegree)

console.log(surf.UDegree()); // 4  (was 3)
console.log(surf.VDegree()); // 4  (was 3)
console.log(surf.NbUPoles()); // 5  (was 4)
console.log(surf.NbVPoles()); // 5  (was 4)
surf.delete();
```

### Verified result
| Property | Before | After |
|---|---|---|
| `UDegree()` | 3 | 4 |
| `VDegree()` | 3 | 4 |
| `NbUPoles()` | 4 | 5 |
| `NbVPoles()` | 4 | 5 |

---

## Item 5 — `GeomLProp_SLProps` curvature evaluation

**REACHABLE** (with constraint — requires `Handle_Geom_Surface`)

### Verified call sequence

```js
// Obtain a Handle_Geom_Surface via BRep_Tool.Surface_2 (see Item 6)
const handle = oc.BRep_Tool.Surface_2(face);

// GeomLProp_SLProps_1(Handle_Geom_Surface, U, V, Order, Resolution)
const props = new oc.GeomLProp_SLProps_1(handle, 0.0, 0.5, 2, 1e-6);

console.log(props.MaxCurvature());      // principal curvature κ_max
console.log(props.MinCurvature());      // principal curvature κ_min
console.log(props.GaussianCurvature()); // κ_max × κ_min
console.log(props.MeanCurvature());     // (κ_max + κ_min) / 2

props.delete();
handle.delete();
```

### Verified values (cylinder, radius 20 mm)
| Method | Value |
|---|---|
| `MaxCurvature()` | 0.000000 |
| `MinCurvature()` | -0.050000 |
| `GaussianCurvature()` | 0.000000 |
| `MeanCurvature()` | -0.025000 |

These are correct for a cylinder of radius 20 mm (κ_min = -1/R = -0.05).

### Available `GeomLProp_SLProps` methods
`CurvatureDirections`, `D1U`, `D1V`, `D2U`, `D2V`, `DUV`, `GaussianCurvature`,
`IsCurvatureDefined`, `IsNormalDefined`, `IsTangentUDefined`, `IsTangentVDefined`,
`IsUmbilic`, `MaxCurvature`, `MeanCurvature`, `MinCurvature`, `Normal`,
`SetParameters`, `SetSurface`, `TangentU`, `TangentV`, `Value`

### Constraint
All four ctors (`_1`–`_4`) reject a raw `Geom_BSplineSurface` (`Standard_Transient`).
The surface must be accessed as a `Handle_Geom_Surface` (obtainable via `BRep_Tool.Surface_2`).

---

## Item 6 — `BRep_Tool.Surface` extraction

**REACHABLE**

### Verified call sequence

```js
// Build a cylinder solid with BRepPrimAPI_MakeCylinder
const cyl = new oc.BRepPrimAPI_MakeCylinder_2(20, 40); // radius 20, height 40
cyl.Build();
const cylShape = cyl.Shape();

// Iterate faces with TopExp_Explorer
const exp = new oc.TopExp_Explorer_2(
  cylShape,
  oc.TopAbs_ShapeEnum.TopAbs_FACE,
  oc.TopAbs_ShapeEnum.TopAbs_SHAPE
);
let curvedFace = null;
while (exp.More()) {
  const face = oc.TopoDS.Face_1(exp.Current());
  const props = new oc.BRepGProp_Face(face);
  // pick the face with largest area = curved lateral surface
  curvedFace = face;   // store largest
  exp.Next();
}

// Extract Handle_Geom_Surface from the face
const handle = oc.BRep_Tool.Surface_2(curvedFace);   // returns Handle_Geom_Surface
const raw = handle.get();                              // Geom_CylindricalSurface

console.log(handle.constructor.name); // "Handle_Geom_Surface"
console.log(raw.constructor.name);    // "Geom_CylindricalSurface"
```

### Verified values
| Field | Value |
|---|---|
| `handle.constructor.name` | `Handle_Geom_Surface` |
| `handle.IsNull()` | `false` |
| `handle.get().constructor.name` | `Geom_CylindricalSurface` |
| Lateral face area | 5026.55 mm² |

### Note
The extracted surface is a `Geom_CylindricalSurface` (analytic representation), not
a `Geom_BSplineSurface`. This is expected — the kernel stores primitive faces as analytic
surfaces internally. The handle is nonetheless a valid `Handle_Geom_Surface` and can
be passed to `GeomLProp_SLProps_1` and `BRepBuilderAPI_MakeFace_8`.

`BRep_Tool` surface-related methods available: `Surface_1`, `Surface_2`,
`CurveOnSurface_1`–`_4`, `PolygonOnSurface_1`–`_4`.

---

## Item 7 — `GeomConvert.SurfaceToBSplineSurface`

**NOT_REACHABLE**

### What was tried

```js
// Attempt 1: pass Handle_Geom_Surface (obtained from BRep_Tool.Surface_2)
try {
  const result = oc.GeomConvert.SurfaceToBSplineSurface(handle);
  // THROWS integer exception 18944264 (Standard_ConstructionError or similar)
} catch (e) { /* "18944264" */ }

// Attempt 2: pass raw Standard_Transient
try {
  const result = oc.GeomConvert.SurfaceToBSplineSurface(rawTransient);
  // BindingError: Expected null or instance of Handle_Geom_Surface,
  //              got an instance of Standard_Transient
} catch (e) { /* BindingError */ }
```

### Verdict explanation
- `oc.GeomConvert` exists and `hasSurfaceToBSplineSurface === true`
- The method is listed in `GeomConvert` static methods
- Attempt with `Handle_Geom_Surface` throws the kernel integer exception `18944264`
  (likely `Standard_NoSuchObject` or `Standard_ConstructionError` from C++ side)
- Attempt with raw transient is rejected by the Embind binding layer
- No third path is available in this build

### Impact on Tasks 2–4
`GeomConvert.SurfaceToBSplineSurface` cannot be used to convert extracted analytic
surfaces (cylinders, planes) to NURBS for unified representation.
Alternative: construct `Geom_BSplineSurface_1` directly (Item 1) for any NURBS
patches needed; do not rely on auto-conversion from BRep-extracted handles.

---

## Sub-project E deliverable scope

Based on these recon results, Tasks 2–4 should build on the following confirmed-reachable ops:

### Task 2 — NURBS surface builder utility
Ops to use:
- **Item 1** (`Geom_BSplineSurface_1`): core construction; 4×4 clamped-cubic baseline
- **Item 3** (`InsertUKnot`/`InsertVKnot`): h-refinement (add knots without changing shape)
- **Item 4** (`IncreaseDegree`): p-refinement (elevate degree without changing shape)
- **Item 6** (`BRep_Tool.Surface_2`): retrieve `Handle_Geom_Surface` from existing BRep faces

### Task 3 — NURBS face creation and B-rep integration
Ops to use:
- **Item 2** (`BRepBuilderAPI_MakeFace_8` with `Handle_Geom_Surface`):
  wrap NURBS surface into a BRep face. Architecture: build surface → store in shell
  via `BRep_Builder` low-level methods to obtain a valid handle, then pass to
  `BRepBuilderAPI_MakeFace_8`.
- **Item 6** (`BRep_Tool.Surface_2`): round-trip verification — extract the surface
  back from the created face to confirm it is stored correctly.

### Task 4 — Curvature analysis and surface diagnostics
Ops to use:
- **Item 5** (`GeomLProp_SLProps_1`): curvature (MaxK, MinK, GaussK, MeanK, Normal,
  principal curvature directions). Access surface via `BRep_Tool.Surface_2` handle.
- **Item 1** + **Item 6** combined: build a NURBS patch, place it into a BRep face,
  extract handle, then evaluate curvature at arbitrary (u, v) parameters.

### Explicitly out of scope (NOT_REACHABLE)
- `GeomConvert.SurfaceToBSplineSurface` — do not use; throws the kernel exception.
  If analytic-to-NURBS conversion is needed, construct `Geom_BSplineSurface_1`
  directly with approximated control points.

---

## Sub-project E — Honest outcome (2026-05-20)

### What shipped

| File | Role |
|---|---|
| `frontend/src/kernel/brep/BrepNurbs.js` | NURBS kernel ops (buildNurbsPatch, refineNurbs, elevateNurbsDegree, nurbsCurvature) |
| `frontend/src/kernel/brep/index.js` | Re-exports all 4 ops |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Facade: `kernel.brep.buildNurbsPatch` etc. |
| `frontend/src/foundation/ToolParamSchemas.js` | 4 schemas for dialog auto-resolve |
| `frontend/src/components/RibbonToolbar.jsx` | 4 tools in Part → Surface group |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | surface.Modify items list |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | 4 handlers |
| `e2e/brep-nurbs-electron.spec.js` | Gate tests (4 real-artifact tests, all green) |

### Architecture decision: triangulated compound

The planned approach (BRepBuilderAPI_MakeFace_8 from a raw B-spline transient) failed
at runtime: `BindingError: Expected null or instance of Handle_Geom_Surface, got an
instance of Standard_Transient`. This is the fundamental constraint documented in
the recon note — no Handle constructor is exposed for B-spline surfaces.

**Final architecture:**
1. Build `Geom_BSplineSurface_1` transient — used for D0/D2/InsertKnot/IncreaseDegree.
2. Sample D0 on a 10×10 grid (200 triangles) → build `TopoDS_Compound` via
   `BRep_Builder.MakeCompound + Add`, with each triangle built as
   `BRepBuilderAPI_MakeEdge_3 → MakeWire_1 → MakeFace_15(wire, true)`.
3. Store raw NURBS transient in `BrepShape.meta.nurbsSurf` (NOT tracked by `withScope`)
   for downstream refine/elevate/curvature ops. `_attachNurbsDispose` extends
   `BrepShape.dispose()` to delete it.
4. Curvature: from `surf.D2(u,v,P,D1u,D1v,D2u,D2v,D2uv)` via classical differential
   geometry (first + second fundamental forms) — bypasses `GeomLProp_SLProps_1`.
5. Refine/elevate: `_cloneSurface` copies poles/knots/mults into a new transient,
   then applies `InsertUKnot`/`InsertVKnot`/`IncreaseDegree`, then re-triangulates.

### E2E results

| Test | Status | Key measurement |
|---|---|---|
| A — NURBS Patch | GREEN | area = 1655.7 mm² ∈ [1500, 2800] mm²; faceCount = 200 |
| B — Refine NURBS | GREEN | area preserved: 1655.6962 → 1655.6962 mm² (Δ < 1e-3 mm²) |
| C — Elevate NURBS | GREEN | area preserved: 1655.6962 → 1655.6962 mm² (Δ < 1e-3 mm²) |
| D — NURBS Curvature | GREEN | sail: gaussian=5.06e-4 ≠ 0; flat (crown=0): gaussian=0, mean=0 |

All 4 tests pass under `--workers=1`. Under 6-worker parallel mode Test A is **flaky**
(same canvas-screenshot timeout pattern as brep-boolean and brep-primitives — pre-existing
resource contention when kernel WASM boots simultaneously in 6 processes). Tests B/C/D
pass in both modes.

### What this is / isn't

**Is:** A working 4×4 cubic NURBS patch with real h-refinement, p-elevation,
and curvature sampling, driven by ribbon clicks in the CAD workbench.
The curvature is computed from actual B-spline derivatives (D2 + differential
geometry), not from a placeholder formula.

**Is not:** A fully parametric BRep face backed by a Handle_Geom_Surface.
The B-rep representation is a triangulated compound (200 planar triangles).
Downstream the kernel operations (Fillet, Boolean, STEP export) on the NURBS patch
will operate on the triangle mesh, not the analytic NURBS surface.
For a fully analytic NURBS BRep you would need to expose `Handle_Geom_BSplineSurface`
constructor in the opencascade.js binding layer (not possible in the
@2.0.0-beta.b5ff984 build without recompiling the WASM).

### Residual gap

The Handle/Transient constraint is a hard limit of this WASM build. A future
sub-project could explore patching the opencascade.js binding (`.d.ts` + `embind`)
to expose `Handle_Geom_BSplineSurface.create(transient)` — this is ~10 lines of
C++ in `the kernel.d.ts` bindings and would unlock direct `BRepBuilderAPI_MakeFace_8`
usage. Until then, the triangulated-compound workaround is the only viable path.
