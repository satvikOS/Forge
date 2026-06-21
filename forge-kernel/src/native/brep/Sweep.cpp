// forge/native/brep/Sweep.cpp
//
// Implementation of forge::native::brep::sweep — see Sweep.hpp for the honest
// scope / validity contract. Pure C++20, standard library only; all topological
// decisions for the caps go through the exact orient2d predicate, and the final
// emitted solid is re-validated with HalfEdgeMesh::validate() before success.

#include "forge/native/brep/Sweep.hpp"

#include "forge/native/Predicates.hpp"          // orient2d, Sign
#include "forge/native/geom/Geom.hpp"            // Point2, Point3, segmentIntersect
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // Vec3, HalfEdgeMesh

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

using geom::Point2;
using geom::Point3;
using mesh::Vec3;

// ---------------------------------------------------------------------------
// Small 3D vector helpers (local; we do not pull in a vector lib).
// ---------------------------------------------------------------------------
inline Vec3 vsub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 vadd(const Vec3& a, const Vec3& b) { return Vec3{a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 vscale(const Vec3& a, double s)    { return Vec3{a.x * s, a.y * s, a.z * s}; }
inline double vdot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
inline double vlen(const Vec3& a) { return std::sqrt(vdot(a, a)); }
inline Vec3 fromP3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

inline bool vnormalize(Vec3& a) {
    const double L = vlen(a);
    if (!(L > 0.0)) return false;
    a = vscale(a, 1.0 / L);
    return true;
}

// ---------------------------------------------------------------------------
// 2D loop helpers.
// ---------------------------------------------------------------------------

// Signed area of a polygon (positive == CCW). Plain double — this is a measure,
// not a combinatorial decision (those use orient2d below).
double signedAreaLocal(const std::vector<Point2>& loop) {
    const std::size_t n = loop.size();
    if (n < 3) return 0.0;
    double a2 = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& p = loop[i];
        const Point2& q = loop[(i + 1) % n];
        a2 += p.x * q.y - q.x * p.y;
    }
    return 0.5 * a2;
}

// Does the open polyline (closed loop) self-intersect? Uses the robust
// segmentIntersect classifier: a simple loop has each edge meeting only its two
// adjacent edges, and only at the shared endpoint.
bool loopIsSimple(const std::vector<Point2>& loop) {
    const std::size_t n = loop.size();
    if (n < 3) return false;
    // reject repeated vertices
    for (std::size_t i = 0; i < n; ++i)
        for (std::size_t j = i + 1; j < n; ++j)
            if (loop[i].x == loop[j].x && loop[i].y == loop[j].y) return false;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a0 = loop[i];
        const Point2& a1 = loop[(i + 1) % n];
        for (std::size_t j = i + 1; j < n; ++j) {
            // adjacency: edges i and j share a vertex when j==i+1 or wrap.
            const bool adjacent =
                (j == i + 1) || (i == 0 && j == n - 1);
            const Point2& b0 = loop[j];
            const Point2& b1 = loop[(j + 1) % n];
            const geom::SegIntersection r = geom::segmentIntersect(a0, a1, b0, b1);
            if (adjacent) {
                // adjacent edges may touch ONLY at their shared endpoint.
                if (r.relation == geom::SegRelation::PROPER_CROSS) return false;
                if (r.relation == geom::SegRelation::COLLINEAR_OVERLAP) return false;
                // ENDPOINT_TOUCH at the shared vertex is fine; DISJOINT impossible.
            } else {
                if (r.relation != geom::SegRelation::DISJOINT) return false;
            }
        }
    }
    return true;
}

