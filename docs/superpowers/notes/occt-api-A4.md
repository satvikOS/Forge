# OCCT API Reconnaissance — Phase A4

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-a4-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-A4-recon.json`
**Status:** ALL ITEMS EMPIRICALLY VERIFIED — spec passes GREEN (1 passed, 15.9s)

---

## Summary

| Item | Status | Key Call |
|------|--------|---------|
| 1. Fused two-box bar (seam input) | **CONFIRMED** | `BRepAlgoAPI_Fuse_3(a,b,pr)` + `.Build(pr)` + `.Shape()` |
| 2. ShapeUpgrade_UnifySameDomain | **CONFIRMED** | `_2(shape, true, true, false)` + `.Build()` + `.Shape()` |
| 3. ShapeFix_Shape (optional) | **CONFIRMED** | `ShapeFix_Shape_2(shape)` + `.Perform(pr)` + `.Shape()` |

**Key finding for Task 4 e2e assertions:** The fuse operation RETAINS the internal seam
(10 faces / 20 unique edges for two abutting 20mm boxes). `ShapeUpgrade_UnifySameDomain`
then cleanly reduces the result to exactly 6 faces / 12 edges — a perfect clean box.
Volume is preserved to floating-point precision (≈16000 mm³ before and after).

---

## Item 1 — Fused Two-Box Bar with Internal Seam (CONFIRMED)

**Geometry:** Box A = `MakeBox_2(20,20,20)` at origin; Box B = same box translated by `(20,0,0)`
so it abuts A face-to-face (forming a 40×20×20 bar when fused).

**Fuse operation:** `BRepAlgoAPI_Fuse_3(a, b, pr)` + `.Build(pr)` + `.Shape()`
(same overload as Boolean Common A3, verified there as pattern.)

```js
// VERIFIED — Build two abutting boxes and fuse them
// Result: a 40×20×20 bar with RETAINED internal seam (10 faces, 20 unique edges)

// Box A at origin
const boxAMaker = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
const boxA = boxAMaker.Shape();
boxAMaker.delete();

// Box B at (20,0,0) — abuts A exactly face-to-face
const boxBRaw = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
const boxBRawShape = boxBRaw.Shape();
boxBRaw.delete();
const trsf = new oc.gp_Trsf_1();
const vec  = new oc.gp_Vec_4(20, 0, 0);
trsf.SetTranslation_1(vec);
vec.delete();
const xform = new oc.BRepBuilderAPI_Transform_2(boxBRawShape, trsf, false);
const boxB = xform.Shape();
xform.delete();
trsf.delete();
boxBRawShape.delete();

// Fuse A + B
const pr1 = new oc.Message_ProgressRange_1();
const fuseAlgo = new oc.BRepAlgoAPI_Fuse_3(boxA, boxB, pr1);
pr1.delete();
const prBuild = new oc.Message_ProgressRange_1();
fuseAlgo.Build(prBuild);
prBuild.delete();
const fusedBar = fuseAlgo.Shape();
fuseAlgo.delete();

// Measure volume
const props = new oc.GProp_GProps_1();
oc.BRepGProp.VolumeProperties_1(fusedBar, props, false, false, false);
const fusedVolume = props.Mass();  // ≈ 16000 mm³
props.delete();

// Count faces (using TopExp_Explorer_2 — verified A0)
// Fused bar retains internal seam → 10 faces (not 6)
const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
let faceCount = 0;
const faceExp = new oc.TopExp_Explorer_2(fusedBar, FACE, ANY);
for (; faceExp.More(); faceExp.Next()) {
  const f = oc.TopoDS.Face_1(faceExp.Current());
  faceCount++;
  f.delete();
}
faceExp.delete();
// faceCount === 10  (seam retained — internal contact face visible in B-rep)

// Count UNIQUE edges (dedup via IsSame — verified A0)
const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
const edges = [];
const edgeExp = new oc.TopExp_Explorer_2(fusedBar, EDGE, ANY);
for (; edgeExp.More(); edgeExp.Next()) {
  const e = edgeExp.Current();
  let found = false;
  for (const prev of edges) {
    if (prev.IsSame(e)) { found = true; break; }
  }
  if (!found) {
    const edgeCopy = oc.TopoDS.Edge_1(e);
    edges.push(edgeCopy);
  }
}
edgeExp.delete();
const edgeCount = edges.length;  // 20 unique edges (seam retained)
for (const e of edges) e.delete();

