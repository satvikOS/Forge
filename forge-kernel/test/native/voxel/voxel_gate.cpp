// forge/native/test/voxel/voxel_gate.cpp
//
// Stage 5 (voxel/lattice) FIRST-increment validation gate. Standalone harness,
// no test framework, no external deps. Every assertion checks a COMPUTED value
// against an ANALYTIC oracle (Bible §0/§9 + roadmap §D rule 2: never an
// unmeasured number).
//
// GATES:
//   (a) SPHERE VOLUME CONVERGENCE — voxelize an SDF sphere of radius r at
//       shrinking spacings; occupied-volume (inside-cell count * cell volume)
//       must converge to 4/3*pi*r^3, with the relative error SHRINKING as the
//       grid refines. Oracle: closed-form sphere volume.
//   (b) GYROID VOLUME FRACTION — the iso=0 gyroid over an integer number of
//       periods has solid volume fraction ~ 0.5. Oracle: the exact 1/2 from the
//       g -> -g antisymmetry of the balanced gyroid. Stated tolerance below.
//   (c) GYROID CONNECTIVITY / PERCOLATION — the iso=0 gyroid solid is a single
//       6-connected component that percolates all three axes (bicontinuous).
//
// TARGETED (reported, not tested as a pass/fail of a mesh): voxel->surface mesh
// extraction is deferred to the shared IsoMesher (roadmap §B Stage 4).
//
// Build + run:
//   clang++ -std=c++20 -O2 -I <include> <this .cpp> <VoxelGrid.cpp> <Tpms.cpp> \
//       -o /tmp/voxel_test && /tmp/voxel_test

#include "forge/native/voxel/VoxelGrid.hpp"
#include "forge/native/voxel/Tpms.hpp"

#include <cstdio>
#include <cmath>
#include <vector>
#include <string>

using namespace forge::native;

static int g_passed = 0;
static int g_total  = 0;

static void check(bool cond, const std::string& name, const std::string& detail) {
    ++g_total;
    if (cond) {
        ++g_passed;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s -- %s\n", name.c_str(), detail.c_str());
    }
}

// ---------------------------------------------------------------------------
// Gate (a): voxelized sphere volume convergence.
// ---------------------------------------------------------------------------
static void gateSphereVolume() {
    std::printf("\n[gate a] voxelized SDF sphere volume -> 4/3 pi r^3 (shrinking error)\n");
    const double r = 1.0;
    const double exact = (4.0 / 3.0) * M_PI * r * r * r; // = 4.18879...
    std::printf("    analytic volume = %.10f\n", exact);

    // Refine spacing; record relative error at each level.
    const std::vector<double> spacings = {0.20, 0.10, 0.05, 0.025};
    std::vector<double> relErr;
    for (double h : spacings) {
        VoxelGrid<float> g = voxelizeSphere(r, h);
        // inside = SDF <= 0 (negative inside). Use cell-center midpoint rule.
        double vol = g.occupiedVolumeByCenter(0.0, /*insideIsLeq=*/true);
        double e = std::fabs(vol - exact) / exact;
        relErr.push_back(e);
        std::printf("    h=%.4f  nodes=%zu^3  cells=%zu  vol=%.6f  relErr=%.5f%%\n",
                    h, g.nx(), g.cellCount(), vol, e * 100.0);
    }

    // (a.1) finest level is accurate (midpoint rule on a 1.0-radius sphere at
    // h=0.025 should be well under 1% error).
    check(relErr.back() < 0.01,
          "sphere volume accurate at finest spacing (<1% err)",
          "finest relErr=" + std::to_string(relErr.back()));

    // (a.2) error SHRINKS overall: finest error is a small fraction of coarsest.
    check(relErr.back() < relErr.front() * 0.5,
          "sphere volume error shrinks with refinement",
          "coarse=" + std::to_string(relErr.front()) +
          " fine=" + std::to_string(relErr.back()));

    // (a.3) monotone-ish convergence: each successive (averaged) refinement is
    // not worse than the previous by more than mild non-monotonicity slack.
    // Midpoint volume error can wobble slightly due to grid alignment, so we
    // assert the trend over the full sweep rather than strict step monotonicity.
    bool trendDown = relErr.back() < relErr[1];
    check(trendDown,
          "sphere volume error trends down across the sweep",
          "relErr[1]=" + std::to_string(relErr[1]) +
          " back=" + std::to_string(relErr.back()));
}

