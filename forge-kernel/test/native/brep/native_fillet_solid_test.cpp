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
//   (6) MULTI-EDGE in ONE call (filletSolidStraightEdgesAnalytic): a greedy pairwise
//       vertex-disjoint subset of the plate -> watertight closed 2-manifold, every
//       blend is a Cylinder, NO unblended corners, volume == plate - SUM removals.
//   (7) MULTI-EDGE realistic part: the four vertical edges of a post (rounded
//       rectangle) -> watertight + checkBRep valid + exact 4-quarter-round removal
//       (the top/bottom caps are NON-convex and MUST be triangulated to stay exact).
//   (8) SHARED-VERTEX KEYSTONE: all 12 box edges in one call share every corner (3
//       fillets meet) -> each is closed by a NATIVE SPHERICAL OCTANT (SurfaceKind::
//       Sphere, radius R, set-back cylinders), so the whole all-12 fillet is ONE
//       watertight closed 2-manifold (genus 0, 8 sphere corner faces, no unblended
//       corners, checkBRep 21/21) with the exact box - 12 prisms - 8 corner volume.
//   (8b) HONEST BOUNDARY: a 2-edge shared corner is NOT the supported orthogonal
//       trihedral corner, so the op REFUSES (ok=false), emits NO solid, and reports
//       it in unblendedCorners; part.filletEdges then falls back to the mesh-bridge.
//   (9) CONSISTENCY: the multi-edge path on a SINGLE edge reproduces the single-edge
//       path's exact volume + a valid checkBRep.

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
#include <unordered_set>
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

    // ---- (6) MULTI-EDGE in ONE call: greedy vertex-disjoint set ----------------
    // The topology-sourced filletSolidStraightEdgesAnalytic fillets a SET of edges in
    // a single watertight result. A greedy pairwise vertex-disjoint subset of a
    // 12x8x20 plate (faces SHARED between filleted edges, but no shared vertices) is
    // the core multi-edge case: every shared face must be re-trimmed for BOTH its
    // edges at once and the result stays a watertight closed 2-manifold with the
    // exact summed quarter-round removal.
    std::printf("\n--- MULTI-EDGE (one call): greedy vertex-disjoint subset of a 12x8x20 plate ---\n");
    {
        const double DX = 12.0, DY = 8.0, DZ = 20.0, Rm = 1.0;
        const double plateVol = DX * DY * DZ;
        SolidFactory facM;
        Solid* plate = facM.buildBox(DX, DY, DZ);
        std::vector<Edge*> pe = enumerateSolidStraightEdges(*plate);
        std::vector<std::uint32_t> sel;
        std::unordered_set<Vertex*> used;
        for (std::uint32_t i = 0; i < pe.size(); ++i) {
            Vertex* a = pe[i]->start; Vertex* b = pe[i]->end;
            if (used.count(a) || used.count(b)) continue;
            sel.push_back(i); used.insert(a); used.insert(b);
        }
        std::printf("[multi] greedy selected %zu of 12 pairwise vertex-disjoint edges\n", sel.size());
        check(sel.size() >= 3, "greedy vertex-disjoint subset has >= 3 edges");
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletSolidStraightEdgesAnalytic(tb, *plate, sel, Rm);
        std::printf("[multi] %s\n", ch.reason);
        check(ch.ok, "multi-edge fillet ok (vertex-disjoint set, single call)");
        if (ch.ok) {
            SewDiagnosis d = diagOf(ch.solid);
            std::printf("      -> V=%zu E=%zu F=%zu free=%zu nonmanifold=%zu %s\n",
                        d.vertices, d.edges, d.faces, d.freeEdges, d.nonManifoldEdges,
                        d.closed ? "CLOSED" : "OPEN");
            check(d.freeEdges == 0 && d.nonManifoldEdges == 0 && d.closed,
                  "multi-edge result is a watertight closed 2-manifold");
            CheckReport rep = checkBRep(ch.solid);
            std::printf("      -> checkBRep: %zu/%zu passed, valid=%s\n",
                        rep.passed(), rep.total(), rep.valid ? "true" : "false");
            if (!rep.valid)
                for (const auto& p : rep.predicates)
                    if (!p.passed) std::printf("         FAIL predicate: %s (%s)\n",
                                               p.name.c_str(), p.detail.c_str());
            check(rep.valid, "multi-edge checkBRep().valid == true");
            bool allCyl = (ch.filletFaces.size() == sel.size());
            for (Face* f : ch.filletFaces)
                if (!f || !f->surface || f->surface->kind != SurfaceKind::Cylinder) allCyl = false;
            check(allCyl, "every blend face is a Cylinder (one per selected edge)");
            check(ch.unblendedCorners.empty(), "no unblended corners (vertex-disjoint set)");
            MassProps mp = massProperties(*ch.solid, 8);
            const double expected = plateVol - ch.removedVolume;
            const double err = std::fabs(mp.volume - expected);
            std::printf("      -> removed=%.12f volume=%.12f expected=%.12f |err|=%.3e\n",
                        ch.removedVolume, mp.volume, expected, err);
            check(err <= 1e-6, "multi-edge volume == plate - SUM (1-pi/4)R^2 L  to <= 1e-6");
        }
    }

    // ---- (7) MULTI-EDGE: round the FOUR VERTICAL edges of a post ---------------
    // The realistic "rounded-rectangle post" selection: the four vertical edges are
    // pairwise vertex-disjoint, the four side faces are each shared by two of them
    // (tangent re-trim), and the top + bottom caps become NON-CONVEX rounded
    // rectangles that MUST be ear-clipped into convex triangles to keep the exact
    // polygon-moment mass integral exact.
    std::printf("\n--- MULTI-EDGE: the four vertical edges of a 12x8x20 post (rounded rectangle) ---\n");
    {
        const double DX = 12.0, DY = 8.0, DZ = 20.0, Rm = 1.5;
        const double postVol = DX * DY * DZ;
        SolidFactory facV;
        Solid* post = facV.buildBox(DX, DY, DZ);
        std::vector<Edge*> pe = enumerateSolidStraightEdges(*post);
        std::vector<std::uint32_t> vert;
        for (std::uint32_t i = 0; i < pe.size(); ++i) {
            const double dx = pe[i]->end->point.x - pe[i]->start->point.x;
            const double dy = pe[i]->end->point.y - pe[i]->start->point.y;
            const double dz = pe[i]->end->point.z - pe[i]->start->point.z;
            const double L = std::sqrt(dx * dx + dy * dy + dz * dz);
            if (L > 0.0 && std::fabs(dz) / L > 0.999) vert.push_back(i);
        }
        check(vert.size() == 4, "post has 4 vertical edges (|dz| == length)");
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletSolidStraightEdgesAnalytic(tb, *post, vert, Rm);
        std::printf("[post] %s\n", ch.reason);
        check(ch.ok, "4-vertical-edge fillet ok");
        if (ch.ok) {
            SewDiagnosis d = diagOf(ch.solid);
            CheckReport rep = checkBRep(ch.solid);
            std::printf("      -> %s checkBRep=%s free=%zu nonmanifold=%zu\n",
                        d.closed ? "CLOSED" : "OPEN", rep.valid ? "valid" : "INVALID",
                        d.freeEdges, d.nonManifoldEdges);
            check(d.closed && d.freeEdges == 0 && d.nonManifoldEdges == 0 && rep.valid,
                  "rounded-post result watertight closed 2-manifold + checkBRep valid");
            const double expRemoved = 4.0 * (1.0 - kPi / 4.0) * Rm * Rm * DZ;
            std::printf("      -> removedVolume=%.12f expect 4*(1-pi/4)R^2*DZ=%.12f\n",
                        ch.removedVolume, expRemoved);
            check(std::fabs(ch.removedVolume - expRemoved) <= 1e-9,
                  "removedVolume == 4 vertical quarter-round prisms");
            MassProps mp = massProperties(*ch.solid, 8);
            const double err = std::fabs(mp.volume - (postVol - expRemoved));
            std::printf("      -> volume=%.12f expected=%.12f |err|=%.3e\n",
                        mp.volume, postVol - expRemoved, err);
            check(err <= 1e-6, "rounded-post volume == post - 4 quarter-round prisms  to <= 1e-6");
        }
    }

    // ---- (7b) MIXED face roles: a face that is ADJACENT to one filleted edge AND
    //      the PERPENDICULAR END of another (no shared vertex). Selecting one bottom
    //      edge (in the z=0 plane) + one vertical edge whose endpoints avoid it makes
    //      the bottom face simultaneously an adjacent re-trim (for the bottom edge)
    //      and an end-cap corner-round (for the vertical) — the per-face accumulation
    //      path that the clean matchings above do not hit.
    std::printf("\n--- MIXED face roles: bottom edge + a non-adjacent vertical edge ---\n");
    {
        const double DX = 12.0, DY = 8.0, DZ = 20.0, Rm = 1.0;
        const double plateVol = DX * DY * DZ;
        SolidFactory facX;
        Solid* plate = facX.buildBox(DX, DY, DZ);
        std::vector<Edge*> pe = enumerateSolidStraightEdges(*plate);
        auto isVertical = [](Edge* e) {
            const double dz = e->end->point.z - e->start->point.z;
            const double dx = e->end->point.x - e->start->point.x;
            const double dy = e->end->point.y - e->start->point.y;
            const double L = std::sqrt(dx * dx + dy * dy + dz * dz);
            return L > 0.0 && std::fabs(dz) / L > 0.999;
        };
        auto atZ0 = [](Edge* e) { return std::fabs(e->start->point.z) < 1e-9 && std::fabs(e->end->point.z) < 1e-9; };
        std::uint32_t bottomId = 0; bool gotB = false;
        for (std::uint32_t i = 0; i < pe.size(); ++i) if (atZ0(pe[i])) { bottomId = i; gotB = true; break; }
        check(gotB, "found a bottom (z=0) edge");
        // a vertical edge whose endpoints do NOT touch the chosen bottom edge
        Vertex* bA = pe[bottomId]->start; Vertex* bB = pe[bottomId]->end;
        std::uint32_t vertId = 0; bool gotV = false;
        for (std::uint32_t i = 0; i < pe.size(); ++i) {
            if (!isVertical(pe[i])) continue;
            Vertex* a = pe[i]->start; Vertex* b = pe[i]->end;
            if (a == bA || a == bB || b == bA || b == bB) continue;
            vertId = i; gotV = true; break;
        }
        check(gotV, "found a vertical edge sharing no vertex with the bottom edge");
        if (gotB && gotV) {
            std::vector<std::uint32_t> mix = {bottomId, vertId};
            TopologyBuilder tb;
            AnalyticChainFilletResult ch = filletSolidStraightEdgesAnalytic(tb, *plate, mix, Rm);
            std::printf("[mixed] %s\n", ch.reason);
            check(ch.ok, "mixed adjacent+end fillet ok");
            if (ch.ok) {
                SewDiagnosis d = diagOf(ch.solid);
                CheckReport rep = checkBRep(ch.solid);
                std::printf("      -> %s checkBRep=%s free=%zu nonmanifold=%zu unblended=%zu\n",
                            d.closed ? "CLOSED" : "OPEN", rep.valid ? "valid" : "INVALID",
                            d.freeEdges, d.nonManifoldEdges, ch.unblendedCorners.size());
                check(d.closed && d.freeEdges == 0 && d.nonManifoldEdges == 0 && rep.valid,
                      "mixed-roles result watertight closed 2-manifold + checkBRep valid");
                check(ch.unblendedCorners.empty(), "mixed-roles: no unblended corners");
                MassProps mp = massProperties(*ch.solid, 8);
                const double err = std::fabs(mp.volume - (plateVol - ch.removedVolume));
                std::printf("      -> volume=%.12f expected=%.12f |err|=%.3e\n",
                            mp.volume, plateVol - ch.removedVolume, err);
                check(err <= 1e-6, "mixed-roles volume == plate - SUM removals  to <= 1e-6");
            }
        }
    }

    // ---- (8) ALL 12 box edges in ONE call: NATIVE spherical-octant corners ------
    // The shared-vertex keystone: every box corner is shared by 3 mutually-orthogonal
    // filleted edges, so each is closed by a SPHERICAL OCTANT of radius R centred at
    // the set-back point. The whole all-12 fillet is now ONE watertight closed
    // 2-manifold (genus 0) — 6 inset planar squares + 12 set-back cylinders + 8
    // sphere octants — with NO unblended corners. Volume == box - 12 edge quarter-
    // round prisms (over the set-back length L-2R) - 8 corner (1-pi/6)R^3 removals.
    std::printf("\n--- ALL 12 box edges in one call: native spherical-octant corner blends ---\n");
    {
        const double L = 10.0, Rc = 1.5;
        SolidFactory facA;
        Solid* cube = facA.buildBox(L, L, L);
        std::vector<Edge*> ce = enumerateSolidStraightEdges(*cube);
        std::vector<std::uint32_t> all;
        for (std::uint32_t i = 0; i < ce.size(); ++i) all.push_back(i);
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletSolidStraightEdgesAnalytic(tb, *cube, all, Rc);
        std::printf("[all12] ok=%d edges=%d corners=%zu unblended=%zu solid=%s\n   %s\n",
                    ch.ok ? 1 : 0, ch.filletedEdgeCount, ch.cornerFaces.size(),
                    ch.unblendedCorners.size(), ch.solid ? "non-null" : "null", ch.reason);
        check(ch.ok, "all-12 fillet ok (native spherical-octant corners; NOT refused)");
        check(ch.filletedEdgeCount == 12, "all-12 resolved the 12 requested edges");
        check(ch.unblendedCorners.empty(), "all-12 leaves NO unblended corners");
        check(ch.cornerFaces.size() == 8, "all-12 emits 8 spherical-octant corner faces");
        if (ch.ok) {
            SewDiagnosis d = diagOf(ch.solid);
            std::printf("      -> V=%zu E=%zu F=%zu free=%zu nonmanifold=%zu %s chi=%lld genus=%lld\n",
                        d.vertices, d.edges, d.faces, d.freeEdges, d.nonManifoldEdges,
                        d.closed ? "CLOSED" : "OPEN", d.eulerCharacteristic, d.genus);
            check(d.freeEdges == 0 && d.nonManifoldEdges == 0 && d.closed,
                  "all-12 result is a watertight closed 2-manifold");
            check(d.genus == 0, "all-12 result is genus 0");
            // every corner face is a Sphere of radius R
            bool allSphere = (ch.cornerFaces.size() == 8);
            for (Face* f : ch.cornerFaces)
                if (!f || !f->surface || f->surface->kind != SurfaceKind::Sphere ||
                    std::fabs(f->surface->r1 - Rc) > 1e-12) allSphere = false;
            check(allSphere, "every corner face is a Sphere of radius R");
            // every sphere sample is exactly R from its centre (analytic, not faked)
            double maxSphErr = 0.0;
            for (Face* f : ch.cornerFaces) {
                Surface* s = f->surface;
                for (int iu = 0; iu <= 6; ++iu)
                    for (int iv = 0; iv <= 6; ++iv) {
                        Vec3 p = s->evaluate(f->u0 + (f->u1 - f->u0) * iu / 6.0,
                                             f->v0 + (f->v1 - f->v0) * iv / 6.0);
                        maxSphErr = std::max(maxSphErr, std::fabs(dist(p, s->origin) - Rc));
                    }
            }
            std::printf("      -> max |dist(sphere sample, centre) - R| = %.3e\n", maxSphErr);
            check(maxSphErr <= 1e-12, "every octant sample is exactly R from the sphere centre");

            CheckReport rep = checkBRep(ch.solid);
            std::printf("      -> checkBRep: %zu/%zu predicates passed, valid=%s\n",
                        rep.passed(), rep.total(), rep.valid ? "true" : "false");
            if (!rep.valid)
                for (const auto& p : rep.predicates)
                    if (!p.passed) std::printf("         FAIL predicate: %s (%s)\n",
                                               p.name.c_str(), p.detail.c_str());
            check(rep.valid, "all-12 checkBRep().valid == true (full 21-predicate battery)");
            check(rep.passed() == rep.total() && rep.total() == 21,
                  "all-12 checkBRep 21/21 predicates passed");

            // Exact removed volume + filleted volume (two independent derivations).
            const double removedExpect = 12.0 * (1.0 - kPi / 4.0) * Rc * Rc * (L - 2.0 * Rc)
                                       + 8.0 * (1.0 - kPi / 6.0) * Rc * Rc * Rc;
            const double a = L - 2.0 * Rc;   // constructive: inner box + slabs + cyls + octants
            const double volConstruct = a * a * a + 6.0 * Rc * a * a
                                      + 12.0 * (kPi / 4.0) * Rc * Rc * a
                                      + 8.0 * (1.0 / 8.0) * (4.0 / 3.0) * kPi * Rc * Rc * Rc;
            const double expectedVol = L * L * L - removedExpect;
            std::printf("      -> removedVolume=%.12f expect=%.12f (constructive vol=%.12f)\n",
                        ch.removedVolume, removedExpect, volConstruct);
            check(std::fabs(ch.removedVolume - removedExpect) <= 1e-9,
                  "all-12 removedVolume == 12 edge prisms + 8 corner removals");
            check(std::fabs(expectedVol - volConstruct) <= 1e-9,
                  "the box-minus-removed and constructive volumes agree (sanity)");
            MassProps mp = massProperties(*ch.solid, 10);
            const double err = std::fabs(mp.volume - expectedVol);
            std::printf("      -> volume=%.12f expected=%.12f |err|=%.3e\n",
                        mp.volume, expectedVol, err);
            check(mp.volume < L * L * L, "material REMOVED (volume < box)");
            check(err <= 1e-9,
                  "all-12 filleted volume == box - 12*(1-pi/4)R^2 L_cyl - 8*(1-pi/6)R^3  to <= 1e-9");
        }
    }

    // ---- (8b) HONEST BOUNDARY: a 2-edge shared corner is NOT the supported trihedral
    //      corner, so the op refuses (mesh-bridge fallback) — never fabricated. Two
    //      bottom edges of a box that share ONE corner (the third edge at that corner
    //      is NOT filleted): the 2-edge spherical-lune blend is a documented follow-up.
    std::printf("\n--- HONEST BOUNDARY: a 2-edge shared corner refuses (mesh-bridge fallback) ---\n");
    {
        SolidFactory facB;
        Solid* cube = facB.buildBox(10.0, 10.0, 10.0);
        std::vector<Edge*> ce = enumerateSolidStraightEdges(*cube);
        // pick two edges that share exactly one vertex.
        std::uint32_t e0 = 0, e1 = 0; bool got = false;
        for (std::uint32_t i = 0; i < ce.size() && !got; ++i)
            for (std::uint32_t j = i + 1; j < ce.size() && !got; ++j) {
                int shared = 0;
                for (Vertex* a : {ce[i]->start, ce[i]->end})
                    for (Vertex* b : {ce[j]->start, ce[j]->end})
                        if (a == b) ++shared;
                if (shared == 1) { e0 = i; e1 = j; got = true; }
            }
        check(got, "found two edges sharing exactly one vertex");
        TopologyBuilder tb;
        AnalyticChainFilletResult ch =
            filletSolidStraightEdgesAnalytic(tb, *cube, std::vector<std::uint32_t>{e0, e1}, 1.5);
        std::printf("[2edge] ok=%d unblended=%zu solid=%s\n   %s\n",
                    ch.ok ? 1 : 0, ch.unblendedCorners.size(), ch.solid ? "non-null" : "null", ch.reason);
        check(!ch.ok, "2-edge shared corner refuses honestly (ok==false)");
        check(ch.solid == nullptr, "2-edge shared corner emits NO fabricated solid");
        check(ch.unblendedCorners.size() == 1, "2-edge shared corner reported in unblendedCorners");
    }

    // ---- (9) one-edge multi path == single-edge path (general-path consistency) -
    std::printf("\n--- CONSISTENCY: one-edge multi path matches the single-edge path ---\n");
    {
        SolidFactory facE;
        Solid* bx = facE.buildBox(10.0, 10.0, 10.0);
        TopologyBuilder t1, t2;
        AnalyticFilletResult single = filletSolidStraightEdgeAnalytic(t1, *bx, 0, 1.5);
        AnalyticChainFilletResult multi =
            filletSolidStraightEdgesAnalytic(t2, *bx, std::vector<std::uint32_t>{0}, 1.5);
        check(single.ok && multi.ok, "single & one-edge-multi both ok");
        if (single.ok && multi.ok) {
            const double v1 = massProperties(*single.solid, 8).volume;
            const double v2 = massProperties(*multi.solid, 8).volume;
            std::printf("[equiv] single=%.12f multi(1)=%.12f |diff|=%.3e\n",
                        v1, v2, std::fabs(v1 - v2));
            check(std::fabs(v1 - v2) <= 1e-9, "one-edge multi-path volume == single-edge volume");
            check(checkBRep(multi.solid).valid, "one-edge multi-path checkBRep valid");
        }
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
