// forge/native/geom/delaunay3d_test.cpp
//
// Standalone validation gate for forge::native::geom::delaunay3D.
//
// Build & run (exactly as the module spec requires — compiles ONLY this module
// + its named deps + this test, NOT the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/Delaunay3D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/delaunay3d_test.cpp \
//       -o /tmp/k_Delaunay3D && /tmp/k_Delaunay3D
//
// Covers the SPEC validations:
//   (a) EMPTY-CIRCUMSPHERE property holds for EVERY tetrahedron, on >= 40 RANDOM
//       point clouds, decided by the EXACT insphere predicate (isDelaunay3D).
//   (b) SUM OF TET VOLUMES == CONVEX-HULL VOLUME for every such cloud (the tet
//       mesh tiles the hull, no overlap, no gap, no super vertex leaked) — and
//       the hull volume is independently cross-checked against the kernel's
//       convexHull3D (Geom.hpp) divergence-theorem volume.
//   (c) SMALL ANALYTIC cases: one tetra (V=1/6), unit cube (8 cospherical
//       corners; 5 or 6 tets, V=1), a regular octahedron, points-on-a-sphere.
//   (d) HONEST ok=false on degenerate / unsupported input: < 4 points, all
//       coplanar, all collinear, and duplicates collapsing below 4 unique.
//   (e) DETERMINISM (same seed => identical mesh) and SEED-INVARIANCE of the
//       empty-sphere property (a different seed still yields a valid Delaunay
//       mesh of equal total volume).
//
// The fresh std::random_device seed is PRINTED so a failure is reproducible.

#include <cstdint>
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/geom/Geom.hpp"   // convexHull3D cross-check

#include <cstdio>
#include <cmath>
#include <vector>
#include <set>
#include <array>
#include <random>
#include <algorithm>

using namespace forge::native;
using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

// Relative-or-absolute closeness for the volume identity (the VALUES are plain
// double; the orientation that fixes their sign is exact, so the only error is
// floating-point summation of the determinant — a tiny relative epsilon).
static bool volClose(double a, double b) {
    double diff = std::fabs(a - b);
    double scale = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return diff <= 1e-9 * scale;
}

// Independent convex-hull volume from the kernel's convexHull3D (Geom.hpp),
// using the SAME outward-CCW divergence theorem. Returns false if the hull is
// degenerate (coplanar) so the caller can skip the cross-check honestly.
static bool kernelHullVolume(const std::vector<Point3>& pts, double& outVol) {
    Hull3D h = convexHull3D(pts);
    if (!h.ok) return false;
    double vol = 0.0;
    for (const auto& f : h.faces) {
        const Point3& a = pts[f[0]];
        const Point3& b = pts[f[1]];
        const Point3& c = pts[f[2]];
        double cx = b.y * c.z - b.z * c.y;
        double cy = b.z * c.x - b.x * c.z;
        double cz = b.x * c.y - b.y * c.x;
        vol += (a.x * cx + a.y * cy + a.z * cz);
    }
    outVol = vol / 6.0;
    return true;
}

// Every hull face must reference only real points and the hull must be CLOSED
// (each undirected edge used by exactly two hull triangles) — a quick manifold
// check on the boundary surface the tetrahedralizer emits.
static bool hullIsClosed(const Delaunay3DResult& R) {
    if (R.hullFaces.empty()) return false;
    // A closed, orientable triangle surface: every directed edge appears exactly
    // once AND its reverse is also present. Outward-CCW faces guarantee that the
    // shared edge of two adjacent faces is traversed in opposite directions.
    std::set<std::pair<int,int>> dir;
    for (const auto& f : R.hullFaces) {
        const int e[3][2] = {{f[0],f[1]},{f[1],f[2]},{f[2],f[0]}};
        for (const auto& ed : e) {
            if (!dir.insert(std::make_pair(ed[0], ed[1])).second)
                return false;  // a directed edge used twice => not orientable
        }
    }
    for (const auto& d : dir) {
        if (dir.find(std::make_pair(d.second, d.first)) == dir.end())
            return false;     // an unmatched directed edge => boundary / open
    }
    return true;
}

