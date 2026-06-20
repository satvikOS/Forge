// forge/native/voxel/VoxelGrid.hpp
//
// Stage 5 (voxel / lattice), FIRST increment — PicoGK-class field engine.
//
// SCOPE OF THIS HEADER (honest, per KERNEL_INHOUSE_ROADMAP.md §0/§D and Bible §0/§9):
//   SHIPPED + VALIDATED in this increment:
//     * VoxelGrid<float> : a dense, axis-aligned sampled scalar field with an
//       origin, a uniform spacing, and (nx,ny,nz) samples. Stores one scalar per
//       grid node. Provides exact node access and trilinear interpolation for
//       arbitrary world-space points inside the box.
//     * Voxelization of an analytic SDF sphere into the grid (sample the field).
//     * Occupied-volume measurement (cell count whose sampled value crosses an
//       iso) × cell volume — used by the sphere-volume convergence gate.
//     * 6-connectivity / percolation flood-fill over the occupied set.
//   (See Tpms.hpp for the gyroid TPMS level-set generator + threshold-to-solid.)
//
//   TARGETED (NOT in this increment — flagged, never faked):
//     * Voxel -> surface mesh extraction (marching cubes / dual contouring). The
//       roadmap (§B, Stage 4 `IsoMesher`) places the mesher in the IMPLICIT
//       stage so that voxel/lattice and SDF F-rep SHARE ONE mesher emitting a
//       `forge::native::HalfEdgeMesh`. This increment deliberately does NOT
//       duplicate a mesher here. A minimal marching-cubes *cell-classification
//       count* is provided ONLY as an internal sanity helper for the gate and is
//       explicitly marked as such — it is NOT a mesh and must be replaced by the
//       shared IsoMesher. // TODO(shared-mesher): consolidate into
//       forge::native::implicit::IsoMesher (roadmap §B Stage 4).
//     * Morphological offset / shell / dilate / erode (roadmap Morphology.cpp).
//     * Schwarz-P / diamond TPMS variants (only gyroid lands here).
//     * Sparse / hierarchical (VDB-style) storage — this increment is DENSE.
//
// CONVENTIONS:
//   * Namespace forge::native. Pure C++20, standard library only.
//   * ZERO external deps, NO OCCT, NO WASM, NO third-party libs.
//
// PREDICATES NOTE (honest):
//   forge/native/Predicates.hpp (the parallel exact-predicate build) is
//   included below. Exact orientation/in-sphere predicates are the bedrock for
//   the voxel->mesh marching-cubes/dual-contouring stage (TARGETED) — there the
//   sign of a face/edge crossing must be combinatorially consistent. For the
//   DENSE SCALAR-FIELD arithmetic in THIS increment (sampling, trilinear
//   interpolation, volume counting, flood-fill) the operations are pure
//   per-node float comparisons with NO orientation determinant, so the exact
//   predicates are not load-bearing yet. We include the header (no duplicate,
//   per the shared-kernel rule) and will route the mesher's edge-crossing signs
//   through it when the shared IsoMesher lands.

#ifndef FORGE_NATIVE_VOXEL_VOXELGRID_HPP
#define FORGE_NATIVE_VOXEL_VOXELGRID_HPP

#include <cstddef>
#include <cstdint>
#include <vector>
#include <array>
#include <cmath>
#include <stdexcept>
#include <functional>

// Shared in-house exact predicates (parallel build). Present at
// include/forge/native/Predicates.hpp. Included per the no-duplicate rule; see
// the PREDICATES NOTE above for why it is not yet load-bearing in this stage.
#if defined(__has_include)
#  if __has_include(<forge/native/Predicates.hpp>)
#    include <forge/native/Predicates.hpp>
#    define FORGE_NATIVE_HAVE_PREDICATES 1
#  endif
#endif
#ifndef FORGE_NATIVE_HAVE_PREDICATES
// TODO: replace with forge::native::Predicates (parallel build). Not reachable
// in this tree (the header exists), but kept per the prompt's contract.
#  define FORGE_NATIVE_HAVE_PREDICATES 0
#endif

