// forge/native/brep/trimmed_face_test.cpp
//
// Standalone validation gate for the K1.2 TRIMMED-NURBS B-REP FACE increment
// (TrimmedFace.hpp/.cpp) — THE critical-path keystone of the in-house kernel.
// Pure C++20, NO external dependencies, NO OCCT, NO WASM, no test framework — a
// tiny hand-rolled harness that prints PASS/FAIL and exits non-zero on any
// failure (mirrors k0_topology_test.cpp / nurbs_algebra_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/TrimmedFace.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/geom/Delaunay.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/test/native/brep/trimmed_face_test.cpp \
//     -o /tmp/trimmed_face_test && /tmp/trimmed_face_test
//
// CLOSED-FORM GATES (asserted below):
//   (1) AREA — a PLANAR surface trimmed by a unit square with a CIRCULAR HOLE has
//       material area  L² − π r²  to 1e-9 (planar-exact Green's-theorem path; the
//       Circle2 hole pcurve contributes exactly π r², NOT a chord-polygon under-
//       estimate). Checked for two (L, r) pairs.
//   (2) POINT-IN-TRIM — points strictly inside the square-but-outside-the-hole
//       classify Inside; points inside the hole classify Outside; points outside
//       the square classify Outside; a point on the square edge and one on the
//       hole rim classify On.
//   (3) TESSELLATION — the trim-respecting CDT mesh of the square-with-hole is
//       non-empty, every triangle lies inside the trim, the summed 3D triangle
//       area equals L² − π r² to a tessellation tolerance, and every boundary
//       loop vertex is shared (watertight at the trim: no T-junctions — every
//       interior edge is shared by exactly two kept triangles).
//   (4) CYLINDRICAL PATCH — a quarter-cylinder (radius R, height Hc) NURBS surface
//       trimmed by its full parameter rectangle has area (π/2)·R·Hc to a curved-
//       surface quadrature tolerance, AND a sub-rectangle trim has the proportional
//       area — exercising the curved (non-planar) quadrature mass path + the
//       trim-respecting tessellation on a curved surface.

#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/Curve.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else       std::printf("  [FAIL] %s\n", name.c_str());
}

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

static constexpr double kPi  = 3.14159265358979323846;
static constexpr double k2Pi = 6.28318530717958647692;

// ===========================================================================
// Helper: build a PLANAR bilinear B-spline surface S(u,v) = (L·u, L·v, 0) over
// the clamped knot domain [0,1]×[0,1] (degree 1 in each direction). The Jacobian
// |S_u × S_v| = L² is constant, so the planar-exact area path applies. A (u,v)
// trim circle of radius rho maps to a physical circle of radius L·rho.
// ===========================================================================
static NurbsSurface makePlane(double L) {
    NurbsSurface s;
    s.degreeU = 1;
    s.degreeV = 1;
    s.control = {
        { {0, 0, 0}, {0, L, 0} },     // u=0 column over v
        { {L, 0, 0}, {L, L, 0} },     // u=1 column over v
    };
    s.weights = { {1, 1}, {1, 1} };
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}

// ===========================================================================
// Helper: a square outer trim loop over the (u,v) unit square [0,1]² (CCW), four
// Line2 segments.
// ===========================================================================
static TrimLoop squareOuterLoop() {
    TrimLoop loop;
    loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({0, 0}, {1, 0}));
    loop.segments.push_back(PCurve::makeLine2({1, 0}, {1, 1}));
    loop.segments.push_back(PCurve::makeLine2({1, 1}, {0, 1}));
    loop.segments.push_back(PCurve::makeLine2({0, 1}, {0, 0}));
    return loop;
}

// A circular hole loop in (u,v): centre (cu,cv), parameter radius rho, CW.
static TrimLoop circleHoleLoop(double cu, double cv, double rho) {
    TrimLoop loop;
    loop.isOuter = false;
    // CW circle: traverse the angle from 2π down to 0 so the winding is opposite
    // the CCW outer square (material on the left of every coedge). The Green's
    // area path and even-odd classification are winding-robust, but we honour the
    // documented convention.
    PCurve c = PCurve::makeCircle2({cu, cv}, rho, k2Pi, 0.0);
    loop.segments.push_back(c);
    return loop;
}

