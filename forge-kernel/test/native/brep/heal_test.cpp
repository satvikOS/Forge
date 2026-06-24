// forge/native/brep/heal_test.cpp
//
// Standalone validation gate for the K5-heal native B-rep HEALING increment
// (Heal.hpp / Heal.cpp) — the in-house replacement for OCCT ShapeFix_Shape /
// ShapeFix_Wire / ShapeUpgrade_* on a native polygonal shell. Pure C++20, NO
// external dependencies, NO OCCT, NO WASM, no test framework — a tiny hand-rolled
// harness that prints PASS/FAIL and exits non-zero on any failure (mirrors
// sew_test.cpp / k0_topology_test.cpp / trimmed_face_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Heal.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/test/native/brep/heal_test.cpp \
//     -o /tmp/heal_test && /tmp/heal_test
//
// THE DEFECTIVE BOX (one shell carrying every defect class the heal must fix):
//   * 6 box faces built as INDEPENDENT fragments (private vertices/edges) — the raw
//     import state (24 verts, 24 free edges), exactly as sew_test builds them.
//   * SPLIT EDGE: the BOTTOM face's edge from (0,0,0)->(L,0,0) is split by an extra
//     near-collinear mid-vertex at (L/2, ε, 0) (ε = tol/4 off the line), so that face
//     is a 5-gon. The FRONT face that shares that physical edge keeps it whole. A
//     naive sew would leave 3 free half-edges there; the heal must merge the
//     collinear corner and re-mate the full edge.
//   * SUB-TOL GAP: the LEFT face's four corners are each nudged by a sub-tol δ = tol/4
//     away from their true box positions, so it is a distinct, slightly-detached
//     patch — its 4 boundary edges are a free-edge gap a plain endpoint-equality sew
//     would miss. The heal's gap-fill must snap them shut.
//   * DUPLICATE VERTEX: the TOP face's ring repeats one corner with a sub-tol jitter
//     (a zero-length stub edge) — the heal must weld/collapse it.
//   * SLIVER FACE: a 7th, extra triangular face of area ~ (tol/2)^2 < tol^2 sits on
//     the box surface — the heal must drop it.
//
// CLOSED-FORM GATES (asserted below):
//   BEFORE heal: the shell is OPEN (free edges > 0, NOT closed) — the defects are real.
//   AFTER heal:  one CLOSED 2-manifold shell, free = 0, non-manifold = 0, V=8/E=12/F=6,
//                Euler chi = 2, genus 0; sliver gone (F=6, not 7); split-edge merged;
//                gap closed; volume == L^3 to tol (the divergence-theorem invariant).

#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

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

// Build a single face from an ordered vertex-position ring (private vertices/edges).
static Face* faceFromRing(TopologyBuilder& tb, const std::vector<Point3>& ring) {
    Face* f = tb.makeFace();
    std::vector<Vertex*> vs;
    vs.reserve(ring.size());
    for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

// ===========================================================================
// Build the DEFECTIVE box described in the header. L = box side; tol = heal tol.
// ===========================================================================
static std::vector<Face*> buildDefectiveBox(TopologyBuilder& tb, double L, double tol) {
    const double a = 0.0, b = L;
    const double eps = tol * 0.25;   // sub-tol perturbation (< tol, so heal-able)

    // 8 ideal corners.
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},  // 0..3  z=a (bottom)
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},  // 4..7  z=b (top)
    };

    std::vector<Face*> faces;

    // bottom (-Z) CCW 0,3,2,1 — but SPLIT the edge 1->0 i.e. (b,a,a)->(a,a,a) with a
    // near-collinear midpoint (L/2, eps, a). Ring order 0,3,2,1 has the segment
    // 1 -> 0 as its closing edge; insert the mid AFTER vertex 1 (before 0).
    {
        std::vector<Point3> ring = {P[0], P[3], P[2], P[1], {L * 0.5, eps, a}};
        faces.push_back(faceFromRing(tb, ring));   // 5-gon (split edge)
    }

    // top (+Z) CCW 4,5,6,7 — DUPLICATE corner: repeat P[5] with a sub-tol jitter
    // right after it (a zero-length stub edge).
    {
        std::vector<Point3> ring = {P[4], P[5], {P[5].x + eps, P[5].y, P[5].z}, P[6], P[7]};
        faces.push_back(faceFromRing(tb, ring));   // 5-gon (duplicate vertex)
    }

    // front (-Y) CCW 0,1,5,4 — clean.
    faces.push_back(faceFromRing(tb, {P[0], P[1], P[5], P[4]}));
    // back  (+Y) CCW 2,3,7,6 — clean.
    faces.push_back(faceFromRing(tb, {P[2], P[3], P[7], P[6]}));

    // left  (-X) CCW 0,4,7,3 — SUB-TOL GAP: nudge every corner by +eps in X (away
    // from the box face), so the whole patch is detached by < tol.
    {
        auto nudge = [&](const Point3& p) { return Point3{p.x + eps, p.y, p.z}; };
        faces.push_back(faceFromRing(tb, {nudge(P[0]), nudge(P[4]), nudge(P[7]), nudge(P[3])}));
    }

    // right (+X) CCW 1,2,6,5 — clean.
    faces.push_back(faceFromRing(tb, {P[1], P[2], P[6], P[5]}));

    // SLIVER face: a tiny degenerate triangle (area ~ (tol/2)^2 < tol^2) lying on the
    // bottom face near the origin.
    {
        const double s = tol * 0.5;
        faces.push_back(faceFromRing(tb, {{a, a, a}, {s, a, a}, {a, s, a}}));
    }

    return faces;
}