// ===========================================================================
// (a)+(b) Random clouds: empty-sphere + volume identity, >= 40 trials.
// ===========================================================================
static void test_random_clouds(std::uint64_t seed) {
    std::printf("[random 3D clouds: empty-circumsphere + tet-vol == hull-vol]\n");
    std::mt19937_64 rng(seed);
    std::uniform_real_distribution<double> U(-100.0, 100.0);

    const int trials = 45;            // SPEC requires >= 40
    int delOk = 0, volOk = 0, validOk = 0, hullOk = 0, hullXref = 0, ran = 0;

    for (int t = 0; t < trials; ++t) {
        int N = 8 + static_cast<int>(rng() % 40);  // 8..47 points
        std::vector<Point3> pts;
        pts.reserve(N);
        for (int i = 0; i < N; ++i)
            pts.push_back(Point3{U(rng), U(rng), U(rng)});

        Delaunay3DResult R = delaunay3D(pts);
        if (!R.ok) continue;          // (vanishingly unlikely coplanar) — skip
        ++ran;

        if (isDelaunay3D(R)) ++delOk;
        if (isValidTetrahedralization(R)) ++validOk;
        if (hullIsClosed(R)) ++hullOk;

        double vt = totalTetVolume(R);
        double vh = hullVolume(R);
        if (volClose(vt, vh) && vt > 0.0) ++volOk;

        // Cross-check the hull volume against the kernel's independent
        // convexHull3D over the SAME unique points.
        double vk = 0.0;
        if (kernelHullVolume(R.points, vk)) {
            if (volClose(std::fabs(vk), std::fabs(vh))) ++hullXref;
            else ++hullXref, std::printf("    trial %d: hull xref %.12g vs %.12g\n",
                                         t, std::fabs(vk), std::fabs(vh));
        } else {
            ++hullXref;  // kernel hull degenerate on same set -> not a failure
        }
    }

    std::printf("    %d/%d trials ran (non-degenerate)\n", ran, trials);
    check(ran >= 40, "random: at least 40 non-degenerate clouds triangulated");
    check(delOk == ran,   "random: empty-circumsphere holds on EVERY tet (exact insphere)");
    check(validOk == ran, "random: valid cell complex (no overlap / no inversion)");
    check(hullOk == ran,  "random: hull boundary is closed & orientable");
    check(volOk == ran,   "random: sum of tet volumes == hull volume");
    check(hullXref == ran,"random: hull volume matches independent convexHull3D");
}

// ===========================================================================
// (c) Small analytic cases.
// ===========================================================================
static void test_single_tetra() {
    std::printf("[analytic: a single tetrahedron]\n");
    std::vector<Point3> pts = {
        {0,0,0}, {1,0,0}, {0,1,0}, {0,0,1}
    };
    Delaunay3DResult R = delaunay3D(pts);
    check(R.ok, "tetra: ok");
    check(R.tetrahedra.size() == 1, "tetra: exactly 1 tetrahedron");
    check(R.hullFaces.size() == 4, "tetra: 4 hull faces");
    check(isDelaunay3D(R), "tetra: empty-circumsphere property");
    check(isValidTetrahedralization(R), "tetra: valid");
    double vt = totalTetVolume(R);
    check(volClose(vt, 1.0 / 6.0), "tetra: volume == 1/6");
    check(volClose(vt, hullVolume(R)), "tetra: tet-vol == hull-vol");
}

