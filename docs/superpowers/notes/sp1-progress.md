# SP-1 — Unified Topology Spine — Progress

Tracking the staged execution of `docs/superpowers/plans/2026-05-22-sp1-topology-spine.md`.

| Stage | Status | Date | Notes |
|---|---|---|---|
| **S0** — recon spec + spine scaffold | **DONE** | 2026-05-22 | see below |
| **S1** — `bindSpine` (OCCT → spine Body) | **DONE** | 2026-05-22 | see below |
| S2 — `SpineBody` + migration adapter; first op | not started | | |
| S3 — primitives + booleans + transforms; ID carry-through | not started | | |
| S4 — features + local ops + surfacing | not started | | |
| S5 — body-kind taxonomy + non-manifold first-class | not started | | |
| S6 — unify native analytic faces into spine faces | not started | | |
| S7 — topology-inspector UI + Model C quarantine | not started | | |

---

## S0 — recon spec + spine scaffold — DONE (2026-05-22)

### The recon finding — the binding-gap is REAL

`e2e/spine-recon-electron.spec.js` probed, against the live B-rep engine inside
the real Electron app, the six binding families `bindSpine` needs. Result:
**5/6 REACHABLE**, with one **real binding gap** — exactly the documented risk
(mirrors the `gp_Pnt2d` gap):

| Probe | Verdict | Finding |
|---|---|---|
| 1 — `TopExp_Explorer` (6 levels) | **REACHABLE** | walks SOLID/SHELL/FACE/WIRE/EDGE/VERTEX of a fuse result; counts sane (1 solid, 1 shell, 10 faces, 20 edges, 12 verts). |
| 2 — ancestry maps | **NOT_REACHABLE** | the gap — see below. |
| 3 — `HashCode`/`IsSame`/`IsEqual` | **REACHABLE** | `HashCode(INT_MAX)` returns a stable integer per sub-shape, identical across two walks; `IsSame`/`IsEqual` work. |
| 4 — `BRep_Tool` geometry extraction | **REACHABLE** | `Surface_2` → `Handle_Geom_Surface`; `Pnt` → vertex point; `Curve_2` ok. |
| 5 — `BRepTools_WireExplorer` | **REACHABLE** | `BRepTools.OuterWire` + `BRepTools_WireExplorer_2(wire)` **1-arg form** walks a loop in coedge order. |
| 6 — non-manifold coedge counting | **REACHABLE** | `fuseNonManifold` of two stacked boxes → a real non-manifold result; the edge→face map gives faces-per-edge histogram `{2:16, 4:4}` — a >2-face edge IS observable. |

**The gap (probe 2), precisely:**
`TopExp::MapShapesAndAncestors` IS bound; `TopTools_IndexedDataMapOfShapeListOfShape_1`
IS bound (builds a correct 12-edge map). BUT:
- `TopTools_ListIteratorOfListOfShape` — **every suffix UNBOUND** (`listIterKeys` empty).
- the `TopTools_ListOfShape` that `FindFromIndex` yields exposes `.Size()` (a
  count) but **no usable member accessor** — `.First()` did not work.

So the ancestry map yields face **counts** but not face **identities**. This is
enough for the non-manifold *count* check (probe 6 used `.Size()`), but NOT
enough to wire coedge partners — `bindSpine` needs the actual ancestor faces.

**Consequence for S1, recorded in `docs/superpowers/notes/topology-spine-A.md`:**
`bindSpine` uses the SP-1-designed **O(n²) `IsSame`-pairing fallback** to recover
edge→face adjacency — for each spine face, walk its engine sub-face's edges with
a per-face `TopExp_Explorer` and pair to spine edges by `IsSame`. Correct,
deterministic, O(faces × edgesPerFace). Implemented as a real, documented branch
(`buildAdjacencyFallback` in `bindSpine.js`), with the map fast-path
(`buildAdjacencyFromMap`) kept for a future engine build that binds the iterator.

Recon artifacts: `docs/superpowers/notes/topology-spine-recon.json` (raw) +
`docs/superpowers/notes/topology-spine-A.md` (engineering note).

### The spine scaffold

New `kernel/topology/` modules — the `Body→Lump→Shell→Face→Loop→Coedge→Edge→
Vertex` entity classes, persistent-ID allocation, validator:

- `IdAllocator.js` — per-body persistent-ID namespace (`b3:f17` style), monotone,
  high-water resumable. Replaces the global `_faceId++` counters.
- `Vertex.js`, `Edge.js`, `Loop.js`, `Face.js`, `Shell.js` — adapted from the
  pre-spine `Topo*` classes, extended with `persistentId`/`transientId`,
  `geomRef`, `tolerance`, body back-refs, and the spine semantics.
