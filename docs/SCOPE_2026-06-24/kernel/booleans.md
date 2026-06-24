# Forge Kernel Audit — AREA: Boolean ops + robustness

> Grounded audit, 2026-06-24. Every claim below was read from the live source at
> `forge-kernel/src/` (cited inline). Target = full industrial 1:1 parity with
> **Parasolid booleans** (B-rep, lineage, tolerant/local ops, splitter/general-fuse,
> imprint, non-manifold) **+ Manifold** (guaranteed-manifold mesh booleans).
> Discipline = Bible §0: real impl only, no MVP/stub, OCCT stays the live oracle &
> fallback until each native op is A/B-proven, CI-green per increment, dynamic not static.

---

## 1. What Forge has TODAY (grounded)

Forge runs **two parallel boolean engines** plus the OCCT oracle/fallback. The
production default (Wave 1 flipped 2026-06-23) is native-first.

### 1a. Native analytic B-rep boolean — `src/native/brep/Boolean.cpp` (1218 LOC)
The flagship. `booleanSolid(A,B,op)` (`Boolean.hpp`) is the in-house
`BRepAlgoAPI_{Fuse,Cut,Common}` replacement. Pipeline (read in full):
- **`booleanSolidAnalytic`** (`Boolean.cpp:1043`): for each AABB-overlapping
  face-pair, calls exact analytic SSI `intersectSurfaces` (`SurfaceIntersect.cpp`,
  823 LOC) to get the closed-form 3-D intersection curve; **defers honestly** (`ok=false`)
  if any needed pair is not closed-form (`Boolean.cpp:1088-1089`).
- **`imprintFace`** (`Boolean.cpp:473`): imprints the curve onto each face in its
  own (u,v) domain. Planar faces → PSLG + `constrainedDelaunay2D` with a
  **fixpoint crossing/T-junction conditioner** using exact `geom::segmentIntersect`
  (`Boolean.cpp:680-726`). Curved (cylinder/cone) faces → horizontal-band split,
  keeping the parent analytic surface (`Boolean.cpp:527-606`).
- **`classify`** (`Boolean.cpp:808`): each sub-face labelled in/out of the OTHER
  solid by **majority-vote ray-cast point-in-solid** (`pointInSoup`, Möller-Trumbore,
  3 tilted dirs, grazing-reject, `Boolean.cpp:104-149`) against the Step-1
  tessellated soup.
- **`stitch`** (`Boolean.cpp:837`): welds shared cut vertices, orients each face by
  a **geometric material-probe** (not a per-op flip), runs a **combinatorial
  2-manifold pre-check** (every undirected edge used exactly twice, oppositely
  mated — `Boolean.cpp:976-984`) BEFORE touching topology, then builds and validates
  via `isClosedTwoManifold` + Euler counts.
- **Envelope**: `Plane | Cylinder | Cone | Sphere` only (`Boolean.cpp:1055-1060`).
  Imprint is analytic for Plane/Cylinder/Cone; an **imprinted Sphere/Torus face
  defers** (`Boolean.cpp:500-502`). Result face-kinds are exact analytic (a box−cyl
  bore yields one true cylindrical wall, mass-integrated with the analytic Jacobian).
- Verified by `test/native/brep/native_boolean_test.cpp` (61 `check()` asserts):
  box−box, bored plate (0.5% curved tol), cross-bore, skew cross-bore (Monte-Carlo),
  box−sphere, box−cone — volume vs OCCT closed form + closed-2-manifold + watertight tess.

### 1b. Native mesh boolean (the Manifold analogue) — `src/native/mesh/MeshBooleanNative.cpp` (1528 LOC)
"Strategy Q" combined-arrangement interior-face removal (`MeshBooleanNative.hpp`).
- Exact triangle-triangle (`TriTriIntersect.cpp`) + exact `orient2d/3d/incircle`
  predicates (`Predicates.hpp`); **global shared intersection-vertex map** so the
  cut polyline is bit-identical on both surfaces (no T-junctions by construction).
- **Simulation of Simplicity** (Edelsbrunner–Mücke ε^(2^i), `MeshBooleanNative.cpp:84-160`):
  resolves measure-zero exact-incidence degeneracies (the clean 45° z-rotated cube,
  edge-on-face, point-on-diagonal) deterministically and globally-consistently.
- UNION/INTERSECTION/DIFFERENCE as pure selection; coplanar contact walls
  net-cancelled per undirected triangle; result rebuilt + `validate()`d as closed
  2-manifold; **0-fakes — `ok=false` if not manifold** (`MeshBooleanNative.cpp:1364`).
- **Honest ceiling (cited in header)**: ~99.88% on random general-position cube
  pairs; residual `ok=false` on near-triple-point COORDINATE slivers (~1e-5) — a
  double-precision coordinate ceiling SoS does not address (NOT CGAL-exact rationals).
