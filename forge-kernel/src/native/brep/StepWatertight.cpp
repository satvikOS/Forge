// forge/native/brep/StepWatertight.cpp
//
// Implementation of the foreign-STEP watertight-soup keystone (StepWatertight.hpp).
// Pure C++20, stdlib + forge native headers only. No OCCT, no WASM.
//
// MODEL. Every face is fanned from the first vertex of each of its sewn loops, in
// coedge-traversal order, sharing the SEW'S welded vertices. Watertightness is read
// at the FACE / LOOP-BOUNDARY level (the real face-to-face adjacency), never over
// the interior fan diagonals — two faces can share two welded corner vertices
// WITHOUT sharing an edge, so a diagonal-level edge count would spuriously report
// non-manifold joins. Concretely:
//   * free-edge count: an undirected welded-vertex pair used by a loop-boundary
//     segment of != 2 faces is a crack (open) or non-manifold join; a watertight
//     soup has zero.
//   * generalized winding number: the solid angle a face subtends at a point p
//     depends ONLY on its oriented boundary loop (Stokes), which the fan reproduces
//     vertex-for-vertex, so GWN(p) = (1/4pi) * sum_faces orient(face) *
//     sum_fan_tri solidAngle. `orient(face)` is propagated across shared loop edges
//     by a FACE-adjacency BFS — purely topological, independent of the surface
//     normals — so |GWN| ~= 1 at an interior point of a closed, orientable soup and
//     collapses toward 0 when cracks leak the solid angle. The interior point is
//     found by maximizing |GWN| over a bbox grid + a few face-inward probes (GWN is
//     itself the inside test — no geometric ray casting, whose accuracy the
//     fan-of-boundary geometry would not support).

#include "forge/native/brep/StepWatertight.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double FOUR_PI = 4.0 * PI;

// Signed solid angle of the oriented triangle (a,b,c) seen from p (Van Oosterom &
// Strackee). Sign follows the (a,b,c) winding.
inline double solidAngle(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c) {
    const Vec3 A = vsub(a, p), B = vsub(b, p), C = vsub(c, p);
    const double la = vlen(A), lb = vlen(B), lc = vlen(C);
    if (la < 1e-30 || lb < 1e-30 || lc < 1e-30) return 0.0;
    const double numer = vdot(A, vcross(B, C));
    const double denom = la * lb * lc + vdot(A, B) * lc + vdot(B, C) * la + vdot(C, A) * lb;
    return 2.0 * std::atan2(numer, denom);
}

inline std::uint64_t ekey(int a, int b) {
    const std::uint32_t lo = a < b ? a : b, hi = a < b ? b : a;
    return (std::uint64_t(lo) << 32) | std::uint64_t(hi);
}

// A tessellated soup with FACE identity retained.
struct Soup {
    std::vector<Vec3> V;                       // welded (or quantized) vertex positions
    std::vector<std::array<int, 3>> T;         // fan triangles (vertex indices)
    std::vector<int> triFace;                  // face id per triangle
    // per FACE: the directed loop-boundary segments (welded-vertex index pairs).
    std::vector<std::array<int, 2>> segE;      // (a,b) directed
    std::vector<int> segFace;                  // face id per segment
    int faceCount = 0;
    Vec3 lo{1e300, 1e300, 1e300}, hi{-1e300, -1e300, -1e300};
    Vec3 centroid{0, 0, 0};
    double diag = 1.0;
    std::vector<Vec3> faceCtr;                 // per-face centroid (avg of its tri verts)

    void finalize() {
        Vec3 sum{0, 0, 0};
        for (const Vec3& v : V) {
            lo.x = std::min(lo.x, v.x); lo.y = std::min(lo.y, v.y); lo.z = std::min(lo.z, v.z);
            hi.x = std::max(hi.x, v.x); hi.y = std::max(hi.y, v.y); hi.z = std::max(hi.z, v.z);
            sum = vadd(sum, v);
        }
        if (!V.empty()) centroid = vscale(sum, 1.0 / double(V.size()));
        if (hi.x >= lo.x) diag = std::max(1e-9, vlen(vsub(hi, lo)));
        // per-face centroid (average of its fan-triangle vertices).
        faceCtr.assign(faceCount, Vec3{0, 0, 0});
        std::vector<int> fn(faceCount, 0);
        for (std::size_t t = 0; t < T.size(); ++t) {
            const int f = triFace[t];
            for (int k = 0; k < 3; ++k) { faceCtr[f] = vadd(faceCtr[f], V[T[t][k]]); ++fn[f]; }
        }
        for (int f = 0; f < faceCount; ++f) if (fn[f]) faceCtr[f] = vscale(faceCtr[f], 1.0 / double(fn[f]));
    }
};

