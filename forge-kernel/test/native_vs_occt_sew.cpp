// forge-kernel/test/native_vs_occt_sew.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native K1.4 sew/heal  vs  OCCT BRepBuilderAPI_Sewing.
//
// This is a STANDALONE C++20 oracle test that LINKS OCCT (brew opencascade 7.9.3).
// It is NOT part of the native gate (run_native.sh) and does NOT touch
// binding.cpp / CMakeLists.txt. It builds the SAME geometric cases on BOTH sides
// and compares the topology signature that K1.4 must match OCCT on:
//
//   CASE 1  closed box  : the 6 planar quad faces of an L-cube, sewn.
//             GATE: free-edge count (both 0), closed (both true), F/E/V (6/12/8).
//   CASE 2  open box    : drop the top face -> 5 faces, sewn.
//             GATE: free-edge count (both 4), closed (both false), F/E/V (5/12/8).
//
// Native side: forge::native::brep::sewFaces over 6 (resp. 5) INDEPENDENT faces
//   built EXACTLY as test/native/brep/sew_test.cpp::buildIndependentBoxFaces does
//   (private fresh vertices per face -> 24 verts / 24 edges pre-sew). The native
//   diagnosis reports V/E/F, freeEdges, closed directly.
//
// OCCT side: each box face is an independent TopoDS_Face built with
//   BRepBuilderAPI_MakeFace(gp_Pln, wire) where the wire is the 4 box corners of
//   that face (BRepBuilderAPI_MakePolygon, closed). All faces are Add()'d to a
//   BRepBuilderAPI_Sewing sewer with the same tolerance; Perform() yields a shell.
//   FREE EDGES are counted via TopExp::MapShapesAndAncestors(result, EDGE, FACE)
//   = edges whose face-ancestor list has exactly 1 face. CLOSED = (free == 0).
//   V/E/F counted with TopExp::MapShapesAndAncestors / TopTools maps.
//
// Build + run (manual; mirrors the sew_test.cpp build line + OCCT flags):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Sew.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Topology.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Surface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Curve.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_sew.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase -lTKPrim -lTKShHealing \
//     -o /tmp/native_vs_occt_sew && /tmp/native_vs_occt_sew

// --- native K1.4 ----------------------------------------------------------
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

// --- OCCT -----------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>
#include <gp_Dir.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>

#include <array>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

// ===========================================================================
// shared geometry: 8 corners of the axis-aligned cube [0,L]^3 + the 6 CCW
// (outward-normal) rings, IDENTICAL to sew_test.cpp::buildIndependentBoxFaces.
// ===========================================================================
static const int kRings[6][4] = {
    {0, 3, 2, 1}, // bottom (-Z)
    {4, 5, 6, 7}, // top    (+Z)
    {0, 1, 5, 4}, // front  (-Y)
    {2, 3, 7, 6}, // back   (+Y)
    {0, 4, 7, 3}, // left   (-X)
    {1, 2, 6, 5}, // right  (+X)
};

static std::array<std::array<double, 3>, 8> cubeCorners(double L) {
    const double a = 0.0, b = L;
    return {{
        {a, a, a}, {b, a, a}, {b, b, a}, {a, b, a},  // 0..3  z=a (bottom)
        {a, a, b}, {b, a, b}, {b, b, b}, {a, b, b},  // 4..7  z=b (top)
    }};
}

// ---------------------------------------------------------------------------
// A topology signature both sides fill in for direct comparison.
// ---------------------------------------------------------------------------
struct Sig {
    long long V = -1, E = -1, F = -1;
    long long freeEdges = -1;
    bool closed = false;
    bool valid = false;
};

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

// ===========================================================================
// NATIVE side: build N independent box faces (exactly sew_test's construction)
// and sew them. `keep` selects which of the 6 ring indices to include.
// ===========================================================================
static Sig nativeSew(const std::vector<int>& keep, double L) {
    auto C = cubeCorners(L);
    TopologyBuilder tb;
    std::vector<Face*> faces;
    for (int ri : keep) {
        Face* f = tb.makeFace();
        std::vector<Vertex*> ring;
        for (int k = 0; k < 4; ++k) {
            const auto& p = C[kRings[ri][k]];
            ring.push_back(tb.makeVertex({p[0], p[1], p[2]}));
        }
        tb.addOuterLoopToFace(f, ring);   // private fresh edges/vertices
        faces.push_back(f);
    }

    SewOptions opt;
    opt.tol = 1e-6;
    SewResult r = sewFaces(tb, faces, opt);

    Sig s;
    s.valid = r.ok;
    const SewDiagnosis& d = r.diagnosis;
    s.V = static_cast<long long>(d.vertices);
    s.E = static_cast<long long>(d.edges);
    s.F = static_cast<long long>(d.faces);
    s.freeEdges = static_cast<long long>(d.freeEdges);
    s.closed = d.closed;
    return s;
}

