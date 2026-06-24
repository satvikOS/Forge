// forge-kernel/test/native_vs_occt_fillet_ext.cpp
//
// RIGOROUS 1:1 A/B HARNESS — EXTENSION of native_vs_occt_fillet.cpp, covering the
// CONCAVE (reflex) edge fillet + the EDGE-CHAIN fillet of the native ANALYTIC
// ROLLING-BALL EDGE FILLET family (forge::native::brep) vs OCCT
// BRepFilletAPI_MakeFillet (brew opencascade 7.9.3).
//
// STANDALONE C++20 that LINKS OCCT. It is NOT part of the native gate
// (run_native.sh) and does NOT touch binding.cpp / CMakeLists.txt. It mirrors the
// gate cases of fillet_analytic_test.cpp EXACTLY on the OCCT side and compares the
// filleted solid volumes 1:1.
//
//   CASE (1) — CONCAVE reflex edge of the L-PRISM (the SAME L-block as the native
//     gate): cross-section polygon (0,0)(W,0)(W,h)(t,h)(t,D)(0,D) extruded +Z by Lz,
//     W=10 D=10 t=4 h=3 Lz=6, fillet radius Rc=1.5. The single REFLEX (interior 270
//     deg) edge runs along +Z at (t,h)=(4,3). Native filletLBlockEdgeAnalytic ADDS
//     (1 - pi/4) Rc^2 Lz of material at the inner corner; OCCT
//     BRepFilletAPI_MakeFillet adds R on that reflex edge. GATE: filleted volume
//     native vs OCCT, relative <= 1e-6.
//
//   CASE (2) — DISJOINT edge-chain {4,6}: two NON-ADJACENT box edges of box [0,L]^3
//     (L=10, R=1.5). Native edge id 4 = top-front (v4(0,0,L)->v5(L,0,L), y=0,z=L)
//     and id 6 = top-back (v6(L,L,L)->v7(0,L,L), y=L,z=L) — they share no vertex.
//     Native filletBoxEdgeChainAnalytic fillets BOTH in one call; OCCT MakeFillet
//     adds R on BOTH edges. GATE: filleted volume native vs OCCT, relative <= 1e-6.
//
//   CASE (3) — SHARED-VERTEX chain {4,5} (HONEST DIFFERENCE, NOT a gate): edges 4
//     and 5 share box corner v5=(L,0,L). The native pass HONESTLY leaves that corner
//     unblended (it is reported in unblendedCorners; the spherical/setback vertex
//     blend is a documented follow-up) while OCCT builds the spherical/setback vertex
//     blend. We REPORT both volumes + state the known honest difference. This is an
//     EXPECTED, documented follow-up — it is NOT counted as a failure.
//
// Build + run (manual; mirrors native_vs_occt_fillet.cpp's build line + OCCT link
// set; the build script at the bottom does this automatically):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     <native sources> \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_fillet_ext.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKFillet -lTKOffset -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_fillet_ext && /tmp/native_vs_occt_fillet_ext

// --- native analytic fillet ------------------------------------------------
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <BRep_Tool.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <gp_Cylinder.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

static constexpr double kPi = 3.14159265358979323846;

// Shared box parameters (MUST mirror fillet_analytic_test.cpp / native_vs_occt_fillet.cpp).
static constexpr double L = 10.0;
static constexpr double R = 1.5;

// Shared L-block parameters (MUST mirror fillet_analytic_test.cpp case (4) EXACTLY).
static constexpr double W  = 10.0;
static constexpr double D  = 10.0;
static constexpr double tt = 4.0;     // notch x-breakpoint (native 't')
static constexpr double hh = 3.0;     // notch y-breakpoint (native 'h')
static constexpr double Lz = 6.0;
static constexpr double Rc = 1.5;

// ===========================================================================
// CASE (1): CONCAVE reflex L-block edge.
// ===========================================================================
struct AB1 { bool nativeOk=false, occtOk=false; double nativeVol=0, occtVol=0; };

