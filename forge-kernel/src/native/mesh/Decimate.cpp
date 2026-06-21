// forge/native/mesh/Decimate.cpp
//
// Implementation of forge::native::mesh::decimate — Garland-Heckbert Quadric
// Error Metric edge-collapse decimation. Pure C++20, no external dependencies.
//
// See Decimate.hpp for the honest scope / robustness statement.
//
// INTERNAL REPRESENTATION
// -----------------------
// We do NOT mutate the HalfEdgeMesh in place (its builder is winding-strict and
// rebuilds twins from scratch). Instead we extract an indexed triangle soup plus
// a lightweight adjacency (per-vertex incident-triangle list and an undirected
// edge -> incident-triangle map), run all the collapses on that mutable working
// set, and finally rebuild a fresh HalfEdgeMesh via buildFromSoup (which re-runs
// the strict 2-manifold / winding audit — a free correctness backstop).
//
// This keeps every topological invariant the rest of the kernel depends on
// (consistent CCW winding, twin pairing) intact: the result is whatever
// buildFromSoup accepts, and decimate() then re-validates it before returning
// ok=true. There is no path by which an invalid mesh is returned with ok=true.

#include "forge/native/mesh/Decimate.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---------------------------------------------------------------------------
// Small linear-algebra helpers (double).
// ---------------------------------------------------------------------------
struct V3 {
    double x = 0.0, y = 0.0, z = 0.0;
};
inline V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

// A symmetric 4x4 quadric stored as its 10 unique upper-triangle entries.
// Q(v) = v^T A v where v = (x,y,z,1). Garland-Heckbert error quadric.
//   [ a  b  c  d ]
//   [ b  e  f  g ]
//   [ c  f  h  i ]
//   [ d  g  i  j ]
struct Quadric {
    double a = 0, b = 0, c = 0, d = 0,
               e = 0, f = 0, g = 0,
                   h = 0, i = 0,
                       j = 0;

    void operator+=(const Quadric& o) {
        a += o.a; b += o.b; c += o.c; d += o.d;
        e += o.e; f += o.f; g += o.g;
        h += o.h; i += o.i; j += o.j;
    }
};

// Build the fundamental quadric for a plane (nx,ny,nz,dd) with n unit.
inline Quadric planeQuadric(double nx, double ny, double nz, double dd) {
    Quadric q;
    q.a = nx * nx; q.b = nx * ny; q.c = nx * nz; q.d = nx * dd;
    q.e = ny * ny; q.f = ny * nz; q.g = ny * dd;
    q.h = nz * nz; q.i = nz * dd;
    q.j = dd * dd;
    return q;
}

// Evaluate v^T A v for v = (px,py,pz,1). Always >= 0 in exact arithmetic for a
// sum of plane quadrics; we clamp tiny negatives from rounding to 0.
inline double quadricError(const Quadric& q, double px, double py, double pz) {
    const double v = q.a * px * px + 2 * q.b * px * py + 2 * q.c * px * pz + 2 * q.d * px
                   + q.e * py * py + 2 * q.f * py * pz + 2 * q.g * py
                   + q.h * pz * pz + 2 * q.i * pz
                   + q.j;
    return v < 0.0 ? 0.0 : v;
}

// Solve A33 * x = -b for the optimal collapse position, where A33 is the upper
// 3x3 of the quadric and b = (d,g,i). Returns false if A33 is (near-)singular.
inline bool solveOptimal(const Quadric& q, double& ox, double& oy, double& oz) {
    // 3x3 matrix:
    //   [ a b c ]
    //   [ b e f ]
    //   [ c f h ]
    const double m00 = q.a, m01 = q.b, m02 = q.c;
    const double m10 = q.b, m11 = q.e, m12 = q.f;
    const double m20 = q.c, m21 = q.f, m22 = q.h;
    const double det =
        m00 * (m11 * m22 - m12 * m21)
      - m01 * (m10 * m22 - m12 * m20)
      + m02 * (m10 * m21 - m11 * m20);
    // Scale-relative singularity threshold so flat/near-flat neighbourhoods fall
    // back to the candidate-endpoint search rather than blowing up.
    const double s = std::fabs(m00) + std::fabs(m11) + std::fabs(m22) + 1e-300;
    if (std::fabs(det) <= 1e-12 * s * s * s) return false;

    const double rx = -q.d, ry = -q.g, rz = -q.i;
    const double inv = 1.0 / det;
    // Cramer's rule.
    ox = inv * ( rx * (m11 * m22 - m12 * m21)
               - m01 * (ry * m22 - m12 * rz)
               + m02 * (ry * m21 - m11 * rz) );
    oy = inv * ( m00 * (ry * m22 - m12 * rz)
               - rx * (m10 * m22 - m12 * m20)
               + m02 * (m10 * rz - ry * m20) );
    oz = inv * ( m00 * (m11 * rz - ry * m21)
               - m01 * (m10 * rz - ry * m20)
               + rx * (m10 * m21 - m11 * m20) );
    return true;
}

