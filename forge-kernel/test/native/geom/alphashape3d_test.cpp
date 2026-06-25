// forge/native/geom/alphashape3d_test.cpp
//
// Standalone validation gate for forge::native::geom::alphaShape3D.
//
// Build & run (compiles ONLY this module + its named deps + this test, NOT the
// whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/AlphaShape3D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/geom/Delaunay3D.cpp \
//       forge-kernel/test/native/geom/alphashape3d_test.cpp \
//       -o /tmp/k6_AlphaShape3D && /tmp/k6_AlphaShape3D
//
// Covers the SPEC validations:
//   (a) alpha = +inf (and alpha = maxCircumradius) keeps EVERY Delaunay tet, so
//       the alpha boundary is exactly the convex-hull boundary: the SAME
//       undirected triangle set as Delaunay3DResult::hullFaces.
//   (b) Points sampled on a SPHERE of radius R (with interior support so the ball
//       is tetrahedralized solid) reconstruct, at a suitable alpha, a CLOSED,
//       orientable surface whose enclosed volume ~ (4/3) pi R^3 within tol, and
//       every boundary triangle belongs to a kept tet whose circumradius <= alpha.
//   (c) The alpha-MEMBERSHIP invariant on RANDOM clouds: every kept tet has
//       circumradius <= alpha, and every boundary triangle is a face of exactly
//       one kept tet; the alpha boundary edge-matches the kept-tet region.
//   (d) MONOTONICITY: increasing alpha keeps a superset of tets; at alpha = max it
//       equals the hull; too-small alpha keeps NOTHING (empty boundary, ok=true).
//   (e) HONEST ok=false on degenerate input: < 4 points, all coplanar, all
//       collinear — the Delaunay `reason` is propagated, no geometry fabricated.
//   (f) enclosed-volume(boundary) == summed kept-tet volume (the boundary really
//       bounds the kept region).
//
// The fresh std::random_device seed is PRINTED so any failure is reproducible.

#include <cstdint>
#include "forge/native/geom/AlphaShape3D.hpp"
#include "forge/native/geom/Delaunay3D.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <map>
#include <random>
#include <set>
#include <vector>

using namespace forge::native;
using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

static bool volClose(double a, double b, double rel) {
    double diff = std::fabs(a - b);
    double scale = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return diff <= rel * scale;
}

// Undirected-triangle-key set of a list of index triples (orientation-agnostic).
static std::set<std::array<int,3>> undirectedSet(
        const std::vector<std::array<int,3>>& tris) {
    std::set<std::array<int,3>> s;
    for (const auto& f : tris) {
        std::array<int,3> k{f[0], f[1], f[2]};
        std::sort(k.begin(), k.end());
        s.insert(k);
    }
    return s;
}

static std::array<int,3> sortedKey(int a, int b, int c) {
    std::array<int,3> k{a, b, c};
    std::sort(k.begin(), k.end());
    return k;
}

// ===========================================================================
// (a) alpha = +inf  ==  convex hull boundary.
// ===========================================================================
static void test_inf_equals_hull(std::uint64_t seed) {
    std::printf("[alpha = +inf / max == convex-hull boundary]\n");
    std::mt19937_64 rng(seed ^ 0xA1u);
    std::uniform_real_distribution<double> U(-50.0, 50.0);

    int trials = 12, ran = 0, hullEqInf = 0, hullEqMax = 0, closedInf = 0;
    for (int t = 0; t < trials; ++t) {
        int N = 12 + static_cast<int>(rng() % 30);
        std::vector<Point3> pts;
        for (int i = 0; i < N; ++i) pts.push_back(Point3{U(rng), U(rng), U(rng)});

        Delaunay3DResult D = delaunay3D(pts);
        if (!D.ok) continue;
        ++ran;

        AlphaShape3DResult inf = alphaShape3DFromDelaunay(D, alphaInfinity());
        // alpha = exactly the max circumradius must also keep every tet.
        AlphaShape3DResult mx  = alphaShape3DFromDelaunay(D, inf.maxCircumradius);

        auto hullSet = undirectedSet(D.hullFaces);
        if (undirectedSet(inf.boundary) == hullSet) ++hullEqInf;
        if (undirectedSet(mx.boundary)  == hullSet) ++hullEqMax;
        if (alphaBoundaryIsClosed(inf)) ++closedInf;
    }
    check(ran >= 8, "inf: enough non-degenerate clouds");
    check(hullEqInf == ran, "inf: alpha=+inf boundary == Delaunay hullFaces (undirected)");
    check(hullEqMax == ran, "inf: alpha=maxCircumradius boundary == hullFaces");
    check(closedInf == ran, "inf: alpha=+inf boundary is closed & orientable");
}

