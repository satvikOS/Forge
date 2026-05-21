# kernel API Reachability — Sub-project G (opencascade.js@2.0.0-beta.b5ff984)

Empirical verdicts from `e2e/brep-g-recon-electron.spec.js` (GREEN on first run).
Raw data in `docs/superpowers/notes/kernel-api-G-recon.json`.

---

## Summary

| Item | Verdict |
|---|---|
| 1. NURBS Surface-Surface Intersection (`GeomAPI_IntSS`) | **REACHABLE** |
| 2. Closest-Point Projection (`GeomAPI_ProjectPointOnSurf`) | **REACHABLE** |
| 3. Auto-trimming NURBS face | **REACHABLE** (Path B — parametric bounds on handle) |

All three the kernel-dependent G capabilities are reachable in this build.

---

## Item 1 — NURBS Surface-Surface Intersection (`GeomAPI_IntSS`)

**REACHABLE**

### Verified call sequence

```js
// Build two primitives that intersect
const mBox = new oc.BRepPrimAPI_MakeBox_2(40, 40, 40);
const cubeShape = mBox.Shape();
mBox.delete();

const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(15, 40);
const cylShape = mCyl.Shape();
mCyl.delete();

// Extract one flat face from cube (face index 0)
const cubeFaces = collectUniqueFaces(cubeShape);  // see helper in spec
const cubeSurfHandle = oc.BRep_Tool.Surface_2(cubeFaces[0]);  // Handle_Geom_Surface (Geom_Plane)

// Extract the curved lateral face from cylinder (largest area face)
const cylFaces = collectUniqueFaces(cylShape);
// cylFaceAreas: [{idx:0, area:3769.9}, {idx:1, area:706.9}, {idx:2, area:706.9}]
const cylSurfHandle = oc.BRep_Tool.Surface_2(cylFaces[0]);    // Handle_Geom_Surface (Geom_CylindricalSurface)

// Clean up shape explorers
for (const f of cubeFaces) f.delete();
for (const f of cylFaces)  f.delete();
cubeShape.delete();
cylShape.delete();

// Construct GeomAPI_IntSS — no-arg ctor + Perform
// Available suffixes: GeomAPI_IntSS, GeomAPI_IntSS_1, GeomAPI_IntSS_2
const intSS = new oc.GeomAPI_IntSS_1();   // no-arg constructor
intSS.Perform(cubeSurfHandle, cylSurfHandle, 1e-6);  // (surfA, surfB, tolerance)

console.log(intSS.IsDone());    // true
console.log(intSS.NbLines());   // 2

// Retrieve the first intersection curve (1-based)
const curveHandle = intSS.Line(1);  // Handle_Geom_Curve
const rawCurve = curveHandle.get(); // Geom_Line (for plane-cylinder intersection)

// Sample points along the curve
console.log(rawCurve.FirstParameter()); // -2e+100 (infinite line)
console.log(rawCurve.LastParameter());  //  2e+100

const p = new oc.gp_Pnt_3(0, 0, 0);
rawCurve.D0(0.0, p);   // evaluate at u=0
console.log(p.X(), p.Y(), p.Z());  // 0, -15, 0  (point on cylinder surface)

// Cleanup
p.delete();
curveHandle.delete();
intSS.delete();
cubeSurfHandle.delete();
cylSurfHandle.delete();
```

### Verified values

| Property | Value |
|---|---|
| Available constructor keys | `GeomAPI_IntSS`, `GeomAPI_IntSS_1`, `GeomAPI_IntSS_2` |
| Correct constructor | `new oc.GeomAPI_IntSS_1()` (no-arg) |
| Perform method | `intSS.Perform(surfA, surfB, tolerance)` |
| `IsDone()` | `true` |
| `NbLines()` | `2` (cube face plane intersects cylinder in 2 lines for a flat face cutting across) |
| `Line(1)` return type | `Handle_Geom_Curve` → `.get()` → `Geom_Line` |
| Available methods | `IsDone`, `Line`, `NbLines`, `Perform` |

