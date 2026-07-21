// forge/native/brep/UnifyFaces.hpp
//
// Native "unify same domain" — merge adjacent faces that lie on the SAME
// underlying analytic surface into one face, dropping the now-redundant shared
// edges and collinear vertices. The in-house replacement for OCCT's
// ShapeUpgrade_UnifySameDomain (the #1 blocker for eventually dropping
// TKShHealing — see OCCT_DEPENDENCY_TRUTH.md).
//
// ============================ HONESTY (Bible §0/§9) ========================
// What is REAL and A/B-VERIFIED in this increment (test/native_unify_smoke.mjs,
// A/B vs OCCT ShapeUpgrade_UnifySameDomain):
//
//   * COPLANAR PLANAR faces. Adjacent faces on the SAME plane (same outward
//     normal within tol, same signed offset within tol) that share an edge are
//     merged into one planar face. The shared (interior) edges are dropped and
//     the merged boundary is re-traced; collinear boundary vertices are removed
//     so the merged face has the minimal edge/vertex count (matching OCCT).
//   * The result is rebuilt as a fresh, closed 2-manifold native Solid via the
//     validated TopologyBuilder (shared edges / mated coedges), so native
//     mass-props / tessellation / the STEP bridge all keep working on it.
//
// What is explicitly TARGETED (NOT built here — the coverage gap for the
// eventual TKShHealing drop):
//   * Co-CYLINDRICAL / co-CONICAL / co-SPHERICAL merge (the analytic-cylinder
//     "128 strips -> 1 face" case) — that needs a PERIODIC single face with a
//     seam edge and two boundary rings, not yet built. `nativeUnifyPlanarEligible`
//     returns false for any solid containing curved faces, so `unifyFaces`
//     (DirectEdit.cpp) honestly falls back to OCCT ShapeUpgrade_UnifySameDomain
//     for those (the cylinder-strip path is unchanged).
//   * Holed / disk / multi-shell inputs also defer to OCCT (kept out of scope so
//     the planar path stays exact + safe).
//
// Pure C++20, ZERO external deps (stdlib + existing forge native headers).
// CONVENTIONS: namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_UNIFYFACES_HPP
#define FORGE_NATIVE_BREP_UNIFYFACES_HPP

#include <memory>

#include "forge/native/brep/Topology.hpp"

namespace forge {
namespace native {
namespace brep {

// True iff `s` is eligible for the native planar unify: exactly one shell and
// EVERY face is a simple planar polygon (surface kind == Plane, a single outer
// loop, no inner/hole loops, not an exact-disk cap, not a boolean-holed face).
// Any curved face, hole, disk cap or extra shell makes this return false so the
// caller defers to OCCT (whose ShapeUpgrade_UnifySameDomain covers those).
bool nativeUnifyPlanarEligible(const Solid& s);

// Merge coplanar-adjacent planar faces of `s` into a NEW native Solid, owned by
// `outOwner` (which is (re)assigned to the fresh TopologyBuilder). Returns the
// merged Solid (a non-owning view into *outOwner), or nullptr if the merge
// cannot be completed exactly (ineligible input, a boundary that does not trace
// to clean loops, or a result that is not a closed 2-manifold — in every such
// case the caller must fall back to OCCT rather than emit a wrong shape).
Solid* unifySameDomainPlanar(const Solid& s,
                             std::shared_ptr<TopologyBuilder>& outOwner);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_UNIFYFACES_HPP
