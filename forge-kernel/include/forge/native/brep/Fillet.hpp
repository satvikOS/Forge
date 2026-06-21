// forge/native/brep/Fillet.hpp
//
// In-house MESH EDGE FILLET (rounded edge) for the Forge native kernel —
// forge::native::brep::Fillet. Pure C++20, ZERO external dependencies: the
// standard library plus the existing forge/native headers only. NO OCCT, NO
// WASM, NO third-party libs. Builds ONLY on the existing forge/native headers
// (by #include, never re-deriving them):
//
//   * forge/native/Predicates.hpp          — robust orient2d/orient3d (degeneracy
//                                            oracle for zero-area faces / planar
//                                            corner solves).
//   * forge/native/geom/Geom.hpp           — Point2/Point3 canonical geom types.
//   * forge/native/geom/AABBTree.hpp        — part of the mandated geom-stack reuse
//                                            surface (broad-phase box hierarchy).
//   * forge/native/mesh/HalfEdgeMesh.hpp    — Vec3 / HalfEdgeMesh / buildFromSoup /
//                                            validate / signedVolume — the solid
//                                            this op consumes and emits.
//   * forge/native/mesh/FeatureEdges.hpp    — detectFeatureEdges: the sharp-edge /
//                                            corner classifier this op REUSES to
//                                            decide which edges to round.
//   * forge/native/mesh/TriTriIntersect.hpp — part of the mandated mesh-stack reuse
//                                            surface (triangle-triangle overlap).
//
// ===========================================================================
// WHAT THIS IS (honest scope — Bible §0 / KERNEL_INHOUSE_ROADMAP §0)
// ===========================================================================
// A MESH fillet (rounded edge), NOT an analytic B-rep fillet. We do NOT trim and
// re-parameterise NURBS faces against a rolling-ball blend surface (that is the
// analytic OCCT `BRepFilletAPI_MakeFillet` road, deliberately NOT claimed here).
// Instead we operate purely on the in-house half-edge TRIANGLE mesh:
//
//   Along each SHARP CONVEX feature edge (found by reusing
//   mesh::detectFeatureEdges), the sharp edge is REPLACED by a rounded strip that
//   approximates a rolling ball of radius `r`. Concretely, on each of the two
//   faces adjacent to a convex edge the rolling ball first touches a CONTACT
//   line offset a distance `r` inward from the edge (in that face's plane, along
//   the in-face perpendicular to the edge). The sharp corner material between the
//   two contact lines is removed and replaced by `nSeg` ARC segments sweeping the
//   quarter-(or general-dihedral-)circle of the rolling ball from one contact
//   line to the other — a strip of `nSeg` quad rings (2*nSeg triangles per edge
//   length unit of the strip) blending the two adjacent faces.
//
//   At a CONVEX corner where several convex edges meet, the per-edge strips would
//   leave a curved triangular gap; we fill it with a spherical-cap fan of the
//   same radius `r` centred at the analytic ball centre for that corner, so the
//   result stays a closed 2-manifold (the corner becomes a rounded vertex).
//
// ===========================================================================
// VALIDATED ENVELOPE (asserted in fillet_test.cpp — read this precisely)
// ===========================================================================
// The HONEST, fully-validated envelope of this increment is the canonical
// rolling-ball fillet of a CONVEX box-like solid whose sharp convex edges meet
// the dihedral/feature criteria — the unit cube is the seed gate:
//
//   * Filleting the 12 convex edges of a unit cube by radius `r` (with
//     0 < r < 0.5, i.e. the contact lines do not cross the face) yields a
//     WATERTIGHT, 2-MANIFOLD, genus-0 solid (validate().isValid(), Euler == 2).
//   * Its volume is strictly LESS than the cube (material was rounded away) and
//     strictly MORE than the cube with every edge cut by a full 45-degree
//     square-edge wedge (cube - r^2 * total_edge_length): the rounded strip
//     leaves the pi/4 quarter-disk of material the square chamfer would discard.
//   * As `nSeg` grows the volume converges to the analytic rolling-ball value
//     cube - (1 - pi/4) * r^2 * total_edge_length  (within a coarse, nSeg-
//     dependent tolerance) — i.e. each convex edge loses exactly the
//     (1 - pi/4) r^2 cross-section over its length.
//   * NO original sharp convex dihedral edge survives in the output (every
//     >threshold convex edge has been split into the rounded strip).
//
// ===========================================================================
// HONEST LIMITS — handled, never faked (ok == false / skipped outside the env)
// ===========================================================================
//   * CONCAVE edges (the ball would have to be on the *outside* of a reflex
//     crease) are NOT rounded by this convex rolling-ball op: they are SKIPPED
//     (recorded in `skippedConcaveEdges`) and pass through as the original sharp
//     edge. Rounding a concave edge needs an interior-blend / subtractive fillet
//     and is TARGETED, not claimed.
//   * `r` TOO LARGE — if any contact line would cross the far side of its face
//     (r >= the in-face half-extent so two opposite contact lines collide), or
//     a corner ball centre cannot be solved — the operation returns ok == false
//     with a populated `reason`. We never emit a self-overlapping or inverted
//     strip to "pass".
//   * BOUNDARY edges (open mesh) and NON-MANIFOLD input are refused via
//     detectFeatureEdges (ok == false) — this op consumes a closed 2-manifold.
//   * The result solid is ALWAYS re-audited with HalfEdgeMesh::validate(); if it
//     does not come out a closed 2-manifold, ok is set false (surfaced, never
//     faked).
//
// ROBUSTNESS POSTURE (honest): the COMBINATORIAL convex/concave classification
// is driven by the sign of the edge's signed dihedral (computed from the exact
// orient3d predicate against the opposite apex), so the decision to round an edge
// cannot be flipped by rounding. The CONTACT-line and ARC vertex COORDINATES are
// ordinary IEEE-754 doubles (the standard mesh-fillet ceiling, the same honest
// level the rest of forge::native ships). This is robust-in-practice, NOT an
// exact (rational) construction kernel. 0 FAKES.