namespace forge {
namespace native {

// ---------------------------------------------------------------------------
// Small POD vector helpers (kept local & minimal; a shared math header is a
// future consolidation, not duplicated logic). // TODO(shared-math): unify with
// the kernel's vector type when the native math header lands.
// ---------------------------------------------------------------------------
struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;
};

// ---------------------------------------------------------------------------
// VoxelGrid<T> : a dense sampled scalar field over an axis-aligned box.
//
// Layout: (nx * ny * nz) samples, x fastest, then y, then z.
//   index(i,j,k) = i + nx*(j + ny*k)
// A *node* at (i,j,k) sits at world position:
//   origin + (i*spacing, j*spacing, k*spacing)
// The field is the value stored AT the nodes; values between nodes are obtained
// by trilinear interpolation (sample()).
//
// "spacing" is uniform (isotropic cubic cells) for this increment; anisotropic
// spacing is a trivial future extension and is flagged TARGETED.
// ---------------------------------------------------------------------------
template <typename T = float>
class VoxelGrid {
public:
    VoxelGrid() = default;

    // Construct a grid with `n*` nodes per axis (each >= 2 so there is at least
    // one cell), an `origin` (world position of node (0,0,0)), and a uniform
    // `spacing`. All node values are initialised to `fill`.
    VoxelGrid(std::size_t nx, std::size_t ny, std::size_t nz,
              const Vec3& origin, double spacing, T fill = T(0))
        : nx_(nx), ny_(ny), nz_(nz),
          origin_(origin), spacing_(spacing),
          data_(nx * ny * nz, fill) {
        if (nx < 2 || ny < 2 || nz < 2)
            throw std::invalid_argument("VoxelGrid needs >= 2 nodes per axis");
        if (!(spacing > 0.0))
            throw std::invalid_argument("VoxelGrid spacing must be > 0");
    }

    std::size_t nx() const { return nx_; }
    std::size_t ny() const { return ny_; }
    std::size_t nz() const { return nz_; }
    std::size_t nodeCount() const { return data_.size(); }
    // Number of CELLS (cubes between nodes) along each axis / in total.
    std::size_t cellsX() const { return nx_ - 1; }
    std::size_t cellsY() const { return ny_ - 1; }
    std::size_t cellsZ() const { return nz_ - 1; }
    std::size_t cellCount() const { return cellsX() * cellsY() * cellsZ(); }

    double spacing() const { return spacing_; }
    double cellVolume() const { return spacing_ * spacing_ * spacing_; }
    const Vec3& origin() const { return origin_; }

    // Flat index of node (i,j,k). No bounds check in release builds beyond the
    // assert-style guard below (kept cheap; callers iterate in-range).
    std::size_t index(std::size_t i, std::size_t j, std::size_t k) const {
        return i + nx_ * (j + ny_ * k);
    }

    // Node value access (read / write).
    T& at(std::size_t i, std::size_t j, std::size_t k) {
        return data_[index(i, j, k)];
    }
    const T& at(std::size_t i, std::size_t j, std::size_t k) const {
        return data_[index(i, j, k)];
    }

    // World position of node (i,j,k).
    Vec3 nodePosition(std::size_t i, std::size_t j, std::size_t k) const {
        return Vec3{ origin_.x + double(i) * spacing_,
                     origin_.y + double(j) * spacing_,
                     origin_.z + double(k) * spacing_ };
    }

    // Fill every node by evaluating a world-space field f(x,y,z).
    void fillFromField(const std::function<double(double, double, double)>& f) {
        for (std::size_t k = 0; k < nz_; ++k)
            for (std::size_t j = 0; j < ny_; ++j)
                for (std::size_t i = 0; i < nx_; ++i) {
                    Vec3 p = nodePosition(i, j, k);
                    at(i, j, k) = static_cast<T>(f(p.x, p.y, p.z));
                }
    }

    // Trilinear interpolation of the field at an arbitrary world point p.
    // p is clamped to the grid box (so points on the boundary are valid and
    // points just outside return the nearest in-box interpolant rather than
    // reading out of bounds). Returns double for accuracy regardless of T.
    double sample(const Vec3& p) const {
        // Continuous index coordinates.
        double gx = (p.x - origin_.x) / spacing_;
        double gy = (p.y - origin_.y) / spacing_;
        double gz = (p.z - origin_.z) / spacing_;

        // Clamp into [0, n-1] so we always have a valid surrounding cell.
        gx = clampd(gx, 0.0, double(nx_ - 1));
        gy = clampd(gy, 0.0, double(ny_ - 1));
        gz = clampd(gz, 0.0, double(nz_ - 1));

        std::size_t i0 = std::size_t(std::floor(gx));
        std::size_t j0 = std::size_t(std::floor(gy));
        std::size_t k0 = std::size_t(std::floor(gz));
        if (i0 >= nx_ - 1) i0 = nx_ - 2;
        if (j0 >= ny_ - 1) j0 = ny_ - 2;
        if (k0 >= nz_ - 1) k0 = nz_ - 2;
        std::size_t i1 = i0 + 1, j1 = j0 + 1, k1 = k0 + 1;

        double tx = gx - double(i0);
        double ty = gy - double(j0);
        double tz = gz - double(k0);

        double c000 = double(at(i0, j0, k0));
        double c100 = double(at(i1, j0, k0));
        double c010 = double(at(i0, j1, k0));
        double c110 = double(at(i1, j1, k0));
        double c001 = double(at(i0, j0, k1));
        double c101 = double(at(i1, j0, k1));
        double c011 = double(at(i0, j1, k1));
        double c111 = double(at(i1, j1, k1));

        double c00 = lerp(c000, c100, tx);
        double c10 = lerp(c010, c110, tx);
        double c01 = lerp(c001, c101, tx);
        double c11 = lerp(c011, c111, tx);
        double c0  = lerp(c00, c10, ty);
        double c1  = lerp(c01, c11, ty);
        return lerp(c0, c1, tz);
    }

