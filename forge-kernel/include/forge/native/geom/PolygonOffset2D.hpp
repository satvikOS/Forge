// forge/native/geom/PolygonOffset2D.hpp
//
// In-house robust 2D polygon offset (CAM contour / 2D Minkowski-with-a-disk) —
// forge::native::geom::PolygonOffset2D. Pure C++20, standard library only.
// NO OCCT, NO WASM, NO third-party libs. Builds ONLY on existing forge headers:
//   * forge/native/Predicates.hpp        (robust orient2d for the combinatorial
//                                          self-intersection / winding decisions)
//   * forge/native/geom/Geom.hpp         (Point2 / segmentIntersect)
//   * forge/native/geom/AABBTree.hpp     (Vec3/Aabb interop — included for the
//                                          kernel-wide geometry vocabulary it
//                                          shares; the offset itself is planar)
//   * forge/native/mesh/HalfEdgeMesh.hpp (Vec3 — the kernel's shared point type)
//
// PURPOSE (Clipper/CGAL Minkowski-offset class, the daily bread of CAM):
//   Offset a SIMPLE closed polygon — a CCW outer boundary plus zero or more CW
//   holes — outward (d>0) or inward (d<0) by a signed distance d. Each edge is
//   pushed |d| along its OUTWARD normal; CONVEX corners are bridged either by a
//   segmented circular arc (the Minkowski-with-a-disk join, default) or by a
//   single MITER vertex; REFLEX corners self-overlap and that overlap is removed
//   so the result is a set of clean, non-self-intersecting loops. A feature that
//   an inward offset shrinks past zero is DROPPED (honestly), and the dropped
//   count is reported — we never emit a collapsed / inverted ghost loop.
//
// THE LAW THIS VALIDATES AGAINST (printed-seed gate, polygonoffset2d_test.cpp):
//   A CCW square of side s offset OUTWARD by d with ROUND joins has area exactly
//
//       (s + 2d)^2 - (4 - pi) d^2  =  s^2 + 4 s d + pi d^2
//
//   (the grown square minus the four corner squares plus the four quarter-disks
//   that round them off), recovered to within the arc-segmentation tolerance. A
//   CW hole shrinks by the SAME law (its enclosed void grows the solid loses).
//   An INWARD offset by d reduces the solid area by s^2 - (s-2d)^2 + ... i.e. by
//   the same 4 s d - pi d^2 first-order law, and an inward offset that exceeds
//   the inradius collapses the loop -> dropped + reported.
//
// ROBUSTNESS POSTURE (honest — Bible §0):
//   The EDGE displacement and the arc tessellation are plain IEEE-754 double
//   (this is a geometric construction, not an exact-arithmetic one — the same
//   honest ceiling Clipper ships). What IS exact here is the COMBINATORIAL
//   cleanup: which raw-offset loops survive is decided by the signed-area sign
//   and a robust point-in-polygon winding number whose ray-crossing tests use
//   forge::native::orient2d, so a reflex notch can never be mis-pruned by
//   rounding. Degenerate / unsupported input (open loop, < 3 vertices, repeated
//   coincident vertices producing a zero-length edge, non-finite coordinate,
//   |d| not finite) is reported via ok=false — never papered over, 0 FAKES.

#ifndef FORGE_NATIVE_GEOM_POLYGONOFFSET2D_HPP
#define FORGE_NATIVE_GEOM_POLYGONOFFSET2D_HPP

#include <cstddef>
#include <string>
#include <vector>

#include "forge/native/Predicates.hpp"          // orient2d (robust)
#include "forge/native/geom/Geom.hpp"            // Point2, segmentIntersect
#include "forge/native/geom/AABBTree.hpp"        // Aabb / Vec3 kernel vocabulary
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // mesh::Vec3 (shared point type)

namespace forge {
namespace native {
namespace geom {

// A closed polygonal loop: an ordered ring of vertices (NOT repeating the first
// at the end). Outer boundaries are expected CCW (positive signed area); holes
// CW (negative signed area). `signedArea()` lets the caller / engine classify.
struct Loop2 {
    std::vector<Point2> pts;

    // Twice the signed area (the shoelace sum). > 0 CCW, < 0 CW, 0 degenerate.
    double signedArea2() const;
    double signedArea() const { return 0.5 * signedArea2(); }
    bool   isCCW()  const { return signedArea2() >  0.0; }
    bool   isCW()   const { return signedArea2() <  0.0; }
};

// A polygon with holes: one outer CCW boundary and zero or more CW holes. The
// NET (solid) area is outer.area + sum(hole.area) since holes are CW (negative).
struct Polygon2 {
    Loop2 outer;
    std::vector<Loop2> holes;

