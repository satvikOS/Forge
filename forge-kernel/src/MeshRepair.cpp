#include "forge/MeshRepair.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <queue>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace forge { namespace meshrepair {

namespace {

inline float v(const Mesh& m, std::uint32_t i, std::uint32_t c) {
    return m.positions[i * 3 + c];
}

inline void sub(const float* a, const float* b, float* out) {
    out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2];
}
inline void cross(const float* a, const float* b, float* out) {
    out[0] = a[1]*b[2] - a[2]*b[1];
    out[1] = a[2]*b[0] - a[0]*b[2];
    out[2] = a[0]*b[1] - a[1]*b[0];
}
inline float dot(const float* a, const float* b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline float lengthSq(const float* a) { return dot(a, a); }

struct EdgeKey {
    std::uint32_t a, b;
    EdgeKey(std::uint32_t x, std::uint32_t y) {
        if (x < y) { a = x; b = y; } else { a = y; b = x; }
    }
    bool operator==(const EdgeKey& o) const { return a == o.a && b == o.b; }
};
struct EdgeHash {
    std::size_t operator()(const EdgeKey& k) const noexcept {
        return (static_cast<std::size_t>(k.a) << 32) ^ static_cast<std::size_t>(k.b);
    }
};

void validateMesh(const Mesh& m) {
    if (m.positions.size() % 3 != 0)
        throw std::invalid_argument("forge.meshrepair: positions length not divisible by 3");
    if (m.indices.size() % 3 != 0)
        throw std::invalid_argument("forge.meshrepair: indices length not divisible by 3");
    const std::uint32_t vCount = static_cast<std::uint32_t>(m.positions.size() / 3);
    for (auto i : m.indices) {
        if (i >= vCount) throw std::invalid_argument("forge.meshrepair: index out of bounds");
    }
}

} // namespace

Stats analyse(const Mesh& m) {
    validateMesh(m);
    Stats s{};
    s.vertexCount   = static_cast<std::uint32_t>(m.positions.size() / 3);
    s.triangleCount = static_cast<std::uint32_t>(m.indices.size() / 3);

    std::unordered_map<EdgeKey, std::uint32_t, EdgeHash> edgeFanCount;
    edgeFanCount.reserve(m.indices.size());
    for (std::size_t t = 0; t < m.indices.size(); t += 3) {
        const std::uint32_t i0 = m.indices[t + 0];
        const std::uint32_t i1 = m.indices[t + 1];
        const std::uint32_t i2 = m.indices[t + 2];
        ++edgeFanCount[EdgeKey(i0, i1)];
        ++edgeFanCount[EdgeKey(i1, i2)];
        ++edgeFanCount[EdgeKey(i2, i0)];
    }
    for (const auto& kv : edgeFanCount) {
        if (kv.second == 1) ++s.boundaryEdgeCount;
        else if (kv.second > 2) ++s.nonManifoldEdgeCount;
    }
    return s;
}

