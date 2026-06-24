// forge/native/brep/heal_test.cpp
//
// Standalone validation gate for the K5-heal native B-rep HEALING increment
// (Heal.hpp / Heal.cpp) — the in-house replacement for OCCT ShapeFix_Shape /
// ShapeFix_Wire / ShapeUpgrade_* on a native polygonal shell. Pure C++20, NO
// external dependencies, NO OCCT, NO WASM, no test framework — a tiny hand-rolled
// harness that prints PASS/FAIL and exits non-zero on any failure (mirrors
// sew_test.cpp / k0_topology_test.cpp / trimmed_face_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below).
// The HARDER defect classes (self-intersection (7)) pull in the EXACT predicate
// layer, so ExactPredicates3D.cpp + ExactReal.cpp + HalfEdgeMesh.cpp are now linked:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Heal.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/src/native/ExactPredicates3D.cpp \
//     forge-kernel/src/native/ExactReal.cpp \
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

// ===========================================================================
// (4) FACE-ORIENTATION REPAIR (heal pass 6): a box with ONE face wound the wrong
// way (its ring reversed) is an inconsistently-oriented shell — sewing alone
// re-mates the edges but leaves that face's two coedges agreeing in sense with
// its neighbours (a mis-orientation). The heal's orientation propagation must
// FLIP the offender so EVERY shared edge is a clean opposite-sense manifold pair,
// gauge the whole shell OUTWARD, and the result is a clean closed solid of the
// correct (positive) volume.
// ===========================================================================
static void testHealOrientationRepair() {
    std::printf("[4] one reversed face -> heal flips it -> consistent closed shell\n");
    TopologyBuilder tb;
    const double L = 5.0, tol = 1e-6;
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    // The six correctly-wound box rings (CCW seen from outside).
    const int rings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (int fi = 0; fi < 6; ++fi) {
        std::vector<Point3> ring = {P[rings[fi][0]], P[rings[fi][1]], P[rings[fi][2]], P[rings[fi][3]]};
        // REVERSE the FRONT face (index 2): wind it the wrong way (inward normal).
        if (fi == 2) std::reverse(ring.begin(), ring.end());
        faces.push_back(faceFromRing(tb, ring));
    }

    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "orient heal ok");

    const SewDiagnosis& A = r.after;
    std::printf("      AFTER : V=%zu E=%zu F=%zu  free=%zu  manifold=%zu  nonmanifold=%zu  shell %s  vol=%.6f  flipped=%zu\n",
                A.vertices, A.edges, A.faces, A.freeEdges, A.manifoldEdges, A.nonManifoldEdges,
                A.closed ? "CLOSED" : "OPEN", r.volumeAfter, r.facesFlipped);

    check(A.closed,                "orient: shell CLOSED after flip");
    check(A.faces == 6,            "orient: 6 faces (none dropped)");
    check(A.freeEdges == 0,        "orient: 0 free edges");
    check(A.manifoldEdges == 12,   "orient: 12 manifold edges");
    check(A.nonManifoldEdges == 0, "orient: 0 non-manifold edges");
    check(r.facesFlipped >= 1,     "orient: at least one face flipped to consistency");
    // Manifold + closed under THIS sewer means every 2-coedge edge is opposite-sense
    // (the sewer's misoriented list would otherwise have left the edge unmated/free);
    // a closed 2-manifold polygonal shell with chi=2 is orientation-consistent.
    check(A.eulerCharacteristic == 2, "orient: Euler chi = 2 (consistent 2-manifold)");
    check(r.fullyHealed(),         "orient: fullyHealed() == true");

    const double expected = L * L * L;
    const double measured = std::fabs(r.volumeAfter);
    std::printf("      VOLUME: measured=%.9f  expected=%.9f  |err|=%.3e\n",
                measured, expected, std::fabs(measured - expected));
    check(std::fabs(measured - expected) <= 1e-6, "orient: volume == L^3 to tol");
    // Outward gauge: a correctly-healed solid winds so the divergence-theorem volume
    // is POSITIVE (outward normals). Assert the sign, not just the magnitude.
    check(r.volumeAfter > 0.0,     "orient: signed volume POSITIVE (outward-gauged)");
}

