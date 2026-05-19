# OCCT API Reconnaissance — Phase A1

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-a1-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-A1-recon.json`
**Status:** ALL 13 ITEMS EMPIRICALLY VERIFIED — spec passes GREEN

All call signatures below were confirmed by executing them inside the Electron app's
WASM context and asserting on measured volumes. Copy-paste safe for A1 kernel code.

---

## Key overload-numbering surprises (read before writing kernel code)

| Type | `_N` suffix rule |
|------|-----------------|
| `gp_Pnt_1` | no-arg default. `gp_Pnt_3(x,y,z)` is the 3-double constructor. |
| `gp_Vec_1` | no-arg. `gp_Vec_4(x,y,z)` is the 3-double constructor. |
| `gp_Dir_1` | no-arg. `gp_Dir_4(x,y,z)` is the 3-double constructor. |
| `gp_Ax1_1` | no-arg. `gp_Ax1_2(pnt, dir)` is the (gp_Pnt, gp_Dir) constructor. |
| `BRepBuilderAPI_MakeFace_15` | `(wire, isPlanar)` overload. 22 total overloads exist; _15 is the wire+bool form. |
| `BRepFilletAPI_MakeFillet` | **Undecorated** (no `_N` suffix). Requires 2 args: `(shape, ChFi3d_FilletShape)`. |
| `BRepFilletAPI_MakeChamfer` | **Undecorated**. Requires 1 arg: `(shape)`. |
| Boolean algos | `_3` suffix = `(s1, s2, progressRange)` constructor; explicit `.Build(pr)` is required. |
| STEP writer Transfer | Exactly 4 args required: `(shape, modelType, doTransfer, progressRange)`. |

---

## Item 1 — Cylinder

**Verified overload:** `BRepPrimAPI_MakeCylinder_1(radius, height)`

```js
// VERIFIED — vol ≈ 942.48 for r=5, h=12 (expected π·25·12 = 942.5)
const maker = new oc.BRepPrimAPI_MakeCylinder_1(5, 12);
const shape = maker.Shape();   // TopoDS_Shape
// … use shape …
shape.delete();
maker.delete();
```

Measured volume: 942.4777960769378 mm³ (expected ≈ 942.5; Δ < 0.05)

---

## Item 2 — Sphere

**Verified overload:** `BRepPrimAPI_MakeSphere_1(radius)`

```js
// VERIFIED — vol ≈ 904.78 for r=6 (expected 4/3·π·216 = 904.8)
const maker = new oc.BRepPrimAPI_MakeSphere_1(6);
const shape = maker.Shape();
shape.delete();
maker.delete();
```

Measured volume: 904.7786842338602 mm³

---

## Item 3 — Cone

**Verified overload:** `BRepPrimAPI_MakeCone_1(r1, r2, height)`

```js
// VERIFIED — vol ≈ 653.45 for r1=6, r2=2, h=12
const maker = new oc.BRepPrimAPI_MakeCone_1(6, 2, 12);
const shape = maker.Shape();
shape.delete();
maker.delete();
```

Measured volume: 653.4512719466769 mm³ (expected ≈ 653.5; π/3·(r1²+r1·r2+r2²)·h)

---

## Item 4 — Torus

**Verified overload:** `BRepPrimAPI_MakeTorus_1(majorRadius, minorRadius)`

```js
// VERIFIED — vol ≈ 1776.53 for R=10, r=3 (expected 2·π²·R·r² = 1776.5)
const maker = new oc.BRepPrimAPI_MakeTorus_1(10, 3);
const shape = maker.Shape();
shape.delete();
maker.delete();
```

Measured volume: 1776.5287921960844 mm³

---

## Item 5 — Boolean Fuse

**Verified overload:** `BRepAlgoAPI_Fuse_3(s1, s2, progressRange)`
**Explicit `.Build(progressRange)` is required.** The constructor does NOT auto-build.

```js
// VERIFIED — two coincident 10mm boxes fused → vol ≈ 1000
const pr1 = new oc.Message_ProgressRange_1();
const algo = new oc.BRepAlgoAPI_Fuse_3(s1, s2, pr1);
pr1.delete();

const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

