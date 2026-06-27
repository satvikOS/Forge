// forge/native/brep/native_fillet_solid_test.cpp
//
// Standalone validation gate for filletSolidStraightEdgeAnalytic — the
// TOPOLOGY-SOURCED analytic rolling-ball edge fillet (FilletAnalytic.hpp), the
// OCCT-zero keystone that replaces the hanging OCCT BRepFilletAPI path in
// forge::part::filletEdges for native solids. Unlike filletBoxEdgeAnalytic
// (box-hardcoded), this resolves the edge + its adjacent / perpendicular faces
// by WALKING the real B-rep topology of an arbitrary native Solid, so it runs
// on imported / boolean / extrude solids. Pure C++20, NO external deps, NO OCCT,
// NO WASM, no test framework — a tiny PASS/FAIL harness (mirrors
// fillet_analytic_test.cpp); exits non-zero on any failure.
//
// GATES (asserted below):
//   (1) enumerateSolidStraightEdges(box) returns the 12 box edges, deterministically.
//   (2) fillet of one convex straight edge -> ok; CLOSED 2-manifold (diagnoseShell
//       free==0, nonmanifold==0, closed) AND checkBRep().valid == true.
//   (3) the new blend face is a SurfaceKind::Cylinder of radius R; every sample on
//       its trim is exactly R from the cylinder axis.
//   (4) VOLUME == boxVol - (1 - pi/4) R^2 * edgeLen  (the analytic quarter-round
//       corner removal), to <= 1e-6.
//   (5) MULTI-EDGE robustness: filleting EACH of the 12 enumerated edges (on a
//       non-cube PLATE, so the edge length is read from the topology, not assumed)
//       yields a valid closed 2-manifold with the per-edge volume removal exact.

#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Primitives.hpp"   // SolidFactory (planar-faced box)
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Check.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
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
static SewDiagnosis diagOf(const Solid* s) {
    std::vector<Face*> faces;
    for (Shell* sh : s->shells) for (Face* f : sh->faces) faces.push_back(f);
    return diagnoseShell(faces);
}

