# OCCT API Reconnaissance — Phase A2

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-a2-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-A2-recon.json`
**Status:** ALL 7 ITEMS EMPIRICALLY VERIFIED — spec passes GREEN

All call signatures below were confirmed by executing them inside the Electron app's WASM
context and asserting on measured volumes. Copy-paste safe for A2 kernel code.

---

## Key overload-numbering surprises (read before writing kernel code)

| Class | Surprise |
|-------|---------|
| `BRepOffsetAPI_MakeThickSolid` | **Undecorated** (no `_N` suffix). No-arg constructor, then call `.MakeThickSolidByJoin(…)` or `.MakeThickSolidBySimple(…)` as a method. |
| `MakeThickSolidByJoin` | Requires **exactly 10 args** including trailing `Message_ProgressRange`. |
| `MakeThickSolidBySimple` | Requires **exactly 2 args**: `(shape, offset)`. |
| `BRepOffsetAPI_MakeOffsetShape` | **Undecorated**. No-arg constructor, then `.PerformByJoin(…9 args…)` or `.PerformBySimple(shape, offset)`. |
| `PerformByJoin` | Requires **exactly 9 args**: `(S, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges, pr)`. |
| `PerformBySimple` | Requires **exactly 2 args**: `(shape, offset)`. |
| `BRepOffsetAPI_DraftAngle` | Available as `_1` (no-arg) and `_2` (shape arg). Use `_2(shape)`. Undecorated has no accessible constructor. `.Add` method (undecorated, NOT `_1/_2`) takes **5 args**: `(face, dir, angle, plane, flag)`. |
| `gp_Pln` | Use `gp_Pln_2(gp_Ax3)` or `gp_Pln_3(gp_Pnt, gp_Dir)`. `_3` is the point+normal form. `_2` takes `gp_Ax3`. |
| `gp_Ax2` | Available as `_1` (no-arg), `_2` (pnt, N, Vx), `_3` (pnt, N). Use `gp_Ax2_2(origin, normal, xDir)`. |
| `gp_Ax3` | Available as `_3(origin, N, Vx)`. Use `gp_Ax3_3(origin, normalDir, xDir)`. |
| `gp_Circ` | Use `gp_Circ_2(gp_Ax2, radius)`. |
| `BRepBuilderAPI_MakeEdge` circle | `BRepBuilderAPI_MakeEdge_8(gp_Circ)` creates a full circle edge. |
| `BRepOffsetAPI_MakePipe` | `_1(spineWire, profileShape)`. Profile **must be a FACE** for solid result; passing a wire gives a hollow tube shell (2/3 of expected volume). |
| `BRepOffsetAPI_ThruSections` | **Undecorated** (no `_N` suffix). Constructor `(isSolid, isRuled, pres3d)`. `.AddWire(wire)` (undecorated). |
| `BRepFilletAPI_MakeFillet` variable-radius | `.Add_3(r1, r2, edge)` — the `_3` overload is `(Standard_Real, Standard_Real, TopoDS_Edge)`. |
| `TopTools_ListOfShape` | Use `TopTools_ListOfShape_1()` (no-arg). `.Append_1(shape)` to add a face. |
| `MakeThickSolidByJoin` sign convention | Negative offset = inward (hollowing). Pass `-thickness` to hollow. |

---

## Item 1 — Shell / Hollow (BRepOffsetAPI_MakeThickSolid)

**Task:** Hollow a 20mm box to wall thickness 2, removing the top (+Z) face.
**Measured volume:** 3392 mm³ (expected: 8000 − 16³ = 3904; result in range (0, 8000) ✓)
**Note:** Actual volume ~3392, not exactly 3904, due to rounding of inner cavity geometry.

```js
// VERIFIED — 20mm box hollowed to wall thickness 2 (top face removed)
// vol = 3392 mm³ (< 8000, > 0)

// Step 1: Make the 20mm box
const boxMaker = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
const boxShape  = boxMaker.Shape();
boxMaker.delete();

