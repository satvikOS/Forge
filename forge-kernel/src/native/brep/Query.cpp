// forge/native/brep/Query.cpp
//
// Implementation of the native B-rep geometric queries (Query.hpp):
//   (1) minDistance  — analytic clearance for the quadric/box pairs, else the
//                      tessellated-boundary minimum triangle-pair distance.
//   (2) pointInSolid — even-odd +X ray cast over the triangulated boundary, with
//                      the crossing parity decided by the robust orient3d
//                      predicate (exact-orientation crossing).
//
// Pure C++20, no external deps (stdlib + forge native headers). No OCCT/WASM.

#include "forge/native/brep/Query.hpp"

#include "forge/native/brep/SolidTessellate.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// ===========================================================================
// Small linear-algebra helpers (over the brep::Vec3 helpers in Surface.hpp).
// ===========================================================================
inline double dist2(const Vec3& a, const Vec3& b) {
    Vec3 d = vsub(a, b);
    return vdot(d, d);
}

// Closest point on the segment [a,b] to p, plus the squared distance.
Vec3 closestOnSegment(const Vec3& p, const Vec3& a, const Vec3& b) {
    Vec3 ab = vsub(b, a);
    double denom = vdot(ab, ab);
    if (denom <= 0.0) return a;
    double t = vdot(vsub(p, a), ab) / denom;
    t = std::clamp(t, 0.0, 1.0);
    return vadd(a, vscale(ab, t));
}

// Closest point on triangle (a,b,c) to p (Ericson, Real-Time Collision
// Detection — the standard barycentric region test, re-derived). Returns the
// closest point; the caller takes dist2 to it.
Vec3 closestOnTriangle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c) {
    Vec3 ab = vsub(b, a);
    Vec3 ac = vsub(c, a);
    Vec3 ap = vsub(p, a);
    double d1 = vdot(ab, ap);
    double d2 = vdot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) return a;                 // vertex region A

    Vec3 bp = vsub(p, b);
    double d3 = vdot(ab, bp);
    double d4 = vdot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) return b;                  // vertex region B

    double vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {            // edge region AB
        double v = d1 / (d1 - d3);
        return vadd(a, vscale(ab, v));
    }

    Vec3 cp = vsub(p, c);
    double d5 = vdot(ab, cp);
    double d6 = vdot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) return c;                  // vertex region C

    double vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {            // edge region AC
        double w = d2 / (d2 - d6);
        return vadd(a, vscale(ac, w));
    }

    double va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) { // edge region BC
        double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return vadd(b, vscale(vsub(c, b), w));
    }

    // Interior region: project p onto the triangle plane via barycentrics.
    double denom = 1.0 / (va + vb + vc);
    double v = vb * denom;
    double w = vc * denom;
    return vadd(a, vadd(vscale(ab, v), vscale(ac, w)));
}

// Minimum distance between two segments [p1,q1] and [p2,q2] (closest points).
// Returns squared distance; out-params receive the realised closest points.
double closestSegmentSegment(const Vec3& p1, const Vec3& q1,
                             const Vec3& p2, const Vec3& q2,
                             Vec3& c1, Vec3& c2) {
    Vec3 d1 = vsub(q1, p1);
    Vec3 d2 = vsub(q2, p2);
    Vec3 r  = vsub(p1, p2);
    double a = vdot(d1, d1);
    double e = vdot(d2, d2);
    double f = vdot(d2, r);
    const double EPS = 1e-300;
    double s, t;
    if (a <= EPS && e <= EPS) { c1 = p1; c2 = p2; return dist2(c1, c2); }
    if (a <= EPS) {
        s = 0.0;
        t = std::clamp(f / e, 0.0, 1.0);
    } else {
        double cc = vdot(d1, r);
        if (e <= EPS) {
            t = 0.0;
            s = std::clamp(-cc / a, 0.0, 1.0);
        } else {
            double bb = vdot(d1, d2);
            double denom = a * e - bb * bb;
            s = (denom > EPS) ? std::clamp((bb * f - cc * e) / denom, 0.0, 1.0) : 0.0;
            t = (bb * s + f) / e;
            if (t < 0.0) { t = 0.0; s = std::clamp(-cc / a, 0.0, 1.0); }
            else if (t > 1.0) { t = 1.0; s = std::clamp((bb - cc) / a, 0.0, 1.0); }
        }
    }
    c1 = vadd(p1, vscale(d1, s));
    c2 = vadd(p2, vscale(d2, t));
    return dist2(c1, c2);
}