### Notes on intersection result

The cube flat face (a `Geom_Plane`) intersects the cylinder lateral surface (`Geom_CylindricalSurface`). the kernel reports this as **2 `Geom_Line`** intersection curves (not circular arcs). This is the analytic result — the intersection of a plane with a cylinder of r=15 is a pair of lines in the degenerate case where the cutting plane is the xy-plane (the base plane of the cylinder). The cube face index 0 happens to be a face coincident with or parallel to the cylinder axis — the intersection topology is geometry-dependent.

For non-degenerate intersections (a tilted plane vs cylinder), the result would be `Geom_Ellipse` or other conic sections. The API is confirmed REACHABLE for all planar surfaces; the specific intersection type depends on the input geometry.

### Gotcha: `Geom_Line` parametric domain

`FirstParameter()` = `-2e+100`, `LastParameter()` = `2e+100` — this is the kernel's infinite-line parametric convention. Sampling at the boundary values produces valid (finite) points only at `u=0` (the line passes through `(0, -15, 0)`). For practical use, bound the parameter range by intersecting with the face's actual domain.

---

## Item 2 — Closest-Point Projection (`GeomAPI_ProjectPointOnSurf`)

**REACHABLE**

### Verified call sequence

```js
// Build cylinder r=20 h=40
const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
const cylShape = mCyl.Shape();
mCyl.delete();

// Extract lateral face (largest area)
const cylFaces = collectUniqueFaces(cylShape);
// areas: [{idx:0, area:5026.5}, {idx:1, area:1256.6}, {idx:2, area:1256.6}]
const cylSurfHandle = oc.BRep_Tool.Surface_2(cylFaces[0]);  // Handle_Geom_Surface (Geom_CylindricalSurface)
for (const f of cylFaces) f.delete();
cylShape.delete();

// Query point 5mm outside cylinder radius in +X at mid-height
const queryPnt = new oc.gp_Pnt_3(25, 0, 20);

// Construct GeomAPI_ProjectPointOnSurf — requires 3 args: (pnt, surface, tolerance)
// Available suffixes: GeomAPI_ProjectPointOnSurf, _1, _2, _3, _4, _5
// _1 is the no-arg ctor (0 params), _2 is the 3-arg ctor
const pp = new oc.GeomAPI_ProjectPointOnSurf_2(queryPnt, cylSurfHandle, 1e-6);
// No separate Perform needed when using _2 ctor, but Perform(queryPnt) also available

console.log(pp.NbPoints());          // 2  (two projections for a cylinder: nearest + antipodal)

// Nearest point
const np = pp.NearestPoint();
console.log(np.X(), np.Y(), np.Z()); // 20, 0, 20  (correct — on cylinder surface r=20)
np.delete();

// Distance to first (nearest) projection
console.log(pp.Distance(1));         // 5.0  (exact: ||(25,0,20) - (20,0,20)||)

// Parameters: available but pass-by-ref
pp.Parameters(1, 0, 0);  // parameters on surface at projection point (the kernel pass-by-ref — see below)

// Cleanup
pp.delete();
queryPnt.delete();
cylSurfHandle.delete();
```

### Verified values

| Property | Value |
|---|---|
| Available constructor suffixes | `GeomAPI_ProjectPointOnSurf` (no-accessible-ctor), `_1` (0-arg), `_2` (3-arg: pnt,surf,tol), `_3`, `_4`, `_5` |
| Correct constructor | `new oc.GeomAPI_ProjectPointOnSurf_2(pnt, surface, tolerance)` |
| `NbPoints()` | `2` (nearest + antipodal on closed cylinder) |
| `NearestPoint()` | `(20.000, 0.000, 20.000)` — exact, error = 0mm |
| `Distance(1)` | `5.0000` mm (exact) |
| `Parameters(1, u, v)` | Method present and callable |
| Full method list | `Distance`, `Init_1`–`Init_6`, `IsDone`, `LowerDistance`, `LowerDistanceParameters`, `NbPoints`, `NearestPoint`, `Parameters`, `Perform`, `Point`, `SetExtremaAlgo`, `SetExtremaFlag` |