// ===========================================================================
// THE GATE.
// ===========================================================================
static void testHealDefectiveBox() {
    std::printf("[1] heal a defective box -> closed 2-manifold, free=0, volume preserved\n");
    TopologyBuilder tb;
    const double L = 4.0;
    const double tol = 1e-4;
    std::vector<Face*> faces = buildDefectiveBox(tb, L, tol);

    check(faces.size() == 7, "input: 7 faces (6 box faces + 1 sliver)");

    HealOptions opt;
    opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "heal ok");

    // ---- BEFORE: the input really is defective (open). --------------------
    const SewDiagnosis& B = r.before;
    std::printf("      BEFORE: V=%zu E=%zu F=%zu  free=%zu  manifold=%zu  nonmanifold=%zu  shell %s  vol=%.6f\n",
                B.vertices, B.edges, B.faces, B.freeEdges, B.manifoldEdges, B.nonManifoldEdges,
                B.closed ? "CLOSED" : "OPEN", r.volumeBefore);
    check(!B.closed,        "before: shell OPEN (defects present)");
    check(B.freeEdges > 0,  "before: free edges > 0");

    // ---- AFTER: clean closed 2-manifold box. ------------------------------
    const SewDiagnosis& A = r.after;
    std::printf("      AFTER : V=%zu E=%zu F=%zu  free=%zu  manifold=%zu  nonmanifold=%zu  shell %s  vol=%.6f\n",
                A.vertices, A.edges, A.faces, A.freeEdges, A.manifoldEdges, A.nonManifoldEdges,
                A.closed ? "CLOSED" : "OPEN", r.volumeAfter);
    std::printf("      FIXES : welded=%zu gapsClosed=%zu shortEdges=%zu slivers=%zu edgePairsMerged=%zu\n",
                r.verticesWelded, r.gapsClosed, r.shortEdgesCollapsed, r.sliverFacesRemoved, r.edgePairsMerged);

    check(A.faces == 6,            "after: F = 6 (sliver removed, split/dup merged)");
    check(A.vertices == 8,         "after: V = 8 welded box corners");
    check(A.edges == 12,           "after: E = 12 shared edges");
    check(A.freeEdges == 0,        "after: 0 FREE edges (gap closed, edges re-mated)");
    check(A.manifoldEdges == 12,   "after: 12 manifold (2-coedge) edges");
    check(A.nonManifoldEdges == 0, "after: 0 non-manifold edges");
    check(A.shellCount == 1,       "after: 1 connected shell");
    check(A.closed,                "after: shell CLOSED (watertight 2-manifold)");
    check(A.eulerCharacteristic == 2, "after: Euler chi = V-E+F = 8-12+6 = 2");
    check(A.genus == 0,            "after: genus 0");

    check(r.sliverFacesRemoved == 1, "fix: exactly 1 sliver face removed");
    check(r.gapsClosed >= 1,         "fix: at least one cross-face gap closed");
    check(r.shortEdgesCollapsed >= 2, "fix: split-edge + duplicate-vertex collapsed (>=2)");
    check(r.unfixedFreeEdgeIds.empty(),        "no free edges left unfixed");
    check(r.unfixedNonManifoldEdgeIds.empty(), "no non-manifold edges left unfixed");
    check(r.keptSliverFaceIds.empty(),         "no sliver kept-unfixed (drop was safe)");
    check(r.fullyHealed(),                      "report: fullyHealed() == true");

    // ---- VOLUME preserved to tol: the clean box is L^3 (sign may be ±). -----
    const double expected = L * L * L;
    const double measured = std::fabs(r.volumeAfter);
    std::printf("      VOLUME: measured=%.9f  expected=%.9f  |err|=%.3e  (tol=%.1e)\n",
                measured, expected, std::fabs(measured - expected), tol);
    check(std::fabs(measured - expected) <= tol, "after: volume == L^3 to tol");

    // The sliver + perturbations changed area/vol by < a few * tol; before-vol is a
    // (meaningless because open) surface integral, but the AFTER vol is the real solid.
}

