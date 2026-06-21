// forge/native/mesh/Bridge.cpp
//
// Implementation of forge::native::mesh::Bridge — bridge / loft between two
// closed boundary loops. See Bridge.hpp for the full contract and the honest
// envelope. Pure C++20, standard library only; no OCCT, no WASM, no third-party
// libs. Builds on the parallel native headers by #include (never re-derived).
//
// CI PORTABILITY: every standard header actually used is included explicitly
// (a missing include compiles on Mac libc++ but fails CI's libstdc++).

#include "forge/native/mesh/Bridge.hpp"

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
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

namespace {

// ── small vector helpers (local, to keep this TU self-contained) ─────────────
struct V3 { double x = 0.0, y = 0.0, z = 0.0; };

inline V3 sub(const V3& a, const V3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 add(const V3& a, const V3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 scale(const V3& a, double s)  { return {a.x * s, a.y * s, a.z * s}; }
inline V3 cross(const V3& a, const V3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double dot(const V3& a, const V3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }
inline bool finiteV(const V3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// Squared distance between two points.
inline double dist2(const V3& a, const V3& b) {
    V3 d = sub(a, b);
    return dot(d, d);
}

// ── parse a flat xyz soup of a loop into V3 vertices ─────────────────────────
// Returns false if the length is not a positive multiple of 3, a coordinate is
// non-finite, or two CONSECUTIVE (cyclically) vertices coincide (a repeated
// closing vertex or a zero-length loop edge — both unsupported here).
bool parseLoop(const std::vector<double>& flat, std::vector<V3>& out,
               const char*& reason) {
    out.clear();
    if (flat.empty() || flat.size() % 3 != 0) { reason = "loop length not a positive multiple of 3"; return false; }
    const std::size_t n = flat.size() / 3;
    out.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        V3 p{flat[3 * i], flat[3 * i + 1], flat[3 * i + 2]};
        if (!finiteV(p)) { reason = "loop has a non-finite coordinate"; return false; }
        out.push_back(p);
    }
    for (std::size_t i = 0; i < n; ++i) {
        const V3& a = out[i];
        const V3& b = out[(i + 1) % n];
        if (dist2(a, b) == 0.0) { reason = "loop has a repeated / coincident consecutive vertex"; return false; }
    }
    return true;
}

// ── best-fit plane of a loop via the Newell area-weighted normal ─────────────
// Returns the (unit) Newell normal and the centroid. ok=false if degenerate
// (zero-area / collinear loop).
bool loopPlane(const std::vector<V3>& loop, V3& normal, V3& centroid) {
    const std::size_t n = loop.size();
    V3 c{0, 0, 0};
    for (const V3& p : loop) c = add(c, p);
    centroid = scale(c, 1.0 / static_cast<double>(n));
    V3 nrm{0, 0, 0};
    for (std::size_t i = 0; i < n; ++i) {
        const V3& cur = loop[i];
        const V3& nxt = loop[(i + 1) % n];
        nrm.x += (cur.y - nxt.y) * (cur.z + nxt.z);
        nrm.y += (cur.z - nxt.z) * (cur.x + nxt.x);
        nrm.z += (cur.x - nxt.x) * (cur.y + nxt.y);
    }
    double l = norm(nrm);
    if (!(l > 1e-300) || !std::isfinite(l)) return false;
    normal = scale(nrm, 1.0 / l);
    return true;
}

// 2D point with id carried for the ear-clip (id == soup vertex index).
struct P2 { double x = 0.0, y = 0.0; std::uint32_t id = 0; };

// EXACT-orient2d ear clipping of a CCW simple polygon `poly` (with carried ids),
// appending triangle id-triples to `tris`. Returns false on a degenerate /
// non-simple polygon (no progress) — honest failure, never a broken cap.
bool earClip(const std::vector<P2>& poly, std::vector<std::uint32_t>& tris) {
    const std::size_t n = poly.size();
    if (n < 3) return false;
    if (n == 3) {
        tris.push_back(poly[0].id); tris.push_back(poly[1].id); tris.push_back(poly[2].id);
        return true;
    }
    std::vector<std::size_t> idx(n);
    std::iota(idx.begin(), idx.end(), std::size_t{0});

    auto isConvex = [&](std::size_t ia, std::size_t ib, std::size_t ic) {
        const P2& a = poly[ia]; const P2& b = poly[ib]; const P2& c = poly[ic];
        return orient2d(a.x, a.y, b.x, b.y, c.x, c.y) == Sign::POSITIVE;
    };
    auto inTri = [&](std::size_t ia, std::size_t ib, std::size_t ic, std::size_t ip) {
        const P2& a = poly[ia]; const P2& b = poly[ib];
        const P2& c = poly[ic]; const P2& p = poly[ip];
        Sign s0 = orient2d(a.x, a.y, b.x, b.y, p.x, p.y);
        Sign s1 = orient2d(b.x, b.y, c.x, c.y, p.x, p.y);
        Sign s2 = orient2d(c.x, c.y, a.x, a.y, p.x, p.y);
        bool neg = (s0 == Sign::NEGATIVE) || (s1 == Sign::NEGATIVE) || (s2 == Sign::NEGATIVE);
        return !neg;
    };

    std::size_t guard = 0;
    const std::size_t guardMax = n * n + 16;
    while (idx.size() > 3) {
        if (++guard > guardMax) return false;
        const std::size_t m = idx.size();
        bool clipped = false;
        for (std::size_t i = 0; i < m; ++i) {
            const std::size_t ia = idx[(i + m - 1) % m];
            const std::size_t ib = idx[i];
            const std::size_t ic = idx[(i + 1) % m];
            if (!isConvex(ia, ib, ic)) continue;
            bool empty = true;
            for (std::size_t j = 0; j < m; ++j) {
                const std::size_t ip = idx[j];
                if (ip == ia || ip == ib || ip == ic) continue;
                if (inTri(ia, ib, ic, ip)) { empty = false; break; }
            }
            if (!empty) continue;
            tris.push_back(poly[ia].id); tris.push_back(poly[ib].id); tris.push_back(poly[ic].id);
            idx.erase(idx.begin() + static_cast<std::ptrdiff_t>(i));
            clipped = true;
            break;
        }
        if (!clipped) return false;
    }
    tris.push_back(poly[idx[0]].id); tris.push_back(poly[idx[1]].id); tris.push_back(poly[idx[2]].id);
    return true;
}

// Cap a loop whose 3D soup-vertex indices are `loopIds` (a simple closed loop)
// by ear clipping in the loop's best-fit plane, SEALING it against a side band.
// The side band already uses each undirected boundary edge once; for a clean
// 2-manifold the cap must use it once in the OPPOSITE direction. The required
// boundary traversal of THIS cap is given by `sealForward`:
//   * sealForward == true  -> the cap's boundary directed edges run
//                             loopIds[i] -> loopIds[i+1] (forward).
//   * sealForward == false -> they run loopIds[i+1] -> loopIds[i] (reverse).
// The combinatorial triangulation is computed CORRECTLY (ear clip needs a CCW
// projection); we then flip the WHOLE cap if its emitted boundary direction does
// not match `sealForward`. Flipping preserves validity (it reverses every
// directed edge, so the cap stays a valid triangulation of the same loop) — it
// only changes which way the perimeter is wound, which is exactly the freedom we
// need to seal either band side. Appends triangles to `tris`. Returns false on a
// degenerate / non-simple projected loop.
bool capLoop(const std::vector<V3>& loopPts,
             const std::vector<std::uint32_t>& loopIds,
             bool sealForward,
             std::vector<std::uint32_t>& tris) {
    V3 nrm, c;
    if (!loopPlane(loopPts, nrm, c)) return false;
    // Any in-plane orthonormal basis (u, v) with u x v == nrm.
    V3 ref = (std::fabs(nrm.x) < 0.9) ? V3{1, 0, 0} : V3{0, 1, 0};
    V3 u = sub(ref, scale(nrm, dot(ref, nrm)));
    double ul = norm(u);
    if (!(ul > 1e-300)) return false;
    u = scale(u, 1.0 / ul);
    V3 v = cross(nrm, u);  // unit; u x v == nrm

    std::vector<P2> poly;
    poly.reserve(loopPts.size());
    for (std::size_t i = 0; i < loopPts.size(); ++i) {
        V3 d = sub(loopPts[i], c);
        poly.push_back(P2{dot(d, u), dot(d, v), loopIds[i]});
    }
    // Ear clip needs a CCW projection; reverse the projected polygon if its
    // signed area is negative (this is a LOCAL choice for triangulation
    // correctness only — the final boundary direction is fixed up afterwards).
    double area2 = 0.0;
    for (std::size_t i = 0; i < poly.size(); ++i) {
        const P2& a = poly[i];
        const P2& b = poly[(i + 1) % poly.size()];
        area2 += a.x * b.y - b.x * a.y;
    }
    if (area2 == 0.0) return false;  // degenerate projection
    if (area2 < 0.0) std::reverse(poly.begin(), poly.end());

    std::vector<std::uint32_t> capTris;
    if (!earClip(poly, capTris)) return false;
    if (capTris.empty()) return false;

    // Detect the cap's actual boundary direction for the loop edge
    // (loopIds[0] -> loopIds[1]) by scanning the emitted triangles for which of
    // the two directed edges between id0 and id1 appears (a boundary edge appears
    // in exactly one triangle, in exactly one direction).
    const std::uint32_t id0 = loopIds[0];
    const std::uint32_t id1 = loopIds.size() > 1 ? loopIds[1] : loopIds[0];
    bool hasForward = false, hasReverse = false;
    for (std::size_t t = 0; t + 2 < capTris.size() + 1 && t < capTris.size(); t += 3) {
        const std::uint32_t a = capTris[t], b = capTris[t + 1], cc = capTris[t + 2];
        const std::uint32_t e[3][2] = {{a, b}, {b, cc}, {cc, a}};
        for (auto& ed : e) {
            if (ed[0] == id0 && ed[1] == id1) hasForward = true;
            if (ed[0] == id1 && ed[1] == id0) hasReverse = true;
        }
    }
    // The undirected edge (id0,id1) is a boundary edge of the loop, so exactly
    // one direction must appear in the cap triangulation.
    if (hasForward == hasReverse) return false;  // unexpected (non-simple) -> honest fail
    bool capIsForward = hasForward;
    if (capIsForward != sealForward) {
        // Flip every cap triangle to reverse the boundary direction.
        for (std::size_t t = 0; t + 2 < capTris.size() + 1 && t < capTris.size(); t += 3)
            std::swap(capTris[t + 1], capTris[t + 2]);
    }
    tris.insert(tris.end(), capTris.begin(), capTris.end());
    return true;
}

} // namespace

// =============================================================================
// bridgeLoops (flat-soup overload) — the core entry point.
// =============================================================================
BridgeReport bridgeLoops(const std::vector<double>& loopA,
                         const std::vector<double>& loopB,
                         const BridgeOptions& opt,
                         std::vector<double>& outPositions,
                         std::vector<std::uint32_t>& outIndices) {
    BridgeReport rep;
    outPositions.clear();
    outIndices.clear();

    std::vector<V3> A, B;
    const char* why = "";
    if (!parseLoop(loopA, A, why)) { rep.reason = why; return rep; }
    if (!parseLoop(loopB, B, why)) { rep.reason = why; return rep; }

    const std::size_t N = A.size();
    if (B.size() != N) {
        rep.reason = "mismatched vertex counts (no resampling in this slice)";
        return rep;
    }
    if (N < 3) { rep.reason = "loops must have at least 3 vertices"; return rep; }
    rep.loopN = static_cast<std::uint32_t>(N);

    // ── min-twist correspondence search ──────────────────────────────────────
    // For each cyclic offset `off` of B (and optionally B reversed), the rung i
    // connects A[i] to B[(i+off) mod N]. We minimise the SUM OF SQUARED rung
    // lengths (the standard twist proxy). Brute force over all N offsets x
    // {identity, reverse} is EXACT-optimal for equal N.
    auto rungCost = [&](std::size_t off, bool flip) {
        double s = 0.0;
        for (std::size_t i = 0; i < N; ++i) {
            std::size_t bi = flip ? (N - 1 - ((i + off) % N)) : ((i + off) % N);
            s += dist2(A[i], B[bi]);
        }
        return s;
    };

    rep.rungCostNaive = rungCost(0, false);

    double best = std::numeric_limits<double>::infinity();
    std::size_t bestOff = 0;
    bool bestFlip = false;
    const int flipPasses = opt.allowFlip ? 2 : 1;
    for (int fp = 0; fp < flipPasses; ++fp) {
        bool flip = (fp == 1);
        for (std::size_t off = 0; off < N; ++off) {
            double c = rungCost(off, flip);
            if (c < best) { best = c; bestOff = off; bestFlip = flip; }
        }
    }
    rep.rungCostBest = best;
    rep.bestOffset = static_cast<std::uint32_t>(bestOff);
    rep.flipped = bestFlip;

    // Reindex B into the matched order Bm[i] := B paired with A[i].
    std::vector<V3> Bm(N);
    for (std::size_t i = 0; i < N; ++i) {
        std::size_t bi = bestFlip ? (N - 1 - ((i + bestOff) % N)) : ((i + bestOff) % N);
        Bm[i] = B[bi];
    }

    // ── assemble the soup ────────────────────────────────────────────────────
    // Soup vertices: A[0..N-1] at indices [0,N), Bm[0..N-1] at indices [N,2N).
    std::vector<double> pos;
    pos.reserve(2 * N * 3);
    for (const V3& p : A)  { pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z); }
    for (const V3& p : Bm) { pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z); }

    auto aIdx = [&](std::size_t i) { return static_cast<std::uint32_t>(i % N); };
    auto bIdx = [&](std::size_t i) { return static_cast<std::uint32_t>(N + (i % N)); };

    std::vector<std::uint32_t> idx;
    idx.reserve(2 * N * 3 + (opt.cap ? 2 * (N - 2) * 3 : 0));

    // SIDE BAND: for each segment i -> i+1, the quad (A[i], A[i+1], Bm[i+1], Bm[i]).
    // We split it into two triangles. The winding below makes the band normals
    // point AWAY from the loop centroids' axis (outward) when A is the "bottom"
    // loop wound CCW seen from B's side; the watertight-volume gate confirms the
    // global orientation sign. Triangles:
    //   (A[i], Bm[i], Bm[i+1])  and  (A[i], Bm[i+1], A[i+1])
    for (std::size_t i = 0; i < N; ++i) {
        std::uint32_t a0 = aIdx(i), a1 = aIdx(i + 1);
        std::uint32_t b0 = bIdx(i), b1 = bIdx(i + 1);
        idx.push_back(a0); idx.push_back(b0); idx.push_back(b1);
        idx.push_back(a0); idx.push_back(b1); idx.push_back(a1);
    }
    rep.sideTris = static_cast<std::uint32_t>(2 * N);

    // ── caps ─────────────────────────────────────────────────────────────────
    if (opt.cap) {
        // The side band traverses the A boundary as A[i+1] -> A[i] (reverse) and
        // the B boundary as B[i] -> B[i+1] (forward). For a clean 2-manifold each
        // cap must use the OPPOSITE direction of its band edges:
        //   * A cap seals FORWARD  (A[i] -> A[i+1]),
        //   * B cap seals REVERSE  (B[i+1] -> B[i]).
        std::vector<std::uint32_t> aIds(N), bIds(N);
        for (std::size_t i = 0; i < N; ++i) { aIds[i] = aIdx(i); bIds[i] = bIdx(i); }

        std::size_t before = idx.size();
        if (!capLoop(A, aIds, /*sealForward=*/true, idx)) { rep.reason = "A-cap triangulation failed (non-simple projected loop)"; return rep; }
        if (!capLoop(Bm, bIds, /*sealForward=*/false, idx)) { rep.reason = "B-cap triangulation failed (non-simple projected loop)"; return rep; }
        rep.capTris = static_cast<std::uint32_t>((idx.size() - before) / 3);
        rep.capped = true;
    }

    // ── rebuild + (when capped) audit ────────────────────────────────────────
    HalfEdgeMesh mesh;
    if (!mesh.buildFromSoup(pos, idx)) {
        rep.reason = "bridged soup is not a valid manifold build (loops likely incompatible)";
        return rep;
    }
    if (opt.cap) {
        ValidityReport vr = mesh.validate();
        if (!vr.isValid()) {
            rep.reason = "capped bridge is not a watertight 2-manifold (loops incompatible)";
            return rep;
        }
        // Orient outward: a closed mesh built with the winding above may have an
        // inward global orientation (negative signed volume). If so, flip every
        // triangle so the result is a positively-oriented (outward) solid. The
        // topology is unchanged; only the global winding is corrected.
        if (mesh.signedVolume() < 0.0) {
            for (std::size_t t = 0; t < idx.size(); t += 3) std::swap(idx[t + 1], idx[t + 2]);
            HalfEdgeMesh m2;
            if (!m2.buildFromSoup(pos, idx) || !m2.validate().isValid()) {
                rep.reason = "orientation-corrected bridge failed re-audit";
                return rep;
            }
        }
    }

    outPositions = std::move(pos);
    outIndices = std::move(idx);
    rep.ok = true;
    return rep;
}

// =============================================================================
// bridgeLoops (Point3 overload)
// =============================================================================
BridgeReport bridgeLoops(const std::vector<geom::Point3>& loopA,
                         const std::vector<geom::Point3>& loopB,
                         const BridgeOptions& opt,
                         std::vector<double>& outPositions,
                         std::vector<std::uint32_t>& outIndices) {
    std::vector<double> fa, fb;
    fa.reserve(loopA.size() * 3);
    fb.reserve(loopB.size() * 3);
    for (const auto& p : loopA) { fa.push_back(p.x); fa.push_back(p.y); fa.push_back(p.z); }
    for (const auto& p : loopB) { fb.push_back(p.x); fb.push_back(p.y); fb.push_back(p.z); }
    return bridgeLoops(fa, fb, opt, outPositions, outIndices);
}

// =============================================================================
// bridgeMeshBoundaries — recover the two open boundary loops of one mesh and
// bridge them (the "close two boundary loops of a mesh" reuse).
// =============================================================================
BridgeReport bridgeMeshBoundaries(const std::vector<double>& positions,
                                  const std::vector<std::uint32_t>& indices,
                                  const BridgeOptions& opt,
                                  std::vector<double>& outPositions,
                                  std::vector<std::uint32_t>& outIndices) {
    BridgeReport rep;
    outPositions.clear();
    outIndices.clear();

    HalfEdgeMesh mesh;
    if (!mesh.buildFromSoup(positions, indices)) {
        rep.reason = "input soup is not a valid manifold-with-boundary build";
        return rep;
    }

    // Recover boundary loops by walking half-edges whose twin is absent. A
    // boundary half-edge (twin == kInvalid) chains via `next` around the hole.
    const auto& HE = mesh.halfEdges();
    std::vector<char> visited(HE.size(), 0);
    std::vector<std::vector<std::uint32_t>> loops;  // each: ORIGIN vertex ids in order
    for (std::uint32_t h = 0; h < HE.size(); ++h) {
        if (HE[h].twin != kInvalid || visited[h]) continue;
        std::vector<std::uint32_t> loopV;
        std::uint32_t cur = h;
        std::uint32_t guard = 0;
        const std::uint32_t guardMax = static_cast<std::uint32_t>(HE.size()) + 16;
        bool good = true;
        do {
            if (HE[cur].twin != kInvalid) { good = false; break; }
            if (visited[cur]) { good = false; break; }
            visited[cur] = 1;
            loopV.push_back(HE[cur].origin);
            // Advance to the next boundary half-edge: rotate around the
            // destination vertex (origin of next interior he) until twin absent.
            // The half-edge's `next` already points along the face; for a clean
            // boundary the next boundary edge is found by walking next/twin fans.
            std::uint32_t e = HE[cur].next;
            std::uint32_t fanGuard = 0;
            while (HE[e].twin != kInvalid && fanGuard < guardMax) {
                e = HE[HE[e].twin].next;
                ++fanGuard;
            }
            if (fanGuard >= guardMax) { good = false; break; }
            cur = e;
            if (++guard > guardMax) { good = false; break; }
        } while (cur != h);
        if (!good) { rep.reason = "boundary is not a set of simple loops (non-manifold boundary)"; return rep; }
        if (loopV.size() >= 3) loops.push_back(std::move(loopV));
    }

    if (loops.size() != 2) {
        rep.reason = "mesh does not have exactly two boundary loops";
        return rep;
    }
    if (loops[0].size() != loops[1].size()) {
        rep.reason = "the two boundary loops have different vertex counts (no resampling in this slice)";
        return rep;
    }

    // Gather the two loops' coordinates.
    const auto& verts = mesh.vertices();
    auto coordsOf = [&](const std::vector<std::uint32_t>& lv) {
        std::vector<double> f;
        f.reserve(lv.size() * 3);
        for (std::uint32_t vi : lv) {
            const Vec3& p = verts[vi].position;
            f.push_back(p.x); f.push_back(p.y); f.push_back(p.z);
        }
        return f;
    };
    std::vector<double> la = coordsOf(loops[0]);
    std::vector<double> lb = coordsOf(loops[1]);

    // Bridge the two recovered rims. With opt.cap == false the result is the
    // standalone connecting BAND (the closure surface) between the two loops — an
    // open tube whose two boundary loops ARE the two input rims (the honest
    // "close two open boundary loops" surface, no planar end caps). With
    // opt.cap == true the two rims are also planar-capped into a closed solid.
    // (We bridge the recovered loop COORDINATES rather than splicing into the
    // original soup, so the operation is well-defined whether or not the original
    // surface already connects the two rims.)
    return bridgeLoops(la, lb, opt, outPositions, outIndices);
}

} // namespace mesh
} // namespace native
} // namespace forge
