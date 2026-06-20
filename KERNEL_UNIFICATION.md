# KERNEL_UNIFICATION.md

**One native Forge kernel with the unified power of OCCT + Manifold + CGAL + libfive + PicoGK — no duplicate engines, no external runtime dependencies beyond the OCCT foundation already vendored/linked.**

Status: ARCHITECTURE + PHASED BUILD PLAN. This document separates **built & validated** (verified against the repo today) from **targeted** (not yet built — marked TODO/UNVERIFIED). Per Forge Engineering Bible rules 0/9: every external claim cites a real URL; every repo claim cites `file:line`; nothing is fabricated; a correct "not implemented" beats a fake "working".

Date of audit: 2026-06-20. Auditor working tree: `/Users/account_clawteam1/archdisc-Mech`.

---

## 0. Executive summary

- The single native kernel is `forge-kernel/` → `forge-kernel.node` (5.0 MB built artifact at `forge-kernel/build/Release/forge-kernel.node`, ls-confirmed). It is **B-rep/NURBS-complete today** on an **OCCT 7.9.3** foundation, plus a vendored 2D constraint solver (planegcs) and header-only Eigen/Boost. Verified: `forge-kernel/CMakeLists.txt:80-87` (OCCT toolkit list), `:104-113` (planegcs), `Standard_Version.hxx` → `OCC_VERSION_COMPLETE "7.9.3"`.
- **Two of the five capability classes are NOT in the native kernel today.** Guaranteed-manifold mesh booleans and implicit/F-rep/SDF + voxel/lattice design live **only in the JavaScript frontend**, on **two WASM npm runtime dependencies** — `manifold-3d` and `opencascade.js` — which directly contradict the "single native kernel / no dependencies" directive. These are the unification targets.
- **The CGAL capability class** (robust exact-predicate geometry + mesh repair) is **partially native already**: `forge-kernel/src/MeshRepair.cpp` exists and is bound (`meshrepair` namespace, `binding.cpp:6631`), but it is **float-precision, not exact-predicate**, and there is **no native robust-predicate (orient3d/incircle) layer** (grep for `orient3d|shewchuk|robust.predicate` over `src/ include/` returned nothing).
- **Plan:** route the frontend's geometry through the native kernel via the existing `window.forge.*` contextBridge (`electron/preload.js:1580`), build the missing manifold-mesh / implicit / voxel capabilities **in-house on top of OCCT's existing data structures and meshers** (no new third-party C++ libs), then delete `manifold-3d` and `opencascade.js` from `frontend/package.json`. This is a **multi-week effort** — see §5 for the honest phased plan with one validation test per capability.
- **No-deps tension, flagged for the user (§6):** robust *exact* boolean/predicate guarantees (the literal CGAL/Manifold correctness promise) are genuinely hard to reproduce in-house at full rigor. We can reach Manifold-class *robustness in practice* on OCCT + an in-house Shewchuk-predicate layer, but matching CGAL's *proven-exact* Nef/EPECK guarantees would, if you demand a formal proof of exactness, argue for vendoring a single header-only exact-predicate file. **This is the one place where "zero external code" and "guaranteed-exact" trade off. You decide.**

---

## 1. Task 1 — What is linked today, and what native capability already exists

### 1.1 Linked libraries (from `forge-kernel/CMakeLists.txt`)

| Dependency | How linked | Evidence | Class |
|---|---|---|---|
| **OCCT 7.9.3** | dynamic link to brew `/opt/homebrew/opt/opencascade`; 20 TK* toolkits | `CMakeLists.txt:43-87` (root + lib list); `Standard_Version.hxx` → `OCC_VERSION_COMPLETE "7.9.3"` | B-rep/NURBS foundation |
| **Eigen** | header-only include | `CMakeLists.txt:58-72, 89-94, 418-426` | linear algebra for in-house FEA/solvers |
| **Boost** | header-only include (graph + math constants, used by planegcs) | `CMakeLists.txt:96-102` | graph/math headers only |
| **planegcs** | vendored in-tree source, compiled into the .node | `CMakeLists.txt:104-113`; provenance `3rdParty/planegcs/UPSTREAM.md` (FreeCAD `0a45a0a`, LGPL-2.1+) | 2D sketch constraint solver |
| **node-addon-api** | header-only (N-API C++ wrapper) | `CMakeLists.txt:20-34` | binding glue |

The exact OCCT toolkits linked (`CMakeLists.txt:80-87`):
`TKernel TKMath TKG2d TKG3d TKGeomBase TKGeomAlgo TKBRep TKTopAlgo TKShHealing TKPrim TKBO TKBool TKFillet TKOffset TKHLR TKMesh TKDE TKDESTEP TKDEIGES TKDESTL TKDEVRML TKXSBase`.