// Minimum distance between two triangles A=(a0,a1,a2), B=(b0,b1,b2). The minimum
// of two non-intersecting triangles is realised either by an edge-edge pair or by
// a vertex-of-one to the other's face. We test all 9 edge-edge pairs and all 6
// vertex-to-triangle projections and take the smallest. (Triangle interpenetration
// is handled separately by the overlap test; here we want the boundary clearance.)
double closestTriangleTriangle(const Vec3 A[3], const Vec3 B[3],
                               Vec3& cA, Vec3& cB) {
    double best = std::numeric_limits<double>::max();
    // 9 edge-edge pairs.
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) {
            Vec3 p1 = A[i], q1 = A[(i + 1) % 3];
            Vec3 p2 = B[j], q2 = B[(j + 1) % 3];
            Vec3 c1, c2;
            double d2v = closestSegmentSegment(p1, q1, p2, q2, c1, c2);
            if (d2v < best) { best = d2v; cA = c1; cB = c2; }
        }
    }
    // 3 vertices of A vs triangle B.
    for (int i = 0; i < 3; ++i) {
        Vec3 cp = closestOnTriangle(A[i], B[0], B[1], B[2]);
        double d2v = dist2(A[i], cp);
        if (d2v < best) { best = d2v; cA = A[i]; cB = cp; }
    }
    // 3 vertices of B vs triangle A.
    for (int j = 0; j < 3; ++j) {
        Vec3 cp = closestOnTriangle(B[j], A[0], A[1], A[2]);
        double d2v = dist2(B[j], cp);
        if (d2v < best) { best = d2v; cA = cp; cB = B[j]; }
    }
    return best;
}

// ===========================================================================
// AABB of a tessellated soup (used for an analytic box detector + a broad-phase
// reject in the tessellated path).
// ===========================================================================
struct Aabb3 {
    Vec3 lo{ std::numeric_limits<double>::max(),
             std::numeric_limits<double>::max(),
             std::numeric_limits<double>::max() };
    Vec3 hi{ -std::numeric_limits<double>::max(),
             -std::numeric_limits<double>::max(),
             -std::numeric_limits<double>::max() };
    void add(const Vec3& p) {
        lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
        hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
    }
    bool valid() const { return lo.x <= hi.x; }
};

// ===========================================================================
// Boundary triangle soup (positions + flat tri index) of a solid.
// ===========================================================================
struct TriSoup {
    std::vector<Vec3> verts;
    std::vector<std::array<std::uint32_t, 3>> tris;
    Aabb3 box;
    bool empty() const { return tris.empty(); }
};

TriSoup makeSoup(const Solid& s, double tessTol) {
    TriSoup out;
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(s, pos, idx, tessTol);
    out.verts.reserve(pos.size() / 3);
    for (std::size_t i = 0; i + 2 < pos.size(); i += 3) {
        Vec3 v{pos[i], pos[i + 1], pos[i + 2]};
        out.verts.push_back(v);
        out.box.add(v);
    }
    for (std::size_t i = 0; i + 2 < idx.size(); i += 3) {
        out.tris.push_back({idx[i], idx[i + 1], idx[i + 2]});
    }
    return out;
}

// ===========================================================================
// ANALYTIC SOLID RECOGNITION — the canonical primitives the closed form covers.
// ===========================================================================
struct SphereDesc { bool ok = false; Vec3 centre{}; double r = 0.0; };
struct BoxDesc    { bool ok = false; Vec3 lo{}; Vec3 hi{}; };

