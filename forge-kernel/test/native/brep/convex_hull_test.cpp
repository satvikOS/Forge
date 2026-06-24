// forge/native/brep/convex_hull_test.cpp
//
// Standalone validation gate for forge::native::geom::convexHull3D_exact — the
// EXACT 3D convex hull (Quickhull, every orientation decided by exactOrient3D).
//
// Build & run (compiles ONLY this module + its named deps + this test — NOT the
// whole tree; matches the kernel's per-module standalone-gate convention):
//
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/ConvexHull3D.cpp \
//       forge-kernel/src/native/ExactPredicates3D.cpp \
//       forge-kernel/src/native/ExactReal.cpp \
//       forge-kernel/test/native/brep/convex_hull_test.cpp \
//       -o /tmp/k_ConvexHull3D && /tmp/k_ConvexHull3D
//
// NOTE: the optional brep::Solid emitter (toSolid) is intentionally NOT linked
// here — it lives in the same .cpp but pulls in Topology.cpp; the mesh-returning
// path under test needs only the three sources above (per the header's "callers
// wanting only the mesh need not link Topology.cpp").
//
// SPEC validations (the prompt's three named cases + the exact certificates):
//   (A) CUBE: hull of a cube's 8 corners == the cube.  Volume == side^3 EXACTLY
//       (closed form), 8 hull vertices, 12 triangles (6 quad faces), and the
//       all-points-inside certificate (exactOrient3D >= 0 vs every outward face
//       — the interior side, with the CCW-outward winding, is the below/positive
//       side; a point strictly outside would be above some face, orient < 0).
//   (B) SPHERE: hull of points sampled on a sphere of radius R ~= the sphere.
//       Volume within a few % of 4/3 pi R^3 and CONVERGING as samples grow; ALL
//       input points inside-or-on the hull to exact sign (orient3D >= 0); every
//       face outward-convex via exact orient3D.
//   (C) INTERIOR POINTS: a cloud whose interior points are NOT hull vertices
//       (isHullVertex false for every strictly-interior point, true for corners).
//   (D) DEGENERATE HONESTY: <4 unique, all-collinear, all-coplanar (coplanar
//       flag set) report ok=false with no fabricated geometry; exact duplicates
//       collapse and a duplicate of a corner is still classified a hull vertex.

#include <algorithm>
#include "forge/native/geom/ConvexHull3D.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <array>

using namespace forge::native;
using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

// ===========================================================================
// (A) CUBE: 8 corners -> the cube exactly.
// ===========================================================================
static void testCube() {
    std::printf("\n[A] Cube (8 corners) hull == cube\n");
    const double s = 3.0;                       // side length
    std::vector<Point3> pts = {
        {0,0,0},{s,0,0},{0,s,0},{s,s,0},
        {0,0,s},{s,0,s},{0,s,s},{s,s,s}
    };
    ConvexHull3DResult h = convexHull3D_exact(pts);
    check(h.ok, "cube hull ok");

    const double expected = s * s * s;          // 27 exactly
    std::printf("       hull volume = %.17g  (side^3 = %.17g)\n", h.volume, expected);
    std::printf("       hull vertices = %zu, faces (tris) = %zu\n",
                h.vertices.size(), h.faces.size());
    // Volume is the exact closed form side^3 (the only fp error is summation of
    // an integer-valued determinant over 12 triangles, which is exact here).
    check(h.volume == expected, "cube volume == side^3 (exact)");
    check(h.vertices.size() == 8, "cube hull has 8 vertices");
    check(h.faces.size() == 12, "cube hull has 12 triangles (6 quad faces)");

    // All 8 input points inside-or-on the hull (every corner is ON it).
    check(allPointsInsideOrOn(h, pts), "cube: all input points inside-or-on (exact orient3D)");
    check(everyFaceOutwardConvex(h), "cube: every face outward-convex (exact)");
    // Every corner is a hull vertex.
    bool allCorners = true;
    for (std::size_t k = 0; k < pts.size(); ++k) if (!h.isHullVertex[k]) allCorners = false;
    check(allCorners, "cube: all 8 corners are hull vertices");
}

// ===========================================================================
// (B) SPHERE: points sampled on radius R -> approximate sphere, converging.
// ===========================================================================
// Deterministic Fibonacci-lattice sampling of N points on the unit sphere,
// scaled by R.  (No RNG: the gate is reproducible.)
static std::vector<Point3> sampleSphere(int N, double R) {
    std::vector<Point3> pts;
    pts.reserve(N);
    const double golden = M_PI * (3.0 - std::sqrt(5.0));  // golden angle
    for (int i = 0; i < N; ++i) {
        const double y  = 1.0 - (2.0 * i + 1.0) / N;       // y in (-1,1)
        const double r  = std::sqrt(std::max(0.0, 1.0 - y * y));
        const double th = golden * i;
        pts.push_back({R * std::cos(th) * r, R * y, R * std::sin(th) * r});
    }
    return pts;
}

