// forge-kernel/test/native_vs_occt_convexhull.cpp
//
// Standalone EXACTNESS verification for the in-house EXACT 3D CONVEX HULL
// (forge::native::geom::convexHull3D_exact — Quickhull, every orientation
// decided by the rational exactOrient3D, NO OCCT in the hull itself).
//
// WHY "exactness, not OCCT-comparison": OCCT has no clean general convex-hull
// builder (no BRepAlgoAPI hull op), so there is no OCCT reference solid to diff
// against. The hull is therefore validated against its CLOSED-FORM truth and its
// own EXACT-predicate certificates:
//
//   (a) CUBE: hull of a cube's 8 corners (side 3) has volume EXACTLY side^3 = 27
//       (operator== on the double — the divergence-theorem sum of integer-valued
//       tetra determinants is bit-exact here), and 8 vertices / 12 triangles.
//   (b) SPHERE (R=2): hull of points sampled on the sphere has volume CONVERGING
//       to 4/3 pi R^3 = 33.5103... as the sample count grows (we report every
//       N and assert the error is monotone-decreasing and < 1% at the finest N).
//   (c) ALL-POINTS-INSIDE certificate: for EVERY input point p and EVERY hull
//       face (a,b,c), exactOrient3D(a,b,c,p) >= 0 — i.e. p is BELOW-OR-ON the
//       outward CCW face => provably inside-or-on the hull.  (Sign convention is
//       the kernel's own: exactOrient3D = +1 when d is BELOW plane(a,b,c); with
//       the CCW-OUTWARD winding the hull INTERIOR is the BELOW/positive side, so
//       a strictly-OUTSIDE point is ABOVE some face with sign < 0.  This is the
//       same convention the library helpers allPointsInsideOrOn /
//       everyFaceOutwardConvex assert — see ConvexHull3D.cpp lines 355-369.)
//       Computed here directly, not trusting the library helper, and reported as
//       an exact count of any (illegal) strictly-outside hits.
//   (d) INTERIOR points are NOT hull vertices (isHullVertex false for strictly
//       interior points, true for corners).
//   (e) OPTIONAL OCCT cross-check (compile with -DFORGE_WITH_OCCT): feed the hull
//       triangle mesh to BRepBuilderAPI_Sewing, then BRepCheck_Analyzer — assert
//       the sewn shell is a VALID, CLOSED solid (a clean 2-manifold). This only
//       confirms the mesh OCCT receives is a valid closed convex solid; the hull
//       combinatorics themselves come entirely from the in-house exact kernel.
//
// BUILD (no OCCT — pure in-house, always works):
//   clang++ -std=c++20 -O2 -Wall -Wextra -DFORGE_CONVEXHULL3D_NO_SOLID \
//       -I forge-kernel/include \
//       forge-kernel/src/native/geom/ConvexHull3D.cpp \
//       forge-kernel/src/native/ExactPredicates3D.cpp \
//       forge-kernel/src/native/ExactReal.cpp \
//       forge-kernel/test/native_vs_occt_convexhull.cpp \
//       -o /tmp/native_vs_occt_convexhull && /tmp/native_vs_occt_convexhull
//
// BUILD (with the optional OCCT cross-check (e)):
//   clang++ -std=c++20 -O2 -Wall -Wextra -DFORGE_CONVEXHULL3D_NO_SOLID \
//       -DFORGE_WITH_OCCT \
//       -I forge-kernel/include \
//       -I /opt/homebrew/opt/opencascade/include/opencascade \
//       forge-kernel/src/native/geom/ConvexHull3D.cpp \
//       forge-kernel/src/native/ExactPredicates3D.cpp \
//       forge-kernel/src/native/ExactReal.cpp \
//       forge-kernel/test/native_vs_occt_convexhull.cpp \
//       -L /opt/homebrew/opt/opencascade/lib \
//       -lTKernel -lTKMath -lTKBRep -lTKTopAlgo \
//       -o /tmp/native_vs_occt_convexhull && /tmp/native_vs_occt_convexhull
//
// Note: the hull's own brep::Solid emitter (toSolid) is NOT linked here (it would
// pull in Topology.cpp); FORGE_CONVEXHULL3D_NO_SOLID disables it. The OCCT path
// builds its OWN solid from the exact hull mesh, which is the whole point of (e).

