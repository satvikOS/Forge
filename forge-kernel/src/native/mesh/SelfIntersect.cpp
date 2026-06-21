// forge/native/mesh/SelfIntersect.cpp
//
// Mesh self-intersection detection (Stage 2 validity tooling). See
// forge/native/mesh/SelfIntersect.hpp for the honest scope statement.
//
// ALGORITHM
// ---------
//  1. Validate the soup (lengths multiples of 3, indices in range). On any
//     malformed input return ok=false (0 FAKES — never a fabricated verdict).
//
//  2. ADJACENCY (the skip rule). Two triangles that share a vertex are adjacent
//     and skipped: a fan meeting along a shared edge/vertex is legitimate shared
//     geometry, not a self-intersection. "Share a vertex" means share a vertex
//     INDEX, or share a coincident POSITION (a welded point). We compute, once,
//     a canonical welded id for every vertex (union by coincidence within
//     weldTol via a coordinate hash) and tag each triangle with the SET of its
//     three canonical vertex ids; two triangles are adjacent iff those sets
//     intersect.
//
//  3. SPATIAL GRID. Each triangle's world AABB is rasterised into a uniform grid
//     whose cell size is the mean triangle AABB extent (so a triangle spans only
//     a handful of cells). Triangles that co-occupy a cell are candidate pairs.
//     A pair sharing several cells is de-duplicated to one test. The grid is a
//     PURE accelerator: a real intersection's two triangles always share a cell
//     (their AABBs overlap), so no real crossing is dropped.
//
//  4. VERDICT. Each candidate non-adjacent pair is classified by the exact
//     primitive triTriIntersect. Any non-DISJOINT, non-degenerate relation is a
//     self-intersection. This verdict is identical in the brute-force reference,
//     so the grid path reproduces the O(n^2) result EXACTLY.
//
// Pure C++20, no external dependencies.

#include "forge/native/mesh/SelfIntersect.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"  // exact triTriIntersect + TriTriRelation

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---- A single triangle's three corner positions + its canonical welded ids --
struct Tri {
    Vec3 v0, v1, v2;
    std::uint32_t w0, w1, w2;  // canonical (welded) vertex ids
    double lo[3];              // AABB min
    double hi[3];              // AABB max
};

inline double triAreaSq(const Vec3& a, const Vec3& b, const Vec3& c) {
    // |(b-a) x (c-a)|^2  — exact-zero only for a truly degenerate triangle.
    double ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    double vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    double cx = uy * vz - uz * vy;
    double cy = uz * vx - ux * vz;
    double cz = ux * vy - uy * vx;
    return cx * cx + cy * cy + cz * cz;
}

// Verdict shared by both the grid and the brute-force paths: do triangles t and
// u count as a self-intersection? (Adjacency is filtered BEFORE this call.)
inline bool pairIntersects(const Tri& t, const Tri& u, int& relationOut) {
    // Cheap AABB reject first (same answer, just faster) — a true intersection
    // requires overlapping boxes.
    for (int k = 0; k < 3; ++k) {
        if (t.hi[k] < u.lo[k] || u.hi[k] < t.lo[k]) return false;
    }
    TriTriResult r = triTriIntersect(t.v0, t.v1, t.v2, u.v0, u.v1, u.v2);
    relationOut = static_cast<int>(r.relation);
    if (r.degenerate) return false;                 // malformed pair: never claim a hit
    return r.relation != TriTriRelation::DISJOINT;  // any real meeting counts
}

inline bool triAdjacent(const Tri& t, const Tri& u) {
    // Adjacent iff the canonical (welded) vertex-id sets share any element.
    const std::uint32_t a[3] = {t.w0, t.w1, t.w2};
    const std::uint32_t b[3] = {u.w0, u.w1, u.w2};
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            if (a[i] == b[j]) return true;
    return false;
}

