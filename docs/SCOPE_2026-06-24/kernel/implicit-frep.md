# Forge Kernel Audit — Implicit / F-rep / SDF Modelling vs libfive (1:1 parity)

> Area: **Implicit / F-rep / SDF modelling**. Target: full industrial parity with
> **libfive** (F-rep CSG tree, analytic gradients, interval pruning, octree
> dual-contouring meshing, transforms/remaps, bounds, the Studio/Guile op set).
> Grounded in the live source at `forge-kernel/src/native/implicit`,
> `forge-kernel/src/native/csg`, `forge-kernel/src/native/voxel`, the headers,
> the tests, `CMakeLists.txt`, and `src/binding.cpp` (read 2026-06-24).
> Discipline per Bible §0: real impl only, no MVP/stub; each native op stays
> behind an A/B gate against an oracle until proven; CI-green per increment.

---

## 0. TL;DR

Forge has a **respectable, honest, but narrow** implicit core: an eval-only SDF
tree, a separate F-rep tree with analytic gradients + interval evaluation, a
modest analytic primitive catalogue, a Quilez-style op set, two meshers
(marching cubes + uniform dual-contouring), and two mesh→field bridges. The math
that exists is real and tested at the unit level.

Three findings dominate the gap and are not visible from the file list alone:

1. **The implicit subsystem is almost entirely un-wired and largely un-built.**
   Of the eight implicit source files, **only `SdfTree.cpp`, `IsoMesher.cpp` and
   `DualContour.cpp` are compiled into `forge-kernel.node`** (`CMakeLists.txt`
   L440–442). `SdfLibrary.cpp`, `SdfOps.cpp`, `FRepTree.cpp`, `MeshToSDF.cpp`,
   `MeshToFRep.cpp` — and the voxel `Lattice.cpp` / `Morphology.cpp` — are **not
   in the addon target** at all. They exist only as standalone unit-test TUs.
   And of what *is* built, **the only JS-bound entry point is the demo function
   `forge.native.sdfSphereVolume(radius, n)`** (`binding.cpp` L16112–16128).
   There is no `frep.*`, no `sdf.*`, no `tpms.*`, no implicit boolean, no
   mesh→SDF op reachable by Archie/CUA. **The whole area is dark to the running
   product.** This is the #1 gap — bigger than any single algorithm.

2. **The two trees are duplicated and divergent**, and **F-rep collapses to
   eval-only at mesh time**, throwing away the very gradients/intervals that
   justify F-rep. `FRep::toSdf()` wraps the tree in an adapter that forwards
   `eval(p)` only (`FRepTree.cpp` L456–471); meshing then runs plain marching
   cubes, so analytic normals and interval pruning are never used to mesh.

3. **There is no octree / adaptive mesher and no interval-pruned evaluation
   pipeline** — the defining performance + feature-fidelity mechanism of libfive.
   Both meshers are dense uniform grids (`IsoMesher::march`, `DualContour::contour`),
   O(n³) field evals, no feature-preserving refinement, no sparse traversal.

---

## 1. What Forge has today (grounded)

### 1.1 SDF expression tree — `src/native/implicit/SdfTree.cpp` (+ `.hpp`)
- Value-handle `Sdf` over `shared_ptr<const SdfNode>`; `eval(p)` only, plus a
  **central-difference** `gradient(p,h)` (L36–44) — *not* analytic.
- Primitives: `sphere`, `box` (Quilez exact-exterior / Chebyshev-bound interior),
  `plane` (normalised) — **three** primitives.
- Operators: `unionOp`=min, `intersectionOp`=max, `differenceOp`=max(a,-b),
  `smoothUnionOp` (Quilez polynomial smin). Empty-operand → throws.

### 1.2 F-rep tree — `src/native/implicit/FRepTree.cpp` (+ `.hpp`)
- Separate `FRep` handle with three modes per node: `eval`, `evalGrad`
  (forward-mode AD, true chain-rule gradient), `evalInterval` (conservative
  interval arithmetic over an AABB) — `iadd/ineg/imin/imax/iabs/isquare/ilength3`
  helpers (L33–72). This is the genuine libfive-class machinery.
- `classify(lo,hi)` → Inside/Outside/Crossing from the interval (L385–390): the
  sound pruning predicate. **But nothing consumes it** — no octree calls it.
- Primitives: `sphere`, `box`, `plane`, `cylinder` — **four** (note: *different
  set* from SdfTree; cylinder lives only here).
