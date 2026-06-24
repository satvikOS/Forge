// forge/native/brep/fillet_analytic_test.cpp
//
// Standalone validation gate for the ANALYTIC ROLLING-BALL EDGE FILLET increment
// (FilletAnalytic.hpp / FilletAnalytic.cpp) — the REAL constant-radius rolling-
// ball blend on the native ANALYTIC B-rep (cylinder fillet surface + re-trimmed
// planar faces + exact quarter-disk end caps, sewn into a closed solid), NOT the
// mesh-bridge rounded-edge strip in Fillet.cpp. Pure C++20, NO external deps, NO
// OCCT, NO WASM, no test framework — a tiny hand-rolled PASS/FAIL harness that
// exits non-zero on any failure (mirrors sew_test.cpp / k0_topology_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/FilletAnalytic.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Topology.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Surface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Curve.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/MassProps.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Sew.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native/brep/fillet_analytic_test.cpp \
//     -o /tmp/fillet_analytic_test && /tmp/fillet_analytic_test
//
// CLOSED-FORM GATES (asserted below) for box L=10, R=1.5 on the top-front edge:
//   (1) The result is a CLOSED 2-manifold shell (every edge mated by exactly two
//       opposite-sense coedges; 0 free, 0 non-manifold — via diagnoseShell).
//   (2) The filleted VOLUME == L^3 - (1 - pi/4)*R^2*L  to <= 1e-9 (the material a
//       quarter-round removes from the square corner over the edge length),
//       measured by the analytic divergence-theorem MassProps integrator.
//   (3) The new fillet SURFACE is a CYLINDER of radius R: sampled points across
//       its parameter rectangle are all exactly R from the cylinder axis (<=1e-9),
//       its surface kind is Cylinder, and its stored radius r1 == R.

#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Sew.hpp"

#include <algorithm>
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

static double dist(const Vec3& a, const Vec3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

int main() {
    std::printf("=== forge::native::brep — ANALYTIC ROLLING-BALL EDGE FILLET gate ===\n");
    constexpr double kPi = 3.14159265358979323846;

    const double L = 10.0;
    const double R = 1.5;

    TopologyBuilder tb;
    AnalyticFilletResult fr = filletBoxEdgeAnalytic(tb, L, R, /*edgeIndex=*/4);

    std::printf("[fillet] %s\n", fr.reason);
    check(fr.ok, "fillet op ok");
    if (!fr.ok) {
        std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
        return 1;
    }

    // ---- (1) closed 2-manifold ---------------------------------------------
    check(tb.isClosedTwoManifold(),
          "topology is a closed 2-manifold (every edge mated, all loops close)");
    std::vector<Face*> faces;
    for (Shell* sh : fr.solid->shells)
        for (Face* f : sh->faces) faces.push_back(f);
    SewDiagnosis d = diagnoseShell(faces);
    std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  shell %s  chi=%lld genus=%lld\n",
                d.vertices, d.edges, d.faces, d.freeEdges, d.nonManifoldEdges,
                d.closed ? "CLOSED" : "OPEN", d.eulerCharacteristic, d.genus);
    check(d.freeEdges == 0, "0 FREE edges (watertight)");
    check(d.nonManifoldEdges == 0, "0 non-manifold edges");
    check(d.closed, "shell CLOSED (watertight)");

    // ---- (2) volume == box - (1 - pi/4) R^2 L ------------------------------
    const double expectedRemoved = (1.0 - kPi / 4.0) * R * R * L;
    const double expectedVol = L * L * L - expectedRemoved;
    MassProps mp = massProperties(*fr.solid, /*gaussN=*/8);
    const double volErr = std::fabs(mp.volume - expectedVol);
    std::printf("      -> volume = %.15f   expected = %.15f   |err| = %.3e\n",
                mp.volume, expectedVol, volErr);
    std::printf("      -> removed = %.15f   (1 - pi/4) R^2 L = %.15f\n",
                (L * L * L - mp.volume), expectedRemoved);
    check(volErr <= 1e-9, "filleted volume == box - (1 - pi/4) R^2 L  to <= 1e-9");

    // ---- (3) the fillet surface is a cylinder of radius R ------------------
    check(fr.filletFace != nullptr && fr.filletFace->surface != nullptr,
          "fillet face carries a surface");
    Surface* s = fr.filletFace->surface;
    check(s->kind == SurfaceKind::Cylinder, "fillet surface kind == Cylinder");
    check(std::fabs(s->r1 - R) <= 1e-12, "fillet surface stored radius r1 == R");

    // Sample the surface across its parameter rectangle; every point must be
    // exactly R from the cylinder axis line (origin, axis dir).
    double maxAxisErr = 0.0;
    const Vec3 axOrigin = s->origin;
    const Vec3 axDir = s->axis;     // unit
    const double fu0 = fr.filletFace->u0, fu1 = fr.filletFace->u1;
    const double fv0 = fr.filletFace->v0, fv1 = fr.filletFace->v1;
    for (int iu = 0; iu <= 8; ++iu) {
        for (int iv = 0; iv <= 8; ++iv) {
            const double u = fu0 + (fu1 - fu0) * (iu / 8.0);
            const double v = fv0 + (fv1 - fv0) * (iv / 8.0);
            Vec3 p = s->evaluate(u, v);
            // perpendicular distance from p to the axis line.
            Vec3 w = vsub(p, axOrigin);
            const double t = vdot(w, axDir);
            Vec3 foot = vadd(axOrigin, vscale(axDir, t));
            const double rad = dist(p, foot);
            maxAxisErr = std::max(maxAxisErr, std::fabs(rad - R));
        }
    }
    std::printf("      -> max |dist(sample, axis) - R| over 9x9 grid = %.3e\n", maxAxisErr);
    check(maxAxisErr <= 1e-9, "every fillet-surface sample is exactly R from the axis (<= 1e-9)");

    // Spot-check the two tangent contacts lie on their faces' planes:
    //   tangentA on face A plane (z = L), tangentB on face B plane (y = 0).
    check(std::fabs(fr.tangentA.z - L) <= 1e-12, "tangent A lies on face A plane (z = L)");
    check(std::fabs(fr.tangentB.y - 0.0) <= 1e-12, "tangent B lies on face B plane (y = 0)");
    check(std::fabs(fr.dihedralDeg - 90.0) <= 1e-9, "interior dihedral = 90 degrees");

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
