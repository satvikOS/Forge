# SP-1 — Unified Topology Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development`
> or `superpowers:executing-plans` to implement this plan stage-by-stage. Steps use
> checkbox (`- [ ]`) syntax for tracking. This is a **T3 multi-stage subsystem** — do not
> attempt it as one pass.

**Date:** 2026-05-22
**Program:** `docs/superpowers/plans/2026-05-21-kernel-parity-program.md` — Sub-Project **SP-1**,
Area **A (Topological data model & invariants)**, Phase **K1**.
**Tier:** T3 (multi-sub-project subsystem). **Critical-path long pole** — blocks SP-2
(attributes), SP-3 (history/rollback), SP-11 (sheet/tolerant), and the *depth* of
SP-4/5/6/9/10/12.
**Depends on:** nothing. **Status:** plan only — no code changed, no e2e run, no commit.

**Goal:** Promote `kernel/topology/` to *the single* topological model of the ArchDisc
kernel — a persistent, ID-stable, non-manifold-capable B-rep spine
`Body{kind: solid|sheet|wire} → Lump → Shell → Face → Loop → Coedge → Edge → Vertex` —
with the underlying B-rep geometry engine (OCCT) sitting *behind* it as the geometry
provider. Every existing facade op is re-expressed to produce spine entities, the app
keeps working after every stage, and the ~388 e2e suite stays green throughout.

**Tech stack:** `opencascade.js@2.0.0-beta.b5ff984` (B-rep WASM), Vite 7, React 19,
Three.js 0.181, Electron 42, Playwright 1.59 (headed, `_electron` launch).

---

## 0. How to read this plan

- **§1 — Recon findings.** What the code *actually is today*: three parallel topology
  models, only one of them live. Read this before designing anything.
- **§2 — Target architecture.** The unified spine entity model spelled out field-by-field,
  body-kind taxonomy, persistent IDs, non-manifold, Euler-Poincaré, and the crucial
  geometry-engine-behind-the-spine contract.
- **§3 — Staged decomposition.** Eight ordered stages (S0–S7), risk front-loaded, each
  independently e2e-verified, app working after each.
- **§4 — Per-stage detail.** Deliverable, files, e2e contract per stage.
- **§5 — Migration / no-regression strategy.** The adapter approach and why.
- **§6 — UI contract.** The Body-Browser / topology-inspector viewport interaction.
- **§7 — Honest risks.** The hardest stages flagged.

**Standing ArchDisc methodology baked into every stage** (from the feedback files in
auto-memory): every op is ribbon-integrated (no floating panels), selection- and
param-dialog-driven (no hardcoded demo inputs), verified by **in-motion motion-capture
e2e** — headed Electron, real ribbon clicks + dialog fills + drag-orbit, slow-mo video +
key-frame stills, multiple camera angles + zoom levels — and each e2e composes a
*complete, complex, real-world model workflow* with the focal capability as the climactic
step. No user-facing string says "OpenCASCADE" / "OCCT".

---

## 1. Recon findings — the two-model situation as it actually is in code

The program plan §2 calls this "two parallel models." The code is worse: **there are
three**, and the relationships are not what the program plan assumes.

### 1.1 Model A — OCCT `TopoDS_*` behind `BrepShape` (the live production model)

`frontend/src/kernel/brep/` — 31 modules. This is the **only model real ribbon ops
touch.** Every facade op (`makeBox`, `fuse`, `filletAll`, `extrudeRect`, `shell`, …) is
an OCCT call sequence wrapped in `withScope()` and returns a **`BrepShape`**
(`BrepShape.js`):

```
class BrepShape {
  id;            // "brep-<n>" — a counter, NOT topology-stable
  shape;         // a raw OCCT TopoDS_Shape (WASM-bound, heap-managed)
  meta;          // { op, params, parents:[brepId], description?, analyticFace?, ... }
  _triangulation // cached {positions,normals,indices}
}
```

- `withScope()` is a WASM-heap disposal arena: every `track()`'d transient OCCT object
  is `.delete()`'d on scope exit, except the `TopoDS_Shape` reachable from the returned
  `BrepShape`. This memory discipline is load-bearing and must be preserved.
- **No native topology entities are constructed by Model A.** A `BrepShape` is an opaque
  handle to an OCCT shape. Topology is interrogated *ad hoc, per op*, by
  `TopExp_Explorer` walks (e.g. `BrepRewrite.js` collects faces, dedups with `IsSame`,
  indexes them 1-based).
- **Faces/edges are addressed by 1-based explorer index** (`replaceFace(shape, faceIndex)`,
  `g2BlendBetweenEdges(body, {edgeA, edgeB})`). This index is **not stable** across ops —
  it is the rawest possible identity and is SP-1's central problem to fix.
- The facade is `ArchDiscKernel.js` → `ArchDiscKernel.brep.*`; barrel in `index.js`.

How a body reaches the screen (`workbenches/mechanical-cad/ToolExecutionEngine.js`,
`addBrepShapeToScene`, line ~286):

```
facade op → BrepShape
  → ArchDiscKernel.brep.brepToMesh(brepShape)  [tessellate → THREE.BufferGeometry]
  → THREE.Group (scale 0.001 mm→m), userData.brepShape=true, pickable=true
  → scene.add(group)
  → registerBody({ group, manifold: {volume()}-shim, brepShape })  [BodyRegistry]
  → window.__lastBrepShape = brepShape ; window.__lastBrepGroup = group
  → consumedInputs[] removed from BodyRegistry (consuming-op cleanup)
```

`BodyRegistry` (`foundation/BodyRegistry.js`) stores `brepShapeRef` per body and exposes
`selectedBrepShapes()` — the selection-driven input path for arity-N ops. `window.__last*`
slots mirror state for e2e + AI introspection. **This entire flow is what SP-1 must keep
intact** — it is how 15+ production ribbon ops and ~388 e2e tests work.

### 1.2 Model B — `kernel/topology/Topo*` (a real half-edge B-rep, used only ad hoc)

`frontend/src/kernel/topology/` — 8 files. A genuine half-edge boundary representation:

| Class | Fields (today) | Methods |
|---|---|---|
| `TopoVertex` | `id` (counter), `point` (Vec3), `edges` (Set), `tag`, `userData` | `valence`, `connectedVertices/Faces`, `clone` |
| `TopoEdge` | `id`, `startVertex`, `endVertex`, `curve`, `faces` (Set), `tag`, `userData` | `length`, `tangentAt*`, `isManifold` (=`faces.size===2`), `reverse`, `tessellate` |
| `TopoLoop` | `id`, `halfEdges` (`[{edge,reversed}]`), `face`, `isOuter`, `tag`, `userData` | `vertices`, `isClosed`, `computeNormal` (Newell), `signedArea`, `reverse` |
| `TopoFace` | `id`, `surface`, `outerLoop`, `innerLoops[]`, `shell`, `reversed`, `tag`, `userData` | `allLoops`, `adjacentFaces`, `normal`, `area`, `flip`, `detach` |
| `TopoShell` | `id`, `faces` (Set), `solid`, `tag`, `userData` | `isClosed`, `isManifold`, `eulerCharacteristic` (`V−E+F`), `volume` |
| `TopoSolid` | `id`, `outerShell`, `innerShells[]`, `material`, `name`, `userData` | `faces`, `edges`, `vertices`, `volume`, `massProperties`, `isValid` |
| `AnalyticNurbsFace` | `NurbsSurfaceAdapter`, `Pcurve`, `makeAnalyticNurbsFace`, `buildAnalyticNurbsFace`, `reseatFaceOnSurface` | builds a `TopoFace` on an exact `foundation/NURBSSurface` |
| `FaceReplace` | `replaceFaceSurface(face, newNurbs)` | re-seats a `TopoFace`, projects pcurves, validates |

