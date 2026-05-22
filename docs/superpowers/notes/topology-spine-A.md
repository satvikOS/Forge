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

## Verdict summary — 6/6 probes REACHABLE

- **Ancestry-map binding tier:** **PARTIAL**
- **O(n²) traversal fallback:** **REQUIRED** for: non-manifold edges only (>2 owning faces)

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

**Verdict: REACHABLE**

Ancestry maps PARTIALLY bound — the IMPORTANT empirical finding. TopExp.MapShapesAndAncestors is bound; TopTools_IndexedDataMapOfShapeListOfShape_1 is bound (edge→face map Extent=12, correct); the TopTools_ListOfShape it yields exposes .Size()/.First()/.Last(). BUT the TopTools_ListIteratorOfListOfShape class is UNBOUND (listIterKeys=[]). So for a MANIFOLD edge (exactly 2 owning faces) the map + First/Last gives the full ancestor set — bindSpine uses the map fast-path. For a NON-MANIFOLD edge (>2 owning faces) First/Last cannot enumerate all members, so bindSpine MUST use the O(n^2) per-face TopExp IsSame fallback (`buildAncestryMapFallback`) on those. This is the SP-1-designed degrade path — implemented as a real, documented code branch, not a silent drop. Box edge→face [2,2,2,2,2,2,2,2,2,2,2,2], vertex→edge [6,6,6,6,6,6,6,6].

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

Shape identity reachable: HashCode(INT_MAX) returns a stable integer per sub-shape (6 faces, hashes [19291865,19290737,19026881,19326377,19306793,19316249] identical across two walks), IsSame=true, IsEqual=true. geomRef keys on HashCode+IsSame.

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
const wire = oc.BRepTools.OuterWire(face);
const we = new oc.BRepTools_WireExplorer_2(wire);  // verified: BRepTools_WireExplorer_2(1 arg)
for (; we.More(); we.Next()) {
  const orientedEdge = we.Current();   // ordered, oriented as used by the loop
  const startVertex  = we.CurrentVertex();  // vertex at the START of this edge
}
we.delete();
```

## Probe 6 — Non-manifold coedge counting

**Verdict: REACHABLE**

Non-manifold coedge counting reachable: the edge→face ancestry map gives faces-per-edge for every edge of a fuseNonManifold(box,box stacked) result (20 edges, max faces/edge=4, histogram {"2":16,"4":4}). nonManifoldEdgePresent=true. bindSpine flags an Edge non-manifold when its coedge count >2 and builds a radial cycle.

> fuseNonManifold may or may not yield a >2-face edge for stacked boxes (OCCT BOP can unify coplanar faces). The probe confirms the COUNTING mechanism works; non-manifold geometry counting is the same code path.

## Consequence for S1 (`bindSpine`)

The ancestry-map binding is **partially present** — this is the empirical
finding that shapes S1:

- `TopExp::MapShapesAndAncestors` — **bound**.
- `TopTools_IndexedDataMapOfShapeListOfShape_1` — **bound** (the map container).
- `TopTools_ListOfShape` (what `FindFromIndex` yields) — **bound**, exposes
  `.Size()`, `.First()`, `.Last()`.
- `TopTools_ListIteratorOfListOfShape` (any suffix) — **NOT bound**
  (`listIterKeys` is empty) — mirrors the documented `gp_Pnt2d` gap.

`bindSpine` therefore implements **two real code paths** (`bindSpine.js`):

1. **Manifold fast-path** — for an edge whose `TopTools_ListOfShape` has
   `.Size() <= 2`, `First()`/`Last()` recover the full owning-face set. This is
   every edge of a watertight manifold solid → the map fast-path covers the
   common case in O(n).
2. **O(n²) `IsSame`-pairing fallback** (`buildAncestryMapFallback`) — for any
   edge with `.Size() > 2` (a non-manifold edge), `First()`/`Last()` cannot
   enumerate all members, so `bindSpine` scans every face with a per-face
   `TopExp_Explorer` and pairs by `IsSame`. Correct, deterministic, O(faces×
   edges) — invoked only for the non-manifold subset. This is the SP-1-designed
   degrade path, shipped as a documented branch — **not** a silent drop.

Honest performance note: for GE9X-scale non-manifold bodies the fallback
subset could be a cost; a custom engine build (Docker-gated) that binds
`TopTools_ListIteratorOfListOfShape` would remove it. Monitored from S1 on.
