// forge-desktop/foundation_probe.cpp
//
// ============================================================================
// FORGE C++ DESKTOP FOUNDATION PROBE  (Pillar #10, Phase-1 — the riskiest unknown)
// ============================================================================
//
// PURPOSE — prove that the Forge geometry kernel decouples from Node.
//
// The shipping `forge-kernel.node` compiles the N-API binding (src/binding*.cpp,
// which `#include <napi.h>`) INTO the shared library, so a plain C++ program that
// linked it would drag in Node's N-API runtime at load. This probe links the
// NODE-FREE core library `forge_kernel_core` (== forge_kernel MINUS the 4 binding
// translation units) and drives the kernel HEADLESSLY through its public C++ API
// (`forge::makeBox`, `forge::cut`, `forge::massProperties`, `forge::faceInventory`,
// ...). If this builds and runs, the C++ -> kernel bridge is real with ZERO Node.
//
// It builds a box, a cylinder, and a boolean (a through-drilled box), queries
// volume + face inventory, and ASSERTS exact / near-exact expected values. Every
// measured value is printed. Exit code 0 == all checks passed; nonzero == the id
// of the first failing check. No graphics, no window, no Node — pure geometry.
//
// Build (option-gated, does NOT touch the default .node build):
//   cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
//   cmake --build build -j3 --target forge_kernel_core forge_foundation_probe
//   ./build/forge_foundation_probe

#include "forge/Primitives.hpp"     // forge::makeBox / makeCylinder
#include "forge/Booleans.hpp"       // forge::cut
#include "forge/Transform.hpp"      // forge::translate
#include "forge/MassProps.hpp"      // forge::massProperties
#include "forge/DirectEdit.hpp"     // forge::faceInventory / unifyFaces / FaceInfo
#include "forge/native/brep/NativeRoute.hpp"  // forgeNativeBrepEnabled() (path report only)

#include <cmath>
#include <cstdio>
#include <exception>

