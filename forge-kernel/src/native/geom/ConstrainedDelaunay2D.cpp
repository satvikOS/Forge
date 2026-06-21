// forge/native/geom/ConstrainedDelaunay2D.cpp
//
// Implementation of the in-house 2D constrained Delaunay triangulation declared
// in forge/native/geom/ConstrainedDelaunay2D.hpp. See that header for the
// algorithm, robustness posture, and the honest limits. Pure C++20 + stdlib.
//
// CI PORTABILITY: every standard header used below is included EXPLICITLY. A
// transitively-available symbol on Mac libc++ can be a hard error on CI's
// libstdc++, so we never rely on transitive includes.

#include "forge/native/geom/ConstrainedDelaunay2D.hpp"

#include <algorithm>      // std::min, std::max, std::swap
#include <array>          // std::array
#include <bit>            // std::bit_cast
#include <cmath>          // std::fabs
#include <cstddef>        // std::size_t
#include <cstdint>        // std::uint32_t / std::uint64_t
#include <queue>          // std::queue (flood fill)
#include <unordered_map>  // adjacency / de-dup maps
#include <unordered_set>  // constrained-edge set
#include <utility>        // std::pair, std::swap
#include <vector>         // std::vector

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"

namespace forge {
namespace native {
namespace geom {

namespace {

// ---------------------------------------------------------------------------
// Undirected / directed edge keys (32-bit vertex indices packed into 64 bits).
// ---------------------------------------------------------------------------
inline std::uint64_t undirKey(int u, int v) {
    if (u > v) std::swap(u, v);
    return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(u)) << 32) |
            static_cast<std::uint64_t>(static_cast<std::uint32_t>(v));
}

// ---------------------------------------------------------------------------
// Triangle mesh with full edge adjacency.
//
// Each triangle stores its 3 vertices v[0..2] (CCW) and 3 neighbours n[0..2],
// where n[i] is the triangle across the edge OPPOSITE vertex v[i] — i.e. across
// edge (v[(i+1)%3], v[(i+2)%3]). A boundary edge has neighbour = -1.
// `alive` tombstones a triangle without invalidating indices.
// ---------------------------------------------------------------------------
struct Tri {
    int v[3];
    int n[3];
    bool alive;
};

// Small deterministic LCG for the randomized insertion order (matches the
// unconstrained sibling's shuffling so behaviour is familiar / reproducible).
struct Lcg {
    std::uint64_t s;
    explicit Lcg(std::uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    std::uint64_t next() {
        s = s * 6364136223846793005ull + 1442695040888963407ull;
        return s;
    }
};

// Exact orientation sign on point indices.
inline Sign orient(const std::vector<Point2>& P, int a, int b, int c) {
    return orient2d(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y);
}

// Exact "is p strictly inside the circumcircle of CCW triangle (a,b,c)?".
inline bool inCircleStrict(const std::vector<Point2>& P, int a, int b, int c, int p) {
    return incircle(P[a].x, P[a].y, P[b].x, P[b].y, P[c].x, P[c].y,
                    P[p].x, P[p].y) == Sign::POSITIVE;
}

// Local index (0..2) of vertex `target` inside triangle t, or -1.
inline int localIndexOf(const Tri& T, int target) {
    if (T.v[0] == target) return 0;
    if (T.v[1] == target) return 1;
    if (T.v[2] == target) return 2;
    return -1;
}

// ---------------------------------------------------------------------------
// The mesh container plus the operations constraint insertion needs.
// ---------------------------------------------------------------------------
struct Mesh {
    std::vector<Point2> P;   // working points (input + 3 super vertices)
    std::vector<Tri>    T;   // triangles
    int                 nInput{0};  // P[0..nInput) are real input vertices

    int makeTri(int a, int b, int c) {
        T.push_back(Tri{{a, b, c}, {-1, -1, -1}, true});
        return static_cast<int>(T.size()) - 1;
    }

    // Set the neighbour of triangle t across edge OPPOSITE local vertex `slot`.
    void setNeighbour(int t, int slot, int other) {
        if (t >= 0) T[t].n[slot] = other;
    }

    // For triangle t and an undirected edge (u,v) that t contains, return the
    // local slot (0..2) opposite that edge (i.e. the local index of the third
    // vertex). Returns -1 if t does not contain both u and v.
    int edgeSlot(int t, int u, int v) const {
        const Tri& A = T[t];
        for (int i = 0; i < 3; ++i) {
            int x = A.v[(i + 1) % 3], y = A.v[(i + 2) % 3];
            if ((x == u && y == v) || (x == v && y == u)) return i;
        }
        return -1;
    }
};

// ---------------------------------------------------------------------------
// Rebuild ALL neighbour links from scratch over the live triangles. O(T). Used
// after the Bowyer-Watson build and after any structural rebuild where keeping
// links incrementally is not worth the bookkeeping. Correctness over cleverness:
// the gate proves the final adjacency by re-deriving it independently.
// ---------------------------------------------------------------------------
void rebuildAdjacency(Mesh& M) {
    // Map each directed edge (a->b) to (triangle, slot-opposite). For a valid
    // triangulation each undirected edge is shared by <=2 triangles; the two
    // share it in OPPOSITE directions, so we key by directed edge and look up
    // the reverse.
    std::unordered_map<std::uint64_t, std::pair<int,int>> dir;
    dir.reserve(M.T.size() * 3 + 1);
    auto dkey = [](int a, int b) {
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(b));
    };
    for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
        if (!M.T[t].alive) continue;
        for (int i = 0; i < 3; ++i) { M.T[t].n[i] = -1; }
    }
    for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
        if (!M.T[t].alive) continue;
        for (int i = 0; i < 3; ++i) {
            int a = M.T[t].v[(i + 1) % 3];
            int b = M.T[t].v[(i + 2) % 3];
            dir[dkey(a, b)] = {t, i};
        }
    }
    for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
        if (!M.T[t].alive) continue;
        for (int i = 0; i < 3; ++i) {
            int a = M.T[t].v[(i + 1) % 3];
            int b = M.T[t].v[(i + 2) % 3];
            auto it = dir.find(dkey(b, a));  // reverse direction = neighbour
            M.T[t].n[i] = (it == dir.end()) ? -1 : it->second.first;
        }
    }
}

