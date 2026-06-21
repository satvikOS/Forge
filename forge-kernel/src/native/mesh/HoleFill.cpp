// forge/native/mesh/HoleFill.cpp
//
// Implementation of forge::native::mesh::fillHoles — see HoleFill.hpp for the
// honest scope statement. Pure C++20, standard library + the named native
// headers only (Predicates / Geom / HalfEdgeMesh). No external deps.

#include <algorithm>
#include "forge/native/mesh/HoleFill.hpp"

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

// ---- small vector helpers (local; do not pollute the public surface) --------
struct V3 { double x, y, z; };

inline V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

// Pack a directed edge (a,b) into a 64-bit key.
inline std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// 2D point in the loop's best-fit plane, tagged with its source vertex id so the
// orient2d ear tests act on the same numbers we hand back to the soup.
struct P2 { double x, y; std::uint32_t id; };

// Triangulate a (already correctly-wound) polygon loop given as a list of P2 by
// classic ear clipping, using the EXACT orient2d predicate for both the
// convexity test and the point-in-triangle containment test. The polygon must be
// wound counter-clockwise (positive signed area) in the (x,y) plane on entry; we
// guarantee that at the call site. Emits triangles as triples of vertex ids into
// `tris` (flat, 3 ids per triangle). Returns false if the polygon is degenerate
// (cannot be reduced — e.g. collinear / self-touching beyond what ear clipping
// can resolve). Adds no new vertices.
bool earClip(const std::vector<P2>& poly, std::vector<std::uint32_t>& tris) {
    const std::size_t n = poly.size();
    if (n < 3) return false;
    if (n == 3) {
        tris.push_back(poly[0].id);
        tris.push_back(poly[1].id);
        tris.push_back(poly[2].id);
        return true;
    }

    // Working index list around the polygon.
    std::vector<std::size_t> idx(n);
    for (std::size_t i = 0; i < n; ++i) idx[i] = i;

    auto isConvex = [&](std::size_t ia, std::size_t ib, std::size_t ic) {
        const P2& a = poly[ia]; const P2& b = poly[ib]; const P2& c = poly[ic];
        // CCW polygon -> a convex (left-turn) ear has orient2d(a,b,c) POSITIVE.
        return orient2d(a.x, a.y, b.x, b.y, c.x, c.y) == Sign::POSITIVE;
    };
    // p strictly/loosely inside triangle (a,b,c) given CCW: all three orient2d
    // signs are non-negative (on an edge counts as inside, so we never clip an
    // ear that would swallow a touching reflex vertex).
    auto inTri = [&](std::size_t ia, std::size_t ib, std::size_t ic, std::size_t ip) {
        const P2& a = poly[ia]; const P2& b = poly[ib];
        const P2& c = poly[ic]; const P2& p = poly[ip];
        Sign s0 = orient2d(a.x, a.y, b.x, b.y, p.x, p.y);
        Sign s1 = orient2d(b.x, b.y, c.x, c.y, p.x, p.y);
        Sign s2 = orient2d(c.x, c.y, a.x, a.y, p.x, p.y);
        bool neg = (s0 == Sign::NEGATIVE) || (s1 == Sign::NEGATIVE) || (s2 == Sign::NEGATIVE);
        return !neg;  // no strictly-negative => p is inside or on the boundary
    };

    std::size_t guard = 0;
    const std::size_t guardMax = n * n + 16;  // generous; a clean polygon needs ~n
    while (idx.size() > 3) {
        if (++guard > guardMax) return false;  // could not make progress -> honest fail
        const std::size_t m = idx.size();
        bool clipped = false;
        for (std::size_t i = 0; i < m; ++i) {
            const std::size_t ia = idx[(i + m - 1) % m];
            const std::size_t ib = idx[i];
            const std::size_t ic = idx[(i + 1) % m];
            if (!isConvex(ia, ib, ic)) continue;  // reflex or collinear -> not an ear
            // No other polygon vertex may lie inside the candidate ear triangle.
            bool empty = true;
            for (std::size_t j = 0; j < m; ++j) {
                const std::size_t ip = idx[j];
                if (ip == ia || ip == ib || ip == ic) continue;
                if (inTri(ia, ib, ic, ip)) { empty = false; break; }
            }
            if (!empty) continue;
            tris.push_back(poly[ia].id);
            tris.push_back(poly[ib].id);
            tris.push_back(poly[ic].id);
            idx.erase(idx.begin() + static_cast<std::ptrdiff_t>(i));
            clipped = true;
            break;
        }
        if (!clipped) return false;  // no ear found this sweep -> degenerate input
    }
    // final triangle
    tris.push_back(poly[idx[0]].id);
    tris.push_back(poly[idx[1]].id);
    tris.push_back(poly[idx[2]].id);
    return true;
}

} // namespace

