# Forge Kernel Audit — Voxel / Lattice / Field-Driven Design (vs PicoGK)

> Area: **Voxel / lattice / field-driven design** — full industrial 1:1 parity with
> **PicoGK** (voxel fields, lattices, implicit→mesh, AM-oriented).
> Auditor: senior CAD-kernel architect. Date: 2026-06-24.
> Method: per-file read of the live kernel under
> `forge-kernel/src/native/{voxel,implicit,am}` and the matching `include/…`
> headers, the gate tests under `test/native/{voxel,implicit,am}`, the
> JS binding (`src/binding.cpp`), `CMakeLists.txt`, and `OCCT_ZERO_ROADMAP.md`.
> Grounded in source, not recall. Discipline = Bible §0: real impl only, no
> MVP/stub, oracle stays until each native op is A/B-proven, CI-green per
> increment, dynamic not static.

---

## 0. TL;DR

Forge already has a **genuinely native, OCCT-free implicit/voxel core** that is
unusually complete for a young kernel: a dense scalar field engine, an analytic
SDF tree + F-rep tree (with analytic gradients + interval pruning), an expanded
primitive + TPMS library, field-level SDF operators (offset/shell/round/
twist/bend/elongate/smooth-blend), three Bravais strut lattices, voxel CSG,
level-set morphology, marching cubes **and** dual contouring sharing one mesh
type, mesh→SDF and mesh→F-rep reverse bridges, and a real **AM build-process
module** (LPBF inherent-strain warp + sinter shrink + automatic geometric
pre-compensation). This is the part of the kernel **least** dependent on OCCT —
`OCCT_ZERO_ROADMAP.md` is entirely about B-rep; the voxel/implicit stack is
already 100% native, pure C++20, standard-library only.

**But it is not yet PicoGK-parity, on two axes:**

1. **Production-scale data structure is missing.** Everything is a **dense**
   `VoxelGrid<float>` (one `std::vector<float>` over the whole AABB),
   **single-threaded**, no GPU. PicoGK is built on a **sparse narrow-band
   voxel field** (OpenVDB-class) precisely so a 200 mm AM part at 30–50 µm voxels
   (10^9–10^10 voxels) fits in memory and meshes in seconds. Forge cannot
   represent a real AM build volume at production resolution today — the dense
   grid would need tens to hundreds of GB. **This is the single biggest blocker.**