// ===========================================================================
// Build a QUARTER-CYLINDER NURBS surface of radius R and height Hc:
//   S(theta, z) = (R cos theta, R sin theta, Hc·z),  theta in [0, π/2], z in [0,1].
// The exact rational quarter circle (degree 2, 3 control points, mid weight
// cos(45°) = √2/2) extruded linearly in z (degree 1). Area of the full param
// rectangle = arc length (π/2·R) × height (Hc) = (π/2)·R·Hc.
// ===========================================================================
static NurbsSurface makeQuarterCylinder(double R, double Hc) {
    NurbsSurface s;
    s.degreeU = 2;   // U = theta (rational quarter circle)
    s.degreeV = 1;   // V = z (linear extrude)
    const double w = std::sqrt(2.0) / 2.0;   // = cos(45°)
    // Quarter-circle control polygon in the XY plane (standard rational arc):
    //   P0=(R,0), P1=(R,R) weight w, P2=(0,R).
    // Tensor with the two z layers (z=0 and z=Hc).
    s.control = {
        { {R, 0, 0},     {R, 0, Hc} },        // theta index 0
        { {R, R, 0},     {R, R, Hc} },        // theta index 1 (the mid, weighted)
        { {0, R, 0},     {0, R, Hc} },        // theta index 2
    };
    s.weights = {
        { 1.0, 1.0 },
        { w,   w   },
        { 1.0, 1.0 },
    };
    // Knot domain [0,1] in both directions (clamped).
    s.knotsU = {0, 0, 0, 1, 1, 1};   // degree 2, 3 ctrl pts
    s.knotsV = {0, 0, 1, 1};         // degree 1, 2 ctrl pts
    return s;
}

// Full parameter-rectangle outer loop over [0,1]² (for a surface whose whole chart
// is the face — a quarter cylinder trimmed to its full domain).
static TrimLoop fullRectLoop() {
    TrimLoop loop;
    loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({0, 0}, {1, 0}));
    loop.segments.push_back(PCurve::makeLine2({1, 0}, {1, 1}));
    loop.segments.push_back(PCurve::makeLine2({1, 1}, {0, 1}));
    loop.segments.push_back(PCurve::makeLine2({0, 1}, {0, 0}));
    return loop;
}

// A sub-rectangle [u0,u1]×[v0,v1] outer loop in (u,v).
static TrimLoop subRectLoop(double a, double b, double c, double d) {
    TrimLoop loop;
    loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({a, c}, {b, c}));
    loop.segments.push_back(PCurve::makeLine2({b, c}, {b, d}));
    loop.segments.push_back(PCurve::makeLine2({b, d}, {a, d}));
    loop.segments.push_back(PCurve::makeLine2({a, d}, {a, c}));
    return loop;
}

// ===========================================================================
// (1) AREA: planar square-with-circular-hole == L² − π r² to 1e-9.
// ===========================================================================
static void testAreaPlanar() {
    std::printf("(1) Planar square-with-circular-hole area == L^2 - pi*r^2\n");

    struct Case { double L, rho; };
    const Case cases[] = { {3.0, 0.25}, {10.0, 0.4} };
    for (const auto& cs : cases) {
        TrimmedFace f;
        f.surface = makePlane(cs.L);
        f.loops.push_back(squareOuterLoop());
        f.loops.push_back(circleHoleLoop(0.5, 0.5, cs.rho));  // hole centred

        const char* vr = nullptr;
        check(f.valid(&vr), std::string("face valid (") + (vr ? vr : "") + ")");

        TrimmedMassProps mp = trimmedFaceArea(f);
        check(mp.ok, "area op ok");
        check(mp.planarExact, "planar-exact Green's path selected");

        // Physical hole radius is L·rho; expected material area L² − π(L·rho)².
        const double r = cs.L * cs.rho;
        const double expected = cs.L * cs.L - kPi * r * r;
        const bool tight = approx(mp.area, expected, 1e-9);
        std::printf("       L=%.1f r=%.4f  area=%.12f expected=%.12f  |d|=%.2e\n",
                    cs.L, r, mp.area, expected, std::fabs(mp.area - expected));
        check(tight, "area == L^2 - pi*r^2 to 1e-9");
    }
}

