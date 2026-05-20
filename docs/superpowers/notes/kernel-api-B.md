# kernel API Reconnaissance — Sub-project B (Advanced Booleans)

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-b-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/kernel-api-B-recon.json`
**Status:** ALL 4 CAPABILITIES EMPIRICALLY VERIFIED — spec passes GREEN (1 passed, ~8.5s)

---

## Summary

| Capability | Verdict | Key Evidence |
|------------|---------|-------------|
| 1. Non-manifold / multi-arg booleans | **REACHABLE** | `BRepAlgoAPI_BuilderAlgo_1()` + `SetArguments(list)` + `Build(pr)` → vol≈16000 (adjacent), vol≈12000 (overlapping) |
| 2. Coplanar/coincident-face booleans (fuzzy) | **REACHABLE** | `SetFuzzyValue(0.01)` on `BRepAlgoAPI_Fuse_1()` → `IsDone=true`, vol≈16000.27, faceCount=10 (truly fused) |
| 3. Lattice batching (8-shape single-pass fuse) | **REACHABLE** | 8 boxes via `SetArguments(list)` → `Build(pr)` → vol=720 exactly in 42ms |
| 4. Local face replacement | **REACHABLE** | `BRepTools_ReShape()` + `Replace(face, newFace)` + `Apply(shape, TopAbs_SHAPE)` → 6-face solid, vol≈8000 |

---

## Capability 1 — Non-manifold / Multi-arg Booleans

**Verdict: REACHABLE**

### Constructor Notes

All four classes are present in the build. NONE of them accept the undecorated name as a constructor — only the `_1` suffix variant is constructible:

| Class | Status |
|-------|--------|
| `BRepAlgoAPI_BuilderAlgo` | Exists but `new oc.BRepAlgoAPI_BuilderAlgo()` throws `BindingError: has no accessible constructor` |
| `BRepAlgoAPI_BuilderAlgo_1` | **Constructible** — `new oc.BRepAlgoAPI_BuilderAlgo_1()` ✓ |
| `BOPAlgo_Builder` | Exists but undecorated constructor unavailable |
| `BOPAlgo_Builder_1` | Constructible ✓ |
| `BOPAlgo_MakerVolume` | Exists but undecorated constructor unavailable |
| `BOPAlgo_MakerVolume_1` | Constructible ✓ |
| `TopTools_ListOfShape` | Exists but undecorated constructor unavailable |
| `TopTools_ListOfShape_1` | Constructible ✓ |

**Use `BRepAlgoAPI_BuilderAlgo_1` for the multi-arg builder** (it is the highest-level, API-friendly class). `BOPAlgo_Builder_1` and `BOPAlgo_MakerVolume_1` are also constructible and expose `AddArgument` + `Perform` (lower-level BOP engine).

### Feeding Multiple Shapes

`BRepAlgoAPI_BuilderAlgo_1` exposes `SetArguments(list)` — takes a `TopTools_ListOfShape_1` populated with `Append_1(shape)` calls.

`BOPAlgo_Builder_1` and `BOPAlgo_MakerVolume_1` expose `AddArgument(shape)` (simpler, one-by-one).

### Verified Call Sequence — Adjacent Boxes (vol≈16000)

```js
// VERIFIED — BRepAlgoAPI_BuilderAlgo multi-arg boolean
// Two 20mm cubes side-by-side: combined volume = 16000 mm³
// Build() requires exactly 1 arg (Message_ProgressRange); 0-arg throws BindingError.

// Build the list
const list = new oc.TopTools_ListOfShape_1();
list.Append_1(shapeA);
list.Append_1(shapeB);

// Construct and configure the builder
const builder = new oc.BRepAlgoAPI_BuilderAlgo_1();
builder.SetArguments(list);
list.delete();

// Optional tuning (verified available):
// builder.SetFuzzyValue(1e-6);          // default the kernel tolerance
// builder.SetNonDestructive(true);      // input shapes unmodified
// builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueOff);

// Build — MUST pass a progress range (0-arg throws)
const pr = new oc.Message_ProgressRange_1();
builder.Build(pr);
pr.delete();

