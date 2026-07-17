// forge-desktop/feature_probe.cpp
//
// ============================================================================
// FORGE C++ DESKTOP FEATURE+DRAFTING PROBE  (Pillar #10, Phase-1)
// ============================================================================
//
// PURPOSE — prove the desktop app's MODELING and DRAFTING surfaces work standalone
// C++ with no Node, beyond the data trilogy (geometry / render-feed / file-IO). A CAD
// app must (a) run modeling FEATURES (shell/fillet/…) and (b) generate 2D DRAWINGS
// (orthographic HLR views). This probe links the NODE-FREE core library
// forge_kernel_core and exercises:
//   1. forge::shell(box, {faceToRemove}, thickness)  — a thick-solid modeling feature;
//        asserts the result is a real solid with 0 < volume < the solid it hollowed
//        (material was removed to a wall, but not all of it).
//   2. forge::projectShape(box, frontView())        — orthographic hidden-line removal;
//        asserts the 2D drawing has visible AND hidden polylines with finite screen
//        coordinates whose extent matches the part (a real front view of a 10-cube).
//
// projectShape is run on a NATIVE solid (the native analytic HLR path is exact on a
// NativeSolid handle — no importOcctSolid faceting). Every measured value is printed.
// Exit 0 == all checks passed. No graphics, no window, no Node.
//
// Build (option-gated, does NOT touch the default .node build):
//   cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
//   cmake --build build -j3 --target forge_feature_probe
//   ./build/forge_feature_probe

#include "forge/Primitives.hpp"     // forge::makeBox
#include "forge/MassProps.hpp"      // forge::massProperties
#include "forge/Features.hpp"       // forge::shell
#include "forge/Drawings.hpp"       // forge::projectShape / frontView / ProjectedView

#include <cmath>
#include <cstdio>
#include <exception>
#include <vector>

namespace {

int  g_check = 0;
bool g_failed = false;

#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_check;                                                             \
        if (!(cond)) {                                                         \
            std::fprintf(stderr, "  FAIL check #%d  (%s)  [line %d]\n",        \
                         g_check, #cond, __LINE__);                            \
            g_failed = true;                                                   \
            return g_check;                                                    \
        }                                                                      \
    } while (0)

// Count polylines + vertices across a list, and check every coordinate is finite;
// also accumulate the 2D screen-space extent.
struct PolyStats { std::size_t polys = 0, verts = 0; bool finite = true;
                   double lo[2] = {1e30, 1e30}, hi[2] = {-1e30, -1e30}; };
PolyStats statOf(const std::vector<forge::Polyline2D>& lists) {
    PolyStats s;
    for (const auto& pl : lists) {
        ++s.polys;
        for (const auto& pt : pl) {
            ++s.verts;
            if (!std::isfinite(pt.first) || !std::isfinite(pt.second)) s.finite = false;
            s.lo[0] = std::min(s.lo[0], pt.first);  s.hi[0] = std::max(s.hi[0], pt.first);
            s.lo[1] = std::min(s.lo[1], pt.second); s.hi[1] = std::max(s.hi[1], pt.second);
        }
    }
    return s;
}

int run() {
    std::printf("=== Forge C++ Desktop Feature+Drafting Probe ===\n");
    std::printf("  linked library : forge_kernel_core  (N-API binding EXCLUDED)\n");
    std::printf("  surfaces       : shell (modeling feature) + projectShape (2D HLR drawing)\n\n");

    // 1) SHELL — hollow a 10-cube by removing one face, wall thickness 1.
    {
        forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
        const double boxVol = forge::massProperties(box).volume;
        // Remove face id 0 (a valid face of any solid); uniform 1 mm wall.
        forge::ShapeHandle shelled =
            forge::part::shell(box, /*faceIdsToRemove*/ {0}, /*thickness*/ 1.0,
                               /*multiThickness*/ {});
        const double shVol = forge::massProperties(shelled).volume;
        std::printf("  [shell        ] box vol=%.3f -> shell vol=%.3f (wall 1mm, 1 face open)\n",
                    boxVol, shVol);
        CHECK(boxVol > 999.0);              // sanity on the source
        CHECK(shVol > 0.0);                 // a real solid came back
        CHECK(shVol < boxVol);              // material was removed (it's a shell)
        CHECK(shVol > 0.05 * boxVol);       // but a plausible wall remains (not collapsed)
    }

    // 2) DRAWING — orthographic HLR front view of the 10-cube.
    {
        forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
        forge::ProjectedView v = forge::projectShape(box, forge::frontView());
        PolyStats vis = statOf(v.visible);
        PolyStats hid = statOf(v.hidden);
        std::printf("  [drawing front] visible: %zu polylines / %zu verts   hidden: %zu / %zu\n",
                    vis.polys, vis.verts, hid.polys, hid.verts);
        CHECK(vis.polys > 0 && vis.verts >= 3);   // a real visible outline
        CHECK(vis.finite && hid.finite);          // finite screen coordinates
        // A cube front view spans ~10 in each screen axis (the face is 10x10).
        double w = vis.hi[0] - vis.lo[0];
        double hgt = vis.hi[1] - vis.lo[1];
        std::printf("      visible screen extent = %.3f x %.3f (expect ~10 x 10)\n", w, hgt);
        CHECK(w > 5.0 && w < 20.0);
        CHECK(hgt > 5.0 && hgt < 20.0);
        // A solid box has occluded back edges -> the HLR must produce hidden lines too.
        CHECK(hid.polys > 0);
    }

    std::printf("\n=== ALL %d CHECKS PASSED — PASS ===\n", g_check);
    return 0;
}

}  // namespace

int main() {
    try {
        int rc = run();
        if (rc != 0) {
            std::fprintf(stderr, "\n=== FEATURE+DRAFTING PROBE FAILED at check #%d ===\n", rc);
            return rc;
        }
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "\n=== FEATURE+DRAFTING PROBE THREW: %s ===\n", e.what());
        return 255;
    }
}
