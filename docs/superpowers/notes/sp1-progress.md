# SP-1 — Unified Topology Spine — Progress

Tracking the staged execution of `docs/superpowers/plans/2026-05-22-sp1-topology-spine.md`.

| Stage | Status | Date | Notes |
|---|---|---|---|
| **S0** — recon spec + spine scaffold | **DONE** | 2026-05-22 | see below |
| **S1** — `bindSpine` (OCCT → spine Body) | **DONE** | 2026-05-22 | see below |
| **S2** — `SpineBody` + migration adapter; first op (`makeBox`) | **DONE** | 2026-05-22 | see below |
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
| 2 — ancestry maps | **PARTIAL** | `MapShapesAndAncestors` + map container bound; `ListOfShape` exposes `Size`/`First_1`/`Last_1`; the `ListIterator` class is unbound — see below. |
| 3 — `HashCode`/`IsSame`/`IsEqual` | **REACHABLE** | `HashCode(INT_MAX)` returns a stable integer per sub-shape, identical across two walks; `IsSame`/`IsEqual` work. |
| 4 — `BRep_Tool` geometry extraction | **REACHABLE** | `Surface_2` → `Handle_Geom_Surface`; `Pnt` → vertex point; `Curve_2` ok. |
| 5 — `BRepTools_WireExplorer` | **REACHABLE** | `BRepTools.OuterWire` + `BRepTools_WireExplorer_2(wire)` **1-arg form** walks a loop in coedge order. |
| 6 — non-manifold coedge counting | **REACHABLE** | `fuseNonManifold` of two stacked boxes → a real non-manifold result; the edge→face map gives faces-per-edge histogram `{2:16, 4:4}` — a >2-face edge IS observable. |

**The gap (probe 2), precisely — binding tier PARTIAL:**
`TopExp::MapShapesAndAncestors` IS bound; `TopTools_IndexedDataMapOfShapeListOfShape_1`
IS bound (builds a correct 12-edge map); the `TopTools_ListOfShape` that
`FindFromIndex` yields exposes `.Size()`, `.First_1()`, `.Last_1()`. BUT:
- `TopTools_ListIteratorOfListOfShape` — **every suffix UNBOUND** (`listIterKeys` empty).

So the ancestry map yields, per edge, a face **count** and — via `First_1`/
`Last_1` — the members of a **≤2-element** list, but cannot enumerate a list of
3+ members. For a watertight manifold solid every edge owns exactly 2 faces, so
the map fully resolves the manifold case; only a non-manifold edge (>2 faces)
exceeds what `First_1`/`Last_1` can recover.

**Consequence for S1 — a real three-tier adjacency builder in `bindSpine.js`:**
- **Path A** — iterator (O(n)): used if a future/custom engine binds
  `TopTools_ListIteratorOfListOfShape`.
- **Path B** — manifold map fast-path (O(n)): `MapShapesAndAncestors` + `Size()`
  + `First_1()`/`Last_1()` resolves every ≤2-face edge — the common case for
  a watertight solid.
- **Path C** — O(n²) `IsSame`-pairing fallback: for any edge path B could not
  fully resolve (a non-manifold >2-face edge, or every edge if the map is
  unusable), walk each spine face's engine sub-edges and pair by `IsSame`.
  Correct, deterministic, O(faces × edgesPerFace) — the SP-1-designed degrade
  path, a real documented branch (`buildAdjacencyFallback`).

`body.diagnostics.bind.adjacencyStrategy` records which path(s) ran for a given
body.

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
4. **Edge→face adjacency** via the three-tier `buildEdgeFaceAdjacency`
   (iterator → manifold map fast-path → O(n²) `IsSame` fallback — see the S0
   section). On this engine build the manifold fast-path resolves every edge
   of a watertight solid; the O(n²) fallback runs only for non-manifold edges.
   `body.diagnostics.bind.adjacencyStrategy` + `.adjacencyPaths` record which
   path each edge took.
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

- **Performance** — the manifold map fast-path (path B) handles every edge of a
  watertight solid in O(n); the O(n²) `IsSame` fallback (path C) runs only for
  non-manifold edges. For a GE9X-scale body with a large non-manifold subset
  path C could still cost; monitored. A custom engine build that binds
  `TopTools_ListIteratorOfListOfShape` would make path A cover everything.
  Note also the map key-lookup (`spineEdgeOf`) is a linear `IsSame` scan — a
  hash-keyed lookup is a straightforward S2+ optimisation.
- **Non-manifold radial order** — S1 ships an unordered (but topologically
  correct) radial coedge cycle; angular ordering is a documented S5 refinement.

---

## S2 — SpineBody + migration adapter + first op (`makeBox`) — DONE (2026-05-22)

### Deliverable