#include "forge/native/geom/ConvexHull3D.hpp"
#include "forge/native/ExactPredicates3D.hpp"   // exactOrient3D (rational)

#include <cstdio>
#include <cmath>
#include <vector>
#include <array>

#ifdef FORGE_WITH_OCCT
#  include <gp_Pnt.hxx>
#  include <TopoDS_Shape.hxx>
#  include <TopoDS_Face.hxx>
#  include <TopoDS_Wire.hxx>
#  include <TopoDS_Shell.hxx>
#  include <TopoDS_Solid.hxx>
#  include <TopoDS.hxx>
#  include <TopExp_Explorer.hxx>
#  include <TopAbs_ShapeEnum.hxx>
#  include <BRepBuilderAPI_MakePolygon.hxx>
#  include <BRepBuilderAPI_MakeFace.hxx>
#  include <BRepBuilderAPI_Sewing.hxx>
#  include <BRepBuilderAPI_MakeSolid.hxx>
#  include <BRepCheck_Analyzer.hxx>
#endif

using forge::native::geom::Point3;
using forge::native::geom::ConvexHull3DResult;
using forge::native::geom::convexHull3D_exact;
using forge::native::Vec3;
using forge::native::exactOrient3D;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

// ----------------------------------------------------------------------------
// The all-points-inside EXACT certificate, computed locally so the report is
// independent of the library helper.  Kernel sign convention (ConvexHull3D.cpp
// lines 355-369): for an OUTWARD CCW face (a,b,c), the hull INTERIOR is the
// BELOW side, where exactOrient3D(a,b,c,p) >= 0.  So p is inside-or-on iff the
// sign is >= 0 for EVERY face; a strictly-outside point is ABOVE some face with
// sign < 0.  We count every check, every (illegal) strictly-outside hit, and
// every exactly-on-face incidence so the report is fully literal.  Returns true
// iff NO check is < 0.
// ----------------------------------------------------------------------------
struct InsideReport { long checks = 0; long outsideHits = 0; long onFace = 0; };

static InsideReport exactAllInside(const ConvexHull3DResult& h,
                                   const std::vector<Point3>& pts) {
    InsideReport r;
    for (const Point3& p : pts) {
        const Vec3 pv{p.x, p.y, p.z};
        for (const auto& f : h.faces) {
            const Point3& A = h.vertices[f[0]];
            const Point3& B = h.vertices[f[1]];
            const Point3& C = h.vertices[f[2]];
            const int s = exactOrient3D(Vec3{A.x, A.y, A.z}, Vec3{B.x, B.y, B.z},
                                        Vec3{C.x, C.y, C.z}, pv);
            ++r.checks;
            if (s < 0) ++r.outsideHits;   // p strictly ABOVE an outward face => OUTSIDE
            if (s == 0) ++r.onFace;       // exactly ON the face plane (corner / facet)
        }
    }
    return r;
}

// ============================================================================
// (a) CUBE — hull of 8 corners (side 3) -> volume == side^3 == 27 EXACTLY.
// ============================================================================
static void testCube() {
    std::printf("\n[a] CUBE: 8 corners (side 3) -> hull volume == side^3 (exact)\n");
    const double s = 3.0;
    std::vector<Point3> pts = {
        {0,0,0},{s,0,0},{0,s,0},{s,s,0},
        {0,0,s},{s,0,s},{0,s,s},{s,s,s}
    };
    ConvexHull3DResult h = convexHull3D_exact(pts);
    check(h.ok, "cube hull ok");

    const double expected = s * s * s;   // 27
    std::printf("       LITERAL hull volume = %.17g   (side^3 = %.17g)\n",
                h.volume, expected);
    std::printf("       vertices = %zu, triangles = %zu\n",
                h.vertices.size(), h.faces.size());
    check(h.volume == expected, "cube: hull volume == side^3 == 27 (operator==, exact)");
    check(h.vertices.size() == 8, "cube: 8 hull vertices");
    check(h.faces.size() == 12, "cube: 12 triangles (6 quads)");

    InsideReport ir = exactAllInside(h, pts);
    std::printf("       exact orient3D checks = %ld  (outside hits = %ld, on-face = %ld)\n",
                ir.checks, ir.outsideHits, ir.onFace);
    check(ir.outsideHits == 0,
          "cube: EVERY input point inside-or-on by exact orient3D (sign <= 0)");
}