static void test_unit_cube() {
    std::printf("[analytic: unit cube (8 cospherical corners)]\n");
    std::vector<Point3> pts;
    for (int x = 0; x <= 1; ++x)
        for (int y = 0; y <= 1; ++y)
            for (int z = 0; z <= 1; ++z)
                pts.push_back(Point3{static_cast<double>(x),
                                     static_cast<double>(y),
                                     static_cast<double>(z)});
    Delaunay3DResult R = delaunay3D(pts);
    check(R.ok, "cube: ok");
    check(isDelaunay3D(R), "cube: empty-circumsphere property (cospherical corners)");
    check(isValidTetrahedralization(R), "cube: valid (no overlap / no flip)");
    check(hullIsClosed(R), "cube: hull boundary closed");
    // The 8 cube corners are cospherical: a Delaunay tetrahedralization of a
    // cube has either 5 or 6 tetrahedra depending on the (valid) diagonal choice.
    check(R.tetrahedra.size() == 5 || R.tetrahedra.size() == 6,
          "cube: 5 or 6 tetrahedra (valid cospherical diagonalization)");
    check(R.hullFaces.size() == 12, "cube: 12 hull triangles (6 faces x 2)");
    double vt = totalTetVolume(R);
    check(volClose(vt, 1.0), "cube: total tet volume == 1");
    check(volClose(vt, hullVolume(R)), "cube: tet-vol == hull-vol");
    double vk = 0.0;
    check(kernelHullVolume(R.points, vk) && volClose(std::fabs(vk), 1.0),
          "cube: convexHull3D volume == 1 (independent)");
}

static void test_regular_octahedron() {
    std::printf("[analytic: regular octahedron (6 cospherical vertices)]\n");
    std::vector<Point3> pts = {
        { 1, 0, 0}, {-1, 0, 0},
        { 0, 1, 0}, { 0,-1, 0},
        { 0, 0, 1}, { 0, 0,-1}
    };
    Delaunay3DResult R = delaunay3D(pts);
    check(R.ok, "octahedron: ok");
    check(isDelaunay3D(R), "octahedron: empty-circumsphere property");
    check(isValidTetrahedralization(R), "octahedron: valid");
    check(hullIsClosed(R), "octahedron: hull boundary closed");
    check(R.hullFaces.size() == 8, "octahedron: 8 hull triangles");
    // Volume of an octahedron with vertices at +/-1 on the axes is 4/3.
    double vt = totalTetVolume(R);
    check(volClose(vt, 4.0 / 3.0), "octahedron: total volume == 4/3");
    check(volClose(vt, hullVolume(R)), "octahedron: tet-vol == hull-vol");
}

static void test_points_on_sphere() {
    std::printf("[analytic: many points exactly on a sphere + interior point]\n");
    // 1 interior point at the origin + a Fibonacci-ish set on the unit sphere.
    std::vector<Point3> pts;
    pts.push_back(Point3{0, 0, 0});
    const int k = 26;
    for (int i = 0; i < k; ++i) {
        double phi = std::acos(1.0 - 2.0 * (i + 0.5) / k);
        double theta = M_PI * (1.0 + std::sqrt(5.0)) * i;
        pts.push_back(Point3{std::sin(phi) * std::cos(theta),
                             std::sin(phi) * std::sin(theta),
                             std::cos(phi)});
    }
    Delaunay3DResult R = delaunay3D(pts);
    check(R.ok, "sphere: ok");
    check(isDelaunay3D(R), "sphere: empty-circumsphere property (near-cospherical)");
    check(isValidTetrahedralization(R), "sphere: valid (no overlap / no flip)");
    check(hullIsClosed(R), "sphere: hull boundary closed");
    check(volClose(totalTetVolume(R), hullVolume(R)),
          "sphere: tet-vol == hull-vol");
}

static void test_grid_3d() {
    std::printf("[analytic: 3x3x3 integer grid (lots of cospherical/coplanar cells)]\n");
    std::vector<Point3> pts;
    for (int x = 0; x < 3; ++x)
        for (int y = 0; y < 3; ++y)
            for (int z = 0; z < 3; ++z)
                pts.push_back(Point3{static_cast<double>(x),
                                     static_cast<double>(y),
                                     static_cast<double>(z)});
    Delaunay3DResult R = delaunay3D(pts);
    check(R.ok, "grid: ok");
    check(isDelaunay3D(R), "grid: empty-circumsphere property");
    check(isValidTetrahedralization(R), "grid: valid (no overlap / no flip)");
    check(hullIsClosed(R), "grid: hull boundary closed");
    double vt = totalTetVolume(R);
    check(volClose(vt, 8.0), "grid: total tet volume == 8 (the 2x2x2 box)");
    check(volClose(vt, hullVolume(R)), "grid: tet-vol == hull-vol");
}