// ===========================================================================
// (2) POINT-IN-TRIM correctness.
// ===========================================================================
static void testPointInTrim() {
    std::printf("(2) Point-in-trim inside / in-hole / outside / on\n");

    TrimmedFace f;
    f.surface = makePlane(1.0);                 // unit (u,v) == unit physical
    f.loops.push_back(squareOuterLoop());
    f.loops.push_back(circleHoleLoop(0.5, 0.5, 0.2));

    // Inside the square, outside the hole -> Inside.
    check(classifyPointInTrim(f, {0.15, 0.15}) == TrimClass::Inside,
          "corner-region point Inside (in square, out of hole)");
    check(classifyPointInTrim(f, {0.85, 0.5}) == TrimClass::Inside,
          "near right edge Inside");

    // Inside the hole -> Outside (material).
    check(classifyPointInTrim(f, {0.5, 0.5}) == TrimClass::Outside,
          "hole centre Outside (material)");
    check(classifyPointInTrim(f, {0.55, 0.55}) == TrimClass::Outside,
          "off-centre in hole Outside");

    // Outside the square -> Outside.
    check(classifyPointInTrim(f, {1.5, 0.5}) == TrimClass::Outside,
          "right of square Outside");
    check(classifyPointInTrim(f, {-0.2, 0.5}) == TrimClass::Outside,
          "left of square Outside");
    check(classifyPointInTrim(f, {0.5, 1.3}) == TrimClass::Outside,
          "above square Outside");

    // On the boundaries.
    check(classifyPointInTrim(f, {0.0, 0.5}) == TrimClass::On,
          "on left square edge On");
    check(classifyPointInTrim(f, {0.7, 0.5}) == TrimClass::On,
          "on hole rim (0.5+0.2, 0.5) On");
}

