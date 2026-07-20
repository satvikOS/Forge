# OCCT-zero: the 15 remaining toolkits → full in-house map (measured 2026-07-20)

Grounded on the GOLD-15 binary (`otool -L build/Release/forge-kernel.node | grep opencascade`).
Consumer counts = src files referencing each toolkit's API family (rough but directional).
ALREADY 0-linkage / fully native: CGAL(mesh) · libfive(implicit) · PicoGK(voxel) · Manifold ·
booleans core (TKBO/TKBool dropped) · analytic-face-inventory · Parasolid-style C-API.

## The 15, grouped by OCCT module + drop effort

### Foundation Classes  (drops LAST — transitive substrate)
- **TKMath** (~28 consumers) — `gp_` / `math_` vectors, matrices, transforms. The math substrate,
  used everywhere. K6: migrate every `gp_Pnt/Vec/Trsf` site → native `NVec3/Matrix` (already built).
  Biggest single effort (Features 112 sites, Drawings 86, OcctImport 79…). Deep but mechanical.
- **TKernel** (0 direct) — Handle/Standard/TColStd. TRANSITIVE only; drops automatically once every
  toolkit above it is gone. No direct work.

### Modeling Data  (geometry primitives)
- **TKBRep** (~34) — `BRep_Tool` / `TopoDS` / `BRepBuilderAPI`. The topology substrate (2nd deepest).
  K6: the native `Topology.hpp` (Vertex/Edge/Loop/Face/Shell/Solid) already exists — migrate the
  `TopoDS` round-trip onto it. Gated on curved-preserving native B-rep (K6a single-face primitives).
- **TKG3d** (~10) / **TKG2d** (~3) / **TKGeomBase** (0) — `Geom_` surfaces / `Geom2d` p-curves.
  Native `NurbsSurface`/`NurbsCurve` built. TKG2d is the p-curve dep the native mesher's PROJECTION
  approach removes (in progress — see below). TKGeomBase transitive.

### Modeling Algorithms
- **TKBool**(~13)/**TKBO**(~1) API surface remains but the TOOLKITS are already DROPPED (native
  booleans routed, OCCT fallback only for non-analytic operands). K2 = kill the residual fallback.
- **TKPrim** (~9) — `BRepPrimAPI` make box/cyl/cone/sphere/torus. K6a: native single-face primitives.
- **TKFillet** (~2) / **TKOffset** (~9) — fillet/chamfer/draft/shell/offset. K3: broaden the native
  analytic fillet to arbitrary/curved inputs.
- **TKTopAlgo** (~3) / **TKGeomAlgo** — sewing / projection / general topo algorithms.
- **TKHLR** (~1, Drawings.cpp) — hidden-line removal. K4: native ortho HLR done + 50× faster (BVH);
  perspective HLR is the remaining bit.
- **TKShHealing** (0 direct) — ShapeFix/ShapeUpgrade. Transitive-ish; drops with its callers.

### Mesh
- **TKMesh** (~9) — `BRepMesh` / `Poly_`. **IN PROGRESS NOW** — native `occtmesh` projection-based
  no-p-curve mesher; a sub-agent is completing its imported-STEP-face coverage so the source rebuilds
  clean (the current blocker). Once green → TKMesh drops (already dropped in GOLD-15's binary; the fix
  restores that at rebuild-parity).

### Data Exchange
- **TKDESTEP** (~2: IoExchange, OcctImport) / **TKXSBase** (0) — STEP read/write. **K1** — native
  foreign reader `readForeignStep` EXISTS (StepRead.cpp, 1300 lines) but is unwired + only 1/81
  coverage (gap: "degenerate outer loop on face #17"). Bounded: complete the loop reader + wire it.

### Visualization / Application Framework
- Not linked (0) — the kernel is a headless modeler; these OCCT modules were never pulled in. Done.

## Ordered path to otool 0 (dependency-respecting)
1. **UNBLOCK (now):** native mesher meshes imported STEP → source rebuilds clean at otool 15.
   PREREQUISITE for everything below (can't drop anything if the tree won't build).
2. **K1 Data-Exchange:** finish `readForeignStep` (loop-reader gap) + wire into importStep → drop
   TKDESTEP/TKXSBase. Bounded, 2 consumers, native reader mostly there.
3. **K6a Modeling-Data primitives:** native single-face cyl/cone/sphere/torus + native STEP-face
   B-rep on `Topology.hpp` → unpins TKBRep/TKPrim/TKG2d/TKG3d for the imported path.
4. **K3/K4 Algorithms:** native fillet/offset (TKFillet/TKOffset) + perspective HLR (TKHLR).
5. **K6 substrate migration:** the ~28 `gp_`/`Geom_` TKMath + ~34 TKBRep sites → native math/topo.
   The long pole; mechanical but large.
6. **Transitive fallout:** TKernel/TKGeomBase/TKShHealing/TKXSBase drop on their own once (2)–(5) land.
7. **FINAL:** remove OCCT_LIBS from CMakeLists → rebuild → `otool` 0. Parasolid-style, fully in-house.

Discipline (unchanged): single-track kernel · every drop gated on native-vs-OCCT A/B (core 34/34) AND
Models-OS-13/13 AND Linux-CI · keep-if-green/revert-if-red · GOLD-15 backup · no faked native pass.