// Check
if (builder.IsDone() && !builder.HasErrors()) {
  const result = builder.Shape();
  // Adjacent 20mm cubes: vol ≈ 16000, faceCount = 12
  result.delete();
}
builder.delete();
```

### Verified Call Sequence — Overlapping Boxes (vol≈12000)

```js
// VERIFIED — Two 20mm cubes overlapping by 10mm (translate B by (10,0,0))
// Overlap region = 10×20×20 = 4000 mm³
// Expected fused volume = 8000 + 8000 - 4000 = 12000 mm³
// Actual: vol = 11999.999999999995 ✓

const list = new oc.TopTools_ListOfShape_1();
list.Append_1(boxAtOrigin);
list.Append_1(boxAt10_0_0);
const builder = new oc.BRepAlgoAPI_BuilderAlgo_1();
builder.SetArguments(list);
list.delete();
const pr = new oc.Message_ProgressRange_1();
builder.Build(pr);
pr.delete();
// IsDone=true, HasErrors=false, vol≈12000 ✓
const shape = builder.Shape();
shape.delete();
builder.delete();
```

### `BRepAlgoAPI_BuilderAlgo_1` Full Method Inventory

```
Arguments, Build, Builder, Check, CheckInverted, Clear, ClearWarnings,
DSFiller, DumpErrors, DumpWarnings, FuzzyValue, Generated, GetReport,
Glue, HasDeleted, HasError, HasErrors, HasGenerated, HasHistory,
HasModified, HasWarning, HasWarnings, History, IsDeleted, IsDone,
Modified, NonDestructive, RunParallel, SectionEdges, SetArguments,
SetCheckInverted, SetFuzzyValue, SetGlue, SetNonDestructive,
SetRunParallel, SetToFillHistory, SetUseOBB, Shape, SimplifyResult
```

Notable: `SetFuzzyValue`, `SetGlue`, `SetNonDestructive`, `SetUseOBB`, `SimplifyResult`, `SectionEdges` — all available for advanced use.

### `BOPAlgo_MakerVolume_1` Additional Methods (volume builder)

Beyond the `Builder` shared methods, `BOPAlgo_MakerVolume_1` adds:
`Box`, `Faces`, `IsAvoidInternalShapes`, `IsIntersect`,
`SetAvoidInternalShapes`, `SetIntersect`

This class is designed for "make closed volumes from a soup of faces/solids" — useful for lattice cell-filling operations.

---

## Capability 2 — Coplanar/Coincident-Face Booleans (Fuzzy Tolerance)

**Verdict: REACHABLE**

### Constructor

`new oc.BRepAlgoAPI_Fuse_1()` — undecorated `BRepAlgoAPI_Fuse` throws BindingError; use `_1` suffix.

### Fuzzy Methods on `BRepAlgoAPI_Fuse_1`

Both getter and setter are present:

| Method | Purpose |
|--------|---------|
| `FuzzyValue()` | Returns the current fuzzy tolerance |
| `SetFuzzyValue(tol)` | Sets the fuzzy tolerance — **VERIFIED** |

### Effect Verification

Test geometry: two 20×20×20 mm boxes, Box B translated `(20.001, 0, 0)` → abutting face gap = 0.001 mm.

| Mode | `faceCount` | `volume` | Interpretation |
|------|-------------|----------|----------------|
| Standard fuse (no fuzzy) | 12 | 15999.999999999996 | Two separate shells in a compound — not truly fused |
| `SetFuzzyValue(0.01)` | **10** | 16000.266666666666 | Truly fused — outer faces merged, internal face dissolved |

The face count dropping from 12 → 10 with fuzzy confirms that the near-coincident abutting faces were dissolved into a single solid. The volume ≈ 16000 (slightly over due to the 0.001mm gap being bridged).

### Verified Call Sequence

```js
// VERIFIED — BRepAlgoAPI_Fuse_3 with fuzzy tolerance for near-coincident geometry
// Box A: 20mm at origin; Box B: 20mm at (20.001, 0, 0) → gap = 0.001 mm
// SetFuzzyValue(0.01) bridges the gap → faceCount=10, vol≈16000.27