These cover: B-rep data + math (`TKernel/TKMath/TKBRep`), curves/surfaces/NURBS (`TKG2d/TKG3d/TKGeomBase/TKGeomAlgo`), **boolean ops** (`TKBO/TKBool`), fillet/chamfer (`TKFillet`), offset/shelling (`TKOffset`), primitives (`TKPrim`), **shape healing** (`TKShHealing`), tessellation (`TKMesh`), hidden-line drawings (`TKHLR`), and Data Exchange STEP/IGES/STL/VRML (`TKDE*`).

### 1.2 Native source surface (built into the .node)

- `forge-kernel/src/` holds **291 files** (ls count). `binding.cpp` alone is **15,555 lines** (`wc -l src/binding.cpp`). `CMakeLists.txt:116-410` lists every compiled translation unit.
- Top-level native namespaces exposed to JS via `Init(...)` (`binding.cpp:4853-5850+`, verified by grep): flat primitive/boolean/transform/tessellate/massProps verbs **plus** the object namespaces
  `assembly, drawings, sketcher, fea, cam, cfd, simulate, part, surfacing, io, direct, heal, sheetMetal, weldments, airfoil, geotech, casting, mold, acoustics, welding, meshrepair` (and the large analytical-calculator set — the ~250 single-purpose `.cpp` engineering calculators in `CMakeLists.txt:189-409`).
- `version()` reports `{ forgeKernel: "0.1.0", occt: <OCC_VERSION_STRING_EXT> }` (`binding.cpp:4840-4846`).

### 1.3 Capability-class scorecard (native kernel only, today)

| Capability class | "Reference" library | Native today? | Evidence |
|---|---|---|---|
| **B-rep / NURBS** (solids, faces, exact curves/surfaces, fillets, drafts, shells, persistent topology) | OCCT | **YES — built & validated** | `src/Primitives.cpp`, `src/Booleans.cpp` (uses `BRepAlgoAPI_Fuse/Cut/Common`, `Booleans.cpp:4-6`), `src/Features.cpp`, `src/Nurbs.cpp`, `src/DirectModeling.cpp`, `src/Healing.cpp`, plus `LineageRegistry.cpp` for persistent naming |
| **Guaranteed-manifold mesh booleans** | Manifold | **NO — only in JS WASM** | native has NO Manifold-class mesh CSG; `src/Booleans.cpp` is OCCT BRep CSG, not a guaranteed-manifold mesh engine. The mesh-boolean path is `frontend/src/forge-v4/meshDispatch.js:31` (`manifold-3d`) |
| **Robust exact-predicate CG + mesh repair** | CGAL | **PARTIAL — float, not exact** | `src/MeshRepair.cpp` bound as `meshrepair` (`binding.cpp:6543-6631`): `analyse, dedupeVertices, removeDegenerate, fillHoles, laplacianSmooth, decimateEdgeCollapse`. All **float** (`MeshRepair.cpp:17` returns `float`). **No** exact predicates (grep `orient3d/shewchuk/robust.predicate` → none) |
| **Implicit / F-rep / SDF** | libfive | **NO — only in JS** | no native SDF/implicit/marching-cubes (grep `SDF/implicit/marchingCubes/tpms` over `src/ include/` → none). Lives in `frontend/src/foundation/`: `MarchingCubes.js`, `SmoothImplicit.js`, `PointCloudSDF.js`, all atop `manifold-3d` |
| **Voxel / lattice field-driven design** | PicoGK | **NO — only in JS** | no native voxel/lattice. Lives in `frontend/src/foundation/`: `LatticeTPMS.js`, `VoxelHexMesh.js`, `VoronoiPanel.js`, `MorphologicalFillet.js`, all atop `manifold-3d` |

**Conclusion of Task 1:** The native kernel is a complete OCCT-anchored **B-rep/NURBS** kernel with a strong analytical/CAE/CAM suite and a *float-precision* mesh-repair module. The **Manifold, libfive, and PicoGK** capability classes do not exist natively — they exist as JavaScript modules riding two WASM npm packages. The **CGAL** class exists only as a non-exact float mesh-repair start.

---

## 2. Task 2 — Dependency audit of the two WASM CAD deps

The directive "no dependencies / single native kernel" is in direct conflict with two runtime npm packages in `frontend/package.json:24-25`:

```
"manifold-3d": "^3.4.1",
"opencascade.js": "2.0.0-beta.b5ff984",
```