Observations that drive the design:

- **The `Topo*` half-edge structure is sound and worth keeping** — coedge directionality
  via `{edge, reversed}`, outer + inner loops, edge→faces back-pointers, Newell normals,
  Euler characteristic on `TopoShell`. The bones of the spine already exist.
- **It is missing the top of the hierarchy.** `TopoSolid` is the root — there is **no
  `Body`, no `Lump`, no wire/sheet body kind.** A `TopoSolid` is implicitly a single
  solid lump. `innerShells` model voids; there is no disjoint-lump concept.
- **`id` is a per-class module-level counter** (`let _faceId = 0; this.id = ++_faceId`)
  with `resetFaceIds()` exports. This is **not a persistent ID** — it is not stable
  across rebuilds, not namespaced to a body, and resettable globally. SP-1 must replace
  this with a real persistent-ID scheme.
- **`userData` is the only attribute carrier** — `BooleanEngine` writes
  `userData.sourceFaceId/sourceTag` for provenance. This is the seed SP-2 will formalise.
- `surface` is a duck-typed contract (`pointAt(u,v)`, `normalAt(u,v)`) — satisfied by
  `kernel/math/Surface.js` analytic primitives **and** by `NurbsSurfaceAdapter`. There is
  **no link to an OCCT `TopoDS_Face` / `Geom_Surface`** — Model B geometry is entirely
  ArchDisc-native JS.

**Who actually uses Model B (`grep` for the classes):**

- `kernel/brep/BrepBlendG2.js` — the G2 blend builds a `buildAnalyticNurbsFace` and parks
  it on `result.meta.analyticFace`. The `TopoFace` is **never rendered and never
  traversed** — it exists only so `nurbsSurfaceToSTEP` can emit a real
  `B_SPLINE_SURFACE_WITH_KNOTS` on STEP export.
- `kernel/brep/BrepRewrite.js` — the curved-swap `replaceFace` path builds a native
  `TopoFace` + `TopoEdge`s, re-seats it via `FaceReplace.replaceFaceSurface`, parks it on
  `meta.analyticFace`. Same story: a side-car analytic record, not the body.
- `kernel/topology/AnalyticNurbsFace.js` + `FaceReplace.js` — internal to the above.

So Model B today is a **side-car for analytic NURBS faces on STEP export** — exactly the
program plan §2 phrase "used ad-hoc (G2 blend, face-replace) not as the unified spine."
It is **not** a parallel body model; it never reaches the scene or the `BodyRegistry`.

### 1.3 Model C — `kernel/features/*` (a dead, demo-era parallel build path)

`frontend/src/kernel/features/` — `PrimitiveBuilder`, `BooleanEngine`, `ExtrudeFeature`,
`RevolveFeature`, `LoftSweep`, `FilletChamfer`, `DirectEdit`, `FeatureTree`. These import
the **same `Topo*` classes** and build complete `TopoSolid`s — `PrimitiveBuilder.box()`
makes the 8-vertex/12-edge/6-face solid; `BooleanEngine` does BSP-tree CSG on
`TopoSolid`s. They are exported from `kernel/index.js`.

- **Per `docs/kernel-audit.md`, this is the pre-OCCT demo-era kernel.** It was the
  original "proprietary B-rep kernel." Today **no ribbon op routes through it** — every
  Part-tab primitive/boolean/feature goes through Model A (`ArchDiscKernel.brep.*`), as
  `ToolExecutionEngine.js` shows (`makeBox`, `fuse`, etc. all `ArchDiscKernel.brep`).
- `BooleanEngine`'s BSP CSG is a triangle-soup boolean — not kernel-grade.
- `FeatureTree.js` is referenced by `components/FeatureTreePanel.jsx` and `Viewport3D.jsx`
  but the audit confirms the feature path is unexercised by real workflows.