int main() {
    std::printf("=== forge::native::brep — TOPOLOGY-SOURCED analytic edge fillet gate ===\n");
    constexpr double kPi = 3.14159265358979323846;
    const double R = 1.5;

    // ---- (1) enumeration on a 10x10x10 native box --------------------------
    SolidFactory fac;
    Solid* box = fac.buildBox(10.0, 10.0, 10.0);
    std::vector<Edge*> edges = enumerateSolidStraightEdges(*box);
    std::printf("[enum] %zu edges enumerated on the box\n", edges.size());
    check(edges.size() == 12, "enumerateSolidStraightEdges(box) == 12 edges");

    MassProps mpBox = massProperties(*box, 8);
    std::printf("[box] volume = %.12f (expect 1000)\n", mpBox.volume);
    check(std::fabs(mpBox.volume - 1000.0) <= 1e-6, "box volume == 1000");

    // ---- (2)+(3)+(4) fillet one convex straight edge (edgeId 0) -------------
    {
        TopologyBuilder tb;
        AnalyticFilletResult fr = filletSolidStraightEdgeAnalytic(tb, *box, /*edgeId=*/0, R);
        std::printf("[fillet#0] %s\n", fr.reason);
        check(fr.ok, "fillet op ok (edgeId 0)");
        if (fr.ok) {
            SewDiagnosis d = diagOf(fr.solid);
            std::printf("      -> V=%zu E=%zu F=%zu free=%zu nonmanifold=%zu %s chi=%lld genus=%lld\n",
                        d.vertices, d.edges, d.faces, d.freeEdges, d.nonManifoldEdges,
                        d.closed ? "CLOSED" : "OPEN", d.eulerCharacteristic, d.genus);
            check(d.freeEdges == 0, "0 FREE edges (watertight)");
            check(d.nonManifoldEdges == 0, "0 non-manifold edges");
            check(d.closed, "shell CLOSED (watertight)");

            CheckReport rep = checkBRep(fr.solid);
            std::printf("      -> checkBRep: %zu/%zu predicates passed, valid=%s\n",
                        rep.passed(), rep.total(), rep.valid ? "true" : "false");
            if (!rep.valid)
                for (const auto& p : rep.predicates)
                    if (!p.passed) std::printf("         FAIL predicate: %s (%s)\n",
                                               p.name.c_str(), p.detail.c_str());
            check(rep.valid, "checkBRep().valid == true (full predicate battery)");

            // blend surface is a cylinder of radius R
            check(fr.filletFace && fr.filletFace->surface &&
                  fr.filletFace->surface->kind == SurfaceKind::Cylinder,
                  "blend face surface kind == Cylinder");
            Surface* s = fr.filletFace->surface;
            check(s && std::fabs(s->r1 - R) <= 1e-12, "blend cylinder stored radius r1 == R");
            if (s) {
                double maxAxisErr = 0.0;
                const Vec3 axO = s->origin, axD = s->axis;
                const double u0 = fr.filletFace->u0, u1 = fr.filletFace->u1;
                const double v0 = fr.filletFace->v0, v1 = fr.filletFace->v1;
                for (int iu = 0; iu <= 8; ++iu)
                    for (int iv = 0; iv <= 8; ++iv) {
                        Vec3 p = s->evaluate(u0 + (u1 - u0) * iu / 8.0, v0 + (v1 - v0) * iv / 8.0);
                        Vec3 w = vsub(p, axO);
                        Vec3 foot = vadd(axO, vscale(axD, vdot(w, axD)));
                        maxAxisErr = std::max(maxAxisErr, std::fabs(dist(p, foot) - R));
                    }
                std::printf("      -> max |dist(blend sample, axis) - R| = %.3e\n", maxAxisErr);
                check(maxAxisErr <= 1e-9, "every blend sample is exactly R from the axis");
            }

            // volume == box - (1 - pi/4) R^2 * edgeLen
            const double removed = (1.0 - kPi / 4.0) * R * R * fr.edgeLength;
            const double expectedVol = 1000.0 - removed;
            MassProps mp = massProperties(*fr.solid, 8);
            const double err = std::fabs(mp.volume - expectedVol);
            std::printf("      -> edgeLen=%.6f removed=(1-pi/4)R^2L=%.12f\n", fr.edgeLength, removed);
            std::printf("      -> volume=%.12f expected=%.12f |err|=%.3e\n", mp.volume, expectedVol, err);
            check(mp.volume < 1000.0, "material REMOVED (volume < box)");
            check(err <= 1e-6, "filleted volume == box - (1 - pi/4) R^2 L  to <= 1e-6");
            check(std::fabs(fr.dihedralDeg - 90.0) <= 1e-9, "interior dihedral == 90 degrees");
        }
    }

    // ---- (5) MULTI-EDGE: fillet EACH of the 12 edges of a non-cube PLATE ----
    // Plate 12 x 8 x 20 (distinct extents) so the per-edge length is genuinely
    // read from the topology (12 / 8 / 20 depending on orientation).
    std::printf("\n--- MULTI-EDGE: fillet each of the 12 plate edges (12x8x20) ---\n");
    {
        const double DX = 12.0, DY = 8.0, DZ = 20.0;
        const double Rm = 1.0;       // < min extent (8)
        const double plateVol = DX * DY * DZ;
        SolidFactory facP;
        Solid* plate = facP.buildBox(DX, DY, DZ);
        std::vector<Edge*> pe = enumerateSolidStraightEdges(*plate);
        check(pe.size() == 12, "plate enumerates 12 edges");
        int okCount = 0, validCount = 0, volCount = 0;
        for (std::uint32_t id = 0; id < pe.size(); ++id) {
            TopologyBuilder tb;
            AnalyticFilletResult fr = filletSolidStraightEdgeAnalytic(tb, *plate, id, Rm);
            if (!fr.ok) { std::printf("   edge %u: NOT ok (%s)\n", id, fr.reason); continue; }
            ++okCount;
            SewDiagnosis d = diagOf(fr.solid);
            CheckReport rep = checkBRep(fr.solid);
            const double removed = (1.0 - kPi / 4.0) * Rm * Rm * fr.edgeLength;
            MassProps mp = massProperties(*fr.solid, 8);
            const double err = std::fabs(mp.volume - (plateVol - removed));
            if (d.closed && d.freeEdges == 0 && d.nonManifoldEdges == 0) ++validCount;
            if (rep.valid && err <= 1e-6) ++volCount;
            std::printf("   edge %2u: len=%5.2f %s checkBRep=%s |volErr|=%.2e\n",
                        id, fr.edgeLength, d.closed ? "CLOSED" : "OPEN",
                        rep.valid ? "valid" : "INVALID", err);
        }
        check(okCount == 12, "all 12 plate edges fillet (ok)");
        check(validCount == 12, "all 12 results are watertight closed 2-manifolds");
        check(volCount == 12, "all 12 results pass checkBRep AND have exact volume removal");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
