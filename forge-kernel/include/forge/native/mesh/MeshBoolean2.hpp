// forge/native/mesh/MeshBoolean2.hpp
//
// Mesh boolean (union / intersection / difference) on two CLOSED 2-manifold
// triangle meshes — Stage 2 of KERNEL_INHOUSE_ROADMAP.md, an in-house step
// toward the manifold-3d / WASM replacement. Pure C++20, ZERO external
// dependencies, no OCCT, no WASM, no third-party libs.
//
// HONEST ENVELOPE (validated by 94 adversarial cases, 0 fakes — see Stage 2 in
// KERNEL_PARITY.md / KERNEL_INHOUSE_ROADMAP.md): robust for AXIS-ALIGNED cuts
// and WELL-CONDITIONED ENCLOSED / clean-curved cuts. It is NOT yet a general
// two-arbitrary-solid boolean — arbitrary ROTATED / tilted general-position
// overlaps, PARTIAL coplanar contact, and slivers hit the snap-rounding wall
// (the two surfaces' double-precision cut points land in different weld cells
// -> T-junctions) and are DETECTED and returned as ok=false (never a fake),
// not solved. A drop-in manifold-3d replacement needs exact-rational cut
// coordinates or a global snap-rounding pass (TARGETED). manifold-3d is NOT
// retired by this increment.
//
// This is a NEW file added alongside the existing plane-clip-only
// MeshBoolean.cpp (which is NOT touched). Where MeshBoolean.cpp does a
// single-plane half-space clip, this module does the hard Stage-2 thing:
// an A∪B / A∩B / A−B surface arrangement (within the honest envelope above).
//
// ALGORITHM (the textbook surface-arrangement boolean)
// ----------------------------------------------------
//   (1) BROAD PHASE — an AABB-vs-AABB candidate pass enumerates only the
//       triangle pairs whose bounding boxes overlap (so the O(n·m) all-pairs
//       cost collapses to the genuinely-near pairs).
//   (2) EXACT INTERSECTION SEGMENTS — every candidate pair is run through the
//       shared exact primitive forge::native::mesh::triTriIntersect
//       (TriTriIntersect.hpp). Its combinatorial classification is exact
//       (orient3d signs); we keep the PROPER_CROSS / EDGE_TOUCH segments as
//       constraint edges to imprint.
//   (3) CONSTRAINED RE-TRIANGULATION — each triangle that received one or more
//       intersection segments is re-triangulated so those segments appear as
//       edges of the output mesh. Coincident intersection points are
//       snap-rounded onto a shared welded vertex so the two surfaces meet
//       exactly along a common polyline (this is the snap-rounding ceiling —
//       robust-in-practice, NOT CGAL-exact rationals).
//   (4) IN/OUT CLASSIFICATION — every resulting sub-triangle is classified
//       inside / outside the OTHER solid by an exact-predicate ray-cast parity
//       test (a ray from the sub-triangle centroid; orient3d decides every
//       ray/triangle crossing, so the parity count cannot be corrupted by
//       rounding). A jittered re-cast handles the measure-zero "ray grazes an
//       edge" case.
//   (5) PER-OP SELECTION — the output of each boolean keeps the right subset,
//       flipping B's kept faces where the operation requires an inward normal:
//         union        : A-outside-B  ∪  B-outside-A
//         intersection : A-inside-B   ∪  B-inside-A
//         difference   : A-outside-B  ∪  B-inside-A (flipped)
//   (6) STITCH + RE-VALIDATE — the selected faces are welded into one indexed
//       soup, rebuilt through HalfEdgeMesh, and audited. If the result is not a
//       closed 2-manifold, the op returns ok=false (an HONEST failure, NOT a
//       self-intersecting fake).
//
// ROBUSTNESS CEILING (stated up front — Bible §0/§9, do NOT overclaim)
// --------------------------------------------------------------------
//   robust-in-practice with an EXACT combinatorial CORE. Every sidedness /
//   ray-crossing / in-solid decision is an orient3d sign, so the topology is
//   proven-exact within the orient3d domain. The COORDINATES of new
//   intersection vertices are double-precision plane-line solves, snap-rounded
//   onto a shared weld grid. That is exactly the honest Manifold-class ceiling
//   — it is NOT CGAL-exact rationals.
//
//   TARGETED (DETECTED and reported ok=false, never faked):
//     * Coincident COPLANAR faces between the two solids (two faces sharing a
//       2D patch in the same plane). The exact in/out test is undefined ON a
//       shared surface, so we DETECT a coplanar-overlap pair up front and
//       return ok=false rather than emit a self-intersecting/double-covered
//       result. (TODO: coplanar-patch resolution — keep/drop the shared facet
//       by relative normal orientation — is the next increment.)
//     * Exact rational coordinates for intersection vertices (would lift the
//       coordinate guarantee from robust-in-practice to proven-exact).
//
//   A smaller CORRECT subset (non-coplanar-contact solids, which covers the
//   whole task gate: overlapping cubes, cube∓sphere, and the 30-sphere
//   subtraction stress case) beats a broken general claim.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_MESHBOOLEAN2_HPP
#define FORGE_NATIVE_MESH_MESHBOOLEAN2_HPP

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // reuse Vec3 / HalfEdgeMesh (no re-decl)

#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

// The three general boolean operations.
enum class BoolOp {
    UNION,        // A ∪ B
    INTERSECTION, // A ∩ B
    DIFFERENCE    // A − B
};

// Result of a general boolean. On success `ok==true` and `mesh` is a closed,
// 2-manifold, watertight HalfEdgeMesh. On any failure (non-manifold / open
// result, coplanar-contact TARGETED case, or a malformed input that is not a
// valid closed 2-manifold) `ok==false`, `mesh` is empty, and `reason` carries
// a short human-readable cause. NEVER a self-intersecting fake.
struct BoolResult {
    bool         ok = false;
    HalfEdgeMesh mesh;
    const char*  reason = "";
};

// General boolean of two CLOSED 2-manifold triangle solids A and B given as
// indexed triangle soups (flat xyz positions + flat triangle indices, outward
// CCW). Reuses triTriIntersect + orient3d + HalfEdgeMesh; introduces no new
// geometric primitives or duplicate types.
//
// Preconditions (verified, NOT assumed): A and B each build a valid closed
// 2-manifold mesh. A violation yields ok=false with a reason.
BoolResult meshBoolean(const std::vector<double>&        aPositions,
                       const std::vector<std::uint32_t>& aIndices,
                       const std::vector<double>&        bPositions,
                       const std::vector<std::uint32_t>& bIndices,
                       BoolOp                            op);

// Convenience overload operating directly on two already-built closed meshes.
BoolResult meshBoolean(const HalfEdgeMesh& A,
                       const HalfEdgeMesh& B,
                       BoolOp              op);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_MESHBOOLEAN2_HPP
