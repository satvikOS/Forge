# NURBS Surface-Surface Intersection (SSI) — Sub-project G, Task 3

## Algorithm

`BrepNurbsSSI.js` implements face-surface intersection via `GeomAPI_IntSS_1`.

### Call sequence (verified — Task 1 recon)

```js
// 1. Extract first face of each BrepShape
const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, ...);
const face = oc.TopoDS.Face_1(exp.Current());

// 2. Get Handle_Geom_Surface
const surfHandle = oc.BRep_Tool.Surface_2(face);  // Handle_Geom_Surface

// 3. Intersect
const intersector = new oc.GeomAPI_IntSS_1();      // no-arg ctor
intersector.Perform(surfA, surfB, tolerance);       // (Handle, Handle, double)

// 4. Read results
const nb = intersector.NbLines();                  // number of curves (1-based)
const curveHandle = intersector.Line(i);           // Handle_Geom_Curve
const rawCurve    = curveHandle.get();             // Geom_Line | Geom_Ellipse | ...

// 5. Sample
rawCurve.D0(t, pnt);                               // evaluate point at parameter t
```

### Parameter domain handling

`GeomAPI_IntSS` returns `Handle_Geom_Curve` whose concrete type depends on the
surface pair. For a flat face (Geom_Plane) intersecting a cylinder
(Geom_CylindricalSurface), the kernel returns `Geom_Line` with parametric
domain `[−2e100, +2e100]` — the infinite-line convention.

`_sampleCurve()` detects this via `Math.abs(param) > 1e90` and clamps to
`±INFINITE_LINE_HALF_RANGE` (60 mm) around the line's `u=0` reference point.
This produces a visible finite segment in the viewport for the primitive test
case (box × cylinder). For non-degenerate surface pairs (NURBS × NURBS), the
parameter domain will be finite and sampling runs the full domain unchanged.

### Rendering

Each intersection curve is rendered as a `THREE.Line` with `LineBasicMaterial`
(colour `0xff4400`, configurable `lineWidth`). The curves are collected under
a `THREE.Group` named `ArchDisc-SSI-<timestamp>` at mm→m scale (`0.001`),
consistent with `addBrepShapeToScene`. The group is non-pickable
(`userData.pickable = false`) — SSI curves are visualisation overlays, not
selectable B-rep bodies.

The result is mirrored to `window.__lastSSI = { curves, group, stats }` for
e2e introspection and AI introspection.

---

## Honest scope and limitations

### Scope: first-face-of-A × first-face-of-B

`intersectSurfaces(brepShapeA, brepShapeB)` extracts **one** face from each
input body (the first face returned by `TopExp_Explorer`) and intersects those
two surfaces. This is sufficient for:

- The recon-verified primitives: box (flat Geom_Plane face) × cylinder
  (Geom_CylindricalSurface lateral face).
- Any two single-faced shapes.

A production-grade multi-face SSI would enumerate every face pair
`(fA_i, fB_j)` via double `TopExp_Explorer` loops, intersect each, and deduplicate
overlapping/coincident curves. That is architecturally straightforward with this
API but out of scope for Task 3. The honest limitation is documented here.

### Geom_Line infinite parameter

When `GeomAPI_IntSS` returns a `Geom_Line` result (degenerate plane × cylinder),
the parametric domain is `[−2e100, +2e100]`. The sampler clamps to `±60 mm`
(configurable via `INFINITE_LINE_HALF_RANGE`) around the line's `u=0` reference.
This is cosmetically correct for the test artifact; a production tool would use
the actual bounding box of the input shapes to choose the clamp range.

### No analytic NURBS B-spline pair test

The recon-verified API works for Geom_Plane × Geom_CylindricalSurface. For
two genuinely parametric NURBS B-spline surfaces (Geom_BSplineSurface), the
kernel may return 0 lines if the surfaces do not analytically intersect at this
tolerance. The caller should check `stats.nbLines === 0` and surface a
user-facing warning. The handler already does this via the `IsDone()` guard.

### Handle_Geom_Surface / Standard_Transient constraint (from Sub-project E)

The NURBS B-spline surfaces built by `buildNurbsPatch` are `Standard_Transient`
(not `Handle_Geom_Surface`). They cannot be passed directly to `Perform()`.
`BrepNurbsSSI` works only with surfaces extracted from existing B-rep shapes
via `BRep_Tool.Surface_2(face)` — which returns a genuine `Handle_Geom_Surface`.
This is why the tool requires two BrepShape inputs (bodies already in the scene),
not raw surface parameters.

---

## Sub-project G — honest outcome

_Updated after Task 3 ships._

| Metric | Value |
|---|---|
| `nbLines` (box × cylinder, face 0) | 2 (two Geom_Line curves; the flat base of the cylinder is coplanar with the box face) |
| `totalPoints` at `samples=64` | 128 (64 per line) |
| Build status | GREEN |
| e2e status | see `e2e/brep-g-ssi-electron.spec.js` |

---

## Files

| File | Role |
|---|---|
| `frontend/src/kernel/brep/BrepNurbsSSI.js` | Core SSI implementation |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Facade entry `brep.intersectSurfaces` |
| `frontend/src/kernel/brep/index.js` | Barrel export |
| `frontend/src/foundation/ToolParamSchemas.js` | Dialog schema |
| `frontend/src/components/RibbonToolbar.jsx` | Ribbon entry (Surface group, Part tab) |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | TOOL_GROUPS.surface entry |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Ribbon handler |
| `e2e/brep-g-ssi-electron.spec.js` | e2e gate |
| `docs/superpowers/notes/kernel-api-G.md` | Recon verdict (Task 1) |

---

## Full-suite gate (Task 8, 2026-05-21)

`brep-g-ssi-electron.spec.js` GREEN in the full kernel + UX suite run
(`--workers=1`). Measured: cylinder × box → nbLines 2, totalPoints 128,
totalLength 240.000, 0 blank captures. Whole suite: 50/50 tests passed,
1 skipped. Residual gap unchanged — an infinite-line intersection of two
analytic primitives carries a ±2e+100 parameter range and callers must clamp
the sampling domain.
