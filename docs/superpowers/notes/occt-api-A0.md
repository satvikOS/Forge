# OCCT API Reconnaissance — Phase A0

**Date:** 2026-05-19
**Package:** `opencascade.js@2.0.0-beta.b5ff984`
**Source:** `e2e/brep-occt-load-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/occt-api-A0-recon.json`
**Status:** ALL ITEMS EMPIRICALLY VERIFIED — spec passes GREEN

All call signatures below were confirmed by actually executing them inside the Electron
app's WASM context and asserting on the results (volume=1000 mm³, 6 faces, 24 edge
hits, bbox corners, non-zero triangle count). Copy-paste safe for Tasks 5-7.

---

## Item 1 — Box Constructor

**Verified overload:** `BRepPrimAPI_MakeBox_2(dx, dy, dz)`

The C++ declaration order in opencascade.js 2.0.0-beta.b5ff984 is:

| Suffix | Constructor signature                          |
|--------|------------------------------------------------|
| `_1`   | `()` — no-arg default                          |
| `_2`   | `(dx, dy, dz)` — canonical box by dimensions  |
| `_3`   | `(P: gp_Pnt, dx, dy, dz)`                     |
| `_4`   | `(P1: gp_Pnt, P2: gp_Pnt)` — two corners      |
| `_5`   | `(Axes: gp_Ax2, dx, dy, dz)`                  |

> The old note claimed `_1` was `(dx,dy,dz)`. That was wrong. `_1` is the
> no-arg default constructor. **Use `_2`.**

```js
// VERIFIED
const box   = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
const shape = box.Shape();   // TopoDS_Shape, non-null
// …use shape…
shape.delete();
box.delete();
```

---

## Item 2 — Volume Measurement

**Verified method:** `oc.BRepGProp.VolumeProperties_1(shape, props, onlyClosed, skipShared, useTriangulation)`

The full static method table on `oc.BRepGProp`:

| Method                  | Signature                                                       |
|-------------------------|-----------------------------------------------------------------|
| `LinearProperties`      | `(S, LProps, skipShared, useTriangulation) → void`             |
| `SurfaceProperties_1`   | `(S, SProps, skipShared, useTriangulation) → void`             |
| `SurfaceProperties_2`   | `(S, SProps, eps, skipShared) → Standard_Real`                 |
| `VolumeProperties_1`    | `(S, VProps, onlyClosed, skipShared, useTriangulation) → void` |
| `VolumeProperties_2`    | `(S, VProps, eps, onlyClosed, skipShared) → Standard_Real`     |
| `VolumePropertiesGK_1`  | full GK variant (more params)                                   |
| `VolumePropertiesGK_2`  | with plane                                                      |

`GProp_GProps_1()` is the no-arg constructor (the simpler choice; `_2` takes a `gp_Pnt` system location).

```js
// VERIFIED — returns 999.9999999999998 for a 10mm box (~1000 mm³)
const props = new oc.GProp_GProps_1();
oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
const volume = props.Mass();   // 1000.0 mm³ for 10×10×10 box
props.delete();
```

---

## Item 3 — Face Count and Edge Count

**Verified:** `TopExp_Explorer_2(S, ToFind, ToAvoid)` — the 3-arg overload.

`_1` is no-arg, `_2` takes all three params. Pass `oc.TopAbs_ShapeEnum.TopAbs_SHAPE`
as `ToAvoid` to avoid no filtering.

**Edge deduplication caveat:** `TopExp_Explorer` without deduplication visits each
shared edge once per owning shape. A box has 12 unique edges, but `TopExp_Explorer_2`
traversing `TopAbs_EDGE` returns **24 hits** (each shared between 2 adjacent faces).
To get unique edges, call `shape.IsSame(other)` to deduplicate, or track
`shape.HashCode(MAX_INT)`.

```js
// VERIFIED — 6 faces, 24 edge-hits (=12 unique edges x2)
const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;  // no avoidance

// Count faces
let faceCount = 0;
const faceExp = new oc.TopExp_Explorer_2(shape, FACE, ANY);
for (; faceExp.More(); faceExp.Next()) {
  const face = oc.TopoDS.Face_1(faceExp.Current());
  faceCount++;
  face.delete();
}
faceExp.delete();
// faceCount === 6  ✓

// Count edges (raw hits, not deduplicated)
let edgeCount = 0;
const edgeExp = new oc.TopExp_Explorer_2(shape, EDGE, ANY);
for (; edgeExp.More(); edgeExp.Next()) {
  edgeCount++;
}
edgeExp.delete();
// edgeCount === 24  (12 unique × 2)  ✓
```

`oc.TopoDS.Face_1(shape)` casts a `TopoDS_Shape` to `TopoDS_Face`.
`oc.TopoDS.Edge_1(shape)` casts to `TopoDS_Edge`.

---

## Item 4 — Bounding Box

**Verified:** `new oc.Bnd_Box_1()` (no-arg constructor); `oc.BRepBndLib.Add(shape, bbox, useTriangulation)`; `CornerMin()` / `CornerMax()` return `gp_Pnt` with `.X()/.Y()/.Z()`.