// Free / non-manifold count over the loop-boundary segments by DIRECTED-USE count:
// a watertight 2-manifold edge is used exactly TWICE (once by each adjacent face's
// coedge, in opposite direction). A seam edge (an EDGE_CURVE used twice by ONE face,
// e.g. a full cylinder's closing seam) is correctly counted as its two uses — a
// closed self-seam, NOT a crack — so a genuinely watertight periodic face reads 0
// free edges. This matches the sew's own free-edge diagnosis.
void edgeCounts(const Soup& s, std::size_t& boundary, std::size_t& freeE, std::size_t& nonM) {
    std::unordered_map<std::uint64_t, int> cnt;
    cnt.reserve(s.segE.size());
    for (std::size_t i = 0; i < s.segE.size(); ++i) ++cnt[ekey(s.segE[i][0], s.segE[i][1])];
    boundary = cnt.size(); freeE = 0; nonM = 0;
    for (const auto& kv : cnt) { if (kv.second != 2) ++freeE; if (kv.second > 2) ++nonM; }
}

// FACE-adjacency BFS orientation. Two faces sharing a loop-boundary edge are
// consistent when they traverse it in OPPOSITE directions; propagate an orientation
// (+1/-1) per face and count irreconcilable conflicts.
std::vector<int> bfsOrientFaces(const Soup& s, int& conflicts) {
    conflicts = 0;
    const int nf = s.faceCount;
    // undirected edge -> incident (face, dir) with dir = +1 if the face's directed
    // segment runs min->max, else -1.
    struct Inc { int face; int dir; };
    std::unordered_map<std::uint64_t, std::vector<Inc>> inc;
    inc.reserve(s.segE.size());
    for (std::size_t i = 0; i < s.segE.size(); ++i) {
        const int a = s.segE[i][0], b = s.segE[i][1];
        if (a == b) continue;
        inc[ekey(a, b)].push_back({s.segFace[i], a < b ? +1 : -1});
    }
    // adjacency list per face.
    std::vector<std::vector<std::pair<int, int>>> adj(nf);  // (neighborFace, want-relation)
    for (const auto& kv : inc) {
        const auto& v = kv.second;
        // dedup by face (a seam edge repeats within one face).
        for (std::size_t i = 0; i < v.size(); ++i)
            for (std::size_t j = i + 1; j < v.size(); ++j) {
                if (v[i].face == v[j].face) continue;
                // consistent (opposite effective dir): o_i*d_i = -(o_j*d_j)
                // => o_j = -o_i * d_i * d_j ; store rel = -d_i*d_j so o_j = o_i*rel.
                const int rel = -v[i].dir * v[j].dir;
                adj[v[i].face].push_back({v[j].face, rel});
                adj[v[j].face].push_back({v[i].face, rel});
            }
    }
    std::vector<int> orient(nf, 0);
    std::vector<int> stack;
    for (int f = 0; f < nf; ++f) {
        if (orient[f] != 0) continue;
        orient[f] = 1; stack.push_back(f);
        while (!stack.empty()) {
            const int c = stack.back(); stack.pop_back();
            for (const auto& nb : adj[c]) {
                const int want = orient[c] * nb.second;
                if (orient[nb.first] == 0) { orient[nb.first] = want; stack.push_back(nb.first); }
                else if (orient[nb.first] != want) ++conflicts;
            }
        }
    }
    return orient;
}

// GWN over the soup with a per-FACE orientation multiplier.
double gwn(const Soup& s, const std::vector<int>& orient, const Vec3& p) {
    double acc = 0.0;
    for (std::size_t t = 0; t < s.T.size(); ++t) {
        double a = solidAngle(p, s.V[s.T[t][0]], s.V[s.T[t][1]], s.V[s.T[t][2]]);
        if (orient[s.triFace[t]] < 0) a = -a;
        acc += a;
    }
    return acc / FOUR_PI;
}

