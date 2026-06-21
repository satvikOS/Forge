// forge/native/csg/Extrude.cpp
//
// Implementation of forge::native::csg::extrude — see Extrude.hpp for the honest
// scope statement. Pure C++20, standard library only. No OCCT / WASM / deps.
//
// PIPELINE
// --------
//   1. Validate inputs: non-zero height, non-degenerate normal, >=3 unique
//      outer vertices, each loop simple, holes strictly inside the outer loop.
//   2. Normalise winding: outer -> CCW, holes -> CW.
//   3. Merge holes into the outer loop with bridge edges (mutually-visible
//      bridge: for each hole, pick its rightmost vertex M, ray-cast +x to find
//      the outer edge it first hits, choose the visible bridge vertex P per the
//      classic Eberly/FIST rule, and splice the hole into the outer ring at the
//      P<->M bridge). This reduces "polygon with holes" to ONE simple polygon.
//   4. Ear-clip the merged simple polygon using the exact orient2d predicate for
//      convexity and exact point-in-triangle for ear emptiness. Output cap
//      triangles as index triples into the ORIGINAL profile vertex list.
//   5. Build the 3D solid: emit the top cap (lifted, CCW = +normal), the bottom
//      cap (at base, reversed = -normal), and a two-triangle wall per ORIGINAL
//      boundary edge of every loop, all with globally consistent winding.
//   6. buildFromSoup + validate; signedVolume cross-check.
//
// The cap triangulation is computed ONCE in 2D and reused for both caps (the
// bottom reuses the same index triples with reversed winding), which guarantees
// the two caps are combinatorially identical and the volume telescopes exactly.

#include "forge/native/csg/Extrude.hpp"

#include "forge/native/Predicates.hpp"

#include <cmath>
#include <cstdint>
#include <vector>
#include <array>
#include <algorithm>
#include <limits>

