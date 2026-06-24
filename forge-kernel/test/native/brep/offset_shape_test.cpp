// forge/native/brep/offset_shape_test.cpp
//
// Standalone validation gate for the native analytic OFFSET-SHAPE increment
// (OffsetShape.hpp / OffsetShape.cpp) — the in-house replacement for OCCT
// BRepOffsetAPI_MakeOffsetShape (BRepOffset_Skin, GeomAbs_Intersection) on
// planar + analytic-quadric faces at a uniform SIGNED distance t. Grows / shrinks
// a WHOLE solid by moving every face along its outward normal by t and re-trimming
// adjacent offset faces to their new mutual intersections. Pure C++20, NO external
// dependencies, NO OCCT, NO WASM, no test framework — a tiny hand-rolled harness
// that prints PASS/FAIL and exits non-zero on any failure (mirrors
// shell_solid_test.cpp / sew_test.cpp).
//
// SINGLE-CLANG build (MEMORY-DISCIPLINE: one clang++, NO run_native.sh, NO cmake):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/OffsetShape.cpp \
//     forge-kernel/src/native/brep/Shell.cpp \
//     forge-kernel/src/native/brep/Primitives.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/SurfaceIntersect.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/test/native/brep/offset_shape_test.cpp \
//     -o /tmp/offset_shape_test && /tmp/offset_shape_test
//
// CLOSED-FORM GATES:
//   (1) BOX GROW.   box L=10 grown t=+1 -> box L+2t=12, volume 12^3 = 1728 exact.
//   (2) BOX SHRINK. box L=10 shrunk t=-1 -> box L-2t=8, volume 8^3 = 512 exact.
//   (3) CYL GROW.   cylinder r=3 h=8 grown t=+0.5 -> r=3.5, caps move out by t so
//       h+2t=9, volume pi*3.5^2*9.
//   (4) FACE-OFFSET unit checks (signed closed-form per-surface offset).

#include <algorithm>
#include "forge/native/brep/OffsetShape.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

