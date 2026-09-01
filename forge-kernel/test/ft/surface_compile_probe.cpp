// forge-kernel/test/ft/surface_compile_probe.cpp
//
// THE SURFACE VALUE KIND, ACTUALLY BUILT.
//
// surface_round_trip_test.cpp proves the two halves of the seam agree about the
// TEXT. This probe links the whole kernel and runs forge::ft::compileText, so it
// is the only place the surface ops produce real geometry and the tolerance
// contract is observed rather than asserted about.
//
// It is a PROBE, not a ratchet: each case prints what the kernel measured, and
// the exit status reflects only the invariants that must hold for the value kind
// to be sound. Where a case's outcome depends on OCCT declining or accepting an
// offset, that is REPORTED, never gated on — a gate on a third-party algorithm's
// mood is a flaky gate, and this repo has been bitten by treating one as a fact.
//
// Build + run: forge-kernel/test/ft/build_surface_compile_probe.sh
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace {

int gChecks = 0;
int gFails = 0;

void ok(bool cond, const std::string& what) {
    ++gChecks;
    if (cond) { std::printf("  PASS  %s\n", what.c_str()); return; }
    ++gFails;
    std::printf("  FAIL  %s\n", what.c_str());
}

void report(const char* title, const forge::ft::CompileResult& r) {
    std::printf("--- %s\n", title);
    std::printf("    ok=%d valid=%d faces=%ld edges=%ld volume=%.3f failedOp=%d\n",
                r.ok ? 1 : 0, r.valid ? 1 : 0, r.faceCount, r.edgeCount, r.volume,
                r.failedOpId);
    if (!r.error.empty()) std::printf("    error: %s\n", r.error.c_str());
    for (const std::string& v : r.verify) std::printf("    %s\n", v.c_str());
}

forge::ft::CompileResult run(const std::string& ir) {
    return forge::ft::compileText(ir, std::string());
}

bool has(const std::string& hay, const char* needle) {
    return hay.find(needle) != std::string::npos;
}

}  // namespace

int main() {
    std::printf("=== SURFACE value kind — compiled, not just parsed ===\n");

    // ── 1. SOLID -> SURFACE -> SOLID, the round the kind exists for ──────────
    {
        const auto r = run(
            "%1 = BOX(80, 60, 20)\n"
            "%2 = FACES(%1, \"+z\")\n"
            "%3 = SURFCHECK(%2, \"faces=1\", \"freeEdges>=1\")\n"
            "%4 = THICKEN(%3, 3)\n"
            "RESULT(%4)\n");
        report("FACES(+z) -> SURFCHECK -> THICKEN", r);
        ok(r.error.empty() || r.failedOpId == 4,
           "the round either builds or fails AT THICKEN with a named op");
        // The measurement that matters regardless of whether OCCT accepted the
        // offset: SURFCHECK saw exactly one face and reported it.
        bool sawOneFace = false;
        for (const std::string& v : r.verify)
            if (has(v, "PASS faces=1")) sawOneFace = true;
        ok(sawOneFace, "SURFCHECK measured the extracted sheet as 1 face");
    }

    // ── 2. TOLERANCE — a selector that matches NOTHING ───────────────────────
    // The whole design in one case. The tree must NOT die at %2; it must reach
    // %3 and be told, in the kernel's own words, that the sheet is empty.
    {
        const auto r = run(
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"bore:r=99999\")\n"
            "%3 = SURFCHECK(%2, \"faces=0\")\n"
            "RESULT(%1)\n");
        report("FACES with an impossible selector", r);
        ok(r.failedOpId != 2,
           "a selector miss does NOT kill the tree at the FACES statement");
        bool emptyReported = false;
        for (const std::string& v : r.verify)
            if (has(v, "PASS faces=0")) emptyReported = true;
        ok(emptyReported, "the empty sheet is REPRESENTABLE and SURFCHECK says so");
        ok(r.ok, "and the tree still delivers its solid");
    }

    // ── 3. the refusal that remains is ACTIONABLE ────────────────────────────
    // Thickening an empty sheet has no meaning, so it refuses. What is asserted
    // is not the refusal — it is that the message names the op and says what was
    // wrong, which is the only thing a repair loop can act on.
    {
        const auto r = run(
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"bore:r=99999\")\n"
            "%3 = THICKEN(%2, 2)\n"
            "RESULT(%3)\n");
        report("THICKEN of an EMPTY sheet", r);
        ok(!r.ok, "it fails rather than inventing a body");
        ok(r.failedOpId == 3, "and it names op %3");
        ok(has(r.error, "EMPTY sheet"), "and says the sheet was empty: " + r.error);
    }

    // ── 4. a SOLID where a SURFACE is expected, and the reverse ──────────────
    {
        const auto r = run(
            "%1 = BOX(20, 20, 20)\n"
            "%2 = SURFCHECK(%1, \"faces=6\")\n"
            "RESULT(%1)\n");
        report("SURFCHECK on a SOLID (the lossless promotion)", r);
        bool six = false;
        for (const std::string& v : r.verify)
            if (has(v, "PASS faces=6")) six = true;
        ok(six, "a SOLID promotes to its 6-face boundary sheet");
    }
    {
        const auto r = run(
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"+z\")\n"
            "%3 = FUSE(%1, %2)\n"
            "RESULT(%3)\n");
        report("FUSE of a SOLID with a SURFACE", r);
        ok(!r.ok, "a sheet is not a body, and the boolean says so");
        ok(has(r.error, "SURFACE"), "the message NAMES the kind it got: " + r.error);
        ok(has(r.error, "THICKEN") || has(r.error, "CAP"),
           "and names the op that would convert it");
    }

    // ── 5. RESULT on a surface is diagnosed, not merely rejected ─────────────
    {
        const auto r = run(
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"+z\")\n"
            "RESULT(%2)\n");
        report("RESULT(%surface)", r);
        ok(!r.ok, "a sheet cannot be the delivered part");
        ok(has(r.error, "SURFACE"), "and the error says which kind it is: " + r.error);
    }

    // ── 6. SKIN builds a real free-form sheet ────────────────────────────────
    {
        const auto r = run(
            "%1 = RING(20, 20, 0)\n"
            "%2 = RING(15, 15, 50, 0, 0, 5)\n"
            "%3 = SKIN(%1, %2)\n"
            "%4 = SURFCHECK(%3, \"faces>=1\")\n"
            "%5 = CAP(%4)\n"
            "RESULT(%5)\n");
        report("SKIN two rings -> SURFCHECK -> CAP", r);
        bool skinned = false;
        for (const std::string& v : r.verify)
            if (has(v, "PASS faces>=1")) skinned = true;
        ok(skinned, "SKIN produced a sheet with at least one face");
    }

    std::printf("---------------------------------------------------------------\n");
    std::printf("TOTAL  checks=%d  fail=%d\n", gChecks, gFails);
    if (gFails == 0) {
        std::printf("RESULT: PASS — the SURFACE value kind builds, measures and "
                    "diagnoses as designed.\n");
        return 0;
    }
    std::printf("RESULT: FAIL\n");
    return 1;
}
