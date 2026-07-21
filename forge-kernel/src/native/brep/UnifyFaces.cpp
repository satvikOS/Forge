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
#include "forge/native/brep/MassProps.hpp"   // massProperties — curved-merge volume safety gate

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
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

// ===========================================================================
// CURVED (co-CYLINDRICAL) UNIFY — merge a native cylinder's N angular strip
// faces back into ONE periodic cylindrical face. See the header for scope.
// ===========================================================================
namespace {

constexpr double kCylRadTol = 1e-9;   // |r1-r2| for "cone is a cylinder"
constexpr double kTwoPi     = 2.0 * 3.14159265358979323846;
constexpr double kFullTol   = 1e-6;   // |Δu - 2π| for "full-2π lateral"

// Is `f` a CYLINDER lateral strip? (a genuine Cylinder, or the equal-radii Cone the
// primitive builder emits for buildCylinder = buildCone(r,r,h)).
bool isCylFace(const Face* f) {
    const Surface* s = f ? f->surface : nullptr;
    if (!s) return false;
    if (s->kind == SurfaceKind::Cylinder) return true;
    if (s->kind == SurfaceKind::Cone &&
        std::fabs(s->r1 - s->r2) <= kCylRadTol * std::max(1.0, std::fabs(s->r1)))
        return true;
    return false;
}

// Quantised geometric key of the INFINITE cylinder a face lies on (radius +
// sign-normalised axis direction + the axis line's foot-point nearest the world
// origin) — two faces on the SAME cylinder share this key even with distinct
// Surface copies. Mirrors NativeOcctBridge::cylinderKey so grouping agrees with the
// bridge that later counts the merged solid.
std::string cylKey(const Surface* s) {
    double ax = s->axis.x, ay = s->axis.y, az = s->axis.z;
    const double an = std::sqrt(ax * ax + ay * ay + az * az);
    if (an < 1e-12) return "bad";
    ax /= an; ay /= an; az /= an;
    const double sgn = std::fabs(ax) > 1e-9 ? ax : (std::fabs(ay) > 1e-9 ? ay : az);
    if (sgn < 0.0) { ax = -ax; ay = -ay; az = -az; }
    const double dp = s->origin.x * ax + s->origin.y * ay + s->origin.z * az;
    const double fx = s->origin.x - dp * ax;
    const double fy = s->origin.y - dp * ay;
    const double fz = s->origin.z - dp * az;
    auto q = [](double v) -> long long { return std::llround(v / 1e-6); };
    char buf[256];
    std::snprintf(buf, sizeof(buf), "C:%lld:%lld:%lld:%lld:%lld:%lld:%lld",
                  q(s->r1), q(ax), q(ay), q(az), q(fx), q(fy), q(fz));
    return std::string(buf);
}

} // namespace

// ---------------------------------------------------------------------------
bool nativeUnifyCurvedEligible(const Solid& s) {
    if (s.shells.size() != 1) return false;
    const Shell* sh = s.shells[0];
    if (sh->faces.empty()) return false;

    int nPlane = 0, nCyl = 0;
    std::string key0;
    bool haveKey = false;
    for (const Face* f : sh->faces) {
        if (!f->surface) return false;
        if (!f->outerLoop || !f->outerLoop->first) return false;
        if (f->outerLoop->coedgeCount < 3) return false;
        if (!f->innerLoops.empty()) return false;   // holed face -> defer to OCCT
        if (f->boolHoled) return false;
        if (f->regionUV || f->paramTri) return false;
        const SurfaceKind k = f->surface->kind;
        if (k == SurfaceKind::Plane) {
            ++nPlane;
        } else if (isCylFace(f)) {
            const std::string key = cylKey(f->surface);
            if (!haveKey) { key0 = key; haveKey = true; }
            else if (key != key0) return false;      // a 2nd cylinder (tube) -> defer
            ++nCyl;
        } else {
            return false;                            // sphere/cone/torus/nurbs -> defer
        }
    }
    // A single co-cylindrical group of >= 2 strips + EXACTLY the two planar caps.
    // (A tube's 2N annular quads or a bored plate's box walls make nPlane != 2.)
    return nCyl >= 2 && nPlane == 2;
}