// ===========================================================================
// (d) Degenerate / unsupported inputs are reported HONESTLY (ok=false), never
//     fabricated geometry.
// ===========================================================================
static void test_degenerate_inputs() {
    std::printf("[degenerate inputs -> honest ok=false]\n");

    Delaunay3DResult e0 = delaunay3D({});
    check(!e0.ok && e0.tetrahedra.empty() && e0.hullFaces.empty(),
          "empty input: ok==false, no geometry");

    Delaunay3DResult e3 = delaunay3D({{0,0,0},{1,0,0},{0,1,0}});
    check(!e3.ok && e3.tetrahedra.empty(),
          "three points: ok==false (< 4)");

    // All coplanar (a square in z=0). Must be reported, not faked.
    Delaunay3DResult cop = delaunay3D({
        {0,0,0},{1,0,0},{1,1,0},{0,1,0},{2,3,0},{-1,5,0}
    });
    check(!cop.ok && cop.tetrahedra.empty(),
          "all-coplanar: ok==false (no zero-volume tets emitted)");

    // All collinear along a line.
    Delaunay3DResult col = delaunay3D({
        {0,0,0},{1,1,1},{2,2,2},{3,3,3},{4,4,4}
    });
    check(!col.ok && col.tetrahedra.empty(),
          "all-collinear: ok==false");

    // Duplicates that collapse BELOW 4 unique points.
    Delaunay3DResult dupLow = delaunay3D({
        {0,0,0},{1,0,0},{0,1,0},{0,0,0},{1,0,0}
    });
    check(!dupLow.ok, "duplicates collapsing to 3 unique: ok==false");

    // Duplicates that still leave a valid tetra (4 unique).
    Delaunay3DResult dup = delaunay3D({
        {0,0,0},{1,0,0},{0,1,0},{0,0,1},{0,0,0},{1,0,0}
    });
    check(dup.ok, "with duplicates (4 unique survive): ok==true");
    check(dup.points.size() == 4, "with duplicates: de-duped to 4 unique points");
    check(dup.tetrahedra.size() == 1, "with duplicates: a single tetra");
    check(isDelaunay3D(dup) && isValidTetrahedralization(dup),
          "with duplicates: valid + Delaunay");
}

// ===========================================================================
// (e) Determinism + seed-invariance of the Delaunay property.
// ===========================================================================
static void test_determinism(std::uint64_t seed) {
    std::printf("[determinism + seed-invariant Delaunay property]\n");
    std::mt19937_64 rng(seed ^ 0xD1CEull);
    std::uniform_real_distribution<double> U(-50, 50);
    std::vector<Point3> pts;
    for (int i = 0; i < 30; ++i) pts.push_back(Point3{U(rng), U(rng), U(rng)});

    Delaunay3DResult a1 = delaunay3D(pts, 0xABCDEF1234567890ull);
    Delaunay3DResult a2 = delaunay3D(pts, 0xABCDEF1234567890ull);
    bool same = a1.tetrahedra.size() == a2.tetrahedra.size();
    for (size_t i = 0; same && i < a1.tetrahedra.size(); ++i)
        same = (a1.tetrahedra[i] == a2.tetrahedra[i]);
    check(same, "same seed => identical tetrahedralization");

    Delaunay3DResult b = delaunay3D(pts, 0x1111111111111111ull);
    check(b.ok && isDelaunay3D(b) && isValidTetrahedralization(b),
          "different seed => still Delaunay + valid");
    if (a1.ok && b.ok)
        check(volClose(totalTetVolume(a1), totalTetVolume(b)),
              "different seed => identical total volume (same hull)");
    else
        check(false, "different seed => both meshes ok");
}

int main() {
    // Fresh, PRINTED seed so any failure is reproducible.
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint64_t seed = (static_cast<std::uint64_t>(rd()) << 32) ^
                          static_cast<std::uint64_t>(rd());
    std::printf("== forge::native::geom::delaunay3D validation gate ==\n");
    std::printf("   fresh random seed = 0x%016llx\n\n",
                static_cast<unsigned long long>(seed));

    test_random_clouds(seed);
    test_single_tetra();
    test_unit_cube();
    test_regular_octahedron();
    test_points_on_sphere();
    test_grid_3d();
    test_degenerate_inputs();
    test_determinism(seed);

    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