// Find the CLEANEST interior GWN over candidate points (centroid + a bbox grid). A
// consistently-oriented watertight soup reads an INTEGER winding number FAR from all
// surfaces (+/-1 deep inside, 0 outside); near-surface points read fractional
// near-field values. So the deep-interior probe is the candidate whose |GWN| >= 0.6
// and is CLOSEST to a nonzero integer — that value is ~= +/-1 for a watertight soup
// and, for a cracked soup, the best the leaked solid angle can muster (typically far
// from any integer, or never reaching 0.6). `nearOne` counts points reading ~= +/-1.
double bestInteriorGwn(const Soup& s, const std::vector<int>& orient, double& signedOut, int& nearOne) {
    signedOut = 0.0; nearOne = 0;
    double bestCleanliness = 1e9; double bestVal = gwn(s, orient, s.centroid);
    auto consider = [&](const Vec3& p) {
        const double w = gwn(s, orient, p);
        const double aw = std::fabs(w);
        if (std::fabs(aw - 1.0) < 0.25) ++nearOne;
        if (aw < 0.6) return;
        const double nr = std::round(w);
        if (std::fabs(nr) < 1.0) return;
        const double cl = std::fabs(w - nr);        // distance to nearest nonzero integer
        if (cl < bestCleanliness) { bestCleanliness = cl; bestVal = w; }
    };
    consider(s.centroid);
    // Full interior bbox grid: a watertight, consistently-oriented soup reads an
    // exact integer winding number at any deep-interior point, so the cleanest
    // near-integer (|GWN| >= 0.6) grid reading is ~= +/-1. A denser grid is needed to
    // trap the interior of thin/hollow parts a coarse grid would step over.
    const int G = 11;
    for (int i = 1; i < G; ++i)
        for (int j = 1; j < G; ++j)
            for (int k = 1; k < G; ++k)
                consider(Vec3{s.lo.x + (s.hi.x - s.lo.x) * (double(i) / G),
                              s.lo.y + (s.hi.y - s.lo.y) * (double(j) / G),
                              s.lo.z + (s.hi.z - s.lo.z) * (double(k) / G)});
    // CHORD candidates: a point stepped from a face centroid toward the global
    // centroid pierces the material even for a thin plate / hollow shell whose
    // interior a uniform grid steps over. A capped, strided face subset keeps it fast.
    const std::size_t nf = s.faceCtr.size();
    const std::size_t fstride = nf > 100 ? (nf / 100) : 1;
    const double ts[5] = {0.15, 0.3, 0.5, 0.7, 0.85};
    for (std::size_t f = 0; f < nf; f += fstride)
        for (double t : ts)
            consider(vadd(vscale(s.faceCtr[f], 1.0 - t), vscale(s.centroid, t)));
    signedOut = bestVal;
    return std::fabs(bestVal);
}

inline void gatherLoopVerts(const Loop* lp, std::vector<Vec3>& pos, std::vector<const Vertex*>& vid) {
    pos.clear(); vid.clear();
    if (!lp || !lp->first || lp->coedgeCount < 3) return;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) {
        const Vertex* o = c->originVertex();
        if (!o) return;
        pos.push_back(Vec3{o->point.x, o->point.y, o->point.z});
        vid.push_back(o);
        c = c->next;
    }
}

// WELDED soup: fan each face's sewn loops sharing the welded Vertex* identities.
Soup buildWeldedSoup(const Solid& solid) {
    Soup s;
    std::unordered_map<const Vertex*, int> vidx;
    auto idOf = [&](const Vertex* v, const Vec3& p) -> int {
        auto it = vidx.find(v);
        if (it != vidx.end()) return it->second;
        const int id = (int)s.V.size();
        vidx.emplace(v, id); s.V.push_back(p);
        return id;
    };
    std::vector<Vec3> pos; std::vector<const Vertex*> vid;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f) continue;
            const int fid = s.faceCount++;
            auto emit = [&](const Loop* lp) {
                gatherLoopVerts(lp, pos, vid);
                if (pos.size() < 3) return;
                std::vector<int> id(pos.size());
                for (std::size_t i = 0; i < pos.size(); ++i) id[i] = idOf(vid[i], pos[i]);
                for (std::size_t i = 1; i + 1 < pos.size(); ++i) {
                    s.T.push_back({id[0], id[i], id[i + 1]}); s.triFace.push_back(fid);
                }
                for (std::size_t i = 0; i < pos.size(); ++i) {
                    const int a = id[i], b = id[(i + 1) % pos.size()];
                    if (a != b) { s.segE.push_back({a, b}); s.segFace.push_back(fid); }
                }
            };
            emit(f->outerLoop);
            for (const Loop* il : f->innerLoops) emit(il);
        }
    }
    s.finalize();
    return s;
}

