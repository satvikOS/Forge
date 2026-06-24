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
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native/brep/fillet_analytic_test.cpp \
//     -o /tmp/fillet_analytic_test && /tmp/fillet_analytic_test
//
// CLOSED-FORM GATES (asserted below):
//   CONVEX (box L=10, R=1.5, top-front edge) — material REMOVED:
//     (1) CLOSED 2-manifold (0 free, 0 non-manifold via diagnoseShell).
//     (2) VOLUME == L^3 - (1 - pi/4)*R^2*L  to <= 1e-9 (quarter-round removed).
//     (3) fillet SURFACE is a CYLINDER of radius R (samples exactly R from axis).
//   CONCAVE (an L-prism's single reflex edge, R=1.5) — material ADDED:
//     (4) CLOSED 2-manifold; VOLUME == V_Lblock + (1 - pi/4)*R^2*L_edge to <= 1e-6
//         (the rolling ball sits OUTSIDE the corner and ADDS the quarter-round).
//   EDGE-CHAIN (box, two requested edges, R=1.5):
//     (5) a DISJOINT 2-edge set both fillet -> CLOSED 2-manifold, VOLUME ==
//         L^3 - sum (1-pi/4)R^2 L_i to <= 1e-6 (multi-edge filleting in one call).
//     (6) a CONNECTED 2-edge top chain: both edges filleted (two cylinder patches),
//         and the SHARED VERTEX is HONESTLY reported in unblendedCorners (the
//         spherical/setback vertex blend is a documented follow-up — NOT fabricated).

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

    // ========================================================================
    // (4) CONCAVE (reflex) fillet of an L-prism's inner edge — material ADDED.
    // ========================================================================
    std::printf("\n--- CONCAVE reflex edge (L-prism inner edge) ---\n");
    {
        const double W = 10.0, D = 10.0, t = 4.0, h = 3.0, Lz = 6.0, Rc = 1.5;
        TopologyBuilder tbc;
        AnalyticFilletResult cc = filletLBlockEdgeAnalytic(tbc, W, D, t, h, Lz, Rc);
        std::printf("[concave] %s\n", cc.reason);
        check(cc.ok, "concave fillet op ok");
        if (cc.ok) {
            std::vector<Face*> cfaces;
            for (Shell* sh : cc.solid->shells)
                for (Face* f : sh->faces) cfaces.push_back(f);
            SewDiagnosis cd = diagnoseShell(cfaces);
            std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  %s  chi=%lld genus=%lld\n",
                        cd.vertices, cd.edges, cd.faces, cd.freeEdges, cd.nonManifoldEdges,
                        cd.closed ? "CLOSED" : "OPEN", cd.eulerCharacteristic, cd.genus);
            check(cd.freeEdges == 0, "concave: 0 FREE edges (watertight)");
            check(cd.nonManifoldEdges == 0, "concave: 0 non-manifold edges");
            check(cd.closed, "concave: shell CLOSED (watertight)");

            // base L-block volume + the ADDED quarter-round (1 - pi/4) R^2 L_edge.
            const double baseArea = W * D - (W - t) * (D - h);   // full rect minus notch
            const double baseVol = baseArea * Lz;
            const double added = (1.0 - kPi / 4.0) * Rc * Rc * Lz;
            const double expectedC = baseVol + added;
            MassProps mpc = massProperties(*cc.solid, /*gaussN=*/8);
            const double cErr = std::fabs(mpc.volume - expectedC);
            std::printf("      -> base L-block = %.12f   ADDED (1-pi/4)R^2 L = %.12f\n", baseVol, added);
            std::printf("      -> volume = %.12f   expected = %.12f   |err| = %.3e\n",
                        mpc.volume, expectedC, cErr);
            check(mpc.volume > baseVol, "concave: material was ADDED (volume > base L-block)");
            check(cErr <= 1e-6, "concave volume == base + (1 - pi/4) R^2 L_edge  to <= 1e-6");
            check(cc.filletFace && cc.filletFace->surface &&
                  cc.filletFace->surface->kind == SurfaceKind::Cylinder,
                  "concave fillet surface kind == Cylinder");
            check(std::fabs(cc.dihedralDeg - 270.0) <= 1e-9, "concave interior dihedral = 270 degrees (reflex)");
        }
    }

    // ========================================================================
    // (5) EDGE-CHAIN: a DISJOINT 2-edge set both filleted in ONE call.
    // ========================================================================
    std::printf("\n--- EDGE-CHAIN: disjoint 2-edge set {4,6} ---\n");
    {
        TopologyBuilder tbd;
        AnalyticChainFilletResult ch = filletBoxEdgeChainAnalytic(tbd, L, R, {4, 6});
        std::printf("[chain-disjoint] %s\n", ch.reason);
        check(ch.ok, "disjoint chain op ok (closed)");
        check(ch.filletedEdgeCount == 2, "disjoint chain: both edges filleted");
        check(ch.unblendedCorners.empty(), "disjoint chain: no shared-vertex corners");
        if (ch.ok) {
            std::vector<Face*> dfaces;
            for (Shell* sh : ch.solid->shells)
                for (Face* f : sh->faces) dfaces.push_back(f);
            SewDiagnosis dd = diagnoseShell(dfaces);
            std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  %s\n",
                        dd.vertices, dd.edges, dd.faces, dd.freeEdges, dd.nonManifoldEdges,
                        dd.closed ? "CLOSED" : "OPEN");
            check(dd.freeEdges == 0 && dd.nonManifoldEdges == 0 && dd.closed,
                  "disjoint chain: CLOSED 2-manifold (watertight)");
            // each edge removes (1 - pi/4) R^2 L; both full-length edges -> 2x.
            const double expectedRem = 2.0 * (1.0 - kPi / 4.0) * R * R * L;
            const double expectedVol = L * L * L - expectedRem;
            MassProps mpd = massProperties(*ch.solid, /*gaussN=*/8);
            const double dErr = std::fabs(mpd.volume - expectedVol);
            std::printf("      -> removedReported = %.12f   expected = %.12f\n",
                        ch.removedVolume, expectedRem);
            std::printf("      -> volume = %.12f   expected = %.12f   |err| = %.3e\n",
                        mpd.volume, expectedVol, dErr);
            check(dErr <= 1e-6, "disjoint chain volume == box - sum (1-pi/4) R^2 L_i  to <= 1e-6");
        }
    }

    // ========================================================================
    // (6) EDGE-CHAIN: a CONNECTED 2-edge top chain {4,5} sharing corner v5 —
    //     both edges filleted, shared vertex reported HONESTLY (not fabricated).
    // ========================================================================
    std::printf("\n--- EDGE-CHAIN: connected top chain {4,5} (shared vertex v5) ---\n");
    {
        TopologyBuilder tbk;
        AnalyticChainFilletResult ch = filletBoxEdgeChainAnalytic(tbk, L, R, {4, 5});
        std::printf("[chain-connected] %s\n", ch.reason);
        check(ch.filletedEdgeCount == 2, "connected chain: BOTH edges filleted");
        check(ch.filletFaces.size() == 2, "connected chain: two cylindrical fillet patches built");
        check(ch.unblendedCorners.size() == 1, "connected chain: exactly one shared vertex reported");
        if (ch.unblendedCorners.size() == 1) {
            const UnblendedCorner& uc = ch.unblendedCorners[0];
            std::printf("      -> unblended corner v%d at (%.2f,%.2f,%.2f), edges %d & %d, count %d\n",
                        uc.cornerIndex, uc.position.x, uc.position.y, uc.position.z,
                        uc.edgeA, uc.edgeB, uc.meetingFilletCount);
            // edges 4 and 5 share box corner v5 = (L, 0, L).
            const bool atV5 = std::fabs(uc.position.x - L) <= 1e-9 &&
                              std::fabs(uc.position.y - 0.0) <= 1e-9 &&
                              std::fabs(uc.position.z - L) <= 1e-9;
            check(atV5, "connected chain: shared vertex is v5 = (L,0,L)");
            const bool edgesOK = (uc.edgeA == 4 && uc.edgeB == 5) || (uc.edgeA == 5 && uc.edgeB == 4);
            check(edgesOK, "connected chain: reported meeting edges are {4,5}");
            check(uc.meetingFilletCount == 2, "connected chain: two fillets meet at the corner");
        }
        // Honest scope: ok is false BECAUSE the shared-vertex blend is not fabricated.
        check(!ch.ok, "connected chain: honestly NOT closed (vertex blend is a documented follow-up)");
    }

    // ========================================================================
    // (7) VARIABLE-RADIUS fillet — LINEAR law R(t)=R0+(R1-R0)t/L on a convex
    //     straight box edge (L=10, R0=1, R1=2). Blend is an EXACT rational NURBS
    //     sweep of the varying quarter-arc; material REMOVED.
    // ========================================================================
    std::printf("\n--- VARIABLE-RADIUS fillet (linear law, box top edge, R0=1 R1=2) ---\n");
    {
        const double Lv = 10.0, R0 = 1.0, R1 = 2.0;
        TopologyBuilder tbv;
        AnalyticVariableFilletResult vf = filletBoxEdgeVariable(tbv, Lv, R0, R1, /*edgeIndex=*/4);
        std::printf("[variable] %s\n", vf.reason);
        check(vf.ok, "variable fillet op ok");
        if (vf.ok) {
            // (7a) closed 2-manifold
            std::vector<Face*> vfaces;
            for (Shell* sh : vf.solid->shells)
                for (Face* f : sh->faces) vfaces.push_back(f);
            SewDiagnosis vd = diagnoseShell(vfaces);
            std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  nonmanifold=%zu  %s  chi=%lld genus=%lld\n",
                        vd.vertices, vd.edges, vd.faces, vd.freeEdges, vd.nonManifoldEdges,
                        vd.closed ? "CLOSED" : "OPEN", vd.eulerCharacteristic, vd.genus);
            check(vd.freeEdges == 0, "variable: 0 FREE edges (watertight)");
            check(vd.nonManifoldEdges == 0, "variable: 0 non-manifold edges");
            check(vd.closed, "variable: shell CLOSED (watertight)");

            // (7b) volume == box - (1 - pi/4) * L * (R0^2 + R0*R1 + R1^2)/3.
            const double removedClosed =
                (1.0 - kPi / 4.0) * Lv * (R0 * R0 + R0 * R1 + R1 * R1) / 3.0;
            const double expectedVol = Lv * Lv * Lv - removedClosed;
            // Higher Gauss order for the (non-polynomial) rational-NURBS metric.
            MassProps mpv = massProperties(*vf.solid, /*gaussN=*/10);
            const double vErr = std::fabs(mpv.volume - expectedVol);
            std::printf("      -> removed-integral (1-pi/4)*L*(R0^2+R0R1+R1^2)/3 = %.15f\n", removedClosed);
            std::printf("      -> volume  = %.15f   expected = %.15f   |err| = %.3e\n",
                        mpv.volume, expectedVol, vErr);
            std::printf("      -> measured removed = %.15f   reported removed = %.15f\n",
                        (Lv * Lv * Lv - mpv.volume), vf.removedVolume);
            check(std::fabs(vf.removedVolume - removedClosed) <= 1e-12,
                  "variable: reported removed == closed-form removed-integral");
            check(vErr <= 1e-6,
                  "variable: filleted volume == box - (1-pi/4)L(R0^2+R0R1+R1^2)/3  to <= 1e-6");

            // (7c) the blend surface is the EXACT variable-radius NURBS sweep: sample
            // it and confirm each point lies distance R(t) from the SPINE at that t.
            check(vf.filletFace != nullptr && vf.filletFace->surface != nullptr,
                  "variable: blend face carries a surface");
            Surface* bs = vf.filletFace->surface;
            check(bs->kind == SurfaceKind::Nurbs,
                  "variable: blend surface kind == Nurbs (exact rational sweep)");
            // The spine runs from axisStart (t=0) to axisEnd (t=L); at NURBS V-param
            // v the station is t = v*L, and R(t) = R0 + (R1-R0)*v. Sample the (u,v)
            // domain and check |point - spine(v)| == R(v) for every sample.
            const Vec3 sp0 = vf.axisStart, sp1 = vf.axisEnd;
            double maxRadErr = 0.0;
            for (int iu = 0; iu <= 8; ++iu) {
                for (int iv = 0; iv <= 8; ++iv) {
                    const double u = iu / 8.0;       // arc param (NURBS domain)
                    const double v = iv / 8.0;       // edge param (NURBS domain)
                    Vec3 p = bs->evaluate(u, v);
                    // spine point at this v (linear between the two axis feet):
                    Vec3 spineP = vadd(vscale(sp0, 1.0 - v), vscale(sp1, v));
                    const double Rt = R0 + (R1 - R0) * v;
                    const double dd = dist(p, spineP);
                    maxRadErr = std::max(maxRadErr, std::fabs(dd - Rt));
                }
            }
            std::printf("      -> max |dist(sample, spine(t)) - R(t)| over 9x9 grid = %.3e\n", maxRadErr);
            check(maxRadErr <= 1e-9,
                  "variable: every blend sample is exactly R(t) from the spine (<= 1e-9)");
            check(std::fabs(vf.dihedralDeg - 90.0) <= 1e-9, "variable: interior dihedral = 90 degrees");
        }
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