- Operators: union/intersection/difference + `smoothUnionOp` with an
  envelope-theorem analytic gradient (L336–349).
- `toSdf()` adapter is **eval-only** (L456–471) → gradients/intervals dropped at
  mesh time; `mesh()` calls `IsoMesher::marchCubic` (dense MC).

### 1.3 Analytic primitive library — `src/native/implicit/SdfLibrary.cpp` (**NOT built into addon**)
- `torus` (exact), `cone` (bounded, exact on faces), `capsule` (exact),
  `roundedBox` (exact exterior), `hexPrism` (Quilez).
- TPMS implicit fields: `gyroid`, `schwarzP`, `schwarzD`, `neovius` as
  `|trigField| - t` with validated amplitude constants (L212–215). Honest:
  not distance fields, periodic, |∇f|≠1 by design.
- Returns `SdfResult{ok,sdf,reason}` — clean failure on degenerate input.

### 1.4 SDF field operators — `src/native/implicit/SdfOps.cpp` (**NOT built into addon**)
- Value transforms: `offset`, `round`, `shell` (|f|-t/2).
- Domain warps: `elongate` (exact), `twist`, `bend` (correct-sign bounds).
- Smooth blends: `smoothUnion`, `smoothSub` (smin/smax).

### 1.5 Meshers
- **Marching cubes** — `src/native/implicit/IsoMesher.cpp`: full Lorensen-Cline
  256-case edge/tri tables (verbatim), shared-vertex de-dup, outward winding,
  `Mesh::volume()`/`area()`. Dense uniform grid. (Built.)
- **Dual contouring** — `src/native/implicit/DualContour.cpp`: Ju-Losasso-
  Schaefer-Warren uniform-grid form; per-cell QEF with from-scratch Jacobi 3×3
  eigensolve + truncated pseudo-inverse + cell-box clamp; Hermite data from
  `Sdf::gradient` (central diff). Dense uniform grid; interior-edge quads only
  (closed). (Built.)

### 1.6 Mesh → field bridges (**NOT built into addon**)
- `MeshToSDF.cpp`: brute-force unsigned point-triangle distance (Ericson regions)
  + ray-parity sign → dense `VoxelGrid<float>`. O(voxels × triangles).
- `MeshToFRep.cpp`: BVH-accelerated closest-point distance + 3-ray majority-vote
  parity sign, wrapped as a composable `Sdf` node (`MeshFieldNode`). Requires a
  watertight, manifold, consistently-wound mesh (refuses otherwise).

### 1.7 Adjacent voxel/lattice (separate subsystem, `src/native/voxel`)
- `Lattice.cpp` (cubic/BCC/FCC strut SDFs, **not built**), `Morphology.cpp`
  (level-set offset, **not built**), `Tpms.cpp` (anchor TU only), `VoxelGrid`,
  `VoxelMesh`, `VoxelBoolean` (built). These overlap the implicit area but are a
  parallel dense-voxel path, not the F-rep tree.

### 1.8 Tests
- Per-module unit gates exist (`test/native/implicit/*_test.cpp`, ~2450 LOC) and
  a roadmap `implicit_gate.cpp` (sphere-volume convergence, box−sphere, smin).
  These compile the sources standalone — which is *why* the un-built files still
  "pass": they are never linked into the product.

---

## 2. The gap vs libfive (concrete, enumerated)

### A. Wiring / build (the dominant gap)
- **A1. Not compiled:** `SdfLibrary`, `SdfOps`, `FRepTree`, `MeshToSDF`,
  `MeshToFRep`, voxel `Lattice`/`Morphology` absent from the `forge_kernel`
  target (`CMakeLists.txt` L440–445 lists only SdfTree/IsoMesher/DualContour +
  VoxelGrid/VoxelMesh/Tpms).
- **A2. Not bound:** no `frep.*`/`sdf.*`/`tpms.*` JS surface; only the
  `sdfSphereVolume` demo (`binding.cpp` L16112). No handle type for an implicit
  body, no persistence, no participation in the document/lineage model.
- **A3. No interop with B-rep:** libfive is standalone, but Forge needs implicit
  bodies to coexist with the native B-rep (boolean between an FRep solid and a
  B-rep solid; mesh an FRep into a `NativeMesh` handle). No bridge exists.

