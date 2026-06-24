// forge-kernel/test/native_vs_occt_hlr.cpp
//
// 1:1 A/B harness: Forge NATIVE hidden-line removal (forge::native::brep::Hlr)
// vs OPEN CASCADE (OCCT 7.9.3) HLRBRep_Algo / HLRAlgo_Projector / HLRBRep_HLRToShape.
//
// PURPOSE -------------------------------------------------------------------
// Validate the native HLR against the industry reference (OCCT) on the exact
// two cases the native gate (test/native/brep/hlr_test.cpp) asserts:
//
//   CASE A  unit cube [0,1]^3, ISO view direction (-1,-1,-1)
//           native gate: 9 visible + 3 hidden segments,
//                        V-len 7.348469 / H-len 2.449490.
//
//   CASE B  4x4x4 block minus a 1x1 square through-hole (centred at (2,2),
//           full height in Z), view direction (-0.2,-0.2,-1)
//           native gate: 13 visible + 11 hidden segments,
//                        V-len 30.742576 / H-len 17.218992.
//
// On the OCCT side the SAME shapes are built (BRepPrimAPI_MakeBox; the holed
// block via BRepAlgoAPI_Cut of a 4x4x4 box minus a 1x1x(>height) prism), HLR
// is run with an ORTHOGRAPHIC HLRAlgo_Projector whose main (Z) direction is the
// matching view direction, Update()+Hide() are called, and HLRBRep_HLRToShape
// yields VCompound (visible) + HCompound (hidden).
//
// METRIC --------------------------------------------------------------------
// OCCT FRAGMENTS edges (it splits a model edge at every visibility / outline
// crossing), so the raw edge COUNT will not match the native per-edge counts —
// that is expected and noted. The robust, kernel-agnostic comparison is the
// SUMMED PROJECTED LENGTH per visibility class, measured in the plane
// orthogonal to the view direction (the N depth component dropped), which both
// sides compute identically. PASS iff per-class length agrees rel <= 1e-6.
//
// BUILD (standalone, single clang — no cmake-js / no native gate touched):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     test/native_vs_occt_hlr.cpp \
//     src/native/brep/Hlr.cpp src/native/brep/Topology.cpp \
//     src/native/brep/Surface.cpp src/native/brep/Curve.cpp \
//     src/native/brep/Nurbs.cpp src/native/brep/NurbsSurface.cpp \
//     src/native/mesh/HalfEdgeMesh.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKHLR -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_hlr && /tmp/native_vs_occt_hlr

// ----- NATIVE kernel ------------------------------------------------------
#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

// ----- OCCT ---------------------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <HLRAlgo_Projector.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRep_Tool.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GCPnts_QuasiUniformAbscissa.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

// ===========================================================================
// Small math for the projected-length metric (shared by both sides).
// Project a 3D point onto the plane orthogonal to unit view-dir N by dropping
// the N component, then measure 2D length. Rotation of the in-plane (U,V)
// axes does not change a length, so this is directly comparable to the native
// HlrSegment::length2d regardless of which U/V frame OCCT vs Forge picks.
// ===========================================================================
struct V3 { double x, y, z; };
static V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static double norm3(const V3& a) { return std::sqrt(dot(a, a)); }
static V3 unit3(const V3& a) { double n = norm3(a); return {a.x / n, a.y / n, a.z / n}; }

// length of segment p0->p1 projected onto the plane orthogonal to unit N.
static double projLen(const V3& p0, const V3& p1, const V3& N) {
    V3 d = sub(p1, p0);
    double dn = dot(d, N);
    double full2 = dot(d, d);
    double perp2 = full2 - dn * dn;          // |d|^2 - (d.N)^2
    return perp2 > 0.0 ? std::sqrt(perp2) : 0.0;
}

// ===========================================================================
// NATIVE side: build the same block-with-square-hole as the native gate
// (mirrors buildBlockWithSquareHole in test/native/brep/hlr_test.cpp).
// ===========================================================================
static Solid* nativeBlockWithSquareHole(TopologyBuilder& tb,
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

    {   // bottom cap (-Z) with hole
        Face* bottom = tb.makeFace();
        tb.addFaceToShell(shell, bottom);
        std::vector<Vertex*> outer = {o[0], o[3], o[2], o[1]};
        tb.addOuterLoopToFace(bottom, outer);
        std::vector<Vertex*> inner = {hb[0], hb[1], hb[2], hb[3]};
        tb.addInnerLoopToFace(bottom, inner);
    }
    {   // top cap (+Z) with hole (reversed)
        Face* top = tb.makeFace();
        tb.addFaceToShell(shell, top);
        std::vector<Vertex*> outer = {o[4], o[5], o[6], o[7]};
        tb.addOuterLoopToFace(top, outer);
        std::vector<Vertex*> inner = {ht[0], ht[3], ht[2], ht[1]};
        tb.addInnerLoopToFace(top, inner);
    }
    const int wall[4][4] = {
        {0, 1, 5, 4}, {1, 2, 6, 5}, {2, 3, 7, 6}, {3, 0, 4, 7},
    };
    for (auto& wq : wall) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {o[wq[0]], o[wq[1]], o[wq[2]], o[wq[3]]};
        tb.addOuterLoopToFace(f, ring);
    }
    for (int i = 0; i < 4; ++i) {
        int j = (i + 1) % 4;
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {hb[j], hb[i], ht[i], ht[j]};
        tb.addOuterLoopToFace(f, ring);
    }
    return solid;
}

