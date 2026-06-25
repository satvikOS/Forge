// forge/native/voxel/SparseVoxelGrid.hpp
//
// Stage 5 (voxel / lattice) — SPARSE (VDB/OpenVDB-class) hierarchical voxel grid.
//
// WHY (honest, per the dense VoxelGrid.hpp TODO(sparse) flag and VoxelBoolean's
// TODO(sparse)/VoxelFieldOps' TODO(sparse-gpu)): the dense VoxelGrid<T> stores
// (nx*ny*nz) samples — one scalar per node — so a 512^3 field is 134M floats
// even when the SOLID it represents is a thin surface band occupying a few
// percent of the box. A signed-distance field is, by construction, interesting
// only NEAR the zero-surface (the narrow band); far from the surface every node
// carries the SAME saturated background distance. This header adds a hierarchical
// tile store that keeps ONLY the leaf tiles that contain at least one node whose
// value DIFFERS from a chosen background, and returns the background for every
// absent tile. That is exactly the OpenVDB "active-tile / background" model
// specialised to one leaf level (root hash-map -> fixed 8^3 leaf tiles).
//
// WHAT THIS HEADER SHIPS + VALIDATES (no MVP / no stub — see sparse_voxel_test):
//   * SparseVoxelGrid<T> : a root std::unordered_map keyed by leaf-tile coordinate
//     -> a Leaf holding a dense kLeaf^3 array of values (kLeaf == 8). A tile is
//     materialised lazily; an absent tile reads `background`. O(1)-ish random
//     access by node index (hash lookup + intra-tile offset); sparse iteration
//     visits ONLY materialised (active) tiles.
//   * LOSSLESS interop with the dense VoxelGrid<T>:
//        fromDense(g)  -> SparseVoxelGrid that stores every node != background,
//        toDense()     -> VoxelGrid<T> reconstructing every node EXACTLY.
//     fromDense(g).toDense() == g node-for-node (bit-exact for T==float).
//   * SPARSE field ops that produce results IDENTICAL to the dense ops while
//     touching only active tiles:
//        enclosedVolume(iso)  == VoxelGrid::occupiedVolumeByCenter(iso) bit-exact,
//        offset(d)            -> a SparseVoxelGrid whose toDense() equals
//                                VoxelFieldOps::offset(dense,d).grid node-for-node,
//        shell(t)             -> matches VoxelFieldOps::shell(dense,t).grid likewise.
//     The math is NOT re-derived: offset is the SAME level-set identity f' = f - d,
//     shell is the SAME |f| - t/2, and the volume is the SAME cell-center
//     midpoint-Riemann rule — all wrapped over the sparse storage by reusing the
//     dense VoxelGrid for the per-cell trilinear sampling at tile granularity.
//
// EXACTNESS POSTURE (Bible §0/§9 — do NOT overclaim):
//   * Round-trip is bit-exact: a leaf stores the literal T values; toDense copies
//     them back and writes `background` into every node of an absent tile, which
//     is precisely what fromDense compared against. No quantisation, no lossy band.
//   * enclosedVolume is bit-exact vs the dense measure: the sparse measure
//     reconstructs the field through the SAME trilinear sampler and the SAME
//     cell-center rule; the ONLY shortcut is skipping cells whose 8 corner nodes
//     are ALL background AND background is provably outside (> iso), where the
//     trilinear value at the center is a convex combination of identical
//     out-of-solid corners and therefore cannot be inside — so the skip changes
//     no count. When that provable-skip condition does not hold the cell is
//     classified by the identical full sampler, so the integer count (hence the
//     volume) is identical to the dense routine. (Validated in the gate.)
//   * offset / shell are bit-exact node transforms (f-d, |f|-t/2) applied to the
//     stored leaf values; the background is transformed the same way so the
//     absent-tile semantics stay consistent. The result's toDense() equals the
//     dense op's grid by the same per-node float arithmetic.
//
// HONEST SCOPE / LIMITS (flagged, never faked):
//   * ONE leaf level (root hash-map -> 8^3 leaves). OpenVDB's full 3-level
//     internal-node tree (32^3 -> 16^3 -> 8^3) is a deeper refinement of the SAME
//     idea (more pointer levels for huge sparse extents); a single internal level
//     is sufficient for the surface-localised SDF fields this kernel produces and
//     is what is gated here. // TODO(multi-level-internal-nodes)
//   * Sparse op coverage: enclosedVolume + offset + shell + shellInward have
//     native sparse implementations (active-tile only). Smooth/rounded booleans
//     and union/intersect/subtract are reachable losslessly via toDense() ->
//     the existing dense VoxelBoolean / VoxelFieldOps (no second implementation);
//     a node-wise sparse boolean over the UNION of two tile sets is the obvious
//     next step. // TODO(sparse-boolean)
//   * Value types: templated on T; the round-trip + offset/shell are exact for
//     any T with float-compatible arithmetic. The float specialisation is the one
//     the rest of the voxel stack uses and the one gated.
//   * Max extent: leaf coordinates are int (so node index up to ~2^31 per axis,
//     i.e. ~2.6e8 tiles per axis); the dense VoxelGrid this interops with is the
//     practical extent bound, not the sparse store.
//
// REUSE (no duplication — #include only):
//   * voxel/VoxelGrid.hpp : the dense VoxelGrid<T>, native::Vec3, the trilinear
//     sampler and the cell-center occupied-volume measure (the in-house oracle the
//     sparse measure delegates to at tile granularity).
//
// CONVENTIONS: namespace forge::native::voxel. Pure C++20, standard library only.
// ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_VOXEL_SPARSEVOXELGRID_HPP
#define FORGE_NATIVE_VOXEL_SPARSEVOXELGRID_HPP

