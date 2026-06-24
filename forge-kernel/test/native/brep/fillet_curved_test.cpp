// forge/native/brep/fillet_curved_test.cpp
//
// Standalone validation gate for the CURVED-FACE rolling-ball edge fillet
// increment (filletCylinderTopEdgeAnalytic in FilletAnalytic.hpp/.cpp): the REAL
// constant-radius rolling-ball blend on the CONVEX CIRCULAR edge where a cylinder's
// CYLINDRICAL side meets its FLAT TOP CAP. Unlike the planar-planar case (whose
// blend is a CYLINDER), here one contact face is a cylinder and the other a plane,
// so the rolling-ball blend is a TORUS of tube radius R and ring radius (Rc - R).
//
// Pure C++20, NO external deps, NO OCCT, NO WASM, no test framework — a tiny
// hand-rolled PASS/FAIL harness exiting non-zero on any failure (mirrors
// fillet_analytic_test.cpp / sew_test.cpp).
//
// Build + run (single clang++, the ONE compile this increment is allowed):
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
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native/brep/fillet_curved_test.cpp \
//     -o /tmp/fillet_curved_test && /tmp/fillet_curved_test
//
// CLOSED-FORM GATES (cylinder Rc=5, H=8, fillet R=1, top circular edge):
//   (1) CLOSED genus-0 2-manifold (0 free, 0 non-manifold via diagnoseShell).
//   (2) the blend surface is a TORUS of tube (minor) radius r2==R and ring (major)
//       radius r1==Rc-R.
//   (3) every blend-surface sample is distance R from the SPINE circle (the locus
//       of the rolling-ball centre): radius Rc-R at z=H-R.
//   (4) VOLUME == pi*Rc^2*H - [ 2*pi*(Rc-R)*(1-pi/4)*R^2 + (pi/3)*R^3 ]  to <= 1e-6
//       (the EXACT revolved toroidal-corner material removed).

#include <algorithm>
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Sew.hpp"

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

int main() {
    std::printf("=== forge::native::brep — CURVED-FACE (planar+cylinder) TORUS FILLET gate ===\n");
    constexpr double kPi = 3.14159265358979323846;

    const double Rc = 5.0;   // cylinder radius
    const double H  = 8.0;   // cylinder height
    const double R  = 1.0;   // fillet radius
    const int    N  = 64;    // angular segments

    TopologyBuilder tb;
    AnalyticTorusFilletResult fr = filletCylinderTopEdgeAnalytic(tb, Rc, H, R, N);

    std::printf("[fillet] %s\n", fr.reason);
    check(fr.ok, "cylinder-top torus fillet op ok");
    if (!fr.ok) {
        std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
        return 1;
    }

    // ---- (1) closed genus-0 2-manifold -------------------------------------
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
    check(d.genus == 0, "genus 0 (a filleted cylinder is topologically a ball)");

    // ---- (2) the blend surface is a TORUS of tube R and ring Rc-R ----------
    check(fr.filletFace != nullptr && fr.filletFace->surface != nullptr,
          "blend face carries a surface");
    Surface* s = fr.filletFace->surface;
    check(s->kind == SurfaceKind::Torus, "blend surface kind == Torus");
    check(std::fabs(s->r2 - R) <= 1e-12, "torus tube (minor) radius r2 == R");
    check(std::fabs(s->r1 - (Rc - R)) <= 1e-12, "torus ring (major) radius r1 == Rc - R");
    check(std::fabs(fr.tubeRadius - R) <= 1e-12, "reported tubeRadius == R");
    check(std::fabs(fr.ringRadius - (Rc - R)) <= 1e-12, "reported ringRadius == Rc - R");
    std::printf("      -> torus: tube r2 = %.15f   ring r1 = %.15f   spine centre = (%.3f,%.3f,%.3f)\n",
                s->r2, s->r1, fr.spineCenter.x, fr.spineCenter.y, fr.spineCenter.z);

    // ---- (3) every blend sample is distance R from the SPINE circle --------
    // The spine circle is radius (Rc-R) at z = H-R; the nearest spine point to a
    // sample at (x,y,z) is the same azimuth on that circle, so the distance is
    //   sqrt( (sqrt(x^2+y^2) - (Rc-R))^2 + (z - (H-R))^2 ).
    const double ringR = Rc - R, zSpine = H - R;
    double maxSpineErr = 0.0;
    for (Face* bf : fr.blendFaces) {
        Surface* ts = bf->surface;
        const double u0 = bf->u0, u1 = bf->u1, v0 = bf->v0, v1 = bf->v1;
        for (int iu = 0; iu <= 4; ++iu) {
            for (int iv = 0; iv <= 4; ++iv) {
                const double u = u0 + (u1 - u0) * (iu / 4.0);
                const double v = v0 + (v1 - v0) * (iv / 4.0);
                Vec3 p = ts->evaluate(u, v);
                const double rho = std::sqrt(p.x * p.x + p.y * p.y);
                const double dr = rho - ringR;
                const double dz = p.z - zSpine;
                const double distSpine = std::sqrt(dr * dr + dz * dz);
                maxSpineErr = std::max(maxSpineErr, std::fabs(distSpine - R));
            }
        }
    }
    std::printf("      -> max |dist(blend sample, spine circle) - R| = %.3e\n", maxSpineErr);
    check(maxSpineErr <= 1e-9, "every blend-surface sample is exactly R from the spine circle (<= 1e-9)");

    // ---- (4) VOLUME == pi Rc^2 H - exact toroidal corner removed -----------
    const double termPappus = 2.0 * kPi * (Rc - R) * (1.0 - kPi / 4.0) * R * R;
    const double termMoment = (kPi / 3.0) * R * R * R;
    const double expectedRemoved = termPappus + termMoment;
    const double cylVol = kPi * Rc * Rc * H;
    const double expectedVol = cylVol - expectedRemoved;
    MassProps mp = massProperties(*fr.solid, /*gaussN=*/8);
    const double volErr = std::fabs(mp.volume - expectedVol);
    std::printf("      -> cylinder vol = %.15f\n", cylVol);
    std::printf("      -> removed: Pappus 2pi(Rc-R)(1-pi/4)R^2 = %.15f  +  (pi/3)R^3 = %.15f\n",
                termPappus, termMoment);
    std::printf("      -> removed total (reported) = %.15f   (derived) = %.15f\n",
                fr.removedVolume, expectedRemoved);
    std::printf("      -> volume = %.15f   expected = %.15f   |err| = %.3e\n",
                mp.volume, expectedVol, volErr);
    std::printf("      -> measured removed = %.15f\n", cylVol - mp.volume);
    check(std::fabs(fr.removedVolume - expectedRemoved) <= 1e-12,
          "reported removedVolume == 2pi(Rc-R)(1-pi/4)R^2 + (pi/3)R^3");
    check(volErr <= 1e-6,
          "filleted volume == pi Rc^2 H - [ 2pi(Rc-R)(1-pi/4)R^2 + (pi/3)R^3 ]  to <= 1e-6");

    // ---- out-of-scope refusals (honest, never a faked solid) ----------------
    {
        TopologyBuilder tb2;
        AnalyticTorusFilletResult e1 = filletCylinderTopEdgeAnalytic(tb2, 5.0, 8.0, 5.0, N);
        check(!e1.ok, "refuses R == Rc (spine radius would vanish) with ok=false");
        TopologyBuilder tb3;
        AnalyticTorusFilletResult e2 = filletCylinderTopEdgeAnalytic(tb3, 5.0, 0.5, 1.0, N);
        check(!e2.ok, "refuses R >= H (wall re-trim would underflow) with ok=false");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