// ===========================================================================
// OCCT side: run HLR on a shape with the orthographic projector whose main
// direction is `viewDir`; accumulate visible/hidden projected length + count.
// ===========================================================================
struct OcctHlr {
    int vCount = 0, hCount = 0;     // raw OCCT result edge counts (will fragment)
    double vLen = 0.0, hLen = 0.0;  // summed projected length per class
};

// 2D screen length of segment p0->p1 in OCCT's PROJECTED frame: HLRToShape
// returns its result edges already rotated into the projector's coordinate
// system where (X,Y) is the drawing plane and Z is the depth along the view
// direction. So the true projected (drawing) length is the 2D length in (X,Y)
// — drop the result Z. This equals the native HlrSegment::length2d (Forge's
// own (U,V) image), making the two sides directly comparable.
static double screenLen2d(const gp_Pnt& a, const gp_Pnt& b) {
    double dx = b.X() - a.X();
    double dy = b.Y() - a.Y();
    return std::sqrt(dx * dx + dy * dy);
}

// Sum the projected (drawing-plane) length over every edge of an HLR result
// compound, sampling each edge with GCPnts so a curved result edge contributes
// its true arc length (the straight box/hole edges need only 2 points, but
// sampling is robust either way).
static void accumulateCompound(const TopoDS_Shape& comp,
                               int& count, double& len) {
    for (TopExp_Explorer ex(comp, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Edge e = TopoDS::Edge(ex.Current());
        ++count;
        BRepAdaptor_Curve ad(e);
        GCPnts_QuasiUniformAbscissa distrib(ad, 24);
        if (!distrib.IsDone() || distrib.NbPoints() < 2) {
            // fall back to endpoints
            gp_Pnt a = ad.Value(ad.FirstParameter());
            gp_Pnt b = ad.Value(ad.LastParameter());
            len += screenLen2d(a, b);
            continue;
        }
        gp_Pnt prev = ad.Value(distrib.Parameter(1));
        for (int i = 2; i <= distrib.NbPoints(); ++i) {
            gp_Pnt cur = ad.Value(distrib.Parameter(i));
            len += screenLen2d(prev, cur);
            prev = cur;
        }
    }
}

static OcctHlr runOcctHlr(const TopoDS_Shape& shape, const V3& viewDir) {
    OcctHlr out;
    V3 N = unit3(viewDir);

    Handle(HLRBRep_Algo) algo = new HLRBRep_Algo();
    algo->Add(shape);

    // Orthographic projector: gp_Ax2 main direction (Z) == the view direction.
    gp_Ax2 cs(gp_Pnt(0, 0, 0), gp_Dir(N.x, N.y, N.z));
    HLRAlgo_Projector projector(cs);          // orthographic (no focus)
    algo->Projector(projector);
    algo->Update();
    algo->Hide();

    HLRBRep_HLRToShape toShape(algo);
    TopoDS_Shape vis = toShape.VCompound();   // visible (sharp) edges
    TopoDS_Shape hid = toShape.HCompound();   // hidden  (sharp) edges

    if (!vis.IsNull()) accumulateCompound(vis, out.vCount, out.vLen);
    if (!hid.IsNull()) accumulateCompound(hid, out.hCount, out.hLen);
    return out;
}

// ===========================================================================
// Comparison + reporting.
// ===========================================================================
static int g_pass = 0, g_total = 0;

static bool relClose(double a, double b, double rel) {
    double denom = std::max(std::fabs(a), std::fabs(b));
    if (denom < 1e-300) return std::fabs(a - b) <= rel;
    return std::fabs(a - b) / denom <= rel;
}

static void report(const char* label, const HlrResult& nat, const OcctHlr& occ) {
    constexpr double kRel = 1e-6;
    std::printf("\n--- %s ---\n", label);
    std::printf("  NATIVE: visSeg=%u hidSeg=%u  V-len=%.6f  H-len=%.6f\n",
                nat.visibleSegments, nat.hiddenSegments,
                nat.visibleLength2d, nat.hiddenLength2d);
    std::printf("  OCCT  : visEdg=%d hidEdg=%d  V-len=%.6f  H-len=%.6f\n",
                occ.vCount, occ.hCount, occ.vLen, occ.hLen);

    double vRel = std::fabs(nat.visibleLength2d - occ.vLen) /
                  std::max({std::fabs(nat.visibleLength2d), std::fabs(occ.vLen), 1e-300});
    double hRel = std::fabs(nat.hiddenLength2d - occ.hLen) /
                  std::max({std::fabs(nat.hiddenLength2d), std::fabs(occ.hLen), 1e-300});
    std::printf("  REL   : V-len rel=%.3e  H-len rel=%.3e  (gate rel<=%.0e)\n",
                vRel, hRel, kRel);

    bool countMatch = (occ.vCount == (int)nat.visibleSegments) &&
                      (occ.hCount == (int)nat.hiddenSegments);
    std::printf("  NOTE  : edge-count %s (OCCT splits edges at outline/visibility crossings)\n",
                countMatch ? "matches exactly" : "DIFFERS — expected; using length metric");

    // TOTAL projected drawing length (visible + hidden): a kernel-agnostic
    // GEOMETRY-TRUTH check — it does not depend on how the visible/hidden
    // boundary is split, so it isolates "same projected geometry" from
    // "same visibility classification".
    double natTot = nat.visibleLength2d + nat.hiddenLength2d;
    double occTot = occ.vLen + occ.hLen;
    double tRel = std::fabs(natTot - occTot) / std::max({natTot, occTot, 1e-300});
    std::printf("  TOTAL : native=%.6f  occt=%.6f  rel=%.3e  (projected-geometry truth)\n",
                natTot, occTot, tRel);

    ++g_total;
    bool ok = relClose(nat.visibleLength2d, occ.vLen, kRel) &&
              relClose(nat.hiddenLength2d, occ.hLen, kRel);
    if (ok) { ++g_pass; std::printf("  [PASS] per-class projected length agrees rel<=1e-6\n"); }
    else {
        std::printf("  [FAIL] per-class projected length differs\n");
        if (relClose(natTot, occTot, kRel))
            std::printf("         (but TOTAL projected length matches rel<=1e-6 -> identical\n"
                        "          geometry; the gap is sampled-z-buffer vs OCCT exact-analytic\n"
                        "          visible/hidden SPLIT inside the hole, per Hlr.hpp envelope)\n");
    }
}

int main() {
    std::printf("=== NATIVE Forge HLR  vs  OCCT 7.9.3 HLRBRep_Algo  (A/B 1:1) ===\n");

    // -----------------------------------------------------------------------
    // CASE A — unit cube [0,1]^3, ISO view direction (-1,-1,-1).
    // -----------------------------------------------------------------------
    {
        const V3 viewDir{-1, -1, -1};

        // NATIVE
        TopologyBuilder tb;
        Solid* box = tb.buildBox({0, 0, 0}, {1, 1, 1});
        HlrResult nat = hiddenLineRemoval(*box, Vec3{viewDir.x, viewDir.y, viewDir.z});

        // OCCT — same unit box.
        TopoDS_Shape occBox = BRepPrimAPI_MakeBox(1.0, 1.0, 1.0).Shape();
        OcctHlr occ = runOcctHlr(occBox, viewDir);

        report("CASE A: unit cube, iso view (-1,-1,-1)", nat, occ);
    }

    // -----------------------------------------------------------------------
    // CASE B — 4x4x4 block minus a 1x1 square through-hole at (2,2),
    //          view direction (-0.2,-0.2,-1).
    // -----------------------------------------------------------------------
    {
        const V3 viewDir{-0.2, -0.2, -1};

        // NATIVE — Euler-built block with a square hole (matches the gate).
        TopologyBuilder tb;
        Solid* blk = nativeBlockWithSquareHole(tb, 4, 4, 4, 2, 2, 0.5);
        HlrResult nat = hiddenLineRemoval(*blk, Vec3{viewDir.x, viewDir.y, viewDir.z});

        // OCCT — 4x4x4 box minus a 1x1 prism running the full Z height. The
        // hole spans x in [1.5,2.5], y in [1.5,2.5]; make the cutter taller than
        // the block (z in [-1,5]) so it is a clean through-hole with both rims
        // coincident with the caps (exactly the native solid).
        TopoDS_Shape block = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 4.0, 4.0, 4.0).Shape();
        TopoDS_Shape cutter = BRepPrimAPI_MakeBox(gp_Pnt(1.5, 1.5, -1.0),
                                                  1.0, 1.0, 6.0).Shape();
        TopoDS_Shape holed = BRepAlgoAPI_Cut(block, cutter).Shape();
        OcctHlr occ = runOcctHlr(holed, viewDir);

        report("CASE B: 4x4x4 block - 1x1 through-hole, view (-0.2,-0.2,-1)", nat, occ);
    }

    std::printf("\n=== %d / %d length comparisons passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