#include "forge/native/voxel/VoxelGrid.hpp"   // VoxelGrid<T>, native::Vec3, sdfSphere

#include <algorithm>
#include <vector>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <array>
#include <stdexcept>

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// SparseVoxelGrid<T> : VDB-style hierarchical (root hash-map -> 8^3 leaves) store
// of a sampled scalar field over the SAME axis-aligned node lattice the dense
// VoxelGrid<T> uses (origin, uniform spacing, (nx,ny,nz) nodes, x-fastest
// index(i,j,k) = i + nx*(j + ny*k)). Only leaf tiles that hold at least one node
// whose value differs from `background` are materialised; absent tiles read
// `background`.
// ---------------------------------------------------------------------------
template <typename T = float>
class SparseVoxelGrid {
public:
    // Edge length of a cubic leaf tile (8^3 == 512 nodes per leaf, the OpenVDB
    // leaf size). Compile-time so the intra-tile offset is a shift/mask, not a
    // divide, on the hot access path.
    static constexpr int kLeaf = 8;
    static constexpr int kLeaf3 = kLeaf * kLeaf * kLeaf;

    // A materialised leaf: a dense kLeaf^3 block of values plus a count of how
    // many of them currently differ from `background` (so a leaf that becomes all
    // background can be pruned). The block is value-initialised to `background`
    // by the owner before any write.
    struct Leaf {
        std::array<T, kLeaf3> v;     // x fastest, then y, then z within the tile
        std::size_t nonBackground = 0;
    };

    SparseVoxelGrid() = default;

    // Construct an EMPTY sparse field over the given lattice. Every node reads
    // `background` until written. The lattice must match a dense VoxelGrid this is
    // meant to interop with (same nx/ny/nz/origin/spacing).
    SparseVoxelGrid(std::size_t nx, std::size_t ny, std::size_t nz,
                    const Vec3& origin, double spacing, T background = T(0))
        : nx_(nx), ny_(ny), nz_(nz),
          origin_(origin), spacing_(spacing), background_(background) {
        if (nx < 2 || ny < 2 || nz < 2)
            throw std::invalid_argument("SparseVoxelGrid needs >= 2 nodes per axis");
        if (!(spacing > 0.0))
            throw std::invalid_argument("SparseVoxelGrid spacing must be > 0");
    }

