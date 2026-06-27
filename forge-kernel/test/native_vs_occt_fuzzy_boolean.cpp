// forge-kernel/test/native_vs_occt_fuzzy_boolean.cpp
//
// Gate for the OCCT-zero Wave-0 (C-FUZZY) FUZZY BOOLEAN — the OCCT-free analogue
// of BRepAlgoAPI_BooleanOperation::SetFuzzyValue, threaded through the native
// analytic boolean (BooleanOptions::fuzz -> SSI coincidence tol + face-overlap pad
// + stitch corner-weld grid).
//
// SCENARIO: two 4x4x4 boxes stacked along +Z with a δ = 1e-5 GAP between A's top
// face (z=4) and B's bottom face (z=4+δ). Each box has volume 64, so the analytic
// fuse target volume is 128.
//
//   PART 1 (NATIVE, no OCCT): fuse with fuzz = 2e-5 (> δ). Assert
//     * the ANALYTIC path succeeds (result.ok),
//     * it did NOT drop to the mesh fallback (!usedMeshFallback) — the fuzz must
//       NOT introduce a sliver crossing that defeats the analytic envelope,
//     * the fused enclosed VOLUME == 128 (rel <= 1e-6).
//
//   PART 2 (A/B vs OCCT): the same two boxes, BRepAlgoAPI_Fuse with
//     SetFuzzyValue(2e-5). Assert native fused volume == OCCT fused volume
//     (rel <= 1e-6).
//
// Standalone C++20; OCCT 7.9.3 is the A/B oracle.
//
// BUILD:
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_fuzzy_boolean.cpp \
//     forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_fuzzy_boolean && /tmp/native_vs_occt_fuzzy_boolean

#include <cmath>
#include <cstdio>
#include <memory>
#include <string>

// ---- Forge native ----------------------------------------------------------
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/NativeRoute.hpp"

// ---- OCCT (the A/B oracle) -------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <gp_Pnt.hxx>
#include <TopoDS_Shape.hxx>

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

int main() {
    const double H = 4.0;          // box edge
    const double delta = 1e-5;     // gap between A-top and B-bottom
    const double fuzz  = 2e-5;     // > delta, so the gap is treated as coincident
    const double Vsep    = 2.0 * (H * H * H);                 // 128       (two disjoint 4^3 shells)
    const double Vbridge = (H * H) * (2.0 * H + delta);       // 128.00016 (one solid, δ gap bridged)

    std::printf("native_vs_occt_fuzzy_boolean — FUZZY FUSE of two %gx%gx%g boxes,\n", H, H, H);
    std::printf("  gap delta=%g, fuzz=%g.  Vsep(two shells)=%.5f  Vbridge(gap filled)=%.5f\n\n",
                delta, fuzz, Vsep, Vbridge);

    SolidFactory fa, fb;
    Solid* A = fa.buildBox(H, H, H);
    Solid* Braw = fb.buildBox(H, H, H);
    const double R[9] = {1,0,0, 0,1,0, 0,0,1};       // identity
    const double t[3] = {0.0, 0.0, H + delta};       // lift B so its base sits delta above A's top
    std::shared_ptr<TopologyBuilder> bOwner;
    Solid* B = transformSolid(*Braw, R, t, bOwner);

    // ---- CONTROL: fuse with fuzz=0 — the δ gap is NOT bridged ---------------
    BooleanOptions opt0; opt0.fuzz = 0.0;
    BooleanResult res0 = booleanSolid(*A, *B, BoolOp::Fuse, opt0);
    double nVol0 = (res0.ok && res0.solid) ? massProperties(*res0.solid).volume : -1.0;

    // ---- FUZZY: fuse with fuzz=2e-5 (> δ) — the gap coalesces ---------------
    BooleanOptions opts; opts.fuzz = fuzz;
    BooleanResult res = booleanSolid(*A, *B, BoolOp::Fuse, opts);
    double nVol = (res.ok && res.solid) ? massProperties(*res.solid).volume : -1.0;

    std::printf("== PART 1: NATIVE fuzzy fuse (no OCCT) ==\n");
    std::printf("  fuzz=0   : ok=%d fallback=%d volume=%.12g\n",
                (int)res0.ok, (int)res0.usedMeshFallback, nVol0);
    std::printf("  fuzz=%g: ok=%d fallback=%d volume=%.12g\n",
                fuzz, (int)res.ok, (int)res.usedMeshFallback, nVol);
    check(res.ok, "native fuzzy fuse ok (analytic path succeeded)");
    check(res.ok && !res.usedMeshFallback, "native fuzzy fuse stayed ANALYTIC (!usedMeshFallback)");
    // With the fuzz the operands coalesce into ONE solid spanning the bridged δ gap
    // -> the analytic closed-form volume is (H*H)*(2H+δ). (The native analytic
    // boolean reconstruction is ~1e-6, same envelope as native_vs_occt_pattern.)
    check(res.ok && relmatch(nVol, Vbridge, 1e-6), "native fuzzy fuse VOLUME == (H*H)(2H+δ) (rel<=1e-6)");
    // Control: without the fuzz the gap is left open (two disjoint shells), so the
    // fuzz DEMONSTRABLY bridged a gap of ~16δ between the two results.
    check(res0.ok && relmatch(nVol0, Vsep, 1e-6), "control fuzz=0 VOLUME == 2*H^3 (two shells, gap NOT bridged)");
    check(res.ok && res0.ok && std::fabs(nVol - nVol0) > 0.5 * (H * H) * delta,
          "fuzz BRIDGED the gap (V_fuzz - V_fuzz0 ~ +16δ, distinct from the fuzz=0 control)");

    // ---- OCCT: same two boxes, BRepAlgoAPI_Fuse + SetFuzzyValue -------------
    TopoDS_Shape oA = BRepPrimAPI_MakeBox(H, H, H).Shape();
    TopoDS_Shape oB = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, H + delta), H, H, H).Shape();
    BRepAlgoAPI_Fuse fuse(oA, oB);
    fuse.SetFuzzyValue(fuzz);
    fuse.Build();
    double oVol = -1.0; bool oOk = fuse.IsDone();
    if (oOk) {
        GProp_GProps g; BRepGProp::VolumeProperties(fuse.Shape(), g, Standard_True);
        oVol = std::fabs(g.Mass());
    }

    std::printf("\n== PART 2: A/B vs OCCT BRepAlgoAPI_Fuse::SetFuzzyValue(%g) ==\n", fuzz);
    std::printf("  OCCT ok=%d volume=%.12g    NATIVE volume=%.12g    |Δ|=%.3e\n",
                (int)oOk, oVol, nVol, std::fabs(nVol - oVol));
    check(oOk, "OCCT fuzzy fuse ok");
    check(oOk && relmatch(oVol, Vbridge, 1e-6), "OCCT fuzzy fuse VOLUME == (H*H)(2H+δ) (rel<=1e-6)");
    check(res.ok && oOk && relmatch(nVol, oVol, 1e-6), "VOLUME native == OCCT SetFuzzyValue (rel<=1e-6)");

    std::printf("\nnative_vs_occt_fuzzy_boolean RESULT: %d/%d checks passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