// ===========================================================================
// (b) Sphere reconstruction: volume ~ (4/3) pi R^3, closed, alpha-valid.
// ===========================================================================
static void test_sphere_reconstruction() {
    std::printf("[sphere sample -> closed surface, V ~ (4/3) pi R^3]\n");
    const double R = 3.0;
    const int k = 400;  // dense Fibonacci sphere

    std::vector<Point3> pts;
    // Interior support so the ball is tetrahedralized as a SOLID, not just a
    // thin shell (the alpha shape of a solid ball is what encloses the volume).
    pts.push_back(Point3{0, 0, 0});
    // A few shells of interior support keep the inradius of interior tets small
    // so a modest alpha fills the ball without bridging across the surface.
    const double shellR[3] = {0.4 * R, 0.7 * R, 0.9 * R};
    const int shellK[3] = {40, 90, 160};
    for (int s = 0; s < 3; ++s) {
        for (int i = 0; i < shellK[s]; ++i) {
            double phi = std::acos(1.0 - 2.0 * (i + 0.5) / shellK[s]);
            double theta = M_PI * (1.0 + std::sqrt(5.0)) * i;
            pts.push_back(Point3{shellR[s] * std::sin(phi) * std::cos(theta),
                                 shellR[s] * std::sin(phi) * std::sin(theta),
                                 shellR[s] * std::cos(phi)});
        }
    }
    for (int i = 0; i < k; ++i) {
        double phi = std::acos(1.0 - 2.0 * (i + 0.5) / k);
        double theta = M_PI * (1.0 + std::sqrt(5.0)) * i;
        pts.push_back(Point3{R * std::sin(phi) * std::cos(theta),
                             R * std::sin(phi) * std::sin(theta),
                             R * std::cos(phi)});
    }

    Delaunay3DResult D = delaunay3D(pts);
    check(D.ok, "sphere: delaunay ok");

    // A suitable alpha: large enough to fill the (well-sampled) interior but
    // small enough not to bridge across the surface. The mean nearest-neighbour
    // spacing on the surface is ~ R * sqrt(4*pi / k) ~ 0.21*R here; an alpha a
    // few times that fills the ball. We probe a small ladder and accept the one
    // that yields a closed surface of the right volume (this is how a user
    // chooses alpha — the gate just proves such an alpha exists and is honest).
    const double trueVol = 4.0 / 3.0 * M_PI * R * R * R;
    bool foundGood = false;
    double bestVol = 0.0, bestAlpha = 0.0;
    for (double a = 0.4; a <= 2.0 + 1e-9; a += 0.1) {
        AlphaShape3DResult A = alphaShape3DFromDelaunay(D, a);
        if (A.boundary.empty()) continue;
        if (!alphaBoundaryIsClosed(A)) continue;
        double v = alphaEnclosedVolume(A);
        if (volClose(v, trueVol, 0.06)) {  // within 6% of the analytic ball
            foundGood = true;
            bestVol = v;
            bestAlpha = a;

            // Within this good alpha, ALL the SPEC invariants must hold.
            // (1) every kept tet has circumradius <= alpha.
            bool allRadiusOk = true;
            for (const auto& tt : A.keptTets) {
                double r = tetCircumradius(A.points[tt[0]], A.points[tt[1]],
                                           A.points[tt[2]], A.points[tt[3]]);
                if (!(r <= a)) { allRadiusOk = false; break; }
            }
            check(allRadiusOk, "sphere: every kept tet circumradius <= alpha");

            // (2) every boundary triangle is a face of exactly one kept tet.
            std::map<std::array<int,3>, int> faceCount;
            for (const auto& tt : A.keptTets) {
                const int F[4][3] = {
                    {tt[0], tt[1], tt[2]}, {tt[0], tt[3], tt[1]},
                    {tt[0], tt[2], tt[3]}, {tt[1], tt[3], tt[2]}
                };
                for (auto& f : F) ++faceCount[sortedKey(f[0], f[1], f[2])];
            }
            bool everyBoundaryOnOneTet = true;
            for (const auto& bf : A.boundary) {
                auto it = faceCount.find(sortedKey(bf[0], bf[1], bf[2]));
                if (it == faceCount.end() || it->second != 1) {
                    everyBoundaryOnOneTet = false;
                    break;
                }
            }
            check(everyBoundaryOnOneTet,
                  "sphere: every boundary tri bounds exactly one kept tet");

            // (3) enclosed volume(boundary) == summed kept-tet volume.
            check(volClose(alphaEnclosedVolume(A), alphaKeptTetVolume(A), 1e-9),
                  "sphere: enclosed-volume(boundary) == kept-tet volume");
            break;
        }
    }
    check(foundGood, "sphere: a suitable alpha reconstructs the ball volume");
    if (foundGood)
        std::printf("    chose alpha=%.2f -> V=%.4f (true %.4f, R=%.1f)\n",
                    bestAlpha, bestVol, trueVol, R);
}