Mesh dedupeVertices(const Mesh& in, double epsilon) {
    validateMesh(in);
    if (epsilon <= 0.0) throw std::invalid_argument("dedupeVertices: epsilon must be > 0");
    const std::uint32_t vCount = static_cast<std::uint32_t>(in.positions.size() / 3);

    // Spatial hash on epsilon-sized cells.
    struct CellKey { std::int64_t x, y, z; bool operator==(const CellKey& o) const { return x==o.x&&y==o.y&&z==o.z; } };
    struct CellHash { std::size_t operator()(const CellKey& k) const noexcept {
        return std::hash<std::int64_t>()(k.x) ^ (std::hash<std::int64_t>()(k.y) << 1) ^ (std::hash<std::int64_t>()(k.z) << 2);
    } };
    std::unordered_map<CellKey, std::vector<std::uint32_t>, CellHash> cells;
    cells.reserve(vCount);

    Mesh out;
    out.positions.reserve(in.positions.size());
    std::vector<std::uint32_t> remap(vCount, 0);
    const float epsf = static_cast<float>(epsilon);
    const float epsfSq = epsf * epsf;

    for (std::uint32_t i = 0; i < vCount; ++i) {
        const float p[3] = { in.positions[i*3+0], in.positions[i*3+1], in.positions[i*3+2] };
        const std::int64_t cx = static_cast<std::int64_t>(std::floor(p[0] / epsf));
        const std::int64_t cy = static_cast<std::int64_t>(std::floor(p[1] / epsf));
        const std::int64_t cz = static_cast<std::int64_t>(std::floor(p[2] / epsf));
        std::uint32_t matched = static_cast<std::uint32_t>(-1);
        for (std::int64_t dx = -1; dx <= 1 && matched == static_cast<std::uint32_t>(-1); ++dx)
        for (std::int64_t dy = -1; dy <= 1 && matched == static_cast<std::uint32_t>(-1); ++dy)
        for (std::int64_t dz = -1; dz <= 1 && matched == static_cast<std::uint32_t>(-1); ++dz) {
            auto it = cells.find({cx+dx, cy+dy, cz+dz});
            if (it == cells.end()) continue;
            for (std::uint32_t j : it->second) {
                const float dxv = out.positions[j*3+0] - p[0];
                const float dyv = out.positions[j*3+1] - p[1];
                const float dzv = out.positions[j*3+2] - p[2];
                if (dxv*dxv + dyv*dyv + dzv*dzv <= epsfSq) { matched = j; break; }
            }
        }
        if (matched != static_cast<std::uint32_t>(-1)) {
            remap[i] = matched;
        } else {
            const std::uint32_t newIdx = static_cast<std::uint32_t>(out.positions.size() / 3);
            out.positions.push_back(p[0]);
            out.positions.push_back(p[1]);
            out.positions.push_back(p[2]);
            cells[{cx, cy, cz}].push_back(newIdx);
            remap[i] = newIdx;
        }
    }
    out.indices.reserve(in.indices.size());
    for (std::size_t t = 0; t < in.indices.size(); t += 3) {
        const std::uint32_t a = remap[in.indices[t+0]];
        const std::uint32_t b = remap[in.indices[t+1]];
        const std::uint32_t c = remap[in.indices[t+2]];
        if (a == b || b == c || c == a) continue; // skip collapsed
        out.indices.push_back(a);
        out.indices.push_back(b);
        out.indices.push_back(c);
    }
    return out;
}

Mesh removeDegenerate(const Mesh& in) {
    validateMesh(in);
    Mesh out;
    out.positions = in.positions;
    out.indices.reserve(in.indices.size());
    for (std::size_t t = 0; t < in.indices.size(); t += 3) {
        const std::uint32_t i0 = in.indices[t+0];
        const std::uint32_t i1 = in.indices[t+1];
        const std::uint32_t i2 = in.indices[t+2];
        if (i0 == i1 || i1 == i2 || i2 == i0) continue;
        const float a[3] = { v(in,i0,0), v(in,i0,1), v(in,i0,2) };
        const float b[3] = { v(in,i1,0), v(in,i1,1), v(in,i1,2) };
        const float c[3] = { v(in,i2,0), v(in,i2,1), v(in,i2,2) };
        float ab[3], ac[3], n[3];
        sub(b, a, ab); sub(c, a, ac); cross(ab, ac, n);
        if (lengthSq(n) <= 1e-20f) continue;
        out.indices.push_back(i0);
        out.indices.push_back(i1);
        out.indices.push_back(i2);
    }
    return out;
}