// Is point p strictly inside the simple CCW polygon? Exact via orient2d ray
// sense is overkill; we use a robust crossing-number with orient2d only for the
// on-edge rejection. Returns: 1 inside, 0 on boundary, -1 outside.
int pointInCCW(const Point2& p, const std::vector<Point2>& poly) {
    const std::size_t n = poly.size();
    int wn = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = poly[i];
        const Point2& b = poly[(i + 1) % n];
        const Sign s = orient2d(a.x, a.y, b.x, b.y, p.x, p.y);
        // on an edge?
        if (s == Sign::ZERO) {
            const double minx = a.x < b.x ? a.x : b.x;
            const double maxx = a.x < b.x ? b.x : a.x;
            const double miny = a.y < b.y ? a.y : b.y;
            const double maxy = a.y < b.y ? b.y : a.y;
            if (p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy)
                return 0;
        }
        if (a.y <= p.y) {
            if (b.y > p.y && s == Sign::POSITIVE) ++wn;
        } else {
            if (b.y <= p.y && s == Sign::NEGATIVE) --wn;
        }
    }
    return wn != 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Ear-clip triangulation of a SIMPLE CCW polygon given as a list of vertex
// indices into a shared coordinate array. Returns triangles as index triples
// (into `idx`), wound CCW. Uses exact orient2d for convexity + containment.
//
// Holes are NOT handled here; they are pre-merged into the outer loop by a
// bridge step (mergeHoles) so the input to this routine is a single simple loop.
// ---------------------------------------------------------------------------
bool earClip(const std::vector<Point2>& pts,
             const std::vector<std::uint32_t>& loop,
             std::vector<std::array<std::uint32_t, 3>>& outTris) {
    const std::size_t n = loop.size();
    if (n < 3) return false;
    std::vector<std::uint32_t> v(loop.begin(), loop.end());

    auto orient = [&](std::uint32_t i, std::uint32_t j, std::uint32_t k) -> Sign {
        return orient2d(pts[i].x, pts[i].y, pts[j].x, pts[j].y,
                        pts[k].x, pts[k].y);
    };

    int guard = 0;
    const int guardMax = static_cast<int>(2 * n * n) + 16;
    while (v.size() > 3) {
        const std::size_t m = v.size();
        bool clipped = false;
        for (std::size_t i = 0; i < m; ++i) {
            const std::uint32_t ip = v[(i + m - 1) % m];
            const std::uint32_t ic = v[i];
            const std::uint32_t in = v[(i + 1) % m];
            // convex corner (CCW) ?
            if (orient(ip, ic, in) != Sign::POSITIVE) continue;
            // no other vertex inside triangle (ip,ic,in)?
            bool ear = true;
            for (std::size_t j = 0; j < m; ++j) {
                const std::uint32_t q = v[j];
                if (q == ip || q == ic || q == in) continue;
                // strictly-inside test via three CCW orientations.
                const Sign s0 = orient2d(pts[ip].x, pts[ip].y, pts[ic].x, pts[ic].y, pts[q].x, pts[q].y);
                const Sign s1 = orient2d(pts[ic].x, pts[ic].y, pts[in].x, pts[in].y, pts[q].x, pts[q].y);
                const Sign s2 = orient2d(pts[in].x, pts[in].y, pts[ip].x, pts[ip].y, pts[q].x, pts[q].y);
                const bool inside =
                    (s0 != Sign::NEGATIVE) && (s1 != Sign::NEGATIVE) && (s2 != Sign::NEGATIVE);
                if (inside) { ear = false; break; }
            }
            if (!ear) continue;
            outTris.push_back({ip, ic, in});
            v.erase(v.begin() + static_cast<long>(i));
            clipped = true;
            break;
        }
        if (!clipped) return false;     // not a simple polygon / no ear found
        if (++guard > guardMax) return false;
    }
    outTris.push_back({v[0], v[1], v[2]});
    return true;
}

