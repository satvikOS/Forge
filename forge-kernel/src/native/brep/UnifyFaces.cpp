// forge/native/brep/UnifyFaces.cpp
//
// Native "unify same domain" for COPLANAR PLANAR faces — the in-house
// replacement for OCCT ShapeUpgrade_UnifySameDomain on planar merges. See the
// header for scope / honesty. Pure C++20, no external deps.
//
// Method (per shell):
//   1. Compute each planar face's outward plane (normal + signed offset).
//   2. An edge is INTERIOR iff its two adjacent faces are COPLANAR (same normal
//      within tol AND same offset within tol). Union those faces — the connected
//      components under "shared interior edge" are the coplanar regions to merge.
//   3. For each component collect the BOUNDARY coedges (edge not interior) and
//      trace them into ordered loop(s). One loop => outer; extra loops => holes.
//   4. GLOBAL collinear cleanup: any vertex with exactly two distinct neighbours
//      that are collinear through it is a redundant mid-edge point (created when
//      a shared edge was dropped) — remove it so the merged face has the minimal
//      edge/vertex count (this is what makes the count match OCCT exactly).
//   5. Rebuild a fresh, closed 2-manifold Solid via TopologyBuilder (shared
//      edges / mated coedges), attaching the plane surface to each merged face.
//
// Coincident corners in the input share the SAME Vertex* (the boolean welds them
// bit-identically), so adjacency/incidence is keyed by Vertex* — exact, no
// tolerance clustering needed for the topology.

#include "forge/native/brep/UnifyFaces.hpp"
#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kNrmTol = 1e-7;   // 1 - dot(n_a, n_b) for "same normal"
constexpr double kOffTol = 1e-6;   // |offset_a - offset_b| for "same plane"
constexpr double kColSin = 1e-7;   // sine of the turn angle for "collinear"

inline Vec3 P2V(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

// Ordered outer-loop vertices of a face (origin vertex of each coedge, in ring
// order). Empty if the loop is malformed.
std::vector<Vertex*> loopRing(const Loop* lp) {
    std::vector<Vertex*> r;
    if (!lp || !lp->first) return r;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        if (!c) { r.clear(); return r; }
        r.push_back(c->originVertex());
        c = c->next;
    }
    return r;
}

// The face that owns a coedge (via its loop).
inline Face* faceOfCoedge(const Coedge* c) {
    return (c && c->loop) ? c->loop->face : nullptr;
}

Vec3 faceNormal(const Face* f) {
    return f->surface->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));
}

// Union-find over face indices.
struct UF {
    std::vector<int> p;
    void init(int n) { p.resize(n); for (int i = 0; i < n; ++i) p[i] = i; }
    int find(int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; }
    void uni(int a, int b) { p[find(a)] = find(b); }
};

bool sameNormal(const Vec3& a, const Vec3& b) { return vdot(a, b) >= 1.0 - kNrmTol; }

// Are (prev - v) and (next - v) anti-parallel through v (v a straight mid point)?
bool collinearThrough(const Vertex* prev, const Vertex* v, const Vertex* next) {
    Vec3 a = vsub(P2V(v->point), P2V(prev->point));   // prev -> v
    Vec3 b = vsub(P2V(next->point), P2V(v->point));   // v -> next
    double la = vlen(a), lb = vlen(b);
    if (la <= 0.0 || lb <= 0.0) return true;           // degenerate => droppable
    double sinMag = vlen(vcross(a, b)) / (la * lb);
    if (sinMag > kColSin) return false;                // a real corner
    return vdot(a, b) > 0.0;                            // same direction (not a fold)
}

} // namespace