(Other geometry-touching deps — `three`, `three-gpu-pathtracer`, `cesium`, `jszip` — are **rendering / map / zip** utilities, not a second CAD kernel, and are out of scope for "duplicate CAD engine" removal. Flagged only so the user knows they were considered.)

### 2.1 `manifold-3d` (MIT, Emmett Lalish — https://github.com/elalish/manifold)

It is the guaranteed-manifold mesh CSG library used by OpenSCAD/Slic3r etc. (provenance and rationale are documented in-repo at `frontend/src/foundation/manifoldKernel.js:8-12`).

**Direct import sites (only 3 — the rest go through these):**
- `frontend/src/foundation/manifoldKernel.js:15,17` — the singleton WASM loader `getManifold()` (`:29-40`).
- `frontend/src/forge-v4/meshDispatch.js:31` — `ensureManifold()` (`:40-52`); mesh booleans + repair-self-intersect.

**Fan-out:** `Manifold` token appears across **111 files** under `frontend/src/`; `getManifold`/`manifoldKernel` is imported by **30 files** (grep counts). Foundation implicit/voxel modules that depend on it include: `MarchingCubes.js`, `SmoothImplicit.js`, `LatticeTPMS.js`, `VoxelHexMesh.js`, `VoronoiPanel.js`, `MorphologicalFillet.js`, `NURBSToManifold.js`, `ManifoldThreeBridge.js`, `PointCloudSDF.js`, `MeshRepair.js`.
**Consumers of the mesh-boolean dispatch** (`meshDispatch.js`): `SimulationWorkbench.jsx`, `SlicerWorkbench.jsx`, `MeshWorkbench.jsx`, `adaptiveMesh.js` (grep).

So `manifold-3d` is the JS backbone for **three** of the five capability classes: Manifold-mesh-booleans, libfive-implicit, and PicoGK-voxel/lattice.

### 2.2 `opencascade.js` (the WASM build of OCCT — https://github.com/donalffons/opencascade.js)

This is **OCCT compiled to WASM** — i.e. the frontend currently carries a **second, duplicate copy of OCCT** in the browser, in addition to the native OCCT 7.9.3 the .node already links. This is the clearest "duplicate engine" violation.

**Direct import sites (only 1 loader):**
- `frontend/src/kernel/brep/kernelLoader.js:12,14` — `getKernel()` / alias `getOCCT()` (`:23-36`).

**Fan-out:** `opencascade/initOpenCascade` token in **25 files**, almost all under `frontend/src/kernel/brep/*` (`BrepPrimitives.js`, `BrepBooleans`-style ops, `BrepNurbs.js`, `BrepBlend.js`, `BrepFeatures.js`, `BrepHeal.js`, `BrepSection.js`, `BrepTessellate.js`, `BrepTransform.js`, …) plus exporters `kernel/export/StepExportAp242.js`, `IgesExport.js` and `kernel/topology/geomAdapters.js`. Note `kernelLoader.js:7-9` already flags the dist filenames as needing confirmation ("NOTE: the dist filenames are confirmed in Task 1 Step 3") — UNVERIFIED whether this WASM path is exercised in the shipped Electron app vs. the native path.

### 2.3 Removal plan (route everything through the native kernel)

The native kernel is **already exposed to the renderer** as `window.forge.*` via `electron/preload.js` (`exposeInMainWorld('forge', forgeApi)` at `preload.js:1580`; addon resolved at `preload.js:32`). So the route exists — the work is to make the JS geometry call `window.forge` instead of the WASM modules.

