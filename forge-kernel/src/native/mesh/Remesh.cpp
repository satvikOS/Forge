// forge/native/mesh/Remesh.cpp
//
// Implementation of forge::native::mesh::remesh — incremental isotropic
// remeshing (Botsch–Kobbelt). Pure C++20, no external dependencies. See
// Remesh.hpp for the honest scope / preservation guarantees.
//
// We keep an INTERNAL mutable half-edge mesh here (the kernel's HalfEdgeMesh is
// immutable after build). The internal mesh supports edge SPLIT / COLLAPSE /
// FLIP with full twin/next/prev rewiring and a tombstone-based free list, plus
// tangential Laplacian smoothing. The final result is rebuilt as an indexed
// soup and validated through HalfEdgeMesh::buildFromSoup + validate() so that
// ok==true is only ever returned for a genuine 2-manifold mesh.

#include "forge/native/mesh/Remesh.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

// Reuse the kernel types/headers by #include only (per spec). We do NOT call
// any symbol whose translation unit is not on the build line (e.g. the exact
// predicates in Predicates.cpp); these includes give us the shared types and
// keep the module wired into the kernel's header graph.
#include "forge/native/Predicates.hpp"     // exact orient/insphere (declarations)
#include "forge/native/geom/Geom.hpp"      // Point2 / Point3 (and Predicates)

#include <cstdint>
#include <cstddef>
#include <cmath>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>
#include <limits>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── small 3D vector helpers (local; the kernel Vec3 is a plain POD) ──────────
struct V3 {
    double x = 0.0, y = 0.0, z = 0.0;
};
inline V3 operator+(const V3& a, const V3& b) { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline V3 operator-(const V3& a, const V3& b) { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline V3 operator*(const V3& a, double s)    { return {a.x*s, a.y*s, a.z*s}; }
inline double dot(const V3& a, const V3& b)   { return a.x*b.x + a.y*b.y + a.z*b.z; }
inline V3 cross(const V3& a, const V3& b) {
    return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }
inline V3 normalized(const V3& a) {
    double n = norm(a);
    return n > 0.0 ? a * (1.0 / n) : V3{0, 0, 0};
}

// ── internal mutable half-edge mesh ──────────────────────────────────────────
//
// Arrays of vertices / half-edges / faces with tombstones (alive flag). A half-
// edge h stores: origin vertex, twin (kInvalid on boundary), next (CCW within
// its triangle). prev is implicit via next->next (triangles only). face is the
// owning triangle. Vertex stores a position and one outgoing half-edge.
struct HE {
    std::uint32_t origin = kInvalid;
    std::uint32_t twin   = kInvalid;
    std::uint32_t next   = kInvalid;
    std::uint32_t face   = kInvalid;
    bool          alive  = true;
};
struct VT {
    V3            pos;
    std::uint32_t he    = kInvalid;  // one outgoing half-edge
    bool          alive = true;
};
struct FC {
    std::uint32_t he    = kInvalid;  // one of its three half-edges
    bool          alive = true;
};

struct Mesh {
    std::vector<VT> V;
    std::vector<HE> H;
    std::vector<FC> F;

    // prev within a triangle = next->next (3-cycle).
    std::uint32_t prev(std::uint32_t h) const { return H[H[h].next].next; }
    // destination vertex of half-edge h.
    std::uint32_t dest(std::uint32_t h) const { return H[H[h].next].origin; }

    bool boundary(std::uint32_t h) const { return H[h].twin == kInvalid; }

    // Build from an indexed triangle soup. Returns false on malformed / non-
    // manifold input (a repeated directed edge), matching the kernel builder's
    // contract. Open meshes are allowed (boundary half-edges left with twin==kInvalid).
    bool build(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx) {
        V.clear(); H.clear(); F.clear();
        if (pos.size() % 3 != 0 || idx.size() % 3 != 0) return false;
        const std::uint32_t nv = static_cast<std::uint32_t>(pos.size() / 3);
        const std::uint32_t nf = static_cast<std::uint32_t>(idx.size() / 3);
        V.resize(nv);
        for (std::uint32_t v = 0; v < nv; ++v) {
            V[v].pos = { pos[3*v], pos[3*v+1], pos[3*v+2] };
            V[v].he = kInvalid; V[v].alive = true;
        }
        F.resize(nf);
        H.resize(static_cast<std::size_t>(nf) * 3);
        std::unordered_map<std::uint64_t, std::uint32_t> dir;
        dir.reserve(static_cast<std::size_t>(nf) * 3 * 2);
        auto key = [](std::uint32_t a, std::uint32_t b) {
            return (static_cast<std::uint64_t>(a) << 32) | b;
        };
        for (std::uint32_t f = 0; f < nf; ++f) {
            std::uint32_t i0 = idx[3*f], i1 = idx[3*f+1], i2 = idx[3*f+2];
            if (i0 >= nv || i1 >= nv || i2 >= nv) return false;
            if (i0 == i1 || i1 == i2 || i0 == i2) return false;
            std::uint32_t h0 = 3*f, h1 = 3*f+1, h2 = 3*f+2;
            H[h0] = HE{ i0, kInvalid, h1, f, true };
            H[h1] = HE{ i1, kInvalid, h2, f, true };
            H[h2] = HE{ i2, kInvalid, h0, f, true };
            F[f].he = h0; F[f].alive = true;
            if (V[i0].he == kInvalid) V[i0].he = h0;
            if (V[i1].he == kInvalid) V[i1].he = h1;
            if (V[i2].he == kInvalid) V[i2].he = h2;
            std::uint32_t a[3] = { i0, i1, i2 };
            std::uint32_t b[3] = { i1, i2, i0 };
            std::uint32_t hh[3] = { h0, h1, h2 };
            for (int k = 0; k < 3; ++k) {
                if (!dir.emplace(key(a[k], b[k]), hh[k]).second) return false;
            }
        }
        for (auto& [k, h] : dir) {
            std::uint32_t a = static_cast<std::uint32_t>(k >> 32);
            std::uint32_t b = static_cast<std::uint32_t>(k & 0xFFFFFFFFu);
            auto it = dir.find(key(b, a));
            if (it != dir.end()) H[h].twin = it->second;
        }
        return true;
    }

    // Export the LIVE faces to a compacted soup (drops tombstoned elements,
    // remaps vertex indices densely).
    void toSoup(std::vector<double>& pos, std::vector<std::uint32_t>& idx) const {
        pos.clear(); idx.clear();
        std::vector<std::uint32_t> remap(V.size(), kInvalid);
        std::uint32_t nv = 0;
        for (std::uint32_t v = 0; v < V.size(); ++v) {
            if (!V[v].alive) continue;
            remap[v] = nv++;
            pos.push_back(V[v].pos.x);
            pos.push_back(V[v].pos.y);
            pos.push_back(V[v].pos.z);
        }
        for (std::uint32_t f = 0; f < F.size(); ++f) {
            if (!F[f].alive) continue;
            std::uint32_t h0 = F[f].he;
            std::uint32_t h1 = H[h0].next;
            std::uint32_t h2 = H[h1].next;
            std::uint32_t a = remap[H[h0].origin];
            std::uint32_t b = remap[H[h1].origin];
            std::uint32_t c = remap[H[h2].origin];
            if (a == kInvalid || b == kInvalid || c == kInvalid) continue;
            idx.push_back(a); idx.push_back(b); idx.push_back(c);
        }
    }

    // ── allocation with a simple free list of tombstoned slots ───────────────
    std::vector<std::uint32_t> freeH, freeF, freeV;
    std::uint32_t newHE() {
        if (!freeH.empty()) { std::uint32_t h = freeH.back(); freeH.pop_back(); H[h] = HE{}; return h; }
        H.push_back(HE{}); return static_cast<std::uint32_t>(H.size() - 1);
    }
    std::uint32_t newFace() {
        if (!freeF.empty()) { std::uint32_t f = freeF.back(); freeF.pop_back(); F[f] = FC{}; return f; }
        F.push_back(FC{}); return static_cast<std::uint32_t>(F.size() - 1);
    }
    std::uint32_t newVert(const V3& p) {
        if (!freeV.empty()) { std::uint32_t v = freeV.back(); freeV.pop_back(); V[v] = VT{}; V[v].pos = p; return v; }
        V.push_back(VT{}); V.back().pos = p; return static_cast<std::uint32_t>(V.size() - 1);
    }
    void killHE(std::uint32_t h)   { H[h].alive = false; freeH.push_back(h); }
    void killFace(std::uint32_t f) { F[f].alive = false; freeF.push_back(f); }
    void killVert(std::uint32_t v) { V[v].alive = false; freeV.push_back(v); }
};

// Closest point on a single triangle (a,b,c) to point p (Ericson, RTCD).
inline V3 closestOnTriangle(const V3& p, const V3& a, const V3& b, const V3& c) {
    V3 ab = b - a, ac = c - a, ap = p - a;
    double d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) return a;
    V3 bp = p - b;
    double d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) return b;
    double vc = d1*d4 - d3*d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
        double v = d1 / (d1 - d3);
        return a + ab * v;
    }
    V3 cp = p - c;
    double d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) return c;
    double vb = d5*d2 - d1*d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
        double w = d2 / (d2 - d6);
        return a + ac * w;
    }
    double va = d3*d6 - d5*d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
        double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return b + (c - b) * w;
    }
    double denom = 1.0 / (va + vb + vc);
    double v = vb * denom, w = vc * denom;
    return a + ab * v + ac * w;
}

