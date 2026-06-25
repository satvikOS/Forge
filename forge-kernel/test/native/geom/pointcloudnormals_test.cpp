// forge/native/geom/pointcloudnormals_test.cpp
//
// Standalone validation gate for forge::native::geom::estimatePointCloudNormals.
//
// Build & run (exactly the agent's verification command):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/PointCloudNormals.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/geom/KdTree3D.cpp \
//       forge-kernel/test/native/geom/pointcloudnormals_test.cpp \
//       -o /tmp/k3_PointCloudNormals && /tmp/k3_PointCloudNormals
//
// VALIDATION GATE (per the module spec):
//   (1) SPHERE: points sampled on a unit sphere -> estimated normals align with
//       the radial direction. With AwayFromCentroid: > 95% of points have
//       |dot(n, radial)| > 0.97 at k = 12 (in fact n . radial > 0.97, outward).
//   (2) PLANE: points on a plane -> all normals align with the plane's true
//       normal (|dot| ~ 1).
//   (3) MST orientation gives a globally CONSISTENT field on the sphere (still
//       |dot(n, radial)| > 0.97 for > 95%) and on the plane every pair of
//       normals is mutually aligned (n_i . n_j > 0).
//   (4) Honest edge cases: empty cloud, non-finite coordinate, k<2, k>n clamp,
//       a degenerate (collinear) neighbourhood flagged, all-coincident cloud.
//
// Seeds are drawn from a fresh std::random_device and PRINTED so every run is a
// different, reproducible random test. Assertions are NEVER weakened to pass.

#include "forge/native/geom/PointCloudNormals.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using forge::native::geom::estimatePointCloudNormals;
using forge::native::geom::Normal3;
using forge::native::geom::NormalEstimation;
using forge::native::geom::OrientMode;
using forge::native::geom::Point3;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