    // ---- lattice geometry (identical conventions to VoxelGrid) --------------
    std::size_t nx() const { return nx_; }
    std::size_t ny() const { return ny_; }
    std::size_t nz() const { return nz_; }
    std::size_t nodeCount() const { return nx_ * ny_ * nz_; }
    std::size_t cellsX() const { return nx_ - 1; }
    std::size_t cellsY() const { return ny_ - 1; }
    std::size_t cellsZ() const { return nz_ - 1; }
    std::size_t cellCount() const { return cellsX() * cellsY() * cellsZ(); }
    double spacing() const { return spacing_; }
    double cellVolume() const { return spacing_ * spacing_ * spacing_; }
    const Vec3& origin() const { return origin_; }
    T background() const { return background_; }

    // ---- sparsity bookkeeping ----------------------------------------------
    // Number of materialised (active) leaf tiles.
    std::size_t activeTileCount() const { return leaves_.size(); }
    // Node slots backed by active tiles (active tiles * kLeaf^3). This is the
    // sparse store's working set; the sparsity win is this / nodeCount().
    std::size_t activeNodeSlots() const { return leaves_.size() * std::size_t(kLeaf3); }
    // Count of nodes actually != background across all active tiles (the truly
    // populated set; <= activeNodeSlots()).
    std::size_t nonBackgroundNodes() const {
        std::size_t n = 0;
        for (const auto& kv : leaves_) n += kv.second.nonBackground;
        return n;
    }

    // ---- random access by NODE index (O(1)-ish: hash lookup + tile offset) --
    // Read node (i,j,k): background for an absent tile, else the stored value.
    T at(std::size_t i, std::size_t j, std::size_t k) const {
        const TileKey key = tileKeyOf(i, j, k);
        auto it = leaves_.find(key);
        if (it == leaves_.end()) return background_;
        return it->second.v[localIndex(i, j, k)];
    }

    // Write node (i,j,k). Materialises the owning leaf on demand; updates the
    // per-leaf non-background count so a leaf that goes fully background can be
    // pruned (pruneBackgroundLeaves()).
    void set(std::size_t i, std::size_t j, std::size_t k, T value) {
        const TileKey key = tileKeyOf(i, j, k);
        const int li = localIndex(i, j, k);
        if (value == background_) {
            auto it = leaves_.find(key);
            if (it == leaves_.end()) return;          // already background
            T& slot = it->second.v[li];
            if (!(slot == background_)) {
                slot = value;
                --it->second.nonBackground;
            }
            return;
        }
        Leaf& leaf = materialise(key);
        T& slot = leaf.v[li];
        if (slot == background_) ++leaf.nonBackground;
        slot = value;
    }

    // Drop any leaf that has become entirely background (housekeeping after a
    // transform that erased a tile's last non-background node). Keeps the active
    // set tight so the sparsity ratio reflects reality.
    void pruneBackgroundLeaves() {
        for (auto it = leaves_.begin(); it != leaves_.end(); ) {
            if (it->second.nonBackground == 0) it = leaves_.erase(it);
            else ++it;
        }
    }

    // ---- world geometry (identical to VoxelGrid) ----------------------------
    Vec3 nodePosition(std::size_t i, std::size_t j, std::size_t k) const {
        return Vec3{ origin_.x + double(i) * spacing_,
                     origin_.y + double(j) * spacing_,
                     origin_.z + double(k) * spacing_ };
    }
    Vec3 cellCenter(std::size_t i, std::size_t j, std::size_t k) const {
        return Vec3{ origin_.x + (double(i) + 0.5) * spacing_,
                     origin_.y + (double(j) + 0.5) * spacing_,
                     origin_.z + (double(k) + 0.5) * spacing_ };
    }