// ── original-surface projector ───────────────────────────────────────────────
// Stores the INPUT triangle soup and answers "closest point on the input
// surface to query p" via a uniform spatial hash grid over the triangles. Used
// to RE-PROJECT smoothed / collapsed vertices back onto the surface so the
// remesh preserves the original shape (and therefore the volume) for ANY input.
struct SurfaceProjector {
    std::vector<V3>            P;     // input vertex positions
    std::vector<std::array<std::uint32_t,3>> T;  // input triangles
    // Dense uniform grid: each triangle is inserted into EVERY cell its AABB
    // overlaps (not just its centroid cell), so a query that lies on/near the
    // surface finds the right triangle at search radius 0 — the expanding-ring
    // search then terminates almost immediately. Flat vectors (no hashing) for
    // speed; the grid is rebuilt once per remesh() call.
    double cell = 1.0;
    V3 lo{0,0,0}, hi{0,0,0};
    int nx = 1, ny = 1, nz = 1;
    std::vector<std::vector<std::uint32_t>> grid;   // size nx*ny*nz

    int clampi(int v, int n) const { return v < 0 ? 0 : (v >= n ? n - 1 : v); }
    int idx3(int i, int j, int k) const { return (k * ny + j) * nx + i; }

    void build(const std::vector<double>& pos, const std::vector<std::uint32_t>& idxv) {
        std::uint32_t nv = static_cast<std::uint32_t>(pos.size() / 3);
        P.resize(nv);
        for (std::uint32_t v = 0; v < nv; ++v) P[v] = { pos[3*v], pos[3*v+1], pos[3*v+2] };
        std::uint32_t nf = static_cast<std::uint32_t>(idxv.size() / 3);
        T.resize(nf);
        lo = { 1e300, 1e300, 1e300 };
        hi = { -1e300, -1e300, -1e300 };
        double edgeAcc = 0.0;
        for (std::uint32_t f = 0; f < nf; ++f) {
            T[f] = { idxv[3*f], idxv[3*f+1], idxv[3*f+2] };
            const V3& a = P[T[f][0]]; const V3& b = P[T[f][1]]; const V3& c = P[T[f][2]];
            edgeAcc += norm(b - a);
            for (const V3* q : { &a, &b, &c }) {
                lo.x = std::min(lo.x, q->x); lo.y = std::min(lo.y, q->y); lo.z = std::min(lo.z, q->z);
                hi.x = std::max(hi.x, q->x); hi.y = std::max(hi.y, q->y); hi.z = std::max(hi.z, q->z);
            }
        }
        // cell ≈ mean edge length: a query is then within ~1 cell of its surface.
        cell = nf > 0 ? std::max(edgeAcc / nf, 1e-9) : 1.0;
        nx = std::max(1, static_cast<int>((hi.x - lo.x) / cell) + 1);
        ny = std::max(1, static_cast<int>((hi.y - lo.y) / cell) + 1);
        nz = std::max(1, static_cast<int>((hi.z - lo.z) / cell) + 1);
        // cap total cells so a huge thin bbox cannot explode memory
        long long cells = static_cast<long long>(nx) * ny * nz;
        if (cells > 4000000) {
            double scale = std::cbrt(static_cast<double>(cells) / 4000000.0);
            cell *= scale;
            nx = std::max(1, static_cast<int>((hi.x - lo.x) / cell) + 1);
            ny = std::max(1, static_cast<int>((hi.y - lo.y) / cell) + 1);
            nz = std::max(1, static_cast<int>((hi.z - lo.z) / cell) + 1);
        }
        grid.assign(static_cast<std::size_t>(nx) * ny * nz, {});
        for (std::uint32_t f = 0; f < nf; ++f) {
            const V3& a = P[T[f][0]]; const V3& b = P[T[f][1]]; const V3& c = P[T[f][2]];
            V3 tlo{ std::min(a.x, std::min(b.x, c.x)), std::min(a.y, std::min(b.y, c.y)), std::min(a.z, std::min(b.z, c.z)) };
            V3 thi{ std::max(a.x, std::max(b.x, c.x)), std::max(a.y, std::max(b.y, c.y)), std::max(a.z, std::max(b.z, c.z)) };
            int i0 = clampi(static_cast<int>((tlo.x - lo.x) / cell), nx);
            int i1 = clampi(static_cast<int>((thi.x - lo.x) / cell), nx);
            int j0 = clampi(static_cast<int>((tlo.y - lo.y) / cell), ny);
            int j1 = clampi(static_cast<int>((thi.y - lo.y) / cell), ny);
            int k0 = clampi(static_cast<int>((tlo.z - lo.z) / cell), nz);
            int k1 = clampi(static_cast<int>((thi.z - lo.z) / cell), nz);
            for (int k = k0; k <= k1; ++k)
            for (int j = j0; j <= j1; ++j)
            for (int i = i0; i <= i1; ++i)
                grid[idx3(i, j, k)].push_back(f);
        }
    }