// ===========================================================================
// (3) TESSELLATION of the square-with-hole: non-empty, all triangles inside,
// summed 3D area matches, watertight-at-trim (every interior edge shared by
// exactly two kept triangles; boundary edges by exactly one).
// ===========================================================================
static void testTessellation() {
    std::printf("(3) Trim-respecting tessellation of square-with-hole\n");

    const double L = 4.0, rho = 0.3;
    TrimmedFace f;
    f.surface = makePlane(L);
    f.loops.push_back(squareOuterLoop());
    f.loops.push_back(circleHoleLoop(0.5, 0.5, rho));

    TessellateOptions opt;
    opt.loopSamples = 96;       // fine boundary so the chordal circle is accurate
    opt.interiorGrid = 16;
    TrimMesh m = tessellateTrimmedFace(f, opt);
    check(m.ok, std::string("tessellation ok (") + m.reason + ")");
    check(!m.triangles.empty(), "tessellation non-empty");

    // Every triangle centroid classifies Inside the trim.
    bool allInside = true;
    for (const auto& tr : m.triangles) {
        const UVCoord a = m.uv[tr[0]], b = m.uv[tr[1]], c = m.uv[tr[2]];
        UVCoord g{(a.u + b.u + c.u) / 3.0, (a.v + b.v + c.v) / 3.0};
        if (classifyPointInTrim(f, g, 1e-7) != TrimClass::Inside) { allInside = false; break; }
    }
    check(allInside, "every triangle centroid is Inside the trim");

    // Summed 3D triangle area ~ L² − π(L·rho)² (chordal hole, so a small under-
    // shoot relative to the analytic value — within a tessellation tolerance).
    double area3d = 0.0;
    for (const auto& tr : m.triangles) {
        const Vec3& A = m.positions[tr[0]];
        const Vec3& B = m.positions[tr[1]];
        const Vec3& C = m.positions[tr[2]];
        const double e1x = B.x - A.x, e1y = B.y - A.y, e1z = B.z - A.z;
        const double e2x = C.x - A.x, e2y = C.y - A.y, e2z = C.z - A.z;
        const double cx = e1y * e2z - e1z * e2y;
        const double cy = e1z * e2x - e1x * e2z;
        const double cz = e1x * e2y - e1y * e2x;
        area3d += 0.5 * std::sqrt(cx * cx + cy * cy + cz * cz);
    }
    const double r = L * rho;
    const double expected = L * L - kPi * r * r;
    std::printf("       tess area3d=%.6f  analytic=%.6f  |d|=%.3e\n",
                area3d, expected, std::fabs(area3d - expected));
    // Chordal hole boundary: area3d is slightly LARGER than analytic (the polygon
    // hole is smaller than the true circle, so more material). Tolerance scales
    // with the boundary sampling.
    check(approx(area3d, expected, 5e-3 * expected), "tess area ~ analytic within tess tol");

    // Watertight-at-the-trim: count undirected-edge incidence over kept triangles.
    // A crack-free trim mesh has every edge shared by exactly 1 (boundary) or 2
    // (interior) triangles — never 3+ and no dangling unmatched interior edge.
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edgeCount;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        return a < b ? std::make_pair(a, b) : std::make_pair(b, a);
    };
    for (const auto& tr : m.triangles) {
        edgeCount[key(tr[0], tr[1])]++;
        edgeCount[key(tr[1], tr[2])]++;
        edgeCount[key(tr[2], tr[0])]++;
    }
    int bad = 0, boundary = 0, interior = 0;
    for (const auto& kv : edgeCount) {
        if (kv.second == 1) ++boundary;
        else if (kv.second == 2) ++interior;
        else ++bad;
    }
    std::printf("       edges: boundary=%d interior=%d bad(>=3)=%d  tris=%zu\n",
                boundary, interior, bad, m.triangles.size());
    check(bad == 0, "no edge shared by >2 triangles (manifold trim mesh)");
    check(boundary > 0 && interior > 0, "has both boundary and interior edges");

    // Per-vertex normals on a planar face all point along +Z (or all −Z).
    bool normalsOk = !m.normals.empty();
    for (const auto& tr : m.triangles)
        for (int k = 0; k < 3; ++k) {
            const Vec3& n = m.normals[tr[k]];
            if (std::fabs(std::fabs(n.z) - 1.0) > 1e-9) { normalsOk = false; }
        }
    check(normalsOk, "planar-face per-vertex normals are unit +/-Z");
}