if (algo.IsDone()) {
  const result = algo.Shape();
  // … use result …
  result.delete();
}
algo.delete();
```

Measured volume (coincident boxes): 999.9999999999998 mm³

**`IFSelect_ReturnStatus` note:** The boolean algo `.Build()` does not return a status;
use `.IsDone()` after calling `.Build()`.

---

## Item 6 — Boolean Cut

**Verified overload:** `BRepAlgoAPI_Cut_3(s1, s2, progressRange)`
Identical pattern to Fuse.

```js
// VERIFIED — two coincident 10mm boxes cut → vol ≈ 0
const pr1 = new oc.Message_ProgressRange_1();
const algo = new oc.BRepAlgoAPI_Cut_3(s1, s2, pr1);
pr1.delete();

const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

if (algo.IsDone()) {
  const result = algo.Shape();   // may be an empty compound
  result.delete();
}
algo.delete();
```

Measured volume (coincident boxes): 0 mm³

---

## Item 7 — Boolean Common

**Verified overload:** `BRepAlgoAPI_Common_3(s1, s2, progressRange)`

```js
// VERIFIED — two coincident 10mm boxes → common vol ≈ 1000
const pr1 = new oc.Message_ProgressRange_1();
const algo = new oc.BRepAlgoAPI_Common_3(s1, s2, pr1);
pr1.delete();

const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

if (algo.IsDone()) {
  const result = algo.Shape();
  result.delete();
}
algo.delete();
```

Measured volume: 999.9999999999998 mm³

---

## Item 8 — Rectangle Face → Extrude

**Full verified call sequence:**

```js
// VERIFIED — 12×8mm rect extruded 5mm → vol = 480 mm³

// Step 1: Points — gp_Pnt_3(x, y, z)
const p0 = new oc.gp_Pnt_3(0,  0, 0);
const p1 = new oc.gp_Pnt_3(12, 0, 0);
const p2 = new oc.gp_Pnt_3(12, 8, 0);
const p3 = new oc.gp_Pnt_3(0,  8, 0);

// Step 2: Edges — BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)
const em01 = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1); const e01 = em01.Edge(); em01.delete();
const em12 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2); const e12 = em12.Edge(); em12.delete();
const em23 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3); const e23 = em23.Edge(); em23.delete();
const em30 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p0); const e30 = em30.Edge(); em30.delete();

// Step 3: Wire — BRepBuilderAPI_MakeWire_1() + .Add_1(edge)
const wm = new oc.BRepBuilderAPI_MakeWire_1();
wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
const wire = wm.Wire();
wm.delete();

// Step 4: Face — BRepBuilderAPI_MakeFace_15(wire, isPlanar)
const fm = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
const face = fm.Face();
fm.delete();

// Step 5: Extrude vec — gp_Vec_4(x, y, z)
const extVec = new oc.gp_Vec_4(0, 0, 5);  // 5mm along Z

// Step 6: Prism — BRepPrimAPI_MakePrism_1(face, vec, copy, canonize)
const prism = new oc.BRepPrimAPI_MakePrism_1(face, extVec, false, true);
const shape = prism.Shape();
prism.delete();

// Cleanup
for (const e of [e01, e12, e23, e30]) e.delete();
wire.delete(); face.delete(); extVec.delete();
p0.delete(); p1.delete(); p2.delete(); p3.delete();
```

Measured volume: 480.0 mm³ (exact)

### Key facts

| Step | Verified constructor |
|------|---------------------|
| `gp_Pnt` 3-double | `gp_Pnt_3(x, y, z)` |
| `gp_Vec` 3-double | `gp_Vec_4(x, y, z)` |
| `MakeEdge` pnt-pnt | `BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)` |
| `MakeWire` + add edge | `BRepBuilderAPI_MakeWire_1()` + `.Add_1(edge)` |
| `MakeFace` wire+planar | `BRepBuilderAPI_MakeFace_15(wire, true)` |
| `MakePrism` | `BRepPrimAPI_MakePrism_1(face, vec, copy, canonize)` |

`BRepBuilderAPI_MakeFace` has 22 overloads (`_1`…`_22`). Overload `_15` is the
`(TopoDS_Wire, isPlanar)` form. Error code 0 from `.Error()` = success (BRepBuilderAPI_FaceDone).

---

## Item 9 — Revolve

**Full verified call sequence:**

```js
// VERIFIED — innerR=4, width=3, height=10 revolved 360° → vol ≈ 1036.7 mm³
// Profile in XZ plane, rotated around Z axis

const innerR = 4, w = 3, h = 10;

// Points in XZ plane (y=0)
const rp0 = new oc.gp_Pnt_3(innerR,     0, 0);
const rp1 = new oc.gp_Pnt_3(innerR + w, 0, 0);
const rp2 = new oc.gp_Pnt_3(innerR + w, 0, h);
const rp3 = new oc.gp_Pnt_3(innerR,     0, h);