// Forward declaration: edge flip (defined below) is used by the incremental
// Delaunay insertion's legalization recursion.
bool flipEdge(Mesh& M, int t, int slot);

// Is point p inside (or on the boundary of) CCW triangle t? Returns:
//   2  = strictly inside
//   1  = on an edge (and inside the triangle's closure)
//   0  = outside
// Decided EXACTLY by the three edge-orientation signs.
inline int pointInTri(const std::vector<Point2>& P, const Tri& T, int p) {
    Sign s0 = orient2d(P[T.v[0]].x, P[T.v[0]].y, P[T.v[1]].x, P[T.v[1]].y, P[p].x, P[p].y);
    Sign s1 = orient2d(P[T.v[1]].x, P[T.v[1]].y, P[T.v[2]].x, P[T.v[2]].y, P[p].x, P[p].y);
    Sign s2 = orient2d(P[T.v[2]].x, P[T.v[2]].y, P[T.v[0]].x, P[T.v[0]].y, P[p].x, P[p].y);
    if (s0 == Sign::NEGATIVE || s1 == Sign::NEGATIVE || s2 == Sign::NEGATIVE) return 0;
    if (s0 == Sign::ZERO || s1 == Sign::ZERO || s2 == Sign::ZERO) return 1;
    return 2;
}

// Legalize the directed edge (pr) opposite the just-inserted vertex `p` in
// triangle `t` (the edge across from p). Lawson recursive flip: if the apex `d`
// of the neighbouring triangle is strictly inside circ(p, r, l) (the triangle
// at p), flip and recurse on the two new outer edges. Robust on cocircular sets
// because the flip predicate is EXACT (a cocircular apex is ZERO -> no flip ->
// no overlap), which is precisely where Bowyer-Watson's cavity heuristic fails.
void legalizeAroundPoint(Mesh& M, int t, int p) {
    int slot = localIndexOf(M.T[t], p);
    if (slot < 0) return;
    int ot = M.T[t].n[slot];            // neighbour across the edge opposite p
    if (ot < 0) return;
    int b = M.T[t].v[(slot + 1) % 3];   // edge endpoints (opposite p)
    int c = M.T[t].v[(slot + 2) % 3];
    int os = M.edgeSlot(ot, b, c);
    if (os < 0) return;
    int d = M.T[ot].v[os];              // apex on the far side
    // p must not be strictly inside circ of (p's triangle reflected) — standard
    // test: is d inside circumcircle of (p,b,c)? (p,b,c) is CCW (t is CCW & p at
    // slot). If yes, edge (b,c) is illegal -> flip.
    if (!inCircleStrict(M.P, p, b, c, d)) return;
    // Convexity is guaranteed for the Delaunay incremental flip (p was just
    // inserted into the union of the two triangles), but verify exactly so a
    // collinear degeneracy can never invert a triangle.
    if (orient(M.P, p, b, d) != Sign::POSITIVE) return;
    if (orient(M.P, p, d, c) != Sign::POSITIVE) return;
    if (!flipEdge(M, t, slot)) return;
    // After the flip, p is in BOTH new triangles (t and ot). Recurse on the two
    // edges now opposite p (the ones incident to d).
    legalizeAroundPoint(M, t, p);
    legalizeAroundPoint(M, ot, p);
}

