// forge/native/mesh/Subdivide.cpp
//
// Implementation of Loop subdivision for the in-house Forge native kernel.
// Pure C++20, no external dependencies. See Subdivide.hpp for the honest scope
// statement, the Loop masks, and the manifold/convex-envelope guarantees.
//
// Strategy per step:
//   * Build the HalfEdgeMesh of the input soup. This GIVES us, for free and with
//     exact combinatorics, the closed/2-manifold audit and the half-edge wiring
//     used to find each edge's two endpoints, its twin, and the two opposite
//     ("flap") vertices for the Loop edge mask.
//   * Enumerate the UNDIRECTED edges (each half-edge paired with its twin once).
//     For each, compute the Loop edge point  3/8(a+b) + 1/8(c+d).
//   * For each original vertex, gather its 1-ring and apply the Loop vertex mask
//     (1 - nβ)·v + βΣ(neighbours), reading ONLY original positions.
//   * Emit four triangles per old face, indexing originals (repositioned) and
//     edge points.
//   * Re-audit the emitted soup through HalfEdgeMesh::validate(); only then is
//     ok=true. Multiple levels just iterate this on the output soup.

#include "forge/native/mesh/Subdivide.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

constexpr double kPi = 3.14159265358979323846;

// Undirected edge key from two vertex indices (order-independent).
inline std::uint64_t undirKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = a < b ? a : b;
    std::uint32_t hi = a < b ? b : a;
    return (static_cast<std::uint64_t>(lo) << 32) | static_cast<std::uint64_t>(hi);
}

// Loop's valence-weighted vertex coefficient β(n) for an interior vertex of
// valence n (the original Loop weights — Warren's simplified 3/(8n) for n>3 is
// an alternative; we use Loop's own trigonometric form, valid and >=0 for n>=3).
//   β(n) = (1/n)·( 5/8 − (3/8 + 1/4·cos(2π/n))² )
inline double loopBeta(int n) {
    if (n <= 0) return 0.0;
    const double c = 3.0 / 8.0 + 0.25 * std::cos(2.0 * kPi / static_cast<double>(n));
    return (1.0 / static_cast<double>(n)) * (5.0 / 8.0 - c * c);
}