// Edges
const em01 = new oc.BRepBuilderAPI_MakeEdge_3(rp0, rp1); const re01 = em01.Edge(); em01.delete();
const em12 = new oc.BRepBuilderAPI_MakeEdge_3(rp1, rp2); const re12 = em12.Edge(); em12.delete();
const em23 = new oc.BRepBuilderAPI_MakeEdge_3(rp2, rp3); const re23 = em23.Edge(); em23.delete();
const em30 = new oc.BRepBuilderAPI_MakeEdge_3(rp3, rp0); const re30 = em30.Edge(); em30.delete();

// Wire
const rwm = new oc.BRepBuilderAPI_MakeWire_1();
rwm.Add_1(re01); rwm.Add_1(re12); rwm.Add_1(re23); rwm.Add_1(re30);
const rWire = rwm.Wire();
rwm.delete();

// Face
const rfm = new oc.BRepBuilderAPI_MakeFace_15(rWire, true);
const rFace = rfm.Face();
rfm.delete();

// Z axis — gp_Dir_4(x,y,z), gp_Ax1_2(pnt, dir)
const axisDir = new oc.gp_Dir_4(0, 0, 1);
const originPt = new oc.gp_Pnt_3(0, 0, 0);
const rotAxis = new oc.gp_Ax1_2(originPt, axisDir);

// Revolve 360° — BRepPrimAPI_MakeRevol_1(face, ax1, angleRad, copy)
const revolve = new oc.BRepPrimAPI_MakeRevol_1(rFace, rotAxis, 2 * Math.PI, false);
const shape = revolve.Shape();
revolve.delete();

// Cleanup
for (const e of [re01, re12, re23, re30]) e.delete();
rWire.delete(); rFace.delete(); axisDir.delete(); originPt.delete(); rotAxis.delete();
rp0.delete(); rp1.delete(); rp2.delete(); rp3.delete();
```

Measured volume: 1036.7255756846316 mm³ (expected π·(49−16)·10 = 1036.73; Δ < 0.001)

### Additional key facts for revolve

| Type | Verified constructor |
|------|---------------------|
| `gp_Dir` 3-double | `gp_Dir_4(x, y, z)` |
| `gp_Ax1` (pnt, dir) | `gp_Ax1_2(gp_Pnt, gp_Dir)` |
| `MakeRevol` | `BRepPrimAPI_MakeRevol_1(face, ax1, angleRad, copy)` |

Full 360° = `2 * Math.PI` radians. The copy param (4th arg) is `false` (don't copy face).

---

## Item 10 — Fillet

**Verified pattern:**

```js
// VERIFIED — all 12 edges of a 10mm box filleted r=1 → vol ≈ 975.6 (in range 900–1000)

// Constructor: undecorated BRepFilletAPI_MakeFillet (NOT _1!), 2 args
const filletObj = new oc.BRepFilletAPI_MakeFillet(
  boxShape,
  oc.ChFi3d_FilletShape.ChFi3d_Rational
);

// Walk edges and deduplicate (TopExp_Explorer visits each edge twice on a box)
const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const edgeExp = new oc.TopExp_Explorer_2(boxShape, EDGE, ANY);
const seenEdges = [];
while (edgeExp.More()) {
  const edge = oc.TopoDS.Edge_1(edgeExp.Current());
  let isDup = false;
  for (const seen of seenEdges) {
    if (seen.IsSame(edge)) { isDup = true; break; }
  }
  if (!isDup) seenEdges.push(edge);
  else edge.delete();
  edgeExp.Next();
}
edgeExp.delete();
// seenEdges.length === 12 (unique edges)

// Add with .Add_2(radius, edge) — NOT .Add_1
for (const edge of seenEdges) {
  filletObj.Add_2(1.0, edge);
}
for (const e of seenEdges) e.delete();

// Explicit Build required
const prBuild = new oc.Message_ProgressRange_1();
filletObj.Build(prBuild);
prBuild.delete();