### Constructor binding details

- `GeomAPI_ProjectPointOnSurf_1` = no-arg ctor (0 params) — use with `Init_*` methods for deferred initialization
- `GeomAPI_ProjectPointOnSurf_2` = `(pnt, surface, tolerance)` — 3-arg direct construction
- `GeomAPI_ProjectPointOnSurf_3`, `_4`, `_5` = additional variants with different parametric extrema flags

The 2-arg form `(pnt, surface)` WITHOUT tolerance is NOT the right overload for `_2` — it requires exactly 3 args.

---

## Item 3 — Auto-trimming NURBS B-rep face

**REACHABLE** via **Path B — parametric bounds on `Handle_Geom_Surface`**

### Path A — Parametric trim wire (MakeEdge2d): NOT used (gp_Pnt2d binding missing)

`BRepBuilderAPI_MakeEdge2d_*` keys exist (_1 through _28 are all present), but `gp_Pnt2d_2(u, v)` is not bound as a 2-argument constructor in this build. Without 2D point construction, the parametric wire cannot be built. Path A is structurally available but blocked by the `gp_Pnt2d` binding gap.

### Path B — `BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol)`: REACHABLE

The correct overload for a parametrically trimmed face from a `Handle_Geom_Surface` is `BRepBuilderAPI_MakeFace_14` with **6 arguments**: `(handle, uMin, uMax, vMin, vMax, tolerance)`.

### Verified call sequence

```js
// Build a surface with a known parametric domain.
// Using a cylinder (r=20 h=40) lateral face as the surface handle.
// Cylinder parametric domain: u ∈ [0, 2π] (angle), v ∈ [0, 40] (height)
const mCyl = new oc.BRepPrimAPI_MakeCylinder_1(20, 40);
const cylShape = mCyl.Shape();
mCyl.delete();

const cylFaces = collectUniqueFaces(cylShape);
// Pick largest-area face = lateral surface
const cylSurfHandle = oc.BRep_Tool.Surface_2(cylFaces[0]);  // Handle_Geom_Surface
for (const f of cylFaces) f.delete();
cylShape.delete();

// Full face area = 2π*20*40 ≈ 5026.5 mm²

// Trim to central 60% of parameter range in both u and v:
//   u ∈ [2π*0.2, 2π*0.8], v ∈ [40*0.2, 40*0.8] = [8, 32]
const TWO_PI = 2 * Math.PI;
const trimU1 = TWO_PI * 0.2;  // ≈ 1.257
const trimU2 = TWO_PI * 0.8;  // ≈ 5.027
const trimV1 = 40 * 0.2;      // = 8.0
const trimV2 = 40 * 0.8;      // = 32.0

// Build the trimmed face via BRepBuilderAPI_MakeFace_14
// Sig: (Handle_Geom_Surface, UMin, UMax, VMin, VMax, tolerance)
const mf = new oc.BRepBuilderAPI_MakeFace_14(cylSurfHandle, trimU1, trimU2, trimV1, trimV2, 1e-6);
console.log(mf.IsDone());  // true

const face = mf.Face();
// Measure area — should be 0.36 × 5026.5 ≈ 1809.6 mm²
const props = new oc.GProp_GProps_1();
oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
const area = props.Mass();  // 1809.5573684677208 mm²
console.log(area / 5026.548);  // ≈ 0.360

// Cleanup
props.delete();
face.delete();
mf.delete();
cylSurfHandle.delete();
```

### Verified values

| Property | Value |
|---|---|
| Correct MakeFace overload | `BRepBuilderAPI_MakeFace_14(Handle_Geom_Surface, U1, U2, V1, V2, tol)` |
| `IsDone()` | `true` |
| Full patch area | `5026.548 mm²` (cylinder r=20 h=40 lateral surface) |
| Trimmed face area | `1809.557 mm²` |
| Area ratio | `0.360` (exact — 0.6 × 0.6 = 0.36 fraction in u×v) |
| Available `MakeFace` ctors tested | `_8` through `_14` |