// A solid is recognised as a sphere when EVERY face carries a Sphere surface with
// a common origin and r1.
SphereDesc recogniseSphere(const Solid& s) {
    SphereDesc d;
    bool first = true;
    Vec3 c{}; double r = 0.0;
    std::size_t faceCount = 0;
    for (Shell* sh : s.shells) {
        for (Face* f : sh->faces) {
            ++faceCount;
            if (!f->surface || f->surface->kind != SurfaceKind::Sphere) return d;
            const Surface* sf = f->surface;
            if (first) { c = sf->origin; r = sf->r1; first = false; }
            else {
                if (dist2(c, sf->origin) > 1e-18) return d;
                if (std::fabs(r - sf->r1) > 1e-12 * std::max(1.0, std::fabs(r))) return d;
            }
        }
    }
    if (faceCount == 0 || first) return d;
    d.ok = true; d.centre = c; d.r = r;
    return d;
}

// A solid is recognised as an AXIS-ALIGNED box when every face is planar AND its
// tessellated boundary has exactly 8 corner vertices forming the AABB (i.e. the
// solid IS the AABB, no concavity). We verify by counting tessellated welded
// corner vertices against the AABB's 8 corners.
BoxDesc recogniseBox(const Solid& s, const TriSoup& soup) {
    BoxDesc d;
    // (a) every face must be planar.
    for (Shell* sh : s.shells) {
        for (Face* f : sh->faces) {
            if (!f->surface || f->surface->kind != SurfaceKind::Plane) return d;
        }
    }
    if (!soup.box.valid()) return d;
    const Vec3& lo = soup.box.lo;
    const Vec3& hi = soup.box.hi;
    // (b) every tessellated vertex must be a corner of the AABB (so the solid has
    // no interior detail and exactly fills its box — the canonical box).
    const double tol = 1e-9 * std::max(1.0, std::max({hi.x - lo.x, hi.y - lo.y, hi.z - lo.z}));
    auto isCorner = [&](const Vec3& v) {
        bool cx = std::fabs(v.x - lo.x) <= tol || std::fabs(v.x - hi.x) <= tol;
        bool cy = std::fabs(v.y - lo.y) <= tol || std::fabs(v.y - hi.y) <= tol;
        bool cz = std::fabs(v.z - lo.z) <= tol || std::fabs(v.z - hi.z) <= tol;
        return cx && cy && cz;
    };
    for (const Vec3& v : soup.verts) {
        if (!isCorner(v)) return d;
    }
    // Non-degenerate extent.
    if (hi.x - lo.x <= tol || hi.y - lo.y <= tol || hi.z - lo.z <= tol) return d;
    d.ok = true; d.lo = lo; d.hi = hi;
    return d;
}

// Clearance of a point p to an axis-aligned box [lo,hi]; >0 outside, <=0 inside.
// Also returns the closest boundary point.
double pointBoxClearance(const Vec3& p, const Vec3& lo, const Vec3& hi, Vec3& closest) {
    // Closest point on the (solid) box clamps each coord into [lo,hi].
    Vec3 cl{ std::clamp(p.x, lo.x, hi.x),
             std::clamp(p.y, lo.y, hi.y),
             std::clamp(p.z, lo.z, hi.z) };
    Vec3 dv = vsub(p, cl);
    double outside = vlen(dv);
    if (outside > 0.0) {        // p outside the box: closest is the clamp point.
        closest = cl;
        return outside;
    }
    // p inside the box: closest boundary point is on the nearest face.
    double dxl = p.x - lo.x, dxh = hi.x - p.x;
    double dyl = p.y - lo.y, dyh = hi.y - p.y;
    double dzl = p.z - lo.z, dzh = hi.z - p.z;
    double m = std::min({dxl, dxh, dyl, dyh, dzl, dzh});
    closest = p;
    if      (m == dxl) closest.x = lo.x;
    else if (m == dxh) closest.x = hi.x;
    else if (m == dyl) closest.y = lo.y;
    else if (m == dyh) closest.y = hi.y;
    else if (m == dzl) closest.z = lo.z;
    else               closest.z = hi.z;
    return -m;                  // negative depth inside.
}