// ---------------------------------------------------------------------------
bool nativeUnifyPlanarEligible(const Solid& s) {
    if (s.shells.size() != 1) return false;
    const Shell* sh = s.shells[0];
    if (sh->faces.empty()) return false;
    for (const Face* f : sh->faces) {
        if (!f->surface) return false;
        if (f->surface->kind != SurfaceKind::Plane) return false;
        if (f->surface->isDisk) return false;
        if (f->boolHoled) return false;
        if (!f->innerLoops.empty()) return false;
        if (!f->outerLoop || !f->outerLoop->first) return false;
        if (f->outerLoop->coedgeCount < 3) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
Solid* unifySameDomainPlanar(const Solid& s,
                             std::shared_ptr<TopologyBuilder>& outOwner) {
    if (!nativeUnifyPlanarEligible(s)) return nullptr;
    const Shell* sh = s.shells[0];

    const int nF = static_cast<int>(sh->faces.size());
    std::vector<Face*> faces(sh->faces.begin(), sh->faces.end());
    std::unordered_map<const Face*, int> idxOf;
    idxOf.reserve(nF * 2);
    for (int i = 0; i < nF; ++i) idxOf[faces[i]] = i;

    // 1. plane of each face
    std::vector<Vec3> nrm(nF);
    std::vector<double> off(nF);
    for (int i = 0; i < nF; ++i) {
        nrm[i] = faceNormal(faces[i]);
        Vertex* v0 = faces[i]->outerLoop->first->originVertex();
        off[i] = vdot(nrm[i], P2V(v0->point));
    }

    // 2. interior edges + union coplanar neighbours
    std::unordered_set<const Edge*> interior;
    std::unordered_set<const Edge*> seen;
    UF uf; uf.init(nF);
    for (int i = 0; i < nF; ++i) {
        Coedge* c = faces[i]->outerLoop->first;
        for (std::size_t k = 0; k < faces[i]->outerLoop->coedgeCount; ++k, c = c->next) {
            Edge* e = c->edge;
            if (!e || !seen.insert(e).second) continue;   // handle each edge once
            if (!e->coedgeA || !e->coedgeB) return nullptr; // open edge: not closed
            Face* fa = faceOfCoedge(e->coedgeA);
            Face* fb = faceOfCoedge(e->coedgeB);
            auto ia = idxOf.find(fa), ib = idxOf.find(fb);
            if (ia == idxOf.end() || ib == idxOf.end()) return nullptr;
            if (ia->second == ib->second) continue;        // both coedges same face
            if (sameNormal(nrm[ia->second], nrm[ib->second]) &&
                std::fabs(off[ia->second] - off[ib->second]) < kOffTol) {
                interior.insert(e);
                uf.uni(ia->second, ib->second);
            }
        }
    }

    // 3. group faces by component
    std::unordered_map<int, std::vector<int>> comps;
    for (int i = 0; i < nF; ++i) comps[uf.find(i)].push_back(i);

    // Per-component output: a list of loops (each an ordered vertex ring) with
    // loop[0] the outer boundary; plus the component's plane normal.
    struct OutFace {
        std::vector<std::vector<Vertex*>> loops; // [0] outer, rest holes
        Vec3 normal;
    };
    std::vector<OutFace> outFaces;
    outFaces.reserve(comps.size());

    for (auto& kv : comps) {
        const std::vector<int>& comp = kv.second;
        Vec3 n = nrm[comp[0]];

        // boundary coedges of this component (edge not interior)
        std::vector<Coedge*> bnd;
        for (int fi : comp) {
            Coedge* c = faces[fi]->outerLoop->first;
            for (std::size_t k = 0; k < faces[fi]->outerLoop->coedgeCount;
                 ++k, c = c->next) {
                if (interior.find(c->edge) == interior.end()) bnd.push_back(c);
            }
        }
        if (bnd.size() < 3) return nullptr;

        // trace boundary coedges into closed loops by origin->dest chaining
        std::unordered_map<Vertex*, std::vector<Coedge*>> byOrigin;
        for (Coedge* c : bnd) byOrigin[c->originVertex()].push_back(c);
        std::unordered_set<Coedge*> used;

        OutFace of;
        of.normal = n;
        for (Coedge* start : bnd) {
            if (used.count(start)) continue;
            std::vector<Vertex*> ring;
            Coedge* c = start;
            std::size_t guard = 0;
            while (true) {
                if (used.count(c)) return nullptr;         // revisited: tangled
                used.insert(c);
                ring.push_back(c->originVertex());
                Vertex* dst = c->destVertex();
                auto it = byOrigin.find(dst);
                if (it == byOrigin.end()) return nullptr;   // open boundary
                Coedge* nxt = nullptr;
                for (Coedge* cand : it->second)
                    if (!used.count(cand)) { nxt = cand; break; }
                if (!nxt) { // dst must close back to the ring start
                    if (dst != ring.front()) return nullptr;
                    break;
                }
                c = nxt;
                if (++guard > bnd.size() + 4) return nullptr;
            }
            if (ring.size() < 3) return nullptr;
            of.loops.push_back(std::move(ring));
        }
        if (of.loops.empty()) return nullptr;

        // pick the largest loop as the outer boundary (holes are smaller)
        if (of.loops.size() > 1) {
            // 2D plane frame for signed area
            Vec3 u = vnorm(vsub(P2V(of.loops[0][1]->point), P2V(of.loops[0][0]->point)));
            Vec3 w = vcross(n, u);
            auto area2 = [&](const std::vector<Vertex*>& lp) {
                double A = 0.0;
                for (std::size_t i = 0; i < lp.size(); ++i) {
                    const Vec3 a = vsub(P2V(lp[i]->point), P2V(lp[0]->point));
                    const Vec3 b = vsub(P2V(lp[(i + 1) % lp.size()]->point),
                                        P2V(lp[0]->point));
                    A += vdot(u, a) * vdot(w, b) - vdot(u, b) * vdot(w, a);
                }
                return std::fabs(A);
            };
            std::size_t best = 0; double bestA = area2(of.loops[0]);
            for (std::size_t i = 1; i < of.loops.size(); ++i) {
                double a = area2(of.loops[i]);
                if (a > bestA) { bestA = a; best = i; }
            }
            if (best != 0) std::swap(of.loops[0], of.loops[best]);
        }
        outFaces.push_back(std::move(of));
    }

    // 4. GLOBAL collinear-vertex cleanup (iterate to a fixpoint)
    for (int pass = 0; pass < nF + 4; ++pass) {
        // neighbours of every vertex across ALL loops
        std::unordered_map<Vertex*, std::unordered_set<Vertex*>> nb;
        for (const OutFace& of : outFaces)
            for (const auto& lp : of.loops)
                for (std::size_t i = 0; i < lp.size(); ++i) {
                    Vertex* a = lp[i];
                    Vertex* b = lp[(i + 1) % lp.size()];
                    nb[a].insert(b);
                    nb[b].insert(a);
                }
        std::unordered_set<Vertex*> removable;
        for (auto& kv : nb) {
            if (kv.second.size() != 2) continue;
            auto it = kv.second.begin();
            Vertex* p = *it++;
            Vertex* q = *it;
            if (collinearThrough(p, kv.first, q)) removable.insert(kv.first);
        }
        if (removable.empty()) break;
        // drop removable vertices from every loop
        bool changed = false;
        for (OutFace& of : outFaces) {
            for (auto& lp : of.loops) {
                std::vector<Vertex*> keep;
                keep.reserve(lp.size());
                for (Vertex* v : lp)
                    if (!removable.count(v)) keep.push_back(v);
                if (keep.size() != lp.size()) changed = true;
                if (keep.size() < 3) return nullptr;   // over-collapsed: bail
                lp.swap(keep);
            }
        }
        if (!changed) break;
    }

    // 5. rebuild a fresh closed 2-manifold solid
    auto ob = std::make_shared<TopologyBuilder>();
    Solid* solid = ob->makeSolid();
    Shell* shell = ob->makeShell();
    ob->addShellToSolid(solid, shell);

    std::unordered_map<Vertex*, Vertex*> vmap; // old vertex -> new vertex
    auto mapV = [&](Vertex* old) -> Vertex* {
        auto it = vmap.find(old);
        if (it != vmap.end()) return it->second;
        Vertex* nv = ob->makeVertex(old->point);
        vmap.emplace(old, nv);
        return nv;
    };

    for (const OutFace& of : outFaces) {
        std::vector<Vertex*> outer;
        outer.reserve(of.loops[0].size());
        for (Vertex* v : of.loops[0]) outer.push_back(mapV(v));

        Face* nf = ob->makeFace();
        ob->addFaceToShell(shell, nf);
        ob->addOuterLoopToFace(nf, outer);

        for (std::size_t li = 1; li < of.loops.size(); ++li) {
            std::vector<Vertex*> inner;
            inner.reserve(of.loops[li].size());
            for (Vertex* v : of.loops[li]) inner.push_back(mapV(v));
            ob->addInnerLoopToFace(nf, inner);
        }

        // attach the plane surface (mirrors Primitives::attachPlanarFace)
        Surface* srf = ob->makeSurface();
        srf->kind = SurfaceKind::Plane;
        Vec3 origin = P2V(outer[0]->point);
        Vec3 uDir{1, 0, 0};
        for (std::size_t i = 1; i < outer.size(); ++i) {
            Vec3 e = vsub(P2V(outer[i]->point), origin);
            if (vlen(e) > 1e-12) { uDir = vnorm(e); break; }
        }
        Vec3 vDir = vcross(of.normal, uDir);
        srf->origin = origin;
        srf->refDir = uDir;
        srf->axis = vnorm(vcross(uDir, vDir));
        srf->reversed = (vdot(srf->axis, of.normal) < 0.0);
        nf->surface = srf;
        nf->vertexUV.clear();
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        for (std::size_t i = 0; i < outer.size(); ++i) {
            Vec3 rel = vsub(P2V(outer[i]->point), origin);
            double pu = vdot(rel, srf->refDir);
            double pv = vdot(rel, srf->binormal());
            nf->vertexUV.push_back({pu, pv});
            if (i == 0) { u0 = u1 = pu; v0 = v1 = pv; }
            else {
                u0 = std::min(u0, pu); u1 = std::max(u1, pu);
                v0 = std::min(v0, pv); v1 = std::max(v1, pv);
            }
        }
        nf->u0 = u0; nf->u1 = u1; nf->v0 = v0; nf->v1 = v1;
        if (of.loops.size() > 1) nf->boolHoled = true; // hole-aware mass/tess
    }

    if (!ob->isClosedTwoManifold()) return nullptr;    // never emit a wrong shape

    outOwner = std::move(ob);
    return solid;
}

} // namespace brep
} // namespace native
} // namespace forge