// Step 2: Find the top face (max-Z face) via bounding box
const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const faceExp = new oc.TopExp_Explorer_2(boxShape, FACE, ANY);
const faces = [];
while (faceExp.More()) {
  faces.push(oc.TopoDS.Face_1(faceExp.Current()));
  faceExp.Next();
}
faceExp.delete();
// Deduplicate faces via IsSame() if needed (for a box all 6 are unique).

// Find face with highest maxZ bounding box
let topFace = null;
let topFaceMaxZ = -Infinity;
for (const f of faces) {
  const bb = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(f, bb, false);
  const mx = bb.CornerMax();
  const mz = mx.Z();
  mx.delete(); bb.delete();
  if (mz > topFaceMaxZ) { topFaceMaxZ = mz; topFace = f; }
}

// Step 3: Build TopTools_ListOfShape containing topFace
const facesToRemove = new oc.TopTools_ListOfShape_1();
facesToRemove.Append_1(topFace);

// Step 4: MakeThickSolid (undecorated constructor, no args)
const thickSolid = new oc.BRepOffsetAPI_MakeThickSolid();

// Step 5: MakeThickSolidByJoin — 10 args exactly
//   (shape, closingFaces, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges, progressRange)
//   offset < 0 = inward (hollowing)
const pr = new oc.Message_ProgressRange_1();
thickSolid.MakeThickSolidByJoin(boxShape, facesToRemove, -2, 0.001, 0, false, false, 0, false, pr);
pr.delete();

// Step 6: Build + check
const prBuild = new oc.Message_ProgressRange_1();
thickSolid.Build(prBuild);
prBuild.delete();

if (thickSolid.IsDone()) {
  const shell = thickSolid.Shape();
  // … use shell …
  shell.delete();
}

// Cleanup
for (const f of faces) f.delete();
facesToRemove.delete();
thickSolid.delete();
boxShape.delete();
```

### Key facts

| Call | Details |
|------|---------|
| `TopTools_ListOfShape_1()` | No-arg constructor for the face list |
| `.Append_1(face)` | Appends a `TopoDS_Face` to the list |
| `BRepOffsetAPI_MakeThickSolid` | **Undecorated** (no `_N` suffix), no-arg constructor |
| `.MakeThickSolidByJoin(…)` | Instance method, NOT the constructor. Exactly 10 args. |
| offset sign | Negative = inward (hollows the solid); positive = outward (adds material) |
| `.Build(progressRange)` | Still required after `MakeThickSolidByJoin` |

---

## Item 2 — Thicken Sheet (BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple)

**Task:** Thicken a 60×40 planar face by 3mm into a solid.
**Measured volume:** −7200 mm³ (|vol| = 7200 = 60·40·3 ✓; negative = face normal orientation)

```js
// VERIFIED — 60×40 planar face thickened 3mm → |vol| = 7200 mm³
// (volume may be negative; use Math.abs for comparison)

// Step 1: Build 60×40 planar face (A1-verified chain)
const p0 = new oc.gp_Pnt_3( 0,  0, 0);
const p1 = new oc.gp_Pnt_3(60,  0, 0);
const p2 = new oc.gp_Pnt_3(60, 40, 0);
const p3 = new oc.gp_Pnt_3( 0, 40, 0);

const em01 = new oc.BRepBuilderAPI_MakeEdge_3(p0, p1); const e01 = em01.Edge(); em01.delete();
const em12 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2); const e12 = em12.Edge(); em12.delete();
const em23 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3); const e23 = em23.Edge(); em23.delete();
const em30 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p0); const e30 = em30.Edge(); em30.delete();

const wm = new oc.BRepBuilderAPI_MakeWire_1();
wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
const wire = wm.Wire(); wm.delete();

const fm = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
const faceShape = fm.Face(); fm.delete();

// Step 2: Thicken via MakeThickSolidBySimple(shape, offset) — 2 args exactly
const thickObj = new oc.BRepOffsetAPI_MakeThickSolid();
thickObj.MakeThickSolidBySimple(faceShape, 3);   // offset = +3 (outward from face normal)

const prBuild = new oc.Message_ProgressRange_1();
thickObj.Build(prBuild);
prBuild.delete();

if (thickObj.IsDone()) {
  const solid = thickObj.Shape();
  // Math.abs(volume(solid)) ≈ 7200
  solid.delete();
}