namespace forge {
namespace native {
namespace csg {

namespace {

using geom::Point2;
using mesh::Vec3;

// ---- small 2D helpers ------------------------------------------------------

// Signed area of a closed polygon (shoelace). +ve => CCW.
double signedArea(const std::vector<Point2>& p) {
    double a = 0.0;
    const std::size_t n = p.size();
    for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
        a += (p[j].x * p[i].y) - (p[i].x * p[j].y);
    }
    return 0.5 * a;
}

bool nearZero(double v, double eps = 1e-300) { return std::fabs(v) <= eps; }

// Robust on-or-inside (closed) triangle test for ear emptiness: a reflex vertex
// lying ON an ear edge would create a degenerate/overlapping triangle, so we
// treat on-edge as "blocks the ear" (closed test) to stay conservative.
bool pointInTriClosedCCW(const Point2& a, const Point2& b, const Point2& c,
                         const Point2& d) {
    const Sign s0 = orient2d(a.x, a.y, b.x, b.y, d.x, d.y);
    const Sign s1 = orient2d(b.x, b.y, c.x, c.y, d.x, d.y);
    const Sign s2 = orient2d(c.x, c.y, a.x, a.y, d.x, d.y);
    return s0 != Sign::NEGATIVE && s1 != Sign::NEGATIVE && s2 != Sign::NEGATIVE;
}

// Does segment (p1,p2) properly intersect segment (p3,p4)? Proper crossing only
// (shared endpoints are NOT a proper intersection). Robust via orient2d.
bool properCross(const Point2& p1, const Point2& p2,
                 const Point2& p3, const Point2& p4) {
    const Sign d1 = orient2d(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
    const Sign d2 = orient2d(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    const Sign d3 = orient2d(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const Sign d4 = orient2d(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
    if (d1 != d2 && d3 != d4 &&
        d1 != Sign::ZERO && d2 != Sign::ZERO &&
        d3 != Sign::ZERO && d4 != Sign::ZERO) {
        return true;
    }
    return false;
}

// Is a closed polygon SIMPLE (no non-adjacent edge crossings, no repeated
// vertices)? O(n^2) — fine at part scale.
bool isSimplePolygon(const std::vector<Point2>& p) {
    const std::size_t n = p.size();
    if (n < 3) return false;
    // No coincident consecutive (or duplicate) vertices.
    for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t j = i + 1; j < n; ++j) {
            if (p[i].x == p[j].x && p[i].y == p[j].y) return false;
        }
    }
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a1 = p[i];
        const Point2& a2 = p[(i + 1) % n];
        for (std::size_t j = i + 1; j < n; ++j) {
            // Skip adjacent edges (they legitimately share a vertex).
            if (j == i) continue;
            if ((j + 1) % n == i) continue;
            if (j == (i + 1) % n) continue;
            const Point2& b1 = p[j];
            const Point2& b2 = p[(j + 1) % n];
            if (properCross(a1, a2, b1, b2)) return false;
        }
    }
    return true;
}

// Winding-number point-in-polygon (closed polygon, CCW or CW handled by sign).
// Returns true if d is STRICTLY inside. Robust orient2d for the edge-crossing
// side test; a point exactly on the boundary returns false.
bool pointStrictlyInsidePoly(const std::vector<Point2>& poly, const Point2& d) {
    const std::size_t n = poly.size();
    int wind = 0;
    for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
        const Point2& a = poly[j];
        const Point2& b = poly[i];
        // On-boundary check: collinear and within the edge bounding box.
        if (orient2d(a.x, a.y, b.x, b.y, d.x, d.y) == Sign::ZERO) {
            const double minx = std::min(a.x, b.x), maxx = std::max(a.x, b.x);
            const double miny = std::min(a.y, b.y), maxy = std::max(a.y, b.y);
            if (d.x >= minx && d.x <= maxx && d.y >= miny && d.y <= maxy)
                return false; // on the boundary => not strictly inside
        }
        if (a.y <= d.y) {
            if (b.y > d.y &&
                orient2d(a.x, a.y, b.x, b.y, d.x, d.y) == Sign::POSITIVE)
                ++wind;
        } else {
            if (b.y <= d.y &&
                orient2d(a.x, a.y, b.x, b.y, d.x, d.y) == Sign::NEGATIVE)
                --wind;
        }
    }
    return wind != 0;
}

// ---- hole bridging ---------------------------------------------------------

// A working ring vertex: its 2D coordinate + the index into the ORIGINAL
// profile vertex array (so cap triangles reference original vertices).
struct RingVertex {
    Point2        p;
    std::uint32_t origIndex;
};

// Bridge one hole (CW, list of RingVertex) into the outer ring (CCW list of
// RingVertex) by the rightmost-vertex visibility rule. Returns the new merged
// ring. `outer` and `hole` are both already correctly wound.
std::vector<RingVertex> bridgeHole(const std::vector<RingVertex>& outer,
                                   const std::vector<RingVertex>& hole) {
    // 1. Find M = rightmost (max x; tie-break max y) hole vertex.
    std::size_t mIdx = 0;
    for (std::size_t i = 1; i < hole.size(); ++i) {
        if (hole[i].p.x > hole[mIdx].p.x ||
            (hole[i].p.x == hole[mIdx].p.x && hole[i].p.y > hole[mIdx].p.y))
            mIdx = i;
    }
    const Point2 M = hole[mIdx].p;

    // 2. Cast a ray from M in +x; find the outer edge it first crosses and the
    //    intersection point I (with the largest x of the candidate). Track the
    //    edge endpoint with the greater x as the initial bridge candidate P.
    double bestT = std::numeric_limits<double>::infinity();
    Point2 I{};
    std::size_t edgeA = static_cast<std::size_t>(-1); // outer index of edge start
    bool found = false;
    const std::size_t on = outer.size();
    for (std::size_t i = 0; i < on; ++i) {
        const Point2& a = outer[i].p;
        const Point2& b = outer[(i + 1) % on].p;
        // Edge must straddle the horizontal line y = M.y.
        if ((a.y > M.y && b.y > M.y) || (a.y < M.y && b.y < M.y)) continue;
        if (a.y == b.y) continue; // horizontal edge: ignore (endpoints caught elsewhere)
        const double t = (M.y - a.y) / (b.y - a.y); // param along a->b
        if (t < 0.0 || t > 1.0) continue;
        const double ix = a.x + t * (b.x - a.x);
        if (ix < M.x) continue; // intersection must be to the right of M
        const double dist = ix - M.x;
        if (dist < bestT) {
            bestT = dist;
            I = Point2{ix, M.y};
            edgeA = i;
            found = true;
        }
    }

    if (!found) {
        // Should not happen for a hole strictly inside the outer ring; fall back
        // to a direct bridge to the rightmost outer vertex (still valid because
        // the hole is interior). This keeps the routine total rather than
        // throwing — the caller has already validated containment.
        std::size_t pr = 0;
        for (std::size_t i = 1; i < on; ++i)
            if (outer[i].p.x > outer[pr].p.x) pr = i;
        edgeA = pr;
        I = outer[pr].p;
    }

    // 3. Choose the bridge vertex P on the outer ring. If I is an existing
    //    vertex, that's P. Otherwise the candidate is the edge endpoint with the
    //    larger x. Then, among reflex outer vertices inside triangle (M, I, P),
    //    pick the one minimising the angle to the +x ray (max x / closest).
    std::size_t pIdx;
    {
        const std::size_t ia = edgeA;
        const std::size_t ib = (edgeA + 1) % on;
        pIdx = (outer[ia].p.x >= outer[ib].p.x) ? ia : ib;
        const Point2 P0 = outer[pIdx].p;
        // Candidate reflex vertices inside triangle (M, I, P0).
        // Build triangle CCW for the predicate test.
        Point2 t0 = M, t1 = I, t2 = P0;
        // Ensure CCW ordering for pointInTri.
        if (orient2d(t0.x, t0.y, t1.x, t1.y, t2.x, t2.y) == Sign::NEGATIVE)
            std::swap(t1, t2);
        double bestCos = -2.0;
        double bestDist = std::numeric_limits<double>::infinity();
        std::size_t cand = pIdx;
        bool haveCand = false;
        for (std::size_t i = 0; i < on; ++i) {
            const Point2& R = outer[i].p;
            if (i == pIdx) continue;
            if (!pointInTriClosedCCW(t0, t1, t2, R)) continue;
            // angle of M->R against +x; prefer smaller angle then nearer.
            const double dx = R.x - M.x, dy = R.y - M.y;
            const double len = std::sqrt(dx * dx + dy * dy);
            if (len == 0.0) continue;
            const double cosA = dx / len; // cos of angle to +x
            if (cosA > bestCos ||
                (cosA == bestCos && len < bestDist)) {
                bestCos = cosA;
                bestDist = len;
                cand = i;
                haveCand = true;
            }
        }
        if (haveCand) pIdx = cand;
    }

    // 4. Splice: build a new ring = outer[0..pIdx], then hole starting at mIdx
    //    walking forward and wrapping (the hole is CW, so we traverse it as-is),
    //    repeat hole[mIdx], repeat outer[pIdx], then continue outer.
    std::vector<RingVertex> merged;
    merged.reserve(outer.size() + hole.size() + 2);
    for (std::size_t i = 0; i <= pIdx; ++i) merged.push_back(outer[i]);
    for (std::size_t k = 0; k < hole.size(); ++k)
        merged.push_back(hole[(mIdx + k) % hole.size()]);
    merged.push_back(hole[mIdx]);            // close back to hole bridge vertex
    merged.push_back(outer[pIdx]);           // back to outer bridge vertex
    for (std::size_t i = pIdx + 1; i < outer.size(); ++i)
        merged.push_back(outer[i]);
    return merged;
}

// ---- ear clipping ----------------------------------------------------------

// Triangulate a SIMPLE CCW ring (RingVertex list) into index triples that
// reference the ORIGINAL profile vertices (RingVertex::origIndex). Returns false
// if it cannot make progress (should not happen for a valid simple polygon).
bool earClip(const std::vector<RingVertex>& ring,
             std::vector<std::array<std::uint32_t, 3>>& tris) {
    const std::size_t n0 = ring.size();
    if (n0 < 3) return false;

    // Doubly-linked index list over `ring`.
    std::vector<int> prev(n0), next(n0);
    for (std::size_t i = 0; i < n0; ++i) {
        prev[i] = static_cast<int>((i + n0 - 1) % n0);
        next[i] = static_cast<int>((i + 1) % n0);
    }
    std::size_t remaining = n0;

    auto coincident = [&](const Point2& p, const Point2& q) {
        return p.x == q.x && p.y == q.y;
    };

    // A vertex is REFLEX if its interior turn is non-left (orient2d <= 0). Only
    // reflex vertices of the *current* ring can block an ear, so the emptiness
    // test need only consider them — and a reflex vertex that is COINCIDENT with
    // one of the ear's own corners (the bridge seam case) does not block it.
    auto isReflex = [&](int i) {
        const Point2& a = ring[prev[i]].p;
        const Point2& b = ring[i].p;
        const Point2& c = ring[next[i]].p;
        return orient2d(a.x, a.y, b.x, b.y, c.x, c.y) != Sign::POSITIVE;
    };

    auto isConvex = [&](int i) { return !isReflex(i); };

    auto isEar = [&](int i) {
        const Point2& a = ring[prev[i]].p;
        const Point2& b = ring[i].p;
        const Point2& c = ring[next[i]].p;
        // The ear apex must be a strictly-convex (left) turn — a collinear apex
        // (orient2d == ZERO) is a zero-area sliver, never a valid ear.
        if (orient2d(a.x, a.y, b.x, b.y, c.x, c.y) != Sign::POSITIVE) return false;
        // No REFLEX vertex strictly inside (or on, but not coincident with a
        // corner of) triangle a-b-c. Bridge-seam duplicates that coincide with
        // a corner are ignored, which is what makes hole-merged rings clip.
        for (int j = next[next[i]]; j != prev[i]; j = next[j]) {
            if (j == i || j == prev[i] || j == next[i]) continue;
            if (!isReflex(j)) continue; // convex verts never block an ear
            const Point2& q = ring[j].p;
            if (coincident(q, a) || coincident(q, b) || coincident(q, c)) continue;
            if (pointInTriClosedCCW(a, b, c, q)) return false;
        }
        return true;
    };
    (void)isConvex;

    int guard = 0;
    int cur = 0;
    const int guardMax = static_cast<int>(n0) * static_cast<int>(n0) + 16;
    while (remaining > 3) {
        bool clipped = false;
        int start = cur;
        do {
            if (isEar(cur)) {
                tris.push_back({ ring[prev[cur]].origIndex,
                                 ring[cur].origIndex,
                                 ring[next[cur]].origIndex });
                // remove cur
                next[prev[cur]] = next[cur];
                prev[next[cur]] = prev[cur];
                int nxt = next[cur];
                cur = prev[cur];
                --remaining;
                clipped = true;
                (void)nxt;
                break;
            }
            cur = next[cur];
        } while (cur != start);

        if (!clipped) return false; // no ear found -> not a valid simple polygon
        if (++guard > guardMax) return false;
    }
    // Final triangle.
    tris.push_back({ ring[prev[cur]].origIndex,
                     ring[cur].origIndex,
                     ring[next[cur]].origIndex });
    return true;
}

// ---- frame construction ----------------------------------------------------

double v3len(const Vec3& a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
Vec3 v3scale(const Vec3& a, double s) { return Vec3{a.x * s, a.y * s, a.z * s}; }
Vec3 v3cross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}

bool buildFrame(const Plane& plane, Vec3& n, Vec3& u, Vec3& v) {
    const double nl = v3len(plane.normal);
    if (nl < 1e-300 || !std::isfinite(nl)) return false;
    n = v3scale(plane.normal, 1.0 / nl);

    const bool haveUV = (v3len(plane.u) > 1e-300) && (v3len(plane.v) > 1e-300);
    if (haveUV) {
        const double ul = v3len(plane.u);
        u = v3scale(plane.u, 1.0 / ul);
        // Re-orthogonalise v against (n,u) to be safe.
        Vec3 vv = v3cross(n, u);
        const double vl = v3len(vv);
        if (vl < 1e-300) return false;
        v = v3scale(vv, 1.0 / vl);
    } else {
        // Derive an arbitrary orthonormal (u,v) from n.
        Vec3 ref = (std::fabs(n.z) < 0.9) ? Vec3{0, 0, 1} : Vec3{1, 0, 0};
        Vec3 uu = v3cross(ref, n);
        const double ul = v3len(uu);
        if (ul < 1e-300) return false;
        u = v3scale(uu, 1.0 / ul);
        v = v3cross(n, u); // already unit
    }
    return true;
}

} // namespace

ExtrudeResult extrude(const Profile2D& profile, double height, const Plane& plane) {
    ExtrudeResult R;

    // ---- 0. Basic validation ----
    if (!std::isfinite(height) || nearZero(height, 1e-15)) {
        R.reason = "height must be a finite non-zero value";
        return R;
    }
    if (profile.outer.size() < 3) {
        R.reason = "outer loop needs >= 3 vertices";
        return R;
    }
    Vec3 n, u, v;
    if (!buildFrame(plane, n, u, v)) {
        R.reason = "degenerate plane normal / frame";
        return R;
    }

    // ---- 1. Normalise winding: outer CCW, holes CW ----
    std::vector<Point2> outer = profile.outer;
    double outerSA = signedArea(outer);
    if (nearZero(outerSA, 1e-14)) { R.reason = "outer loop is degenerate (zero area / collinear)"; return R; }
    if (outerSA < 0.0) { std::reverse(outer.begin(), outer.end()); outerSA = -outerSA; }
    if (!isSimplePolygon(outer)) { R.reason = "outer loop self-intersects or has duplicate vertices"; return R; }

    std::vector<std::vector<Point2>> holes;
    holes.reserve(profile.holes.size());
    double holeAreaSum = 0.0;
    for (const auto& h0 : profile.holes) {
        if (h0.size() < 3) { R.reason = "a hole loop has < 3 vertices"; return R; }
        std::vector<Point2> h = h0;
        double hsa = signedArea(h);
        if (nearZero(hsa, 1e-14)) { R.reason = "a hole loop is degenerate (zero area)"; return R; }
        // Hole must be CW for the merge (negative signed area).
        if (hsa > 0.0) { std::reverse(h.begin(), h.end()); hsa = -hsa; }
        if (!isSimplePolygon(h)) { R.reason = "a hole loop self-intersects"; return R; }
        // Every hole vertex must be strictly inside the outer ring.
        for (const auto& hp : h) {
            if (!pointStrictlyInsidePoly(outer, hp)) {
                R.reason = "a hole vertex is not strictly inside the outer loop";
                return R;
            }
        }
        holeAreaSum += -hsa; // unsigned hole area (hsa is negative now)
        holes.push_back(std::move(h));
    }

    // Disallow holes that touch / overlap each other (vertex strictly inside
    // another hole, or proper edge crossing) — keeps the merge well-defined.
    for (std::size_t i = 0; i < holes.size(); ++i) {
        for (std::size_t j = i + 1; j < holes.size(); ++j) {
            for (const auto& p : holes[j])
                if (pointStrictlyInsidePoly(holes[i], p)) { R.reason = "holes overlap / nest"; return R; }
            for (const auto& p : holes[i])
                if (pointStrictlyInsidePoly(holes[j], p)) { R.reason = "holes overlap / nest"; return R; }
            // proper crossing of any edge pair
            const std::size_t ni = holes[i].size(), nj = holes[j].size();
            for (std::size_t a = 0; a < ni; ++a) {
                const Point2& a1 = holes[i][a];
                const Point2& a2 = holes[i][(a + 1) % ni];
                for (std::size_t b = 0; b < nj; ++b) {
                    const Point2& b1 = holes[j][b];
                    const Point2& b2 = holes[j][(b + 1) % nj];
                    if (properCross(a1, a2, b1, b2)) { R.reason = "hole boundaries cross"; return R; }
                }
            }
        }
    }

    // ---- 2. Assemble the original-index vertex table ----
    // The 2D profile vertices, in a single array, become the (u,v) lattice that
    // is lifted to bottom (z=0 plane offset) and top (z=height offset). Index
    // layout: [0 .. P-1] = bottom verts, [P .. 2P-1] = top verts, where P is the
    // total number of profile vertices (outer + all holes).
    std::vector<Point2> verts2D;
    verts2D.reserve(outer.size() + holeAreaSum * 0); // hint
    std::vector<RingVertex> outerRing;
    outerRing.reserve(outer.size());
    for (const auto& p : outer) {
        outerRing.push_back(RingVertex{p, static_cast<std::uint32_t>(verts2D.size())});
        verts2D.push_back(p);
    }
    std::vector<std::vector<RingVertex>> holeRings;
    for (const auto& h : holes) {
        std::vector<RingVertex> hr;
        hr.reserve(h.size());
        for (const auto& p : h) {
            hr.push_back(RingVertex{p, static_cast<std::uint32_t>(verts2D.size())});
            verts2D.push_back(p);
        }
        holeRings.push_back(std::move(hr));
    }
    const std::uint32_t P = static_cast<std::uint32_t>(verts2D.size());

    // ---- 3. Merge holes into the outer ring (one at a time, rightmost-first) ----
    // Sort holes by descending rightmost-x so outer ones merge first (FIST rule).
    std::vector<std::size_t> order(holeRings.size());
    for (std::size_t i = 0; i < order.size(); ++i) order[i] = i;
    std::sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
        double ra = -1e300, rb = -1e300;
        for (const auto& rv : holeRings[a]) ra = std::max(ra, rv.p.x);
        for (const auto& rv : holeRings[b]) rb = std::max(rb, rv.p.x);
        return ra > rb;
    });
    std::vector<RingVertex> ring = outerRing;
    for (std::size_t k : order) ring = bridgeHole(ring, holeRings[k]);