static AB1 case1_concave() {
    AB1 ab;

    // ---- NATIVE: filletLBlockEdgeAnalytic on the reflex inner edge ----------
    {
        TopologyBuilder tb;
        AnalyticFilletResult cc = filletLBlockEdgeAnalytic(tb, W, D, tt, hh, Lz, Rc);
        if (cc.ok && cc.solid) {
            MassProps mp = massProperties(*cc.solid, /*gaussN=*/8);
            ab.nativeVol = mp.volume;
            ab.nativeOk = true;
        } else {
            std::printf("  [native concave] NOT ok: %s\n", cc.reason);
        }
    }

    // ---- OCCT: build the SAME L-prism, fillet R on the reflex edge ----------
    {
        // Cross-section polygon (0,0)(W,0)(W,h)(t,h)(t,D)(0,D) in z=0 plane.
        BRepBuilderAPI_MakePolygon poly;
        poly.Add(gp_Pnt(0,  0,  0));
        poly.Add(gp_Pnt(W,  0,  0));
        poly.Add(gp_Pnt(W,  hh, 0));
        poly.Add(gp_Pnt(tt, hh, 0));
        poly.Add(gp_Pnt(tt, D,  0));
        poly.Add(gp_Pnt(0,  D,  0));
        poly.Close();
        TopoDS_Wire wire = poly.Wire();
        TopoDS_Face base = BRepBuilderAPI_MakeFace(wire).Face();
        // Extrude +Z by Lz to the L-prism solid.
        TopoDS_Shape prism = BRepPrimAPI_MakePrism(base, gp_Vec(0, 0, Lz)).Shape();

        // Locate the REFLEX inner edge: runs along +Z at (x,y)=(t,h)=(4,3); both its
        // endpoints are at x==t && y==h and it spans the full Lz in Z.
        TopoDS_Edge target;
        bool found = false;
        const double tol = 1e-7;
        for (TopExp_Explorer ex(prism, TopAbs_EDGE); ex.More(); ex.Next()) {
            const TopoDS_Edge e = TopoDS::Edge(ex.Current());
            TopTools_IndexedMapOfShape vmap;
            TopExp::MapShapes(e, TopAbs_VERTEX, vmap);
            if (vmap.Extent() < 2) continue;
            int hits = 0; double zmin = 1e300, zmax = -1e300;
            for (Standard_Integer i = 1; i <= vmap.Extent(); ++i) {
                gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vmap(i)));
                if (std::fabs(p.X() - tt) <= tol && std::fabs(p.Y() - hh) <= tol) ++hits;
                zmin = std::min(zmin, p.Z());
                zmax = std::max(zmax, p.Z());
            }
            if (hits == vmap.Extent() && std::fabs((zmax - zmin) - Lz) <= 1e-6) {
                target = e; found = true; break;
            }
        }
        if (!found) {
            std::printf("  [occt concave] could not locate the reflex inner edge\n");
        } else {
            BRepFilletAPI_MakeFillet fillet(prism);
            fillet.Add(Rc, target);
            fillet.Build();
            if (!fillet.IsDone()) {
                std::printf("  [occt concave] fillet Build() not done\n");
            } else {
                TopoDS_Shape result = fillet.Shape();
                if (result.IsNull()) {
                    std::printf("  [occt concave] fillet result is null\n");
                } else {
                    GProp_GProps props;
                    BRepGProp::VolumeProperties(result, props);
                    ab.occtVol = props.Mass();
                    ab.occtOk = true;
                }
            }
        }
    }
    return ab;
}

// ===========================================================================
// Generic helper: find a box edge of box [0,L]^3 matching the native enumeration.
// Native box-edge enumeration (FilletAnalytic / boxCorners):
//   v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0) v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)
//   edge 4: v4->v5  (y=0, z=L, along +X)  TOP-FRONT
//   edge 5: v5->v6  (x=L, z=L, along +Y)  TOP-RIGHT
//   edge 6: v6->v7  (y=L, z=L, along +X)  TOP-BACK
// We match an OCCT box edge by its two endpoint coordinates (order-independent).
// ===========================================================================
struct EdgeKey { double a[3], b[3]; };

static EdgeKey edgeKey(int nativeEdge) {
    switch (nativeEdge) {
        case 4: return {{0,0,L}, {L,0,L}};  // top-front
        case 5: return {{L,0,L}, {L,L,L}};  // top-right
        case 6: return {{L,L,L}, {0,L,L}};  // top-back
        default: return {{0,0,0},{0,0,0}};
    }
}

static bool sameVtx(const gp_Pnt& p, const double q[3]) {
    return std::fabs(p.X()-q[0]) <= 1e-6 && std::fabs(p.Y()-q[1]) <= 1e-6 &&
           std::fabs(p.Z()-q[2]) <= 1e-6;
}