### B. F-rep tree completeness (vs libfive `Tree` / `libfive_stdlib`)
libfive ships ~100 ops in `stdlib`. Forge has ~7 primitives + ~10 ops total,
split across two divergent trees. Missing, concretely:
- **B1. Coordinate/affine transforms as tree nodes:** `move`/translate,
  `rotate_{x,y,z}`, general 3×3, `scale` (uniform + non-uniform with Lipschitz
  correction), `reflect_{x,y,z,xy,...}`, `symmetric_{x,y,z}`. Forge has *no*
  transform node — you cannot place/orient a primitive inside the tree.
- **B2. More remaps:** `taper`, `revolve_y`, `shear`, generic `remap(f, gx,gy,gz)`
  (arbitrary coordinate functions). Forge has only twist/bend/elongate.
- **B3. Array / repetition:** `array_{x,y,z}`, `array_polar`, infinite `repeat`
  (mod-domain) — core libfive lattice/pattern ops. Absent.
- **B4. Blends beyond smin:** `blend_expt`/`blend_rough`, `blend_difference`,
  exponential & power smooth-min, `loft`/`loft_between` (implicit lofting along
  z). Forge has polynomial smin/smax only; **no `smoothIntersection`** node even.
- **B5. 2D sublanguage:** libfive has a full 2D shape set (`circle`, `rectangle`,
  `polygon`, `text`, `triangle`) + `extrude_z` to lift 2D→3D. Forge implicit has
  **no 2D primitives and no implicit extrude**; extrude/revolve live only in the
  *mesh* CSG path (`src/native/csg/Extrude.cpp`, `Revolve.cpp`), not as F-rep.
- **B6. Morphological/field ops:** `morph` (interpolate two fields), `clearance`,
  `offset` as a tree node (exists only in the un-built SdfOps), `attract`/`repel`.
- **B7. Single unified tree:** libfive has ONE `Tree`. Forge has SdfTree *and*
  FRepTree with different primitive sets and no shared node base — duplication
  the Bible explicitly forbids ("no duplicate engines").

### C. Evaluation engine (vs libfive `Evaluator` family)
- **C1. No interval/affine evaluator wired to meshing.** `FRep::classify` exists
  but is dead code; libfive's whole speed/quality story is interval pruning of an
  octree. Forge evaluates the field densely at every grid node.
- **C2. No tape / instruction compilation.** libfive flattens the tree to a
  register tape, does common-subexpression elimination, and (optionally) JITs.
  Forge re-walks a `shared_ptr` tree per `eval` (virtual call per node) — orders
  of magnitude slower and not SIMD/GPU-amenable.
- **C3. No feature/derivative evaluator for DC.** DualContour gets normals from
  *central-difference* `Sdf::gradient`, not the analytic `FRep::evalGrad` —
  inconsistent with the F-rep tree and noisier at sharp features.
- **C4. No batched/SIMD/GPU eval.** libfive has SIMD interval + (in forks) GPU.
  Forge is scalar, single-point, virtual-dispatch.

### D. Meshing (vs libfive `Mesh::render` octree DC)
- **D1. No octree dual-contouring** — the headline feature. No adaptive cell
  subdivision, no interval-pruned traversal, no error-driven refinement. Both
  Forge meshers are fixed uniform grids (`march`, `contour`).
- **D2. No manifold-guaranteeing DC** (Schaefer/Nielson manifold dual
  contouring). Forge's uniform DC emits one vertex per cell and can produce
  non-manifold edges where >1 surface component passes a cell; no manifold fix-up.
- **D3. No QEF feature clamping/sharpness control** beyond cell-box clamp; no
  detection of multiple surface sheets per cell (libfive splits cells / uses
  multiple vertices). Sharp edges/corners are not provably preserved.
- **D4. No watertightness/topology guarantee across the mesher** other than the
  "interior-edge only" trick (which simply *drops* boundary geometry — a domain
  the surface exits is silently clipped, not closed correctly).
- **D5. No normal output / no UVs** from the mesher (only positions+triangles;
  `Mesh` has no normals array). libfive returns normals.
- **D6. No multi-resolution / LOD or progressive meshing.**

### E. Robustness & correctness
- **E1. MeshToSDF/MeshToFRep sign is ray-parity**, honest but not exact; fails on
  open/non-manifold meshes (refuses) — no winding-number (generalized winding
  number / fast winding number) sign, which libfive-adjacent tools use for
  robustness on imperfect meshes.
- **E2. No `bounds`/automatic domain inference** for an arbitrary tree (libfive
  derives render bounds; Forge requires the caller to pass lo/hi).
- **E3. Smooth-union interval bound is loose** (k/4 slab) — fine, but no tighter
  affine-arithmetic option for thin features.
