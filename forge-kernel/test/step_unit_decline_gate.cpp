// step_unit_decline_gate.cpp — StepAnalytic must DECLINE a non-millimetre file.
//
// THE DEFECT THIS PINS. StepAnalytic::read exists to round-trip FORGE'S OWN
// analytic dialect, which write() always emits as SI_UNIT(.MILLI.,.METRE.).
// Because Forge was the only producer it was written for, it resolved no unit
// context AT ALL -- so a foreign file declaring SI_UNIT($,.METRE.) was read RAW,
// returning metres where every other instrument returns millimetres. Measured on
// real corpus rows at exactly 1000.0 on every axis, which refused 359 otherwise
// round-trip-proved rows against 187 kept.
//
// WHY THE FIXTURE IS DERIVED, NOT HAND-WRITTEN. The two documents below are
// produced by Forge's OWN writer and then differ in ONE RESPECT: the unit
// declaration. Same entities, same coordinates, same topology. So any difference
// in how they are read is attributable to the unit context and to nothing else --
// a hand-written STEP pair could differ in a dozen invisible ways.
//
// ★ IT ASSERTS THE FAST PATH STILL WORKS (case 1). A fix that made StepAnalytic
//   decline EVERYTHING would satisfy case 2 and destroy the reader. Case 1 is
//   what stops that.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepRead.hpp"

#include <cstdio>
#include <string>

namespace {
int g_checks = 0, g_fail = 0;
void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) { ++g_fail; std::printf("  FAIL  %s\n", what.c_str()); }
}
}  // namespace

int main() {
    using namespace forge::native::brep;
    std::printf("[step-unit] StepAnalytic must decline a non-millimetre file\n");

    SolidFactory factory;
    Solid* box = factory.buildBox(10.0, 10.0, 10.0);
    if (!box) { std::printf("  FATAL: buildBox returned null\n"); return 2; }

    const AnalyticWriteResult w = StepAnalytic::write(*box);
    if (!w.ok) { std::printf("  FATAL: write failed: %s\n", w.reason.c_str()); return 2; }

    // The document Forge writes must actually be millimetres, or the fixture is
    // not what this gate claims it is.
    check(w.text.find("SI_UNIT(.MILLI.,.METRE.)") != std::string::npos,
          "0: Forge's own writer emits SI_UNIT(.MILLI.,.METRE.)");

    // ── 1. THE FAST PATH IS NOT DISABLED WHOLESALE ──────────────────────────
    {
        const AnalyticReadResult r = StepAnalytic::read(w.text);
        if (!r.ok) std::printf("        reason: %s\n", r.reason.c_str());
        check(r.ok, "1: a MILLIMETRE Forge document still round-trips through StepAnalytic");
    }

    // ── 2. THE DEFECT: a METRE document must be DECLINED, not read raw ───────
    std::string metre = w.text;
    {
        const std::string mm = "SI_UNIT(.MILLI.,.METRE.)";
        const std::string m  = "SI_UNIT($,.METRE.)";
        const auto at = metre.find(mm);
        check(at != std::string::npos, "2a: the fixture's unit declaration was found and swapped");
        if (at != std::string::npos) metre.replace(at, mm.size(), m);

        const AnalyticReadResult r = StepAnalytic::read(metre);
        if (r.ok)
            std::printf("        StepAnalytic ACCEPTED a metre file — it read the coordinates raw\n");
        check(!r.ok, "2b: a METRE document is DECLINED by StepAnalytic (not silently read as mm)");
    }

    // ── 3. AND IT ROUTES TO THE READER THAT ALREADY SCALES ──────────────────
    //     Declining is only correct because path 2 handles it. Prove path 2 sees
    //     the metre context, and still sees millimetres in the millimetre file.
    {
        const ForeignReadResult fm = readForeignStep(metre);
        const ForeignReadResult fx = readForeignStep(w.text);
        if (fm.lengthScaleToMm != 1000.0)
            std::printf("        readForeignStep(metre).lengthScaleToMm = %.6f (want 1000)\n",
                        fm.lengthScaleToMm);
        check(fm.lengthScaleToMm == 1000.0,
              "3a: readForeignStep resolves the METRE context to a 1000x scale");
        check(fx.lengthScaleToMm == 1.0,
              "3b: readForeignStep leaves the MILLIMETRE document at 1x");
    }

    // ── 4. NEGATIVE CONTROL ─────────────────────────────────────────────────
    //     Without this, cases 3a/3b would be green over a comparison that cannot
    //     distinguish the two values at all.
    check(!(1000.0 == 1.0), "4: the comparator DISTINGUISHES a 1000x scale from 1x");

    std::printf("[step-unit] %d checks, %d failures — %s\n", g_checks, g_fail,
                g_fail == 0 ? "PASS" : "FAIL");
    return g_fail == 0 ? 0 : 1;
}
