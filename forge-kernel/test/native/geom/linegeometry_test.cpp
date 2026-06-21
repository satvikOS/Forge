// forge/native/geom/linegeometry_test.cpp
//
// Standalone validation gate for forge::native::geom::LineGeometry.
//
// Build & run:
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/LineGeometry.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/linegeometry_test.cpp \
//       -o /tmp/k5_LineGeometry && /tmp/k5_LineGeometry
//
// Validations (exactly the SPEC):
//   (A) segmentSegmentClosest distance matches a DENSE brute-force minimum to
//       within 1e-6 over many random segment pairs, AND over hand-built
//       parallel / intersecting / skew / endpoint-clamped fixtures.
//   (B) The returned closest points reconstruct from s,t (c1 = p1+s*(q1-p1),
//       c2 = p2+t*(q2-p2)) and their gap equals the reported distance.
//   (C) pointPlaneSignedDistance matches the analytic n·(p-p0)/|n| formula, and
//       its sign flips across the plane; the foot lies on the plane.
//   (D) A segment crossing a plane returns t in [0,1] and a crossing point that
//       reconstructs IDENTICALLY from BOTH the segment param and the plane
//       equation (point on segment AND on plane).
//   (E) Degenerate / parallel cases are flagged honestly (zero-length segments,
//       parallel segments & lines, line-in-plane, parallel-to-plane).
//   (F) lineLineClosest matches the analytic skew-line distance and reports
//       parallel lines via ok=false.
//   (G) pointLine / pointSegment distances match a dense brute force.
//
// The random seed is printed so any failure is reproducible.

#include "forge/native/geom/LineGeometry.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <limits>
#include <algorithm>

using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; }
    else      { std::printf("  [FAIL] %s\n", name); }
}

static bool approx(double a, double b, double tol = 1e-6) {
    return std::fabs(a - b) <= tol;
}

// Brute-force minimum distance between two segments — an INDEPENDENT reference
// that does not use the kernel's closed form. A coarse grid locates the basin,
// then a window-halving refinement (the window always recenters on the current
// best and shrinks every pass) drives the sampled minimum monotonically toward
// the true optimum. Because every sample is a real point on each segment, this
// reference is always an UPPER bound on the true minimum distance; the halving
// guarantees it converges to within ~1e-9 of the true optimum for the
// coordinate magnitudes used here — comfortably inside the 1e-6 gate. We never
// rely on the kernel to produce this value.
static double bruteSegSeg(const Point3& p1, const Point3& q1,
                          const Point3& p2, const Point3& q2,
                          int N = 400) {
    Point3 d1 = vsub(q1, p1);
    Point3 d2 = vsub(q2, p2);
    auto eval = [&](double s, double t) {
        return vdist(vadd(p1, vscale(d1, s)), vadd(p2, vscale(d2, t)));
    };

    // Coarse grid to find the basin of the global minimum.
    double best = std::numeric_limits<double>::infinity();
    double bestS = 0.0, bestT = 0.0;
    for (int i = 0; i <= N; ++i) {
        double s = double(i) / N;
        for (int j = 0; j <= N; ++j) {
            double t = double(j) / N;
            double dd = eval(s, t);
            if (dd < best) { best = dd; bestS = s; bestT = t; }
        }
    }

    // Refinement: window of half-width h around (bestS,bestT), sampled M x M;
    // recenter on the new best and halve h each pass. 60 halvings of an initial
    // h <= 1 reach ~1e-18 in parameter space (limited only by double precision),
    // so the sampled distance converges to the true minimum far below 1e-6.
    double h = 2.0 / N;
    const int M = 16;
    for (int pass = 0; pass < 60; ++pass) {
        double localBest = best;
        double ls = bestS, lt = bestT;
        for (int i = 0; i <= M; ++i) {
            double s = std::clamp(bestS - h + (2.0 * h) * i / M, 0.0, 1.0);
            for (int j = 0; j <= M; ++j) {
                double t = std::clamp(bestT - h + (2.0 * h) * j / M, 0.0, 1.0);
                double dd = eval(s, t);
                if (dd < localBest) { localBest = dd; ls = s; lt = t; }
            }
        }
        best = localBest;
        bestS = ls;
        bestT = lt;
        h *= 0.5;
    }
    return best;
}

