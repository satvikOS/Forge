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
//   * CO-CYLINDRICAL / co-CONICAL / co-SPHERICAL merge (ADDITIVE increments, A/B vs
//     OCCT in test/native_unify_smoke.mjs). The primitive builders emit a quadric of
//     revolution as N angular STRIP faces on ONE shared analytic surface (a cylinder
//     = buildCone(r,r,h) -> 128 Cone(r1==r2) sectors; a cone/frustum -> 128 Cone
//     sectors; a sphere -> N*M spherical patches with pole triangle fans).
//     `unifySameDomainCurved` merges those strips back into the ONE periodic analytic
//     face OCCT produces, IN-HOUSE (no OCCT bridge):
//       - CYLINDER / cone FRUSTUM: drop the N-1 interior seam edges (keep one as the
//         face SEAM), re-trace the two boundary rings (bottom + top circle) and splice
//         them through the seam; copy the two planar caps 1:1 (== OCCT 3F).
//       - pointed CONE (top radius 0): the top ring collapses to the apex vertex, so
//         the loop is base-ring + seam-to-apex; copy the one planar cap 1:1 (== OCCT 2F).
//       - SPHERE: one periodic spherical face whose boundary is a there-and-back seam
//         meridian with the two poles as degenerate vertices, no caps (== OCCT 1F).
//     Each rebuilds a fresh closed 2-manifold Solid (analyticFaceInventory stripFaceCount
//     N -> 1), is VOLUME-cross-checked against the input (never a wrong shape), and,
//     when bridged to OCCT for counting, matches OCCT ShapeUpgrade_UnifySameDomain 1:1
//     (face/edge count + exact volume). Fires ONLY for a CLEAN single primitive body
//     (one co-surface group forming a full 2*pi lateral + its expected cap count, no
//     holes) so bored plates / tubes / partial (fillet) surfaces stay on the OCCT path.
//
// What is explicitly TARGETED (NOT built here — the remaining coverage gap for the
// eventual TKShHealing drop):
//   * Co-TOROIDAL merge (torus), the cut-cylinder / bored-plate holed-annulus merge,
//     multi-cylinder (tube) bodies, and hemispheres (sphere + a planar cut cap) — those
//     defer to OCCT ShapeUpgrade_UnifySameDomain (a torus/nurbs face, a second
//     cyl/cone/sphere group, or a holed/multi-shell/extra-cap input makes both
//     eligibility checks return false, so `unifyFaces` (DirectEdit.cpp) falls back
//     unchanged).
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

// ADDITIVE (curved co-cylindrical / co-conical / co-spherical merge). True iff `s` is
// eligible for the native curved unify: exactly one shell, every face a single simple
// outer loop (no inner/hole loops, not boolean-holed, no region/param annotation), and
// the body is exactly ONE clean quadric-of-revolution primitive:
//   * a CYLINDER or CONE — one ruled group (>= 2 strip faces, all on the SAME
//     SurfaceKind::Cylinder/Cone sharing one quantised radii+height+axis+foot key) plus
//     TWO planar caps (cylinder / frustum) or ONE (pointed cone / apex); or
//   * a full SPHERE — only patches of ONE SurfaceKind::Sphere (>= 2, sharing one
//     centre+radius key), with NO planar caps.
// Any torus/nurbs face, a second cyl/cone/sphere group (a tube, or two fused
// primitives), any holed/disk-with-hole face, an extra planar face (a bored plate's box
// walls, or a hemisphere's cut cap), or a partial (fillet) surface makes this false, so
// the caller defers to OCCT ShapeUpgrade_UnifySameDomain unchanged.
bool nativeUnifyCurvedEligible(const Solid& s);

// Merge the co-surface strip faces of `s` into the ONE periodic analytic face OCCT
// produces — a periodic cylinder/cone lateral (dropping the interior seams, keeping one,
// splicing the boundary rings; the top ring collapses to the apex for a pointed cone) +
// the planar cap(s) copied 1:1, OR a single periodic spherical face with a there-and-back
// seam meridian and degenerate poles — into a NEW native Solid owned by `outOwner`.
// Returns the merged Solid (a non-owning view into *outOwner) or nullptr if the merge
// cannot be completed EXACTLY (ineligible input, the boundary does not trace to the
// expected ring(s), no seam/apex is found, the rebuilt solid is not a closed 2-manifold,
// or its volume does not match the input to tolerance — in every such case the caller
// must fall back to OCCT rather than emit a wrong shape).
Solid* unifySameDomainCurved(const Solid& s,
                             std::shared_ptr<TopologyBuilder>& outOwner);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_UNIFYFACES_HPP
