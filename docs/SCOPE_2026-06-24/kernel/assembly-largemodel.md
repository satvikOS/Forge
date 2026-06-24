# Forge Kernel Audit — Assembly Management + Large-Model Graphics + 100k-Instance

> Grounded audit of the **live** kernel tree at `forge-kernel/` (read 2026-06-24, not recall).
> Target: full industrial **1:1 parity with NX / CATIA large-assembly** — mates, instancing,
> graphics-only bodies, sub-tree rebuild. Real feature set, real data structures, real
> operational paradigms. NO lite versions.
> Discipline (Bible §0): OCCT stays live default + A/B oracle until each native op is
> A/B-proven; flip behind a flag; delete OCCT only at the very end vs a frozen golden corpus.

---

## 1. What Forge has TODAY (cited to real files/functions)

### 1.1 Instance store — `ComponentRegistry` (src/ComponentRegistry.cpp, include/forge/ComponentRegistry.hpp)
- **Singleton, flat `std::vector<Slot>` store** with a free-list (`addInstance`, `removeInstance`, `updateTransform`). `Slot = {ShapeHandle component, Transform4x4 xform, AABB aabb, bool alive}` (ComponentRegistry.hpp:104-109). 1-indexed `InstanceId` (0 = invalid).
- **True geometry instancing**: many instances reference one `ShapeHandle`; "a fastener BREP is built once and instanced 50,000 times via cheap transforms" (header note). This is the right paradigm and the core large-model win.
- **World-space AABB per instance**, recomputed lazily on `updateTransform` via `computeAABB` → **`BRepBndLib::Add` + `Bnd_Box`** (ComponentRegistry.cpp:201-206). **This is the sole OCCT dependency** in the registry (matches OCCT_ZERO_ROADMAP W2.1).
- **Spatial index**: SAH-binned **BVH** (src/BVH.cpp) with `queryAABB` / `queryRay` (slab test) / `queryFrustum` (positive-vertex test). `bvhDirty_` flag, lazy rebuild (`ensureBvhLocked`), linear-scan fallback when dirty. `reserve(n)` for bulk load. `bytesUsed()` accounting.
- **Proven at scale**: `test/bench_100k.js` adds 100k box instances, queries, removes 10k, then scales to **500k** with targets `buildBvh < 200 ms`, `queryAABB tiny < 0.2 ms`, `queryFrustum < 5 ms`. The 100k/500k culling substrate genuinely exists and is benched.

### 1.2 Sub-assembly tree — `AssemblyHierarchy` (src/AssemblyHierarchy.cpp)
- Parallel `parentOf_` / `childrenOf_` maps keyed by `InstanceId`. `setParent` with **cycle rejection** (`wouldCreateCycle` walks to root), `getParent`, `getChildren`, `clearAll`, `edgeCount`.
- **`worldTransform(instance)`** composes local × parent × … to root via `multiplyTransforms` (4×4). Correct recursive world-frame composition.

### 1.3 Mate solvers — TWO of them, both real:
- **`AssemblySolver` (src/AssemblySolver.cpp)** — registry-bound, **Gauss-Newton with numeric (forward-diff) Jacobian**, in-house sparse CSR + dense LDLT least-squares (`native::linalg`), backtracking line search, 6-DOF/instance (axis-angle via Rodrigues). Solves **8 mate kinds**: Coincident, Concentric, Parallel, Perpendicular, Distance, Angle, Tangent, Fixed (MateKind enum, AssemblySolver.hpp:50-59). `findDrivingMate` for motion. Fully native (zero OCCT).
- **`matelib` (src/MateLibrary.cpp)** — standalone **damped Gauss-Seidel**, **12 SolidWorks-equivalent kinds**: coincident, concentric, distance, angle, parallel, perpendicular, tangent, **gear, rack-pinion, cam, slot, width** (dispatch at MateLibrary.cpp:637-656). Works on arbitrary local points/axes (not schematic topoIds). **One OCCT call**: `rotateVec` uses `gp_Quaternion::Multiply` "for parity check" (MateLibrary.cpp:77-84) — trivially removable (OCCT_ZERO_ROADMAP W2.2).