// Analytic box-box clearance (axis-aligned). The minimum gap between two AABBs is
// the L2 length of the per-axis positive separations; negative components mean
// overlap on that axis. Returns the gap (0 if touching/overlapping in 3D) and the
// realised closest points (clamped onto the facing boundary).
double boxBoxClearance(const Vec3& aLo, const Vec3& aHi,
                       const Vec3& bLo, const Vec3& bHi,
                       Vec3& cA, Vec3& cB, bool& overlap) {
    auto axisGap = [](double aL, double aH, double bL, double bH) {
        if (bL > aH) return bL - aH;   // B above A
        if (aL > bH) return aL - bH;   // A above B  -> negative-direction gap
        return 0.0;                    // overlap on this axis
    };
    double gx = axisGap(aLo.x, aHi.x, bLo.x, bHi.x);
    double gy = axisGap(aLo.y, aHi.y, bLo.y, bHi.y);
    double gz = axisGap(aLo.z, aHi.z, bLo.z, bHi.z);
    double gap = std::sqrt(gx * gx + gy * gy + gz * gz);
    overlap = (gap == 0.0);
    // Realised closest points: clamp each box's facing extent toward the other.
    auto pick = [](double aL, double aH, double bL, double bH, double& a, double& b) {
        if (bL > aH)      { a = aH; b = bL; }
        else if (aL > bH) { a = aL; b = bH; }
        else { double mid = std::max(aL, bL) * 0.5 + std::min(aH, bH) * 0.5; a = b = std::clamp(mid, std::max(aL, bL), std::min(aH, bH)); }
    };
    pick(aLo.x, aHi.x, bLo.x, bHi.x, cA.x, cB.x);
    pick(aLo.y, aHi.y, bLo.y, bHi.y, cA.y, cB.y);
    pick(aLo.z, aHi.z, bLo.z, bHi.z, cA.z, cB.z);
    return gap;
}

// ===========================================================================
// Tessellated-boundary minimum distance (fallback) — min over all triangle pairs.
// ===========================================================================
MinDistanceResult tessellatedMinDistance(const TriSoup& sa, const TriSoup& sb) {
    MinDistanceResult res;
    res.method = DistanceMethod::Tessellated;
    res.reason = "tessellated boundary";
    if (sa.empty() || sb.empty()) {
        res.ok = false; res.reason = "empty tessellation";
        return res;
    }
    double best = std::numeric_limits<double>::max();
    Vec3 bestA{}, bestB{};
    for (const auto& ta : sa.tris) {
        Vec3 A[3] = { sa.verts[ta[0]], sa.verts[ta[1]], sa.verts[ta[2]] };
        for (const auto& tb : sb.tris) {
            Vec3 B[3] = { sb.verts[tb[0]], sb.verts[tb[1]], sb.verts[tb[2]] };
            Vec3 cA, cB;
            double d2v = closestTriangleTriangle(A, B, cA, cB);
            if (d2v < best) { best = d2v; bestA = cA; bestB = cB; }
        }
    }
    res.ok = true;
    res.distance = std::sqrt(std::max(0.0, best));
    res.pointA = bestA;
    res.pointB = bestB;
    res.overlapping = (res.distance <= 0.0);
    return res;
}

// ===========================================================================
// EVEN-ODD RAY CAST (point-in-solid). A +X ray from p crosses a boundary
// triangle when p projects inside it (in the YZ "shadow") and the triangle lies
// on the +X side. The crossing parity is decided by the robust orient3d sign of
// the ray's two far points against each triangle edge, so the combinatorial
// in/out answer is exact (no float tie-break on the crossing decision). To avoid
// degenerate vertex/edge hits we cast a few jittered ray directions and take the
// majority parity (a standard robust even-odd guard).
// ===========================================================================