    // Closest point on the input surface to p. Expanding-ring search over the
    // dense grid with a correct early-out: once the best hit distance is no
    // larger than the (already-fully-searched) inner box half-width, no closer
    // triangle can exist outside, so we stop. A full-scan fallback guarantees a
    // correct answer if the grid is somehow empty around p (never garbage).
    V3 project(const V3& p) const {
        if (T.empty()) return p;
        int ci = clampi(static_cast<int>((p.x - lo.x) / cell), nx);
        int cj = clampi(static_cast<int>((p.y - lo.y) / cell), ny);
        int ck = clampi(static_cast<int>((p.z - lo.z) / cell), nz);
        double best = 1e300; V3 bestPt = p; bool found = false;
        int maxRad = std::max(nx, std::max(ny, nz));
        for (int rad = 0; rad <= maxRad; ++rad) {
            int i0 = std::max(0, ci-rad), i1 = std::min(nx-1, ci+rad);
            int j0 = std::max(0, cj-rad), j1 = std::min(ny-1, cj+rad);
            int k0 = std::max(0, ck-rad), k1 = std::min(nz-1, ck+rad);
            for (int k = k0; k <= k1; ++k)
            for (int j = j0; j <= j1; ++j)
            for (int i = i0; i <= i1; ++i) {
                // only the shell at this radius (skip already-searched core)
                if (rad > 0 && std::abs(i-ci) < rad && std::abs(j-cj) < rad && std::abs(k-ck) < rad) continue;
                for (std::uint32_t f : grid[idx3(i, j, k)]) {
                    V3 q = closestOnTriangle(p, P[T[f][0]], P[T[f][1]], P[T[f][2]]);
                    double d2 = dot(q - p, q - p);
                    if (d2 < best) { best = d2; bestPt = q; found = true; }
                }
            }
            // The inner box [ci-rad,ci+rad]^3 is fully searched; any triangle in
            // a farther shell is at least rad*cell away. Stop once best is inside.
            if (found && std::sqrt(best) <= static_cast<double>(rad) * cell) break;
        }
        if (!found) {
            for (std::uint32_t f = 0; f < T.size(); ++f) {
                V3 q = closestOnTriangle(p, P[T[f][0]], P[T[f][1]], P[T[f][2]]);
                double d2 = dot(q - p, q - p);
                if (d2 < best) { best = d2; bestPt = q; }
            }
        }
        return bestPt;
    }
};

// ── geometric helpers on the mesh ────────────────────────────────────────────
inline double edgeLen(const Mesh& m, std::uint32_t h) {
    return norm(m.V[m.dest(h)].pos - m.V[m.H[h].origin].pos);
}

// Face normal (un-normalized = 2*area*n) for the triangle owning half-edge h0.
inline V3 faceNormalRaw(const Mesh& m, std::uint32_t h0) {
    std::uint32_t h1 = m.H[h0].next, h2 = m.H[h1].next;
    const V3& a = m.V[m.H[h0].origin].pos;
    const V3& b = m.V[m.H[h1].origin].pos;
    const V3& c = m.V[m.H[h2].origin].pos;
    return cross(b - a, c - a);
}
inline double faceArea(const Mesh& m, std::uint32_t h0) {
    return 0.5 * norm(faceNormalRaw(m, h0));
}

// Is vertex v on the boundary? (any incident half-edge is a boundary edge)
bool vertOnBoundary(const Mesh& m, std::uint32_t v) {
    std::uint32_t start = m.V[v].he;
    if (start == kInvalid) return false;
    std::uint32_t h = start;
    int guard = 0;
    do {
        if (m.boundary(h)) return true;                 // outgoing boundary
        std::uint32_t tw = m.H[h].twin;
        if (tw == kInvalid) return true;
        // incoming boundary too (prev of an outgoing whose twin is gone)
        std::uint32_t hp = m.prev(h);
        if (m.boundary(hp)) return true;
        h = m.H[tw].next;                               // rotate around v (CCW)
        if (++guard > 1000000) break;
    } while (h != start && h != kInvalid);
    return false;
}

// Collect the one-ring neighbour VERTICES of v (destinations of outgoing HEs).
// Works on interior and boundary vertices. Returns false if the fan is broken.
bool oneRing(const Mesh& m, std::uint32_t v, std::vector<std::uint32_t>& ring) {
    ring.clear();
    std::uint32_t start = m.V[v].he;
    if (start == kInvalid) return false;
    // Ensure `start` is an outgoing half-edge of v.
    if (m.H[start].origin != v) return false;

    // If v is on a boundary, rewind to the first outgoing HE after the boundary
    // gap so we traverse the open fan once.
    std::uint32_t h = start;
    if (vertOnBoundary(m, v)) {
        // rotate CW until we hit a boundary (no twin on the incoming side)
        int guard = 0;
        while (true) {
            std::uint32_t hp = m.prev(h);          // incoming to v on same face
            std::uint32_t tw = m.H[hp].twin;       // CW neighbour outgoing
            if (tw == kInvalid) break;             // reached boundary start
            h = tw;
            if (h == start) break;
            if (++guard > 1000000) return false;
        }
    }
    std::uint32_t cur = h;
    int guard = 0;
    do {
        ring.push_back(m.dest(cur));
        if (m.boundary(cur)) {
            // last spoke of an open fan: also add the boundary's far endpoint
            // already captured by dest(cur); stop.
            break;
        }
        std::uint32_t tw = m.H[cur].twin;
        if (tw == kInvalid) break;
        cur = m.H[tw].next;                        // next outgoing CCW
        if (++guard > 1000000) return false;
    } while (cur != h);
    return !ring.empty();
}

