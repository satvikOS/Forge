// forge/native/brep/sew_test.cpp
//
// Standalone validation gate for the K1.4 native SEW / DIAGNOSE / HEAL increment
// (Sew.hpp / Sew.cpp) — the in-house replacement for OCCT BRepBuilderAPI_Sewing +
// the first slice of ShapeFix (vertex-weld healing). Pure C++20, NO external
// dependencies, NO OCCT, NO WASM, no test framework — a tiny hand-rolled harness
// that prints PASS/FAIL and exits non-zero on any failure (mirrors
// k0_topology_test.cpp / trimmed_face_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/sew_test.cpp \
//     -o /tmp/sew_test && /tmp/sew_test
//
// CLOSED-FORM GATES (asserted below):
//   (1) BOX SEW. The SIX planar quad faces of an L×L×L box are each built from
//       their OWN PRIVATE 4 vertices (24 independent vertices, 24 independent
//       boundary edges — exactly the import scenario of 6 separate STEP
//       ADVANCED_FACE records). Sewing them welds the coincident corners to 8
//       vertices, merges the coincident boundary edges to 12 shared edges (each
//       with TWO opposite-sense coedges), and builds ONE connected, CLOSED
//       (watertight) shell with 0 free edges. Euler V-E+F = 8-12+6 = 2 ⇒ genus 0.
//   (2) OPEN SHELL. Removing one face and sewing the remaining 5 yields an OPEN
//       shell with EXACTLY 4 free edges (the rim of the missing face), V=8, the
//       12 edges now split 8 manifold + 4 free, and genus is reported undefined.
//   (3) MIS-ORIENTATION DETECTED. Two faces that share a coincident edge but are
//       wound the SAME way across it (so their shared-edge coedges agree in sense
//       instead of opposing) are flagged by the sew diagnosis as a mis-oriented
//       pair — the orientation defect a consistent solid cannot contain.

#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Curve.hpp"

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

// ===========================================================================
// Build the six planar faces of an axis-aligned box [0,L]^3 as INDEPENDENT
// fragments: every face gets its own fresh 4 vertices (so the 8 box corners are
// represented by 3 distinct vertices each = 24 vertices, and every face edge is a
// private edge with a single coedge). This is the genuine sew input — NOT the
// already-shared box from buildBox().
//
// Each ring is given CCW as seen from OUTSIDE the box (outward normal), matching
// buildBox's winding, so a correct sew produces opposite-sense coedges on every
// shared edge. Returns the 6 faces (in the order bottom,top,front,back,left,right).
// ===========================================================================
static std::vector<Face*> buildIndependentBoxFaces(TopologyBuilder& tb, double L) {
    const double a = 0.0, b = L;
    // 8 logical corner positions (CCW rings reference these by position; each
    // face re-creates its own vertices at the positions, so corners are split).
    const Point3 P[8] = {
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},  // 0..3  z=a (bottom)
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},  // 4..7  z=b (top)
    };
    // Same CCW-from-outside rings buildBox uses.
    const int rings[6][4] = {
        {0, 3, 2, 1}, // bottom (-Z)
        {4, 5, 6, 7}, // top    (+Z)
        {0, 1, 5, 4}, // front  (-Y)
        {2, 3, 7, 6}, // back   (+Y)
        {0, 4, 7, 3}, // left   (-X)
        {1, 2, 6, 5}, // right  (+X)
    };
    std::vector<Face*> faces;
    for (const auto& r : rings) {
        Face* f = tb.makeFace();
        std::vector<Vertex*> ring;
        for (int k = 0; k < 4; ++k) ring.push_back(tb.makeVertex(P[r[k]]));
        tb.addOuterLoopToFace(f, ring);  // private edges (no reuse: fresh vertices)
        faces.push_back(f);
    }
    return faces;
}