if (filletObj.IsDone()) {
  const filletShape = filletObj.Shape();
  // volumeMM3 ≈ 975.6 (< 1000, > 900)
  filletShape.delete();
}
filletObj.delete();
```

Measured volume: 975.5870138909415 mm³

### Constructor note

`BRepFilletAPI_MakeFillet` (undecorated) = the 2-arg constructor `(TopoDS_Shape, ChFi3d_FilletShape)`.
There is NO `BRepFilletAPI_MakeFillet_1` — the binding does NOT follow the `_N` pattern here.

`ChFi3d_FilletShape` enum keys: `ChFi3d_Rational`, `ChFi3d_QuasiAngular`, `ChFi3d_Polynomial`.

`.Add_2(Standard_Real, TopoDS_Edge)` — this is the `(radius, edge)` overload.
`.Add_1(...)` has a different signature (likely `(radius, face, face)` or similar).

---

## Item 11 — Chamfer

**Verified pattern:**

```js
// VERIFIED — all 12 edges of a 10mm box chamfered d=1 → vol ≈ 945.3 (< 1000)

// Constructor: undecorated BRepFilletAPI_MakeChamfer (NOT _1!), 1 arg
const chamferObj = new oc.BRepFilletAPI_MakeChamfer(boxShape);

// Walk + deduplicate edges (same as fillet)
// … same edge-walk code as item 10 …

// Add with .Add_2(distance, edge)
for (const edge of seenEdges) {
  chamferObj.Add_2(1.0, edge);
}

// Explicit Build required
const prBuild = new oc.Message_ProgressRange_1();
chamferObj.Build(prBuild);
prBuild.delete();

if (chamferObj.IsDone()) {
  const chamferShape = chamferObj.Shape();
  // volumeMM3 ≈ 945.3 (< 1000)
  chamferShape.delete();
}
chamferObj.delete();
```

Measured volume: 945.333333333333 mm³

### Constructor note

`BRepFilletAPI_MakeChamfer` (undecorated) = 1-arg constructor `(TopoDS_Shape)`.
Same binding anomaly: no `_1` suffix.

---

## Item 12 — STEP Export

**Verified call sequence:**

```js
// VERIFIED — 10mm box round-trips through STEP; FS contains "ISO-10303-21"

// Writer
const writer = new oc.STEPControl_Writer_1();

// Model type: STEPControl_AsIs = 0
const modelType = oc.STEPControl_StepModelType.STEPControl_AsIs;

// Transfer — EXACTLY 4 args required (3-arg call throws BindingError)
const prTransfer = new oc.Message_ProgressRange_1();
const transferRet = writer.Transfer(boxShape, modelType, true, prTransfer);
prTransfer.delete();
// transferRet.value === 1 (IFSelect_RetDone)

// Write to emscripten virtual FS — use a relative filename (no leading slash also works)
const writeRet = writer.Write('myshape.step');
// writeRet.value === 1 (success)

// Read back via oc.FS (Emscripten file system)
const stepText = oc.FS.readFile('myshape.step', { encoding: 'utf8' });
// stepText is a JS string starting with "ISO-10303-21;\n..."

writer.delete();
```

Key observations:
- `STEPControl_StepModelType.STEPControl_AsIs` = 0
- `Transfer` is NOT overloaded by suffix; there is exactly one `Transfer` method and it **requires 4 arguments**. Calling with 2 or 3 args throws `BindingError`.
- `Write(filename)` returns an Embind object with `.value === 1` on success (IFSelect_RetDone = 1).
- `oc.FS.readFile(filename, {encoding:'utf8'})` returns a plain JS string. Without `{encoding:'utf8'}` it returns a `Uint8Array`.
- Emscripten FS root dirs: `/`, `/tmp`, `/home`, `/dev`, `/proc`. Relative filenames (no leading slash) also work and resolve to `/`.
- The STEP file for a 10mm box is 15,416 bytes.
- `IFSelect_ReturnStatus.IFSelect_RetDone.value === 1`.

---

## Item 13 — STEP Import

**Verified call sequence:**

```js
// VERIFIED — box STEP text round-trips through reader; vol ≈ 1000 mm³

// Write STEP text into emscripten FS
oc.FS.writeFile('myshape_import.step', stepText);

// Reader
const reader = new oc.STEPControl_Reader_1();

// ReadFile — status IFSelect_RetDone (1)
const readStatus = reader.ReadFile('myshape_import.step');
// readStatus.value === 1

// TransferRoots — requires progressRange
const prTR = new oc.Message_ProgressRange_1();
const trCount = reader.TransferRoots(prTR);
prTR.delete();
// trCount.value === 1 (number of transferred roots)

// OneShape — returns the imported shape
const importedShape = reader.OneShape();
// importedShape is a TopoDS_Shape with vol ≈ 1000 mm³