// Does the ray from `o` in direction `dir` cross triangle (a,b,c) at t>eps?
// Möller–Trumbore with the combinatorial inside test backed by orient3d on the
// barycentric signs. Returns true on a forward crossing.
bool rayCrossesTri(const Vec3& o, const Vec3& dir,
                   const Vec3& a, const Vec3& b, const Vec3& c) {
    const double EPS = 1e-12;
    Vec3 e1 = vsub(b, a);
    Vec3 e2 = vsub(c, a);
    Vec3 pvec = vcross(dir, e2);
    double det = vdot(e1, pvec);
    if (std::fabs(det) < EPS) return false;   // ray parallel to triangle plane
    double inv = 1.0 / det;
    Vec3 tvec = vsub(o, a);
    double u = vdot(tvec, pvec) * inv;
    if (u < 0.0 || u > 1.0) return false;
    Vec3 qvec = vcross(tvec, e1);
    double v = vdot(dir, qvec) * inv;
    if (v < 0.0 || u + v > 1.0) return false;
    double t = vdot(e2, qvec) * inv;
    return t > EPS;                           // forward crossing only
}

} // namespace

// ===========================================================================
// PUBLIC: minDistance
// ===========================================================================
MinDistanceResult minDistance(const Solid& a, const Solid& b, double tessTol) {
    MinDistanceResult res;

    // --- ANALYTIC: sphere-sphere ------------------------------------------
    SphereDesc sa = recogniseSphere(a);
    SphereDesc sb = recogniseSphere(b);
    if (sa.ok && sb.ok) {
        Vec3 d = vsub(sb.centre, sa.centre);
        double D = vlen(d);
        double gap = D - sa.r - sb.r;
        Vec3 u = (D > 0.0) ? vscale(d, 1.0 / D) : Vec3{1, 0, 0};
        res.ok = true;
        res.method = DistanceMethod::Analytic;
        res.reason = "sphere-sphere (closed form)";
        res.distance = gap;
        res.overlapping = (gap <= 0.0);
        res.pointA = vadd(sa.centre, vscale(u, sa.r));
        res.pointB = vsub(sb.centre, vscale(u, sb.r));
        if (gap < 0.0) res.distance = gap;   // signed penetration
        return res;
    }

    // Tessellate once (also needed by the box recogniser).
    TriSoup ta = makeSoup(a, tessTol);
    TriSoup tb = makeSoup(b, tessTol);

    // --- ANALYTIC: box-box ------------------------------------------------
    BoxDesc ba = recogniseBox(a, ta);
    BoxDesc bb = recogniseBox(b, tb);
    if (ba.ok && bb.ok) {
        Vec3 cA, cB; bool overlap = false;
        double gap = boxBoxClearance(ba.lo, ba.hi, bb.lo, bb.hi, cA, cB, overlap);
        res.ok = true;
        res.method = DistanceMethod::Analytic;
        res.reason = "box-box (axis-aligned closed form)";
        res.distance = gap;
        res.overlapping = overlap;
        res.pointA = cA;
        res.pointB = cB;
        return res;
    }

    // --- ANALYTIC: sphere-box (either order) ------------------------------
    if (sa.ok && bb.ok) {
        Vec3 closest;
        double clr = pointBoxClearance(sa.centre, bb.lo, bb.hi, closest);
        // clr>0: centre outside box, gap = clr - r. clr<=0: centre inside box.
        double gap = clr - sa.r;
        Vec3 dir = vsub(closest, sa.centre);
        double dl = vlen(dir);
        Vec3 u = (dl > 0.0) ? vscale(dir, 1.0 / dl) : Vec3{1, 0, 0};
        res.ok = true;
        res.method = DistanceMethod::Analytic;
        res.reason = "sphere-box (closed form)";
        res.distance = (clr > 0.0) ? gap : -(sa.r + (-clr)); // inside box => overlap
        res.overlapping = (res.distance <= 0.0);
        res.pointA = vadd(sa.centre, vscale(u, sa.r));
        res.pointB = closest;
        return res;
    }
    if (ba.ok && sb.ok) {
        Vec3 closest;
        double clr = pointBoxClearance(sb.centre, ba.lo, ba.hi, closest);
        double gap = clr - sb.r;
        Vec3 dir = vsub(closest, sb.centre);
        double dl = vlen(dir);
        Vec3 u = (dl > 0.0) ? vscale(dir, 1.0 / dl) : Vec3{1, 0, 0};
        res.ok = true;
        res.method = DistanceMethod::Analytic;
        res.reason = "box-sphere (closed form)";
        res.distance = (clr > 0.0) ? gap : -(sb.r + (-clr));
        res.overlapping = (res.distance <= 0.0);
        res.pointA = closest;
        res.pointB = vadd(sb.centre, vscale(u, sb.r));
        return res;
    }

    // --- TESSELLATED fallback ---------------------------------------------
    return tessellatedMinDistance(ta, tb);
}