    // ---- 4. Ear-clip the merged simple ring -> cap triangles (orig indices) ----
    std::vector<std::array<std::uint32_t, 3>> capTris;
    capTris.reserve(P);
    if (!earClip(ring, capTris)) {
        R.reason = "ear-clip failed (profile not a valid simple polygon after merge)";
        return R;
    }

    // ---- 5. Lift to 3D and emit the watertight solid ----
    // 3D position of a profile vertex i at z-offset h along normal n.
    auto pos3 = [&](std::uint32_t i, double h) -> Vec3 {
        const Point2& q = verts2D[i];
        return Vec3{ plane.origin.x + q.x * u.x + q.y * v.x + h * n.x,
                     plane.origin.y + q.x * u.y + q.y * v.y + h * n.y,
                     plane.origin.z + q.x * u.z + q.y * v.z + h * n.z };
    };

    // We want OUTWARD-facing CCW triangles with POSITIVE signedVolume. The cap
    // triangulation `capTris` is CCW in the profile (u,v) plane. With height>0,
    // the TOP cap (z=height) should keep CCW winding (normal +n => outward), the
    // BOTTOM cap (z=0) must be REVERSED (normal -n => outward). For height<0 the
    // sense flips; we handle it by orienting walls/caps off the SIGN of height so
    // the result is always a positive-volume outward solid.
    const double hTop = (height > 0.0) ? height : 0.0;
    const double hBot = (height > 0.0) ? 0.0 : height;
    // After this, hTop > hBot always; "top" is the +n end.