// Finds boundary loops by walking edges with exactly one incident triangle.
// Each loop is fan-triangulated from its centroid. Loops longer than
// `maxLoopLength` (edges) are skipped — they're probably real holes
// the caller doesn't want patched (windows, slots).
Mesh fillHoles(const Mesh& in, std::uint32_t maxLoopLength) {
    validateMesh(in);
    Mesh out = in;
    if (out.indices.empty()) return out;

    // Build directed-edge → triangle map. A directed edge (a→b) belongs to
    // exactly one triangle in a manifold mesh; the opposite edge (b→a) is
    // owned by the neighbouring triangle. Boundary edges have no twin.
    std::unordered_map<std::uint64_t, std::uint32_t> directed;
    directed.reserve(out.indices.size());
    auto key = [](std::uint32_t a, std::uint32_t b) {
        return (static_cast<std::uint64_t>(a) << 32) | b;
    };
    const std::uint32_t triCount = static_cast<std::uint32_t>(out.indices.size() / 3);
    for (std::uint32_t t = 0; t < triCount; ++t) {
        std::uint32_t i0 = out.indices[t*3+0];
        std::uint32_t i1 = out.indices[t*3+1];
        std::uint32_t i2 = out.indices[t*3+2];
        directed[key(i0,i1)] = t;
        directed[key(i1,i2)] = t;
        directed[key(i2,i0)] = t;
    }
    // Boundary edges: a→b such that b→a does not exist.
    std::unordered_map<std::uint32_t, std::uint32_t> nextOnBoundary;
    for (const auto& kv : directed) {
        const std::uint32_t a = static_cast<std::uint32_t>(kv.first >> 32);
        const std::uint32_t b = static_cast<std::uint32_t>(kv.first & 0xffffffffu);
        if (directed.find(key(b, a)) == directed.end()) {
            nextOnBoundary[a] = b;
        }
    }

    std::unordered_set<std::uint32_t> visited;
    for (const auto& start : nextOnBoundary) {
        if (visited.count(start.first)) continue;
        std::vector<std::uint32_t> loop;
        std::uint32_t cur = start.first;
        while (visited.count(cur) == 0) {
            visited.insert(cur);
            loop.push_back(cur);
            auto it = nextOnBoundary.find(cur);
            if (it == nextOnBoundary.end()) { loop.clear(); break; }
            cur = it->second;
            if (cur == start.first) break;
            if (loop.size() > maxLoopLength) { loop.clear(); break; }
        }
        if (loop.size() < 3) continue;

        // Compute centroid + insert as a new vertex.
        double cx = 0, cy = 0, cz = 0;
        for (auto vi : loop) {
            cx += out.positions[vi*3+0];
            cy += out.positions[vi*3+1];
            cz += out.positions[vi*3+2];
        }
        const double n = static_cast<double>(loop.size());
        const std::uint32_t centre = static_cast<std::uint32_t>(out.positions.size() / 3);
        out.positions.push_back(static_cast<float>(cx / n));
        out.positions.push_back(static_cast<float>(cy / n));
        out.positions.push_back(static_cast<float>(cz / n));

        // Fan triangulation. The boundary walk is consistent (a→b implies
        // the hole sits on the LEFT of a→b), so fan with the centre as
        // the apex preserves winding.
        for (std::size_t i = 0; i < loop.size(); ++i) {
            const std::uint32_t a = loop[i];
            const std::uint32_t b = loop[(i + 1) % loop.size()];
            out.indices.push_back(b);
            out.indices.push_back(a);
            out.indices.push_back(centre);
        }
    }
    return out;
}

