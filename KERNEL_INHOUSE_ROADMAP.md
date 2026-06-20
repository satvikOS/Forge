# KERNEL_INHOUSE_ROADMAP.md — bottom-up in-house kernel build order

**Companion to `KERNEL_UNIFICATION.md` (§0 goal, §4 decision, §5 plan) and
`KERNEL_PARITY.md`.** This document is the *honest, bottom-up build order* for
re-implementing the unified kernel **in-house, pure C++, no new dependencies,
no WASM** — studying OCCT and the other reference kernels' published
architecture/algorithms, but linking none of them for the new capabilities.

Date: 2026-06-20. Working tree: `/Users/account_clawteam1/archdisc-Mech`.
Auditor-verified baseline (this session, real output):

```
$ node forge-kernel/test/smoke.js
[smoke] version = { forgeKernel: '0.1.0', occt: '7.9.3', napiCpp: 8 }
[smoke] box ok — volume 0.9999999999999998 area 6 com [ 0.5, 0.5, 0.5 ]
[smoke] cylinder ok — volume 62.83185307179585
[smoke] cut ok — residual volume 0.9293141652942296
[smoke] tessellate ok — vertices 24 triangles 12
[smoke] lifecycle ok — refcounting honored
[smoke] ALL PASS
```

So the kernel works **today** on the OCCT 7.9.3 foundation. Nothing in this
roadmap is built yet; **everything below the baseline is TARGETED.** The only
"proven" facts are the negative ones a grep already establishes (see §A).

---

## §0 — The honest bottom line (read first)

- **This is a multi-year, Parasolid/ACIS-class program.** Re-implementing a
  B-rep/NURBS kernel from scratch (Stage 6) is the hardest software in the CAD
  industry — three commercial incumbents (Parasolid, ACIS, CGM) each represent
  30+ years of investment. Stages 1–5 (predicates → mesh → implicit → voxel)
  are individually *tractable in weeks-to-months each*; Stage 6 is the
  multi-year pole. **Nobody should read this doc as "ships this quarter."**
- **OCCT stays as foundation AND parity oracle** the entire time. We never rip
  out the working kernel and ship a stub. Each in-house capability is validated
  against OCCT (or against analytic truth where OCCT has no equivalent) *before*
  the corresponding OCCT/WASM path is retired. Retirement is per-capability, not
  big-bang. This is the no-fallback / no-stub rule (Bible §0/§9) applied to a
  kernel swap.
- **Honest robustness ceiling, stated up front (do NOT overclaim):** the target
  for the mesh/implicit/voxel stages is **robust-in-practice** (adaptive-exact
  *predicates* + snap-rounding), which is exactly what Manifold itself targets
  and what 3D-printing / CAD-mesh workflows need. It is **NOT** CGAL's
  *proven-exact* (EPECK / Nef polyhedra, arbitrary-precision rationals)
  guarantee. We will say "robust-in-practice," never "CGAL-exact," unless and
  until a Stage adds a rational-arithmetic kernel and a gate proves it.
- **Predicate decision in force (user, 2026-06-20, `KERNEL_UNIFICATION.md:206`):**
  re-derive the adaptive-precision predicates *from first principles* in-tree —
  not one line of outside code — cross-checking sign results against Shewchuk's
  *published reference values* as an independent oracle (not by copying source).
  Accepted trade-off: slower to validate, higher subtle-non-robustness risk than
  vendoring one file → the Stage-1 gate MUST be exhaustive (degenerate +
  perturbation/consistency fixtures) before any mesh-CSG relies on it.
- **Effort numbers are planning estimates, UNVERIFIED.** They are honest
  order-of-magnitude, not measurements. Stage 6 deliberately carries no week
  number — it is "multi-year, milestone-gated," and any single quarter only
  buys a slice of it.

---

## §A — What a grep already PROVES is absent (the only hard facts)

Run this session over `forge-kernel/src` + `forge-kernel/include`:

| Claim | Command | Result |
|---|---|---|
| No native robust predicates | `grep -rE 'orient3d\|orient2d\|incircle\|insphere\|shewchuk' src include` | **0 hits** |
| No native SDF / marching cubes / half-edge mesh / voxel | `grep -rE 'SDF\|MarchingCubes\|VoxelGrid\|tpms\|gyroid' src include` | only `MoldFlow.cpp` — a `struct HalfEdgeOwner` for mold-flow physics, **not a mesh engine** |
| `MeshRepair.cpp` is float, not exact | `grep -nE 'float\|double' src/MeshRepair.cpp` | `inline float v(...)`, `float epsf` — **float-precision** |
| Only one vendored 3rd-party lib | `ls forge-kernel/3rdParty` | `planegcs` (only) |
| No `src/native/` or `test/native/` yet | `ls src/native test/native` | **absent** (to be created by Stage 0) |

Everything else in this doc is a *plan*, not a measurement.

---

## §B — In-house module layout

New code lives in dedicated `native/` subtrees so it is unambiguously
"the in-house kernel" and never confused with the OCCT-binding files. The
existing kernel uses an **explicit source list** in
`forge-kernel/CMakeLists.txt:139` (`add_library(forge_kernel SHARED ...)`),
`include/` is already on the include path (`CMakeLists.txt:448`), and headers
already live flat under `include/forge/*.hpp`. We extend that convention:

```
forge-kernel/
├── src/native/                      # in-house pure-C++ implementations (.cpp)
│   ├── predicates/                  # Stage 1 — exact predicates (bedrock)
│   │   ├── ExactArithmetic.cpp      #   adaptive expansions (two-sum/two-product, grow-expansion)
│   │   └── Predicates.cpp           #   orient2d/3d, incircle/insphere (adaptive)
│   ├── mesh/                        # Stage 2 — half-edge mesh + manifold booleans
│   │   ├── HalfEdgeMesh.cpp         #   canonical mesh type + invariants
│   │   ├── MeshBoolean.cpp          #   tri–tri intersection, arrangement, in/out, retri
│   │   └── MeshValidate.cpp         #   exact 2-manifold / watertight / self-intersection
│   ├── implicit/                    # Stage 4 — SDF / F-rep
│   │   ├── SdfTree.cpp              #   expression tree (analytic + sampled, smooth ops)
│   │   ├── IntervalEval.cpp         #   interval-arithmetic pruning
│   │   └── IsoMesher.cpp            #   marching cubes / dual contouring → HalfEdgeMesh
│   ├── voxel/                       # Stage 5 — voxel / lattice
│   │   ├── VoxelGrid.cpp            #   signed-distance/density grid
│   │   ├── Morphology.cpp           #   offset/shell/dilate/erode
│   │   └── Tpms.cpp                 #   gyroid/Schwarz/diamond level sets
│   └── brep/                        # Stage 6 — in-house B-rep/NURBS (the OCCT replacement)
│       ├── geom/                    #   Bezier/BSpline curve+surface, NURBS eval (de Boor)
│       ├── topo/                    #   in-house Vertex/Edge/Wire/Face/Shell/Solid + half-edge-of-faces
│       ├── intersect/               #   curve–curve / surface–surface / SSI
│       ├── boolean/                 #   B-rep CSG (imprint + classify + sew)
│       └── feature/                 #   fillet/chamfer/offset/draft/shell on in-house B-rep
├── include/forge/native/            # public headers mirroring the above
│   ├── predicates/Predicates.hpp
│   ├── mesh/HalfEdgeMesh.hpp  mesh/MeshBoolean.hpp  mesh/MeshValidate.hpp
│   ├── implicit/SdfTree.hpp   implicit/IsoMesher.hpp
│   ├── voxel/VoxelGrid.hpp    voxel/Tpms.hpp
│   └── brep/...                # in-house B-rep public API (mirrors what OCCT TopoDS exposes)
└── test/native/                     # in-house gate tests (run via `node` / a tiny C++ harness)
    ├── predicates_gate.cpp / .js
    ├── mesh_boolean_gate.js
    ├── implicit_gate.js
    ├── voxel_gate.js
    └── brep_gate.js               # Stage 6 — parity vs OCCT, the long tail
```

**Binding & CMake wiring:** each new `.cpp` is appended to the explicit list in
`add_library(forge_kernel SHARED ...)` (`CMakeLists.txt:139`). New N-API
namespaces (`forge.mesh.*`, `forge.implicit.*`, `forge.lattice.*`, and
eventually a parallel in-house B-rep surface) are registered in
`src/binding.cpp` Init exactly like the existing `assembly`/`fea`/`cam`
namespaces. **Stage 0 stands these up returning a real "not implemented" error
(an honest stub that *raises* — never a fake success).**