// One Loop step. Returns true on success and fills out the new soup; on any
// structural failure returns false (caller surfaces ok=false). Also accumulates
// the convex-combination guard stats (max |Σw−1|, min weight) so the report can
// prove every new vertex is a convex combination of originals.
bool loopStep(const std::vector<double>& inPos,
              const std::vector<std::uint32_t>& inIdx,
              bool repositionOriginals,
              std::vector<double>& outPos,
              std::vector<std::uint32_t>& outIdx,
              double& weightSumError,
              double& minWeight,
              const char*& reason) {
    HalfEdgeMesh m;
    if (!m.buildFromSoup(inPos, inIdx)) {
        reason = "input soup is not a valid 2-manifold (build failed)";
        return false;
    }
    ValidityReport vr = m.validate();
    if (!vr.watertight) {
        reason = "input mesh is not watertight (open/boundaried) — unsupported";
        return false;
    }
    if (!vr.manifold || !vr.twinsConsistent) {
        reason = "input mesh is not 2-manifold";
        return false;
    }

    const std::vector<Vertex>&   V  = m.vertices();
    const std::vector<HalfEdge>& HE = m.halfEdges();
    const std::vector<Face>&     F  = m.faces();

    const std::uint32_t nV = static_cast<std::uint32_t>(V.size());
    const std::size_t   nH = HE.size();

    if (nV == 0 || F.empty()) {
        reason = "empty mesh";
        return false;
    }

    // ── valence (1-ring degree) of each original vertex ───────────────────────
    // For a closed 2-manifold triangle mesh the number of outgoing half-edges at
    // a vertex equals its valence (the count of 1-ring neighbours).
    std::vector<int> valence(nV, 0);
    for (std::size_t h = 0; h < nH; ++h) valence[HE[h].origin] += 1;

    // ── repositioned original vertices (Loop vertex mask) ─────────────────────
    // newPos[v] = (1 − nβ)·v + β·Σ(1-ring neighbours).  We sum the 1-ring by
    // walking outgoing half-edges (twin.origin is the neighbour). Read ONLY the
    // ORIGINAL positions so all masks see the same coarse mesh.
    std::vector<double> newPos(static_cast<std::size_t>(nV) * 3, 0.0);
    for (std::uint32_t v = 0; v < nV; ++v) {
        const Vec3& p = V[v].position;
        const int n = valence[v];
        if (!repositionOriginals || n < 3) {
            // Degree < 3 cannot happen on a closed manifold (min valence 3); if
            // smoothing is disabled we simply keep the original position.
            newPos[3 * v + 0] = p.x;
            newPos[3 * v + 1] = p.y;
            newPos[3 * v + 2] = p.z;
            // self-weight 1, no neighbours → convex trivially.
            if (1.0 < minWeight) minWeight = 1.0;
            continue;
        }
        const double beta = loopBeta(n);
        // Sum the 1-ring by rotating around v: start at v's outgoing half-edge,
        // neighbour = twin.origin, advance to twin.next (next outgoing edge).
        double sx = 0.0, sy = 0.0, sz = 0.0;
        std::uint32_t start = V[v].halfEdge;
        std::uint32_t cur = start;
        int seen = 0;
        do {
            const std::uint32_t tw = HE[cur].twin;
            // closed manifold guaranteed above → tw valid.
            const Vec3& q = V[HE[tw].origin].position;
            sx += q.x; sy += q.y; sz += q.z;
            cur = HE[tw].next;
            if (++seen > n + 1) break; // guard (cannot trip on a valid fan)
        } while (cur != start);

        const double self = 1.0 - static_cast<double>(n) * beta;
        newPos[3 * v + 0] = self * p.x + beta * sx;
        newPos[3 * v + 1] = self * p.y + beta * sy;
        newPos[3 * v + 2] = self * p.z + beta * sz;

        // Convex-combination guard: weights are {self} ∪ {β × n neighbours}.
        const double wsum = self + beta * static_cast<double>(n);
        const double err = std::fabs(wsum - 1.0);
        if (err > weightSumError) weightSumError = err;
        if (self < minWeight) minWeight = self;
        if (beta < minWeight) minWeight = beta;
    }

    // ── edge points (Loop edge mask) ──────────────────────────────────────────
    // Walk every undirected edge once. The two endpoints are (origin, dest);
    // the two opposite/flap vertices are the third vertex of each incident
    // triangle: c = origin(he.prev) wait — for a CCW triangle he: a->b, the
    // third vertex is origin(he.next.next) == origin(he.prev). Likewise the twin
    // gives the second flap. Edge point = 3/8(a+b) + 1/8(c+d).
    std::unordered_map<std::uint64_t, std::uint32_t> edgePointId;
    edgePointId.reserve(nH); // upper bound; ~nH/2 undirected edges
    // New vertices appended after the originals.
    for (std::size_t h = 0; h < nH; ++h) {
        const HalfEdge& he = HE[h];
        const std::uint32_t a = he.origin;
        const std::uint32_t b = HE[he.next].origin;
        const std::uint64_t k = undirKey(a, b);
        if (edgePointId.count(k)) continue; // already created from its twin

        const std::uint32_t tw = he.twin;
        if (tw == kInvalid) { // boundary — rejected earlier, defensive.
            reason = "boundary edge encountered (open mesh) — unsupported";
            return false;
        }
        // flap c: third vertex of he's triangle = origin(he.prev)
        const std::uint32_t c = HE[he.prev].origin;
        // flap d: third vertex of twin's triangle = origin(twin.prev)
        const std::uint32_t d = HE[tw].prev != kInvalid ? HE[HE[tw].prev].origin
                                                         : kInvalid;
        if (d == kInvalid) {
            reason = "malformed twin face (no prev)";
            return false;
        }

        const Vec3& pa = V[a].position;
        const Vec3& pb = V[b].position;
        const Vec3& pc = V[c].position;
        const Vec3& pd = V[d].position;

        const double w_ab = 3.0 / 8.0; // weight on EACH endpoint
        const double w_cd = 1.0 / 8.0; // weight on EACH flap
        const double ex = w_ab * (pa.x + pb.x) + w_cd * (pc.x + pd.x);
        const double ey = w_ab * (pa.y + pb.y) + w_cd * (pc.y + pd.y);
        const double ez = w_ab * (pa.z + pb.z) + w_cd * (pc.z + pd.z);

        const std::uint32_t id = static_cast<std::uint32_t>(newPos.size() / 3);
        newPos.push_back(ex);
        newPos.push_back(ey);
        newPos.push_back(ez);
        edgePointId.emplace(k, id);

        // Convex-combination guard for the edge point.
        const double wsum = 2.0 * w_ab + 2.0 * w_cd; // = 1
        const double err = std::fabs(wsum - 1.0);
        if (err > weightSumError) weightSumError = err;
        if (w_cd < minWeight) minWeight = w_cd;
    }

    // ── retriangulate: each old face → 4 new faces ────────────────────────────
    // Old face (a,b,c) with edge points ab (on a-b), bc (on b-c), ca (on c-a):
    //   (a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)
    // This winding preserves orientation (each sub-triangle CCW like the parent).
    outIdx.clear();
    outIdx.reserve(F.size() * 4 * 3);
    for (const Face& f : F) {
        if (f.halfEdge == kInvalid) continue;
        const HalfEdge& h0 = HE[f.halfEdge];
        const HalfEdge& h1 = HE[h0.next];
        const HalfEdge& h2 = HE[h1.next];
        const std::uint32_t a = h0.origin;
        const std::uint32_t b = h1.origin;
        const std::uint32_t c = h2.origin;

        auto ep = [&](std::uint32_t u, std::uint32_t w) -> std::uint32_t {
            return edgePointId[undirKey(u, w)];
        };
        const std::uint32_t ab = ep(a, b);
        const std::uint32_t bc = ep(b, c);
        const std::uint32_t ca = ep(c, a);

        outIdx.push_back(a);  outIdx.push_back(ab); outIdx.push_back(ca);
        outIdx.push_back(b);  outIdx.push_back(bc); outIdx.push_back(ab);
        outIdx.push_back(c);  outIdx.push_back(ca); outIdx.push_back(bc);
        outIdx.push_back(ab); outIdx.push_back(bc); outIdx.push_back(ca);
    }

    outPos = std::move(newPos);
    return true;
}

} // namespace