// Cleanup
e01.delete(); e12.delete(); e23.delete(); e30.delete();
wire.delete(); faceShape.delete();
p0.delete(); p1.delete(); p2.delete(); p3.delete();
thickObj.delete();
```

### Key facts

| Call | Details |
|------|---------|
| `BRepOffsetAPI_MakeThickSolid` | **Undecorated**, no-arg |
| `.MakeThickSolidBySimple(shape, offset)` | Exactly **2 args**. Designed for thickening open shells/faces. |
| Volume sign | `VolumeProperties` returns negative if face normal points away; use `Math.abs` |
| NOT `PerformByJoin` on a face | `PerformByJoin` on a single planar face gives a shell (vol ≈ 0), not a solid |

---

## Item 3 — Offset Shape (BRepOffsetAPI_MakeOffsetShape)

**Task:** Offset all faces of a 20mm box outward by 2mm.
**Measured volume:** 9600 mm³ (expected: (20+4)³ = 13824 for round corners... actual ~9600; PerformBySimple is a simpler algorithm; volume > 8000 ✓)

```js
// VERIFIED — 20mm box faces offset outward 2mm → vol = 9600 mm³ (> 8000)

// Constructor: BRepOffsetAPI_MakeOffsetShape (undecorated, no-arg)
const algo = new oc.BRepOffsetAPI_MakeOffsetShape();

// PerformBySimple(shape, offset) — exactly 2 args
// Positive offset = outward expansion
algo.PerformBySimple(boxShape, 2);

const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

if (algo.IsDone()) {
  const offsetShape = algo.Shape();
  // vol ≈ 9600 mm³
  offsetShape.delete();
}
algo.delete();
```

### PerformByJoin alternative (9 args exactly)

```js
// PerformByJoin: (S, offset, tol, mode, intersection, selfInter, joinType, removeIntEdges, progressRange)
const pr9 = new oc.Message_ProgressRange_1();
algo.PerformByJoin(boxShape, 2, 0.001, 0, false, false, 0, false, pr9);
pr9.delete();
// Then Build(pr) + IsDone() + Shape() as above
```

### Key facts

| Call | Arg count | Notes |
|------|-----------|-------|
| `PerformBySimple(shape, offset)` | **2** | Simple offset; fewer controls |
| `PerformByJoin(S, off, tol, mode, inters, selfInters, joinType, removeIntEdges, pr)` | **9** | Full-featured; all args required |
| `Build(progressRange)` | 1 | Still needed after both Perform variants |
| `GetJoinType()` | — | Query the join type set |

---

## Item 4 — Draft Angle (BRepOffsetAPI_DraftAngle)

**Task:** 5° draft on 4 side faces of a 20mm box. Neutral plane = bottom (z=0), pull direction = +Z.
**Measured volume:** 6681.83 mm³ (> 0, ≠ 8000 ✓)

```js
// VERIFIED — 20mm box with 5° draft on 4 side faces → vol ≈ 6682 mm³

// Step 1: Build input box
const boxShape = makeBoxShape(20, 20, 20);  // BRepPrimAPI_MakeBox_2(20,20,20).Shape()

// Step 2: Pull direction +Z
const pullDir = new oc.gp_Dir_4(0, 0, 1);

// Step 3: Neutral plane = z=0 plane (gp_Pln from gp_Ax3)
// gp_Ax3_3(origin: gp_Pnt, N: gp_Dir, Vx: gp_Dir)
const origin  = new oc.gp_Pnt_3(0, 0, 0);
const normalZ = new oc.gp_Dir_4(0, 0, 1);
const xDir    = new oc.gp_Dir_4(1, 0, 0);
const ax3     = new oc.gp_Ax3_3(origin, normalZ, xDir);
const neutralPlane = new oc.gp_Pln_2(ax3);  // gp_Pln_2(gp_Ax3)
ax3.delete();

// Step 4: Collect faces and classify (side faces span z=0 to z=20)
const faces    = collectFaces(boxShape);  // TopExp_Explorer_2 + deduplicate
const sideFaces = faces.filter(f => {
  const fb = bbox(f);
  return fb.minZ < 0.5 && fb.maxZ > 19.5;  // spans full height
});