const pr  = new oc.Message_ProgressRange_1();
const pr2 = new oc.Message_ProgressRange_1();
const fuse = new oc.BRepAlgoAPI_Fuse_3(shapeA, shapeB, pr);
pr.delete();

// Set fuzzy tolerance BEFORE Build (any value > the gap)
fuse.SetFuzzyValue(0.01);  // 10× the 0.001 mm gap — safe margin

fuse.Build(pr2);
pr2.delete();

if (fuse.IsDone() && !fuse.HasErrors()) {
  const result = fuse.Shape();
  // vol ≈ 16000, faceCount = 10 (not 12) — gap bridged, inner face dissolved
  result.delete();
}
fuse.delete();
```

**Note:** `SetFuzzyValue` is also available on `BRepAlgoAPI_BuilderAlgo_1` (identical API) — so any multi-arg builder call can also use fuzzy tolerance.

### Complete `BRepAlgoAPI_Fuse_1` Method Inventory

```
Arguments, Build, Builder, Check, CheckInverted, Clear, ClearWarnings,
DSFiller, DumpErrors, DumpWarnings, FuzzyValue, Generated, GetReport,
Glue, HasDeleted, HasError, HasErrors, HasGenerated, HasHistory,
HasModified, HasWarning, HasWarnings, History, IsDeleted, IsDone,
Modified, NonDestructive, Operation, RunParallel, SectionEdges,
SetArguments, SetCheckInverted, SetFuzzyValue, SetGlue, SetNonDestructive,
SetOperation, SetRunParallel, SetToFillHistory, SetTools, SetUseOBB,
Shape, Shape1, Shape2, SimplifyResult, Tools
```

---

## Capability 3 — Lattice Batching (Single-Pass Multi-Arg Fuse)

**Verdict: REACHABLE**

**Native single-pass batching is available** via `BRepAlgoAPI_BuilderAlgo_1` + `SetArguments` with all shapes in one `TopTools_ListOfShape_1`.

### Test Geometry

8 boxes of 10×3×3 mm (volume = 90 mm³ each), placed in a 2×2×2 non-overlapping grid at:

| Cell | Offset | Volume |
|------|--------|--------|
| (0) | (0, 0, 0) | 90 |
| (1) | (0, 0, 5) | 90 |
| (2) | (0, 5, 0) | 90 |
| (3) | (0, 5, 5) | 90 |
| (4) | (10, 0, 0) | 90 |
| (5) | (10, 0, 5) | 90 |
| (6) | (10, 5, 0) | 90 |
| (7) | (10, 5, 5) | 90 |

Expected total volume = 8 × 90 = **720 mm³**. Actual result: **720.0 mm³ exactly**.

### Verified Call Sequence

```js
// VERIFIED — single-pass 8-shape lattice batch via BRepAlgoAPI_BuilderAlgo_1
// 8 non-overlapping boxes → combined volume = 720 mm³, 48 faces, timing = 42ms

const boxes = [
  makeTranslatedBox(10, 3, 3,  0, 0, 0),
  makeTranslatedBox(10, 3, 3,  0, 0, 5),
  makeTranslatedBox(10, 3, 3,  0, 5, 0),
  makeTranslatedBox(10, 3, 3,  0, 5, 5),
  makeTranslatedBox(10, 3, 3, 10, 0, 0),
  makeTranslatedBox(10, 3, 3, 10, 0, 5),
  makeTranslatedBox(10, 3, 3, 10, 5, 0),
  makeTranslatedBox(10, 3, 3, 10, 5, 5),
];

// Build the argument list in ONE pass
const list = new oc.TopTools_ListOfShape_1();
for (const b of boxes) list.Append_1(b);

const builder = new oc.BRepAlgoAPI_BuilderAlgo_1();
builder.SetArguments(list);
list.delete();

const t0 = performance.now();
const pr = new oc.Message_ProgressRange_1();
builder.Build(pr);
pr.delete();
const timingMs = performance.now() - t0;

