// forge/native/geom/Geom.cpp
//
// Implementation of forge::native::geom — see Geom.hpp for the scope/honesty
// statement. All combinatorial decisions go through the adaptive-exact
// predicates in forge/native/Predicates.hpp; nothing here re-derives them.

#include "forge/native/geom/Geom.hpp"

#include <algorithm>  // std::sort, std::min, std::max
#include <cmath>      // std::fabs
#include <map>
#include <utility>

namespace forge {
namespace native {
namespace geom {

// ===========================================================================
// Shared small helpers
// ===========================================================================
namespace {

// Lexicographic order for 2D points (x then y). Exact double comparison; used
// only to canonicalise input ordering, not to make geometric decisions.
inline bool lexLess(const Point2& a, const Point2& b) {
    if (a.x != b.x) return a.x < b.x;
    return a.y < b.y;
}
inline bool sameP2(const Point2& a, const Point2& b) {
    return a.x == b.x && a.y == b.y;
}

// orient2d wrapper on Point2.
inline Sign orient(const Point2& a, const Point2& b, const Point2& c) {
    return orient2d(a.x, a.y, b.x, b.y, c.x, c.y);
}

// Is point q on the closed segment p-r, GIVEN that p, q, r are known collinear
// (orient2d(p,q,r) == ZERO)? Pure bounding-box containment, exact on doubles.
inline bool onSegmentCollinear(const Point2& p, const Point2& q,
                               const Point2& r) {
    return std::min(p.x, r.x) <= q.x && q.x <= std::max(p.x, r.x) &&
           std::min(p.y, r.y) <= q.y && q.y <= std::max(p.y, r.y);
}

} // namespace

// ===========================================================================
// (1) 2D convex hull — Andrew's monotone chain, robust orient2d.
// ===========================================================================
//
// Build the lower then the upper hull. A left turn (CCW) is required at every
// hull vertex, so we pop while the last turn is NOT strictly positive
// (orient2d != POSITIVE catches both clockwise AND collinear), which is exactly
// what excludes interior and collinear-boundary points.
std::vector<Point2> convexHull2D(const std::vector<Point2>& ptsIn) {
    // 1. Copy, sort lexicographically, remove exact duplicates.
    std::vector<Point2> pts = ptsIn;
    std::sort(pts.begin(), pts.end(), lexLess);
    pts.erase(std::unique(pts.begin(), pts.end(), sameP2), pts.end());

    const int n = static_cast<int>(pts.size());
    if (n <= 2) {
        // 0, 1, or 2 unique points: the hull is exactly those points.
        return pts;
    }

    std::vector<Point2> hull;
    hull.reserve(static_cast<size_t>(2 * n));

    // Lower hull (left to right).
    for (int i = 0; i < n; ++i) {
        while (hull.size() >= 2 &&
               orient(hull[hull.size() - 2], hull[hull.size() - 1], pts[i]) !=
                   Sign::POSITIVE) {
            hull.pop_back();
        }
        hull.push_back(pts[i]);
    }

    // Upper hull (right to left). 't' marks the floor below which we must not
    // pop (keeps the lower hull intact).
    const size_t lowerFloor = hull.size() + 1;
    for (int i = n - 2; i >= 0; --i) {
        while (hull.size() >= lowerFloor &&
               orient(hull[hull.size() - 2], hull[hull.size() - 1], pts[i]) !=
                   Sign::POSITIVE) {
            hull.pop_back();
        }
        hull.push_back(pts[i]);
    }

    // The last point equals the first (closing point); drop it so the result is
    // a clean, non-repeating CCW vertex list.
    if (!hull.empty()) hull.pop_back();

    // Degenerate all-collinear case: the monotone chain above can collapse to a
    // single point if every input was collinear (every turn was ZERO). Detect
    // and return the two extreme endpoints instead.
    if (hull.size() < 3) {
        // All collinear (or coincident already handled). Return the two
        // lexicographic extremes (first and last unique points).
        std::vector<Point2> seg;
        seg.push_back(pts.front());
        if (!sameP2(pts.front(), pts.back())) seg.push_back(pts.back());
        return seg;
    }

    return hull;
}

// ===========================================================================
// (3) 2D segment–segment intersection — orientation-based, exact class.
// ===========================================================================
SegIntersection segmentIntersect(const Point2& p1, const Point2& p2,
                                 const Point2& p3, const Point2& p4) {
    SegIntersection out;

    const Sign d1 = orient(p3, p4, p1);  // p1 vs line p3p4
    const Sign d2 = orient(p3, p4, p2);  // p2 vs line p3p4
    const Sign d3 = orient(p1, p2, p3);  // p3 vs line p1p2
    const Sign d4 = orient(p1, p2, p4);  // p4 vs line p1p2

    // ---- Proper crossing: each segment strictly straddles the other's line.
    if (d1 != Sign::ZERO && d2 != Sign::ZERO &&
        d3 != Sign::ZERO && d4 != Sign::ZERO &&
        d1 != d2 && d3 != d4) {
        out.relation = SegRelation::PROPER_CROSS;
        // Intersection point (best-effort double; classification above is the
        // exact part). Denominator is nonzero because the segments cross.
        const double a1 = p2.y - p1.y;
        const double b1 = p1.x - p2.x;
        const double c1 = a1 * p1.x + b1 * p1.y;
        const double a2 = p4.y - p3.y;
        const double b2 = p3.x - p4.x;
        const double c2 = a2 * p3.x + b2 * p3.y;
        const double det = a1 * b2 - a2 * b1;
        out.point.x = (b2 * c1 - b1 * c2) / det;
        out.point.y = (a1 * c2 - a2 * c1) / det;
        return out;
    }

    // ---- Collinear cases: at least one segment lies on the other's line.
    // Both endpoints of one segment collinear with the other means the two
    // segments are collinear (when d1==d2==ZERO the line p3p4 contains p1,p2).
    const bool collinear =
        (d1 == Sign::ZERO && d2 == Sign::ZERO &&
         d3 == Sign::ZERO && d4 == Sign::ZERO);

    if (collinear) {
        // Project onto the dominant axis to find overlap of [p1,p2] and [p3,p4].
        // Order each segment's endpoints, then intersect the 1D intervals using
        // the actual 2D coordinates (they are collinear, so axis projection is
        // monotone). We compare with a parametric scalar along p1->p2 direction.
        // Simpler: compute overlap via per-axis interval intersection; since the
        // points are exactly collinear, the box intersection IS the overlap.
        const double aMinX = std::min(p1.x, p2.x), aMaxX = std::max(p1.x, p2.x);
        const double aMinY = std::min(p1.y, p2.y), aMaxY = std::max(p1.y, p2.y);
        const double bMinX = std::min(p3.x, p4.x), bMaxX = std::max(p3.x, p4.x);
        const double bMinY = std::min(p3.y, p4.y), bMaxY = std::max(p3.y, p4.y);

        const double loX = std::max(aMinX, bMinX), hiX = std::min(aMaxX, bMaxX);
        const double loY = std::max(aMinY, bMinY), hiY = std::min(aMaxY, bMaxY);

        if (loX > hiX || loY > hiY) {
            out.relation = SegRelation::DISJOINT;
            return out;
        }

        // Overlap endpoints. Because the segments are collinear, the overlap is
        // the box [lo,hi] on whichever axis the line is not constant in.
        Point2 oa, ob;
        // Choose the axis with larger span to parametrise the overlap endpoints.
        const bool useX = (aMaxX - aMinX) >= (aMaxY - aMinY);
        if (useX) {
            oa.x = loX; ob.x = hiX;
            // recover y on the line p1->p2
            if (p2.x != p1.x) {
                const double t0 = (loX - p1.x) / (p2.x - p1.x);
                const double t1 = (hiX - p1.x) / (p2.x - p1.x);
                oa.y = p1.y + t0 * (p2.y - p1.y);
                ob.y = p1.y + t1 * (p2.y - p1.y);
            } else {
                oa.y = loY; ob.y = hiY;
            }
        } else {
            oa.y = loY; ob.y = hiY;
            if (p2.y != p1.y) {
                const double t0 = (loY - p1.y) / (p2.y - p1.y);
                const double t1 = (hiY - p1.y) / (p2.y - p1.y);
                oa.x = p1.x + t0 * (p2.x - p1.x);
                ob.x = p1.x + t1 * (p2.x - p1.x);
            } else {
                oa.x = loX; ob.x = hiX;
            }
        }

        if (sameP2(oa, ob)) {
            // Touch at a single collinear point (e.g. abutting end-to-end).
            out.relation = SegRelation::ENDPOINT_TOUCH;
            out.point = oa;
            return out;
        }
        out.relation = SegRelation::COLLINEAR_OVERLAP;
        out.overlapA = oa;
        out.overlapB = ob;
        out.point = oa;  // representative
        return out;
    }

    // ---- Touching at an endpoint (one endpoint lies ON the other segment).
    // Exactly one of the orientation values is ZERO AND that endpoint is within
    // the other segment's bounds. Check each candidate.
    if (d1 == Sign::ZERO && onSegmentCollinear(p3, p1, p4)) {
        out.relation = SegRelation::ENDPOINT_TOUCH; out.point = p1; return out;
    }
    if (d2 == Sign::ZERO && onSegmentCollinear(p3, p2, p4)) {
        out.relation = SegRelation::ENDPOINT_TOUCH; out.point = p2; return out;
    }
    if (d3 == Sign::ZERO && onSegmentCollinear(p1, p3, p2)) {
        out.relation = SegRelation::ENDPOINT_TOUCH; out.point = p3; return out;
    }
    if (d4 == Sign::ZERO && onSegmentCollinear(p1, p4, p2)) {
        out.relation = SegRelation::ENDPOINT_TOUCH; out.point = p4; return out;
    }

    out.relation = SegRelation::DISJOINT;
    return out;
}

// ===========================================================================
// (2) 3D convex hull — incremental, robust orient3d, for small point sets.
// ===========================================================================
namespace {

inline Sign orient3(const Point3& a, const Point3& b,
                    const Point3& c, const Point3& d) {
    return orient3d(a.x, a.y, a.z, b.x, b.y, b.z,
                    c.x, c.y, c.z, d.x, d.y, d.z);
}

inline bool sameP3(const Point3& a, const Point3& b) {
    return a.x == b.x && a.y == b.y && a.z == b.z;
}

struct Face {
    int a, b, c;          // indices into the point array, CCW seen from outside
    bool alive{true};
};

} // namespace

Hull3D convexHull3D(const std::vector<Point3>& ptsIn) {
    Hull3D result;

    // Dedup exact-coincident points while remembering original indices is not
    // required: coincident points are simply never added to the hull (orient3d
    // treats them as on every plane). We keep the original array for indexing.
    const std::vector<Point3>& P = ptsIn;
    const int n = static_cast<int>(P.size());
    if (n < 4) { result.reason = "fewer than 4 points"; return result; }

    // --- Find an initial non-degenerate tetrahedron. ---
    // i0,i1: two distinct points.
    int i0 = 0, i1 = -1;
    for (int i = 1; i < n; ++i) {
        if (!sameP3(P[i0], P[i])) { i1 = i; break; }
    }
    if (i1 < 0) { result.reason = "all points coincident"; return result; }

    // i2: not collinear with i0,i1. Collinearity in 3D: the three points are
    // collinear iff they are coplanar with EVERY other point AND the triangle
    // area is zero; we use the cross-product magnitude (zero => collinear).
    auto cross = [](const Point3& u, const Point3& v) {
        return Point3{u.y * v.z - u.z * v.y,
                      u.z * v.x - u.x * v.z,
                      u.x * v.y - u.y * v.x};
    };
    int i2 = -1;
    for (int i = 0; i < n; ++i) {
        if (i == i0 || i == i1) continue;
        Point3 u{P[i1].x - P[i0].x, P[i1].y - P[i0].y, P[i1].z - P[i0].z};
        Point3 v{P[i].x - P[i0].x,  P[i].y - P[i0].y,  P[i].z - P[i0].z};
        Point3 c = cross(u, v);
        if (c.x != 0.0 || c.y != 0.0 || c.z != 0.0) { i2 = i; break; }
    }
    if (i2 < 0) { result.reason = "all points collinear"; return result; }

    // i3: not coplanar with i0,i1,i2 (orient3d != 0).
    int i3 = -1;
    for (int i = 0; i < n; ++i) {
        if (i == i0 || i == i1 || i == i2) continue;
        if (orient3(P[i0], P[i1], P[i2], P[i]) != Sign::ZERO) { i3 = i; break; }
    }
    if (i3 < 0) { result.reason = "all points coplanar"; return result; }

    // --- Seed the hull with the tetrahedron, all faces outward-oriented. ---
    // For a face (a,b,c), "outward" means the fourth point d is BELOW it, i.e.
    // orient3d(a,b,c,d) > 0 (POSITIVE), per the predicate's convention
    // (POSITIVE => d below the plane, a,b,c CCW seen from above d... we orient
    // each face so that the remaining apex is on the negative/inside side).
    std::vector<Face> faces;
    auto addOrientedFace = [&](int a, int b, int c, int inside) {
        // Ensure the 'inside' point is on the NEGATIVE side of (a,b,c), so the
        // face normal points outward. orient3d(a,b,c,inside): if POSITIVE, the
        // inside point is below -> outward normal already points the other way;
        // we want inside to be NEGATIVE, so flip when it's POSITIVE.
        if (orient3(P[a], P[b], P[c], P[inside]) == Sign::POSITIVE) {
            std::swap(b, c);
        }
        faces.push_back(Face{a, b, c, true});
    };
    addOrientedFace(i1, i2, i3, i0);
    addOrientedFace(i0, i2, i3, i1);
    addOrientedFace(i0, i1, i3, i2);
    addOrientedFace(i0, i1, i2, i3);

    // A point p is "visible" from face f if it lies strictly OUTSIDE the face's
    // plane, i.e. on the opposite side from the hull interior. With our outward
    // orientation, interior points are NEGATIVE; visible points are POSITIVE.
    auto visible = [&](const Face& f, int p) -> bool {
        return orient3(P[f.a], P[f.b], P[f.c], P[p]) == Sign::POSITIVE;
    };

    // --- Incrementally add the remaining points. ---
    for (int p = 0; p < n; ++p) {
        if (p == i0 || p == i1 || p == i2 || p == i3) continue;

        // Collect visible faces.
        std::vector<int> visFaces;
        for (int fi = 0; fi < static_cast<int>(faces.size()); ++fi) {
            if (faces[fi].alive && visible(faces[fi], p)) visFaces.push_back(fi);
        }
        if (visFaces.empty()) continue;  // p is inside or on the hull -> skip.

        // Find horizon edges: edges shared by exactly one visible face.
        // Count each directed edge of visible faces; an edge on the horizon
        // appears in a visible face but its reverse is NOT in a visible face.
        std::map<std::pair<int, int>, int> edgeCount;  // undirected key (min,max)
        std::map<std::pair<int, int>, std::pair<int, int>> dirEdge; // ordered
        auto key = [](int a, int b) {
            return std::make_pair(std::min(a, b), std::max(a, b));
        };
        for (int fi : visFaces) {
            const Face& f = faces[fi];
            int e[3][2] = {{f.a, f.b}, {f.b, f.c}, {f.c, f.a}};
            for (auto& ed : e) {
                auto k = key(ed[0], ed[1]);
                edgeCount[k]++;
                // remember a directed instance for orientation later
                dirEdge[k] = {ed[0], ed[1]};
            }
        }

        // Kill visible faces.
        for (int fi : visFaces) faces[fi].alive = false;

        // For each horizon edge (count == 1) build a new face to p, keeping the
        // outward winding. The directed edge stored is (u->v) as it appeared in
        // a now-removed visible face; the new face (u, v, p) must keep the hull
        // interior on the negative side. We orient using an existing interior
        // reference point (any of the seed apexes works since the tetra core is
        // always interior to the growing hull — use the centroid of the seed
        // tetra for a robust interior reference).
        Point3 interior{
            (P[i0].x + P[i1].x + P[i2].x + P[i3].x) * 0.25,
            (P[i0].y + P[i1].y + P[i2].y + P[i3].y) * 0.25,
            (P[i0].z + P[i1].z + P[i2].z + P[i3].z) * 0.25};

        for (auto& kv : edgeCount) {
            if (kv.second != 1) continue;  // shared by 2 visible faces -> interior
            auto de = dirEdge[kv.first];
            int u = de.first, v = de.second;
            // New face (u, v, p). Orient so the interior centroid is NEGATIVE.
            int fa = u, fb = v, fc = p;
            if (orient3d(P[fa].x, P[fa].y, P[fa].z,
                         P[fb].x, P[fb].y, P[fb].z,
                         P[fc].x, P[fc].y, P[fc].z,
                         interior.x, interior.y, interior.z) == Sign::POSITIVE) {
                std::swap(fb, fc);
            }
            faces.push_back(Face{fa, fb, fc, true});
        }
    }

    // --- Collect alive faces into the result. ---
    for (const Face& f : faces) {
        if (f.alive) result.faces.push_back({f.a, f.b, f.c});
    }
    result.ok = !result.faces.empty();
    if (!result.ok) result.reason = "no faces produced";
    return result;
}

} // namespace geom
} // namespace native
} // namespace forge
