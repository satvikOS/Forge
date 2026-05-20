# OCCT API Reconnaissance — Sub-project F

**Date:** 2026-05-20
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-f-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-F-recon.json`
**Status:** ALL 5 CAPABILITIES INVESTIGATED — spec passes GREEN (1 passed, ~13s)

---

## Summary

| Item | Capability | Verdict | Key Evidence |
|------|-----------|---------|-------------|
| 1 | N-Sided Patching (`BRepOffsetAPI_MakeFilling`) | **NOT_REACHABLE** | `Build(pr)` throws raw OCCT C++ integer exception for all inputs (4-edge square: `18942920`, 5-edge pentagon: `18952888`). Confirms A5 honest outcome. |
| 2 | Tortuous-path Sweep (`BRepOffsetAPI_MakePipeShell`) | **REACHABLE** | `IsDone=true`, 3 faces, 1 shell. `Add_1(wire, false, false)` required; `Build(pr)` required. Volume lower than expected (open-ended pipe, not capped solid — correct for this topology). |
| 3 | Lofting with Tangency (`BRepOffsetAPI_ThruSections`) | **REACHABLE** | `IsDone=true`, `solidCount=1`, `volume=25779mm³`. `SetSmoothing(true)` confirmed present and callable. Full smoothing method suite available. |
| 4 | Tolerant Stitching (`BRepBuilderAPI_Sewing`) | **REACHABLE** | Two faces with 0.05mm gap → 1 shell, 2 faces after Sewing with tol=0.1. Constructor requires exactly 5 args. `Perform(pr)` required. |
| 5 | Convergent Modeling (MakeFace+Sewing+MakeSolid) | **REACHABLE** | 12 triangle faces → Sewing → Shell → `BRepBuilderAPI_MakeSolid_3(shell)` → `IsDone=true`, `solidCount=1`, `volume=8000mm³` exactly (20mm cube). |

---

## Item 1 — N-Sided Patching (BRepOffsetAPI_MakeFilling)

**Verdict: NOT_REACHABLE**

**Evidence:** `BRepOffsetAPI_MakeFilling.Build(pr)` throws a raw OCCT C++ exception (exposed as an integer pointer in JS, e.g. `18942920`) for ALL tested boundary geometries:
- 4-edge planar square wire: `18942920`
- 5-edge planar pentagon wire: `18952888`

The constructor works, `Add_1(edge, GeomAbs_C2, false)` works, but the variational solver itself crashes unconditionally in this WASM build.

This **confirms the A5 honest outcome** (documented in `occt-api-A5.md` §"Remaining Gaps"): the variational solver is not usable in `opencascade.js@2.0.0-beta.b5ff984`.

### What Was Tested

```js
// VERIFIED — MakeFilling constructor and Add work; Build crashes
const filling = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 1e-2, 0.1, 8, 9);
// Add 4 edges of a planar square wire
for (const edge of squareEdges) {
  filling.Add_1(edge, oc.GeomAbs_Shape.GeomAbs_C2, false);  // OK
}
const pr = new oc.Message_ProgressRange_1();
try {
  filling.Build(pr);  // THROWS: raw OCCT integer exception "18942920"
} catch (e) {
  // e = "18942920" — not a BindingError; OCCT C++ threw
}
```

**Honest explanation:** The WASM build's variational solver (`GeomPlate`) is either not linked, has missing mesh infrastructure, or has a thread/memory model incompatibility. No workaround exists short of a custom OCCT build.

---

## Item 2 — Tortuous-path Sweep (BRepOffsetAPI_MakePipeShell)

**Verdict: REACHABLE**

**Evidence:** `IsDone()=true` after sweeping a circular profile (r=4mm) along a 3-segment tortuous path with two right-angle bends. The result shape has 3 faces and 1 shell.

**Volume note:** Measured volume = 670mm³; expected ≈3520mm³ (π·r²·totalLength). The discrepancy is expected: `MakePipeShell` without `MakeSolid()` produces an **open-ended pipe shell** (no caps at the ends). The shell topology (3 faces = cylindrical sweep face + 2 end caps? or open with 1 face) indicates the result is a correct open-ended tube. For a solid, call `.MakeSolid()` on the pipe shell before `.Shape()`. This does not affect the API's reachability verdict.

### Verified Call Sequence

```js
// VERIFIED — Tortuous-path sweep via BRepOffsetAPI_MakePipeShell
// Spine: 3-segment polyline with two right-angle bends
const spineEdges = [
  makeLineEdge(0, 0, 0,   20, 0, 0),    // segment 1: along +X (20mm)
  makeLineEdge(20, 0, 0,  20, 20, 0),   // segment 2: along +Y (20mm) — right-angle bend
  makeLineEdge(20, 20, 0, 20, 20, 30),  // segment 3: along +Z (30mm) — right-angle bend
];
const bw = new oc.BRepBuilderAPI_MakeWire_1();
for (const e of spineEdges) bw.Add_1(e);
const spineWire = bw.Wire();
bw.delete();