Mesh laplacianSmooth(const Mesh& in, std::uint32_t iterations, double lambda) {
    validateMesh(in);
    if (iterations == 0) return in;
    if (lambda <= 0.0 || lambda >= 1.0)
        throw std::invalid_argument("laplacianSmooth: lambda must lie in (0,1)");

    Mesh out = in;
    const std::uint32_t vCount = static_cast<std::uint32_t>(out.positions.size() / 3);

    // Build vertex 1-ring adjacency.
    std::vector<std::unordered_set<std::uint32_t>> nbr(vCount);
    for (std::size_t t = 0; t < out.indices.size(); t += 3) {
        const std::uint32_t i0 = out.indices[t+0];
        const std::uint32_t i1 = out.indices[t+1];
        const std::uint32_t i2 = out.indices[t+2];
        nbr[i0].insert(i1); nbr[i0].insert(i2);
        nbr[i1].insert(i0); nbr[i1].insert(i2);
        nbr[i2].insert(i0); nbr[i2].insert(i1);
    }
    // Boundary vertices are pinned (so smoothing doesn't shrink the mesh).
    std::unordered_map<std::uint64_t, std::uint32_t> directed;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        return (static_cast<std::uint64_t>(a) << 32) | b;
    };
    for (std::size_t t = 0; t < out.indices.size(); t += 3) {
        const std::uint32_t i0 = out.indices[t+0];
        const std::uint32_t i1 = out.indices[t+1];
        const std::uint32_t i2 = out.indices[t+2];
        directed[key(i0,i1)] = 1; directed[key(i1,i2)] = 1; directed[key(i2,i0)] = 1;
    }
    std::vector<bool> pinned(vCount, false);
    for (const auto& kv : directed) {
        const std::uint32_t a = static_cast<std::uint32_t>(kv.first >> 32);
        const std::uint32_t b = static_cast<std::uint32_t>(kv.first & 0xffffffffu);
        if (directed.find(key(b, a)) == directed.end()) {
            pinned[a] = true; pinned[b] = true;
        }
    }

    std::vector<float> next(out.positions.size());
    for (std::uint32_t it = 0; it < iterations; ++it) {
        for (std::uint32_t i = 0; i < vCount; ++i) {
            if (pinned[i] || nbr[i].empty()) {
                next[i*3+0] = out.positions[i*3+0];
                next[i*3+1] = out.positions[i*3+1];
                next[i*3+2] = out.positions[i*3+2];
                continue;
            }
            double sx = 0, sy = 0, sz = 0;
            for (std::uint32_t j : nbr[i]) {
                sx += out.positions[j*3+0];
                sy += out.positions[j*3+1];
                sz += out.positions[j*3+2];
            }
            const double inv = 1.0 / static_cast<double>(nbr[i].size());
            const double cx = sx * inv, cy = sy * inv, cz = sz * inv;
            next[i*3+0] = static_cast<float>(out.positions[i*3+0] * (1.0 - lambda) + cx * lambda);
            next[i*3+1] = static_cast<float>(out.positions[i*3+1] * (1.0 - lambda) + cy * lambda);
            next[i*3+2] = static_cast<float>(out.positions[i*3+2] * (1.0 - lambda) + cz * lambda);
        }
        std::swap(out.positions, next);
    }
    return out;
}

namespace {

struct CollapseCandidate {
    float lengthSq;
    std::uint32_t a, b;
    bool operator<(const CollapseCandidate& o) const {
        // priority queue is a max heap; we want shortest edge first, so
        // invert.
        return lengthSq > o.lengthSq;
    }
};

} // namespace