static bool relApprox(double a, double b, double rel) {
    double denom = std::max(1.0, std::fabs(b));
    return std::fabs(a - b) <= rel * denom;
}
static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// ===========================================================================
// (1) BOX GROW: box L=10, t=+1 -> box L+2t=12, volume 1728 exact.
// ===========================================================================
static void testBoxGrow() {
    std::printf("[1] box grow (L=10, t=+1 -> L=12)\n");
    const double L = 10.0, t = 1.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);

    OffsetShapeOptions opt;
    opt.distance = t;
    opt.tol = 1e-9;

    OffsetShapeResult r = offsetSolidShape(fac.builder(), box, opt);
    check(r.ok, std::string("offset ok (") + r.reason + ")");
    check(r.solid != nullptr, "offset solid built");

    const double expected = (L + 2 * t) * (L + 2 * t) * (L + 2 * t); // 1728
    check(approx(r.volume, expected, 1e-6),
          "volume == (L+2t)^3 == 1728 (<= 1e-6)");
    check(r.closedManifold, "offset solid is a closed 2-manifold");
    check(r.freeEdges == 0, "0 free edges (watertight)");
    check(r.faces == 6, "6 offset faces");

    std::printf("      -> faces=%zu  V=%.12f (exp %.12f)  %s\n",
                r.faces, r.volume, expected,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (2) BOX SHRINK: box L=10, t=-1 -> box L-2t=8, volume 512 exact.
// ===========================================================================
static void testBoxShrink() {
    std::printf("[2] box shrink (L=10, t=-1 -> L=8)\n");
    const double L = 10.0, t = -1.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);

    OffsetShapeOptions opt;
    opt.distance = t;
    opt.tol = 1e-9;

    OffsetShapeResult r = offsetSolidShape(fac.builder(), box, opt);
    check(r.ok, std::string("offset ok (") + r.reason + ")");

    const double expected = (L + 2 * t) * (L + 2 * t) * (L + 2 * t); // (10-2)^3 = 512
    check(approx(r.volume, expected, 1e-6), "volume == (L-2t)^3 == 512 (<= 1e-6)");
    check(r.closedManifold, "shrunk solid is a closed 2-manifold");
    check(r.freeEdges == 0, "0 free edges");

    std::printf("      -> faces=%zu  V=%.12f (exp %.12f)  %s\n",
                r.faces, r.volume, expected,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (3) CYLINDER GROW: r=3, h=8, t=+0.5 -> r=3.5, h+2t=9, V = pi*3.5^2*9.
// ===========================================================================
static void testCylinderGrow() {
    std::printf("[3] cylinder grow (r=3, h=8, t=+0.5 -> r=3.5, h=9)\n");
    const double r = 3.0, h = 8.0, t = 0.5;

    SolidFactory fac;
    Solid* cyl = fac.buildCylinder(r, h);

    OffsetShapeOptions opt;
    opt.distance = t;
    opt.tol = 1e-9;

    OffsetShapeResult res = offsetSolidShape(fac.builder(), cyl, opt);
    check(res.ok, std::string("offset ok (") + res.reason + ")");

    const double rO = r + t;          // 3.5
    const double hO = h + 2 * t;      // 9
    const double expected = M_PI * rO * rO * hO;   // pi*3.5^2*9 = 346.36...
    // Quadric mass-props is Gauss-quadrature exact on the cylinder; faceted topology
    // (128 sectors) makes the assembled cap-rim a 128-gon, so allow a small rel tol.
    check(relApprox(res.volume, expected, 1e-3),
          "volume == pi*(r+t)^2*(h+2t) (<= 1e-3 rel)");
    check(res.closedManifold, "grown cylinder is a closed 2-manifold");

    std::printf("      -> faces=%zu  V=%.12f (exp %.12f)  rel=%.3e  %s\n",
                res.faces, res.volume, expected,
                std::fabs(res.volume - expected) / expected,
                res.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (4) FACE-OFFSET unit checks (signed closed-form per-surface offset).
// ===========================================================================
static void testFaceOffset() {
    std::printf("[4] analytic signed face-offset closed forms\n");
    // Plane: origin (0,0,0), outward +Z. Outward offset by t=+2 -> origin (0,0,+2).
    {
        Surface p;
        p.kind = SurfaceKind::Plane;
        p.origin = {0, 0, 0};
        p.axis = {0, 0, 1};
        p.refDir = {1, 0, 0};
        OffsetShapeSurfaceResult o = offsetSurfaceOutward(p, 2.0);
        check(o.ok, "plane outward offset ok");
        check(approx(o.surface.origin.z, 2.0, 1e-12),
              "plane offsets +2 along outward normal (grow)");
        OffsetShapeSurfaceResult o2 = offsetSurfaceOutward(p, -2.0);
        check(o2.ok && approx(o2.surface.origin.z, -2.0, 1e-12),
              "plane offsets -2 along outward normal (shrink)");
    }
    // Cylinder r=5 grow t=+2 -> r=7; shrink t=-2 -> r=3.
    {
        Surface c;
        c.kind = SurfaceKind::Cylinder;
        c.origin = {0, 0, 0}; c.axis = {0, 0, 1}; c.refDir = {1, 0, 0};
        c.r1 = 5.0; c.param = 10.0;
        OffsetShapeSurfaceResult o = offsetSurfaceOutward(c, 2.0);
        check(o.ok && approx(o.surface.r1, 7.0, 1e-12), "cylinder r -> r + t (5 -> 7, grow)");
        OffsetShapeSurfaceResult o2 = offsetSurfaceOutward(c, -2.0);
        check(o2.ok && approx(o2.surface.r1, 3.0, 1e-12), "cylinder r -> r + t (5 -> 3, shrink)");
    }
    // Sphere r=4 grow t=+1.5 -> r=5.5.
    {
        Surface s;
        s.kind = SurfaceKind::Sphere;
        s.origin = {0, 0, 0}; s.axis = {0, 0, 1}; s.refDir = {1, 0, 0};
        s.r1 = 4.0;
        OffsetShapeSurfaceResult o = offsetSurfaceOutward(s, 1.5);
        check(o.ok && approx(o.surface.r1, 5.5, 1e-12), "sphere r -> r + t (4 -> 5.5)");
    }
    // Over-shrink rejection: t <= -radius -> honest ok=false.
    {
        Surface s; s.kind = SurfaceKind::Sphere; s.r1 = 1.0; s.axis = {0,0,1}; s.refDir = {1,0,0};
        OffsetShapeSurfaceResult o = offsetSurfaceOutward(s, -1.0);
        check(!o.ok, "t <= -radius rejected honestly (no fake)");
    }
}

int main() {
    std::printf("=== forge::native::brep — native OFFSET-SHAPE (MakeOffsetShape) gate ===\n");
    testBoxGrow();
    testBoxShrink();
    testCylinderGrow();
    testFaceOffset();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