// ---- Build the per-triangle records, computing welded vertex ids ------------
// Returns false on malformed input. On success `tris` is filled and `bbox`
// holds the overall mesh AABB.
bool buildTris(const std::vector<double>& positions,
               const std::vector<std::uint32_t>& indices,
               double weldTol,
               std::vector<Tri>& tris,
               double bboxLo[3], double bboxHi[3]) {
    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0)   return false;
    const std::size_t numVerts = positions.size() / 3;
    const std::size_t numTris  = indices.size() / 3;
    if (numTris == 0) { /* empty soup is a valid, clean input */ }

    // Canonical welded id per ORIGINAL vertex index.
    // weldTol <= 0  : weld only EXACTLY-equal coordinates (and identical indices,
    //                 which are trivially equal coordinates).
    // weldTol > 0   : weld vertices within a tol-sized lattice cell (snap-round
    //                 the coordinate to a grid of size weldTol and hash it).
    std::vector<std::uint32_t> canon(numVerts);
    {
        std::unordered_map<std::uint64_t, std::uint32_t> bucket;     // snapped-hash -> id (tol>0)
        std::unordered_map<std::string, std::uint32_t> exactBucket;  // raw bits -> id (tol<=0)
        bucket.reserve(numVerts * 2);
        exactBucket.reserve(numVerts * 2);
        std::uint32_t next = 0;

        auto bits = [](double d) -> std::uint64_t {
            std::uint64_t u;
            static_assert(sizeof(u) == sizeof(d), "double is 64-bit");
            std::memcpy(&u, &d, sizeof(u));
            if (d == 0.0) u = 0;  // collapse +0/-0 to one key
            return u;
        };

        for (std::size_t v = 0; v < numVerts; ++v) {
            double x = positions[3 * v + 0];
            double y = positions[3 * v + 1];
            double z = positions[3 * v + 2];
            std::uint32_t id;
            if (weldTol > 0.0) {
                // snap to a lattice of size weldTol, hash the integer cell.
                auto q = [&](double c) -> long long {
                    return static_cast<long long>(std::llround(c / weldTol));
                };
                long long qx = q(x), qy = q(y), qz = q(z);
                std::uint64_t h = 1469598103934665603ULL;
                auto mix = [&](long long w) {
                    h ^= static_cast<std::uint64_t>(w);
                    h *= 1099511628211ULL;
                };
                mix(qx); mix(qy); mix(qz);
                auto it = bucket.find(h);
                if (it != bucket.end()) id = it->second;
                else { id = next++; bucket.emplace(h, id); }
            } else {
                std::uint64_t bx = bits(x), by = bits(y), bz = bits(z);
                std::string key(reinterpret_cast<const char*>(&bx), 8);
                key.append(reinterpret_cast<const char*>(&by), 8);
                key.append(reinterpret_cast<const char*>(&bz), 8);
                auto it = exactBucket.find(key);
                if (it != exactBucket.end()) id = it->second;
                else { id = next++; exactBucket.emplace(std::move(key), id); }
            }
            canon[v] = id;
        }
    }

    tris.clear();
    tris.reserve(numTris);
    for (int k = 0; k < 3; ++k) {
        bboxLo[k] =  std::numeric_limits<double>::infinity();
        bboxHi[k] = -std::numeric_limits<double>::infinity();
    }

    for (std::size_t f = 0; f < numTris; ++f) {
        std::uint32_t ia = indices[3 * f + 0];
        std::uint32_t ib = indices[3 * f + 1];
        std::uint32_t ic = indices[3 * f + 2];
        if (ia >= numVerts || ib >= numVerts || ic >= numVerts) return false;  // out of range
        if (ia == ib || ib == ic || ia == ic) return false;                    // repeated index = degenerate
        Tri t;
        t.v0 = { positions[3*ia+0], positions[3*ia+1], positions[3*ia+2] };
        t.v1 = { positions[3*ib+0], positions[3*ib+1], positions[3*ib+2] };
        t.v2 = { positions[3*ic+0], positions[3*ic+1], positions[3*ic+2] };
        if (triAreaSq(t.v0, t.v1, t.v2) == 0.0) return false;                   // zero-area triangle
        t.w0 = canon[ia]; t.w1 = canon[ib]; t.w2 = canon[ic];
        for (int k = 0; k < 3; ++k) {
            double c0 = (k == 0 ? t.v0.x : k == 1 ? t.v0.y : t.v0.z);
            double c1 = (k == 0 ? t.v1.x : k == 1 ? t.v1.y : t.v1.z);
            double c2 = (k == 0 ? t.v2.x : k == 1 ? t.v2.y : t.v2.z);
            t.lo[k] = std::min(c0, std::min(c1, c2));
            t.hi[k] = std::max(c0, std::max(c1, c2));
            bboxLo[k] = std::min(bboxLo[k], t.lo[k]);
            bboxHi[k] = std::max(bboxHi[k], t.hi[k]);
        }
        tris.push_back(t);
    }
    return true;
}

