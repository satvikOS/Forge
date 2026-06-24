// forge/native/brep/hlr_test.cpp
//
// Standalone validation gate for HIDDEN-LINE REMOVAL (HLR) on the Forge native
// B-rep (Hlr.hpp/.cpp) — the OCCT HLRBRep_Algo analogue used to generate 2D
// engineering drawings (orthographic views) from a solid. Pure C++20, no external
// dependencies, no test framework — a tiny hand-rolled harness that prints
// PASS/FAIL and exits non-zero on any failure (mirrors k0_topology_test.cpp).
//
// Build + run (SINGLE clang, no cmake-js / no run_native.sh):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Hlr.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/test/native/brep/hlr_test.cpp \
//     -o /tmp/hlr_test && /tmp/hlr_test
//
// VALIDATION GATE (asserted below):
//   (1) THE CLASSIC BOX DRAWING. A unit cube viewed along an ISOMETRIC direction
//       (so three faces are seen) yields the textbook orthographic-drawing result:
//       9 VISIBLE edges (drawn solid) + 3 HIDDEN edges (drawn dashed — the three
//       edges meeting at the single rear-most occluded corner). We assert exactly
//       9 fully-visible + 3 fully-hidden B-rep edges (12 total), and that the 3
//       hidden edges are the ones incident to the back corner.
//   (2) AXIS FRONT VIEW. The same cube viewed straight down an axis (front view)
//       projects the front and back faces onto the same square; the 4 silhouette
//       edges are visible and the 4 far (back) edges + connecting depth edges are
//       depth-tested — we assert the back face's 4 edges classify hidden.
//   (3) THROUGH-HOLE FAR RIM. A block with a square through-hole, viewed down the
//       hole axis offset isometrically, hides the hole's FAR rim (the back opening)
//       behind the front face while the near rim stays visible.

#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

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
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}

// ===========================================================================
// Build a block [0,W]x[0,D]x[0,H] with a SQUARE through-hole of half-size `hr`
// centred at (cx,cy) running the full height in Z. Reuses the public Euler
// operator API exactly like k0_topology_test's buildBlockWithHole, with N=4 so
// the hole rims are clean square loops (4 edges each).
// ===========================================================================
static Solid* buildBlockWithSquareHole(TopologyBuilder& tb,
                                        double W, double D, double H,
                                        double cx, double cy, double hr) {
    Vertex* o[8];
    o[0] = tb.makeVertex({0, 0, 0});
    o[1] = tb.makeVertex({W, 0, 0});
    o[2] = tb.makeVertex({W, D, 0});
    o[3] = tb.makeVertex({0, D, 0});
    o[4] = tb.makeVertex({0, 0, H});
    o[5] = tb.makeVertex({W, 0, H});
    o[6] = tb.makeVertex({W, D, H});
    o[7] = tb.makeVertex({0, D, H});

    // Square hole corners (CCW in XY), bottom + top.
    const double hx[4] = {cx - hr, cx + hr, cx + hr, cx - hr};
    const double hy[4] = {cy - hr, cy - hr, cy + hr, cy + hr};
    Vertex* hb[4]; Vertex* ht[4];
    for (int i = 0; i < 4; ++i) {
        hb[i] = tb.makeVertex({hx[i], hy[i], 0});
        ht[i] = tb.makeVertex({hx[i], hy[i], H});
    }

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // Bottom cap (-Z): outer CCW-from-below 0,3,2,1; inner hole CCW-in-XY.
    {
        Face* bottom = tb.makeFace();
        tb.addFaceToShell(shell, bottom);
        std::vector<Vertex*> outer = {o[0], o[3], o[2], o[1]};
        tb.addOuterLoopToFace(bottom, outer);
        std::vector<Vertex*> inner = {hb[0], hb[1], hb[2], hb[3]};
        tb.addInnerLoopToFace(bottom, inner);
    }
    // Top cap (+Z): outer CCW-from-above 4,5,6,7; inner hole reversed.
    {
        Face* top = tb.makeFace();
        tb.addFaceToShell(shell, top);
        std::vector<Vertex*> outer = {o[4], o[5], o[6], o[7]};
        tb.addOuterLoopToFace(top, outer);
        std::vector<Vertex*> inner = {ht[0], ht[3], ht[2], ht[1]}; // reversed
        tb.addInnerLoopToFace(top, inner);
    }
    // 4 outer side walls.
    const int wall[4][4] = {
        {0, 1, 5, 4}, {1, 2, 6, 5}, {2, 3, 7, 6}, {3, 0, 4, 7},
    };
    for (auto& wq : wall) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {o[wq[0]], o[wq[1]], o[wq[2]], o[wq[3]]};
        tb.addOuterLoopToFace(f, ring);
    }
    // 4 inner hole walls (mate the cap rings in opposite sense).
    for (int i = 0; i < 4; ++i) {
        int j = (i + 1) % 4;
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {hb[j], hb[i], ht[i], ht[j]};
        tb.addOuterLoopToFace(f, ring);
    }
    return solid;
}

