# Forge Kernel Audit — Feature-based parametric modelling + history/rollback + direct edit

> AREA: "Feature-based parametric modelling + history/rollback + direct edit"
> TARGET: industrial 1:1 parity with Parasolid + enterprise feature trees
> (sketch→extrude→hole→fillet, rollback, ripple-rebuild).
> Grounded in the live tree at `forge-kernel/src/` and `frontend/src/kernel/forge/`
> + `frontend/src/forge-v4/` read 2026-06-24. Discipline: Bible §0 — real impl
> only, OCCT stays the live default + A/B oracle until each native op is
> A/B-proven; no MVP/stub; CI-green per increment; dynamic not static.

---

## 0. TL;DR

Forge's parametric story is **split across two layers that do not share a topology
model**:

1. **C++ kernel** (`forge-kernel/src/`) — a **stateless op library**. `Features.cpp`
   (1604 LOC), `DirectModeling.cpp` (532 LOC), `VarFillet.cpp` expose ~25 part/direct
   verbs that each take input handle(s) and return a *fresh* `ShapeHandle`. There is
   **no feature tree, no history, no rollback, no rebuild graph, and no persistent
   topological naming inside the kernel** — by design ("no in-place mutation … the
   registry retains the original so it can be re-used for parametric rebuild",
   `Features.cpp:1-6`). Selection is by **raw 0-based `TopExp_Explorer` index**
   (`faceById`/`edgeById`, `Features.cpp:120-140`).

2. **JS parametric layer** (`frontend/src/kernel/forge/`) — `FeatureTree.js`,
   `RebuildEngine.js`, `UndoRedo.js`, `Configurations.js`, plus the OCAF re-impl
   `forge-v4/ocafDocument.js`. This is where history/rollback/ripple-rebuild
   actually live, and it is genuinely competent: dirty-propagation rebuild with
   input-hash caching, rollback bar, suppress, reorder-with-dependency-guard,
   serialize/deserialize, undo/redo with coalescing, configurations/design-tables.

The decisive gap vs Parasolid is **not a missing feature verb** — most verbs exist.
It is that the two layers are joined by an **unstable integer index**, so the
single most important parametric-CAD invariant — *"a fillet placed on edge X stays
on edge X after an upstream edit changes the topology"* — **does not hold**. There
is a fully-built persistent-id topology spine (`frontend/src/kernel/topology/
bindSpine.js` + `kernel/history/HistoryLog.js`) from the older "ArchDisc kernel"
era that has exactly the right data structures, but it is **NOT wired** to the
forge-v4 FeatureTree/RebuildEngine/PartOps pipeline (grep: zero references).

**Single biggest blocker: persistent topological naming.** Until selections bind to
stable geometric references instead of `TopExp` ordinals, ripple-rebuild silently
re-targets features onto the wrong geometry — the classic "topological naming
problem" that Parasolid/ACIS solve with attribute-tagged sub-shapes and roll-forward
name maps. Everything else (analytic fillet, non-manifold booleans, XT I/O) is
secondary to this.

---

## 1. What Forge has now (grounded)

### 1.1 Part feature ops — `src/Features.cpp` (namespace `forge::part`)

All exported in `binding.cpp` (confirmed). Each is OCCT-backed with an *optional*
native-mesh-bridge behind `FORGE_NATIVE_BREP` + `forgeNativeFeaturesEnabled()`:

