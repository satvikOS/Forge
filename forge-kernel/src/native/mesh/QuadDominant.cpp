// forge/native/mesh/QuadDominant.cpp
//
// Implementation of greedy triangle-to-quad-dominant conversion for the in-house
// Forge native kernel. Pure C++20, no external dependencies. See QuadDominant.hpp
// for the honest scope statement, the scoring terms, and the convexity / area
// guarantees.
//
// Strategy:
//   * Validate the triangle soup up front (length multiples, in-range indices,
//     no repeated-vertex triangle). On any defect: ok=false, `out` untouched.
//   * Map every UNDIRECTED edge to the (up to two) triangles using it. An edge
//     used by exactly two triangles is an INTERIOR edge -> one candidate quad.
//   * For each candidate, order the four corners around the boundary of the merged
//     polygon (drop the shared diagonal), compute the average plane normal, project
//     the corners into that plane, and gate STRICT CONVEXITY with the EXACT
//     orient2d predicate (all four turns same sign, none zero). Reject creases
//     (dihedral > threshold) and non-convex / degenerate pairings.
//   * Score the survivors (planarity * shape regularity) and push to a max-heap.
//   * Pop best-first; if neither source triangle is consumed yet, emit the quad and
//     consume both. Stale entries (a triangle already consumed) are discarded.
//   * Every triangle never paired is emitted as a leftover triangle face.

#include "forge/native/mesh/QuadDominant.hpp"

#include "forge/native/Predicates.hpp"            // orient2d (exact convexity gate)
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // Vec3

#include <algorithm>      // std::sort, std::max, std::min, std::clamp
#include <array>          // std::array
#include <cmath>          // std::sqrt, std::fabs, std::acos
#include <cstddef>        // std::size_t
#include <cstdint>        // std::uint32_t, std::uint64_t
#include <limits>         // std::numeric_limits
#include <queue>          // std::priority_queue
#include <unordered_map>  // std::unordered_map
#include <vector>         // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── small vector helpers (Vec3 from HalfEdgeMesh.hpp) ────────────────────────
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline Vec3 scale(const Vec3& a, double s) { return {a.x * s, a.y * s, a.z * s}; }

// Area of triangle (a,b,c) in 3D = 0.5 * |(b-a) x (c-a)|.
inline double triArea(const Vec3& a, const Vec3& b, const Vec3& c) {
    return 0.5 * norm(cross(sub(b, a), sub(c, a)));
}

// Unit normal of triangle (a,b,c); returns false (and leaves n) if degenerate.
inline bool triNormal(const Vec3& a, const Vec3& b, const Vec3& c, Vec3& n) {
    Vec3 cr = cross(sub(b, a), sub(c, a));
    double L = norm(cr);
    if (L <= 0.0) return false;
    n = scale(cr, 1.0 / L);
    return true;
}

// Order-independent 64-bit key for an undirected edge (lo<<32 | hi).
inline std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b;
    std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

// A scored merge candidate (one interior edge).
struct Candidate {
    double        score = 0.0;   // higher = better
    std::uint32_t triA  = 0;     // the two triangles sharing the edge
    std::uint32_t triB  = 0;
    std::array<std::uint32_t, 4> quad{};  // CCW corner order around the merged poly
    std::uint32_t tieKey = 0;    // deterministic tie-break (smaller edge wins)
};

// Max-heap ordering: best (highest) score on top; ties broken by SMALLER tieKey
// so the greedy order is fully deterministic for a fixed input.
struct CandLess {
    bool operator()(const Candidate& a, const Candidate& b) const {
        if (a.score != b.score) return a.score < b.score;   // higher score = higher priority
        return a.tieKey > b.tieKey;                         // smaller tieKey = higher priority
    }
};

} // namespace