- **E4. No exact CSG-on-distance** (the min/max fields are Lipschitz bounds, not
  exact distances post-CSG) — acceptable and matches libfive, but there is no
  re-distancing / fast-marching pass to recover an exact field when needed
  (e.g. for offsetting a CSG result by a true distance).

### F. Serialization / interop
- **F1. No tree serialization** (libfive can save/load trees; Forge cannot
  persist an implicit body at all — there is no handle to persist).
- **F2. No script/DSL surface** (libfive has a Guile + Python frontend). Forge's
  equivalent would be the Archie/JS binding — which, per A2, doesn't exist yet.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Oracle for A/B: **libfive itself** (build it as a dev-only oracle; it is GPL, so
it stays a *test-time* comparator, never linked into the shipped product — same
discipline as OCCT-as-oracle in `OCCT_ZERO_ROADMAP.md`). Secondary oracles:
closed-form volumes/areas, and the existing `MassProps` for meshed solids.
Every step: CI-green, real impl, dynamic (driven through the binding/CUA where
applicable), topology signature checked (not just mass props — per the roadmap §6
"coincidental mass-props parity" warning).

### Phase A — Unify + wire what already exists (days; highest ROI)
- **A1. Merge SdfTree ⇒ FRepTree into ONE tree.** Make `FRep` the single tree;
  give every node `eval`/`evalGrad`/`evalInterval`; port SdfLibrary primitives
  (torus/cone/capsule/roundedBox/hexPrism) and SdfOps (offset/round/shell/
  elongate/twist/bend/smoothSub) onto it; delete the duplicate SdfNode path or
  reduce `Sdf` to a thin eval-only view of an `FRep`. *Subsystem:* `native/implicit`.
  *Verify:* every existing `*_test.cpp` still passes after re-pointing; per-op
  A/B value-field RMS vs libfive `stdlib` over a random point cloud < 1e-9 on the
  exact fields. *LOC:* ~400 (mostly moving + dedup).
- **A2. Compile everything into the addon.** Add `SdfLibrary.cpp`, `SdfOps.cpp`,
  `FRepTree.cpp`, `MeshToSDF.cpp`, `MeshToFRep.cpp`, `voxel/Lattice.cpp`,
  `voxel/Morphology.cpp` to the `forge_kernel` target. *Verify:* link succeeds;
  the standalone gates now also run as linked symbols. *LOC:* ~10 (CMake).
- **A3. Bind the F-rep surface to JS.** `forge.implicit.{sphere,box,cylinder,
  torus,cone,capsule,roundedBox,hexPrism, plane, gyroid/schwarzP/...}` →
  builder; `{union,intersection,difference,smoothUnion,smoothSub}` → ops;
  `{offset,round,shell,elongate,twist,bend}` → remaps; `mesh(tree,bounds,res)` →
  `NativeMesh` handle that flows into the existing viewport/massprops/STEP-faceted
  path. *Subsystem:* `src/binding.cpp` + a small `ImplicitBody` handle.
  *Verify:* headed CUA e2e — Archie types "make a gyroid-infilled bracket", body
  renders + measures; volume A/B vs analytic. *LOC:* ~600.

### Phase B — Interval-pruned octree dual contouring (the keystone)
- **B1. Octree builder driven by `evalInterval`/`classify`.** Recursively
  subdivide only `Crossing` cells; prune `Inside`/`Outside`. *Subsystem:* new
  `native/implicit/Octree.cpp`. *Verify:* prune count vs brute force; identical
  zero-set (Hausdorff distance to dense MC mesh < cell size). *LOC:* ~500.
- **B2. Octree dual contouring with analytic normals.** Replace central-diff
  Hermite with `FRep::evalGrad`; per-leaf QEF (reuse `solveQEF`); minimal-edge /
  face-collapse stitching across octree levels (Ju 2002 adaptive form).
  *Subsystem:* extend `DualContour.cpp` or new `OctreeDC.cpp`. *Verify:* A/B vs
  `libfive::Mesh::render` — vertex/triangle counts within tolerance, Hausdorff
  distance < ε, **manifold + watertight** via `HalfEdgeMesh::validate()`.
  *LOC:* ~700.
- **B3. Manifold DC + multi-vertex cells.** Detect >1 surface sheet per leaf,
  emit multiple vertices (manifold dual contouring). *Verify:* known
  non-manifold-prone inputs (two spheres kissing, thin shell) produce manifold
  output. *LOC:* ~400.
