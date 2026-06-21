// forge/native/csg/Extrude.hpp
//
// In-house CSG primitive builder — forge::native::csg::extrude.
//
// Sweep a closed 2D profile (a single outer boundary loop, plus zero or more
// hole loops) linearly along a plane normal to produce a WATERTIGHT,
// 2-manifold solid as a forge::native::mesh::HalfEdgeMesh. The result is the
// "prism" with the profile as its base cross-section:
//
//     * TOP cap    — the profile triangulated, lifted to height `height`,
//                    wound so its outward normal points +normal.
//     * SIDE WALLS  — a quad (two triangles) per profile boundary edge,
//                    connecting the bottom loop to the top loop, outward-facing.
//     * BOTTOM cap  — the same triangulation at height 0, wound REVERSED so its
//                    outward normal points -normal.
//
// SCOPE (honest — Bible §0 / no-fakes rule):
//   What is REAL and VALIDATED in extrude_test.cpp:
//     (1) Cap triangulation by EAR CLIPPING with HOLE support. Holes are merged
//         into the outer boundary via bridge edges (the classic "find a mutually
//         visible bridge vertex" technique) so a single simple polygon with no
//         holes is triangulated. Ear validity (convex + empty) is decided with
//         the ROBUST exact predicate forge::native::orient2d — the combinatorial
//         convexity/containment test cannot be corrupted by rounding.
//     (2) Side-wall + bottom-cap generation with GLOBALLY CONSISTENT winding, so
//         HalfEdgeMesh::buildFromSoup accepts it (no duplicated directed edge)
//         and the audit reports twinsConsistent && manifold && watertight.
//     (3) signedVolume == (outerArea - sum(holeArea)) * height to 1e-9.
//
//   HONEST LIMITS (return ok=false, NEVER a self-intersecting fake):
//     * The profile loops must be SIMPLE (non-self-intersecting) and the holes
//       must lie strictly inside the outer loop and not touch each other or the
//       outer boundary. Self-intersecting / touching / nested-into-each-other
//       loops are rejected (ok=false) rather than silently producing garbage.
//     * `height` must be non-zero and `plane.normal` must be a non-degenerate
//       direction; a zero/near-zero normal or zero height yields ok=false.
//     * Collinear-only or fewer-than-3-unique-vertex outer loops yield ok=false.
//     * The ear-clip is O(n^2); intended for the part-scale profiles a CAD sketch
//       produces, not million-vertex contours.
//
// CONVENTIONS: pure C++20, standard library only. NO OCCT, NO WASM, NO third
// party. Builds strictly by #include on the parallel native increments:
//     forge/native/Predicates.hpp        (exact orient2d)
//     forge/native/geom/Geom.hpp         (Point2)
//     forge/native/mesh/HalfEdgeMesh.hpp (Vec3, HalfEdgeMesh)
// We deliberately do NOT re-implement those primitives here.

#ifndef FORGE_NATIVE_CSG_EXTRUDE_HPP
#define FORGE_NATIVE_CSG_EXTRUDE_HPP

#include <vector>

#include "forge/native/geom/Geom.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace csg {

// The plane the profile is drawn on, expressed in 3D. `origin` is a point on
// the plane; the profile's local (x,y) are mapped onto the orthonormal frame
// (u, v) and the sweep runs along `normal`. `normal` need not be unit (it is
// normalised internally); `u`/`v` are derived from `normal` when not supplied.
//
// For the common "sketch on the XY plane, extrude up +Z" case, leave everything
// default: origin = (0,0,0), normal = +Z, u = +X, v = +Y.
struct Plane {
    mesh::Vec3 origin{0.0, 0.0, 0.0};
    mesh::Vec3 normal{0.0, 0.0, 1.0};
    // In-plane axes that the profile's local (x, y) map to. If left as the zero
    // vector, an orthonormal (u, v) is derived from `normal` automatically.
    mesh::Vec3 u{0.0, 0.0, 0.0};
    mesh::Vec3 v{0.0, 0.0, 0.0};
};

// A 2D profile: one outer boundary loop plus zero or more hole loops, each a
// closed polygon given as an ordered vertex list (the closing edge back to the
// first vertex is implicit; do NOT repeat the first vertex at the end).
//
// Winding is normalised internally — the outer loop is forced CCW and each hole
// CW — so the caller may supply either orientation.
struct Profile2D {
    std::vector<geom::Point2>              outer;
    std::vector<std::vector<geom::Point2>> holes;
};

// Result of an extrude. On success `ok==true` and `mesh` is a closed 2-manifold
// solid. On any rejected / degenerate input `ok==false`, `mesh` is empty, and
// `reason` explains why (for diagnostics / honest failure).
struct ExtrudeResult {
    bool                 ok{false};
    mesh::HalfEdgeMesh   mesh;
    const char*          reason{""};
    // Diagnostics (filled on success): the unsigned cap area (outer - holes) and
    // the resulting signed volume, both for the caller / tests to cross-check.
    double               capArea{0.0};
    double               volume{0.0};
};

// Sweep `profile` along `plane.normal` for distance `height` (signed) and return
// a watertight solid. See the scope/limits comment above for the honest
// envelope of accepted inputs.
ExtrudeResult extrude(const Profile2D& profile, double height, const Plane& plane);

// Convenience overload: extrude on the XY plane, sweep +Z.
ExtrudeResult extrude(const Profile2D& profile, double height);

} // namespace csg
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_CSG_EXTRUDE_HPP