static double brutePointSeg(const Point3& p, const Point3& a, const Point3& b,
                            int N = 200000) {
    Point3 ab = vsub(b, a);
    double best = std::numeric_limits<double>::infinity();
    for (int i = 0; i <= N; ++i) {
        double t = double(i) / N;
        best = std::min(best, vdist(p, vadd(a, vscale(ab, t))));
    }
    return best;
}

int main() {
    std::random_device rd;
    unsigned seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(-10.0, 10.0);
    std::printf("== forge::native::geom::LineGeometry validation ==\n");
    std::printf("seed = %u\n", seed);

    auto rp = [&]() { return Point3{U(rng), U(rng), U(rng)}; };

    // -----------------------------------------------------------------------
    // (A)+(B) Random segment pairs: closest distance vs dense brute force, and
    // closest-point reconstruction from s,t.
    // -----------------------------------------------------------------------
    {
        int cases = 200;
        double worst = 0.0;
        bool reconOk = true, distOk = true;
        for (int k = 0; k < cases; ++k) {
            Point3 p1 = rp(), q1 = rp(), p2 = rp(), q2 = rp();
            SegSegResult r = segmentSegmentClosest(p1, q1, p2, q2);
            double bf = bruteSegSeg(p1, q1, p2, q2);
            worst = std::max(worst, std::fabs(r.distance - bf));
            if (!approx(r.distance, bf)) distOk = false;

            // Reconstruct c1,c2 from s,t and check against the returned points
            // and the reported distance.
            Point3 c1 = vadd(p1, vscale(vsub(q1, p1), r.s));
            Point3 c2 = vadd(p2, vscale(vsub(q2, p2), r.t));
            if (!approx(vdist(c1, r.c1), 0.0, 1e-9)) reconOk = false;
            if (!approx(vdist(c2, r.c2), 0.0, 1e-9)) reconOk = false;
            if (!approx(vdist(r.c1, r.c2), r.distance, 1e-9)) reconOk = false;
        }
        std::printf("(A) %d random seg-seg pairs: worst |dist-brute| = %.3e\n",
                    cases, worst);
        check(distOk, "(A) random seg-seg distance matches dense brute force <=1e-6");
        check(reconOk, "(B) closest points reconstruct from s,t and equal reported gap");
    }

    // -----------------------------------------------------------------------
    // (A') Hand-built taxonomy: parallel, intersecting, skew, endpoint-clamped.
    // -----------------------------------------------------------------------
    {
        // Intersecting (cross at origin in z=0 plane): distance 0.
        {
            SegSegResult r = segmentSegmentClosest({-1,-1,0},{1,1,0},
                                                   {-1,1,0},{1,-1,0});
            double bf = bruteSegSeg({-1,-1,0},{1,1,0},{-1,1,0},{1,-1,0});
            check(approx(r.distance, 0.0) && approx(r.distance, bf),
                  "(A') intersecting segments -> distance 0");
        }
        // Skew lines offset in z: known closest distance = 1 (the z gap), both
        // crossing at the mid in xy.
        {
            SegSegResult r = segmentSegmentClosest({-1,0,0},{1,0,0},
                                                   {0,-1,1},{0,1,1});
            double bf = bruteSegSeg({-1,0,0},{1,0,0},{0,-1,1},{0,1,1});
            check(approx(r.distance, 1.0) && approx(r.distance, bf),
                  "(A') skew perpendicular segments -> distance 1");
        }
        // Parallel segments, both along x, offset by 2 in y; overlapping in x.
        {
            SegSegResult r = segmentSegmentClosest({0,0,0},{4,0,0},
                                                   {1,2,0},{5,2,0});
            double bf = bruteSegSeg({0,0,0},{4,0,0},{1,2,0},{5,2,0});
            check(r.parallel, "(A') parallel segments flagged parallel=true");
            check(approx(r.distance, 2.0) && approx(r.distance, bf),
                  "(A') parallel overlapping segments -> distance 2");
        }
        // Endpoint-clamped: parallel-ish but non-overlapping in x so the closest
        // pair is endpoint-to-endpoint.
        {
            Point3 p1{0,0,0}, q1{1,0,0}, p2{5,1,0}, q2{6,1,0};
            SegSegResult r = segmentSegmentClosest(p1, q1, p2, q2);
            double bf = bruteSegSeg(p1, q1, p2, q2);
            check(approx(r.distance, bf),
                  "(A') endpoint-clamped parallel segments match brute force");
            check((approx(r.s,1.0)||approx(r.s,0.0)) &&
                  (approx(r.t,1.0)||approx(r.t,0.0)),
                  "(A') endpoint-clamped solution sits on segment endpoints");
        }
        // Non-parallel but disjoint, closest at endpoints (general clamp path).
        {
            Point3 p1{0,0,0}, q1{1,0,0}, p2{3,3,1}, q2{4,5,2};
            SegSegResult r = segmentSegmentClosest(p1, q1, p2, q2);
            double bf = bruteSegSeg(p1, q1, p2, q2);
            check(approx(r.distance, bf),
                  "(A') general endpoint-clamped skew match brute force");
        }
    }

    // -----------------------------------------------------------------------
    // (E) Degenerate (zero-length) inputs flagged honestly.
    // -----------------------------------------------------------------------
    {
        // Zero-length segment 1 -> reduces to point-to-segment.
        {
            Point3 p{2,3,0};
            SegSegResult r = segmentSegmentClosest(p, p, {0,0,0}, {4,0,0});
            PointSegmentResult ps = pointSegmentDistance(p, {0,0,0}, {4,0,0});
            check(r.degenerate, "(E) zero-length segment flagged degenerate");
            check(approx(r.distance, ps.distance),
                  "(E) degenerate seg-seg equals point-segment distance");
        }
        // Both zero-length -> point-to-point.
        {
            SegSegResult r = segmentSegmentClosest({1,1,1},{1,1,1},
                                                   {4,5,1},{4,5,1});
            check(r.degenerate, "(E) both-zero-length flagged degenerate");
            check(approx(r.distance, vdist({1,1,1},{4,5,1})),
                  "(E) both-zero-length equals point-point distance");
        }
        // pointSegmentDistance on a zero-length segment.
        {
            PointSegmentResult ps = pointSegmentDistance({3,4,0},{0,0,0},{0,0,0});
            check(ps.degenerate && approx(ps.distance, 5.0),
                  "(E) point to zero-length segment is point-point distance");
        }
    }

    // -----------------------------------------------------------------------
    // (C) point-plane signed distance vs analytic formula; sign + foot checks.
    // -----------------------------------------------------------------------
    {
        bool allOk = true, signOk = true, footOk = true;
        for (int k = 0; k < 200; ++k) {
            Point3 p = rp();
            Plane pl{rp(), rp()};
            if (vdot(pl.normal, pl.normal) < 1e-6) { pl.normal = {0,0,1}; }
            PointPlaneResult r = pointPlaneSignedDistance(p, pl);
            // Analytic: dot(unit_n, p - p0).
            double nn = vdot(pl.normal, pl.normal);
            double inv = 1.0 / std::sqrt(nn);
            Point3 un = vscale(pl.normal, inv);
            double analytic = vdot(un, vsub(p, pl.point));
            if (!approx(r.signedDistance, analytic)) allOk = false;
            if (!approx(r.distance, std::fabs(analytic))) allOk = false;
            // Foot must lie on the plane (zero signed distance).
            PointPlaneResult rf = pointPlaneSignedDistance(r.foot, pl);
            if (!approx(rf.signedDistance, 0.0, 1e-9)) footOk = false;
        }
        // Sign flip across the plane: a point on +n side and its mirror on -n.
        {
            Plane pl{{0,0,0},{0,0,1}};
            PointPlaneResult above = pointPlaneSignedDistance({1,2,3}, pl);
            PointPlaneResult below = pointPlaneSignedDistance({1,2,-3}, pl);
            if (!(above.signedDistance > 0 && below.signedDistance < 0)) signOk = false;
            if (!approx(above.signedDistance, 3.0) || !approx(below.signedDistance, -3.0))
                signOk = false;
        }
        check(allOk, "(C) point-plane signed distance matches analytic n.(p-p0)/|n|");
        check(signOk, "(C) signed distance flips sign across the plane");
        check(footOk, "(C) projected foot lies exactly on the plane");
    }

    // -----------------------------------------------------------------------
    // (D) Segment crossing a plane: exact crossing param t in [0,1], point on
    // BOTH the segment and the plane.
    // -----------------------------------------------------------------------
    {
        bool tRange = true, onSeg = true, onPlane = true, reconBoth = true;
        int hits = 0;
        for (int k = 0; k < 300; ++k) {
            Point3 a = rp(), b = rp();
            Plane pl{rp(), rp()};
            if (vdot(pl.normal, pl.normal) < 1e-6) continue;
            // Only assert on segments that genuinely straddle the plane.
            PointPlaneResult da = pointPlaneSignedDistance(a, pl);
            PointPlaneResult db = pointPlaneSignedDistance(b, pl);
            if (da.signedDistance * db.signedDistance >= 0.0) continue;
            ++hits;
            LinePlaneResult r = segmentPlaneIntersect(a, b, pl);
            if (r.status != PlaneHit::HIT) { tRange = false; continue; }
            if (r.t < -1e-12 || r.t > 1.0 + 1e-12) tRange = false;
            // Reconstruct from the segment param:
            Point3 fromSeg = vadd(a, vscale(vsub(b, a), r.t));
            if (!approx(vdist(fromSeg, r.point), 0.0, 1e-9)) reconBoth = false;
            // Point must be on the segment (distance to segment ~0):
            PointSegmentResult ps = pointSegmentDistance(r.point, a, b);
            if (!approx(ps.distance, 0.0, 1e-7)) onSeg = false;
            // Point must be on the plane (signed distance ~0):
            PointPlaneResult pp = pointPlaneSignedDistance(r.point, pl);
            if (!approx(pp.signedDistance, 0.0, 1e-7)) onPlane = false;
        }
        std::printf("(D) tested %d straddling segment-plane crossings\n", hits);
        check(hits > 50, "(D) generated a healthy number of crossing cases");
        check(tRange, "(D) crossing param t in [0,1] for straddling segments");
        check(reconBoth, "(D) point reconstructs from segment param t");
        check(onSeg, "(D) crossing point lies on the segment");
        check(onPlane, "(D) crossing point lies on the plane");

        // Exact known crossing: segment (0,0,-2)->(0,0,2) vs z=0 plane -> t=0.5.
        {
            LinePlaneResult r = segmentPlaneIntersect({0,0,-2},{0,0,2},
                                                      Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::HIT && approx(r.t, 0.5) &&
                  approx(r.point.z, 0.0),
                  "(D) known crossing returns t=0.5 at z=0");
        }
        // Segment that does NOT reach the plane -> MISS.
        {
            LinePlaneResult r = segmentPlaneIntersect({0,0,1},{0,0,2},
                                                      Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::MISS,
                  "(D) non-reaching segment classified MISS");
        }
    }

    // -----------------------------------------------------------------------
    // (E') Parallel-to-plane and line-in-plane flagged honestly.
    // -----------------------------------------------------------------------
    {
        // Direction parallel to z=0 plane, above it -> PARALLEL.
        {
            LinePlaneResult r = linePlaneIntersect({0,0,5},{1,0,0},
                                                   Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::PARALLEL,
                  "(E') line parallel to plane (off-plane) -> PARALLEL");
        }
        // Direction parallel and start on the plane -> IN_PLANE.
        {
            LinePlaneResult r = linePlaneIntersect({3,4,0},{1,0,0},
                                                   Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::IN_PLANE,
                  "(E') line lying in the plane -> IN_PLANE");
        }
        // Ray pointing away from plane -> MISS (t<0).
        {
            LinePlaneResult r = rayPlaneIntersect({0,0,1},{0,0,1},
                                                  Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::MISS,
                  "(E') ray pointing away from plane -> MISS");
        }
        // Ray pointing toward plane -> HIT at t=1.
        {
            LinePlaneResult r = rayPlaneIntersect({0,0,1},{0,0,-1},
                                                  Plane{{0,0,0},{0,0,1}});
            check(r.status == PlaneHit::HIT && approx(r.t, 1.0),
                  "(E') ray toward plane -> HIT at t=1");
        }
    }

    // -----------------------------------------------------------------------
    // (F) line-line closest approach: skew analytic + parallel reporting.
    // -----------------------------------------------------------------------
    {
        // Skew lines: x-axis through origin, and the line x=0,z=1 along y.
        // The closest distance is 1, at (0,0,0) and (0,*,1).
        {
            LineLineResult r = lineLineClosest({0,0,0},{1,0,0},
                                               {0,0,1},{0,1,0});
            check(r.ok && approx(r.distance, 1.0),
                  "(F) skew lines closest distance = 1");
            check(approx(vdist(r.c1, r.c2), r.distance, 1e-9),
                  "(F) skew line closest points realize the reported distance");
        }
        // Random skew lines vs the cross-product analytic distance formula
        // |(b0-a0).(da x db)| / |da x db|.
        {
            bool ok = true;
            int tested = 0;
            for (int k = 0; k < 200; ++k) {
                Point3 a0 = rp(), da = rp(), b0 = rp(), db = rp();
                Point3 n = vcross(da, db);
                double nl2 = vdot(n, n);
                if (nl2 < 1e-6) continue;  // skip near-parallel
                ++tested;
                LineLineResult r = lineLineClosest(a0, da, b0, db);
                double analytic = std::fabs(vdot(vsub(b0, a0), n)) / std::sqrt(nl2);
                if (!r.ok || !approx(r.distance, analytic)) ok = false;
                // closest points must realize the distance and be perpendicular
                // to both directions.
                if (r.ok) {
                    if (!approx(vdist(r.c1, r.c2), r.distance, 1e-7)) ok = false;
                    Point3 w = vsub(r.c1, r.c2);
                    if (std::fabs(vdot(w, da)) > 1e-6 * (vlen(da) + 1) ||
                        std::fabs(vdot(w, db)) > 1e-6 * (vlen(db) + 1)) ok = false;
                }
            }
            check(tested > 50, "(F) generated enough random skew line pairs");
            check(ok, "(F) random skew line distance matches cross-product formula");
        }
        // Parallel lines -> ok=false, parallel=true, constant distance reported.
        {
            LineLineResult r = lineLineClosest({0,0,0},{1,0,0},
                                               {0,3,0},{2,0,0});
            check(!r.ok && r.parallel,
                  "(F) parallel lines reported ok=false, parallel=true");
            check(approx(r.distance, 3.0),
                  "(F) parallel lines report the constant gap distance (3)");
        }
    }

    // -----------------------------------------------------------------------
    // (G) point-line / point-segment vs brute force.
    // -----------------------------------------------------------------------
    {
        bool segOk = true, lineOk = true;
        for (int k = 0; k < 200; ++k) {
            Point3 p = rp(), a = rp(), b = rp();
            PointSegmentResult ps = pointSegmentDistance(p, a, b);
            double bf = brutePointSeg(p, a, b);
            if (!approx(ps.distance, bf)) segOk = false;

            // point-line: distance to the infinite line through a with dir b-a.
            PointLineResult plr = pointLineDistance(p, a, vsub(b, a));
            // perpendicular distance via cross product magnitude:
            Point3 d = vsub(b, a);
            double cross = vlen(vcross(vsub(p, a), d)) / vlen(d);
            if (!approx(plr.distance, cross)) lineOk = false;
        }
        check(segOk, "(G) point-segment distance matches dense brute force");
        check(lineOk, "(G) point-line distance matches cross-product formula");

        // Degenerate line (zero direction) flagged.
        {
            PointLineResult plr = pointLineDistance({1,2,2},{0,0,0},{0,0,0});
            check(!plr.ok && approx(plr.distance, 3.0),
                  "(G) zero-direction line flagged ok=false, gives point distance");
        }
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
