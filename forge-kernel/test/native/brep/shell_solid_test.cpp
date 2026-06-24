// forge/native/brep/shell_solid_test.cpp
//
// Standalone validation gate for the native analytic OFFSET / SHELL increment
// (Shell.hpp / Shell.cpp) — the in-house replacement for OCCT
// BRepOffsetAPI_MakeThickSolid on planar + analytic-quadric faces at a uniform wall
// thickness. Pure C++20, NO external dependencies, NO OCCT, NO WASM, no test
// framework — a tiny hand-rolled harness that prints PASS/FAIL and exits non-zero on
// any failure (mirrors sew_test.cpp / k0_topology_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below mirrors
// run_native.sh — it compiles EVERY native source object and links them all):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
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
//     forge-kernel/test/native/brep/shell_solid_test.cpp \
//     -o /tmp/shell_solid_test && /tmp/shell_solid_test
//
// CLOSED-FORM GATES (L = 10, t = 1):
//   (1) OPEN-TOP SHELL. Hollow the box with the TOP face removed -> an open wall
//       solid whose VOLUME == outer box minus the open cavity:
//           V = L^3 - (L-2t)^2 * (L-t) = 1000 - 64*9 = 424   (<= 1e-9).
//       The wall stays a closed 2-manifold (the mouth rim is bridged by a side-wall
//       lip band), and the sampled wall thickness == t.
//   (2) CLOSED SHELL. Hollow the box with NO face removed -> a watertight hollow
//       solid whose VOLUME == L^3 - (L-2t)^3 = 1000 - 512 = 488   (<= 1e-9).
//   (3) FACE OFFSET unit checks: a plane offsets to a parallel plane shifted by t
//       along its inward normal; a cylinder/sphere radius r -> r-t.

#include "forge/native/brep/Shell.hpp"
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