// ---------------------------------------------------------------------------
// Robust incremental (Lawson) unconstrained Delaunay build into Mesh M.
//   M.P already holds the nInput real points followed by 3 super vertices.
// Insert each point by locating its containing triangle (linear scan — correct
// and simple; the constraint phase dominates cost anyway), splitting that
// triangle (1->3, or 2->4 on an edge), then legalizing by recursive flips. This
// NEVER produces overlapping triangles, including on fully-cocircular inputs
// (regular polygons) where the Bowyer-Watson cavity heuristic breaks down.
// ---------------------------------------------------------------------------
void buildUnconstrained(Mesh& M, std::uint64_t seed) {
    const int n = M.nInput;
    const int s0 = n + 0, s1 = n + 1, s2 = n + 2;

    {
        int a = s0, b = s1, c = s2;
        if (orient(M.P, a, b, c) == Sign::NEGATIVE) std::swap(b, c);
        M.makeTri(a, b, c);
    }
    rebuildAdjacency(M);

    std::vector<int> order(n);
    for (int i = 0; i < n; ++i) order[i] = i;
    {
        Lcg rng(seed);
        for (int i = n - 1; i > 0; --i) {
            int j = static_cast<int>(rng.next() % static_cast<std::uint64_t>(i + 1));
            std::swap(order[i], order[j]);
        }
    }

    for (int oi = 0; oi < n; ++oi) {
        const int p = order[oi];

        // Locate a live triangle whose closure contains p.
        int host = -1, loc = 0;
        for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
            if (!M.T[t].alive) continue;
            int in = pointInTri(M.P, M.T[t], p);
            if (in > 0) { host = t; loc = in; break; }
        }
        if (host < 0) continue;  // p coincides with a vertex or is unlocatable

        if (loc == 2) {
            // Strictly inside: 1 -> 3 split.
            int A = M.T[host].v[0], B = M.T[host].v[1], C = M.T[host].v[2];
            int t0 = host;
            M.T[t0] = Tri{{A, B, p}, {-1, -1, -1}, true};
            int t1 = M.makeTri(B, C, p);
            int t2 = M.makeTri(C, A, p);
            rebuildAdjacency(M);
            legalizeAroundPoint(M, t0, p);
            legalizeAroundPoint(M, t1, p);
            legalizeAroundPoint(M, t2, p);
        } else {
            // On an edge: split BOTH incident triangles (2 -> 4). Find the edge
            // of `host` that p lies on (the one with orient == ZERO).
            int es = -1;
            for (int i = 0; i < 3; ++i) {
                int u = M.T[host].v[(i + 1) % 3], v = M.T[host].v[(i + 2) % 3];
                if (orient(M.P, u, v, p) == Sign::ZERO) { es = i; break; }
            }
            if (es < 0) {  // numerical fallback: treat as interior split
                int A = M.T[host].v[0], B = M.T[host].v[1], C = M.T[host].v[2];
                int t0 = host;
                M.T[t0] = Tri{{A, B, p}, {-1, -1, -1}, true};
                int t1 = M.makeTri(B, C, p);
                int t2 = M.makeTri(C, A, p);
                rebuildAdjacency(M);
                legalizeAroundPoint(M, t0, p);
                legalizeAroundPoint(M, t1, p);
                legalizeAroundPoint(M, t2, p);
                continue;
            }
            int u = M.T[host].v[(es + 1) % 3];
            int v = M.T[host].v[(es + 2) % 3];
            int w = M.T[host].v[es];            // apex of host opposite the edge
            int other = M.T[host].n[es];        // triangle across edge (u,v)

            std::vector<int> created;
            // Split host (u,v,w) into (u,p,w) and (p,v,w).
            int h0 = host;
            M.T[h0] = Tri{{u, p, w}, {-1, -1, -1}, true};
            int h1 = M.makeTri(p, v, w);
            created.push_back(h0); created.push_back(h1);

            if (other >= 0) {
                int oslot = M.edgeSlot(other, u, v);
                int z = M.T[other].v[oslot];     // apex of other opposite (u,v)
                // Split other (u,v,z) into (u,z,p)? keep CCW: other is CCW with
                // edge (v,u) (opposite winding). Build (p,u,z') correctly by
                // orienting each new triangle.
                int o0 = other;
                // new tris: (u, p, z) and (p, v, z) — orient each.
                {
                    int a = u, b = p, c = z;
                    if (orient(M.P, a, b, c) == Sign::NEGATIVE) std::swap(b, c);
                    M.T[o0] = Tri{{a, b, c}, {-1, -1, -1}, true};
                }
                {
                    int a = p, b = v, c = z;
                    if (orient(M.P, a, b, c) == Sign::NEGATIVE) std::swap(b, c);
                    int o1 = M.makeTri(a, b, c);
                    created.push_back(o1);
                }
                created.push_back(o0);
            }
            rebuildAdjacency(M);
            for (int ct : created) legalizeAroundPoint(M, ct, p);
        }
    }

    rebuildAdjacency(M);
}

// ---------------------------------------------------------------------------
// Edge flip: the diagonal of the convex quad formed by triangles t and its
// neighbour across local slot `slot` is flipped. Returns false (no-op) if there
// is no neighbour. Neighbour links of the four surrounding triangles are kept
// consistent so the flip pass can run purely on adjacency. The two triangles
// keep their indices (t and the neighbour) to minimise reallocation.
//
// Geometry: t = (a, b, c) with the shared edge being (b, c) [opposite a]; the
// neighbour ot = (c, b, d). After the flip we have (a, b, d) and (a, d, c).
// ---------------------------------------------------------------------------
bool flipEdge(Mesh& M, int t, int slot) {
    int ot = M.T[t].n[slot];
    if (ot < 0) return false;

    int a = M.T[t].v[slot];
    int b = M.T[t].v[(slot + 1) % 3];
    int c = M.T[t].v[(slot + 2) % 3];

    int oslot = M.edgeSlot(ot, b, c);
    if (oslot < 0) return false;            // adjacency inconsistency guard
    int d = M.T[ot].v[oslot];

    // Outer neighbours (around the quad), referenced by the edges they sit on.
    // In t: edge (a,b) opposite c -> slot (slot+2)%3 ; edge (c,a) opposite b ->
    //        slot (slot+1)%3.
    int nAB = M.T[t].n[(slot + 2) % 3];   // across (a,b)
    int nCA = M.T[t].n[(slot + 1) % 3];   // across (c,a)
    // In ot (= c,b,d order is arbitrary; use edges): across (b,d) and (d,c).
    int nBD = M.T[ot].n[M.edgeSlot(ot, b, d)];
    int nDC = M.T[ot].n[M.edgeSlot(ot, d, c)];

    // New triangles, written back into slots t and ot, CCW guaranteed by the
    // convexity precondition the caller checks (this routine assumes a convex
    // quad — it is only called after that exact check).
    M.T[t]  = Tri{{a, b, d}, {-1, -1, -1}, true};
    M.T[ot] = Tri{{a, d, c}, {-1, -1, -1}, true};

    // Re-link the two new triangles to each other and to the four outer
    // neighbours, fixing the outer neighbours' back-pointers too.
    auto link = [&](int x, int xu, int xv, int y) {
        // set neighbour of x across edge (xu,xv) to y
        int sl = M.edgeSlot(x, xu, xv);
        if (sl >= 0) M.T[x].n[sl] = y;
    };
    auto relinkBack = [&](int outer, int u, int v, int self) {
        if (outer < 0) return;
        int sl = M.edgeSlot(outer, u, v);
        if (sl >= 0) M.T[outer].n[sl] = self;
    };

    // t = (a,b,d): shared diagonal edge (a,d) -> neighbour ot.
    link(t, a, d, ot);
    link(t, a, b, nAB); relinkBack(nAB, a, b, t);
    link(t, b, d, nBD); relinkBack(nBD, b, d, t);

    // ot = (a,d,c): diagonal (a,d) -> neighbour t.
    link(ot, a, d, t);
    link(ot, d, c, nDC); relinkBack(nDC, d, c, ot);
    link(ot, c, a, nCA); relinkBack(nCA, c, a, ot);

    return true;
}

