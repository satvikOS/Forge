// forge-kernel/test/native_vs_occt_stl.cpp
//
// 1:1 A/B-vs-OCCT harness for the NATIVE ASCII-STL CODEC
// (forge::native::brep::MeshExchange::writeSTL / readSTL, MeshExchange.hpp) — the
// OCCT-zero Wave-0 (B2) replacement for OCCT's StlAPI_Writer / StlAPI_Reader +
// BRepMesh_IncrementalMesh in src/IoExchange.cpp importStl/exportStl.
//
// GATE (machine-epsilon rigor):
//   PART A — BOX 10mm, native STL round-trip vs OCCT StlAPI round-trip:
//     * TRI-COUNT preserved through the native write->read AND equal to OCCT's
//       StlAPI round-trip tri-count (both 12 for a box).
//     * ENCLOSED VOLUME (divergence theorem) parity: native round-trip == 1000,
//       OCCT StlAPI round-trip == 1000, native == OCCT, all rel <= 1e-9.
//   PART B — native ASCII codec EXACT-DOUBLE round-trip on a CURVED body (sphere
//     r=7, irrational vertex coords): write->read preserves the enclosed volume to
//     rel <= 1e-9 (this is the load-bearing std::to_chars/from_chars bit-exactness
//     that a float32 binary STL could NOT provide) and preserves the tri-count.
//
// OCCT (StlAPI + BRepMesh) is the A/B ORACLE here — it stays linked in THIS harness
// even though it has been retired from the production STL path. Standalone C++20.
//
// BUILD (single clang++; OCCT 7.9.3 from homebrew):
//   clang++ -std=c++20 -O2 \
//     -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_stl.cpp \
//     forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKMesh -lTKDESTL -lTKXSBase -lTKShHealing \
//     -o /tmp/native_vs_occt_stl && /tmp/native_vs_occt_stl

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ---- Forge native ----------------------------------------------------------
#include "forge/native/brep/MeshExchange.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/SolidTessellate.hpp"

// ---- OCCT (the A/B oracle) -------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <StlAPI_Writer.hxx>
#include <StlAPI_Reader.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool relmatch(double got, double exp, double tol) {
    double scale = std::max(1.0, std::fabs(exp));
    return std::fabs(got - exp) <= tol * scale;
}
static std::string num(double v) {
    char b[64]; std::snprintf(b, sizeof(b), "%.12g", v); return std::string(b);
}

// --- native: tessellate a Solid to a TriMesh (the production export path) ----
static TriMesh nativeTess(const Solid& s) {
    TriMesh m;
    tessellateSolid(s, m.positions, m.indices, /*weldTol*/ 1e-7);
    return m;
}

// --- OCCT: BRepMesh a shape, StlAPI write (ASCII) then read back. OCCT 7.9's
//     StlAPI_Reader returns a COMPOUND of N TRIANGULAR TopoDS_Faces (one per STL
//     facet, NO Poly_Triangulation). So the round-trip TRI-COUNT is the read-back
//     face count, and the enclosed VOLUME is got by sewing those facet-faces into
//     a closed shell -> solid -> BRepGProp::VolumeProperties (the same sew+solid
//     path the IGES A/B harness uses). ----------------------------------------
struct OcctStl { bool ok = false; int tris = 0; double vol = 0.0; };
static OcctStl occtStlRoundTrip(const TopoDS_Shape& shape, double defl, const char* tag) {
    OcctStl R;
    BRepMesh_IncrementalMesh mesher(shape, defl, Standard_False, 0.5, Standard_True);
    mesher.Perform();
    std::string path = std::string("/tmp/forge_ab_stl_") + tag + ".stl";
    StlAPI_Writer w; w.ASCIIMode() = Standard_True;
    if (!w.Write(shape, path.c_str())) return R;
    TopoDS_Shape readBack;
    StlAPI_Reader r;
    if (!r.Read(readBack, path.c_str())) return R;
    int tris = 0;
    BRepBuilderAPI_Sewing sew(1e-6);
    for (TopExp_Explorer ex(readBack, TopAbs_FACE); ex.More(); ex.Next()) {
        ++tris; sew.Add(ex.Current());
    }
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    double vol = 0.0;
    for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
        TopoDS_Solid sol = BRepBuilderAPI_MakeSolid(TopoDS::Shell(ex.Current())).Solid();
        GProp_GProps g; BRepGProp::VolumeProperties(sol, g, Standard_True);
        vol = std::fabs(g.Mass());
    }
    R.ok = true; R.tris = tris; R.vol = vol;
    return R;
}

