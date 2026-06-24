// forge/native/brep/draft_analytic_test.cpp
//
// Standalone validation gate for the ANALYTIC FACE DRAFT increment
// (DraftAnalytic.hpp / DraftAnalytic.cpp) — the REAL uniform mold-release taper
// about a NEUTRAL PLANE on the native ANALYTIC B-rep (planar tilted side walls +
// re-trimmed to their new mutual intersections + unchanged caps, assembled into a
// closed solid), the SIBLING of the analytic chamfer/fillet, NOT the mesh-bridge
// vertex-displacement taper in Draft.cpp. Pure C++20, NO external deps, NO OCCT,
// NO WASM, no test framework — a tiny hand-rolled PASS/FAIL harness that exits
// non-zero on any failure (mirrors chamfer_analytic_test.cpp / fillet_analytic_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; it links every test
// against the WHOLE native object set. The single-TU clang line below links only
// the brep objects this gate actually needs):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     .../src/native/brep/DraftAnalytic.cpp \
//     .../src/native/brep/Topology.cpp \
//     .../src/native/brep/Surface.cpp \
//     .../src/native/brep/Curve.cpp \
//     .../src/native/brep/MassProps.cpp \
//     .../src/native/brep/Sew.cpp \
//     .../src/native/brep/Nurbs.cpp \
//     .../src/native/brep/NurbsSurface.cpp \
//     .../test/native/brep/draft_analytic_test.cpp \
//     -o /tmp/draft_analytic_test && /tmp/draft_analytic_test
//
// CLOSED-FORM GATES (asserted below) for box L=10, neutral plane z=0, alpha=5 deg:
//   (1) The result is a CLOSED 2-manifold shell (every edge mated by exactly two
//       opposite-sense coedges; 0 free, 0 non-manifold — via diagnoseShell).
//   (2) The drafted VOLUME == the exact integral of the linearly-shrinking square
//       cross-section  ∫_0^L (L - 2 z tan(alpha))^2 dz  to <= 1e-9 (the square
//       frustum), measured by the analytic divergence-theorem MassProps integrator.
//   (3) Each drafted SIDE face is PLANAR and makes angle alpha with the original
//       VERTICAL wall (and the side faces are exactly the four tilted walls).

#include "forge/native/brep/DraftAnalytic.hpp"
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

// Exact closed form of  ∫_0^L (L - 2 z t)^2 dz  with t = tan(alpha).
//   let f(z) = L - 2 t z ;  f' = -2t ;  ∫ f^2 dz = -f^3 / (6 t)  evaluated 0..L
//   = ( f(0)^3 - f(L)^3 ) / (6 t) = ( L^3 - (L - 2 t L)^3 ) / (6 t).
// (For t -> 0 this -> L^3, the un-drafted box, by l'Hopital — but we draft t>0.)
static double frustumVolumeIntegral(double L, double t) {
    const double f0 = L;
    const double fL = L - 2.0 * t * L;
    return (f0 * f0 * f0 - fL * fL * fL) / (6.0 * t);
}