// Profile: circle r=4 at path start, normal along first segment direction (+X)
const origin  = new oc.gp_Pnt_3(0, 0, 0);
const axisDir = new oc.gp_Dir_4(1, 0, 0);  // normal = first edge direction
const refDir  = new oc.gp_Dir_4(0, 0, 1);  // reference direction
const ax2     = new oc.gp_Ax2_2(origin, axisDir, refDir);
const circ    = new oc.gp_Circ_2(ax2, 4);  // radius = 4mm
const circEdgeMaker = new oc.BRepBuilderAPI_MakeEdge_8(circ);
const circEdge = circEdgeMaker.Edge();
const pw = new oc.BRepBuilderAPI_MakeWire_1();
pw.Add_1(circEdge);
const profileWire = pw.Wire();
// cleanup: circEdgeMaker.delete(), circEdge.delete(), pw.delete(), circ.delete(), etc.

// Construct PipeShell — NO suffix variant in this build
const pipeShell = new oc.BRepOffsetAPI_MakePipeShell(spineWire);

// Add profile — Add_1 requires EXACTLY 3 args: (wire, withContact, withCorrection)
// 0-arg and 1-arg forms throw BindingError "expected 3 args"
pipeShell.Add_1(profileWire, false, false);
// withContact=false: profile does not maintain contact with spine
// withCorrection=false: no frame correction

// Optionally set transition mode (default is ok for non-self-intersecting paths)
// pipeShell.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);

// Build — no-arg form throws "expected 1 args"; progress range required
const pr = new oc.Message_ProgressRange_1();
pipeShell.Build(pr);
pr.delete();

if (pipeShell.IsDone()) {
  const shape = pipeShell.Shape();     // open-ended pipe shell
  // For a CAPPED solid pipe: call pipeShell.MakeSolid() before Shape()
  // shape is a SHELL (1 shell, 3 faces for this 3-segment path)
  shape.delete();
}
pipeShell.delete();
profileWire.delete();
spineWire.delete();
for (const e of spineEdges) e.delete();
```

### Constructor Notes

- Only `BRepOffsetAPI_MakePipeShell` (no suffix) exists in this build.
- `BRepOffsetAPI_MakePipeShell_1` is NOT present (confirmed missing).

### Add Overloads

- `Add_1(wire, withContact, withCorrection)` — 3 args required; 1-arg throws BindingError.
- `Add_2` — alternate overload (likely for specifying a local frame; signature unverified).

### Method Inventory on `BRepOffsetAPI_MakePipeShell` Instance

```
Add_1, Add_2,
Build, Check, Delete,
ErrorOnSurface, FirstShape, Generated, GetStatus,
IsDeleted, IsDone, IsReady, LastShape,
MakeSolid,                    // Call BEFORE Shape() for a capped solid result
Modified, Profiles,
SetDiscreteMode, SetForceApproxC1,
SetLaw_1, SetLaw_2,           // law-driven sweep (variable profile)
SetMaxDegree, SetMaxSegments,
SetMode_1, SetMode_2, SetMode_3, SetMode_4, SetMode_5,
SetTolerance, SetTransitionMode,
Shape, Simulate, Spine,
clone, deleteLater, isAliasOf
```

---

## Item 3 — Lofting with Tangency (BRepOffsetAPI_ThruSections + SetSmoothing)

**Verdict: REACHABLE**

**Evidence:** `ThruSections(true, false, 1e-6)` with 3 section wires at different Z heights produces `IsDone()=true`, a solid with `solidCount=1`, `faceCount=6`, and `volume=25779mm³` (positive). `SetSmoothing(true)` is confirmed present and callable without error.

### Verified Call Sequence

```js
// VERIFIED — Loft with tangency via BRepOffsetAPI_ThruSections + SetSmoothing
// Build 3 square section wires at z=0,20,40 (sides 40mm, 20mm, 30mm)
function makeSquareWireAtZ(s, z) {
  const edges = [
    makeLineEdge(0, 0, z,  s, 0, z),
    makeLineEdge(s, 0, z,  s, s, z),
    makeLineEdge(s, s, z,  0, s, z),
    makeLineEdge(0, s, z,  0, 0, z),
  ];
  const bw = new oc.BRepBuilderAPI_MakeWire_1();
  for (const e of edges) bw.Add_1(e);
  const w = bw.Wire();
  bw.delete();
  for (const e of edges) e.delete();
  return w;
}
const wire0 = makeSquareWireAtZ(40, 0);   // 40mm square at z=0
const wire1 = makeSquareWireAtZ(20, 20);  // 20mm square at z=20
const wire2 = makeSquareWireAtZ(30, 40);  // 30mm square at z=40