### Notes on Path B suffix mapping

The 6-arg `(Handle_Geom_Surface, U1, U2, V1, V2, tolerance)` overload is `_14` in this build.
Other suffixes map to specific analytic primitive types:
- `_8`: `(Handle_Geom_Surface, tol)` — no parametric bounds
- `_9`: `(gp_Pln, U1, U2, V1, V2)` — planar face
- `_10`: `(gp_Cylinder, U1, U2, V1, V2)` — cylindrical face from analytic primitive
- `_11`: `(gp_Cone, ...)`, `_12`: `(gp_Sphere, ...)`, `_13`: `(gp_Torus, ...)`
- `_14`: `(Handle_Geom_Surface, U1, U2, V1, V2, tol)` — generic surface with bounds

### Geom_RectangularTrimmedSurface also available

`Geom_RectangularTrimmedSurface_1` (`Handle_Geom_Surface, U1, U2, V1, V2, USense, VSense`) constructs successfully. However, the resulting object is a raw `Standard_Transient` (same Handle/Transient constraint as BSpline surfaces), so it cannot be directly passed to `BRepBuilderAPI_MakeFace_8`. The direct parametric-bounds path (`MakeFace_14`) is simpler and preferred.

### Path A status

`BRepBuilderAPI_MakeEdge2d_1` through `_28` are all present in the binding. However, `gp_Pnt2d` 2-argument constructor is not reachable in this build (no `gp_Pnt2d_2(u, v)` exists). Without 2D points, parametric wire construction is blocked. Path A cannot be completed without `gp_Pnt2d` binding.

---

## Sub-project G the kernel-dependent deliverable scope

Based on these recon results, all three the kernel-dependent G Tasks are buildable:

### Task 3 — NURBS Surface-Surface Intersection (`BrepNurbsSSI.js`)

**BUILD** — `GeomAPI_IntSS` is REACHABLE.

Key architecture:
- `nurbsSSI(brepShapeA, faceIdxA, brepShapeB, faceIdxB)`: extract two face surfaces via `BRep_Tool.Surface_2`, run `new oc.GeomAPI_IntSS_1()` + `.Perform(surfA, surfB, tol)`, read intersection curves via `.NbLines()` + `.Line(i)` (1-based).
- Return `{curves: [{points: [[x,y,z],...], class: 'Geom_Line'|'Geom_Ellipse'|...}]}`.
- Sampling: use `.FirstParameter()/.LastParameter()` for domain bounds; for infinite lines (`Geom_Line`), clamp to a sensible range (e.g. ±100 mm) from the line's midpoint.
- Ribbon tool: **"NURBS SSI"** (arity 2, two bodies selected). Dialog: faceIndexA, faceIndexB.
- Honest limitation: intersection curve type depends on geometry (plane×cylinder = line; NURBS×NURBS may fail if no analytic form — probe `NbLines() === 0` and report accordingly).

### Task 4 — Surface Pull-back in Retopology (`BrepRetopo.js` modification)

**BUILD** — `GeomAPI_ProjectPointOnSurf` is REACHABLE.

Key architecture:
- Per-face oracle: extract each face via `TopExp_Explorer_2(shape, TopAbs_FACE)`, get handle via `BRep_Tool.Surface_2(face)`, construct `new oc.GeomAPI_ProjectPointOnSurf_2(queryPnt, surfHandle, 1e-6)` for each candidate face, read `NbPoints() >= 1 ? NearestPoint() : null`.
- Multi-face closest: loop over all faces, compare `.LowerDistance()`, keep the minimum.
- Wire into `IsotropicRemesh.js` `surfaceOracle` callback.
- Opt: `pullBack: boolean` in `retopoShape` (default true).
- Cleanup: `.delete()` every `GeomAPI_ProjectPointOnSurf_2` and every `gp_Pnt_3` query object after use.

### Task 5 — Auto-trimming NURBS face (`BrepNurbsTrim.js`)