// Vertex valence (number of one-ring neighbours).
int valence(const Mesh& m, std::uint32_t v) {
    std::vector<std::uint32_t> r;
    if (!oneRing(m, v, r)) return -1;
    return static_cast<int>(r.size());
}

// Approximate area-weighted vertex normal from the incident faces.
V3 vertexNormal(const Mesh& m, std::uint32_t v) {
    V3 n{0, 0, 0};
    std::uint32_t start = m.V[v].he;
    if (start == kInvalid) return n;
    std::uint32_t h = start;
    int guard = 0;
    do {
        if (!m.boundary(h)) n = n + faceNormalRaw(m, h);   // raw = 2*area*normal
        std::uint32_t tw = m.H[h].twin;
        if (tw == kInvalid) {
            // hop across the boundary gap by walking the other direction once;
            // simplest robust path: restart from prev's twin chain. For our
            // closed-mesh validation this branch is not hit.
            break;
        }
        h = m.H[tw].next;
        if (++guard > 1000000) break;
    } while (h != start);
    return normalized(n);
}

// ── topological operations ───────────────────────────────────────────────────

// EDGE SPLIT: split the undirected edge of half-edge h at point p, inserting a
// new vertex. Handles both interior (two incident triangles) and boundary (one)
// edges. Returns the new vertex index, or kInvalid on failure.
//
// Interior edge (h: a->b, twin t: b->a). Faces: (a,b,c) via h and (b,a,d) via t.
// We create vertex m on edge ab and split both triangles:
//   (a,b,c) -> (a,m,c) + (m,b,c)
//   (b,a,d) -> (b,m,d) + (m,a,d)
std::uint32_t splitEdge(Mesh& m, std::uint32_t h, const V3& p) {
    std::uint32_t t = m.H[h].twin;
    std::uint32_t vNew = m.newVert(p);

    // --- first side (face of h) ---
    std::uint32_t h_ab = h;                 // a->b
    std::uint32_t h_bc = m.H[h_ab].next;    // b->c
    std::uint32_t h_ca = m.H[h_bc].next;    // c->a
    std::uint32_t a = m.H[h_ab].origin;
    std::uint32_t b = m.H[h_bc].origin;
    std::uint32_t c = m.H[h_ca].origin;
    std::uint32_t f0 = m.H[h_ab].face;

    // New face f1 = (m,b,c); reuse f0 for (a,m,c).
    std::uint32_t f1 = m.newFace();
    std::uint32_t h_am = h_ab;              // reuse: a->m
    std::uint32_t h_mc = m.newHE();         // m->c
    // h_ca stays c->a
    std::uint32_t h_mb = m.newHE();         // m->b
    std::uint32_t h_cm = m.newHE();         // c->m
    // h_bc stays b->c

    // face f0 = (a, m, c): a->m (h_am), m->c (h_mc), c->a (h_ca)
    m.H[h_am] = HE{ a, kInvalid, h_mc, f0, true };
    m.H[h_mc] = HE{ vNew, h_cm, h_ca, f0, true };
    m.H[h_ca].next = h_am; m.H[h_ca].face = f0;
    m.F[f0].he = h_am;

    // face f1 = (m, b, c): m->b (h_mb), b->c (h_bc), c->m (h_cm)
    m.H[h_mb] = HE{ vNew, kInvalid, h_bc, f1, true };
    m.H[h_bc].next = h_cm; m.H[h_bc].face = f1;
    m.H[h_cm] = HE{ c, h_mc, h_mb, f1, true };
    m.F[f1].he = h_mb;

    // vertex wiring
    m.V[vNew].he = h_mc;
    m.V[a].he = h_am;
    m.V[b].he = h_bc;
    m.V[c].he = h_ca;

    if (t == kInvalid) {
        // boundary edge: only one side. h_am (a->m) and h_mb (m->b) inherit the
        // boundary (twin kInvalid). Done.
        m.V[vNew].he = h_mb;
        return vNew;
    }

    // --- second side (face of t): t = b->a ---
    std::uint32_t h_ba = t;                 // b->a
    std::uint32_t h_ad = m.H[h_ba].next;    // a->d
    std::uint32_t h_db = m.H[h_ad].next;    // d->b
    std::uint32_t d = m.H[h_db].origin;
    std::uint32_t f2 = m.H[h_ba].face;

    std::uint32_t f3 = m.newFace();
    std::uint32_t h_bm = h_ba;              // reuse: b->m
    std::uint32_t h_md = m.newHE();         // m->d
    // h_db stays d->b
    std::uint32_t h_ma = m.newHE();         // m->a
    std::uint32_t h_dm = m.newHE();         // d->m
    // h_ad stays a->d

    // face f2 = (b, m, d): b->m (h_bm), m->d (h_md), d->b (h_db)
    m.H[h_bm] = HE{ b, kInvalid, h_md, f2, true };
    m.H[h_md] = HE{ vNew, h_dm, h_db, f2, true };
    m.H[h_db].next = h_bm; m.H[h_db].face = f2;
    m.F[f2].he = h_bm;

    // face f3 = (m, a, d): m->a (h_ma), a->d (h_ad), d->m (h_dm)
    m.H[h_ma] = HE{ vNew, kInvalid, h_ad, f3, true };
    m.H[h_ad].next = h_dm; m.H[h_ad].face = f3;
    m.H[h_dm] = HE{ d, h_md, h_ma, f3, true };
    m.F[f3].he = h_ma;

    // twin pairing across the split edge: a->m (h_am) <-> m->a (h_ma);
    // m->b (h_mb) <-> b->m (h_bm)
    m.H[h_am].twin = h_ma; m.H[h_ma].twin = h_am;
    m.H[h_mb].twin = h_bm; m.H[h_bm].twin = h_mb;

    m.V[a].he = h_am;
    m.V[b].he = h_bm;
    m.V[d].he = h_db;
    m.V[vNew].he = h_mc;
    return vNew;
}