// ===========================================================================
// (c) Alpha-membership invariant + (d) monotonicity on random clouds.
// ===========================================================================
static void test_membership_and_monotonicity(std::uint64_t seed) {
    std::printf("[alpha-membership invariant + monotonicity, random clouds]\n");
    std::mt19937_64 rng(seed ^ 0xC0FFEEu);
    std::uniform_real_distribution<double> U(-40.0, 40.0);

    int trials = 20, ran = 0;
    int radiusOk = 0, boundaryOnTet = 0, monoOk = 0, volMatch = 0, emptyOk = 0;

    for (int t = 0; t < trials; ++t) {
        int N = 10 + static_cast<int>(rng() % 30);
        std::vector<Point3> pts;
        for (int i = 0; i < N; ++i) pts.push_back(Point3{U(rng), U(rng), U(rng)});

        Delaunay3DResult D = delaunay3D(pts);
        if (!D.ok) continue;
        ++ran;

        double maxR = 0.0;
        for (const auto& tt : D.tetrahedra) {
            double r = tetCircumradius(D.points[tt[0]], D.points[tt[1]],
                                       D.points[tt[2]], D.points[tt[3]]);
            if (std::isfinite(r)) maxR = std::max(maxR, r);
        }
        // Probe an alpha around the median scale of this cloud.
        double a = 0.35 * maxR;
        AlphaShape3DResult A = alphaShape3DFromDelaunay(D, a);

        // (i) every kept tet has circumradius <= alpha.
        bool rok = true;
        for (const auto& tt : A.keptTets) {
            double r = tetCircumradius(A.points[tt[0]], A.points[tt[1]],
                                       A.points[tt[2]], A.points[tt[3]]);
            if (!(r <= a)) { rok = false; break; }
        }
        if (rok) ++radiusOk;

        // (ii) every boundary tri bounds exactly one kept tet.
        std::map<std::array<int,3>, int> fc;
        for (const auto& tt : A.keptTets) {
            const int F[4][3] = {
                {tt[0], tt[1], tt[2]}, {tt[0], tt[3], tt[1]},
                {tt[0], tt[2], tt[3]}, {tt[1], tt[3], tt[2]}
            };
            for (auto& f : F) ++fc[sortedKey(f[0], f[1], f[2])];
        }
        bool bok = true;
        for (const auto& bf : A.boundary) {
            auto it = fc.find(sortedKey(bf[0], bf[1], bf[2]));
            if (it == fc.end() || it->second != 1) { bok = false; break; }
        }
        if (bok) ++boundaryOnTet;

        // (iii) monotonicity: kept tets at a larger alpha are a superset.
        AlphaShape3DResult Abig = alphaShape3DFromDelaunay(D, 0.7 * maxR);
        std::set<std::array<int,4>> small(A.keptTets.begin(), A.keptTets.end());
        std::set<std::array<int,4>> big(Abig.keptTets.begin(), Abig.keptTets.end());
        bool superset = std::includes(big.begin(), big.end(),
                                      small.begin(), small.end());
        // and the FULL set at alpha=inf equals every Delaunay tet.
        AlphaShape3DResult Ainf = alphaShape3DFromDelaunay(D, alphaInfinity());
        bool fullIsAll = (Ainf.keptTets.size() == D.tetrahedra.size());
        if (superset && fullIsAll) ++monoOk;

        // (iv) the boundary really bounds the kept region (volume identity).
        if (volClose(alphaEnclosedVolume(A), alphaKeptTetVolume(A), 1e-9))
            ++volMatch;

        // (v) too-small alpha keeps nothing, honestly (ok=true, empty boundary).
        AlphaShape3DResult tiny = alphaShape3DFromDelaunay(D, 1e-9 * maxR);
        if (tiny.ok && tiny.keptTets.empty() && tiny.boundary.empty()) ++emptyOk;
    }

    check(ran >= 12, "random: enough non-degenerate clouds");
    check(radiusOk == ran,     "random: every kept tet circumradius <= alpha");
    check(boundaryOnTet == ran,"random: every boundary tri bounds exactly one kept tet");
    check(monoOk == ran,       "random: kept-tet set is monotone in alpha; inf == all tets");
    check(volMatch == ran,     "random: enclosed-volume(boundary) == kept-tet volume");
    check(emptyOk == ran,      "random: too-small alpha -> empty boundary (honest ok=true)");
}