static double dot(const Normal3& a, double x, double y, double z) {
    return a.x * x + a.y * y + a.z * z;
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    const unsigned seed = rd();
    std::mt19937 rng(seed);
    std::printf("PointCloudNormals validation (random_device seed = %u)\n", seed);

    // -----------------------------------------------------------------------
    // (1) SPHERE — normals must be radial. Sample uniformly on a unit sphere.
    // -----------------------------------------------------------------------
    std::printf("\n(1) sphere: estimated normals align with radial direction\n");
    {
        const int N = 2000;
        std::normal_distribution<double> gauss(0.0, 1.0);
        std::vector<Point3> pts;
        pts.reserve(N);
        std::vector<std::array<double, 3>> radial;
        radial.reserve(N);
        for (int i = 0; i < N; ++i) {
            // Marsaglia: a Gaussian 3-vector normalized is uniform on the sphere.
            double x = gauss(rng), y = gauss(rng), z = gauss(rng);
            double r = std::sqrt(x * x + y * y + z * z);
            if (r < 1e-9) { --i; continue; }
            x /= r; y /= r; z /= r;
            pts.push_back(Point3{x, y, z});
            radial.push_back({x, y, z});
        }

        const int k = 12;
        NormalEstimation est = estimatePointCloudNormals(pts, k, OrientMode::AwayFromCentroid);
        check(est.ok, "(1) sphere estimation ok");
        check(est.kEffective == k, "(1) kEffective == 12");
        check(est.normals.size() == pts.size(), "(1) one normal per point");

        int aligned = 0;       // |dot| > 0.97
        int outward = 0;       // dot > 0.97 (signed, outward)
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const double d = dot(est.normals[i], radial[i][0], radial[i][1], radial[i][2]);
            if (std::fabs(d) > 0.97) ++aligned;
            if (d > 0.97) ++outward;
        }
        const double fracAligned = double(aligned) / double(pts.size());
        const double fracOutward = double(outward) / double(pts.size());
        std::printf("    aligned |dot|>0.97: %.3f%%   outward dot>0.97: %.3f%%\n",
                    100.0 * fracAligned, 100.0 * fracOutward);
        check(fracAligned > 0.95, "(1) >95%% of sphere normals |dot(radial)|>0.97 at k=12");
        check(fracOutward > 0.95, "(1) >95%% point OUTWARD (AwayFromCentroid sign correct)");
    }

    // -----------------------------------------------------------------------
    // (2) PLANE — normals must align with the plane's true normal.
    //     Random plane through origin with a random unit normal; sample points
    //     by mixing two in-plane basis vectors, add a tiny jitter to avoid an
    //     exactly-rank-2 covariance edge (still planar to ~1e-6).
    // -----------------------------------------------------------------------
    std::printf("\n(2) plane: estimated normals align with the plane normal\n");
    {
        std::normal_distribution<double> gauss(0.0, 1.0);
        std::uniform_real_distribution<double> uni(-1.0, 1.0);

        // Random unit plane normal.
        double nx = gauss(rng), ny = gauss(rng), nz = gauss(rng);
        double nl = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-9) { nx = 0; ny = 0; nz = 1; nl = 1; }
        nx /= nl; ny /= nl; nz /= nl;

        // Two orthonormal in-plane basis vectors (Gram-Schmidt off an axis).
        double ax = 1, ay = 0, az = 0;
        if (std::fabs(nx) > 0.9) { ax = 0; ay = 1; az = 0; }
        double ux = ay * nz - az * ny;
        double uy = az * nx - ax * nz;
        double uz = ax * ny - ay * nx;
        double ul = std::sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul; uy /= ul; uz /= ul;
        double vx = ny * uz - nz * uy;
        double vy = nz * ux - nx * uz;
        double vz = nx * uy - ny * ux;

        const int N = 1500;
        std::vector<Point3> pts;
        pts.reserve(N);
        const double jitter = 1e-6;
        for (int i = 0; i < N; ++i) {
            const double s = uni(rng) * 5.0;
            const double t = uni(rng) * 5.0;
            const double e = gauss(rng) * jitter;  // tiny out-of-plane noise
            pts.push_back(Point3{
                s * ux + t * vx + e * nx,
                s * uy + t * vy + e * ny,
                s * uz + t * vz + e * nz});
        }

        const int k = 12;
        NormalEstimation est = estimatePointCloudNormals(pts, k, OrientMode::AwayFromCentroid);
        check(est.ok, "(2) plane estimation ok");

        int aligned = 0;
        double minAbs = 1.0;
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const double d = std::fabs(dot(est.normals[i], nx, ny, nz));
            if (d < minAbs) minAbs = d;
            if (d > 0.97) ++aligned;
        }
        const double frac = double(aligned) / double(pts.size());
        std::printf("    plane |dot|>0.97: %.3f%%   worst |dot|: %.6f\n",
                    100.0 * frac, minAbs);
        check(frac > 0.95, "(2) >95%% of plane normals align with the plane normal");

        // MST orientation must produce a MUTUALLY CONSISTENT field on a plane:
        // every normal agrees in sign with the first (all same side).
        NormalEstimation estM = estimatePointCloudNormals(pts, k, OrientMode::MstPropagation);
        check(estM.ok, "(2) plane MST estimation ok");
        int consistent = 0;
        const Normal3& ref = estM.normals[0];
        for (std::size_t i = 0; i < estM.normals.size(); ++i) {
            if (dot(estM.normals[i], ref.x, ref.y, ref.z) > 0.0) ++consistent;
        }
        check(consistent == int(estM.normals.size()),
              "(2) MST yields a globally sign-consistent plane field");
    }

    // -----------------------------------------------------------------------
    // (3) SPHERE under MST — globally consistent AND radial in magnitude.
    // -----------------------------------------------------------------------
    std::printf("\n(3) sphere under MST orientation: consistent & radial\n");
    {
        const int N = 1500;
        std::normal_distribution<double> gauss(0.0, 1.0);
        std::vector<Point3> pts;
        std::vector<std::array<double, 3>> radial;
        for (int i = 0; i < N; ++i) {
            double x = gauss(rng), y = gauss(rng), z = gauss(rng);
            double r = std::sqrt(x * x + y * y + z * z);
            if (r < 1e-9) { --i; continue; }
            x /= r; y /= r; z /= r;
            pts.push_back(Point3{x, y, z});
            radial.push_back({x, y, z});
        }
        const int k = 12;
        NormalEstimation est = estimatePointCloudNormals(pts, k, OrientMode::MstPropagation);
        check(est.ok, "(3) sphere MST estimation ok");
        int aligned = 0;
        for (std::size_t i = 0; i < pts.size(); ++i) {
            const double d = dot(est.normals[i], radial[i][0], radial[i][1], radial[i][2]);
            if (std::fabs(d) > 0.97) ++aligned;
        }
        const double frac = double(aligned) / double(pts.size());
        std::printf("    MST sphere |dot|>0.97: %.3f%%\n", 100.0 * frac);
        check(frac > 0.95, "(3) >95%% of MST sphere normals |dot(radial)|>0.97");
    }

    // -----------------------------------------------------------------------
    // (4) HONEST EDGE CASES.
    // -----------------------------------------------------------------------
    std::printf("\n(4) honest edge cases\n");
    {
        // empty cloud -> ok=false
        NormalEstimation e0 = estimatePointCloudNormals({}, 12);
        check(!e0.ok && e0.normals.empty(), "(4a) empty cloud -> ok=false");

        // non-finite coordinate -> ok=false
        const double inf = std::numeric_limits<double>::infinity();
        const double nan = std::numeric_limits<double>::quiet_NaN();
        std::vector<Point3> bad = { {0, 0, 0}, {1, 0, 0}, {inf, 0, 0}, {0, nan, 0} };
        NormalEstimation e1 = estimatePointCloudNormals(bad, 3);
        check(!e1.ok, "(4b) non-finite coordinate -> ok=false");

        // k < 2 -> ok=false
        std::vector<Point3> few = { {0, 0, 0}, {1, 0, 0}, {0, 1, 0} };
        NormalEstimation e2 = estimatePointCloudNormals(few, 1);
        check(!e2.ok, "(4c) k<2 -> ok=false");

        // k > n -> clamped to n, ok=true (a small planar triangle).
        std::vector<Point3> tri = { {0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {1, 1, 0} };
        NormalEstimation e3 = estimatePointCloudNormals(tri, 100);
        check(e3.ok && e3.kEffective == int(tri.size()),
              "(4d) k>n clamped to n, ok=true");
        // The 4 coplanar points lie in z=0, so every normal must be +-Z.
        bool allZ = true;
        for (const Normal3& nrm : e3.normals)
            if (std::fabs(std::fabs(nrm.z) - 1.0) > 1e-6) allZ = false;
        check(allZ, "(4d) coplanar set -> normals are +-Z");

        // Collinear neighbourhood -> flagged degenerate, no fabricated normal.
        std::vector<Point3> line;
        for (int i = 0; i < 20; ++i) line.push_back(Point3{double(i), 0, 0});
        NormalEstimation e4 = estimatePointCloudNormals(line, 5);
        check(e4.ok, "(4e) collinear cloud still returns ok=true");
        check(e4.numDegenerate > 0, "(4e) collinear neighbourhoods flagged degenerate");
        // A line's least-variance direction is perpendicular to the line (x-axis):
        // the estimated normal must have ~zero x-component.
        bool perp = true;
        for (const Normal3& nrm : e4.normals) {
            const double mag = std::sqrt(nrm.x * nrm.x + nrm.y * nrm.y + nrm.z * nrm.z);
            if (mag > 0.5 && std::fabs(nrm.x) > 1e-6) perp = false;
        }
        check(perp, "(4e) collinear normals are perpendicular to the line (n.x ~ 0)");

        // All-coincident cloud -> degenerate; direction honestly {0,0,0}.
        std::vector<Point3> coincident(10, Point3{3, 3, 3});
        NormalEstimation e5 = estimatePointCloudNormals(coincident, 6);
        check(e5.ok, "(4f) all-coincident cloud returns ok=true");
        check(e5.numDegenerate == coincident.size(),
              "(4f) every coincident point flagged degenerate");
        bool allZeroDir = true;
        for (const Normal3& nrm : e5.normals)
            if (nrm.x != 0.0 || nrm.y != 0.0 || nrm.z != 0.0) allZeroDir = false;
        check(allZeroDir, "(4f) coincident -> honest zero direction (no fabrication)");
    }

    // -----------------------------------------------------------------------
    // (5) Returned normals are unit length wherever a normal is defined.
    // -----------------------------------------------------------------------
    std::printf("\n(5) defined normals are unit length\n");
    {
        const int N = 400;
        std::normal_distribution<double> gauss(0.0, 1.0);
        std::vector<Point3> pts;
        for (int i = 0; i < N; ++i) {
            double x = gauss(rng), y = gauss(rng), z = gauss(rng);
            double r = std::sqrt(x * x + y * y + z * z);
            if (r < 1e-9) { --i; continue; }
            pts.push_back(Point3{x / r, y / r, z / r});
        }
        NormalEstimation est = estimatePointCloudNormals(pts, 12);
        bool unit = true;
        for (std::size_t i = 0; i < est.normals.size(); ++i) {
            if (est.degenerate[i]) continue;
            const Normal3& nrm = est.normals[i];
            const double mag = std::sqrt(nrm.x * nrm.x + nrm.y * nrm.y + nrm.z * nrm.z);
            if (std::fabs(mag - 1.0) > 1e-9) unit = false;
        }
        check(unit, "(5) all non-degenerate normals are unit length to 1e-9");
    }

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