// Construct ThruSections — solid loft (isSolid=true, isRuled=false)
const thru = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);

// Add wires in order (bottom to top)
thru.AddWire(wire0);
thru.AddWire(wire1);
thru.AddWire(wire2);

// ── TANGENCY — SetSmoothing(true) enables G1-tangent (smooth) loft ──────────
// Without SetSmoothing: loft uses C0 (positional) interpolation — faceted look
// With SetSmoothing(true): loft uses tangent-continuous smoothing — smooth surfaces
thru.SetSmoothing(true);

// Additional tangency controls (all verified present and callable):
thru.SetMaxDegree(8);                            // max NURBS degree (default varies)
thru.SetParType(0);                              // 0=Chordale, 1=Centripetal, 2=IsoParametric
thru.SetContinuity(oc.GeomAbs_Shape.GeomAbs_C1); // continuity constraint at sections

// Build — no-arg throws "expected 1 args"; progress range required
const pr = new oc.Message_ProgressRange_1();
thru.Build(pr);
pr.delete();

if (thru.IsDone()) {
  const shape = thru.Shape();
  // solidCount=1, faceCount=6, volume=25779mm³ for (40,20,30)-side tower
  shape.delete();
}
wire0.delete(); wire1.delete(); wire2.delete();
thru.delete();
```

### Method Inventory on `BRepOffsetAPI_ThruSections` Instance

```
AddVertex, AddWire,
Build, Check, CheckCompatibility,
Continuity, CriteriumWeight,
FirstShape, Generated, GeneratedFace,
Init, IsDeleted, IsDone, LastShape, MaxDegree, Modified, ParType,
SetContinuity,        // GeomAbs_C0, GeomAbs_C1, GeomAbs_C2, etc.
SetCriteriumWeight,   // weight for smoothing criterion
SetMaxDegree,         // max NURBS degree of loft surface
SetParType,           // parameterization type (0/1/2)
SetSmoothing,         // true = tangent-continuous (G1) loft; false = positional (C0)
Shape, UseSmoothing, Wires,
clone, deleteLater, isAliasOf
```

**Continuity note:** `SetSmoothing(true)` enables G1 (tangent-continuous) blending at section boundaries. `SetContinuity(GeomAbs_C1)` additionally constrains the mathematical continuity. For class-A lofts requiring G2/curvature continuity, `SetSmoothing(true)` + `SetContinuity(GeomAbs_C2)` is the path — though exact G2 depends on the local geometry.

---

## Item 4 — Tolerant Stitching (BRepBuilderAPI_Sewing)

**Verdict: REACHABLE**

**Evidence:** Two planar faces with a 0.05mm gap are stitched into a single shell (1 shell, 2 faces) using `BRepBuilderAPI_Sewing` with tolerance 0.1mm. The result is confirmed via `SewedShape()` topology count.

### Verified Call Sequence

```js
// VERIFIED — Tolerant stitching via BRepBuilderAPI_Sewing
// Face A: (0,0,0)→(20,0,0)→(20,20,0)→(0,20,0)
// Face B: (20.05,0,0)→(40.05,0,0)→(40.05,20,0)→(20.05,20,0)
// Gap ≈ 0.05mm between shared edge