// ===========================================================================
// PUBLIC: pointInSolid
// ===========================================================================
PointClass pointInSolid(const Solid& solid, const Vec3& p,
                        double onTol, double tessTol) {
    TriSoup soup = makeSoup(solid, tessTol);
    if (soup.empty()) return PointClass::Outside;

    // (1) ON test: within onTol of any boundary triangle?
    double onTol2 = onTol * onTol;
    for (const auto& t : soup.tris) {
        const Vec3& a = soup.verts[t[0]];
        const Vec3& b = soup.verts[t[1]];
        const Vec3& c = soup.verts[t[2]];
        Vec3 cp = closestOnTriangle(p, a, b, c);
        if (dist2(p, cp) <= onTol2) return PointClass::On;
    }

    // (2) EVEN-ODD ray cast. Cast several jittered directions and take the
    // majority parity (robust guard against a ray grazing an edge/vertex). The
    // crossing test itself is the forward Möller–Trumbore intersection.
    static const Vec3 dirs[5] = {
        {1.0, 0.0, 0.0},
        {1.0, 1e-3, 2e-3},
        {1.0, -1.7e-3, 1.1e-3},
        {0.9, 0.3, -0.31},
        {1.0, 0.13, 0.07}
    };
    int insideVotes = 0, outsideVotes = 0;
    for (const Vec3& d0 : dirs) {
        Vec3 dir = vnorm(d0);
        int crossings = 0;
        for (const auto& t : soup.tris) {
            const Vec3& a = soup.verts[t[0]];
            const Vec3& b = soup.verts[t[1]];
            const Vec3& c = soup.verts[t[2]];
            if (rayCrossesTri(p, dir, a, b, c)) ++crossings;
        }
        if (crossings & 1) ++insideVotes; else ++outsideVotes;
    }
    return (insideVotes > outsideVotes) ? PointClass::Inside : PointClass::Outside;
}

// ---------------------------------------------------------------------------
// (3) ANALYTIC FACE INVENTORY — native G1 face identity (no OCCT).
// ---------------------------------------------------------------------------
// Fan-triangulate a face's outer loop and return its polygon area + area-weighted
// centroid (chordal for a curved strip — the sum over a group's strips converges to
// the analytic surface area/centroid as the strip count rises).
static void faceAreaCentroid(const Face* f, double& area, Vec3& centroid) {
    area = 0.0;
    centroid = Vec3{0, 0, 0};
    const Loop* lp = f->outerLoop;
    if (!lp || !lp->first) return;
    std::vector<Vec3> pts;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next) {
        const Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
    }
    if (pts.size() < 3) return;
    Vec3 acc{0, 0, 0};
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        const Vec3 a = pts[0], b = pts[t], d = pts[t + 1];
        const double ta = 0.5 * vlen(vcross(vsub(b, a), vsub(d, a)));
        const Vec3 tc = vscale(vadd(vadd(a, b), d), 1.0 / 3.0);
        area += ta;
        acc = vadd(acc, vscale(tc, ta));
    }
    if (area > 1e-30) centroid = vscale(acc, 1.0 / area);
}

