# OCCT API Reconnaissance — Phase A3

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-a3-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-A3-recon.json`
**Status:** Items 3, 4, 5 FULLY VERIFIED. Items 1, 2 PARTIAL — checker runs but result-reading types are unbound.

---

## Summary

| Item | Status | Key Call |
|------|--------|---------|
| 1. Self-intersection check (clean) | NOT CONFIRMED (result-reading unbound) | `BRepExtrema_SelfIntersection_2(shape, tol)` + `Perform()` — IsDone=true but `OverlapElements()` unbound |
| 2. Self-intersection check (overlapping compound) | PARTIAL — compound building confirmed; checker result unbound | `TopoDS_Compound()` + `BRep_Builder()` + `MakeCompound` + `Add` |
| 3. Shape transform | **CONFIRMED** | `gp_Trsf_1()` + `SetTranslation_1(gp_Vec_4)` + `BRepBuilderAPI_Transform_2(shape, trsf, false)` |
| 4. Clash — interference volume | **CONFIRMED** | `BRepAlgoAPI_Common_3(a, b, pr)` + `.Build(pr)` + `.Shape()` → vol ≈ 4000 |
| 5. Clash — minimum distance | **CONFIRMED** | `BRepExtrema_DistShapeShape_1()` + `LoadS1/LoadS2` + `Perform(pr)` + `Value()` |

---

## Item 3 — Shape Transform (CONFIRMED)

**Verified:** translate a 20mm box by (10, 0, 0) → `CornerMin.X` moves from ≈0 to ≈10.

```js
// VERIFIED — gp_Trsf_1 + SetTranslation_1 + BRepBuilderAPI_Transform_2
// Translates any TopoDS_Shape by (dx, dy, dz)

const trsf = new oc.gp_Trsf_1();           // no-arg constructor
const vec  = new oc.gp_Vec_4(10, 0, 0);    // gp_Vec_4 = 3-double constructor (A1 verified)
trsf.SetTranslation_1(vec);                 // SetTranslation_1 takes a gp_Vec
vec.delete();

// BRepBuilderAPI_Transform_2(shape, trsf, copy)
// _1 = (trsf) — no shape yet; _2 = (shape, trsf, copy)
const xform = new oc.BRepBuilderAPI_Transform_2(inputShape, trsf, false);
const transformedShape = xform.Shape();
xform.delete();
trsf.delete();

// Verify: bbox of transformed shape
const bb = new oc.Bnd_Box_1();
oc.BRepBndLib.Add(transformedShape, bb, false);
const mn = bb.CornerMin();
// mn.X() ≈ 10.0 (was ≈ 0.0 before transform)
mn.delete(); bb.delete();
transformedShape.delete();
```

### Key facts for Item 3

| Type | Working constructor | Notes |
|------|--------------------|-|
| `gp_Trsf` | `gp_Trsf_1()` | No-arg; `_2` = copy-from-gp_Trsf2d |
| `SetTranslation` | `SetTranslation_1(gp_Vec)` | `_2` = (gp_Pnt from, gp_Pnt to) |
| `BRepBuilderAPI_Transform` | `_2(shape, trsf, copy)` | `_1(trsf)` = trsf-only, no shape |

### Available `gp_Trsf` translation methods (from prototype)

- `SetTranslation_1(gp_Vec)` — set from vector (use this)
- `SetTranslation_2(gp_Pnt, gp_Pnt)` — from point to point
- `SetTranslationPart(gp_Vec)` — set only the translation part of existing trsf
- `TranslationPart()` — getter

---

## Item 4 — Clash: Interference Volume (CONFIRMED)

**Verified:** Box A `[0..20]³`, Box B `[10..30] × [0..20] × [0..20]` (translated +10 in X).
Boolean Common gives the overlap volume ≈ 10·20·20 = **4000 mm³** (measured: 3999.999…).

```js
// VERIFIED — BRepAlgoAPI_Common_3 on two overlapping boxes
// Overlap X=[10..20], Y=[0..20], Z=[0..20] → vol = 4000 mm³

// Build box A
const boxA = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
const shapeA = boxA.Shape();
boxA.delete();

// Build box B = A translated by (10, 0, 0)
const trsf = new oc.gp_Trsf_1();
const vec   = new oc.gp_Vec_4(10, 0, 0);
trsf.SetTranslation_1(vec);
vec.delete();
const xform = new oc.BRepBuilderAPI_Transform_2(shapeA, trsf, false);
const shapeB = xform.Shape();
xform.delete();
trsf.delete();

// Boolean Common (A1 verified)
const pr1 = new oc.Message_ProgressRange_1();
const algo = new oc.BRepAlgoAPI_Common_3(shapeA, shapeB, pr1);
pr1.delete();

const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