- Used as the **flagged fallback** by the B-rep boolean (`Boolean.cpp:313` →
  `reconstructPlanar` emits planar faces, sets `usedMeshFallback=true`).
- Supporting cast: `BooleanBVH.cpp` (acceleration, verdict-identical to brute force),
  `MeshBoolean.cpp` (plane-clip special case), `TriTriIntersect.cpp`, `SelfIntersect.cpp`
  (grid-accelerated exact self-intersection detection), `Repair.cpp` (weld/heal substrate).

### 1c. OCCT oracle + fallback — `src/Booleans.cpp` (live), `src/BooleanTol.cpp` (fuzzy)
- `fuse/cut/common` (`Booleans.cpp:195-224`) try native first, then fall back to
  `BRepAlgoAPI_{Fuse,Cut,Common}` for mixed/OCCT operands or native `ok=false`.
- **Lineage (`Modified/Generated/IsDeleted`) is OCCT-ONLY** (`buildLineage`,
  `Booleans.cpp:40-145`) → emitted to `LineageRegistry` for `ForgeTopoIdRegistry`.
  **The native path produces NO lineage** (confirmed: zero `Modified/Generated`
  refs anywhere under `src/native/`).
- **Fuzzy/tolerant booleans are OCCT-ONLY** (`BooleanTol.cpp` → `SetFuzzyValue`).
- **Splitter / Section / GeneralFuse / CellsComplex are OCCT-ONLY** and live in
  consumers (`Mold.cpp`, `Weldments.cpp`, `Drawings.cpp`, `SheetMetalExtended.cpp`),
  not in the native engine.

**Routing gate** (`NativeRoute.cpp:51`): `forgeNativeBrepEnabled()` is the Wave-1
production default (native CORE on; FEAT/STEP off). Native-on-native only — any
OCCT-backed operand bridges to OCCT and keeps lineage.

---

## 2. The GAP vs target (Parasolid booleans + Manifold) — concrete

### A. B-rep boolean surface/topology envelope (vs Parasolid)
1. **No analytic boolean on Sphere/Torus/NURBS faces.** Envelope is Plane/Cyl/Cone/
   Sphere, and even a *cut-imprinted* Sphere/Torus defers to the mesh fallback
   (`Boolean.cpp:500-502`). Parasolid does exact B-rep booleans on the full surface
   zoo (NURBS, torus, blend surfaces, offset surfaces, spun/swept).
2. **No NURBS surface in the boolean envelope at all.** `SurfaceKind::Nurbs` exists
   (`Surface.hpp:65`) but `kindOK` rejects it (`Boolean.cpp:1055`). Any real STEP/
   customer part with a freeform face → mesh fallback (planar facets, lineage-less)
   or OCCT. This is the single biggest correctness gap for industrial parts.
3. **No non-manifold boolean handling.** `stitch` ASSERTS exactly-2-manifold
   (`Boolean.cpp:976`) and returns `ok=false` otherwise. Parasolid supports
   non-manifold bodies (laminae, wire+sheet+solid mixed, T-junctions, shared faces).
4. **No general multi-body / disjoint-result booleans.** Result is one Shell in one
   Solid (`stitch` PASS 2). A fuse that yields 2 lumps, or a cut that fragments into
   N pieces, has no representation. Parasolid `PK_BODY` boolean returns multi-lump bodies.
5. **No sheet/wire boolean operands.** Solid−solid only. No solid-with-sheet
   imprint, no sheet−sheet, no wire booleans (needed for trim/parting/split).
6. **Classification is mesh-soup ray-cast, not exact B-rep point-in-solid.** Robust
   in practice but density-dependent on the tessellation; Parasolid classifies
   against exact faces.

### B. Tolerant / robustness paradigm (vs Parasolid + Manifold)
7. **No native fuzzy/tolerant boolean.** `fuzz` exists only on the OCCT path
   (`BooleanTol.cpp`). The OCCT_ZERO_ROADMAP flags this as a Phase-D blocker (W2.4).
   Parasolid has tolerant modelling with per-entity tolerances; without a native
   equivalent OCCT cannot be deleted.
8. **No exact-arithmetic / interval coordinate kernel.** Both engines are
   double-precision; the mesh boolean's residual ~0.12% failure is a coordinate
   ceiling (header is explicit it is NOT CGAL-exact). Manifold itself is robust via
   a careful collider + manifold-guaranteed datastructure; matching it needs either
   exact predicates *with exact construction* (snap-rounding / shewchuk-expansion
   coordinates) or a Manifold-style guaranteed-manifold halfedge with property
   propagation.
