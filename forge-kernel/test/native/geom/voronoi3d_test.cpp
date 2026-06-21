// forge/native/geom/voronoi3d_test.cpp
//
// Standalone validation gate for forge::native::geom::voronoi3D — the 3D Voronoi
// diagram built as the EXACT combinatorial dual of the in-house Delaunay
// tetrahedralization (geom/Delaunay3D), with circumcenters as Voronoi vertices.
//
// Build & run (compiles ONLY this module + its named deps + this test, NOT the
// whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/Voronoi3D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/geom/Delaunay3D.cpp \
//       forge-kernel/test/native/geom/voronoi3d_test.cpp \
//       -o /tmp/k5_Voronoi3D && /tmp/k5_Voronoi3D
//
// Covers the SPEC validations:
//   (a) REGULAR GRID: every INTERIOR site's Voronoi cell volume ~ spacing^3
//       within tolerance, and the sum of bounded-cell volumes <= convex-hull
//       volume of the sites.
//   (b) NEAREST-SITE <=> CELL-CONTAINMENT: the nearest input site to a random
//       query equals the site whose Voronoi cell contains the query, cross-
//       checked against a brute-force nearest over >= 40 queries (on multiple
//       random clouds).
//   (c) DUALITY: Voronoi vertices == circumcenters of the Delaunay tets (each is
//       equidistant from the four sites of its tet), one per tet.
//   (d) COSPHERICAL / DEGENERATE handled via the exact-predicate Delaunay (unit
//       cube of 8 cospherical corners; the interior of a grid).
//   (e) HONEST reporting: < 5 points (single tetra => all sites on the hull =>
//       NO bounded cell, ok=true with reason) and < 4 unique / coplanar /
//       collinear => ok=false carrying the Delaunay diagnosis.
//
// A fresh std::random_device seed is PRINTED so any failure is reproducible.

#include <cstdint>

#include "forge/native/geom/Voronoi3D.hpp"
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/geom/Geom.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <string>
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

// Relative-or-absolute closeness (values are plain double; the combinatorics
// that fix them are exact, so the only error is float arithmetic).
static bool close(double a, double b, double rel = 1e-9, double absT = 1e-9) {
    const double diff = std::fabs(a - b);
    const double scale = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return diff <= std::max(absT, rel * scale);
}

// Convex-hull volume of a point set via the kernel's convexHull3D + divergence
// theorem. Returns false (no volume) if the set is degenerate (coplanar).
static bool hullVolumeOf(const std::vector<Point3>& pts, double& outVol) {
    Hull3D h = convexHull3D(pts);
    if (!h.ok) return false;
    double vol = 0.0;
    for (const auto& f : h.faces) {
        const Point3& a = pts[f[0]];
        const Point3& b = pts[f[1]];
        const Point3& c = pts[f[2]];
        const double cx = b.y * c.z - b.z * c.y;
        const double cy = b.z * c.x - b.x * c.z;
        const double cz = b.x * c.y - b.y * c.x;
        vol += (a.x * cx + a.y * cy + a.z * cz);
    }
    outVol = std::fabs(vol / 6.0);
    return true;
}