// ---------------------------------------------------------------------------
// Gate (b): gyroid volume fraction ~ 0.5.
// ---------------------------------------------------------------------------
static void gateGyroidVolumeFraction() {
    std::printf("\n[gate b] gyroid iso=0 solid volume fraction -> 0.5\n");
    // Integer number of periods so the balanced field is symmetric.
    const int periods = 4;
    const int samplesPerPeriod = 24;
    VoxelGrid<float> g = buildGyroidGrid(periods, samplesPerPeriod);

    // solid = { g <= 0 }
    std::size_t inside = g.countInsideCellsByCenter(0.0, /*insideIsLeq=*/true);
    double frac = double(inside) / double(g.cellCount());
    std::printf("    periods=%d  samples/period=%d  cells=%zu\n",
                periods, samplesPerPeriod, g.cellCount());
    std::printf("    inside cells=%zu  volume fraction=%.5f\n", inside, frac);

    // Stated tolerance: 0.02 (2 percentage points). The continuum value is
    // exactly 0.5 by g -> -g antisymmetry; discretisation jitter is well within
    // this band at 24 samples/period.
    const double tol = 0.02;
    check(std::fabs(frac - 0.5) < tol,
          "gyroid volume fraction within 0.02 of 0.5",
          "frac=" + std::to_string(frac));

    // Refinement also tightens it: a finer grid should be at least as close.
    VoxelGrid<float> gf = buildGyroidGrid(periods, samplesPerPeriod * 2);
    std::size_t inside2 = gf.countInsideCellsByCenter(0.0, true);
    double frac2 = double(inside2) / double(gf.cellCount());
    std::printf("    refined samples/period=%d  volume fraction=%.5f\n",
                samplesPerPeriod * 2, frac2);
    check(std::fabs(frac2 - 0.5) <= std::fabs(frac - 0.5) + 1e-6,
          "gyroid volume fraction does not worsen under refinement",
          "coarse=" + std::to_string(frac) + " fine=" + std::to_string(frac2));
}

// ---------------------------------------------------------------------------
// Gate (c): gyroid connectivity / percolation.
// ---------------------------------------------------------------------------
static void gateGyroidConnectivity() {
    std::printf("\n[gate c] gyroid iso=0 solid is connected + percolates (6-conn)\n");
    const int periods = 3;
    const int samplesPerPeriod = 24;
    VoxelGrid<float> g = buildGyroidGrid(periods, samplesPerPeriod);

    auto r = g.analyzeConnectivity(0.0, /*insideIsLeq=*/true);
    double largestFrac = r.occupiedCells ?
        double(r.largestComponent) / double(r.occupiedCells) : 0.0;
    std::printf("    occupied cells=%zu  components=%zu  largest=%zu (%.2f%% of solid)\n",
                r.occupiedCells, r.componentCount, r.largestComponent,
                largestFrac * 100.0);
    std::printf("    percolates  X=%d  Y=%d  Z=%d\n",
                int(r.percolatesX), int(r.percolatesY), int(r.percolatesZ));

    // (c.1) the solid is essentially one blob: the largest 6-connected component
    // holds the overwhelming majority of occupied cells (tiny corner specks from
    // discretisation are tolerated).
    check(largestFrac > 0.95,
          "gyroid solid largest component holds >95% of cells",
          "largestFrac=" + std::to_string(largestFrac));

    // (c.2) bicontinuity: the dominant component spans opposite faces on all
    // three axes (percolation).
    check(r.percolatesX && r.percolatesY && r.percolatesZ,
          "gyroid solid percolates all three axes",
          "X=" + std::to_string(r.percolatesX) +
          " Y=" + std::to_string(r.percolatesY) +
          " Z=" + std::to_string(r.percolatesZ));
}

// ---------------------------------------------------------------------------
// Sanity: trilinear interpolation reproduces node values + linear fields.
// ---------------------------------------------------------------------------
static void gateInterpolation() {
    std::printf("\n[gate s] VoxelGrid trilinear sampling sanity\n");
    // A linear field f = 2x + 3y + 5z must be reproduced EXACTLY by trilinear
    // interpolation (trilinear is exact on functions linear in each axis).
    VoxelGrid<float> g(5, 5, 5, Vec3{-1, -2, -3}, 0.5f);
    auto lin = [](double x, double y, double z) { return 2 * x + 3 * y + 5 * z; };
    g.fillFromField(lin);

    // Node reproduction.
    Vec3 nodeP = g.nodePosition(2, 3, 1);
    double atNode = g.sample(nodeP);
    double trueNode = lin(nodeP.x, nodeP.y, nodeP.z);
    check(std::fabs(atNode - trueNode) < 1e-4,
          "sample() reproduces node value",
          "got=" + std::to_string(atNode) + " want=" + std::to_string(trueNode));

    // Mid-cell point (linear field => exact under trilinear).
    Vec3 mid{ -1 + 0.25, -2 + 0.75, -3 + 1.10 };
    double atMid = g.sample(mid);
    double trueMid = lin(mid.x, mid.y, mid.z);
    check(std::fabs(atMid - trueMid) < 1e-3,
          "sample() exact on a linear field (trilinear)",
          "got=" + std::to_string(atMid) + " want=" + std::to_string(trueMid));
}

int main() {
    std::printf("=== forge::native::voxel — Stage 5 first-increment gate ===\n");
#if FORGE_NATIVE_HAVE_PREDICATES
    std::printf("(linked against forge/native/Predicates.hpp; predicates not yet\n"
                " load-bearing in dense-grid arithmetic -- relevant at the\n"
                " TARGETED voxel->mesh stage. See VoxelGrid.hpp PREDICATES NOTE.)\n");
#else
    std::printf("(Predicates.hpp not found -- using local arithmetic only.)\n");
#endif

    gateInterpolation();
    gateSphereVolume();
    gateGyroidVolumeFraction();
    gateGyroidConnectivity();

    std::printf("\n=== RESULT: %d / %d passed ===\n", g_passed, g_total);
    std::printf("TARGETED / NOT shipped this increment: voxel->surface mesh\n"
                "extraction (shared IsoMesher, roadmap Stage 4); morphology\n"
                "offset/shell/dilate/erode; Schwarz-P/diamond TPMS; sparse VDB\n"
                "storage. See header comments.\n");
    return (g_passed == g_total) ? 0 : 1;
}
