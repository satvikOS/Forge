// forge/native/geom/Delaunay.cpp
//
// Implementation of the in-house 2D Delaunay triangulation declared in
// forge/native/geom/Delaunay.hpp. See that header for the algorithm, robustness
// posture, and the TARGETED remainder. Pure C++20 + stdlib only.

#include "forge/native/geom/Delaunay.hpp"

#include <algorithm>
#include <unordered_map>
#include <cstdint>
#include <cmath>
#include <limits>
#include <bit>

namespace forge {
namespace native {
namespace geom {

namespace {

// A triangle as three indices into a working point array (super vertices use
// the highest three indices). `alive` lets us tombstone instead of erasing,
// keeping indices stable inside one insertion step.
struct Tri {
    int a, b, c;
    bool alive;
};

// Ensure (a,b,c) is CCW using the EXACT orientation predicate. If it is CW we
// swap b,c. Collinear triples never reach here (they would be zero-area and are
// excluded by construction during insertion).
inline void makeCCW(const std::vector<Point2>& P, int& a, int& b, int& c) {
    Sign s = orient2d(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y);
    if (s == Sign::NEGATIVE) std::swap(b, c);
}

// EXACT "is p strictly inside the circumcircle of CCW triangle (a,b,c)?".
// incircle() requires a,b,c CCW; we guarantee that for every stored triangle.
inline bool strictlyInCircumcircle(const std::vector<Point2>& P,
                                   int a, int b, int c, int p) {
    return incircle(P[a].x, P[a].y,
                    P[b].x, P[b].y,
                    P[c].x, P[c].y,
                    P[p].x, P[p].y) == Sign::POSITIVE;
}

// Undirected edge key for cavity-boundary bookkeeping.
inline std::uint64_t edgeKey(int u, int v) {
    if (u > v) std::swap(u, v);
    return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
            static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
}

// Small deterministic LCG for the randomized insertion order.
struct Lcg {
    std::uint64_t s;
    explicit Lcg(std::uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    std::uint64_t next() {
        // Numerical Recipes constants — fine for shuffling insertion order.
        s = s * 6364136223846793005ull + 1442695040888963407ull;
        return s;
    }
};

} // namespace

DelaunayResult delaunay2D(const std::vector<Point2>& ptsIn, std::uint64_t seed) {
    DelaunayResult R;

    // ---- 1. De-duplicate input EXACTLY (a duplicate has no well-defined
    //         circumcircle membership). Keep first occurrence order. ----------
    {
        // Map exact (x,y) -> local index. Hash on the raw bit patterns so that
        // -0.0 and +0.0 (which compare equal) map together via the equality
        // pass; we additionally normalize -0.0 to +0.0 before hashing.
        struct Key { double x, y; };
        struct KeyHash {
            std::size_t operator()(const Key& k) const {
                auto bx = std::bit_cast<std::uint64_t>(k.x);
                auto by = std::bit_cast<std::uint64_t>(k.y);
                std::uint64_t h = bx * 0x9E3779B97F4A7C15ull ^
                                  (by + 0x9E3779B97F4A7C15ull + (bx << 6) + (bx >> 2));
                return static_cast<std::size_t>(h);
            }
        };
        struct KeyEq {
            bool operator()(const Key& a, const Key& b) const {
                return a.x == b.x && a.y == b.y;
            }
        };
        std::unordered_map<Key, int, KeyHash, KeyEq> seen;
        seen.reserve(ptsIn.size() * 2 + 1);
        for (int i = 0; i < static_cast<int>(ptsIn.size()); ++i) {
            double x = ptsIn[i].x == 0.0 ? 0.0 : ptsIn[i].x;  // normalize -0.0
            double y = ptsIn[i].y == 0.0 ? 0.0 : ptsIn[i].y;
            Key k{x, y};
            if (seen.find(k) == seen.end()) {
                seen.emplace(k, static_cast<int>(R.points.size()));
                R.points.push_back(Point2{x, y});
                R.inputIndex.push_back(i);
            }
        }
    }

    const int n = static_cast<int>(R.points.size());
    if (n < 3) {
        R.ok = false;
        R.reason = "fewer than 3 unique points";
        R.triangles.clear();
        return R;
    }

    // ---- All-collinear check via the EXACT predicate. If no triple is a
    //      non-degenerate CCW/CW triangle, there is no 2D triangulation. -------
    {
        bool foundNonCollinear = false;
        for (int i = 2; i < n && !foundNonCollinear; ++i) {
            if (orient2d(R.points[0].x, R.points[0].y,
                         R.points[1].x, R.points[1].y,
                         R.points[i].x, R.points[i].y) != Sign::ZERO) {
                foundNonCollinear = true;
            }
        }
        if (!foundNonCollinear) {
            R.ok = false;
            R.reason = "all unique points are collinear";
            R.triangles.clear();
            return R;
        }
    }

    // ---- 2. Build the working point array: input points + 3 super vertices. --
    // Bounding box of the input.
    double minx = R.points[0].x, maxx = R.points[0].x;
    double miny = R.points[0].y, maxy = R.points[0].y;
    for (int i = 1; i < n; ++i) {
        minx = std::min(minx, R.points[i].x);
        maxx = std::max(maxx, R.points[i].x);
        miny = std::min(miny, R.points[i].y);
        maxy = std::max(maxy, R.points[i].y);
    }
    double dx = maxx - minx, dy = maxy - miny;
    double dmax = std::max(dx, dy);
    if (dmax <= 0.0) dmax = 1.0;  // all-equal-coordinate guard (shouldn't reach
                                  // here after the collinear check, but safe).
    double cx = 0.5 * (minx + maxx);
    double cy = 0.5 * (miny + maxy);
    // A super-triangle that strictly contains the bounding box with wide margin.
    // The factor is generous so every input point is well inside; the gate
    // checks the result tiles the hull, so "large enough" is verified, not
    // assumed.
    const double M = 1000.0 * dmax;

    std::vector<Point2> P = R.points;  // working copy; super verts appended
    const int s0 = n + 0, s1 = n + 1, s2 = n + 2;
    P.push_back(Point2{cx - 2.0 * M, cy - M});       // s0 bottom-left
    P.push_back(Point2{cx + 2.0 * M, cy - M});       // s1 bottom-right
    P.push_back(Point2{cx,           cy + 2.0 * M}); // s2 top

    std::vector<Tri> tris;
    tris.reserve(static_cast<std::size_t>(2 * n) + 8);
    {
        int a = s0, b = s1, c = s2;
        makeCCW(P, a, b, c);
        tris.push_back(Tri{a, b, c, true});
    }

    // ---- 3. Randomized insertion order (deterministic). --------------------
    std::vector<int> order(n);
    for (int i = 0; i < n; ++i) order[i] = i;
    {
        Lcg rng(seed);
        for (int i = n - 1; i > 0; --i) {
            int j = static_cast<int>(rng.next() % static_cast<std::uint64_t>(i + 1));
            std::swap(order[i], order[j]);
        }
    }

    // Reusable scratch.
    std::vector<int> bad;                          // indices into tris
    std::unordered_map<std::uint64_t, int> edgeCount;  // cavity-boundary edges
    std::unordered_map<std::uint64_t, std::array<int,2>> edgeVerts;

    // ---- 4. Bowyer-Watson insertion. ---------------------------------------
    for (int oi = 0; oi < n; ++oi) {
        const int p = order[oi];

        // (a) Collect bad triangles (p strictly inside their circumcircle).
        bad.clear();
        for (int t = 0; t < static_cast<int>(tris.size()); ++t) {
            if (!tris[t].alive) continue;
            if (strictlyInCircumcircle(P, tris[t].a, tris[t].b, tris[t].c, p))
                bad.push_back(t);
        }
        // With an EXACT incircle and a point strictly inside the super-triangle,
        // `bad` is always non-empty and forms a single star-shaped cavity.
        // (If a future input ever sat exactly on EVERY relevant circle, `bad`
        // could be empty; we then skip — the point already lies on existing
        // circumcircles so the triangulation stays Delaunay. This cannot drop a
        // point from the hull because such a point is necessarily a duplicate or
        // on an existing edge, both handled elsewhere.)
        if (bad.empty()) continue;

        // (b) Find the cavity boundary: edges that belong to exactly one bad
        //     triangle. Tombstone the bad triangles as we go.
        edgeCount.clear();
        edgeVerts.clear();
        auto addEdge = [&](int u, int v) {
            std::uint64_t k = edgeKey(u, v);
            auto it = edgeCount.find(k);
            if (it == edgeCount.end()) {
                edgeCount.emplace(k, 1);
                edgeVerts.emplace(k, std::array<int,2>{u, v});  // keep one CCW order
            } else {
                ++it->second;
            }
        };
        for (int t : bad) {
            const Tri& T = tris[t];
            addEdge(T.a, T.b);
            addEdge(T.b, T.c);
            addEdge(T.c, T.a);
            tris[t].alive = false;
        }

        // (c) Re-triangulate the cavity: connect p to every boundary edge,
        //     wound CCW via the exact predicate.
        for (auto& kv : edgeCount) {
            if (kv.second != 1) continue;  // interior cavity edge — shared, drop
            const std::array<int,2>& e = edgeVerts[kv.first];
            int a = e[0], b = e[1], c = p;
            // Skip a degenerate (collinear) new triangle defensively; with a
            // star-shaped cavity around an interior point this does not occur,
            // but the exact test makes the guard free and certain.
            Sign s = orient2d(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y);
            if (s == Sign::ZERO) continue;
            if (s == Sign::NEGATIVE) std::swap(a, b);  // make CCW
            tris.push_back(Tri{a, b, c, true});
        }
    }

    // ---- 5. Drop triangles touching a super vertex; emit the rest. ----------
    R.triangles.clear();
    R.triangles.reserve(tris.size());
    for (const Tri& T : tris) {
        if (!T.alive) continue;
        if (T.a >= n || T.b >= n || T.c >= n) continue;  // touches super vertex
        // Triangles were stored CCW already; re-affirm with the exact predicate
        // so the contract (orient2d > 0) is guaranteed even if anything upstream
        // changed.
        int a = T.a, b = T.b, c = T.c;
        makeCCW(P, a, b, c);
        R.triangles.push_back(std::array<int,3>{a, b, c});
    }

    R.ok = !R.triangles.empty();
    if (!R.ok) R.reason = "no finite triangles produced";
    return R;
}

bool isDelaunay(const DelaunayResult& result) {
    const auto& P = result.points;
    const int n = static_cast<int>(P.size());
    for (const auto& t : result.triangles) {
        int a = t[0], b = t[1], c = t[2];
        // Must be CCW for incircle() to have its documented meaning.
        if (orient2d(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y)
                != Sign::POSITIVE)
            return false;
        for (int p = 0; p < n; ++p) {
            if (p == a || p == b || p == c) continue;
            if (incircle(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y,
                         P[p].x, P[p].y) == Sign::POSITIVE)
                return false;  // a point strictly inside a circumcircle
        }
    }
    return true;
}

bool isValidTriangulation(const DelaunayResult& result) {
    const auto& P = result.points;
    // All triangles CCW (no inversion / no flipped triangle).
    for (const auto& t : result.triangles) {
        int a = t[0], b = t[1], c = t[2];
        if (orient2d(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y)
                != Sign::POSITIVE)
            return false;
    }
    // Edge-manifoldness: every undirected edge is shared by exactly 1 (boundary)
    // or 2 (interior) triangles. A planar triangulation with overlapping
    // triangles would create an edge used 3+ times, or a directed edge reused in
    // the same direction. We check BOTH:
    //   * undirected edge multiplicity in {1,2}
    //   * each DIRECTED edge appears at most once (consistent winding => no two
    //     CCW triangles share an edge in the same direction, which would mean
    //     they overlap).
    std::unordered_map<std::uint64_t,int> undirected;
    std::unordered_map<std::uint64_t,int> directed;
    auto und = [](int u, int v) {
        if (u > v) std::swap(u, v);
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
    };
    auto dir = [](int u, int v) {
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
    };
    for (const auto& t : result.triangles) {
        int e[3][2] = {{t[0],t[1]},{t[1],t[2]},{t[2],t[0]}};
        for (auto& ed : e) {
            if (++undirected[und(ed[0], ed[1])] > 2) return false;
            if (++directed[dir(ed[0], ed[1])] > 1) return false;  // overlap
        }
    }
    return true;
}

} // namespace geom
} // namespace native
} // namespace forge