// ---------------------------------------------------------------------------
// Merge holes into the outer loop by bridge edges so the cap can be ear-clipped
// as a single simple loop. Each hole (CW) is connected to the outer loop with a
// pair of coincident bridge edges from a mutually-visible vertex pair. We pick
// the rightmost hole vertex and bridge it to the nearest outer vertex to its
// right that yields a non-crossing bridge — a standard, robust-enough choice for
// the non-pathological tube profiles in scope. Returns a flat index loop into a
// rebuilt coordinate array.
//
// On failure (no valid bridge, overlapping holes) returns false.
// ---------------------------------------------------------------------------
bool mergeHoles(const std::vector<Point2>& outer,
                const std::vector<std::vector<Point2>>& holes,
                std::vector<Point2>& mergedPts,
                std::vector<std::uint32_t>& mergedLoop) {
    // Start with the outer ring.
    mergedPts = outer;
    mergedLoop.clear();
    for (std::uint32_t i = 0; i < outer.size(); ++i) mergedLoop.push_back(i);

    // Process holes one at a time, each time bridging into the current loop.
    for (const auto& hole : holes) {
        const std::size_t hn = hole.size();
        if (hn < 3) return false;
        // Pick the hole vertex with the maximum x (the rightmost), tie-break by y.
        std::size_t hStart = 0;
        for (std::size_t i = 1; i < hn; ++i) {
            if (hole[i].x > hole[hStart].x ||
                (hole[i].x == hole[hStart].x && hole[i].y < hole[hStart].y))
                hStart = i;
        }
        const Point2 hv = hole[hStart];

        // Find a loop vertex to bridge to: choose the visible loop vertex with
        // the smallest distance whose bridge segment crosses no edge.
        long bestK = -1;
        double bestD2 = 0.0;
        const std::size_t Ln = mergedLoop.size();
        for (std::size_t k = 0; k < Ln; ++k) {
            const Point2 lp = mergedPts[mergedLoop[k]];
            // bridge must go to the right of / outward — require lp.x >= hv.x is
            // too strict for general holes; instead test visibility directly.
            const double dx = lp.x - hv.x, dy = lp.y - hv.y;
            const double d2 = dx * dx + dy * dy;
            if (d2 == 0.0) continue;
            // Does segment hv->lp cross any current loop edge (excluding edges
            // incident to lp) or any other hole edge? Use robust classifier.
            bool crosses = false;
            for (std::size_t e = 0; e < Ln && !crosses; ++e) {
                const Point2 e0 = mergedPts[mergedLoop[e]];
                const Point2 e1 = mergedPts[mergedLoop[(e + 1) % Ln]];
                if (e == k || (e + 1) % Ln == k) continue;  // incident to lp
                const geom::SegIntersection r = geom::segmentIntersect(hv, lp, e0, e1);
                if (r.relation == geom::SegRelation::PROPER_CROSS ||
                    r.relation == geom::SegRelation::COLLINEAR_OVERLAP)
                    crosses = true;
            }
            // also reject crossing the hole's own (other) edges
            for (std::size_t e = 0; e < hn && !crosses; ++e) {
                const Point2 e0 = hole[e];
                const Point2 e1 = hole[(e + 1) % hn];
                if (e == hStart || (e + 1) % hn == hStart) continue;
                const geom::SegIntersection r = geom::segmentIntersect(hv, lp, e0, e1);
                if (r.relation == geom::SegRelation::PROPER_CROSS ||
                    r.relation == geom::SegRelation::COLLINEAR_OVERLAP)
                    crosses = true;
            }
            if (crosses) continue;
            if (bestK < 0 || d2 < bestD2) { bestK = static_cast<long>(k); bestD2 = d2; }
        }
        if (bestK < 0) return false;  // no visible bridge -> not a clean profile

        // Splice: new loop = outer[0..bestK] , hole[hStart..hStart] (full ring
        // starting at hStart, CW), back to outer[bestK], continue outer.
        // We add the hole vertices as new points.
        const std::uint32_t baseIdx = static_cast<std::uint32_t>(mergedPts.size());
        for (const Point2& p : hole) mergedPts.push_back(p);

        std::vector<std::uint32_t> newLoop;
        newLoop.reserve(mergedLoop.size() + hn + 2);
        for (std::size_t k = 0; k <= static_cast<std::size_t>(bestK); ++k)
            newLoop.push_back(mergedLoop[k]);
        // walk the hole starting at hStart, going forward (hole is CW which,
        // when inserted into a CCW outer via a bridge, yields a valid simple
        // weakly-self-touching loop the ear-clipper handles).
        for (std::size_t t = 0; t < hn; ++t) {
            const std::size_t hi = (hStart + t) % hn;
            newLoop.push_back(baseIdx + static_cast<std::uint32_t>(hi));
        }
        newLoop.push_back(baseIdx + static_cast<std::uint32_t>(hStart)); // close hole
        for (std::size_t k = static_cast<std::size_t>(bestK); k < mergedLoop.size(); ++k)
            newLoop.push_back(mergedLoop[k]);

        mergedLoop = std::move(newLoop);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Path validity: distinct points, no zero-length segment, no 180-degree
// reversal, and no self-intersection (non-adjacent segments must not meet;
// adjacent segments must not fold back onto each other).
// ---------------------------------------------------------------------------
struct PathInfo {
    std::vector<Vec3> pts;          // cleaned path vertices (>= 2)
    std::vector<Vec3> tangents;     // unit segment directions (size = pts-1)
    bool ok = false;
    const char* reason = "";
};

PathInfo analysePath(const std::vector<Point3>& pathIn) {
    PathInfo pi;
    if (pathIn.size() < 2) { pi.reason = "path has < 2 points"; return pi; }
    // drop exact consecutive duplicates
    std::vector<Vec3> p;
    p.push_back(fromP3(pathIn[0]));
    for (std::size_t i = 1; i < pathIn.size(); ++i) {
        const Vec3 q = fromP3(pathIn[i]);
        const Vec3 d = vsub(q, p.back());
        if (vlen(d) == 0.0) continue;  // duplicate
        p.push_back(q);
    }
    if (p.size() < 2) { pi.reason = "path collapses to a single point"; return pi; }

    std::vector<Vec3> t;
    for (std::size_t i = 0; i + 1 < p.size(); ++i) {
        Vec3 d = vsub(p[i + 1], p[i]);
        if (!vnormalize(d)) { pi.reason = "zero-length path segment"; return pi; }
        t.push_back(d);
    }
    // No 180-degree reversal at interior joints (miter plane undefined). Also
    // reject any sharp fold where consecutive tangents are nearly anti-parallel.
    for (std::size_t i = 0; i + 1 < t.size(); ++i) {
        const double c = vdot(t[i], t[i + 1]);
        if (c <= -1.0 + 1e-12) { pi.reason = "180-degree path reversal"; return pi; }
    }

    // Self-intersection of the 3D polyline: test every non-adjacent segment pair
    // for a near-coincident closest approach (< eps), and adjacent pairs for a
    // fold-back beyond the shared joint. We use the segment-segment closest
    // distance in 3D.
    const std::size_t ns = p.size() - 1;
    const double eps = 1e-9;
    auto segClosest = [&](const Vec3& a0, const Vec3& a1,
                          const Vec3& b0, const Vec3& b1) -> double {
        const Vec3 d1 = vsub(a1, a0);
        const Vec3 d2 = vsub(b1, b0);
        const Vec3 r  = vsub(a0, b0);
        const double A = vdot(d1, d1), E = vdot(d2, d2), F = vdot(d2, r);
        double s, tt;
        const double C = vdot(d1, r);
        const double B = vdot(d1, d2);
        const double denom = A * E - B * B;
        if (denom > 1e-300) s = (B * F - C * E) / denom; else s = 0.0;
        if (s < 0.0) s = 0.0; else if (s > 1.0) s = 1.0;
        tt = (B * s + F) / (E > 1e-300 ? E : 1.0);
        if (tt < 0.0) { tt = 0.0; s = (-C) / (A > 1e-300 ? A : 1.0); }
        else if (tt > 1.0) { tt = 1.0; s = (B - C) / (A > 1e-300 ? A : 1.0); }
        if (s < 0.0) s = 0.0; else if (s > 1.0) s = 1.0;
        const Vec3 c1 = vadd(a0, vscale(d1, s));
        const Vec3 c2 = vadd(b0, vscale(d2, tt));
        return vlen(vsub(c1, c2));
    };
    for (std::size_t i = 0; i < ns; ++i) {
        for (std::size_t j = i + 1; j < ns; ++j) {
            const double dist = segClosest(p[i], p[i + 1], p[j], p[j + 1]);
            if (j == i + 1) {
                // adjacent: they share p[i+1]; a fold-back makes the rest of the
                // segments approach. The 180-degree check already caught exact
                // reversal; here reject if the non-shared portions overlap.
                continue;
            }
            if (dist < eps) { pi.reason = "self-intersecting path"; return pi; }
        }
    }

    pi.pts = std::move(p);
    pi.tangents = std::move(t);
    pi.ok = true;
    return pi;
}

} // namespace

// ===========================================================================
// Public: signedArea
// ===========================================================================
double signedArea(const std::vector<geom::Point2>& loop) {
    return signedAreaLocal(loop);
}

// ===========================================================================
// Public: sweep
// ===========================================================================
SweepResult sweep(const Profile& profile,
                  const std::vector<geom::Point3>& path) {
    SweepResult res;

    // ---- 1. validate the profile -----------------------------------------
    const std::vector<Point2>& outer = profile.outer;
    if (outer.size() < 3)      { res.reason = "outer loop has < 3 vertices"; return res; }
    if (!loopIsSimple(outer))  { res.reason = "outer loop is not simple"; return res; }
    if (signedAreaLocal(outer) <= 0.0) { res.reason = "outer loop is not CCW"; return res; }

    for (const auto& h : profile.holes) {
        if (h.size() < 3)       { res.reason = "hole has < 3 vertices"; return res; }
        if (!loopIsSimple(h))   { res.reason = "hole is not simple"; return res; }
        if (signedAreaLocal(h) >= 0.0) { res.reason = "hole is not CW"; return res; }
        // hole strictly inside outer
        for (const Point2& p : h)
            if (pointInCCW(p, outer) != 1) { res.reason = "hole not strictly inside outer"; return res; }
    }
    // holes mutually disjoint (no shared/crossing edges): pairwise loop check
    for (std::size_t a = 0; a < profile.holes.size(); ++a) {
        for (std::size_t b = a + 1; b < profile.holes.size(); ++b) {
            const auto& ha = profile.holes[a];
            const auto& hb = profile.holes[b];
            for (std::size_t i = 0; i < ha.size(); ++i) {
                const Point2 a0 = ha[i], a1 = ha[(i + 1) % ha.size()];
                for (std::size_t j = 0; j < hb.size(); ++j) {
                    const Point2 b0 = hb[j], b1 = hb[(j + 1) % hb.size()];
                    const geom::SegIntersection r = geom::segmentIntersect(a0, a1, b0, b1);
                    if (r.relation != geom::SegRelation::DISJOINT) {
                        res.reason = "holes overlap"; return res;
                    }
                }
            }
            // one hole nested in another?
            if (pointInCCW(hb[0], ha) == 1 || pointInCCW(ha[0], hb) == 1) {
                res.reason = "nested holes"; return res;
            }
        }
    }

    // ---- 2. validate the path --------------------------------------------
    PathInfo pi = analysePath(path);
    if (!pi.ok) { res.reason = pi.reason; return res; }

    const std::size_t nSec = pi.pts.size();          // number of cross-sections
    const std::size_t nSeg = nSec - 1;               // number of path segments

    // ---- 3. build the profile vertex list (outer then each hole), and the
    //         per-loop edge list (each loop contributes ring edges). ----------
    struct Loop { std::uint32_t start, count; bool ccw; };
    std::vector<Point2> P2;                 // all profile vertices (2D)
    std::vector<Loop>   loops;
    {
        Loop L{0, static_cast<std::uint32_t>(outer.size()), true};
        for (const Point2& p : outer) P2.push_back(p);
        loops.push_back(L);
        for (const auto& h : profile.holes) {
            Loop H{static_cast<std::uint32_t>(P2.size()),
                   static_cast<std::uint32_t>(h.size()), false};
            for (const Point2& p : h) P2.push_back(p);
            loops.push_back(H);
        }
    }
    const std::size_t profN = P2.size();

    // ---- 4. build the transport frames along the spine --------------------
    // Local sketch basis (U,V) at section 0, with plane normal = tangent[0].
    Vec3 N0 = pi.tangents[0];
    Vec3 U0, V0;
    {
        // any vector not parallel to N0
        Vec3 a = (std::fabs(N0.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        U0 = vcross(a, N0);
        if (!vnormalize(U0)) { res.reason = "degenerate frame"; return res; }
        V0 = vcross(N0, U0);
        vnormalize(V0);
    }

    // Rotation-minimising transport of (U,V) per SECTION via double reflection.
    // tangentAtSection[i] = the *reference* tangent used to carry the frame:
    //   section 0 uses tangent[0]; interior section i (1..nSeg-1) uses the
    //   bisector of tangent[i-1] and tangent[i]; last section uses tangent[nSeg-1].
    std::vector<Vec3> secNormal(nSec);    // section plane normal (miter)
    std::vector<Vec3> secU(nSec), secV(nSec);
    std::vector<double> secScaleU(nSec, 1.0), secScaleV(nSec, 1.0);

    secNormal[0] = N0;
    secU[0] = U0; secV[0] = V0;

    // We carry the frame along consecutive SEGMENT tangents using RMF, then
    // build each section's miter plane and project the carried (U,V) into it.
    Vec3 curU = U0, curV = V0, curT = N0, curPos = pi.pts[0];

    auto rmfStep = [](const Vec3& x0, const Vec3& t0, const Vec3& t1, Vec3& x1) {
        // double-reflection RMF (Wang et al.). x0 is a unit reference vector
        // orthogonal to t0; produce x1 orthogonal to t1 with minimal rotation.
        // Reflection 1: across plane bisecting t0 and the point... we use the
        // standard formulation reflecting in the segment + tangent.
        // R1 reflects across the plane with normal (t1 - t0) direction is not
        // robust at t0==t1; handle that case as identity.
        const Vec3 c = Vec3{t1.x - t0.x, t1.y - t0.y, t1.z - t0.z};
        const double c1 = c.x * c.x + c.y * c.y + c.z * c.z;
        if (c1 < 1e-300) { x1 = x0; return; }
        // reflect x0 in plane normal c: x' = x0 - 2*(x0.c)/c1 * c
        const double d0 = (x0.x * c.x + x0.y * c.y + x0.z * c.z);
        Vec3 xr{ x0.x - (2.0 * d0 / c1) * c.x,
                 x0.y - (2.0 * d0 / c1) * c.y,
                 x0.z - (2.0 * d0 / c1) * c.z };
        Vec3 tr{ t0.x - (2.0 * (t0.x * c.x + t0.y * c.y + t0.z * c.z) / c1) * c.x,
                 t0.y - (2.0 * (t0.x * c.x + t0.y * c.y + t0.z * c.z) / c1) * c.y,
                 t0.z - (2.0 * (t0.x * c.x + t0.y * c.y + t0.z * c.z) / c1) * c.z };
        // reflect again to map tr -> t1
        const Vec3 c2v = Vec3{t1.x - tr.x, t1.y - tr.y, t1.z - tr.z};
        const double c2 = c2v.x * c2v.x + c2v.y * c2v.y + c2v.z * c2v.z;
        if (c2 < 1e-300) { x1 = xr; return; }
        const double d1 = (xr.x * c2v.x + xr.y * c2v.y + xr.z * c2v.z);
        x1 = Vec3{ xr.x - (2.0 * d1 / c2) * c2v.x,
                   xr.y - (2.0 * d1 / c2) * c2v.y,
                   xr.z - (2.0 * d1 / c2) * c2v.z };
    };

    for (std::size_t s = 1; s < nSec; ++s) {
        // carry frame from tangent of segment (s-1)'s start to its end.
        const Vec3 tPrev = pi.tangents[s - 1];
        Vec3 newU, newV;
        rmfStep(curU, curT, tPrev, newU);
        rmfStep(curV, curT, tPrev, newV);
        curU = newU; curV = newV; curT = tPrev; curPos = pi.pts[s];
        secU[s] = curU; secV[s] = curV;

        if (s == nSec - 1) {
            secNormal[s] = tPrev;          // end cap uses last tangent
        } else {
            // interior joint: miter plane normal = bisector of incoming/outgoing.
            Vec3 nb = vadd(pi.tangents[s - 1], pi.tangents[s]);
            if (!vnormalize(nb)) { res.reason = "undefined miter plane"; return res; }
            secNormal[s] = nb;
        }
        (void)curPos;
    }

    // ---- 5. place every profile vertex at every section -------------------
    // For section s, a profile point with local (u,v) starts as the 3D ray
    //   ray(t) = pi.pts[s] + u*secU[s] + v*secV[s] + t*tangentIncoming
    // and we intersect it with the section plane (point pi.pts[s], normal
    // secNormal[s]) so that the side walls of consecutive segments meet exactly.
    // For end sections the plane normal IS the tangent so t == 0 (no shift).
    std::vector<Vec3> V3(nSec * profN);

    for (std::size_t s = 0; s < nSec; ++s) {
        const Vec3 origin = pi.pts[s];
        const Vec3 nrm = secNormal[s];
        // incoming tangent: segment (s-1) for s>0 else segment 0; we slide along
        // the outgoing tangent for s==0, incoming for s>0 — both lie in walls.
        const Vec3 slide = (s == 0) ? pi.tangents[0] : pi.tangents[s - 1];
        const double nd = vdot(nrm, slide);
        if (std::fabs(nd) < 1e-12) { res.reason = "grazing miter (section parallel to wall)"; return res; }
        for (std::size_t k = 0; k < profN; ++k) {
            const Vec3 base = vadd(origin,
                                   vadd(vscale(secU[s], P2[k].x),
                                        vscale(secV[s], P2[k].y)));
            // solve nrm . (base + t*slide - origin) = 0
            const double t = -vdot(nrm, vsub(base, origin)) / nd;
            V3[s * profN + k] = vadd(base, vscale(slide, t));
        }
    }

    // ---- 6. emit the triangle soup ----------------------------------------
    // positions
    std::vector<double> positions;
    positions.reserve(nSec * profN * 3);
    for (std::size_t s = 0; s < nSec; ++s)
        for (std::size_t k = 0; k < profN; ++k) {
            const Vec3& p = V3[s * profN + k];
            positions.push_back(p.x);
            positions.push_back(p.y);
            positions.push_back(p.z);
        }
    auto vid = [&](std::size_t s, std::uint32_t k) -> std::uint32_t {
        return static_cast<std::uint32_t>(s * profN + k);
    };

    std::vector<std::uint32_t> indices;

    // Side walls: for each loop, each ring edge (a->b in the loop's local
    // direction) sweeps a quad between consecutive sections. Outward winding:
    //   the OUTER loop is CCW in (U,V); walking outer edge a->b, the wall faces
    //   outward when the quad (s:a, s:b, s+1:b, s+1:a) is wound so its normal
    //   points away from the spine. We split into triangles (a_s, b_s, b_{s+1})
    //   and (a_s, b_{s+1}, a_{s+1}). For HOLE loops (CW) the same formula yields
    //   inward-facing-to-the-hole == outward-from-solid walls automatically,
    //   because the hole is traversed CW.
    for (const Loop& L : loops) {
        for (std::uint32_t e = 0; e < L.count; ++e) {
            const std::uint32_t ka = L.start + e;
            const std::uint32_t kb = L.start + (e + 1) % L.count;
            for (std::size_t s = 0; s + 1 < nSec; ++s) {
                const std::uint32_t a0 = vid(s, ka);
                const std::uint32_t b0 = vid(s, kb);
                const std::uint32_t a1 = vid(s + 1, ka);
                const std::uint32_t b1 = vid(s + 1, kb);
                // tri 1: a0, b0, b1 ; tri 2: a0, b1, a1
                indices.push_back(a0); indices.push_back(b0); indices.push_back(b1);
                indices.push_back(a0); indices.push_back(b1); indices.push_back(a1);
            }
        }
    }

    // Caps: triangulate the profile (outer + holes merged) once in 2D, then
    // emit at section 0 (start, reversed winding) and section nSec-1 (end).
    std::vector<Point2> capPts;
    std::vector<std::uint32_t> capLoop;
    if (!mergeHoles(outer, profile.holes, capPts, capLoop)) {
        res.reason = "cap hole-merge failed"; return res;
    }
    // capPts is a fresh point array; we must map cap vertices back to the
    // profile-vertex indices used above. mergeHoles preserves the outer/hole
    // vertex ORDER (outer first, then each hole in order), with duplicated
    // bridge endpoints appended at the end of capPts that we must NOT add as new
    // mesh vertices — instead map them to the matching profile index by value.
    // To keep this exact, we rebuild a value->profileIndex map from P2.
    auto mapToProfileIndex = [&](const Point2& p) -> long {
        for (std::size_t k = 0; k < P2.size(); ++k)
            if (P2[k].x == p.x && P2[k].y == p.y) return static_cast<long>(k);
        return -1;
    };

    std::vector<std::array<std::uint32_t, 3>> capTris;
    if (!earClip(capPts, capLoop, capTris)) {
        res.reason = "cap triangulation failed (non-simple profile)"; return res;
    }

    // start cap (section 0): reverse winding so normal points -tangent (outward
    // at the start of the tube).
    for (const auto& tri : capTris) {
        const long m0 = mapToProfileIndex(capPts[tri[0]]);
        const long m1 = mapToProfileIndex(capPts[tri[1]]);
        const long m2 = mapToProfileIndex(capPts[tri[2]]);
        if (m0 < 0 || m1 < 0 || m2 < 0) { res.reason = "cap index map failed"; return res; }
        const std::uint32_t i0 = vid(0, static_cast<std::uint32_t>(m0));
        const std::uint32_t i1 = vid(0, static_cast<std::uint32_t>(m1));
        const std::uint32_t i2 = vid(0, static_cast<std::uint32_t>(m2));
        // reversed
        indices.push_back(i0); indices.push_back(i2); indices.push_back(i1);
    }
    // end cap (section nSec-1): forward winding (normal +tangent).
    for (const auto& tri : capTris) {
        const long m0 = mapToProfileIndex(capPts[tri[0]]);
        const long m1 = mapToProfileIndex(capPts[tri[1]]);
        const long m2 = mapToProfileIndex(capPts[tri[2]]);
        const std::uint32_t i0 = vid(nSec - 1, static_cast<std::uint32_t>(m0));
        const std::uint32_t i1 = vid(nSec - 1, static_cast<std::uint32_t>(m1));
        const std::uint32_t i2 = vid(nSec - 1, static_cast<std::uint32_t>(m2));
        indices.push_back(i0); indices.push_back(i1); indices.push_back(i2);
    }

    // ---- 7. build + validate the half-edge solid -------------------------
    mesh::HalfEdgeMesh hem;
    if (!hem.buildFromSoup(positions, indices)) {
        res.reason = "emitted soup is not a consistent manifold (build failed)";
        return res;
    }
    const mesh::ValidityReport vr = hem.validate();
    if (!vr.isValid()) {
        res.reason = "emitted solid failed watertight/2-manifold validation";
        return res;
    }
    double vol = hem.signedVolume();
    if (vol < 0.0) {
        res.reason = "emitted solid has inverted (negative) volume";
        return res;
    }

    // Success.
    res.ok = true;
    res.solid = std::move(hem);
    res.volume = vol;
    res.area = res.solid.surfaceArea();
    res.eulerChar = vr.eulerChar;
    res.positions = std::move(positions);
    res.indices = std::move(indices);
    res.reason = "";
    (void)nSeg;
    return res;
}

// ===========================================================================
// Public: prism
// ===========================================================================
SweepResult prism(const Profile& profile, double length) {
    SweepResult res;
    if (!(length > 0.0)) { res.reason = "prism length must be > 0"; return res; }
    std::vector<geom::Point3> path = {
        geom::Point3{0.0, 0.0, 0.0},
        geom::Point3{0.0, 0.0, length}
    };
    return sweep(profile, path);
}

} // namespace brep
} // namespace native
} // namespace forge