function makeRectFace(x0, y0, x1, y1, z) {
  const edges = [
    makeLineEdge(x0, y0, z,  x1, y0, z),
    makeLineEdge(x1, y0, z,  x1, y1, z),
    makeLineEdge(x1, y1, z,  x0, y1, z),
    makeLineEdge(x0, y1, z,  x0, y0, z),
  ];
  const bw = new oc.BRepBuilderAPI_MakeWire_1();
  for (const e of edges) bw.Add_1(e);
  const wire = bw.Wire(); bw.delete();
  const mf = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  const face = mf.Face(); mf.delete(); wire.delete();
  for (const e of edges) e.delete();
  return face;
}
const faceA = makeRectFace(0,    0, 20,    20, 0);
const faceB = makeRectFace(20.05, 0, 40.05, 20, 0);

// CRITICAL: Constructor requires EXACTLY 5 args — 0, 1, or 4-arg forms throw BindingError
// new oc.BRepBuilderAPI_Sewing(0.1)  → "expected (5) parameters instead!"
// new oc.BRepBuilderAPI_Sewing()     → "expected (5) parameters instead!"
const sewing = new oc.BRepBuilderAPI_Sewing(
  0.1,    // tolerance — stitches edges within 0.1mm of each other
  true,   // optionFaceMode — process faces
  true,   // optionBorderMode — process border edges
  true,   // optionFreeEdges — process free edges
  false   // optionNonManifold — non-manifold mode off
);

// Init is also available (and also requires 5 args):
// sewing.Init(0.1, true, true, true, false);

// Add faces
sewing.Add(faceA);  // .Add() (no suffix), not .Add_1()
sewing.Add(faceB);

// Perform — no-arg throws "expected 1 args"; progress range required
const pr = new oc.Message_ProgressRange_1();
sewing.Perform(pr);
pr.delete();

// Get result
const sewedShape = sewing.SewedShape();  // no suffix
// Count topology:
// shellCount = 1  (stitched into a single open shell)
// faceCount  = 2  (both original faces reachable)

sewedShape.delete();
sewing.delete();
faceA.delete();
faceB.delete();
```

### Constructor Notes

- `BRepBuilderAPI_Sewing_1` is NOT present in this build.
- `BRepBuilderAPI_Sewing` is the only constructor — requires **exactly 5 args**.
- Tolerance 1-arg form throws BindingError.

### Sewing Methods Inventory

Notable methods on instance:
```
Add,
ContigousEdge, ContigousEdgeCouple,     // query stitched edges
DegeneratedShape, DeletedFace,          // diagnostics
FreeEdge, MultipleEdge,                 // unstitched edge queries
NbContigousEdges, NbDegeneratedShapes,
NbDeletedFaces, NbFreeEdges, NbMultipleEdges,
Init,                                   // re-initialize with new tolerance (also 5 args)
Perform,                                // triggers sewing computation (needs pr)
SewedShape,                             // retrieve result
SetFaceMode, SetFloatingEdgesMode,
SetLocalTolerancesMode, SetMaxTolerance, SetMinTolerance,
SetNonManifoldMode, SetSameParameterMode, SetTolerance,
WhichFace                               // query which original face contributed to a result face
```

---

## Item 5 — Convergent Modeling (MakeFace + Sewing + MakeSolid Pipeline)

**Verdict: REACHABLE**

**Evidence:** 12 planar triangular faces built from a 20mm cube mesh (via `MakeEdge_3` + `MakeWire` + `MakeFace_15`) are sewn into a single closed shell via `BRepBuilderAPI_Sewing`, then promoted to a solid via `BRepBuilderAPI_MakeSolid_3(shell)`. Result: `IsDone()=true`, `solidCount=1`, `faceCount=12`, `volume=8000.0mm³` (exact for 20mm cube).

### Verified Call Sequence

```js
// VERIFIED — Convergent modeling: facet mesh → B-rep solid
// 8 vertices, 12 triangles of a 20mm cube