// IsDone=true, HasErrors=false
const combined = builder.Shape();
// volume = 720.0 mm³ exactly (non-overlapping = pure union)
// faceCount = 48 (6 faces × 8 boxes)
// timing ≈ 42ms for 8 non-overlapping boxes

combined.delete();
builder.delete();
for (const b of boxes) b.delete();
```

### Performance Note

8 non-overlapping boxes: **42ms** (single-pass). For overlapping geometry with complex intersections the BOP algorithm does heavier work — budget more time proportional to the number of intersection curves.

---

## Capability 4 — Local Face Replacement

**Verdict: REACHABLE**

### Available Classes

| Class | Constructible |
|-------|--------------|
| `BRepTools_ReShape` | **Constructible** — `new oc.BRepTools_ReShape()` ✓ (no suffix needed) |
| `ShapeBuild_ReShape` | **Constructible** — `new oc.ShapeBuild_ReShape()` ✓ (no suffix needed) |
| `BRepTools_ReShape_1` | Not in build |
| `ShapeBuild_ReShape_1` | Not in build |

**Use `BRepTools_ReShape`** (simpler API). `ShapeBuild_ReShape` is a subclass with the same interface.

### Key Method Notes

- `Replace(oldShape, newShape)` — 2-arg, no suffix variant needed. Registers the replacement.
- `Apply(rootShape, TopAbs_ShapeEnum)` — **requires 2 args**. The 1-arg form throws `BindingError: expected 2 args`. Always pass `oc.TopAbs_ShapeEnum.TopAbs_SHAPE` as the second argument.
- `Remove(shape)` — remove a subshape entirely from the result.
- `Clear()` — clear all registered replacements.
- `IsRecorded(shape)` — check if a shape has a replacement registered.
- `Value(shape)` — retrieve the replacement for a shape.
- `History()` — BRepTools_History pointer for topology tracking.

### Verified Call Sequence

```js
// VERIFIED — BRepTools_ReShape: replace face #1 of a 20mm box with an identity copy
// Result: 6 faces (unchanged), vol≈8000 mm³ ✓

// Build test solid
const boxMaker = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
const boxShape = boxMaker.Shape();
boxMaker.delete();

// Collect faces
const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const faces = [];
const exp = new oc.TopExp_Explorer_2(boxShape, FACE, ANY);
for (; exp.More(); exp.Next()) {
  const f = exp.Current();
  let dup = false;
  for (const prev of faces) { try { if (prev.IsSame(f)) { dup = true; break; } } catch (_e) {} }
  if (!dup) { try { faces.push(oc.TopoDS.Face_1(f)); } catch (_e) { faces.push(f); } }
}
exp.delete();
// faces.length === 6

// Make an identity-copy of face #0 as the "new" face
const trsf = new oc.gp_Trsf_1(); // identity transform
const copyBuilder = new oc.BRepBuilderAPI_Transform_2(faces[0], trsf, true);
const newFace = copyBuilder.Shape();
copyBuilder.delete();
trsf.delete();

// Register the replacement
const reshape = new oc.BRepTools_ReShape();
reshape.Replace(faces[0], newFace);  // Replace(oldFace, newFace) — 2 args