importedShape.delete();
reader.delete();
```

Measured round-trip volume: 999.9999999999998 mm³

---

## Constructor Overload Quick-Reference

| Class | Working constructor | Notes |
|-------|--------------------|-|
| `gp_Pnt` | `gp_Pnt_3(x, y, z)` | `_1` = no-arg, `_2` = gp_XYZ |
| `gp_Vec` | `gp_Vec_4(x, y, z)` | `_1` = no-arg, `_2` = gp_Dir, `_3` = gp_XYZ |
| `gp_Dir` | `gp_Dir_4(x, y, z)` | `_1` = no-arg, `_2` = gp_Vec, `_3` = gp_XYZ |
| `gp_Ax1` | `gp_Ax1_2(gp_Pnt, gp_Dir)` | `_1` = no-arg |
| `BRepBuilderAPI_MakeEdge` | `_3(gp_Pnt, gp_Pnt)` | 12+ overloads |
| `BRepBuilderAPI_MakeWire` | `_1()` + `.Add_1(edge)` | `.Add_2` = add wire, `.Add_3` = add compound |
| `BRepBuilderAPI_MakeFace` | `_15(wire, isPlanar)` | 22 overloads; _15 = TopoDS_Wire+bool |
| `BRepPrimAPI_MakeBox` | `_2(dx, dy, dz)` | A0 verified |
| `BRepPrimAPI_MakeCylinder` | `_1(r, h)` | `_2` = partial angle `(r, h, angle)` |
| `BRepPrimAPI_MakeSphere` | `_1(r)` | `_2` = partial angle; etc. |
| `BRepPrimAPI_MakeCone` | `_1(r1, r2, h)` | `_2` = with angle |
| `BRepPrimAPI_MakeTorus` | `_1(R, r)` | `_2` = partial angle |
| `BRepPrimAPI_MakePrism` | `_1(face, vec, copy, canonize)` | copy=false, canonize=true typical |
| `BRepPrimAPI_MakeRevol` | `_1(face, ax1, angle, copy)` | copy=false typical |
| `BRepAlgoAPI_Fuse` | `_3(s1, s2, pr)` | explicit `.Build(pr)` required |
| `BRepAlgoAPI_Cut` | `_3(s1, s2, pr)` | explicit `.Build(pr)` required |
| `BRepAlgoAPI_Common` | `_3(s1, s2, pr)` | explicit `.Build(pr)` required |
| `BRepFilletAPI_MakeFillet` | **undecorated**`(shape, ChFi3d_FilletShape)` | `.Add_2(r, edge)` |
| `BRepFilletAPI_MakeChamfer` | **undecorated**`(shape)` | `.Add_2(d, edge)` |
| `STEPControl_Writer` | `_1()` | `.Transfer(s,mt,true,pr)` exactly 4 args |
| `STEPControl_Reader` | `_1()` | `.ReadFile(name)` + `.TransferRoots(pr)` + `.OneShape()` |
| `TopExp_Explorer` | `_2(shape, toFind, toAvoid)` | A0 verified |
| `GProp_GProps` | `_1()` | A0 verified |
| `BRepMesh_IncrementalMesh` | `_2(shape, linDef, isRel, angDef, isParallel)` | A0 verified |
| `Message_ProgressRange` | `_1()` | no-arg; pass to Build/Transfer |

---

## Volume Cross-Check

| Shape | Dimensions | Expected (mm³) | Measured (mm³) |
|-------|-----------|---------------|----------------|
| Cylinder | r=5, h=12 | 942.48 | 942.478 |
| Sphere | r=6 | 904.78 | 904.779 |
| Cone | r1=6,r2=2,h=12 | 653.45 | 653.451 |
| Torus | R=10, r=3 | 1776.53 | 1776.529 |
| Fuse (coincident boxes) | 10×10×10 | 1000 | 1000.000 |
| Cut (coincident boxes) | 10×10×10 | 0 | 0 |
| Common (coincident boxes) | 10×10×10 | 1000 | 1000.000 |
| Extrude (12×8 rect, 5mm) | — | 480 | 480.000 |
| Revolve (annulus r4–7,h10) | — | 1036.73 | 1036.726 |
| Fillet (box r=1) | 10×10×10 | <1000,>900 | 975.587 |
| Chamfer (box d=1) | 10×10×10 | <1000 | 945.333 |
| STEP round-trip | 10×10×10 | 1000 | 1000.000 |