QuadDominantReport quadDominant(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                const QuadDominantOptions& options,
                                std::vector<PolyFace>& outFaces) {
    QuadDominantReport rep;

    // ── 0-FAKES input validation ─────────────────────────────────────────────
    if (positions.empty() || indices.empty()) {
        rep.reason = "empty soup";
        return rep;
    }
    if (positions.size() % 3 != 0) {
        rep.reason = "positions length not a multiple of 3";
        return rep;
    }
    if (indices.size() % 3 != 0) {
        rep.reason = "indices length not a multiple of 3";
        return rep;
    }
    const std::size_t numVerts = positions.size() / 3;
    const std::size_t numTris  = indices.size() / 3;

    for (std::size_t t = 0; t < numTris; ++t) {
        std::uint32_t a = indices[3 * t + 0];
        std::uint32_t b = indices[3 * t + 1];
        std::uint32_t c = indices[3 * t + 2];
        if (a >= numVerts || b >= numVerts || c >= numVerts) {
            rep.reason = "index out of range";
            return rep;
        }
        if (a == b || b == c || a == c) {
            rep.reason = "degenerate (repeated-vertex) triangle";
            return rep;
        }
    }

    // Cached vertex positions as Vec3.
    std::vector<Vec3> P(numVerts);
    for (std::size_t i = 0; i < numVerts; ++i) {
        P[i] = {positions[3 * i + 0], positions[3 * i + 1], positions[3 * i + 2]};
    }

    // Per-triangle unit normal + area (reject any degenerate-AREA triangle: a
    // soup with a zero-area face is unsupported input, surfaced honestly).
    std::vector<Vec3>   triN(numTris);
    std::vector<double> triA(numTris);
    double inputArea = 0.0;
    for (std::size_t t = 0; t < numTris; ++t) {
        const Vec3& a = P[indices[3 * t + 0]];
        const Vec3& b = P[indices[3 * t + 1]];
        const Vec3& c = P[indices[3 * t + 2]];
        if (!triNormal(a, b, c, triN[t])) {
            rep.reason = "zero-area (degenerate) triangle";
            return rep;
        }
        triA[t]    = forge::native::mesh::triArea(a, b, c);
        inputArea += triA[t];
    }

    // ── undirected-edge -> incident triangles ────────────────────────────────
    // Each interior edge (exactly two incident triangles) is a quad candidate.
    struct EdgeRec { std::uint32_t t0 = 0xFFFFFFFFu, t1 = 0xFFFFFFFFu; std::uint32_t count = 0; };
    std::unordered_map<std::uint64_t, EdgeRec> edges;
    edges.reserve(numTris * 3);
    for (std::size_t t = 0; t < numTris; ++t) {
        std::uint32_t v[3] = {indices[3 * t + 0], indices[3 * t + 1], indices[3 * t + 2]};
        for (int e = 0; e < 3; ++e) {
            std::uint64_t k = edgeKey(v[e], v[(e + 1) % 3]);
            EdgeRec& r = edges[k];
            if (r.count == 0)      r.t0 = static_cast<std::uint32_t>(t);
            else if (r.count == 1) r.t1 = static_cast<std::uint32_t>(t);
            ++r.count;
        }
    }

    const double cosCrease = std::cos(std::clamp(options.maxDihedral, 0.0,
                                                 3.141592653589793238462643383279502884));

    // ── score each candidate ─────────────────────────────────────────────────
    std::priority_queue<Candidate, std::vector<Candidate>, CandLess> heap;

    // Deterministic iteration order: gather + sort the interior edge keys so the
    // tie-break key is stable run to run (unordered_map order is not).
    std::vector<std::uint64_t> ekeys;
    ekeys.reserve(edges.size());
    for (const auto& kv : edges) {
        if (kv.second.count == 2) ekeys.push_back(kv.first);
    }
    std::sort(ekeys.begin(), ekeys.end());

    std::uint32_t tie = 0;
    for (std::uint64_t k : ekeys) {
        const EdgeRec& r = edges[k];
        const std::uint32_t ta = r.t0, tb = r.t1;
        const std::uint32_t s0 = static_cast<std::uint32_t>(k >> 32);          // shared edge endpoints
        const std::uint32_t s1 = static_cast<std::uint32_t>(k & 0xFFFFFFFFu);

        // The two "apex" vertices: the corner of each triangle NOT on the shared edge.
        auto apexOf = [&](std::uint32_t t) -> std::uint32_t {
            for (int i = 0; i < 3; ++i) {
                std::uint32_t vi = indices[3 * t + i];
                if (vi != s0 && vi != s1) return vi;
            }
            return 0xFFFFFFFFu;
        };
        std::uint32_t pa = apexOf(ta);
        std::uint32_t pb = apexOf(tb);
        if (pa == 0xFFFFFFFFu || pb == 0xFFFFFFFFu) continue;  // (cannot happen on valid input)
        if (pa == pb) continue;  // two tris span the same 3 verts (folded) — not a quad

        const std::uint32_t tieKey = tie++;

        // (planarity) reject sharp creases: dihedral angle = angle between normals.
        double cosDih = dot(triN[ta], triN[tb]);
        cosDih = std::clamp(cosDih, -1.0, 1.0);
        if (cosDih < cosCrease) continue;  // too sharp a fold — keep the feature edge

        // Order the four quad corners CCW around the merged polygon boundary. The
        // merged quad's boundary, traversed, is:  pa -> s0 -> pb -> s1  (one of the
        // two diagonal choices). Pick the winding so corners go around once; verify
        // by exact orient2d in the quad's average plane.
        const Vec3& A = P[pa];
        const Vec3& B = P[s0];
        const Vec3& C = P[pb];
        const Vec3& D = P[s1];

        // Average plane normal (sum of the two triangle normals, renormalised).
        Vec3 nsum = add(triN[ta], triN[tb]);
        double nl = norm(nsum);
        if (nl <= 0.0) continue;  // opposed normals (back-to-back) — not a usable plane
        Vec3 n = scale(nsum, 1.0 / nl);

        // Build an orthonormal in-plane basis (u, w) for projection.
        Vec3 ref = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
        Vec3 u = cross(n, ref);
        double ul = norm(u);
        if (ul <= 0.0) continue;
        u = scale(u, 1.0 / ul);
        Vec3 w = cross(n, u);  // unit (n,u orthonormal)

        auto project = [&](const Vec3& p) -> std::array<double, 2> {
            return {dot(p, u), dot(p, w)};
        };
        std::array<std::array<double, 2>, 4> q = {project(A), project(B), project(C), project(D)};

        // STRICT convexity gate (EXACT orient2d): all four consecutive turns must
        // share the SAME non-zero sign. This rejects non-convex AND degenerate
        // (collinear / zero-area) quads outright — never emitted.
        auto turn = [&](int i) -> int {
            const auto& p0 = q[i];
            const auto& p1 = q[(i + 1) % 4];
            const auto& p2 = q[(i + 2) % 4];
            return signValue(forge::native::orient2d(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]));
        };
        int s = turn(0);
        if (s == 0) continue;
        bool convex = true;
        for (int i = 1; i < 4; ++i) {
            int si = turn(i);
            if (si == 0 || (si > 0) != (s > 0)) { convex = false; break; }
        }
        if (!convex) continue;

        // The CCW corner order to actually emit. orient2d>0 means (A,B,C) is CCW in
        // the (u,w) basis; if it is CW, reverse so the emitted polygon is CCW in
        // that basis (consistent winding among quads).
        std::array<std::uint32_t, 4> quad = {pa, s0, pb, s1};
        if (s < 0) quad = {pa, s1, pb, s0};

        // (shape) regularity term: 4 * area / Σ(squared side lengths). This is the
        // standard quad quality in [0, 1]; == 1 for a perfect square, -> 0 for a
        // sliver. Area is the sum of the two triangle areas (they tile the quad).
        double quadAreaVal = triA[ta] + triA[tb];
        double e0 = norm(sub(P[quad[1]], P[quad[0]]));
        double e1 = norm(sub(P[quad[2]], P[quad[1]]));
        double e2 = norm(sub(P[quad[3]], P[quad[2]]));
        double e3 = norm(sub(P[quad[0]], P[quad[3]]));
        double sumSq = e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3;
        double shape = (sumSq > 0.0) ? (4.0 * quadAreaVal / sumSq) : 0.0;
        shape = std::clamp(shape, 0.0, 1.0);

        // (planarity) term in [0,1]: 1 for perfectly flat, decays with the fold.
        double planar = std::clamp(cosDih, 0.0, 1.0);

        Candidate c;
        c.score  = planar * shape;   // both in [0,1]; product favours flat + well-shaped
        c.triA   = ta;
        c.triB   = tb;
        c.quad   = quad;
        c.tieKey = tieKey;
        heap.push(c);
    }

    // ── greedy max-matching (each triangle used at most once) ────────────────
    std::vector<unsigned char> consumed(numTris, 0);
    std::vector<PolyFace> faces;
    faces.reserve(numTris);  // upper bound

    std::size_t quadCount = 0;
    double outputArea = 0.0;

    while (!heap.empty()) {
        Candidate c = heap.top();
        heap.pop();
        if (consumed[c.triA] || consumed[c.triB]) continue;  // stale — a tri already taken
        consumed[c.triA] = 1;
        consumed[c.triB] = 1;
        PolyFace f;
        f.verts = {c.quad[0], c.quad[1], c.quad[2], c.quad[3]};
        // Area of the emitted quad = its two source triangle areas (exact tiling).
        outputArea += triA[c.triA] + triA[c.triB];
        faces.push_back(std::move(f));
        ++quadCount;
    }

    // Leftover triangles -> triangular faces.
    std::size_t triCount = 0;
    for (std::size_t t = 0; t < numTris; ++t) {
        if (consumed[t]) continue;
        PolyFace f;
        f.verts = {indices[3 * t + 0], indices[3 * t + 1], indices[3 * t + 2]};
        faces.push_back(std::move(f));
        outputArea += triA[t];
        ++triCount;
    }

    // ── success ──────────────────────────────────────────────────────────────
    outFaces = std::move(faces);
    rep.ok             = true;
    rep.reason         = "";
    rep.inputTriangles = numTris;
    rep.quadCount      = quadCount;
    rep.triCount       = triCount;
    rep.faceCount      = quadCount + triCount;
    rep.quadFraction   = (rep.faceCount > 0)
                         ? static_cast<double>(quadCount) / static_cast<double>(rep.faceCount)
                         : 0.0;
    rep.inputArea      = inputArea;
    rep.outputArea     = outputArea;
    return rep;
}

QuadDominantReport quadDominant(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                std::vector<PolyFace>& outFaces) {
    return quadDominant(positions, indices, QuadDominantOptions{}, outFaces);
}

} // namespace mesh
} // namespace native
} // namespace forge