// Cleanup
fusedBar.delete();   // (normally pass to item 2 — delete when done)
boxA.delete();
boxB.delete();
```

### Measured values for fused 40×20×20 bar

| Metric | Observed | Notes |
|--------|----------|-------|
| Volume | 15999.999999999995 mm³ | ≈ 16000 ✓ |
| Face count | **10** | Seam RETAINED (not 6) |
| Unique edge count | **20** | Seam RETAINED (not 12) |

**Seam retention means:** `BRepAlgoAPI_Fuse_3` does NOT automatically merge coplanar
faces from the two input boxes. The internal contact face and its edges remain in the
B-rep. This is the correct/expected OCCT behavior — simplification must be applied
explicitly via `ShapeUpgrade_UnifySameDomain`.

---

## Item 2 — ShapeUpgrade_UnifySameDomain (CONFIRMED)

**Verified:** `new oc.ShapeUpgrade_UnifySameDomain_2(shape, unifyEdges, unifyFaces, concatBSplines)`
is the working constructor (4-arg form). The suffix convention in this build:

| Suffix | Constructor signature |
|--------|-----------------------|
| `_1`   | `(shape)` — 1-arg (also available) |
| `_2`   | `(shape, unifyEdges, unifyFaces, concatBSplines)` — 4-arg (use this) |
| undecorated | `(shape, unifyEdges, unifyFaces, concatBSplines)` — same as `_2` |

Use `_2` with `(shape, true, true, false)` — unify edges, unify faces, do NOT concat B-splines.

```js
// VERIFIED — ShapeUpgrade_UnifySameDomain on the fused bar
// Reduces 10 faces / 20 edges → 6 faces / 12 edges; volume preserved

// fusedBar is the TopoDS_Shape from item 1 (10 faces, 20 edges, vol≈16000)

// Step 1: Construct
// ShapeUpgrade_UnifySameDomain_2(shape, unifyEdges, unifyFaces, concatBSplines)
const unify = new oc.ShapeUpgrade_UnifySameDomain_2(fusedBar, true, true, false);

// Step 2: Build (no-arg — does NOT take a progress range)
unify.Build();

// Step 3: Read result
const simplifiedShape = unify.Shape();
unify.delete();

// Step 4: Measure simplified shape
const props2 = new oc.GProp_GProps_1();
oc.BRepGProp.VolumeProperties_1(simplifiedShape, props2, false, false, false);
const simplifiedVolume = props2.Mass();  // ≈ 16000 mm³ (preserved)
props2.delete();

