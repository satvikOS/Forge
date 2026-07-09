# OCCT dependency truth (2026-07-06, otool -verified) — NOT OCCT-free
forge-kernel.node LINKS 24 OCCT dylibs (libTKernel/TKMath/TKBRep/TKTopAlgo/TKBO/TKBool/TKFillet/TKHLR/
TKMesh/TKDESTEP/TKDEIGES/TKG2d/TKG3d/TKGeomBase/... ). OCCT is the B-rep backbone + every-residual fallback
+ STEP/IGES/STL io (TKDE*) + test oracle. FORGE_NATIVE_BREP=ON exposes a native path that is PREFERRED and
A/B-verified to MATCH OCCT on the ops that flip — but OCCT is NOT removed. "native-verified" ≠ "OCCT-free".
GENUINELY dependency-free (NOT linked): CGAL(mesh), libfive(implicit), PicoGK(voxel), Manifold — all native
in src/native/{mesh,implicit,voxel,csg}. So 4 of 5 engines are dependency-free; OCCT is the one that is not.
TRUE OCCT-zero requires: native path covers 100% (no fallback for curved mixed booleans/NURBS offset/
perspective HLR), NATIVE STEP/IGES/STL io (replace TKDE*), then UNLINK OCCT + prove 0 OCCT dylibs. Large
real effort. Map: occt-unlink-truth workflow (wiwmyie3m).

## 2026-07-09 — the native→OCCT bridge is lossy in TOPOLOGY (not in volume)

Measured with the new `faceInventory` op (src/DirectEdit.cpp):

    FORGE_NATIVE_BREP=ON   makeCylinder(7,25) -> 130 faces { cylinder:128, plane:2 }
    FORGE_NATIVE_BREP=OFF  makeCylinder(7,25) ->   3 faces { cylinder:1,   plane:2 }

Both report volume 3848.451000647 (= pi*49*25) to 1e-12, and both tessellate and
mass-prop identically. That is why every existing A/B gate passes: the gates check
volume, COM, chi/genus, and tessellation — none of them check FACE IDENTITY.

But the native path's bridge emits an analytic cylindrical surface as 128 angular
strips, each an independent TopoDS_Face of radius 7 spanning 360/128 deg. So
"select the bore and resize it", "remove this hole", "fillet that edge" — every
face-level direct-modelling operation — has no well-defined target on a native-path
solid. This is a real limitation of the "native-verified" claim: the ops that were
verified are the ops whose correctness is expressible in volume/topology invariants.
Face-level semantics were never in the gate, and they do not survive the bridge.

Mitigation shipped: `unifyFaces()` (ShapeUpgrade_UnifySameDomain) merges same-surface
faces and restores 130 -> 3 with volume preserved to 1e-12. It is a documented
prerequisite for the DirectEdit ops on native-path solids, and a no-op on solids
imported from STEP. Proper fix (bridge emits one face per analytic surface) is
still open.

Test: test/directedit.mjs, case "native->OCCT bridge shatters an analytic cylinder;
unifyFaces repairs it".