9. **No SoS on the B-rep path.** SoS lives only in the mesh engine. The analytic
   B-rep path relies on weld tolerance (`wtol=1e-7`, `Boolean.cpp:850`) and majority
   votes — robust for primitives, fragile for coincident/tangent industrial cases.

### C. Lineage / history / associativity (vs Parasolid PK report + Manifold property IDs)
10. **No native lineage** (Modified/Generated/Deleted) — the #1 structural gap.
    Parametric rebuild, feature-tree re-evaluation, and persistent face IDs depend on
    it; today they only work on the OCCT path. This BLOCKS deleting OCCT (roadmap §5).
11. **No persistent topological naming through native booleans.** Manifold propagates
    per-triangle property/originalID through the boolean; Forge's mesh boolean drops
    provenance (`reconstructPlanar` re-creates anonymous planar faces).
12. **No attribute/property propagation** (face colours, materials, PMI, mesh UVs/
    normals) across either native boolean.

### D. Operators present in the targets but ABSENT natively
13. **Imprint / merge-faces-only** (intersect curves onto faces without selecting) —
    needed for split lines, parting, decals, parametric splits. (Imprint exists
    *inside* the boolean but is not exposed as a standalone op.)
14. **Boolean Splitter** (`BRepAlgoAPI_Splitter`) — split a body by tool faces,
    keep all pieces. OCCT-only, used by Mold/SheetMetal.
15. **Section** (face/face → wire, `BRepAlgoAPI_Section`) — OCCT-only.
16. **General Fuse / non-regularized boolean / CellsComplex** — OCCT-only.
17. **Local ops on boolean results** (defeature, delete-blend, replace-face,
    tolerant-stitch of boolean seam). None native.
18. **Boolean of bodies with internal voids / multi-shell solids** — `stitch`
    builds a single shell; a solid with a cavity (2 shells) has no boolean path.

### E. Manifold-specific paradigm gaps
19. **No guaranteed-manifold datastructure as the boolean's native output.** The
    mesh boolean validates *after the fact* and can return `ok=false`; Manifold's
    invariant is the mesh is manifold *by construction*. To claim Manifold parity the
    output halfedge must be manifold-by-invariant, not validated-post-hoc.
20. **No property/ID-preserving boolean, no `Manifold`-style batched/CSG-tree
    evaluation** (Manifold composes a tree of ops lazily). Forge evaluates pairwise.
21. **No genus / Euler-characteristic guarantee surfaced**; mesh boolean reports a
    reason string, not Manifold's topological invariants.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Each step: real impl, native subsystem, oracle/verification, rough LOC. OCCT stays
the oracle + fallback until each op is A/B-proven; CI-green per increment.

> **Oracle gap to fix FIRST (roadmap §6):** every topology-changing A/B gate today
> compares vol/COM/inertia/AABB — **two different solids can share all four.**
> **B0.** Add a **topology signature** (face/edge/vertex counts + sorted
> adjacency hash + per-surface-kind histogram) to `native_vs_occt` and the boolean
> battery. ~120 LOC. Do before trusting any new boolean increment.

### Phase B1 — Close the B-rep envelope to Sphere/Torus imprint (highest value/LOC)
- **B1.1 Sphere-face imprint.** Plane∩Sphere and Sphere∩Sphere SSI are already
  closed-form circles; add a spherical-coordinate imprint domain to `imprintFace`
  (lift the Plane/Cyl/Cone restriction at `Boolean.cpp:500`). Verify: box−sphere /
  sphere−sphere vol vs OCCT to 1e-4 + topo-sig + closed-2-manifold. **~400 LOC.**
- **B1.2 Torus-face imprint + Torus in `kindOK`.** Add torus (u,v) imprint;
  plane∩torus / cyl∩torus need conic/quartic SSI curves (extend `SurfaceIntersect`).
  Verify vs OCCT torus-boolean battery. **~700 LOC** (SSI is the cost).
- *Removes the most common analytic→mesh-fallback regressions on mechanical parts.*

### Phase B2 — Native lineage (the structural keystone, gates Phase D)
- **B2.1** Add `provenance` (parent face ptr + op tag) to `SubFace`; carry it through
  `imprint→classify→stitch` into the result `Face`. Emit a native `LineageEntry`
  list (Survivor/Split/Birth/Death) mirroring `buildLineage`'s contract.
- **B2.2** Wire native lineage into `LineageRegistry` from `tryNativeBoolean`
  (`Booleans.cpp:179`). Verify: native lineage entries == OCCT `buildLineage` entries
  on the whole boolean battery (set-equality on (kind, entityKind, in/out face roles)).
  **~500 LOC.** *Without this, native booleans can never replace OCCT in a feature tree.*

