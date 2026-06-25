// forge/native/test/voxel/sparse_voxel_test.cpp
//
// Stage 5 SPARSE voxel grid validation gate (standalone, no framework, no deps).
// Gate for SparseVoxelGrid.hpp — the VDB-style hierarchical (root hash-map -> 8^3
// leaf tiles) field store that keeps ONLY active (near-surface / non-background)
// tiles. Every assertion checks the sparse store against (a) the DENSE VoxelGrid
// — the in-house oracle — for round-trip + op result-identity, and (b) a
// CLOSED-FORM analytic volume for the multi-tile sphere (Bible §0/§9).
//
// GATES:
//   (A) ROUND-TRIP EXACT. fromDense(g).toDense() == g node-for-node (every voxel
//       bit-identical) for several shapes: an SDF sphere, an SDF torus, and a
//       CSG UNION of two spheres (min of two SDFs). No quantisation, no lossy band.
//   (B) RESULT IDENTITY vs the DENSE ops.
//         enclosedVolume(sparse, iso) == VoxelGrid::occupiedVolumeByCenter(iso)
//             bit-exact (the integer inside-cell count is identical, so the
//             double volume is identical).
//         offset(sparse, +d).toDense() == dense f-d field node-for-node.
//         shell(sparse, t).toDense()   == dense |f|-t/2 field node-for-node.
//       The sparse op does NOT change the answer — it only skips empty tiles.
//   (C) MEMORY / SPARSITY WIN. For a thin spherical SHELL field (surface-localised)
//       the active-tile node slots are a SMALL fraction (<= 25%) of the dense node
//       count — the whole point of a sparse store. The achieved ratio is printed.
//   (D) MULTI-TILE BOUNDARY CORRECTNESS. A sphere large enough to span MANY 8^3
//       leaf tiles has its enclosed volume (computed sparsely) match the analytic
//       4/3·pi·r^3 within a voxel-resolution tolerance, with NO seams/gaps at tile
//       boundaries (the sparse count == the dense count exactly, AND both track
//       the closed form). Refinement shrinks the error.
//
// Build + run (single standalone clang++, minimal link set — header-only sparse
// grid + the dense VoxelGrid translation unit):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/voxel/VoxelGrid.cpp \
//       forge-kernel/test/native/voxel/sparse_voxel_test.cpp \
//       -o /tmp/k2_SparseVoxel && /tmp/k2_SparseVoxel
//
// DETERMINISM: any randomness is seeded from a FIXED default constant, overridable
// by argv[1] (NOT std::random_device).

#include <algorithm>
#include <vector>
#include <cmath>
#include <cstdint>
#include <unordered_map>

#include "forge/native/voxel/SparseVoxelGrid.hpp"
#include "forge/native/voxel/VoxelGrid.hpp"

#include <cstdio>
#include <cstdlib>
#include <random>
#include <string>

using namespace forge::native;
using forge::native::voxel::SparseVoxelGrid;

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

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ---------------------------------------------------------------------------
// Analytic fields (exact closed-form SDFs sampled at the nodes).
// ---------------------------------------------------------------------------
static double sdfTorus(double x, double y, double z, const Vec3& c,
                       double majorR, double minorR) {
    // Torus about the z axis through center c. q = (len(xy)-R, z); sdf = len(q)-r.
    double dx = x - c.x, dy = y - c.y, dz = z - c.z;
    double rxy = std::sqrt(dx * dx + dy * dy) - majorR;
    return std::sqrt(rxy * rxy + dz * dz) - minorR;
}

// Build a dense sphere SDF on an explicit cubic lattice (so its tile occupancy is
// controllable). origin/spacing chosen so the sphere is centred in the box.
static VoxelGrid<float> denseSphere(std::size_t n, double spacing,
                                    const Vec3& center, double radius) {
    double half = (double(n - 1) * spacing) * 0.5;
    Vec3 origin{ center.x - half, center.y - half, center.z - half };
    VoxelGrid<float> g(n, n, n, origin, spacing);
    g.fillFromField([&](double x, double y, double z) {
        return sdfSphere(x, y, z, center, radius);
    });
    return g;
}

