// forge/native/brep/shell_faceid_test.cpp
//
// Native gate for FIX #3 — "shell faceIds off-by-one / deterministic selection".
//
// THE FRICTION (production / OCCT path): forge.part.shell's JS verb documents
// face ids as 1-based, but the kernel's faceById (Features.cpp) is 0-based, so a
// caller selecting the documented "face 6" of a 6-face box hit
// "face id 6 out of range (only 6 faces)" — the open face could not be picked
// deterministically. The production fix converts 1-based → 0-based in the verb,
// so JS "face 6" maps to the kernel's index 5 (the LAST valid index of a 6-face
// box); native index 6 is correctly the first out-of-range value.
//
// A second, in-house friction (this file's kernel-side fix): brep::shellSolid
// used to SILENTLY IGNORE an out-of-range removedFaces index — a mis-numbered
// open face returned a SEALED shell with no signal. It now REFUSES out-of-range
// indices (ok == false + reason), so face selection is deterministic on the
// native path too.
//
// This gate proves DETERMINISTIC, BOUNDED 0-based face selection in the
// dependency-free in-house shell — pure C++20, NO external deps, NO WASM, no
// framework. (The OCCT-side faceById already throws clearly; the JS 1→0-based
// conversion is what makes that path correct, and is live without a relink.)
//
// GATES (asymmetric box a=30, b=40, c=50, wall t=5 — never weakened):
//   (1) PER-FACE FINGERPRINT. Opening each face index i ∈ [0,5] produces a
//       watertight POSITIVE-volume housing whose volume equals the closed form
//       for THAT face's own axis:
//           remove face ⟂ X:  abc − (a−t)(b−2t)(c−2t)
//           remove face ⟂ Y:  abc − (a−2t)(b−t)(c−2t)
//           remove face ⟂ Z:  abc − (a−2t)(b−2t)(c−t)
//       The three axis volumes are DISTINCT (30000 / 32000 / 33000), so matching
//       proves the SELECTED face — not just "some" face — was opened. Exactly
//       one outer mouth is opened (outerFaces == 5 vs 6 sealed).
//   (2) BOUNDED INDEXING. A 6-face box is addressable at 0-based [0..5]; index 5
//       is the LAST valid index (= the JS verb's 1-based "face 6"), and index 6
//       is the FIRST out-of-range value → REFUSED honestly (ok == false +
//       reason), never a silent sealed shell.

#include "forge/native/brep/Shell.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <cmath>
#include <cstdio>
#include <string>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}
static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// (1) deterministic per-face selection via the axis-volume fingerprint.
static void testDeterministicFaceSelection() {
    std::printf("[1] deterministic 0-based face selection (asymmetric box, per-face fingerprint)\n");
    const double a = 30.0, b = 40.0, c = 50.0, t = 5.0;
    const double abc = a * b * c;
    const double vX = abc - (a - t)      * (b - 2 * t) * (c - 2 * t);   // 30000
    const double vY = abc - (a - 2 * t)  * (b - t)     * (c - 2 * t);   // 32000
    const double vZ = abc - (a - 2 * t)  * (b - 2 * t) * (c - t);       // 33000

    SolidFactory fac;
    Solid* box = fac.buildBox(a, b, c);
    const auto& faces = box->shells.front()->faces;
    check(faces.size() == 6, "asymmetric box has 6 faces");

    for (std::size_t i = 0; i < faces.size(); ++i) {
        // Determine which world axis this face's plane normal points along.
        const Vec3 n = faces[i]->surface->axis;
        const double ax = std::fabs(n.x), ay = std::fabs(n.y), az = std::fabs(n.z);
        double expect; const char* axisName;
        if (ax >= ay && ax >= az)      { expect = vX; axisName = "X"; }
        else if (ay >= ax && ay >= az) { expect = vY; axisName = "Y"; }
        else                           { expect = vZ; axisName = "Z"; }

        SolidFactory f2;                     // fresh solid per removal (shellSolid mutates the builder)
        Solid* bx = f2.buildBox(a, b, c);
        ShellOptions opt; opt.thickness = t; opt.removedFaces = { i }; opt.tol = 1e-9;
        ShellResult r = shellSolid(f2.builder(), bx, opt);

        check(r.ok, std::string("face ") + std::to_string(i) + " open shell ok");
        if (!r.ok) { std::printf("        reason: %s\n", r.reason); continue; }
        check(r.volume > 0.0, std::string("face ") + std::to_string(i) + " housing positive volume");
        check(approx(r.volume, expect, 1e-6),
              std::string("face ") + std::to_string(i) + " (⟂" + axisName +
              ") volume matches that axis's closed form");
        check(r.outerFaces == 5, std::string("face ") + std::to_string(i) + " opened exactly one mouth");
        std::printf("        face %zu ⟂%s  V=%.3f (exp %.3f)\n", i, axisName, r.volume, expect);
    }
}

// (2) bounded indexing — index 5 valid (= JS 1-based "face 6"), index 6 refused.
static void testBoundedIndexing() {
    std::printf("[2] bounded 0-based indexing (index 5 valid, index 6 refused)\n");
    const double a = 30.0, b = 40.0, c = 50.0, t = 5.0;

    {   // index 5 is the LAST valid index of a 6-face box (JS verb's 1-based "face 6").
        SolidFactory fac; Solid* box = fac.buildBox(a, b, c);
        ShellOptions opt; opt.thickness = t; opt.removedFaces = { 5 }; opt.tol = 1e-9;
        ShellResult r = shellSolid(fac.builder(), box, opt);
        check(r.ok, "index 5 (last valid; == JS 1-based face 6) accepted");
    }
    {   // index 6 is the FIRST out-of-range value → honest refusal (no silent seal).
        SolidFactory fac; Solid* box = fac.buildBox(a, b, c);
        ShellOptions opt; opt.thickness = t; opt.removedFaces = { 6 }; opt.tol = 1e-9;
        ShellResult r = shellSolid(fac.builder(), box, opt);
        check(!r.ok, "index 6 out-of-range refused (ok == false, not a silent sealed shell)");
        if (!r.ok) std::printf("        (reason: %s)\n", r.reason);
    }
}

int main() {
    std::printf("=== forge::native::brep — SHELL FACE-ID selection gate (fix #3) ===\n");
    testDeterministicFaceSelection();
    testBoundedIndexing();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