### Phase B3 — Native tolerant ("fuzzy") boolean (gates OCCT deletion, roadmap W2.4)
- **B3.1** Thread a `fuzz` (per-op tolerance) through `BooleanOptions`; relax the
  weld tol (`Boolean.cpp:850`), SSI coincidence tol, and the classify vote band by
  fuzz. **B3.2** Add a native `booleantol::{fuse,cut,common}` path. Verify vs OCCT
  `SetFuzzyValue` on near-coincident/tangent batteries (vol + topo-sig). **~350 LOC.**

### Phase B4 — Multi-lump / multi-shell results + sheet/void operands
- **B4.1** Let `stitch` emit N shells/solids via connected-component partition of the
  manifold-valid face graph (fuse-of-disjoint, cut-fragments). **B4.2** Support a 2nd
  (void) shell so cavities survive booleans. Verify: count + per-lump vol vs OCCT
  multi-result. **~600 LOC.**
- **B4.3** Sheet/wire operands (imprint a solid by a sheet; split). **~500 LOC.**

### Phase B5 — Standalone Splitter / Section / Imprint ops (Parasolid op-set)
- Expose `imprint(body, tool)`, `splitter(body, tools)→pieces`,
  `section(a,b)→wire` reusing the SSI + imprint + classify core. Verify vs OCCT
  `BRepAlgoAPI_Splitter`/`_Section` (piece counts + per-piece vol + wire length).
  **~700 LOC.**

### Phase C1 — Manifold-grade mesh robustness (close the 0.12% ceiling)
- **C1.1** Replace double-construction at intersection vertices with **snap-rounded
  / Shewchuk-expansion exact construction** (or interval+filter) so near-triple-point
  slivers resolve to one point — the residual `ok=false` class. Verify: re-run the
  ~120k random-triple gate, demand 100% closed-2-manifold; A/B vol vs OCCT. **~900 LOC.**
- **C1.2** Make the output **manifold-by-invariant** (Manifold parity): build the
  result directly into a halfedge that cannot represent a non-manifold edge, with
  per-triangle **property/originalID propagation** (gap #11/#19). Verify: property
  round-trip + genus invariant. **~700 LOC.**
- **C1.3** Lazy **CSG-tree batched evaluation** (Manifold's compose model) for N-ary
  booleans. **~400 LOC.**

### Phase C2 — NURBS-face B-rep boolean (the deep frontier; depends on the kernel-wide NURBS keystone)
- Requires the trimmed-NURBS surface (read+eval+SSI) that the OCCT_ZERO_ROADMAP §5
  calls THE keystone blocker. Once native NURBS SSI exists, extend `kindOK` + imprint
  to NURBS faces. Verify vs OCCT on freeform-skin booleans (vol 1e-3 + topo-sig).
  **~1500+ LOC** (mostly the shared NURBS keystone, owned by the STEP/surfacing area).

### Phase D — Delete OCCT booleans
- Only after: native lineage == OCCT (B2), native fuzzy (B3), multi-result (B4),
  NURBS-face boolean (C2), and a **frozen OCCT-built golden corpus** for post-deletion
  regression (roadmap §6 oracle-removal paradox). Flip the gate, keep the golden
  corpus as the truth source. Splitter/Section/GeneralFuse (B5) must also be native
  or the OCCT consumers (Mold/SheetMetal/Drawings) break.

---

## 4. The single biggest blocker + critical path

**Biggest blocker (this area): no native NURBS-face boolean (gap #1/#2).** Every
industrial / CADGenBench / customer part with one freeform face leaves the analytic
envelope at `Boolean.cpp:1055` and routes to the lineage-less planar mesh fallback or
OCCT. It is gated on the **kernel-wide trimmed-NURBS surface keystone** that the
OCCT_ZERO_ROADMAP independently names as THE blocker — so the boolean area cannot
solve it alone; it consumes that keystone.

**Critical path (what must precede OCCT deletion for booleans):**
1. **B0 topology signature** (without it every downstream A/B gate is unsound — two
   solids share mass props) → 2. **B2 native lineage** (parametric rebuild + the
   roadmap's stated Phase-D precondition) → 3. **B3 native fuzzy** (roadmap W2.4
   Phase-D blocker) + **B4 multi-result** → 4. **C2 NURBS-face boolean** (needs the
   NURBS keystone) → 5. **C1 Manifold-grade robustness** for the mesh-fallback class
   → 6. **Phase D** deletion against a frozen golden corpus.

The lower-LOC, immediately-shippable wins are **B0 (topology sig), B2 (lineage), B3
(fuzzy), B1.1 (sphere imprint)** — all A/B-provable against OCCT today without the
NURBS keystone, and B2 is the structural item that currently forces every
feature-tree boolean back onto OCCT.