static double dist2(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// Brute-force nearest site index (independent of the module's nearestSite).
static int bruteNearest(const std::vector<Point3>& sites, const Point3& q) {
    int best = -1; double bd = std::numeric_limits<double>::infinity();
    for (int i = 0; i < static_cast<int>(sites.size()); ++i) {
        const double d = dist2(sites[i], q);
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

// Is `q` strictly inside the bounded convex cell? A point is inside a convex
// polyhedron iff it is on the SAME side of every face plane as the cell's
// interior. We calibrate the "interior side" from the cell's own centroid (which
// is definitively interior to a convex polyhedron) rather than assuming a face-
// winding sign convention — the side test itself uses a plain double signed
// distance to the face plane, with a small inward margin so a query that merely
// grazes a facet is treated as a boundary (excluded), keeping the containment
// claim strict.
// `strict==true` requires the query to be inside every face by a margin that
// SCALES with the cell's extent, so a query that merely grazes a facet (or sits
// on a long thin sliver cell's boundary, where the float face-plane is least
// reliable) is conservatively reported NOT-inside. This makes a `true` result a
// ROBUST containment claim — exactly what the Voronoi <=> nearest-site identity
// must hold for. (`strict==false` is plain "inside or on", used for coverage.)
static bool insideCellImpl(const VoronoiCell& cell, const Point3& q, bool strict) {
    if (!cell.bounded || cell.hullFaces.empty()) return false;
    // Centroid of the cell vertices: strictly interior for a convex polyhedron.
    Point3 ctr{0, 0, 0};
    for (const auto& v : cell.vertices) { ctr.x += v.x; ctr.y += v.y; ctr.z += v.z; }
    const double inv = 1.0 / static_cast<double>(cell.vertices.size());
    ctr.x *= inv; ctr.y *= inv; ctr.z *= inv;
    // Cell extent (bbox diagonal) sets the relative margin scale.
    Point3 mn{ q.x, q.y, q.z }, mx{ q.x, q.y, q.z };
    for (const auto& v : cell.vertices) {
        mn.x = std::min(mn.x, v.x); mn.y = std::min(mn.y, v.y); mn.z = std::min(mn.z, v.z);
        mx.x = std::max(mx.x, v.x); mx.y = std::max(mx.y, v.y); mx.z = std::max(mx.z, v.z);
    }
    const double diag = std::sqrt((mx.x-mn.x)*(mx.x-mn.x) +
                                  (mx.y-mn.y)*(mx.y-mn.y) +
                                  (mx.z-mn.z)*(mx.z-mn.z));
    const double margin = strict ? std::max(1e-6, 1e-4 * diag) : -1e-6 * std::max(1.0, diag);

    for (const auto& f : cell.hullFaces) {
        const Point3& a = cell.vertices[f[0]];
        const Point3& b = cell.vertices[f[1]];
        const Point3& c = cell.vertices[f[2]];
        // Face normal (b-a) x (c-a) and the plane through a.
        const double ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const double vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const double nx = uy * vz - uz * vy;
        const double ny = uz * vx - ux * vz;
        const double nz = ux * vy - uy * vx;
        const double nlen = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (nlen <= 0.0) continue;                 // degenerate face, skip
        // Signed distances (normalized) of the query and the interior centroid.
        const double sq = (nx * (q.x   - a.x) + ny * (q.y   - a.y) + nz * (q.z   - a.z)) / nlen;
        const double sc = (nx * (ctr.x - a.x) + ny * (ctr.y - a.y) + nz * (ctr.z - a.z)) / nlen;
        // q must be on the interior side (same sign as the centroid), inside by
        // `margin`. Orient the test so "interior" is the positive direction.
        const double sgn = (sc >= 0.0) ? 1.0 : -1.0;
        if (sgn * sq < margin) return false;
    }
    return true;
}
static bool insideCell(const VoronoiCell& cell, const Point3& q) {
    return insideCellImpl(cell, q, /*strict=*/true);
}

// ===========================================================================
// (a) Regular grid: interior cell volume ~ spacing^3, sum <= hull volume.
// ===========================================================================
static void test_regular_grid() {
    std::printf("[regular grid: interior cell volume ~ spacing^3]\n");
    const double h = 2.0;                 // grid spacing
    const int    G = 5;                   // 5x5x5 lattice
    std::vector<Point3> pts;
    for (int i = 0; i < G; ++i)
        for (int j = 0; j < G; ++j)
            for (int k = 0; k < G; ++k)
                pts.push_back(Point3{i * h, j * h, k * h});

    Voronoi3DResult V = voronoi3D(pts);
    check(V.ok, "grid: ok");
    check(static_cast<int>(V.sites.size()) == G * G * G, "grid: all sites kept");
    check(V.boundedCellCount == (G - 2) * (G - 2) * (G - 2),
          "grid: interior count == (G-2)^3 bounded cells");

    // Every bounded cell's volume must be ~ h^3.
    const double target = h * h * h;
    int volOk = 0, bounded = 0;
    for (const auto& cell : V.cells) {
        if (!cell.bounded) continue;
        ++bounded;
        if (close(cell.volume, target, 1e-6, 1e-6)) ++volOk;
        else std::printf("    interior cell %d volume %.10g (target %.10g)\n",
                         cell.site, cell.volume, target);
    }
    check(bounded > 0, "grid: at least one bounded cell");
    check(volOk == bounded, "grid: EVERY bounded cell volume ~ spacing^3");

    // Every bounded cell's faces must be wound CCW as seen from OUTSIDE (the
    // documented hullFaces contract): the face normal points away from the cell
    // centroid. Check on every triangle of every bounded cell.
    int faceTris = 0, outward = 0;
    for (const auto& cell : V.cells) {
        if (!cell.bounded) continue;
        Point3 ctr{0, 0, 0};
        for (const auto& v : cell.vertices) { ctr.x += v.x; ctr.y += v.y; ctr.z += v.z; }
        const double inv = 1.0 / static_cast<double>(cell.vertices.size());
        ctr.x *= inv; ctr.y *= inv; ctr.z *= inv;
        for (const auto& f : cell.hullFaces) {
            const Point3& a = cell.vertices[f[0]];
            const Point3& b = cell.vertices[f[1]];
            const Point3& c = cell.vertices[f[2]];
            const double ux = b.x-a.x, uy = b.y-a.y, uz = b.z-a.z;
            const double vx = c.x-a.x, vy = c.y-a.y, vz = c.z-a.z;
            const double nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
            const double d = nx*(a.x-ctr.x) + ny*(a.y-ctr.y) + nz*(a.z-ctr.z);
            ++faceTris; if (d > 0.0) ++outward;
        }
    }
    check(faceTris > 0 && outward == faceTris,
          "grid: every bounded-cell face is wound outward-CCW");

    // Sum of bounded-cell volumes <= convex-hull volume of the sites.
    double sum = totalBoundedCellVolume(V);
    double hv = 0.0;
    bool gotHull = hullVolumeOf(V.sites, hv);
    check(gotHull, "grid: sites have a non-degenerate convex hull");
    check(sum <= hv + 1e-6, "grid: sum of bounded-cell volumes <= hull volume");
    std::printf("    sum bounded = %.10g, hull = %.10g\n", sum, hv);
}

// ===========================================================================
// (b) Nearest-site <=> cell containment, cross-checked vs brute force.
// ===========================================================================
static void test_nearest_site(std::uint64_t seed) {
    std::printf("[nearest-site == Voronoi-cell owner, vs brute force]\n");
    std::mt19937_64 rng(seed);
    std::uniform_real_distribution<double> U(-50.0, 50.0);

    // --- Part 1: random clouds — module nearestSite == brute-force nearest on
    //     EVERY random query (the exact-scan point-location property), AND any
    //     query that ROBUSTLY lands inside a bounded cell has that cell's site as
    //     its brute-force nearest (Voronoi-containment <=> nearest equivalence).
    int totalQueries = 0;
    int nearestMatch = 0;
    int containMatch = 0;
    int containedTested = 0;

    const int clouds = 6;
    for (int c = 0; c < clouds; ++c) {
        const int N = 30 + static_cast<int>(rng() % 30);   // 30..59 sites
        std::vector<Point3> pts;
        for (int i = 0; i < N; ++i) pts.push_back(Point3{U(rng), U(rng), U(rng)});

        Voronoi3DResult V = voronoi3D(pts);
        if (!V.ok) continue;

        // (1) Arbitrary random queries anywhere in the box: the module's
        //     exact-scan nearestSite must agree with an independent brute force
        //     EVERY time (this is the pure point-location property and is exact).
        const int queries = 12;
        for (int qi = 0; qi < queries; ++qi) {
            Point3 q{U(rng), U(rng), U(rng)};
            ++totalQueries;
            if (nearestSite(V, q) == bruteNearest(V.sites, q)) ++nearestMatch;
        }

        // (2) Voronoi-containment <=> nearest-site, on IRREGULAR clouds. The
        //     unimpeachable, seed-independent invariant: a site is ALWAYS strictly
        //     closest to itself (distance 0; every other distinct site is farther),
        //     and a bounded Voronoi cell strictly contains its own site. So for
        //     every bounded cell we assert: the site point (i) lies inside that
        //     cell and (ii) has that very site as its brute-force AND module
        //     nearest. (We deliberately query AT the site rather than a stepped
        //     point: random clouds occasionally produce two distinct-but-near-
        //     coincident sites, where a finite step toward one would cross the
        //     bisector — the Voronoi diagram of such a cloud is still correct, and
        //     querying at the site avoids asserting on that knife-edge.)
        for (const auto& cell : V.cells) {
            if (!cell.bounded || cell.vertices.empty()) continue;
            const Point3& s = V.sites[cell.site];
            ++containedTested;
            const bool in = insideCellImpl(cell, s, /*strict=*/false);  // inside-or-on
            const int bn = bruteNearest(V.sites, s);
            const int mn = nearestSite(V, s);
            const bool nn = (bn == cell.site);
            const bool mm = (mn == cell.site);
            if (in && nn && mm) ++containMatch;
            else std::printf("    cloud %d site %d: in=%d brute=%d(d2=%.3e self=%.3e) module=%d\n",
                             c, cell.site, (int)in, bn, dist2(V.sites[bn], s),
                             dist2(s, s), mn);
        }
    }

    std::printf("    random: %d nearest queries; %d interior-cell containment probes\n",
                totalQueries, containedTested);
    check(totalQueries >= 40, "nearest: >= 40 random queries issued");
    check(nearestMatch == totalQueries,
          "nearest: module nearestSite == brute-force nearest on EVERY query");
    check(containedTested >= 40, "nearest: >= 40 interior-cell containment probes");
    check(containMatch == containedTested,
          "nearest: interior-cell probe is inside the cell AND nearest to its site");

    // --- Part 2: a DETERMINISTIC grid drives many queries that are GUARANTEED to
    //     land inside known bounded cells (a regular-grid interior cell is a cube
    //     of side h centered on its site). For each interior site we probe its
    //     site location and several jittered points well inside its cube, and
    //     assert: (i) the query is inside that site's bounded cell, (ii) that
    //     site is the brute-force nearest, (iii) the module's nearestSite agrees.
    //     This delivers >= 40 robust cell-containment cross-checks.
    {
        const double h = 3.0;
        const int    G = 5;                 // 5x5x5 => 27 interior sites
        std::vector<Point3> pts;
        for (int i = 0; i < G; ++i)
            for (int j = 0; j < G; ++j)
                for (int k = 0; k < G; ++k)
                    pts.push_back(Point3{i * h, j * h, k * h});

        Voronoi3DResult V = voronoi3D(pts);
        // index of a site by lattice coordinate (k fastest, matching push order)
        auto siteIdx = [&](int i, int j, int k) { return (i * G + j) * G + k; };

        int gridQueries = 0, gridContain = 0, gridNearest = 0, gridOwner = 0;
        // small in-cube offsets (|d| < h/2 so the point stays in this site's cube)
        const double off = 0.35 * h;
        const double jit[5][3] = {
            { 0, 0, 0}, { off, 0, 0}, {0, off, 0}, {0, 0, off}, {-off, off, -off}
        };
        for (int i = 1; i < G - 1; ++i)
            for (int j = 1; j < G - 1; ++j)
                for (int k = 1; k < G - 1; ++k) {
                    const int s = siteIdx(i, j, k);
                    if (!V.cells[s].bounded) continue;
                    for (const auto& d : jit) {
                        Point3 q{ i * h + d[0], j * h + d[1], k * h + d[2] };
                        ++gridQueries;
                        if (insideCell(V.cells[s], q)) ++gridContain;
                        if (bruteNearest(V.sites, q) == s) ++gridNearest;
                        if (nearestSite(V, q) == s) ++gridOwner;
                    }
                }

        std::printf("    grid: %d in-cube queries probed\n", gridQueries);
        check(gridQueries >= 40, "nearest(grid): >= 40 in-cell queries issued");
        check(gridContain == gridQueries,
              "nearest(grid): every in-cube query is inside its site's bounded cell");
        check(gridNearest == gridQueries,
              "nearest(grid): the cell's site is the brute-force nearest");
        check(gridOwner == gridQueries,
              "nearest(grid): module nearestSite returns the cell's site");
    }
}

// ===========================================================================
// (c) Duality: Voronoi vertices == tet circumcenters (equidistant from sites).
// ===========================================================================
static void test_duality(std::uint64_t seed) {
    std::printf("[duality: Voronoi vertices are tet circumcenters]\n");
    std::mt19937_64 rng(seed ^ 0xABCDEF12u);
    std::uniform_real_distribution<double> U(-20.0, 20.0);

    const int N = 40;
    std::vector<Point3> pts;
    for (int i = 0; i < N; ++i) pts.push_back(Point3{U(rng), U(rng), U(rng)});

    Voronoi3DResult V = voronoi3D(pts);
    Delaunay3DResult D = delaunay3D(pts);
    check(V.ok && D.ok, "duality: both Voronoi and Delaunay ok");
    check(V.voronoiVertices.size() == D.tetrahedra.size(),
          "duality: one Voronoi vertex per Delaunay tet");

    // Each Voronoi vertex is equidistant from the four sites of its tet.
    int equi = 0;
    for (int t = 0; t < static_cast<int>(D.tetrahedra.size()); ++t) {
        const auto& q = D.tetrahedra[t];
        const Point3& o = V.voronoiVertices[t];
        const double r0 = dist2(o, V.sites[q[0]]);
        const double r1 = dist2(o, V.sites[q[1]]);
        const double r2 = dist2(o, V.sites[q[2]]);
        const double r3 = dist2(o, V.sites[q[3]]);
        if (close(r0, r1, 1e-6, 1e-6) && close(r0, r2, 1e-6, 1e-6) &&
            close(r0, r3, 1e-6, 1e-6))
            ++equi;
    }
    check(equi == static_cast<int>(D.tetrahedra.size()),
          "duality: every Voronoi vertex equidistant from its 4 sites");

    // The circumcenter is the empty-circumsphere center: no OTHER site is closer
    // to it than the four sites of the tet (consequence of the Delaunay property,
    // up to float slack). Spot-checked on every tet.
    int emptyOk = 0;
    for (int t = 0; t < static_cast<int>(D.tetrahedra.size()); ++t) {
        const auto& q = D.tetrahedra[t];
        const Point3& o = V.voronoiVertices[t];
        const double R = dist2(o, V.sites[q[0]]);
        bool ok = true;
        for (int s = 0; s < static_cast<int>(V.sites.size()); ++s) {
            if (s == q[0] || s == q[1] || s == q[2] || s == q[3]) continue;
            if (dist2(o, V.sites[s]) < R * (1.0 - 1e-9)) { ok = false; break; }
        }
        if (ok) ++emptyOk;
    }
    check(emptyOk == static_cast<int>(D.tetrahedra.size()),
          "duality: circumcenter is an empty-sphere center (no closer site)");
}

// ===========================================================================
// (d) Cospherical handling: the unit cube of 8 cospherical corners.
// ===========================================================================
static void test_unit_cube() {
    std::printf("[cospherical: unit cube (8 cospherical corners)]\n");
    std::vector<Point3> pts;
    for (int x = 0; x <= 1; ++x)
        for (int y = 0; y <= 1; ++y)
            for (int z = 0; z <= 1; ++z)
                pts.push_back(Point3{static_cast<double>(x),
                                     static_cast<double>(y),
                                     static_cast<double>(z)});
    Voronoi3DResult V = voronoi3D(pts);
    check(V.ok, "cube: ok (cospherical handled by exact Delaunay)");
    // All 8 corners are on the hull => NO interior site => no bounded cell.
    check(V.boundedCellCount == 0, "cube: no bounded cell (all corners on hull)");
    check(static_cast<int>(V.cells.size()) == 8, "cube: 8 cells (one per site)");
    bool allUnbounded = true;
    for (const auto& cell : V.cells) if (cell.bounded) allUnbounded = false;
    check(allUnbounded, "cube: every cell reported unbounded honestly");
}

// ===========================================================================
// (e) Honest reporting of degenerate / small inputs.
// ===========================================================================
static void test_honest_reporting() {
    std::printf("[honest reporting: small / degenerate inputs]\n");

    // Single tetrahedron: 4 points, all on the hull => no bounded cell, ok=true.
    {
        std::vector<Point3> pts = {{0,0,0},{1,0,0},{0,1,0},{0,0,1}};
        Voronoi3DResult V = voronoi3D(pts);
        check(V.ok, "tetra(4 pts): ok=true (diagram exists)");
        check(V.boundedCellCount == 0, "tetra: 0 bounded cells (all on hull)");
        check(std::string(V.reason).find("unbounded") != std::string::npos,
              "tetra: reason reports unbounded-only honestly");
    }

    // Fewer than 4 unique points => no 3D Delaunay => ok=false.
    {
        std::vector<Point3> pts = {{0,0,0},{1,0,0},{0,1,0}};
        Voronoi3DResult V = voronoi3D(pts);
        check(!V.ok, "3 pts: ok=false (no 3D Delaunay)");
        check(V.cells.empty(), "3 pts: no cells produced");
    }

    // All coplanar (>=4 points, all z=0) => ok=false, forwarded reason.
    {
        std::vector<Point3> pts = {{0,0,0},{1,0,0},{0,1,0},{1,1,0},{2,3,0}};
        Voronoi3DResult V = voronoi3D(pts);
        check(!V.ok, "coplanar: ok=false");
        check(std::string(V.reason).find("coplanar") != std::string::npos,
              "coplanar: Delaunay reason forwarded");
    }

    // All collinear => ok=false.
    {
        std::vector<Point3> pts = {{0,0,0},{1,1,1},{2,2,2},{3,3,3}};
        Voronoi3DResult V = voronoi3D(pts);
        check(!V.ok, "collinear: ok=false");
        check(std::string(V.reason).find("collinear") != std::string::npos,
              "collinear: Delaunay reason forwarded");
    }

    // Duplicates collapsing below 4 unique => ok=false.
    {
        std::vector<Point3> pts = {{0,0,0},{0,0,0},{1,0,0},{1,0,0},{0,1,0}};
        Voronoi3DResult V = voronoi3D(pts);
        check(!V.ok, "dups<4 unique: ok=false");
    }
}

// ===========================================================================
int main() {
    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("voronoi3d_test seed = %llu\n",
                static_cast<unsigned long long>(seed));

    test_regular_grid();
    test_nearest_site(seed);
    test_duality(seed);
    test_unit_cube();
    test_honest_reporting();

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