// ===========================================================================
// (5) SELF-INTERSECTION REPAIR (heal pass 7): a clean closed box PLUS a tiny
// extra face that pokes THROUGH the box wall (a small self-overlapping sliver
// whose interior properly interpenetrates a box face) must be detected by the
// EXACT triangle-triangle test and DROPPED, leaving the watertight box. The box
// itself is built so its faces share corners (so the box's own faces are NOT
// flagged — only the rogue interpenetrating patch is).
// ===========================================================================
static void testHealSelfIntersectionRepair() {
    std::printf("[5] tiny self-overlapping sliver -> heal removes it -> watertight\n");
    TopologyBuilder tb;
    const double L = 10.0, tol = 1e-6;
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    const int rings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (const auto& rr : rings)
        faces.push_back(faceFromRing(tb, {P[rr[0]], P[rr[1]], P[rr[2]], P[rr[3]]}));

    // A tiny rogue triangle straddling the FRONT wall (y=0 plane): two corners just
    // inside the box (y=+d) and one just outside (y=-d), centred mid-wall — so its
    // interior PROPERLY pierces the front face. Its area ~ (small)^2 is far below the
    // box-face area, so it is a small/removable sliver. It does NOT share any box
    // corner, so it is a genuine non-adjacent interpenetration.
    const double cx = L * 0.5, cz = L * 0.5, s = L * 0.02, d = L * 0.01;
    faces.push_back(faceFromRing(tb, {
        {cx - s, +d, cz}, {cx + s, +d, cz}, {cx, -d, cz + s}}));

    check(faces.size() == 7, "selfx input: 6 box faces + 1 interpenetrating sliver");

    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "selfx heal ok");

    const SewDiagnosis& A = r.after;
    std::printf("      AFTER : F=%zu  free=%zu  nonmanifold=%zu  shell %s  vol=%.6f  selfxRemoved=%zu  unfixedPairs=%zu\n",
                A.faces, A.freeEdges, A.nonManifoldEdges, A.closed ? "CLOSED" : "OPEN",
                r.volumeAfter, r.selfIntersectingFacesRemoved,
                r.unfixedSelfIntersectionFacePairs.size());

    check(r.selfIntersectingFacesRemoved == 1, "selfx: exactly 1 interpenetrating sliver removed");
    check(r.unfixedSelfIntersectionFacePairs.empty(), "selfx: no structural self-intersection left unfixed");
    check(A.faces == 6,    "selfx: back to 6 box faces");
    check(A.closed,        "selfx: shell CLOSED (watertight) after removal");
    check(A.freeEdges == 0, "selfx: 0 free edges");
    check(A.nonManifoldEdges == 0, "selfx: 0 non-manifold edges");
    check(r.fullyHealed(), "selfx: fullyHealed() == true");
    check(std::fabs(std::fabs(r.volumeAfter) - L*L*L) <= 1e-6, "selfx: volume == L^3");
}