inline void sortAndDedup(std::vector<SelfIntersection>& pairs) {
    std::sort(pairs.begin(), pairs.end(),
              [](const SelfIntersection& a, const SelfIntersection& b) {
                  return a.i != b.i ? a.i < b.i : a.j < b.j;
              });
    pairs.erase(std::unique(pairs.begin(), pairs.end(),
                            [](const SelfIntersection& a, const SelfIntersection& b) {
                                return a.i == b.i && a.j == b.j;
                            }),
                pairs.end());
}

} // namespace

// ==========================================================================
// Brute-force O(n^2) reference.
// ==========================================================================
SelfIntersectReport detectSelfIntersectionsBruteForce(const std::vector<double>& positions,
                                                      const std::vector<std::uint32_t>& indices,
                                                      double weldTol) {
    SelfIntersectReport rep;
    std::vector<Tri> tris;
    double lo[3], hi[3];
    if (!buildTris(positions, indices, weldTol, tris, lo, hi)) {
        rep.ok = false;
        return rep;
    }
    rep.ok = true;
    rep.numTris = static_cast<std::uint32_t>(tris.size());

    const std::size_t n = tris.size();
    for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t j = i + 1; j < n; ++j) {
            if (triAdjacent(tris[i], tris[j])) continue;
            int rel = 0;
            if (pairIntersects(tris[i], tris[j], rel)) {
                rep.pairs.push_back({static_cast<std::uint32_t>(i),
                                     static_cast<std::uint32_t>(j), rel});
            }
        }
    }
    sortAndDedup(rep.pairs);
    rep.isClean = rep.pairs.empty();
    return rep;
}