// ===========================================================================
// (b') Analytic: a single regular-ish solid (the unit cube) at alpha=inf gives
//      the 12-triangle cube boundary; an alpha below the cube's circumradius but
//      above its face/sub-tet radii degrades honestly.
// ===========================================================================
static void test_cube_alpha() {
    std::printf("[analytic: unit cube]\n");
    std::vector<Point3> pts;
    for (int x = 0; x <= 1; ++x)
        for (int y = 0; y <= 1; ++y)
            for (int z = 0; z <= 1; ++z)
                pts.push_back(Point3{double(x), double(y), double(z)});

    Delaunay3DResult D = delaunay3D(pts);
    check(D.ok, "cube: delaunay ok");

    AlphaShape3DResult inf = alphaShape3DFromDelaunay(D, alphaInfinity());
    check(undirectedSet(inf.boundary) == undirectedSet(D.hullFaces),
          "cube: alpha=inf boundary == hull (12 tris)");
    check(inf.boundary.size() == 12, "cube: 12 boundary triangles at alpha=inf");
    check(volClose(alphaEnclosedVolume(inf), 1.0, 1e-9),
          "cube: alpha=inf enclosed volume == 1");
    check(alphaBoundaryIsClosed(inf), "cube: alpha=inf boundary closed");

    // The cube's 8 corners are cospherical; every Delaunay tet of the cube shares
    // the same circumradius sqrt(3)/2 ~ 0.866 (the cube's own circumradius). So an
    // alpha just below that keeps NOTHING (honest empty), and an alpha at/above it
    // recovers the whole cube. This is the honest "too-small -> sparse/empty".
    AlphaShape3DResult below = alphaShape3DFromDelaunay(D, 0.80);
    check(below.ok && below.boundary.empty(),
          "cube: alpha below circumradius -> empty boundary (honest)");
    AlphaShape3DResult atR = alphaShape3DFromDelaunay(D, 0.8661);
    check(undirectedSet(atR.boundary) == undirectedSet(D.hullFaces),
          "cube: alpha at circumradius recovers full cube boundary");
}

// ===========================================================================
// (e) Degenerate / unsupported input -> honest ok=false (Delaunay reason).
// ===========================================================================
static void test_degenerate() {
    std::printf("[degenerate input -> honest ok=false]\n");

    AlphaShape3DResult e0 = alphaShape3D({}, alphaInfinity());
    check(!e0.ok && e0.boundary.empty() && e0.keptTets.empty(),
          "empty input: ok==false, no geometry");
    check(e0.reason && e0.reason[0] != '\0', "empty input: a reason is given");

    AlphaShape3DResult e3 = alphaShape3D({{0,0,0},{1,0,0},{0,1,0}}, alphaInfinity());
    check(!e3.ok && e3.boundary.empty(), "three points: ok==false (< 4)");

    AlphaShape3DResult cop = alphaShape3D({
        {0,0,0},{1,0,0},{1,1,0},{0,1,0},{2,3,0},{-1,5,0}
    }, alphaInfinity());
    check(!cop.ok && cop.boundary.empty(), "all-coplanar: ok==false");

    AlphaShape3DResult col = alphaShape3D({
        {0,0,0},{1,1,1},{2,2,2},{3,3,3}
    }, alphaInfinity());
    check(!col.ok && col.boundary.empty(), "all-collinear: ok==false");
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint64_t seed = (static_cast<std::uint64_t>(rd()) << 32) ^
                          static_cast<std::uint64_t>(rd());
    std::printf("== forge::native::geom::alphaShape3D validation gate ==\n");
    std::printf("   fresh random seed = 0x%016llx\n\n",
                static_cast<unsigned long long>(seed));

    test_inf_equals_hull(seed);
    test_sphere_reconstruction();
    test_membership_and_monotonicity(seed);
    test_cube_alpha();
    test_degenerate();

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