2. **The rich capability is not wired to the app.** Only **two** verbs from this
   whole stack reach JS via `binding.cpp`: `nativeNs.sdfSphereVolume` (a demo)
   and `nativeNs.amWarp` (LPBF warp). Lattice/TPMS/morphology/voxel-boolean/
   SDF-ops/dual-contour/mesh→SDF are **in-kernel-only** — an engineer driving
   Forge cannot reach them. PicoGK's whole value is the **scripting surface**
   (`Voxels`, `Lattice`, `ScalarField`, `VectorField`, `Mesh`, implicit
   modelling in C#); Forge's equivalent surface is essentially unexposed.

Beyond those two: graded/conformal lattices, the octet/diamond/Kelvin/stochastic
families, field-driven (variable-radius) struts, vector fields, true exact
thick-strut volume, MC33 disambiguation, and slicing/AM-output (no slicer, no
support generation, no `.cli`/G-code-from-voxels) are all absent.

---

## 1. What Forge has NOW (cited, from source read)

### 1.1 Dense field engine — `voxel::VoxelGrid<float>`
`include/forge/native/voxel/VoxelGrid.hpp` (+ `src/native/voxel/VoxelGrid.cpp`,
explicit `template class VoxelGrid<float>;`).
- Dense axis-aligned sampled scalar field: `(nx·ny·nz)` nodes, **uniform
  isotropic** spacing, origin, x-fastest layout (`index(i,j,k)=i+nx*(j+ny*k)`).
- `fillFromField(std::function<double(x,y,z)>)`, exact node access `at()`,
  **trilinear** `sample(Vec3)` with box clamping.
- Occupancy/volume by cell-center midpoint-Riemann rule
  (`countInsideCellsByCenter`, `occupiedVolumeByCenter`) — the validated volume
  measure.
- **6-connectivity flood-fill + percolation** (`analyzeConnectivity` →
  `ConnectivityResult{occupiedCells, largestComponent, componentCount,
  percolatesX/Y/Z}`).
- Analytic `sdfSphere` + `voxelizeSphere` helper.
- Honest limits stated in-header: dense only, isotropic only, no mesher here
  (deferred to shared IsoMesher).

### 1.2 TPMS level sets — `Tpms.hpp` + `implicit/SdfLibrary`
- `voxel/Tpms.hpp`: **gyroid** field `sin·cos` triad, `gyroidSheetField`
  (`|g|−t` shell band), `buildGyroidGrid`. Validated: volume fraction → 0.5,
  single bicontinuous percolating component (`voxel_gate.cpp` gates b,c).
- `implicit/SdfLibrary.hpp`: **gyroid / Schwarz-P / Schwarz-D / Neovius** as
  `|trigField|−t` periodic implicit fields, plus analytic primitives **torus,
  cone, capsule, roundedBox, hexPrism** with per-builder amplitude oracles and
  `SdfResult{ok,reason}` honest-failure. Gated by `sdflibrary_test.cpp`.

### 1.3 Strut lattices — `voxel::Lattice`
`include/forge/native/voxel/Lattice.hpp` + `src/native/voxel/Lattice.cpp`.
- **Three Bravais families**: `LatticeType::{Cubic, BCC, FCC}` as a periodic
  strut graph; each strut a **capsule SDF** (`capsuleSdf` = exact segment
  distance − radius); lattice field = **min over 3×3×3 cell neighbourhood**
  (`latticeSdf`, O(1)/query, requires `radius < cellSize`).
- `enumerateStruts` (de-duplicated world segments), `unitCellStrutLength`,
  `totalStrutLength`, **analytic volume oracles** `analyticStrutVolume`
  (thin-strut cylinder sum, asymptotically tight upper bound) and
  `analyticCapsuleVolume` (guaranteed union upper bound).
- `voxelize` (dense grid + margin pad + resolve guard), `buildLatticeMesh`
  (→ shared mesher), `measuredOccupiedVolume`. Gated by `lattice_test.cpp`
  (volume-fraction convergence + closed 2-manifold + honest-empty at r=0).

### 1.4 Voxel CSG — `voxel::VoxelBoolean`
`VoxelBoolean.{hpp,cpp}`: node-wise `unite=min`, `intersect=max`,
`subtract=max(a,−b)` on **aligned** grids (hard precondition `aligned()`,
`ok=false` if not — no silent resample). `enclosedVolume`, `contour` (→ shared
bridge). Closed-form **sphere-sphere CSG oracles** (cap/lens/union/difference
volumes). Gated by `voxelboolean_test.cpp`. Exactness caveat (min/max of two SDFs
is Lipschitz-1 bound, sign exact) stated honestly.

### 1.5 Level-set morphology — `voxel::Morphology`
`Morphology.{hpp,cpp}`: exact SDF offset identity `f'=f−d` →
`offset/dilate/erode/open/close`, `fieldVolume`, `isEmpty`, `meshVolume`
(through shared contour). Honest-empty on over-erode. Gated by
`morphology_test.cpp`.

### 1.6 Implicit / F-rep modelling — `implicit::*`
- `SdfTree.hpp`: value-semantics SDF expression tree (sphere/box/plane + CSG +
  smooth-union), numeric gradient.
- `FRepTree.hpp` + `FRepTree.cpp`: **analytic gradient via chain rule**
  (forward-mode AD) **and interval/range evaluation** over an AABB →
  `classify()` Outside/Inside/Crossing for **octree/cell pruning**; adds a
  cylinder primitive. This is real libfive-class machinery.
- `SdfOps.hpp` + `.cpp`: field operators — value transforms
  `offset/round/shell`, domain warps `elongate/twist/bend`, smooth blends
  `smoothUnion/smoothSub`. Gated by `sdfops_test.cpp`.

### 1.7 Meshers (shared) — `implicit::IsoMesher`, `implicit::DualContour`
- `IsoMesher`: classic Lorensen-Cline **marching cubes**, embedded tables, indexed
  soup → `Mesh{positions,triangles}` with `volume()`/`area()`. Sphere-volume
  convergence gated (`implicit_gate.cpp`).
- `DualContour`: Ju-Losasso-Schaefer-Warren **dual contouring** with QEF +
  truncated-SVD solve + cell clamping → **sharp-feature** reconstruction;
  sphere-volume preserved; closed surface. Gated (`dualcontour_test.cpp`).
- `voxel::VoxelMesh::contour`: the **one** bridge that meshes a `VoxelGrid<float>`
  by wrapping it as an `Sdf` (`GridFieldSdf`) → `IsoMesher::march` →
  `mesh::HalfEdgeMesh::buildFromSoup` (which **rejects** non-manifold soup,
  `ok=false`, never fakes). One mesh type across the whole stack.

### 1.8 Reverse bridges — mesh → field
- `implicit::MeshToSDF`: closed mesh → dense signed VoxelGrid; exact
  point-triangle distance (magnitude), ray-parity sign (perturbed), `closed`
  flag. Brute-force O(N_nodes·N_tris) (BVH flagged TARGETED). Gated.
- `implicit::MeshToFRep`: closed mesh → **lazily-evaluable** `Sdf` node backed by
  a **BVH (`geom::AABBTree`)** + 3-ray majority-vote sign; composes with CSG/
  smooth-blend and re-meshes. ok=false on open/non-manifold. Gated.

### 1.9 AM build-process simulation — `am::*` (the marketed differentiator)
`include/forge/native/am/Am.hpp` + `src/native/am/Am.cpp` (≈27 KB):
- **LPBF inherent-strain warp** `predictInherentStrainWarp` (tet4 CST + hex8
  trilinear FE, Jacobi-PCG, eigenstrain→nodal-force, build-plate clamp), elastic
  C from `materials::buildCompliance`. Calibration honesty propagated
  (`calibrated` flag).
- **Sinter shrink** `applySinterShrink` (affine, anisotropic, field-driven).
- **Automatic geometric pre-compensation** `preCompensate` /
  `preCompensateSinter` (inverse-warp morph iteration to nominal) — the "killer
  feature". Gated by `am_test.cpp`.
- **Exposed to JS** as `nativeNs.amWarp` (`binding.cpp:16573`) — the only
  field-design verb other than `sdfSphereVolume` that reaches the app.

### 1.10 Native-vs-OCCT posture (this area)
**Zero OCCT.** Every file above is `// Pure C++20 … No OCCT, no WASM, no
third-party libs.` `OCCT_ZERO_ROADMAP.md`'s 33 OCCT-dependent files are **all
B-rep**; none are in `voxel/`, `implicit/`, or `am/`. So unlike the B-rep audit,
**there is no oracle-removal blocker here** — the oracle for this area is the
**analytic closed-form** (sphere/lens/strut-volume/0.5 gyroid fraction), and
**PicoGK/OpenVDB as an external A/B reference**, not a compiled dependency.

**LOC in this area today:** voxel ~37 KB src+hdr, implicit ~5 files src, am
~27 KB — order **~5,300 LOC** of native field/voxel/AM code (measured).

---

## 2. The gap vs PicoGK (specific, concrete)

PicoGK = a sparse narrow-band voxel field engine (`Voxels`), implicit/lattice
library, mesh interop, and an AM-grade scripting surface. Mapping Forge → PicoGK:

### 2.1 Data structure & performance (CRITICAL)
- **No sparse / narrow-band / VDB-style storage.** Only dense
  `VoxelGrid<float>`. `grep` for `sparse|narrow.?band|VDB|octree` in voxel+implicit
  returns **zero** non-TARGETED hits. PicoGK's `Voxels` is a sparse field; a
  100–200 mm AM part at 30–50 µm needs 10^9–10^10 voxels → **dense is
  infeasible** (≥ tens of GB). Forge tops out at ~hobby-scale grids.
- **Single-threaded everywhere.** No `<thread>`, no parallel-for, no SIMD, no GPU.
  `fillFromField`, `latticeSdf` sampling, `analyzeConnectivity`, MeshToSDF
  brute-force loops are all serial. PicoGK/OpenVDB are heavily threaded.
- **No narrow-band level set** (signed distance maintained only in a thin shell
  around the surface) — the storage + re-normalization paradigm PicoGK inherits
  from OpenVDB. Morphology/booleans here rewrite the **whole** dense field.
- **No SDF re-normalization (fast-sweeping / fast-marching).** After many CSG
  min/max ops the field is only a Lipschitz-1 *bound*, not a true distance;
  PicoGK periodically renormalizes so offsets/morphology stay metrically correct.
  Forge has **no eikonal re-distance** anywhere.

### 2.2 Lattices (BREADTH gap)
- **Only 3 Bravais families** (cubic/BCC/FCC). Missing the AM-standard
  **octet-truss**, **diamond/cubic-diamond**, **Kelvin (tetrakaidecahedron)**,
  **iso-truss**, **re-entrant/auxetic**, and **stochastic (Voronoi/spinodal)**
  lattices — PicoGK ships/enables these.
- **No graded / conformal lattices.** `LatticeSpec` has a single scalar
  `radius` and `cellSize`; no per-cell or **field-driven variable radius/cell
  size**, no conforming-to-a-shell warp. Confirmed: `grep graded|conformal|
  field.?driven` over Lattice = TARGETED-only. PicoGK's signature feature is
  **functionally-graded** lattices (radius/thickness driven by a stress or
  distance field).
- **No anisotropic cells** (cubic cell only).
- **Thick-strut volume is only an upper bound** — no inclusion-exclusion exact
  thick-strut/merged-node volume (flagged TARGETED in `Lattice.hpp`).
- **No lattice trim to an arbitrary shell** as a first-class op (left to caller
  via SDF intersect) — PicoGK trims lattice ∩ solid as a one-liner.
- **No surface/skin lattices, no shell-infill hybrid** (solid skin + lattice
  core), a core AM workflow.

### 2.3 Fields & implicit modelling
- **No vector fields.** PicoGK has `VectorField` (for warping, flow, anisotropy);
  Forge has scalar fields only.
- **No field arithmetic surface** beyond `VoxelBoolean` (no general per-node
  `add/scale/lerp/clamp/remap`, no `ScalarField` algebra exposed).
- **No field-from-mesh thickness / medial-axis field**, no **wall-thickness
  field as a lattice driver** (the `mesh/WallThickness.hpp` exists but is not
  coupled to lattice grading).
- **Smooth field boolean on grids is TARGETED** (`// TODO(smooth-field-boolean)`)
  — only sharp min/max on `VoxelGrid`; the smooth `smin` exists for SDF
  *expressions* but is not ported to the dense-grid boolean.
- **No regrid / resample of misaligned grids** (`VoxelBoolean` hard-rejects;
  `// TODO(regrid)`). PicoGK resamples freely.

### 2.4 Meshing / contouring
- **No MC33 / asymptotic-decider**; ambiguous saddle cells produce a
  non-manifold soup that is **rejected** (honest, but a capability gap vs
  always-manifold output).
- **Dual contouring is uniform-grid only** (no octree/adaptive, no Manifold
  Dual Contouring guarantee) — self-intersection on thin features acknowledged.
- **No boundary capping** of a field clipped by the grid box (`// TODO(cap-
  boundary)`) — clipped solids mesh open.
- **No adaptive / error-driven meshing** (decimation to a triangle budget driven
  by curvature) — PicoGK leans on OpenVDB's adaptive mesher.

### 2.5 AM output chain (large gap)
- **No slicer.** No voxel/field → layer contours, no `.cli`/`.svg`/G-code/`.zip`
  slice export. PicoGK is AM-oriented end-to-end; Forge stops at warp + mesh.
- **No support-structure generation** (the dense lattice machinery is not wired
  to overhang detection → support lattice).
- **No build-plate / build-volume orchestration** (pack, orient-for-AM, nesting).
- **No surface-roughness / staircase / down-skin modelling** for AM as-built.

### 2.6 Scripting / exposure surface (the PicoGK *point*)
- **Almost nothing is exposed to JS.** `binding.cpp` exposes only
  `sdfSphereVolume` + `amWarp` from this whole stack. No `lattice`, `tpms/
  gyroid`, `voxelBoolean`, `morphology`, `sdfOps`, `dualContour`, `meshToSdf`,
  `meshToFrep` verbs. An engineer/Archie-CUA cannot do implicit/lattice modelling
  in Forge today. PicoGK *is* its scripting surface — this is the parity gap that
  most blocks user value.
- **No persistent voxel object / handle in the app** (no `Voxels` body that
  flows through the viewport, no field-body type alongside the B-rep body).

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Oracle policy for this area: the **analytic closed-form** stays the in-tree gate
(sphere/lens/strut volume, 0.5 gyroid fraction, convergence-under-refinement);
**PicoGK/OpenVDB is the external reference** to A/B against for the new
capabilities (volume fraction, distortion, slice contours) — install/keep it as
a comparison oracle, never compiled in. Each step ships real, gated, CI-green.

### Phase A — Expose what already exists (highest value / LOC, do FIRST)
**A1. Wire the existing stack to JS.** Add `nativeNs` verbs:
`latticeInfill`, `tpmsInfill` (gyroid/SchwarzP/D/Neovius), `voxelBoolean`,
`morphology` (dilate/erode/open/close/shell/offset), `sdfOps`
(round/shell/twist/bend/elongate/smoothUnion), `dualContour`, `meshToSdf`,
`meshToFrep`. Subsystem: `src/binding.cpp` + a thin `FieldBody` handle.
*Verify:* round-trip e2e (JS call → kernel → mesh in viewport), gate the
returned volume against the same analytic oracle the C++ gate uses. **~600–900
LOC.** No new kernel math — pure exposure. Unblocks engineer/CUA use immediately.

**A2. A field-body type in the app** so a voxel/lattice/TPMS result is a
first-class body (multi-cam e2e, headed). Subsystem: app bridge + viewport.
*Verify:* headed Playwright, ≥5 cam angles, against the existing demo harness.
**~400 LOC** (mostly app-side).

### Phase B — Lattice breadth + grading (the PicoGK signature)
**B1. Graded / field-driven lattices.** Extend `LatticeSpec` to accept a
`radiusField`/`cellField` (a `std::function` or an `Sdf`/`VoxelGrid` driver) so
strut radius varies in space. Subsystem: `voxel/Lattice`. *Verify:* analytic —
integrate πr(s)²·dL along struts as the oracle; assert measured occupied volume
converges to it under refinement, and that a linear radius ramp produces a
monotone volume-fraction gradient. **~300 LOC.**

**B2. New unit cells:** octet-truss, diamond, Kelvin, iso-truss, re-entrant
(auxetic). Subsystem: `voxel/Lattice` (each is a new strut template + analytic
length oracle). *Verify:* per-family `unitCellStrutLength`/`analyticStrutVolume`
oracle + convergence gate (mirror the existing cubic/BCC/FCC gate). **~400 LOC.**

**B3. Lattice ∩ shell + skin-core hybrid** as first-class ops (reuse SDF
intersect + an offset skin). *Verify:* volume = lattice-vol-inside-shell, A/B vs
PicoGK trim on a benchmark part. **~250 LOC.**

**B4. Stochastic lattices** (Voronoi/spinodal). Subsystem: new
`voxel/StochasticLattice`. *Verify:* target relative-density input vs measured
volume fraction within tol; connectivity/percolation via existing
`analyzeConnectivity`. **~500 LOC.**

### Phase C — Production data structure (the BLOCKER; heaviest)
**C1. Sparse narrow-band voxel field** (`voxel::SparseGrid`, tile/leaf-node
hashed storage, OpenVDB-class). Keep `VoxelGrid<float>` as the dense reference +
**A/B oracle** (every SparseGrid op must reproduce the dense result on small
grids bit-for-bit). Subsystem: new `voxel/SparseGrid` + adapters so the shared
`GridFieldSdf`/mesher/morphology/boolean run on it unchanged. *Verify:*
op-by-op A/B vs dense `VoxelGrid` on identical small fields (volume, occupancy,
connectivity, contour vertex set); then a memory/throughput benchmark at
production voxel counts the dense grid cannot reach. **~1,500–2,500 LOC** — the
single largest item.

**C2. Multi-threaded field eval + meshing** (parallel `fillFromField`, parallel
marching-cubes/DC over tiles). *Verify:* identical output to serial (A/B,
deterministic), wall-clock speedup. **~300 LOC.**

**C3. Eikonal re-distance (fast sweeping)** so morphology/offset stay metric
after CSG. *Verify:* on an exact analytic SDF, `redistance(min/max field)` must
return |∇f|→1 within tol and reproduce the analytic offset volume. **~400 LOC.**

### Phase D — Meshing robustness + AM output
**D1. MC33 / asymptotic-decider** in `IsoMesher` so ambiguous cells stay
manifold (eliminate the reject path). *Verify:* a saddle-config test field now
yields a closed 2-manifold (`HalfEdgeMesh::validate`), volume preserved. **~400
LOC.**
**D2. Boundary capping** of grid-clipped fields (reuse `mesh` planeClip). **~200
LOC.**
**D3. Voxel/field → slice contours + `.cli`/`.svg` export** (the AM chain start).
*Verify:* per-layer area integral = enclosed volume / layer height within tol;
A/B vs PicoGK slicer on a benchmark. **~500 LOC.**
**D4. Overhang detection → support-lattice generation** (reuses the lattice +
morphology + the AM warp). **~500 LOC.**

### Phase E — Fields & vector fields
**E1. `ScalarField` algebra** (add/scale/lerp/clamp/remap/min/max + smooth
boolean on grids — closes `// TODO(smooth-field-boolean)`). **~250 LOC.**
**E2. `VectorField`** (warp/advect a field; anisotropic lattice driver). **~400
LOC.**
**E3. Regrid/resample** misaligned grids (closes `// TODO(regrid)`). **~200 LOC.**

---

## 4. Single biggest blocker + critical path

**Biggest blocker: the dense-only `VoxelGrid<float>` (no sparse narrow-band
field).** Everything else in this area is *correct* but *small-scale*. A real AM
part at production voxel resolution (30–50 µm over 100–200 mm) is 10^9–10^10
voxels; the dense grid would need tens to hundreds of GB and is single-threaded,
so Forge **cannot represent or process a production build volume at all**. PicoGK
exists *because* it solved this with a sparse field. Without C1, graded lattices
(B1), AM slicing (D3) and support generation (D4) are demos, not production —
they have nowhere to live at real resolution.

**Critical path:**
`A1 (expose) → A2 (field-body) → C1 (sparse field) → C2 (threading) → C3
(re-distance) → B1 (graded) / D3 (slicer) → D4 (supports)`.

Rationale for the ordering vs Bible §0:
- **A first** because the capability already exists and is gated — exposing it is
  the fastest path to engineer/CUA value and to an honest CADGenBench
  field-design surface, at near-zero kernel risk.
- **C1 is the keystone**: it gates every production-scale claim. It is uniquely
  A/B-safe because the **dense `VoxelGrid` is its own perfect oracle** (small
  grids must match bit-for-bit), so it can be built behind a flag with the dense
  path staying default until proven — exactly the §0 discipline, with the bonus
  that the oracle is in-tree (no external dep to retire).
- **B (breadth) can proceed in parallel on the dense path** for small parts and
  re-target the sparse field once C1 lands — graded lattices and new cells are
  independent of storage.
- The **AM output chain (D3/D4)** is the most marketable PicoGK-parity
  differentiator but sits *after* C1 because it only matters at production
  resolution.

**Oracle-gap watch (this area's analogue of the B-rep oracle paradox):** PicoGK
is the external reference for volume-fraction / distortion / slice parity. Freeze
a **PicoGK-generated golden corpus** (a graded gyroid, an octet lattice, a
warp/pre-comp case, a slice stack) **before** building B/C/D so the new native
ops have a fixed truth source — analytic closed-forms cover spheres/lenses/struts
but **not** graded lattices or real slices.