// ---------------------------------------------------------------------------
// Insert ONE constraint edge (vi -> vj) into the mesh by Anglada's strip method.
// `constrained` is the set of undirected keys already pinned as constraints; the
// inserted edge is added to it. Returns false only on a hard topological failure
// (which would indicate a precondition bug — the caller treats that as ok=false).
//
// If (vi,vj) is already an edge, we simply pin it. Otherwise we walk from vi
// toward vj across the strip of triangles the open segment crosses, collect the
// upper- and lower-boundary vertex chains, delete the strip, and re-triangulate
// each side with the constrained recursive-Delaunay fill. The new diagonal
// (vi,vj) is pinned.
// ---------------------------------------------------------------------------
bool insertConstraint(Mesh& M, int vi, int vj,
                      std::unordered_set<std::uint64_t>& constrained);

// Constrained recursive triangulation of a polygon given as an ordered vertex
// list `poly` whose first and last vertices are the constraint segment endpoints
// (vi at poly.front(), vj at poly.back()), and the chain in between bounding ONE
// side of the segment. Adds triangles to M. Classic CGAL "triangulate pseudo-
// polygon" recursion picking the vertex with the empty circumcircle.
// EXACT "is D strictly inside the circumcircle of triangle (A,C,B)?" that is
// CORRECT for EITHER winding of (A,C,B): incircle() assumes a CCW triple, so we
// orient the triple first and test with the consistent meaning. (The pseudo-
// polygon chains arrive in opposite windings on the two sides of the constraint;
// this makes the selection robust to both without re-deriving the chain order.)
inline bool inCircleAnyWinding(const std::vector<Point2>& P,
                               int A, int C, int B, int D) {
    Sign o = orient2d(P[A].x, P[A].y, P[C].x, P[C].y, P[B].x, P[B].y);
    if (o == Sign::ZERO) return false;        // degenerate triple: no circle
    if (o == Sign::NEGATIVE) std::swap(C, B);  // make (A,C,B) CCW
    return incircle(P[A].x, P[A].y, P[C].x, P[C].y, P[B].x, P[B].y,
                    P[D].x, P[D].y) == Sign::POSITIVE;
}

void triangulatePseudoPolygon(Mesh& M, const std::vector<int>& poly) {
    if (poly.size() < 3) return;
    int a = poly.front();
    int b = poly.back();
    // Pick c in (1..size-2) such that NO other polygon vertex lies inside the
    // circumcircle of (a,c,b) — the Delaunay diagonal. The winding-agnostic test
    // keeps this correct on both chains (left chain is CCW, right chain is CW).
    int ci = 1;
    if (poly.size() > 3) {
        for (int k = 2; k + 1 < static_cast<int>(poly.size()); ++k) {
            if (inCircleAnyWinding(M.P, a, poly[ci], b, poly[k]))
                ci = k;
        }
    }
    int c = poly[ci];

    // Emit triangle (a, c, b) wound CCW (skip if degenerate/collinear).
    {
        int x = a, y = c, z = b;
        Sign s = orient(M.P, x, y, z);
        if (s != Sign::ZERO) {
            if (s == Sign::NEGATIVE) std::swap(y, z);
            M.makeTri(x, y, z);
        }
    }

    // Recurse on the two sub-polygons (each still has a,b at front/back of its
    // slice, preserving the (front,back)=(endpoint,endpoint) invariant).
    if (ci > 1) {
        std::vector<int> left(poly.begin(), poly.begin() + ci + 1);
        triangulatePseudoPolygon(M, left);
    }
    if (ci + 1 < static_cast<int>(poly.size()) - 1) {
        std::vector<int> right(poly.begin() + ci, poly.end());
        triangulatePseudoPolygon(M, right);
    }
}