// ---------------------------------------------------------------------------
Solid* unifySameDomainCurved(const Solid& s,
                             std::shared_ptr<TopologyBuilder>& outOwner) {
    if (!nativeUnifyCurvedEligible(s)) return nullptr;
    const Shell* sh = s.shells[0];

    // Partition faces into the planar caps and the single co-cylindrical group.
    std::vector<Face*> planarFaces;
    std::vector<Face*> cylFaces;
    for (Face* f : sh->faces) {
        if (isCylFace(f)) cylFaces.push_back(f);
        else              planarFaces.push_back(f);   // Plane (eligibility guaranteed)
    }
    if (cylFaces.size() < 2 || planarFaces.size() != 2) return nullptr;
    std::unordered_set<const Face*> cylSet(cylFaces.begin(), cylFaces.end());

    // 1. Classify the group's edges: INTERIOR (both incident faces cylindrical — the
    //    vertical seams between adjacent strips) vs BOUNDARY (the other face is a
    //    cap). Collect the group's boundary COEDGES (already oriented for the lateral
    //    face) to re-trace, and the interior edges to source the seam from.
    std::vector<Coedge*> bnd;
    std::vector<Edge*> interior;
    std::unordered_set<const Edge*> seen;
    double minU0 = 1e300, maxU1 = -1e300, minV0 = 1e300, maxV1 = -1e300;
    for (Face* f : cylFaces) {
        minU0 = std::min(minU0, f->u0); maxU1 = std::max(maxU1, f->u1);
        minV0 = std::min(minV0, f->v0); maxV1 = std::max(maxV1, f->v1);
        Coedge* c = f->outerLoop->first;
        for (std::size_t k = 0; k < f->outerLoop->coedgeCount; ++k, c = c->next) {
            Edge* e = c->edge;
            if (!e || !e->coedgeA || !e->coedgeB) return nullptr;   // open edge
            Face* fa = faceOfCoedge(e->coedgeA);
            Face* fb = faceOfCoedge(e->coedgeB);
            const bool bothCyl = fa && fb && cylSet.count(fa) && cylSet.count(fb);
            if (bothCyl) {
                if (seen.insert(e).second) interior.push_back(e);
            } else {
                bnd.push_back(c);   // this coedge is on the lateral boundary
            }
        }
    }
    // A full 2π lateral: the strips' angular trim windows must tile a full turn.
    if (std::fabs((maxU1 - minU0) - kTwoPi) > kFullTol) return nullptr;
    if (bnd.size() < 6 || interior.empty()) return nullptr;

    // 2. Trace the boundary coedges into closed vertex rings (origin->dest chaining,
    //    on the ORIGINAL vertices). A full cylinder yields EXACTLY two rings (the
    //    bottom + top circles), each in the lateral face's boundary orientation.
    std::unordered_map<Vertex*, std::vector<Coedge*>> byOrigin;
    for (Coedge* c : bnd) byOrigin[c->originVertex()].push_back(c);
    std::unordered_set<Coedge*> used;
    std::vector<std::vector<Vertex*>> rings;
    for (Coedge* start : bnd) {
        if (used.count(start)) continue;
        std::vector<Vertex*> ring;
        Coedge* c = start;
        std::size_t guard = 0;
        while (true) {
            if (used.count(c)) return nullptr;                // tangled boundary
            used.insert(c);
            ring.push_back(c->originVertex());
            Vertex* dst = c->destVertex();
            auto it = byOrigin.find(dst);
            if (it == byOrigin.end()) return nullptr;         // open boundary
            Coedge* nxt = nullptr;
            for (Coedge* cand : it->second)
                if (!used.count(cand)) { nxt = cand; break; }
            if (!nxt) {                                       // ring closes back
                if (dst != ring.front()) return nullptr;
                break;
            }
            c = nxt;
            if (++guard > bnd.size() + 4) return nullptr;
        }
        if (ring.size() < 3) return nullptr;
        rings.push_back(std::move(ring));
    }
    if (rings.size() != 2) return nullptr;                    // not a full 2-ring tube

    // 3. Seam: an interior (vertical) edge joining a vertex of ring 0 to a vertex of
    //    ring 1 becomes the single kept seam edge (the rest are dropped).
    std::unordered_map<Vertex*, int> ringOf;
    for (int r = 0; r < 2; ++r)
        for (Vertex* v : rings[r]) ringOf[v] = r;
    Vertex* seamA = nullptr;   // on ring 0
    Vertex* seamB = nullptr;   // on ring 1
    for (Edge* e : interior) {
        auto ia = ringOf.find(e->start), ib = ringOf.find(e->end);
        if (ia == ringOf.end() || ib == ringOf.end()) continue;
        if (ia->second == 0 && ib->second == 1) { seamA = e->start; seamB = e->end; break; }
        if (ia->second == 1 && ib->second == 0) { seamA = e->end;   seamB = e->start; break; }
    }
    if (!seamA || !seamB) return nullptr;

    // 4. Rebuild a fresh closed 2-manifold solid: copy the planar caps 1:1, and emit
    //    ONE periodic lateral face whose loop splices the two rings through the seam.
    auto ob = std::make_shared<TopologyBuilder>();
    Solid* solid = ob->makeSolid();
    Shell* shell = ob->makeShell();
    ob->addShellToSolid(solid, shell);

    std::unordered_map<Vertex*, Vertex*> vmap;
    auto mapV = [&](Vertex* old) -> Vertex* {
        auto it = vmap.find(old);
        if (it != vmap.end()) return it->second;
        Vertex* nv = ob->makeVertex(old->point);
        nv->tolerance = old->tolerance;
        vmap.emplace(old, nv);
        return nv;
    };
    auto copySurface = [&](const Surface* src) -> Surface* {
        Surface* d = ob->makeSurface();
        *d = *src;   // POD copy: kind/frame/radii/param/reversed/isDisk/nurbs
        return d;
    };
    auto copyLoopVerts = [&](const Loop* lp) {
        std::vector<Vertex*> out;
        if (!lp || !lp->first) return out;
        Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next)
            out.push_back(mapV(c->originVertex()));
        return out;
    };

    // 4a. planar caps — faithful 1:1 copy (surface frame, disk annotation, trim,
    //     vertexUV, boolHoled), so their exact mass / circle-detected bridge is
    //     unchanged.
    for (Face* pf : planarFaces) {
        std::vector<Vertex*> ring = copyLoopVerts(pf->outerLoop);
        if (ring.size() < 3) return nullptr;
        Face* nf = ob->makeFace();
        ob->addFaceToShell(shell, nf);
        ob->addOuterLoopToFace(nf, ring);
        nf->surface = copySurface(pf->surface);
        nf->u0 = pf->u0; nf->u1 = pf->u1; nf->v0 = pf->v0; nf->v1 = pf->v1;
        nf->vertexUV = pf->vertexUV;
        nf->boolHoled = pf->boolHoled;
    }

    // 4b. merged lateral: ring0 (from seamA) + seam up + ring1 (from seamB) + seam
    //     down. Rotating each traced ring to start at its seam vertex, the origin
    //     sequence [ring0.., seamA, ring1.., seamB] closes with the seam edge used
    //     once each direction (the periodic face seam).
    auto rotated = [](const std::vector<Vertex*>& r, Vertex* startAt) {
        std::vector<Vertex*> out;
        std::size_t s = 0;
        for (; s < r.size(); ++s) if (r[s] == startAt) break;
        if (s == r.size()) return out;   // startAt not in ring
        for (std::size_t i = 0; i < r.size(); ++i) out.push_back(r[(s + i) % r.size()]);
        return out;
    };
    std::vector<Vertex*> r0 = rotated(rings[0], seamA);
    std::vector<Vertex*> r1 = rotated(rings[1], seamB);
    if (r0.empty() || r1.empty()) return nullptr;

    std::vector<Vertex*> mergedRing;
    mergedRing.reserve(r0.size() + r1.size() + 2);
    for (Vertex* v : r0) mergedRing.push_back(mapV(v));   // bottom ring [seamA..]
    mergedRing.push_back(mapV(seamA));                    // seam up start
    for (Vertex* v : r1) mergedRing.push_back(mapV(v));   // top ring [seamB..]
    mergedRing.push_back(mapV(seamB));                    // seam down start

    Face* lat = ob->makeFace();
    ob->addFaceToShell(shell, lat);
    ob->addOuterLoopToFace(lat, mergedRing);
    lat->surface = copySurface(cylFaces[0]->surface);
    lat->u0 = minU0; lat->u1 = maxU1;   // [0, 2π] full lateral
    lat->v0 = minV0; lat->v1 = maxV1;
    // Mass over the full-2π lateral via the REGION integrator (scan-line, ~42 angular
    // strips) NOT a single tensor-Gauss panel: a full period of the single-component
    // divergence integrand (r·cos²θ …) is under-resolved by one 8-node Gauss panel
    // over [0,2π] (off ~4e-6), but the strip-subdivided region path recovers the
    // exact analytic volume — matching the 128-strip primitive to round-off. The
    // region is the axis-aligned (u,v) rectangle [u0,u1]×[v0,v1].
    lat->regionUV = true;
    lat->regionOuterUV = {
        {lat->u0, lat->v0}, {lat->u1, lat->v0},
        {lat->u1, lat->v1}, {lat->u0, lat->v1}};

    if (!ob->isClosedTwoManifold()) return nullptr;       // never emit a wrong shape

    // Safety: the merge must PRESERVE the shape exactly (both native mass, no OCCT).
    const double volRef = massProperties(s).volume;
    const double volNew = massProperties(*solid).volume;
    if (!(volRef > 1e-12)) return nullptr;
    if (std::fabs(volNew - volRef) > 1e-6 * std::max(1.0, std::fabs(volRef)))
        return nullptr;

    outOwner = std::move(ob);
    return solid;
}

} // namespace brep
} // namespace native
} // namespace forge