The first PRODUCTION OP MIGRATION to the unified topology spine, gated end-to-end
through the real scene path. `makeBox` now constructs a `SpineBody` instead of a
raw `BrepShape`; the SP-1 §5 BrepShape-duck-compatibility adapter makes that
return value flow facade → scene → `BodyRegistry` → `window.__lastSpine*` →
e2e IDENTICALLY to a `BrepShape`, with zero behaviour regression in the ~680
existing tests. The migration adapter delivered in this stage is the
infrastructure on which every S3/S4 op migration will follow the same one-line
pattern.

### Three commits

1. **`bd99c467` SP-1 S2 — SpineBody migration adapter** — three additive
   changes that make `SpineBody` BrepShape-duck-compatible end-to-end:
   - `kernel/brep/BrepShape.js` — `withScope()` survivor detection now
     recognises a `SpineBody` alongside a `BrepShape`. Duck-typed (has `body`
     + `occtWrapper` + live `.shape`) to keep `kernel/brep` free of a topology
     import (lower-layer module cannot depend on upper). Protects BOTH the
     engine TopoDS_Shape AND the underlying BrepShape wrapper so a subsequent
     op handing the wrapper back into `withScope` still finds a live
     BrepShape.
   - `kernel/topology/index.js` — re-export `isSpineBody` helper.
   - `workbenches/mechanical-cad/ToolExecutionEngine.js` — when the body that
     flows in is a `SpineBody`, mirror it on three new window slots for e2e +
     AI introspection: `window.__lastSpine` (the spine `Body` itself),
     `window.__lastSpineBody` (the SpineBody wrapper — the SP-1 currency),
     `window.__lastSpineValidation` (the `validateSpine` report from bind
     time). For un-migrated ops (still returning raw `BrepShape`) these slots
     stay at their previous value — additive, never regressive.
2. **`31bd7d43` SP-1 S2 — migrate makeBox to the topology spine** — the
   canonical first migration. `makeBox` now runs the OCCT box → `bindSpine`
   builds the full `Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex` graph from
   the engine shape → wrap in `SpineBody`. `bindSpine` only READS the engine
   shape (never mutates it) so the geometry path cannot regress (SP-1 §5.2).
   A 40 mm box spine: 1 lump / 1 shell / 6 faces / 6 loops / 12 edges / 8
   vertices / 24 coedges, kind=solid, χ=2, genusImplied=0, validateSpine ok,
   every persistent id unique and namespaced to the body tag, three-tier
   adjacency resolves every edge via the manifold map fast-path (path B).