    std::vector<double>        positions;
    std::vector<std::uint32_t> indices;
    positions.reserve(static_cast<std::size_t>(P) * 2 * 3);
    indices.reserve(capTris.size() * 6 + static_cast<std::size_t>(P) * 6);

    // Vertex i (bottom) -> slot i; vertex i (top) -> slot P + i.
    for (std::uint32_t i = 0; i < P; ++i) {
        const Vec3 b = pos3(i, hBot);
        positions.push_back(b.x); positions.push_back(b.y); positions.push_back(b.z);
    }
    for (std::uint32_t i = 0; i < P; ++i) {
        const Vec3 t = pos3(i, hTop);
        positions.push_back(t.x); positions.push_back(t.y); positions.push_back(t.z);
    }
    const std::uint32_t TOP = P; // offset of top verts

    // TOP cap: CCW as-is (+n outward).
    for (const auto& t : capTris) {
        indices.push_back(TOP + t[0]);
        indices.push_back(TOP + t[1]);
        indices.push_back(TOP + t[2]);
    }
    // BOTTOM cap: reversed (-n outward).
    for (const auto& t : capTris) {
        indices.push_back(t[0]);
        indices.push_back(t[2]);
        indices.push_back(t[1]);
    }

    // SIDE WALLS: one quad per ORIGINAL boundary edge of every loop. For each
    // directed boundary edge (a -> b) wound CCW in the profile (so the polygon
    // interior is on the LEFT), the outward wall faces away from the interior.
    // With bottom verts a,b and top verts a',b', the outward quad is
    // (a, b, b') + (a, b', a') so its normal points outward (right of a->b, and
    // up the +n sweep). This winding is the unique one consistent with both caps.
    auto emitWallLoop = [&](const std::vector<RingVertex>& loop, bool isOuter) {
        const std::size_t m = loop.size();
        for (std::size_t i = 0; i < m; ++i) {
            // Outer ring is CCW (interior on left); holes are CW (interior of the
            // SOLID is on the left of the hole edge too, since the hole is a void
            // wound opposite). In both cases the stored loop has the solid's
            // material on the left of a->b, so the same wall winding is outward.
            std::uint32_t a = loop[i].origIndex;
            std::uint32_t b = loop[(i + 1) % m].origIndex;
            std::uint32_t aT = TOP + a, bT = TOP + b;
            // Triangle 1: (a, b, bT)   Triangle 2: (a, bT, aT)
            indices.push_back(a);  indices.push_back(b);  indices.push_back(bT);
            indices.push_back(a);  indices.push_back(bT); indices.push_back(aT);
            (void)isOuter;
        }
    };
    emitWallLoop(outerRing, true);
    for (const auto& hr : holeRings) emitWallLoop(hr, false);

    // ---- 6. Build, validate, measure ----
    mesh::HalfEdgeMesh hem;
    if (!hem.buildFromSoup(positions, indices)) {
        R.reason = "buildFromSoup rejected the soup (winding/manifold) — refusing to return a fake";
        return R;
    }
    const mesh::ValidityReport vr = hem.validate();
    if (!vr.isValid()) {
        R.reason = "result not 2-manifold/watertight — refusing to return a fake";
        return R;
    }

    R.capArea = outerSA - holeAreaSum;
    R.volume  = hem.signedVolume();
    R.mesh    = std::move(hem);
    R.ok      = true;
    R.reason  = "";
    return R;
}

ExtrudeResult extrude(const Profile2D& profile, double height) {
    return extrude(profile, height, Plane{});
}

} // namespace csg
} // namespace native
} // namespace forge
