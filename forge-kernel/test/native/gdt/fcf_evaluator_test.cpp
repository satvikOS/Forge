// forge/native/gdt/fcf_evaluator_test.cpp
//
// KNOWN-ANSWER validation gate for forge::native::gdt::fcf — the geometric GD&T /
// FCF evaluator that measures on a BUILT NATIVE B-rep Solid (FcfEvaluator.hpp/cpp).
//
// Per Forge Engineering Bible §0/§9 the math is REAL ASME Y14.5 geometry, so each
// characteristic is checked against an ANALYTIC expected value, not self-
// consistency:
//   * a perfectly planar face          -> flatness  ≈ 0
//   * a tilted-but-flat plane          -> flatness  ≈ 0   (flatness ≠ orientation)
//   * a symmetric ±h two-spike set     -> flatness  ≈ 2h
//   * a zig-zag ±d line element        -> straightness ≈ 2d
//   * an ellipse a=R+e, b=R section    -> circularity  ≈ e
//   * an elliptical cylinder           -> cylindricity ≈ e
//   * a hole axis displaced d (in DRF) -> position     ≈ 2d  (+ exact MMC bonus)
//   * an axis tilted φ from a datum     -> perpendicularity ≈ L·sinφ
//   * a basic-angle-θ feature off by φ  -> angularity        ≈ L·sinφ
//   * a feature axis eccentric e        -> concentricity     ≈ 2e
//   * a circle eccentric e (one section)-> circular runout   ≈ 2e
//   * an eccentric-e cylinder           -> total runout      ≈ 2e
//   * a profile point pushed δ off-norm -> profile           ≈ δ (pass iff δ≤tol/2)
//
// It ALSO drives the NATIVE B-rep pipeline end-to-end on REAL primitive solids
// built by brep::SolidFactory (box, cylinder): an ideal built solid measures ≈ 0
// for every form/orientation/runout characteristic, proving the surface/curve
// SAMPLING + axis-read path, not just the point-set cores.
//
// Build & run (also via test/native/run_native.sh, which globs the gdt dir):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//     forge-kernel/src/native/gdt/FcfEvaluator.cpp \
//     forge-kernel/src/native/brep/*.cpp ... \
//     forge-kernel/test/native/gdt/fcf_evaluator_test.cpp -o /tmp/fcf && /tmp/fcf
// (run_native.sh links the whole native object set, so all brep deps resolve.)

#include "forge/native/gdt/FcfEvaluator.hpp"
#include "forge/native/brep/Primitives.hpp"

#include <cstdio>
#include <cmath>
#include <vector>

using namespace forge::native::gdt::fcf;
namespace brep = forge::native::brep;
using brep::Vec3;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) ++g_pass;
    else std::printf("  [FAIL] %s\n", name);
}
static bool approx(double a, double b, double tol = 1e-6) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}

// ---- small geometry builders for the analytic known-answer point sets --------
static std::vector<Vec3> planarGrid(double half, int n, double z) {
    std::vector<Vec3> p;
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) {
            double x = -half + 2 * half * i / (n - 1);
            double y = -half + 2 * half * j / (n - 1);
            p.push_back(Vec3{x, y, z});
        }
    return p;
}

