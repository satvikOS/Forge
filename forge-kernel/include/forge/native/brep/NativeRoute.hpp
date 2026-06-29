// forge/native/brep/NativeRoute.hpp
//
// IN-HOUSE KERNEL STEP 3a — the ROUTING LAYER that lets the LIVE Forge core ops
// (makeBox / makeCylinder / ... / fuse / cut / common / translate / rotate /
// massProps / tessellate / filletEdges / chamferEdges) run through the OCCT-FREE
// forge::native B-rep path behind the SAME integer handle, so the JS API is
// byte-identical regardless of backend.
//
// ============================ HONESTY (Bible §0/§9) ========================
// ADDITIVE + GATED. Everything here is compiled in ONLY under -DFORGE_NATIVE_BREP
// and is taken at runtime ONLY when forgeNativeBrepEnabled() is true (env
// FORGE_NATIVE_BREP=1). Default OFF leaves every live op on the existing OCCT
// path, byte-for-byte unchanged.
//
// WHAT IS ANALYTIC-NATIVE (exact, parity ~1e-6 vs OCCT):
//   * all primitives (buildBox/.../buildTube) — analytic faces, OCCT placement
//   * translate/rotate via transformSolid (rigid transform of the analytic Solid)
//   * fuse/cut/common via brep::booleanSolid (analytic SSI; honest flagged mesh
//     fallback ONLY where SSI defers — see Boolean.hpp)
//   * massProps via brep::massProperties (exact divergence theorem)
//   * tessellate via brep::tessellateSolid (watertight) + normals + faceIds
//
// WHAT IS A MESH-BRIDGE (in-house, ~0.5% tess tol, HONESTLY a mesh, not analytic):
//   * filletEdges / chamferEdges — the native analytic Solid is tessellated to a
//     mesh::HalfEdgeMesh, then the proven mesh fillet/chamfer runs. The result is
//     a NativeMesh handle (NOT an analytic Solid). It rounds/bevels EVERY sharp
//     convex edge (the native mesh op has no per-edge selection), so the JS
//     edgeIds argument is honored for the EDGE SET it spans but the native op
//     applies the radius to all sharp-convex edges — stated plainly, never faked.
//
// Pure C++20, ZERO external deps (stdlib + forge native headers). No OCCT, no WASM.

#ifndef FORGE_NATIVE_BREP_NATIVEROUTE_HPP
#define FORGE_NATIVE_BREP_NATIVEROUTE_HPP

#include <cstdint>
#include <memory>
#include <vector>

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// Runtime gate. True iff the live core ops should route through the native
// B-rep path. Reads the FORGE_NATIVE_BREP environment variable ONCE (cached):
// "1"/"on"/"true"/"yes" (case-insensitive) -> enabled; anything else -> OCCT.
// The COMPILE gate (-DFORGE_NATIVE_BREP) must also be set for this TU to exist;
// this runtime gate lets a single binary A/B-toggle the two backends so the gate
// harness compares native-vs-OCCT on the SAME process.
// ---------------------------------------------------------------------------
bool forgeNativeBrepEnabled();

// Per-capability sub-gates (the migration enables native one PROVEN capability at
// a time). FEATURES = mesh-bridge/feature ops (fillet/chamfer/draft/loft/...) that
// return a NativeMesh — Wave 2; STEP = native STEP import/export — Wave 3. Both
// DEFAULT OFF (their own env opt-ins FORGE_NATIVE_FEATURES / FORGE_NATIVE_STEP),
// so the Wave-1 production default (FORGE_NATIVE_BREP=1) runs analytic-core native
// while features + STEP stay on OCCT. (See NativeRoute.cpp.)
bool forgeNativeFeaturesEnabled();
bool forgeNativeStepEnabled();