// Volume-preserving optimal point (Lindstrom-Turk style). Minimise the quadric
// form  x^T A33 x + 2 b·x  subject to the single linear VOLUME constraint
//   g·x = c   (g,c chosen so the local star volume is exactly preserved).
// Lagrange conditions give the 4x4 symmetric system
//   [ A33  g ] [ x      ]   [ -b ]
//   [ g^T  0 ] [ lambda ] = [  c ]
// Returns false (caller falls back) if the system is (near-)singular.
inline bool solveVolumePreserving(const Quadric& q,
                                  double gx, double gy, double gz, double c,
                                  double& ox, double& oy, double& oz) {
    const double gn = gx * gx + gy * gy + gz * gz;
    if (gn <= 1e-300) return false;  // no usable constraint direction

    // 4x4 augmented matrix M and rhs.
    double M[4][4] = {
        { q.a, q.b, q.c, gx },
        { q.b, q.e, q.f, gy },
        { q.c, q.f, q.h, gz },
        { gx,  gy,  gz,  0.0 },
    };
    double rhs[4] = { -q.d, -q.g, -q.i, c };

    // Gaussian elimination with partial pivoting on the 4x4.
    const double scale = std::fabs(q.a) + std::fabs(q.e) + std::fabs(q.h) + gn + 1e-300;
    for (int col = 0; col < 4; ++col) {
        int piv = col;
        double best = std::fabs(M[col][col]);
        for (int r = col + 1; r < 4; ++r) {
            const double v = std::fabs(M[r][col]);
            if (v > best) { best = v; piv = r; }
        }
        if (best <= 1e-13 * scale) return false;  // singular -> fall back
        if (piv != col) {
            for (int k = 0; k < 4; ++k) std::swap(M[piv][k], M[col][k]);
            std::swap(rhs[piv], rhs[col]);
        }
        for (int r = 0; r < 4; ++r) {
            if (r == col) continue;
            const double factor = M[r][col] / M[col][col];
            for (int k = col; k < 4; ++k) M[r][k] -= factor * M[col][k];
            rhs[r] -= factor * rhs[col];
        }
    }
    ox = rhs[0] / M[0][0];
    oy = rhs[1] / M[1][1];
    oz = rhs[2] / M[2][2];
    return std::isfinite(ox) && std::isfinite(oy) && std::isfinite(oz);
}

// ---------------------------------------------------------------------------
// Working mutable mesh: indexed triangle soup + incremental adjacency.
// ---------------------------------------------------------------------------
struct Tri {
    std::array<std::uint32_t, 3> v{};   // vertex indices, CCW
    bool alive = true;
};

struct Work {
    std::vector<V3> pos;                              // vertex positions
    std::vector<bool> vAlive;                         // vertex liveness
    std::vector<bool> vBoundary;                      // on a boundary loop?
    std::vector<Quadric> Q;                           // per-vertex quadric
    std::vector<Tri> tris;                            // triangles
    std::vector<std::unordered_set<std::uint32_t>> vTris;  // incident triangles per vertex
    std::size_t liveTris = 0;

    // Canonical undirected edge key.
    static std::uint64_t ekey(std::uint32_t a, std::uint32_t b) {
        if (a > b) std::swap(a, b);
        return (static_cast<std::uint64_t>(a) << 32) | b;
    }
};

// One pending collapse candidate in the priority queue (lazy-deletion style).
struct Cand {
    double cost;
    std::uint32_t u, v;       // collapse v INTO u (u survives)
    double tx, ty, tz;        // target position
    std::uint64_t stampU, stampV;  // version stamps for staleness detection
};
struct CandCmp {
    bool operator()(const Cand& a, const Cand& b) const { return a.cost > b.cost; }
};

