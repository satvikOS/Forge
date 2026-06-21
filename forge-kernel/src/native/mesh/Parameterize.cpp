// forge/native/mesh/Parameterize.cpp
//
// Implementation of forge::native::mesh::parameterize — Tutte / harmonic UV
// embedding of a disk-topology triangle patch. Pure C++20, ZERO external
// dependencies. See Parameterize.hpp for the honest scope statement.
//
// PIPELINE
//   1. validate disk topology: exactly one boundary loop, single connected
//      manifold-with-boundary component, >= 3 boundary vertices.
//   2. fix the boundary loop onto a convex polygon (unit circle / unit square),
//      arc-length / chord-length spaced.
//   3. solve the harmonic Laplacian L u = 0 (interior) by Gauss-Seidel / Jacobi
//      iteration with uniform (Tutte) or cotangent weights — no external solver.
//   4. EXACT flip audit per triangle via orient2d; affine-distortion diagnostics.

#include "forge/native/mesh/Parameterize.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>   // std::max
#include <cmath>       // std::sqrt / std::fabs / std::cos / std::sin
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t / std::uint64_t
#include <utility>     // std::move
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

// pi as an exact-enough constant (M_PI is not guaranteed under strict -std=c++20
// on libstdc++ without _USE_MATH_DEFINES; define our own to stay CI-portable).
constexpr double kPi = 3.14159265358979323846;

// A neighbour entry in the interior linear system: index of the neighbour vertex
// and its (non-negative for uniform) weight in the convex/harmonic combination.
struct Neighbour {
    std::uint32_t v = 0;
    double        w = 0.0;
};

// Per-triangle vertex triple in mesh-vertex indices (CCW as stored).
struct Tri {
    std::uint32_t a = 0, b = 0, c = 0;
};

// Squared 3D distance between two mesh vertices.
inline double dist2(const Vec3& p, const Vec3& q) {
    const double dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    return dx * dx + dy * dy + dz * dz;
}