// Greedy shortest-edge collapse. For each edge in the queue:
//   * skip if either endpoint has been merged
//   * merge the endpoints at their midpoint
//   * drop triangles that become degenerate
// Stops when triangleCount reaches `targetTriangles` (or no more
// collapsible edges remain).
//
// Topology guard: a collapse is rejected if it would create a
// non-manifold edge (two triangles sharing the merged vertex would
// otherwise become a single triangle wrapped on itself).
Mesh decimateEdgeCollapse(const Mesh& in, std::uint32_t targetTriangles) {
    validateMesh(in);
    Mesh out = in;
    const std::uint32_t triCount0 = static_cast<std::uint32_t>(out.indices.size() / 3);
    if (targetTriangles >= triCount0) return out;
    if (targetTriangles < 4) targetTriangles = 4;

    std::uint32_t vCount = static_cast<std::uint32_t>(out.positions.size() / 3);
    std::vector<std::uint32_t> parent(vCount);
    for (std::uint32_t i = 0; i < vCount; ++i) parent[i] = i;
    auto findRoot = [&](std::uint32_t x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };

    std::priority_queue<CollapseCandidate> pq;
    auto pushEdge = [&](std::uint32_t a, std::uint32_t b) {
        if (a == b) return;
        const float dx = out.positions[a*3+0] - out.positions[b*3+0];
        const float dy = out.positions[a*3+1] - out.positions[b*3+1];
        const float dz = out.positions[a*3+2] - out.positions[b*3+2];
        pq.push({ dx*dx + dy*dy + dz*dz, a, b });
    };
    for (std::size_t t = 0; t < out.indices.size(); t += 3) {
        pushEdge(out.indices[t+0], out.indices[t+1]);
        pushEdge(out.indices[t+1], out.indices[t+2]);
        pushEdge(out.indices[t+2], out.indices[t+0]);
    }

    std::vector<std::uint32_t> triActive(out.indices.size() / 3, 1);
    std::uint32_t triCount = triCount0;

    while (!pq.empty() && triCount > targetTriangles) {
        CollapseCandidate c = pq.top(); pq.pop();
        const std::uint32_t a = findRoot(c.a);
        const std::uint32_t b = findRoot(c.b);
        if (a == b) continue;

        // Topology guard: ensure 1-rings of a + b share exactly two
        // common vertices (the two opposite-corner vertices on the
        // two triangles sharing edge (a,b)).
        std::unordered_set<std::uint32_t> neighA, neighB;
        for (std::size_t t = 0; t < out.indices.size(); t += 3) {
            if (!triActive[t / 3]) continue;
            std::uint32_t i0 = findRoot(out.indices[t+0]);
            std::uint32_t i1 = findRoot(out.indices[t+1]);
            std::uint32_t i2 = findRoot(out.indices[t+2]);
            auto collect = [&](std::uint32_t target, std::unordered_set<std::uint32_t>& dst) {
                if (i0 == target) { dst.insert(i1); dst.insert(i2); }
                if (i1 == target) { dst.insert(i0); dst.insert(i2); }
                if (i2 == target) { dst.insert(i0); dst.insert(i1); }
            };
            collect(a, neighA);
            collect(b, neighB);
        }
        neighA.erase(b); neighB.erase(a);
        std::uint32_t shared = 0;
        for (auto x : neighA) if (neighB.count(x)) ++shared;
        if (shared > 2) continue; // would create non-manifold

        // Midpoint merge.
        const float mx = 0.5f * (out.positions[a*3+0] + out.positions[b*3+0]);
        const float my = 0.5f * (out.positions[a*3+1] + out.positions[b*3+1]);
        const float mz = 0.5f * (out.positions[a*3+2] + out.positions[b*3+2]);
        out.positions[a*3+0] = mx;
        out.positions[a*3+1] = my;
        out.positions[a*3+2] = mz;
        parent[b] = a;

        // Drop triangles that became degenerate. Push new edges around `a`.
        for (std::size_t t = 0; t < out.indices.size(); t += 3) {
            if (!triActive[t / 3]) continue;
            std::uint32_t i0 = findRoot(out.indices[t+0]);
            std::uint32_t i1 = findRoot(out.indices[t+1]);
            std::uint32_t i2 = findRoot(out.indices[t+2]);
            if (i0 == i1 || i1 == i2 || i2 == i0) {
                triActive[t / 3] = 0;
                --triCount;
                continue;
            }
            if (i0 == a || i1 == a || i2 == a) {
                pushEdge(i0, i1); pushEdge(i1, i2); pushEdge(i2, i0);
            }
        }
    }

    // Compact: emit new positions + remapped indices.
    std::vector<std::uint32_t> compactRemap(vCount, static_cast<std::uint32_t>(-1));
    Mesh result;
    result.positions.reserve(vCount * 3);
    for (std::size_t t = 0; t < out.indices.size(); t += 3) {
        if (!triActive[t / 3]) continue;
        std::uint32_t roots[3] = {
            findRoot(out.indices[t+0]),
            findRoot(out.indices[t+1]),
            findRoot(out.indices[t+2]),
        };
        for (std::uint32_t r : roots) {
            if (compactRemap[r] == static_cast<std::uint32_t>(-1)) {
                compactRemap[r] = static_cast<std::uint32_t>(result.positions.size() / 3);
                result.positions.push_back(out.positions[r*3+0]);
                result.positions.push_back(out.positions[r*3+1]);
                result.positions.push_back(out.positions[r*3+2]);
            }
        }
        result.indices.push_back(compactRemap[roots[0]]);
        result.indices.push_back(compactRemap[roots[1]]);
        result.indices.push_back(compactRemap[roots[2]]);
    }
    return result;
}

}} // namespace forge::meshrepair