static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// ===========================================================================
// (1) OPEN-TOP SHELL: box L=10, t=1, top face removed -> wall solid.
//   V = L^3 - (L-2t)^2 (L-t) = 1000 - 64*9 = 424.
// ===========================================================================
static void testOpenTopShell() {
    std::printf("[1] open-top box shell (L=10, t=1, top removed)\n");
    const double L = 10.0, t = 1.0;

    SolidFactory fac;                 // analytic surfaces attached on every box face
    Solid* box = fac.buildBox(L, L, L);

    // Box face order (Primitives.cpp buildBox): 0 bottom, 1 top, 2 front, 3 back,
    // 4 left, 5 right. Remove the TOP face (index 1).
    ShellOptions opt;
    opt.thickness = t;
    opt.removedFaces = {1};
    opt.tol = 1e-9;

    ShellResult r = shellSolid(fac.builder(), box, opt);
    check(r.ok, std::string("shell ok (") + r.reason + ")");
    check(r.solid != nullptr, "hollow solid built");

    const double expected = L * L * L - (L - 2 * t) * (L - 2 * t) * (L - t); // 424
    check(approx(r.volume, expected, 1e-9),
          "volume == L^3 - (L-2t)^2 (L-t) == 424 (<= 1e-9)");

    // The wall is a closed 2-manifold (mouth bridged by the lip band).
    check(r.closedManifold, "wall is a closed 2-manifold (lip-bridged)");
    check(r.freeEdges == 0, "0 free edges (watertight wall)");

    // Wall thickness sampled: the gap between the outer bottom plane (z=0) and the
    // inner bottom plane (z=t) must equal t; likewise the side walls. We verify via
    // the offset-surface helper on the bottom face: the inner bottom plane sits at
    // z = t, i.e. exactly t below the outer plane along its inward normal.
    {
        Surface* bottom = box->shells.front()->faces[0]->surface;   // z=0, outward -Z
        OffsetSurfaceResult os = offsetSurfaceInward(*bottom, t);
        check(os.ok, "bottom face offset ok");
        // inward normal of the bottom face is +Z; offset origin moves +Z by t.
        check(approx(os.surface.origin.z, t, 1e-12), "inner bottom plane at z == t (thickness == t)");
    }

    std::printf("      -> outerF=%zu innerF=%zu wallF=%zu  V=%.12f (exp %.12f)  %s\n",
                r.outerFaces, r.innerFaces, r.wallFaces, r.volume, expected,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (2) CLOSED SHELL: box L=10, t=1, NO face removed -> watertight hollow solid.
//   V = L^3 - (L-2t)^3 = 1000 - 512 = 488.
// ===========================================================================
static void testClosedShell() {
    std::printf("[2] closed box shell (L=10, t=1, no face removed)\n");
    const double L = 10.0, t = 1.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);

    ShellOptions opt;
    opt.thickness = t;
    opt.tol = 1e-9;                    // removedFaces empty -> fully closed

    ShellResult r = shellSolid(fac.builder(), box, opt);
    check(r.ok, std::string("shell ok (") + r.reason + ")");

    const double expected = L * L * L - (L - 2 * t) * (L - 2 * t) * (L - 2 * t); // 488
    check(approx(r.volume, expected, 1e-9), "volume == L^3 - (L-2t)^3 == 488 (<= 1e-9)");
    check(r.closedManifold, "watertight hollow solid (closed 2-manifold)");
    check(r.freeEdges == 0, "0 free edges");
    check(r.wallFaces == 0, "no side-wall bands (nothing removed)");
    check(r.outerFaces == 6 && r.innerFaces == 6, "6 outer + 6 inner faces");

    std::printf("      -> outerF=%zu innerF=%zu wallF=%zu  V=%.12f (exp %.12f)  %s\n",
                r.outerFaces, r.innerFaces, r.wallFaces, r.volume, expected,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// ===========================================================================
// (3) FACE-OFFSET unit checks (closed-form per-surface offset).
// ===========================================================================
static void testFaceOffset() {
    std::printf("[3] analytic face-offset closed forms\n");
    // Plane: origin (0,0,0), outward +Z. Inward offset by t=2 -> origin (0,0,-2)
    // (moved along the INWARD normal -Z), normal unchanged.
    {
        Surface p;
        p.kind = SurfaceKind::Plane;
        p.origin = {0, 0, 0};
        p.axis = {0, 0, 1};      // plane normal +Z (outward)
        p.refDir = {1, 0, 0};
        OffsetSurfaceResult o = offsetSurfaceInward(p, 2.0);
        check(o.ok, "plane offset ok");
        check(approx(o.surface.origin.z, -2.0, 1e-12), "plane offsets to parallel plane shifted -2 along inward normal");
        Vec3 n0 = p.normalAt(0, 0), n1 = o.surface.normalAt(0, 0);
        check(approx(n0.x, n1.x, 1e-12) && approx(n0.y, n1.y, 1e-12) && approx(n0.z, n1.z, 1e-12),
              "offset plane keeps the same normal");
    }
    // Cylinder r=5 -> r-t=3.
    {
        Surface c;
        c.kind = SurfaceKind::Cylinder;
        c.origin = {0, 0, 0}; c.axis = {0, 0, 1}; c.refDir = {1, 0, 0};
        c.r1 = 5.0; c.param = 10.0;
        OffsetSurfaceResult o = offsetSurfaceInward(c, 2.0);
        check(o.ok && approx(o.surface.r1, 3.0, 1e-12), "cylinder radius r -> r - t (5 -> 3)");
    }
    // Sphere r=4 -> r-t=2.5.
    {
        Surface s;
        s.kind = SurfaceKind::Sphere;
        s.origin = {0, 0, 0}; s.axis = {0, 0, 1}; s.refDir = {1, 0, 0};
        s.r1 = 4.0;
        OffsetSurfaceResult o = offsetSurfaceInward(s, 1.5);
        check(o.ok && approx(o.surface.r1, 2.5, 1e-12), "sphere radius r -> r - t (4 -> 2.5)");
    }
    // Over-thick rejection: t >= radius -> honest ok=false.
    {
        Surface s; s.kind = SurfaceKind::Sphere; s.r1 = 1.0; s.axis = {0,0,1}; s.refDir = {1,0,0};
        OffsetSurfaceResult o = offsetSurfaceInward(s, 1.0);
        check(!o.ok, "t >= radius rejected honestly (no fake)");
    }
}

int main() {
    std::printf("=== forge::native::brep — native OFFSET / SHELL (MakeThickSolid) gate ===\n");
    testOpenTopShell();
    testClosedShell();
    testFaceOffset();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