inline std::uint64_t quantKey(const Vec3& p, double inv) {
    auto q = [&](double v) -> std::int64_t { return (std::int64_t)std::llround(v * inv); };
    return (std::uint64_t(q(p.x) & 0x1FFFFF) << 42) ^
           (std::uint64_t(q(p.y) & 0x1FFFFF) << 21) ^
            std::uint64_t(q(p.z) & 0x1FFFFF);
}

// NAIVE soup: each CURVED face on its own (u,v) grid, planar faces fanned; vertices
// merged only by near-exact position, so mismatched shared curved edges crack. The
// loop-boundary segments are recorded per QUANTIZED position so cracks show as free
// edges and the orientation BFS still runs.
Soup buildNaiveSoup(const Solid& solid, double diag) {
    Soup s;
    const double inv = 1.0 / std::max(1e-12, 1e-6 * diag);
    std::unordered_map<std::uint64_t, int> vidx;
    auto idOf = [&](const Vec3& p) -> int {
        const std::uint64_t k = quantKey(p, inv);
        auto it = vidx.find(k);
        if (it != vidx.end()) return it->second;
        const int id = (int)s.V.size();
        vidx.emplace(k, id); s.V.push_back(p);
        return id;
    };
    std::vector<Vec3> pos; std::vector<const Vertex*> vid;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (const Face* f : sh->faces) {
            if (!f || !f->surface) continue;
            const int fid = s.faceCount++;
            const Surface* sf = f->surface;
            if (sf->kind == SurfaceKind::Plane) {
                gatherLoopVerts(f->outerLoop, pos, vid);
                if (pos.size() >= 3) {
                    std::vector<int> id(pos.size());
                    for (std::size_t i = 0; i < pos.size(); ++i) id[i] = idOf(pos[i]);
                    for (std::size_t i = 1; i + 1 < pos.size(); ++i) {
                        s.T.push_back({id[0], id[i], id[i + 1]}); s.triFace.push_back(fid);
                    }
                    for (std::size_t i = 0; i < pos.size(); ++i) {
                        const int a = id[i], b = id[(i + 1) % pos.size()];
                        if (a != b) { s.segE.push_back({a, b}); s.segFace.push_back(fid); }
                    }
                }
            } else {
                const int G = 10;
                const double du = f->u1 - f->u0, dv = f->v1 - f->v0;
                std::vector<std::vector<int>> gid(G + 1, std::vector<int>(G + 1));
                for (int a = 0; a <= G; ++a)
                    for (int b = 0; b <= G; ++b)
                        gid[a][b] = idOf(sf->evaluate(f->u0 + du * (double(a) / G),
                                                      f->v0 + dv * (double(b) / G)));
                for (int a = 0; a < G; ++a)
                    for (int b = 0; b < G; ++b) {
                        s.T.push_back({gid[a][b], gid[a + 1][b], gid[a + 1][b + 1]}); s.triFace.push_back(fid);
                        s.T.push_back({gid[a][b], gid[a + 1][b + 1], gid[a][b + 1]}); s.triFace.push_back(fid);
                    }
                // grid perimeter as this face's loop-boundary segments (they crack
                // against the neighbour's mismatched grid perimeter).
                auto seg = [&](int a, int b) { if (a != b) { s.segE.push_back({a, b}); s.segFace.push_back(fid); } };
                for (int a = 0; a < G; ++a) { seg(gid[a][0], gid[a + 1][0]); seg(gid[a + 1][G], gid[a][G]); }
                for (int b = 0; b < G; ++b) { seg(gid[G][b], gid[G][b + 1]); seg(gid[0][b + 1], gid[0][b]); }
            }
        }
    }
    s.finalize();
    return s;
}

void fillReport(const Soup& s, WatertightReport& r) {
    r.faces = (std::size_t)s.faceCount;
    r.triangles = s.T.size();
    edgeCounts(s, r.boundaryEdges, r.freeEdges, r.nonManifoldEdges);
    if (s.T.empty()) return;
    int conflicts = 0;
    const std::vector<int> orient = bfsOrientFaces(s, conflicts);
    r.wnCentroid = gwn(s, orient, s.centroid);
    double signedBest = 0.0; int nearOne = 0;
    r.wnBestInterior = bestInteriorGwn(s, orient, signedBest, nearOne);
    r.interiorNearOne = nearOne;
    r.interiorSamples = 1 + 6 * 6 * 6;   // centroid + interior bbox grid
    r.orientationConflicts = conflicts;
    // WATERTIGHT = closed (no free/non-manifold loop edges) AND the interior winding
    // number resolves to a clean +/-1 (a consistently-oriented closed 2-cycle exists).
    // Orientability of the RAW coedge traversal is a separate property (conflicts):
    // the reader's per-face planar-loop reversal makes the raw loop orientation
    // globally inconsistent, which is exactly why the BFS re-orientation is needed
    // before the GWN reads a clean +/-1 — the soup is still geometrically watertight.
    r.watertight = (r.freeEdges == 0 && r.nonManifoldEdges == 0 && r.wnBestInterior > 0.75);
}