// INTERFERENCE clash test (assembly overlap volume) sub-gate. This is a CORE-class,
// REPRESENTATION-NEUTRAL op — it returns a scalar overlap volume + a clash verdict,
// NOT a NativeMesh (unlike the FEATURES bridge). Its native path is
//   resolveWorldSolid (NativeSolid directly / OCCT-analytic via importOcctSolid) ->
//   transformSolid -> brep::booleanSolid(Common) -> brep::massProperties,
// all of which are the Wave-1 analytic-core engine A/B-verified vs OCCT (the
// box-box COMMON overlap volume is gate-covered to 1e-6 in native_boolean_test.cpp,
// and the import→native composition vs OCCT BRepAlgoAPI_Common is gate-covered in
// native_vs_occt_interference.cpp). It was previously bundled under FEATURES (OFF);
// it now has its OWN gate, DEFAULT ON (env FORGE_NATIVE_INTERFERENCE=0/off rolls back
// to the OCCT BRepAlgoAPI_Common narrow phase). OCCT stays LINKED as the honest
// fallback for non-analytic operands (NURBS/torus → importOcctSolid defers) and as
// the importOcctSolid source — per Bible §0 (delete OCCT only at the very end).
bool forgeNativeInterferenceEnabled();

// Force the runtime gate (overrides the env var for the rest of the process).
// Used by the A/B gate harness to toggle backends per-op deterministically.
// Sets CORE + FEATURES + STEP + INTERFERENCE together so the harness can A/B every op.
void setForgeNativeBrepEnabled(bool on);

// ---------------------------------------------------------------------------
// transformSolid — THE PLACEMENT-GAP FIX.
//
// Deep-clone `src` into a NEW solid owned by `outOwner`, with every Vertex
// position and every analytic Surface frame (origin/axis/refDir) rigidly
// transformed by  p' = R*p + t  (R a rotation, t a translation). The result is
// a genuine analytic Solid (planar faces stay planar, a cylinder stays the SAME
// cylinder moved/rotated) so the live JS  makeBox -> translate -> cut  chain
// runs identically on the native backend — closing the §4 placement gap.
//
//   R   : row-major 3x3 rotation (9 doubles). Pass the identity for a pure
//         translation. (translate() builds identity; rotate() builds the
//         axis-angle matrix.)
//   t   : translation (3 doubles).
//
// Returns a non-owning view into *outOwner. The topology connectivity is
// preserved exactly (shared edges stay shared), so the clone is closed iff the
// source was. Surface trim windows (u0..v1, vertexUV, isDisk radii) are copied
// verbatim because a RIGID transform does not change the parameterisation.
// ---------------------------------------------------------------------------
Solid* transformSolid(const Solid& src,
                      const double R[9], const double t[3],
                      std::shared_ptr<TopologyBuilder>& outOwner);

// ---------------------------------------------------------------------------
// Live-op-facing helpers used by the gated routing in src/Primitives.cpp etc.
// These convert a native result into the EXACT JS shapes the OCCT path emits.
// ---------------------------------------------------------------------------

// A watertight Solid -> tessellation in the OCCT viewport contract: flat
// Float32 positions, smooth per-vertex normals (area-weighted face-normal
// accumulation, matching Tessellate.cpp), per-TRIANGLE 1-based faceIds (one id
// per analytic Face in shell/face order), and flat Uint32 indices.
struct NativeTessOut {
    std::vector<float>         positions; // xyz triples
    std::vector<float>         normals;   // per-vertex, normalised
    std::vector<std::uint32_t> indices;   // triangle indices
    std::vector<std::uint32_t> faceIds;   // per-triangle, 1-based
};

NativeTessOut tessellateSolidForViewport(const Solid& solid);

// Same for a fillet/chamfer RESULT mesh (NativeMesh handle): a triangle soup
// with a single faceId stream (per-triangle, derived from the mesh face index +
// 1, since a mesh has no analytic-face grouping).
NativeTessOut tessellateMeshForViewport(const mesh::HalfEdgeMesh& m);

// Inertia tensor about the COM of a closed triangle mesh, via signed-tetra
// decomposition from the origin (unit density). Matches the OCCT convention
// (about COM, row-major). HONEST: this is the MESH inertia of a fillet/chamfer
// RESULT (a mesh handle), not an analytic tensor.
struct MeshMassOut {
    double volume = 0.0;
    double area   = 0.0;
    double com[3] = {0, 0, 0};
    double inertiaCom[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0};
};
MeshMassOut meshMassProperties(const mesh::HalfEdgeMesh& m);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NATIVEROUTE_HPP
