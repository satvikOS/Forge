# K6/K7 Execution Brief — the ordered path from otool 17 → 0

**Status 2026-07-17:** `otool -L build/Release/forge-kernel.node | grep -c opencascade` = **17**.
6 CI-green kernel improvements shipped this program; **every remaining dylib DROP is
gated on the same root cause** — the native geometry system is faceted/analytic-
primitive-based, while OCCT healing/HLR/mesh/features/prim operate on exact curved
`TopoDS` shapes. No individual drop closes until a **curved-preserving native B-rep**
replaces the faceted `importOcctSolid`/`TopoDS` round-trip. This brief sequences that
work into verifiable chunks. It supersedes ad-hoc drop-attempts (exhausted/mapped).

## The gate everything waits on: G2 watertight surface tessellation

The native tessellator (`src/native/brep/SolidTessellate.cpp`) has a **surface-sampling
path** (`surfaceTessEnabled()`, env `FORGE_SURFACE_TESSELLATE`, default OFF) that
samples a curved analytic face over its (u,v) window instead of fanning loop corners.

**Measured 2026-07-17:**
- Clean primitives (cyl/sph/tor/box) tessellate **WATERTIGHT** with the flag ON
  (0 boundary edges) — the seam welds via the position grid `qz` as designed.
- Full native gate suite with `FORGE_SURFACE_TESSELLATE=1`: **correctness all-PASS**,
  BUT `native_boolean_test` **TIMES OUT >300s** — denser meshes make the boolean
  validation exceed the CI gate's per-test limit. This is the *sole* blocker to
  default-on (not correctness).

**Two independent fixes needed before default-on (each verifiable, bounded-ish):**
1. **Density-agnostic consumers / density tuning.** The boolean test times out because
   surface-sampled clean faces (`angDensity = 32/M_PI` → 64 seg/2π) densify meshes fed
   to boolean validation. Options: (a) lower `angDensity` to a curvature-adaptive
   floor that keeps chord error < tol while halving triangle count; (b) give the
   boolean-result validation a coarser display LOD. Gate: `run_native.sh` 137/137
   with the flag ON, `native_boolean_test` under 300s, `forge:coherence` watertight.
2. **Boolean-body curved-face conformance.** The path is gated to
   `innerLoops.empty() && !boolHoled` (clean faces only) precisely because a boolean
   TRIMS a curved face → its (u,v) window is partial and its new edges don't conform
   to the grid sampling → crack. Extend surface-sampling to trimmed curved faces by
   deriving the shared-edge subdivision from the EDGE (so both incident faces sample
   it identically), then honour inner-loop trims in param space. Gate: coherence
   scorer 8/8 on boolean bodies with the flag ON.

Once G2 is default-on and watertight on boolean bodies, the native mesh is
curvature-accurate everywhere → unblocks the two drops below.

## Ordered keystones

- **K6a — native single-face primitive builders.** With G2 watertight, replace the
  128-strip `makeCylinder/Cone/Sphere/Torus` construction with single periodic
  analytic faces (buildCylinder → 1 cyl face). Depends on G2 (the periodic face must
  tessellate watertight — the G1 bridge-coalesce revert proved bridge-level
  `UnifySameDomain` is the wrong layer). Gate: `faceInventory` == OCCT identity
  (cyl 3/cone 3/torus 1) built natively, `core.mjs` 34/34, coherence 8/8.
- **K6b — route public `faceInventory`/`direct.faceCount` to `nativeFaceInventory`**
  for native handles (the native analytic-face-inventory layer is already built +
  30/30). Retires OCCT `BRepAdaptor` face-query on the native path. No drop yet
  (TKBRep/TKGeomBase still used by booleans) but removes a whole OCCT consumer class.
- **K5 — drop TKMesh (17→16).** With G2 default-on watertight, route the 2 OCCT
  `BRepMesh` sites (`Tessellate.cpp:68` display, `FeaTet.cpp:724` tet-seed — FeaTet
  routing already verified working) through the native tessellator; convert mesh A/B
  gates to golden; drop TKMesh from `OCCT_LIBS`. (`docs/K5_TKMESH_DROP_BRIEF.md`.)
- **K4 — drop TKHLR (→ lower).** Native HLR is already correctness-complete + perf-
  resolved (BVH) for analytic-quadric silhouettes on imported curved solids
  (commits 66abd76e/22ed2071/8baf73a0). Remaining: (1) native FREEFORM-NURBS
  silhouette HLR (NativeMesh/torus-revolution parts still defer to OCCT HLRBRep) —
  needs K6's curved B-rep; (2) plumb a `ShapeHandle` overload onto
  `projectView`/`sectionView` (they take raw `TopoDS` today) so the native route
  doesn't re-tessellate. (2) is bounded plumbing; (1) is K6-gated.
- **K1 — native trimmed-NURBS STEP reader (drop TKDESTEP+TKXSBase).** Foreign/
  trimmed-NURBS STEP still falls back to OCCT (`StepAnalytic::read` ok=false). Only
  `IoExchange.cpp`+`NativeOcctBridge.cpp` include these. Needs a native trimmed-NURBS
  surface reader — the largest single native-capability build.
- **K2/K3 — curved/fuzzy booleans + general fillet/shell/offset** (drop TKBool/
  TKFillet/TKOffset/TKTopAlgo): the deepest, on the native NURBS boolean engine.
- **K7 — Parasolid-style opaque-handle C-API** over the fully-native B-rep (the
  gp_/Geom_→native Vec3/Nurbs migration finished): the final consolidation.

## Discipline (do not skip)
- Machine-precision A/B vs OCCT in one process (`setNativeBrep` false/true).
- **Before ANY push: `bash test/native/run_native.sh` local (137/137, `JOBS=3`, ~5min),
  `forge:coherence`, `core.mjs` against `build/` (NOT stale `build-native/`).**
- Honest reverts (G1 bridge-coalesce + K5 tkmesh swap were both A/B-failed → reverted).
- Worktree isolation for kernel cycles; single-track builds (never concurrent OCCT-
  linked clang — OOM on 36G); GPU-train XOR kernel-build.

## Why this order
G2 is first because K6a (single-face) and K5 (TKMesh) both physically require a
watertight periodic tessellator, and the whole faceted-vs-curved root cause dissolves
once curved faces tessellate correctly. Everything downstream is then a migration, not
a capability gap.