    // Trilinear sample at an arbitrary world point — BYTE-IDENTICAL arithmetic to
    // VoxelGrid::sample (same clamp, same i0/j0/k0 selection, same lerp order),
    // but reading node corner values through the sparse store (at()) instead of a
    // dense array. Reads are O(1) hash lookups; absent corners return background.
    // This is what keeps the volume measure sparse: only the (few) cells near the
    // surface are ever sampled, and no full dense array is materialised.
    double sample(const Vec3& p) const {
        double gx = (p.x - origin_.x) / spacing_;
        double gy = (p.y - origin_.y) / spacing_;
        double gz = (p.z - origin_.z) / spacing_;
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

    // ---- sparse iteration over ACTIVE tiles ---------------------------------
    // Visit every node that lives in a materialised tile (background nodes inside
    // an active tile included) as fn(i,j,k,value). Absent tiles are skipped —
    // that is the whole point. The base node of each tile is recovered from its
    // key so global (i,j,k) are exact.
    template <typename Fn>
    void forEachActiveNode(Fn fn) const {
        for (const auto& kv : leaves_) {
            const TileKey key = kv.first;
            const Leaf& leaf = kv.second;
            const std::size_t bi = std::size_t(key.tx) * kLeaf;
            const std::size_t bj = std::size_t(key.ty) * kLeaf;
            const std::size_t bk = std::size_t(key.tz) * kLeaf;
            for (int lz = 0; lz < kLeaf; ++lz) {
                const std::size_t gk = bk + std::size_t(lz);
                if (gk >= nz_) break;
                for (int ly = 0; ly < kLeaf; ++ly) {
                    const std::size_t gj = bj + std::size_t(ly);
                    if (gj >= ny_) break;
                    for (int lx = 0; lx < kLeaf; ++lx) {
                        const std::size_t gi = bi + std::size_t(lx);
                        if (gi >= nx_) break;
                        const int loff = lx + kLeaf * (ly + kLeaf * lz);
                        fn(gi, gj, gk, leaf.v[std::size_t(loff)]);
                    }
                }
            }
        }
    }

    // ---- lossless interop with the dense VoxelGrid<T> -----------------------
    // Build a SparseVoxelGrid from a dense grid: materialise a leaf for every
    // tile that contains a node whose value differs from `background`, copying the
    // exact stored value. Nodes equal to background are left absent (read back as
    // background) so the round-trip is exact.
    static SparseVoxelGrid<T> fromDense(const VoxelGrid<T>& g, T background = T(0)) {
        SparseVoxelGrid<T> s(g.nx(), g.ny(), g.nz(), g.origin(), g.spacing(),
                             background);
        for (std::size_t k = 0; k < g.nz(); ++k)
            for (std::size_t j = 0; j < g.ny(); ++j)
                for (std::size_t i = 0; i < g.nx(); ++i) {
                    const T val = g.at(i, j, k);
                    if (!(val == background)) s.set(i, j, k, val);
                }
        return s;
    }

    // Reconstruct the dense grid EXACTLY: fill the whole lattice with `background`
    // then overwrite every node that lives in an active tile with its stored
    // value. fromDense(g).toDense() == g node-for-node.
    VoxelGrid<T> toDense() const {
        VoxelGrid<T> g(nx_, ny_, nz_, origin_, spacing_, background_);
        forEachActiveNode([&](std::size_t i, std::size_t j, std::size_t k, T v) {
            g.at(i, j, k) = v;
        });
        return g;
    }

    // ---- sparse field ops (active-tile only; result-identical to dense) ------
    //
    // OFFSET: f' = f - d (the SAME level-set identity as VoxelFieldOps::offset /
    // Morphology::offset; not re-derived). Applied to every stored leaf value AND
    // to the background (so absent tiles keep consistent semantics). Touches only
    // active tiles. toDense() of the result equals the dense offset's grid.
    SparseVoxelGrid<T> offset(double d) const {
        SparseVoxelGrid<T> out(nx_, ny_, nz_, origin_, spacing_,
                               static_cast<T>(double(background_) - d));
        for (const auto& kv : leaves_) {
            Leaf nl;
            nl.v.fill(out.background_);
            nl.nonBackground = 0;
            const Leaf& src = kv.second;
            for (int li = 0; li < kLeaf3; ++li) {
                const T nv = static_cast<T>(double(src.v[std::size_t(li)]) - d);
                nl.v[std::size_t(li)] = nv;
                if (!(nv == out.background_)) ++nl.nonBackground;
            }
            if (nl.nonBackground > 0) out.leaves_.emplace(kv.first, std::move(nl));
        }
        return out;
    }

    // SHELL (symmetric uniform thickness t): f' = |f| - t/2 (the SAME identity as
    // VoxelFieldOps::shell). t must be finite and > 0; otherwise the field is
    // returned UNCHANGED (honest, matching the dense op's degenerate handling).
    SparseVoxelGrid<T> shell(double t) const {
        if (!std::isfinite(t) || !(t > 0.0)) return *this;   // unchanged copy
        const double half = 0.5 * t;
        const T newBg = static_cast<T>(std::fabs(double(background_)) - half);
        SparseVoxelGrid<T> out(nx_, ny_, nz_, origin_, spacing_, newBg);
        for (const auto& kv : leaves_) {
            Leaf nl;
            nl.v.fill(newBg);
            nl.nonBackground = 0;
            const Leaf& src = kv.second;
            for (int li = 0; li < kLeaf3; ++li) {
                const T nv = static_cast<T>(std::fabs(double(src.v[std::size_t(li)])) - half);
                nl.v[std::size_t(li)] = nv;
                if (!(nv == newBg)) ++nl.nonBackground;
            }
            if (nl.nonBackground > 0) out.leaves_.emplace(kv.first, std::move(nl));
        }
        return out;
    }

    // INWARD-only wall: f' = max(f, -f - t) (the SAME identity as
    // VoxelFieldOps::shellInward). t finite and > 0 else unchanged.
    SparseVoxelGrid<T> shellInward(double t) const {
        if (!std::isfinite(t) || !(t > 0.0)) return *this;
        const double bg = double(background_);
        const T newBg = static_cast<T>(std::max(bg, -bg - t));
        SparseVoxelGrid<T> out(nx_, ny_, nz_, origin_, spacing_, newBg);
        for (const auto& kv : leaves_) {
            Leaf nl;
            nl.v.fill(newBg);
            nl.nonBackground = 0;
            const Leaf& src = kv.second;
            for (int li = 0; li < kLeaf3; ++li) {
                const double f = double(src.v[std::size_t(li)]);
                const T nv = static_cast<T>(std::max(f, -f - t));
                nl.v[std::size_t(li)] = nv;
                if (!(nv == newBg)) ++nl.nonBackground;
            }
            if (nl.nonBackground > 0) out.leaves_.emplace(kv.first, std::move(nl));
        }
        return out;
    }

    // ENCLOSED VOLUME by the cell-center midpoint-Riemann rule — BIT-EXACT with
    // VoxelGrid::occupiedVolumeByCenter(iso, insideIsLeq=true). The integer inside
    // -cell count is identical to the dense routine (proof below); the volume is
    // count * cellVolume(). Solid = { field <= iso }.
    //
    // Strategy: iterate cells in tile-blocks. For each cell (i,j,k) (a cube
    // spanning nodes i..i+1 etc) we need the trilinear value at the cell CENTER,
    // which depends on the 8 corner node values. If ALL 8 corners are background
    // AND background > iso (provably outside) the center value — a convex
    // combination of 8 identical out-of-solid corners (== background) — equals
    // background > iso, so the cell is NOT inside and is skipped WITHOUT counting:
    // this changes no count. Otherwise the cell is classified by the SAME
    // trilinear sampler over the SAME corner values, so the count matches dense.
    //
    // To stay sparse, we only ENUMERATE cells that touch an active tile (or a
    // node adjacent to one): a cell can be inside only if at least one of its 8
    // corners is non-background (since all-background-and-outside is skipped, and
    // if background <= iso the field is solid everywhere — handled by the
    // background branch). We gather candidate cells from active tiles and their
    // low-side neighbours so no inside cell is missed at tile boundaries.
    std::size_t countInsideCellsByCenter(double iso) const {
        // If the BACKGROUND itself is inside (<= iso), the solid fills the whole
        // box wherever the field is background, so a sparse skip is unsafe; fall
        // back to the exact dense count (this is the degenerate "solid background"
        // case — an SDF whose far field is inside, which is not the surface
        // -localised regime sparsity targets). Bit-exact by construction.
        if (double(background_) <= iso) {
            return toDense().countInsideCellsByCenter(iso, /*insideIsLeq=*/true);
        }

        // Surface-localised regime: only cells touching an active tile can be
        // inside. Collect the set of candidate cell base-indices (i,j,k with
        // i<cellsX etc): every cell that has at least one corner inside an active
        // tile. A node (gi,gj,gk) is a corner of cells with base index in
        // {gi-1,gi} x {gj-1,gj} x {gk-1,gk} (clamped to the cell range). We mark
        // those candidate cells, dedup, then classify each by the SAME trilinear
        // sampler — read directly from the sparse store (no dense materialise).
        std::vector<uint8_t> candidate(cellCount(), 0);
        const std::size_t cx = cellsX(), cy = cellsY(), cz = cellsZ();
        forEachActiveNode([&](std::size_t gi, std::size_t gj, std::size_t gk, T) {
            const std::size_t i0 = (gi == 0) ? 0 : gi - 1;
            const std::size_t j0 = (gj == 0) ? 0 : gj - 1;
            const std::size_t k0 = (gk == 0) ? 0 : gk - 1;
            for (std::size_t ck = k0; ck <= gk && ck < cz; ++ck)
                for (std::size_t cj = j0; cj <= gj && cj < cy; ++cj)
                    for (std::size_t ci = i0; ci <= gi && ci < cx; ++ci)
                        candidate[ci + cx * (cj + cy * ck)] = 1;
        });

        std::size_t count = 0;
        for (std::size_t ck = 0; ck < cz; ++ck)
            for (std::size_t cj = 0; cj < cy; ++cj)
                for (std::size_t ci = 0; ci < cx; ++ci) {
                    if (!candidate[ci + cx * (cj + cy * ck)]) continue;
                    Vec3 c = cellCenter(ci, cj, ck);
                    if (sample(c) <= iso) ++count;
                }
        return count;
    }

    double occupiedVolumeByCenter(double iso) const {
        return double(countInsideCellsByCenter(iso)) * cellVolume();
    }
    // PicoGK-named alias used by the rest of the voxel stack.
    double enclosedVolume(double iso = 0.0) const {
        return occupiedVolumeByCenter(iso);
    }

private:
    // Leaf-tile coordinate key. tx == floor(globalIndex / kLeaf). Packed into a
    // 64-bit key for a flat hash (21 bits per axis -> up to ~2M tiles/axis, i.e.
    // ~16M nodes/axis; the dense grid is the practical extent bound anyway).
    struct TileKey {
        int32_t tx = 0, ty = 0, tz = 0;
        bool operator==(const TileKey& o) const {
            return tx == o.tx && ty == o.ty && tz == o.tz;
        }
    };
    struct TileKeyHash {
        std::size_t operator()(const TileKey& k) const {
            // SplitMix-style mixing of the three packed coordinates.
            std::uint64_t h = (std::uint64_t(std::uint32_t(k.tx)) * 0x9E3779B97F4A7C15ull)
                            ^ (std::uint64_t(std::uint32_t(k.ty)) * 0xC2B2AE3D27D4EB4Full)
                            ^ (std::uint64_t(std::uint32_t(k.tz)) * 0x165667B19E3779F9ull);
            h ^= h >> 33; h *= 0xFF51AFD7ED558CCDull; h ^= h >> 33;
            return std::size_t(h);
        }
    };

    TileKey tileKeyOf(std::size_t i, std::size_t j, std::size_t k) const {
        return TileKey{ int32_t(i / kLeaf), int32_t(j / kLeaf), int32_t(k / kLeaf) };
    }
    static int localIndex(std::size_t i, std::size_t j, std::size_t k) {
        const int lx = int(i % kLeaf), ly = int(j % kLeaf), lz = int(k % kLeaf);
        return lx + kLeaf * (ly + kLeaf * lz);
    }

    Leaf& materialise(const TileKey& key) {
        auto it = leaves_.find(key);
        if (it != leaves_.end()) return it->second;
        Leaf leaf;
        leaf.v.fill(background_);
        leaf.nonBackground = 0;
        auto res = leaves_.emplace(key, std::move(leaf));
        return res.first->second;
    }

    static double clampd(double v, double lo, double hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
    static double lerp(double a, double b, double t) { return a + (b - a) * t; }

    std::size_t nx_ = 0, ny_ = 0, nz_ = 0;
    Vec3 origin_{};
    double spacing_ = 1.0;
    T background_ = T(0);
    std::unordered_map<TileKey, Leaf, TileKeyHash> leaves_;
};

} // namespace voxel
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_SPARSEVOXELGRID_HPP
