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
