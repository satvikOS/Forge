# PD — Fuse Mesh-Operand Bridge (keystone OCCT-zero step)

**Root cause (corrected):** begin→makeBox/Cylinder already yields analytic **NativeSolid**
(Primitives.cpp:64-66) and translate keeps it (Transform.cpp:35-38). The NativeMesh enters via
the mesh-bridged FEATURE verbs — `filletEdges` (Features.cpp:903) / `chamferEdges`
(Features.cpp:971) tessellate the Solid → return **NativeMesh**. A subsequent
`part.add`/`part.subtract`/`part.bolt-circle` boolean then:
1. `tryNativeBoolean` bails — `kindOf(a)!=NativeSolid || kindOf(b)!=NativeSolid` (Booleans.cpp:183)
2. Falls to OCCT `runBoolean<>` → `ShapeRegistry::get(meshHandle)` → **THROWS**
   (ShapeRegistry.cpp:81 "native-mesh-backed … no analytic TopoDS_Shape")
3. Verb errors (dispatchSequence pushes to errors), ctx.current stays stale → part never finalizes
   → "context-verb part builds in-kernel but never reaches the viewport".

**Fix = option (b): route the boolean through the native MESH boolean when an operand is NativeMesh.**
Machinery already exists + is trusted: `booleanSolidMeshFallback` (Boolean.cpp:313-339) →
`meshBooleanNative` (MeshBooleanNative.cpp:1376) → `reconstructPlanar` (Boolean.cpp:257) →
`isClosedTwoManifold` gate (Boolean.cpp:334) → returns a closed analytic NativeSolid.

## Smallest increment (ONE cmake-js build)
1. **Boolean.cpp** — factor the soup→meshBooleanNative→reconstructPlanar→manifold-check core out of
   `booleanSolidMeshFallback` (Boolean.cpp:313) into a helper `booleanMeshOperand(soupA, soupB, op)`
   returning `{ok, solid, owner}`. Declare in **include/forge/native/brep/Boolean.hpp** (~:82).
2. **Booleans.cpp** — in `tryNativeBoolean` (:179), replace the hard bail (:183): if either operand
   is NativeMesh (other is NativeMesh or NativeSolid), gather each operand's soup
   (`getNativeMesh().toSoup()` / `tessellateSolid(getNativeSolid())`) → call `booleanMeshOperand` →
   register result via `addNativeSolid`. Keep the pure Solid×Solid analytic path UNCHANGED.
   (Do soup copies outside any held registry lock — mirror booleanSolidMeshFallback.)

## Proving test (clone the importOcctSolidCallCount probe pattern)
`test/native_fuse_mesh_operand_test.cpp` (+ build_fuse_mesh_operand_test.sh, sibling of
build_occt_wire_activation_test.sh):
1. setForgeNativeBrepEnabled(true)
2. makeBox → filletEdges → assert kindOf == NativeMesh (the mesh operand)
3. makeCylinder cutter (NativeSolid)
4. cut(filletedMeshHandle, cutter)
5. ASSERT: result kindOf != Occt (NativeSolid or NativeMesh — both renderable); NO exception;
   `importOcctSolidCallCount()` delta == 0 (proves NO OCCT bridge hit — inverted importer probe)
6. checkValidity / isClosedTwoManifold on result + Betti/volume sanity (bore present)

## Notes / risks
- Result is tessellation-dense planar Solid (reconstructPlanar = 1 face/tri) — same as existing
  Solid×Solid fallback; fine for viewport/mass-props; lineage EMPTY on mesh path (accepted, same as
  status quo — post-fillet body is terminal in context-build).
- No new ShapeKind, no JS wiring change — removing the C++ throw is sufficient for ctx.current →
  response.current → forge.tessellate to reach the viewport.
- Optional later safety net: NativeMesh→OCCT bridge in ShapeRegistry::get() (:74-79 analogue) so any
  lingering OCCT-only consumer degrades gracefully instead of throwing.

**SCHEDULE: execute in the GPU-free window AFTER the iter-250 reasoning eval (model paused), before
resuming the train. Hardware-calm: NEVER build while train2 (GPU) runs.**