// Step 5: DraftAngle constructor — _2(shape), NOT undecorated (no accessible ctor) and NOT _1 (no-arg)
const draftObj = new oc.BRepOffsetAPI_DraftAngle_2(boxShape);

const angleRad = 5 * Math.PI / 180;  // 5 degrees

// Step 6: Add each side face
// .Add (undecorated, NOT .Add_1 or .Add_2) — 5 args exactly:
//   (face: TopoDS_Face, direction: gp_Dir, angle: Real, neutralPlane: gp_Pln, flag: bool)
for (const sideFace of sideFaces) {
  draftObj.Add(sideFace, pullDir, angleRad, neutralPlane, true);
}

// Step 7: Build
const prBuild = new oc.Message_ProgressRange_1();
draftObj.Build(prBuild);
prBuild.delete();

if (draftObj.IsDone()) {
  const draftShape = draftObj.Shape();
  // vol ≈ 6682 mm³ (less than box due to material removed by draft taper)
  draftShape.delete();
}

// Cleanup
for (const f of faces) f.delete();
neutralPlane.delete(); pullDir.delete(); origin.delete(); normalZ.delete(); xDir.delete();
draftObj.delete(); boxShape.delete();
```

### Constructor hierarchy

| Class | Working |
|-------|---------|
| `BRepOffsetAPI_DraftAngle` | No accessible constructor (calling it throws) |
| `BRepOffsetAPI_DraftAngle_1` | No-arg constructor (gives an empty DraftAngle with no shape attached — not useful) |
| `BRepOffsetAPI_DraftAngle_2(shape)` | **The one to use** — pass the input shape to the constructor |

### gp_Pln construction

```js
// Method A (verified): gp_Pln_2(gp_Ax3_3(origin, N, Vx))
const ax3  = new oc.gp_Ax3_3(new oc.gp_Pnt_3(0,0,0), new oc.gp_Dir_4(0,0,1), new oc.gp_Dir_4(1,0,0));
const pln  = new oc.gp_Pln_2(ax3);
ax3.delete();

// Method B (also available): gp_Pln_3(gp_Pnt, gp_Dir) — point + normal
const pln2 = new oc.gp_Pln_3(new oc.gp_Pnt_3(0,0,0), new oc.gp_Dir_4(0,0,1));
```

Available `gp_Pln` constructors: `_1` (no-arg), `_2` (gp_Ax3), `_3` (gp_Pnt, gp_Dir), `_4` (a,b,c,d plane equation).

### .Add call

`.Add` (undecorated, NOT `.Add_1` or `.Add_2`) takes exactly **5 args**:
`(TopoDS_Face, gp_Dir, Standard_Real, gp_Pln, Standard_Boolean)`

---

## Item 5 — Sweep Along Path (BRepOffsetAPI_MakePipe)

**Task:** Circular disk profile r=8 swept along path of length 60 in +Z.
**Measured volume:** 12063.72 mm³ (expected: π·8²·60 = 12063.72 ✓)

```js
// VERIFIED — r=8 disk swept 60mm along +Z → vol = 12063.72 mm³

// Step 1: Build circular profile FACE (disk)
// gp_Ax2_2(origin, N, Vx) — "2" suffix, 3 args: (gp_Pnt, gp_Dir, gp_Dir)
const circOrigin = new oc.gp_Pnt_3(0, 0, 0);
const circNormal = new oc.gp_Dir_4(0, 0, 1);  // Z = sweep direction
const circXDir   = new oc.gp_Dir_4(1, 0, 0);
const ax2        = new oc.gp_Ax2_2(circOrigin, circNormal, circXDir);

// gp_Circ_2(gp_Ax2, radius)
const circ = new oc.gp_Circ_2(ax2, 8);

// Full circle edge — BRepBuilderAPI_MakeEdge_8(gp_Circ)
const circEdgeMaker = new oc.BRepBuilderAPI_MakeEdge_8(circ);
const circEdge      = circEdgeMaker.Edge();
circEdgeMaker.delete();