// ============================================================================
// (b) SPHERE — hull of points sampled on R=2 sphere converges to 4/3 pi R^3.
// ============================================================================
static std::vector<Point3> sampleSphere(int N, double R) {
    std::vector<Point3> pts;
    pts.reserve(N);
    const double golden = M_PI * (3.0 - std::sqrt(5.0));   // golden angle
    for (int i = 0; i < N; ++i) {
        const double y  = 1.0 - (2.0 * i + 1.0) / N;
        const double r  = std::sqrt(std::max(0.0, 1.0 - y * y));
        const double th = golden * i;
        pts.push_back({R * std::cos(th) * r, R * y, R * std::sin(th) * r});
    }
    return pts;
}

static void testSphere() {
    std::printf("\n[b] SPHERE: hull of R=2 samples -> converges to 4/3 pi R^3\n");
    const double R = 2.0;
    const double exact = 4.0 / 3.0 * M_PI * R * R * R;     // 33.5103...
    std::printf("       4/3 pi R^3 = %.17g\n", exact);

    const int Ns[] = {64, 256, 1024, 4096};
    double prevErr = 1e9;
    bool monotone = true, allInside = true;
    long lastOutside = -1;
    for (int N : Ns) {
        std::vector<Point3> pts = sampleSphere(N, R);
        ConvexHull3DResult h = convexHull3D_exact(pts);
        if (!h.ok) { check(false, "sphere hull ok"); return; }
        const double err = std::fabs(h.volume - exact) / exact * 100.0;
        InsideReport ir = exactAllInside(h, pts);
        std::printf("       N=%5d  LITERAL vol=%.10g  faces=%zu  verts=%zu  "
                    "err=%.4f%%  outsideHits=%ld\n",
                    N, h.volume, h.faces.size(), h.vertices.size(), err,
                    ir.outsideHits);
        if (err > prevErr + 1e-9) monotone = false;        // error must not grow
        prevErr = err;
        if (ir.outsideHits != 0) allInside = false;
        lastOutside = ir.outsideHits;
    }
    std::printf("       finest-N error vs analytic = %.4f%%\n", prevErr);
    check(monotone, "sphere: volume error DECREASES monotonically as samples grow");
    check(prevErr < 1.0, "sphere: finest-N hull within 1%% of 4/3 pi R^3");
    check(allInside && lastOutside == 0,
          "sphere: EVERY input point inside-or-on by exact orient3D at every N");
}

// ============================================================================
// (c)+(d) INTERIOR points inside (exact) and NOT hull vertices.
// ============================================================================
static void testInterior() {
    std::printf("\n[c/d] INTERIOR points: inside (exact orient3D) and NOT hull vertices\n");
    std::vector<Point3> pts = {
        {0,0,0},{1,0,0},{0,1,0},{1,1,0},
        {0,0,1},{1,0,1},{0,1,1},{1,1,1},
    };
    const std::size_t firstInterior = pts.size();
    pts.push_back({0.5, 0.5, 0.5});
    pts.push_back({0.25,0.25,0.25});
    pts.push_back({0.75,0.6, 0.4});
    pts.push_back({0.3, 0.8, 0.5});

    ConvexHull3DResult h = convexHull3D_exact(pts);
    check(h.ok, "interior-cloud hull ok");
    check(h.vertices.size() == 8, "interior-cloud: exactly 8 hull vertices (corners only)");
    check(h.volume == 1.0, "interior-cloud: unit-cube volume == 1 (exact)");

    bool cornersAreHull = true, interiorsAreNot = true;
    for (std::size_t k = 0; k < firstInterior; ++k)
        if (!h.isHullVertex[k]) cornersAreHull = false;
    for (std::size_t k = firstInterior; k < pts.size(); ++k)
        if (h.isHullVertex[k]) interiorsAreNot = false;
    check(cornersAreHull, "interior-cloud: all 8 corners ARE hull vertices");
    check(interiorsAreNot, "interior-cloud: every interior point is NOT a hull vertex (d)");

    InsideReport ir = exactAllInside(h, pts);
    std::printf("       exact orient3D checks = %ld  (outside hits = %ld)\n",
                ir.checks, ir.outsideHits);
    check(ir.outsideHits == 0,
          "interior-cloud: EVERY point inside-or-on by exact orient3D (c)");
}

