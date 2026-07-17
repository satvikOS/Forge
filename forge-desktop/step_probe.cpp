// forge-desktop/step_probe.cpp
//
// ============================================================================
// FORGE C++ DESKTOP STEP-IO PROBE  (Pillar #10, Phase-1 — the file-IO backbone)
// ============================================================================
//
// PURPOSE — prove the desktop app's persistence / interchange layer works standalone
// C++ with no Node. A CAD app must Open/Save STEP (the exact analytic exchange, the
// kernel's lossless format). This probe links the NODE-FREE core library
// forge_kernel_core (same one foundation_probe / mesh_probe proved) and, for a box /
// cylinder / boolean:
//   1. exportStep(...)     -> a STEP AP242 file; asserts it exists, is non-trivial,
//        and begins with the ISO-10303-21 magic (a real STEP part file).
//   2. importStep(...)     -> a fresh ShapeHandle; asserts the ROUND-TRIP preserves
//        geometry: massProperties(reimported).volume == massProperties(original)
//        volume (native STEP is analytic + lossless, so exact to a tight tol).
//   3. re-export the reimported body -> asserts the writer is idempotent (a second
//        STEP file is produced), i.e. an imported body is itself re-savable.
//
// This is the third leg of the Phase-1 foundation trilogy — geometry (foundation_probe),
// render-feed (mesh_probe), and now file-IO — all proven to run standalone C++ with
// ZERO Node. Every measured value is printed. Exit 0 == all checks passed.
//
// Build (option-gated, does NOT touch the default .node build):
//   cmake -B build -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
//   cmake --build build -j3 --target forge_step_probe
//   ./build/forge_step_probe

#include "forge/Primitives.hpp"     // forge::makeBox / makeCylinder
#include "forge/Booleans.hpp"       // forge::cut
#include "forge/Transform.hpp"      // forge::translate
#include "forge/MassProps.hpp"      // forge::massProperties
#include "forge/IoExchange.hpp"     // forge::io::exportStep / importStep

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

namespace {

constexpr double PI = 3.14159265358979323846;

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

bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// File size, or -1 if missing/unreadable.
long fileSize(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return -1;
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fclose(f);
    return n;
}

// True iff the file begins with the ISO-10303-21 STEP magic (allowing a leading BOM
// / whitespace, which real STEP files do not use — a strict prefix check is fine).
bool isStepFile(const std::string& path) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    char head[16] = {0};
    std::size_t rd = std::fread(head, 1, sizeof(head) - 1, f);
    std::fclose(f);
    if (rd < 12) return false;
    return std::strncmp(head, "ISO-10303-21", 12) == 0;
}

// Export -> import -> verify volume preserved -> re-export, for one solid.
int checkStepRoundTrip(const char* tag, forge::ShapeHandle h,
                       const std::string& dir, double tol) {
    const double vol0 = forge::massProperties(h).volume;

    const std::string p1 = dir + "/" + tag + ".step";
    bool wrote = forge::io::exportStep(h, p1);
    CHECK(wrote);
    long sz = fileSize(p1);
    CHECK(sz > 64);                 // a real STEP file, not an empty stub
    CHECK(isStepFile(p1));          // ISO-10303-21 magic

    forge::ShapeHandle h2 = forge::io::importStep(p1);
    const double vol1 = forge::massProperties(h2).volume;

    std::printf("  [%-14s] vol(orig)=%.6f  ->  STEP %ld B  ->  vol(reimport)=%.6f\n",
                tag, vol0, sz, vol1);

    CHECK(vol1 > 0.0);                        // imported to a real solid
    CHECK(approx(vol1, vol0, tol));           // round-trip preserved geometry

    // The reimported body must itself be re-savable (idempotent writer).
    const std::string p2 = dir + "/" + tag + "_reexport.step";
    bool wrote2 = forge::io::exportStep(h2, p2);
    CHECK(wrote2);
    CHECK(isStepFile(p2));
    std::printf("      re-export ok (%ld B)\n", fileSize(p2));
    return 0;
}

int run() {
    std::printf("=== Forge C++ Desktop STEP-IO Probe ===\n");
    std::printf("  linked library : forge_kernel_core  (N-API binding EXCLUDED)\n");
    std::printf("  backbone       : ShapeHandle -> exportStep -> importStep -> volume-preserved\n\n");

    const std::string dir = "/tmp/forge_step_probe";
    std::system(("mkdir -p " + dir).c_str());

    {   // box: exact planar volume, round-trip must be exact.
        forge::ShapeHandle box = forge::makeBox(10.0, 10.0, 10.0);
        int rc = checkStepRoundTrip("box", box, dir, /*tol*/ 1e-6);
        if (rc) return rc;
    }
    {   // cylinder: analytic quadric; native STEP is analytic + lossless.
        forge::ShapeHandle cyl = forge::makeCylinder(5.0, 10.0);
        int rc = checkStepRoundTrip("cylinder", cyl, dir, /*tol*/ 1e-3);
        if (rc) return rc;
    }
    {   // boolean: a through-drilled box — a multi-face B-rep round-trip.
        forge::ShapeHandle box  = forge::makeBox(10.0, 10.0, 10.0);
        forge::ShapeHandle tool = forge::translate(forge::makeCylinder(2.0, 20.0),
                                                   5.0, 5.0, -5.0);
        forge::ShapeHandle drilled = forge::cut(box, tool);
        const double want = 1000.0 - PI * 4.0 * 10.0;   // 1000 - vol(r2,h10 bore)
        double got = forge::massProperties(drilled).volume;
        std::printf("  [drilled pre ] vol=%.6f (want ~%.6f)\n", got, want);
        int rc = checkStepRoundTrip("drilled", drilled, dir, /*tol*/ 1e-2);
        if (rc) return rc;
    }

    std::printf("\n=== ALL %d CHECKS PASSED — PASS ===\n", g_check);
    return 0;
}

}  // namespace

int main() {
    try {
        int rc = run();
        if (rc != 0) {
            std::fprintf(stderr, "\n=== STEP-IO PROBE FAILED at check #%d ===\n", rc);
            return rc;
        }
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "\n=== STEP-IO PROBE THREW: %s ===\n", e.what());
        return 255;
    }
}