**Decision for SP-1:** Model C is dead weight that *confuses* the codebase ("which
topology model is real?"). SP-1 will **not migrate Model C** — it will **delete or
quarantine** `kernel/features/*`'s geometry builders once the spine subsumes their role,
and keep only what `FeatureTreePanel`/`Viewport3D` genuinely need (a stage-by-stage
detail in S0). Model C's `Topo*` *constructors* are reusable reference code — its
*build path* is not.

### 1.4 Adjacent fact — `foundation/TopologicalNaming.js`

`originalID` (program plan §2: "persistent `originalID` survives booleans") is **not** in
either topology model — it lives in `foundation/TopologicalNaming.js` and is a
**manifold-3d** mechanism (`Manifold.runOriginalID` propagation), unrelated to OCCT or
`Topo*`. It is a third, separate provenance scheme on the `foundation/` manifold path.
SP-1's persistent-ID design (§2.3) supersedes it for the spine; `TopologicalNaming.js`
stays for the manifold path it serves and is out of SP-1 scope.

### 1.5 Recon conclusion

| Model | What it is | Live? | SP-1 action |
|---|---|---|---|
| **A** — OCCT `TopoDS_*` + `BrepShape` | The geometry engine + the production op results | **Yes** — every ribbon op, ~388 e2e | **Keep as the geometry engine.** Wrap, don't replace. |
| **B** — `kernel/topology/Topo*` | A real half-edge B-rep, used only as an analytic-face side-car | Partially — STEP export only | **Promote to THE spine.** This is SP-1's core work. |
| **C** — `kernel/features/*` | Dead demo-era parallel kernel on the same `Topo*` classes | **No** — no ribbon op uses it | **Quarantine / delete.** Do not migrate. |

The target is **one** model where B is promoted to the topology truth, A is the geometry
engine *referenced by* B, and C is gone. The hard part is doing this without breaking the
Model-A→scene flow that everything currently depends on.

---

## 2. Target architecture — the unified topology spine

### 2.1 The entity hierarchy

The spine is the ACIS/Parasolid hierarchy, deduplicated (per the line-312 reference in
`docs/ARCHDISC_VISION_AND_ROADMAP.md` — ACIS `BODY/LUMP/SHELL/SUBSHELL/FACE/LOOP/COEDGE/
EDGE/VERTEX`; Parasolid `PART/REGION/SHELL/FACE/LOOP/FIN/EDGE/VERTEX`). ArchDisc adopts
the ACIS naming with `Coedge` as the directed construct (= ACIS COEDGE = Parasolid FIN):

```
Body  {kind: 'solid' | 'sheet' | 'wire'}
 └─ Lump        (a maximally-connected point set, disjoint from sibling lumps)
     └─ Shell   (a connected set of faces ± wires; bounds a region or a void)
         ├─ Face   (a connected patch of one Surface, bounded by Loops)
         │   └─ Loop      (a closed cycle of Coedges; one outer, ≥0 inner)
         │       └─ Coedge (the directed use of an Edge by a Loop)
         │           └─ Edge   (a Curve bounded by two Vertices)
         │               └─ Vertex (a Point)
         └─ Wire   (a Shell may also carry wire edges — for wire bodies / mixed shells)
```

`SUBSHELL` (ACIS memory-block subdivision) is **not** reproduced — it is an internal
performance detail of a C++ kernel; ArchDisc's spine is a JS object graph and does not
need it. Documented omission.

The eight spine classes (the `→` chain SP-1 must deliver), with their **responsibilities**:

| Entity | Responsibility | Geometry it references |
|---|---|---|
| **Body** | The independent model object. Carries `kind`, the lump list, the persistent-ID namespace, body-level attributes, and the back-reference to its OCCT shape (§2.4). | — (a container) |
| **Lump** | One connected chunk of the body. A multi-lump body = a boolean that fell into disjoint pieces, or a deliberate multi-piece body. Each lump knows its shells. | — |
| **Shell** | A connected face set (+ optional wire edges). A *peripheral* shell bounds the lump outward; a *void* shell bounds an internal cavity. Holds `isClosed`, manifold classification, Euler characteristic. | — |
| **Face** | A bounded region of exactly one `Surface`. Outer loop + inner loops (holes). `reversed` flag relative to surface normal. | one `Surface` (analytic, NURBS-adapter, or OCCT-`Geom_Surface`-backed) |
| **Loop** | A closed coedge cycle. `isOuter` distinguishes the outer boundary from holes. | — (boundary of a face) |
| **Coedge** | The directed use of an `Edge` by one `Loop`. Carries the `reversed` orientation, the **partner/mate** pointer (the coedge of the adjacent face on the same edge — the non-manifold-aware adjacency link), and the optional `Pcurve` (2-D edge trace in the face's surface). | a `Pcurve` (optional) |
| **Edge** | A `Curve` bounded by two `Vertices`. Knows its coedges (→ all faces using it — manifold = exactly 2). Carries a `tolerance` field (for SP-11 tolerant edges). | one `Curve` |
| **Vertex** | A 0-D `Point`. Knows its edges. Carries a `tolerance` field (for SP-11 tolerant vertices). | one `Point` |

This **replaces** today's `TopoSolid` (→ becomes `Body` + `Lump`), and **upgrades**
`TopoLoop.halfEdges` (raw `{edge,reversed}` tuples) into first-class **`Coedge`** objects
that can carry a mate pointer and a pcurve.

### 2.2 Body-kind taxonomy (wire / sheet / solid)

`Body.kind` is the single discriminator, validated by an invariant per kind:

- **`solid`** — every shell is closed; every edge is shared by exactly 2 coedges within
  the shell (manifold) *or* by ≥2 (non-manifold solid, §2.5). Bounds a volume.
  Euler-Poincaré: `V − E + F = 2(S − G)` (§2.6).
- **`sheet`** — faces that do not bound a volume; shells may be open. An edge may have
  1 coedge (a free boundary edge / *lamina* edge). `thicken` consumes a sheet body.
  This formalises today's "open-surface bodies accepted by `thicken`."
- **`wire`** — no faces at all; the body is a connected set of edges + vertices (a
  `Shell` carrying only wire edges, no faces). The carrier for sketch profiles, sweep
  paths, and SP-6's arbitrary trimmed-wire profiles.

A body's kind is **derived and then asserted** at construction (from face/edge counts and
closure), never free-typed — `deriveBodyKind(body)` is a spine utility. Mixed shells
(faces + dangling wire edges, e.g. an ACIS shell with both) are allowed on `solid`/`sheet`
bodies; the wire edges live on the `Shell` alongside faces.

### 2.3 Persistent IDs

The current per-class incrementing counter is replaced by a **per-body persistent-ID
namespace**:

- Each `Body` owns an `IdAllocator` (a monotone counter that never reuses a value within
  that body's lifetime, plus a "high-water mark" so a rebuilt body can resume numbering).
- Every entity gets `body.allocId()` at creation → `entity.persistentId` (a string like
  `b3:f17` — body tag + entity tag). Stable for the entity's whole life.
- `entity.transientId` (the old counter) is **kept** for fast in-session map keys and
  debugging, but is never persisted or exposed to features.
- **Carry-through contract:** every spine-producing op (boolean, fillet, …) must, where a
  result face/edge *derives from* an input face/edge, copy the input's `persistentId`
  onto the result (and record a `derivedFrom: [persistentId,...]` list when an entity is
  a merge/split product). This is the topological-naming foundation — and the precise
  hook SP-2 (attributes) and SP-3 (history) build on. SP-1 delivers the *mechanism* and
  wires it for the primitive + boolean + fillet ops; later sub-projects extend coverage.
- Persistent IDs are **what the UI selection, the `window.__last*` slots, and e2e
  assertions key on** after SP-1 — replacing the brittle 1-based explorer index.

### 2.4 OCCT *behind* the spine — the geometry-engine contract

This is the crux of the program-plan instruction "OCCT as the geometry engine behind it."

**The spine is topology truth. OCCT is a geometry + heavy-operation engine the spine
*references and drives*.** Concretely:

- A `Body` holds an **`occtShape`** field — the live `TopoDS_Shape` (still inside a
  `BrepShape`-style heap-managed wrapper, so `withScope()`/`.delete()` discipline is
  unchanged). The OCCT shape remains the *evaluation engine*: tessellation, exact volume,
  boolean execution, fillet execution all still run in OCCT.
- Every spine **`Face`/`Edge`/`Vertex` carries a `geomRef`** — a stable reference into
  the OCCT shape (the OCCT sub-shape, located via a TopoDS hash / a `TopTools` index map
  built once when the spine is bound to the shape). `geomRef` is *how a spine face asks
  OCCT "evaluate your surface at (u,v)" / "give me your `Geom_Surface`".*
- The spine `Surface`/`Curve` objects are **adapters**: an OCCT-backed face's `Surface`
  delegates `pointAt/normalAt/nurbsData` to its `Geom_Surface`; an ArchDisc-analytic
  face's `Surface` is the existing `NurbsSurfaceAdapter` or `kernel/math/Surface.js`
  primitive. **Both present the identical `Surface` contract** — the spine does not care
  which engine is behind a face.
- **The binding direction:** ops execute in OCCT (fast, robust) → the result
  `TopoDS_Shape` is **"spined"**: a `bindSpine(occtShape)` builder walks the shape with
  `TopExp` and constructs the full `Body→…→Vertex` graph, each entity `geomRef`-linked
  back to its OCCT sub-shape, persistent IDs assigned/carried. The spine is thus the
  *authoritative topological view*; OCCT is the *geometry of record + the muscle*.
- **The reverse is also supported** for spine-native results: an ArchDisc-analytic face
  (G2 blend, N-sided patch, face-replace — §2.7) has *no* OCCT sub-shape; its `geomRef`
  is `null` and its geometry is the native `NURBSSurface`. The spine is *heterogeneous* —
  some faces OCCT-backed, some ArchDisc-analytic — and that is fine, because the topology
  graph and the `Surface` contract are uniform. STEP export already reads `nurbsData()`;
  tessellation falls back to the native `NURBSSurface.tessellate`.

So: **OCCT does the geometry and the heavy lifting; the spine owns identity, adjacency,
body-kind, attributes, history, and invariants.** A future custom-OCCT build (Docker-gated,
per `project_parity_closure.md`) or even a different engine could be swapped behind the
same spine.

### 2.5 Non-manifold representation

Non-manifold topology becomes **first-class**, not "only via BOP":

- An `Edge` has a list of `Coedge`s. **Manifold edge** = exactly 2 coedges. **Non-manifold
  edge** = >2 coedges (≥3 faces meeting at one edge) or, on a sheet/wire, an odd count.
- Each `Coedge` has a **`partner`** pointer. On a manifold edge it points to the single
  other coedge. On a non-manifold edge the coedges form a **radial cycle** (ordered
  around the edge by surface tangent angle — the standard radial-edge structure); each
  coedge's `partner` is the next in that cycle, and the cycle is the non-manifold
  adjacency. `radialOrder(edge)` is a spine utility.
- Non-manifold **vertices** (a vertex where otherwise-disjoint shells touch at a point)
  are represented naturally — the vertex's edge list simply spans multiple shells.
- `fuseNonManifold` / `fuseLattice` (existing OCCT facade ops) produce shapes that, when
  spined, yield non-manifold edges automatically — the `bindSpine` builder detects
  coedge count >2 and builds the radial cycle. No special op path needed; non-manifold is
  just *what the builder produces* when the geometry is non-manifold.

### 2.6 Euler-Poincaré maintained and checked

The contract `V − E + F = 2(S − G)` (line-312 reference: "preserved through every op"),
generalised for the spine:

- For a closed manifold solid body: `V − E + F = 2(C − G) + 2H` where `C` = number of
  shells (connected components / lumps), `G` = total genus, `H` = number of internal
  void shells. The classic `χ = 2` is the single-shell, genus-0 case.
- `Body.eulerCharacteristic()` and `Body.checkEulerPoincare()` are spine methods. The
  latter returns `{ V, E, F, shells, genus, expected, actual, ok }`.
- **Where it is checked:** after every spine-producing op, in a `validateSpine(body)`
  pass that runs in dev/test builds (and is the backbone of the SP-1 recon spec and every
  stage's e2e). It checks: Euler-Poincaré consistency, every loop closed, every coedge
  has a partner (or a documented free-boundary on a sheet/wire), every edge's coedge count
  matches its manifold classification, every face's loops reference only that face's
  coedges, persistent IDs unique within the body.
- **`validateSpine` is not a runtime gate in production** (it would cost performance) —
  it is a *verification instrument*. The honest position: SP-1 *maintains* the invariant
  by construction (the `bindSpine` builder produces consistent graphs) and *checks* it
  exhaustively in e2e. Genuine Euler-operator-level incremental maintenance (the ACIS
  bulletin-board style) is SP-3's job, not SP-1's.

### 2.7 Unifying the ArchDisc-native analytic faces

The existing native analytic faces — G2 blend (`BrepBlendG2`), N-sided patch
(`BrepNSided`), face-replace (`BrepRewrite` curved-swap) — currently produce a side-car
`TopoFace` on `meta.analyticFace`. Under the spine they **become genuine spine faces**:

- An analytic blend/patch result is spined like any other body, **but** the blend/patch
  face is a spine `Face` whose `Surface` is the `NurbsSurfaceAdapter` (geometry = the
  exact `NURBSSurface`) and whose `geomRef` is `null` (no OCCT sub-shape — it is a
  native face). Its `Coedge`s carry the `Pcurve`s that `AnalyticNurbsFace`/`FaceReplace`
  already generate.
- The result body is therefore **heterogeneous** — e.g. a filleted plate with a G2 blend
  face: the box faces are OCCT-backed spine faces, the blend face is an ArchDisc-analytic
  spine face, and they are stitched into one `Shell` with shared `Edge`s/`Coedge`s.
- This **resolves the program-plan §6 residual gap** ("native-JS analytic faces … are
  ArchDisc-native, not OCCT `TopoDS_Face` objects … a fully unified single representation
  is itself part of SP-1's long-term goal"). SP-1's answer: the unified representation is
  *the spine* — not "make everything an OCCT face," but "make everything a spine `Face`,
  with a uniform `Surface` contract, regardless of which engine backs the geometry."
- `meta.analyticFace` is **retired** as a side-car concept after S6 — the analytic face is
  *in the body* as a real spine face; STEP export reads it from the spine.

### 2.8 The spine module layout (target)

```
kernel/topology/
  Body.js          NEW   — Body{kind}, lumps, IdAllocator, occtShape ref, attributes
  Lump.js          NEW   — Lump, shells, disjoint-set tracking
  Shell.js         FROM TopoShell — + peripheral/void role, wire-edge support
  Face.js          FROM TopoFace  — + persistentId, geomRef, body back-ref
  Loop.js          FROM TopoLoop  — coedge cycles (halfEdges → Coedge[])
  Coedge.js        NEW   — directed edge use; partner pointer; pcurve
  Edge.js          FROM TopoEdge  — + persistentId, geomRef, tolerance, coedges
  Vertex.js        FROM TopoVertex — + persistentId, geomRef, tolerance
  Surface.js       — re-export/extend kernel/math/Surface + NurbsSurfaceAdapter
  Pcurve.js        FROM AnalyticNurbsFace.Pcurve
  IdAllocator.js   NEW   — persistent-ID allocation per body
  bindSpine.js     NEW   — TopoDS_Shape → spine Body builder (the OCCT→spine bridge)
  validateSpine.js NEW   — Euler-Poincaré + structural invariant checker
  SpineBody.js     NEW   — the SP-1 successor to BrepShape: { id, body, occtWrapper, meta }
  index.js         NEW   — spine barrel
  (TopoSolid.js, AnalyticNurbsFace.js, FaceReplace.js — kept until S6, then refactored)
```

`SpineBody` is the new currency that flows facade→scene. It *contains* a `Body` (topology
spine) and the OCCT heap wrapper. During migration (§5) it is adapter-compatible with
`BrepShape` so the scene path is untouched.

---

## 3. Staged decomposition

Eight stages, **risk front-loaded**. After every stage the app fully works and the entire
e2e suite is green. The hardest, most uncertain work (the OCCT→spine builder and the
op-migration) is S1–S3 — done early so a failure surfaces while the blast radius is small.

| Stage | Deliverable | Risk | App-visible change |
|---|---|---|---|
| **S0** | Empirical recon spec + spine-scaffold (entity classes, IdAllocator, no behaviour change) | Low | none |
| **S1** | `bindSpine` — OCCT `TopoDS_Shape` → full spine `Body`; `validateSpine` passes on all primitives | **HIGH** | none (spine built alongside, unused) |
| **S2** | `SpineBody` + the migration adapter; one op (`makeBox`) produces a `SpineBody`; scene path proven | **HIGH** | none (behaviour identical) |
| **S3** | Migrate all primitive + boolean + transform ops to the spine; persistent-ID carry-through through booleans | Med-High | none (behaviour identical) |
| **S4** | Migrate all feature + local-op + surfacing ops (extrude/revolve/fillet/chamfer/shell/thicken/draft/sweep/loft) | Med | none (behaviour identical) |
| **S5** | Body-kind taxonomy live: wire + sheet + solid bodies; non-manifold spine from `fuseNonManifold`/lattice | Med | wire/sheet bodies are now first-class; new diagnostics |
| **S6** | Unify the native analytic faces (G2 blend, N-sided, face-replace) into spine faces; retire `meta.analyticFace` | **HIGH** | none (STEP export still works; blend faces now in-body) |
| **S7** | Body-Browser → topology-inspector UI; `window.__lastSpine*` introspection; quarantine Model C | Low-Med | the marquee UI: a topology tree + viewport pick of spine entities |

**Why this order:** S1+S2 prove the single riskiest hypothesis — *that an OCCT shape can
be losslessly reflected into the spine and the spine can drive the existing scene path* —
before any op is migrated. If S1/S2 reveal an OCCT-binding wall (e.g. a `TopExp` map
class is unbound, mirroring the `gp_Pnt2d` gap in `kernel-api-G.md`), it is caught with
*zero* migrated ops. S3 then migrates the highest-traffic ops (primitives/booleans —
exercised by the most e2e) so regressions surface immediately. S4 is mechanical repetition
of the S3 pattern. S5/S6 add genuinely new capability on the now-proven spine. S7 is the
UI, which depends on the spine being complete and stable.

Each stage is **independently shippable** — the migration adapter (§5) means the app and
e2e are green at every stage boundary, never "broken mid-refactor."

---

## 4. Per-stage detail

Every stage's e2e is **headed Electron, motion-capture** (slow-mo video + key-frame
stills, real ribbon clicks + dialog fills + drag-orbit, multi-angle + multi-zoom), and
each composes a *complete complex model workflow*. Build the frontend (`cd frontend &&
npx vite build`) before each spec; run via `./node_modules/.bin/playwright` (1.59).

### Stage S0 — Recon spec + spine scaffold

**This is Step 1 of the plan, per the SP-1 brief: "write an empirical recon spec."**

- [ ] **S0.1 — Recon spec.** Create `e2e/spine-recon-electron.spec.js` (pattern:
  `e2e/brep-g-recon-electron.spec.js`). It launches the real Electron app and, inside
  `win.evaluate`, empirically verifies — against live OCCT — every binding `bindSpine`
  will need:
  - `TopExp_Explorer` over `TopAbs_SOLID / SHELL / FACE / WIRE / EDGE / VERTEX` from a
    boolean result — confirm each level is reachable and counts are sane.
  - `TopExp.MapShapes` / `TopExp.MapShapesAndAncestors` (or `TopTools_IndexedMap*` /
    `TopTools_IndexedDataMapOfShapeListOfShape`) — the **face↔edge↔vertex ancestry maps**
    `bindSpine` needs to wire coedges and partners. **This is the highest-risk probe** —
    if these map classes are unbound, S1's design changes (fallback: per-shape `IsSame`
    O(n²) pairing). Verdict: REACHABLE / NOT_REACHABLE with the working call sequence.
  - `TopoDS_Shape.HashCode` / orientation / `IsSame` / `IsEqual` — for the stable
    `geomRef` key. Confirm hash stability across explorer passes.
  - `BRep_Tool.Surface_2` / `.Curve_*` / `.Pnt` / `.Range` — geometry extraction per
    sub-shape (mostly confirmed in `kernel-api-A0/G.md`, re-confirm in the spine context).
  - `BRepTools.OuterWire`, `BRepTools_WireExplorer` — ordered loop traversal (confirmed in
    `BrepRewrite.js`, re-confirm).
  - A non-manifold probe: spine-bind a `fuseNonManifold` result, count coedges per edge,
    confirm an edge with >2 faces is observable.
  - Writes `docs/superpowers/notes/topology-spine-recon.json` + a human-readable
    `docs/superpowers/notes/topology-spine-A.md` (verified call sequences, copy-paste
    safe for S1). No "OpenCASCADE" in the note title or prose — call it the B-rep engine.
- [ ] **S0.2 — Spine scaffold.** Create the new entity classes
  (`Body/Lump/Shell/Face/Loop/Coedge/Edge/Vertex` — most adapted from the `Topo*`
  classes, `Coedge`/`Lump`/`Body` new), `IdAllocator.js`, `Pcurve.js`,
  `kernel/topology/index.js`. **No behaviour change** — these classes are not yet
  constructed by any op. `validateSpine.js` is created with the Euler-Poincaré + structural
  checks (§2.6), unit-exercisable on a hand-built spine. Keep `TopoSolid/TopoFace/…` in
  place untouched (Model B's analytic-face side-car still works).
- **e2e verification:** the recon spec passes GREEN (all bindings REACHABLE, or a
  documented fallback). A `e2e/spine-scaffold-electron.spec.js` builds a spine `Body`
  *by hand* in `win.evaluate` (a unit cube: 8 vertices, 12 edges, 24 coedges, 6 faces,
  6 loops, 1 shell, 1 lump, 1 solid body), runs `validateSpine`, asserts
  `checkEulerPoincare().ok === true` and `χ === 2`. Existing suite: untouched, green.
- **App still works:** nothing wired — trivially yes.

### Stage S1 — `bindSpine`: OCCT shape → spine Body (HIGH RISK)

- [ ] **S1.1** — Implement `bindSpine(occtShape, { idAllocator })` using the S0-verified
  call sequences: walk solids→lumps, shells, faces, loops (via `OuterWire` +
  `WireExplorer`), edges, vertices; construct the full spine graph; build the
  `geomRef` map (sub-shape hash → spine entity); construct `Coedge`s with `partner`
  pointers from the edge-ancestry map (radial cycle for non-manifold edges, §2.5);
  attach `Surface`/`Curve` adapters that delegate to `BRep_Tool.Surface/Curve`.
- [ ] **S1.2** — `validateSpine` runs inside `bindSpine` in test/dev builds; `bindSpine`
  of every primitive (box/cylinder/sphere/cone/torus) produces a body that passes
  Euler-Poincaré + all structural checks.
- [ ] **S1.3** — `bindSpine` of a boolean result (fuse/cut/common of two primitives) and
  of a `fuseNonManifold` result both validate; the non-manifold result shows ≥1 edge
  with >2 coedges.
- **Deliverable:** a pure function `TopoDS_Shape → validated spine Body`. Nothing in the
  app calls it yet — it is exercised only by e2e.
- **e2e verification:** `e2e/spine-bind-electron.spec.js`. In `win.evaluate`: for each
  primitive and for fuse/cut/common/fuseNonManifold, call the facade op, `bindSpine` the
  result, assert entity counts match independent `TopExp` counts, `checkEulerPoincare().ok`,
  and (for the non-manifold case) a >2-coedge edge exists. This spec is **data-heavy by
  nature** (it verifies a builder) — but it *also* drives the real ribbon: it builds each
  primitive via the actual Part-tab ribbon tool + dialog, captures slow-mo video + stills
  from 4 angles, *then* introspects the spine — so it satisfies the in-motion + real-
  workflow standard while proving the builder.
- **App still works:** `bindSpine` is additive; no op changed; full suite green.

### Stage S2 — `SpineBody` + migration adapter; first op migrated (HIGH RISK)

- [ ] **S2.1** — Implement `SpineBody.js`: `{ id, body (spine Body), occtWrapper (the
  heap-managed TopoDS_Shape, == old BrepShape internals), meta }`. Crucially, **make
  `SpineBody` duck-compatible with `BrepShape`**: it exposes a `.shape` getter (→
  `occtWrapper.shape`) and `.id` / `.meta`, so every existing consumer
  (`brepToMesh`, `measure`, `addBrepShapeToScene`, `selectedBrepShapes`,
  `withScope` survivor detection) treats it identically. This is the migration adapter
  (§5).
- [ ] **S2.2** — `withScope` survivor logic updated to recognise `SpineBody` (keep its
  `occtWrapper.shape` alive) — a one-line additive change in `BrepShape.js`.
- [ ] **S2.3** — Migrate exactly **one** op — `makeBox` — to return a `SpineBody`
  (`makeBox` runs the OCCT box → `bindSpine` → wrap in `SpineBody`). `addBrepShapeToScene`
  and `BodyRegistry` are checked end-to-end with a `SpineBody`.
- **Deliverable:** the proof that a spine-carrying body flows facade→scene→registry→
  `window.__last*` with **zero behaviour change**.
- **e2e verification:** `e2e/spine-makebox-electron.spec.js` — drive the Part-tab "Box"
  ribbon tool + dialog, motion-capture the creation, then assert: the body renders, the
  Body Browser lists it, `measure` returns volume 1000 for a 10mm box, **and**
  `window.__lastSpine` (new slot) exposes a valid spine `Body` with `χ===2`. The
  *existing* `e2e/brep-primitives-electron.spec.js` must still pass unchanged — that is
  the regression proof.
- **App still works:** only `makeBox` changed, behaviour identical; full suite green.

### Stage S3 — Migrate primitives + booleans + transforms; ID carry-through

- [ ] **S3.1** — Migrate `makeCylinder/Sphere/Cone/Torus`, `translate`, `makeCompound`
  to return `SpineBody`s (same pattern as S2.3).
- [ ] **S3.2** — Migrate `fuse/cut/common` and `fuseAll/fuseNonManifold/fuseCoincident/
  fuseLattice`. Implement **persistent-ID carry-through** (§2.3): when a boolean result
  is spined, each result face is matched back to its originating input face (using OCCT's
  `BRepAlgoAPI_*` `Modified`/`Generated`/`IsDeleted` history maps — verify these are
  bound in the S0 recon, or fall back to geometric face-matching) and the input's
  `persistentId` is copied / a `derivedFrom` list recorded.
- [ ] **S3.3** — `consumedInputs` cleanup in `addBrepShapeToScene` confirmed working with
  `SpineBody`s (it matches by object identity — unaffected, but verify).
- **Deliverable:** every primitive/boolean/transform op is spine-backed; a face's
  identity survives a boolean.
- **e2e verification:** `e2e/spine-boolean-identity-electron.spec.js` — a *complex
  workflow*: build a bracket (box, cut two holes, fuse a boss, fillet later), motion-
  captured via real ribbon ops; assert that a named face of the original box still
  resolves to a spine face with the same `persistentId` after the cut + fuse, from 4
  camera angles + 2 zooms. Existing boolean/advanced-boolean specs pass unchanged.
- **App still works:** behaviour identical; full suite green.

### Stage S4 — Migrate features + local ops + surfacing

- [ ] **S4.1** — Migrate `extrudeRect`, `revolveRect`, `loft`, `sweep`, `pipeShellSweep`,
  `loftTangent` → `SpineBody`.
- [ ] **S4.2** — Migrate `filletAll`, `chamferAll`, `variableFillet`, `cliffEdgeBlend`,
  `mitreCorner` → `SpineBody`; carry persistent IDs through (fillet *generates* new
  faces — record `derivedFrom`).
- [ ] **S4.3** — Migrate `shell`, `thicken`, `offsetShape`, `draft`, `simplify`,
  `stitchFaces`, `convergentSolid`, `subdivideShape`, `retopoShape`,
  `catmullClarkShape` → `SpineBody`.
- [ ] **S4.4** — Migrate the NURBS facade ops (`buildNurbsPatch`, `refineNurbs`,
  `elevateNurbsDegree`, `trimmedNurbsFace`) → `SpineBody`. (`intersectSurfaces`,
  `classAAnalyze`, `nurbsCurvature` are analyses, not body-producing — they consume
  `SpineBody.shape`, no change needed.)
- **Deliverable:** **every body-producing facade op** returns a `SpineBody`. `BrepShape`
  is now used only internally by `SpineBody` as the OCCT wrapper.
- **e2e verification:** `e2e/spine-feature-coverage-electron.spec.js` — a multi-feature
  part workflow (extrude a profile, shell it, fillet edges, draft a face) all via real
  ribbon tools, motion-captured; after each op assert the result is a valid spine body
  (`validateSpine` ok). Every existing feature/local-op/surfacing e2e passes unchanged.
- **App still works:** behaviour identical; full suite green.

### Stage S5 — Body-kind taxonomy + non-manifold first-class

- [ ] **S5.1** — `deriveBodyKind` + per-kind invariants (§2.2) wired into `bindSpine`;
  every body now carries a correct `kind`. `BodyRegistry` entries show the kind.
- [ ] **S5.2** — **Wire bodies** become first-class: a sketch profile / sweep path
  bound as a `wire` `Body` (a shell of wire edges, no faces). Wire `SpineBody`s render
  as polyline overlays in the scene (a small `brepToMesh` extension for the faceless
  case).
- [ ] **S5.3** — **Sheet bodies**: open-surface results (e.g. a single trimmed NURBS
  face, a stitched open shell) bind as `sheet` bodies; `thicken`'s sheet→solid contract
  is made explicit (it consumes a `sheet`, emits a `solid`).
- [ ] **S5.4** — Non-manifold: confirm `fuseNonManifold`/`fuseLattice` results spine into
  bodies with non-manifold edges + radial coedge cycles; expose
  `body.nonManifoldEdges()`.
- **Deliverable:** the wire/sheet/solid taxonomy is real and visible; non-manifold is a
  property of the spine, not a hidden BOP detail.
- **e2e verification:** `e2e/spine-body-kinds-electron.spec.js` — three workflows in one
  spec: (a) draw a wire profile → confirm a `wire` body, rendered as a polyline; (b)
  build an open sheet → `thicken` it → confirm `sheet`→`solid` kind transition; (c)
  `fuseNonManifold` two plates sharing a face → confirm a non-manifold edge with 3
  coedges. Motion-captured, multi-angle. Existing specs green.
- **App still works:** new capability is additive; full suite green.

### Stage S6 — Unify the native analytic faces into spine faces (HIGH RISK)

- [ ] **S6.1** — Refactor `BrepBlendG2.g2BlendBetweenEdges`: instead of parking a
  side-car `TopoFace` on `meta.analyticFace`, spine-bind the OCCT triangle-shell result
  **and replace** the blend face's spine `Face` with an ArchDisc-analytic spine `Face`
  (`Surface` = the exact `NurbsSurfaceAdapter`, `geomRef` = null), stitched into the body
  via shared edges/coedges (§2.7).
- [ ] **S6.2** — Same for `BrepNSided.nSidedPatch` and `BrepRewrite.replaceFace`
  (curved-swap path). `AnalyticNurbsFace.js` / `FaceReplace.js` are refactored to produce
  *spine* `Face`s directly (they already build `TopoFace`s — the change is to emit the
  new `Face` class and attach them into a `Body`).
- [ ] **S6.3** — STEP export (`foundation/StepExport.js` / `nurbsSurfaceToSTEP`) re-pointed
  to read analytic faces **from the spine body** (`body` faces whose `Surface.analytic`)
  rather than from `meta.analyticSurface`. `meta.analyticFace`/`meta.analyticSurface`
  side-cars retired.
- [ ] **S6.4** — `brepToMesh` handles the heterogeneous body: OCCT-backed faces
  tessellate via OCCT, analytic faces via `NURBSSurface.tessellate`; one merged mesh.
- **Deliverable:** the §1.2 side-car is gone — a blend/patch/replaced face is a genuine
  face *of the body's spine*, and a body can mix OCCT-backed and analytic faces uniformly.
  Closes program-plan §6 residual gap.
- **e2e verification:** `e2e/spine-analytic-faces-electron.spec.js` — workflow: build a
  notched plate, G2-blend two edges (real "G2 Blend" ribbon tool), then verify the blend
  face is enumerable as a spine `Face` of the body with an `analytic` surface, that
  `validateSpine` still passes (the analytic face is correctly stitched), that STEP
  export still emits `B_SPLINE_SURFACE_WITH_KNOTS`, and that the body renders correctly
  from 4 angles. The existing `brep-g-g2blend-electron.spec.js`, `class-a`, `nurbs-trim`,
  `face-replace` specs pass unchanged.
- **App still works:** STEP export + rendering verified identical; full suite green.

### Stage S7 — Topology-inspector UI + introspection + Model C quarantine

- [ ] **S7.1** — Extend the existing **Part Browser** panel (`components/
  PartBrowserPanel.jsx`) into a **Body Browser with a topology tree**: each body row
  expands to `Lump → Shell → Face/Edge/Vertex` (lazy-rendered from the spine `Body`).
  This is a panel that *already exists* in the right aside — **no new floating panel**;
  it is an enrichment of the established `PartBrowserPanel`, matching the
  `feedback_no_floating_panels` standard.
- [ ] **S7.2** — **Viewport pick ↔ tree sync**: picking a face/edge in the 3D viewport
  (the existing gizmo pick-set) highlights the corresponding spine entity in the topology
  tree, and vice-versa — clicking a tree node highlights + frames the entity in the
  viewport. This is the SP-1 "topology-inspector viewport interaction" the program-plan
  §5 calls for. Pick identity is the **persistent ID**, not the explorer index.
- [ ] **S7.3** — A per-entity readout (selection-driven, in the existing PropertyManager
  pattern): picked face → surface type, area, loop count, persistent ID, `derivedFrom`;
  picked edge → curve type, length, coedge count (manifold/non-manifold), tolerance;
  picked vertex → coordinates, valence. Matches the existing `Interference`/measurement
  readout pattern — no floating box.
- [ ] **S7.4** — Introspection: `window.__lastSpine` (the last body's spine `Body`),
  `window.__lastSpineValidation` (its `validateSpine` report). For e2e + AI introspection,
  consistent with the `window.__last*` convention.
- [ ] **S7.5** — **Quarantine Model C**: confirm (by grep + an e2e smoke run) that no
  ribbon op routes through `kernel/features/PrimitiveBuilder|BooleanEngine|Extrude|
  Revolve|LoftSweep|FilletChamfer|DirectEdit`; remove them from `kernel/index.js`
  exports; either delete the files or move them under a clearly-labelled
  `kernel/_legacy/` with a header explaining they are the superseded demo-era kernel.
  Keep `FeatureTree.js` only if `FeatureTreePanel.jsx`/`Viewport3D.jsx` genuinely need it
  (verify; if they only need the panel data shape, decouple them from the dead kernel).
- **Deliverable:** the spine is *visible and inspectable* by the user; the codebase has
  one topology model.
- **e2e verification:** `e2e/spine-topology-inspector-electron.spec.js` — workflow: build
  a complex part (bracket with holes + fillets + a blend), open the Body Browser, expand
  the topology tree, motion-capture clicking through `Lump→Shell→Face`, pick a face in
  the viewport and assert the tree highlights it (and the reverse), read the per-entity
  readout, all multi-angle. Plus a full-suite regression run confirming Model C removal
  broke nothing.
- **App still works:** the UI is additive; Model C was already dead; full suite green.

---

## 5. Migration / no-regression strategy

**The strategy: introduce the spine as an additive layer, migrate ops one at a time
behind an adapter, never break the scene path.** Justification and mechanics:

1. **The adapter is `SpineBody`'s `BrepShape` compatibility** (S2.1). `SpineBody` exposes
   `.shape`, `.id`, `.meta` exactly as `BrepShape` does. Therefore `brepToMesh`,
   `measure`, `addBrepShapeToScene`, `BodyRegistry.selectedBrepShapes`, and `withScope`'s
   survivor detection all consume a `SpineBody` **without any change**. An op can return
   a `SpineBody` *or* a `BrepShape` and the downstream is identical. This is what lets
   S3/S4 migrate ops *incrementally* — at any moment some ops return `SpineBody`, some
   still return `BrepShape`, and the app is fully working.
2. **`bindSpine` is pure and additive** (S1). It never mutates the OCCT shape; it only
   reads it. Building the spine cannot regress geometry — worst case it throws, which an
   op wraps. So the spine can be built "alongside" with zero risk to the geometry path.
3. **Risk is front-loaded** (S1, S2 — the two HIGH-risk stages — come first). The single
   biggest unknown (can OCCT shapes be losslessly spined, and the S0-probed map bindings)
   is resolved before *any* op is migrated. If S0/S1 hit a binding wall, the plan adapts
   (documented fallbacks in S0.1) with zero migrated ops to unwind.
4. **Highest-traffic ops migrate first** (S3 = primitives + booleans). These are
   exercised by the *most* e2e specs, so a regression in the spine path surfaces
   immediately and loudly, not in a rarely-tested corner.
5. **Every stage ends green.** The acceptance gate for each stage is: (a) the new
   stage e2e passes, **and** (b) the *entire pre-existing ~388-test suite* passes
   unchanged. No stage is "done" until both hold. Because the adapter keeps behaviour
   identical, the pre-existing suite is the regression oracle — if it breaks, the spine
   migration of that op is wrong.
6. **`validateSpine` is the internal correctness oracle.** Every spine-producing op, in
   dev/test builds, runs `validateSpine` on its result; a structural defect (broken loop,
   missing coedge partner, Euler-Poincaré violation) fails fast in e2e rather than
   silently shipping a malformed body.
7. **`BrepShape` is retired last, gently.** After S4, `BrepShape` survives only *inside*
   `SpineBody` as the OCCT-wrapper sub-object (the heap-management role). It is never
   deleted — its memory-discipline code (`withScope`/`track`) is reused verbatim. The
   class is just no longer the *currency* between facade and scene.
8. **Model C is touched only at the end** (S7.5) and only after grep-proving it is dead —
   so its removal cannot regress anything.

**No feature flag is needed** — the adapter makes spine and non-spine ops coexist
transparently, which is cleaner than a global flag. The "flag" is simply "which ops have
been migrated," tracked by the S3/S4 checklists.

**No-regression summary:** the app works and the e2e suite is green at the boundary of
**every one of S0–S7**, because (a) S0–S1 add unused code, (b) S2 changes one op with an
identical-behaviour adapter, (c) S3–S4 repeat that proven pattern, (d) S5–S7 are purely
additive capability/UI, (e) the full legacy suite gates every stage.

---

## 6. UI contract (program-plan §5)

SP-1's UI deliverable is the **Body Browser / topology-inspector** (§4 S7), built to the
ArchDisc UI standards:

- **Ribbon-integrated, no floating panels.** The topology inspector is an *enrichment of
  the existing `PartBrowserPanel`* in the right aside — not a new floating box
  (`feedback_no_floating_panels`). The per-entity readout follows the existing
  `PropertyManager` / measurement-readout pattern.
- **Selection-driven.** The inspector consumes the user's existing viewport pick-set
  (the gizmo pick) — no hardcoded inputs. Picking in 3D drives the tree; clicking the
  tree drives the viewport highlight + frame. Entity identity is the **persistent ID**.
- **In-motion e2e.** `spine-topology-inspector-electron.spec.js` clicks the real tree,
  picks real viewport entities, records slow-mo video + key-frame stills, captures
  multiple camera angles + zooms.
- **Complete-workflow scope.** The inspector e2e builds a genuinely complex part first
  (bracket + holes + fillets + blend), then inspects it — the inspection is the climax of
  a real modelling workflow, not an isolated action.

This also lays the UI substrate the *later* sub-projects need: SP-2's attribute inspector
hangs off the same per-entity readout; SP-3's history panel keys on the same persistent
IDs; SP-9's push-pull picks the same spine faces.

---

## 7. Honest risks — the hardest stages flagged

**Hardest stages: S1 (bindSpine), S2 (the adapter + scene proof), S6 (analytic-face
unification).** These are flagged HIGH in §3. Specific risks:

1. **(S1) OCCT ancestry-map bindings may be unbound.** `bindSpine` needs face↔edge↔vertex
   ancestry to wire coedges and partners. `opencascade.js@2.0.0-beta` has documented
   binding gaps (`gp_Pnt2d` in `kernel-api-G.md`). If `TopExp.MapShapesAndAncestors` /
   `TopTools_IndexedDataMapOfShapeListOfShape` are unbound, S1 falls back to O(n²)
   `IsSame` pairing — correct but slower; for large bodies (the GE9X-scale assemblies in
   auto-memory) this could be a performance problem. **Mitigation:** S0's recon spec
   probes exactly this *first*; if unbound, the fallback is designed in S0.1, and a
   custom OCCT WASM build (Docker-gated) is the escalation path.

2. **(S1) Non-manifold radial ordering.** Building the correct radial coedge cycle around
   a non-manifold edge (ordering coedges by surface tangent angle) is genuinely subtle
   geometry. **Mitigation:** S1.3 tests it on real `fuseNonManifold` output; if the angle
   ordering is unreliable, the first cut ships an *unordered* coedge set on non-manifold
   edges (still correct topology — just no guaranteed radial order) and ordered cycles
   become a documented S5 refinement.

3. **(S2) The scene path is load-bearing for ~388 e2e.** `addBrepShapeToScene`,
   `BodyRegistry`, `withScope`, `window.__last*` are touched by everything. A subtle
   adapter mismatch (e.g. `withScope` not recognising a `SpineBody` survivor → a freed
   shape → a blank viewport) would be a broad breakage. **Mitigation:** S2 migrates
   *exactly one* op and the gate is the *entire* legacy suite passing — the blast radius
   is one op, the detection is total.

4. **(S6) Stitching an analytic face into an OCCT-backed body.** A G2-blend face is an
   ArchDisc `NURBSSurface` with no OCCT sub-shape; its boundary edges must be the *same
   `Edge` objects* as the adjacent OCCT-backed faces' edges, or the body is not a valid
   shell. Reconciling "this edge is shared between an OCCT face and an analytic face" —
   when one side has a `geomRef` and the other does not — is the trickiest single piece
   of S6. **Mitigation:** S6.1 does it for the G2 blend *only* first, with `validateSpine`
   as the oracle; if edge reconciliation proves unreliable, the fallback is that an
   analytic face is its *own one-face sheet shell* loosely associated with the body
   (less elegant, still a valid spine) — documented as a residual gap.

5. **(S6) STEP export re-pointing.** STEP export currently reads `meta.analyticSurface`.
   Re-pointing it to read from the spine must not regress the existing
   `B_SPLINE_SURFACE_WITH_KNOTS` emission. **Mitigation:** S6.3 keeps the existing STEP
   e2e as the regression oracle; the side-car is retired only after the spine-sourced
   path is proven byte-comparable.

6. **Performance at GE9X scale.** Auto-memory notes bodies with 1M+ triangles and 100k
   instanced components. Spining a huge boolean result builds a large JS object graph.
   **Mitigation:** the spine is built per-*body*, not per-scene; instanced assemblies
   (`MassiveAssembly`) share one spine. `bindSpine` is lazy where possible (loops/coedges
   built on first access). If a body is pathologically large, `bindSpine` can cap detail
   and flag the body `spinePartial` — documented honest limit. This is monitored from S1
   onward, not deferred.

7. **Scope honesty.** SP-1 delivers the spine *structure*, the OCCT-behind-it binding,
   the body-kind taxonomy, persistent IDs *with carry-through wired for the migrated
   ops*, non-manifold representation, and Euler-Poincaré *checking*. It does **not**
   deliver: incremental Euler-operator maintenance (that is SP-3's bulletin-board), a
   full attribute system (SP-2), or 100%-coverage persistent-ID carry-through across
   *every* exotic op (later sub-projects extend it). Calling SP-1 "done" means the spine
   is the single model, every body-producing op produces a validated spine body, and the
   app + e2e are green — not that topological naming is fully solved. That honesty is
   per the program plan's own §6 framing.

---

## 8. Definition of done

SP-1 is complete when **all** hold:

- [ ] `kernel/topology/` is the single topology model: `Body{kind} → Lump → Shell → Face
  → Loop → Coedge → Edge → Vertex`, with persistent IDs and the OCCT-geometry-engine-
  behind-it binding (§2).
- [ ] Every body-producing facade op returns a `SpineBody` carrying a validated spine
  `Body`; `BrepShape` survives only as `SpineBody`'s internal OCCT wrapper.
- [ ] `validateSpine` (Euler-Poincaré + structural invariants) passes on every primitive,
  boolean, feature, local-op, surfacing, and analytic-face result, exercised by e2e.
- [ ] Wire / sheet / solid body kinds are first-class; non-manifold edges are represented
  with radial coedge cycles.
- [ ] The native analytic faces (G2 blend, N-sided, face-replace) are genuine spine faces
  of their body; the `meta.analyticFace` side-car is retired; STEP export is regression-
  clean.
- [ ] The Body Browser is a topology inspector with viewport pick↔tree sync, keyed on
  persistent IDs; no floating panels.
- [ ] Model C (`kernel/features/*` geometry builders) is quarantined/removed; the codebase
  has one topology model.
- [ ] The pre-existing ~388-test e2e suite passes unchanged, **and** every new
  `spine-*-electron.spec.js` (S0–S7) passes — motion-capture, headed Electron, real
  ribbon workflows, multi-angle.
- [ ] SP-2 and SP-3 can begin — they have a persistent-ID-keyed spine to attach
  attributes and a transaction log to.

---

## Appendix — file change map

| File | Stage | Action |
|---|---|---|
| `e2e/spine-recon-electron.spec.js` | S0 | Create — empirical recon spec (Step 1) |
| `docs/superpowers/notes/topology-spine-A.md` + `-recon.json` | S0 | Create — verified bindings |
| `kernel/topology/{Body,Lump,Coedge,IdAllocator,Pcurve,bindSpine,validateSpine,SpineBody,index}.js` | S0–S1 | Create |
| `kernel/topology/{Shell,Face,Loop,Edge,Vertex}.js` | S0 | Create — adapted from `Topo{Shell,Face,Loop,Edge,Vertex}.js` |
| `kernel/brep/BrepShape.js` | S2 | Modify — `withScope` recognises `SpineBody` |
| `kernel/brep/BrepPrimitives.js` | S2–S3 | Modify — primitives return `SpineBody` |
| `kernel/brep/BrepBoolean.js`, `BrepBoolAdvanced.js`, `BrepTransform.js` | S3 | Modify — return `SpineBody`; ID carry-through |
| `kernel/brep/BrepFeatures.js`, `BrepLocalOps.js`, `BrepSurfacing.js`, `BrepFinal.js`, `BrepNurbs.js`, `BrepBlend.js`, `BrepSubdivide.js`, `BrepRetopo.js`, `BrepCatmullClark.js`, `BrepHeal.js`, `BrepNurbsTrim.js` | S4 | Modify — return `SpineBody` |
| `kernel/brep/BrepBlendG2.js`, `BrepNSided.js`, `BrepRewrite.js` | S6 | Modify — analytic faces become spine faces |
| `kernel/topology/AnalyticNurbsFace.js`, `FaceReplace.js` | S6 | Modify — emit spine `Face`s |
| `foundation/StepExport.js` (`nurbsSurfaceToSTEP` path) | S6 | Modify — read analytic faces from the spine |
| `kernel/brep/brepToMesh.js` | S5–S6 | Modify — wire-body polyline + heterogeneous-body mesh |
| `workbenches/mechanical-cad/ToolExecutionEngine.js` | S2–S7 | Modify — `addBrepShapeToScene` verified with `SpineBody`; `window.__lastSpine*` |
| `components/PartBrowserPanel.jsx` | S7 | Modify — topology tree + pick sync |
| `components/PropertyManager.jsx` | S7 | Modify — per-spine-entity readout |
| `kernel/features/*`, `kernel/index.js` | S7 | Quarantine/remove Model C |
| `e2e/spine-{scaffold,bind,makebox,boolean-identity,feature-coverage,body-kinds,analytic-faces,topology-inspector}-electron.spec.js` | S0–S7 | Create — one motion-capture e2e per stage |