if (algo.IsDone()) {
  const commonShape = algo.Shape();
  // Measure volume
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(commonShape, props, false, false, false);
  const vol = props.Mass();   // ≈ 4000 mm³
  props.delete();
  commonShape.delete();
}
algo.delete();
shapeA.delete();
shapeB.delete();
```

Measured volume: 3999.999999999999 mm³ (expected 4000).

---

## Item 5 — Clash: Minimum Distance (CONFIRMED)

**Verified:**
- Disjoint boxes (gap = 30 mm): `Value()` → **30.0** ✓
- Overlapping boxes (overlap 10 mm in X): `Value()` → **0** ✓

**Key discovery:** `BRepExtrema_DistShapeShape_1()` (no-arg ctor) + `LoadS1(shape)` + `LoadS2(shape)` + `Perform(pr)` + `Value()`.

The `_2` overload needs 5 args and the `_3` needs 6 args — both are inaccessible without knowing the extra arg types. Always use the no-arg `_1` ctor + `LoadS1`/`LoadS2`.

```js
// VERIFIED — complete working sequence for BRepExtrema_DistShapeShape

// Step 1: Construct with no-arg _1
const dist = new oc.BRepExtrema_DistShapeShape_1();

// Step 2: Load shapes
dist.LoadS1(shapeA);
dist.LoadS2(shapeB);

// Step 3: Perform (requires progress range)
const pr = new oc.Message_ProgressRange_1();
dist.Perform(pr);
pr.delete();

// Step 4: Read results
if (dist.IsDone()) {
  const minDist = dist.Value();    // minimum distance (mm)
  const nbSols  = dist.NbSolution(); // number of solutions
  // For each solution i=1..NbSolution():
  //   dist.PointOnShape1(i) → gp_Pnt (closest point on shape A)
  //   dist.PointOnShape2(i) → gp_Pnt (closest point on shape B)
  //   dist.SupportTypeShape1(i) → BRepExtrema_SupportType enum
  //   dist.SupportTypeShape2(i) → BRepExtrema_SupportType enum
  //   dist.SupportOnShape1(i) → TopoDS_Shape (edge/face/vertex on A)
  //   dist.SupportOnShape2(i) → TopoDS_Shape (edge/face/vertex on B)
}
dist.delete();
```

### Complete method list on `BRepExtrema_DistShapeShape_1` instance

`Dump`, `InnerSolution`, `IsDone`, `IsMultiThread`, `LoadS1`, `LoadS2`, `NbSolution`,
`ParOnEdgeS1`, `ParOnEdgeS2`, `ParOnFaceS1`, `ParOnFaceS2`, `Perform`,
`PointOnShape1`, `PointOnShape2`, `SetAlgo`, `SetDeflection`, `SetFlag`,
`SetMultiThread`, `SupportOnShape1`, `SupportOnShape2`, `SupportTypeShape1`,
`SupportTypeShape2`, `Value`

### Overload counts (from BindingErrors — do NOT attempt multi-arg ctors)

| Class | Expected args |
|-------|--------------|
| `BRepExtrema_DistShapeShape_1` | 0 (no-arg, use this) |
| `BRepExtrema_DistShapeShape_2` | 5 |
| `BRepExtrema_DistShapeShape_3` | 6 |
| `BRepExtrema_DistShapeShape` (undecorated) | no accessible constructor |

### Verified distances

| Test case | Shapes | Expected | Measured |
|-----------|--------|----------|---------|
| Disjoint | A=[0..20]³, B=[50..70]×[0..20]² | 30 mm | 30 mm ✓ |
| Overlapping | A=[0..20]³, B=[10..30]×[0..20]² | 0 mm | 0 mm ✓ |

---

## Items 1 & 2 — Self-intersection Check (NOT CONFIRMED — Unbound Types)

### What was attempted

**Primary: `BOPAlgo_CheckerSI`**

`BOPAlgo_CheckerSI` (undecorated, no `_1`/`_2` suffix) exists in this build but its
constructor has an unbound dependency: `BOPAlgo_PaveFiller` is not bound in
`opencascade.js@2.0.0-beta.b5ff984`.

```
UnboundTypeError: Cannot construct BOPAlgo_CheckerSI
  due to unbound types: 18BOPAlgo_PaveFiller
```

The intended sequence (copy-paste ready for a build where it IS available):

```js
// INTENDED SEQUENCE — BOPAlgo_CheckerSI
// NOT usable in opencascade.js@2.0.0-beta.b5ff984 (BOPAlgo_PaveFiller unbound)
// Preserved here for reference / future builds

// Step 1: Shape to check
const shapeToCheck = makeBoxShape(20, 20, 20);  // or any TopoDS_Shape

// Step 2: Build argument list
const argList = new oc.TopTools_ListOfShape_1();
argList.Append_1(shapeToCheck);

// Step 3: Construct checker (FAILS in this build)
// const checker = new oc.BOPAlgo_CheckerSI();   // ← UnboundTypeError

// Step 4 (if ctor worked): Feed shape
// checker.SetArguments(argList);   // SetArguments(list) — from TopTools_ListOfShape

