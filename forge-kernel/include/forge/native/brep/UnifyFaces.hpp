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
//   * CO-CYLINDRICAL merge (ADDITIVE increment, A/B vs OCCT in
//     test/native_unify_smoke.mjs). A native cylinder's lateral surface is emitted
//     by the primitive builders as N angular STRIP faces on ONE shared analytic
//     surface (buildCone(r,r,h) -> 128 Cone(r1==r2) sectors). `unifySameDomainCurved`
//     merges those strips back into ONE periodic cylindrical face: it drops the
//     N-1 interior vertical seam edges (keeping exactly one as the face SEAM),
//     re-traces the two boundary rings (bottom + top circle) and splices them
//     through the seam into a single closed loop, then rebuilds a fresh closed
//     2-manifold Solid whose lateral is a single full-2*pi face (analyticFaceInventory
//     stripFaceCount 128 -> 1) and whose planar caps are copied 1:1. The result is
//     VOLUME-cross-checked against the input (never a wrong shape) and, when bridged
//     to OCCT for counting, matches OCCT ShapeUpgrade_UnifySameDomain 1:1 (3F/3E,
//     exact volume). Fires ONLY for a clean cylinder body (exactly one co-cylindrical
//     group forming a full 2*pi lateral + exactly two planar cap faces, no holes) so
//     bored plates / tubes / partial (fillet) cylinders stay on the OCCT path.
//
// What is explicitly TARGETED (NOT built here — the remaining coverage gap for the
// eventual TKShHealing drop):
//   * Co-CONICAL / co-SPHERICAL / co-TOROIDAL merge (cone frustum, sphere, torus),
//     the cut-cylinder / bored-plate holed-annulus merge, and multi-cylinder
//     (tube) bodies — those defer to OCCT ShapeUpgrade_UnifySameDomain (a sphere/
//     torus/cone or a holed/multi-shell input makes both eligibility checks return
//     false, so `unifyFaces` (DirectEdit.cpp) falls back unchanged).
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

// ADDITIVE (curved co-cylindrical merge). True iff `s` is eligible for the native
// curved unify: exactly one shell, every face a single simple outer loop (no inner/
// hole loops, not boolean-holed), and the faces are EXACTLY two planar cap faces
// plus a single co-cylindrical group (>= 2 strip faces, all on the SAME cylinder —
// SurfaceKind::Cylinder or the equal-radii SurfaceKind::Cone the primitive builder
// emits — sharing one quantised axis+radius+foot-point key). Any sphere/cone/torus/
// nurbs face, any holed/disk-with-hole face, any second cylinder (tube), any extra
// planar face (a bored plate's box walls), or a partial (fillet) cylinder makes this
// false, so the caller defers to OCCT ShapeUpgrade_UnifySameDomain unchanged.
bool nativeUnifyCurvedEligible(const Solid& s);

// Merge the co-cylindrical strip faces of `s` into ONE periodic cylindrical face,
// dropping the interior seam edges (keeping one as the face seam) and re-tracing the
// two boundary rings into a single spliced loop, and copy the planar caps 1:1, into
// a NEW native Solid owned by `outOwner`. Returns the merged Solid (a non-owning view
// into *outOwner) or nullptr if the merge cannot be completed EXACTLY (ineligible
// input, the boundary does not trace to exactly two rings, no seam edge is found, the
// rebuilt solid is not a closed 2-manifold, or its volume does not match the input to
// tolerance — in every such case the caller must fall back to OCCT rather than emit a
// wrong shape).
Solid* unifySameDomainCurved(const Solid& s,
                             std::shared_ptr<TopologyBuilder>& outOwner);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_UNIFYFACES_HPP