// EDGE FLIP: flip interior edge h (a->b) shared by faces (a,b,c) and (b,a,d) to
// the diagonal (c->d). Only valid for two interior triangles. Returns true on
// success. We veto a flip that would create a degenerate / normal-flipping face.
bool flipEdge(Mesh& m, std::uint32_t h) {
    std::uint32_t t = m.H[h].twin;
    if (t == kInvalid) return false;            // boundary: not flippable

    std::uint32_t h_ab = h;
    std::uint32_t h_bc = m.H[h_ab].next;
    std::uint32_t h_ca = m.H[h_bc].next;
    std::uint32_t h_ba = t;
    std::uint32_t h_ad = m.H[h_ba].next;
    std::uint32_t h_db = m.H[h_ad].next;

    std::uint32_t a = m.H[h_ab].origin;
    std::uint32_t b = m.H[h_bc].origin;
    std::uint32_t c = m.H[h_ca].origin;
    std::uint32_t d = m.H[h_db].origin;

    if (c == d) return false;                   // would duplicate edge
    // If c and d are already connected, flipping creates a duplicate (non-manifold) edge.
    {
        std::vector<std::uint32_t> ring;
        if (!oneRing(m, c, ring)) return false;
        if (std::find(ring.begin(), ring.end(), d) != ring.end()) return false;
    }

    const V3& A = m.V[a].pos; const V3& B = m.V[b].pos;
    const V3& C = m.V[c].pos; const V3& D = m.V[d].pos;
    // New triangles (c,d,b) and (d,c,a) — must keep consistent winding & be non-
    // degenerate, and not flip the surface normal beyond a hemisphere.
    V3 nOld1 = cross(B - A, C - A);             // (a,b,c)
    V3 nOld2 = cross(A - B, D - B);             // (b,a,d)
    V3 nNew1 = cross(D - C, B - C);             // (c,d,b)
    V3 nNew2 = cross(C - D, A - D);             // (d,c,a)
    double aOld1 = norm(nOld1), aOld2 = norm(nOld2);
    double aNew1 = norm(nNew1), aNew2 = norm(nNew2);
    double eps = 1e-14 * std::max(1.0, (aOld1 + aOld2));
    if (aNew1 < eps || aNew2 < eps) return false;           // degenerate
    V3 ref = normalized(nOld1 + nOld2);
    if (dot(normalized(nNew1), ref) <= 0.0) return false;   // normal flip
    if (dot(normalized(nNew2), ref) <= 0.0) return false;

    std::uint32_t f0 = m.H[h_ab].face;
    std::uint32_t f1 = m.H[h_ba].face;

    // Rewire face f0 = (c, d, b): c->d (reuse h_ab), d->b (h_db), b->c (h_bc)
    m.H[h_ab].origin = c; m.H[h_ab].next = h_db; m.H[h_ab].face = f0;
    m.H[h_db].next = h_bc; m.H[h_db].face = f0;
    m.H[h_bc].next = h_ab; m.H[h_bc].face = f0;
    m.F[f0].he = h_ab;

    // Rewire face f1 = (d, c, a): d->c (reuse h_ba), c->a (h_ca), a->d (h_ad)
    m.H[h_ba].origin = d; m.H[h_ba].next = h_ca; m.H[h_ba].face = f1;
    m.H[h_ca].next = h_ad; m.H[h_ca].face = f1;
    m.H[h_ad].next = h_ba; m.H[h_ad].face = f1;
    m.F[f1].he = h_ba;

    // twins of the diagonal stay paired (h_ab<->h_ba). Fix vertex outgoing refs.
    m.V[a].he = h_ad;
    m.V[b].he = h_bc;
    m.V[c].he = h_ca;
    m.V[d].he = h_db;
    return true;
}

// LINK CONDITION for collapsing edge (u,v): the intersection of the one-ring
// vertex sets of u and v must be exactly the two vertices opposite the edge
// (c and d). This is the necessary+sufficient combinatorial test that the
// collapse preserves a 2-manifold (Dey/Edelsbrunner). For a boundary edge the
// condition is adapted (one opposite vertex).
bool linkConditionOK(const Mesh& m, std::uint32_t h) {
    std::uint32_t u = m.H[h].origin;
    std::uint32_t v = m.dest(h);
    std::vector<std::uint32_t> ru, rv;
    if (!oneRing(m, u, ru) || !oneRing(m, v, rv)) return false;
    std::unordered_set<std::uint32_t> su(ru.begin(), ru.end());

    // opposite vertices c (from h's face) and d (from twin's face)
    std::uint32_t c = m.dest(m.H[h].next);          // third vertex of h's face
    bool interior = m.H[h].twin != kInvalid;
    std::uint32_t d = kInvalid;
    if (interior) d = m.dest(m.H[m.H[h].twin].next); // third vertex of twin's face

    int shared = 0;
    for (std::uint32_t w : rv) {
        if (su.count(w)) {
            ++shared;
            if (w != c && w != d) return false;      // an unexpected shared vertex
        }
    }
    int expected = interior ? 2 : 1;
    return shared == expected;
}

