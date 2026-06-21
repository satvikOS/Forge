// forge/native/mesh/Repair.cpp
//
// Implementation of forge::native::mesh::repairMesh — see Repair.hpp for the full
// contract. Pure C++20, standard library only; reuses the parallel native headers
// by #include (Predicates / Geom / HalfEdgeMesh). NO external deps.

#include "forge/native/mesh/Repair.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

// Explicit standard headers (CI portability: libstdc++ does not transitively pull
// these the way libc++ sometimes does).
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---------------------------------------------------------------------------
// Small vector helpers (local; do not pollute the public Vec3).
// ---------------------------------------------------------------------------
struct V3 {
    double x = 0.0, y = 0.0, z = 0.0;
};

static inline V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
static inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

// Triangle area from three positions.
static inline double triArea(const V3& a, const V3& b, const V3& c) {
    return 0.5 * norm(cross(sub(b, a), sub(c, a)));
}

// Pack/unpack an undirected edge key (lo<<32 | hi).
static inline std::uint64_t undirectedKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b;
    std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}
// Directed edge key (a<<32 | b).
static inline std::uint64_t directedKey(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// Canonical (rotation+reflection invariant) key for a face, for exact-dup detect.
// Returns the three indices sorted ascending packed into a 96-bit triple-key
// represented as a pair<uint64,uint32>. We use a std::array<uint32,3> sorted.
static inline std::array<std::uint32_t, 3> canonFace(std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    std::array<std::uint32_t, 3> t{a, b, c};
    std::sort(t.begin(), t.end());
    return t;
}

struct ArrHash {
    std::size_t operator()(const std::array<std::uint32_t, 3>& t) const {
        std::hash<std::uint64_t> h;
        std::uint64_t k0 = (static_cast<std::uint64_t>(t[0]) << 32) | t[1];
        return h(k0) ^ (h(static_cast<std::uint64_t>(t[2]) + 0x9e3779b97f4a7c15ull) << 1);
    }
};

// ---------------------------------------------------------------------------
// (1) VERTEX WELD via a uniform spatial hash. Cell size = eps. We compare a
// candidate against the 27 neighbor cells; the first representative within eps
// wins. Deterministic for a given input ordering.
// ---------------------------------------------------------------------------
struct WeldResult {
    std::vector<V3>           positions;  // welded (unique) positions
    std::vector<std::uint32_t> remap;     // old vertex index -> new index
};

static WeldResult weldVertices(const std::vector<V3>& in, double eps) {
    WeldResult wr;
    wr.remap.assign(in.size(), kInvalid);
    if (eps <= 0.0) eps = std::numeric_limits<double>::min();
    const double inv = 1.0 / eps;

    auto cellOf = [&](const V3& p) -> std::array<long long, 3> {
        return {static_cast<long long>(std::floor(p.x * inv)),
                static_cast<long long>(std::floor(p.y * inv)),
                static_cast<long long>(std::floor(p.z * inv))};
    };
    struct CellHash {
        std::size_t operator()(const std::array<long long, 3>& c) const {
            std::hash<long long> h;
            std::size_t s = h(c[0]);
            s ^= h(c[1]) + 0x9e3779b97f4a7c15ull + (s << 6) + (s >> 2);
            s ^= h(c[2]) + 0x9e3779b97f4a7c15ull + (s << 6) + (s >> 2);
            return s;
        }
    };
    // cell -> list of representative new-vertex indices living in that cell.
    std::unordered_map<std::array<long long, 3>, std::vector<std::uint32_t>, CellHash> grid;
    grid.reserve(in.size() * 2);

    const double eps2 = eps * eps;
    for (std::size_t i = 0; i < in.size(); ++i) {
        const V3& p = in[i];
        std::array<long long, 3> c = cellOf(p);
        std::uint32_t found = kInvalid;
        for (long long dx = -1; dx <= 1 && found == kInvalid; ++dx)
        for (long long dy = -1; dy <= 1 && found == kInvalid; ++dy)
        for (long long dz = -1; dz <= 1 && found == kInvalid; ++dz) {
            std::array<long long, 3> nc{c[0] + dx, c[1] + dy, c[2] + dz};
            auto it = grid.find(nc);
            if (it == grid.end()) continue;
            for (std::uint32_t rep : it->second) {
                V3 d = sub(p, wr.positions[rep]);
                if (dot(d, d) <= eps2) { found = rep; break; }
            }
        }
        if (found == kInvalid) {
            found = static_cast<std::uint32_t>(wr.positions.size());
            wr.positions.push_back(p);
            grid[c].push_back(found);
        }
        wr.remap[i] = found;
    }
    return wr;
}

// ---------------------------------------------------------------------------
// Best-fit-plane projection of a 3D loop to 2D, for ear-clip hole fill. Returns
// the 2D coordinates (Point2) of each loop vertex in the plane basis. Newell's
// method gives a robust normal; we pick two in-plane axes from it.
// ---------------------------------------------------------------------------
static void projectLoopToPlane(const std::vector<V3>& loop,
                               std::vector<forge::native::geom::Point2>& out2d,
                               V3& planeNormal) {
    // Newell normal.
    V3 n{0, 0, 0};
    const std::size_t L = loop.size();
    for (std::size_t i = 0; i < L; ++i) {
        const V3& a = loop[i];
        const V3& b = loop[(i + 1) % L];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    double nl = norm(n);
    if (nl < 1e-300) { n = {0, 0, 1}; nl = 1.0; }
    n.x /= nl; n.y /= nl; n.z /= nl;
    planeNormal = n;

    // Build an in-plane orthonormal basis (u,v).
    V3 ref = (std::fabs(n.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
    V3 u = cross(n, ref);
    double ul = norm(u);
    if (ul < 1e-300) { u = {1, 0, 0}; ul = 1.0; }
    u.x /= ul; u.y /= ul; u.z /= ul;
    V3 v = cross(n, u);  // already unit (n,u unit & orthogonal)

    V3 origin = loop.empty() ? V3{0, 0, 0} : loop[0];
    out2d.clear();
    out2d.reserve(L);
    for (const V3& p : loop) {
        V3 d = sub(p, origin);
        out2d.push_back({dot(d, u), dot(d, v)});
    }
}

// Exact-orient2d point-in-triangle (closed) test for ear clipping.
static bool pointInTri2D(const forge::native::geom::Point2& p,
                         const forge::native::geom::Point2& a,
                         const forge::native::geom::Point2& b,
                         const forge::native::geom::Point2& c) {
    using forge::native::orient2d;
    using forge::native::Sign;
    Sign s0 = orient2d(a.x, a.y, b.x, b.y, p.x, p.y);
    Sign s1 = orient2d(b.x, b.y, c.x, c.y, p.x, p.y);
    Sign s2 = orient2d(c.x, c.y, a.x, a.y, p.x, p.y);
    bool hasNeg = (s0 == Sign::NEGATIVE) || (s1 == Sign::NEGATIVE) || (s2 == Sign::NEGATIVE);
    bool hasPos = (s0 == Sign::POSITIVE) || (s1 == Sign::POSITIVE) || (s2 == Sign::POSITIVE);
    return !(hasNeg && hasPos);  // all same sign (or on boundary) -> inside/on
}

// Ear-clip a simple polygon given by 2D coords; returns local index triples into
// the polygon. Orientation: we clip ears that are convex w.r.t. the polygon's own
// signed-area orientation, using exact orient2d. Empty result on failure.
static std::vector<std::array<std::uint32_t, 3>>
earClip2D(const std::vector<forge::native::geom::Point2>& poly) {
    using forge::native::orient2d;
    using forge::native::Sign;
    std::vector<std::array<std::uint32_t, 3>> tris;
    const std::size_t n = poly.size();
    if (n < 3) return tris;

    // Signed area sign to determine winding (CCW vs CW).
    double area2 = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const auto& a = poly[i];
        const auto& b = poly[(i + 1) % n];
        area2 += a.x * b.y - b.x * a.y;
    }
    bool ccw = area2 > 0.0;

    std::vector<std::uint32_t> idx(n);
    std::iota(idx.begin(), idx.end(), 0u);

    auto isConvex = [&](std::uint32_t pa, std::uint32_t pb, std::uint32_t pc) -> bool {
        Sign s = orient2d(poly[pa].x, poly[pa].y, poly[pb].x, poly[pb].y,
                          poly[pc].x, poly[pc].y);
        if (s == Sign::ZERO) return false;
        return ccw ? (s == Sign::POSITIVE) : (s == Sign::NEGATIVE);
    };

    std::size_t guard = 0;
    std::size_t maxGuard = n * n + 16;
    while (idx.size() > 3 && guard++ < maxGuard) {
        std::size_t m = idx.size();
        bool clipped = false;
        for (std::size_t i = 0; i < m; ++i) {
            std::uint32_t ia = idx[(i + m - 1) % m];
            std::uint32_t ib = idx[i];
            std::uint32_t ic = idx[(i + 1) % m];
            if (!isConvex(ia, ib, ic)) continue;
            // Check no other vertex is inside the candidate ear.
            bool ear = true;
            for (std::size_t j = 0; j < m; ++j) {
                std::uint32_t jv = idx[j];
                if (jv == ia || jv == ib || jv == ic) continue;
                if (pointInTri2D(poly[jv], poly[ia], poly[ib], poly[ic])) { ear = false; break; }
            }
            if (!ear) continue;
            tris.push_back({ia, ib, ic});
            idx.erase(idx.begin() + static_cast<long>(i));
            clipped = true;
            break;
        }
        if (!clipped) break;  // stuck (degenerate polygon) -> fail honestly
    }
    if (idx.size() == 3) {
        tris.push_back({idx[0], idx[1], idx[2]});
    }
    // Success only if we triangulated to exactly n-2 triangles.
    if (tris.size() != n - 2) tris.clear();
    return tris;
}

} // namespace

// ---------------------------------------------------------------------------
// Soup-level repair.
// ---------------------------------------------------------------------------
RepairReport repairMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        const RepairOptions& opt,
                        std::vector<double>& outPositions,
                        std::vector<std::uint32_t>& outIndices) {
    RepairReport rep;
    outPositions.clear();
    outIndices.clear();

    // ---- precondition checks (0 fakes) -----------------------------------
    if (positions.empty() || indices.empty()) { rep.reason = "empty soup"; return rep; }
    if (positions.size() % 3 != 0) { rep.reason = "positions length not a multiple of 3"; return rep; }
    if (indices.size() % 3 != 0)   { rep.reason = "indices length not a multiple of 3"; return rep; }
    if (opt.weldEps <= 0.0)        { rep.reason = "weldEps must be > 0"; return rep; }
    if (opt.areaEps < 0.0)         { rep.reason = "areaEps must be >= 0"; return rep; }

    const std::uint32_t numVin = static_cast<std::uint32_t>(positions.size() / 3);
    const std::uint32_t numFin = static_cast<std::uint32_t>(indices.size() / 3);
    rep.vertsIn = numVin;
    rep.facesIn = numFin;

    for (std::uint32_t i : indices) {
        if (i >= numVin) { rep.reason = "index out of range"; return rep; }
    }

    std::vector<V3> vin(numVin);
    for (std::uint32_t i = 0; i < numVin; ++i) {
        vin[i] = {positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]};
    }

    // ---- (0) CLEAN FAST PATH ---------------------------------------------
    // If the input is ALREADY a clean closed 2-manifold (and, when requested,
    // positively oriented), no repair is needed: return the input soup VERBATIM
    // with wasClean=true and zero repair counts. This avoids reindexing a mesh
    // that did not need touching (the spec's "returned unchanged" guarantee).
    {
        HalfEdgeMesh m0;
        if (m0.buildFromSoup(positions, indices)) {
            ValidityReport v0 = m0.validate();
            if (v0.isValid() && (!opt.orientOutward || m0.signedVolume() > 0.0)) {
                outPositions = positions;
                outIndices = indices;
                rep.vertsOut = numVin;
                rep.facesOut = numFin;
                // components left 0: the per-component pass is skipped on the
                // clean fast path, so we do not claim a count we did not compute.
                rep.wasClean = true;
                rep.ok = true;
                rep.reason = "ok";
                return rep;
            }
        }
    }

    // ---- (1) WELD --------------------------------------------------------
    WeldResult wr = weldVertices(vin, opt.weldEps);
    const std::uint32_t numV = static_cast<std::uint32_t>(wr.positions.size());
    rep.vertsWelded = numVin - numV;

    // Remap faces; (2) drop degenerate (repeated index or tiny area) while at it.
    struct Tri { std::uint32_t a, b, c; };
    std::vector<Tri> faces;
    faces.reserve(numFin);
    for (std::uint32_t f = 0; f < numFin; ++f) {
        std::uint32_t a = wr.remap[indices[3 * f]];
        std::uint32_t b = wr.remap[indices[3 * f + 1]];
        std::uint32_t c = wr.remap[indices[3 * f + 2]];
        if (a == b || b == c || a == c) { ++rep.trisDropped; continue; }
        double area = triArea(wr.positions[a], wr.positions[b], wr.positions[c]);
        if (area <= opt.areaEps) { ++rep.trisDropped; continue; }
        faces.push_back({a, b, c});
    }

    // ---- (3) DEDUPE exact-duplicate faces --------------------------------
    {
        std::unordered_set<std::array<std::uint32_t, 3>, ArrHash> seen;
        seen.reserve(faces.size() * 2);
        std::vector<Tri> kept;
        kept.reserve(faces.size());
        for (const Tri& t : faces) {
            auto key = canonFace(t.a, t.b, t.c);
            if (seen.insert(key).second) kept.push_back(t);
            else ++rep.dupFacesRemoved;
        }
        faces.swap(kept);
    }

    if (faces.empty()) { rep.reason = "no valid faces after cleanup"; return rep; }

    // ---- detect whether the cleaned soup is non-manifold at the EDGE level
    // BEFORE we try to orient/fill. An undirected edge incident to > 2 faces can
    // never be a 2-manifold; report ok=false honestly (do not guess).
    {
        std::unordered_map<std::uint64_t, int> edgeCount;
        edgeCount.reserve(faces.size() * 3);
        for (const Tri& t : faces) {
            ++edgeCount[undirectedKey(t.a, t.b)];
            ++edgeCount[undirectedKey(t.b, t.c)];
            ++edgeCount[undirectedKey(t.c, t.a)];
        }
        for (const auto& kv : edgeCount) {
            if (kv.second > 2) { rep.reason = "non-manifold: an edge is shared by >2 faces"; return rep; }
        }
    }

    // ---- (4) CONSISTENT WINDING per connected component ------------------
    // Build undirected-edge -> incident face list for adjacency/BFS.
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> edgeFaces;
    edgeFaces.reserve(faces.size() * 3);
    auto addEdge = [&](std::uint32_t a, std::uint32_t b, std::uint32_t f) {
        edgeFaces[undirectedKey(a, b)].push_back(f);
    };
    for (std::uint32_t f = 0; f < faces.size(); ++f) {
        addEdge(faces[f].a, faces[f].b, f);
        addEdge(faces[f].b, faces[f].c, f);
        addEdge(faces[f].c, faces[f].a, f);
    }

    const std::uint32_t F = static_cast<std::uint32_t>(faces.size());
    std::vector<int> comp(F, -1);
    int numComp = 0;
    std::vector<std::vector<std::uint32_t>> compFaces;

    // Returns true if face uses directed edge (a->b).
    auto usesDirected = [&](const Tri& t, std::uint32_t a, std::uint32_t b) -> bool {
        return (t.a == a && t.b == b) || (t.b == a && t.c == b) || (t.c == a && t.a == b);
    };
    auto flipFace = [&](std::uint32_t f) { std::swap(faces[f].b, faces[f].c); };

    for (std::uint32_t s = 0; s < F; ++s) {
        if (comp[s] != -1) continue;
        int cid = numComp++;
        compFaces.emplace_back();
        std::queue<std::uint32_t> q;
        comp[s] = cid;
        q.push(s);
        compFaces[cid].push_back(s);
        while (!q.empty()) {
            std::uint32_t f = q.front(); q.pop();
            // Its three directed edges (current orientation).
            std::uint32_t e[3][2] = {
                {faces[f].a, faces[f].b},
                {faces[f].b, faces[f].c},
                {faces[f].c, faces[f].a},
            };
            for (int k = 0; k < 3; ++k) {
                std::uint64_t uk = undirectedKey(e[k][0], e[k][1]);
                for (std::uint32_t g : edgeFaces[uk]) {
                    if (g == f) continue;
                    if (comp[g] == cid) continue;  // already placed/oriented
                    if (comp[g] != -1) continue;   // different comp (shouldn't happen via shared edge)
                    // Orient g so the shared edge is traversed OPPOSITE to f.
                    // f uses (e[k][0]->e[k][1]); g must use (e[k][1]->e[k][0]).
                    if (usesDirected(faces[g], e[k][0], e[k][1])) {
                        flipFace(g);
                        ++rep.facesFlipped;
                    }
                    comp[g] = cid;
                    compFaces[cid].push_back(g);
                    q.push(g);
                }
            }
        }
    }
    rep.components = static_cast<std::uint32_t>(numComp);

    // ---- (5) FILL SMALL HOLES (boundary loops) --------------------------
    // A boundary directed edge is one whose REVERSE directed edge is not present
    // among current faces. Walk boundary edges into loops and ear-clip each loop
    // of size <= maxHoleEdges, sealing with reversed winding.
    auto buildHoleFill = [&]() -> bool {
        // Directed edge set of the current faces.
        std::unordered_set<std::uint64_t> directed;
        directed.reserve(faces.size() * 3);
        for (const Tri& t : faces) {
            directed.insert(directedKey(t.a, t.b));
            directed.insert(directedKey(t.b, t.c));
            directed.insert(directedKey(t.c, t.a));
        }
        // Boundary directed edges: (a->b) present but (b->a) absent.
        // The boundary loop, traversed by following next-from at each vertex,
        // bounds the hole; to SEAL it we add faces using the boundary edges in
        // REVERSE (b->a chain).
        std::unordered_map<std::uint32_t, std::uint32_t> nextOf;  // a -> b along boundary
        std::vector<std::pair<std::uint32_t, std::uint32_t>> bedges;
        for (const Tri& t : faces) {
            const std::uint32_t E[3][2] = {{t.a, t.b}, {t.b, t.c}, {t.c, t.a}};
            for (auto& ed : E) {
                if (directed.find(directedKey(ed[1], ed[0])) == directed.end()) {
                    bedges.push_back({ed[0], ed[1]});
                }
            }
        }
        if (bedges.empty()) return true;  // already watertight

        // Manifold-boundary check: each boundary vertex must have exactly one
        // outgoing boundary edge (else a pinch -> do not guess).
        std::unordered_map<std::uint32_t, int> outDeg, inDeg;
        for (auto& be : bedges) { outDeg[be.first]++; inDeg[be.second]++; nextOf[be.first] = be.second; }
        for (auto& kv : outDeg) if (kv.second != 1) return false;
        for (auto& kv : inDeg)  if (kv.second != 1) return false;

        std::unordered_set<std::uint32_t> visited;
        for (auto& be : bedges) {
            std::uint32_t start = be.first;
            if (visited.count(start)) continue;
            // Walk the loop.
            std::vector<std::uint32_t> loop;
            std::uint32_t cur = start;
            std::size_t guard = 0;
            while (guard++ <= bedges.size() + 1) {
                if (visited.count(cur)) break;
                visited.insert(cur);
                loop.push_back(cur);
                auto it = nextOf.find(cur);
                if (it == nextOf.end()) { loop.clear(); break; }
                cur = it->second;
                if (cur == start) break;
            }
            if (loop.size() < 3) { if (!loop.empty()) return false; else continue; }
            if (loop.size() > opt.maxHoleEdges) { ++rep.holesLeftOpen; continue; }

            // Project to plane, ear-clip.
            std::vector<V3> loop3d;
            loop3d.reserve(loop.size());
            for (std::uint32_t vi : loop) loop3d.push_back(wr.positions[vi]);
            std::vector<forge::native::geom::Point2> poly2d;
            V3 nrm;
            projectLoopToPlane(loop3d, poly2d, nrm);
            std::vector<std::array<std::uint32_t, 3>> localTris = earClip2D(poly2d);
            if (localTris.empty()) return false;  // could not triangulate -> honest fail

            // The loop is wound (a->b along the boundary). To SEAL with the
            // surrounding surface the cap must use each boundary edge REVERSED.
            // The ear-clip produced triangles consistent with the loop's own 2D
            // winding; we emit them and then make winding globally consistent in
            // a re-pass below, so exact local orientation here is not critical —
            // but we DO need the cap triangles connected, which they are.
            for (auto& lt : localTris) {
                Tri nt{loop[lt[0]], loop[lt[1]], loop[lt[2]]};
                // skip accidental degenerate
                if (nt.a == nt.b || nt.b == nt.c || nt.a == nt.c) continue;
                faces.push_back(nt);
                ++rep.holeTrisAdded;
            }
            ++rep.holesFilled;
        }
        return true;
    };

    if (!buildHoleFill()) { rep.reason = "non-manifold boundary or untriangulable hole"; return rep; }

    // If we added cap faces, re-run winding propagation so the new caps are
    // oriented consistently with their component (cheap second pass).
    if (rep.holeTrisAdded > 0) {
        // Rebuild edgeFaces and re-propagate from scratch (faces changed).
        edgeFaces.clear();
        for (std::uint32_t f = 0; f < faces.size(); ++f) {
            addEdge(faces[f].a, faces[f].b, f);
            addEdge(faces[f].b, faces[f].c, f);
            addEdge(faces[f].c, faces[f].a, f);
        }
        const std::uint32_t F2 = static_cast<std::uint32_t>(faces.size());
        // edge over-incidence guard again (cap could have doubled an edge).
        {
            std::unordered_map<std::uint64_t, int> ec;
            for (const Tri& t : faces) {
                ++ec[undirectedKey(t.a, t.b)];
                ++ec[undirectedKey(t.b, t.c)];
                ++ec[undirectedKey(t.c, t.a)];
            }
            for (auto& kv : ec) if (kv.second > 2) { rep.reason = "hole cap produced a non-manifold edge"; return rep; }
        }
        std::vector<int> comp2(F2, -1);
        int nc2 = 0;
        for (std::uint32_t s = 0; s < F2; ++s) {
            if (comp2[s] != -1) continue;
            int cid = nc2++;
            std::queue<std::uint32_t> q;
            comp2[s] = cid; q.push(s);
            while (!q.empty()) {
                std::uint32_t f = q.front(); q.pop();
                std::uint32_t e[3][2] = {
                    {faces[f].a, faces[f].b}, {faces[f].b, faces[f].c}, {faces[f].c, faces[f].a}};
                for (int k = 0; k < 3; ++k) {
                    std::uint64_t uk = undirectedKey(e[k][0], e[k][1]);
                    for (std::uint32_t g : edgeFaces[uk]) {
                        if (g == f || comp2[g] != -1) continue;
                        if (usesDirected(faces[g], e[k][0], e[k][1])) { flipFace(g); ++rep.facesFlipped; }
                        comp2[g] = cid; q.push(g);
                    }
                }
            }
        }
        rep.components = static_cast<std::uint32_t>(nc2);
    }

    // ---- assemble cleaned soup, drop vertices unused by any face ---------
    std::vector<std::uint32_t> vremap(numV, kInvalid);
    std::vector<double> finalPos;
    std::vector<std::uint32_t> finalIdx;
    finalIdx.reserve(faces.size() * 3);
    auto pushV = [&](std::uint32_t v) -> std::uint32_t {
        if (vremap[v] == kInvalid) {
            vremap[v] = static_cast<std::uint32_t>(finalPos.size() / 3);
            finalPos.push_back(wr.positions[v].x);
            finalPos.push_back(wr.positions[v].y);
            finalPos.push_back(wr.positions[v].z);
        }
        return vremap[v];
    };
    for (const Tri& t : faces) {
        finalIdx.push_back(pushV(t.a));
        finalIdx.push_back(pushV(t.b));
        finalIdx.push_back(pushV(t.c));
    }

    rep.vertsOut = static_cast<std::uint32_t>(finalPos.size() / 3);
    rep.facesOut = static_cast<std::uint32_t>(finalIdx.size() / 3);

    // ---- rebuild + audit; orient outward; final validity gate ------------
    HalfEdgeMesh m;
    if (!m.buildFromSoup(finalPos, finalIdx)) {
        rep.reason = "rebuilt soup is not a valid manifold (non-manifold / inconsistent winding)";
        return rep;
    }
    ValidityReport vr = m.validate();
    if (!vr.isValid()) {
        rep.reason = "result is not a watertight 2-manifold after repair";
        return rep;
    }

    // (4 cont.) Global outward orientation: flip the WHOLE soup if signed volume
    // is negative. (Closed consistent mesh -> a single global flip suffices per
    // component; for one closed component this is just sign of total volume.)
    if (opt.orientOutward && m.signedVolume() < 0.0) {
        for (std::uint32_t f = 0; f < faces.size(); ++f) {
            std::swap(finalIdx[3 * f + 1], finalIdx[3 * f + 2]);
            ++rep.facesFlipped;
        }
        HalfEdgeMesh m2;
        if (!m2.buildFromSoup(finalPos, finalIdx) || !m2.validate().isValid()) {
            rep.reason = "global outward orientation broke validity";
            return rep;
        }
        if (m2.signedVolume() <= 0.0) {
            rep.reason = "could not orient outward (signed volume not positive)";
            return rep;
        }
    }

    outPositions.swap(finalPos);
    outIndices.swap(finalIdx);
    rep.wasClean = !rep.totalRepairs();
    rep.ok = true;
    rep.reason = "ok";
    return rep;
}

RepairReport repairMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        const RepairOptions& opt,
                        HalfEdgeMesh& outMesh) {
    std::vector<double> op;
    std::vector<std::uint32_t> oi;
    RepairReport rep = repairMesh(positions, indices, opt, op, oi);
    outMesh = HalfEdgeMesh{};
    if (rep.ok) {
        outMesh.buildFromSoup(op, oi);  // already validated above
    }
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