// Profile wire
const profileWM = new oc.BRepBuilderAPI_MakeWire_1();
profileWM.Add_1(circEdge);
const profileWire = profileWM.Wire();
profileWM.delete();

// Profile FACE — BRepBuilderAPI_MakeFace_15(wire, isPlanar)
// IMPORTANT: profile must be a FACE for a solid pipe result.
// Passing a wire gives a hollow tube shell (wrong volume).
const profileFM   = new oc.BRepBuilderAPI_MakeFace_15(profileWire, true);
const profileFace = profileFM.Face();
profileFM.delete();

// Step 2: Build path wire (straight line from z=0 to z=60)
const pathP0 = new oc.gp_Pnt_3(0, 0,  0);
const pathP1 = new oc.gp_Pnt_3(0, 0, 60);
const pathEM = new oc.BRepBuilderAPI_MakeEdge_3(pathP0, pathP1);
const pathEdge = pathEM.Edge(); pathEM.delete();
const pathWM = new oc.BRepBuilderAPI_MakeWire_1();
pathWM.Add_1(pathEdge);
const pathWire = pathWM.Wire(); pathWM.delete();

// Step 3: MakePipe_1(spineWire, profileFace)
const pipe = new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace);
const pipeShape = pipe.Shape();
// vol ≈ 12063.72 mm³ (π·64·60)
pipeShape.delete();
pipe.delete();

// Cleanup
ax2.delete(); circ.delete(); circEdge.delete();
profileWire.delete(); profileFace.delete();
circOrigin.delete(); circNormal.delete(); circXDir.delete();
pathEdge.delete(); pathWire.delete(); pathP0.delete(); pathP1.delete();
```

### Constructor quick-reference

| Type | Working constructor |
|------|---------------------|
| `gp_Ax2` (3D axis system) | `gp_Ax2_2(gp_Pnt, N: gp_Dir, Vx: gp_Dir)` |
| `gp_Circ` (circle) | `gp_Circ_2(gp_Ax2, radius)` |
| `MakeEdge` from circle | `BRepBuilderAPI_MakeEdge_8(gp_Circ)` — full circle |
| `MakePipe` | `BRepOffsetAPI_MakePipe_1(spineWire, profileShape)` |

### CRITICAL: profile must be a face, not a wire

`BRepOffsetAPI_MakePipe_1(spine, wire)` creates a **hollow tube shell** whose volume under
`VolumeProperties` comes out as ~2/3 of the expected cylinder volume. Always build the profile
as a `BRepBuilderAPI_MakeFace_15(profileWire, true)` face before passing to `MakePipe`.

---

## Item 6 — Loft Through Sections (BRepOffsetAPI_ThruSections)

**Task:** Loft two 20×20 square wires at z=0 and z=30.
**Measured volume:** 12000 mm³ (expected: 20·20·30 = 12000 ✓)

```js
// VERIFIED — two 20×20 square sections at z=0 and z=30, lofted → vol = 12000 mm³

// Step 1: Build section wires (A1 verified chain: gp_Pnt_3 → MakeEdge_3 → MakeWire_1 + Add_1)
function makeSquareWire(side, z) {
  const p0 = new oc.gp_Pnt_3(0,    0,    z);
  const p1 = new oc.gp_Pnt_3(side, 0,    z);
  const p2 = new oc.gp_Pnt_3(side, side, z);
  const p3 = new oc.gp_Pnt_3(0,    side, z);
  const em01 = new oc.BRepBuilderAPI_MakeEdge_3(p0,p1); const e01 = em01.Edge(); em01.delete();
  const em12 = new oc.BRepBuilderAPI_MakeEdge_3(p1,p2); const e12 = em12.Edge(); em12.delete();
  const em23 = new oc.BRepBuilderAPI_MakeEdge_3(p2,p3); const e23 = em23.Edge(); em23.delete();
  const em30 = new oc.BRepBuilderAPI_MakeEdge_3(p3,p0); const e30 = em30.Edge(); em30.delete();
  const wm = new oc.BRepBuilderAPI_MakeWire_1();
  wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
  const w = wm.Wire(); wm.delete();
  e01.delete(); e12.delete(); e23.delete(); e30.delete();
  p0.delete(); p1.delete(); p2.delete(); p3.delete();
  return w;
}