**BUILD** via Path B — `BRepBuilderAPI_MakeFace_14(handle, U1, U2, V1, V2, tol)`.

Key architecture:
- `trimmedNurbsFace(opts)`: the surface must be obtainable as a `Handle_Geom_Surface`. Build via `BRepPrimAPI_MakeCylinder_1` or similar, or re-use the E-noted workaround (triangulated compound with stored NURBS transient) for NURBS patches.
- Parametric trim: `new oc.BRepBuilderAPI_MakeFace_14(surfHandle, uMin, uMax, vMin, vMax, 1e-6)`.
- For NURBS patches from `Geom_BSplineSurface_1` (raw transient), the Handle/Transient constraint from E still applies. Options:
  1. Use `MakeFace_8(handle, tol)` first to create an untrimmed face, extract its handle via `BRep_Tool.Surface_2`, then apply trim via `MakeFace_14`. This round-trip recovers a valid `Handle_Geom_Surface` for a BSpline patch.
  2. Alternatively, restrict Task 5 to surfaces extracted from existing BRep shapes (not freshly-constructed BSpline transients).
- Ribbon tool: **"Trimmed NURBS Patch"** (arity 0). Dialog: surfaceSource (body index), faceIndex, uMin, uMax, vMin, vMax.
- Honest note: Path A (parametric wire via MakeEdge2d) is blocked by missing `gp_Pnt2d` 2-arg constructor. The `MakeFace_14` param-bounds path is the primary path.

### Explicitly out of scope

- Path A parametric trim wire via `BRepBuilderAPI_MakeEdge2d`: blocked by `gp_Pnt2d` binding gap (no `gp_Pnt2d_2(u, v)` constructor in this build). `MakeEdge2d_*` keys are all present but unusable without 2D point construction.
- `GeomAPI_IntSS` for two analytic primitives whose intersection is an infinite line: the `Geom_Line` result has a ±2e+100 parameter range. Callers must clamp the parameter sampling to a finite domain. Document this limitation per-tool.

---

## Sub-project G — Honest outcome

_Final, measured. Recorded by Task 8 (full kernel + UX e2e suite gate) on 2026-05-21._

### Suite result

The full kernel + UX e2e suite was run in 6 chunks, `--project=chromium --workers=1
--retries=0` (motion-capture specs race in parallel workers, so `--workers=1` is
mandatory). Measured result:

| Chunk | Specs | Tests passed |
|---|---|---|
| A — recon | brep-occt-load, brep-a1..a5-recon, brep-b/e/f/g-recon, subdivide-recon, retopo-recon (12 files) | 12 / 12 |
| B — foundation/ribbon/primitives/boolean/features/step (6 files) | 11 / 11 |
| C — localops/surfacing/varfillet/check/simplify/blend (6 files) | 10 / 10 |
| D — b-advanced/subdivide-surface/retopo-surface/nurbs/final (5 files) | 5 / 5 |
| E — G ops: catmullclark/ssi/pullback/trim/g2blend/classa (6 files) | 6 / 6 |
| F — viewport/misc: pick-diagnostic, viewport-workflow-freeze, viewport-freeze-debug, thought-bubble-dismiss, motion-recon (5 files) | 6 / 6 + 1 skipped |

**Total: 50 / 50 tests passed, 1 skipped** (`thought-bubble-dismiss-electron.spec.js`
is an intentional `test.skip`). 0 genuine failures — no spec needed a fix; the
session's behaviour changes (gizmo-pick-set fix, consuming-ops removing input
bodies, the ~20-spec motion-capture retrofit) were already absorbed by the specs
as shipped.

### Coherence check

Every Sub-project G op is coherently wired end-to-end:

