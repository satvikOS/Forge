// forge-kernel/test/callsite_concave_fillet_test.cpp
//
// CALL-SITE proof for the native CONCAVE (reflex) blend — drives the REAL public
// entry points forge::part::filletEdges / forge::part::chamferEdges (src/Features.cpp
// :1562 and :1974) on a REAL OCCT shape, not the engine's own API.
//
// The shape is an L-prism built the way the app builds one: cut(box, box), which
// yields an OCCT TopoDS_Shape carrying exactly one reflex vertical edge at (10,10)
// alongside five convex ones. Base polygon (0,0)(30,0)(30,10)(10,10)(10,20)(0,20),
// area 400, height 8, volume 3200.
//
// WHAT THIS PROVES THAT THE ENGINE-LEVEL A/B CANNOT.
//   Compiled with -DFORGE_FILLET_DROP_NATIVE=ON there is NO BRepFilletAPI in the
//   binary and TKFillet is NOT linked, so a fillet that returns a solid can ONLY
//   have come from forge::occtfillet. Run that way, a PASS is a proof of routing.
//   Compiled WITHOUT the drop it still passes — the same request is served by the
//   native engine and the OCCT fallback is simply never reached — so this file is a
//   regression test in both configurations. The runner script builds and runs BOTH.
//
// EDGE IDENTIFICATION is by BEHAVIOUR, not by index: the call site addresses edges
// by TopExp order and this test does not assume which index the reflex edge got. It
// sweeps every id, and asserts that exactly ONE of them ADDS the concave closed-form
// volume (+(1-pi/4)R^2*L) and that at least four ADD nothing / remove it — so a
// renumbering cannot make the test silently vacuous.
//
// Build + run with  bash forge-kernel/test/run_callsite_concave_fillet.sh

#include "forge/Primitives.hpp"
#include "forge/Transform.hpp"
#include "forge/Booleans.hpp"
#include "forge/Features.hpp"
#include "forge/MassProps.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_pass = 0, g_total = 0;
void check(bool c, const std::string& what) {
    ++g_total;
    std::printf("  %s %s\n", c ? "[PASS]" : "[FAIL]", what.c_str());
    if (c) ++g_pass;
}
bool relClose(double a, double b, double tol) {
    const double s = std::max(1.0, std::max(std::fabs(a), std::fabs(b)));
    return std::fabs(a - b) <= tol * s;
}

}  // namespace

int main() {
    std::printf("=== CALL-SITE: forge::part::filletEdges / chamferEdges on a reflex edge ===\n");
#ifdef FORGE_FILLET_DROP_NATIVE
    std::printf("    build: FORGE_FILLET_DROP_NATIVE=ON — no BRepFilletAPI compiled\n");
#else
    std::printf("    build: default (OCCT BRepFilletAPI fallback still compiled)\n");
#endif

    // Force the OCCT core route BEFORE the first kernel call. Without this, cut()
    // returns a NativeSolid whose fetch() bridges through the FACETED path — measured
    // 2026-08-29: 54 edges / 36 faces for this L instead of 18 / 8 — and the fillet
    // then runs on a faceted body, which is a different question from the one this
    // test asks. The gates are function-local statics read on first use, so setting
    // the environment here is deterministic.
    ::setenv("FORGE_NATIVE_BREP", "0", 1);

    const double H = 8.0, R = 2.0, D = 2.0;
    const double baseVol = 400.0 * H;                       // 3200
    const double dFillet = (1.0 - kPi / 4.0) * R * R * H;   // per 90-degree edge
    const double dChamfer = 0.5 * D * D * H;                // per 90-degree edge

    forge::ShapeHandle L;
    try {
        const forge::ShapeHandle big = forge::makeBox(30.0, 20.0, H);
        const forge::ShapeHandle notch =
            forge::translate(forge::makeBox(20.0, 10.0, H + 2.0), 10.0, 10.0, -1.0);
        L = forge::cut(big, notch);
    } catch (const std::exception& e) {
        std::printf("  [FAIL] could not build the L-prism: %s\n", e.what());
        return 1;
    }
    const double v0 = forge::massProperties(L).volume;
    check(relClose(v0, baseVol, 1e-9), "L-prism volume == 3200");

    // Sweep every edge id; classify by what the blend did to the volume.
    int nConcaveF = 0, nConvexF = 0, nOtherF = 0, nDeclined = 0, nIds = 0;
    std::string firstDecline;
    for (std::uint32_t id = 0; id < 64; ++id) {
        double v = 0.0;
        try {
            v = forge::massProperties(forge::part::filletEdges(L, {id}, R)).volume;
        } catch (const std::exception& e) {
            // An out-of-range id and an honest in-scope decline both land here; the
            // sweep does NOT stop on either, because stopping at the first throw is
            // how a renumbering would silently empty this test.
            if (firstDecline.empty()) firstDecline = e.what();
            ++nDeclined;
            continue;
        } catch (...) {
            // OCCT's Standard_Failure does NOT derive from std::exception — catching
            // only std::exception here let an OCCT raise escape and abort the process.
            if (firstDecline.empty()) firstDecline = "(non-std exception, e.g. OCCT Standard_Failure)";
            ++nDeclined;
            continue;
        }
        ++nIds;
        if      (relClose(v, baseVol + dFillet, 1e-9)) ++nConcaveF;
        else if (relClose(v, baseVol - dFillet, 1e-9)) ++nConvexF;
        else                                           ++nOtherF;
    }
    std::printf("  swept %d ids: concave=%d convex=%d other=%d declined=%d\n",
                nIds, nConcaveF, nConvexF, nOtherF, nDeclined);
    if (!firstDecline.empty()) std::printf("  first decline: %s\n", firstDecline.c_str());
    check(nIds > 0, "the sweep reached at least one edge id");
    // >= 1, not == 1: edgeById addresses edges in TopExp_Explorer order, which visits
    // a shared edge ONCE PER ADJACENT FACE, so the single reflex edge answers to two
    // ids (measured: 15 and 18 on this shape).
    check(nConcaveF >= 1, "an edge id ADDS the concave closed-form volume "
                          "(+ (1-pi/4)R^2 L) — the reflex edge is served, not refused");
    check(nConvexF >= 4, "at least four edge ids REMOVE it (the convex verticals still work)");

    // The same reflex edge, chamfered, through the chamfer call site.
    int nConcaveC = 0, nConvexC = 0;
    for (std::uint32_t id = 0; id < 64; ++id) {
        double v = 0.0;
        try {
            v = forge::massProperties(forge::part::chamferEdges(L, {id}, D, -1.0)).volume;
        } catch (const std::exception&) { continue; }
          catch (...) { continue; }
        if      (relClose(v, baseVol + dChamfer, 1e-9)) ++nConcaveC;
        else if (relClose(v, baseVol - dChamfer, 1e-9)) ++nConvexC;
    }
    std::printf("  chamfer sweep: concave=%d convex=%d\n", nConcaveC, nConvexC);
    check(nConcaveC >= 1, "an edge id ADDS the concave chamfer volume (+ d^2 sin(psi) L / 2)");
    check(nConvexC >= 4, "at least four edge ids REMOVE it");

    std::printf("\n=== %d/%d call-site assertions passed ===\n", g_pass, g_total);
    return g_pass == g_total ? 0 : 1;
}