// Representative on-surface sample points + outward normals for the reorient vote.
void faceSamples(const Face* f, std::vector<Vec3>& P, std::vector<Vec3>& N) {
    P.clear(); N.clear();
    const Surface* s = f->surface;
    if (!s) return;
    if (s->kind == SurfaceKind::Plane) {
        std::vector<Vec3> pos; std::vector<const Vertex*> vid;
        gatherLoopVerts(f->outerLoop, pos, vid);
        if (pos.size() < 3) return;
        Vec3 ctr{0, 0, 0};
        for (const Vec3& p : pos) ctr = vadd(ctr, p);
        ctr = vscale(ctr, 1.0 / double(pos.size()));
        const Vec3 n = s->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));
        if (vlen(n) < 1e-9) return;
        const Vec3 nn = vnorm(n);
        P.push_back(ctr); N.push_back(nn);
        for (std::size_t k = 0; k < pos.size(); k += std::max<std::size_t>(1, pos.size() / 3)) {
            P.push_back(vadd(vscale(ctr, 0.7), vscale(pos[k], 0.3)));
            N.push_back(nn);
        }
    } else {
        const int G = 3;
        const double du = f->u1 - f->u0, dv = f->v1 - f->v0;
        for (int a = 1; a < G; ++a)
            for (int b = 1; b < G; ++b) {
                const double u = f->u0 + du * (double(a) / G);
                const double v = f->v0 + dv * (double(b) / G);
                const Vec3 n = s->normalAt(u, v);
                if (vlen(n) > 1e-9) { P.push_back(s->evaluate(u, v)); N.push_back(vnorm(n)); }
            }
    }
}

} // namespace

WatertightReport probeWatertightWelded(const Solid& solid) {
    Soup s = buildWeldedSoup(solid);
    WatertightReport r;
    fillReport(s, r);
    return r;
}

WatertightReport probeWatertightNaive(const Solid& solid) {
    Soup w = buildWeldedSoup(solid);
    Soup s = buildNaiveSoup(solid, w.diag);
    WatertightReport r;
    fillReport(s, r);
    return r;
}

ReorientResult reorientByGWN(const Solid& solid) {
    ReorientResult out;
    Soup s = buildWeldedSoup(solid);
    std::size_t bE = 0, freeE = 0, nonM = 0;
    edgeCounts(s, bE, freeE, nonM);
    // Cheap gate first: only a CLOSED, cleanly-orientable soup is a trustworthy
    // orientation oracle. Skip the expensive interior GWN search otherwise (NO-OP).
    if (freeE != 0 || nonM != 0) return out;
    int conflicts = 0;
    const std::vector<int> orient = bfsOrientFaces(s, conflicts);
    if (conflicts != 0) return out;
    double signedBest = 0.0; int nearOne = 0;
    const double best = bestInteriorGwn(s, orient, signedBest, nearOne);
    out.wnSign = (signedBest >= 0.0) ? 1.0 : -1.0;
    out.reliable = (best > 0.8);
    if (!out.reliable) return out;

    const double eps = 2.0e-3 * s.diag;
    const double sgn = out.wnSign;
    std::vector<Vec3> P, N;
    for (const Shell* sh : solid.shells) {
        if (!sh) continue;
        for (Face* f : sh->faces) {
            if (!f || !f->surface) continue;
            ++out.faces;
            faceSamples(f, P, N);
            if (P.empty()) continue;
            double vote = 0.0; int valid = 0;
            for (std::size_t k = 0; k < P.size(); ++k) {
                const Vec3 pin = vsub(P[k], vscale(N[k], eps));   // against the normal
                const Vec3 pout = vadd(P[k], vscale(N[k], eps));  // along the normal
                const double inScore = gwn(s, orient, pin) * sgn;   // ~1 inside
                const double outScore = gwn(s, orient, pout) * sgn; // ~0 outside
                const double d = inScore - outScore;   // >0 => normal points OUT (keep)
                if (std::fabs(d) > 0.35) { vote += d; ++valid; }
            }
            if (valid > 0 && vote < -0.5) { f->surface->reversed = !f->surface->reversed; ++out.flipped; }
        }
    }
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