// ===========================================================================
// (1) BOX SEW -> CLOSED watertight shell, 12 shared edges, 8 vertices, chi = 2.
// ===========================================================================
static void testBoxSewClosed() {
    std::printf("[1] box sew -> closed watertight shell\n");
    TopologyBuilder tb;
    const double L = 3.0;
    std::vector<Face*> faces = buildIndependentBoxFaces(tb, L);

    // Pre-sew sanity: 24 independent vertices, 24 independent boundary edges,
    // every edge single-use (free) — the raw import state.
    check(tb.vertexCount() == 24, "pre-sew: 24 independent vertices");
    check(tb.edgeCount() == 24,   "pre-sew: 24 independent edges");

    SewOptions opt;
    opt.tol = 1e-6;
    SewResult r = sewFaces(tb, faces, opt);

    check(r.ok, "sew ok");
    const SewDiagnosis& d = r.diagnosis;
    check(d.faces == 6,            "F = 6 faces");
    check(d.vertices == 8,         "V = 8 welded vertices");
    check(d.edges == 12,           "E = 12 shared edges");
    check(r.mergedEdgePairs == 12, "12 edge pairs merged (24 -> 12)");
    check(r.weldedVertices == 16,  "16 duplicate vertices welded away (24 -> 8)");
    check(d.freeEdges == 0,        "0 FREE edges (watertight)");
    check(d.manifoldEdges == 12,   "12 manifold (2-coedge) edges");
    check(d.nonManifoldEdges == 0, "0 non-manifold edges");
    check(d.shellCount == 1,       "1 connected shell");
    check(d.closed,                "shell CLOSED (watertight)");
    check(d.eulerCharacteristic == 2, "Euler chi = V-E+F = 8-12+6 = 2");
    check(d.genus == 0,            "genus 0");
    check(r.misoriented.empty(),   "no mis-oriented edges");

    std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  chi=%lld  genus=%lld  shell %s\n",
                d.vertices, d.edges, d.faces, d.freeEdges,
                d.eulerCharacteristic, d.genus, d.closed ? "CLOSED" : "OPEN");
}

// ===========================================================================
// (2) REMOVE 1 FACE -> OPEN shell with EXACTLY 4 free edges.
// ===========================================================================
static void testBoxOpenFourFree() {
    std::printf("[2] remove one face -> open shell, exactly 4 free edges\n");
    TopologyBuilder tb;
    const double L = 3.0;
    std::vector<Face*> all = buildIndependentBoxFaces(tb, L);
    // Drop the TOP face (index 1); sew the remaining 5.
    std::vector<Face*> five = {all[0], all[2], all[3], all[4], all[5]};

    SewOptions opt;
    opt.tol = 1e-6;
    SewResult r = sewFaces(tb, five, opt);

    check(r.ok, "sew ok");
    const SewDiagnosis& d = r.diagnosis;
    check(d.faces == 5,          "F = 5 faces");
    check(d.vertices == 8,       "V = 8 welded vertices (top corners shared by side faces)");
    check(d.edges == 12,         "E = 12 distinct edges (8 manifold + 4 rim)");
    check(d.freeEdges == 4,      "EXACTLY 4 FREE edges (rim of the missing top face)");
    check(d.manifoldEdges == 8,  "8 manifold edges");
    check(d.nonManifoldEdges == 0, "0 non-manifold edges");
    check(!d.closed,             "shell OPEN (not watertight)");
    check(d.genus == -1,         "genus undefined for an open shell");
    check(d.freeEdgeIds.size() == 4, "4 flagged free-edge gap ids");

    std::printf("      -> V=%zu E=%zu F=%zu  free=%zu  manifold=%zu  shell %s\n",
                d.vertices, d.edges, d.faces, d.freeEdges, d.manifoldEdges,
                d.closed ? "CLOSED" : "OPEN");
}