// Face count
let simplifiedFaces = 0;
const faceExp2 = new oc.TopExp_Explorer_2(simplifiedShape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
for (; faceExp2.More(); faceExp2.Next()) {
  const f = oc.TopoDS.Face_1(faceExp2.Current());
  simplifiedFaces++;
  f.delete();
}
faceExp2.delete();
// simplifiedFaces === 6  (clean box — seam removed)

// Unique edge count (same dedup pattern as above)
// simplifiedEdgeCount === 12  (clean box — seam edges removed)

simplifiedShape.delete();
```

### Before vs After — Fused Bar Simplification

| Metric | Before (fused bar) | After (simplified) | Delta |
|--------|-------------------|--------------------|-------|
| Volume (mm³) | 15999.999999999995 | 15999.999999999996 | ~0 ✓ |
| Face count | **10** | **6** | −4 ✓ |
| Unique edge count | **20** | **12** | −8 ✓ |

**Result:** `ShapeUpgrade_UnifySameDomain_2` with `(shape, true, true, false)` perfectly
simplifies the fused two-box bar to a clean 6-face / 12-edge box. Volume is preserved
to floating-point precision. This is the expected "seam removal" behavior.

### Method inventory on `ShapeUpgrade_UnifySameDomain_2` instance

All callable methods (from prototype introspection):

```
AllowInternalEdges, Build, DecrementRefCounter, Delete, DynamicType,
GetRefCount, History_1, History_2, IncrementRefCounter, Initialize,
IsInstance_1, IsInstance_2, IsKind_1, IsKind_2, KeepShape, KeepShapes,
SetAngularTolerance, SetLinearTolerance, SetSafeInputMode, Shape,
This, clone, deleteLater, isAliasOf
```

Notable methods for production use:
- `Initialize(shape, unifyEdges, unifyFaces, concatBSplines)` — re-initialize on new shape
- `Build()` — compute (no-arg, no progress range)
- `Shape()` — read result
- `SetAngularTolerance(val)` — tune angular tolerance for face merging
- `SetLinearTolerance(val)` — tune linear tolerance for edge merging
- `KeepShape(shape)` / `KeepShapes(list)` — prevent specific sub-shapes from being merged
- `AllowInternalEdges(bool)` — whether to allow internal edges in result
- `History_1()` / `History_2()` — topology change history for downstream mapping

---

## Item 3 — ShapeFix_Shape (CONFIRMED, Optional)

**Verified:** `ShapeFix_Shape_2(shape)` is constructible and `Perform(pr)` + `Shape()` work.

```js
// VERIFIED — ShapeFix_Shape_2 + Perform(pr) + Shape()
// Use for repairing bad geometry (tolerances, PCurves, etc.)

const sf = new oc.ShapeFix_Shape_2(shape);

// Perform requires 1 arg — a progress range (NOT no-arg)
const pr = new oc.Message_ProgressRange_1();
sf.Perform(pr);
pr.delete();

const fixedShape = sf.Shape();
sf.delete();
// fixedShape is the repaired shape
fixedShape.delete();
```

**Key fact:** `ShapeFix_Shape.Perform()` (no-arg) fails with:
`"function ShapeFix_Shape.Perform called with 0 arguments, expected 1 args!"`
Always pass a `Message_ProgressRange_1` as the argument.

**Note:** `ShapeFix_Shape` is useful for repairing tolerances and PCurves on imported
geometry. For clean B-rep simplification (seam removal), use `ShapeUpgrade_UnifySameDomain`
(item 2) instead — it is the correct tool for that purpose.

### ShapeFix_Shape method inventory

Available methods on instance:
```
Context, FixEdgeTool, FixFaceTool, FixFreeFaceMode, FixFreeShellMode,
FixFreeWireMode, FixSameParameterMode, FixShellTool, FixSolidMode,
FixSolidTool, FixVertexPositionMode, FixVertexTolMode, FixWireTool,
Init, LimitTolerance, MaxTolerance, MinTolerance, MsgRegistrator,
Perform, Precision, SendFail_1
```

---

## Constructor Quick-Reference (A4 additions)

| Class | Working constructor | Notes |
|-------|--------------------|-|
| `BRepAlgoAPI_Fuse` | `BRepAlgoAPI_Fuse_3(shapeA, shapeB, pr)` | Same pattern as `BRepAlgoAPI_Common_3`; use `_3` (A3 verified) |
| `ShapeUpgrade_UnifySameDomain` | `ShapeUpgrade_UnifySameDomain_2(shape, unifyEdges, unifyFaces, concatBSplines)` | `_1` = (shape) 1-arg; `_2` = 4-arg (use this with `true, true, false`) |
| `ShapeFix_Shape` | `ShapeFix_Shape_2(shape)` | `_1` = no-arg; `_2` = (shape); Perform takes 1 arg (ProgressRange) |

---

## E2E Assertion Implications for Task 4

Since the fused bar **retains** the seam (10 faces, 20 edges), and `ShapeUpgrade_UnifySameDomain`
cleanly removes it (→ 6 faces, 12 edges), production assertions in Task 4 should:

1. After `BRepAlgoAPI_Fuse_3` on two abutting boxes: `expect(faceCount).toBeGreaterThan(6)` — seam is present
2. After `ShapeUpgrade_UnifySameDomain_2` simplification: `expect(faceCount).toBe(6)` — seam removed
3. Volume invariant: within ±0.01% (floating-point rounding, not geometry error)

The simplification is deterministic — always produces exactly 6 faces / 12 edges for
two abutting co-planar rectangular boxes.

---

## Available ShapeUpgrade Classes in `opencascade.js@2.0.0-beta.b5ff984`

Discovered during Item 2 introspection (first 30):

```
ShapeUpgrade_SplitCurve3dContinuity, ShapeUpgrade_Tool,
ShapeUpgrade_ConvertSurfaceToBezierBasis, ShapeUpgrade_SplitCurve3d,
ShapeUpgrade_UnifySameDomain, ShapeUpgrade_UnifySameDomain_1,
ShapeUpgrade_UnifySameDomain_2, ShapeUpgrade_ConvertCurve3dToBezier,
ShapeUpgrade_RemoveLocations, ShapeUpgrade_EdgeDivide,
ShapeUpgrade_RemoveInternalWires, ShapeUpgrade_RemoveInternalWires_1,
ShapeUpgrade_RemoveInternalWires_2, ShapeUpgrade_ConvertCurve2dToBezier,
ShapeUpgrade_ShapeDivideClosedEdges, ShapeUpgrade_ShapeConvertToBezier,
ShapeUpgrade_ShapeConvertToBezier_1, ShapeUpgrade_ShapeConvertToBezier_2,
ShapeUpgrade_FaceDivideArea, ShapeUpgrade_FaceDivideArea_1,
ShapeUpgrade_FaceDivideArea_2, ShapeUpgrade_ShellSewing,
ShapeUpgrade_WireDivide, ShapeUpgrade_SplitSurfaceArea,
ShapeUpgrade_ShapeDivideAngle, ShapeUpgrade_ShapeDivideAngle_1,
ShapeUpgrade_ShapeDivideAngle_2, ShapeUpgrade_SplitSurface,
ShapeUpgrade_FixSmallBezierCurves, ShapeUpgrade
```

`ShapeUpgrade_UnifySameDomain` is the correct class for coplanar-face/same-domain-edge
merging. The others are for different operations (B-spline conversion, area subdivision,
angular subdivision, internal-wire removal, etc.).