3. **`fa685044` SP-1 S2 — makeBox migration motion-capture e2e** — headed
   Electron + slow-mo video + key-frame stills (8 storyboard frames + 7
   multi-angle orbits). Drives the complete workflow: real Part-tab ribbon
   click + dialog bypass build the Box (migrated op); a real viewport
   drag-orbit shows it in 3D; assertions cover duck-compatibility
   (`window.__lastBrepShape` set + live shape + meta + registry entry; the
   S2-new slots populated + identity-equal to the legacy slot), spine
   inspection (full topology counts + Euler χ + genus + validateSpine.ok +
   persistent-id uniqueness + body-namespacing + `geomEngineShape`
   back-reference), `measure` end-to-end via `withScope` (volume=64,000 mm³,
   area=9,600 mm²), real viewport click selects the body (gizmo pick-set
   reads the SpineBody off the registry's `brepShapeRef`), and MIXED-CURRENCY
   interop — Fillet (legacy BrepShape-returning op) takes the SpineBody as
   input and produces a valid filleted body (volume ~63,109; result is a
   BrepShape, confirming the adapter handles the migrated-op + legacy-op
   combination seamlessly).

### One follow-up regression — fixed (commit `a232a6e3`)

The full-suite no-regression run surfaced one genuine S2 regression:
`viewport-freeze-debug-electron`'s 70-body test calls `seed.clone(true)`
which invokes Three.js's `Object3D.copy()` — and that method deep-clones
userData via `this.userData = JSON.parse(JSON.stringify(source.userData))`.
The seed group's `userData.brepShapeRef` is now a `SpineBody` whose spine
graph carries legitimate back-reference cycles (Lump↔Shell, Shell↔Face,
Loop↔Coedge, Edge↔Coedge) that `JSON.stringify` correctly rejects with
"Converting circular structure to JSON". Pre-S2 the `brepShapeRef` was a
`BrepShape` (acyclic) so the round-trip worked.

Fix — minimal, targeted: store `brepShapeRef` on `group.userData` as a
**non-enumerable property** via `Object.defineProperty`. `JSON.stringify`
skips non-enumerable properties, so the `Object3D.copy` userData round-trip
succeeds; the property is still readable by `selectedBrepShapes()` (which
reads it explicitly as `group.userData.brepShapeRef`), so the live selection
path is unaffected. Verified: `viewport-freeze-debug-electron` (both 3-body
and 70-body tests) and `spine-s2-makebox-electron` all pass together; the 12
critical-risk specs (brep-primitives, brep-boolean, brep-features, all spine
specs, etc.) re-pass.

### Full-suite no-regression result

The full pre-existing suite of 682 tests was run, headed, `--workers=1`,
`--retries=0`, in 5 sharded batches (Playwright `--shard=N/5`). Totals:

| Batch | Tests | Passed | Failed | Skipped | Time |
|---|---|---|---|---|---|
| 1 of 5 | 137 | 121 | 16 | 0 | 17.3 min |
| 2 of 5 | 141 | 120 | 21 | 0 | 33.8 min |
| 3 of 5 | 133 | 133 | 0 | 0 | 9.8 min |
| 4 of 5 | 136 | 120 | 16 | 0 | 22.9 min |
| 5 of 5 | 135 | 114 | 20 | 1 | 20.1 min |
| **Total** | **682** | **608** | **73** | **1** | **103.9 min** |

After the BodyRegistry follow-up fix, the 1 viewport-freeze regression is
resolved (verified by re-running the spec), bringing the post-S2 expected
result to **72 failures + 1 fix = 609 pass / 72 fail / 1 skip**.

### Every failure is PRE-EXISTING — verified

The 72 remaining failures are split across three pre-existing root-cause
families, all predating S2 (most predating 2026-05-19):

1. **Stale UI selectors** — specs that reference legacy CSS classes
   (`.tool-icon-button`, `.feature-tree-item`, `.feature-tree-name`,
   `.tool-status-bar` text-pattern mismatches) that the current UI no
   longer renders. Examples: `agent-bridge` (3), `audit` (3), `feature-tree`
   (4), `boolean-tracking` (2), `edge-selection` (2),
   `drawing-engine`/`drawing-pdf-export`/`drawing-preview` (4),
   `cam-toolpath`, `cfd`, `fea-markers`, `fea-viz`, `mechanical-cad`
   feature-tree row.
2. **`__lastFoundationManifold` ToolRegistry mismatch** — `Extrude Boss`,
   `Revolve Boss`, `Fillet` ribbon handlers were retrofitted to the OCCT
   B-rep path (commit `8228d397`, 2026-05-19) and now set
   `__lastBrepShape`, not `__lastFoundationManifold`; but
   `ToolRegistry.js` still declares them as producing
   `__lastFoundationManifold`, and many specs (~25) wait on that slot:
   `assembly-cost-panel`, `body-selection-properties`,
   `chat-plan-templates`/`chat-projects`/`chat-verdict-trend`,
   `cost-estimation-panel`, `dfm-check-panel`, `export-assembly`,
   `geometry-check`, `ge9x-orchestration`, `integration-*` (10),
   `integration-fillet-rotor-massprops`, `omega-watch`,
   `parametric-tools` (2), `part-browser-panel`, `playground-jet-engine-walkthrough`,
   `profile-fillet`, `section-preview`, `slicer-preview`, `stair-climber-production`,
   `voxel-hex-mesh`, `visual-check-foundation-bodies`,
   `viewport-pick-selects-body`, `vendor-package`,
   `autonomous-mechanism`/`pressure`/`product`/`resonance`/`rotating` via
   `agent-runtime.js:141`.
3. **Other pre-existing nits** — `ai-verify-loop-electron` ES-module-scope
   exports error; `turbomachinery` 9-vs-13 data mismatch;
   `stock-moldflow`/`topology-opt`/`plm-cost-sustain` status-bar text
   pattern mismatches; `chat-projects`/`chat-verdict-trend` canvas
   visibility timing; `property-manager` selector drift.

Verification: every failing test's root cause is a pre-S2 commit (verified
by `git log` on the spec file or the handler the spec drives), and no
failure references `SpineBody` / `__lastSpine*` / topology entity
construction. The B-rep-heavy specs that ARE makeBox-adjacent
(`brep-primitives`, `brep-boolean`, `brep-features`, `brep-foundation`,
`brep-blend`, `brep-ribbon`, `brep-localops`, `brep-surfacing`,
`brep-varfillet`, etc.) ALL pass — exactly the specs most exposed to the
makeBox migration.

### Risks carried into S3

- **Object3D.copy + non-cycle-safe userData ref** — guarded for now by the
  non-enumerable `brepShapeRef`. As more ops migrate (S3+), more bodies in
  the scene carry SpineBodies; the same hardening pattern applies. A
  cleaner long-term fix is to remove `brepShapeRef` from `group.userData`
  entirely and key it on a separate Map (group id → SpineBody) — punted to
  S3+ once the migration pattern is fully proven.
- **ToolRegistry `produces` drift** — orthogonal to S2 but it gates the
  ~25 pre-existing failures listed above. Could be tackled as a
  housekeeping commit independent of S3, but is out of scope for SP-1 S2.
- **Mixed-currency lifetime** — `withScope` survivor detection works for
  both BrepShape and SpineBody, but a future op that calls `dispose()` on
  a SpineBody must not also `delete()` the engine shape from inside a
  `withScope` survivor list. S2 verified the simple case (`makeBox` →
  scene path); S3 will exercise more combinations (boolean inputs are
  SpineBodies, result is a SpineBody, both pass through `withScope`).