int main() {
    std::printf("=== forge::native::brep — ANALYTIC FACE DRAFT (neutral-plane taper) gate ===\n");

    const double L = 10.0;
    const double alphaDeg = 5.0;
    const double t = std::tan(alphaDeg * M_PI / 180.0);

    TopologyBuilder tb;
    AnalyticDraftResult dr = draftBoxAnalytic(tb, L, alphaDeg);

    std::printf("[draft] %s\n", dr.reason);
    check(dr.ok, "draft op ok");
    if (!dr.ok) {
        std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
        return 1;
    }

    // ---- (1) closed 2-manifold ---------------------------------------------
    check(tb.isClosedTwoManifold(),
          "topology is a closed 2-manifold (every edge mated, all loops close)");
    std::vector<Face*> faces;
    for (Shell* sh : dr.solid->shells)
        for (Face* f : sh->faces) faces.push_back(f);
    SewDiagnosis dg = diagnoseShell(faces);
    std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  shell %s  chi=%lld genus=%lld\n",
                dg.vertices, dg.edges, dg.faces, dg.freeEdges, dg.nonManifoldEdges,
                dg.closed ? "CLOSED" : "OPEN", dg.eulerCharacteristic, dg.genus);
    check(dg.freeEdges == 0, "0 FREE edges (watertight)");
    check(dg.nonManifoldEdges == 0, "0 non-manifold edges");
    check(dg.closed, "shell CLOSED (watertight)");
    check(dg.faces == 6, "result has 6 faces (2 caps + 4 tilted walls)");

    // ---- (2) volume == ∫_0^L (L - 2 z tan a)^2 dz (square frustum) ----------
    const double expectedVol = frustumVolumeIntegral(L, t);
    // Cross-check against the standard square-frustum formula (h/3)(Ab+At+sqrt(Ab*At)).
    const double Ab = L * L;
    const double At = (L - 2.0 * t * L) * (L - 2.0 * t * L);
    const double frustumFormula = (L / 3.0) * (Ab + At + std::sqrt(Ab * At));
    std::printf("      -> integral form = %.15f   frustum (h/3)(Ab+At+sqrt) = %.15f   |diff| = %.3e\n",
                expectedVol, frustumFormula, std::fabs(expectedVol - frustumFormula));
    check(std::fabs(expectedVol - frustumFormula) <= 1e-9,
          "integral matches the square-frustum closed form (self-consistency)");

    MassProps mp = massProperties(*dr.solid, /*gaussN=*/8);
    const double volErr = std::fabs(mp.volume - expectedVol);
    std::printf("      -> volume = %.15f   expected = %.15f   |err| = %.3e\n",
                mp.volume, expectedVol, volErr);
    std::printf("      -> box L^3 = %.15f ; removed by draft = %.15f\n",
                L * L * L, (L * L * L - mp.volume));
    check(volErr <= 1e-9, "drafted volume == frustum integral to <= 1e-9");

    // ---- (3) each drafted face is PLANAR & at angle alpha with vertical ------
    check(dr.numDrafted == 4, "exactly 4 side faces drafted");
    check(dr.draftedFaces.size() == 4, "4 drafted faces returned");

    double maxAngErr = 0.0;
    double maxPlaneErr = 0.0;
    int planarCount = 0;
    for (std::size_t i = 0; i < dr.draftedFaces.size(); ++i) {
        Face* f = dr.draftedFaces[i];
        if (f && f->surface && f->surface->kind == SurfaceKind::Plane) ++planarCount;
        // angle vs vertical
        const double ang = (i < dr.faceAngleVsVerticalDeg.size())
                               ? dr.faceAngleVsVerticalDeg[i] : -1.0;
        maxAngErr = std::max(maxAngErr, std::fabs(ang - alphaDeg));
        // coplanarity: every loop vertex on the stored plane (origin + axis).
        Surface* s = f ? f->surface : nullptr;
        if (s) {
            Loop* lp = f->outerLoop;
            Coedge* ce = lp->first;
            for (std::size_t k = 0; k < lp->coedgeCount; ++k) {
                Vertex* o = ce->originVertex();
                Vec3 p{o->point.x, o->point.y, o->point.z};
                const double sd = vdot(vsub(p, s->origin), s->axis);
                maxPlaneErr = std::max(maxPlaneErr, std::fabs(sd));
                ce = ce->next;
            }
        }
    }
    std::printf("      -> drafted-face angles vs vertical (deg): ");
    for (double a : dr.faceAngleVsVerticalDeg) std::printf("%.12f ", a);
    std::printf("\n      -> expected alpha = %.12f ; max |angle - alpha| = %.3e ; max coplanarity err = %.3e\n",
                alphaDeg, maxAngErr, maxPlaneErr);
    check(planarCount == 4, "all 4 drafted side faces carry a Plane surface (PLANAR)");
    check(maxPlaneErr <= 1e-12, "all drafted-face vertices coplanar to <= 1e-12 (PLANAR)");
    check(maxAngErr <= 1e-9, "each drafted face makes angle alpha with the vertical wall");

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
