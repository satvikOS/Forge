// forge/native/brep/Aabb.hpp
//
// In-house ANALYTIC axis-aligned bounding box of a native B-rep Solid — the
// OCCT-free replacement for BRepBndLib::AddOptimal + Bnd_Box on a native handle
// (OCCT_ZERO_ROADMAP W2.1). This is the SOLE OCCT call ComponentRegistry made.
//
// ============================ HONESTY (Bible §0/§9) ========================
// Computes the EXACT tight world-space AABB of a closed brep::Solid by, for each
// world axis ê in {X,Y,Z}, taking the analytic extremum of the projection
// S(u,v)·ê over EVERY face's parameter trim window [u0,u1]x[v0,v1] and unioning:
//
//   * PLANE faces — S·ê is affine in (u,v); the extremum over a rectangle is at a
//     corner, so the four trim-rectangle corners (and, when the face carries a
//     vertexUV polygon, its loop vertices) bound it exactly. A planar face is a
//     flat patch, so its min/max along any direction is achieved at the boundary
//     of its (u,v) window — bit-exact.
//   * CYLINDER / CONE / SPHERE / TORUS faces — S·ê is a constant + a single
//     sinusoid A·cos(θ)+B·sin(θ) in the angular parameter (plus a monotone term
//     in the axial/φ parameter). The stationary angle θ* = atan2(B,A) (and its
//     antipode) is found in closed form and CLAMPED to the face's angular trim
//     window; the axial/radial parameter extremum is at a window endpoint. So a
//     cylinder's true ±r bulge, a sphere's pole, a cone's rim are captured
//     EXACTLY regardless of how finely the primitive was faceted into angular
//     sectors (each sector contributes its own arc's exact extent; abutting
//     sectors tile the full angle).
//   * NURBS faces (ellipsoid / pyramid sides) — no closed-form extremum, so the
//     window is sampled on a dense grid and bounded by the samples + corners.
//     This is the ONE non-exact kind; documented plainly, not faked. (The
//     canonical analytic primitives never hit it.)
//
// The result is the model-space AABB of the Solid as built (untransformed); the
// caller applies the instance transform to the 8 corners (ComponentRegistry does
// this already, unchanged). Validated A/B against OCCT BRepBndLib::AddOptimal to
// 1e-9 for every analytic primitive + planar boolean (test/native/brep/
// aabb_test.cpp + the native_vs_occt AABB tie).
//
// Pure C++20, ZERO external deps. No OCCT, no WASM.

#ifndef FORGE_NATIVE_BREP_AABB_HPP
#define FORGE_NATIVE_BREP_AABB_HPP

#include "forge/native/brep/Topology.hpp"

namespace forge {
namespace native {
namespace brep {

// Model-space axis-aligned box. `void_` is true iff the solid had no geometry
// (empty), in which case min/max are unspecified (the caller treats it as void).
struct Aabb3 {
    double minX = 0.0, minY = 0.0, minZ = 0.0;
    double maxX = 0.0, maxY = 0.0, maxZ = 0.0;
    bool   void_ = true;
};

// Exact analytic AABB of the (untransformed) solid in model space. `nurbsGrid`
// is the per-direction sample count used ONLY for Nurbs faces (ignored by the
// analytic kinds, which are bit-exact); 24 is dense enough that the canonical
// ellipsoid/pyramid bound to << 1e-6 and is never the gated path (the gate
// covers analytic primitives, which are exact). Walks every shell/face/loop —
// O(faces).
Aabb3 computeAabb(const Solid& solid, int nurbsGrid = 24);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_AABB_HPP