// =============================================================================
// fillHoles (half-edge overload)
// =============================================================================
HoleFillReport fillHoles(const HalfEdgeMesh& inMesh,
                         const HoleFillOptions& opt,
                         HalfEdgeMesh& outMesh) {
    HoleFillReport rep;
    outMesh = HalfEdgeMesh{};

    // Export the input to a soup we can audit + augment.
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    inMesh.toSoup(pos, idx);

    if (pos.empty() || idx.empty()) { rep.reason = "empty mesh"; return rep; }
    if (pos.size() % 3 != 0 || idx.size() % 3 != 0) { rep.reason = "malformed soup"; return rep; }

    // Re-build to confirm the input is a clean (manifold) build; buildFromSoup
    // fails on a repeated directed edge / bad index, which is exactly the
    // non-manifold case we must reject honestly.
    HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) { rep.reason = "input is not a valid manifold build"; return rep; }

    const std::uint32_t numV = static_cast<std::uint32_t>(pos.size() / 3);
    auto P = [&](std::uint32_t v) -> V3 { return {pos[3*v], pos[3*v+1], pos[3*v+2]}; };

    // ---- collect boundary directed edges -------------------------------------
    // A directed edge a->b present in some face is a boundary half-edge iff the
    // reverse b->a is NOT present in any face. We rebuild the directed set from
    // the soup (cheap, and independent of the half-edge twin wiring).
    std::unordered_set<std::uint64_t> directed;
    directed.reserve(idx.size());
    const std::uint32_t numF = static_cast<std::uint32_t>(idx.size() / 3);
    for (std::uint32_t f = 0; f < numF; ++f) {
        std::uint32_t a = idx[3*f], b = idx[3*f+1], c = idx[3*f+2];
        directed.insert(edgeKey(a, b));
        directed.insert(edgeKey(b, c));
        directed.insert(edgeKey(c, a));
    }

    // Outgoing boundary edge per vertex (next vertex along the boundary). For a
    // clean 2-manifold-with-boundary each boundary vertex has exactly ONE
    // outgoing boundary edge; more than one means the boundary is non-manifold
    // (a pinch point) -> we reject rather than guess.
    std::unordered_map<std::uint32_t, std::uint32_t> nextOnBoundary;
    nextOnBoundary.reserve(idx.size());
    for (std::uint32_t f = 0; f < numF; ++f) {
        std::uint32_t e[3] = {idx[3*f], idx[3*f+1], idx[3*f+2]};
        for (int k = 0; k < 3; ++k) {
            std::uint32_t a = e[k], b = e[(k+1)%3];
            if (directed.find(edgeKey(b, a)) == directed.end()) {
                // a->b is a boundary edge.
                auto it = nextOnBoundary.find(a);
                if (it != nextOnBoundary.end() && it->second != b) {
                    rep.reason = "non-manifold boundary (vertex with >1 outgoing boundary edge)";
                    return rep;
                }
                nextOnBoundary[a] = b;
            }
        }
    }

    if (nextOnBoundary.empty()) {
        // No boundary at all: already closed. Return the input unchanged.
        rep.wasClosed = true;
        rep.ok = true;
        rep.reason = "no boundary (closed) — returned unchanged";
        outMesh = inMesh;
        return rep;
    }

    // ---- extract boundary loops ---------------------------------------------
    std::vector<std::vector<std::uint32_t>> loops;
    std::unordered_set<std::uint32_t> visited;
    visited.reserve(nextOnBoundary.size());
    for (const auto& kv : nextOnBoundary) {
        std::uint32_t start = kv.first;
        if (visited.count(start)) continue;
        std::vector<std::uint32_t> loop;
        std::uint32_t cur = start;
        std::size_t guard = 0;
        const std::size_t guardMax = nextOnBoundary.size() + 4;
        bool closed = false;
        while (true) {
            if (++guard > guardMax) break;            // safety
            if (visited.count(cur)) {                 // returned somewhere
                closed = (cur == start);
                break;
            }
            visited.insert(cur);
            loop.push_back(cur);
            auto it = nextOnBoundary.find(cur);
            if (it == nextOnBoundary.end()) break;    // dangling -> open chain
            cur = it->second;
            if (cur == start) { closed = true; break; }
        }
        if (!closed || loop.size() < 3) {
            rep.reason = "boundary did not resolve into a simple closed loop";
            return rep;
        }
        loops.push_back(std::move(loop));
    }

    rep.loopsFound = static_cast<std::uint32_t>(loops.size());

    // ---- triangulate + stitch each loop -------------------------------------
    // `loop` lists vertices v0->v1->...->v_{n-1} following boundary directed
    // edges (v_i -> v_{i+1} is a boundary edge with the surface on its LEFT, hole
    // on its RIGHT). To SEAL the hole the cap faces must traverse each boundary
    // edge in REVERSE; equivalently the cap polygon, wound CCW for its own
    // outward (cap) normal, is the REVERSED vertex order.
    std::uint32_t nextNewVert = numV;
    for (auto& loop : loops) {
        const std::size_t n = loop.size();

        // Capping polygon = reversed loop, so its edges run v_{i+1}->v_i.
        std::vector<std::uint32_t> capPoly(loop.rbegin(), loop.rend());

        // Best-fit plane of the loop via the area-weighted (Newell) normal — this
        // is robust for non-planar / slightly-warped loops, not just flat ones.
        V3 centroid{0, 0, 0};
        for (std::uint32_t v : capPoly) { V3 p = P(v); centroid.x += p.x; centroid.y += p.y; centroid.z += p.z; }
        centroid.x /= static_cast<double>(n);
        centroid.y /= static_cast<double>(n);
        centroid.z /= static_cast<double>(n);

        V3 nrm{0, 0, 0};  // Newell normal of the cap polygon (consistent with capPoly winding)
        for (std::size_t i = 0; i < n; ++i) {
            const V3 a = P(capPoly[i]);
            const V3 b = P(capPoly[(i + 1) % n]);
            nrm.x += (a.y - b.y) * (a.z + b.z);
            nrm.y += (a.z - b.z) * (a.x + b.x);
            nrm.z += (a.x - b.x) * (a.y + b.y);
        }
        double nlen = norm(nrm);
        if (nlen < 1e-300) { rep.reason = "loop is degenerate (zero-area / collinear)"; return rep; }
        nrm.x /= nlen; nrm.y /= nlen; nrm.z /= nlen;

        // In-plane orthonormal basis (u, v) with u x v == nrm, so projecting onto
        // (u,v) preserves the CCW sense of the cap polygon (positive signed area).
        V3 ref = (std::fabs(nrm.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
        V3 u = cross(ref, nrm);
        double ulen = norm(u);
        if (ulen < 1e-300) { rep.reason = "could not build loop plane basis"; return rep; }
        u.x /= ulen; u.y /= ulen; u.z /= ulen;
        V3 v = cross(nrm, u);  // already unit (nrm, u orthonormal)

        // Project cap polygon vertices into (u,v).
        std::vector<P2> proj;
        proj.reserve(n);
        for (std::uint32_t vid : capPoly) {
            V3 d = sub(P(vid), centroid);
            proj.push_back(P2{dot(d, u), dot(d, v), vid});
        }

        // Decide convexity: the loop is "convex-ish" iff its 2D convex hull uses
        // every loop vertex exactly once (no interior / collinear vertex dropped).
        bool convex = false;
        if (opt.allowCentroidFan) {
            std::vector<geom::Point2> hullIn;
            hullIn.reserve(proj.size());
            for (auto& p : proj) hullIn.push_back(geom::Point2{p.x, p.y});
            std::vector<geom::Point2> hull = geom::convexHull2D(hullIn);
            convex = (hull.size() == proj.size());
        }

        std::vector<std::uint32_t> tris;  // flat triples of vertex ids
        if (convex) {
            // CENTROID FAN: new apex at the 3D centroid; fan it to every cap edge
            // capPoly[i] -> capPoly[i+1]. Triangle (apex, capPoly[i], capPoly[i+1])
            // is wound consistently with the cap polygon (CCW about nrm).
            std::uint32_t apex = nextNewVert++;
            pos.push_back(centroid.x); pos.push_back(centroid.y); pos.push_back(centroid.z);
            rep.vertsAdded += 1;
            for (std::size_t i = 0; i < n; ++i) {
                tris.push_back(apex);
                tris.push_back(capPoly[i]);
                tris.push_back(capPoly[(i + 1) % n]);
            }
            rep.fansUsed += 1;
        } else {
            // EAR CLIP in the (u,v) plane. The projected polygon is CCW (positive
            // signed area) because (u,v) was built right-handed w.r.t. nrm.
            // Guard the orientation explicitly; if it came out CW (a warped loop
            // whose Newell normal flipped the projection), reverse it AND remember
            // to emit triangles in reversed order so the 3D winding still seals.
            double area2 = 0.0;
            for (std::size_t i = 0; i < n; ++i) {
                const P2& a = proj[i]; const P2& b = proj[(i + 1) % n];
                area2 += a.x * b.y - b.x * a.y;
            }
            bool reversed = false;
            std::vector<P2> work = proj;
            if (area2 < 0.0) { std::reverse(work.begin(), work.end()); reversed = true; }

            std::vector<std::uint32_t> raw;
            if (!earClip(work, raw)) { rep.reason = "ear-clip failed on a non-convex loop"; return rep; }

            if (!reversed) {
                tris = std::move(raw);
            } else {
                // Undo the projection reversal in the EMITTED winding: flip each
                // triangle so the stitched 3D faces keep the cap normal (nrm),
                // i.e. seal the hole rather than face into it.
                tris.reserve(raw.size());
                for (std::size_t i = 0; i + 2 < raw.size() + 1; i += 3) {
                    tris.push_back(raw[i]);
                    tris.push_back(raw[i + 2]);
                    tris.push_back(raw[i + 1]);
                }
            }
            rep.earClipsUsed += 1;
        }

        // Stitch into the soup.
        for (std::size_t i = 0; i + 2 < tris.size() + 1; i += 3) {
            idx.push_back(tris[i]);
            idx.push_back(tris[i + 1]);
            idx.push_back(tris[i + 2]);
            rep.trisAdded += 1;
        }
        rep.loopsFilled += 1;
    }

    // ---- compact away orphaned vertices --------------------------------------
    // The input soup can carry vertices that were referenced ONLY by faces the
    // caller had already removed to open the holes (e.g. an interior vertex of a
    // removed patch). buildFromSoup keeps every position as a vertex, and the
    // validity audit skips isolated vertices — so they stay watertight/2-manifold
    // but each one inflates V, pushing the Euler characteristic above 2. They are
    // not part of the surface, so we drop them here, remapping the indices. This
    // changes NO geometry of the actual surface; it only removes dangling points.
    {
        std::vector<std::uint32_t> remap(pos.size() / 3, kInvalid);
        std::vector<double> cpos;
        cpos.reserve(pos.size());
        std::uint32_t next = 0;
        for (std::uint32_t& vi : idx) {
            if (remap[vi] == kInvalid) {
                remap[vi] = next++;
                cpos.push_back(pos[3 * vi + 0]);
                cpos.push_back(pos[3 * vi + 1]);
                cpos.push_back(pos[3 * vi + 2]);
            }
            vi = remap[vi];
        }
        pos.swap(cpos);
    }

    // ---- rebuild + validate --------------------------------------------------
    HalfEdgeMesh result;
    if (!result.buildFromSoup(pos, idx)) {
        rep.reason = "stitched soup failed to rebuild (cap created a non-manifold edge)";
        return rep;
    }
    ValidityReport vr = result.validate();
    if (!vr.isValid()) {
        rep.reason = "stitched mesh is not a valid watertight 2-manifold";
        return rep;
    }

    outMesh = std::move(result);
    rep.ok = true;
    rep.reason = "filled";
    return rep;
}

// =============================================================================
// fillHoles (soup overload)
// =============================================================================
HoleFillReport fillHoles(const std::vector<double>& positions,
                         const std::vector<std::uint32_t>& indices,
                         const HoleFillOptions& opt,
                         std::vector<double>& outPositions,
                         std::vector<std::uint32_t>& outIndices) {
    outPositions.clear();
    outIndices.clear();

    HoleFillReport rep;
    if (positions.empty() || indices.empty()) { rep.reason = "empty soup"; return rep; }
    if (positions.size() % 3 != 0 || indices.size() % 3 != 0) { rep.reason = "malformed soup"; return rep; }

    HalfEdgeMesh m;
    if (!m.buildFromSoup(positions, indices)) {
        rep.reason = "input soup is not a valid manifold build";
        return rep;
    }

    HalfEdgeMesh out;
    rep = fillHoles(m, opt, out);
    if (rep.ok) out.toSoup(outPositions, outIndices);
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
