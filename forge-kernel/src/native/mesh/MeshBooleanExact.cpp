// forge/native/mesh/MeshBooleanExact.cpp
//
// K2 — exact-predicate / exact-construction mesh boolean (see MeshBooleanExact.hpp
// for the contract + audit citation). Pure C++20, builds on ExactReal +
// ExactPredicates3D + the existing meshBooleanNative fast path + HalfEdgeMesh.
//
// PIPELINE
//   1. FAST PATH — try meshBooleanNative (Strategy Q + SoS, analytic/double
//      coordinates). On ok=true we are done (the common general-position case
//      stays exactly as fast as before; the analytic quadric fast-path is kept).
//   2. EXACT PATH — when the fast path returns ok=false (the residual sliver /
//      coplanar-degenerate class) OR the input is a known-degenerate battery,
//      build a COMBINED ARRANGEMENT with EXACT constructions:
//        a. Ingest both soups into a CANONICAL exact-point pool (exact-equality
//           weld — coincident corners across A and B map to ONE id).
//        b. For every AABB-overlapping triangle pair, compute the exact cut
//           segment with ExactReal constructions and register its endpoints in the
//           pool (so a near-triple-point's three hits collapse to one exact id).
//        c. Re-triangulate every cut face by an EXACT constrained ear-clip in the
//           face's own plane (orientation decided by exactOrient3D — never a
//           double tie-break on the topology).
//        d. Classify each sub-face IN/OUT of the other solid by EXACT ray-parity
//           (exactOrient3D), select per op, net-cancel coincident walls.
//        e. Rebuild + validate() as a closed 2-manifold. ok=true ONLY then.
//
// The exact path is the K2 deliverable that lifts the boolean off the documented
// ~0.12% double-coordinate ceiling for the degenerate classes the battery covers.

#include "forge/native/mesh/MeshBooleanExact.hpp"
#include "forge/native/ExactPredicates3D.hpp"
#include "forge/native/ExactReal.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <chrono>
#include <cstdlib>
#include <map>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

namespace {

constexpr std::uint32_t kNone = 0xFFFFFFFFu;

// ── CANONICAL EXACT-POINT POOL ───────────────────────────────────────────────
// Every distinct geometric point (original corner OR exact construction) is held
// ONCE, addressed by a stable id. add() welds by EXACT equality — so a near-
// triple-point's three constructions, being the SAME exact rational, get the SAME
// id, which is precisely what removes the sliver / non-2-manifold edge. A spatial
// hash on the rounded double keeps the exact-equality scan O(1) amortised.
struct ExactPool {
    std::vector<ExactPoint3> pts;
    std::unordered_multimap<std::uint64_t, std::uint32_t> bucket;