// ===========================================================================
// (6) NON-MANIFOLD RESOLUTION (heal pass 8): a closed box PLUS a flap face that
// shares ONE box edge makes that edge shared by 3 faces (non-manifold). The flap
// is NOT a duplicate of any box face, so it cannot be dropped — the heal must
// DETECT the non-manifold edge and report it UNFIXED (honest: the 2-manifold model
// cannot split an arbitrary non-manifold join). We also assert a SEPARATE clean box
// + an EXACT-duplicate face IS de-manifolded by dropping the duplicate.
// ===========================================================================
static void testHealNonManifold() {
    std::printf("[6] non-manifold edge (3 faces) -> detected + reported UNFIXED (honest)\n");
    TopologyBuilder tb;
    const double L = 6.0, tol = 1e-6;
    const double a = 0.0, b = L;
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},
    };
    const int rings[6][4] = {{0,3,2,1},{4,5,6,7},{0,1,5,4},{2,3,7,6},{0,4,7,3},{1,2,6,5}};
    std::vector<Face*> faces;
    for (const auto& rr : rings)
        faces.push_back(faceFromRing(tb, {P[rr[0]], P[rr[1]], P[rr[2]], P[rr[3]]}));

    // FLAP: a face that re-uses the box bottom-front edge (0)->(1) i.e. (a,a,a)->(b,a,a)
    // and stands up out of the box (into +Z, -Y so it does not coincide with any wall).
    // That edge is now shared by 3 faces (bottom + front + flap) -> non-manifold.
    const Point3 q0{a, -L * 0.5, L * 0.5};
    const Point3 q1{b, -L * 0.5, L * 0.5};
    faces.push_back(faceFromRing(tb, {P[0], P[1], q1, q0}));

    check(faces.size() == 7, "nonman input: closed box + 1 flap sharing one edge");

    HealOptions opt; opt.tol = tol;
    HealReport r = healBRep(tb, faces, opt);
    check(r.ok, "nonman heal ok");

    const SewDiagnosis& A = r.after;
    std::printf("      AFTER : F=%zu  free=%zu  manifold=%zu  nonmanifold=%zu  shell %s  dupRemoved=%zu  nmEdgesReport=%zu  nmVerts=%zu\n",
                A.faces, A.freeEdges, A.manifoldEdges, A.nonManifoldEdges,
                A.closed ? "CLOSED" : "OPEN", r.duplicateFacesRemoved,
                r.unfixedNonManifoldEdgeReport.size(), r.nonManifoldVertexIds.size());

    // The sewer mates only TWO coedges per Edge, so a 3rd face on an edge does NOT
    // surface as a 3-coedge Edge — it surfaces GEOMETRICALLY (3 faces sharing one
    // welded endpoint-position pair). The heal detects that join and reports it.
    check(r.duplicateFacesRemoved == 0,         "nonman: flap is NOT a duplicate (not dropped)");
    check(!r.unfixedNonManifoldEdgeReport.empty(), "nonman: 3-faces-on-an-edge join REPORTED unfixed");
    check(!r.nonManifoldVertexIds.empty(),      "nonman: non-manifold vertices detected (pinch corners)");
    check(!r.fullyHealed(),                     "nonman: fullyHealed() == false (honest, unfixed remains)");
    std::printf("      -> honest: 3-faces-on-an-edge DETECTED (%zu edge ids, %zu pinch verts), NOT force-split\n",
                r.unfixedNonManifoldEdgeReport.size(), r.nonManifoldVertexIds.size());

    // ---- de-manifold by EXACT-DUPLICATE drop: a box + a perfect copy of one face. --
    std::printf("    [6b] exact-duplicate face -> dropped to restore manifold\n");
    TopologyBuilder tb2;
    std::vector<Face*> faces2;
    for (const auto& rr : rings)
        faces2.push_back(faceFromRing(tb2, {P[rr[0]], P[rr[1]], P[rr[2]], P[rr[3]]}));
    // Exact duplicate of the bottom face (same ring) -> its 4 edges each become 3-coedge.
    faces2.push_back(faceFromRing(tb2, {P[rings[0][0]], P[rings[0][1]], P[rings[0][2]], P[rings[0][3]]}));
    check(faces2.size() == 7, "dup input: closed box + 1 exact-duplicate face");

    HealReport r2 = healBRep(tb2, faces2, opt);
    check(r2.ok, "dup heal ok");
    const SewDiagnosis& A2 = r2.after;
    std::printf("      AFTER : F=%zu  free=%zu  nonmanifold=%zu  shell %s  dupRemoved=%zu\n",
                A2.faces, A2.freeEdges, A2.nonManifoldEdges, A2.closed ? "CLOSED" : "OPEN",
                r2.duplicateFacesRemoved);
    check(r2.duplicateFacesRemoved == 1, "dup: exactly 1 duplicate face dropped");
    check(A2.faces == 6,                 "dup: back to 6 faces");
    check(A2.nonManifoldEdges == 0,      "dup: 0 non-manifold edges after drop");
    check(A2.closed,                     "dup: shell CLOSED (manifold restored)");
    check(r2.fullyHealed(),              "dup: fullyHealed() == true");
}

int main() {
    std::printf("=== forge::native::brep — K5 HEAL (ShapeFix/ShapeUpgrade) gate ===\n");
    testHealDefectiveBox();
    testHealCleanIdempotent();
    testHealHonestUnfixed();
    testHealOrientationRepair();
    testHealSelfIntersectionRepair();
    testHealNonManifold();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