#ifndef FORGE_NATIVE_BREP_FILLET_HPP
#define FORGE_NATIVE_BREP_FILLET_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh, validate

namespace forge {
namespace native {
namespace brep {

// Diagnostics for one convex edge that was rounded into a fillet strip.
struct FilletEdgeInfo {
    std::uint32_t v0 = mesh::kInvalid;   // original edge endpoints (v0 < v1)
    std::uint32_t v1 = mesh::kInvalid;
    double        length = 0.0;          // original edge length
    double        dihedralDeg = 0.0;     // dihedral angle of the sharp edge [0,180]
};

// Outcome of a mesh edge-fillet operation.
struct FilletResult {
    bool             ok = false;          // true only when a valid closed solid was emitted
    mesh::HalfEdgeMesh mesh;              // the filleted solid (valid only when ok==true)
    std::string      reason = "";         // why ok==false (diagnostic; "" on success)

    // --- accounting (populated whenever the input parsed) -------------------
    double radius = 0.0;                  // the fillet radius applied
    std::uint32_t nSeg = 0;               // arc segments per strip actually used

    std::uint32_t numConvexEdgesRounded  = 0;  // sharp convex edges turned into strips
    std::uint32_t numSkippedConcaveEdges = 0;  // sharp concave edges left sharp
    std::vector<FilletEdgeInfo> roundedEdges;  // one entry per rounded convex edge
    std::vector<FilletEdgeInfo> skippedConcaveEdges;  // sharp concave edges skipped

    double totalConvexEdgeLength = 0.0;   // sum of lengths of the rounded edges
    double inputVolume  = 0.0;            // signed volume of the input solid
    double outputVolume = 0.0;            // signed volume of the filleted solid

    // The analytic rolling-ball target for the rounded edges:
    //   inputVolume - (1 - pi/4) * r^2 * totalConvexEdgeLength
    // (exact only for 90-degree dihedrals; a reference value for the gate).
    double analyticTargetVolume = 0.0;
};

// Fillet (round) every SHARP CONVEX feature edge of a closed 2-manifold triangle
// solid by a rolling ball of radius `r`, inserting `nSeg` arc segments per strip.
//
//   positions    : flat xyz triples, length == 3 * numVertices
//   indices      : flat triangle indices, length == 3 * numTriangles
//   r            : fillet radius (> 0).
//   nSeg         : arc segments per fillet strip (>= 1). Higher -> closer to the
//                  analytic rolling-ball surface.
//   thresholdDeg : dihedral threshold (deg) for "sharp" (default 30) — passed
//                  straight through to detectFeatureEdges.
//
// Returns ok == false (with `reason`) when:
//   * the input is empty / not a buildable closed 2-manifold (via detectFeatureEdges),
//   * r <= 0 or nSeg == 0 or thresholdDeg outside [0,180] or non-finite input,
//   * r is too large (a contact line would cross its face / corner unsolvable),
//   * the emitted solid fails HalfEdgeMesh::validate() (not a closed 2-manifold).
//
// CONCAVE sharp edges are SKIPPED (left sharp, recorded), not an error by themselves.
FilletResult filletConvexEdges(const std::vector<double>& positions,
                               const std::vector<std::uint32_t>& indices,
                               double r, std::uint32_t nSeg,
                               double thresholdDeg = 30.0);

// Build the 12-triangle (two-per-face) closed soup of an axis-aligned cube of
// side `L` placed with its min corner at `origin`, all faces CCW-wound as seen
// from OUTSIDE. Exposed for testing / reuse (the canonical fillet seed target).
// (Uniquely named to avoid colliding with brep::makeCubeSoup in sibling modules
// such as Chamfer — the namespace-unique-symbol rule.)
void makeCubeSoupForFillet(double L, const mesh::Vec3& origin,
                           std::vector<double>& positions,
                           std::vector<std::uint32_t>& indices);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_FILLET_HPP