### 1.4 Supporting subsystems
- **Interference** (src/InterferenceDetection.cpp): broad-phase inflated-AABB O(N²) sweep → narrow-phase **`BRepAlgoAPI_Common`** (OCCT) volume test. Returns `{instA, instB, volume}`. **OCCT-bound narrow phase.**
- **Motion study** (src/MotionStudy.cpp): drives a Distance/Angle mate value across N steps, re-solves each frame, captures transforms, restores state. Built on `AssemblySolver`.
- **LOD** (src/LOD.cpp): per-(handle,level) tessellation cache + screen-space `selectLOD` (pixel-coverage heuristic). One OCCT call `BRepTools::Clean` (no-op for native handles, OCCT_ZERO_ROADMAP W1.5).
- **Variants** (src/Variants.cpp): Latin-hypercube + Pareto front (design-of-experiments). Pure native.
- **Lineage** (src/LineageRegistry.cpp): `ShapeHandle → vector<LineageEntry>` map (feature provenance store).
- **Frontend-only assembly UX** (`frontend/src/kernel/forge/Assembly.js`, 426 LOC JS): `ExplodedView` (lerp explode), `ComponentPattern` (linear/circular/grid pattern of transforms), `BomRollup` (qty rollup), `SmartComponent`. **These are JS, NOT in the C++ kernel.**
- Bindings: `forge.assembly.*` namespace (binding.cpp:5341-5367) exposes addMate/removeMate/setMateActive/setFixed/solve/setParent/getChildren/worldTransform/detectInterference/runMotionStudy; instance ops + buildBvh/queryRay/queryFrustum at top level; `forge.matelib` separately.

**Bottom line on "have":** The *instancing + spatial-culling substrate* (100k/500k) is genuinely strong and native. The *mate-solver math* is real (20 kinds across two solvers). The *tree* exists. But everything above the transform-and-cull layer is either OCCT-bound (AABB, interference) or **absent at kernel level** (graphics-only bodies, sub-tree rebuild engine, product-structure I/O, per-instance state).

---

## 2. The GAP vs NX/CATIA large-assembly (specific, concrete)

### 2.1 No graphics-only / lightweight body representation (THE headline gap)
NX **"Lightweight"/JT facet** and CATIA **"Visualization Mode" (cgr)** let a 100k-part assembly open with only tessellated facets + bounding boxes in memory — the B-rep is loaded **on demand** per component when edited. Forge has **no such split**:
- `ComponentRegistry::Slot` holds a `ShapeHandle` into `ShapeRegistry`, which holds a full `TopoDS_Shape` (or native `Solid`) — **the exact B-rep, always resident** (ShapeRegistry.hpp:100). There is **no facet-only / box-only instance mode**, no "load B-rep on demand," no partial-load / unload, no out-of-core streaming.
- LOD caches tessellations but still requires the **full B-rep resident** to produce them. 100k *unique* parts (not instanced) would hold 100k full B-reps in RAM. NX/CATIA explicitly avoid this.
- **Missing data structures**: `InstanceRep { Precise | Lightweight | BoxOnly | Suppressed }` state per instance; a facet/JT cache decoupled from the B-rep; a component "load state" (loaded / unloaded / partially-loaded); reference-set / display-set selection.

### 2.2 No per-instance assembly state
`Slot` carries only `{component, xform, aabb, alive}`. NX/CATIA instances carry, per occurrence: **visibility, suppression/load-state, color/appearance override, material override, layer, reference-set, configuration/variant binding, instance name, display state**. None of these exist in the registry. Without suppression you cannot do **lightweight subtree loads, simplified reps, or configuration-driven assemblies**.