// Triangle normal (unnormalised) and area helpers on the working set.
inline V3 triNormalRaw(const Work& w, const Tri& t) {
    const V3& a = w.pos[t.v[0]];
    const V3& b = w.pos[t.v[1]];
    const V3& c = w.pos[t.v[2]];
    return cross(sub(b, a), sub(c, a));
}

} // namespace

// ---------------------------------------------------------------------------
// Core driver.
// ---------------------------------------------------------------------------
DecimateReport decimate(const HalfEdgeMesh& in, HalfEdgeMesh& out,
                        const DecimateOptions& opt) {
    DecimateReport rep;

    // -- precondition: input must be a CLOSED 2-manifold ----------------------
    // This increment is closed-only (HalfEdgeMesh::validate() certifies the
    // `manifold` flag for watertight meshes only — a boundary edge has a single
    // incident face). Refuse anything else honestly rather than return a result
    // we cannot validate. `freezeBoundary` is reserved for a future open-mesh
    // increment and intentionally does not relax this.
    (void)opt.freezeBoundary;
    ValidityReport vin = in.validate();
    if (!vin.isValid()) {
        rep.reason = "input is not a closed 2-manifold (decimate is closed-only this increment)";
        return rep;
    }
    const bool closed = true;

    // -- extract soup ---------------------------------------------------------
    std::vector<double> P;
    std::vector<std::uint32_t> I;
    in.toSoup(P, I);
    const std::size_t numV = P.size() / 3;
    const std::size_t numT = I.size() / 3;
    rep.inputTriangles = numT;
    if (closed) rep.inputVolume = in.signedVolume();

    if (numT == 0 || numV < 3) {
        rep.reason = "empty / sub-triangular input";
        return rep;
    }
    // -- target sanity --------------------------------------------------------
    const std::size_t target = opt.targetTriangles;
    if (target == 0 || target >= numT) {
        rep.reason = "target must be in (0, inputTriangles): nothing to do";
        return rep;
    }

    // -- build working set ----------------------------------------------------
    Work w;
    w.pos.resize(numV);
    for (std::size_t i = 0; i < numV; ++i)
        w.pos[i] = V3{P[3 * i + 0], P[3 * i + 1], P[3 * i + 2]};
    w.vAlive.assign(numV, true);
    w.vBoundary.assign(numV, false);
    w.Q.assign(numV, Quadric{});
    w.vTris.assign(numV, {});
    w.tris.reserve(numT);

    for (std::size_t t = 0; t < numT; ++t) {
        Tri tt;
        tt.v = {I[3 * t + 0], I[3 * t + 1], I[3 * t + 2]};
        const std::uint32_t id = static_cast<std::uint32_t>(w.tris.size());
        w.tris.push_back(tt);
        for (int k = 0; k < 3; ++k) w.vTris[tt.v[k]].insert(id);
    }
    w.liveTris = numT;

    // -- per-vertex quadrics from incident face planes ------------------------
    for (const Tri& t : w.tris) {
        const V3& a = w.pos[t.v[0]];
        V3 n = triNormalRaw(w, t);
        const double len = norm(n);
        if (len <= 0.0) {
            rep.reason = "input contains a zero-area (degenerate) triangle";
            return rep;
        }
        n.x /= len; n.y /= len; n.z /= len;
        const double dd = -dot(n, a);
        const Quadric q = planeQuadric(n.x, n.y, n.z, dd);
        for (int k = 0; k < 3; ++k) w.Q[t.v[k]] += q;
    }

    // -- mark boundary vertices (edges with only one incident triangle) -------
    {
        std::unordered_map<std::uint64_t, int> edgeCount;
        edgeCount.reserve(numT * 3);
        for (const Tri& t : w.tris) {
            for (int k = 0; k < 3; ++k) {
                const std::uint32_t a = t.v[k];
                const std::uint32_t b = t.v[(k + 1) % 3];
                edgeCount[Work::ekey(a, b)] += 1;
            }
        }
        for (const auto& [key, c] : edgeCount) {
            if (c == 1) {
                w.vBoundary[static_cast<std::uint32_t>(key >> 32)] = true;
                w.vBoundary[static_cast<std::uint32_t>(key & 0xFFFFFFFFu)] = true;
            }
        }
    }

    // Version stamps: bump a vertex's stamp whenever its quadric/position/
    // adjacency changes so stale queue entries can be detected and skipped.
    std::vector<std::uint64_t> stamp(numV, 0);

    // Triangles incident to BOTH u and v (the edge's two side triangles in a
    // manifold; one for a boundary edge). These vanish on collapse.
    auto sharedTris = [&](std::uint32_t u, std::uint32_t v,
                          std::vector<std::uint32_t>& shared) {
        shared.clear();
        const auto& su = w.vTris[u];
        const auto& sv = w.vTris[v];
        const auto& small = su.size() <= sv.size() ? su : sv;
        const auto& big   = su.size() <= sv.size() ? sv : su;
        for (std::uint32_t tid : small)
            if (big.count(tid)) shared.push_back(tid);
    };

    // Neighbour-vertex set of a vertex (one ring, excluding itself).
    auto oneRing = [&](std::uint32_t u, std::unordered_set<std::uint32_t>& ring) {
        ring.clear();
        for (std::uint32_t tid : w.vTris[u]) {
            const Tri& t = w.tris[tid];
            for (int k = 0; k < 3; ++k)
                if (t.v[k] != u) ring.insert(t.v[k]);
        }
    };

    // ----- collapse validity gate -------------------------------------------
    // Returns true if collapsing v INTO u, moving u to (tx,ty,tz), is legal.
    auto collapseValid = [&](std::uint32_t u, std::uint32_t v,
                             double tx, double ty, double tz) -> bool {
        if (u == v) return false;
        if (!w.vAlive[u] || !w.vAlive[v]) return false;

        // Boundary policy: with freezeBoundary, never touch a boundary vertex.
        if (opt.freezeBoundary && (w.vBoundary[u] || w.vBoundary[v])) return false;

        std::vector<std::uint32_t> shared;
        sharedTris(u, v, shared);
        // A 2-manifold interior edge shares EXACTLY two triangles; a boundary
        // edge shares one. Anything else (0 or >2) means (u,v) is not a single
        // manifold edge — refuse (would create non-manifold topology).
        if (shared.empty() || shared.size() > 2) return false;

        // ---- LINK CONDITION (Dey et al.): an edge collapse preserves the mesh
        // homeomorphism type iff  lk(u) ∩ lk(v) == lk(edge uv).  For a triangle
        // mesh this reduces to: the common neighbours of u and v are EXACTLY the
        // apex vertices of the shared triangles. Any other common neighbour would
        // become a non-manifold (pinched) vertex after the merge.
        std::unordered_set<std::uint32_t> ru, rv;
        oneRing(u, ru);
        oneRing(v, rv);
        // apex set = third vertex of each shared triangle.
        std::unordered_set<std::uint32_t> apex;
        for (std::uint32_t tid : shared) {
            const Tri& t = w.tris[tid];
            for (int k = 0; k < 3; ++k)
                if (t.v[k] != u && t.v[k] != v) apex.insert(t.v[k]);
        }
        for (std::uint32_t x : ru) {
            if (x == v) continue;
            if (rv.count(x) && !apex.count(x)) return false;  // illegal common nbr
        }

        // A boundary edge (single shared tri) collapsing two boundary vertices
        // that are NOT adjacent along the boundary would merge/pinch boundary
        // loops. With freezeBoundary we already returned above; this is a belt-
        // and-braces guard for closed meshes (shared.size()==2 there).
        if (shared.size() == 1) {
            // open-mesh interior-of-boundary collapse: refuse under freeze policy
            // (we never reach here when freezeBoundary touched a boundary vertex,
            // but a non-boundary u with a boundary edge to v is still risky).
            return false;
        }

        // ---- NORMAL-FLIP / ZERO-AREA gate on surviving triangles -----------
        // Every triangle incident to u or v that is NOT one of the shared
        // (vanishing) triangles must keep its orientation (normal does not flip
        // past ~90 deg) and must not collapse to zero area, once u/v are mapped
        // to the target position.
        const V3 newp{tx, ty, tz};
        auto survivesOk = [&](std::uint32_t pivot) -> bool {
            for (std::uint32_t tid : w.vTris[pivot]) {
                if (tid == shared[0] || (shared.size() == 2 && tid == shared[1]))
                    continue;
                const Tri& t = w.tris[tid];
                // map u and v to newp (v's incident tris will be reassigned to u)
                std::array<V3, 3> pp;
                for (int k = 0; k < 3; ++k) {
                    std::uint32_t vid = t.v[k];
                    pp[k] = (vid == u || vid == v) ? newp : w.pos[vid];
                }
                const V3 before = triNormalRaw(w, t);
                const V3 after  = cross(sub(pp[1], pp[0]), sub(pp[2], pp[0]));
                const double aArea = norm(after);
                if (aArea <= 1e-18) return false;             // degenerate
                // orientation preserved: normals point the same way.
                if (dot(before, after) <= 0.0) return false;  // flipped (>=90deg)
            }
            return true;
        };
        if (!survivesOk(u)) return false;
        if (!survivesOk(v)) return false;

        return true;
    };

    // Choose the best collapse target + cost for edge (a,b). u survives.
    // We always collapse the HIGHER-index vertex into the lower to keep the
    // mapping deterministic, but evaluate the optimal point either way.
    auto evalEdge = [&](std::uint32_t a, std::uint32_t b, Cand& out) -> bool {
        if (!w.vAlive[a] || !w.vAlive[b]) return false;
        const std::uint32_t u = std::min(a, b);
        const std::uint32_t v = std::max(a, b);

        Quadric q = w.Q[u];
        q += w.Q[v];

        const bool frozen = opt.freezeBoundary && (w.vBoundary[u] || w.vBoundary[v]);

        struct Pt { double x, y, z; };

        // --- candidate target positions, in PREFERENCE order on ties ----------
        // 1) volume-preserving point (Lindstrom-Turk) — kills the systematic
        //    inward shrink a pure-QEM collapse causes on convex regions,
        // 2) QEM-optimal point (pure error minimiser),
        // 3) edge midpoint, 4) endpoint u, 5) endpoint v.
        std::array<Pt, 5> cands;
        int nc = 0;
        int volIdx = -1;   // index of the volume-preserving candidate (if any)

        if (!frozen) {
            // VOLUME-PRESERVING point. Every surviving star triangle has exactly
            // ONE moved vertex (the shared triangles vanish on collapse), so the
            // local star volume is linear in the new position x:
            //   V(x) = (1/6) g·x + const,   g = sum over surviving star tris of
            //   (p × q)  for the tri written CCW as (movedVertex, p, q).
            // Preserving it (V(x) == V_orig) is the plane constraint  g·x = v6orig
            // (the 1/6 cancels). We minimise the quadric subject to that plane.
            // g  = sum over SURVIVING star tris of (p × q)  (linear coeff in x)
            // v6 = 6 * ORIGINAL volume of the WHOLE star — the surviving tris AND
            //      the SHARED tris that VANISH on collapse. The shared tris no
            //      longer depend on x but their original volume must be matched by
            //      the new surviving tris, so requiring V_new(x) == V_old means
            //      g·x == v6 with v6 including the shared-tri term. (Omitting the
            //      shared term was the bug that turned volume preservation into a
            //      ~10x-worse over-shoot — see decimate_test.cpp single-collapse
            //      verification.)
            double gvx = 0, gvy = 0, gvz = 0, v6orig = 0;
            std::vector<std::uint32_t> shTmp;
            sharedTris(u, v, shTmp);
            auto accum = [&](std::uint32_t pivot) {
                for (std::uint32_t tid : w.vTris[pivot]) {
                    bool isShared = false;
                    for (std::uint32_t s : shTmp) if (s == tid) { isShared = true; break; }
                    if (isShared) continue;
                    const Tri& t = w.tris[tid];
                    int mk = 0;
                    for (int k = 0; k < 3; ++k) if (t.v[k] == pivot) { mk = k; break; }
                    const V3& p  = w.pos[t.v[(mk + 1) % 3]];
                    const V3& qq = w.pos[t.v[(mk + 2) % 3]];
                    const V3 pc = cross(p, qq);
                    gvx += pc.x; gvy += pc.y; gvz += pc.z;
                    v6orig += dot(w.pos[pivot], pc);
                }
            };
            accum(u);
            accum(v);
            for (std::uint32_t tid : shTmp) {
                const Tri& t = w.tris[tid];
                v6orig += dot(w.pos[t.v[0]], cross(w.pos[t.v[1]], w.pos[t.v[2]]));
            }
            double vtx, vty, vtz;
            if (solveVolumePreserving(q, gvx, gvy, gvz, v6orig, vtx, vty, vtz)) {
                volIdx = nc;
                cands[nc++] = {vtx, vty, vtz};
            }
            // QEM-optimal point.
            double ox, oy, oz;
            if (solveOptimal(q, ox, oy, oz)) cands[nc++] = {ox, oy, oz};
        }
        const V3& pu = w.pos[u];
        const V3& pv = w.pos[v];
        cands[nc++] = {0.5 * (pu.x + pv.x), 0.5 * (pu.y + pv.y), 0.5 * (pu.z + pv.z)};
        cands[nc++] = {pu.x, pu.y, pu.z};
        cands[nc++] = {pv.x, pv.y, pv.z};

        // The QUEUE COST is the true minimum QEM error over valid candidates (so
        // edge ordering is the proper Garland-Heckbert metric). The TARGET POSITION
        // is the volume-preserving point WHEN it is valid and its QEM error is within
        // a small factor of the minimum (so we never trade real shape error for
        // volume); otherwise it is the min-error valid candidate.
        double minCost = std::numeric_limits<double>::infinity();
        int minIdx = -1;
        std::array<double, 5> err{};
        std::array<bool, 5>   ok{};
        for (int i = 0; i < nc; ++i) {
            err[i] = quadricError(q, cands[i].x, cands[i].y, cands[i].z);
            // We standardise on "collapse v INTO u" (u survives). The gate's
            // manifold/flip checks are symmetric in (u,v) because BOTH endpoints
            // move to the same target, so a single authoritative call suffices.
            ok[i] = collapseValid(u, v, cands[i].x, cands[i].y, cands[i].z);
            if (ok[i] && err[i] < minCost) { minCost = err[i]; minIdx = i; }
        }
        if (minIdx < 0) return false;

        // PLACEMENT POLICY (Lindstrom-Turk philosophy): the QEM cost decides WHICH
        // edge to collapse (shape priority — see out.cost below), but the merged
        // vertex is PLACED at the volume-preserving point whenever that point is a
        // legal collapse and stays local (the reach bound). This separates the two
        // concerns: order by shape error, place to conserve volume. We deliberately
        // do NOT gate the placement on a QEM-error slack — on a curved surface the
        // volume point legitimately carries a LARGER QEM error than the pure optimum
        // (it must leave the locally-best tangent plane to keep volume), so a slack
        // gate would reject it exactly when it matters and reintroduce the
        // systematic inward shrink. The reach bound (placement may not stray past
        // ~1.5 edge-lengths from the collapsing edge) keeps a coarse-mesh volume
        // point from over-shooting, and the normal-flip / zero-area gate inside
        // collapseValid already guarantees the placement never folds the surface.
        int chosen = minIdx;
        if (volIdx >= 0 && ok[volIdx]) {
            const Pt& vp = cands[volIdx];
            const V3 vpv{vp.x, vp.y, vp.z};
            const double elen = norm(sub(pv, pu));
            const double reach = std::max(norm(sub(vpv, pu)), norm(sub(vpv, pv)));
            if (reach <= 1.5 * elen + 1e-15) chosen = volIdx;
        }

        out.cost = minCost;       // order edges by the true QEM minimum
        out.u = u;
        out.v = v;
        out.tx = cands[chosen].x; // but collapse to the (volume-preserving) point
        out.ty = cands[chosen].y;
        out.tz = cands[chosen].z;
        out.stampU = stamp[u];
        out.stampV = stamp[v];
        return true;
    };

    // ----- seed the priority queue ------------------------------------------
    std::priority_queue<Cand, std::vector<Cand>, CandCmp> pq;
    {
        std::unordered_set<std::uint64_t> seen;
        seen.reserve(numT * 3);
        for (const Tri& t : w.tris) {
            for (int k = 0; k < 3; ++k) {
                const std::uint32_t a = t.v[k];
                const std::uint32_t b = t.v[(k + 1) % 3];
                const std::uint64_t key = Work::ekey(a, b);
                if (!seen.insert(key).second) continue;
                Cand cnd;
                if (evalEdge(a, b, cnd)) pq.push(cnd);
            }
        }
    }

    // ----- perform the actual collapse on the working set -------------------
    // Collapse v into u: move u to target, reassign v's triangles to u, drop the
    // shared triangles, retire v. Then refresh u's quadric and re-cost its ring.
    auto doCollapse = [&](const Cand& c) {
        const std::uint32_t u = c.u, v = c.v;

        std::vector<std::uint32_t> shared;
        sharedTris(u, v, shared);

        // move u
        w.pos[u] = V3{c.tx, c.ty, c.tz};
        // merge quadric
        w.Q[u] += w.Q[v];

        // retire shared triangles
        for (std::uint32_t tid : shared) {
            Tri& t = w.tris[tid];
            if (!t.alive) continue;
            t.alive = false;
            for (int k = 0; k < 3; ++k) w.vTris[t.v[k]].erase(tid);
            --w.liveTris;
        }

        // reassign v's remaining triangles to u
        std::vector<std::uint32_t> vt(w.vTris[v].begin(), w.vTris[v].end());
        for (std::uint32_t tid : vt) {
            Tri& t = w.tris[tid];
            if (!t.alive) continue;
            for (int k = 0; k < 3; ++k)
                if (t.v[k] == v) t.v[k] = u;
            w.vTris[u].insert(tid);
        }
        w.vTris[v].clear();
        w.vAlive[v] = false;

        // bump stamps for u and its whole one ring (their costs are now stale)
        ++stamp[u];
        std::unordered_set<std::uint32_t> ring;
        oneRing(u, ring);
        for (std::uint32_t x : ring) ++stamp[x];
        ++stamp[v];

        // re-cost edges from u to each ring neighbour
        for (std::uint32_t x : ring) {
            Cand cnd;
            if (evalEdge(u, x, cnd)) pq.push(cnd);
        }
        ++rep.collapses;
    };

    // ----- main loop ---------------------------------------------------------
    while (w.liveTris > target && !pq.empty()) {
        Cand c = pq.top();
        pq.pop();
        // staleness check
        if (!w.vAlive[c.u] || !w.vAlive[c.v]) continue;
        if (c.stampU != stamp[c.u] || c.stampV != stamp[c.v]) continue;
        // re-validate at pop time (positions/topology may have shifted)
        if (!collapseValid(c.u, c.v, c.tx, c.ty, c.tz)) continue;
        doCollapse(c);
    }

    // ----- compact + rebuild -------------------------------------------------
    std::vector<std::uint32_t> remap(numV, kInvalid);
    std::vector<double> outP;
    outP.reserve(numV * 3);
    std::uint32_t next = 0;
    for (std::size_t i = 0; i < numV; ++i) {
        if (!w.vAlive[i]) continue;
        // only keep vertices that still belong to a live triangle
        if (w.vTris[i].empty()) continue;
        remap[i] = next++;
        outP.push_back(w.pos[i].x);
        outP.push_back(w.pos[i].y);
        outP.push_back(w.pos[i].z);
    }
    std::vector<std::uint32_t> outI;
    outI.reserve(w.liveTris * 3);
    for (const Tri& t : w.tris) {
        if (!t.alive) continue;
        const std::uint32_t a = remap[t.v[0]];
        const std::uint32_t b = remap[t.v[1]];
        const std::uint32_t cc = remap[t.v[2]];
        if (a == kInvalid || b == kInvalid || cc == kInvalid) {
            rep.reason = "internal error: live triangle referenced a retired vertex";
            return rep;
        }
        if (a == b || b == cc || a == cc) {
            rep.reason = "internal error: collapse produced a degenerate triangle";
            return rep;
        }
        outI.push_back(a);
        outI.push_back(b);
        outI.push_back(cc);
    }

    HalfEdgeMesh result;
    if (!result.buildFromSoup(outP, outI)) {
        rep.reason = "decimated soup failed the strict 2-manifold rebuild (not a fake: refused)";
        return rep;
    }
    ValidityReport vr = result.validate();
    // Input was a closed 2-manifold, so the output MUST be too. This is the
    // unconditional 0-FAKES backstop: we never return ok=true on a mesh that does
    // not pass validate().isValid().
    if (!vr.isValid()) {
        rep.reason = "decimated mesh is not a closed 2-manifold (refused — no fake)";
        return rep;
    }

    out = std::move(result);
    rep.ok = true;
    rep.outputTriangles = outI.size() / 3;
    rep.outputVolume = out.signedVolume();
    (void)closed;
    return rep;
}

DecimateReport decimate(const HalfEdgeMesh& in, HalfEdgeMesh& out,
                        std::size_t targetTriangles) {
    DecimateOptions opt;
    opt.targetTriangles = targetTriangles;
    opt.freezeBoundary = true;
    return decimate(in, out, opt);
}

} // namespace mesh
} // namespace native
} // namespace forge