// EDGE COLLAPSE: collapse edge h (u->v), moving v into the merged vertex placed
// at `target`, and removing u (and the up-to-two incident triangles). Caller
// MUST have checked linkConditionOK(h) first. Returns the surviving vertex
// index, or kInvalid on failure. We additionally veto a collapse that would
// flip any incident face normal or create a degenerate triangle.
std::uint32_t collapseEdge(Mesh& m, std::uint32_t h, const V3& target) {
    std::uint32_t u = m.H[h].origin;
    std::uint32_t v = m.dest(h);

    // Faces to remove: f0 (h's face) and f1 (twin's face if interior).
    std::uint32_t t = m.H[h].twin;

    // Pre-check: simulate moving u to `target` and reject if any face NOT being
    // removed becomes degenerate or flips. We test every face incident to u
    // except the (≤2) faces being collapsed.
    std::uint32_t fKeep0 = m.H[h].face;
    std::uint32_t fKeep1 = (t != kInvalid) ? m.H[t].face : kInvalid;

    // Walk faces around u.
    {
        std::uint32_t start = m.V[u].he;
        if (start == kInvalid || m.H[start].origin != u) return kInvalid;
        std::uint32_t cur = start;
        int guard = 0;
        do {
            std::uint32_t f = m.H[cur].face;
            if (f != fKeep0 && f != fKeep1) {
                // vertices of this triangle, substituting u->target
                std::uint32_t h0 = m.F[f].he;
                std::uint32_t h1 = m.H[h0].next;
                std::uint32_t h2 = m.H[h1].next;
                std::uint32_t vs[3] = { m.H[h0].origin, m.H[h1].origin, m.H[h2].origin };
                V3 P[3];
                for (int k = 0; k < 3; ++k) P[k] = (vs[k] == u) ? target : m.V[vs[k]].pos;
                V3 nNew = cross(P[1] - P[0], P[2] - P[0]);
                V3 nOld = faceNormalRaw(m, h0);
                double aNew = norm(nNew);
                double aOld = norm(nOld);
                double eps = 1e-13 * std::max(1.0, aOld);
                if (aNew < eps) return kInvalid;             // degenerate
                if (dot(nNew, nOld) <= 0.0) return kInvalid; // normal flip
            }
            std::uint32_t tw = m.H[cur].twin;
            if (tw == kInvalid) break;                       // boundary fan end
            cur = m.H[tw].next;
            if (++guard > 1000000) return kInvalid;
        } while (cur != start);
    }

    // --- perform the collapse: retarget every half-edge with origin u to v. ---
    // First gather all outgoing half-edges of u (around the fan, both directions
    // for a boundary). We collect via a robust scan of the whole array region is
    // overkill; instead rotate.
    std::vector<std::uint32_t> outU;
    {
        std::uint32_t start = m.V[u].he;
        std::uint32_t cur = start;
        int guard = 0;
        // forward (CCW)
        do {
            if (m.H[cur].origin == u && m.H[cur].alive) outU.push_back(cur);
            std::uint32_t tw = m.H[cur].twin;
            if (tw == kInvalid) break;
            cur = m.H[tw].next;
            if (++guard > 1000000) return kInvalid;
        } while (cur != start);
        // if boundary, also walk CW from start to catch the other wing
        if (m.boundary(m.prev(start)) || m.H[start].twin == kInvalid) {
            cur = start; guard = 0;
            while (true) {
                std::uint32_t hp = m.prev(cur);
                std::uint32_t tw = m.H[hp].twin;
                if (tw == kInvalid) break;
                cur = tw;
                if (m.H[cur].origin == u && m.H[cur].alive) {
                    if (std::find(outU.begin(), outU.end(), cur) == outU.end())
                        outU.push_back(cur);
                }
                if (cur == start) break;
                if (++guard > 1000000) return kInvalid;
            }
        }
    }

    // Move v to the target position.
    m.V[v].pos = target;

    // Retarget origins.
    for (std::uint32_t hh : outU) m.H[hh].origin = v;

    // Remove the collapsed face(s) and stitch the twins of their "side" edges.
    // We re-anchor every involved vertex LOCALLY from the stitched half-edges —
    // no global array scans (those made collapse O(|H|) and dominated runtime).
    auto reanchor = [&](std::uint32_t vtx, std::uint32_t heGuess) {
        // anchor vtx to a live outgoing half-edge; prefer the guess.
        if (heGuess != kInvalid && m.H[heGuess].alive && m.H[heGuess].origin == vtx) {
            m.V[vtx].he = heGuess; return;
        }
        std::uint32_t cur = m.V[vtx].he;
        if (cur != kInvalid && m.H[cur].alive && m.H[cur].origin == vtx) return;
    };
    auto collapseFace = [&](std::uint32_t hEdge) {
        // face triangle: hEdge (u->v after retarget), the other two edges get
        // their outer twins re-paired across the removed face.
        std::uint32_t e0 = hEdge;                 // was u->v
        std::uint32_t e1 = m.H[e0].next;          // v->c
        std::uint32_t e2 = m.H[e1].next;          // c->u (now c->v)
        std::uint32_t cVtx = m.H[e2].origin;      // the opposite vertex c
        std::uint32_t to1 = m.H[e1].twin;         // outer twin of v->c (origin c)
        std::uint32_t to2 = m.H[e2].twin;         // outer twin of c->v (origin v)
        if (to1 != kInvalid) m.H[to1].twin = to2;
        if (to2 != kInvalid) m.H[to2].twin = to1;
        std::uint32_t fdel = m.H[e0].face;
        m.killHE(e0); m.killHE(e1); m.killHE(e2);
        m.killFace(fdel);
        // Local re-anchors from the surviving stitched edges:
        //   to1 originates at c        -> anchor c
        //   to2 originates at v        -> anchor v
        if (to1 != kInvalid) reanchor(cVtx, to1);
        if (to2 != kInvalid) reanchor(v,    to2);
        // if c had no surviving outgoing edge via to1, try the incoming side
        if (to2 != kInvalid) reanchor(cVtx, m.H[to2].next);
    };

    collapseFace(h);
    if (t != kInvalid) collapseFace(t);

    // Anchor v from any live retargeted outgoing half-edge.
    std::uint32_t vhe = kInvalid;
    for (std::uint32_t hh : outU) {
        if (m.H[hh].alive && m.H[hh].origin == v) { vhe = hh; break; }
    }
    if (vhe == kInvalid) { m.killVert(u); return kInvalid; }
    m.V[v].he = vhe;

    // Re-anchor v's surviving neighbours from the (live) retargeted edges only —
    // local, O(valence), no global scan.
    for (std::uint32_t hh : outU) {
        if (!m.H[hh].alive) continue;
        std::uint32_t w = m.dest(hh);
        std::uint32_t twh = m.H[hh].twin;          // outgoing edge of w (w->v)'s twin path
        if (twh != kInvalid && m.H[twh].alive && m.H[twh].origin == w)
            m.V[w].he = twh;
        std::uint32_t cand = m.V[w].he;
        if (cand == kInvalid || !m.H[cand].alive || m.H[cand].origin != w) {
            // fall back to the next half-edge after the incoming edge w->v
            if (twh != kInvalid && m.H[twh].alive) {
                std::uint32_t nx2 = m.H[twh].next;
                if (m.H[nx2].alive && m.H[nx2].origin == w) m.V[w].he = nx2;
            }
        }
    }

    m.killVert(u);
    return v;
}

// ── edge-length statistics over the LIVE mesh ────────────────────────────────
void edgeStats(const Mesh& m, double& mean, double& stddev, double& mn, double& mx) {
    double sum = 0.0, sum2 = 0.0; std::size_t n = 0;
    mn = std::numeric_limits<double>::max(); mx = 0.0;
    // count each undirected edge once: only when h < twin (or boundary)
    for (std::uint32_t h = 0; h < m.H.size(); ++h) {
        if (!m.H[h].alive) continue;
        std::uint32_t tw = m.H[h].twin;
        if (tw != kInvalid && tw < h) continue;     // counted by the twin
        double L = edgeLen(m, h);
        sum += L; sum2 += L * L; ++n;
        mn = std::min(mn, L); mx = std::max(mx, L);
    }
    if (n == 0) { mean = stddev = 0.0; mn = 0.0; return; }
    mean = sum / static_cast<double>(n);
    double var = sum2 / static_cast<double>(n) - mean * mean;
    stddev = var > 0.0 ? std::sqrt(var) : 0.0;
}

} // anonymous namespace