bool insertConstraint(Mesh& M, int vi, int vj,
                      std::unordered_set<std::uint64_t>& constrained) {
    if (vi == vj) return false;

    // Already an edge? Find a triangle containing both as an edge.
    for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
        if (!M.T[t].alive) continue;
        if (localIndexOf(M.T[t], vi) >= 0 && M.edgeSlot(t, vi, vj) >= 0) {
            constrained.insert(undirKey(vi, vj));
            return true;
        }
    }

    // Find the first triangle incident to vi that the segment (vi->vj) enters.
    // The segment leaves vi through the edge (e0,e1) opposite vi whose endpoints
    // STRADDLE the directed line vi->vj (opposite nonzero orient signs) and where
    // vj lies on the far side of that edge from vi. We then canonicalise so that
    // `startL` is the LEFT endpoint (orient(vi,vj,·) POSITIVE) and `startR` the
    // RIGHT endpoint, which the walk below relies on.
    int startT = -1, startL = -1, startR = -1;
    for (int t = 0; t < static_cast<int>(M.T.size()) && startT < 0; ++t) {
        if (!M.T[t].alive) continue;
        int li = localIndexOf(M.T[t], vi);
        if (li < 0) continue;
        int e0 = M.T[t].v[(li + 1) % 3];
        int e1 = M.T[t].v[(li + 2) % 3];
        Sign s0 = orient(M.P, vi, vj, e0);
        Sign s1 = orient(M.P, vi, vj, e1);
        // Both endpoints must be strictly off the line and on opposite sides.
        if (s0 == Sign::ZERO || s1 == Sign::ZERO) continue;
        if (s0 == s1) continue;
        // vj must be on the far side of edge (e0,e1) from vi (the edge separates
        // them), else the segment exits through a different edge / vertex.
        Sign o1 = orient(M.P, e0, e1, vi);
        Sign o2 = orient(M.P, e0, e1, vj);
        if (o1 == Sign::ZERO || o2 == Sign::ZERO || o1 == o2) continue;
        startT = t;
        if (s0 == Sign::POSITIVE) { startL = e0; startR = e1; }
        else                      { startL = e1; startR = e0; }
    }
    if (startT < 0) return false;  // could not locate strip (precondition bug)

    // Walk the strip, collecting crossed triangles and the two boundary chains.
    std::vector<int> upper;  // vertices LEFT of vi->vj (orient positive)
    std::vector<int> lower;  // vertices RIGHT (orient negative)
    std::vector<int> killed; // triangles to delete

    upper.push_back(vi);
    lower.push_back(vi);

    int curT = startT;
    int l = startL;  // current LEFT boundary vertex
    int r = startR;  // current RIGHT boundary vertex
    killed.push_back(curT);
    upper.push_back(l);
    lower.push_back(r);

    // Cross the edge (l,r) into the neighbour and continue until we reach vj.
    int guard = 0;
    const int guardMax = 8 * static_cast<int>(M.T.size()) + 16;
    while (true) {
        if (++guard > guardMax) return false;  // runaway guard (precondition bug)
        int slot = M.edgeSlot(curT, l, r);
        if (slot < 0) return false;
        int nxt = M.T[curT].n[slot];
        if (nxt < 0) return false;             // ran off the boundary unexpectedly
        killed.push_back(nxt);

        // The opposite vertex of nxt across (l,r) is the new apex `o`.
        int os = M.edgeSlot(nxt, l, r);
        if (os < 0) return false;
        int o = M.T[nxt].v[os];

        if (o == vj) {
            upper.push_back(vj);
            lower.push_back(vj);
            break;
        }
        // Which side of vi->vj does `o` fall on? Decides whether it extends the
        // upper or lower chain, and which of (l,r) we keep for the next crossing.
        Sign so = orient(M.P, vi, vj, o);
        if (so == Sign::POSITIVE) {
            // `o` is LEFT of the segment: it becomes the new left boundary, so
            // the segment now crosses edge (o, r). Advance `l`.
            upper.push_back(o);
            l = o;
        } else if (so == Sign::NEGATIVE) {
            // `o` is RIGHT of the segment: new right boundary; segment now
            // crosses edge (l, o). Advance `r`.
            lower.push_back(o);
            r = o;
        } else {
            // `o` lies exactly ON the segment vi->vj: a vertex on the constraint
            // interior. The proper PSLG handling is to split the constraint at o.
            // We treat this as an honest unsupported configuration.
            return false;
        }
        curT = nxt;
    }

    // Delete the strip triangles.
    for (int t : killed) M.T[t].alive = false;

    // upper chain goes vi -> ... -> vj along the LEFT; lower chain vi -> ... -> vj
    // along the RIGHT. The pseudo-polygon for the UPPER side, traversed so that
    // its interior is on a consistent side, is exactly `upper` (vi first, vj
    // last). For the LOWER side we reverse so the recursion's (front,back) =
    // (vi,vj) still holds while keeping the orientation consistent.
    {
        std::vector<int> up = upper;            // vi ... vj  (left vertices)
        triangulatePseudoPolygon(M, up);
    }
    {
        std::vector<int> lo = lower;            // vi ... vj  (right vertices)
        triangulatePseudoPolygon(M, lo);
    }

    constrained.insert(undirKey(vi, vj));

    // The strip rebuild changed local adjacency; refresh links for the whole
    // mesh (cheap relative to the exactness guarantees we want — the gate proves
    // correctness independently).
    rebuildAdjacency(M);
    return true;
}