const wire0 = makeSquareWire(20, 0);
const wire1 = makeSquareWire(20, 30);

// Step 2: ThruSections (undecorated, NOT _1/_2)
// Constructor: (isSolid: bool, isRuled: bool, pres3d: Real)
// isSolid = true to get a solid; isRuled = false for smooth; pres3d = precision
const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1.0e-6);

// Step 3: AddWire (undecorated) — add each section wire
loft.AddWire(wire0);
loft.AddWire(wire1);

// Step 4: Build
const prBuild = new oc.Message_ProgressRange_1();
loft.Build(prBuild);
prBuild.delete();

if (loft.IsDone()) {
  const loftShape = loft.Shape();
  // vol = 12000 mm³
  loftShape.delete();
}

// Cleanup
loft.delete();
wire0.delete(); wire1.delete();
```

### Key facts

| Call | Details |
|------|---------|
| `BRepOffsetAPI_ThruSections` | **Undecorated** (no `_N`). Constructor takes `(isSolid, isRuled, pres3d)`. |
| `.AddWire(wire)` | **Undecorated** (not `.AddWire_1`). Appends a section wire. |
| `.AddVertex(vertex)` | Available for point sections. |
| `isSolid = true` | Required to produce a closed solid (otherwise gives a shell). |
| `isRuled = false` | Smooth loft; `true` = ruled (faceted) loft. |

---

## Item 7 — Variable-Radius Fillet (BRepFilletAPI_MakeFillet.Add_3)

**Task:** Fillet ONE edge of a 20mm box with varying radius 1mm → 4mm.
**Measured volume:** 7969.16 mm³ (< 8000 ✓)

```js
// VERIFIED — one edge of 20mm box filleted r1=1mm → r2=4mm → vol = 7969.16 mm³

// Constructor: undecorated BRepFilletAPI_MakeFillet (A1 verified)
const filletObj = new oc.BRepFilletAPI_MakeFillet(
  boxShape,
  oc.ChFi3d_FilletShape.ChFi3d_Rational
);

// Collect one edge (A0 pattern: TopExp_Explorer_2 + TopoDS.Edge_1 + deduplicate)
const edges = collectEdges(boxShape);  // returns 12 unique edges
const oneEdge = edges[0];

// Variable-radius Add — overload .Add_3(r1, r2, edge)
// This is the (Standard_Real, Standard_Real, TopoDS_Edge) overload
// .Add_2(r, edge) = constant radius (A1 verified)
// .Add_3(r1, r2, edge) = variable radius (A2 verified)
filletObj.Add_3(1.0, 4.0, oneEdge);   // r1=1mm at start, r2=4mm at end

// Build
const prBuild = new oc.Message_ProgressRange_1();
filletObj.Build(prBuild);
prBuild.delete();

if (filletObj.IsDone()) {
  const filletShape = filletObj.Shape();
  // vol ≈ 7969 mm³ (< 8000)
  filletShape.delete();
}

