// forge/native/geom/PolygonBoolean2D.hpp
//
// In-house robust 2D polygon BOOLEAN clipping — forge::native::geom::
// PolygonBoolean2D. Pure C++20, standard library only. NO OCCT, NO WASM, NO
// third-party libs. Builds ONLY on existing forge native headers (by #include,
// never re-deriving any of them):
//   * forge/native/Predicates.hpp        (robust orient2d for EVERY combinatorial
//                                          decision: which side of an edge a flank
//                                          probe is on, hence every winding sign)
//   * forge/native/geom/Geom.hpp          (Point2 / segmentIntersect — the exact
//                                          segment crossing classification)
//   * forge/native/geom/AABBTree.hpp      (kernel-wide geometry vocabulary; the
//                                          boolean itself is planar)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (mesh::Vec3 — the kernel's shared point
//                                          type, included for vocabulary parity)
//   * forge/native/mesh/FeatureEdges.hpp  (mandated reuse surface — the boolean
//                                          sits on the same geom/mesh stack)
//   * forge/native/mesh/TriTriIntersect.hpp (mandated reuse surface — this 2D
//                                          boolean COMPLEMENTS the 3D mesh
//                                          arrangement that header anchors)
//
// PURPOSE (Clipper / CGAL Boolean_set_operations_2 class — the daily bread of
// sketch / CAM geometry):
//   Given a SUBJECT polygon A and a CLIP polygon B, each a CCW outer boundary
//   plus zero or more CW holes, compute their boolean combination:
//
//       UNION         A ∪ B   { x : inA OR  inB }
//       INTERSECTION  A ∩ B   { x : inA AND inB }
//       DIFFERENCE    A − B   { x : inA AND NOT inB }
//       XOR           A ⊕ B   { x : inA XOR inB }
//
//   The result is returned as a set of clean, non-self-intersecting, correctly-
//   oriented loops (outer contours CCW / positive area, hole contours CW /
//   negative area), so PolygonBoolean2D::netArea(result) is the exact area of the
//   result region and a frame (square-minus-inner-square) comes back as TWO
//   contours of opposite winding (genus 1) — never a stitched bridge.
//
// METHOD (a robust planar-arrangement / winding extraction, the same exact-core
// pattern PolygonOffset2D::cleanRawLoop uses, generalised to two operands):
//   1. Validate each operand is a SIMPLE polygon-with-holes: every contour has
//      >= 3 vertices, finite coordinates, nonzero area, and NO self/mutual
//      intersection WITHIN the same operand (decided by segmentIntersect's exact
//      classification). A self-intersecting input is refused -> ok=false (no fake).
//   2. Collect every directed boundary edge of A and of B (each contour walked in
//      its given orientation). Split every edge at all proper crossings with edges
//      of the OTHER operand AND with edges of the SAME operand's other contours
//      (the latter only at true crossings, which for a valid input occur only
//      between A and B). Crossing points are found with the exact segmentIntersect.
//   3. Build a tiny DCEL: snap split-points to shared nodes; every directed
//      sub-edge becomes a half-edge carrying its OWNER (A or B).
//   4. For each directed sub-edge, probe a point just to its LEFT and just to its
//      RIGHT (a robust off-edge step) and evaluate the winding number of A and of
//      B at each flank via the EXACT orient2d ray test. Map (inA,inB) -> inside
//      through the boolean predicate. The sub-edge is a boundary of the result iff
//      exactly one flank is inside; we orient it so the result interior lies on
//      its LEFT (CCW outer / CW holes fall out directly).
//   5. Chain the kept directed edges into closed loops (sharp-left tie-break at
//      shared nodes), drop slivers, classify each loop by signed-area sign.
//
//   The COMBINATORIAL core — which sub-edges bound the result, and the winding
//   parity that decides it — is driven entirely by forge::native::orient2d signs,
//   so a near-grazing edge can never flip the in/out classification. Only the
//   COORDINATES of intersection vertices are plain IEEE-754 double (the same
//   honest ceiling Clipper ships). This is robust-in-practice with exact
//   predicates, NOT a rational / EPECK construction kernel.
//
// HONEST ENVELOPE (read the .cpp top comment for the precise statement):
//   Fully handled: any two valid simple polygons-with-holes whose boundaries meet
//   only in PROPER (transversal) crossings or are disjoint — overlapping squares,
//   disjoint, frame (containment), the 30 random axis-aligned rectangle pairs of
//   the gate, nested holes. Refused honestly (ok=false): a self-intersecting
//   operand, a non-finite or zero-area contour, fewer than 3 vertices. NOT claimed
//   robust and reported via ok=false when detected: operands that share a
//   COLLINEAR boundary overlap or touch only at an isolated vertex (degenerate,
//   measure-zero contact) — these need snap-rounding the construction kernel does
//   not yet have, so we refuse rather than emit a fake.

