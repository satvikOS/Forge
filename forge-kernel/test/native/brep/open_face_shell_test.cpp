// forge/native/brep/open_face_shell_test.cpp
//
// Native gate for FIX #2 — "open-face part.shell".
//
// THE FRICTION (production / OCCT path): forge.part.shell with an EMPTY faceIds
// set seals the part, and OCCT BRepOffsetAPI_MakeThickSolid then emits an
// INVERTED solid whose mass-property volume is NEGATIVE (measured: a sealed
// 40 mm box at t=6 → V = −136076). That is wrong USAGE, not a kernel bug: a
// hollow HOUSING needs an OPEN mouth, so the caller must name the open face(s).
// The production fix makes the JS verb (a) document this, (b) convert the
// 1-based open-face id to the kernel's 0-based index, and (c) reject a
// non-positive-volume result with a clear, actionable error rather than
// returning the inverted body.
//
// This gate proves the GEOMETRIC CONTRACT in the dependency-free in-house shell
// (brep::shellSolid + MassProps) — pure C++20, NO external deps, NO WASM, no
// framework. The in-house shell offsets INWARD by construction, so it is the
// correct-by-construction reference: an open-face shell is a POSITIVE-volume
// watertight housing, and a too-thick wall is refused honestly.
//
// CLOSED-FORM GATES (box L=40, wall t=6 — never weakened):
//   (1) OPEN-TOP HOUSING. Remove the TOP face → a watertight wall whose volume
//       is POSITIVE and equals  L³ − (L−2t)²·(L−t) = 64000 − 28²·34 = 37344
//       (>0, NOT the inverted negative the sealed OCCT case produced). The wall
//       is a closed 2-manifold (mouth bridged by a thickness-t lip), 0 free
//       edges.
//   (2) SEALED SHELL IS POSITIVE TOO. With NO face removed the in-house shell is
//       a watertight hollow whose volume is the POSITIVE wall volume
//       L³ − (L−2t)³ = 64000 − 28³ = 42048 — confirming the inward-offset sign
//       is correct (the OCCT negative-volume inversion is specific to that
//       path, and is what the JS verb now rejects).
//   (3) WALL THICKNESS. The inner floor of the open-top housing sits exactly t
//       above the outer floor (sampled via the analytic face offset).
//   (4) HONEST REFUSAL. A wall as thick as the part's half-extent (t ≥ L/2)
//       collapses the cavity → ok == false with a reason (no fake solid).

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

// Box face order (Primitives.cpp buildBox): 0 bottom, 1 top, 2 front, 3 back,
// 4 left, 5 right.
static constexpr std::size_t FACE_TOP = 1;

// (1) open-top housing — POSITIVE-volume watertight hollow.
static void testOpenTopHousing() {
    std::printf("[1] open-top housing (box L=40, wall t=6, top open)\n");
    const double L = 40.0, t = 6.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);

    ShellOptions opt;
    opt.thickness = t;
    opt.removedFaces = { FACE_TOP };
    opt.tol = 1e-9;

    ShellResult r = shellSolid(fac.builder(), box, opt);
    check(r.ok, std::string("open-top shell ok (") + r.reason + ")");
    if (!r.ok) return;

    const double expected = L * L * L - (L - 2 * t) * (L - 2 * t) * (L - t); // 37344
    check(r.volume > 0.0, "housing volume is POSITIVE (not the inverted negative OCCT case)");
    check(approx(r.volume, expected, 1e-9), "volume == L³ − (L−2t)²(L−t) == 37344 (1e-9)");
    check(r.closedManifold, "wall is a closed 2-manifold (mouth bridged by lip)");
    check(r.freeEdges == 0, "0 free edges (watertight wall)");

    // Wall thickness: inner floor sits exactly t above the outer floor.
    {
        Surface* bottom = box->shells.front()->faces[0]->surface;  // z=0, outward −Z
        OffsetSurfaceResult os = offsetSurfaceInward(*bottom, t);
        check(os.ok && approx(os.surface.origin.z, t, 1e-12), "inner floor at z == t (wall thickness == t)");
    }

    std::printf("      -> V=%.6f (exp %.6f)  outerF=%zu innerF=%zu wallF=%zu  %s\n",
                r.volume, expected, r.outerFaces, r.innerFaces, r.wallFaces,
                r.closedManifold ? "CLOSED-MANIFOLD" : "OPEN");
}

// (2) sealed shell — POSITIVE volume confirms the inward-offset sign.
static void testSealedPositive() {
    std::printf("[2] sealed shell positive-volume sign check (no face removed)\n");
    const double L = 40.0, t = 6.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);
    ShellOptions opt; opt.thickness = t; opt.tol = 1e-9;   // removedFaces empty

    ShellResult r = shellSolid(fac.builder(), box, opt);
    check(r.ok, std::string("sealed shell ok (") + r.reason + ")");
    if (!r.ok) return;

    const double expected = L * L * L - (L - 2 * t) * (L - 2 * t) * (L - 2 * t); // 42048
    check(r.volume > 0.0, "sealed wall volume is POSITIVE (correct inward-offset sign)");
    check(approx(r.volume, expected, 1e-9), "volume == L³ − (L−2t)³ == 42048 (1e-9)");
    check(r.closedManifold && r.freeEdges == 0, "watertight closed hollow");

    std::printf("      -> V=%.6f (exp %.6f)\n", r.volume, expected);
}

// (4) honest refusal — wall too thick.
static void testOverThickRefused() {
    std::printf("[3] honest refusal — wall ≥ half-extent collapses the cavity\n");
    const double L = 40.0;

    SolidFactory fac;
    Solid* box = fac.buildBox(L, L, L);
    ShellOptions opt; opt.thickness = L / 2.0; opt.removedFaces = { FACE_TOP }; opt.tol = 1e-9;

    ShellResult r = shellSolid(fac.builder(), box, opt);
    check(!r.ok, "t == L/2 refused (ok == false, no fake)");
    if (!r.ok) std::printf("      (reason: %s)\n", r.reason);
}

int main() {
    std::printf("=== forge::native::brep — OPEN-FACE SHELL housing gate (fix #2) ===\n");
    testOpenTopHousing();
    testSealedPositive();
    testOverThickRefused();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