**OCCT-as-oracle wiring:** gate tests call *both* the new in-house op and the
existing OCCT-backed op on the same input and assert agreement within
tolerance. OCCT is the oracle for Stages 2/4/5/6 wherever it has an equivalent;
analytic truth (closed-form volume/area/curvature) is the oracle where it does
not (e.g. an SDF sphere's volume, a gyroid's volume fraction).

---

## §C — Build order (bottom-up), per-stage gates

Honest robustness levels named per stage. "Replaces" = which reference-kernel
class / which current dependency it eliminates. "Oracle" = what truth the gate
checks against.

### Stage 1 — Exact predicates *(BEDROCK)*
- **Replaces:** the robustness substrate of CGAL **and** Manifold (both rest on
  exact/adaptive predicates). Nothing ships correctly above this layer without it.
- **In-house module:** `src/native/predicates/` →
  `orient2d`, `orient3d`, `incircle`, `insphere`, on adaptive floating-point
  expansions (two-sum / two-product / grow-expansion), re-derived from first
  principles per the user decision (`KERNEL_UNIFICATION.md:206`).
- **Validation gate:** (a) exact sign agreement with a high-precision oracle
  (Shewchuk's *published* adversarial sign values + a `long double` / rational
  reference computed in-tree) on a curated degenerate fixture (collinear,
  coplanar, cospherical, near-coincident, sliver); (b) a perturbation /
  consistency check — sign is stable and self-consistent under tiny coordinate
  jitter and under coordinate permutation (orientation antisymmetry).
  **No false signs on the adversarial set.**
- **Parity oracle:** Shewchuk published reference values (independent oracle, not
  copied source) + an in-tree exact/rational recomputation.
- **Honest robustness achieved (target):** *proven-correct on the fixture set,
  robust-in-practice in general.* We do NOT claim a machine-checked proof of
  exactness for all inputs — only that the adaptive expansions are exact when
  they terminate and the gate covers the known-hard cases. If a degenerate case
  fails the gate, it is recorded as a TODO with the offending coordinates, not
  hidden.
- **Effort (honest, unverified):** ~1–2 weeks to a passing gate; this is small
  *code* but high *validation* burden (the user-accepted re-derive trade-off).

### Stage 2 — Robust arithmetic + half-edge mesh + **manifold mesh booleans**
- **Replaces:** **`manifold-3d`** (the Manifold class) — guaranteed-2-manifold
  mesh CSG used today only in the JS frontend on a WASM dep
  (`frontend/src/forge-v4/meshDispatch.js`, `frontend/src/foundation/manifoldKernel.js`).
- **In-house module:** `src/native/mesh/` → `HalfEdgeMesh` (positions/indices +
  half-edge adjacency, the canonical mesh type from `KERNEL_UNIFICATION.md:133`),
  triangle–triangle intersection (exact via Stage 1), arrangement + in/out
  classification, re-triangulation, snap-rounding. Plus `MeshValidate` upgrading
  the *float* `src/MeshRepair.cpp` checks to **exact** ones.
- **Validation gate:** the repo's own documented failure case —
  "~30 sequential subtractions on a single envelope"
  (`frontend/src/foundation/manifoldKernel.js:8-9`) — runs to completion with
  every intermediate passing `mesh.validate` (2-manifold, watertight). Plus
  algebraic invariants: A∪A=A (idempotence), A−A=∅, and volume conservation under
  union of disjoint solids within tolerance.
- **Parity oracle:** `manifold-3d` itself (run the same op-chain through the WASM
  path during transition and diff volumes/manifoldness) **and** analytic volume
  for constructed primitives.
- **Honest robustness achieved (target):** *robust-in-practice* (exact
  predicates + snap-rounding), **explicitly NOT CGAL-exact (no Nef/EPECK).** Same
  honest ceiling Manifold itself ships. Adversarial coincident-coplanar-face
  stacks remain the known risk; any failure → TODO with the input mesh saved.
- **On pass:** remove `manifold-3d` from `meshDispatch.js`, then from
  `frontend/package.json:24`. CI dep-guard flips to hard-fail on the token.
- **Effort (honest, unverified):** ~3–5 weeks. The arrangement + robust
  classification is the hard part; predicates from Stage 1 de-risk it.