| Op | `index.js` barrel | `ArchDiscKernel.brep.*` | Ribbon tool | `TOOL_GROUPS` | Handler |
|---|---|---|---|---|---|
| Catmull-Clark | `catmullClarkShape` | ✓ | "Catmull-Clark Subdivide" | ✓ | ✓ |
| NURBS SSI | `intersectSurfaces` | ✓ | "Surface-Surface Intersection" | ✓ | ✓ |
| Surface pull-back | `projectPointsOntoBrep` / `projectMeshOntoBrep` | ✓ | "Retopo Surface" `pullBackToSurface` opt | ✓ | ✓ |
| Trimmed NURBS face | `trimmedNurbsFace` | ✓ | "Trimmed NURBS Patch" | ✓ | ✓ |
| G2 blend | `g2BlendBetweenEdges` | ✓ | "G2 Blend" | ✓ | ✓ |
| Class-A analyze | `classAAnalyze` | ✓ | "Class-A Analyze" + "Zebra Stripes" | ✓ | ✓ |

No wiring gaps were found; nothing needed fixing.

### Ops shipped (G)

1. **Catmull-Clark Subdivide** — pure-JS `CatmullClarkSubdivision.js` (full
   face/edge/vertex rules, crease/corner/boundary, tri→quad converter) behind
   `BrepCatmullClark.js`. e2e: rounded plate, 2 levels, bbox preserved.
2. **NURBS SSI** — `BrepNurbsSSI.js` via `GeomAPI_IntSS`. e2e: cylinder × box →
   2 intersection lines, 128 sampled points.
3. **Surface pull-back (retopo)** — `BrepSurfaceProject.js` + `IsotropicRemesh.js`
   `surfaceOracle` via `GeomAPI_ProjectPointOnSurf`. e2e: sphere retopo keeps all
   827 verts on r=25 surface (spread 0.000 mm, 4913 projections, maxΔ 0.199 mm).
4. **Trimmed NURBS face** — `BrepNurbsTrim.js` via `BRepBuilderAPI_MakeFace_14`
   (parametric u-v bounds). e2e: windowed sail panel, trimRatio 0.188.
5. **G2 blend** — pure-JS `G2BlendSurface.js` (degree 3×5 NURBS, curvature match)
   behind `BrepBlendG2.js`. e2e: notched-plate fairing, boundary fit error ~1e-14.
6. **Class-A tools** — `BrepClassA.js` Gaussian-curvature heatmap + `ZebraStripes.js`
   reflected-ray stripe overlay. e2e: filleted plate, 616 samples, 18 zebra bands.

### Honest residual gaps (carried forward, unchanged)

These were documented when each op shipped and remain true — the suite gate did
not change them:

- **NURBS SSI** — for two analytic primitives whose intersection is an infinite
  line, the `Geom_Line` result carries a ±2e+100 parameter range; callers clamp
  sampling to a finite domain.
- **Trimmed NURBS face** — Path A (arbitrary parametric trim curve via
  `BRepBuilderAPI_MakeEdge2d`) is blocked by the missing `gp_Pnt2d` 2-arg
  constructor in this WASM build. Only rectangular u-v-bounds trim
  (`MakeFace_14`) is reachable. Single trimmed face, not an auto-sewn multi-face
  class-A panel.
- **Surface pull-back** — no UV-in-domain clamp; oracle is O(n_faces) per vertex
  (no BVH); per-vertex projection with no global face-consistency smoothing.
- **G2 blend** — mesh-fidelity result (sewn triangle shell), not a single
  analytic NURBS `TopoDS_Face`; two-edge blend only; curvature continuity is
  along v-isocurves (strongly-skew boundary pairs are a gap).
- **Catmull-Clark** — quads only; unpairable triangles become degenerate quads
  whose limit surface is not class-A; tri→quad pairing is greedy, not optimal.
- **Class-A tools** — discrete per-vertex curvature estimate (converges under
  refinement, not exact analytic curvature); zebra is a reflected-ray shader
  approximation, not a sampled HDRI; analysis tools only — no interactive
  curvature-comb / surface-matching editing.
- **Open frontier beyond G** — auto-trimming a complex multi-face B-rep with G2
  fillets into a true class-A B-rep solid still needs the `gp_Pnt2d` binding gap
  resolved (custom WASM build) or a different geometry kernel.