int main() {
    std::printf("native_vs_occt_stl — 1:1 A/B-vs-OCCT ASCII-STL CODEC HARNESS\n");
    std::printf("  native: forge::native::brep::MeshExchange::{writeSTL,readSTL}\n");
    std::printf("  occt  : StlAPI_Writer + StlAPI_Reader + BRepMesh (OCCT 7.9.3)\n\n");

    // ====================================================================== A
    // BOX 10mm: native STL round-trip vs OCCT StlAPI round-trip.
    {
        const double L = 10.0, expVol = L * L * L;   // 1000
        SolidFactory f;
        Solid* box = f.buildBox(L, L, L);
        TriMesh M = nativeTess(*box);

        std::string stl = MeshExchange::writeSTL(M, "forge");
        ReadResult rr = MeshExchange::readSTL(stl);

        const double nVolPre  = std::fabs(M.signedVolume());
        const double nVolPost = rr.ok ? std::fabs(rr.mesh.signedVolume()) : -1.0;
        const int    nTriPre  = (int)M.triangleCount();
        const int    nTriPost = rr.ok ? (int)rr.mesh.triangleCount() : -1;

        OcctStl oc = occtStlRoundTrip(BRepPrimAPI_MakeBox(L, L, L).Shape(), 0.05, "box");

        std::printf("== CASE A: BOX %gmm (VOLUME target %.1f) ==\n", L, expVol);
        std::printf("  NATIVE write->read: ok=%d tris %d->%d  vol %.12g->%.12g\n",
                    (int)rr.ok, nTriPre, nTriPost, nVolPre, nVolPost);
        std::printf("  OCCT  StlAPI round-trip: ok=%d tris=%d vol=%.12g\n", (int)oc.ok, oc.tris, oc.vol);

        check(rr.ok, "A native readSTL ok");
        check(oc.ok, "A OCCT StlAPI round-trip ok");
        check(nTriPost == nTriPre, "A native TRI-COUNT preserved (" + std::to_string(nTriPre) + ")");
        check(oc.tris == nTriPost, "A TRI-COUNT native(" + std::to_string(nTriPost) + ")==OCCT(" + std::to_string(oc.tris) + ")");
        check(relmatch(nVolPost, expVol, 1e-9), "A native round-trip VOLUME==1000 (rel<=1e-9) got " + num(nVolPost));
        check(relmatch(nVolPost, nVolPre, 1e-9), "A native VOLUME preserved write->read (rel<=1e-9)");
        check(relmatch(oc.vol,   expVol, 1e-9), "A OCCT StlAPI VOLUME==1000 (rel<=1e-9) got " + num(oc.vol));
        check(relmatch(nVolPost, oc.vol,  1e-9), "A VOLUME native==OCCT StlAPI round-trip (rel<=1e-9)");
        std::printf("\n");
    }

    // ====================================================================== B
    // SPHERE r=7 (irrational vertex coords): native ASCII codec EXACT round-trip.
    {
        const double R = 7.0;
        PrimitiveOptions po; po.nSeg = 48; po.nBand = 24;
        SolidFactory f(po);
        Solid* sph = f.buildSphere(R);
        TriMesh M = nativeTess(*sph);

        std::string stl = MeshExchange::writeSTL(M, "forge");
        ReadResult rr = MeshExchange::readSTL(stl);

        const double nVolPre  = std::fabs(M.signedVolume());
        const double nVolPost = rr.ok ? std::fabs(rr.mesh.signedVolume()) : -1.0;
        const int    nTriPre  = (int)M.triangleCount();
        const int    nTriPost = rr.ok ? (int)rr.mesh.triangleCount() : -1;

        std::printf("== CASE B: SPHERE r=%g (curved, irrational coords) — native exact round-trip ==\n", R);
        std::printf("  NATIVE write->read: ok=%d tris %d->%d  vol %.15g->%.15g\n",
                    (int)rr.ok, nTriPre, nTriPost, nVolPre, nVolPost);

        check(rr.ok, "B native readSTL ok");
        check(nTriPost == nTriPre, "B native TRI-COUNT preserved (" + std::to_string(nTriPre) + ")");
        // The codec is bit-exact, so the enclosed volume is preserved to rel<=1e-9
        // even with irrational sphere-vertex coordinates (the float32 binary STL the
        // OCCT path could write would lose ~6-7 digits here).
        check(relmatch(nVolPost, nVolPre, 1e-9), "B native VOLUME preserved write->read (rel<=1e-9)");
        std::printf("    delta = %.3e (abs)\n\n", std::fabs(nVolPost - nVolPre));
    }

    std::printf("native_vs_occt_stl RESULT: %d/%d checks passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