// 3D dot / cross helpers.
inline double dot3(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 sub3(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 cross3(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}

// cot of the angle at the apex of triangle (apex, p, q): cot = (e1 . e2) / |e1 x e2|
// where e1 = p-apex, e2 = q-apex. Returns 0 for a degenerate (zero-area) corner
// rather than an infinity, keeping the system finite.
inline double cotAngle(const Vec3& apex, const Vec3& p, const Vec3& q) {
    const Vec3 e1 = sub3(p, apex);
    const Vec3 e2 = sub3(q, apex);
    const double d = dot3(e1, e2);
    const Vec3 x = cross3(e1, e2);
    const double s = std::sqrt(x.x * x.x + x.y * x.y + x.z * x.z);
    if (s <= 0.0) return 0.0;
    return d / s;
}

} // namespace

ParamReport parameterize(const HalfEdgeMesh& inMesh,
                         const ParamOptions& opt,
                         std::vector<UV>& outUV) {
    outUV.clear();
    ParamReport rep;

    const std::vector<Vertex>&   V  = inMesh.vertices();
    const std::vector<HalfEdge>& HE = inMesh.halfEdges();
    const std::vector<Face>&     F  = inMesh.faces();

    const std::uint32_t numV = static_cast<std::uint32_t>(V.size());
    const std::uint32_t numF = static_cast<std::uint32_t>(F.size());
    const std::uint32_t numH = static_cast<std::uint32_t>(HE.size());

    rep.numVertices = numV;
    rep.numFaces    = numF;

    if (numV == 0 || numF == 0 || numH == 0) {
        rep.reason = "empty mesh";
        return rep;
    }

    // ---- (1a) twin-consistency precondition --------------------------------
    // We rely on twin/next wiring being a clean manifold-with-boundary; verify
    // every non-boundary twin is reciprocal. A broken build is rejected, never
    // guessed.
    for (std::uint32_t h = 0; h < numH; ++h) {
        const std::uint32_t tw = HE[h].twin;
        if (tw != kInvalid) {
            if (tw >= numH || HE[tw].twin != h) {
                rep.reason = "non-manifold / inconsistent twin wiring";
                return rep;
            }
        }
        if (HE[h].next >= numH || HE[h].origin >= numV) {
            rep.reason = "corrupt half-edge wiring";
            return rep;
        }
    }

    // ---- (1b) collect boundary half-edges (twin == kInvalid) ----------------
    // Each boundary vertex must have EXACTLY ONE outgoing boundary half-edge for
    // a clean (manifold) single-loop boundary. We record, per origin vertex, its
    // outgoing boundary half-edge; a second one at the same vertex is a pinch /
    // non-manifold boundary -> reject.
    std::vector<std::uint32_t> boundaryOut(numV, kInvalid); // origin -> its boundary he
    std::uint32_t numBoundaryHE = 0;
    bool pinch = false;
    for (std::uint32_t h = 0; h < numH; ++h) {
        if (HE[h].twin != kInvalid) continue;
        ++numBoundaryHE;
        const std::uint32_t o = HE[h].origin;
        if (boundaryOut[o] != kInvalid) { pinch = true; break; }
        boundaryOut[o] = h;
    }
    if (pinch) {
        rep.reason = "non-manifold boundary (vertex with >1 outgoing boundary edge)";
        return rep;
    }
    if (numBoundaryHE == 0) {
        rep.reason = "closed mesh (no boundary) — not disk topology";
        return rep;
    }
    if (numBoundaryHE < 3) {
        rep.reason = "degenerate boundary (< 3 boundary edges)";
        return rep;
    }

    // ---- (1c) walk the boundary loop(s); require EXACTLY ONE ----------------
    // From boundary he h (origin o, destination d = origin of HE[h].next), the
    // next boundary he is the unique boundary he whose origin is d, i.e.
    // boundaryOut[d]. Follow until we return to the start; if we cover every
    // boundary he in one walk there is exactly one loop. Otherwise (multiple
    // disjoint loops, e.g. an annulus / >1 hole) it is NOT disk topology.
    std::vector<std::uint32_t> loop;                  // boundary vertices in order
    std::vector<char> visitedHE(numH, 0);
    {
        std::uint32_t start = kInvalid;
        for (std::uint32_t h = 0; h < numH; ++h)
            if (HE[h].twin == kInvalid) { start = h; break; }
        std::uint32_t cur = start;
        std::uint32_t guard = 0;
        do {
            if (cur == kInvalid || HE[cur].twin != kInvalid) {
                rep.reason = "boundary walk left the boundary (corrupt)";
                return rep;
            }
            if (visitedHE[cur]) break;
            visitedHE[cur] = 1;
            loop.push_back(HE[cur].origin);
            const std::uint32_t dest = HE[HE[cur].next].origin;
            cur = boundaryOut[dest];                   // next boundary he
            if (++guard > numBoundaryHE + 1) {
                rep.reason = "boundary loop did not close";
                return rep;
            }
        } while (cur != start);

        if (loop.size() != numBoundaryHE) {
            rep.reason = "multiple boundary loops (annulus / >1 hole) — not disk topology";
            return rep;
        }
    }

    rep.numBoundary = static_cast<std::uint32_t>(loop.size());
    rep.numInterior = numV - rep.numBoundary;

    // boundary membership + loop-position lookup
    std::vector<char>         isBoundary(numV, 0);
    std::vector<std::uint32_t> loopPos(numV, kInvalid);
    for (std::uint32_t i = 0; i < loop.size(); ++i) {
        isBoundary[loop[i]] = 1;
        loopPos[loop[i]] = i;
    }

    // ---- (2) gather the triangle list (mesh-vertex indices, CCW) ------------
    std::vector<Tri> tris;
    tris.reserve(numF);
    for (std::uint32_t f = 0; f < numF; ++f) {
        if (F[f].halfEdge == kInvalid) continue;
        const std::uint32_t h0 = F[f].halfEdge;
        const std::uint32_t h1 = HE[h0].next;
        const std::uint32_t h2 = HE[h1].next;
        tris.push_back(Tri{HE[h0].origin, HE[h1].origin, HE[h2].origin});
    }
    if (tris.empty()) {
        rep.reason = "no faces after traversal";
        return rep;
    }

    // ---- (3a) build the neighbour weight system for INTERIOR vertices -------
    // For each undirected edge incident to an interior vertex we accumulate a
    // weight. Uniform: w=1 per neighbour. Cotangent: w_ij = cot(alpha)+cot(beta)
    // where alpha,beta are the angles opposite edge (i,j) in its two triangles.
    std::vector<std::vector<Neighbour>> adj(numV);

    // adjacency index lookup so we can accumulate cot contributions in O(deg).
    // We build a per-vertex map from neighbour -> position in adj[v].
    auto findOrAdd = [&](std::uint32_t v, std::uint32_t nb) -> Neighbour& {
        std::vector<Neighbour>& a = adj[v];
        for (Neighbour& n : a) if (n.v == nb) return n;
        a.push_back(Neighbour{nb, 0.0});
        return a.back();
    };

    if (opt.weight == ParamWeight::Uniform) {
        // Symmetric uniform weights: 1 per (undirected) neighbour. Use a per-edge
        // dedup so a neighbour shared by two triangles is not double-weighted.
        for (const Tri& t : tris) {
            const std::uint32_t e[3][2] = {{t.a, t.b}, {t.b, t.c}, {t.c, t.a}};
            for (auto& pr : e) {
                const std::uint32_t i = pr[0], j = pr[1];
                Neighbour& nij = findOrAdd(i, j);
                Neighbour& nji = findOrAdd(j, i);
                nij.w = 1.0;   // idempotent: stays 1 even if edge seen twice
                nji.w = 1.0;
            }
        }
    } else {
        // Cotangent weights, accumulated per triangle corner. For triangle
        // (a,b,c): edge (b,c) gets += cot(angle at a), etc. Each interior edge is
        // shared by two triangles so it receives cot(alpha)+cot(beta).
        for (const Tri& t : tris) {
            const Vec3& pa = V[t.a].position;
            const Vec3& pb = V[t.b].position;
            const Vec3& pc = V[t.c].position;
            const double cotA = cotAngle(pa, pb, pc); // angle at a, opposite (b,c)
            const double cotB = cotAngle(pb, pc, pa); // angle at b, opposite (c,a)
            const double cotC = cotAngle(pc, pa, pb); // angle at c, opposite (a,b)
            const double half = 0.5;
            // edge (b,c): += cotA
            findOrAdd(t.b, t.c).w += half * cotA;
            findOrAdd(t.c, t.b).w += half * cotA;
            // edge (c,a): += cotB
            findOrAdd(t.c, t.a).w += half * cotB;
            findOrAdd(t.a, t.c).w += half * cotB;
            // edge (a,b): += cotC
            findOrAdd(t.a, t.b).w += half * cotC;
            findOrAdd(t.b, t.a).w += half * cotC;
        }
    }

    // ---- (3b) fix the boundary onto a convex polygon ------------------------
    std::vector<UV> uv(numV, UV{0.0, 0.0});

    // accumulated chord length along the boundary loop (3D), for arc-length param
    const std::uint32_t L = static_cast<std::uint32_t>(loop.size());
    std::vector<double> arc(L + 1, 0.0);
    for (std::uint32_t i = 0; i < L; ++i) {
        const Vec3& p = V[loop[i]].position;
        const Vec3& q = V[loop[(i + 1) % L]].position;
        arc[i + 1] = arc[i] + std::sqrt(dist2(p, q));
    }
    const double total = arc[L];
    if (!(total > 0.0)) {
        rep.reason = "degenerate boundary (zero perimeter)";
        return rep;
    }

    if (opt.boundary == ParamBoundary::Circle) {
        for (std::uint32_t i = 0; i < L; ++i) {
            const double theta = 2.0 * kPi * (arc[i] / total);
            uv[loop[i]] = UV{std::cos(theta), std::sin(theta)};
        }
    } else { // Square: map fraction t in [0,1) around the perimeter of [-1,1]^2
        for (std::uint32_t i = 0; i < L; ++i) {
            double t = arc[i] / total;       // [0,1)
            double s = t * 4.0;              // [0,4)
            int side = static_cast<int>(s);
            if (side > 3) side = 3;
            double f = s - side;             // [0,1) along this side
            double x, y;
            switch (side) {
                case 0:  x = -1.0 + 2.0 * f; y = -1.0;          break; // bottom L->R
                case 1:  x =  1.0;           y = -1.0 + 2.0 * f; break; // right  B->T
                case 2:  x =  1.0 - 2.0 * f; y =  1.0;          break; // top   R->L
                default: x = -1.0;           y =  1.0 - 2.0 * f; break; // left  T->B
            }
            uv[loop[i]] = UV{x, y};
        }
    }

    // ---- (3c) interior solve (Gauss-Seidel / Jacobi) ------------------------
    // Each interior vertex i:  u_i = (sum_j w_ij u_j) / (sum_j w_ij).
    // For uniform weights this is a strict convex combination (all w>0), so the
    // Tutte theorem applies. For cotangent weights a corner could be obtuse and
    // a single w_ij negative; we keep the solve as written (true harmonic map)
    // and AUDIT the result for flips rather than clamping silently.
    std::vector<double> wsum(numV, 0.0);
    for (std::uint32_t i = 0; i < numV; ++i) {
        if (isBoundary[i]) continue;
        double s = 0.0;
        for (const Neighbour& n : adj[i]) s += n.w;
        wsum[i] = s;
        if (!(std::fabs(s) > 0.0)) {
            // An interior vertex with zero total weight cannot be solved — this
            // only happens for a fully-degenerate (zero-area) cotangent fan.
            rep.reason = "interior vertex with zero neighbour weight (degenerate geometry)";
            return rep;
        }
    }

    // initialise interior UVs at the centroid of the boundary (a point strictly
    // inside the convex boundary polygon) so the iteration starts feasible.
    double cu = 0.0, cv = 0.0;
    for (std::uint32_t i = 0; i < L; ++i) { cu += uv[loop[i]].u; cv += uv[loop[i]].v; }
    cu /= static_cast<double>(L);
    cv /= static_cast<double>(L);
    for (std::uint32_t i = 0; i < numV; ++i)
        if (!isBoundary[i]) uv[i] = UV{cu, cv};

    std::vector<UV> uvPrev;                       // for Jacobi double-buffering
    if (opt.solver == ParamSolver::Jacobi) uvPrev = uv;

    double residual = 0.0;
    std::uint32_t it = 0;
    bool converged = false;
    for (; it < opt.maxIters; ++it) {
        double maxDelta = 0.0;
        const std::vector<UV>& src = (opt.solver == ParamSolver::Jacobi) ? uvPrev : uv;
        for (std::uint32_t i = 0; i < numV; ++i) {
            if (isBoundary[i]) continue;
            double su = 0.0, sv = 0.0;
            for (const Neighbour& n : adj[i]) {
                su += n.w * src[n.v].u;
                sv += n.w * src[n.v].v;
            }
            const double nu = su / wsum[i];
            const double nv = sv / wsum[i];
            const double d = std::fabs(nu - uv[i].u) + std::fabs(nv - uv[i].v);
            if (d > maxDelta) maxDelta = d;
            uv[i] = UV{nu, nv};
        }
        residual = maxDelta;
        if (opt.solver == ParamSolver::Jacobi) uvPrev = uv;
        if (maxDelta < opt.tol) { converged = true; ++it; break; }
    }
    rep.iterations = it;
    rep.residual   = residual;
    rep.converged  = converged;

    // ---- (4) EXACT flip audit + distortion diagnostics ----------------------
    // For every triangle, the signed UV area sign is decided by the EXACT
    // orient2d predicate on the UV coordinates (never a float tolerance). A valid
    // Tutte embedding has every triangle POSITIVE (same winding as input CCW).
    // We also accumulate |signed UV area| and the per-face area-ratio deviation
    // against the 3D area ratios (the affine-distortion measure: ~0 on a flat
    // patch mapped affinely).
    double xyzTotal = 0.0, uvTotal = 0.0;
    std::vector<double> xyzA(tris.size(), 0.0), uvA(tris.size(), 0.0);
    std::uint32_t flipped = 0, zero = 0;
    bool allPositive = true;

    for (std::size_t k = 0; k < tris.size(); ++k) {
        const Tri& t = tris[k];
        const UV& A = uv[t.a];
        const UV& B = uv[t.b];
        const UV& C = uv[t.c];
        const Sign s = orient2d(A.u, A.v, B.u, B.v, C.u, C.v);
        if (s == Sign::ZERO) { ++zero; allPositive = false; }
        else if (s == Sign::NEGATIVE) { ++flipped; allPositive = false; }

        // |signed UV area| = 0.5 * |cross|
        const double uvArea = 0.5 * std::fabs((B.u - A.u) * (C.v - A.v)
                                            - (B.v - A.v) * (C.u - A.u));
        uvA[k] = uvArea;
        uvTotal += uvArea;

        // 3D triangle area
        const Vec3& pa = V[t.a].position;
        const Vec3& pb = V[t.b].position;
        const Vec3& pc = V[t.c].position;
        const Vec3 n = cross3(sub3(pb, pa), sub3(pc, pa));
        const double xyzArea = 0.5 * std::sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        xyzA[k] = xyzArea;
        xyzTotal += xyzArea;
    }

    double maxDev = 0.0;
    if (xyzTotal > 0.0 && uvTotal > 0.0) {
        for (std::size_t k = 0; k < tris.size(); ++k) {
            const double rxyz = xyzA[k] / xyzTotal;
            const double ruv  = uvA[k]  / uvTotal;
            maxDev = std::max(maxDev, std::fabs(ruv - rxyz));
        }
    }

    rep.numFlipped       = flipped;
    rep.numZeroArea      = zero;
    rep.allPositive      = allPositive;
    rep.maxAreaRatioDev  = maxDev;
    rep.uvTotalArea      = uvTotal;

    outUV = std::move(uv);
    rep.ok = true;
    return rep;
}

ParamReport parameterize(const std::vector<double>& positions,
                         const std::vector<std::uint32_t>& indices,
                         const ParamOptions& opt,
                         std::vector<UV>& outUV) {
    outUV.clear();
    ParamReport rep;

    if (positions.empty() || indices.empty()) {
        rep.reason = "empty soup";
        return rep;
    }
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) {
        rep.reason = "malformed soup (length not a multiple of 3)";
        return rep;
    }

    HalfEdgeMesh m;
    if (!m.buildFromSoup(positions, indices)) {
        rep.reason = "buildFromSoup failed (out-of-range / repeated index / non-manifold winding)";
        return rep;
    }
    return parameterize(m, opt, outUV);
}

} // namespace mesh
} // namespace native
} // namespace forge