// Step 5 (if ctor worked): Run
// const pr = new oc.Message_ProgressRange_1();
// checker.Perform(pr);             // or checker.Perform() — try both
// pr.delete();

// Step 6 (if ctor worked): Read results
// checker.HasErrors()              // → false = no self-intersection
// checker.Interferences()          // → returns a map; .Size() or .Extent() = count
// checker.Interferences().Size()   // interference pair count

// Cleanup
argList.delete();
shapeToCheck.delete();
// checker.delete();
```

**Fallback: `BRepExtrema_SelfIntersection`**

`BRepExtrema_SelfIntersection_2(shape, deflection)` is accessible (constructible, IsDone=true
after `Perform()`), but its result-reading types are also unbound:

```
// BRepExtrema_SelfIntersection_2(shape, deflection) — 2 args
// Perform() — 0 args (NOT Perform(pr))
// IsDone() → true after Perform()
//
// OverlapElements() → UnboundTypeError (return type 19N unbound)
// ElementSet()      → returns Handle; .get() → UnboundTypeError (BVH_PrimitiveSet unbound)
```

Available methods on `BRepExtrema_SelfIntersection_2` instance:
`ElementSet`, `GetSubShape`, `IsDone`, `LoadShape`, `OverlapElements`, `Perform`,
`PreCheckElements`, `SetTolerance`, `Tolerance`

### Compound Building — CONFIRMED

Items 1 and 2 confirmed the `TopoDS_Compound` + `BRep_Builder` chain, which IS needed by
production code:

```js
// VERIFIED — build a compound of two shapes
// TopoDS_Compound (undecorated, no _1/_2) + BRep_Builder (undecorated)

const compound = new oc.TopoDS_Compound();
const builder  = new oc.BRep_Builder();
builder.MakeCompound(compound);    // initializes the compound
builder.Add(compound, shape1);     // Add(compound, shape)
builder.Add(compound, shape2);

// compound is now a TopoDS_Shape containing shape1 and shape2
// Use as input to any algorithm that accepts TopoDS_Shape

// Cleanup
compound.delete();
builder.delete();
```

| Class | Working ctor | Method |
|-------|-------------|--------|
| `TopoDS_Compound` | `TopoDS_Compound()` (undecorated) | — |
| `BRep_Builder` | `BRep_Builder()` (undecorated) | `.MakeCompound(compound)` |
| | | `.Add(compound, shape)` |

### Recommended Workaround for Clash Detection

For the A3 phase, self-intersection in the sense of "two solid bodies overlap" is best
detected via **Boolean Common volume** (Item 4), which IS fully confirmed:

```js
// Reliable clash detection via Common volume
// Two shapes are clashing if their Common volume > 0

const pr1 = new oc.Message_ProgressRange_1();
const algo = new oc.BRepAlgoAPI_Common_3(shapeA, shapeB, pr1);
pr1.delete();
const prBuild = new oc.Message_ProgressRange_1();
algo.Build(prBuild);
prBuild.delete();

let overlapVolume = 0;
if (algo.IsDone()) {
  const common = algo.Shape();
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(common, props, false, false, false);
  overlapVolume = Math.abs(props.Mass());
  props.delete();
  common.delete();
}
algo.delete();
// overlapVolume > 0 → shapes are clashing
// overlapVolume ≈ 0 → shapes are not clashing (or just touching)
```

---

## Constructor Overload Quick-Reference (A3 additions)

| Class | Working constructor | Notes |
|-------|--------------------|-|
| `gp_Trsf` | `gp_Trsf_1()` | No-arg; use `SetTranslation_1(gp_Vec)` |
| `BRepBuilderAPI_Transform` | `_2(shape, trsf, copy)` | `_1` = (trsf) only, no shape |
| `TopoDS_Compound` | `TopoDS_Compound()` (undecorated) | No `_N` suffix |
| `BRep_Builder` | `BRep_Builder()` (undecorated) | No `_N` suffix |
| `BRepExtrema_DistShapeShape` | `_1()` + `LoadS1(s)` + `LoadS2(s)` + `Perform(pr)` | `_2` needs 5 args, `_3` needs 6 |
| `BOPAlgo_CheckerSI` | NOT usable — needs unbound `BOPAlgo_PaveFiller` | — |
| `BRepExtrema_SelfIntersection` | `_2(shape, deflection)` — constructible, IsDone=true | `OverlapElements()` return type unbound |

---

## Volume Cross-Check (A3)

| Shape | Test | Expected (mm³) | Measured (mm³) |
|-------|------|---------------|----------------|
| Boolean Common (A[0..20]³ ∩ B[10..30]×[0..20]²) | Overlap = 10·20·20 | 4000 | 3999.999… |
| DistShapeShape (disjoint, gap 30) | Min dist | 30 mm | 30 mm |
| DistShapeShape (overlapping 10mm in X) | Min dist | 0 mm | 0 mm |