| Verb | OCCT path | Native path (FORGE_NATIVE_BREP) | Honest status |
|------|-----------|----------------------------------|---------------|
| `extrudeProfile` (`:246`) | `BRepPrimAPI_MakePrism` | `nb::prism`/`nb::sweep` → **NativeMesh** | native = watertight *mesh*, not analytic solid |
| `extrudeProfileOnPlane` (`:318`) | prism on relocated face | — (OCCT only) | sketch-on-face |
| `revolveProfile` (`:378`) | `BRepPrimAPI_MakeRevol` | `ncs::revolve` (faceted, 4 seg/°) → **NativeMesh** | partial+full angle |
| `sweep` (`:474`) | `MakePipe` / `MakePipeShell` (guides) | `nb::sweep` (no guides) → **NativeMesh** | guided sweep = OCCT only |
| `pipeFromPolyline` / `sweepPolyline` / `profileWire` | `MakePipe` / polygon wire | — | routing-style helpers |
| `loft` (`:704`) | `BRepOffsetAPI_ThruSections` | `nb::loftSections` (**requires equal vertex count per section**) → NativeMesh | native loft does NOT reparametrise mismatched sections |
| `loftWithGuides` (`:1458`) | `GeomFill_NSections` skin / ThruSections | — | guides "advisory" — `(void)guides` (`:1521`); returns a *face*, not a solid, in the guided branch |
| `shell` (`:785`) | `BRepOffsetAPI_MakeThickSolid` | — | per-face thickness is a **no-op metadata record** (`:804`) |
| `shellMultiThickness` (`:1548`) | multi-pass ThickSolid + fuse | — | self-described "5%-tolerant approximation" (`:1547`) |
| `thickenSurface` (`:821`) | `BRepOffset_MakeOffset` skin | — | surface→solid |
| `filletEdges` (`:847`) | `BRepFilletAPI_MakeFillet` | mesh rolling-ball strip (per-edge select via `EdgeSel` keys) → NativeMesh | constant radius only |
| `variableFilletEdge` (`:920`) + `VarFillet.cpp` | `BRepFilletAPI_MakeFillet` + `Law_Linear`/`Law_S` | — (OCCT only) | law-driven; **no native equivalent** |
| `chamferEdges` (`:947`) | `BRepFilletAPI_MakeChamfer` (sym + asym) | mesh bevel — **EVERY** sharp convex edge, no per-edge select (`:960`) | native chamfer is all-or-nothing |
| `draftFaces` (`:1011`) | `BRepOffsetAPI_DraftAngle` | `nb::applyDraft` displacement taper → NativeMesh | face-id mapped via per-triangle faceId stream |
| `holeWizard` (`:1096`) | cut cylinder/cone (simple/CB/CS/tapped) | — | **tapped = simple hole + metadata** (`:1179`); no thread geometry |
| `rib` (`:1187`) | extrude-and-thicken | — | free-standing solid, caller fuses; not a true `BRepFeat` rib |
| `linearPattern` / `circularPattern` / `mirrorPattern` / `onCurvePattern` (`:1233-1405`) | transform + fuse loop | — | **fuses copies into one body** (not instanced); `onCurvePattern` does not rotate-to-tangent (`:1378`) |

### 1.2 Direct-edit ops — `src/DirectModeling.cpp` (namespace `forge::direct`)

OCCT-backed, **no native path** (matches roadmap "missing"):

- `pushPullFace` (`:234`) — extrude face along true-outward normal (centroid-based
  sign fix, `:120-129`), fuse (push) / cut (pull), then `ShapeFix_Shape` heal.
- `moveFace` (`:276`) — decompose into normal (push/pull) + tangential (fuse a wedge).
  Honest: tangential is a "warp neighbouring walls" approximation, not a true
  variational move-face.
- `rotateFace` (`:323`) — extrude a wedge between old/new face pose + fuse. Approximate.
- `deleteFaceAndHeal` (`:367`) — build shell minus faces, hand to
  `heal::autoFillMissingFaces` to cap holes.
- `replaceFace` (`:399`) — swap a face's surface (plane/cylinder/sphere only),
  re-trim with outer wire, sew + `ShapeFix_Shape`.
- `inferFeature` (`:465`) — classify a face's surface type → Boss/Hole/Fillet/Chamfer/
  Blend (feature-recognition stub for direct-edit UX).
- Picking: `faceCount`/`edgeCount`/`edgeSegments` (`:152-232`) — edge polyline
  sampling for viewport selection (native handles use sharp-convex-edge enumeration).

### 1.3 The actual parametric backbone — JS (`frontend/src/kernel/forge/`)

- **`FeatureTree.js` (184 LOC)** — `FeatureNode {kind, params, dependsOn[],
  suppressed, error, outputHandle}`; `FeatureTree` with insertion-order `_order[]`,
  `rollbackTo`/`isRolledBack`/`appliedList`, `suppress`, `reorder` (refuses to
  violate `dependsOn`, `:71-82`), `edit`, `*buildOrder()` generator that breaks at
  the rollback marker and blocks downstream of errored/suppressed deps, plus
  `serialize`/`deserialize`.
- **`RebuildEngine.js` (187 LOC)** — dirty-set propagation, FNV-1a input-hash over
  `kind|params|depOutputs` (`inputHashFor`, `:45`), cache-hit skip when hash
  unchanged + not dirty, auto-subscribe to tree `onChange` to diff params and mark
  downstream dirty (`_downstreamOf`, `:109`). Async executors keyed by `kind`. This
  is a genuine ripple-rebuild — but **caches by `outputHandle` integer**, so a stale
  selection still resolves to a wrong/absent sub-shape.