static VoxelGrid<float> denseTorus(std::size_t n, double spacing, const Vec3& center,
                                   double majorR, double minorR) {
    double half = (double(n - 1) * spacing) * 0.5;
    Vec3 origin{ center.x - half, center.y - half, center.z - half };
    VoxelGrid<float> g(n, n, n, origin, spacing);
    g.fillFromField([&](double x, double y, double z) {
        return sdfTorus(x, y, z, center, majorR, minorR);
    });
    return g;
}

// Node-for-node exact equality of two dense grids (same lattice + bit-identical
// float values). The whole round-trip / result-identity claim rests on this.
static bool denseEqualExact(const VoxelGrid<float>& a, const VoxelGrid<float>& b) {
    if (a.nx() != b.nx() || a.ny() != b.ny() || a.nz() != b.nz()) return false;
    if (a.spacing() != b.spacing()) return false;
    if (a.origin().x != b.origin().x || a.origin().y != b.origin().y ||
        a.origin().z != b.origin().z) return false;
    const std::vector<float>& da = a.data();
    const std::vector<float>& db = b.data();
    if (da.size() != db.size()) return false;
    for (std::size_t i = 0; i < da.size(); ++i)
        // Bit-exact compare; NaN never appears in these analytic SDF fields.
        if (da[i] != db[i]) return false;
    return true;
}