// ============================================================================
// (e) OPTIONAL OCCT cross-check: sew the hull mesh and BRepCheck it.
// ============================================================================
#ifdef FORGE_WITH_OCCT
static void testOcct() {
    std::printf("\n[e] OCCT cross-check: sew hull mesh -> BRepCheck valid closed solid\n");
    // Use the cube hull (a known clean convex solid).
    const double s = 3.0;
    std::vector<Point3> pts = {
        {0,0,0},{s,0,0},{0,s,0},{s,s,0},
        {0,0,s},{s,0,s},{0,s,s},{s,s,s}
    };
    ConvexHull3DResult h = convexHull3D_exact(pts);
    if (!h.ok) { check(false, "occt: hull ok"); return; }

    // Build one OCCT triangular face per hull triangle, in the SAME outward winding.
    BRepBuilderAPI_Sewing sewer(1.0e-6);
    int builtFaces = 0;
    for (const auto& f : h.faces) {
        const Point3& A = h.vertices[f[0]];
        const Point3& B = h.vertices[f[1]];
        const Point3& C = h.vertices[f[2]];
        BRepBuilderAPI_MakePolygon poly(
            gp_Pnt(A.x, A.y, A.z), gp_Pnt(B.x, B.y, B.z),
            gp_Pnt(C.x, C.y, C.z), Standard_True);   // closed wire
        if (!poly.IsDone()) continue;
        BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);
        if (!mf.IsDone()) continue;
        sewer.Add(mf.Face());
        ++builtFaces;
    }
    std::printf("       handed %d triangular faces to OCCT sewing\n", builtFaces);

    sewer.Perform();
    TopoDS_Shape sewn = sewer.SewedShape();
    check(!sewn.IsNull(), "occt: sewing produced a non-null shape");

    // Extract the shell and test closure + validity.
    TopExp_Explorer shx(sewn, TopAbs_SHELL);
    bool haveShell = shx.More();
    check(haveShell, "occt: sewn result contains a shell");

    bool closedSolidValid = false;
    if (haveShell) {
        TopoDS_Shell shell = TopoDS::Shell(shx.Current());
        // Closure is the real test: a convex hull sewn watertight is a closed
        // shell.  Some OCCT versions only flag Closed() after MakeSolid, so we
        // also report the flag as observed.
        const bool closedFlag = shell.Closed();
        BRepBuilderAPI_MakeSolid mksolid(shell);
        if (mksolid.IsDone()) {
            TopoDS_Solid solid = mksolid.Solid();
            BRepCheck_Analyzer analyzer(solid);
            const bool valid = analyzer.IsValid();
            // Count faces to confirm OCCT kept all triangles (no free edges ==
            // every triangle mated => closed manifold).
            int occtFaces = 0;
            for (TopExp_Explorer fx(solid, TopAbs_FACE); fx.More(); fx.Next()) ++occtFaces;
            int freeEdges = sewer.NbFreeEdges();
            std::printf("       solid valid=%d  closed-shell-flag=%d  faces=%d  "
                        "free-edges=%d\n",
                        (int)valid, (int)closedFlag, occtFaces, freeEdges);
            // VALID + every input triangle retained + zero free (unmated) edges
            // == a closed 2-manifold convex solid.
            closedSolidValid = valid && (occtFaces == builtFaces) && (freeEdges == 0);
        }
    }
    check(closedSolidValid,
          "occt: BRepCheck valid CLOSED convex solid from the exact hull mesh");
}
#endif  // FORGE_WITH_OCCT

int main() {
    std::setvbuf(stdout, nullptr, _IOLBF, 0);
    std::printf("=== EXACT 3D convex hull verification "
                "(closed-form + exactness; no OCCT hull) ===\n");
    testCube();
    testSphere();
    testInterior();
#ifdef FORGE_WITH_OCCT
    testOcct();
#else
    std::printf("\n[e] OCCT cross-check SKIPPED (build without -DFORGE_WITH_OCCT)\n");
#endif
    std::printf("\n==== %d / %d checks passed ====\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