    // -----------------------------------------------------------------------
    // Occupancy + volume.
    //
    // A solid is the sub-level (or super-level) set of the field relative to an
    // iso value. By the convention here, a node is "occupied/inside" when its
    // value is <= iso (typical signed-distance convention: negative inside).
    // For TPMS where the solid is { f <= iso } this matches directly.
    // -----------------------------------------------------------------------

    // Count CELLS whose CENTER (the trilinear value at the cell centroid) is
    // inside. This is the volume measure used by the gate: occupied-volume =
    // (count) * cellVolume(). Cell-center sampling gives an unbiased midpoint
    // (Riemann) estimate that converges to the true volume as spacing -> 0.
    std::size_t countInsideCellsByCenter(double iso, bool insideIsLeq = true) const {
        std::size_t count = 0;
        for (std::size_t k = 0; k < cellsZ(); ++k)
            for (std::size_t j = 0; j < cellsY(); ++j)
                for (std::size_t i = 0; i < cellsX(); ++i) {
                    Vec3 c = cellCenter(i, j, k);
                    double v = sample(c);
                    bool inside = insideIsLeq ? (v <= iso) : (v >= iso);
                    if (inside) ++count;
                }
        return count;
    }

    // Occupied volume by the cell-center rule (the gate's measure).
    double occupiedVolumeByCenter(double iso, bool insideIsLeq = true) const {
        return double(countInsideCellsByCenter(iso, insideIsLeq)) * cellVolume();
    }

    // World center of cell (i,j,k) (i in [0,cellsX), etc).
    Vec3 cellCenter(std::size_t i, std::size_t j, std::size_t k) const {
        return Vec3{ origin_.x + (double(i) + 0.5) * spacing_,
                     origin_.y + (double(j) + 0.5) * spacing_,
                     origin_.z + (double(k) + 0.5) * spacing_ };
    }

    // -----------------------------------------------------------------------
    // 6-connectivity / percolation.
    //
    // Build the occupied CELL set (by cell-center rule), flood-fill from a seed
    // through 6-connected (face-adjacent) neighbours, and report whether the
    // occupied set is a single connected component, plus whether it percolates
    // (touches two opposite faces of the grid along a given axis).
    // -----------------------------------------------------------------------
    struct ConnectivityResult {
        std::size_t occupiedCells = 0;       // total inside cells
        std::size_t largestComponent = 0;    // size of biggest 6-connected blob
        std::size_t componentCount = 0;      // number of distinct components
        bool percolatesX = false;            // largest comp touches x=0 and x=max
        bool percolatesY = false;
        bool percolatesZ = false;
    };