static bool findBoxEdge(const TopoDS_Shape& box, const EdgeKey& k, TopoDS_Edge& out) {
    for (TopExp_Explorer ex(box, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        TopTools_IndexedMapOfShape vmap;
        TopExp::MapShapes(e, TopAbs_VERTEX, vmap);
        if (vmap.Extent() != 2) continue;
        gp_Pnt p1 = BRep_Tool::Pnt(TopoDS::Vertex(vmap(1)));
        gp_Pnt p2 = BRep_Tool::Pnt(TopoDS::Vertex(vmap(2)));
        const bool m = (sameVtx(p1, k.a) && sameVtx(p2, k.b)) ||
                       (sameVtx(p1, k.b) && sameVtx(p2, k.a));
        if (m) { out = e; return true; }
    }
    return false;
}

// ===========================================================================
// CASE (2): DISJOINT edge-chain {4,6}.
// ===========================================================================
struct AB2 { bool nativeOk=false, occtOk=false; double nativeVol=0, occtVol=0;
             int nativeEdges=0; bool nativeNoShared=false; };

static AB2 case2_disjointChain() {
    AB2 ab;

    // ---- NATIVE: filletBoxEdgeChainAnalytic on {4,6} ------------------------
    {
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletBoxEdgeChainAnalytic(tb, L, R, {4, 6});
        ab.nativeEdges = ch.filletedEdgeCount;
        ab.nativeNoShared = ch.unblendedCorners.empty();
        if (ch.ok && ch.solid) {
            MassProps mp = massProperties(*ch.solid, /*gaussN=*/8);
            ab.nativeVol = mp.volume;
            ab.nativeOk = true;
        } else {
            std::printf("  [native disjoint] NOT ok: %s\n", ch.reason);
        }
    }

    // ---- OCCT: box, fillet R on BOTH edges 4 and 6 --------------------------
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0,0,0), L, L, L).Shape();
        TopoDS_Edge e4, e6;
        const bool f4 = findBoxEdge(box, edgeKey(4), e4);
        const bool f6 = findBoxEdge(box, edgeKey(6), e6);
        if (!f4 || !f6) {
            std::printf("  [occt disjoint] could not locate edges 4(%d) / 6(%d)\n", f4, f6);
        } else {
            BRepFilletAPI_MakeFillet fillet(box);
            fillet.Add(R, e4);
            fillet.Add(R, e6);
            fillet.Build();
            if (!fillet.IsDone()) {
                std::printf("  [occt disjoint] fillet Build() not done\n");
            } else {
                TopoDS_Shape result = fillet.Shape();
                if (result.IsNull()) {
                    std::printf("  [occt disjoint] fillet result is null\n");
                } else {
                    GProp_GProps props;
                    BRepGProp::VolumeProperties(result, props);
                    ab.occtVol = props.Mass();
                    ab.occtOk = true;
                }
            }
        }
    }
    return ab;
}

// ===========================================================================
// CASE (3): SHARED-VERTEX chain {4,5} — HONEST DIFFERENCE, reported not gated.
// ===========================================================================
struct AB3 { bool nativeOk=false, occtOk=false; double nativeVol=0, occtVol=0;
             int nativeEdges=0; int sharedCorners=0; bool nativeClosed=false; };

static AB3 case3_sharedVertexChain() {
    AB3 ab;

    // ---- NATIVE: filletBoxEdgeChainAnalytic on {4,5} (shares corner v5) -----
    {
        TopologyBuilder tb;
        AnalyticChainFilletResult ch = filletBoxEdgeChainAnalytic(tb, L, R, {4, 5});
        ab.nativeEdges = ch.filletedEdgeCount;
        ab.sharedCorners = static_cast<int>(ch.unblendedCorners.size());
        ab.nativeClosed = ch.ok;   // honest: false because vertex blend not fabricated
        if (ch.solid) {
            // The native solid is the per-edge fillet assembly with the shared corner
            // left sharp (watertight via the caps but NOT vertex-blended). Report its
            // measured volume for the honest comparison even though ch.ok is false.
            MassProps mp = massProperties(*ch.solid, /*gaussN=*/8);
            ab.nativeVol = mp.volume;
            ab.nativeOk = true;   // "we have a native volume to report" (not a gate)
        }
    }

    // ---- OCCT: box, fillet R on BOTH edges 4 and 5 (builds the vertex blend) -
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0,0,0), L, L, L).Shape();
        TopoDS_Edge e4, e5;
        const bool f4 = findBoxEdge(box, edgeKey(4), e4);
        const bool f5 = findBoxEdge(box, edgeKey(5), e5);
        if (!f4 || !f5) {
            std::printf("  [occt shared] could not locate edges 4(%d) / 5(%d)\n", f4, f5);
        } else {
            BRepFilletAPI_MakeFillet fillet(box);
            fillet.Add(R, e4);
            fillet.Add(R, e5);
            fillet.Build();
            if (!fillet.IsDone()) {
                std::printf("  [occt shared] fillet Build() not done\n");
            } else {
                TopoDS_Shape result = fillet.Shape();
                if (result.IsNull()) {
                    std::printf("  [occt shared] fillet result is null\n");
                } else {
                    GProp_GProps props;
                    BRepGProp::VolumeProperties(result, props);
                    ab.occtVol = props.Mass();
                    ab.occtOk = true;
                }
            }
        }
    }
    return ab;
}

