// forge/native/brep/interference_overlap_test.cpp
//
// PURE-NATIVE GATE (NO OCCT) for the WAVE-2 interference flip's decision logic
// (src/InterferenceDetection.cpp, gate forgeNativeInterferenceEnabled() default ON).
// Auto-discovered by test/native/run_native.sh (the `brep` class), so it needs no
// script edit. It exercises the EXACT native engine the flipped clash test uses —
//     transformSolid (world R,t placement)  ->  booleanSolid(A, B, Common)
//       ->  massProperties(result).volume  ->  verdict (>= kInterferenceMinVolume)
// — on native SolidFactory operands, against CLOSED-FORM ground truth.
//
// This is NON-DUPLICATIVE of native_boolean_test.cpp (which proves booleanSolid's
// fuse/cut/common correctness at a fixed placement): here we prove the INTERFERENCE-
// SPECIFIC contributions that file does NOT cover —
//   (1) a ROTATED world placement through the real transformSolid(R,t) path (not the
//       in-place vertex translate native_boolean_test uses), since the runtime clash
//       test places each operand by its assembly worldTransform's R[9]/t[3];
//   (2) the CLASH VERDICT threshold — an OVERLAP pair must report >= kInterferenceMinVolume,
//       and a CLEARANCE (disjoint) pair must report NO clash (booleanSolid honestly
//       returns !ok OR a sub-threshold volume — both == "no clash", matching the
//       runtime defer-to-OCCT-then-empty behaviour).
//
// The OCCT-operand half of the flip (importOcctSolid -> native Common vs OCCT
// BRepAlgoAPI_Common) is the A/B oracle in test/native_vs_occt_interference.cpp.
//
// Pure C++20, ZERO external deps. Exit 0 iff every check passes.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/NativeRoute.hpp"   // transformSolid
#include "forge/native/brep/Topology.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>

using namespace forge::native::brep;

// Mirror of forge::kInterferenceMinVolume (forge/InterferenceDetection.hpp). That
// header pulls OCCT (ComponentRegistry.hpp -> <Bnd_Box.hxx>), so this pure-native
// gate restates the documented threshold constant rather than include it.
namespace forge { constexpr double kInterferenceMinVolume = 1e-9; }

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool relWithin(double got, double exp, double tol) {
    const double d = std::fabs(got - exp);
    const double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}

// Rz(theta) row-major 3x3.
static void rotZ(double th, double R[9]) {
    const double c = std::cos(th), s = std::sin(th);
    R[0]=c; R[1]=-s; R[2]=0;
    R[3]=s; R[4]= c; R[5]=0;
    R[6]=0; R[7]= 0; R[8]=1;
}
static const double IDENT[9] = {1,0,0, 0,1,0, 0,0,1};

// The native clash test's per-pair core (resolveWorldSolid -> booleanSolid Common ->
// massProperties), reduced to native operands: place B by (R,t), intersect with A,
// return (ran, overlapVolume). ran==false == honest defer (== "no native clash").
struct Clash { bool ran; double vol; };
static Clash nativeClash(const Solid& A,
                         const Solid& B, const double R[9], const double t[3]) {
    std::shared_ptr<TopologyBuilder> owner;
    Solid* Bw = transformSolid(B, R, t, owner);
    if (!Bw) return {false, 0.0};
    BooleanResult inter = booleanSolid(A, *Bw, BoolOp::Common);
    if (!inter.ok || inter.solid == nullptr) return {false, 0.0};
    return {true, std::fabs(massProperties(*inter.solid, 10).volume)};
}

int main() {
    std::printf("=== forge::native::brep — INTERFERENCE clash-test gate ===\n");

    // (1a) translation placement — box[0,4]^3 ∩ box+(2,2,2) => exact corner overlap 8.
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(4, 4, 4);
        Solid* B = fb.buildBox(4, 4, 4);
        const double t[3] = {2, 2, 2};
        Clash c = nativeClash(*A, *B, IDENT, t);
        check(c.ran, "translate placement — native engine ran (no defer)");
        check(c.ran && relWithin(c.vol, 8.0, 1e-6),
              "translate placement — overlap volume == 8 (planar, 1e-6) got=" +
              std::to_string(c.vol));
        check(c.ran && c.vol >= forge::kInterferenceMinVolume,
              "translate placement — VERDICT = clash");
    }

    // (1b) ROTATED world placement through transformSolid — box[0,4]^3 ∩
    //      (box rotated +90° about Z, then translated (3,1,1)) => occupies
    //      [-1,3]x[1,5]x[1,5]; overlap with [0,4]^3 is [0,3]x[1,4]x[1,4] = 27.
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(4, 4, 4);
        Solid* B = fb.buildBox(4, 4, 4);
        double R[9]; rotZ(M_PI / 2.0, R);
        const double t[3] = {3, 1, 1};
        Clash c = nativeClash(*A, *B, R, t);
        check(c.ran, "rotated placement — native engine ran (no defer)");
        check(c.ran && relWithin(c.vol, 27.0, 1e-6),
              "rotated placement — overlap volume == 27 (planar+rotation, 1e-6) got=" +
              std::to_string(c.vol));
        check(c.ran && c.vol >= forge::kInterferenceMinVolume,
              "rotated placement — VERDICT = clash");
    }

    // (2) CLEARANCE — box[0,4]^3 and box+(10,10,10) are disjoint. The native path
    //     reports NO clash: either booleanSolid defers (!ok -> ran=false), or it
    //     returns an empty/sub-threshold solid. Both == "no clash".
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(4, 4, 4);
        Solid* B = fb.buildBox(4, 4, 4);
        const double t[3] = {10, 10, 10};
        Clash c = nativeClash(*A, *B, IDENT, t);
        const bool noClash = (!c.ran) || (c.vol < forge::kInterferenceMinVolume);
        check(noClash, "clearance — VERDICT = no clash (ran=" + std::to_string(c.ran) +
                       " vol=" + std::to_string(c.vol) + ")");
    }

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