- `Coedge.js` — NEW first-class directed-edge-use (ACIS COEDGE / Parasolid FIN);
  promotes `TopoLoop`'s raw `{edge,reversed}` tuples; carries `partner` + `pcurve`.
- `Lump.js` — NEW connected-chunk entity (ACIS LUMP) between Body and Shell.
- `Body.js` — NEW root (ACIS BODY); owns the `IdAllocator`, the lump list, the
  `kind` discriminator, `geomEngineShape` ref; `deriveKind`/`assertKind`,
  `eulerCharacteristic`, `checkEulerPoincare`.
- `Pcurve.js` — re-exports the existing B-spline pcurve + a new `LinearPcurve`.
- `validateSpine.js` — Euler-Poincaré + 8 structural-invariant checks.
- `index.js` — the spine barrel.

S0 is **purely additive**: no op constructs a spine entity yet. The pre-spine
`Topo*` classes are untouched (the analytic-face side-car still works).

Verified by `e2e/spine-scaffold-electron.spec.js` (headed Electron, motion-
capture): builds a real Box via the ribbon, then hand-builds a unit-cube spine
`Body` (8 V, 12 E, 24 coedges, 6 F, 6 loops, 1 shell, 1 lump, solid) — asserts
`validateSpine().ok`, `χ === 2`, `genusImplied === 0`, body-namespaced ids; and
proves the validator catches a defect (a kind-lying spine FAILS with precise
errors). Green.

---

## S1 — `bindSpine`: OCCT shape → spine Body — DONE (2026-05-22)

### Deliverable

`kernel/topology/bindSpine.js` — a pure function `(oc, TopoDS_Shape, opts) →
validated spine Body`. It walks the engine shape and constructs the full
`Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex` graph, each entity
`geomRef`-linked to its engine sub-shape, persistent ids assigned, then runs
`validateSpine`. It only READS the shape — never mutates it — so it cannot
regress geometry. Plus `kernel/topology/geomAdapters.js` — the lazy
`OcctSurfaceAdapter`/`OcctCurveAdapter` delegating `pointAt`/`normalAt` to
`BRep_Tool`.

### The `bindSpine` algorithm

1. **Vertex / Edge / Face caches** keyed by `HashCode`, `IsSame`-verified on
   collision — one spine entity per unique engine sub-shape.
2. **Top-level dispatch by shape type:** SOLID-bearing → one `Lump` per solid
   (multi-lump compounds handled); free SHELL → sheet body; free FACE → sheet
   body; pure WIRE/EDGE → wire body (faceless shell of wire edges).
3. **Loops** built with `BRepTools_WireExplorer_2(wire)` (the recon-verified
   1-arg form) for ordered coedge cycles; an unordered-explorer + endpoint-
   chaining fallback if WireExplorer fails.
4. **Edge→face adjacency** via `buildEdgeFaceAdjacency`: probes whether the
   ancestry map yields list MEMBERS; on this engine build it does not (the S0
   gap), so the **O(n²) `IsSame`-pairing fallback** runs — a real, documented
   branch, not a silent drop. `body.diagnostics.bind.adjacencyStrategy` records
   which path ran.
5. **Coedge partners** wired from the adjacency: manifold edge (2 coedges) →
   mutual partners; non-manifold edge (>2) → a radial cycle (each coedge linked
   to the next — stable but, per SP-1 §7 risk 2, *not* yet angularly ordered, a
   documented S5 refinement); free edge → null partner.
6. **Shell roles** classified peripheral vs void (largest-area heuristic when
   `BRepClass3d.OuterShell` is unavailable).
7. **Body kind** derived + asserted; `validateSpine` run, report attached.

Edge cases handled: degenerate edges (`BRep_Tool.Degenerated`), non-manifold
topology, empty/open shells, reversed face orientations, multi-lump compounds.

### Verification

`e2e/spine-bind-electron.spec.js` (headed Electron, motion-capture): builds each
primitive (box/cylinder/sphere/cone/torus) and fuse/cut/common/fuseNonManifold
via the real Part-tab ribbon, captures slow-mo video + multi-angle stills, then
`bindSpine`s each result and asserts spine entity counts against independent
`TopExp` counts, `checkEulerPoincare().ok`, and (non-manifold case) a >2-coedge
edge. S1 is additive — no op calls `bindSpine` in production yet; it is
exercised only by e2e. Full pre-existing suite: no regression.

### Risks carried into S2

- **Performance** — the O(n²) adjacency fallback is per-body; for GE9X-scale
  non-manifold bodies it could cost. Monitored; a custom engine build that binds
  `TopTools_ListIteratorOfListOfShape` removes it.
- **Non-manifold radial order** — S1 ships an unordered (but topologically
  correct) radial coedge cycle; angular ordering is a documented S5 refinement.
