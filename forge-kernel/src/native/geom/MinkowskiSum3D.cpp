// forge/native/geom/MinkowskiSum3D.cpp
//
// Implementation of forge::native::geom::minkowskiSum3D — see the header for the
// scope/honesty statement. The construction REUSES the validated
// forge::native::geom::convexHull3D; the combinatorial decisions are therefore
// driven by the adaptive-exact orient3d predicate. Nothing is re-derived here.

#include "forge/native/geom/MinkowskiSum3D.hpp"

#include <cstddef>

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Volume enclosed by a CCW-outward triangulated closed surface, via the
// divergence theorem: V = (1/6) * sum_f ( v0 . (v1 x v2) ). For an outward
// (CCW-seen-from-outside) winding this is positive. Robust enough for a metric
// (plain double); the COMBINATORIAL correctness lives in the hull, not here.
// ---------------------------------------------------------------------------
double hullVolume(const std::vector<Point3>& points,
                  const std::vector<std::array<int,3>>& faces) {
    double six_v = 0.0;
    for (const auto& f : faces) {
        const Point3& a = points[static_cast<std::size_t>(f[0])];
        const Point3& b = points[static_cast<std::size_t>(f[1])];
        const Point3& c = points[static_cast<std::size_t>(f[2])];
        // a . (b x c)
        const double cx = b.y * c.z - b.z * c.y;
        const double cy = b.z * c.x - b.x * c.z;
        const double cz = b.x * c.y - b.y * c.x;
        six_v += a.x * cx + a.y * cy + a.z * cz;
    }
    double v = six_v / 6.0;
    return v < 0.0 ? -v : v;  // magnitude: orientation sign is the hull's concern
}

// ---------------------------------------------------------------------------
// Minkowski sum of two point sets.
// ---------------------------------------------------------------------------
MinkowskiResult minkowskiSum3D(const std::vector<Point3>& A,
                               const std::vector<Point3>& B,
                               bool aConvex,
                               bool bConvex) {
    MinkowskiResult out;

    // The Minkowski sum with an empty set is the empty set. Report honestly;
    // do NOT fabricate any points to make a downstream test pass.
    if (A.empty() || B.empty()) {
        out.reason = "empty input set (Minkowski sum is empty)";
        return out;
    }

    // Form ALL pairwise sums a_i + b_j. For convex inputs the convex hull of
    // these is exactly the boundary of A (+) B. (Interior/redundant points are
    // dropped by convexHull3D, so passing the full vertex sets is fine.)
    out.points.reserve(A.size() * B.size());
    for (const Point3& a : A) {
        for (const Point3& b : B) {
            out.points.push_back(Point3{a.x + b.x, a.y + b.y, a.z + b.z});
        }
    }

    // The result is the TRUE Minkowski sum only when both inputs are convex;
    // otherwise it is the convex OUTER bound (hull-of-sums). We carry that fact
    // honestly rather than claiming a non-convex sum was computed.
    out.exact = aConvex && bConvex;

    // Take the 3D convex hull of the summed cloud (reuses the validated, robust
    // incremental hull — the combinatorial decisions are adaptive-exact).
    Hull3D hull = convexHull3D(out.points);
    if (!hull.ok) {
        // Degenerate summed set (e.g. both inputs collinear/coplanar so the sum
        // is lower-dimensional). Surface the hull's own reason; return ok=false.
        out.faces.clear();
        out.reason = hull.reason;
        out.ok = false;
        return out;
    }

    out.faces = std::move(hull.faces);
    out.ok = true;
    return out;
}

} // namespace geom
} // namespace native
} // namespace forge