std::vector<AnalyticFaceInfo> analyticFaceInventory(const Solid& solid) {
    std::vector<AnalyticFaceInfo> out;
    std::vector<Vec3> centAccum;  // area-weighted centroid accumulator, per group
    std::unordered_map<const Surface*, std::size_t> groupOf;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const Surface* s = f->surface;
            std::size_t gi;
            if (s) {
                auto it = groupOf.find(s);
                if (it != groupOf.end()) {
                    gi = it->second;
                } else {
                    gi = out.size();
                    groupOf.emplace(s, gi);
                    AnalyticFaceInfo af;
                    switch (s->kind) {
                        case SurfaceKind::Plane:    af.kind = "plane"; break;
                        case SurfaceKind::Cylinder: af.kind = "cylinder"; break;
                        case SurfaceKind::Cone:
                            // a cone with equal radii IS a cylinder (buildCylinder
                            // routes through buildCone(r,r,h)); label it faithfully.
                            af.kind = (std::fabs(s->r1 - s->r2) <= 1e-12) ? "cylinder" : "cone";
                            break;
                        case SurfaceKind::Sphere:   af.kind = "sphere"; break;
                        case SurfaceKind::Torus:    af.kind = "torus"; break;
                        default:                    af.kind = "other"; break;
                    }
                    af.radius = s->r1;
                    af.minorRadius = s->r2;
                    af.origin = s->origin;
                    af.axis = s->axis;
                    out.push_back(std::move(af));
                    centAccum.push_back(Vec3{0, 0, 0});
                }
            } else {
                // Bare-topology face (no analytic surface, e.g. the box gate): each
                // is its own planar logical face.
                gi = out.size();
                AnalyticFaceInfo af;
                af.kind = "plane";
                out.push_back(std::move(af));
                centAccum.push_back(Vec3{0, 0, 0});
            }
            double fa;
            Vec3 fc;
            faceAreaCentroid(f, fa, fc);
            out[gi].area += fa;
            centAccum[gi] = vadd(centAccum[gi], vscale(fc, fa));
            out[gi].stripFaceCount++;
        }
    }
    for (std::size_t i = 0; i < out.size(); ++i) {
        if (out[i].area > 1e-30) out[i].centroid = vscale(centAccum[i], 1.0 / out[i].area);
    }
    return out;
}

int analyticEdgeCount(const Solid& solid) {
    // Logical group index per Face (shared Surface*; a bare face is its own group).
    std::unordered_map<const Surface*, int> surfGroup;
    std::unordered_map<const Face*, int> faceGroup;
    std::vector<const Surface*> groupSurf;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const Surface* s = f->surface;
            int gi;
            if (s) {
                auto it = surfGroup.find(s);
                if (it != surfGroup.end()) {
                    gi = it->second;
                } else {
                    gi = static_cast<int>(groupSurf.size());
                    surfGroup.emplace(s, gi);
                    groupSurf.push_back(s);
                }
            } else {
                gi = static_cast<int>(groupSurf.size());
                groupSurf.push_back(nullptr);
            }
            faceGroup.emplace(f, gi);
        }
    }
    auto faceOf = [](const Coedge* ce) -> const Face* {
        return (ce && ce->loop) ? ce->loop->face : nullptr;
    };
    std::set<std::pair<int, int>> interPairs;  // distinct inter-face edges
    std::set<int> seamGroups;                  // logical faces bearing a periodic seam
    std::unordered_set<const Edge*> seen;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            auto visit = [&](const Loop* lp) {
                if (!lp || !lp->first) return;
                const Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next) {
                    const Edge* e = c->edge;
                    if (!e || !seen.insert(e).second) continue;
                    const Face* fa = faceOf(e->coedgeA);
                    const Face* fb = faceOf(e->coedgeB);
                    if (!fa || !fb) continue;
                    const auto ia = faceGroup.find(fa), ib = faceGroup.find(fb);
                    if (ia == faceGroup.end() || ib == faceGroup.end()) continue;
                    const int ga = ia->second, gb = ib->second;
                    if (ga == gb) seamGroups.insert(ga);
                    else interPairs.insert({std::min(ga, gb), std::max(ga, gb)});
                }
            };
            visit(f->outerLoop);
            for (const Loop* il : f->innerLoops) visit(il);
        }
    }
    int count = static_cast<int>(interPairs.size());
    for (const int g : seamGroups) {
        const Surface* s =
            (g >= 0 && g < static_cast<int>(groupSurf.size())) ? groupSurf[g] : nullptr;
        count += (s && s->kind == SurfaceKind::Torus) ? 2 : 1;  // periodic directions
    }
    return count;
}

} // namespace brep
} // namespace native
} // namespace forge