    double netArea() const;   // outer (CCW,+) + holes (CW,-)
};

// How a convex corner of the offset is bridged.
enum class JoinType {
    Round,   // segmented circular arc (Minkowski-with-a-disk; default)
    Miter    // single mitred vertex, capped by miterLimit (falls back to Round)
};

// Tunables for an offset operation.
struct OffsetOptions {
    JoinType join{JoinType::Round};
    // Maximum chord-deviation (sagitta) of a round-join arc, in model units.
    // The arc is segmented so no segment deviates from the true circle by more
    // than this; smaller -> closer to the exact pi*d^2 corner area. Must be > 0.
    double   arcTolerance{0.0};   // 0 => auto = max(1e-6, |d|*1e-3)
    // Miter limit as a multiple of |d|: if a mitred corner would stick out
    // farther than miterLimit*|d|, that corner is rounded instead (Clipper sense).
    double   miterLimit{2.0};
};

// Result of an offset. `ok==false` carries a human-readable `reason`; on success
// `loops` is a set of clean, non-self-intersecting, correctly-oriented loops
// (outer CCW, holes CW). `droppedLoops` counts features the offset collapsed
// (only possible for an inward offset) — reported, never silently emitted.
struct OffsetResult {
    bool                ok{false};
    std::vector<Loop2>  loops;
    std::size_t         droppedLoops{0};
    std::string         reason;

    // TRUE iff the result was recovered by the sub-tolerance retry described at
    // offsetLoop below (the first attempt collapsed; a ring with its
    // below-arcTolerance vertices removed did not). Reported, never hidden: the
    // caller can tell a first-attempt answer from a recovered one. Purely
    // informational -- `ok` and `loops` mean exactly what they always did.
    bool                relaxedCollinear{false};

    // Convenience: net signed area of all surviving loops.
    double netArea() const;
};

// ---------------------------------------------------------------------------
// PolygonOffset2D — the offset engine.
//
// Stateless façade; everything is in the free-standing static methods so the
// caller never needs to manage an instance. (A class is used purely to give the
// operation a single, discoverable name in the kernel namespace.)
// ---------------------------------------------------------------------------
class PolygonOffset2D {
public:
    // Offset a single closed loop by signed distance d (outward = grow the side
    // the loop's interior is on; for a CCW loop d>0 grows it, d<0 shrinks it; a
    // CW hole is the mirror). Returns the cleaned surviving loop(s) — a single
    // convex loop yields one; a concave loop pinched by an inward offset may
    // split into several, or collapse entirely (droppedLoops>0).
    //
    // SUB-TOLERANCE RETRY (added 2026-08-30, measured). If — and ONLY if — the
    // first attempt collapses, the loop is retried once with the vertices that
    // lie on the chord of their neighbours to within the SAME arcTolerance this
    // call already tessellates its own round joins to removed, and the retry's
    // answer is returned if it survives (`relaxedCollinear` says so). Nothing on
    // the succeeding path is touched: an input that produced loops before
    // produces the identical loops now. It exists because a ring sampled off a
    // near-straight spline carries micro-facets whose offset lines cross at
    // near-zero angle, and cleanRawLoop's arrangement then welds one geometric
    // crossing into two nodes (measured 4e-7 apart on a 218-unit ring against a
    // 2.2e-7 weld tolerance), leaving a boundary that is unbalanced at 60 nodes
    // and cannot be chained — so a raw offset of demonstrably CORRECT area was
    // being reported as a total collapse. See reports/corpus_ab.
    static OffsetResult offsetLoop(const Loop2& loop, double d,
                                   const OffsetOptions& opts = {});

    // Offset a polygon-with-holes by signed distance d. d>0 grows the solid
    // (outer outward, holes inward — i.e. holes shrink); d<0 shrinks the solid.
    // Holes that collapse and outer loops that collapse are both counted in
    // droppedLoops. The result's loops carry the correct orientation so that
    // OffsetResult::netArea() is the offset solid's area.
    static OffsetResult offsetPolygon(const Polygon2& poly, double d,
                                      const OffsetOptions& opts = {});

    // Robust point-in-loop winding test (ray crossing decided via orient2d).
    // Returns the winding number of `loop` about `q` (0 == outside a simple
    // loop). Exposed because the cleanup uses it and the gate verifies it.
    static int windingNumber(const Loop2& loop, const Point2& q);

private:
    // Build the RAW offset of one loop (per-edge displacement + corner joins),
    // BEFORE self-overlap cleanup. The raw loop may self-intersect.
    static Loop2 rawOffset(const Loop2& loop, double signedDist,
                           const OffsetOptions& opts);

    // Decompose a (possibly self-intersecting) raw loop into simple loops and
    // keep only the valid ones via non-zero-winding region extraction.
    // `expectedSign` (+1 / -1) is the orientation every surviving loop must have
    // (it equals the SOURCE loop's orientation — the offset preserves it). A
    // face survives iff its winding number w.r.t. the source-oriented raw ring
    // has that sign and magnitude >= 1. `droppedAll` is set true if EVERY face
    // was pruned (an inward offset that collapsed the feature).
    static std::vector<Loop2> cleanRawLoop(const Loop2& raw,
                                           double expectedSign,
                                           bool& droppedAll);
};

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_POLYGONOFFSET2D_HPP