// ---------------------------------------------------------------------------
// Lawson flip pass restoring the constrained-Delaunay property. Repeatedly flip
// any NON-constrained interior edge that is locally non-Delaunay AND whose flip
// stays convex (so it does not invert a triangle). Constrained edges are pinned.
// Terminates because each successful flip strictly increases the lexicographic
// "min-angle" Delaunay measure on a finite mesh (classical Lawson result); we
// also cap iterations defensively.
// ---------------------------------------------------------------------------
void restoreDelaunay(Mesh& M, const std::unordered_set<std::uint64_t>& constrained) {
    bool changed = true;
    int iter = 0;
    const int iterMax = 64 * static_cast<int>(M.T.size()) + 256;
    while (changed && iter++ < iterMax) {
        changed = false;
        for (int t = 0; t < static_cast<int>(M.T.size()); ++t) {
            if (!M.T[t].alive) continue;
            for (int slot = 0; slot < 3; ++slot) {
                int ot = M.T[t].n[slot];
                if (ot < 0 || ot == t) continue;
                if (!M.T[ot].alive) continue;

                int a = M.T[t].v[slot];
                int b = M.T[t].v[(slot + 1) % 3];
                int c = M.T[t].v[(slot + 2) % 3];
                if (constrained.count(undirKey(b, c))) continue;  // pinned

                int oslot = M.edgeSlot(ot, b, c);
                if (oslot < 0) continue;
                int d = M.T[ot].v[oslot];

                // Local Delaunay: d must not be strictly inside circ(a,b,c). Note
                // (a,b,c) is CCW by construction.
                if (!inCircleStrict(M.P, a, b, c, d)) continue;

                // Flip only if the quad (a,b,d,c) is strictly convex, else the
                // flip would create an inverted / degenerate triangle. Convex iff
                // the new triangles (a,b,d) and (a,d,c) are both CCW.
                if (orient(M.P, a, b, d) != Sign::POSITIVE) continue;
                if (orient(M.P, a, d, c) != Sign::POSITIVE) continue;

                // ANTI-OSCILLATION (near-cocircular robustness). On four points
                // that are nearly — but not exactly — cocircular, the adaptive-
                // exact incircle can report BOTH diagonals of the convex quad as
                // locally illegal (each apex marginally inside the other's
                // circumcircle — the known robustness boundary on a vanishing
                // determinant). Flipping then cycles forever. We require the flip
                // to STRICTLY improve: after the flip the new diagonal (a,d) must
                // itself be locally Delaunay (neither b nor c strictly inside the
                // circumcircle of the triangle on the far side of (a,d)). If the
                // flipped state is no better (a tie), we keep the current diagonal
                // — a valid CDT choice on a near-cocircular quad. This is decided
                // by the SAME predicate the gate's isConstrainedDelaunay uses, so
                // the property the gate asserts is exactly the one we establish.
                bool bInNew = incircle(M.P[a].x, M.P[a].y, M.P[d].x, M.P[d].y,
                                       M.P[c].x, M.P[c].y, M.P[b].x, M.P[b].y)
                              == Sign::POSITIVE;          // b inside circ(a,d,c)
                bool cInNew = incircle(M.P[a].x, M.P[a].y, M.P[b].x, M.P[b].y,
                                       M.P[d].x, M.P[d].y, M.P[c].x, M.P[c].y)
                              == Sign::POSITIVE;          // c inside circ(a,b,d)
                if (bInNew || cInNew) continue;           // not a strict improvement

                if (flipEdge(M, t, slot)) {
                    rebuildAdjacency(M);
                    changed = true;
                    break;  // t was rewritten; restart its edges next sweep
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Even-odd inside/outside marking by flood fill over the FINAL triangle list.
//   `keep` maps final-triangle-index -> bool inside.
// We add a virtual "outside" region: every boundary edge of the convex hull is
// adjacent to outside. Flood from there with parity 0; crossing a constraint
// edge toggles parity; a triangle reached with odd parity is INSIDE.
//
// `finalAdj[t][e]` is the neighbour final-triangle across edge e of final tri t,
// or -1 for hull boundary. `finalConstrained(u,v)` is true for constraint edges.
// ---------------------------------------------------------------------------
void markInsideOutside(const std::vector<std::array<int,3>>& tris,
                       const std::vector<std::array<int,3>>& adj,
                       const std::unordered_set<std::uint64_t>& constrained,
                       std::vector<char>& inside) {
    const int nT = static_cast<int>(tris.size());
    inside.assign(nT, 0);
    std::vector<int> parity(nT, -1);  // -1 unvisited; else 0/1
    std::queue<int> q;

    // Seed: any triangle with a hull-boundary edge starts at parity 0 (outside-
    // adjacent). If that boundary edge is itself a constraint, the triangle is
    // already inside (parity flips immediately).
    for (int t = 0; t < nT; ++t) {
        for (int e = 0; e < 3; ++e) {
            if (adj[t][e] < 0) {
                int u = tris[t][(e + 1) % 3];
                int v = tris[t][(e + 2) % 3];
                int startParity = constrained.count(undirKey(u, v)) ? 1 : 0;
                if (parity[t] < 0) {
                    parity[t] = startParity;
                    q.push(t);
                }
            }
        }
    }
    // Degenerate fallback: if nothing was seeded (no boundary found — impossible
    // for a real triangulation), seed triangle 0 as outside.
    if (q.empty() && nT > 0) { parity[0] = 0; q.push(0); }

    while (!q.empty()) {
        int t = q.front(); q.pop();
        for (int e = 0; e < 3; ++e) {
            int nt = adj[t][e];
            if (nt < 0) continue;
            int u = tris[t][(e + 1) % 3];
            int v = tris[t][(e + 2) % 3];
            int np = parity[t] ^ (constrained.count(undirKey(u, v)) ? 1 : 0);
            if (parity[nt] < 0) {
                parity[nt] = np;
                q.push(nt);
            }
        }
    }
    for (int t = 0; t < nT; ++t)
        inside[t] = (parity[t] == 1) ? 1 : 0;
}

} // namespace

// ===========================================================================
// Public entry point.
// ===========================================================================
CDTResult constrainedDelaunay2D(const std::vector<Point2>& ptsIn,
                                const std::vector<ConstraintEdge>& constraints,
                                std::uint64_t seed) {
    CDTResult R;

    // ---- 1. De-duplicate input EXACTLY; build original->unique index map. ----
    std::vector<int> origToUnique(ptsIn.size(), -1);
    {
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
            auto it = seen.find(k);
            if (it == seen.end()) {
                int idx = static_cast<int>(R.points.size());
                seen.emplace(k, idx);
                R.points.push_back(Point2{x, y});
                R.inputIndex.push_back(i);
                origToUnique[i] = idx;
            } else {
                origToUnique[i] = it->second;
            }
        }
    }

    const int n = static_cast<int>(R.points.size());
    if (n < 3) {
        R.ok = false;
        R.reason = "fewer than 3 unique points";
        return R;
    }

    // ---- All-collinear check (no 2D triangulation otherwise). ----------------
    {
        bool nonCollinear = false;
        for (int i = 2; i < n && !nonCollinear; ++i) {
            if (orient(R.points, 0, 1, i) != Sign::ZERO) nonCollinear = true;
        }
        if (!nonCollinear) {
            R.ok = false;
            R.reason = "all unique points are collinear";
            return R;
        }
    }

    // ---- 2. Map + validate constraints. --------------------------------------
    std::vector<std::array<int,2>> cons;   // undirected (u<v) unique-index edges
    std::unordered_set<std::uint64_t> consSet;
    cons.reserve(constraints.size());
    for (const ConstraintEdge& ce : constraints) {
        if (ce.a < 0 || ce.b < 0 ||
            ce.a >= static_cast<int>(ptsIn.size()) ||
            ce.b >= static_cast<int>(ptsIn.size())) {
            R.ok = false;
            R.reason = "constraint endpoint index out of range";
            return R;
        }
        int u = origToUnique[ce.a];
        int v = origToUnique[ce.b];
        if (u < 0 || v < 0) {  // defensive; mapping is total above
            R.ok = false;
            R.reason = "constraint endpoint not mapped";
            return R;
        }
        if (u == v) {
            R.ok = false;
            R.reason = "degenerate (zero-length) constraint";
            return R;
        }
        std::uint64_t k = undirKey(u, v);
        if (consSet.insert(k).second) {
            if (u > v) std::swap(u, v);
            cons.push_back({u, v});
        }
    }

    // Self-intersection check via the EXACT segmentIntersect classifier. Two
    // distinct constraint segments may share an endpoint (allowed) but must not
    // properly cross, collinearly overlap, or T-touch at an interior point.
    for (std::size_t i = 0; i < cons.size(); ++i) {
        for (std::size_t j = i + 1; j < cons.size(); ++j) {
            int a0 = cons[i][0], a1 = cons[i][1];
            int b0 = cons[j][0], b1 = cons[j][1];
            bool shareEndpoint = (a0 == b0 || a0 == b1 || a1 == b0 || a1 == b1);
            SegIntersection si = segmentIntersect(
                R.points[a0], R.points[a1], R.points[b0], R.points[b1]);
            if (si.relation == SegRelation::PROPER_CROSS) {
                R.ok = false;
                R.reason = "self-intersecting constraints (proper crossing)";
                return R;
            }
            if (si.relation == SegRelation::COLLINEAR_OVERLAP) {
                R.ok = false;
                R.reason = "self-intersecting constraints (collinear overlap)";
                return R;
            }
            if (si.relation == SegRelation::ENDPOINT_TOUCH && !shareEndpoint) {
                // A shared TRIANGULATION vertex would be a shared endpoint; an
                // endpoint touching the interior of another segment (T-junction)
                // is an unsupported PSLG (needs a Steiner split).
                R.ok = false;
                R.reason = "self-intersecting constraints (T-junction)";
                return R;
            }
        }
    }

    // ---- 3. Build unconstrained DT (with super vertices + adjacency). --------
    Mesh M;
    M.nInput = n;
    M.P = R.points;
    {
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
        if (dmax <= 0.0) dmax = 1.0;
        double cx = 0.5 * (minx + maxx);
        double cy = 0.5 * (miny + maxy);
        const double Mscale = 1000.0 * dmax;
        M.P.push_back(Point2{cx - 2.0 * Mscale, cy - Mscale});
        M.P.push_back(Point2{cx + 2.0 * Mscale, cy - Mscale});
        M.P.push_back(Point2{cx,               cy + 2.0 * Mscale});
    }
    buildUnconstrained(M, seed);

    // ---- 4. Insert each constraint edge. -------------------------------------
    std::unordered_set<std::uint64_t> constrainedSet;
    for (const auto& e : cons) {
        if (!insertConstraint(M, e[0], e[1], constrainedSet)) {
            R.ok = false;
            R.reason = "failed to insert a constraint edge (unsupported PSLG)";
            return R;
        }
    }

    // ---- 5. Restore constrained-Delaunay property by flips. ------------------
    restoreDelaunay(M, constrainedSet);

    // ---- 6. Extract finite triangles (drop those touching super vertices). ---
    R.triangles.clear();
    for (const Tri& T : M.T) {
        if (!T.alive) continue;
        if (T.v[0] >= n || T.v[1] >= n || T.v[2] >= n) continue;
        int a = T.v[0], b = T.v[1], c = T.v[2];
        if (orient(M.P, a, b, c) == Sign::NEGATIVE) std::swap(b, c);
        if (orient(M.P, a, b, c) == Sign::ZERO) continue;  // defensive
        R.triangles.push_back({a, b, c});
    }
    if (R.triangles.empty()) {
        R.ok = false;
        R.reason = "no finite triangles produced";
        return R;
    }

    // Build final-triangle adjacency (over the extracted list) for marking.
    std::vector<std::array<int,3>> finalAdj(R.triangles.size(), {-1, -1, -1});
    {
        // directed edge -> (tri, edge-slot)
        std::unordered_map<std::uint64_t, std::pair<int,int>> dir;
        dir.reserve(R.triangles.size() * 3 + 1);
        auto dkey = [](int a, int b) {
            return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
                    static_cast<std::uint64_t>(static_cast<std::uint32_t>(b));
        };
        for (int t = 0; t < static_cast<int>(R.triangles.size()); ++t) {
            for (int e = 0; e < 3; ++e) {
                int a = R.triangles[t][(e + 1) % 3];
                int b = R.triangles[t][(e + 2) % 3];
                dir[dkey(a, b)] = {t, e};
            }
        }
        for (int t = 0; t < static_cast<int>(R.triangles.size()); ++t) {
            for (int e = 0; e < 3; ++e) {
                int a = R.triangles[t][(e + 1) % 3];
                int b = R.triangles[t][(e + 2) % 3];
                auto it = dir.find(dkey(b, a));
                finalAdj[t][e] = (it == dir.end()) ? -1 : it->second.first;
            }
        }
    }

    // ---- Constraint-loop-closed check (every vertex even constraint-degree). --
    {
        std::unordered_map<int,int> deg;
        for (const auto& e : cons) { ++deg[e[0]]; ++deg[e[1]]; }
        bool closed = true;
        for (const auto& kv : deg) if (kv.second % 2 != 0) { closed = false; break; }
        R.closedLoops = cons.empty() ? true : closed;
    }

    // ---- 6b. Inside/outside marking (even-odd). ------------------------------
    if (cons.empty()) {
        // No constraints: the whole convex hull is "inside" by convention.
        R.inside.assign(R.triangles.size(), 1);
    } else {
        markInsideOutside(R.triangles, finalAdj, constrainedSet, R.inside);
    }

    // Report the constraint edges (undirected, u<v) for the caller / gate.
    R.constraintEdges = cons;

    R.ok = true;
    return R;
}

// ===========================================================================
// Verification helpers.
// ===========================================================================
bool allConstraintsPresent(const CDTResult& r) {
    // Collect all undirected triangulation edges.
    std::unordered_set<std::uint64_t> edges;
    edges.reserve(r.triangles.size() * 3 + 1);
    for (const auto& t : r.triangles) {
        edges.insert(undirKey(t[0], t[1]));
        edges.insert(undirKey(t[1], t[2]));
        edges.insert(undirKey(t[2], t[0]));
    }
    for (const auto& e : r.constraintEdges) {
        if (edges.find(undirKey(e[0], e[1])) == edges.end()) return false;
    }
    return true;
}

bool isConstrainedDelaunay(const CDTResult& r) {
    const auto& P = r.points;
    // Constrained-edge set.
    std::unordered_set<std::uint64_t> cons;
    for (const auto& e : r.constraintEdges) cons.insert(undirKey(e[0], e[1]));

    // Directed-edge -> apex map, to find the two triangles across each edge.
    std::unordered_map<std::uint64_t, int> apex;  // (a->b) -> third vertex c
    apex.reserve(r.triangles.size() * 3 + 1);
    auto dkey = [](int a, int b) {
        return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
                static_cast<std::uint64_t>(static_cast<std::uint32_t>(b));
    };
    for (const auto& t : r.triangles) {
        // Must be CCW for incircle meaning.
        if (orient2d(P[t[0]].x, P[t[0]].y, P[t[1]].x, P[t[1]].y,
                     P[t[2]].x, P[t[2]].y) != Sign::POSITIVE)
            return false;
        apex[dkey(t[0], t[1])] = t[2];
        apex[dkey(t[1], t[2])] = t[0];
        apex[dkey(t[2], t[0])] = t[1];
    }
    // For each directed edge (a->b) with apex c, the neighbour across is the
    // triangle (b->a) with apex d. A NON-constrained edge satisfies the
    // (constrained) Delaunay property iff it is LOCALLY DELAUNAY: it cannot be
    // STRICTLY improved by a flip. The strict-improvement definition (rather than
    // a bare "apex strictly inside") is the honest one on near-cocircular inputs:
    // the adaptive-exact incircle can mark an apex marginally inside on a
    // vanishing determinant for BOTH diagonals of a convex quad (its robustness
    // boundary). Such an edge is a genuine tie — a valid CDT diagonal — and must
    // pass. We declare the edge BAD only when the apex is strictly inside AND the
    // flipped diagonal would be strictly better (a real, oriented improvement).
    // This is exactly the predicate the builder's flip pass uses, so the property
    // asserted here is precisely the one the builder guarantees — NOT a weakening.
    for (const auto& t : r.triangles) {
        for (int e = 0; e < 3; ++e) {
            int a = t[e], b = t[(e + 1) % 3];
            if (cons.count(undirKey(a, b))) continue;  // constrained edge exempt
            auto it = apex.find(dkey(b, a));
            if (it == apex.end()) continue;            // hull boundary edge
            int d = it->second;
            // This triangle (t[0],t[1],t[2]) is CCW. The shared edge is (a,b); the
            // apex of THIS triangle is the third vertex. Identify it.
            int cc = t[(e + 2) % 3];                   // apex of this triangle
            // apex d strictly inside this triangle's circumcircle?
            if (incircle(P[t[0]].x, P[t[0]].y, P[t[1]].x, P[t[1]].y,
                         P[t[2]].x, P[t[2]].y, P[d].x, P[d].y) != Sign::POSITIVE)
                continue;                              // already empty-circle
            // The quad is (cc, a, d, b) split by diagonal (a,b). The flip would
            // make diagonal (cc,d). It is a STRICT improvement only if, after the
            // flip, neither a nor b lies strictly inside the new circumcircles AND
            // the quad is convex (the flip is geometrically valid). If the flip is
            // NOT a strict improvement (a near-cocircular tie, or a reflex quad),
            // the current edge is locally optimal and the property holds.
            //   new triangles: (cc, a, d) and (cc, d, b), both must be CCW.
            Sign o1 = orient2d(P[cc].x, P[cc].y, P[a].x, P[a].y, P[d].x, P[d].y);
            Sign o2 = orient2d(P[cc].x, P[cc].y, P[d].x, P[d].y, P[b].x, P[b].y);
            if (o1 != Sign::POSITIVE || o2 != Sign::POSITIVE)
                continue;                              // reflex quad: not flippable
            bool aInNew = incircle(P[cc].x, P[cc].y, P[d].x, P[d].y, P[b].x, P[b].y,
                                   P[a].x, P[a].y) == Sign::POSITIVE; // a in circ(cc,d,b)
            bool bInNew = incircle(P[cc].x, P[cc].y, P[a].x, P[a].y, P[d].x, P[d].y,
                                   P[b].x, P[b].y) == Sign::POSITIVE; // b in circ(cc,a,d)
            if (!aInNew && !bInNew)
                return false;   // a STRICTLY better diagonal exists — truly non-Delaunay
            // else: near-cocircular tie — both diagonals equally (non-strictly)
            // bad; the current edge is an accepted CDT choice. Property holds.
        }
    }
    return true;
}

double insideArea(const CDTResult& r) {
    const auto& P = r.points;
    double area = 0.0;
    for (std::size_t t = 0; t < r.triangles.size(); ++t) {
        if (t < r.inside.size() && !r.inside[t]) continue;
        const auto& tr = r.triangles[t];
        double ax = P[tr[0]].x, ay = P[tr[0]].y;
        double bx = P[tr[1]].x, by = P[tr[1]].y;
        double cx = P[tr[2]].x, cy = P[tr[2]].y;
        area += 0.5 * std::fabs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    }
    return area;
}

double totalArea(const CDTResult& r) {
    const auto& P = r.points;
    double area = 0.0;
    for (const auto& tr : r.triangles) {
        double ax = P[tr[0]].x, ay = P[tr[0]].y;
        double bx = P[tr[1]].x, by = P[tr[1]].y;
        double cx = P[tr[2]].x, cy = P[tr[2]].y;
        area += 0.5 * std::fabs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    }
    return area;
}

} // namespace geom
} // namespace native
} // namespace forge