1. **`opencascade.js` → delete first (lowest risk).** It is literally a duplicate of the native OCCT. Re-point every `frontend/src/kernel/brep/*` op at the equivalent native namespace (`window.forge.makeBox/fuse/cut/...`, `forge.part.*`, `forge.surfacing.*`, `forge.direct.*`, `forge.heal.*`, `forge.io.exportStep*`). Where a JS BRep op has **no** native equivalent yet, **add the native op** (it's a thin OCCT call) rather than keep the WASM. Net: remove `"opencascade.js"` from `package.json:25` and the `kernel/brep/kernelLoader.js` import.
2. **`manifold-3d` → replace with a native `mesh` namespace (the bulk of the work).** Build native guaranteed-manifold mesh booleans + repair + implicit + voxel (§3, §5) and expose them as `window.forge.mesh.*` / `forge.implicit.*` / `forge.lattice.*`. Migrate `meshDispatch.js` and the foundation modules to call those. Remove `"manifold-3d"` from `package.json:24` and the three import sites.
3. **Guard against regression:** add a build-time lint/test that **fails CI if `manifold-3d` or `opencascade.js` reappears** in `frontend/package.json` or in any `import`/`require` under `frontend/src/`. (Mirror the existing CI guard pattern noted in repo memory for gitignored locks.)

**Honesty note:** this is a large migration (136 files reference one of the two tokens). It is NOT a config flip. Sequence it per §5; do not delete a dep until its native replacement passes the validation test for that capability class.

---

## 3. Task 3 — Unified kernel architecture

### 3.1 Design principle: one representation set, one engine per job

The unified Forge Kernel keeps **one canonical representation per geometric kind** and **exactly one engine per operation class** — no two engines that both do "boolean", no two that both do "tessellate".

```
                        ┌───────────────────────────────────────────┐
                        │           Forge Kernel API (N-API)          │
                        │     window.forge.*  (one surface, one .node)│
                        └───────────────────────────────────────────┘
                                          │
        ┌──────────────┬──────────────────┼──────────────────┬──────────────┐
        ▼              ▼                  ▼                  ▼              ▼
   B-rep / NURBS   Mesh (manifold)   Implicit / F-rep      Voxel /        Exact
   ── OCCT ──      ── in-house ──    ── in-house SDF ──     Lattice field  predicates
   TopoDS_Shape    HalfEdgeMesh      Sdf tree (CSG of       VoxelGrid<f>   (Shewchuk
   (the truth      (guaranteed       analytic + sampled)    (PicoGK-class) orient3d/
   for B-rep)      2-manifold)                                             incircle)
        │              │                  │                  │              │
        └──────────────┴──────────────────┴──────────────────┴──────────────┘
                          CHARACTERIZED CONVERSIONS (lossy-marked, §3.3)
```

| Representation | Canonical type | Engine that owns it | Existing? |
|---|---|---|---|
| **B-rep / NURBS** | `TopoDS_Shape` (OCCT) | OCCT `TKBO/TKBool/TKFillet/TKOffset` — the **only** boolean/fillet/offset engine in the kernel | YES (`src/Booleans.cpp`, `Features.cpp`, `Nurbs.cpp`) |
| **Mesh** | in-house `HalfEdgeMesh` (positions/indices + half-edge adjacency) | in-house manifold-mesh-CSG (Manifold-class) | NO — TODO (§5 P2) |
| **Implicit / F-rep** | `Sdf` expression tree (CSG over analytic SDFs + sampled fields) | in-house SDF evaluator + dual-contouring/marching-cubes mesher | NO — TODO (§5 P3) |
| **Voxel / lattice** | `VoxelGrid<float>` (signed-distance or density field on a grid) | in-house field ops (offset/shell/lattice/TPMS/gyroid) | NO — TODO (§5 P4) |
| **Exact predicates** | `double` + adaptive-precision predicates | in-house Shewchuk `orient3d/incircle` layer shared by mesh-CSG + repair | NO — TODO (§5 P1) |

**No-duplicate rule, made concrete:**
- B-rep booleans are done **once**, by OCCT. The mesh-CSG engine is **not** a second B-rep boolean — it operates on `HalfEdgeMesh` only, and is the canonical answer when the input *is already a mesh* (imported STL, marching-cubes output, lattice). When a user booleans two B-rep solids, it goes to OCCT; when they boolean two meshes, it goes to the mesh engine; a **mixed** B-rep⊕mesh boolean is resolved by first converting the B-rep to mesh via the characterized conversion (§3.3), never by running two boolean engines.
- Tessellation is done **once**, by OCCT `BRepMesh` for B-rep (`src/Tessellate.cpp`) and by the SDF mesher for implicit/voxel. No third tessellator.
- Mesh repair / healing: OCCT `TKShHealing` heals **B-rep**; the in-house `meshrepair` + exact-predicate layer heals **meshes**. Two domains, not two duplicate engines.

### 3.2 The Forge Kernel API (one coherent surface)

Extend the existing flat+namespaced N-API surface (`binding.cpp:4853+`) with three new namespaces, mirroring the existing style (`assembly`, `fea`, `cam`, …):

```
window.forge
├── (B-rep, exists)   makeBox/Cylinder/... fuse/cut/common, part.*, surfacing.*,
│                     direct.*, heal.*, sketcher.*, io.*, drawings.*, …
├── mesh.*    (NEW)   fromBrep(handle, deflection) -> meshHandle
│                     booleanUnion/Cut/Intersect(a,b)   // Manifold-class, guaranteed 2-manifold
│                     repair.* (exact)  decimate  remesh  isManifold  validate
├── implicit.* (NEW)  box/sphere/cyl/gyroid/... (Sdf nodes)  union/cut/smoothUnion
│                     fromMesh(meshHandle, band)  toMesh(sdf, resolution) -> meshHandle (libfive-class)
└── lattice.* (NEW)   voxelize(brepOrMesh, pitch) -> voxelHandle
                      offset/shell/dilate/erode  tpms(gyroid|schwarz|...)  toMesh -> meshHandle (PicoGK-class)
```

Handles are integers in the existing `ShapeRegistry`/`LineageRegistry` style (`src/ShapeRegistry.cpp`, `src/LineageRegistry.cpp`), with a typed-handle discipline so a `meshHandle` can never be passed where a B-rep handle is expected (validity invariant, §3.4).

### 3.3 Characterized conversions (the inter-representation glue)

Every conversion is **explicit, directional, and characterized** (records what it costs). No silent lossy conversions.

| Conversion | Engine | Lossy? | Characterization recorded |
|---|---|---|---|
| B-rep → mesh | OCCT `BRepMesh_IncrementalMesh` (already used in `src/Tessellate.cpp`) | YES (curved → faceted) | `deflection`, `angularDeflection`, max chordal error, tri count |
| mesh → implicit/SDF | in-house narrow-band SDF from triangle soup (exact-predicate point-in-mesh) | YES (band-limited) | grid `pitch`, narrow-band width, fill method |
| implicit/SDF → mesh | in-house dual contouring / marching cubes | YES (sampled) | iso-resolution, feature-preservation flag |
| mesh → B-rep | OCCT `BRepBuilderAPI` per-face + sewing (`TKShHealing`); ONLY for planar/quadric fits, else flagged "no exact B-rep" | YES + may FAIL | fit tolerance, %faces fit, fallback note |
| voxel ↔ mesh | in-house marching cubes / voxelization | YES | pitch, iso |

**Rule:** the kernel never auto-promotes a mesh back to exact B-rep silently. mesh→B-rep is opt-in and returns an honest "could not produce exact B-rep for N faces" rather than a fake solid (consistent with the repo's no-fallback rule).

### 3.4 Persistent-naming strategy (single source of truth)

Persistent topological naming already exists natively for B-rep and **must remain the single authority** — there must not be a second naming scheme in JS.

- **B-rep:** OCCT boolean ops emit `Modified()/Generated()/IsDeleted()` lineage, which `src/Booleans.cpp:19-45` (`buildLineage`) already converts to the JS-facing lineage contract, persisted in `src/LineageRegistry.cpp`. The contract is documented to match `ForgeTopoIdRegistry.applyOp` on the JS side (`Booleans.cpp:22`). **Keep this; do not duplicate it.**
- **Mesh/implicit/voxel:** these representations don't have OCCT topology, so their elements (mesh faces, SDF nodes, voxels) get **stable IDs minted by the same `LineageRegistry`**, with provenance edges back to the B-rep face they were converted from (so a fillet selected on the B-rep can still be referenced after a mesh round-trip). The naming registry is **one** module; each representation registers its entities through it.

### 3.5 Validity invariant after every op

Every kernel op returns a result **only after** passing the representation's invariant; a failing op raises (no silent invalid handle), matching the existing `meshrepair.analyse` and `ShapeCheck`/`ShapeFix` pattern (`src/ShapeCheck.cpp`, `src/ShapeFix.cpp`).

| Representation | Invariant checked after every mutating op | Native checker |
|---|---|---|
| B-rep | `BRepCheck_Analyzer.IsValid()` (closed shells, no self-intersection, valid pcurves) | OCCT — already wrapped in `src/ShapeCheck.cpp` |
| Mesh | 2-manifold (every edge has ≤2 incident faces), consistent orientation, no degenerate tris, watertight if claimed solid | in-house `mesh.validate` (extends `meshrepair.analyse`, `MeshRepair.cpp`) — TODO exact version |
| Implicit/SDF | tree is finite, Lipschitz-bounded sampling produced a closed iso-surface | in-house — TODO |
| Voxel | grid finite, signed-distance sign-consistent | in-house — TODO |

---

## 4. What is buildable in-house vs. what genuinely needs an external lib

**Buildable in-house on OCCT + Eigen + (vendored) planegcs, no new third-party CAD libs:**
- **Manifold-class mesh booleans** — implementable as polygon-mesh CSG (triangle–triangle intersection, BSP/arrangement, in/out classification, re-triangulation) on the in-house `HalfEdgeMesh`. This is the Manifold algorithm class; it is well-documented and does not require Manifold's source. Robustness comes from the exact-predicate layer (below).
- **libfive-class implicit/F-rep** — an SDF expression tree + interval-arithmetic pruning + dual contouring/marching cubes is a self-contained algorithm; no library needed. We already have a JS reference (`frontend/src/foundation/MarchingCubes.js`, `SmoothImplicit.js`) to port to C++.
- **PicoGK-class voxel/lattice** — a `VoxelGrid<float>` with morphological ops (dilate/erode/offset/shell) and TPMS/gyroid sampling is pure arithmetic on a grid; no library. JS reference: `LatticeTPMS.js`, `VoxelHexMesh.js`, `VoronoiPanel.js`.
- **Mesh repair (CGAL-class, the algorithmic parts)** — dedupe, degenerate removal, hole filling, decimation already exist natively (`src/MeshRepair.cpp`). Upgrading them to **use exact predicates** is in-house work.

**The one genuine no-deps tension — exact-predicate / proven-exact geometry:**
- The *robustness* of CGAL and Manifold comes from **exact (or adaptive-exact) arithmetic predicates** (orient2d/3d, incircle/insphere). The classic in-house solution is **Shewchuk's adaptive-precision predicates** — a single, public-domain, header-/single-file routine (reference: Shewchuk, "Adaptive Precision Floating-Point Arithmetic and Fast Robust Geometric Predicates," Discrete & Comput. Geom. 18:305-363, 1996 — https://www.cs.cmu.edu/~quake/robust.html). Writing these ~1 file ourselves keeps "no external library" true (it's not a dependency, it's in-tree source, exactly as planegcs is vendored per `3rdParty/planegcs/UPSTREAM.md`).
  - **DECISION (user, 2026-06-20): option (b) — re-derive predicates from scratch.** The directive "official kernels, no dependencies, native only" is taken at full strength: NOT one line of outside code for the predicate layer. We derive and validate our own adaptive-precision exact predicates (orient2d/3d, incircle/insphere) in-tree from first principles, cross-checking sign results against Shewchuk's published reference values as an independent *oracle* (not by copying his source). Accepted trade-off (the user is aware): slower to validate and higher subtle-non-robustness risk than vendoring one file — so the Phase-1 predicate gate (§5 P1) MUST include an exhaustive degenerate / near-degenerate fixture suite plus a perturbation/consistency check before any mesh-CSG relies on it.
  - **Scope of "no dependencies / native only" re: OCCT — HONEST FLAG.** Taken literally, "no dependencies" also indicts OCCT, Eigen, Boost, and vendored planegcs (all external code the kernel links/compiles). Interpretation in force unless the user says otherwise: **OCCT 7.9.3 is the accepted *foundation*** (treated like the C++ compiler / stdlib) — every serious solid-modeling kernel that is not one of the 3 commercial incumbents (Parasolid / ACIS / CGM) is built this way, and those incumbents each represent 30+ years of investment. Re-implementing a Parasolid-class B-rep/NURBS kernel from scratch to remove OCCT is a **multi-year moonshot**, not a multi-week task, and will NOT be silently pursued. What "native only / no deps" concretely buys now: (1) zero NEW third-party libs (enforced by the C0 dep-allowlist ratchet), (2) the four non-OCCT capability classes built in-house (not via Manifold/CGAL/libfive/PicoGK), (3) removal of the WASM npm CAD runtimes. **DECISION (user, 2026-06-20): YES — replace OCCT with an in-house pure-C++ B-rep kernel too** ("official kernels, no deps, no WASM, in-house B-rep too"). This is now an explicit, top-level track, NOT deferred. Honest framing (non-negotiable per Bible §0): this is a **multi-year, Parasolid/ACIS-class program** — the hardest software in the CAD industry. The in-house kernel is designed **based on OCCT (open-source) and other kernels' published architecture + algorithms** as the reference, re-implemented in pure C++ in-tree (studied, not linked). It is built REAL and validated, feature-by-feature, with **OCCT retained as the working foundation AND as the parity *oracle*** until each in-house capability passes its gate; OCCT is retired piece-by-piece only as the in-house kernel reaches parity. We NEVER rip out the working kernel and ship a stub (that violates no-fallback/no-stub and would break the product). `KERNEL_PARITY.md` tracks in-house-vs-OCCT status per feature; nothing is marked done until a test proves it matches OCCT (or analytic truth) within tolerance. Same rule for the WASM removal: `manifold-3d` / `opencascade.js` come out only as native pure-C++ replacements pass their gates.
- **Proven-exact (EPECK / Nef polyhedra) parity:** matching CGAL's *formal* exactness guarantee (arbitrary-precision rationals) is beyond Shewchuk-predicate robustness and is **not** a goal we can honestly claim to fully reach in-house in the multi-week window. We target **robust-in-practice** (snap-rounding + exact predicates), which is what Manifold itself targets and what 3D-printing/CAD-mesh workflows need — and we will **say so**, not claim CGAL-exact.

---

## 5. Task 4 — Honest, phased, test-by-test build plan (multi-week)

**This is a multi-week program, not a single slice.** Each phase is gated by one concrete validation test; do not start the next phase or delete a dep until the gate passes. Effort estimates are rough and UNVERIFIED until the phase is actually executed.

### Phase 0 — Migration scaffolding & guards (~3-5 days)
- Stand up empty native `mesh` / `implicit` / `lattice` namespaces in `binding.cpp` returning "not implemented" (honest stub that *raises*, not a fake success).
- Add CI guard test that fails if `manifold-3d`/`opencascade.js` appear in `frontend/package.json` *after the migration phases mark them removable* (start it as a warning).
- **Gate test:** `forge.mesh`, `forge.implicit`, `forge.lattice` exist and raise a clear "not implemented" error (proves the surface + handle plumbing without faking results).

### Phase 1 — CGAL-class: exact predicates + exact mesh validity (~1 week)
- Vendor (or re-derive — pending §4 user decision) Shewchuk `orient3d/incircle/insphere` into `3rdParty/predicates/` with an `UPSTREAM.md` (mirror `3rdParty/planegcs/UPSTREAM.md`).
- Upgrade `src/MeshRepair.cpp` validity (`analyse`) to use exact predicates for self-intersection + orientation; add `mesh.validate` / `mesh.isManifold`.
- **Gate test:** a curated set of known-degenerate meshes (sliver tris, near-coincident verts, self-intersections) is classified correctly with **no false negatives** vs. a hand-labeled fixture; predicate unit tests reproduce Shewchuk's published sign results on adversarial inputs.

### Phase 2 — Manifold-class: native guaranteed-manifold mesh booleans (~1.5-2 weeks)
- Implement `HalfEdgeMesh`, triangle–triangle intersection (exact-predicate), arrangement + in/out classification, re-triangulation; expose `mesh.fromBrep`, `mesh.booleanUnion/Cut/Intersect`.
- Migrate `frontend/src/forge-v4/meshDispatch.js` boolean/repair paths to `window.forge.mesh.*`.
- **Gate test:** the exact failure case in the repo's own rationale — "~30 sequential subtractions on a single envelope" (`frontend/src/foundation/manifoldKernel.js:8-9`) — runs to completion and every intermediate result passes `mesh.validate` (2-manifold, watertight). Plus: A∪A=A idempotence, A−A=∅, volume conservation under union of disjoint solids within tolerance.
- **On pass:** remove `manifold-3d` from `meshDispatch.js`.

### Phase 3 — libfive-class: implicit / F-rep / SDF (~1.5 weeks)
- Implement `Sdf` tree (analytic primitives + smooth-union/cut), interval-pruned evaluation, dual-contouring/marching-cubes mesher (`implicit.toMesh`), and `implicit.fromMesh` (narrow-band).
- Port the JS references `MarchingCubes.js`, `SmoothImplicit.js`, `PointCloudSDF.js` to native; re-point their consumers at `window.forge.implicit.*`.
- **Gate test:** an SDF sphere of radius r meshed at increasing resolution converges to volume 4/3·π·r³ within a stated tolerance that shrinks with resolution; smooth-union of two spheres produces a watertight, 2-manifold mesh (`mesh.validate` passes).

### Phase 4 — PicoGK-class: voxel / lattice field design (~1.5 weeks)
- Implement `VoxelGrid<float>`, `lattice.voxelize`, morphological `offset/shell/dilate/erode`, `lattice.tpms` (gyroid/Schwarz), `lattice.toMesh`.
- Port `LatticeTPMS.js`, `VoxelHexMesh.js`, `VoronoiPanel.js`, `MorphologicalFillet.js`; re-point consumers.
- **Gate test:** a gyroid lattice infill of a unit cube at a given pitch produces a connected, 2-manifold mesh with measured volume-fraction within tolerance of the analytic gyroid level-set target; a shell op preserves manifoldness.

### Phase 5 — Retire `opencascade.js` (the duplicate OCCT) (~1 week)
- For each native B-rep gap exercised by `frontend/src/kernel/brep/*`, add the thin OCCT op natively; re-point `kernelLoader.js`/`geomAdapters.js`/exporters at `window.forge.*`.
- **Gate test:** the existing `kernel/brep/*` operations (primitives, booleans, fillet, section, tessellate, STEP/IGES export) produce results matching the WASM path within tolerance on a fixture set; then remove `opencascade.js` from `package.json` and CI guard flips to **hard fail** on either token.

### Phase 6 — Unification hardening (~ongoing)
- Mixed-representation booleans via characterized conversion (§3.3); persistent-naming provenance across round-trips (§3.4); validity invariant wired into every new op (§3.5); multi-cam e2e per the repo's Forge e2e standard.
- **Gate test:** a B-rep solid → mesh boolean → back-reference a B-rep-selected face survives (naming provenance test); full suite green on all CI platforms.

**Total honest estimate: ~7-9 weeks** of focused work, single-heavy-step-at-a-time (consistent with the hardware-calm constraint in repo memory). None of Phases 1-6 is built today; all are **targeted**.

---

## 6. Decision flagged for the user (no-deps tension)

The **only** place where "no external code at all" collides with "CGAL/Manifold-class correctness" is the **exact-predicate kernel** (§4). The recommended resolution is to **vendor one self-contained, public-domain predicates source file in-tree** (Shewchuk; https://www.cs.cmu.edu/~quake/robust.html), documented in `3rdParty/predicates/UPSTREAM.md` exactly as planegcs is vendored — giving robust-in-practice geometry with **zero runtime/linked dependency**. If you require literally zero outside source, we re-derive predicates ourselves at the cost of a longer, higher-risk Phase 1, and we will **not** claim CGAL-exact (EPECK/Nef) guarantees — only robust-in-practice, which is what Manifold itself provides.

---

## 7. Evidence index (repo `file:line` and external URLs)

Repo (verified this session):
- OCCT link + version: `forge-kernel/CMakeLists.txt:43-87`; `/opt/homebrew/opt/opencascade/include/opencascade/Standard_Version.hxx` → `OCC_VERSION_COMPLETE "7.9.3"`.
- planegcs vendored: `forge-kernel/CMakeLists.txt:104-113`; `forge-kernel/3rdParty/planegcs/UPSTREAM.md`.
- Native B-rep booleans (OCCT, not mesh-manifold): `forge-kernel/src/Booleans.cpp:4-6` (`BRepAlgoAPI_Fuse/Cut/Common`).
- Native lineage / persistent naming: `forge-kernel/src/Booleans.cpp:19-45`; `forge-kernel/src/LineageRegistry.cpp`.
- Native mesh repair (float, not exact): `forge-kernel/src/MeshRepair.cpp:17`; bound `forge-kernel/src/binding.cpp:6543-6631`.
- No native implicit/SDF/voxel/exact-predicate: grep over `forge-kernel/src forge-kernel/include` for `SDF|implicit|marchingCubes|tpms|orient3d|shewchuk` → no hits.
- Built artifact: `forge-kernel/build/Release/forge-kernel.node` (5,019,840 bytes, ls).
- WASM deps: `frontend/package.json:24` (`manifold-3d`), `:25` (`opencascade.js`).
- `manifold-3d` import sites: `frontend/src/foundation/manifoldKernel.js:15,17`; `frontend/src/forge-v4/meshDispatch.js:31`. Rationale: `manifoldKernel.js:8-12`.
- `opencascade.js` import site: `frontend/src/kernel/brep/kernelLoader.js:12,14` (+ UNVERIFIED note `:7-9`).
- Native exposed to renderer: `electron/preload.js:32` (addon resolve), `:1580` (`exposeInMainWorld('forge', forgeApi)`).
- ShapeCheck/ShapeFix (B-rep validity): `forge-kernel/src/ShapeCheck.cpp`, `forge-kernel/src/ShapeFix.cpp`.

External (cite-before-claim):
- OCCT (Open CASCADE Technology): https://dev.opencascade.org/ ; STEP/Data-Exchange toolkits per OCCT docs.
- Manifold (Emmett Lalish, MIT): https://github.com/elalish/manifold
- opencascade.js (OCCT→WASM): https://github.com/donalffons/opencascade.js
- CGAL: https://www.cgal.org/
- libfive (implicit/F-rep): https://libfive.com/ ; https://github.com/libfive/libfive
- PicoGK (voxel/lattice, LEAP 71): https://github.com/leap71/PicoGK
- Shewchuk robust predicates: https://www.cs.cmu.edu/~quake/robust.html

**TODO/UNVERIFIED markers:** all of §3's `mesh`/`implicit`/`lattice` namespaces and §5 Phases 1-6 are **targeted, not built**. Whether the `opencascade.js` WASM path is actually exercised in the shipped Electron build (vs. the native `window.forge` path) is **UNVERIFIED** (`kernelLoader.js:7-9` self-flags this). Effort estimates in §5 are unverified planning numbers, not measurements.