// ===========================================================================
// OCCT side: build the same faces as independent TopoDS_Face on a gp_Pln +
// closed polygon wire, Add to BRepBuilderAPI_Sewing, Perform, inspect.
// ===========================================================================
static TopoDS_Face occtBoxFace(const std::array<std::array<double, 3>, 8>& C, int ri) {
    // The 4 corners of this ring, as a closed polygon wire.
    BRepBuilderAPI_MakePolygon poly;
    gp_Pnt pts[4];
    for (int k = 0; k < 4; ++k) {
        const auto& p = C[kRings[ri][k]];
        pts[k] = gp_Pnt(p[0], p[1], p[2]);
        poly.Add(pts[k]);
    }
    poly.Close();
    const TopoDS_Wire wire = poly.Wire();

    // Supporting plane: anchor at corner 0 of the ring, normal from the ring's
    // two edge vectors (right-hand rule -> outward, matching the CCW winding).
    const gp_Pnt p0 = pts[0];
    const gp_Vec u(p0, pts[1]);
    const gp_Vec v(p0, pts[3]);
    gp_Vec n = u.Crossed(v);
    const gp_Pln pln(p0, gp_Dir(n));

    // Make the planar face bounded by the wire on that plane.
    BRepBuilderAPI_MakeFace mf(pln, wire, /*Inside=*/Standard_True);
    return mf.Face();
}

// Count free edges of a sewn result: edges with exactly ONE face ancestor.
static long long occtFreeEdgeCount(const TopoDS_Shape& shape) {
    TopTools_IndexedDataMapOfShapeListOfShape edge2face;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge2face);
    long long freeCount = 0;
    for (Standard_Integer i = 1; i <= edge2face.Extent(); ++i) {
        if (edge2face.FindFromIndex(i).Extent() == 1) ++freeCount;
    }
    return freeCount;
}

static long long occtCount(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(shape, kind, m);
    return static_cast<long long>(m.Extent());
}

static Sig occtSew(const std::vector<int>& keep, double L) {
    auto C = cubeCorners(L);
    BRepBuilderAPI_Sewing sewer(1e-6);
    for (int ri : keep) sewer.Add(occtBoxFace(C, ri));
    sewer.Perform();
    const TopoDS_Shape& result = sewer.SewedShape();

    Sig s;
    s.valid = !result.IsNull();
    s.V = occtCount(result, TopAbs_VERTEX);
    s.E = occtCount(result, TopAbs_EDGE);
    s.F = occtCount(result, TopAbs_FACE);
    s.freeEdges = occtFreeEdgeCount(result);
    // CLOSED == watertight == zero free edges (every edge shared by 2 faces).
    s.closed = (s.freeEdges == 0);
    return s;
}

// ===========================================================================
// Compare one case across the two oracles.
// ===========================================================================
static void runCase(const char* title,
                    const std::vector<int>& keep,
                    double L,
                    long long expF, long long expE, long long expV,
                    long long expFree, bool expClosed) {
    std::printf("\n=== CASE: %s ===\n", title);
    const Sig nat = nativeSew(keep, L);
    const Sig occ = occtSew(keep, L);

    std::printf("  NATIVE : V=%lld E=%lld F=%lld  free=%lld  closed=%s  (ok=%d)\n",
                nat.V, nat.E, nat.F, nat.freeEdges, nat.closed ? "true" : "false", nat.valid);
    std::printf("  OCCT   : V=%lld E=%lld F=%lld  free=%lld  closed=%s  (ok=%d)\n",
                occ.V, occ.E, occ.F, occ.freeEdges, occ.closed ? "true" : "false", occ.valid);

    // 1:1 MATCH gates (native vs OCCT) -------------------------------------
    check(nat.valid,                          "native sew ok");
    check(occ.valid,                          "occt   sew ok");
    check(nat.freeEdges == occ.freeEdges,     "free-edge count MATCHES (native == occt)");
    check(nat.closed   == occ.closed,         "closedness MATCHES (native == occt)");
    check(nat.F == occ.F,                     "F (faces) MATCHES");
    check(nat.E == occ.E,                     "E (edges) MATCHES");
    check(nat.V == occ.V,                     "V (verts) MATCHES");

    // Absolute expected-value gates (both sides hit the closed-form oracle) --
    check(nat.F == expF && occ.F == expF,     "F == expected");
    check(nat.E == expE && occ.E == expE,     "E == expected");
    check(nat.V == expV && occ.V == expV,     "V == expected");
    check(nat.freeEdges == expFree && occ.freeEdges == expFree, "free edges == expected");
    check(nat.closed == expClosed && occ.closed == expClosed,   "closedness == expected");
}

int main() {
    std::printf("=== A/B 1:1  native K1.4 sew  vs  OCCT BRepBuilderAPI_Sewing ===\n");
    const double L = 3.0;

    // CASE 1: all 6 faces -> closed watertight shell.
    //   F=6 E=12 V=8  free=0  closed=true  (Euler 8-12+6 = 2)
    runCase("closed box (6 faces)", {0, 1, 2, 3, 4, 5}, L,
            /*F*/6, /*E*/12, /*V*/8, /*free*/0, /*closed*/true);

    // CASE 2: drop the TOP face (ring index 1) -> open shell, 4 free edges.
    //   F=5 E=12 V=8  free=4  closed=false
    runCase("open box (5 faces, top removed)", {0, 2, 3, 4, 5}, L,
            /*F*/5, /*E*/12, /*V*/8, /*free*/4, /*closed*/false);

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