namespace {

constexpr double PI = 3.14159265358979323846;

int g_check = 0;
bool g_failed = false;

// A hard check: increments the check counter, records + reports the FIRST failure.
#define CHECK(cond)                                                            \
    do {                                                                       \
        ++g_check;                                                             \
        if (!(cond)) {                                                         \
            std::fprintf(stderr, "  FAIL check #%d  (%s)  [line %d]\n",        \
                         g_check, #cond, __LINE__);                            \
            if (!g_failed) g_failed = true;                                    \
            return g_check;                                                    \
        }                                                                      \
    } while (0)

bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

int run() {
    std::printf("=== Forge C++ Desktop Foundation Probe ===\n");
    std::printf("  linked library : forge_kernel_core  (N-API binding EXCLUDED)\n");
    std::printf("  kernel backend : %s\n",
                forge::native::brep::forgeNativeBrepEnabled()
                    ? "native analytic B-rep (production default)"
                    : "OCCT baseline");
    std::printf("\n");

    // ---------------------------------------------------------------------
    // 1. BOX  10 x 10 x 10  ->  exact volume 1000, exactly 6 planar faces.
    // ---------------------------------------------------------------------
    forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
    forge::MassProperties bmp = forge::massProperties(box);
    std::vector<forge::FaceInfo> bfaces = forge::faceInventory(box);
    int planar = 0;
    double faceAreaSum = 0.0;
    for (const auto& f : bfaces) { if (f.kind == "plane") ++planar; faceAreaSum += f.area; }

    std::printf("[1] makeBox(10,10,10)\n");
    std::printf("    volume        = %.9f   (expected 1000)\n", bmp.volume);
    std::printf("    surface area  = %.9f   (expected 600)\n", faceAreaSum);
    std::printf("    face count    = %zu           (expected 6)\n", bfaces.size());
    std::printf("    planar faces  = %d           (expected 6)\n", planar);
    std::printf("    centroid      = (%.6f, %.6f, %.6f)\n", bmp.cx, bmp.cy, bmp.cz);
    CHECK(approx(bmp.volume, 1000.0, 1e-6));
    CHECK(bfaces.size() == 6);
    CHECK(planar == 6);
    CHECK(approx(faceAreaSum, 600.0, 1e-6));
    CHECK(approx(bmp.cx, 5.0, 1e-9) && approx(bmp.cy, 5.0, 1e-9) && approx(bmp.cz, 5.0, 1e-9));

    // ---------------------------------------------------------------------
    // 2. CYLINDER  r=5 h=10  ->  exact volume pi*25*10; after unifyFaces the
    //    face inventory is 1 lateral + 2 caps == 3 (the native->OCCT bridge
    //    emits the analytic side as angular strips; unifyFaces merges them —
    //    the documented DirectEdit prerequisite).
    // ---------------------------------------------------------------------
    forge::ShapeHandle rawCyl = forge::makeCylinder(5.0, 10.0);
    forge::MassProperties cmp = forge::massProperties(rawCyl);
    forge::ShapeHandle cyl = forge::unifyFaces(rawCyl);
    std::vector<forge::FaceInfo> cfaces = forge::faceInventory(cyl);
    int lateral = 0; double latR = 0.0;
    for (const auto& f : cfaces) { if (f.kind == "cylinder") { ++lateral; latR = f.radius; } }
    const double cylVol = PI * 25.0 * 10.0;

    std::printf("\n[2] makeCylinder(r=5, h=10)  [+ unifyFaces]\n");
    std::printf("    volume        = %.9f   (expected %.9f = pi*25*10)\n", cmp.volume, cylVol);
    std::printf("    face count    = %zu           (expected 3 after unify)\n", cfaces.size());
    std::printf("    lateral faces = %d  radius = %.9f (expected 1 face, r=5)\n", lateral, latR);
    CHECK(approx(cmp.volume, cylVol, 1e-6));
    CHECK(cfaces.size() == 3);
    CHECK(lateral == 1);
    CHECK(approx(latR, 5.0, 1e-6));

    // ---------------------------------------------------------------------
    // 3. BOOLEAN — a through-drilled box.  box(10^3) MINUS a centred cylinder
    //    r=2 h=10 (translated to (5,5)) removes a clean through-hole:
    //      drop = pi*r^2*h = pi*4*10 = 125.6637...
    //      result volume    = 1000 - 125.6637 = 874.3363...
    //    The hole strictly adds faces (> 6). Curved boolean -> relative tol.
    // ---------------------------------------------------------------------
    forge::ShapeHandle drill = forge::translate(forge::makeCylinder(2.0, 10.0), 5.0, 5.0, 0.0);
    forge::ShapeHandle holed = forge::cut(box, drill);
    forge::MassProperties hmp = forge::massProperties(holed);
    std::vector<forge::FaceInfo> hfaces = forge::faceInventory(holed);
    const double removed = PI * 4.0 * 10.0;
    const double expectVol = 1000.0 - removed;

    std::printf("\n[3] cut( box(10^3), cylinder(r=2,h=10) @ (5,5) )  [through-hole]\n");
    std::printf("    volume        = %.9f   (expected %.9f = 1000 - pi*4*10)\n", hmp.volume, expectVol);
    std::printf("    removed        = %.9f   (expected %.9f)\n", 1000.0 - hmp.volume, removed);
    std::printf("    face count    = %zu           (expected > 6: box + bore)\n", hfaces.size());
    CHECK(hmp.volume < 1000.0);                             // material was removed
    CHECK(approx(hmp.volume, expectVol, 1e-2 * removed));   // within 1% of analytic drop
    CHECK(hfaces.size() > 6);                               // a through-hole adds faces

    std::printf("\n=== ALL %d CHECKS PASSED — PASS ===\n", g_check);
    std::printf("Node-free kernel core drove box + cylinder + boolean headlessly.\n");
    return 0;
}

} // namespace

int main() {
    try {
        int rc = run();
        if (rc != 0) {
            std::fprintf(stderr, "\n=== PROBE FAILED at check #%d ===\n", rc);
        }
        return rc;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "\n=== PROBE THREW: %s ===\n", e.what());
        return 255;
    } catch (...) {
        std::fprintf(stderr, "\n=== PROBE THREW (unknown) ===\n");
        return 255;
    }
}
