// forge/native/brep/chamfer_analytic_test.cpp
//
// Standalone validation gate for the ANALYTIC FLAT-BEVEL EDGE CHAMFER increment
// (ChamferAnalytic.hpp / ChamferAnalytic.cpp) — the REAL symmetric flat-bevel
// blend on the native ANALYTIC B-rep (planar bevel face + re-trimmed planar faces
// + clipped end pentagons, sewn into a closed solid), the SIBLING of the analytic
// rolling-ball fillet, NOT the mesh-bridge vertex-split chamfer in Chamfer.cpp.
// Pure C++20, NO external deps, NO OCCT, NO WASM, no test framework — a tiny
// hand-rolled PASS/FAIL harness that exits non-zero on any failure (mirrors
// fillet_analytic_test.cpp / sew_test.cpp / k0_topology_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; it links every test
// against the WHOLE native object set, so cross-module symbols like HalfEdgeMesh
// resolve — the illustrative single-TU clang line below mirrors the fillet test's
// header but, like it, needs the full native object set at link time):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/ChamferAnalytic.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Topology.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Surface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Curve.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/MassProps.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Sew.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     <the rest of forge-kernel/src/native/**.cpp> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native/brep/chamfer_analytic_test.cpp \
//     -o /tmp/chamfer_analytic_test && /tmp/chamfer_analytic_test
//
// CLOSED-FORM GATES (asserted below) for box L=10, d=1.5 on the top-front edge:
//   (1) The result is a CLOSED 2-manifold shell (every edge mated by exactly two
//       opposite-sense coedges; 0 free, 0 non-manifold — via diagnoseShell).
//   (2) The chamfered VOLUME == L^3 - (1/2) d^2 L  to <= 1e-9 (the right-triangle
//       prism the flat bevel removes from the square corner over the edge length),
//       measured by the analytic divergence-theorem MassProps integrator.
//   (3) The new bevel SURFACE is a PLANE: all four loop vertices are coplanar to
//       <= 1e-12, its surface kind is Plane, and the bevel meets each face at 45
//       degrees (the symmetric 90-degree-edge chamfer angle).

#include "forge/native/brep/ChamferAnalytic.hpp"
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