- **B4. Emit normals + automatic bounds inference** from the tree. *LOC:* ~150.

### Phase C — Tree completeness (parity breadth)
- **C1. Transform/affine nodes** (move/rotate/scale/reflect/symmetric) with
  Lipschitz-correct scale. *Verify:* A/B vs libfive transforms; |∇f| invariants
  on rigid transforms. *LOC:* ~300.
- **C2. Array/repeat nodes** (array_x/y/z, polar, infinite repeat). *LOC:* ~250.
- **C3. 2D sublanguage + `extrude_z`/`revolve`** as F-rep nodes (circle,
  rectangle, polygon, rounded-polygon; lift to 3D). Bridges the existing mesh-CSG
  extrude/revolve into the implicit tree. *Verify:* A/B vs libfive 2D + extrude;
  cross-check against `csg/Extrude.cpp` volumes. *LOC:* ~500.
- **C4. Blend family** (smoothIntersection, expt/rough blends, blend_difference,
  morph, loft_between). *LOC:* ~300.

### Phase D — Engine performance + robustness
- **D1. Tape compiler + CSE.** Flatten tree → register tape; common-subexpression
  elimination; interval + float interpreters over the tape. *Verify:* identical
  field values; ≥10× eval throughput on deep trees. *LOC:* ~700.
- **D2. SIMD batched interval/float eval** over the tape. *LOC:* ~400.
- **D3. Generalized/fast winding-number sign** for MeshToFRep/MeshToSDF so
  imperfect (open, slightly non-manifold) meshes get a robust sign. *Verify:* A/B
  vs current parity sign on watertight meshes (must agree); graceful on open
  meshes. *LOC:* ~500.
- **D4. Re-distancing / fast-marching pass** to recover an exact SDF from a CSG
  field when an exact offset/clearance is needed. *Verify:* |∇f|→1 post-pass.
  *LOC:* ~500.

### Phase E — Interop, persistence, DSL
- **E1. Implicit↔B-rep boolean + mesh-into-handle** so implicit bodies are
  first-class in the document. *LOC:* ~400.
- **E2. Tree (de)serialization** for save/load + lineage. *LOC:* ~250.
- **E3. Full Archie/CUA op vocabulary** (parametric verbs for every node) +
  training-corpus entries. *LOC:* ~300 binding + corpus.

---

## 4. The single biggest blocker + critical path

**Biggest blocker: the subsystem is un-built and un-bound (Phase A).** Unlike the
B-rep OCCT-zero work, the implicit gap is *not* a missing hard algorithm first —
it is that the real, tested code we already have does not compile into
`forge-kernel.node` and is not reachable by the product. Until Phase A lands, no
implicit capability — however good the math — affects Forge, CADGenBench, or any
demo. **This is cheap (~1000 LOC, mostly merge + CMake + binding) and unblocks
everything.**

**Critical path after A:** the keystone capability for *parity* is **B2 —
interval-pruned octree dual contouring with analytic normals**. It is what makes
Forge's implicit modeller a libfive peer rather than a uniform-grid toy: it
consumes the `evalGrad` + `evalInterval`/`classify` machinery that already exists
(today dead code), gives feature-preserving, manifold, adaptive meshes, and is
the gate for credible TPMS/lattice/organic geometry at engineering resolution.

**Must-precede order:** A1 (unify tree) → A2/A3 (build+bind) → B1 (octree) → B2
(octree DC) → B3 (manifold) → C (breadth) → D (perf/robustness) → E (interop).
A1 must precede B2 because octree DC needs `evalGrad`/`evalInterval` on *one*
tree (today gradients live on FRep but meshing runs through the eval-only SdfTree
adapter — they must be merged first).

**Oracle-removal discipline (Bible §0):** build libfive as a *test-only* GPL
oracle; A/B every native op (value-field RMS + Hausdorff mesh distance +
manifold/watertight topology signature, never mass-props alone); keep the dense
uniform meshers as the A/B fallback for the octree mesher until B2 is proven;
freeze a golden implicit corpus before retiring any path.

---

## 5. LOC summary
- Phase A (unify + wire + bind): **~1,000**
- Phase B (octree interval DC, the keystone): **~1,750**
- Phase C (tree breadth to libfive stdlib): **~1,350**
- Phase D (tape/SIMD/winding/re-distance): **~2,100**
- Phase E (interop/serialize/DSL): **~950**
- **Total to libfive 1:1: ~7,150 LOC** net new/rework (excluding the ~2,450 LOC
  of existing tests, which mostly carry forward).