// Attach an outward-normal analytic Plane surface to every face of a bare box so
// the tessellator's winding (and our depth soup) sees consistent geometry. (HLR
// works on bare polygon faces too, but the box builder leaves surface==null; we
// don't actually need surfaces for the depth test, which fans the loop polygon.)

int main() {
    std::printf("=== HLR (hidden-line removal) gate ===\n\n");

    // -----------------------------------------------------------------------
    // (1) Classic box drawing: unit cube, isometric view => 9 visible + 3 hidden.
    // -----------------------------------------------------------------------
    std::printf("[1] classic box: isometric view -> 9 solid + 3 dashed\n");
    {
        TopologyBuilder tb;
        Solid* box = tb.buildBox({0, 0, 0}, {1, 1, 1});

        // Isometric-style view direction: looking from the (+1,+1,+1) corner
        // toward the origin, i.e. view dir = (-1,-1,-1). Three faces face the
        // viewer; the rear corner (0,0,0) is fully occluded.
        Vec3 viewDir{-1, -1, -1};
        HlrResult r = hiddenLineRemoval(*box, viewDir);

        std::printf("      ok=%d totalEdges=%u  visSeg=%u hidSeg=%u\n",
                    (int)r.ok, r.totalEdges, r.visibleSegments, r.hiddenSegments);
        std::printf("      fullyVisibleEdges=%u fullyHiddenEdges=%u partialEdges=%u\n",
                    r.fullyVisibleEdges, r.fullyHiddenEdges, r.partialEdges);
        std::printf("      visibleLen2d=%.6f hiddenLen2d=%.6f\n",
                    r.visibleLength2d, r.hiddenLength2d);

        check(r.ok, "HLR ran ok");
        check(r.totalEdges == 12, "cube has 12 collected edges");
        check(r.fullyVisibleEdges == 9, "9 fully-VISIBLE edges (solid lines)");
        check(r.fullyHiddenEdges == 3, "3 fully-HIDDEN edges (dashed lines)");
        check(r.partialEdges == 0, "no partially-split edges in pure iso view");
        check(r.visibleSegments == 9, "9 visible segments");
        check(r.hiddenSegments == 3, "3 hidden segments");

        // The 3 hidden edges must all touch the back corner (0,0,0).
        bool allHiddenTouchBack = true;
        int hiddenCount = 0;
        for (const auto& s : r.segments) {
            if (s.visibility != HlrVisibility::Hidden) continue;
            ++hiddenCount;
            bool touches = false;
            for (const Vec3& p : s.poly3d) {
                if (std::fabs(p.x) < 1e-9 && std::fabs(p.y) < 1e-9 &&
                    std::fabs(p.z) < 1e-9) { touches = true; break; }
            }
            if (!touches) allHiddenTouchBack = false;
        }
        check(hiddenCount == 3 && allHiddenTouchBack,
              "all 3 hidden edges meet the occluded back corner (0,0,0)");
    }

    // -----------------------------------------------------------------------
    // (2) Axis FRONT view: looking along -Y. Back face (y=max) edges are hidden.
    // -----------------------------------------------------------------------
    std::printf("\n[2] axis front view (look along -Y): back-face edges hidden\n");
    {
        TopologyBuilder tb;
        Solid* box = tb.buildBox({0, 0, 0}, {2, 2, 2});
        // Look along -Y (viewer at +Y looking toward -Y). The y=2 face is nearest;
        // the y=0 (back) face's 4 edges are directly behind it -> hidden.
        Vec3 viewDir{0, -1, 0};
        HlrResult r = hiddenLineRemoval(*box, viewDir);

        std::printf("      ok=%d totalEdges=%u visSeg=%u hidSeg=%u\n",
                    (int)r.ok, r.totalEdges, r.visibleSegments, r.hiddenSegments);
        std::printf("      fullyVisibleEdges=%u fullyHiddenEdges=%u partialEdges=%u\n",
                    r.fullyVisibleEdges, r.fullyHiddenEdges, r.partialEdges);

        check(r.ok, "HLR ran ok");
        check(r.totalEdges == 12, "cube has 12 collected edges");

        // Count edges whose 3D polyline lies entirely on the back face y == 0.
        int backEdgesHidden = 0;
        for (const auto& s : r.segments) {
            if (s.visibility != HlrVisibility::Hidden) continue;
            bool onBack = true;
            for (const Vec3& p : s.poly3d)
                if (std::fabs(p.y - 0.0) > 1e-9) { onBack = false; break; }
            if (onBack) ++backEdgesHidden;
        }
        std::printf("      hidden edges lying on the back face (y=0): %d\n",
                    backEdgesHidden);
        check(backEdgesHidden == 4, "all 4 back-face edges classify HIDDEN");
    }

    // -----------------------------------------------------------------------
    // (3) Through-hole: the hole's FAR rim is hidden behind the front face.
    // -----------------------------------------------------------------------
    std::printf("\n[3] block with square through-hole: far rim hidden\n");
    {
        TopologyBuilder tb;
        // 4x4x4 block, 1x1 square hole centred at (2,2) through Z.
        Solid* blk = buildBlockWithSquareHole(tb, 4, 4, 4, 2, 2, 0.5);

        // View down the hole axis but tilted so we see depth: look along
        // (-0.2,-0.2,-1) — mostly down -Z (top toward bottom), slightly oblique so
        // the near (top, z=4) rim occludes the far (bottom, z=0) rim.
        Vec3 viewDir{-0.2, -0.2, -1};
        HlrResult r = hiddenLineRemoval(*blk, viewDir);

        std::printf("      ok=%d totalEdges=%u visSeg=%u hidSeg=%u\n",
                    (int)r.ok, r.totalEdges, r.visibleSegments, r.hiddenSegments);
        std::printf("      fullyVisibleEdges=%u fullyHiddenEdges=%u partialEdges=%u\n",
                    r.fullyVisibleEdges, r.fullyHiddenEdges, r.partialEdges);
        std::printf("      visibleLen2d=%.6f hiddenLen2d=%.6f\n",
                    r.visibleLength2d, r.hiddenLength2d);

        check(r.ok, "HLR ran ok");
        // Block-with-square-hole edge count: 12 (box) + 3*4 (hole) = 24.
        check(r.totalEdges == 24, "block+square-hole has 24 collected edges");

        // The far hole rim is the 4 hole edges on the bottom cap (z == 0). They
        // sit directly under the solid top cap (z=4) -> hidden. Count hidden
        // segments lying entirely on z==0 AND inside the hole footprint.
        int farRimHidden = 0;
        for (const auto& s : r.segments) {
            if (s.visibility != HlrVisibility::Hidden) continue;
            bool onBottom = true, inHole = true;
            for (const Vec3& p : s.poly3d) {
                if (std::fabs(p.z - 0.0) > 1e-9) onBottom = false;
                if (std::fabs(p.x - 2.0) > 0.5 + 1e-6 ||
                    std::fabs(p.y - 2.0) > 0.5 + 1e-6) inHole = false;
            }
            if (onBottom && inHole) ++farRimHidden;
        }
        std::printf("      far-rim (bottom hole) edges classified hidden: %d\n",
                    farRimHidden);
        check(farRimHidden == 4, "all 4 far-rim (far hole) edges HIDDEN");

        // The near hole rim (top cap z==4) must be VISIBLE.
        int nearRimVisible = 0;
        for (const auto& s : r.segments) {
            if (s.visibility != HlrVisibility::Visible) continue;
            bool onTop = true, inHole = true;
            for (const Vec3& p : s.poly3d) {
                if (std::fabs(p.z - 4.0) > 1e-9) onTop = false;
                if (std::fabs(p.x - 2.0) > 0.5 + 1e-6 ||
                    std::fabs(p.y - 2.0) > 0.5 + 1e-6) inHole = false;
            }
            if (onTop && inHole) ++nearRimVisible;
        }
        std::printf("      near-rim (top hole) edges classified visible: %d\n",
                    nearRimVisible);
        check(nearRimVisible == 4, "all 4 near-rim (near hole) edges VISIBLE");
    }

    std::printf("\n=== %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
