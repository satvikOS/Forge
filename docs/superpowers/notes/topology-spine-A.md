# Topology-Spine Binding Recon — SP-1 Stage S0

**Date:** 2026-05-22
**Package:** `opencascade.js@2.0.0-beta.b5ff984` (the B-rep engine behind the spine)
**Source:** `e2e/spine-recon-electron.spec.js` run against the real Electron app
**Raw output:** `docs/superpowers/notes/topology-spine-recon.json`

SP-1 promotes `kernel/topology/` to THE topology model of the ArchDisc kernel —
a persistent `Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex` spine — with the
B-rep engine sitting *behind* it as the geometry provider. `bindSpine` walks a
`TopoDS_Shape` and builds the full spine graph. This note records, empirically,
whether every binding that walk needs is reachable in this engine build.

## Verdict summary — 5/6 probes REACHABLE

- **Ancestry-map binding tier:** **NONE**
- **O(n²) traversal fallback:** **REQUIRED** for: all edges

Tier meaning: **FULL** = the ancestry map + a list iterator are bound, `bindSpine` uses the map outright. **PARTIAL** = the map and `TopTools_ListOfShape` `Size()`/`First()`/`Last()` are bound but the `TopTools_ListIteratorOfListOfShape` class is **not** — so the map is used as a fast-path for manifold edges (≤2 owning faces, fully recovered by `First`/`Last`), and the O(n²) per-face `IsSame` fallback is used for non-manifold edges (>2 owning faces). **NONE** = the map is unusable, the fallback is used for every edge.

## Probe 1 — Sub-shape traversal (`TopExp_Explorer`)

**Verdict: REACHABLE**

TopExp_Explorer_2 walks all 6 levels of a fuse result: solids=1 shells=1 faces=10 wires=10 edges=20 verts=12 (unique, IsSame-deduped). Raw edge hits=40 (each edge visited once per owning face).

Verified call sequence (copy-paste safe for S1):

```js
const SHAPE = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, SHAPE);
for (; exp.More(); exp.Next()) { const f = exp.Current(); /* IsSame-dedup */ }
exp.delete();
```

## Probe 2 — Ancestry maps (`MapShapesAndAncestors`) — HIGHEST RISK

**Verdict: NOT_REACHABLE**

Ancestry-map binding NOT usable. mapBuilt=true, listStrategy=listAccessor:Size, membersRetrievable=false. S1 uses the O(n^2) per-face TopExp IsSame-pairing fallback for ALL edges. Detail: {"mapClassKeys":["TopTools_IndexedDataMapOfShapeListOfShape","TopTools_IndexedDataMapOfShapeListOfShape_1","TopTools_IndexedDataMapOfShapeListOfShape_2","TopTools_IndexedDataMapOfShapeListOfShape_3"],"listIterKeys":[],"listClassKeys":["TopTools_ListOfShape","TopTools_ListOfShape_1","TopTools_ListOfShape_2","TopTools_ListOfShape_3"],"hasTopExp":true

Verified call sequence (copy-paste safe for S1):

```js
// MANIFOLD fast-path (TopTools_ListOfShape.Size/First/Last — verified bound):
const map = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
oc.TopExp.MapShapesAndAncestors(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
const lst = map.FindFromIndex(i);
const n = lst.Size();
if (n <= 2) { const faces = n === 2 ? [lst.First(), lst.Last()] : (n === 1 ? [lst.First()] : []); }
// NON-MANIFOLD edge (n > 2): the iterator class is UNBOUND — fall to:
// O(n^2) per-face TopExp IsSame pairing (buildAncestryMapFallback).
```

## Probe 3 — Shape identity (`HashCode` / `IsSame` / `IsEqual`)

**Verdict: REACHABLE**

Shape identity reachable: HashCode(INT_MAX) returns a stable integer per sub-shape (6 faces, hashes [19302241,19290601,19323737,19326185,19306625,19316145] identical across two walks), IsSame=true, IsEqual=true. geomRef keys on HashCode+IsSame.

Verified call sequence (copy-paste safe for S1):

```js
const hash = subShape.HashCode(2147483647);  // stable integer key
a.IsSame(b)   // same TShape + same location, orientation-independent
a.IsEqual(b)  // IsSame AND same orientation
```

## Probe 4 — Geometry extraction (`BRep_Tool`)

**Verdict: REACHABLE**

Geometry extraction reachable: BRep_Tool.Surface_2 → Handle_Geom_Surface (raw Geom_CylindricalSurface); BRep_Tool.Pnt → vertex point {"x":12,"y":-2.9391523179536475e-15,"z":30}; curve via Curve_2 ok=true. Spine Surface/Curve/Point adapters delegate to these.

Verified call sequence (copy-paste safe for S1):

```js
const surfH = oc.BRep_Tool.Surface_2(face);   // Handle_Geom_Surface
const raw = surfH.get();  raw.D0(u, v, gpPnt);
const pnt = oc.BRep_Tool.Pnt(vertex);          // gp_Pnt
```

## Probe 5 — Ordered loop traversal (`BRepTools_WireExplorer`)

**Verdict: REACHABLE**

Ordered loop traversal reachable: BRepTools.OuterWire returns the outer wire; BRepTools_WireExplorer_2(1 arg) walks it in coedge order (4 edges on a box face, orientations [0,0,1,1]). bindSpine builds ordered Loop→Coedge cycles.

Verified call sequence (copy-paste safe for S1):

```js
const wire = oc.BRepTools.OuterWire_1(face);
const we = new oc.BRepTools_WireExplorer_2(wire, face);
for (; we.More(); we.Next()) { const coedge = we.Current(); /* ordered */ }
we.delete();
```

## Probe 6 — Non-manifold coedge counting

**Verdict: REACHABLE**

Non-manifold coedge counting reachable: the edge→face ancestry map gives faces-per-edge for every edge of a fuseNonManifold(box,box stacked) result (20 edges, max faces/edge=4, histogram {"2":16,"4":4}). nonManifoldEdgePresent=true. bindSpine flags an Edge non-manifold when its coedge count >2 and builds a radial cycle.

> fuseNonManifold may or may not yield a >2-face edge for stacked boxes (OCCT BOP can unify coplanar faces). The probe confirms the COUNTING mechanism works; non-manifold geometry counting is the same code path.

## Consequence for S1 (`bindSpine`)

The ancestry-map binding is **absent**. `bindSpine` MUST use the O(n²)
`IsSame`-pairing fallback (`buildAncestryMapFallback` in `bindSpine.js`):
for each edge, scan every face and test `face owns edge` via per-face
`TopExp_Explorer`. Correct but O(faces×edges); flagged as a known
performance limit for GE9X-scale bodies and a custom engine build escalation.