// ===========================================================================
// (3) MIS-ORIENTED shared edge detected.
// Two unit quads in the z=0 plane sharing the edge from (1,0,0) to (1,1,0):
//   face A: (0,0)(1,0)(1,1)(0,1)  CCW  -> its right edge runs (1,0)->(1,1)
//   face B: (1,0)(2,0)(2,1)(1,1)  CCW  -> its left  edge runs (1,1)->(1,0)
// Built correctly, the shared edge's two coedges OPPOSE (no defect). To force a
// defect we wind face B the SAME way along the shared edge by reversing B's ring
// so its left edge ALSO runs (1,0)->(1,1) — same sense as A across the shared
// edge -> the sew flags a mis-oriented pair.
// ===========================================================================
static void testMisorientationDetected() {
    std::printf("[3] mis-oriented shared edge detected\n");

    // --- 3a. correctly-oriented control: NO defect on the shared edge. -----
    {
        TopologyBuilder tb;
        Face* A = tb.makeFace();
        std::vector<Vertex*> ra = {
            tb.makeVertex({0, 0, 0}), tb.makeVertex({1, 0, 0}),
            tb.makeVertex({1, 1, 0}), tb.makeVertex({0, 1, 0})};
        tb.addOuterLoopToFace(A, ra);

        Face* B = tb.makeFace();
        // CCW: (1,0)(2,0)(2,1)(1,1) -> left edge runs (1,1)->(1,0): opposite to A.
        std::vector<Vertex*> rb = {
            tb.makeVertex({1, 0, 0}), tb.makeVertex({2, 0, 0}),
            tb.makeVertex({2, 1, 0}), tb.makeVertex({1, 1, 0})};
        tb.addOuterLoopToFace(B, rb);

        SewResult r = sewFaces(tb, {A, B}, SewOptions{});
        check(r.ok, "control sew ok");
        // One shared edge gets two opposite-sense coedges -> 1 manifold, 6 free.
        check(r.mergedEdgePairs == 1, "control: 1 edge pair merged");
        check(r.diagnosis.manifoldEdges == 1, "control: 1 manifold (shared) edge");
        check(r.misoriented.empty(), "control: NO mis-oriented pair (correct winding)");
    }

    // --- 3b. defective: face B reversed so it agrees in sense across the edge.
    {
        TopologyBuilder tb;
        Face* A = tb.makeFace();
        std::vector<Vertex*> ra = {
            tb.makeVertex({0, 0, 0}), tb.makeVertex({1, 0, 0}),
            tb.makeVertex({1, 1, 0}), tb.makeVertex({0, 1, 0})};
        tb.addOuterLoopToFace(A, ra);  // shared edge runs (1,0)->(1,1)

        Face* B = tb.makeFace();
        // REVERSED ring (CW): (1,1)(2,1)(2,0)(1,0) -> left edge runs (1,0)->(1,1):
        // SAME sense as A across the shared edge -> mis-oriented defect.
        std::vector<Vertex*> rb = {
            tb.makeVertex({1, 1, 0}), tb.makeVertex({2, 1, 0}),
            tb.makeVertex({2, 0, 0}), tb.makeVertex({1, 0, 0})};
        tb.addOuterLoopToFace(B, rb);

        SewResult r = sewFaces(tb, {A, B}, SewOptions{});
        check(r.ok, "defect sew ok");
        check(r.mergedEdgePairs == 1, "defect: 1 edge pair merged (still geometrically coincident)");
        check(r.misoriented.size() == 1, "defect: EXACTLY 1 mis-oriented pair detected");
        check(!r.misoriented.empty() &&
              ((r.misoriented[0].faceA == A && r.misoriented[0].faceB == B) ||
               (r.misoriented[0].faceA == B && r.misoriented[0].faceB == A)),
              "defect: the mis-oriented pair is (A,B)");
    }
}

int main() {
    std::printf("=== forge::native::brep — K1.4 SEW / DIAGNOSE / HEAL gate ===\n");
    testBoxSewClosed();
    testBoxOpenFourFree();
    testMisorientationDetected();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
