// forge/native/csg/MeshCrossSection.hpp
//
// In-house 2D cross-section algebra — forge::native::csg::CrossSection.
//
// A CrossSection is a set of 2D polygons forming a (possibly multiply-connected)
// planar region: zero or more OUTER contours, each carrying zero or more HOLE
// contours. By convention every OUTER contour is wound COUNTER-CLOCKWISE
// (positive signed area) and every HOLE is wound CLOCKWISE (negative signed
// area). This is the same orientation rule OpenSCAD / Clipper / Manifold's
// CrossSection use, so a CrossSection produced here drops straight into a
// downstream "sweep / extrude a 2D profile to a solid" stage.
//
// WHAT IS REAL AND VALIDATED HERE (honest — Bible §0, KERNEL roadmap):
//   (1) Boolean ops union / intersection / difference of two CrossSections,
//       built on a robust polygon clipper. The clipper is a winding-number /
//       general-position arrangement: every directed edge of A is split at its
//       exact crossings with every directed edge of B (and vice-versa), each
//       resulting sub-edge is classified IN / OUT of the *other* operand by an
//       exact even-odd ray rule evaluated at the sub-edge midpoint, and the
//       surviving sub-edges are stitched back into closed contours. Output
//       contours are re-signed to the CCW-outer / CW-hole convention.
//   (2) Polygon OFFSET (Minkowski sum with a disc of radius d, d>0 grow / d<0
//       shrink): each edge is pushed out along its outward normal by |d| and
//       consecutive offset edges are joined by a MITER (sharp, with a miter
//       limit fallback to a bevel) or a ROUND (polygonal arc) join. The offset
//       result is returned as a CrossSection and self-cleaned through a union.
//
// EXACTNESS POSTURE (stated up front, do NOT overclaim):
//   The COMBINATORIAL backbone — which way an edge turns, whether two edges
//   cross, which side of an edge a test point lies on — is decided by the
//   re-derived adaptive-exact predicate forge::native::orient2d
//   (Predicates.hpp). So the topology of the boolean result (how many loops,
//   which sub-edges survive, nesting of holes) is robust-in-practice and cannot
//   be flipped by ordinary floating-point noise. The COORDINATES of new
//   intersection vertices are computed in plain double (the segment-segment
//   meet point). Degenerate intersections (a vertex of one polygon landing
//   exactly on an edge or vertex of the other) are SNAPPED to the shared vertex
//   so no zero-length / self-intersecting fake edge is ever emitted. This is the
//   same honest ceiling Manifold's CrossSection ships — robust predicates over
//   double coordinates, NOT a rational / EPECK exact-construction kernel.
//
// HONEST ENVELOPE (which polygon classes are robust — see MeshCrossSection.cpp
// and the gate report for the measured numbers):
//   * Simple polygons (no self-intersection), convex OR non-convex, with or
//     without holes, in GENERAL POSITION (no two input vertices coincide and no
//     vertex lies exactly on a non-incident edge): FULLY robust — boolean areas
//     match an independent grid/shoelace reference to clipper tolerance.
//   * Axis-aligned and arbitrarily-rotated rectangles, random simple polygons:
//     robust (this is the validated random-fuzz class).
//   * Shared-vertex / vertex-on-edge degeneracies: handled by exact-snap; the
//     clipper merges coincident vertices before stitching.
//   * NOT in this increment (reported ok=false, never a fake): polygons that are
//     themselves SELF-INTERSECTING on input; fully-overlapping coincident
//     COLLINEAR edge stacks of three or more operands at once; non-finite
//     coordinates. These return ok=false rather than a corrupt loop.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no third-
// party libs. Builds on forge/native/Predicates.hpp (exact orient2d),
// forge/native/geom/Geom.hpp (Point2, convexHull2D) and reuses Vec3 / the area
// idiom shared with forge/native/mesh/HalfEdgeMesh.hpp. We do NOT re-implement
// orient2d here — if Predicates.hpp were absent this file would fail to compile
// loudly rather than silently duplicate the predicate.