// ---------------------------------------------------------------------------
int main(int argc, char** argv) {
    // DETERMINISM: fixed default seed, optional argv[1] override. The fields
    // themselves are fully deterministic; the RNG only drives a random-access
    // probe of the sparse store vs the dense grid, so any seed must still pass.
    std::uint64_t seed = 1337ull;
    if (argc > 1) seed = std::strtoull(argv[1], nullptr, 10);
    std::mt19937_64 rng(seed);

    std::printf("=== SparseVoxelGrid gate (seed=%llu) ===\n",
                (unsigned long long)seed);

    const double iso = 0.0;

    // -----------------------------------------------------------------------
    // (A) ROUND-TRIP EXACT for sphere, torus, CSG-union.
    // -----------------------------------------------------------------------
    {
        // Background = +1e30: a saturated "far outside" value that no analytic SDF
        // node here ever equals, so fromDense stores EVERY node (the round-trip is
        // exercised on a fully-populated set, the hardest case) and the absent
        // -tile read-back can never collide with a real value.
        const float BG = 1e30f;

        VoxelGrid<float> sphere = denseSphere(34, 0.10, Vec3{0, 0, 0}, 1.0);
        auto sp = SparseVoxelGrid<float>::fromDense(sphere, BG);
        VoxelGrid<float> back = sp.toDense();
        check(denseEqualExact(sphere, back),
              "round-trip EXACT: sphere fromDense->toDense == dense",
              "sphere node mismatch after round-trip");

        VoxelGrid<float> torus = denseTorus(34, 0.10, Vec3{0, 0, 0}, 0.8, 0.30);
        auto st = SparseVoxelGrid<float>::fromDense(torus, BG);
        check(denseEqualExact(torus, st.toDense()),
              "round-trip EXACT: torus fromDense->toDense == dense",
              "torus node mismatch after round-trip");

        // CSG UNION of two spheres = node-wise min of two SDFs (the VoxelBoolean
        // convention) — built here directly to keep the link set minimal.
        VoxelGrid<float> sA = denseSphere(40, 0.10, Vec3{-0.4, 0, 0}, 0.9);
        VoxelGrid<float> sB = denseSphere(40, 0.10, Vec3{ 0.4, 0, 0}, 0.9);
        VoxelGrid<float> uni(sA.nx(), sA.ny(), sA.nz(), sA.origin(), sA.spacing());
        for (std::size_t k = 0; k < sA.nz(); ++k)
            for (std::size_t j = 0; j < sA.ny(); ++j)
                for (std::size_t i = 0; i < sA.nx(); ++i)
                    uni.at(i, j, k) = std::min(sA.at(i, j, k), sB.at(i, j, k));
        auto su = SparseVoxelGrid<float>::fromDense(uni, BG);
        check(denseEqualExact(uni, su.toDense()),
              "round-trip EXACT: CSG-union(min) fromDense->toDense == dense",
              "csg-union node mismatch after round-trip");

        // Random-access probe: at(i,j,k) on the sparse store must equal the dense
        // node for many random indices (the O(1) accessor is the hot path).
        std::uniform_int_distribution<std::size_t> di(0, sphere.nx() - 1);
        bool accessOk = true;
        for (int t = 0; t < 5000; ++t) {
            std::size_t i = di(rng), j = di(rng), k = di(rng);
            if (sp.at(i, j, k) != sphere.at(i, j, k)) { accessOk = false; break; }
        }
        check(accessOk, "random-access at(i,j,k) == dense node (5000 probes)",
              "sparse at() disagreed with dense");
    }

    // -----------------------------------------------------------------------
    // (B) RESULT IDENTITY vs the dense ops (volume + offset + shell).
    // For result-identity the BACKGROUND must be a value that round-trips through
    // the op the same way the dense op transforms a far-outside node. We use a
    // LARGE finite positive background so |f|-t/2 and f-d stay "outside" and never
    // alias an inside value — exactly mirroring the dense field's far nodes.
    // -----------------------------------------------------------------------
    {
        const float BG = 1e6f;   // far-outside sentinel; transforms like a real node

        VoxelGrid<float> g = denseSphere(40, 0.10, Vec3{0, 0, 0}, 1.2);
        auto s = SparseVoxelGrid<float>::fromDense(g, BG);

        // -- enclosedVolume bit-exact (integer count identical) --------------
        std::size_t denseCount = g.countInsideCellsByCenter(iso, true);
        std::size_t sparseCount = s.countInsideCellsByCenter(iso);
        check(denseCount == sparseCount,
              "RESULT IDENTITY: enclosedVolume inside-cell COUNT == dense (bit-exact)",
              "sparse count " + std::to_string(sparseCount) +
              " != dense " + std::to_string(denseCount));
        double dv = g.occupiedVolumeByCenter(iso, true);
        double sv = s.enclosedVolume(iso);
        check(dv == sv,
              "RESULT IDENTITY: enclosedVolume DOUBLE == dense (bit-exact)",
              "sparse vol " + std::to_string(sv) + " != dense " + std::to_string(dv));

        // -- offset(+d) result-identity (node-for-node) ----------------------
        const double d = 0.35;
        // Dense reference: f' = f - d (the SAME identity VoxelFieldOps::offset uses;
        // reproduced inline to keep the link set to VoxelGrid.cpp only).
        VoxelGrid<float> denseOff = g;
        for (float& f : denseOff.data()) f = float(double(f) - d);
        auto sparseOff = s.offset(d);
        check(denseEqualExact(denseOff, sparseOff.toDense()),
              "RESULT IDENTITY: offset(+d).toDense() == dense f-d (node-for-node)",
              "offset field mismatch vs dense");
        // And the offset solid's VOLUME matches dense-of-the-offset.
        check(denseOff.occupiedVolumeByCenter(iso, true) == sparseOff.enclosedVolume(iso),
              "RESULT IDENTITY: offset enclosedVolume == dense-offset volume",
              "offset volume mismatch");

        // -- shell(t) result-identity (node-for-node) ------------------------
        const double t = 0.30;
        VoxelGrid<float> denseShell = g;
        for (float& f : denseShell.data()) f = float(std::fabs(double(f)) - 0.5 * t);
        auto sparseShell = s.shell(t);
        check(denseEqualExact(denseShell, sparseShell.toDense()),
              "RESULT IDENTITY: shell(t).toDense() == dense |f|-t/2 (node-for-node)",
              "shell field mismatch vs dense");
        check(denseShell.occupiedVolumeByCenter(iso, true) == sparseShell.enclosedVolume(iso),
              "RESULT IDENTITY: shell enclosedVolume == dense-shell volume",
              "shell volume mismatch");
    }

    // -----------------------------------------------------------------------
    // (C) MEMORY / SPARSITY WIN for a surface-localised SHELL field.
    // A thin shell stores nodes only in the narrow band around the sphere
    // surface; far interior + far exterior are background and cost ZERO tiles.
    // We build the shell field DIRECTLY (|f|-t/2) and store only its near-band:
    // a node is "active" iff its shell value is within a few voxels of the band,
    // i.e. |shellValue| <= bandHalfWidth — everything else collapses to background.
    // -----------------------------------------------------------------------
    {
        const std::size_t n = 160;         // 160^3 = 4,096,000 dense nodes
        const double spacing = 0.03;
        const double R = 1.6, t = 0.20;    // sphere radius, shell thickness
        VoxelGrid<float> sphere = denseSphere(n, spacing, Vec3{0, 0, 0}, R);

        // Shell field |f|-t/2 as a dense reference (the exact field).
        VoxelGrid<float> shellDense = sphere;
        for (float& f : shellDense.data()) f = float(std::fabs(double(f)) - 0.5 * t);

        // Narrow-band background: anything farther than `band` from the shell's
        // zero-surface is saturated to BG. This is the VDB narrow-band idiom — the
        // field is only meaningful (and only stored) near the surface. A +-2-voxel
        // band is the standard OpenVDB level-set half-width.
        const double band = 2.0 * spacing;     // +-2 voxels around the shell band
        const float BG = float(band);          // saturate to the band edge
        VoxelGrid<float> banded = shellDense;
        for (float& f : banded.data()) {
            if (double(f) > band) f = BG;       // far outside the band -> background
            else if (double(f) < -band) f = BG; // deep interior void -> background too
        }
        auto sShell = SparseVoxelGrid<float>::fromDense(banded, BG);

        const std::size_t denseNodes = sphere.nodeCount();
        const std::size_t activeSlots = sShell.activeNodeSlots();
        const std::size_t nonBg = sShell.nonBackgroundNodes();
        const double slotRatio = double(activeSlots) / double(denseNodes);
        const double nbRatio = double(nonBg) / double(denseNodes);
        std::printf("    [sparsity] dense nodes=%zu  active-tiles=%zu  "
                    "active-slots=%zu (%.2f%%)  non-bg nodes=%zu (%.2f%%)\n",
                    denseNodes, sShell.activeTileCount(), activeSlots,
                    100.0 * slotRatio, nonBg, 100.0 * nbRatio);
        check(slotRatio <= 0.25,
              "SPARSITY WIN: active-tile slots <= 25% of dense node count",
              "slot ratio " + std::to_string(slotRatio) + " > 0.25");

        // The banded-field round-trip is still exact (sparsity is lossless on the
        // stored band).
        check(denseEqualExact(banded, sShell.toDense()),
              "SPARSITY: banded shell round-trip still EXACT",
              "banded shell node mismatch");
    }

    // -----------------------------------------------------------------------
    // (D) MULTI-TILE BOUNDARY CORRECTNESS: a sphere spanning many 8^3 tiles.
    // The sparse enclosed volume must (1) equal the dense count EXACTLY (no seams
    // or double-counts at tile borders) and (2) track the analytic 4/3·pi·r^3
    // within a voxel-resolution tolerance, with the error SHRINKING under
    // refinement.
    // -----------------------------------------------------------------------
    {
        const float BG = 1e30f;
        const double R = 1.5;
        const double analytic = (4.0 / 3.0) * M_PI * R * R * R;

        struct Res { double h; double vol; std::size_t tiles; std::size_t span; };
        std::vector<Res> results;

        for (double h : { 0.10, 0.05 }) {
            // n chosen so the sphere (radius R, +3-voxel margin) fits; this makes
            // the sphere span ceil(2R/h / 8) tiles per axis -> clearly multi-tile.
            std::size_t n = std::size_t(std::ceil((2.0 * (R + 3.0 * h)) / h)) + 1;
            VoxelGrid<float> g = denseSphere(n, h, Vec3{0, 0, 0}, R);
            auto s = SparseVoxelGrid<float>::fromDense(g, BG);

            // (1) sparse count == dense count EXACTLY (boundary integrity).
            std::size_t dc = g.countInsideCellsByCenter(iso, true);
            std::size_t sc = s.countInsideCellsByCenter(iso);
            check(dc == sc,
                  "MULTI-TILE: sparse inside-cell count == dense (no seams/gaps)",
                  "h=" + std::to_string(h) + " sparse " + std::to_string(sc) +
                  " != dense " + std::to_string(dc));

            double vol = s.enclosedVolume(iso);
            std::size_t tilesPerAxis = (n + SparseVoxelGrid<float>::kLeaf - 1) /
                                       SparseVoxelGrid<float>::kLeaf;
            results.push_back(Res{ h, vol, s.activeTileCount(), tilesPerAxis });

            // The sphere must genuinely span MANY tiles (sanity that this is a
            // multi-tile feature, not a single-tile toy).
            check(tilesPerAxis >= 4,
                  "MULTI-TILE: sphere spans >= 4 leaf tiles per axis",
                  "only " + std::to_string(tilesPerAxis) + " tiles/axis");

            // (2) sparse volume vs analytic 4/3 pi r^3 within a voxel tol. The
            // surface band is O(h) thick over a 4 pi R^2 area, so the absolute
            // volume error is ~ 4 pi R^2 * c * h; use a generous c=3 voxel-band tol.
            double tol = 3.0 * (4.0 * M_PI * R * R) * h;
            std::printf("    [multi-tile] h=%.3f  n=%zu  tiles/axis=%zu  "
                        "active-tiles=%zu  vol=%.6f  analytic=%.6f  err=%.6f  tol=%.6f\n",
                        h, n, tilesPerAxis, s.activeTileCount(), vol, analytic,
                        std::fabs(vol - analytic), tol);
            check(std::fabs(vol - analytic) <= tol,
                  "MULTI-TILE: sparse volume matches 4/3 pi r^3 within voxel tol",
                  "h=" + std::to_string(h) + " err " +
                  std::to_string(std::fabs(vol - analytic)) + " > tol " +
                  std::to_string(tol));
        }

        // Error shrinks under refinement (h: 0.10 -> 0.05).
        if (results.size() == 2) {
            double e0 = std::fabs(results[0].vol - analytic);
            double e1 = std::fabs(results[1].vol - analytic);
            check(e1 < e0,
                  "MULTI-TILE: volume error SHRINKS under refinement (h 0.10->0.05)",
                  "err did not shrink: " + std::to_string(e0) + " -> " +
                  std::to_string(e1));
        }
    }

    // -----------------------------------------------------------------------
    // Pruning sanity: setting a leaf's nodes back to background prunes the tile,
    // and the field then reads background everywhere (the active set tracks reality).
    // -----------------------------------------------------------------------
    {
        SparseVoxelGrid<float> s(16, 16, 16, Vec3{0, 0, 0}, 0.1, /*bg=*/0.0f);
        s.set(3, 4, 5, -2.0f);
        s.set(11, 12, 13, -3.0f);  // a second tile
        check(s.activeTileCount() == 2, "pruning: two writes -> two active tiles",
              "tile count " + std::to_string(s.activeTileCount()));
        check(s.at(3, 4, 5) == -2.0f && s.at(11, 12, 13) == -3.0f,
              "pruning: written nodes read back exactly", "value mismatch");
        s.set(3, 4, 5, 0.0f);      // back to background
        s.set(11, 12, 13, 0.0f);
        s.pruneBackgroundLeaves();
        check(s.activeTileCount() == 0,
              "pruning: erasing all nodes prunes all tiles", "tiles remain");
        check(s.at(3, 4, 5) == 0.0f, "pruning: pruned node reads background",
              "non-background after prune");
    }

    std::printf("=== RESULT: %d / %d checks passed ===\n", g_passed, g_total);
    return (g_passed == g_total) ? 0 : 1;
}