The bounding box is expanded by a tolerance (~1e-7 mm) — min comes back as
`(-1e-7, -1e-7, -1e-7)` and max as `(10.0000001, 10.0000001, 10.0000001)` for a 10mm
box. Use `Math.abs(val) < 0.01` style comparisons, not strict equality.

```js
// VERIFIED — min≈(0,0,0), max≈(10,10,10) within 1e-7 mm tolerance
const bbox = new oc.Bnd_Box_1();
oc.BRepBndLib.Add(shape, bbox, true);  // true = useTriangulation
const pmin = bbox.CornerMin();
const pmax = bbox.CornerMax();
const minX = pmin.X(), minY = pmin.Y(), minZ = pmin.Z();
const maxX = pmax.X(), maxY = pmax.Y(), maxZ = pmax.Z();
pmin.delete();
pmax.delete();
bbox.delete();
```

`BRepBndLib` also provides `AddOptimal(shape, bbox, useTriangulation, useShapeTolerance)`
if tighter bounds are needed, but `Add` is sufficient for most uses.

---

## Item 5 — Tessellation

**Verified:** all steps below confirmed against a 10mm box (24 nodes, 12 triangles across 6 faces).

### Step A: Mesh the shape

```js
// VERIFIED
// BRepMesh_IncrementalMesh_2(shape, linDeflection, isRelative, angDeflection, isInParallel)
const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
mesh.delete();   // mesh object itself can be deleted; tessellation is stored on the shape
```

Overloads: `_1` = no-arg; `_2` = full 5-param (confirmed working); `_3` = params struct.

### Step B: Read triangulation per face

```js
// VERIFIED
const loc = new oc.TopLoc_Location_1();   // identity location

const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const faceExp = new oc.TopExp_Explorer_2(shape, FACE, ANY);

for (; faceExp.More(); faceExp.Next()) {
  const face = oc.TopoDS.Face_1(faceExp.Current());

  // BRep_Tool.Triangulation(face, location, meshPurpose)
  // meshPurpose = 0 (integer) means "any purpose" — no Poly_MeshPurpose enum needed
  const handleTri = oc.BRep_Tool.Triangulation(face, loc, 0);
  if (!handleTri || handleTri.IsNull()) { face.delete(); continue; }

  const tri = handleTri.get();          // Poly_Triangulation*
  const nbNodes = tri.NbNodes();        // e.g. 4 per face on box
  const nbTris  = tri.NbTriangles();    // e.g. 2 per face on box

  // Read a node (1-indexed)
  const pt = tri.Node(1);               // gp_Pnt
  const x = pt.X(), y = pt.Y(), z = pt.Z();
  // pt is a value type returned inline — no .delete() needed for Node()

  // Read a triangle (1-indexed)
  const t = tri.Triangle(1);            // Poly_Triangle
  const n1 = t.Value(1);               // vertex index 1  (1-based)
  const n2 = t.Value(2);               // vertex index 2
  const n3 = t.Value(3);               // vertex index 3
  // t is a value type — no .delete() needed for Triangle()

  // Face orientation (for winding order correction)
  const ori = face.Orientation_1();     // TopAbs_Orientation enum object
  // Compare: ori === oc.TopAbs_Orientation.TopAbs_REVERSED (reverse winding if true)

  handleTri.delete();
  face.delete();
}

faceExp.delete();
loc.delete();
```

### Observed values for 10mm box

| Metric      | Observed |
|-------------|----------|
| Total nodes | 24       |
| Total tris  | 12       |
| Per face    | 4 nodes, 2 tris |
| Sample tri  | indices [2, 1, 3] (1-based) |

### Key type facts

- `BRep_Tool.Triangulation` takes **3 args**: `(TopoDS_Face, TopLoc_Location, int/Poly_MeshPurpose)`.  
  Pass `0` as the third arg — it accepts a raw integer for the mesh-purpose enum.
- Returns `Handle_Poly_Triangulation`; call `.get()` to unwrap to `Poly_Triangulation*`.
- `tri.Node(i)` returns `gp_Pnt` by value (no `.delete()` needed).
- `tri.Triangle(i)` returns `Poly_Triangle` by value (no `.delete()` needed).
- `t.Value(1..3)` returns the 1-based vertex index as an integer.

---

## General Memory Rules

Every object created with `new oc.Xyz(...)` leaks WASM heap unless `.delete()` is called.
Objects returned by value from methods (e.g. `gp_Pnt` from `Node()`, `Poly_Triangle` from
`Triangle()`) do **not** need `.delete()`. Handle wrappers (`Handle_Poly_Triangulation`)
**do** need `.delete()`.

---

## Constructor Overload Convention

`_1` is always the first C++ constructor in declaration order — which is almost always
the no-arg or simplest default constructor. The useful parameterized constructors start
at `_2`. Do not call the bare undecorated name (e.g. `new oc.BRepPrimAPI_MakeBox()`) —
that is the abstract base class.

---

## Binding Surface

- Total named properties on `oc`: **24,878**
- WASM size: ~50 MB (`opencascade.full.wasm`)
- `window.__archdiscKernel.getOCCT()` caches the singleton; subsequent calls are instant