#ifndef FORGE_NATIVE_CSG_MESHCROSSSECTION_HPP
#define FORGE_NATIVE_CSG_MESHCROSSSECTION_HPP

#include <vector>
#include <cstddef>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"

namespace forge {
namespace native {
namespace csg {

// A single closed contour: an ordered ring of vertices (NOT repeating the first
// vertex at the end). A CCW (positive signed area) ring is an outer boundary; a
// CW (negative signed area) ring is a hole.
struct Contour {
    std::vector<geom::Point2> pts;
};

// Join style for the OFFSET operation.
enum class JoinType {
    MITER,  // sharp corner, falls back to a bevel past the miter limit
    ROUND   // convex corners replaced by a polygonal circular arc
};

// A 2D region = a list of contours under the CCW-outer / CW-hole convention.
// Multiple disjoint outer loops and nested holes are all allowed.
class CrossSection {
public:
    CrossSection() = default;

    // Construct from raw contours. They are taken as-is (the convention is the
    // caller's responsibility for the raw constructor); normalize() re-signs and
    // orders them into the canonical CCW-outer / CW-hole form.
    explicit CrossSection(std::vector<Contour> contours)
        : contours_(std::move(contours)) {}

    // Convenience: a single CCW outer contour with no holes.
    static CrossSection fromPolygon(const std::vector<geom::Point2>& ccwOuter);

    // ---- boolean ops ------------------------------------------------------
    // Each returns the boolean of *this and `other`. `ok` is set false (and the
    // result is empty) only for an UNSUPPORTED / degenerate input per the
    // header's honest envelope (e.g. a self-intersecting operand). A genuinely
    // empty boolean result (e.g. disjoint intersection) returns ok=true with an
    // empty CrossSection — empty is a valid answer, not a failure.
    CrossSection unionWith   (const CrossSection& other, bool& ok) const;
    CrossSection intersectWith(const CrossSection& other, bool& ok) const;
    CrossSection differenceWith(const CrossSection& other, bool& ok) const;

    // ---- offset -----------------------------------------------------------
    // Minkowski offset by signed distance `delta` (>0 grow, <0 shrink), with the
    // given corner join. `roundSegments` controls the polygon resolution of a
    // ROUND join over a full turn (>=4); ignored for MITER. `miterLimit` is the
    // max ratio of miter length to |delta| before a MITER corner bevels.
    // Returns the offset region; `ok` false on unsupported input.
    CrossSection offset(double delta, JoinType join, bool& ok,
                        int roundSegments = 32, double miterLimit = 2.0) const;

    // ---- queries ----------------------------------------------------------
    // Signed area summed over all contours (CCW outer adds, CW hole subtracts).
    // For a normalized region this is the true geometric area (>= 0).
    double area() const;

    // Re-sign and canonicalize contours into CCW-outer / CW-hole form by
    // even-odd nesting depth. Drops zero-area / degenerate contours.
    void normalize();

    const std::vector<Contour>& contours() const { return contours_; }
    bool empty() const { return contours_.empty(); }
    std::size_t contourCount() const { return contours_.size(); }

private:
    std::vector<Contour> contours_;
};

// ---------------------------------------------------------------------------
// Free helpers (exposed for the validation gate's independent cross-checks).
// ---------------------------------------------------------------------------

// Signed area of a single ring via the shoelace formula (CCW positive).
double signedAreaOf(const std::vector<geom::Point2>& ring);

// Is `q` strictly inside / on the boundary of a single simple ring? Uses an
// exact orient2d-based even-odd crossing rule for the boundary classification;
// the inside test is the standard crossing-number ray cast. Returns:
//   +1 strictly inside, 0 on boundary, -1 strictly outside.
int pointInRing(const geom::Point2& q, const std::vector<geom::Point2>& ring);

} // namespace csg
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_CSG_MESHCROSSSECTION_HPP