// ===========================================================================
// (2) CLEAN box is idempotent: healing an already-clean independent-face box
// returns the same closed shell with ZERO fixes applied (no fabrication).
// ===========================================================================
static void testHealCleanIdempotent() {
    std::printf("[2] heal an already-clean box -> idempotent, zero fixes\n");
    TopologyBuilder tb;
    const double L = 2.0, tol = 1e-6;
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    const int rings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (const auto& rr : rings)
        faces.push_back(faceFromRing(tb, {P[rr[0]], P[rr[1]], P[rr[2]], P[rr[3]]}));

    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "clean heal ok");
    check(r.after.closed, "clean: still CLOSED after heal");
    check(r.after.faces == 6, "clean: still 6 faces");
    check(r.after.freeEdges == 0, "clean: 0 free edges");
    check(r.sliverFacesRemoved == 0, "clean: 0 slivers removed (no fabrication)");
    check(r.shortEdgesCollapsed == 0, "clean: 0 short edges collapsed");
    check(std::fabs(std::fabs(r.volumeAfter) - L*L*L) <= 1e-9, "clean: volume == L^3");
}

// ===========================================================================
// (3) HONEST UNFIXED: a box missing a whole face with a >tol gap cannot be made
// watertight by snapping — the heal must report the residual free edges UNFIXED,
// never fabricate a closure.
// ===========================================================================
static void testHealHonestUnfixed() {
    std::printf("[3] unhealable gap -> reported UNFIXED (no fabrication)\n");
    TopologyBuilder tb;
    const double L = 3.0, tol = 1e-5;
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    // 5 faces only — the TOP face is missing entirely (a true unclosable hole).
    const int rings[5][4] = {{0,3,2,1},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (const auto& rr : rings) faces.push_back(faceFromRing(tb, {P[rr[0]],P[rr[1]],P[rr[2]],P[rr[3]]}));

    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "unfixed heal ok (runs)");
    check(!r.after.closed, "unfixed: shell still OPEN (cannot fabricate the missing top)");
    check(r.after.freeEdges == 4, "unfixed: exactly 4 free edges remain (the rim of the missing face)");
    check(r.unfixedFreeEdgeIds.size() == 4, "unfixed: 4 free-edge ids reported as UNFIXED");
    check(!r.fullyHealed(), "unfixed: fullyHealed() == false (honest)");
    std::printf("      -> AFTER free=%zu  reported-unfixed=%zu  (honest: missing face NOT fabricated)\n",
                r.after.freeEdges, r.unfixedFreeEdgeIds.size());
}

int main() {
    std::printf("=== forge::native::brep — K5 HEAL (ShapeFix/ShapeUpgrade) gate ===\n");
    testHealDefectiveBox();
    testHealCleanIdempotent();
    testHealHonestUnfixed();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