int main() {
    std::printf("=== A/B 1:1  native analytic rolling-ball fillet (CONCAVE + EDGE-CHAIN)  "
                "vs  OCCT BRepFilletAPI_MakeFillet ===\n\n");

    // ---- closed-form oracles for context ----------------------------------
    // CONCAVE: base L-block + (1 - pi/4) Rc^2 Lz ADDED.
    const double baseArea  = W * D - (W - tt) * (D - hh);
    const double baseVol   = baseArea * Lz;
    const double addedC    = (1.0 - kPi / 4.0) * Rc * Rc * Lz;
    const double oracleC   = baseVol + addedC;
    // DISJOINT: box - 2 * (1 - pi/4) R^2 L REMOVED.
    const double removed2  = 2.0 * (1.0 - kPi / 4.0) * R * R * L;
    const double oracle2   = L * L * L - removed2;

    // ======================================================================
    // CASE (1) CONCAVE
    // ======================================================================
    std::printf("--- CASE (1): CONCAVE reflex L-block edge "
                "(W=%.1f D=%.1f t=%.1f h=%.1f Lz=%.1f Rc=%.2f) ---\n",
                W, D, tt, hh, Lz, Rc);
    const AB1 c1 = case1_concave();
    std::printf("  NATIVE : volume = %.15f\n", c1.nativeVol);
    std::printf("  OCCT   : volume = %.15f\n", c1.occtVol);
    std::printf("  ORACLE : volume = %.15f  (= baseLblock %.6f + (1 - pi/4) Rc^2 Lz %.6f)\n",
                oracleC, baseVol, addedC);
    double c1abs = std::fabs(c1.nativeVol - c1.occtVol);
    double c1rel = (c1.occtVol != 0.0) ? c1abs / std::fabs(c1.occtVol) : 1e300;
    std::printf("  -> |native - occt| = %.6e   rel = %.6e\n", c1abs, c1rel);
    check(c1.nativeOk, "case1: native concave fillet ok");
    check(c1.occtOk, "case1: occt concave fillet ok");
    check(c1.nativeOk && c1.occtOk && c1rel <= 1e-6,
          "case1: CONCAVE filleted VOLUME native == OCCT  (relative <= 1e-6)");
    check(c1.nativeOk && std::fabs(c1.nativeVol - oracleC) / oracleC <= 1e-6,
          "case1: native concave volume == closed-form base + (1-pi/4)Rc^2 Lz (rel <= 1e-6)");
    check(c1.occtOk && std::fabs(c1.occtVol - oracleC) / oracleC <= 1e-6,
          "case1: occt concave volume == closed-form base + (1-pi/4)Rc^2 Lz (rel <= 1e-6)");

    // ======================================================================
    // CASE (2) DISJOINT chain {4,6}
    // ======================================================================
    std::printf("\n--- CASE (2): DISJOINT edge-chain {4,6} (box L=%.1f R=%.2f) ---\n", L, R);
    const AB2 c2 = case2_disjointChain();
    std::printf("  NATIVE : volume = %.15f   (edges filleted=%d, shared corners=%s)\n",
                c2.nativeVol, c2.nativeEdges, c2.nativeNoShared ? "none" : "SOME");
    std::printf("  OCCT   : volume = %.15f\n", c2.occtVol);
    std::printf("  ORACLE : volume = %.15f  (= L^3 - 2 (1 - pi/4) R^2 L)\n", oracle2);
    double c2abs = std::fabs(c2.nativeVol - c2.occtVol);
    double c2rel = (c2.occtVol != 0.0) ? c2abs / std::fabs(c2.occtVol) : 1e300;
    std::printf("  -> |native - occt| = %.6e   rel = %.6e\n", c2abs, c2rel);
    check(c2.nativeOk, "case2: native disjoint-chain fillet ok (closed)");
    check(c2.nativeEdges == 2, "case2: native filleted both edges");
    check(c2.nativeNoShared, "case2: native reports no shared-vertex corners");
    check(c2.occtOk, "case2: occt disjoint-chain fillet ok");
    check(c2.nativeOk && c2.occtOk && c2rel <= 1e-6,
          "case2: DISJOINT-CHAIN filleted VOLUME native == OCCT  (relative <= 1e-6)");
    check(c2.nativeOk && std::fabs(c2.nativeVol - oracle2) / oracle2 <= 1e-6,
          "case2: native disjoint volume == closed-form L^3 - 2(1-pi/4)R^2 L (rel <= 1e-6)");
    check(c2.occtOk && std::fabs(c2.occtVol - oracle2) / oracle2 <= 1e-6,
          "case2: occt disjoint volume == closed-form L^3 - 2(1-pi/4)R^2 L (rel <= 1e-6)");

    // ======================================================================
    // CASE (3) SHARED-VERTEX chain {4,5} — HONEST DIFFERENCE (reported, NOT gated)
    // ======================================================================
    std::printf("\n--- CASE (3): SHARED-VERTEX chain {4,5} (HONEST DIFFERENCE, not a gate) ---\n");
    const AB3 c3 = case3_sharedVertexChain();
    std::printf("  NATIVE : volume = %.15f   (edges filleted=%d, shared/unblended corners=%d, "
                "ch.ok(closed)=%s)\n",
                c3.nativeVol, c3.nativeEdges, c3.sharedCorners,
                c3.nativeClosed ? "true" : "false");
    std::printf("  OCCT   : volume = %.15f   (builds the spherical/setback vertex blend)\n",
                c3.occtVol);
    double c3abs = std::fabs(c3.nativeVol - c3.occtVol);
    double c3rel = (c3.occtVol != 0.0) ? c3abs / std::fabs(c3.occtVol) : 1e300;
    std::printf("  -> |native - occt| = %.6e   rel = %.6e\n", c3abs, c3rel);
    std::printf("  NOTE: this DIFFERENCE IS EXPECTED. The native pass HONESTLY leaves the\n"
                "        shared corner v5 unblended (reported in unblendedCorners; ch.ok=false)\n"
                "        rather than fabricate a subtly-wrong corner. OCCT builds the\n"
                "        spherical/setback VERTEX BLEND there, so the two volumes differ at\n"
                "        the corner. The vertex blend is a DOCUMENTED FOLLOW-UP in\n"
                "        FilletAnalytic.hpp (NOT a failure of this harness).\n");
    // Reported, NOT gated. We only assert the native HONESTY contract holds:
    check(c3.nativeEdges == 2, "case3: native filleted BOTH edges (two cylinder patches)");
    check(c3.sharedCorners == 1, "case3: native HONESTLY reports exactly one shared/unblended corner");
    check(!c3.nativeClosed,
          "case3: native honestly NOT closed (vertex blend is a documented follow-up)");
    check(c3.occtOk, "case3: occt shared-vertex fillet built (vertex blend)");

    // ======================================================================
    // VERDICT — PASS iff the CONCAVE + DISJOINT-CHAIN gates match rel <= 1e-6.
    // The shared-vertex honest-diff is EXPECTED/REPORTED, NOT a fail.
    // ======================================================================
    const bool concavePass = c1.nativeOk && c1.occtOk && c1rel <= 1e-6;
    const bool disjointPass = c2.nativeOk && c2.occtOk && c2rel <= 1e-6 &&
                              c2.nativeEdges == 2 && c2.nativeNoShared;
    const bool honestyOk = c3.nativeEdges == 2 && c3.sharedCorners == 1 && !c3.nativeClosed;
    const bool verdict = concavePass && disjointPass && honestyOk;

    std::printf("\n=== VERDICT: %s ===\n", verdict ? "PASS" : "FAIL");
    std::printf("    concave gate (rel<=1e-6)      : %s\n", concavePass ? "PASS" : "FAIL");
    std::printf("    disjoint-chain gate (rel<=1e-6): %s\n", disjointPass ? "PASS" : "FAIL");
    std::printf("    shared-vertex honest-diff      : %s (expected/reported, NOT a gate)\n",
                honestyOk ? "OK" : "CONTRACT-BROKEN");
    std::printf("=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