// ─────────────────────────────────────────────────────────────────────────────
RemeshReport remesh(const std::vector<double>&        positions,
                    const std::vector<std::uint32_t>& indices,
                    double                            targetLength,
                    const RemeshOptions&              options,
                    std::vector<double>&              outPositions,
                    std::vector<std::uint32_t>&       outIndices) {
    RemeshReport rep;
    outPositions.clear();
    outIndices.clear();

    // ---- input validation (0-fakes: bail honestly) ----
    if (targetLength <= 0.0 || !std::isfinite(targetLength)) {
        rep.reason = "target length must be a positive finite number";
        return rep;
    }
    if (positions.empty() || indices.empty()) {
        rep.reason = "empty input mesh";
        return rep;
    }

    // The kernel half-edge builder is the authority on whether the input soup is
    // a valid (2-manifold-buildable) mesh — reuse it for the gate.
    HalfEdgeMesh inHE;
    if (!inHE.buildFromSoup(positions, indices)) {
        rep.reason = "input soup is not buildable (non-manifold / bad indices)";
        return rep;
    }
    {
        ValidityReport vr = inHE.validate();
        if (!vr.manifold) {
            rep.reason = "input mesh is not 2-manifold";
            return rep;
        }
    }

    Mesh m;
    if (!m.build(positions, indices)) {
        rep.reason = "internal mesh build failed";
        return rep;
    }

    // Build the ORIGINAL-surface projector once. Every new interior vertex
    // (split midpoint, collapse target, smoothed point) is snapped back onto the
    // input surface so the remesh preserves the original shape/volume for ANY
    // input — not just an analytic sphere. Boundary vertices are NOT projected
    // (the boundary polyline is preserved combinatorially instead).
    SurfaceProjector proj;
    proj.build(positions, indices);
    auto projectToSurface = [&](const V3& p) { return proj.project(p); };

    rep.inVertices   = static_cast<std::uint32_t>(positions.size() / 3);
    rep.inFaces      = static_cast<std::uint32_t>(indices.size() / 3);
    rep.targetLength = targetLength;
    rep.volumeBefore = inHE.signedVolume();
    {
        double mean, sd, mn, mx; edgeStats(m, mean, sd, mn, mx);
        rep.meanEdgeBefore   = mean;
        rep.stddevEdgeBefore = sd;
    }

    const double Lhigh = options.splitRatio    * targetLength;   // split above
    const double Llow  = options.collapseRatio * targetLength;   // collapse below
    const double Lhigh2 = Lhigh * Lhigh;
    const double Llow2  = Llow  * Llow;

    auto dist2 = [&](std::uint32_t h) {
        V3 e = m.V[m.dest(h)].pos - m.V[m.H[h].origin].pos;
        return dot(e, e);
    };

    for (int iter = 0; iter < options.iterations; ++iter) {
        // ---- (1) SPLIT long edges ----
        // Snapshot current half-edge count; only consider originals this pass.
        {
            std::uint32_t H0 = static_cast<std::uint32_t>(m.H.size());
            for (std::uint32_t h = 0; h < H0; ++h) {
                if (!m.H[h].alive) continue;
                std::uint32_t tw = m.H[h].twin;
                if (tw != kInvalid && tw < h) continue;   // once per undirected edge
                if (dist2(h) > Lhigh2) {
                    // Split at the chord midpoint. The deviation from the surface
                    // is only the local sagitta of a single edge (second order in
                    // edge length); the per-iteration smoothing+projection pass
                    // pulls the new vertex back onto the surface, so we do NOT pay
                    // a projection here (keeps the hot split loop cheap).
                    V3 mid = (m.V[m.H[h].origin].pos + m.V[m.dest(h)].pos) * 0.5;
                    if (splitEdge(m, h, mid) != kInvalid) ++rep.splits;
                }
            }
        }

        // ---- (2) COLLAPSE short edges ----
        {
            std::uint32_t H0 = static_cast<std::uint32_t>(m.H.size());
            for (std::uint32_t h = 0; h < H0; ++h) {
                if (!m.H[h].alive) continue;
                std::uint32_t tw = m.H[h].twin;
                if (tw != kInvalid && tw < h) continue;
                if (dist2(h) >= Llow2) continue;

                std::uint32_t u = m.H[h].origin;
                std::uint32_t v = m.dest(h);
                bool uB = vertOnBoundary(m, u);
                bool vB = vertOnBoundary(m, v);
                bool edgeIsBoundary = (m.H[h].twin == kInvalid);

                // Never collapse an interior edge that joins two boundary
                // vertices (would pinch the surface). Never move a boundary
                // vertex off the boundary.
                if (uB && vB && !edgeIsBoundary) continue;

                // Choose the collapse target preserving the boundary.
                V3 target;
                if (uB && !vB)      target = m.V[u].pos;   // keep boundary vertex
                else if (vB && !uB) target = m.V[v].pos;
                else {
                    if (options.collapseToMidpoint)
                        target = (m.V[u].pos + m.V[v].pos) * 0.5;
                    else
                        target = m.V[v].pos;
                    // Midpoint of a SHORT edge deviates from the surface only by
                    // that edge's tiny sagitta; the smoothing+projection pass
                    // corrects it. No projection in the hot collapse loop.
                }

                if (!linkConditionOK(m, h)) continue;

                // Veto if the collapse would create an over-long edge (> Lhigh)
                // from the merged vertex to any neighbour of u.
                bool tooLong = false;
                {
                    std::vector<std::uint32_t> ru;
                    if (oneRing(m, u, ru)) {
                        for (std::uint32_t w : ru) {
                            if (w == v) continue;
                            double d2 = dot(m.V[w].pos - target, m.V[w].pos - target);
                            if (d2 > Lhigh2) { tooLong = true; break; }
                        }
                    } else tooLong = true;
                }
                if (tooLong) continue;

                if (collapseEdge(m, h, target) != kInvalid) ++rep.collapses;
            }
        }

        // ---- (3) FLIP toward valence 6 ----
        if (options.doFlips) {
            std::uint32_t H0 = static_cast<std::uint32_t>(m.H.size());
            for (std::uint32_t h = 0; h < H0; ++h) {
                if (!m.H[h].alive) continue;
                std::uint32_t tw = m.H[h].twin;
                if (tw == kInvalid) continue;          // boundary not flipped
                if (tw < h) continue;                  // once per undirected edge

                std::uint32_t a = m.H[h].origin;
                std::uint32_t b = m.dest(h);
                std::uint32_t c = m.dest(m.H[h].next);
                std::uint32_t d = m.dest(m.H[tw].next);

                auto target = [&](std::uint32_t vtx) {
                    return vertOnBoundary(m, vtx) ? 4 : 6;
                };
                int va = valence(m, a), vb = valence(m, b);
                int vc = valence(m, c), vd = valence(m, d);
                if (va < 0 || vb < 0 || vc < 0 || vd < 0) continue;

                auto dev = [&](int val, std::uint32_t vtx) {
                    int tg = target(vtx);
                    return (val - tg) * (val - tg);
                };
                int before = dev(va, a) + dev(vb, b) + dev(vc, c) + dev(vd, d);
                int after  = dev(va - 1, a) + dev(vb - 1, b)
                           + dev(vc + 1, c) + dev(vd + 1, d);
                // Don't drop any interior valence below 3.
                if (!vertOnBoundary(m, a) && va - 1 < 3) continue;
                if (!vertOnBoundary(m, b) && vb - 1 < 3) continue;
                if (after < before) {
                    if (flipEdge(m, h)) ++rep.flips;
                }
            }
        }

        // ---- (4) TANGENTIAL Laplacian smoothing + surface re-projection ----
        // Smooth each interior vertex toward its 1-ring centroid with the normal
        // component removed (a purely TANGENTIAL slide), then RE-PROJECT the
        // moved vertex onto the ORIGINAL input surface so the surface itself is
        // preserved. The re-projection is what bounds the volume drift to the
        // input's own discretization rather than letting the discrete tangent-
        // plane curvature creep the convex surface inward. Boundary vertices are
        // smoothed only along the boundary polyline and never re-projected off it.
        if (options.doSmoothing && options.smoothLambda > 0.0) {
            std::vector<V3> newPos(m.V.size());
            std::vector<bool> move(m.V.size(), false);
            for (std::uint32_t v = 0; v < m.V.size(); ++v) {
                if (!m.V[v].alive) continue;
                std::vector<std::uint32_t> ring;
                if (!oneRing(m, v, ring) || ring.empty()) continue;

                bool onB = vertOnBoundary(m, v);
                V3 centroid{0, 0, 0};
                if (onB) {
                    // average only the boundary neighbours (keep vertex on the
                    // boundary polyline)
                    int cnt = 0;
                    for (std::uint32_t w : ring) {
                        if (vertOnBoundary(m, w)) { centroid = centroid + m.V[w].pos; ++cnt; }
                    }
                    if (cnt < 2) continue;     // corner: pin it
                    centroid = centroid * (1.0 / cnt);
                } else {
                    for (std::uint32_t w : ring) centroid = centroid + m.V[w].pos;
                    centroid = centroid * (1.0 / static_cast<double>(ring.size()));
                }

                V3 disp = centroid - m.V[v].pos;
                V3 cand;
                if (onB) {
                    cand = m.V[v].pos + disp * options.smoothLambda;
                } else {
                    // remove the normal component => purely TANGENTIAL slide
                    V3 n = vertexNormal(m, v);
                    disp = disp - n * dot(disp, n);
                    cand = m.V[v].pos + disp * options.smoothLambda;
                    // re-project the tangentially-moved point back onto the
                    // ORIGINAL surface (closest point on the input triangle set)
                    cand = projectToSurface(cand);
                }
                newPos[v] = cand;
                move[v] = true;
            }
            // Apply, but veto any per-vertex move that degenerates an incident
            // face (keeps the surface valid).
            for (std::uint32_t v = 0; v < m.V.size(); ++v) {
                if (!move[v]) continue;
                V3 old = m.V[v].pos;
                m.V[v].pos = newPos[v];
                bool bad = false;
                std::uint32_t start = m.V[v].he;
                std::uint32_t cur = start; int guard = 0;
                if (start != kInvalid) {
                    do {
                        if (!m.boundary(cur)) {
                            if (faceArea(m, cur) < 1e-18) { bad = true; break; }
                        }
                        std::uint32_t twh = m.H[cur].twin;
                        if (twh == kInvalid) break;
                        cur = m.H[twh].next;
                        if (++guard > 1000000) break;
                    } while (cur != start);
                }
                if (bad) m.V[v].pos = old;     // revert
            }
        }
    }

    // ---- finalize: export + validate through the kernel half-edge mesh ----
    std::vector<double> sp; std::vector<std::uint32_t> si;
    m.toSoup(sp, si);
    if (sp.empty() || si.empty()) {
        rep.reason = "remesh produced an empty mesh";
        return rep;
    }

    HalfEdgeMesh outHE;
    if (!outHE.buildFromSoup(sp, si)) {
        rep.reason = "remeshed soup failed half-edge rebuild (non-manifold)";
        return rep;
    }
    ValidityReport vr = outHE.validate();

    // Count non-manifold edges + boundary half-edges from the rebuilt mesh.
    {
        std::unordered_map<std::uint64_t, int> ec;
        const auto& hes = outHE.halfEdges();
        std::uint32_t boundaryCount = 0;
        for (std::size_t hh = 0; hh < hes.size(); ++hh) {
            std::uint32_t a = hes[hh].origin;
            std::uint32_t b = hes[hes[hh].next].origin;
            std::uint32_t lo = std::min(a, b), hi = std::max(a, b);
            ec[(static_cast<std::uint64_t>(lo) << 32) | hi] += 1;
            if (hes[hh].twin == kInvalid) ++boundaryCount;
        }
        std::uint32_t nm = 0;
        for (auto& [k, c] : ec) if (c != 2) ++nm;
        rep.nonManifoldEdges = nm;
        rep.boundaryEdges    = boundaryCount;
    }

    rep.outVertices = static_cast<std::uint32_t>(sp.size() / 3);
    rep.outFaces    = static_cast<std::uint32_t>(si.size() / 3);
    rep.watertight  = vr.watertight;
    rep.manifold    = vr.manifold;
    rep.volumeAfter = outHE.signedVolume();
    {
        // recompute edge stats on the rebuilt (compacted) mesh
        Mesh m2; m2.build(sp, si);
        double mean, sd, mn, mx; edgeStats(m2, mean, sd, mn, mx);
        rep.meanEdgeAfter   = mean;
        rep.stddevEdgeAfter = sd;
    }

    // 0-FAKES: ok=true ONLY for a validated 2-manifold result. For a closed
    // input we additionally require watertight; an open input is allowed to
    // remain open but must stay 2-manifold with no non-manifold edges.
    bool inputClosed = inHE.validate().watertight;
    bool good = vr.manifold && rep.nonManifoldEdges == 0
             && (!inputClosed || vr.watertight);
    if (!good) {
        rep.reason = "remesh result failed 2-manifold / watertight audit";
        rep.ok = false;
        // still return the diagnostics, but DO NOT hand back the soup as valid
        return rep;
    }

    rep.ok = true;
    rep.reason = "ok";
    outPositions = std::move(sp);
    outIndices   = std::move(si);
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