    static std::uint64_t hashKey(const ExactPoint3& p) {
        // Bucket by a coarse rounded coordinate. Two exactly-equal points round to
        // the same key; the exact-equality scan inside the bucket is the truth.
        auto q = [](double v) -> long long {
            if (!std::isfinite(v)) return 0;
            return (long long)std::llround(v * 1048576.0);   // 2^20 grid
        };
        long long a = q(p.x.toDouble()), b = q(p.y.toDouble()), c = q(p.z.toDouble());
        std::uint64_t h = 1469598103934665603ull;
        for (long long w : {a, b, c}) {
            std::uint64_t u = (std::uint64_t)w;
            for (int i = 0; i < 8; ++i) { h ^= (u & 0xFF); h *= 1099511628211ull; u >>= 8; }
        }
        return h;
    }
    std::uint32_t add(const ExactPoint3& p) {
        std::uint64_t k = hashKey(p);
        auto range = bucket.equal_range(k);
        for (auto it = range.first; it != range.second; ++it)
            if (pts[it->second].equals(p)) return it->second;
        // also scan neighbour buckets is unnecessary: equal points share the key.
        std::uint32_t id = (std::uint32_t)pts.size();
        pts.push_back(p);
        bucket.emplace(k, id);
        return id;
    }
};

struct Tri { std::uint32_t v[3]; };

// AABB of a triangle in double (just an accelerator; correctness is exact below).
struct Box { double mn[3], mx[3]; };
inline Box boxOf(const ExactPool& pool, const Tri& t) {
    Box b;
    for (int d = 0; d < 3; ++d) { b.mn[d] = 1e300; b.mx[d] = -1e300; }
    for (int k = 0; k < 3; ++k) {
        Vec3 p = pool.pts[t.v[k]].toVec3();
        double c[3] = { p.x, p.y, p.z };
        for (int d = 0; d < 3; ++d) { b.mn[d] = std::min(b.mn[d], c[d]); b.mx[d] = std::max(b.mx[d], c[d]); }
    }
    return b;
}
inline bool boxOverlap(const Box& a, const Box& b, double eps) {
    for (int d = 0; d < 3; ++d)
        if (a.mn[d] > b.mx[d] + eps || b.mn[d] > a.mx[d] + eps) return false;
    return true;
}

std::vector<Tri> ingest(const std::vector<double>& pos, const std::vector<std::uint32_t>& idx,
                        ExactPool& pool) {
    std::vector<Tri> tris;
    std::size_t nf = idx.size() / 3;
    tris.reserve(nf);
    for (std::size_t f = 0; f < nf; ++f) {
        Tri t;
        for (int k = 0; k < 3; ++k) {
            std::uint32_t vi = idx[3 * f + k];
            ExactPoint3 p(Vec3{ pos[3 * vi + 0], pos[3 * vi + 1], pos[3 * vi + 2] });
            t.v[k] = pool.add(p);
        }
        if (t.v[0] == t.v[1] || t.v[1] == t.v[2] || t.v[0] == t.v[2]) continue; // drop degenerate
        tris.push_back(t);
    }
    return tris;
}

// ── EXACT 2D side test in a face's dominant-axis plane ───────────────────────
// We project to the plane that best preserves area (drop the axis whose exact
// normal component is largest in magnitude — decided by ExactReal compare so it is
// deterministic). The 2D orientation is then exactOrient3D with a lifted apex,
// i.e. we keep everything in 3D and never form a double 2D coordinate for a sign.

// Exact 2D orientation of (a,b,c) inside the plane of triangle face `f` — i.e. the
// sign of the triple product (b-a)x(c-a) . n where n is the face normal. Exact —
// delegates to the interval-filtered predicate (ExactPredicates3D.cpp), which
// answers the far-from-degenerate common case without big-integer arithmetic and
// falls through to the identical ExactReal evaluation otherwise.
int exactPlanarOrient(const ExactPoint3& a, const ExactPoint3& b, const ExactPoint3& c,
                      const ExactPoint3& n) {
    return exactPlanarOrient3D(a, b, c, n);
}

ExactPoint3 faceNormal(const ExactPool& pool, const Tri& t) {
    const ExactPoint3& A = pool.pts[t.v[0]];
    const ExactPoint3& B = pool.pts[t.v[1]];
    const ExactPoint3& C = pool.pts[t.v[2]];
    ExactReal ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z;
    ExactReal vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
    return ExactPoint3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

// Strict in-triangle (interior + boundary excluded? no — interior+edges) for the
// ear-clip containment test, all exact, in the face plane (normal n).
bool exactInPlanarTri(const ExactPoint3& p, const ExactPoint3& a, const ExactPoint3& b,
                      const ExactPoint3& c, const ExactPoint3& n) {
    int s0 = exactPlanarOrient(a, b, p, n);
    int s1 = exactPlanarOrient(b, c, p, n);
    int s2 = exactPlanarOrient(c, a, p, n);
    bool neg = (s0 < 0) || (s1 < 0) || (s2 < 0);
    bool pos = (s0 > 0) || (s1 > 0) || (s2 > 0);
    return !(neg && pos);
}

// ── EXACT constrained re-triangulation of ONE face ───────────────────────────
// Given the original triangle plus extra points (cut-segment endpoints that lie
// on/in it) and constraint segments, produce sub-triangles. We use an EXACT
// ear-clipping of the convex face augmented by a constrained-Delaunay-free
// incremental insertion: because the inputs of K2's degenerate battery are convex
// triangles cut by straight chords whose endpoints lie on edges or interior, an
// exact incremental insert + constraint-respecting ear clip triangulates them
// without any double tie-break. Every orientation/containment test is ExactReal.
struct SubTri { std::uint32_t v[3]; };

bool exactRetriangulate(const ExactPool& pool, const Tri& f,
                        const std::vector<std::uint32_t>& extraPts,
                        const std::vector<std::array<std::uint32_t, 2>>& constraints,
                        std::vector<SubTri>& out) {
    ExactPoint3 n = faceNormal(pool, f);
    // Gather the local point set: the 3 corners + every extra/constraint vertex.
    std::vector<std::uint32_t> P = { f.v[0], f.v[1], f.v[2] };
    auto addLocal = [&](std::uint32_t id) {
        if (std::find(P.begin(), P.end(), id) == P.end()) P.push_back(id);
    };
    for (std::uint32_t id : extraPts) addLocal(id);
    for (auto& c : constraints) { addLocal(c[0]); addLocal(c[1]); }

    if (P.size() == 3) { out.push_back({ f.v[0], f.v[1], f.v[2] }); return true; }

    // Orient the corner triangle CCW w.r.t. n (so all area signs are consistent).
    int ori = exactPlanarOrient(pool.pts[f.v[0]], pool.pts[f.v[1]], pool.pts[f.v[2]], n);
    std::array<std::uint32_t, 3> base = { f.v[0], f.v[1], f.v[2] };
    if (ori < 0) std::swap(base[1], base[2]);

    // Start with the base triangle, then insert each interior/edge point by
    // splitting the containing sub-triangle (3-way for interior, 2-way on an
    // edge). Containment decided exactly. This yields a valid triangulation of the
    // convex face that respects every point; constraints between collinear-on-edge
    // points are automatically edges of the result because the points lie on the
    // face boundary or chords.
    std::vector<SubTri> work = { { base[0], base[1], base[2] } };
    for (std::uint32_t id : P) {
        if (id == f.v[0] || id == f.v[1] || id == f.v[2]) continue;
        const ExactPoint3& p = pool.pts[id];
        bool placed = false;
        for (std::size_t ti = 0; ti < work.size() && !placed; ++ti) {
            const SubTri st = work[ti];
            const ExactPoint3& a = pool.pts[st.v[0]];
            const ExactPoint3& b = pool.pts[st.v[1]];
            const ExactPoint3& c = pool.pts[st.v[2]];
            int s0 = exactPlanarOrient(a, b, p, n);
            int s1 = exactPlanarOrient(b, c, p, n);
            int s2 = exactPlanarOrient(c, a, p, n);
            bool neg = (s0 < 0) || (s1 < 0) || (s2 < 0);
            bool pos = (s0 > 0) || (s1 > 0) || (s2 > 0);
            if (neg && pos) continue;              // outside this sub-triangle
            // inside or on boundary -> split.
            work[ti] = work.back(); work.pop_back();
            auto pushIf = [&](std::uint32_t x, std::uint32_t y, std::uint32_t z) {
                if (x == y || y == z || x == z) return;
                if (exactPlanarOrient(pool.pts[x], pool.pts[y], pool.pts[z], n) != 0)
                    work.push_back({ x, y, z });
            };
            if (s0 == 0)      { pushIf(st.v[0], id, st.v[2]); pushIf(id, st.v[1], st.v[2]); }
            else if (s1 == 0) { pushIf(st.v[1], id, st.v[0]); pushIf(id, st.v[2], st.v[0]); }
            else if (s2 == 0) { pushIf(st.v[2], id, st.v[1]); pushIf(id, st.v[0], st.v[1]); }
            else { pushIf(st.v[0], st.v[1], id); pushIf(st.v[1], st.v[2], id); pushIf(st.v[2], st.v[0], id); }
            placed = true;
        }
        if (!placed) {
            // Point not inside the convex face (numerically off-edge). For a convex
            // triangle this should not happen for true on-face points; treat as
            // honest failure rather than fudge.
            return false;
        }
    }
    out.insert(out.end(), work.begin(), work.end());
    return true;
}

// ── EXACT ray-parity point-in-solid ──────────────────────────────────────────
// Cast a ray from an exact interior probe point; count exact crossings of solid
// faces. All sidedness via exactOrient3D, so a grazing ray never makes an
// inconsistent decision. The probe is a face centroid pushed slightly along its
// exact normal; we vote over a few directions for a coordinate-noise guard.
int exactRayCrossings(const ExactPoint3& pt, const ExactPoint3& far,
                      const std::vector<Tri>& solid, const ExactPool& pool) {
    int cr = 0;
    for (const Tri& f : solid) {
        const ExactPoint3& A = pool.pts[f.v[0]];
        const ExactPoint3& B = pool.pts[f.v[1]];
        const ExactPoint3& C = pool.pts[f.v[2]];
        int sPt = exactOrient3D(A, B, C, pt);
        int sFar = exactOrient3D(A, B, C, far);
        if (sPt == 0 || sFar == 0) return -1;     // ray grazes a plane: caller re-tries
        if (sPt == sFar) continue;
        int s1 = exactOrient3D(pt, far, A, B);
        int s2 = exactOrient3D(pt, far, B, C);
        int s3 = exactOrient3D(pt, far, C, A);
        if (s1 == 0 || s2 == 0 || s3 == 0) return -1;
        if (s1 == s2 && s2 == s3) ++cr;
    }
    return cr;
}

bool pointInSolidExact(const ExactPoint3& probe, const std::vector<Tri>& solid,
                       const ExactPool& pool, double extent) {
    static const double dirs[][3] = {
        {1, 0, 0}, {0.7, 0.5, 0.31}, {-0.33, 0.91, 0.17},
        {0.41, -0.27, 0.87}, {-0.6, -0.55, 0.58}, {0.13, 0.97, -0.21}
    };
    double Lr = 8.0 * (extent > 0 ? extent : 1.0);
    int inV = 0, outV = 0;
    for (auto& d : dirs) {
        ExactPoint3 far(probe.x + ExactReal(d[0] * Lr),
                        probe.y + ExactReal(d[1] * Lr),
                        probe.z + ExactReal(d[2] * Lr));
        int cr = exactRayCrossings(probe, far, solid, pool);
        if (cr < 0) continue;                     // grazing — skip this direction
        if (cr & 1) ++inV; else ++outV;
    }
    return inV > outV;
}

// Coincident-coplanar wall: is sub-triangle (v0,v1,v2) (centroid cen, normal nrm)
// coplanar with AND inside a face of `other`? Returns +1 aligned, -1 opposed, 0 no.
int coincidentWallExact(const std::array<std::uint32_t, 3>& v, const ExactPoint3& cen,
                        const ExactPoint3& nrm, const std::vector<Tri>& other,
                        const ExactPool& pool) {
    for (const Tri& fb : other) {
        const ExactPoint3& B0 = pool.pts[fb.v[0]];
        const ExactPoint3& B1 = pool.pts[fb.v[1]];
        const ExactPoint3& B2 = pool.pts[fb.v[2]];
        if (exactOrient3D(B0, B1, B2, pool.pts[v[0]]) != 0) continue;
        if (exactOrient3D(B0, B1, B2, pool.pts[v[1]]) != 0) continue;
        if (exactOrient3D(B0, B1, B2, pool.pts[v[2]]) != 0) continue;
        ExactPoint3 bn = faceNormal(pool, fb);
        if (!exactInPlanarTri(cen, B0, B1, B2, bn)) continue;
        ExactReal dot = nrm.x * bn.x + nrm.y * bn.y + nrm.z * bn.z;
        return dot.sign() >= 0 ? +1 : -1;
    }
    return 0;
}

} // namespace

// ═════════════════════════════════════════════════════════════════════════════
// EXACT-PATH boolean. Returns ok=false honestly if it cannot close.
// ═════════════════════════════════════════════════════════════════════════════
static BoolResultN exactArrangementBoolean(const std::vector<double>& aPos,
                                           const std::vector<std::uint32_t>& aIdx,
                                           const std::vector<double>& bPos,
                                           const std::vector<std::uint32_t>& bIdx,
                                           BoolOpN op) {
    BoolResultN R;

    // WORK BUDGET. This stage runs an O(|A|.|B|) arrangement in arbitrary-precision ExactReal
    // arithmetic, then an O(n^2) constrained retriangulation. On a tessellated sphere crossing a
    // planar box face it does not finish: measured 42% CPU, 4.5 MB RSS, no result after 600s, which
    // took CI's `native` job from 12 min to a 2-hour hard kill (2026-07-06 .. 2026-07-10). The
    // commit that introduced the escalation (b7815380) hangs; its parent passes the gate in 61s.
    //
    // The contract of this file is "detect, never fake" -- ok=true only on a validated closed
    // 2-manifold, ok=false otherwise. An honest ok=false is therefore a LEGAL result, and it is the
    // right one when the arrangement cannot be completed in bounded time. Returning it costs the
    // caller nothing it was not already prepared for, and it makes the failure loud instead of
    // infinite. Override with FORGE_EXACT_BOOL_BUDGET_MS (0 or negative disables the bound).
    const auto   t0 = std::chrono::steady_clock::now();
    const double budgetMs = [] {
        if (const char* e = std::getenv("FORGE_EXACT_BOOL_BUDGET_MS")) return std::atof(e);
        return 5000.0;
    }();
    const auto overBudget = [&] {
        if (budgetMs <= 0.0) return false;
        return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() > budgetMs;
    };

    ExactPool pool;
    std::vector<Tri> A = ingest(aPos, aIdx, pool);
    std::vector<Tri> B = ingest(bPos, bIdx, pool);
    if (A.empty() || B.empty()) { R.ok = false; R.reason = "empty operand (exact)"; return R; }

    // scene extent (double, accelerator only).
    double mn[3] = { 1e300, 1e300, 1e300 }, mx[3] = { -1e300, -1e300, -1e300 };
    for (const auto& v : { aPos, bPos })
        for (std::size_t i = 0; i + 2 < v.size(); i += 3)
            for (int d = 0; d < 3; ++d) { mn[d] = std::min(mn[d], v[i + d]); mx[d] = std::max(mx[d], v[i + d]); }
    double extent = std::sqrt((mx[0]-mn[0])*(mx[0]-mn[0]) + (mx[1]-mn[1])*(mx[1]-mn[1]) + (mx[2]-mn[2])*(mx[2]-mn[2]));
    double eps = 1e-9 * (extent > 0 ? extent : 1.0);

    std::vector<Box> ab(A.size()), bb(B.size());
    for (std::size_t i = 0; i < A.size(); ++i) ab[i] = boxOf(pool, A[i]);
    for (std::size_t j = 0; j < B.size(); ++j) bb[j] = boxOf(pool, B[j]);

    // ── IMPRINT: exact cut segments (shared exact ids on both surfaces). ──────
    std::vector<std::vector<std::uint32_t>> aExtra(A.size()), bExtra(B.size());
    std::vector<std::vector<std::array<std::uint32_t, 2>>> aCons(A.size()), bCons(B.size());

    auto registerCut = [&](std::uint32_t cid, std::size_t fi, std::vector<std::vector<std::uint32_t>>& extra) {
        if (std::find(extra[fi].begin(), extra[fi].end(), cid) == extra[fi].end())
            extra[fi].push_back(cid);
    };

    for (std::size_t i = 0; i < A.size(); ++i) {
        if ((i & 0xF) == 0 && overBudget()) { R.ok = false; R.reason = "exact arrangement over budget (imprint)"; return R; }
        for (std::size_t j = 0; j < B.size(); ++j) {
            if (!boxOverlap(ab[i], bb[j], eps)) continue;
            const Tri& fa = A[i]; const Tri& fb = B[j];
            // Collect crossing points of A's edges through B's triangle plane, and
            // B's edges through A's plane — each an EXACT construction registered in
            // the shared pool (so the same point gets the same id on both faces).
            std::vector<std::uint32_t> hits;
            auto edgeVsTri = [&](const Tri& ea, std::size_t ei, const Tri& tb,
                                 std::vector<std::vector<std::uint32_t>>& extraE) {
                for (int e = 0; e < 3; ++e) {
                    const ExactPoint3& P0 = pool.pts[ea.v[e]];
                    const ExactPoint3& P1 = pool.pts[ea.v[(e + 1) % 3]];
                    SegTriResult r = segmentTriangleClassify(P0, P1,
                        pool.pts[tb.v[0]], pool.pts[tb.v[1]], pool.pts[tb.v[2]]);
                    if (r.intersects && !r.coplanar && r.point.x.den().sign() != 0) {
                        // construct exact point and weld.
                        std::uint32_t cid = pool.add(r.point);
                        registerCut(cid, ei, extraE);
                        hits.push_back(cid);
                    }
                }
            };
            edgeVsTri(fa, i, fb, aExtra);
            edgeVsTri(fb, j, fa, bExtra);
            // Pair the (typically 2) shared hits into a constraint on BOTH faces.
            std::sort(hits.begin(), hits.end());
            hits.erase(std::unique(hits.begin(), hits.end()), hits.end());
            if (hits.size() == 2 && hits[0] != hits[1]) {
                aCons[i].push_back({ hits[0], hits[1] });
                bCons[j].push_back({ hits[0], hits[1] });
                registerCut(hits[0], i, aExtra); registerCut(hits[1], i, aExtra);
                registerCut(hits[0], j, bExtra); registerCut(hits[1], j, bExtra);
            }
        }
    }

    // ── CONFORMING EDGE-SPLIT: a cut point exactly on a shared original mesh edge
    //    must split BOTH adjacent same-mesh faces at the SAME id. We add, per mesh,
    //    every pool point that lies exactly on an undirected mesh edge to every
    //    face owning that edge. Exactness makes "on the edge" a real ExactReal test.
    auto conformEdges = [&](const std::vector<Tri>& F,
                            std::vector<std::vector<std::uint32_t>>& extra) {
        // candidate points = union of all extras (the only non-corner points).
        std::vector<std::uint32_t> cand;
        for (auto& v : extra) for (std::uint32_t id : v) cand.push_back(id);
        std::sort(cand.begin(), cand.end()); cand.erase(std::unique(cand.begin(), cand.end()), cand.end());
        for (std::size_t i = 0; i < F.size(); ++i) {
            for (int e = 0; e < 3; ++e) {
                std::uint32_t u = F[i].v[e], w = F[i].v[(e + 1) % 3];
                const ExactPoint3& U = pool.pts[u]; const ExactPoint3& W = pool.pts[w];
                for (std::uint32_t pid : cand) {
                    if (pid == u || pid == w) continue;
                    const ExactPoint3& Pp = pool.pts[pid];
                    // collinear with U,W ? cross((W-U),(P-U)) == 0 exactly.
                    ExactReal dx = W.x - U.x, dy = W.y - U.y, dz = W.z - U.z;
                    ExactReal qx = Pp.x - U.x, qy = Pp.y - U.y, qz = Pp.z - U.z;
                    ExactReal cx = dy * qz - dz * qy, cy = dz * qx - dx * qz, cz = dx * qy - dy * qx;
                    if (cx.sign() != 0 || cy.sign() != 0 || cz.sign() != 0) continue;
                    // strictly between U and W ? 0 < (P-U).(W-U) < |W-U|^2.
                    ExactReal proj = qx * dx + qy * dy + qz * dz;
                    ExactReal len2 = dx * dx + dy * dy + dz * dz;
                    if (proj.sign() <= 0) continue;
                    if (proj.cmp(len2) >= 0) continue;
                    registerCut(pid, i, extra);
                }
            }
        }
    };
    conformEdges(A, aExtra);
    conformEdges(B, bExtra);

    // ── RE-TRIANGULATE every face → sub-faces (exact). ───────────────────────
    std::vector<SubTri> aSub, bSub;
    for (std::size_t i = 0; i < A.size(); ++i) {
        if ((i & 0xF) == 0 && overBudget()) { R.ok = false; R.reason = "exact arrangement over budget (retriangulate A)"; return R; }
        std::vector<SubTri> sub;
        if (!exactRetriangulate(pool, A[i], aExtra[i], aCons[i], sub)) { R.ok = false; R.reason = "exact CDT failed on A"; return R; }
        aSub.insert(aSub.end(), sub.begin(), sub.end());
    }
    for (std::size_t j = 0; j < B.size(); ++j) {
        if ((j & 0xF) == 0 && overBudget()) { R.ok = false; R.reason = "exact arrangement over budget (retriangulate B)"; return R; }
        std::vector<SubTri> sub;
        if (!exactRetriangulate(pool, B[j], bExtra[j], bCons[j], sub)) { R.ok = false; R.reason = "exact CDT failed on B"; return R; }
        bSub.insert(bSub.end(), sub.begin(), sub.end());
    }

    // ── SELECT per op (exact in/out + exact coincident-wall handling). ───────
    bool keepInside; bool flipPrimaryWall;  // wall sense
    std::vector<SubTri> selected;
    // Returns false iff the work budget expired mid-select (same honest-failure
    // contract as the imprint/retriangulate checks above — the SELECT stage's
    // exact classification is O(|subs|*|other|) and previously ran UNBOUNDED).
    auto selectFrom = [&](const std::vector<SubTri>& subs, const std::vector<Tri>& other,
                          bool primary) -> bool {
        for (std::size_t si = 0; si < subs.size(); ++si) {
            if ((si & 0xF) == 0 && overBudget()) return false;
            const SubTri& s = subs[si];
            const ExactPoint3& A0 = pool.pts[s.v[0]];
            const ExactPoint3& A1 = pool.pts[s.v[1]];
            const ExactPoint3& A2 = pool.pts[s.v[2]];
            // centroid (exact) and exact normal.
            ExactPoint3 cen((A0.x + A1.x + A2.x) / ExactReal(3LL),
                            (A0.y + A1.y + A2.y) / ExactReal(3LL),
                            (A0.z + A1.z + A2.z) / ExactReal(3LL));
            ExactReal ux = A1.x - A0.x, uy = A1.y - A0.y, uz = A1.z - A0.z;
            ExactReal vx = A2.x - A0.x, vy = A2.y - A0.y, vz = A2.z - A0.z;
            ExactPoint3 nrm(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
            std::array<std::uint32_t, 3> tv = { s.v[0], s.v[1], s.v[2] };
            int cs = coincidentWallExact(tv, cen, nrm, other, pool);
            if (cs != 0) {
                if (!primary) continue;            // only A emits the contact wall
                bool keepW;
                if (op == BoolOpN::UNION || op == BoolOpN::INTERSECTION) keepW = (cs > 0);
                else keepW = (cs < 0);
                if (keepW) selected.push_back({ s.v[0], s.v[1], s.v[2] });
                continue;
            }
            // probe: centroid pushed a hair along the normal (double, only nudges
            // the ray origin off the surface — the in/out decision itself is exact).
            Vec3 c = cen.toVec3(); Vec3 nn = nrm.toVec3();
            double nl = std::sqrt(nn.x*nn.x + nn.y*nn.y + nn.z*nn.z);
            double push = 1e-6 * (extent > 0 ? extent : 1.0);
            ExactPoint3 probe = cen;
            if (nl > 0) probe = ExactPoint3(cen.x + ExactReal(nn.x / nl * push),
                                            cen.y + ExactReal(nn.y / nl * push),
                                            cen.z + ExactReal(nn.z / nl * push));
            bool inside = pointInSolidExact(probe, other, pool, extent);
            if (inside != keepInside) continue;
            if (flipPrimaryWall && !primary) selected.push_back({ s.v[0], s.v[2], s.v[1] });
            else                             selected.push_back({ s.v[0], s.v[1], s.v[2] });
        }
        return true;
    };

    if (op == BoolOpN::UNION) { keepInside = false; flipPrimaryWall = false; }
    else if (op == BoolOpN::INTERSECTION) { keepInside = true; flipPrimaryWall = false; }
    else { keepInside = false; flipPrimaryWall = false; }   // DIFFERENCE handled per-side below

    // For DIFFERENCE, A keeps OUTSIDE B, B keeps INSIDE A (reversed). We special-case.
    if (op == BoolOpN::DIFFERENCE) {
        // A side: keep A outside B.
        for (std::size_t si = 0; si < aSub.size(); ++si) {
            if ((si & 0xF) == 0 && overBudget()) { R.ok = false; R.reason = "exact arrangement over budget (select)"; return R; }
            const SubTri& s = aSub[si];
            const ExactPoint3& A0 = pool.pts[s.v[0]]; const ExactPoint3& A1 = pool.pts[s.v[1]]; const ExactPoint3& A2 = pool.pts[s.v[2]];
            ExactPoint3 cen((A0.x+A1.x+A2.x)/ExactReal(3LL),(A0.y+A1.y+A2.y)/ExactReal(3LL),(A0.z+A1.z+A2.z)/ExactReal(3LL));
            ExactReal ux=A1.x-A0.x,uy=A1.y-A0.y,uz=A1.z-A0.z, vx=A2.x-A0.x,vy=A2.y-A0.y,vz=A2.z-A0.z;
            ExactPoint3 nrm(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
            std::array<std::uint32_t,3> tv={s.v[0],s.v[1],s.v[2]};
            int cs = coincidentWallExact(tv, cen, nrm, B, pool);
            if (cs != 0) { if (cs < 0) selected.push_back({s.v[0],s.v[1],s.v[2]}); continue; }
            Vec3 nn=nrm.toVec3(); double nl=std::sqrt(nn.x*nn.x+nn.y*nn.y+nn.z*nn.z); double push=1e-6*(extent>0?extent:1.0);
            ExactPoint3 probe=cen; if(nl>0) probe=ExactPoint3(cen.x+ExactReal(nn.x/nl*push),cen.y+ExactReal(nn.y/nl*push),cen.z+ExactReal(nn.z/nl*push));
            if (!pointInSolidExact(probe, B, pool, extent)) selected.push_back({s.v[0],s.v[1],s.v[2]});
        }
        // B side: keep B inside A, reversed.
        for (std::size_t si = 0; si < bSub.size(); ++si) {
            if ((si & 0xF) == 0 && overBudget()) { R.ok = false; R.reason = "exact arrangement over budget (select)"; return R; }
            const SubTri& s = bSub[si];
            const ExactPoint3& A0 = pool.pts[s.v[0]]; const ExactPoint3& A1 = pool.pts[s.v[1]]; const ExactPoint3& A2 = pool.pts[s.v[2]];
            ExactPoint3 cen((A0.x+A1.x+A2.x)/ExactReal(3LL),(A0.y+A1.y+A2.y)/ExactReal(3LL),(A0.z+A1.z+A2.z)/ExactReal(3LL));
            ExactReal ux=A1.x-A0.x,uy=A1.y-A0.y,uz=A1.z-A0.z, vx=A2.x-A0.x,vy=A2.y-A0.y,vz=A2.z-A0.z;
            ExactPoint3 nrm(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
            std::array<std::uint32_t,3> tv={s.v[0],s.v[1],s.v[2]};
            int cs = coincidentWallExact(tv, cen, nrm, A, pool);
            if (cs != 0) continue;     // B does not emit the contact wall (A did)
            Vec3 nn=nrm.toVec3(); double nl=std::sqrt(nn.x*nn.x+nn.y*nn.y+nn.z*nn.z); double push=1e-6*(extent>0?extent:1.0);
            ExactPoint3 probe=cen; if(nl>0) probe=ExactPoint3(cen.x+ExactReal(nn.x/nl*push),cen.y+ExactReal(nn.y/nl*push),cen.z+ExactReal(nn.z/nl*push));
            if (pointInSolidExact(probe, A, pool, extent)) selected.push_back({s.v[0],s.v[2],s.v[1]});
        }
    } else {
        if (!selectFrom(aSub, B, /*primary=*/true) ||
            !selectFrom(bSub, A, /*primary=*/false)) {
            R.ok = false; R.reason = "exact arrangement over budget (select)"; return R;
        }
    }

    // ── ASSEMBLE: net-cancel coincident duplicate walls, build + validate. ────
    std::map<std::array<std::uint32_t, 3>, int> net;
    std::map<std::array<std::uint32_t, 3>, std::array<std::uint32_t, 3>> rep;
    auto permSign = [&](std::array<std::uint32_t, 3> p) -> int {
        int sw = 0; for (int x = 0; x < 3; ++x) for (int y = x + 1; y < 3; ++y) if (p[x] > p[y]) ++sw;
        return (sw % 2 == 0) ? +1 : -1; };
    for (const SubTri& f : selected) {
        std::uint32_t a = f.v[0], b = f.v[1], c = f.v[2];
        if (a == b || b == c || a == c) continue;
        std::array<std::uint32_t, 3> srt{ a, b, c }; std::sort(srt.begin(), srt.end());
        net[srt] += permSign({ a, b, c });
        if (rep.find(srt) == rep.end()) rep[srt] = { a, b, c };
    }
    std::vector<SubTri> kept;
    for (auto& kv : net) {
        if (kv.second == 0) continue;
        auto base = rep[kv.first];
        bool wantPlus = (kv.second > 0);
        if ((permSign(base) > 0) == wantPlus) kept.push_back({ base[0], base[1], base[2] });
        else                                   kept.push_back({ base[0], base[2], base[1] });
    }
    if (kept.empty()) { R.ok = false; R.reason = "empty result (exact)"; return R; }

    std::unordered_map<std::uint32_t, std::uint32_t> remap;
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    auto getv = [&](std::uint32_t id) -> std::uint32_t {
        auto it = remap.find(id);
        if (it != remap.end()) return it->second;
        std::uint32_t ni = (std::uint32_t)(pos.size() / 3);
        Vec3 p = pool.pts[id].toVec3();
        pos.push_back(p.x); pos.push_back(p.y); pos.push_back(p.z);
        remap.emplace(id, ni); return ni; };
    for (const SubTri& f : kept) { idx.push_back(getv(f.v[0])); idx.push_back(getv(f.v[1])); idx.push_back(getv(f.v[2])); }

    HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) { R.ok = false; R.reason = "exact: non-manifold (build failed)"; return R; }
    ValidityReport vr = m.validate();
    if (!vr.isValid()) { R.ok = false; R.reason = "exact: result not closed 2-manifold"; return R; }
    R.ok = true; R.mesh = std::move(m); R.reason = "ok (exact)";
    return R;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ENTRY — meshBooleanExact
// ═════════════════════════════════════════════════════════════════════════════
BoolResultN meshBooleanExact(const std::vector<double>&        aPos,
                             const std::vector<std::uint32_t>& aIdx,
                             const std::vector<double>&        bPos,
                             const std::vector<std::uint32_t>& bIdx,
                             BoolOpN op) {
    if (aIdx.size() < 3 || bIdx.size() < 3 || aIdx.size() % 3 || bIdx.size() % 3) {
        BoolResultN R; R.ok = false; R.reason = "empty/invalid input soup"; return R;
    }
    // 1. FAST PATH — keeps the analytic/SoS engine (and its quadric SSI fast-path
    //    upstream). Common general-position cases return here unchanged.
    BoolResultN fast = meshBooleanNative(aPos, aIdx, bPos, bIdx, op);
    if (fast.ok) return fast;

    // 2. EXACT PATH — the residual degenerate / sliver class the fast path could
    //    not close. Exact constructions + canonical exact-point weld remove the
    //    double-coordinate ceiling. Still validated (0 fakes).
    BoolResultN exact = exactArrangementBoolean(aPos, aIdx, bPos, bIdx, op);
    if (exact.ok) return exact;

    // Both failed honestly — return the more informative reason.
    return fast.reason ? fast : exact;
}

} // namespace mesh
} // namespace native
} // namespace forge