static void testSphere() {
    std::printf("\n[B] Sphere-sampled hull -> ~sphere (converging)\n");
    const double R = 2.0;
    const double exact = 4.0 / 3.0 * M_PI * R * R * R;
    std::printf("       4/3 pi R^3 = %.17g\n", exact);

    double prevErr = 1e9;
    // Sweep increasing sample counts to show convergence. The hull BUILD is fast
    // at every N; the all-points-inside certificate is brute force O(N * faces)
    // through the EXACT predicate, so we cap the sweep at 1024 to keep the gate
    // watchable (the convergence trend + the <3% bound + the exact orient3D certificate
    // are all already decisive by 1024; larger N only shrinks the error further).
    const int Ns[] = {64, 256, 1024};
    bool converged = true, allInside = true, allConvex = true;
    for (int N : Ns) {
        std::vector<Point3> pts = sampleSphere(N, R);
        ConvexHull3DResult h = convexHull3D_exact(pts);
        if (!h.ok) { check(false, "sphere hull ok"); return; }
        const double err = std::fabs(h.volume - exact) / exact * 100.0;
        std::printf("       N=%5d  vol=%.10g  faces=%zu  verts=%zu  err=%.4f%%\n",
                    N, h.volume, h.faces.size(), h.vertices.size(), err);
        if (err > prevErr + 1e-9) converged = false;        // monotone-ish decrease
        prevErr = err;
        if (!allPointsInsideOrOn(h, pts)) allInside = false; // EXACT orient3D>=0 cert
        if (!everyFaceOutwardConvex(h))  allConvex = false;
    }
    // The largest sample is within a few % of the analytic sphere volume.
    std::printf("       final error vs 4/3 pi R^3 = %.4f%%\n", prevErr);
    check(prevErr < 3.0, "sphere: finest hull within 3%% of 4/3 pi R^3");
    check(converged, "sphere: volume error decreases as samples grow");
    check(allInside, "sphere: ALL input points inside-or-on hull (exact orient3D)");
    check(allConvex, "sphere: every face outward-convex (exact orient3D)");
}

// ===========================================================================
// (C) INTERIOR POINTS: a cube cloud with added interior points; interiors are
//     NOT hull vertices.
// ===========================================================================
static void testInteriorPoints() {
    std::printf("\n[C] Interior points are NOT hull vertices\n");
    std::vector<Point3> pts = {
        // 8 corners of a unit cube (these ARE hull vertices)
        {0,0,0},{1,0,0},{0,1,0},{1,1,0},
        {0,0,1},{1,0,1},{0,1,1},{1,1,1},
    };
    const std::size_t firstInterior = pts.size();
    // Strictly-interior points (must NOT be hull vertices).
    pts.push_back({0.5, 0.5, 0.5});   // center
    pts.push_back({0.25,0.25,0.25});
    pts.push_back({0.75,0.6, 0.4});
    pts.push_back({0.3, 0.8, 0.5});

    ConvexHull3DResult h = convexHull3D_exact(pts);
    check(h.ok, "interior-cloud hull ok");
    check(h.vertices.size() == 8, "interior-cloud hull has exactly 8 vertices (the corners)");

    bool cornersAreHull = true, interiorsAreNot = true;
    for (std::size_t k = 0; k < firstInterior; ++k) if (!h.isHullVertex[k]) cornersAreHull = false;
    for (std::size_t k = firstInterior; k < pts.size(); ++k) if (h.isHullVertex[k]) interiorsAreNot = false;
    check(cornersAreHull, "interior-cloud: all 8 corners ARE hull vertices");
    check(interiorsAreNot, "interior-cloud: every interior point is NOT a hull vertex");
    check(allPointsInsideOrOn(h, pts), "interior-cloud: all points inside-or-on (exact orient3D)");
    check(h.volume == 1.0, "interior-cloud: unit-cube volume == 1 (exact)");
}

// ===========================================================================
// (D) DEGENERATE / DUPLICATE HONESTY.
// ===========================================================================
static void testDegenerate() {
    std::printf("\n[D] Degenerate inputs reported honestly\n");

    // < 4 unique points.
    {
        std::vector<Point3> pts = {{0,0,0},{1,0,0},{0,1,0}};
        ConvexHull3DResult h = convexHull3D_exact(pts);
        check(!h.ok && h.faces.empty(), "fewer than 4 points -> ok=false, no faces");
    }
    // All collinear.
    {
        std::vector<Point3> pts = {{0,0,0},{1,1,1},{2,2,2},{3,3,3},{5,5,5}};
        ConvexHull3DResult h = convexHull3D_exact(pts);
        check(!h.ok, "all collinear -> ok=false");
    }
    // All coplanar (z == 0): coplanar flag set so caller can fall back to 2D hull.
    {
        std::vector<Point3> pts = {{0,0,0},{2,0,0},{2,2,0},{0,2,0},{1,1,0}};
        ConvexHull3DResult h = convexHull3D_exact(pts);
        check(!h.ok && h.coplanar, "all coplanar -> ok=false, coplanar flag set");
    }
    // Exact duplicates collapse; a duplicate of a corner is still a hull vertex.
    {
        std::vector<Point3> pts = {
            {0,0,0},{1,0,0},{0,1,0},{1,1,0},
            {0,0,1},{1,0,1},{0,1,1},{1,1,1},
            {0,0,0},   // exact duplicate of corner 0
            {1,1,1},   // exact duplicate of corner 7
        };
        ConvexHull3DResult h = convexHull3D_exact(pts);
        check(h.ok && h.vertices.size() == 8,
              "duplicates collapse -> 8 unique hull vertices");
        check(h.isHullVertex[8] && h.isHullVertex[9],
              "a duplicate of a corner is classified a hull vertex");
        check(h.volume == 1.0, "deduped cube volume == 1 (exact)");
    }
}

int main() {
    std::setvbuf(stdout, nullptr, _IOLBF, 0);   // line-buffered: stream progress
    std::printf("=== forge::native::geom::convexHull3D_exact gate ===\n");
    testCube();
    testSphere();
    testInteriorPoints();
    testDegenerate();
    std::printf("\n==== %d / %d checks passed ====\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