SubdivideReport subdivideLoop(const std::vector<double>&        positions,
                              const std::vector<std::uint32_t>& indices,
                              const SubdivideOptions&           options,
                              std::vector<double>&              outPositions,
                              std::vector<std::uint32_t>&       outIndices) {
    SubdivideReport rep;
    outPositions.clear();
    outIndices.clear();

    if (options.levels < 1) {
        rep.reason = "levels < 1 (nothing to subdivide)";
        return rep;
    }
    if (positions.empty() || indices.empty()) {
        rep.reason = "empty input mesh";
        return rep;
    }
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) {
        rep.reason = "malformed soup (length not a multiple of 3)";
        return rep;
    }

    // Record input stats from a clean build (also validates the input up front).
    {
        HalfEdgeMesh m0;
        if (!m0.buildFromSoup(positions, indices)) {
            rep.reason = "input soup is not a valid 2-manifold (build failed)";
            return rep;
        }
        ValidityReport v0 = m0.validate();
        if (!v0.watertight) {
            rep.reason = "input mesh is not watertight (open/boundaried) — unsupported";
            return rep;
        }
        if (!v0.manifold || !v0.twinsConsistent) {
            rep.reason = "input mesh is not 2-manifold";
            return rep;
        }
        rep.inVertices  = v0.numVertices;
        rep.inFaces     = v0.numFaces;
        rep.volumeBefore = m0.signedVolume();
    }

    // Iterate the Loop step `levels` times, each on the previous output.
    std::vector<double>        curPos = positions;
    std::vector<std::uint32_t> curIdx = indices;
    rep.minWeight = 1.0; // start at the trivial self-weight upper sentinel

    for (int lvl = 0; lvl < options.levels; ++lvl) {
        std::vector<double>        np;
        std::vector<std::uint32_t> ni;
        const char* why = "";
        if (!loopStep(curPos, curIdx, options.repositionOriginals,
                      np, ni, rep.weightSumError, rep.minWeight, why)) {
            rep.reason = why;
            return rep;
        }
        curPos = std::move(np);
        curIdx = std::move(ni);
        rep.levels = lvl + 1;
    }

    // ── independent final audit of the result soup ────────────────────────────
    HalfEdgeMesh mOut;
    if (!mOut.buildFromSoup(curPos, curIdx)) {
        rep.reason = "result soup failed to build as a 2-manifold";
        return rep;
    }
    ValidityReport vOut = mOut.validate();

    // Count non-manifold edges directly from the soup (independent of the audit).
    std::uint32_t nonManifold = 0;
    {
        std::unordered_map<std::uint64_t, int> ec;
        ec.reserve(curIdx.size());
        for (std::size_t fi = 0; fi + 2 < curIdx.size(); fi += 3) {
            const std::uint32_t tri[3] = { curIdx[fi], curIdx[fi + 1], curIdx[fi + 2] };
            for (int k = 0; k < 3; ++k)
                ec[undirKey(tri[k], tri[(k + 1) % 3])] += 1;
        }
        for (auto& [key, c] : ec) if (c != 2) ++nonManifold;
    }

    rep.outVertices      = vOut.numVertices;
    rep.outFaces         = vOut.numFaces;
    rep.watertight       = vOut.watertight;
    rep.manifold         = vOut.manifold;
    rep.nonManifoldEdges = nonManifold;
    rep.volumeAfter      = mOut.signedVolume();

    // ok ONLY for a validated, closed, 2-manifold result with no non-manifold
    // edges. No geometry is fabricated to reach this — failure surfaces honestly.
    if (vOut.watertight && vOut.manifold && vOut.twinsConsistent && nonManifold == 0) {
        rep.ok = true;
        rep.reason = "";
        outPositions = std::move(curPos);
        outIndices   = std::move(curIdx);
    } else {
        rep.ok = false;
        if (!rep.watertight)      rep.reason = "result not watertight";
        else if (!rep.manifold)   rep.reason = "result not 2-manifold";
        else                      rep.reason = "result has non-manifold edges";
    }
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