### 2.3 No sub-tree rebuild / dirty-propagation engine
There is **no associative rebuild graph** at assembly level. `MotionStudy` brute-force re-solves *all* mates each frame; `AssemblySolver::solve()` rebuilds the entire active-mate system from scratch every call. Missing:
- **Dirty propagation**: change one component → mark only dependent mates/children dirty → re-solve only that subtree (NX **"interpart expressions" / WAVE linking**, CATIA **knowledge/relations update**). Forge re-solves the whole mate set globally.
- **Mate dependency graph** (which mates couple which instances) for incremental/partitioned solves. Today coupling is recomputed per `solve()` via `mateByInst` (AssemblySolver.cpp:521).
- **Inter-part / context relations** (geometry of part B referencing part A's face — NX WAVE, CATIA contextual links). Absent entirely.
- **Component-level feature rebuild ordering / regeneration timestamp** — there is a `LineageRegistry` per shape but no assembly-level rebuild scheduler.

### 2.4 Mate system gaps vs production
- **Schematic topoIds** in `AssemblySolver`: only 0=origin, 1=+Z axis, 2=+Z face, 3=+X axis (AssemblySolver.hpp:31-36). **No real sub-shape references** (actual face/edge/vertex index on the B-rep). The header itself flags "A future slice will replace this with a real OCCT subshape index." Production mates attach to *named, persistent topological entities* that survive rebuild (NX/CATIA persistent IDs / topological naming). Forge has **no persistent topological naming** for mate references → mates cannot reliably re-bind after an edit.
- **No mate types**: Lock, Symmetric, Path mate, Linear/Linear-coupler, Limit/range mates, Screw mate, Universal-joint, Hinge with limits, **mate references / smart-mates** (auto-mate on drop). `matelib` has gear/cam/rack but the registry solver (the one wired to the tree + motion) has only 8 basic kinds.
- **No DOF analysis / under- & over-constraint diagnostics** surfaced (which DOF remain, which mates are redundant, which conflict). The solver reports a residual but not a DOF report or the redundant-mate set — NX/CATIA both show this.
- **No mate-on-pattern / component-pattern at kernel level** (`ComponentPattern` is JS-only, transforms only — no associative pattern that tracks the seed).

### 2.5 Interference / clash gaps
- Narrow phase is **OCCT `BRepAlgoAPI_Common`** (InterferenceDetection.cpp:96) — not native, blocks OCCT removal.
- Broad phase is **O(N²)** (InterferenceDetection.cpp:90-91) — explicitly bounded to "≤ a few hundred moving parts." **Does not use the existing 100k BVH.** Will not scale to a full-assembly clash on 100k parts.
- **Only hard-clash by intersection volume**. Missing: **clearance/soft-clash** (min-distance under threshold without intersection), **touch detection**, **clash sets / rules** (exclude same-part, ignore fasteners), **continuous/swept clash** along motion, and **clash result persistence** (approve/ignore). NX **Clearance Analysis** and **Simulation/motion interference** cover all these.

### 2.6 Product-structure I/O (read + write) is essentially absent
- STEP **write** emits a single `PRODUCT_DEFINITION` (StepAnalytic.cpp:540-561) — **no `NEXT_ASSEMBLY_USAGE_OCCURRENCE` (NAUO), no `MAPPED_ITEM`, no `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION`** → it cannot write a multi-part assembly with positioned instances. STEP AP242 assembly structure is not produced.
- STEP **read** of assembly product structure (NAUO graph + per-instance placement → ComponentRegistry instances + AssemblyHierarchy tree) **does not exist**. You cannot import a real NX/CATIA assembly's component tree.
- No JT / CGR / 3D-XML read (the formats large assemblies actually ship in). No assembly-level glTF instancing export through the hierarchy.

### 2.7 No large-assembly memory / streaming management
- Everything is resident: no **partial load**, no **unload of unused subtrees**, no **out-of-core** instance store, no **memory budget / eviction**. `bytesUsed()` reports but nothing acts on it. NX (lightweight + JT) and CATIA (visualization mode + cache) are built around this.
- BVH is a single flat tree rebuilt wholesale on any change (`build()` clears + rebuilds, BVH.cpp:230). No **refit/incremental update** or **two-level/TLAS** (per-component BLAS + instance TLAS), so a single moved instance in a 500k scene forces a full rebuild.

### 2.8 No appearance / render-state plumbing for big models
No per-instance color/material/transparency, no **section/cut-plane on the assembly**, no **display set / saved view states**, no **render-prep** (face-group merge, draw-call batching by material) — all required to actually *draw* a 100k-part model performantly.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Each step: real impl, dep stays as oracle until A/B-proven, CI-green per increment, dynamic not static.
LOC rough, kernel C++ unless noted.

### Phase A — flip the easy native gates (days; from OCCT_ZERO_ROADMAP W1/W2)
- **A1. Native instance AABB.** Replace `BRepBndLib::Add` (ComponentRegistry.cpp:201) with `brep::computeAABB(handle)` over the native solid/mesh; keep OCCT path for OCCT handles. **Verify:** A/B AABB on the 100k corpus (every instance min/max within 1e-9 of OCCT). ~120 LOC. *Removes the registry's only OCCT call.*
- **A2. matelib drop OCCT quaternion.** Replace `gp_Quaternion::Multiply` (MateLibrary.cpp:77-84) with the in-house Hamilton `rotateVec`. **Verify:** A/B the rotated vector vs OCCT on a random-quaternion sweep (1e-12). ~15 LOC deletion.
- **A3. Native interference narrow phase.** Route `BRepAlgoAPI_Common` (InterferenceDetection.cpp:96) through the native boolean (`native/csg` / `native/brep/Boolean`) for native operands; OCCT fallback for OCCT handles. **Verify:** A/B intersection volume on a known overlap suite + topology signature (face/edge/vertex counts), not just volume (per OCCT_ZERO_ROADMAP §6 coincidental-mass-props risk). ~200 LOC.

### Phase B — large-model graphics core (1–2 wks) — the headline differentiator
- **B1. Two-level BVH (TLAS/BLAS) + refit.** Build a per-component BLAS once; the registry holds a **TLAS over instance AABBs** that supports **refit** (update node boxes without re-partition) on `updateTransform`, and incremental insert/remove. **Verify (dynamic):** move 1k of 500k instances, assert refit query results == full-rebuild results, and refit time ≪ rebuild time (bench_100k extended). ~600 LOC.
- **B2. Per-instance state on `Slot`.** Extend `Slot` to `{component, xform, aabb, alive, RepMode rep, bool visible, bool suppressed, ColorOverride color, MaterialId material, uint32 layer}`; add registry setters/getters + bindings. **Verify:** round-trip state through bindings; suppressed instances excluded from solve/cull/interference; CI smoke. ~300 LOC + ~80 binding.
- **B3. Lightweight / graphics-only body representation.** Add `RepMode { Precise, Facet, BoxOnly }`. A `Facet` instance keeps only a cached `Mesh` (+AABB), **no B-rep resident**; `BoxOnly` keeps only the AABB. Add a **JT-like facet cache** keyed by component, decoupled from `ShapeRegistry`. Load/promote-to-Precise on demand (when an instance is selected for edit). **Verify (dynamic):** load a 100k-*unique*-part synthetic corpus in `Facet` mode, assert RAM ≪ Precise mode (measure `bytesUsed`), assert render mesh identical to Precise tessellation, assert promote-on-edit yields the full B-rep. ~700 LOC. **This is the single most valuable item — it is the NX-lightweight / CATIA-cgr capability and it does not exist today.**
- **B4. BVH-driven clash + clearance.** Replace the O(N²) sweep with the TLAS broad phase; add **clearance mode** (min-distance under threshold via native mesh/BVH closest-point — substrate exists in `native/implicit` envelope distance) and **clash sets / exclusion rules**. **Verify:** A/B hard-clash vs current OCCT-common result on the existing suite; clearance vs analytic known-distance cases; scale test on 100k. ~500 LOC.

### Phase C — assembly structure + I/O (2 wks)
- **C1. Persistent topological naming + real sub-shape mate refs.** Give B-rep faces/edges/vertices **stable persistent IDs** that survive rebuild; change `MateRef` from schematic topoId to a persistent sub-shape reference (resolve to a geometric frame at solve time). **Verify (dynamic):** edit a component's unrelated feature, assert mates re-bind to the same faces and the solve still converges (regression, not pure A/B). ~600 LOC (naming is the hard part; coordinate with the kernel-wide topological-naming workstream — see §4).
- **C2. STEP AP242 assembly write.** Emit `NEXT_ASSEMBLY_USAGE_OCCURRENCE` + `MAPPED_ITEM` + per-instance `AXIS2_PLACEMENT_3D` from the `AssemblyHierarchy` + `ComponentRegistry` transforms. **Verify:** write a 3-level assembly, read back through OCCT `STEPControl_Reader` (oracle), assert component count + per-instance placement match within 1e-6. ~400 LOC.
- **C3. STEP AP242 assembly read → product structure.** Parse the NAUO graph + placements into `ComponentRegistry` instances + `AssemblyHierarchy` tree (deduping shared components into one `ShapeHandle` instanced N times). **Verify:** import a known NX/CATIA STEP assembly, A/B instance count + tree + placements vs OCCT's product-structure reader. ~700 LOC. *(Depends on the native trimmed-NURBS reader keystone for the part geometry — see §4; until then read structure native, geometry via OCCT oracle.)*

### Phase D — sub-tree rebuild + diagnostics (1–2 wks)
- **D1. Mate dependency graph + partitioned/incremental solve.** Build a persistent coupling graph (instances ↔ mates); on a change, mark the affected connected component dirty and re-solve **only that partition**. **Verify (dynamic):** perturb one subtree of a multi-subtree assembly, assert only that partition's transforms change and the global residual matches a full solve. ~400 LOC.
- **D2. DOF / over-constraint diagnostics.** From the Jacobian rank at convergence, report remaining DOF, redundant mates, and conflicting mates. **Verify:** known under/well/over-constrained fixtures → expected DOF counts. ~250 LOC.
- **D3. Associative component pattern + mate-on-pattern (kernel).** Port `ComponentPattern` into the kernel as an associative instance generator that tracks its seed and updates when the seed moves. **Verify:** move seed → patterned instances follow; A/B transforms vs JS reference. ~300 LOC.

### Phase E — render-prep + memory management (1 wk)
- **E1. Out-of-core / unload + memory budget.** Subtree load/unload, LRU eviction of `Facet` caches under a byte budget, partial load. **Verify (dynamic):** stream a >RAM-budget assembly, assert no OOM, assert evicted subtrees reload correctly. ~400 LOC.
- **E2. Draw-call batching by material + assembly section plane.** Merge facet groups by appearance for fewer draw calls; cut-plane query over the TLAS. **Verify:** triangle/section-area parity vs per-instance reference. ~300 LOC.

---

## 4. The single biggest blocker + critical path

**Single biggest blocker: there is no graphics-only / lightweight body representation, and the whole stack assumes the full B-rep is resident for every instance (`ComponentRegistry::Slot` → `ShapeHandle` → resident `TopoDS_Shape`/`Solid`).** Every large-assembly capability NX/CATIA are built on — opening a 100k-*unique*-part model, partial load, out-of-core, fast clash, sectioning, configuration display sets — is downstream of decoupling **facets (display)** from **B-rep (edit)**. Today Forge's 100k story works *only because the benchmark instances one box 100k times*; a 100k-*unique*-part model would hold 100k full B-reps. **Build B3 (lightweight rep) first** — it is the keystone that unblocks B4 (scalable clash), C3 (importing real assemblies without exploding RAM), and E1 (out-of-core).

**Critical path:** `A1 (native AABB) → B1 (two-level BVH + refit) → B3 (lightweight/facet rep) → B2 (per-instance state, incl. load-state/suppression) → C1 (persistent topological naming) → C3 (STEP assembly import) → D1 (sub-tree incremental rebuild) → E1 (out-of-core)`.

**Cross-workstream dependency to flag:** C1 (persistent topological naming) and C3 (native trimmed-NURBS for imported part geometry) are **shared keystones with the OCCT-Zero roadmap** (its W3.1 native trimmed-NURBS reader is "THE keystone blocker"). Assembly import of real-world parts cannot fully drop OCCT until that native NURBS reader lands; sequence assembly-structure read (native) ahead of part-geometry read (OCCT oracle until W3.1). Interference/clash narrow-phase (A3) is gated on the native boolean lineage, also shared with OCCT-Zero W1.3.

**Honest scope note:** the instancing + culling substrate (ComponentRegistry + BVH + LOD + 100k/500k bench) is genuinely production-grade and native. The gap is *not* "we have nothing" — it is that everything above transform-and-cull (lightweight reps, per-instance state, real sub-shape mates with persistent naming, sub-tree rebuild, product-structure I/O, scalable clash) is missing or OCCT-bound. That is roughly **~5,000–6,000 LOC of new native kernel** across Phases B–E to reach credible NX/CATIA large-assembly parity, on top of the ~350 LOC of Phase-A flips.