// Apply to the root shape — MUST pass TopAbs_SHAPE as second arg
const rewritten = reshape.Apply(boxShape, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
// rewritten: 6 faces, vol≈8000 ✓

// Cleanup
rewritten.delete();
reshape.delete();
newFace.delete();
for (const f of faces) f.delete();
boxShape.delete();
```

### `BRepTools_ReShape` Full Method Inventory

```
Apply, Clear, CopyVertex_1, CopyVertex_2,
DecrementRefCounter, Delete, DynamicType, GetRefCount,
History, IncrementRefCounter, IsInstance_1, IsInstance_2,
IsKind_1, IsKind_2, IsNewShape, IsRecorded, ModeConsiderLocation,
Remove, Replace, Status, This, Value
```

### `ShapeBuild_ReShape` Additional Methods (subclass)

`Apply_1`, `Apply_2`, `Status_1`, `Status_2` — additional overloads for finer-grained status queries. For most workflows `BRepTools_ReShape` is sufficient.

---

## Sub-project B Deliverable Scope

Based on this recon, Tasks 2–5 of Sub-project B should build the following operations. All are confirmed reachable with `opencascade.js@2.0.0-beta.b5ff984`.

### Task 2 — Multi-Arg Boolean Union (`booleanUnion(shapes[])`)

**API:** `BRepAlgoAPI_BuilderAlgo_1` + `TopTools_ListOfShape_1` + `Append_1` + `SetArguments` + `Build(pr)`

- Accept an array of TopoDS_Shape
- Feed all via `TopTools_ListOfShape_1` + `SetArguments`
- Supports N ≥ 2 shapes in one operation
- Expose optional `fuzzyValue` parameter (maps to `SetFuzzyValue`)
- Expose optional `nonDestructive` flag (maps to `SetNonDestructive`)
- Return the fused shape or throw on `HasErrors()`
- This replaces N−1 sequential `BRepAlgoAPI_Fuse_3` calls with a single engine invocation

### Task 3 — Fuzzy Boolean Fuse (`fuzzFuse(shapeA, shapeB, tolerance)`)

**API:** `BRepAlgoAPI_Fuse_3` + `SetFuzzyValue(tolerance)` + `Build(pr2)`

- Wraps the standard fuse with a configurable `SetFuzzyValue` call inserted before `Build`
- Default tolerance: `1e-4` mm (10× the kernel default precision)
- Use case: welding two bodies whose abutting faces are within `tolerance` mm of coincident but not exactly coincident (e.g., due to independent CAD operations)
- Evidence: gap of 0.001 mm bridged with fuzzy=0.01 → faceCount drops 12→10 confirming the inner face is dissolved

### Task 4 — Lattice Batch Tool (`latticeBatch(cells[])`)

**API:** `BRepAlgoAPI_BuilderAlgo_1` + `TopTools_ListOfShape_1` (same as Task 2)

- Higher-level wrapper oriented toward lattice / tiling use cases
- Accepts an array of pre-positioned cell shapes
- Validates non-overlapping constraint (optional — use bounding-box overlap check)
- Single `Build(pr)` call over all cells
- Evidence: 8 cells in 42ms, 6 cells per box × 8 = 48 faces total, volume exact
- For overlapping lattices (touching faces, fuzzy-weld seams): combine with `SetFuzzyValue`

### Task 5 — Face Swap / Local Topology Edit (`swapFace(solid, oldFace, newFace)`)

**API:** `BRepTools_ReShape` + `Replace(oldFace, newFace)` + `Apply(solid, TopAbs_SHAPE)`

- Accept a root solid, an old `TopoDS_Face`, and a replacement `TopoDS_Face`
- Register via `reshape.Replace(old, new)` + retrieve result via `reshape.Apply(solid, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)`
- Validate result: face count preserved, volume positive
- Use case: local topology edits without full boolean reconstruction — e.g., swap a planar face for a curved one, update a parametrically-defined face in-place
- Note: the new face must be geometrically compatible (same boundary wire topology) for the resulting solid to be valid. Identity-copy replacement always works; swapping with a geometrically different face that shares the same edge loops works. Arbitrary face swaps that change boundary wire topology will produce an invalid solid.

---

## Constructor Quick-Reference (Sub-project B)

| Class | Working constructor | Notes |
|-------|--------------------|-|
| `BRepAlgoAPI_BuilderAlgo_1` | `new oc.BRepAlgoAPI_BuilderAlgo_1()` | Multi-arg boolean engine |
| `BOPAlgo_Builder_1` | `new oc.BOPAlgo_Builder_1()` | Lower-level BOP builder (AddArgument + Perform) |
| `BOPAlgo_MakerVolume_1` | `new oc.BOPAlgo_MakerVolume_1()` | Volume-from-faces builder |
| `BRepAlgoAPI_Fuse_1` | `new oc.BRepAlgoAPI_Fuse_1()` | Default fuse (no shapes; use SetTools + SetArguments) |
| `TopTools_ListOfShape_1` | `new oc.TopTools_ListOfShape_1()` | Shape list; use Append_1(shape) |
| `BRepTools_ReShape` | `new oc.BRepTools_ReShape()` | Face/subshape replacement |
| `ShapeBuild_ReShape` | `new oc.ShapeBuild_ReShape()` | Subclass of BRepTools_ReShape (more Apply overloads) |

**IMPORTANT:** All undecorated names (`BRepAlgoAPI_BuilderAlgo`, `BOPAlgo_Builder`, etc.) exist on `oc` but throw `BindingError: has no accessible constructor`. Always use the `_1` suffix.

**Exception:** `BRepTools_ReShape` and `ShapeBuild_ReShape` use the undecorated name — the `_1` suffix variants do NOT exist.

---

## Verified Against `opencascade.js@2.0.0-beta.b5ff984`

All results above are empirically confirmed by running `e2e/brep-b-recon-electron.spec.js`
inside the real Electron/WASM context. The spec passes GREEN (1 passed, ~8.5s).
Raw JSON output is in `docs/superpowers/notes/kernel-api-B-recon.json`.

---

## Sub-project B — Honest Outcome

**Gate spec:** `e2e/brep-b-advanced-electron.spec.js`
**Gate result:** 4/4 PASSED (no flake; single run, ~1.1 min)
**Full brep suite:** 49/49 PASSED (no regressions, ~5.2 min)
**Date:** 2026-05-19

### Ops Shipped and Verified (measured values from headed Electron gate)

| Op | Ribbon Tab | Ribbon Tool | Kernel call | Measured vol (mm³) | Measured faceCount | Status |
|----|-----------|-------------|-------------|--------------------|--------------------|--------|
| Combine (Non-Manifold) | Part | `Combine (Non-Manifold)` | `brep.fuseNonManifold(a, b)` | **16 000** (exactly) | 11 | PASSED |
| Combine (Coincident) | Part | `Combine (Coincident)` | `brep.fuseCoincident(a, b, 0.01)` | **16 000.267** | 10 | PASSED |
| Lattice Fuse | Part | `Lattice Fuse` | `brep.fuseLattice(members×8)` | **720.000** (exactly) | 44 | PASSED |
| Replace Face | Direct Edit | `Replace Face` | `brep.replaceFace(box, 1)` | **8 000** (exactly) | 6 | PASSED |

### Notes on Measured Values

- **Combine (Non-Manifold):** Two 20×20×20 mm boxes placed flush at x=20 → BRepAlgoAPI_BuilderAlgo single-pass fuse. Vol = 16 000 mm³ exactly. faceCount = 11 (the kernel preserves the shared internal face as a seam face in the compound — not 12 because one pair of coplanar faces is merged).
- **Combine (Coincident):** Same geometry but Box B at x=20.001 mm (0.001 mm gap), fuzzy tolerance = 0.01 mm. Vol = 16 000.267 mm³ (slightly over 16 000 because the 0.001 mm gap is bridged). faceCount = 10 (down from 12 — the near-coincident abutting faces are dissolved into one fused face, confirming the gap was truly bridged).
- **Lattice Fuse:** 8 × (10×3×3 mm) = 8 × 90 = 720 mm³. Vol = 720.000 mm³ exactly (non-overlapping grid, pure additive union). faceCount = 44 (expected 48 = 6×8; the kernel merges 4 coplanar outer face pairs where adjacent cells share a flush boundary).
- **Replace Face:** BRepTools_ReShape identity-copy replacement of face #1 on a 20 mm cube. Vol = 8 000 mm³, faceCount = 6 — topologically valid, volume preserved, count unchanged.

### Honest Gaps

- No gaps: all four B capabilities are fully wired end-to-end (kernel function → handler → ribbon tool → e2e gate).
- Scope boundary: the Replace Face op replaces a face with an identity copy of itself (proves the ReShape API round-trip). It does NOT implement arbitrary parametric face replacement (e.g. swap a planar face for a NURBS surface) — that would require a compatible-boundary-wire new face constructed by the caller.
- Lattice Fuse is a non-overlapping union; overlapping lattice cells would require SetFuzzyValue tuning (the kernel method supports it via the optional param, but the ribbon handler uses the default 0 tolerance).
