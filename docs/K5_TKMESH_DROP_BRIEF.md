# K5 — Drop TKMesh (native tessellation becomes the only surface mesher)

**North-star:** `otool -L build/Release/forge-kernel.node | grep -c opencascade` → 0.
After K4 (TKHLR) this should be **16**; K5 targets **16 → 15**. Prereq: land K4 first.

## Ground truth (audited 2026-07-17)

Direct TKMesh (`BRepMesh`/`IMeshData`/`IMeshTools`) includes in `src/` — only **two files, two uses,
BOTH on OCCT-backed shapes**:

- **`src/Tessellate.cpp:68`** — `BRepMesh_IncrementalMesh mesher(shape, linearTol, false, angTol, ...)`
  for the **display/viewport** tessellation. **Native handles already bypass BRepMesh entirely**:
  lines 48–56 route `ShapeKind::NativeSolid`→`nb::tessellateSolidForViewport(...)` and
  `ShapeKind::NativeMesh`→`nb::tessellateMeshForViewport(...)` (watertight analytic-face tessellation
  + smooth normals + per-tri faceIds), which is the SHIPPING default for native handles. The
  BRepMesh call is reached ONLY for `ShapeKind::Occt` handles.
- **`src/FeaTet.cpp:724`** — `BRepMesh_IncrementalMesh mesher(shape, targetEdge, false, ...)` then
  `Poly_Triangulation` boundary-triangle extraction (line ~634) to seed the **tetrahedral volume
  mesh**. Also OCCT-backed only. Note the existing workaround comment (line ~748): "BRepMesh on a
  planar face only produces corner+edge vertices" — the native sampler can do BETTER here.

The native replacement already exists: `src/native/brep/SolidTessellate.cpp` +
`tessellateSolidForViewport` (`NativeRoute.hpp`). The surface-sampling density knob is
`FORGE_SURFACE_TESSELLATE` (default OFF).

## The one nuance — the FORGE_SURFACE_TESSELLATE timeout is a DIFFERENT path

`FORGE_SURFACE_TESSELLATE` was left default-OFF because turning surface-sampling on **globally** made
the **boolean path's** meshes denser and timed out `native_boolean_test` (300s cap). That is the CSG
result-validation tessellation — NOT the public display `tessellate` export and NOT FeaTet. So routing
the two OCCT-backed uses above through the native tessellator should **not** re-trigger the boolean
timeout. VERIFY THIS EXPLICITLY: after the change, `bash test/native/run_native.sh` JOBS=3 must finish
`native_boolean_test` well under 300s. If routing FeaTet/display somehow shares the dense path, cap the
native deflection for these two callers to match BRepMesh's `linearTol`/`targetEdge` density (do NOT
globally flip FORGE_SURFACE_TESSELLATE).

## Drop sequence (verify each step before the next)

1. **Tessellate.cpp:** for `ShapeKind::Occt`, `importOcctSolid(shape)` → native `Solid` →
   `tessellateSolidForViewport` (exactly as the native branch), removing the `BRepMesh_IncrementalMesh`
   call. A/B the resulting vertex/tri counts + AABB + per-face areas against the current BRepMesh
   output on the canonical solids BEFORE deleting the OCCT path (the native tessellation need not be
   vertex-identical, but must be watertight, same topology genus, and area-match to chordal tol).
2. **FeaTet.cpp:** replace the BRepMesh surface seed with the native surface mesh (import OCCT→native,
   sample faces). The tet mesher only needs a watertight, well-formed boundary triangle set. Gate:
   the FEA tet gates (`native_*fea*` / `feaTet` smokes) still pass — element count within tolerance,
   no inverted/degenerate boundary tris, closed surface.
3. **Oracle removal:** the mesh A/B gates that use BRepMesh as reference will not compile without
   TKMesh — capture BRepMesh outputs as golden fixtures (vert/tri counts + AABB + area per canonical
   solid) and convert to native-only golden regressions; keep the OCCT oracle behind an opt-in
   `#ifdef FORGE_HAVE_OCCT_MESH` TU excluded from the default build.
4. **Remove** both `#include <BRepMesh_IncrementalMesh.hxx>`. Confirm `grep -rE 'BRepMesh|IMeshData|
   IMeshTools' src/` is empty.
5. **Drop `TKMesh`** from `OCCT_LIBS` in `forge-kernel/CMakeLists.txt`.
6. **Gate before push (mandatory):** clean rebuild `build/`; `otool ... | grep -c opencascade` == **15**;
   `bash test/native/run_native.sh` JOBS=3 == 137/137 (watch `native_boolean_test` timing);
   `native_vs_occt_core.mjs` 34/34; `forge:coherence` DISCRIMINATION PASS. macOS flat-namespace hides
   bad drops → the true gate is **Linux CI green**, never the mac link.

## Discipline
- Warm main tree or worktree; **commit locally, DO NOT push** — human reviews diff + gate output and
  pushes (CI-green control, one workflow-kind at a time).
- If FeaTet native surface quality can't match BRepMesh for tet seeding on some scene, **do NOT drop
  TKMesh**: route only the display `Tessellate.cpp` path native (that's safe + verified), leave FeaTet
  on OCCT, record the precise FeaTet blocker here, keep everything green, commit the partial verified
  progress, and report honestly. No faked pass; the native tessellator reports failure rather than
  emit a non-watertight/degenerate mesh.
```