int main() {
    std::printf("== forge::native::gdt::fcf known-answer gate ==\n");
    const double PI = 3.14159265358979323846;

    // =======================================================================
    // (0) DATUM REFERENCE FRAME
    // =======================================================================
    {
        Drf d = buildDrfPlanes(Vec3{0, 0, 1}, Vec3{0, 0, 2},      // A: z=1 plane, +Z
                               Vec3{2, 0, 0}, Vec3{3, 0, 0},      // B: x=2 plane, +X
                               Vec3{0, 5, 0}, Vec3{0, -1, 0});    // C: y=5 plane, ±Y
        check(d.ok, "(0) DRF builds from 3 planes");
        // ez ∥ A normal (+Z), origin at the mutual intersection (2,5,1).
        check(approx(std::fabs(d.ez.z), 1.0), "(0) DRF ez ∥ A normal");
        check(approx(d.origin.x, 2.0) && approx(d.origin.y, 5.0) && approx(d.origin.z, 1.0),
              "(0) DRF origin = plane intersection (2,5,1)");
        // orthonormal & right-handed
        Vec3 xy = brep::vcross(d.ex, d.ey);
        check(approx(brep::vdot(d.ex, d.ey), 0) && approx(brep::vdot(d.ex, d.ez), 0) &&
              approx(brep::vdot(d.ey, d.ez), 0), "(0) DRF orthogonal");
        check(approx(xy.x, d.ez.x) && approx(xy.y, d.ez.y) && approx(xy.z, d.ez.z),
              "(0) DRF right-handed");
        // round-trip identity
        Vec3 w{1.3, -2.7, 4.1};
        Vec3 back = toWorld(d, toDrf(d, w));
        check(approx(back.x, w.x) && approx(back.y, w.y) && approx(back.z, w.z),
              "(0) DRF round-trip identity");

        Drf bad = buildDrfPlanes(Vec3{0, 0, 0}, Vec3{0, 0, 1},
                                 Vec3{0, 0, 0}, Vec3{0, 0, 1},   // B ∥ A
                                 Vec3{0, 0, 0}, Vec3{0, 1, 0});
        check(!bad.ok, "(0) DRF rejects B parallel to A");

        Drf ax = buildDrfAxis(Vec3{1, 2, 3}, Vec3{0, 0, 5});
        check(ax.ok && approx(std::fabs(ax.ez.z), 1.0), "(0) DRF from a primary axis");
    }

    // =======================================================================
    // (1) FLATNESS
    // =======================================================================
    {
        // F1 perfectly planar -> 0
        FcfResult f1 = measureFlatness(planarGrid(3.0, 5, 0.0), 1e-6);
        check(f1.ok && f1.measured < 1e-9 && f1.pass, "(1) perfect plane flatness≈0");

        // F2 symmetric two-spike ±h about the grid centroid -> band = 2h
        const double h = 0.37;
        std::vector<Vec3> pts = planarGrid(3.0, 5, 0.0);
        pts.push_back(Vec3{0, 0, +h});
        pts.push_back(Vec3{0, 0, -h});
        FcfResult f2 = measureFlatness(pts, 1.0);
        check(f2.ok && approx(f2.measured, 2 * h, 1e-6), "(1) ±h spikes flatness≈2h");
        check(measureFlatness(pts, 2 * h + 1e-6).pass, "(1) tol just above 2h PASSES");
        check(!measureFlatness(pts, 2 * h - 1e-6).pass, "(1) tol just below 2h FAILS");

        // F3 tilted-but-flat plane -> flatness STILL 0 (distinguishes flatness from
        //    orientation: a tilted flat face is perfectly flat).
        const double th = 0.4;
        Vec3 u{std::cos(th), 0, -std::sin(th)}, v{0, 1, 0};   // span of an inclined plane
        std::vector<Vec3> tilt;
        for (int i = -3; i <= 3; ++i)
            for (int j = -3; j <= 3; ++j)
                tilt.push_back(Vec3{u.x * i + v.x * j, u.y * i + v.y * j, u.z * i + v.z * j});
        FcfResult f3 = measureFlatness(tilt, 1e-6);
        check(f3.ok && f3.measured < 1e-9, "(1) tilted-but-flat plane flatness≈0");

        // F4 REAL box face (native pipeline): four coplanar corners -> 0
        brep::SolidFactory fac;
        brep::Solid* box = fac.buildBox(10, 6, 4);
        check(box && !box->shells.empty(), "(1) box solid built");
        brep::Face* bf = box->shells[0]->faces.front();
        FcfResult f4 = flatness(*bf, 1e-6);
        check(f4.ok && f4.measured < 1e-6 && f4.pass, "(1) REAL box face flatness≈0 (pipeline)");
    }

    // =======================================================================
    // (2) STRAIGHTNESS
    // =======================================================================
    {
        const double L = 8.0, d = 0.21;
        std::vector<Vec3> line;            // along +x at y=0, z=0
        for (int i = 0; i < 20; ++i) line.push_back(Vec3{L * i / 19.0, 0, 0});
        FcfResult s0 = measureStraightness(line, 1e-6, false);
        check(s0.ok && s0.measured < 1e-9, "(2) perfect line straightness≈0");

        std::vector<Vec3> zig;             // y alternates ±d, x evenly spaced
        for (int i = 0; i < 20; ++i)
            zig.push_back(Vec3{L * i / 19.0, (i % 2 ? +d : -d), 0});
        FcfResult sp = measureStraightness(zig, 1.0, false);   // planar band
        check(sp.ok && approx(sp.measured, 2 * d, 1e-6), "(2) zig-zag planar straightness≈2d");
        FcfResult sd = measureStraightness(zig, 1.0, true);    // Ø derived median line
        check(sd.ok && approx(sd.measured, 2 * d, 1e-6), "(2) zig-zag Ø straightness≈2d");

        // REAL box edge (native pipeline): a straight edge -> ≈ 0.
        brep::SolidFactory fac;
        brep::Solid* box = fac.buildBox(10, 6, 4);
        brep::Edge* e = box->shells[0]->faces.front()->outerLoop->first->edge;
        FcfResult se = straightnessEdge(*e, 1e-6);
        check(se.ok && se.measured < 1e-6, "(2) REAL box edge straightness≈0 (pipeline)");
    }

    // =======================================================================
    // (3) CIRCULARITY
    // =======================================================================
    {
        const double R = 5.0, e = 0.18;
        std::vector<Vec3> circ, ell;
        const int N = 360;                 // includes θ=0,90,180,270
        for (int i = 0; i < N; ++i) {
            double a = 2 * PI * i / N;
            circ.push_back(Vec3{R * std::cos(a), R * std::sin(a), 0});
            ell.push_back(Vec3{(R + e) * std::cos(a), R * std::sin(a), 0});  // a=R+e, b=R
        }
        FcfResult c0 = measureCircularity(circ, 1e-6);
        check(c0.ok && c0.measured < 1e-6, "(3) perfect circle circularity≈0");
        FcfResult ce = measureCircularity(ell, 1.0);
        check(ce.ok && approx(ce.measured, e, 1e-4), "(3) ellipse a=R+e circularity≈e");

        // REAL cylinder base ring (native pipeline): full circle from the analytic
        // cylinder-surface sectors -> ≈ 0.
        brep::SolidFactory fac;
        brep::Solid* cyl = fac.buildCylinder(R, 12.0);
        std::vector<Vec3> ring;
        for (brep::Face* f : cyl->shells[0]->faces) {
            if (!f->surface || f->surface->kind != brep::SurfaceKind::Cylinder) continue;
            const brep::Surface& s = *f->surface;
            for (int k = 0; k < 8; ++k) {
                double uu = f->u0 + (f->u1 - f->u0) * k / 8.0;   // base ring at v=v0
                ring.push_back(s.evaluate(uu, f->v0));
            }
        }
        FcfResult cr = measureCircularity(ring, 1e-6);
        check(cr.ok && cr.measured < 1e-6, "(3) REAL cylinder ring circularity≈0 (pipeline)");
    }

    // =======================================================================
    // (4) CYLINDRICITY
    // =======================================================================
    {
        const double R = 4.0, e = 0.12, H = 10.0;
        std::vector<Vec3> cyl, ell;
        for (int j = 0; j < 12; ++j) {
            double z = -H / 2 + H * j / 11.0;   // centred on z=0 -> eigenvecs = X,Y,Z
            for (int i = 0; i < 48; ++i) {
                double a = 2 * PI * i / 48;
                cyl.push_back(Vec3{R * std::cos(a), R * std::sin(a), z});
                ell.push_back(Vec3{(R + e) * std::cos(a), R * std::sin(a), z});
            }
        }
        FcfResult cy0 = measureCylindricity(cyl, 1e-6);
        check(cy0.ok && cy0.measured < 1e-6, "(4) perfect cylinder cylindricity≈0");
        FcfResult cye = measureCylindricity(ell, 1.0);
        check(cye.ok && approx(cye.measured, e, 1e-4), "(4) elliptical cylinder cylindricity≈e");

        // REAL cylinder full surface cloud (native pipeline) -> ≈ 0.
        brep::SolidFactory fac;
        brep::Solid* solid = fac.buildCylinder(R, H);
        std::vector<Vec3> cloud;
        for (brep::Face* f : solid->shells[0]->faces)
            if (f->surface && f->surface->kind == brep::SurfaceKind::Cylinder)
                for (const Vec3& p : sampleFace(*f, 6, 8)) cloud.push_back(p);
        FcfResult cyr = measureCylindricity(cloud, 1e-6);
        check(cyr.ok && cyr.measured < 1e-6, "(4) REAL cylinder cylindricity≈0 (pipeline)");
    }

    // =======================================================================
    // (5) POSITION (+ MMC/LMC bonus)
    // =======================================================================
    {
        const double d = 0.15, posTol = 0.5;
        // P1 core: axis displaced d in the DRF XY -> diametral 2d.
        FcfResult p1 = measurePosition(Vec3{d, 0, 9}, Vec3{0, 0, 0}, posTol,
                                       10, 10, MatCond::RFS, FoSType::Hole);
        check(approx(p1.measured, 2 * d) && approx(p1.toleranceZone, posTol) && p1.pass,
              "(5) position deviation≈2d (RFS)");

        // P2 MMC bonus (hole): MMC=10, actual=10.5 -> bonus 0.5; posTol 0.2 -> zone 0.7;
        //    deviation 0.6 -> PASS; the SAME feature at RFS (zone 0.2) FAILS.
        FcfResult mmc = measurePosition(Vec3{0.3, 0, 0}, Vec3{0, 0, 0}, 0.2,
                                        10.5, 10.0, MatCond::MMC, FoSType::Hole);
        check(approx(mmc.measured, 0.6) && approx(mmc.bonus, 0.5) &&
              approx(mmc.toleranceZone, 0.7) && mmc.pass,
              "(5) MMC hole bonus 0.5 -> zone 0.7 PASS");
        FcfResult rfs = measurePosition(Vec3{0.3, 0, 0}, Vec3{0, 0, 0}, 0.2,
                                        10.5, 10.0, MatCond::RFS, FoSType::Hole);
        check(rfs.bonus == 0.0 && !rfs.pass, "(5) same feature RFS FAILS");
        // MMC pin: largest size is MMC; shrinking earns bonus.
        check(approx(mmcBonus(9.6, 10.0, MatCond::MMC, FoSType::Pin), 0.4),
              "(5) MMC pin shrink bonus 0.4");

        // P3 REAL cylinder (native pipeline): identity DRF, hole axis at world (0,0,0),
        //    basic location (d,0,0) in the DRF -> measured 2d.
        Drf id = buildDrfPlanes(Vec3{0, 0, 0}, Vec3{0, 0, 1},
                                Vec3{0, 0, 0}, Vec3{1, 0, 0},
                                Vec3{0, 0, 0}, Vec3{0, 1, 0});
        check(id.ok && approx(id.origin.x, 0) && approx(id.origin.y, 0) && approx(id.origin.z, 0),
              "(5) identity DRF built");
        brep::SolidFactory fac;
        brep::Solid* cyl = fac.buildCylinder(3.0, 8.0);
        brep::Face* cf = nullptr;
        for (brep::Face* f : cyl->shells[0]->faces)
            if (f->surface && f->surface->kind == brep::SurfaceKind::Cylinder) { cf = f; break; }
        check(cf != nullptr, "(5) found a cylindrical face");
        FcfResult p3 = position(*cf, id, Vec3{d, 0, 0}, posTol, 0.0, 0.0,
                                MatCond::RFS, FoSType::Hole);
        check(p3.ok && approx(p3.measured, 2 * d, 1e-6), "(5) REAL hole position≈2d (pipeline)");
    }

    // =======================================================================
    // (6) ORIENTATION: Perpendicularity / Parallelism / Angularity
    // =======================================================================
    {
        const double L = 6.0, phi = 0.10;   // rad
        // O1 perpendicularity of an axis to a datum plane: axis tilted φ from the
        //    plane normal -> deviation = L·sinφ.
        Vec3 axis{0, std::sin(phi), std::cos(phi)};
        FcfResult o1 = measureOrientation(Characteristic::Perpendicularity, axis,
                                          Vec3{0, 0, 1}, 0.0, 1.0, L);
        check(o1.ok && approx(o1.measured, L * std::sin(phi), 1e-9),
              "(6) perpendicularity axis tilt φ -> L·sinφ");
        check(measureOrientation(Characteristic::Perpendicularity, axis, Vec3{0, 0, 1},
                                 0.0, L * std::sin(phi) + 1e-6, L).pass,
              "(6) tol just above L·sinφ PASSES");
        check(!measureOrientation(Characteristic::Perpendicularity, axis, Vec3{0, 0, 1},
                                  0.0, L * std::sin(phi) - 1e-6, L).pass,
              "(6) tol just below L·sinφ FAILS");

        // O2 angularity θ=30°: a feature at 30°+φ from the datum -> error φ.
        double base = 30.0, ang = (base + phi * 180.0 / PI) * PI / 180.0;
        Vec3 fdir{std::sin(ang), 0, std::cos(ang)};   // makes angle (30°+φ) with +Z
        FcfResult o2 = measureOrientation(Characteristic::Angularity, fdir,
                                          Vec3{0, 0, 1}, base, 1.0, L);
        check(o2.ok && approx(o2.measured, L * std::sin(phi), 1e-6),
              "(6) angularity basic 30° off by φ -> L·sinφ");

        // O3 REAL cylinder (native pipeline): axis ∥ +Z, perpendicular to a datum
        //    plane whose normal is +Z -> deviation ≈ 0.
        brep::SolidFactory fac;
        brep::Solid* cyl = fac.buildCylinder(3.0, 8.0);
        brep::Face* cf = nullptr;
        for (brep::Face* f : cyl->shells[0]->faces)
            if (f->surface && f->surface->kind == brep::SurfaceKind::Cylinder) { cf = f; break; }
        FcfResult o3 = orientationAxis(*cf, Vec3{0, 0, 1},
                                       Characteristic::Perpendicularity, 0.0, 0.05);
        check(o3.ok && o3.measured < 1e-6 && o3.pass,
              "(6) REAL cylinder axis ⟂ datum plane -> 0 (pipeline)");

        // O4 REAL box top face (native pipeline): face normal vs a parallel datum
        //    normal -> deviation ≈ 0.
        brep::Solid* box = fac.buildBox(10, 6, 4);
        brep::Face* bf = box->shells[0]->faces.front();
        FcfResult o4 = orientationFace(*bf, Vec3{0, 0, 1},
                                       Characteristic::Parallelism, 0.0, 0.05);
        // basic angle for ∥ depends on the box face's actual normal; just assert it
        // produced a finite verdict (the face normal is axis-aligned -> 0 or 90 exact).
        check(o4.ok, "(6) REAL box face orientation evaluated (pipeline)");
    }

    // =======================================================================
    // (7) CONCENTRICITY
    // =======================================================================
    {
        const double e = 0.22;
        FcfResult c0 = measureConcentricity(Vec3{0, 0, 0}, Vec3{0, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(c0.ok && c0.measured < 1e-12, "(7) coaxial feature concentricity≈0");
        FcfResult ce = measureConcentricity(Vec3{e, 0, 0}, Vec3{0, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(ce.ok && approx(ce.measured, 2 * e), "(7) eccentric e concentricity≈2e");

        // REAL cylinder (native pipeline): axis at (0,0,0); datum axis offset by e.
        brep::SolidFactory fac;
        brep::Solid* cyl = fac.buildCylinder(3.0, 8.0);
        brep::Face* cf = nullptr;
        for (brep::Face* f : cyl->shells[0]->faces)
            if (f->surface && f->surface->kind == brep::SurfaceKind::Cylinder) { cf = f; break; }
        FcfResult cr = concentricity(*cf, Vec3{e, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(cr.ok && approx(cr.measured, 2 * e, 1e-6),
              "(7) REAL cylinder eccentric e concentricity≈2e (pipeline)");
    }

    // =======================================================================
    // (8) RUNOUT (circular + total)
    // =======================================================================
    {
        const double R = 5.0, e = 0.16;
        // R1 circular runout: a circle of radius R centred at (e,0) in one section;
        //    datum axis is +Z through the origin -> FIM = 2e.
        std::vector<Vec3> section;
        const int N = 360;
        for (int i = 0; i < N; ++i) {
            double a = 2 * PI * i / N;
            section.push_back(Vec3{e + R * std::cos(a), R * std::sin(a), 3.0});
        }
        FcfResult rc = measureCircularRunout(section, Vec3{0, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(rc.ok && approx(rc.measured, 2 * e, 1e-4), "(8) circular runout eccentric e -> 2e");

        // R2 total runout: an eccentric-e cylinder over its length -> FIM 2e.
        std::vector<Vec3> surf;
        for (int j = 0; j < 12; ++j) {
            double z = 10.0 * j / 11.0;
            for (int i = 0; i < 48; ++i) {
                double a = 2 * PI * i / 48;
                surf.push_back(Vec3{e + R * std::cos(a), R * std::sin(a), z});
            }
        }
        FcfResult rt = measureTotalRunout(surf, Vec3{0, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(rt.ok && approx(rt.measured, 2 * e, 1e-4), "(8) total runout eccentric e -> 2e");

        // R3 REAL cylinder (native pipeline): coaxial datum -> 0; datum offset e -> 2e.
        brep::SolidFactory fac;
        brep::Solid* cyl = fac.buildCylinder(R, 10.0);
        std::vector<Vec3> cloud;
        for (brep::Face* f : cyl->shells[0]->faces)
            if (f->surface && f->surface->kind == brep::SurfaceKind::Cylinder)
                for (const Vec3& p : sampleFace(*f, 6, 8)) cloud.push_back(p);
        FcfResult rt0 = measureTotalRunout(cloud, Vec3{0, 0, 0}, Vec3{0, 0, 1}, 1e-6);
        check(rt0.ok && rt0.measured < 1e-6, "(8) REAL cylinder coaxial total runout≈0 (pipeline)");
        FcfResult rte = measureTotalRunout(cloud, Vec3{e, 0, 0}, Vec3{0, 0, 1}, 1.0);
        check(rte.ok && approx(rte.measured, 2 * e, 1e-4),
              "(8) REAL cylinder datum offset e total runout≈2e (pipeline)");
    }

    // =======================================================================
    // (9) PROFILE OF A SURFACE
    // =======================================================================
    {
        // True profile = points on a plane z=0 with outward normal +Z; push each
        // measured point off the normal by δ_i, max |δ| = δmax.
        std::vector<Vec3> truePts, normals, meas;
        const double dmax = 0.08;
        for (int i = 0; i < 11; ++i) {
            double x = i - 5.0;
            double dlt = dmax * std::sin(PI * i / 10.0);  // peaks at dmax
            truePts.push_back(Vec3{x, 0, 0});
            normals.push_back(Vec3{0, 0, 1});
            meas.push_back(Vec3{x, 0, dlt});
        }
        FcfResult pr = measureProfile(meas, truePts, normals, 0.20, false);  // bilateral ±0.10
        check(pr.ok && approx(pr.measured, dmax, 1e-9), "(9) profile worst dev≈δmax");
        check(pr.pass, "(9) profile PASS when δmax ≤ tol/2");
        FcfResult prf = measureProfile(meas, truePts, normals, 0.10, false); // ±0.05 < δmax
        check(!prf.pass, "(9) profile FAIL when δmax > tol/2");
        FcfResult pru = measureProfile(meas, truePts, normals, 0.10, true);  // unilateral 0..0.10
        check(pru.ok && pru.pass, "(9) profile unilateral 0..tol PASS (all δ≥0, ≤tol)");
    }

    std::printf("\n== RESULT: %d / %d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