// ==========================================================================
// Uniform-spatial-grid production path.
// ==========================================================================
SelfIntersectReport detectSelfIntersections(const std::vector<double>& positions,
                                            const std::vector<std::uint32_t>& indices,
                                            double weldTol) {
    SelfIntersectReport rep;
    std::vector<Tri> tris;
    double lo[3], hi[3];
    if (!buildTris(positions, indices, weldTol, tris, lo, hi)) {
        rep.ok = false;
        return rep;
    }
    rep.ok = true;
    rep.numTris = static_cast<std::uint32_t>(tris.size());

    const std::size_t n = tris.size();
    if (n < 2) { rep.isClean = true; return rep; }

    // Cell size = mean triangle AABB extent (averaged over the three axes), so a
    // typical triangle spans ~1-2 cells per axis. Guard against a zero/NaN size.
    double extentSum = 0.0;
    std::size_t extentCount = 0;
    for (const auto& t : tris) {
        for (int k = 0; k < 3; ++k) {
            double e = t.hi[k] - t.lo[k];
            if (e > 0.0) { extentSum += e; ++extentCount; }
        }
    }
    double cell = (extentCount > 0) ? (extentSum / static_cast<double>(extentCount)) : 0.0;

    // Domain span; if the whole mesh is a point or the cell size is unusable,
    // fall back to the exact brute path (still correct, just O(n^2)).
    double span = 0.0;
    for (int k = 0; k < 3; ++k) span = std::max(span, hi[k] - lo[k]);
    if (!(cell > 0.0) || !(span > 0.0) || !std::isfinite(cell) || !std::isfinite(span)) {
        return detectSelfIntersectionsBruteForce(positions, indices, weldTol);
    }

    // Cap the grid resolution per axis so memory stays bounded on huge meshes.
    const long long kMaxRes = 256;
    auto resOf = [&](int k) -> long long {
        double r = std::ceil((hi[k] - lo[k]) / cell);
        if (!(r >= 1.0)) r = 1.0;
        return std::min<long long>(static_cast<long long>(r), kMaxRes);
    };
    long long rx = resOf(0), ry = resOf(1), rz = resOf(2);
    // Effective cell size per axis from the (possibly capped) resolution.
    double cx = (hi[0] - lo[0]) / static_cast<double>(rx);
    double cy = (hi[1] - lo[1]) / static_cast<double>(ry);
    double cz = (hi[2] - lo[2]) / static_cast<double>(rz);
    if (!(cx > 0.0)) cx = 1.0;
    if (!(cy > 0.0)) cy = 1.0;
    if (!(cz > 0.0)) cz = 1.0;

    auto clampIdx = [](long long v, long long n_) -> long long {
        if (v < 0) return 0;
        if (v >= n_) return n_ - 1;
        return v;
    };
    auto cellKey = [&](long long ix, long long iy, long long iz) -> std::uint64_t {
        // rx,ry,rz <= 256, so 3*9 bits fits comfortably in 64.
        return (static_cast<std::uint64_t>(ix))
             | (static_cast<std::uint64_t>(iy) << 21)
             | (static_cast<std::uint64_t>(iz) << 42);
    };

    // Bucket: cell key -> list of triangle indices overlapping that cell.
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> grid;
    grid.reserve(n * 2);
    for (std::size_t f = 0; f < n; ++f) {
        const Tri& t = tris[f];
        long long ix0 = clampIdx(static_cast<long long>(std::floor((t.lo[0] - lo[0]) / cx)), rx);
        long long ix1 = clampIdx(static_cast<long long>(std::floor((t.hi[0] - lo[0]) / cx)), rx);
        long long iy0 = clampIdx(static_cast<long long>(std::floor((t.lo[1] - lo[1]) / cy)), ry);
        long long iy1 = clampIdx(static_cast<long long>(std::floor((t.hi[1] - lo[1]) / cy)), ry);
        long long iz0 = clampIdx(static_cast<long long>(std::floor((t.lo[2] - lo[2]) / cz)), rz);
        long long iz1 = clampIdx(static_cast<long long>(std::floor((t.hi[2] - lo[2]) / cz)), rz);
        for (long long iz = iz0; iz <= iz1; ++iz)
            for (long long iy = iy0; iy <= iy1; ++iy)
                for (long long ix = ix0; ix <= ix1; ++ix)
                    grid[cellKey(ix, iy, iz)].push_back(static_cast<std::uint32_t>(f));
    }
    rep.gridCells = static_cast<std::uint32_t>(grid.size());

    // Test every co-occupant pair within each cell. De-dup candidate pairs (a
    // pair sharing several cells appears multiple times) BEFORE the (cheap) test
    // so triTriIntersect runs at most once per unique pair.
    std::unordered_set<std::uint64_t> tested;
    tested.reserve(n * 4);
    auto pairKey = [](std::uint32_t a, std::uint32_t b) -> std::uint64_t {
        return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
    };

    for (const auto& kv : grid) {
        const std::vector<std::uint32_t>& occ = kv.second;
        const std::size_t m = occ.size();
        for (std::size_t a = 0; a < m; ++a) {
            for (std::size_t b = a + 1; b < m; ++b) {
                std::uint32_t fi = occ[a], fj = occ[b];
                if (fi > fj) std::swap(fi, fj);
                if (!tested.insert(pairKey(fi, fj)).second) continue;  // already handled
                if (triAdjacent(tris[fi], tris[fj])) continue;
                int rel = 0;
                if (pairIntersects(tris[fi], tris[fj], rel)) {
                    rep.pairs.push_back({fi, fj, rel});
                }
            }
        }
    }
    sortAndDedup(rep.pairs);
    rep.isClean = rep.pairs.empty();
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