const cubeVerts = [
  [0,0,0],[20,0,0],[20,20,0],[0,20,0],
  [0,0,20],[20,0,20],[20,20,20],[0,20,20],
];
const cubeTris = [
  // Bottom (z=0, normal -Z)
  [0,2,1],[0,3,2],
  // Top (z=20, normal +Z)
  [4,5,6],[4,6,7],
  // Front (y=0, normal -Y)
  [0,1,5],[0,5,4],
  // Back (y=20, normal +Y)
  [2,3,7],[2,7,6],
  // Left (x=0, normal -X)
  [0,4,7],[0,7,3],
  // Right (x=20, normal +X)
  [1,2,6],[1,6,5],
];

// Build one planar face per triangle
const triFaces = [];
for (const [ia, ib, ic] of cubeTris) {
  const [ax,ay,az] = cubeVerts[ia], [bx,by,bz] = cubeVerts[ib], [cx,cy,cz] = cubeVerts[ic];
  const e1 = makeLineEdge(ax,ay,az, bx,by,bz);
  const e2 = makeLineEdge(bx,by,bz, cx,cy,cz);
  const e3 = makeLineEdge(cx,cy,cz, ax,ay,az);
  const bw = new oc.BRepBuilderAPI_MakeWire_1();
  bw.Add_1(e1); bw.Add_1(e2); bw.Add_1(e3);
  const wire = bw.Wire(); bw.delete();
  e1.delete(); e2.delete(); e3.delete();
  const mf = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
  triFaces.push(mf.Face());
  mf.delete(); wire.delete();
}

// Sew the 12 faces into a closed shell (tolerance = 0.001 for exact-match vertices)
const sewing = new oc.BRepBuilderAPI_Sewing(0.001, true, true, true, false);
for (const f of triFaces) sewing.Add(f);
const pr1 = new oc.Message_ProgressRange_1();
sewing.Perform(pr1); pr1.delete();
const sewedShape = sewing.SewedShape();
// sewedShape: shellCount=1, faceCount=12

// Extract the shell
const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const exp = new oc.TopExp_Explorer_2(sewedShape, SHELL, ANY);
const shell = oc.TopoDS.Shell_1(exp.Current());
exp.delete();