### Stage 3 — *(folded into Stage 2)* robust arithmetic + half-edge data structure
- These are not a separate ship; the adaptive-arithmetic primitives (Stage 1)
  and the `HalfEdgeMesh` type (Stage 2) ARE the "robust arithmetic + half-edge"
  layer the prompt names. Listed in the build order as its own conceptual rung,
  but it has no standalone gate beyond the predicate gate (Stage 1) and the mesh
  validity gate (Stage 2). Calling it out so the bottom-up rung is not skipped.

### Stage 4 — Implicit / F-rep / SDF + meshing (marching cubes)
- **Replaces:** **libfive** class — implicit/SDF modeling. Today only JS on
  `manifold-3d` (`frontend/src/foundation/MarchingCubes.js`, `SmoothImplicit.js`,
  `PointCloudSDF.js`).
- **In-house module:** `src/native/implicit/` → `SdfTree` (analytic primitives +
  smooth-union/cut, CSG over SDFs), interval-arithmetic pruning, and `IsoMesher`
  (marching cubes first, dual contouring for feature preservation) emitting a
  `HalfEdgeMesh` (reusing Stage 2's validator).
- **Validation gate:** an SDF sphere of radius r meshed at increasing resolution
  converges to volume 4/3·π·r³ within a tolerance that *shrinks with resolution*
  (proves the mesher converges, not just runs); a smooth-union of two spheres
  yields a watertight, 2-manifold mesh (`mesh.validate` passes).
- **Parity oracle:** analytic closed-form volume/area (sphere, torus); cross-check
  manifoldness against Stage 2's validator.
- **Honest robustness achieved (target):** *robust-in-practice* — marching cubes
  is sampling-based, so sharp features are softened at low res (dual contouring
  mitigates). We will state the chordal/iso error, never claim exact surfaces.
- **Effort (honest, unverified):** ~2–4 weeks. Self-contained algorithm; the JS
  reference de-risks the port.

### Stage 5 — Voxel / lattice field design
- **Replaces:** **PicoGK** class — voxel/lattice. Today only JS on `manifold-3d`
  (`frontend/src/foundation/LatticeTPMS.js`, `VoxelHexMesh.js`, `VoronoiPanel.js`,
  `MorphologicalFillet.js`).
- **In-house module:** `src/native/voxel/` → `VoxelGrid<float>` (signed-distance /
  density field), morphological `offset/shell/dilate/erode`, `Tpms`
  (gyroid/Schwarz/diamond level sets), `lattice.toMesh` via Stage 4's iso-mesher.
- **Validation gate:** a gyroid lattice infill of a unit cube at a given pitch
  produces a connected, 2-manifold mesh whose measured volume-fraction is within
  tolerance of the analytic gyroid level-set target; a shell op preserves
  manifoldness (`mesh.validate`).
- **Parity oracle:** analytic gyroid volume-fraction vs level-set threshold; the
  JS `LatticeTPMS.js` output during transition.
- **Honest robustness achieved (target):** *robust-in-practice* — pure grid
  arithmetic; accuracy bounded by pitch/resolution, stated explicitly.
- **Effort (honest, unverified):** ~2–4 weeks. Lowest algorithmic risk of the
  non-B-rep stages (grid arithmetic + reuse of Stage 4 meshing).

### Stage 6 — In-house B-rep topology + NURBS *(the OCCT replacement — LONGEST POLE)*
- **Replaces:** **OCCT** itself — the exact B-rep/NURBS core (`TopoDS_Shape`,
  `Geom_BSplineSurface`, `BRepAlgoAPI_*`, fillet/offset/draft). This is the
  multi-year, Parasolid/ACIS-class track explicitly chosen by the user
  (`KERNEL_UNIFICATION.md:207`).
- **In-house module:** `src/native/brep/` built sub-feature by sub-feature:
  `geom/` (Bezier/B-spline/NURBS curves+surfaces, de-Boor eval, knot insertion,
  degree elevation) → `topo/` (in-house Vertex/Edge/Wire/Face/Shell/Solid with
  half-edge-of-faces + persistent IDs minted by the existing `LineageRegistry`)
  → `intersect/` (curve–curve, surface–surface intersection — the robustness
  crux) → `boolean/` (imprint + classify + sew B-rep CSG) → `feature/`
  (fillet/chamfer/offset/draft/shell).
- **Validation gate (per sub-feature, NOT one big gate):** each in-house op runs
  on the same fixtures as the OCCT-backed op already covered in `KERNEL_PARITY.md`
  and must match within tolerance — e.g. in-house box → vol 1.0 ± ε, area 6
  (matches `smoke.js`); in-house cut residual 0.929 ± ε (matches `smoke.js`);
  in-house NURBS saddle eval matches `test/nurbs_smoke.js` (unit normal ±1e-6,
  Gauss K<0); in-house mass props match `BRepGProp` within tolerance.
  **A sub-feature is "done" only when its parity test passes; until then OCCT
  serves that op in production.**
- **Parity oracle:** OCCT 7.9.3, op-for-op, on the `KERNEL_PARITY.md` fixture set
  (every PARITY row there becomes a target); analytic truth where closed-form
  exists (primitive volumes, sphere curvature K=1/R²).
- **Honest robustness achieved (target):** *targeted, mostly unbuilt.* Realistic
  near-term reach is **robust on well-conditioned inputs**, matching OCCT on the
  validated fixtures; matching OCCT's (already sub-Parasolid) robustness on
  adversarial coincident-face / tangent-propagation / thin-sliver cases is a
  *multi-year* tail and will NOT be claimed until a stress suite proves it. The
  honest near-term posture is "OCCT remains the production B-rep engine; the
  in-house B-rep grows under it, validated piece by piece, and OCCT is retired
  per-op only as parity gates pass."
- **Effort (honest, unverified):** **multi-year, milestone-gated.** No single
  week/quarter number is honest here. Any one quarter buys a slice (e.g. the
  `geom/` NURBS layer, or primitives + booleans on simple inputs); the
  intersection + robust-boolean tail is where the years go.

---

## §D — Honesty / sequencing rules (Bible §0/§9, restated for this build)

1. **Never a stub that fakes success.** Stage 0's empty namespaces *raise* "not
   implemented." No op returns a plausible-looking fake handle.
2. **Never an unmeasured number.** Every gate asserts against a *computed* oracle
   (OCCT output or analytic truth), and the doc cites the real test output
   (e.g. the `smoke.js` block in §0). Effort estimates are explicitly flagged
   UNVERIFIED.
3. **OCCT is foundation + oracle until parity, then retired per-capability.** No
   big-bang removal. A dependency (`manifold-3d`, `opencascade.js`, eventually an
   OCCT toolkit) is removed only after its in-house replacement passes its gate,
   guarded by the CI dep-ratchet.
4. **State the robustness level; do not overclaim.** Stages 2/4/5 are
   *robust-in-practice*, NOT CGAL-exact. Stage 6 near-term is *robust on
   well-conditioned inputs*, NOT Parasolid-robust. These words are mandatory in
   any status report.
5. **If a case fails, say so + leave a TODO.** A failing degenerate predicate, a
   non-converging boolean stack, a softened sharp feature — each is recorded with
   the offending input saved, never silently dropped.

---

## §E — Dependency-retirement ledger (what each stage lets us delete)

| Stage | Native capability reaches gate | Dependency retired | Guard |
|---|---|---|---|
| 1 | exact predicates | — (enables 2/4/5) | predicate gate fixtures |
| 2 | manifold mesh booleans | **`manifold-3d`** (mesh CSG path) | CI dep-ratchet hard-fail on token |
| 4 | implicit/SDF | `manifold-3d` (implicit consumers) | dep-ratchet |
| 5 | voxel/lattice | `manifold-3d` (lattice consumers) — full removal | dep-ratchet hard-fail |
| — | (parallel, lower risk) duplicate-OCCT WASM | **`opencascade.js`** | dep-ratchet (see `KERNEL_UNIFICATION.md:242`) |
| 6 | in-house B-rep/NURBS, per-op | **OCCT toolkits**, retired op-by-op as parity gates pass | per-op parity gate + dep-ratchet |

`opencascade.js` (the duplicate WASM OCCT) is the lowest-risk removal and can be
retired in parallel with Stages 1–5 by re-pointing `frontend/src/kernel/brep/*`
at the already-native `window.forge.*` B-rep ops — it does not wait on the
in-house B-rep rewrite.

---

*Generated 2026-06-20. Baseline `smoke.js` output is real (cited §0). Every
stage gate and effort number below the baseline is TARGETED/UNVERIFIED until its
test is written and run. Re-run `node forge-kernel/test/smoke.js` to reproduce
the baseline; the §A grep facts reproduce via the commands shown.*