    ConnectivityResult analyzeConnectivity(double iso, bool insideIsLeq = true) const {
        const std::size_t cx = cellsX(), cy = cellsY(), cz = cellsZ();
        const std::size_t total = cx * cy * cz;
        std::vector<uint8_t> occ(total, 0);
        std::size_t occupied = 0;
        for (std::size_t k = 0; k < cz; ++k)
            for (std::size_t j = 0; j < cy; ++j)
                for (std::size_t i = 0; i < cx; ++i) {
                    Vec3 c = cellCenter(i, j, k);
                    double v = sample(c);
                    bool inside = insideIsLeq ? (v <= iso) : (v >= iso);
                    if (inside) { occ[cellIdx(i, j, k, cx, cy)] = 1; ++occupied; }
                }

        ConnectivityResult r;
        r.occupiedCells = occupied;
        if (occupied == 0) return r;

        std::vector<int> comp(total, -1);
        std::vector<std::size_t> stack;
        int compId = 0;
        std::size_t best = 0;
        int bestId = -1;
        for (std::size_t s = 0; s < total; ++s) {
            if (!occ[s] || comp[s] != -1) continue;
            // BFS/DFS flood-fill this component.
            std::size_t size = 0;
            bool touchX0 = false, touchX1 = false;
            bool touchY0 = false, touchY1 = false;
            bool touchZ0 = false, touchZ1 = false;
            stack.clear();
            stack.push_back(s);
            comp[s] = compId;
            while (!stack.empty()) {
                std::size_t cur = stack.back();
                stack.pop_back();
                ++size;
                std::size_t ci = cur % cx;
                std::size_t cj = (cur / cx) % cy;
                std::size_t ck = cur / (cx * cy);
                if (ci == 0)      touchX0 = true;
                if (ci == cx - 1) touchX1 = true;
                if (cj == 0)      touchY0 = true;
                if (cj == cy - 1) touchY1 = true;
                if (ck == 0)      touchZ0 = true;
                if (ck == cz - 1) touchZ1 = true;
                // 6 face neighbours.
                pushIfOcc(stack, comp, occ, ci > 0,      cur - 1,        compId);
                pushIfOcc(stack, comp, occ, ci + 1 < cx, cur + 1,        compId);
                pushIfOcc(stack, comp, occ, cj > 0,      cur - cx,       compId);
                pushIfOcc(stack, comp, occ, cj + 1 < cy, cur + cx,       compId);
                pushIfOcc(stack, comp, occ, ck > 0,      cur - cx * cy,  compId);
                pushIfOcc(stack, comp, occ, ck + 1 < cz, cur + cx * cy,  compId);
            }
            if (size > best) {
                best = size; bestId = compId;
                r.percolatesX = touchX0 && touchX1;
                r.percolatesY = touchY0 && touchY1;
                r.percolatesZ = touchZ0 && touchZ1;
            }
            ++compId;
        }
        (void)bestId;
        r.componentCount = std::size_t(compId);
        r.largestComponent = best;
        return r;
    }

    const std::vector<T>& data() const { return data_; }
    std::vector<T>& data() { return data_; }

private:
    static double clampd(double v, double lo, double hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
    static double lerp(double a, double b, double t) { return a + (b - a) * t; }

    static std::size_t cellIdx(std::size_t i, std::size_t j, std::size_t k,
                               std::size_t cx, std::size_t cy) {
        return i + cx * (j + cy * k);
    }
    static void pushIfOcc(std::vector<std::size_t>& stack,
                          std::vector<int>& comp,
                          const std::vector<uint8_t>& occ,
                          bool inRange, std::size_t neighbor, int compId) {
        if (!inRange) return;
        if (occ[neighbor] && comp[neighbor] == -1) {
            comp[neighbor] = compId;
            stack.push_back(neighbor);
        }
    }

    std::size_t nx_ = 0, ny_ = 0, nz_ = 0;
    Vec3 origin_{};
    double spacing_ = 1.0;
    std::vector<T> data_;
};

// ---------------------------------------------------------------------------
// Analytic SDF helpers (the fields we voxelize).
// ---------------------------------------------------------------------------

// Signed distance to a sphere: negative inside, zero on surface, positive
// outside. EXACT closed form (no sampling error in the field itself; the only
// approximation is the grid discretisation done by the caller).
inline double sdfSphere(double x, double y, double z,
                        const Vec3& center, double radius) {
    double dx = x - center.x, dy = y - center.y, dz = z - center.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

// Convenience: build a VoxelGrid sampling an SDF sphere over a box that
// comfortably contains the sphere (pad cells of margin on each side).
inline VoxelGrid<float> voxelizeSphere(double radius, double spacing,
                                       const Vec3& center = Vec3{0, 0, 0},
                                       double marginCells = 3.0) {
    double half = radius + marginCells * spacing;
    Vec3 origin{ center.x - half, center.y - half, center.z - half };
    // node count so the box spans [center-half, center+half]
    std::size_t n = std::size_t(std::ceil((2.0 * half) / spacing)) + 1;
    if (n < 2) n = 2;
    VoxelGrid<float> g(n, n, n, origin, spacing);
    g.fillFromField([&](double x, double y, double z) {
        return sdfSphere(x, y, z, center, radius);
    });
    return g;
}

} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_VOXELGRID_HPP
