// forge/native/brep/section_test.cpp
//
// Native gate for the planar SECTION / CUT VIEW of a B-rep solid (Section.hpp /
// Section.cpp — the OCCT BRepAlgoAPI_Section + section-fill analog). Auto-
// discovered by test/native/run_native.sh (the `brep` class).
//
// Asserts, on closed analytic solids built by SolidFactory:
//   * box (10x6x4) cut by a mid-HEIGHT plane (z = 2)        -> 1 closed rect wire,
//        filled area == 10*6 = 60 EXACT, centroid at the box centre (5,3,2);
//   * cylinder (R=3, H=8) cut by an AXIAL plane (y = 0)     -> rectangle 2R x H
//        = 6*8 = 48, centroid on the axis at z=H/2;
//   * cylinder (R=3, H=8) cut by a TRANSVERSE plane (z=4)   -> circle area piR^2
//        = pi*9, centroid on the axis;
//   * hollow tube (rO=4, rI=2, H=10) cut TRANSVERSE (z=5)   -> annulus area
//        pi(rO^2 - rI^2) = pi*12, 2 wires (outer + hole), centroid on the axis.
//
// Pure C++20, no external deps, no test framework.

#include <algorithm>
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Section.hpp"

#include <cmath>
#include <cstdio>
#include <string>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
static bool absClose(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol;
}

constexpr double PI = 3.14159265358979323846;

int main() {
    std::printf("== native B-rep planar SECTION / CUT-VIEW gate ==\n");

    // -------------------------------------------------------------------------
    // (1) BOX 10 x 6 x 4, cut by the mid-height plane z = 2.
    //     Section is the 10x6 rectangle at z=2; area == 60 EXACT; centroid (5,3,2).
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* box = fac.buildBox(10.0, 6.0, 4.0);
        SectionPlane pl; pl.point = {0, 0, 2.0}; pl.normal = {0, 0, 1};
        SectionResult r = sectionSolid(*box, pl);
        std::printf("  [box z=2]   ok=%d wires=%zu area=%.12f centroid=(%.9f,%.9f,%.9f) reason=%s\n",
                    (int)r.ok, r.numWires, r.area,
                    r.centroid.x, r.centroid.y, r.centroid.z, r.reason);
        check(r.ok, "box section ok");
        check(r.numWires == 1, "box section -> 1 closed wire");
        check(absClose(r.area, 60.0, 1e-9), "box section area == 10*6 = 60 exact");
        check(absClose(r.centroid.x, 5.0, 1e-7) &&
              absClose(r.centroid.y, 3.0, 1e-7) &&
              absClose(r.centroid.z, 2.0, 1e-12),
              "box section centroid == box centre (5,3,2)");
    }

    // -------------------------------------------------------------------------
    // (2) CYLINDER R=3, H=8, cut by the AXIAL plane y = 0 (contains the axis).
    //     Section is the 2R x H = 6 x 8 = 48 rectangle; centroid on the axis at
    //     (0, 0, H/2) = (0,0,4).
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* cyl = fac.buildCylinder(3.0, 8.0);
        SectionPlane pl; pl.point = {0, 0, 0}; pl.normal = {0, 1, 0};
        SectionResult r = sectionSolid(*cyl, pl);
        std::printf("  [cyl axial] ok=%d wires=%zu area=%.12f centroid=(%.9f,%.9f,%.9f) reason=%s\n",
                    (int)r.ok, r.numWires, r.area,
                    r.centroid.x, r.centroid.y, r.centroid.z, r.reason);
        check(r.ok, "cylinder axial section ok");
        check(r.numWires == 1, "cylinder axial section -> 1 closed wire");
        check(rel(r.area, 48.0, 1e-6), "cylinder axial section area == 2R*H = 48");
        check(absClose(r.centroid.x, 0.0, 1e-6) &&
              absClose(r.centroid.y, 0.0, 1e-9) &&
              absClose(r.centroid.z, 4.0, 1e-6),
              "cylinder axial section centroid on axis at z=H/2");
    }

    // -------------------------------------------------------------------------
    // (3) CYLINDER R=3, H=8, cut by the TRANSVERSE plane z = 4 (perp to axis).
    //     Section is the disc of radius 3; area == pi*R^2 = 9 pi; centroid on axis.
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* cyl = fac.buildCylinder(3.0, 8.0);
        SectionPlane pl; pl.point = {0, 0, 4.0}; pl.normal = {0, 0, 1};
        SectionResult r = sectionSolid(*cyl, pl);
        std::printf("  [cyl trans] ok=%d wires=%zu area=%.12f (pi*9=%.12f) centroid=(%.9f,%.9f,%.9f) reason=%s\n",
                    (int)r.ok, r.numWires, r.area, PI * 9.0,
                    r.centroid.x, r.centroid.y, r.centroid.z, r.reason);
        check(r.ok, "cylinder transverse section ok");
        check(r.numWires == 1, "cylinder transverse section -> 1 closed wire");
        check(rel(r.area, PI * 9.0, 1e-9), "cylinder transverse section area == pi*R^2");
        check(absClose(r.centroid.x, 0.0, 1e-6) &&
              absClose(r.centroid.y, 0.0, 1e-6) &&
              absClose(r.centroid.z, 4.0, 1e-12),
              "cylinder transverse section centroid on axis at z=4");
    }

    // -------------------------------------------------------------------------
    // (4) HOLLOW TUBE rO=4, rI=2, H=10, cut TRANSVERSE z = 5.
    //     Section is an annulus: 2 wires (outer R=4 + hole R=2); filled area ==
    //     pi(rO^2 - rI^2) = pi*12; centroid on the axis.
    // -------------------------------------------------------------------------
    {
        SolidFactory fac;
        Solid* tube = fac.buildTube(4.0, 2.0, 10.0);
        SectionPlane pl; pl.point = {0, 0, 5.0}; pl.normal = {0, 0, 1};
        SectionResult r = sectionSolid(*tube, pl);
        std::printf("  [tube ann]  ok=%d wires=%zu area=%.12f (pi*12=%.12f) centroid=(%.9f,%.9f,%.9f) reason=%s\n",
                    (int)r.ok, r.numWires, r.area, PI * 12.0,
                    r.centroid.x, r.centroid.y, r.centroid.z, r.reason);
        check(r.ok, "tube annulus section ok");
        check(r.numWires == 2, "tube annulus section -> 2 closed wires (outer + hole)");
        check(rel(r.area, PI * 12.0, 1e-9), "tube annulus filled area == pi(rO^2-rI^2)=12 pi");
        check(absClose(r.centroid.x, 0.0, 1e-6) &&
              absClose(r.centroid.y, 0.0, 1e-6) &&
              absClose(r.centroid.z, 5.0, 1e-12),
              "tube annulus section centroid on axis at z=5");
    }

    std::printf("\n== section gate: %d/%d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