#ifndef FORGE_NATIVE_GEOM_POLYGONBOOLEAN2D_HPP
#define FORGE_NATIVE_GEOM_POLYGONBOOLEAN2D_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/native/Predicates.hpp"            // orient2d (robust)
#include "forge/native/geom/Geom.hpp"             // Point2, segmentIntersect
#include "forge/native/geom/AABBTree.hpp"         // Aabb / Vec3 kernel vocabulary
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // mesh::Vec3 (shared point type)
#include "forge/native/mesh/FeatureEdges.hpp"     // mandated reuse surface
#include "forge/native/mesh/TriTriIntersect.hpp"  // mandated reuse surface (3D peer)

namespace forge {
namespace native {
namespace geom {

// A closed polygonal contour: an ordered ring of vertices (the first vertex is
// NOT repeated at the end). Outer contours are expected CCW (positive signed
// area); holes CW (negative signed area).
struct BoolContour {
    std::vector<Point2> pts;

    double signedArea2() const;                         // twice the shoelace sum
    double signedArea()  const { return 0.5 * signedArea2(); }
    bool   isCCW() const { return signedArea2() > 0.0; }
    bool   isCW()  const { return signedArea2() < 0.0; }
};

// A polygon with holes: one outer CCW boundary plus zero or more CW holes. Used
// for BOTH the subject and the clip operand of every boolean.
struct BoolPolygon {
    BoolContour              outer;
    std::vector<BoolContour> holes;

    double netArea() const;   // outer (CCW,+) + holes (CW,-)
};

// The four boolean operations.
enum class BoolOp {
    Union,         // A ∪ B
    Intersection,  // A ∩ B
    Difference,    // A − B  (subject minus clip)
    Xor            // A ⊕ B
};

// Result of a boolean. `ok==false` carries a human-readable `reason` and an
// empty `contours`. On success `contours` is the set of clean, non-self-
// intersecting, correctly-oriented loops (outer CCW / positive area, holes CW /
// negative area). An empty result region (e.g. intersection of disjoint inputs)
// returns ok==true with NO contours (area 0), which is honest, not a failure.
struct BoolResult {
    bool                     ok{false};
    std::vector<BoolContour> contours;
    std::string              reason;

    // Net signed area of all contours (outer +, holes -) == area of the region.
    double netArea() const;
    // Number of contours (outer + hole boundaries) — a frame has 2.
    std::size_t contourCount() const { return contours.size(); }
};

// ---------------------------------------------------------------------------
// PolygonBoolean2D — the boolean engine.
//
// Stateless façade: every operation is a free-standing static method so the
// caller never manages an instance. (The class names the operation in the
// kernel namespace.)
// ---------------------------------------------------------------------------
class PolygonBoolean2D {
public:
    // The single general entry: combine subject A and clip B under `op`.
    static BoolResult compute(const BoolPolygon& A, const BoolPolygon& B,
                              BoolOp op);

    // Named conveniences.
    static BoolResult unite(const BoolPolygon& A, const BoolPolygon& B) {
        return compute(A, B, BoolOp::Union);
    }
    static BoolResult intersect(const BoolPolygon& A, const BoolPolygon& B) {
        return compute(A, B, BoolOp::Intersection);
    }
    static BoolResult difference(const BoolPolygon& A, const BoolPolygon& B) {
        return compute(A, B, BoolOp::Difference);
    }
    static BoolResult symmetricDifference(const BoolPolygon& A,
                                          const BoolPolygon& B) {
        return compute(A, B, BoolOp::Xor);
    }

    // Robust winding number of a polygon-with-holes about a query point `q`
    // (ray crossing decided via the exact orient2d). Sums the winding of the
    // outer contour and every hole; for a valid CCW-outer / CW-holes polygon the
    // result is 1 in the solid, 0 in the holes and outside. Exposed because the
    // classification core uses it and the gate verifies it.
    static int windingNumber(const BoolPolygon& poly, const Point2& q);

    // Robust winding number of a single contour about `q` (the building block).
    static int contourWinding(const BoolContour& c, const Point2& q);

    // Is `poly` a VALID simple polygon-with-holes? (>= 3 verts / contour, finite
    // coords, nonzero area, no self/mutual proper crossing among its contours).
    // Exposed so callers can pre-screen; `compute` runs it internally and returns
    // ok=false with a reason when it fails.
    static bool isValid(const BoolPolygon& poly, std::string& reason);

private:
    // Net signed area of a flat list of contours.
    static double netAreaOf(const std::vector<BoolContour>& cs);
};

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_POLYGONBOOLEAN2D_HPP