int main() {
    std::printf("=== forge::native::brep — ANALYTIC FLAT-BEVEL EDGE CHAMFER gate ===\n");

    const double L = 10.0;
    const double d = 1.5;

    TopologyBuilder tb;
    AnalyticChamferResult cr = chamferBoxEdgeAnalytic(tb, L, d, /*edgeIndex=*/4);

    std::printf("[chamfer] %s\n", cr.reason);
    check(cr.ok, "chamfer op ok");
    if (!cr.ok) {
        std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
        return 1;
    }

    // ---- (1) closed 2-manifold ---------------------------------------------
    check(tb.isClosedTwoManifold(),
          "topology is a closed 2-manifold (every edge mated, all loops close)");
    std::vector<Face*> faces;
    for (Shell* sh : cr.solid->shells)
        for (Face* f : sh->faces) faces.push_back(f);
    SewDiagnosis dg = diagnoseShell(faces);
    std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  shell %s  chi=%lld genus=%lld\n",
                dg.vertices, dg.edges, dg.faces, dg.freeEdges, dg.nonManifoldEdges,
                dg.closed ? "CLOSED" : "OPEN", dg.eulerCharacteristic, dg.genus);
    check(dg.freeEdges == 0, "0 FREE edges (watertight)");
    check(dg.nonManifoldEdges == 0, "0 non-manifold edges");
    check(dg.closed, "shell CLOSED (watertight)");

    // ---- (2) volume == box - (1/2) d^2 L -----------------------------------
    const double expectedRemoved = 0.5 * d * d * L;
    const double expectedVol = L * L * L - expectedRemoved;
    MassProps mp = massProperties(*cr.solid, /*gaussN=*/8);
    const double volErr = std::fabs(mp.volume - expectedVol);
    std::printf("      -> volume = %.15f   expected = %.15f   |err| = %.3e\n",
                mp.volume, expectedVol, volErr);
    std::printf("      -> removed = %.15f   (1/2) d^2 L = %.15f\n",
                (L * L * L - mp.volume), expectedRemoved);
    check(volErr <= 1e-9, "chamfered volume == box - (1/2) d^2 L  to <= 1e-9");

    // ---- (3) the bevel surface is a PLANE at 45 degrees --------------------
    check(cr.bevelFace != nullptr && cr.bevelFace->surface != nullptr,
          "bevel face carries a surface");
    Surface* s = cr.bevelFace->surface;
    check(s->kind == SurfaceKind::Plane, "bevel surface kind == Plane");

    // Every loop vertex must be coplanar with the stored plane (origin + axis) to
    // <= 1e-12: signed distance (p - origin) . axis == 0 for all ring vertices.
    double maxPlaneErr = 0.0;
    Loop* lp = cr.bevelFace->outerLoop;
    Coedge* ce = lp->first;
    int nv = 0;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        Vertex* o = ce->originVertex();
        Vec3 p{o->point.x, o->point.y, o->point.z};
        const double sd = vdot(vsub(p, s->origin), s->axis);
        maxPlaneErr = std::max(maxPlaneErr, std::fabs(sd));
        ++nv;
        ce = ce->next;
    }
    std::printf("      -> bevel loop has %d verts; max |(p - origin).axis| = %.3e\n",
                nv, maxPlaneErr);
    check(maxPlaneErr <= 1e-12, "all bevel-face vertices coplanar to <= 1e-12 (PLANAR)");

    // The bevel meets each adjacent face at 45 degrees (symmetric 90-degree-edge).
    std::printf("      -> chamfer angle vs each face = %.12f deg (expect 45)\n",
                cr.chamferAngleDeg);
    check(std::fabs(cr.chamferAngleDeg - 45.0) <= 1e-9,
          "bevel meets each face at 45 degrees (symmetric chamfer)");

    // Spot-check the two setback contacts lie on their faces' planes:
    //   tangentA on face A plane (z = L), tangentB on face B plane (y = 0).
    check(std::fabs(cr.tangentA.z - L) <= 1e-12, "setback A lies on face A plane (z = L)");
    check(std::fabs(cr.tangentB.y - 0.0) <= 1e-12, "setback B lies on face B plane (y = 0)");
    check(std::fabs(cr.dihedralDeg - 90.0) <= 1e-9, "interior dihedral = 90 degrees");

    // =======================================================================
    // ASYMMETRIC TWO-DISTANCE CHAMFER GATE
    // box L=10, dA=1.5 (on face A, z=L), dB=2.5 (on face B, y=0), top-front edge.
    //   (1) closed 2-manifold;
    //   (2) volume == L^3 - (1/2) dA dB L = 1000 - 0.5*1.5*2.5*10 = 981.25 to <=1e-9
    //       (the right-triangle prism with legs dA, dB the tilted bevel removes);
    //   (3) the bevel surface is a PLANE (a single tilted plane, NOT the bisector),
    //       meeting face A at atan(dB/dA) and face B at atan(dA/dB).
    // =======================================================================
    std::printf("\n=== ASYMMETRIC TWO-DISTANCE CHAMFER gate (dA=1.5, dB=2.5) ===\n");
    const double dA = 1.5;
    const double dB = 2.5;

    TopologyBuilder tb2;
    AnalyticChamferResult ar = chamferBoxEdgeAsymmetric(tb2, L, dA, dB, /*edgeIndex=*/4);
    std::printf("[chamfer] %s\n", ar.reason);
    check(ar.ok, "asymmetric chamfer op ok");

    if (ar.ok) {
        // ---- (1) closed 2-manifold -----------------------------------------
        check(tb2.isClosedTwoManifold(),
              "asymmetric topology is a closed 2-manifold");
        std::vector<Face*> faces2;
        for (Shell* sh : ar.solid->shells)
            for (Face* f : sh->faces) faces2.push_back(f);
        SewDiagnosis dg2 = diagnoseShell(faces2);
        std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  shell %s  chi=%lld genus=%lld\n",
                    dg2.vertices, dg2.edges, dg2.faces, dg2.freeEdges, dg2.nonManifoldEdges,
                    dg2.closed ? "CLOSED" : "OPEN", dg2.eulerCharacteristic, dg2.genus);
        check(dg2.freeEdges == 0, "asym: 0 FREE edges (watertight)");
        check(dg2.nonManifoldEdges == 0, "asym: 0 non-manifold edges");
        check(dg2.closed, "asym: shell CLOSED (watertight)");

        // ---- (2) volume == box - (1/2) dA dB L -----------------------------
        const double expRemovedA = 0.5 * dA * dB * L;
        const double expVolA = L * L * L - expRemovedA;
        MassProps mp2 = massProperties(*ar.solid, /*gaussN=*/8);
        const double volErrA = std::fabs(mp2.volume - expVolA);
        std::printf("      -> volume = %.15f   expected = %.15f   |err| = %.3e\n",
                    mp2.volume, expVolA, volErrA);
        std::printf("      -> removed = %.15f   (1/2) dA dB L = %.15f\n",
                    (L * L * L - mp2.volume), expRemovedA);
        check(volErrA <= 1e-9, "asym chamfered volume == box - (1/2) dA dB L to <= 1e-9");

        // ---- (3) bevel surface is a single tilted PLANE --------------------
        check(ar.bevelFace != nullptr && ar.bevelFace->surface != nullptr,
              "asym bevel face carries a surface");
        Surface* s2 = ar.bevelFace->surface;
        check(s2->kind == SurfaceKind::Plane, "asym bevel surface kind == Plane");

        double maxPlaneErrA = 0.0;
        Loop* lp2 = ar.bevelFace->outerLoop;
        Coedge* ce2 = lp2->first;
        for (std::size_t i = 0; i < lp2->coedgeCount; ++i) {
            Vertex* o = ce2->originVertex();
            Vec3 p{o->point.x, o->point.y, o->point.z};
            const double sd = vdot(vsub(p, s2->origin), s2->axis);
            maxPlaneErrA = std::max(maxPlaneErrA, std::fabs(sd));
            ce2 = ce2->next;
        }
        std::printf("      -> asym bevel max |(p - origin).axis| = %.3e\n", maxPlaneErrA);
        check(maxPlaneErrA <= 1e-12, "asym: all bevel-face vertices coplanar to <= 1e-12 (single tilted PLANE)");

        // The bevel meets face A at atan(dB/dA) and face B at atan(dA/dB).
        const double expAngA = std::atan2(dB, dA) * 180.0 / M_PI;  // ~59.0362435 deg
        const double expAngB = std::atan2(dA, dB) * 180.0 / M_PI;  // ~30.9637565 deg
        std::printf("      -> bevel angle vs face A = %.12f deg (expect atan(dB/dA) = %.12f)\n",
                    ar.chamferAngleADeg, expAngA);
        std::printf("      -> bevel angle vs face B = %.12f deg (expect atan(dA/dB) = %.12f)\n",
                    ar.chamferAngleBDeg, expAngB);
        check(std::fabs(ar.chamferAngleADeg - expAngA) <= 1e-9,
              "asym bevel meets face A at atan(dB/dA)");
        check(std::fabs(ar.chamferAngleBDeg - expAngB) <= 1e-9,
              "asym bevel meets face B at atan(dA/dB)");
        check(std::fabs((ar.chamferAngleADeg + ar.chamferAngleBDeg) - 90.0) <= 1e-9,
              "asym bevel angles sum to 90 (right-triangle cross-section)");
        check(ar.chamferAngleADeg > 45.0 + 1e-6 && ar.chamferAngleBDeg < 45.0 - 1e-6,
              "asym bevel is TILTED off the 45-degree bisector (dB > dA)");

        // Setback contacts lie on their faces' planes (A on z=L, B on y=0).
        check(std::fabs(ar.tangentA.z - L) <= 1e-12, "asym setback A on face A plane (z = L)");
        check(std::fabs(ar.tangentB.y - 0.0) <= 1e-12, "asym setback B on face B plane (y = 0)");
        check(std::fabs(ar.setbackA - dA) <= 1e-12 && std::fabs(ar.setbackB - dB) <= 1e-12,
              "asym setbacks reported as (dA, dB)");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
