// native_gate_guard_gate.cpp — a compile must leave the native gates EXACTLY as it
// found them.
//
// THE DEFECT THIS PINS. forge::ft::compile() forces the OCCT analytic backend for the
// duration of a build and restores the prior state afterwards. It used to save ONE bit
//
//     bool prev = forgeNativeBrepEnabled();
//     setForgeNativeBrepEnabled(false);
//     ~GateGuard() { setForgeNativeBrepEnabled(prev); }
//
// and restore FOUR, because setForgeNativeBrepEnabled() writes core + features + step +
// interference from a single value. Its own comment says "production never calls this",
// and the compiler is production.
//
// The three gates default ON; FEATURES defaults OFF. So after the first compile the
// FEATURES override was forced to 1 and stayed there for the life of the process.
// Measured consequence: mass properties on the app's own bracket read 11514.789967
// against an analytic 77583.539933 (-85.2%), with a centre of mass of
// (-1.37e34, -8.53e33, 67.38) instead of (0,0,10). A COM of 1e34 is the tell that this
// is a wrong code path, not a tolerance.
//
// WHY THE ASSERTION IS "UNCHANGED" AND NOT A SPECIFIC VALUE. Pinning the four gates to
// particular booleans would bake today's defaults into a test and go red whenever a wave
// flips one deliberately. The invariant that actually matters is narrower and permanent:
// a scope that saves and restores must restore what it saved. So this compares the gate
// vector to ITSELF across a compile, and additionally checks the RAW overrides, so an
// UNSET override (-1) restored as a frozen 0/1 is caught even when the effective boolean
// happens to agree.
//
// MUTATION PROOF: revert FeatureTreeCompiler.cpp's guard to the one-bit form and case 2
// and case 4 below go RED. Verified before this file was committed.

#include "forge/native/brep/NativeRoute.hpp"
#include "forge/ft/FeatureTree.hpp"

#include <cstdio>
#include <string>

namespace {

int g_checks = 0;
int g_fail = 0;

void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) {
        ++g_fail;
        std::printf("  FAIL  %s\n", what.c_str());
    }
}

struct GateVector {
    bool core, features, step, interference;
};

GateVector readGates() {
    using namespace forge::native::brep;
    return {forgeNativeBrepEnabled(), forgeNativeFeaturesEnabled(),
            forgeNativeStepEnabled(), forgeNativeInterferenceEnabled()};
}

bool sameGates(const GateVector& a, const GateVector& b) {
    return a.core == b.core && a.features == b.features && a.step == b.step &&
           a.interference == b.interference;
}

bool sameOverrides(const forge::native::brep::NativeGateOverrides& a,
                   const forge::native::brep::NativeGateOverrides& b) {
    return a.core == b.core && a.features == b.features && a.step == b.step &&
           a.interference == b.interference;
}

std::string show(const GateVector& g) {
    return std::string("core=") + (g.core ? "1" : "0") + " feat=" + (g.features ? "1" : "0") +
           " step=" + (g.step ? "1" : "0") + " interf=" + (g.interference ? "1" : "0");
}

// A minimal, always-legal tree: one box. The point is the SIDE EFFECT of compiling,
// not the geometry, so the smallest valid program is the right one. Built through
// forge::ft::parse() rather than by hand — Op::args is a vector<Token>, not a vector
// of doubles, and hand-constructing it would encode an assumption about the IR's
// internal representation that this gate has no business depending on.
forge::ft::FeatureTree oneBox() {
    return forge::ft::parse("%1 = BOX(10, 10, 10)\nRESULT(%1)\n");
}

}  // namespace

int main() {
    using namespace forge::native::brep;

    std::printf("[native-gate-guard] a compile must leave the gates exactly as it found them\n");

    // ── 1. POSITIVE CONTROL: save/restore is faithful on its own, including UNSET.
    {
        const NativeGateOverrides before = saveNativeGateOverrides();
        setForgeNativeBrepEnabled(true);
        restoreNativeGateOverrides(before);
        const NativeGateOverrides after = saveNativeGateOverrides();
        check(sameOverrides(before, after),
              "1: restoreNativeGateOverrides puts back exactly what save captured");
        // An unset override must come back UNSET, not frozen to its evaluated value.
        check(after.features == before.features,
              "1b: an UNSET override is restored as unset, not frozen to 0/1");
    }

    // ── 2. THE DEFECT: a compile must not move any gate.
    {
        const GateVector before = readGates();
        const NativeGateOverrides beforeOv = saveNativeGateOverrides();
        (void)forge::ft::compile(oneBox());
        const GateVector after = readGates();
        const NativeGateOverrides afterOv = saveNativeGateOverrides();
        if (!sameGates(before, after))
            std::printf("        before: %s\n        after:  %s\n", show(before).c_str(),
                        show(after).c_str());
        check(sameGates(before, after), "2: one compile leaves the gate VECTOR unchanged");
        check(sameOverrides(beforeOv, afterOv),
              "2b: one compile leaves the RAW OVERRIDES unchanged (an unset gate stays unset)");
    }

    // ── 3. The FEATURES gate specifically — the one the old code widened.
    {
        const bool before = forgeNativeFeaturesEnabled();
        (void)forge::ft::compile(oneBox());
        const bool after = forgeNativeFeaturesEnabled();
        if (before != after)
            std::printf("        forgeNativeFeaturesEnabled(): %d before, %d after\n",
                        before ? 1 : 0, after ? 1 : 0);
        check(before == after, "3: forgeNativeFeaturesEnabled() is unchanged by a compile");
    }

    // ── 4. Idempotence across repeats — the old defect latched on the FIRST compile,
    //      so a single-compile test could pass while the process stayed corrupted.
    {
        const GateVector before = readGates();
        for (int i = 0; i < 3; ++i) (void)forge::ft::compile(oneBox());
        check(sameGates(before, readGates()), "4: three compiles leave the gates unchanged");
    }

    // ── 5. NEGATIVE CONTROL: the comparator can actually fail. Without this, cases 2-4
    //      would be green over a comparator that returns true unconditionally.
    {
        GateVector a = readGates();
        GateVector b = a;
        b.features = !b.features;
        check(!sameGates(a, b), "5: the gate comparator DETECTS a one-bit difference");
        NativeGateOverrides oa = saveNativeGateOverrides();
        NativeGateOverrides ob = oa;
        ob.step = (ob.step == 1) ? 0 : 1;
        check(!sameOverrides(oa, ob), "5b: the override comparator DETECTS a one-value difference");
    }

    std::printf("[native-gate-guard] %d checks, %d failures — %s\n", g_checks, g_fail,
                g_fail == 0 ? "PASS" : "FAIL");
    return g_fail == 0 ? 0 : 1;
}
