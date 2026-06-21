// forge/native/geom/LineGeometry.cpp
//
// Implementation of the robust line / segment / ray / plane primitives declared
// in forge/native/geom/LineGeometry.hpp. Pure C++20, standard library only.
//
// The segment-segment routine follows the well-known clamp-and-recompute method
// (Ericson, "Real-Time Collision Detection", §5.1.9), re-derived here. Degenerate
// and parallel configurations are detected from the algebraic denominators and
// resolved honestly — see the per-branch comments.

#include "forge/native/geom/LineGeometry.hpp"

#include <algorithm>  // std::clamp, std::min, std::max
#include <cmath>      // std::sqrt, std::fabs
#include <limits>     // std::numeric_limits

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Vector length helpers (declared in the header).
// ---------------------------------------------------------------------------
double vlen(const Point3& a) {
    return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
double vdist(const Point3& a, const Point3& b) {
    return vlen(vsub(a, b));
}

namespace {

// Tolerance below which a squared length / denominator is treated as zero.
// Chosen well below the 1e-6 validation tolerance but above pure-double noise.
constexpr double kEps     = 1e-12;  // squared-magnitude threshold
constexpr double kParEps  = 1e-12;  // parallel-direction threshold (on sin^2)

} // namespace

// ---------------------------------------------------------------------------
// Plane construction.
// ---------------------------------------------------------------------------
PlaneFit planeFromPoints(const Point3& a, const Point3& b, const Point3& c) {
    PlaneFit out;
    Point3 n = vcross(vsub(b, a), vsub(c, a));
    if (vdot(n, n) <= kEps) {
        out.ok = false;
        out.reason = "collinear points: plane normal is zero";
        return out;
    }
    out.ok = true;
    out.plane.point = a;
    out.plane.normal = n;
    return out;
}

// ---------------------------------------------------------------------------
// (5) Point–plane signed distance.
// ---------------------------------------------------------------------------
PointPlaneResult pointPlaneSignedDistance(const Point3& p, const Plane& plane) {
    PointPlaneResult out;
    double nn = vdot(plane.normal, plane.normal);
    if (nn <= kEps) {
        out.ok = false;
        return out;  // degenerate plane: zero normal
    }
    double inv = 1.0 / std::sqrt(nn);
    Point3 un = vscale(plane.normal, inv);          // unit normal
    double sd = vdot(un, vsub(p, plane.point));     // signed distance
    out.ok = true;
    out.signedDistance = sd;
    out.distance = std::fabs(sd);
    out.foot = vsub(p, vscale(un, sd));             // p projected onto plane
    return out;
}

double pointPlaneDistance(const Point3& p, const Plane& plane, bool* ok) {
    PointPlaneResult r = pointPlaneSignedDistance(p, plane);
    if (ok) *ok = r.ok;
    return r.ok ? r.distance : 0.0;
}

// ---------------------------------------------------------------------------
// (4) Point–line distance.
// ---------------------------------------------------------------------------
PointLineResult pointLineDistance(const Point3& p,
                                  const Point3& a, const Point3& dir) {
    PointLineResult out;
    double dd = vdot(dir, dir);
    if (dd <= kEps) {
        out.ok = false;          // direction is zero: line undefined
        out.distance = vdist(p, a);
        out.foot = a;
        out.t = 0.0;
        return out;
    }
    double t = vdot(vsub(p, a), dir) / dd;
    Point3 foot = vadd(a, vscale(dir, t));
    out.ok = true;
    out.t = t;
    out.foot = foot;
    out.distance = vdist(p, foot);
    return out;
}

// ---------------------------------------------------------------------------
// (4) Point–segment distance (clamped).
// ---------------------------------------------------------------------------
PointSegmentResult pointSegmentDistance(const Point3& p,
                                        const Point3& a, const Point3& b) {
    PointSegmentResult out;
    Point3 ab = vsub(b, a);
    double dd = vdot(ab, ab);
    if (dd <= kEps) {
        // Zero-length segment: collapses to the point a.
        out.degenerate = true;
        out.t = 0.0;
        out.foot = a;
        out.distance = vdist(p, a);
        return out;
    }
    double t = vdot(vsub(p, a), ab) / dd;
    t = std::clamp(t, 0.0, 1.0);
    Point3 foot = vadd(a, vscale(ab, t));
    out.t = t;
    out.foot = foot;
    out.distance = vdist(p, foot);
    return out;
}

// ---------------------------------------------------------------------------
// (1) Segment–segment closest points.
//
// Notation (Ericson): segment 1 is S1(s) = p1 + s*d1, d1 = q1-p1, s in [0,1];
// segment 2 is S2(t) = p2 + t*d2, d2 = q2-p2, t in [0,1]; r = p1 - p2.
// ---------------------------------------------------------------------------
SegSegResult segmentSegmentClosest(const Point3& p1, const Point3& q1,
                                   const Point3& p2, const Point3& q2) {
    SegSegResult out;

    Point3 d1 = vsub(q1, p1);   // direction & length of segment 1
    Point3 d2 = vsub(q2, p2);   // direction & length of segment 2
    Point3 r  = vsub(p1, p2);

    double a = vdot(d1, d1);    // squared length of segment 1, >= 0
    double e = vdot(d2, d2);    // squared length of segment 2, >= 0
    double f = vdot(d2, r);

    double s = 0.0, t = 0.0;

    bool deg1 = (a <= kEps);
    bool deg2 = (e <= kEps);

    if (deg1 && deg2) {
        // Both segments are points.
        out.degenerate = true;
        s = 0.0; t = 0.0;
    } else if (deg1) {
        // First segment is a point: project p1 onto segment 2.
        out.degenerate = true;
        s = 0.0;
        t = std::clamp(f / e, 0.0, 1.0);
    } else {
        double c = vdot(d1, r);
        if (deg2) {
            // Second segment is a point: project p2 onto segment 1.
            out.degenerate = true;
            t = 0.0;
            s = std::clamp(-c / a, 0.0, 1.0);
        } else {
            // The general non-degenerate case.
            double b   = vdot(d1, d2);
            double den = a * e - b * b;  // always >= 0, == 0 iff parallel

            // Detect parallelism honestly: den == 0 (within tolerance relative
            // to the magnitudes of a*e) means the directions are parallel and
            // the closest pair is not unique.
            if (den <= kParEps * (a * e)) {
                out.parallel = true;
                // Pick s=0 as the representative on segment 1, then clamp t.
                s = 0.0;
            } else {
                s = std::clamp((b * f - c * e) / den, 0.0, 1.0);
            }

            // Compute t for the chosen s, then clamp and recompute s if t was
            // pushed out of [0,1].
            t = (b * s + f) / e;
            if (t < 0.0) {
                t = 0.0;
                s = std::clamp(-c / a, 0.0, 1.0);
            } else if (t > 1.0) {
                t = 1.0;
                s = std::clamp((b - c) / a, 0.0, 1.0);
            }
        }
    }

    Point3 c1 = vadd(p1, vscale(d1, s));
    Point3 c2 = vadd(p2, vscale(d2, t));
    out.s = s;
    out.t = t;
    out.c1 = c1;
    out.c2 = c2;
    out.distance = vdist(c1, c2);
    return out;
}

// ---------------------------------------------------------------------------
// (2) Line–line closest approach (infinite lines).
// ---------------------------------------------------------------------------
LineLineResult lineLineClosest(const Point3& a0, const Point3& da,
                               const Point3& b0, const Point3& db) {
    LineLineResult out;

    double a = vdot(da, da);
    double e = vdot(db, db);

    if (a <= kEps || e <= kEps) {
        // A direction is zero: not a proper line. Fall back to point/line.
        out.ok = false;
        out.parallel = false;
        if (a <= kEps && e <= kEps) {
            out.c1 = a0; out.c2 = b0;
            out.distance = vdist(a0, b0);
        } else if (a <= kEps) {
            PointLineResult pl = pointLineDistance(a0, b0, db);
            out.c1 = a0; out.c2 = pl.foot; out.t = pl.t; out.distance = pl.distance;
        } else {
            PointLineResult pl = pointLineDistance(b0, a0, da);
            out.c1 = pl.foot; out.c2 = b0; out.s = pl.t; out.distance = pl.distance;
        }
        return out;
    }

    Point3 r = vsub(a0, b0);
    double b = vdot(da, db);
    double c = vdot(da, r);
    double f = vdot(db, r);
    double den = a * e - b * b;  // >= 0, zero iff parallel

    if (den <= kParEps * (a * e)) {
        // Parallel lines: no unique closest pair. Report the constant distance
        // via a representative pair (project a0 onto line B).
        out.ok = false;
        out.parallel = true;
        out.s = 0.0;
        out.t = f / e;             // foot of a0 on line B
        out.c1 = a0;
        out.c2 = vadd(b0, vscale(db, out.t));
        out.distance = vdist(out.c1, out.c2);
        return out;
    }

    double s = (b * f - c * e) / den;
    double t = (a * f - b * c) / den;
    out.ok = true;
    out.parallel = false;
    out.s = s;
    out.t = t;
    out.c1 = vadd(a0, vscale(da, s));
    out.c2 = vadd(b0, vscale(db, t));
    out.distance = vdist(out.c1, out.c2);
    return out;
}

// ---------------------------------------------------------------------------
// (3) Generic line/segment/ray vs plane core.
//
// Solves dot(n, a + t*dir - p0) = 0  =>  t = dot(n, p0 - a) / dot(n, dir).
// The `tMin..tMax` window selects segment ([0,1]), ray ([0,inf)) or line.
// ---------------------------------------------------------------------------
namespace {

LinePlaneResult linePlaneCore(const Point3& a, const Point3& dir,
                              const Plane& plane, double tMin, double tMax) {
    LinePlaneResult out;

    double nn = vdot(plane.normal, plane.normal);
    if (nn <= kEps) {
        // Degenerate plane (zero normal): treat as no intersection.
        out.status = PlaneHit::MISS;
        return out;
    }

    double denom = vdot(plane.normal, dir);
    double numer = vdot(plane.normal, vsub(plane.point, a));

    // Relative scale for the "parallel" test: compare |denom| against the
    // magnitudes that produced it, so it is invariant to overall scaling.
    double scale = std::sqrt(nn) * vlen(dir);

    if (std::fabs(denom) <= kParEps * (scale + 1.0)) {
        // Direction parallel to the plane.
        if (std::fabs(numer) <= kEps * (scale + 1.0)) {
            // Start point lies on the plane: the whole line is in the plane.
            out.status = PlaneHit::IN_PLANE;
            out.t = 0.0;
            out.point = a;
        } else {
            out.status = PlaneHit::PARALLEL;
        }
        return out;
    }

    double t = numer / denom;
    if (t < tMin || t > tMax) {
        out.status = PlaneHit::MISS;
        out.t = t;  // report the (out-of-range) crossing param for diagnostics
        out.point = vadd(a, vscale(dir, t));
        return out;
    }

    out.status = PlaneHit::HIT;
    out.t = t;
    out.point = vadd(a, vscale(dir, t));
    return out;
}

} // namespace

LinePlaneResult segmentPlaneIntersect(const Point3& a, const Point3& b,
                                      const Plane& plane) {
    return linePlaneCore(a, vsub(b, a), plane, 0.0, 1.0);
}

LinePlaneResult linePlaneIntersect(const Point3& a, const Point3& dir,
                                   const Plane& plane) {
    constexpr double kInf = std::numeric_limits<double>::infinity();
    return linePlaneCore(a, dir, plane, -kInf, kInf);
}

LinePlaneResult rayPlaneIntersect(const Point3& origin, const Point3& dir,
                                  const Plane& plane) {
    constexpr double kInf = std::numeric_limits<double>::infinity();
    return linePlaneCore(origin, dir, plane, 0.0, kInf);
}

} // namespace geom
} // namespace native
} // namespace forge