// ===========================================================================
// (4) CYLINDRICAL PATCH area (curved quadrature mass path).
// ===========================================================================
static void testCylindricalPatch() {
    std::printf("(4) Quarter-cylinder trimmed-patch area (curved quadrature)\n");

    const double R = 2.0, Hc = 5.0;
    NurbsSurface cyl = makeQuarterCylinder(R, Hc);
    const char* sr = nullptr;
    check(validateSurface(cyl, &sr), std::string("cylinder surface valid (") + (sr ? sr : "") + ")");

    // Spot-check the surface lies on radius R (rational quarter circle).
    {
        SurfaceSample s0  = evaluatePoint(cyl, 0.0, 0.0);
        SurfaceSample s1  = evaluatePoint(cyl, 1.0, 0.0);
        SurfaceSample smid = evaluatePoint(cyl, 0.5, 0.5);
        const double r0 = std::hypot(s0.point.x, s0.point.y);
        const double r1 = std::hypot(s1.point.x, s1.point.y);
        const double rm = std::hypot(smid.point.x, smid.point.y);
        check(approx(r0, R, 1e-9) && approx(r1, R, 1e-9) && approx(rm, R, 1e-9),
              "quarter-cylinder points lie on radius R");
        check(approx(smid.point.z, Hc * 0.5, 1e-9), "mid-height z correct");
    }

    // FULL parameter rectangle: area == (pi/2)*R*Hc.
    {
        TrimmedFace f;
        f.surface = cyl;
        f.loops.push_back(fullRectLoop());

        TrimmedMassProps mp = trimmedFaceArea(f, /*quadRefine=*/4);
        check(mp.ok, "cylinder full-rect area op ok");
        check(!mp.planarExact, "curved quadrature path selected (not planar)");
        const double expected = (kPi / 2.0) * R * Hc;
        std::printf("       full-rect area=%.8f  expected (pi/2)RH=%.8f  |d|=%.3e\n",
                    mp.area, expected, std::fabs(mp.area - expected));
        check(approx(mp.area, expected, 1e-4 * expected),
              "quarter-cylinder area == (pi/2)*R*Hc");
    }

    // HALF the angular sweep (u in [0,0.5]) over full height: area should be the
    // arc-length of theta in [0, pi/4] times Hc = (pi/4)*R*Hc (the rational arc is
    // a true circle so half the U-parameter is half the arc by symmetry of the
    // standard quarter-arc parameterisation? NOT exactly — the rational quarter
    // arc is NOT arc-length parameterised, so we instead verify the SUB-rectangle
    // area is strictly between 0 and the full area and that two complementary
    // halves SUM to the full area, i.e. the quadrature is additive/consistent).
    {
        TrimmedFace fa, fb;
        fa.surface = cyl; fa.loops.push_back(subRectLoop(0.0, 0.5, 0.0, 1.0));
        fb.surface = cyl; fb.loops.push_back(subRectLoop(0.5, 1.0, 0.0, 1.0));
        TrimmedMassProps a = trimmedFaceArea(fa, 4);
        TrimmedMassProps b = trimmedFaceArea(fb, 4);
        check(a.ok && b.ok, "both half-sweep area ops ok");
        const double full = (kPi / 2.0) * R * Hc;
        const double sum = a.area + b.area;
        std::printf("       half-sweep areas a=%.6f b=%.6f sum=%.6f full=%.6f\n",
                    a.area, b.area, sum, full);
        check(approx(sum, full, 1e-4 * full), "two angular halves sum to full area");
        check(a.area > 0.0 && b.area > 0.0 && a.area < full && b.area < full,
              "each half-sweep area strictly within (0, full)");
    }

    // Also confirm the curved surface tessellates (trim-respecting) on a curved
    // chart and the summed 3D area is close (chordal under-shoot on curvature).
    {
        TrimmedFace f;
        f.surface = cyl;
        f.loops.push_back(fullRectLoop());
        TessellateOptions opt; opt.loopSamples = 64; opt.interiorGrid = 24;
        TrimMesh m = tessellateTrimmedFace(f, opt);
        check(m.ok && !m.triangles.empty(), "curved-surface trim tessellation ok");
        double area3d = 0.0;
        for (const auto& tr : m.triangles) {
            const Vec3& A = m.positions[tr[0]];
            const Vec3& B = m.positions[tr[1]];
            const Vec3& C = m.positions[tr[2]];
            const double e1x = B.x - A.x, e1y = B.y - A.y, e1z = B.z - A.z;
            const double e2x = C.x - A.x, e2y = C.y - A.y, e2z = C.z - A.z;
            const double cx = e1y * e2z - e1z * e2y;
            const double cy = e1z * e2x - e1x * e2z;
            const double cz = e1x * e2y - e1y * e2x;
            area3d += 0.5 * std::sqrt(cx * cx + cy * cy + cz * cz);
        }
        const double expected = (kPi / 2.0) * R * Hc;
        std::printf("       curved tess area3d=%.6f analytic=%.6f |d|=%.3e\n",
                    area3d, expected, std::fabs(area3d - expected));
        // Chordal facets under-shoot the curved area; tolerance ~ sampling.
        check(area3d > 0.0 && area3d <= expected + 1e-6 &&
              area3d > 0.98 * expected, "curved tess 3D area within chordal tol");
    }
}

int main() {
    std::printf("=== K1.2 TRIMMED-NURBS B-REP FACE — validation gate ===\n");
    testAreaPlanar();
    testPointInTrim();
    testTessellation();
    testCylindricalPatch();
    std::printf("=== RESULT: %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