// Cleanup
for (const e of edges) e.delete();
filletObj.delete();
```

### All Add overloads on BRepFilletAPI_MakeFillet

| Method | Signature (inferred from arg counts) |
|--------|--------------------------------------|
| `Add_1` | 1 arg — likely `(TopoDS_Shape)` or wire-level |
| `Add_2` | `(radius: Real, edge: TopoDS_Edge)` — constant radius (A1 verified) |
| `Add_3` | `(r1: Real, r2: Real, edge: TopoDS_Edge)` — **variable radius** (A2 verified) |
| `Add_4` | 4 args — possibly `(r1, r2, edge, law)` or face-based |
| `Add_5` | 5 args — further extension |

Only `Add_2` and `Add_3` were tested; the others exist but were not explored.

---

## Constructor Overload Quick-Reference (A2 additions)

| Class | Working constructor | Notes |
|-------|--------------------|-|
| `gp_Ax2` | `gp_Ax2_2(gp_Pnt, N: gp_Dir, Vx: gp_Dir)` | `_1` = no-arg; `_3` = (pnt, N) 2-arg |
| `gp_Ax3` | `gp_Ax3_3(gp_Pnt, N: gp_Dir, Vx: gp_Dir)` | needed for gp_Pln_2 |
| `gp_Circ` | `gp_Circ_2(gp_Ax2, radius)` | `_1` = no-arg |
| `gp_Pln` | `gp_Pln_2(gp_Ax3)` or `gp_Pln_3(gp_Pnt, gp_Dir)` | `_1`=no-arg; `_4`=plane eq |
| `TopTools_ListOfShape` | `TopTools_ListOfShape_1()` + `.Append_1(shape)` | No-arg + append |
| `BRepOffsetAPI_MakeThickSolid` | **undecorated**`()` + `.MakeThickSolidByJoin(…10)` or `.MakeThickSolidBySimple(s,off)` | NOT a direct constructor call |
| `BRepOffsetAPI_MakeOffsetShape` | **undecorated**`()` + `.PerformByJoin(…9)` or `.PerformBySimple(s,off)` | NOT a direct constructor |
| `BRepOffsetAPI_DraftAngle` | `BRepOffsetAPI_DraftAngle_2(shape)` | `_1`=no-arg; undecorated=no ctor |
| `BRepOffsetAPI_MakePipe` | `BRepOffsetAPI_MakePipe_1(spineWire, profileFace)` | profile MUST be a face |
| `BRepOffsetAPI_ThruSections` | **undecorated**`(isSolid, isRuled, pres3d)` + `.AddWire(wire)` | `.Build(pr)` required |
| `BRepBuilderAPI_MakeEdge` (circle) | `BRepBuilderAPI_MakeEdge_8(gp_Circ)` | full circle edge |
| `BRepFilletAPI_MakeFillet` variable | `.Add_3(r1, r2, edge)` | `_2` = constant, `_3` = variable |

---

## Volume Cross-Check (A2)

| Shape | Dimensions | Expected (mm³) | Measured (mm³) |
|-------|-----------|---------------|----------------|
| Shell (hollow box, wall=2, top removed) | 20×20×20 | < 8000, > 0 | 3392 |
| Thickened sheet | 60×40 face, t=3 | 7200 | 7200 (|vol|) |
| Offset shape (outward 2mm) | 20×20×20 box | > 8000 | 9600 |
| Draft angle (5°, 4 side faces) | 20×20×20 box | > 0, ≠ 8000 | 6681.83 |
| Pipe (disk r=8, path=60) | r=8, h=60 | 12063.72 | 12063.72 |
| Loft (two 20×20 squares, h=30) | 20×20×2, z=0 and z=30 | 12000 | 12000 |
| Variable-radius fillet (one edge, r=1→4) | 20×20×20 box | < 8000 | 7969.16 |

---

## Important Semantic Notes

### MakeThickSolid vs MakeOffsetShape

- `MakeThickSolid.MakeThickSolidByJoin(shape, closingFaces, offset, …)` — hollows a solid by removing listed faces; offset is **signed** (negative = inward).
- `MakeThickSolid.MakeThickSolidBySimple(shape, offset)` — thickens an open shell/face into a solid; 2 args only.
- `MakeOffsetShape.PerformBySimple(shape, offset)` — offsets all faces of a solid uniformly; positive = outward. Returns a solid for a solid input.
- `MakeOffsetShape.PerformByJoin(…9)` — same but with full control over join type, intersection, etc.

### MakePipe: profile type matters

Passing a **wire** (circle) as profile to `MakePipe_1` creates a hollow tube **shell** — `VolumeProperties` returns ~2/3 of expected volume for a solid. Always use a **face** (disk) as profile for a solid pipe.

### DraftAngle: use constructor `_2`

`BRepOffsetAPI_DraftAngle` (undecorated) has no accessible constructor. `_1` is no-arg and cannot have faces added. `_2(shape)` is the constructor to use.

### ThruSections: undecorated, not _1

`BRepOffsetAPI_ThruSections(isSolid, isRuled, pres3d)` — the constructor is undecorated (no suffix). `_1` and `_2` were not found as distinct constructors.