- **`UndoRedo.js` (370 LOC)** — action stack (do/undo diffs, not snapshots),
  `mergeCoalescing` for slider drags, `_branchPoint` reserved for future side-branches
  (linear only today).
- **`Configurations.js` (177 LOC)** — `Configuration` (overrides keyed
  `${featureId}.${paramName}` + suppressed set) + `DesignTable` CSV expansion.
- **`forge-v4/ocafDocument.js` (333 LOC)** — JS re-impl of OCAF: `TDF_Label` tree,
  `TDF_Delta`, `TFunctionDriver` recompute graph, transaction undo/redo. Parallel to
  FeatureTree; the op-graph (`opGraph.js`) is one consumer.
- UI: `forge-v4/FeatureTree.jsx`, `RollbackBar.jsx`, `featureTreeOps.js`,
  `kernel/features/FeatureTree.js` (second tree impl — duplication to reconcile).

### 1.4 Native B-rep substrate that exists (credited)

`src/native/brep/`: `Boolean.cpp` (57k — **analytic-first** SSI + imprint + classify
+ stitch, mesh fallback), `Fillet.cpp` (65k — explicitly **mesh** rolling-ball strip,
"NOT an analytic B-rep fillet", `Fillet.cpp:6-7`), `Chamfer.cpp`, `Draft.cpp`,
`Loft.cpp` (ruled), `Sweep.cpp`, `Primitives.cpp`, `NurbsSurface.cpp`,
`SurfaceIntersect.cpp`, `StepAnalytic.cpp`, `MassProps.cpp`, `Topology.cpp`. Plus a
**dormant persistent-id topology spine**: `frontend/src/kernel/topology/bindSpine.js`
(Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex with `geomRef` + persistent id) and
`kernel/history/HistoryLog.js` (forward/inverse deltas keyed on
`persistentId`, named marks, replay — "mirrors the ACIS bulletin board / Parasolid
macro-and-rollback machinery"). **Not connected to the forge pipeline.**

---

## 2. The gap vs Parasolid + enterprise feature trees (concrete)

### 2.1 KEYSTONE — no persistent topological naming
- Features select faces/edges by **0-based `TopExp` ordinal** (`faceById`/`edgeById`).
  OCCT does not guarantee ordinal stability across `BRepAlgoAPI`/`BRepFilletAPI`
  rebuilds, so an upstream parameter change can shift indices → a fillet/hole/chamfer
  re-targets the wrong edge silently. This is THE Parasolid/ACIS differentiator
  (attribute-tagged sub-shapes + generated/modified name maps).
- No "generated-from / modified-from / deleted" lineage map produced by any op. The
  native Boolean (`Boolean.cpp`) builds the result but emits **no `Modified()/
  Generated()/IsDeleted()` query** (roadmap W1.3 confirms). Roll-forward selection
  re-binding is therefore impossible natively.
- `LineageRegistry.cpp` exists but stores only a flat `vector<LineageEntry>` per
  output handle (no sub-shape granularity, no rebuild re-resolution).

### 2.2 Feature-tree / rebuild data-model gaps vs enterprise CAD
- **Selections are not first-class references.** A `FeatureNode.params` holds raw
  `edgeIds:[3,7]`; there is no `Reference{type, persistentName, fallbackGeometry}` so
  an edit cannot re-resolve a moved edge.
- **No mid-tree feature insert with auto-renumber of downstream selections** (you can
  `reorder`, but downstream integer ids are not remapped).
- **Patterns fuse instead of instancing** — `linearPattern` etc. produce one fused
  solid, losing per-instance identity, suppress-one-instance, and pattern-driven-by-
  table. Enterprise patterns keep instances addressable.
- **No equation/global-variable driven dimensions inside the tree** (there is
  `foundation/EquationStore.js` but it is not bound to FeatureTree params as a
  dependency edge).
- **Two competing tree impls** (`kernel/forge/FeatureTree.js` vs
  `kernel/features/FeatureTree.js`) and two competing history models (RebuildEngine
  dirty-graph vs ocafDocument TFunction graph) — must converge to one.
- **No in-context assembly feature / external reference** dependency edges
  (top-down design). `dependsOn` is intra-part only.

### 2.3 Operator-fidelity gaps (geometry)
- **No analytic B-rep variable-radius / face-blend / setback corner fillet** natively;
  native fillet is a mesh strip (`Fillet.cpp:6`). Constant-radius OCCT fillet works;
  variable/var-conic/hold-line/full-round do not exist natively.
- **`holeWizard` tapped = geometry-identical to simple hole** (`Features.cpp:1179`) —
  no thread modelling (cosmetic or real helical), no standard tap-drill tables in
  geometry, no thread callout geometry.
- **Boolean lacks non-manifold handling + lineage** — analytic path stitches a closed
  2-manifold; non-manifold (lamina, mixed-dim, shared-face) inputs fall back to mesh
  or fail. No imprint-only / general-body modelling like Parasolid PK_BODY.
- **`shell` per-face thickness is metadata only** (`:804`); `shellMultiThickness` is a
  5%-tolerant fuse approximation, not true variable-offset thick-solid.
- **`moveFace`/`rotateFace` are wedge-fuse approximations**, not Parasolid
  tweak-face / local-ops that re-extend neighbouring faces analytically.
- **`replaceFace` only supports plane/cylinder/sphere** target surfaces (`:404-430`).
- **`loftWithGuides` guided branch returns a face, ignores guides** (`:1521`).

### 2.4 Data-structure / I/O gaps for a parametric kernel
- No **Parasolid-XT** (or ACIS SAT) reader/writer — required for "1:1 with Parasolid"
  interop and for a frozen golden corpus.
- No native **trimmed-NURBS STEP read** (roadmap W3.1, `StepAnalytic.cpp:749` fails
  honestly) → can't round-trip real-world parametric parts.
- **NativeMesh feature outputs cannot re-enter analytic ops** — once `extrude/revolve/
  fillet/chamfer/draft` go native, the result is a faceted `HalfEdgeMesh`
  (`ShapeRegistry::get` throws for native-mesh handles, `ShapeRegistry.cpp:81-83`).
  So a native extrude → native fillet → analytic boolean chain is broken; the
  parametric tree silently downgrades to mesh. This blocks an all-native feature
  history.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Each increment: real impl, OCCT stays oracle, A/B gate (mass-props + **topology
signature** — face/edge/vertex counts + adjacency hash, per roadmap §6 to avoid
coincidental mass-props parity), CI-green before next.

### Phase P0 — Persistent topological naming (KEYSTONE, unblocks everything)
- **P0.1 Sub-shape identity + name map in the kernel.** Add a `ForgeName` attribute on
  every face/edge/vertex of a result (stable across rebuilds): seed from the creating
  op (extrude side k of profile edge j → deterministic name), and produce a
  `Generated/Modified/Deleted` map from every op (fillet, boolean, hole, draft). For
  OCCT path, harvest `BRepAlgoAPI`/`BRepFilletAPI` `Modified()/Generated()/IsDeleted()`
  + `BRepTools_History`. Subsystem: new `src/TopoNaming.cpp` + extend `LineageRegistry`
  to sub-shape granularity. **Verify:** edit upstream param, assert the named face/edge
  resolves to a geometrically-corresponding sub-shape on both OCCT and (later) native.
  Regression: a "edit base height, fillet stays on top rim" e2e. ~1.5–2k LOC.
- **P0.2 References as first-class.** Change `faceIds:[int]` selections in PartOps /
  FeatureTree params to `Reference{name, snapshotGeom}` that resolves through P0.1 with
  a geometric-proximity fallback when a name is lost. Subsystem: `kernel/forge/
  Reference.js` + adapt `Features.cpp` to accept names. **Verify:** RebuildEngine
  re-resolves after a topology-changing upstream edit; golden ripple-rebuild test.
  ~800 LOC JS + ~400 C++.
- **P0.3 Wire the dormant spine.** Either retire `bindSpine.js`/`HistoryLog.js` or
  promote them as the P0.1 store (they already key deltas on `persistentId`). Decide
  one tree + one history model (kill the duplicate `kernel/features/FeatureTree.js` and
  reconcile `ocafDocument` vs RebuildEngine). **Verify:** no behavioural regression in
  existing FeatureTree/RebuildEngine/UndoRedo tests. ~300 LOC.

### Phase P1 — Feature-tree completeness (depends on P0)
- **P1.1 True instanced patterns** — keep per-instance identity, suppress-instance,
  pattern-table. Subsystem: PartOps + a `PatternFeature` that emits instance
  transforms consumed by ComponentRegistry (already supports instances). **Verify:**
  suppress instance 3, assert volume = N-1 copies; A/B vs OCCT fused-equivalent volume.
  ~600 LOC.
- **P1.2 Equation-driven params** — bind `EquationStore.js` variables as FeatureTree
  `dependsOn` edges so a global `D1` drives many features; dirty-propagation already
  exists. **Verify:** edit global, assert all dependent features rebuild (executor
  count). ~400 LOC.
- **P1.3 Mid-tree insert + downstream rebind** using P0 names. **Verify:** insert a
  fillet before a shell, assert shell re-resolves its removed face. ~300 LOC.

### Phase P2 — Operator fidelity (each native behind A/B, OCCT oracle stays)
- **P2.1 Analytic B-rep constant + variable fillet/blend** — replace the mesh strip
  with an analytic rolling-ball fillet surface (toroidal/NURBS) + radius law; reuse
  `NurbsSurface.cpp` + `SurfaceIntersect.cpp`. Subsystem: `native/brep/FilletBRep.cpp`.
  **Verify:** A/B vol/COM/inertia + topology sig vs OCCT `BRepFilletAPI` on a corpus of
  boxes/cylinders; this is roadmap W3.10, deepest single item. ~3–4k LOC.
- **P2.2 NativeMesh→analytic re-entry** — make native feature outputs analytic
  `Solid`s (not `HalfEdgeMesh`) so a native feature history composes. Prereq for
  all-native parametric. Subsystem: have `nb::prism/revolve/sweep/loft` build a
  `native::brep::Solid` (they already have the topology for planar/quadric cases).
  **Verify:** native extrude→native fillet→native boolean chain matches OCCT chain.
  ~2k LOC.
- **P2.3 True thread modelling for holeWizard** (cosmetic thread + tap-drill table +
  callout geometry). **Verify:** thread minor/major dia vs spec tables; drawing callout
  round-trip. ~800 LOC.
- **P2.4 Real local-ops move/rotate/replace-face** (re-extend neighbours, free-form
  target surfaces). Depends on native healing (roadmap W3.4). ~2k LOC.
- **P2.5 True variable-offset shell** (per-face thickness, not metadata). ~1k LOC.

### Phase P3 — Interop / corpus
- **P3.1 Parasolid-XT reader/writer** (or at least XT-text import for the benchmark
  corpus) + native trimmed-NURBS STEP read (roadmap W3.1). **Verify:** round-trip
  vol/COM/topology vs OCCT-read reference; freeze a golden corpus before any OCCT
  deletion. ~4k+ LOC.

---

## 4. The single biggest blocker + critical path

**Biggest blocker: persistent topological naming (Phase P0).** Forge already has the
feature verbs, a rollback bar, dirty-propagation rebuild, undo/redo, and
configurations — the parametric *scaffolding* is real. What it does not have is the
one invariant that makes a feature tree trustworthy: **stable selection references that
survive a topology-changing rebuild.** With integer-ordinal selection, ripple-rebuild
can silently move a fillet onto the wrong edge — the exact failure that disqualifies a
kernel from "1:1 with Parasolid." This must be solved before P1/P2 deliver durable
value, because every downstream feature, pattern, and direct-edit consumes a selection.

**Critical path:**
`P0.1 sub-shape names + Generated/Modified/Deleted maps` → `P0.2 References as
first-class (re-resolution)` → `P0.3 single tree/history model` → then in parallel
`P1 (tree completeness)` and `P2.1/P2.2 (analytic fillet + native re-entry)` → `P3
(XT/STEP corpus)`.

Secondary blocker, gating *all-native* parametric history: **P2.2 NativeMesh→analytic
re-entry** — today the moment a feature goes native it becomes a faceted mesh that
analytic ops reject (`ShapeRegistry.cpp:81`), so the native feature pipeline cannot
chain. Until P2.2, native features are leaf-only and OCCT remains load-bearing for any
multi-feature part — which is acceptable per Bible §0 (OCCT stays oracle) but must be
closed before Phase D OCCT deletion.

**Net:** the headline number from the OCCT roadmap (~35% migrated) understates the
*parametric* maturity (tree/rollback/rebuild are solid in JS) and overstates the
*geometric* parametric maturity (no persistent naming, no analytic fillet, native
features are mesh leaves). Close P0 first; it is ~3–4k LOC and unblocks the rest.