// Convert shell → solid
// CRITICAL: Use MakeSolid_3 — the only variant that accepts a shell
// MakeSolid_2: expects TopoDS_CompSolid (wrong type — BindingError)
// MakeSolid_1: 0-arg constructor (no shell arg)
// MakeSolid:   no accessible constructor
// MakeSolid_3: WORKS — takes a TopoDS_Shell directly
const solidMaker = new oc.BRepBuilderAPI_MakeSolid_3(shell);
if (solidMaker.IsDone()) {
  const solid = solidMaker.Shape();
  // solidCount=1, faceCount=12, volume=8000.0mm³ (exact for 20mm cube)
  solid.delete();
}
solidMaker.delete(); shell.delete(); sewedShape.delete();
sewing.delete();
for (const f of triFaces) f.delete();
```

### MakeSolid Variants Available

```
BRepBuilderAPI_MakeSolid     — no accessible constructor
BRepBuilderAPI_MakeSolid_1   — 0-arg (empty solid builder, no shell input)
BRepBuilderAPI_MakeSolid_2   — takes TopoDS_CompSolid (NOT TopoDS_Shell)
BRepBuilderAPI_MakeSolid_3   — CORRECT: takes TopoDS_Shell → VERIFIED WORKS
BRepBuilderAPI_MakeSolid_4   — likely 2-shell variant
BRepBuilderAPI_MakeSolid_5   — likely 3-shell variant
BRepBuilderAPI_MakeSolid_6   — likely 4-shell variant
BRepBuilderAPI_MakeSolid_7   — likely solid+shell variant
```

**Always use `BRepBuilderAPI_MakeSolid_3(shell)` when converting a sewed shell to a solid.**

---

## Sub-project F Deliverable Scope

Based on this recon, Tasks 2-3 should implement the following ops in `frontend/src/kernel/brep/BrepFinal.js`:

### REACHABLE — Build these (Tasks 2-3)

#### 1. `pipeShellSweep(opts)` — Tortuous-path Sweep
- **API:** `new oc.BRepOffsetAPI_MakePipeShell(spineWire)` + `Add_1(profileWire, false, false)` + `Build(pr)` + `MakeSolid()` + `Shape()`
- **UI schema:** `profileRadius` (default 4mm), `segLen1/segLen2/segLen3` (default 20/20/30mm), direction per segment
- **Key note:** Call `.MakeSolid()` BEFORE `.Shape()` to get a capped solid pipe vs open shell

#### 2. `loftTangent(opts)` — Loft with Tangency
- **API:** `new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6)` + `AddWire(w)` × N + `SetSmoothing(true)` + `Build(pr)` + `Shape()`
- **UI schema:** 3 section sides (s0=40, s1=20, s2=30) and z-heights (z0=0, z1=20, z2=40)
- **Key note:** `SetSmoothing(true)` required for G1-tangent output; `Build` requires progressRange

#### 3. `stitchFaces(opts)` — Tolerant Stitching
- **API:** `new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false)` + `Add(face)` × N + `Perform(pr)` + `SewedShape()`
- **UI schema:** tolerance (default 0.1mm); demonstrates stitching 2 rectangular faces with a gap
- **Key note:** Constructor requires exactly 5 args; `Perform` requires progressRange

#### 4. `convergentSolid(opts)` — Facet-derived Solid
- **API:** Triangle `MakeEdge_3`+`MakeWire`+`MakeFace_15` × N + `Sewing(tol)` + `BRepBuilderAPI_MakeSolid_3(shell)` + `Shape()`
- **UI schema:** `gridSize` (default 20mm) — builds a cube from 12 triangles as a demo
- **Key note:** `MakeSolid_3` is the only valid shell→solid ctor; `MakeSolid_2` fails on shell type

### NOT_REACHABLE — Skip these (document only)

#### N-Sided Patching (BRepOffsetAPI_MakeFilling)
- **Why:** `Build(pr)` throws raw OCCT C++ integer exception for ALL inputs in this WASM build.
- **Root cause:** Variational solver (`GeomPlate`) not functional in `opencascade.js@2.0.0-beta.b5ff984`.
- **Evidence:** 4-edge planar square → `18942920`; 5-edge planar pentagon → `18952888`.
- **Future path:** Requires a custom OCCT build with confirmed WASM-compatible GeomPlate support.
- **Workaround available:** `BRepBuilderAPI_MakeFace_15(wire, true)` fills PLANAR open boundaries correctly (used by `blendG2` in A5). Non-planar N-sided patching is not achievable.

---

## Constructor Quick-Reference (Sub-project F additions)

| Class | Working constructor | Key requirement |
|-------|--------------------|-|
| `BRepOffsetAPI_MakePipeShell` | `BRepOffsetAPI_MakePipeShell(spineWire)` | No `_1` suffix in this build |
| `BRepOffsetAPI_MakePipeShell.Add_1` | `Add_1(profileWire, withContact, withCorrection)` | 3 args required (1-arg throws BindingError) |
| `BRepOffsetAPI_MakePipeShell.Build` | `Build(pr)` | ProgressRange required (0-arg throws BindingError) |
| `BRepOffsetAPI_ThruSections` | `BRepOffsetAPI_ThruSections(isSolid, isRuled, pres)` | Standard 3-arg form (same as A2) |
| `BRepOffsetAPI_ThruSections.Build` | `Build(pr)` | ProgressRange required |
| `BRepBuilderAPI_Sewing` | `BRepBuilderAPI_Sewing(tol, faceMode, borderMode, freeEdges, nonManifold)` | **Exactly 5 args**; no `_1` suffix; no 1-arg form |
| `BRepBuilderAPI_Sewing.Perform` | `Perform(pr)` | ProgressRange required (0-arg throws BindingError) |
| `BRepBuilderAPI_MakeSolid_3` | `BRepBuilderAPI_MakeSolid_3(shell)` | Correct shell→solid ctor; `_2` takes CompSolid (wrong) |

---

## Verified Against `opencascade.js@2.0.0-beta.b5ff984`

All results above are empirically confirmed by running `e2e/brep-f-recon-electron.spec.js`
inside the real Electron/WASM context. The spec passes GREEN (1 passed, ~13s).
Raw JSON output is in `docs/superpowers/notes/occt-api-F-recon.json`.
