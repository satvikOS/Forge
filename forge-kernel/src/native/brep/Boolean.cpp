// forge/native/brep/Boolean.cpp
//
// Implementation of IN-HOUSE KERNEL STEP 2 — the OCCT-free native B-rep boolean
// (Boolean.hpp). See the header for the full strategy and the HONEST map. Pure
// C++20 (+ the existing forge native headers), no external deps. No OCCT, no WASM.
//
// PIPELINE (analytic-first, mesh-fallback-flagged):
//   booleanSolidAnalytic(A,B,op):
//     for each overlapping face-pair (fA,fB):
//       intersectSurfaces(*fA->surface,*fB->surface)   -- exact 3-D SSI
//         -> if any needed pair is NOT closed-form: abort analytic, use fallback.
//       imprint the clipped curve onto BOTH faces in their (u,v) domains (CDT),
//         the sub-faces KEEP the parent Surface (plane stays plane, cylinder side
//         stays the same cylinder).
//     classify each sub-face IN/OUT of the OTHER solid (ray-cast point-in-solid),
//     select + orient per op, STITCH (shared cut vertices welded) into a closed
//     2-manifold Solid; validate.
//   On any analytic-envelope miss -> booleanSolidMeshFallback (flagged), which is
//   the proven tess -> meshBooleanNative -> reconstruct(planar) path.

#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/SurfaceIntersect.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/geom/ConstrainedDelaunay2D.hpp"
#include "forge/native/mesh/MeshBooleanNative.hpp"
#include "forge/native/mesh/MeshBooleanExact.hpp"   // K2 exact escalation (near-triple-point)

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <map>
#include <set>
#include <tuple>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

// ===========================================================================
// Small geometry utilities (built on the brep::Vec3 helpers in Surface.hpp).
// ===========================================================================
struct Aabb {
    Vec3 lo{ std::numeric_limits<double>::max(),  std::numeric_limits<double>::max(),  std::numeric_limits<double>::max()};
    Vec3 hi{-std::numeric_limits<double>::max(), -std::numeric_limits<double>::max(), -std::numeric_limits<double>::max()};
    void add(const Vec3& p) {
        lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
        hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
    }
    bool overlaps(const Aabb& o, double pad) const {
        return lo.x - pad <= o.hi.x && hi.x + pad >= o.lo.x &&
               lo.y - pad <= o.hi.y && hi.y + pad >= o.lo.y &&
               lo.z - pad <= o.hi.z && hi.z + pad >= o.lo.z;
    }
};

// Ordered 3-D corner points of a face's outer loop (origin vertices in ring order).
std::vector<Vec3> faceRing(const Face* f) {
    std::vector<Vec3> pts;
    const Loop* lp = f->outerLoop;
    if (!lp) return pts;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        const Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
        c = c->next;
    }
    return pts;
}

Aabb faceAabb(const Face* f) {
    Aabb bb;
    for (const Vec3& p : faceRing(f)) bb.add(p);
    return bb;
}

// Ordered 3-D corner points of an arbitrary loop (outer or inner).
std::vector<Vec3> loopRing3D(const Loop* lp) {
    std::vector<Vec3> pts;
    if (!lp || !lp->first) return pts;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next) {
        const Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
    }
    return pts;
}

// ===========================================================================
// PLANAR 2-D helpers (for the holed-face inner-loop path). A planar face is
// embedded into 2-D via an orthonormal in-plane basis so the cut fragments can
// be welded, assembled into closed rings, and point-in-region tested exactly.
// ===========================================================================
void planeBasis(const Vec3& n, Vec3& e1, Vec3& e2) {
    // Pick the world axis least aligned with n, then Gram-Schmidt it into the plane.
    Vec3 a = (std::fabs(n.x) <= std::fabs(n.y) && std::fabs(n.x) <= std::fabs(n.z))
                 ? Vec3{1, 0, 0}
                 : (std::fabs(n.y) <= std::fabs(n.z) ? Vec3{0, 1, 0} : Vec3{0, 0, 1});
    e1 = vnorm(vsub(a, vscale(n, vdot(a, n))));
    e2 = vcross(n, e1);
}
inline geom::Point2 proj2(const Vec3& p, const Vec3& o, const Vec3& e1, const Vec3& e2) {
    Vec3 d = vsub(p, o);
    return geom::Point2{vdot(d, e1), vdot(d, e2)};
}
// Even-odd point-in-polygon over a 2-D ring.
bool pointInPoly2(const std::vector<geom::Point2>& poly, double qx, double qy) {
    bool in = false;
    std::size_t n = poly.size();
    if (n < 3) return false;
    for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
        double xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > qy) != (yj > qy)) &&
            (qx < (xj - xi) * (qy - yi) / (yj - yi) + xi))
            in = !in;
    }
    return in;
}

// Try to merge the imprint curve fragments (`curves3D`) of a PLANAR face into one
// or more CLOSED rings that lie STRICTLY INSIDE the face's `boundary` loop — the
// signature of a drilled hole (a circle/closed loop fully inside the face). On
// success `loops` holds each closed ring (ordered 3-D points) and the function
// returns true. It returns false (loops cleared) when ANY fragment endpoint is a
// boundary-reaching open cut (degree != 2) or sits outside the boundary — those
// cuts keep the legacy per-CDT-triangle path. Pure topology: the fragments are
// welded EXACTLY (the SSI emits the shared sector-arc endpoints bit-identically).
bool assembleClosedInteriorLoops(const std::vector<std::vector<Vec3>>& curves3D,
                                 const std::vector<Vec3>& boundary,
                                 const Vec3& normal,
                                 std::vector<std::vector<Vec3>>& loops) {
    loops.clear();
    if (curves3D.empty() || boundary.size() < 3) return false;

    Vec3 e1, e2; planeBasis(normal, e1, e2);
    const Vec3 o = boundary[0];

    std::vector<geom::Point2> bpoly; bpoly.reserve(boundary.size());
    for (const Vec3& p : boundary) bpoly.push_back(proj2(p, o, e1, e2));

    double scale = 1.0;
    { Aabb bb; for (const Vec3& p : boundary) bb.add(p);
      scale = std::max({1.0, bb.hi.x - bb.lo.x, bb.hi.y - bb.lo.y, bb.hi.z - bb.lo.z}); }
    const double wtol = 1e-7 * scale;

    // Weld every fragment point (in 2-D quantised keys) -> unique vertex ids.
    std::map<std::pair<long long, long long>, int> weld;
    std::vector<Vec3>          P3;
    std::vector<geom::Point2>  P2;
    auto vid = [&](const Vec3& p) -> int {
        geom::Point2 q = proj2(p, o, e1, e2);
        auto key = std::make_pair((long long)std::llround(q.x / wtol),
                                  (long long)std::llround(q.y / wtol));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        int id = (int)P3.size(); P3.push_back(p); P2.push_back(q);
        weld.emplace(key, id); return id;
    };
    std::vector<std::pair<int,int>> edges;
    for (const auto& cv : curves3D) {
        int prev = -1;
        for (const Vec3& p : cv) {
            int id = vid(p);
            if (prev >= 0 && prev != id) edges.push_back({prev, id});
            prev = id;
        }
    }
    if (P3.size() < 3) return false;

    std::vector<std::set<int>> adj(P3.size());
    for (auto& e : edges) { adj[e.first].insert(e.second); adj[e.second].insert(e.first); }

    // Every welded fragment point must have degree EXACTLY 2 (clean closed loops)
    // and lie strictly inside the boundary (interior hole, not a boundary cut).
    for (int i = 0; i < (int)P3.size(); ++i) {
        if (adj[i].size() != 2) return false;
        if (!pointInPoly2(bpoly, P2[i].x, P2[i].y)) return false;
    }

    // Trace each connected cycle into an ordered ring.
    std::vector<char> vis(P3.size(), 0);
    for (int s = 0; s < (int)P3.size(); ++s) {
        if (vis[s]) continue;
        std::vector<int> ring;
        int cur = s, prev = -1;
        bool closed = false;
        for (std::size_t guard = 0; guard <= P3.size(); ++guard) {
            vis[cur] = 1; ring.push_back(cur);
            int nxt = -1;
            for (int nb : adj[cur]) if (nb != prev && !vis[nb]) { nxt = nb; break; }
            if (nxt < 0) { closed = (adj[cur].count(s) && ring.size() >= 3); break; }
            prev = cur; cur = nxt;
        }
        if (!closed || ring.size() < 3) return false;
        std::vector<Vec3> r3; r3.reserve(ring.size());
        for (int id : ring) r3.push_back(P3[id]);
        loops.push_back(std::move(r3));
    }
    return !loops.empty();
}

// ===========================================================================
// POINT-IN-SOLID — ray-cast parity against a watertight triangle soup of the
// OTHER solid. The soup is the Step-1 tessellation (watertight; the curved cut
// walls are chordal, but for an INTERIOR sample nudged off any boundary the
// parity is robust). Uses a Moller-Trumbore ray/triangle test along +X with a
// pseudo-random tilt so the ray avoids edge/vertex grazing.
// ===========================================================================
struct SoupCache {
    std::vector<double>        pos;
    std::vector<std::uint32_t> idx;
    Aabb bb;
};

void buildSoup(const Solid& s, SoupCache& sc, double weldTol) {
    tessellateSolid(s, sc.pos, sc.idx, weldTol);
    for (std::size_t i = 0; i + 2 < sc.pos.size(); i += 3)
        sc.bb.add(Vec3{sc.pos[i], sc.pos[i + 1], sc.pos[i + 2]});
}

// Count forward ray/triangle crossings; returns true if `p` is inside the soup.
bool pointInSoup(const SoupCache& sc, const Vec3& p) {
    // Quick reject by bounding box (with a small pad).
    const double pad = 1e-9;
    if (p.x < sc.bb.lo.x - pad || p.x > sc.bb.hi.x + pad ||
        p.y < sc.bb.lo.y - pad || p.y > sc.bb.hi.y + pad ||
        p.z < sc.bb.lo.z - pad || p.z > sc.bb.hi.z + pad)
        return false;

    // A few tilted ray directions; take the majority vote so a single grazing
    // configuration cannot flip the classification.
    static const Vec3 dirs[3] = {
        {1.0, 0.0013, 0.0007}, {0.0011, 1.0, 0.0009}, {0.0008, 0.0012, 1.0}};
    int votesInside = 0;
    for (const Vec3& d0 : dirs) {
        Vec3 d = vnorm(d0);
        int crossings = 0;
        bool degenerate = false;
        for (std::size_t t = 0; t + 2 < sc.idx.size(); t += 3) {
            const std::uint32_t ia = sc.idx[t], ib = sc.idx[t + 1], ic = sc.idx[t + 2];
            Vec3 a{sc.pos[3 * ia], sc.pos[3 * ia + 1], sc.pos[3 * ia + 2]};
            Vec3 b{sc.pos[3 * ib], sc.pos[3 * ib + 1], sc.pos[3 * ib + 2]};
            Vec3 c{sc.pos[3 * ic], sc.pos[3 * ic + 1], sc.pos[3 * ic + 2]};
            Vec3 e1 = vsub(b, a), e2 = vsub(c, a);
            Vec3 h = vcross(d, e2);
            double det = vdot(e1, h);
            if (std::fabs(det) < 1e-15) continue;   // ray parallel to triangle
            double inv = 1.0 / det;
            Vec3 sP = vsub(p, a);
            double u = vdot(sP, h) * inv;
            if (u < -1e-12 || u > 1 + 1e-12) continue;
            Vec3 q = vcross(sP, e1);
            double v = vdot(d, q) * inv;
            if (v < -1e-12 || u + v > 1 + 1e-12) continue;
            double tt = vdot(e2, q) * inv;
            if (tt <= 1e-9) continue;               // behind / at the origin
            // Reject grazing hits within an epsilon of an edge/vertex (degenerate
            // for parity); re-roll with the next direction if so.
            if (u < 1e-7 || v < 1e-7 || u + v > 1 - 1e-7) { degenerate = true; break; }
            ++crossings;
        }
        if (degenerate) continue;
        if (crossings & 1) ++votesInside;
        else               --votesInside;
    }
    return votesInside > 0;
}

// ===========================================================================
// PARAMETER PROJECTION — map a 3-D point onto a face's (u,v) parameter domain.
// Only the kinds the analytic path produces sub-faces for are needed.
// Returns false if the kind is unsupported for projection.
// ===========================================================================
bool projectToUV(const Surface* s, const Vec3& p, double& u, double& v) {
    const Vec3 b = s->binormal();
    switch (s->kind) {
    case SurfaceKind::Plane: {
        Vec3 rel = vsub(p, s->origin);
        u = vdot(rel, s->refDir);
        v = vdot(rel, b);
        return true;
    }
    case SurfaceKind::Cylinder: {
        Vec3 rel = vsub(p, s->origin);
        double x = vdot(rel, s->refDir), y = vdot(rel, b);
        u = std::atan2(y, x);
        if (u < 0) u += 2.0 * kPi;
        v = vdot(rel, s->axis);
        return true;
    }
    case SurfaceKind::Cone: {
        Vec3 rel = vsub(p, s->origin);
        double x = vdot(rel, s->refDir), y = vdot(rel, b);
        u = std::atan2(y, x);
        if (u < 0) u += 2.0 * kPi;
        double along = (s->param != 0.0) ? vdot(rel, s->axis) / s->param : 0.0;
        v = along; // t in [0,1]
        return true;
    }
    default:
        return false;
    }
}

// Unwrap a cylinder/cone angular coordinate u so it is continuous within a sub-
// window whose representative angle is `uref` (handles the 2pi seam).
double unwrapNear(double u, double uref) {
    while (u - uref > kPi)  u -= 2.0 * kPi;
    while (uref - u > kPi)  u += 2.0 * kPi;
    return u;
}

// The canonical SolidFactory builds a CYLINDER as an equal-radius CONE
// (buildCylinder -> buildCone(r,r,h)), so its lateral surface has kind==Cone with
// r1==r2. An equal-r cone IS EXACTLY a cylinder, but intersectSurfaces dispatches
// plane∩cone to the deferred path. Normalize such a surface to a genuine Cylinder
// JUST FOR THE SSI QUERY (we keep the original Cone surface on the sub-face so the
// geometry/evaluator/mass-integrator are byte-identical). Exact, not an approx.
Surface normalizeForSSI(const Surface& s) {
    if (s.kind == SurfaceKind::Cone && std::fabs(s.r1 - s.r2) < 1e-12) {
        Surface c = s;
        c.kind = SurfaceKind::Cylinder;
        c.r1 = s.r1;        // cylinder radius
        c.param = s.param;  // height
        // Cone v in [0,1] along axis*param maps to cylinder v in [0,param]; the SSI
        // returns whole curves which we re-project per face, so this is consistent.
        return c;
    }
    return s;
}

} // namespace

// ===========================================================================
// MESH FALLBACK PATH (flagged) — the proven Strategy-Q arrangement reconstructed
// as planar triangle faces. Used ONLY when the analytic path cannot be exact.
// ===========================================================================
namespace {

double soupSignedVolume(const std::vector<double>& pos,
                        const std::vector<std::uint32_t>& idx) {
    double v6 = 0.0;
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        const std::uint32_t a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const double* pa = &pos[3 * a];
        const double* pb = &pos[3 * b];
        const double* pc = &pos[3 * c];
        const double cx = pb[1] * pc[2] - pb[2] * pc[1];
        const double cy = pb[2] * pc[0] - pb[0] * pc[2];
        const double cz = pb[0] * pc[1] - pb[1] * pc[0];
        v6 += pa[0] * cx + pa[1] * cy + pa[2] * cz;
    }
    return v6 / 6.0;
}

void ensurePositiveWinding(std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    if (soupSignedVolume(pos, idx) < 0.0)
        for (std::size_t t = 0; t + 2 < idx.size(); t += 3)
            std::swap(idx[t + 1], idx[t + 2]);
}

mesh::BoolOpN toMeshOp(BoolOp op) {
    switch (op) {
    case BoolOp::Fuse:   return mesh::BoolOpN::UNION;
    case BoolOp::Cut:    return mesh::BoolOpN::DIFFERENCE;
    case BoolOp::Common: return mesh::BoolOpN::INTERSECTION;
    }
    return mesh::BoolOpN::UNION;
}

inline Vec3 toV3(const mesh::Vec3& p) { return Vec3{p.x, p.y, p.z}; }

// Reconstruct a watertight result mesh into a brep::Solid (every triangle -> a
// planar Face). Returns false on a degenerate triangle (honest failure).
bool reconstructPlanar(const mesh::HalfEdgeMesh& m, TopologyBuilder& tb, Solid*& outSolid) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    m.toSoup(pos, idx);
    const std::size_t nv = pos.size() / 3;
    if (idx.empty() || nv < 4) return false;

    std::vector<Vertex*> verts(nv, nullptr);
    for (std::size_t i = 0; i < nv; ++i)
        verts[i] = tb.makeVertex({pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]});

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        std::uint32_t ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
        if (ia == ib || ib == ic || ia == ic) return false;
        Vec3 a = toV3(m.vertices()[ia].position);
        Vec3 b = toV3(m.vertices()[ib].position);
        Vec3 c = toV3(m.vertices()[ic].position);
        Vec3 nrm = vcross(vsub(b, a), vsub(c, a));
        double area2 = vlen(nrm);
        if (area2 < 1e-18) return false;

        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {verts[ia], verts[ib], verts[ic]};
        tb.addOuterLoopToFace(f, ring);

        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        s->origin = a;
        s->refDir = vnorm(vsub(b, a));
        s->axis = vnorm(nrm);
        s->reversed = false;
        f->surface = s;

        Vec3 uDir = s->refDir, vDir = s->binormal();
        f->vertexUV.clear(); f->vertexUV.reserve(3);
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        const Vec3 P[3] = {a, b, c};
        for (int k = 0; k < 3; ++k) {
            Vec3 rel = vsub(P[k], s->origin);
            double pu = vdot(rel, uDir), pv = vdot(rel, vDir);
            f->vertexUV.push_back({pu, pv});
            if (k == 0) { u0 = u1 = pu; v0 = v1 = pv; }
            else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
                   v0 = std::min(v0, pv); v1 = std::max(v1, pv); }
        }
        f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
    }
    outSolid = solid;
    return true;
}

BooleanResult booleanSolidMeshFallback(const Solid& A, const Solid& B, BoolOp op,
                                       const BooleanOptions& opts) {
    BooleanResult res;
    res.usedMeshFallback = true;

    // Tessellate BOTH solids to conforming soups, then route through the shared
    // mesh-operand core (booleanMeshOperand). Identical pipeline to before — the
    // soup->meshBooleanNative->reconstructPlanar->manifold-check body now lives in
    // booleanMeshOperand so src/Booleans.cpp can reuse it for NativeMesh operands.
    std::vector<double> ap, bp;
    std::vector<std::uint32_t> ai, bi;
    tessellateSolid(A, ap, ai, opts.weldTol);
    tessellateSolid(B, bp, bi, opts.weldTol);

    MeshOperandResult mr = booleanMeshOperand(ap, ai, bp, bi, op);
    res.ok     = mr.ok;
    res.reason = mr.ok ? "ok (mesh fallback)" : mr.reason;
    res.solid  = mr.solid;
    res.owner  = std::move(mr.owner);
    return res;
}

} // namespace

// ===========================================================================
// MESH-OPERAND BOOLEAN (the fuse/cut mesh-operand bridge) — see Boolean.hpp.
// The reusable core factored out of booleanSolidMeshFallback: it operates on raw
// triangle soups so a caller (src/Booleans.cpp) can supply a NativeMesh operand's
// soup (getNativeMesh().toSoup()) that has no analytic Solid to tessellate. The
// anonymous-namespace helpers (ensurePositiveWinding / toMeshOp / reconstructPlanar)
// are defined above in this TU and are in scope here.
// ===========================================================================
MeshOperandResult booleanMeshOperand(const std::vector<double>& aPos,
                                     const std::vector<std::uint32_t>& aIdx,
                                     const std::vector<double>& bPos,
                                     const std::vector<std::uint32_t>& bIdx,
                                     BoolOp op) {
    MeshOperandResult res;

    if (aIdx.empty() || bIdx.empty()) { res.reason = "empty input tessellation"; return res; }

    // Copy the soups so we can normalize winding without mutating the caller's
    // (the caller's soups may be views it still needs / built outside a lock).
    std::vector<double> ap = aPos, bp = bPos;
    std::vector<std::uint32_t> ai = aIdx, bi = bIdx;
    ensurePositiveWinding(ap, ai);
    ensurePositiveWinding(bp, bi);

    // K2 ESCALATION: meshBooleanExact KEEPS the fast meshBooleanNative (Strategy Q +
    // SoS) as its first attempt, and ONLY when that returns ok=false (the residual
    // near-triple-point / coplanar-sliver class the double-coordinate engine cannot
    // close) escalates to the fully-exact ExactReal arrangement. This resolves those
    // inputs NATIVELY here instead of deferring to OCCT one level up. Both stages are
    // validate()'d as closed 2-manifolds, so ok=true stays an honest guarantee.
    mesh::BoolResultN br = mesh::meshBooleanExact(ap, ai, bp, bi, toMeshOp(op));
    if (!br.ok) { res.reason = br.reason ? br.reason : "mesh boolean ok=false"; return res; }

    auto owner = std::make_shared<TopologyBuilder>();
    Solid* solid = nullptr;
    if (!reconstructPlanar(br.mesh, *owner, solid)) {
        res.reason = "mesh-operand reconstruction hit a degenerate triangle"; return res;
    }
    if (!owner->isClosedTwoManifold()) {
        res.reason = "mesh-operand reconstructed solid is not a closed 2-manifold"; return res;
    }
    res.ok = true; res.reason = "ok (mesh operand)"; res.solid = solid; res.owner = owner;
    return res;
}

// ===========================================================================
// ANALYTIC PATH
// ===========================================================================
namespace {

// A sub-face produced by imprinting: it carries a parent Surface*, a parameter
// trim window, an ordered 3-D ring (welded vertex ids), and an in/out label vs
// the OTHER solid.
struct SubFace {
    const Surface* parent = nullptr;  // the parent face's analytic surface
    bool   reversedFlag = false;      // parent->reversed (copied)
    Vec3   origin{}, axis{0,0,1}, refDir{1,0,0};
    SurfaceKind kind = SurfaceKind::Plane;
    double r1 = 0, r2 = 0, param = 0;
    bool   isDisk = false; double diskOuter = 0, diskInner = 0;
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    std::vector<std::array<double,2>> vertexUV; // (u,v) per ring vertex (param-triangle)
    std::vector<Vec3> ring;                     // ordered 3-D corner points (OUTER loop)
    // HOLED PLANAR FACE (native boolean inner-loop path): closed hole rings (each
    // an ordered 3-D point loop) cut INTO this planar sub-face — a drilled hole's
    // bore rim. Empty for every ordinary sub-face. When non-empty the sub-face is
    // a SINGLE analytic holed face (outer `ring` + these inner rings), not a
    // per-CDT-triangle fan. stitch welds + orients these against the bore wall.
    std::vector<std::vector<Vec3>> innerRings;
    bool   boolHoled = false;                   // emit as a holed analytic face
    bool   paramTri = false;                    // integrate over the (u,v) triangle
    bool   insideOther = false;                 // classification result
    bool   fromA = true;                        // provenance: which input solid
    // LINEAGE (PD-7): the index of the PARENT INPUT FACE this sub-face was carved
    // from, in the input solid's face-enumeration order (fromA ? A's list : B's).
    // -1 == unassigned (never happens on the analytic path; the imprint always
    // threads the parent index). Every result face traces back to exactly one
    // (fromA, parentFaceIdx) pair, which is the Modified/IsDeleted relation.
    int    parentFaceIdx = -1;
};

// Densely + EXACTLY sample a closed-form intersection curve, clipped to a 3-D box
// (the overlap region of the two crossing faces). For a LINE the SSI samples the
// whole infinite span over [-1e3,1e3], so only 1-2 of its 256 samples land on a
// small face — we instead CLIP the analytic line to the box and sample THAT span
// finely. For a CIRCLE / ELLIPSE / CONIC the SSI samples are already dense and
// bounded, so we keep them (filtered to the box with a pad). Returns a 3-D
// polyline well-resolved across the face.
std::vector<Vec3> sampleCurveInBox(const IntersectionCurve& cu, const Aabb& box) {
    std::vector<Vec3> out;
    const double pad = 1e-6 * std::max({1.0, box.hi.x - box.lo.x,
                                              box.hi.y - box.lo.y, box.hi.z - box.lo.z});
    auto inBox = [&](const Vec3& p) {
        return p.x >= box.lo.x - pad && p.x <= box.hi.x + pad &&
               p.y >= box.lo.y - pad && p.y <= box.hi.y + pad &&
               p.z >= box.lo.z - pad && p.z <= box.hi.z + pad;
    };

    if (cu.kind == CurveKind::Line) {
        // Clip the line origin + t*dir to the (padded) box -> [t0,t1], sample fine.
        Vec3 o = cu.origin, d = cu.dir;
        double t0 = -1e300, t1 = 1e300;
        const double lo[3] = {box.lo.x - pad, box.lo.y - pad, box.lo.z - pad};
        const double hi[3] = {box.hi.x + pad, box.hi.y + pad, box.hi.z + pad};
        const double od[3] = {o.x, o.y, o.z};
        const double dd[3] = {d.x, d.y, d.z};
        bool empty = false;
        for (int a = 0; a < 3; ++a) {
            if (std::fabs(dd[a]) < 1e-15) {
                if (od[a] < lo[a] || od[a] > hi[a]) { empty = true; break; }
            } else {
                double ta = (lo[a] - od[a]) / dd[a];
                double tb = (hi[a] - od[a]) / dd[a];
                if (ta > tb) std::swap(ta, tb);
                t0 = std::max(t0, ta); t1 = std::min(t1, tb);
            }
        }
        if (empty || t0 > t1) return out;
        // A straight line needs only its two clipped ENDPOINTS — the imprint then
        // imprints it as a single constraint segment (and the PSLG conditioner
        // splits it at any crossing). Sampling the interior would explode the CDT.
        out.push_back(vadd(o, vscale(d, t0)));
        out.push_back(vadd(o, vscale(d, t1)));
        return out;
    }

    // Circle / Ellipse / Conic / Polyline: keep the dense analytic samples that
    // lie in (or near) the box. Preserve order; the imprint breaks chains at gaps.
    for (const Vec3& p : cu.samples)
        if (inBox(p)) out.push_back(p);
    // If a closed curve was clipped to an arc, that's fine (the imprint treats it
    // as an open polyline). If nothing survived, the curve does not touch the box.
    return out;
}

// Sample a cut CIRCLE at the CURVED partner surface's angular vertex positions so
// the planar face's imprinted hole shares vertices with the curved wall's rim. The
// circle is coaxial with the cylinder/cone (a plane ⊥ axis cut), so the circle's
// angle measured in the curved surface's (refDir,binormal) frame equals the
// surface's own theta; we step theta by the sector width over the full 2π so the
// imprint vertices land EXACTLY on the curved primitive's rim vertices.
std::vector<Vec3> sampleCircleOnCurved(const IntersectionCurve& cu,
                                       const Surface& curved, double secW,
                                       const Aabb& box) {
    std::vector<Vec3> out;
    int nSeg = (int)std::llround(2.0 * kPi / secW);
    if (nSeg < 3) nSeg = 3;
    const double pad = 1e-6 * std::max({1.0, box.hi.x - box.lo.x,
                                              box.hi.y - box.lo.y, box.hi.z - box.lo.z});
    auto inBox = [&](const Vec3& p) {
        return p.x >= box.lo.x - pad && p.x <= box.hi.x + pad &&
               p.y >= box.lo.y - pad && p.y <= box.hi.y + pad &&
               p.z >= box.lo.z - pad && p.z <= box.hi.z + pad;
    };
    Vec3 er = curved.refDir, et = curved.binormal();
    for (int k = 0; k <= nSeg; ++k) {
        double th = 2.0 * kPi * (k % nSeg) / nSeg;
        Vec3 p = vadd(cu.origin, vadd(vscale(er, cu.r1 * std::cos(th)),
                                      vscale(et, cu.r1 * std::sin(th))));
        if (inBox(p)) out.push_back(p);
    }
    return out;
}

// Build a SubFace shell from a parent surface (copies the analytic geometry so
// the result face IS the same quadric/plane as the parent). `parentFaceIdx` is
// the index of the input FACE this sub-face descends from (lineage, PD-7) — every
// sub-face minted from input face i carries i so the result→input map is exact.
SubFace makeSubFromSurface(const Surface* parent, bool fromA, int parentFaceIdx) {
    SubFace sf;
    sf.parent = parent;
    sf.kind = parent->kind;
    sf.origin = parent->origin; sf.axis = parent->axis; sf.refDir = parent->refDir;
    sf.r1 = parent->r1; sf.r2 = parent->r2; sf.param = parent->param;
    sf.reversedFlag = parent->reversed;
    sf.isDisk = parent->isDisk; sf.diskOuter = parent->diskOuter; sf.diskInner = parent->diskInner;
    sf.fromA = fromA;
    sf.parentFaceIdx = parentFaceIdx;
    return sf;
}

// Project a face's loop ring + every imprint curve into the parent's (u,v)
// domain, run the CDT, and emit one SubFace per inside triangle-region merged
// back into the parameter sub-polygons. For robustness and because the mass
// integrator + tessellator both operate per simple-loop face, we emit one
// SubFace PER inside CDT TRIANGLE (each keeping the parent surface) — this is the
// same "faceted topology over exact analytic geometry" model the primitives use
// for curved sides. The geometry stays exact (every vertex is on the analytic
// surface); only the parameter domain is subdivided.
//
// Returns false if the CDT could not be formed (caller then defers honestly).
//
// `parentFaceIdx` (PD-7 lineage): the index of THIS input face in its solid's
// face-enumeration order. It is stamped onto every SubFace this call produces so
// that, after stitching, each result face can be traced back to the exact input
// face it descends from (the Modified relation) and consumed faces (zero output)
// are the IsDeleted set.
bool imprintFace(const Face* parent, bool fromA, int parentFaceIdx,
                 const std::vector<std::vector<Vec3>>& curves3D,
                 std::vector<SubFace>& out) {
    const Surface* s = parent->surface;
    if (!s) return false;

    std::vector<Vec3> ring = faceRing(parent);
    if (ring.size() < 3) return false;

    // FAST PATH — a face crossed by NO imprint curve is kept WHOLE (the original
    // analytic face, exact). This covers containment (e.g. an enclosed sphere whose
    // faces never meet a box face) and any face entirely on one side of the other
    // solid. The single sub-face copies the parent's full trim window + geometry
    // (a sphere/torus face thus survives as the exact sphere/torus patch).
    if (curves3D.empty()) {
        SubFace sf = makeSubFromSurface(s, fromA, parentFaceIdx);
        sf.u0 = parent->u0; sf.u1 = parent->u1; sf.v0 = parent->v0; sf.v1 = parent->v1;
        sf.paramTri = false;
        sf.vertexUV = parent->vertexUV;
        sf.ring = ring;
        // HOLED-FACE CARRY-OVER: a face that already carries inner (hole) loops from
        // a PRIOR boolean (sequential drilling) but is NOT crossed by this op must
        // keep its holes — re-emit them as the sub-face's inner rings.
        if (!parent->innerLoops.empty()) {
            for (Loop* il : parent->innerLoops) {
                std::vector<Vec3> r = loopRing3D(il);
                if (r.size() >= 3) sf.innerRings.push_back(std::move(r));
            }
            if (!sf.innerRings.empty()) sf.boolHoled = true;
        }
        out.push_back(std::move(sf));
        return true;
    }

    // Beyond the whole-face fast path, only plane / cylinder / cone faces are
    // imprinted analytically (sphere/torus imprints are a TARGETED follow-on; an
    // imprinted sphere/torus face defers honestly to the mesh fallback).
    if (s->kind != SurfaceKind::Plane && s->kind != SurfaceKind::Cylinder &&
        s->kind != SurfaceKind::Cone)
        return false;

    // Reference angle for unwrapping (cylinder/cone): the loop's mean angle.
    double uref = 0.0;
    bool angular = (s->kind == SurfaceKind::Cylinder || s->kind == SurfaceKind::Cone);
    if (angular) {
        // use the existing trim window centre as the unwrap reference
        uref = 0.5 * (parent->u0 + parent->u1);
    }

    auto toParam = [&](const Vec3& p, double& u, double& v) -> bool {
        if (!projectToUV(s, p, u, v)) return false;
        if (angular) u = unwrapNear(u, uref);
        return true;
    };

    // ---- CURVED (cylinder/cone) faces: HORIZONTAL-BAND SPLIT --------------------
    // A curved sector face [u0,u1]x[v0,v1] is cut by cap planes perpendicular to
    // the axis, whose intersection with the surface is a CIRCLE at CONSTANT v (a
    // horizontal line in (u,v)). We split the sector into horizontal BANDS at those
    // v-levels and emit each band as a rectangular quad sub-face that keeps the
    // SAME analytic surface and is integrated over its full [u0,u1]x[vb0,vb1]
    // rectangle (EXACT, like the primitive's sectors). If an imprint curve on a
    // curved face is NOT a constant-v line (e.g. an oblique-plane ellipse), we
    // DEFER (return false) — honest, the mesh fallback then takes it.
    if (angular) {
        // sector parameter extent from the boundary ring. A CONE apex ring vertex
        // lies ON the axis (radius 0), so its angular coordinate u = atan2(0,0) is
        // undefined/garbage and must NOT pollute the sector's [su0,su1] range — it
        // would otherwise stretch the band to a wrong azimuth and weld corners to the
        // wrong rim vertices. We accumulate u only from non-apex (radius>tol) ring
        // points, but accumulate v (the axial coordinate) from all points.
        double su0 = 1e300, su1 = -1e300, sv0 = 1e300, sv1 = -1e300;
        for (const Vec3& p : ring) {
            double u, v; if (!toParam(p, u, v)) return false;
            sv0 = std::min(sv0, v); sv1 = std::max(sv1, v);
            // radial distance from the surface axis (0 at the cone apex).
            Vec3 rel = vsub(p, s->origin);
            Vec3 radial = vsub(rel, vscale(s->axis, vdot(rel, s->axis)));
            if (vlen(radial) > 1e-9) { su0 = std::min(su0, u); su1 = std::max(su1, u); }
        }
        if (su0 > su1) { su0 = parent->u0; su1 = parent->u1; } // all-apex guard
        const double vspan = std::max(1e-12, sv1 - sv0);
        const double uspan = std::max(1e-12, su1 - su0);
        // collect distinct cut v-levels strictly inside (sv0,sv1)
        std::vector<double> cutsV;
        for (const auto& cv : curves3D) {
            double vmin = 1e300, vmax = -1e300; bool any = false;
            double umin = 1e300, umax = -1e300;
            for (const Vec3& p : cv) {
                double u, v; if (!toParam(p, u, v)) continue;
                // only count samples whose u lies within this sector
                if (u < su0 - 1e-7 || u > su1 + 1e-7) continue;
                vmin = std::min(vmin, v); vmax = std::max(vmax, v); any = true;
                umin = std::min(umin, u); umax = std::max(umax, u);
            }
            if (!any) continue;
            if (vmax - vmin > 1e-4 * vspan) {
                // A VERTICAL (constant-u, large-v) imprint curve is a plane PARALLEL to
                // the axis slicing this lateral along a GENERATOR line (not a cap plane).
                // When that generator lies at (within tol of) this sector's OWN u-edge —
                // the tessellation seam a corner/partial cut aligns to (e.g. a box side
                // face slicing the bore quadrant along u=0 / u=pi/2) — it is the sector's
                // existing boundary and induces NO band split, so SKIP it rather than
                // deferring the whole op to the mesh fallback. A genuinely INTERIOR
                // vertical cut (would need a u-split) still defers honestly.
                const bool constU = (umax - umin) < 1e-3 * uspan;
                const double uc = 0.5 * (umin + umax);
                const bool atUedge = std::fabs(uc - su0) < 1e-2 * uspan ||
                                     std::fabs(uc - su1) < 1e-2 * uspan;
                if (constU && atUedge) continue;   // boundary-coincident generator: no-op
                return false;                       // oblique / interior cut -> defer
            }
            double vc = 0.5 * (vmin + vmax);
            if (vc > sv0 + 1e-7 * vspan && vc < sv1 - 1e-7 * vspan) cutsV.push_back(vc);
        }
        std::sort(cutsV.begin(), cutsV.end());
        // merge near-duplicate levels
        std::vector<double> levels; levels.push_back(sv0);
        for (double vc : cutsV)
            if (vc - levels.back() > 1e-7 * vspan) levels.push_back(vc);
        if (sv1 - levels.back() > 1e-7 * vspan) levels.push_back(sv1);

        // A CONE band whose top or bottom v-level sits at the apex (cone radius
        // r(v)=r1+(r2-r1)v == 0) degenerates: the two corners on that v-edge
        // collapse to the single apex point. Emit a TRIANGLE there (the parametric
        // integration domain stays the full [u,v] rectangle, so the mass integral —
        // which already accounts for the radius taper — remains EXACT; only the
        // welded topology ring drops the duplicated apex vertex).
        auto coneRadiusAt = [&](double vlvl) -> double {
            if (s->kind != SurfaceKind::Cone) return 1.0; // cylinder: never apex
            return s->r1 + (s->r2 - s->r1) * vlvl;
        };
        for (std::size_t b = 0; b + 1 < levels.size(); ++b) {
            double vb0 = levels[b], vb1 = levels[b + 1];
            SubFace sf = makeSubFromSurface(s, fromA, parentFaceIdx);
            sf.u0 = su0; sf.u1 = su1; sf.v0 = vb0; sf.v1 = vb1;
            sf.paramTri = false;  // RECTANGLE band -> standard parametric integral
            sf.isDisk = false;
            const bool botApex = std::fabs(coneRadiusAt(vb0)) < 1e-12;
            const bool topApex = std::fabs(coneRadiusAt(vb1)) < 1e-12;
            // Build the ring CCW in (u,v), collapsing the apex edge to one vertex.
            std::vector<std::array<double,2>> corners;
            if (botApex && !topApex) {
                // triangle: apex (one corner at vb0) + two top corners.
                corners = {{0.5*(su0+su1), vb0}, {su1, vb1}, {su0, vb1}};
            } else if (topApex && !botApex) {
                // triangle: two bottom corners + apex.
                corners = {{su0, vb0}, {su1, vb0}, {0.5*(su0+su1), vb1}};
            } else {
                // full quad (or, if both edges are at the apex, a degenerate sliver
                // that the degeneracy check below will reject — but that cannot
                // happen for a genuine band with vb0<vb1).
                corners = {{su0, vb0}, {su1, vb0}, {su1, vb1}, {su0, vb1}};
            }
            for (const auto& c : corners) {
                sf.vertexUV.push_back(c);
                sf.ring.push_back(s->evaluate(c[0], c[1]));
            }
            out.push_back(std::move(sf));
        }
        return true;
    }

    // ---- PLANAR faces: HOLED-FACE (INNER-LOOP) ANALYTIC PATH -------------------
    // BEFORE the per-CDT-triangle imprint, detect the drilled-hole signature: the
    // imprint fragments of THIS face merge into one or more CLOSED rings that lie
    // entirely inside the face boundary (a circle/loop fully interior — a through
    // bore). If so, emit ONE holed analytic sub-face (the original outer loop +
    // those inner rings + any inner loops carried from a prior cut) instead of a
    // triangle fan. This keeps a drilled face as a SINGLE planar face per drill —
    // no +388-faces/hole explosion, no T-junction at the 6th hole. A cut that
    // REACHES the boundary (open/partial) yields degree!=2 fragment endpoints, so
    // assembleClosedInteriorLoops returns false and we keep the legacy CDT path.
    {
        Vec3 nrm = s->normalAt(0.5 * (parent->u0 + parent->u1),
                               0.5 * (parent->v0 + parent->v1));
        std::vector<std::vector<Vec3>> newLoops;
        bool allClosed = assembleClosedInteriorLoops(curves3D, ring, nrm, newLoops);
        if (allClosed) {
            // Helper: project a planar loop into (u,v), filling vertexUV + bbox.
            auto fillUV = [&](SubFace& f, const std::vector<Vec3>& loop) {
                double mnu = 1e300, mxu = -1e300, mnv = 1e300, mxv = -1e300;
                for (const Vec3& p : loop) {
                    double u, v; if (!toParam(p, u, v)) continue;
                    mnu = std::min(mnu, u); mxu = std::max(mxu, u);
                    mnv = std::min(mnv, v); mxv = std::max(mxv, v);
                    f.vertexUV.push_back({u, v});
                }
                if (mnu <= mxu) { f.u0 = mnu; f.u1 = mxu; f.v0 = mnv; f.v1 = mxv; }
                else            { f.u0 = parent->u0; f.u1 = parent->u1;
                                  f.v0 = parent->v0; f.v1 = parent->v1; }
            };

            // (a) The HOLED ANNULUS face: outer loop + every hole loop (existing
            // carried-over holes + the newly-cut loops). Classified by an annulus
            // sample; selected by the op's OUTSIDE-the-cut side (Cut/Fuse keep it).
            SubFace sf = makeSubFromSurface(s, fromA, parentFaceIdx);
            sf.ring = ring;
            sf.paramTri = false;
            sf.isDisk = false;
            for (Loop* il : parent->innerLoops) {
                std::vector<Vec3> r = loopRing3D(il);
                if (r.size() >= 3) sf.innerRings.push_back(std::move(r));
            }
            for (const auto& nl : newLoops) sf.innerRings.push_back(nl); // copy (disks need it)
            sf.boolHoled = !sf.innerRings.empty();
            fillUV(sf, ring);
            out.push_back(std::move(sf));

            // (b) One DISK face per NEWLY-cut loop: the region INSIDE that cut circle
            // (the bore plug's cap). Classified by its own interior centroid; selected
            // by the op's INSIDE-the-cut side (Common keeps it; Cut drops it). Without
            // this the inside-selections would lose the material the cut split off.
            // Existing (carried-over) holes get NO disk — they are genuine voids.
            for (const auto& nl : newLoops) {
                if (nl.size() < 3) continue;
                SubFace dk = makeSubFromSurface(s, fromA, parentFaceIdx);
                dk.ring = nl;
                dk.paramTri = false; dk.isDisk = false; dk.boolHoled = false;
                fillUV(dk, nl);
                out.push_back(std::move(dk));
            }
            return true;
        }
        // A face that ALREADY has holes but is met by an OPEN/partial cut is outside
        // the analytic holed envelope — defer honestly to the mesh fallback rather
        // than silently dropping the existing holes via the legacy CDT path.
        if (!parent->innerLoops.empty()) return false;
    }

    // ---- PLANAR faces: CDT IMPRINT ---------------------------------------------
    // Build the PSLG: boundary loop points + curve points.
    std::vector<geom::Point2> pts;
    std::vector<geom::ConstraintEdge> cons;
    auto addPoint = [&](double u, double v) -> int {
        // de-dup within a tolerance to keep constraint endpoints exact input pts
        for (std::size_t i = 0; i < pts.size(); ++i)
            if (std::fabs(pts[i].x - u) < 1e-9 && std::fabs(pts[i].y - v) < 1e-9)
                return static_cast<int>(i);
        pts.push_back({u, v});
        return static_cast<int>(pts.size() - 1);
    };

    // Boundary loop as a closed constraint ring.
    std::vector<int> boundIdx;
    for (const Vec3& p : ring) {
        double u, v;
        if (!toParam(p, u, v)) return false;
        boundIdx.push_back(addPoint(u, v));
    }
    for (std::size_t i = 0; i < boundIdx.size(); ++i) {
        int a = boundIdx[i], b = boundIdx[(i + 1) % boundIdx.size()];
        if (a != b) cons.push_back({a, b});
    }

    // Curve polylines as constraints. Clip each curve to the face's (u,v) bbox so
    // an infinite SSI line/circle only imprints where it crosses this face.
    double bu0 = parent->u0, bu1 = parent->u1, bv0 = parent->v0, bv1 = parent->v1;
    // For planar faces the trim window may be a tight bbox of the loop; recompute
    // a generous param bbox from the boundary points to be safe.
    {
        double mnu = 1e300, mxu = -1e300, mnv = 1e300, mxv = -1e300;
        for (int bi : boundIdx) {
            mnu = std::min(mnu, pts[bi].x); mxu = std::max(mxu, pts[bi].x);
            mnv = std::min(mnv, pts[bi].y); mxv = std::max(mxv, pts[bi].y);
        }
        bu0 = mnu; bu1 = mxu; bv0 = mnv; bv1 = mxv;
    }
    const double pad = 1e-6 * std::max(1.0, std::max(bu1 - bu0, bv1 - bv0));

    // BOUNDARY-TOUCH SNAP. An SSI cut curve that reaches a face edge TERMINATES on
    // that edge, but trig/rounding leaves the endpoint a hair off it. The corner
    // notch's arc endpoint on the box BOTTOM face is (0,4,0) via cos(pi/2): its (u,v)
    // lands at v = 2.4e-16 (not the exact 0 of the x=0 boundary) — just INSIDE the
    // face. The EXACT PSLG conditioning below (geom::segmentIntersect) then correctly
    // sees it as NOT on the boundary, so the boundary edge is never T-split there and
    // the CDT emits a near-degenerate sliver triangle whose three edges never mate
    // (the x=0-side unmated edges; the symmetric y=0 endpoint (4,0,0) has an EXACT
    // sin(0)=0 so it already lands on its boundary — hence the asymmetry). Snapping a
    // projected curve point that is within a scale-relative 1e-9*extent of a boundary
    // segment EXACTLY onto that segment lets the T-junction split fire, yielding the
    // same clean 2-region cut as the y=0 face. The tolerance is >=1e4x below the SSI
    // clip overshoot (~1e-5, handled by the window pad above / PROPER_CROSS below) and
    // >=1e6x below any real CAD feature, so a genuinely-interior point never moves.
    const double snapB = 1e-9 * std::max(1.0, std::max(bu1 - bu0, bv1 - bv0));
    auto snapToBoundary = [&](double& u, double& v) {
        double best = snapB, su = u, sv = v; bool hit = false;
        std::size_t n = boundIdx.size();
        for (std::size_t i = 0; i < n; ++i) {
            const geom::Point2& A = pts[boundIdx[i]];
            const geom::Point2& B = pts[boundIdx[(i + 1) % n]];
            const double dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
            if (L2 < 1e-30) continue;
            double t = ((u - A.x) * dx + (v - A.y) * dy) / L2;
            if (t < 0.0 || t > 1.0) continue;   // only onto the segment span
            const double px = A.x + t * dx, py = A.y + t * dy;
            const double d = std::hypot(u - px, v - py);
            if (d < best) { best = d; su = px; sv = py; hit = true; }
        }
        if (hit) { u = su; v = sv; }
    };

    auto flushChain = [&](std::vector<int>& chain) {
        for (std::size_t j = 0; j + 1 < chain.size(); ++j)
            if (chain[j] != chain[j + 1]) cons.push_back({chain[j], chain[j + 1]});
        chain.clear();
    };
    for (const auto& cv : curves3D) {
        std::vector<int> chain;
        for (std::size_t k = 0; k < cv.size(); ++k) {
            double u, v;
            if (!toParam(cv[k], u, v)) continue;
            // keep only samples within the face param window (+pad); break the
            // imprint chain at out-of-window gaps.
            if (u < bu0 - pad || u > bu1 + pad || v < bv0 - pad || v > bv1 + pad) {
                flushChain(chain);
                continue;
            }
            snapToBoundary(u, v);   // pin a boundary-terminating endpoint exactly on
            int id = addPoint(u, v);
            if (chain.empty() || chain.back() != id) chain.push_back(id);
        }
        flushChain(chain);
    }

    // CONDITION THE PSLG: constrainedDelaunay2D refuses constraints that properly
    // cross (it does not auto-insert Steiner points). The imprint of two cutting
    // faces onto one face produces cut lines that cross INSIDE the face (e.g. the
    // x=4 and y=4 cuts on a box face). Split every proper crossing by inserting the
    // intersection point as a shared vertex and replacing the two crossing edges
    // with four. Iterate to a fixpoint (a new split can create new crossings). All
    // crossing CLASSIFICATION uses the exact geom::segmentIntersect.
    auto sameRef = [&](int a, int b) {
        return std::fabs(pts[a].x - pts[b].x) < 1e-9 && std::fabs(pts[a].y - pts[b].y) < 1e-9;
    };
    bool changed = true;
    int guard = 0;
    while (changed && guard++ < 200) {
        changed = false;
        for (std::size_t i = 0; i < cons.size() && !changed; ++i) {
            for (std::size_t j = i + 1; j < cons.size() && !changed; ++j) {
                int a0 = cons[i].a, a1 = cons[i].b, b0 = cons[j].a, b1 = cons[j].b;
                // skip if they share an endpoint
                if (a0 == b0 || a0 == b1 || a1 == b0 || a1 == b1) continue;
                geom::SegIntersection si = geom::segmentIntersect(pts[a0], pts[a1], pts[b0], pts[b1]);
                if (si.relation == geom::SegRelation::PROPER_CROSS) {
                    int m = addPoint(si.point.x, si.point.y);
                    // replace edge i (a0-a1) with a0-m, m-a1 ; edge j with b0-m, m-b1
                    geom::ConstraintEdge ei = cons[i], ej = cons[j];
                    cons[i] = {ei.a, m};
                    cons[j] = {ej.a, m};
                    cons.push_back({m, ei.b});
                    cons.push_back({m, ej.b});
                    changed = true;
                } else if (si.relation == geom::SegRelation::ENDPOINT_TOUCH) {
                    // A T-junction: one segment's endpoint lies in the interior of the
                    // other. Split the through-segment at that endpoint so the CDT sees
                    // a conforming PSLG. Find which constraint's interior is touched.
                    int touch = addPoint(si.point.x, si.point.y);
                    auto interiorOf = [&](int s0, int s1) {
                        if (sameRef(touch, s0) || sameRef(touch, s1)) return false;
                        // touch is on segment s0-s1 strictly inside?
                        geom::SegIntersection t = geom::segmentIntersect(pts[s0], pts[s1], pts[touch], pts[touch]);
                        return t.relation != geom::SegRelation::DISJOINT;
                    };
                    if (touch != a0 && touch != a1 && interiorOf(a0, a1)) {
                        geom::ConstraintEdge ei = cons[i];
                        cons[i] = {ei.a, touch}; cons.push_back({touch, ei.b}); changed = true;
                    } else if (touch != b0 && touch != b1 && interiorOf(b0, b1)) {
                        geom::ConstraintEdge ej = cons[j];
                        cons[j] = {ej.a, touch}; cons.push_back({touch, ej.b}); changed = true;
                    }
                }
            }
        }
    }
    // Drop any zero-length constraints created by coincident splits.
    {
        std::vector<geom::ConstraintEdge> c2;
        for (auto& e : cons) if (e.a != e.b && !sameRef(e.a, e.b)) c2.push_back(e);
        cons.swap(c2);
    }

    geom::CDTResult cdt = geom::constrainedDelaunay2D(pts, cons);
    if (!cdt.ok) {
        // ROBUST RETRY (near-coincident PSLG conditioning). Independently-computed
        // imprint curves from MANY partner faces — e.g. a bore's 128 cylinder-sector
        // faces all crossing ONE box side face along the SAME line — deposit
        // near-coincident-but-not-identical points (SSI clip overshoot ~1e-5) and the
        // duplicate / reversed / near-zero constraints they induce. constrainedDelaunay2D
        // de-dups only EXACTLY (bit-equal), so it cannot merge them and rejects the PSLG
        // as self-intersecting (collinear overlap / T-junction). SNAP near-coincident
        // points to a shared representative coordinate (so the CDT's exact de-dup then
        // collapses them), drop the resulting zero-length constraints, dedup undirected
        // edges, and retry the CDT ONCE. A well-formed PSLG succeeds on the FIRST call
        // above and NEVER reaches this retry, so every currently-passing imprint is
        // byte-identical (zero regression) — this only rescues the shatter case.
        double mnx = 1e300, mxx = -1e300, mny = 1e300, mxy = -1e300;
        for (const auto& p : pts) {
            mnx = std::min(mnx, p.x); mxx = std::max(mxx, p.x);
            mny = std::min(mny, p.y); mxy = std::max(mxy, p.y);
        }
        const double ext  = std::max(1.0, std::max(mxx - mnx, mxy - mny));
        const double snap = 1e-5 * ext;   // >> the ~1e-5 SSI clip noise, << any real feature
        std::vector<int> rep(pts.size());
        for (std::size_t i = 0; i < pts.size(); ++i) {
            rep[i] = static_cast<int>(i);
            for (std::size_t j = 0; j < i; ++j)
                if (std::fabs(pts[i].x - pts[j].x) <= snap &&
                    std::fabs(pts[i].y - pts[j].y) <= snap) { rep[i] = rep[j]; break; }
        }
        for (std::size_t i = 0; i < pts.size(); ++i)
            pts[i] = pts[static_cast<std::size_t>(rep[i])];   // rep is always a cluster root
        std::vector<geom::ConstraintEdge> c3; c3.reserve(cons.size());
        std::set<std::uint64_t> seenC;
        for (const auto& e : cons) {
            int a = rep[e.a], b = rep[e.b];
            if (a == b) continue;                                   // zero-length after snap
            const std::uint32_t lo = static_cast<std::uint32_t>(a < b ? a : b);
            const std::uint32_t hi = static_cast<std::uint32_t>(a < b ? b : a);
            const std::uint64_t key = (static_cast<std::uint64_t>(lo) << 32) | hi;
            if (seenC.insert(key).second) c3.push_back({a, b});     // dedup undirected
        }
        cons.swap(c3);
        cdt = geom::constrainedDelaunay2D(pts, cons);
    }
    if (!cdt.ok) {
#ifdef FORGE_BOOL_IMPRINT_DEBUG
        std::fprintf(stderr, "    [imprint CDT FAIL] kind=%d pts=%zu cons=%zu reason=%s\n",
                     (int)s->kind, pts.size(), cons.size(), cdt.reason);
#endif
        return false;
    }

#ifdef FORGE_BOOL_IMPRINT_DEBUG
    if (!curves3D.empty()) {
        std::fprintf(stderr, "    [imprint] kind=%d pts=%zu cons=%zu cdt.tris=%zu\n",
                     (int)s->kind, pts.size(), cons.size(), cdt.triangles.size());
        for (std::size_t i = 0; i < pts.size(); ++i)
            std::fprintf(stderr, "      p%zu=(%.3f,%.3f)\n", i, pts[i].x, pts[i].y);
        for (std::size_t i = 0; i < cons.size(); ++i)
            std::fprintf(stderr, "      c%zu=(%d,%d)\n", i, cons[i].a, cons[i].b);
    }
#endif

    const bool curved = (s->kind != SurfaceKind::Plane);

    // Boundary loop as a param-space polygon (in mesh-local point order). The CDT
    // de-dups + reorders points, so map the original boundary vertices to the
    // mesh-local indices to rebuild the polygon for an exact point-in-polygon test.
    std::vector<geom::Point2> bpoly;
    for (int bi : boundIdx) {
        // bi indexes our `pts`; the CDT keeps the same coordinates, find the local
        // point with matching coordinates.
        bpoly.push_back(pts[bi]);
    }
    // Robust even-odd point-in-polygon (boundary loop) via ray crossing.
    auto inBoundary = [&](double qx, double qy) -> bool {
        bool in = false;
        std::size_t n = bpoly.size();
        for (std::size_t i = 0, j = n - 1; i < n; j = i++) {
            double xi = bpoly[i].x, yi = bpoly[i].y, xj = bpoly[j].x, yj = bpoly[j].y;
            if (((yi > qy) != (yj > qy)) &&
                (qx < (xj - xi) * (qy - yi) / (yj - yi) + xi))
                in = !in;
        }
        return in;
    };

    // Emit one SubFace per triangle whose centroid lies inside the face boundary
    // loop, keeping the parent surface. A planar sub-face is integrated exactly as
    // a polygon; a CURVED sub-face is a true patch of the SAME quadric, integrated
    // over its (u,v) parameter triangle (paramTri=true) so its mass is EXACT.
    for (std::size_t t = 0; t < cdt.triangles.size(); ++t) {
        const auto& tri = cdt.triangles[t];
        {
            double cx = (cdt.points[tri[0]].x + cdt.points[tri[1]].x + cdt.points[tri[2]].x) / 3.0;
            double cy = (cdt.points[tri[0]].y + cdt.points[tri[1]].y + cdt.points[tri[2]].y) / 3.0;
            if (!inBoundary(cx, cy)) continue;
        }
        SubFace sf = makeSubFromSurface(s, fromA, parentFaceIdx);
        double mnu = 1e300, mxu = -1e300, mnv = 1e300, mxv = -1e300;
        for (int k = 0; k < 3; ++k) {
            const geom::Point2& P = cdt.points[tri[k]];
            sf.vertexUV.push_back({P.x, P.y});
            sf.ring.push_back(s->evaluate(P.x, P.y));
            mnu = std::min(mnu, P.x); mxu = std::max(mxu, P.x);
            mnv = std::min(mnv, P.y); mxv = std::max(mxv, P.y);
        }
        sf.u0 = mnu; sf.u1 = mxu; sf.v0 = mnv; sf.v1 = mxv;
        sf.paramTri = curved;     // curved => integrate the (u,v) triangle
        sf.isDisk = false;        // planar cap disk annotation doesn't survive split
        out.push_back(std::move(sf));
    }
    return true;
}

// Classify a sub-face against the OTHER solid's soup by a MAJORITY VOTE over
// several interior sample points (centroid + points pulled from the centroid
// toward each ring vertex). A single centroid sample is fragile when the centroid
// happens to land exactly on the other solid's boundary — e.g. a box top face whose
// centroid coincides with a tangent cone apex on the axis: the lone centroid sits on
// the cone tip and classifies unstably with tessellation density, while the bulk of
// the face is clearly outside the cone. The vote over interior points (each strictly
// inside the sub-face, none of them the special centroid) is robust to that.
void classify(SubFace& sf, const SoupCache& other) {
    Vec3 c{0, 0, 0};
    for (const Vec3& p : sf.ring) c = vadd(c, p);
    c = vscale(c, 1.0 / sf.ring.size());

    // HOLED FACE: the outer-loop centroid may fall INSIDE a hole (a centred bore),
    // which would misclassify the face. Vote only over sample points proven to lie
    // in the ANNULUS — inside the outer loop AND outside every inner (hole) loop.
    if (sf.boolHoled && !sf.innerRings.empty() && sf.ring.size() >= 3) {
        Vec3 nrm = vnorm(vcross(vsub(sf.ring[1], sf.ring[0]), vsub(sf.ring[2], sf.ring[0])));
        Vec3 e1, e2; planeBasis(nrm, e1, e2);
        const Vec3 o = sf.ring[0];
        std::vector<geom::Point2> outer;
        for (const Vec3& p : sf.ring) outer.push_back(proj2(p, o, e1, e2));
        std::vector<std::vector<geom::Point2>> inners;
        for (const auto& ir : sf.innerRings) {
            std::vector<geom::Point2> q; for (const Vec3& p : ir) q.push_back(proj2(p, o, e1, e2));
            inners.push_back(std::move(q));
        }
        auto inAnnulus = [&](const Vec3& p) -> bool {
            geom::Point2 q = proj2(p, o, e1, e2);
            if (!pointInPoly2(outer, q.x, q.y)) return false;
            for (const auto& ip : inners) if (pointInPoly2(ip, q.x, q.y)) return false;
            return true;
        };
        int votesIn = 0, votes = 0;
        auto vote = [&](const Vec3& p) { if (inAnnulus(p)) { if (pointInSoup(other, p)) ++votesIn; ++votes; } };
        vote(c);
        for (const Vec3& p : sf.ring) vote(vadd(c, vscale(vsub(p, c), 0.6)));
        std::size_t n = sf.ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            Vec3 m = vscale(vadd(sf.ring[i], sf.ring[(i + 1) % n]), 0.5);
            vote(vadd(m, vscale(vsub(c, m), 0.05))); // just inside each outer edge
        }
        if (votes > 0) { sf.insideOther = (2 * votesIn > votes); return; }
        // (no annulus sample landed — fall through to the plain centroid vote)
    }

    int votesIn = 0, votes = 0;
    // centroid (weight 1)
    if (pointInSoup(other, c)) ++votesIn; ++votes;
    // a sample partway from the centroid to each ring vertex (interior of the face).
    for (const Vec3& p : sf.ring) {
        Vec3 s = vadd(c, vscale(vsub(p, c), 0.6)); // 60% toward the corner, still interior
        if (pointInSoup(other, s)) ++votesIn;
        ++votes;
    }
    sf.insideOther = (2 * votesIn > votes);
}

// LINEAGE (PD-7) — per result face, the (fromA, parentFaceIdx) it descends from,
// captured at the moment stitch mints the Face*. `generatedEdges` are the result
// edges shared by an A-piece and a B-piece (the imprinted SSI cut), which existed
// on neither input. booleanSolidAnalytic turns these into the indexed Modified /
// IsDeleted maps + the Generated-edge list on BooleanResult.
struct StitchLineage {
    struct FaceProv { Face* face; bool fromA; int parentFaceIdx; };
    std::vector<FaceProv> faceProv;       // one entry per surviving result face
    std::vector<Edge*>    generatedEdges; // SSI cut edges (A-piece | B-piece border)
};

// Build the final Solid from selected, correctly-oriented sub-faces. Welds
// coincident 3-D corner points to shared topological Vertices so the imprinted
// cut mates edge-for-edge (closed 2-manifold).
//
// `material(p)` returns true iff a point p is INSIDE the result solid's material
// (computed from the op + the two input soups). Each face's normal is oriented to
// point OUT of the material (toward empty space) by probing a tiny step along the
// analytic normal — robust regardless of each primitive's per-kind winding quirk
// (the sphere pole-fan winds opposite the cylinder, so a blanket per-op flip is
// wrong; the geometric probe is always right). The surface `reversed` flag is then
// set so MassProps/SolidTessellate integrate the genuine outward normal.
//
// `lineage` (out, PD-7) is populated with each result face's provenance + the
// generated cut edges. It is recorded ALONGSIDE the geometry — the solid built is
// byte-identical to the pre-lineage path; nothing here changes a vertex, edge, or
// face. Pass nullptr to skip (the mesh fallback does not call stitch).
template <class MaterialFn>
BooleanResult stitch(std::vector<SubFace>& subs, const char* reason,
                     MaterialFn&& material, StitchLineage* lineage = nullptr,
                     double weldGrid = 1e-7) {
    BooleanResult res;

    // ---- PASS 1: weld 3-D corners to integer vertex ids and orient each ring
    // so its winding follows the (op-adjusted) analytic outward normal. We do NOT
    // touch the TopologyBuilder yet — first we PROVE the candidate is a closed
    // 2-manifold combinatorially (every undirected edge used exactly twice, in
    // opposite directions). makeCoedge ASSERTS on a 3rd use, so we must never feed
    // it a non-manifold ring set; instead we detect it here and return ok=false
    // (the caller then falls back honestly).
    // Characteristic size (subface-ring bbox diagonal). Sets BOTH the orientation
    // probe step (eps) AND the scale-relative corner-weld floor (wtol) below.
    double diag = 0.0;
    {
        Aabb bb;
        for (SubFace& sf : subs) for (const Vec3& p : sf.ring) bb.add(p);
        diag = vlen(vsub(bb.hi, bb.lo));
    }
    const double eps = std::max(1e-7, 1e-5 * diag);

    std::map<std::tuple<long long, long long, long long>, int> weld;
    std::vector<Vec3> vpos;
    // Corner-weld grid. A fuzzy boolean passes a widened weldGrid; INDEPENDENTLY we
    // floor the grid at a SCALE-RELATIVE 1e-6*diag so the ~1e-5 SSI clip-overshoot
    // noise on a shared cut vertex collapses to ONE welded vertex. A partial cylinder
    // wall meeting a box side face deposits the SAME analytic corner as z=0 on one
    // contributing face and z=-1e-5 on the other (the SSI clip overshoots the
    // parametric boundary by ~1e-5); at the old fixed 1e-7 grid those land 100 cells
    // apart and split into two unmated boundary edges (the corner-notch stitch's 14
    // unmated edges). The 1e-6*diag floor (~5e-5 at a 50mm model) absorbs that noise
    // while staying >=1e4x below the smallest real CAD feature, so genuinely distinct
    // corners never merge — and the EXACT manifold pre-check below still guards it
    // (a wrong merge would fail the pre-check and fall back to mesh, not corrupt).
    const double wtol = std::max(weldGrid, 1e-6 * diag);
    auto vid = [&](const Vec3& p) -> int {
        auto key = std::make_tuple((long long)std::llround(p.x / wtol),
                                   (long long)std::llround(p.y / wtol),
                                   (long long)std::llround(p.z / wtol));
        auto it = weld.find(key);
        if (it != weld.end()) return it->second;
        int id = static_cast<int>(vpos.size());
        vpos.push_back(p);
        weld.emplace(key, id);
        return id;
    };

    struct OrientedFace {
        std::vector<int> vids;     // welded OUTER-loop vertex ids in final CCW order
        std::vector<std::array<double,2>> uv; // (u,v) per vid (final order)
        // HOLED FACE: welded INNER (hole) loop vertex ids, each ring oriented CW
        // w.r.t. the face's outward normal (opposite the outer CCW loop) so the
        // material is on the left of every coedge and the rim mates the bore wall.
        std::vector<std::vector<int>> innerVids;
        bool boolHoled = false;
        SubFace* sf = nullptr;
    };
    std::vector<OrientedFace> ofaces;

    for (SubFace& sf : subs) {
        if (sf.ring.size() < 3) continue;

        // 3-D centroid + the raw analytic normal (reversed flag NOT yet trusted).
        Vec3 c{0, 0, 0};
        for (const Vec3& p : sf.ring) c = vadd(c, p);
        c = vscale(c, 1.0 / sf.ring.size());
        Vec3 nRaw;
        {
            double um = 0.5 * (sf.u0 + sf.u1), vm = 0.5 * (sf.v0 + sf.v1);
            Surface tmp;
            tmp.kind = sf.kind; tmp.origin = sf.origin; tmp.axis = sf.axis;
            tmp.refDir = sf.refDir; tmp.r1 = sf.r1; tmp.r2 = sf.r2; tmp.param = sf.param;
            tmp.reversed = false;
            nRaw = tmp.normalAt(um, vm);
        }
        // Decide the OUTWARD direction geometrically: the side that is EMPTY (not
        // material) is outward. Probe both sides; pick the unambiguous one.
        bool plusInside  = material(vadd(c, vscale(nRaw, eps)));
        bool minusInside = material(vsub(c, vscale(nRaw, eps)));
        bool outwardIsPlus;
        if (plusInside == minusInside) {
            // Both material probes at the centroid agree => the centroid is not on a
            // material/empty boundary. For a PLANAR sub-face this can mean either (a)
            // a genuine COINCIDENT-FACE net-cancellation (e.g. a cone base disk lying
            // exactly on the cut solid's face — its WHOLE area is non-boundary, so it
            // must drop, leaving the rim shared by exactly two faces), or (b) a fragile
            // centroid that happens to sit on a tangent feature (e.g. a box top face
            // whose centroid coincides with a tangent cone apex on the axis) while the
            // face as a whole IS a real boundary. To tell them apart we VOTE over
            // interior points: only drop when the face is non-boundary EVERYWHERE.
            // Curved faces never net-cancel here (a narrow tip probe is unreliable).
            bool drop = false;
            if (sf.kind == SurfaceKind::Plane) {
                int bndy = 0, both = 0;
                for (const Vec3& rp : sf.ring) {
                    Vec3 cp = vadd(c, vscale(vsub(rp, c), 0.6)); // interior sample
                    bool pi = material(vadd(cp, vscale(nRaw, eps)));
                    bool mi = material(vsub(cp, vscale(nRaw, eps)));
                    if (pi == mi) ++both; else ++bndy;
                }
                if (bndy == 0 && both > 0) drop = true; // non-boundary everywhere
            }
            if (drop) continue;                  // coincident-face net-cancellation
            outwardIsPlus = !sf.reversedFlag;    // reversedFlag=true => outward is -nRaw
        } else {
            outwardIsPlus = (!plusInside && minusInside);
        }
        // reversed=true means normalAt returns -nRaw. We want normalAt == outward.
        sf.reversedFlag = outwardIsPlus ? false : true;
        Vec3 nWanted = outwardIsPlus ? nRaw : vscale(nRaw, -1.0);

        std::vector<Vec3> ring = sf.ring;
        std::vector<std::array<double,2>> uv = sf.vertexUV;
        Vec3 triN = vcross(vsub(ring[1], ring[0]), vsub(ring[2], ring[0]));
        if (vdot(triN, nWanted) < 0.0) {
            std::reverse(ring.begin(), ring.end());
            std::reverse(uv.begin(), uv.end());
        }

        std::vector<int> vring;
        vring.reserve(ring.size());
        for (const Vec3& p : ring) vring.push_back(vid(p));
        bool degen = false;
        for (std::size_t i = 0; i < vring.size(); ++i)
            for (std::size_t j = i + 1; j < vring.size(); ++j)
                if (vring[i] == vring[j]) degen = true;
        if (degen) continue;

        // HOLED FACE: weld + orient each inner (hole) ring. Each inner loop is wound
        // CW w.r.t. the face's outward normal nWanted (opposite the outer CCW loop)
        // so the hole interior stays on the right of every coedge — the standard
        // material-on-the-left convention — which makes each rim edge the exact
        // opposite-sense mate of the bore wall's rim coedge (closed 2-manifold).
        std::vector<std::vector<int>> innerVrings;
        bool innerDegen = false;
        for (const std::vector<Vec3>& iring : sf.innerRings) {
            if (iring.size() < 3) { innerDegen = true; break; }
            // Newell area-vector of the ring (translation-invariant for a closed loop).
            Vec3 pn{0, 0, 0};
            for (std::size_t k = 0; k < iring.size(); ++k)
                pn = vadd(pn, vcross(iring[k], iring[(k + 1) % iring.size()]));
            std::vector<Vec3> r = iring;
            if (vdot(pn, nWanted) > 0.0) std::reverse(r.begin(), r.end()); // -> CW vs nWanted
            std::vector<int> iv; iv.reserve(r.size());
            for (const Vec3& p : r) iv.push_back(vid(p));
            for (std::size_t a = 0; a < iv.size() && !innerDegen; ++a)
                for (std::size_t b = a + 1; b < iv.size(); ++b)
                    if (iv[a] == iv[b]) { innerDegen = true; break; }
            innerVrings.push_back(std::move(iv));
        }
        if (innerDegen) continue;

        OrientedFace of; of.vids = std::move(vring); of.uv = std::move(uv); of.sf = &sf;
        of.innerVids = std::move(innerVrings);
        of.boolHoled = sf.boolHoled && !of.innerVids.empty();
        ofaces.push_back(std::move(of));
    }

    if (ofaces.empty()) { res.reason = "analytic stitch: no faces survived"; return res; }

    // ---- Combinatorial manifold pre-check: every directed edge (a->b) must be
    // matched by exactly one opposite directed edge (b->a), and no undirected
    // edge may appear more than twice.
    std::map<std::pair<int,int>, int> directed;        // (a,b) -> count
    std::map<std::pair<int,int>, int> undirected;      // (min,max) -> count
    auto countRing = [&](const std::vector<int>& r) {
        std::size_t n = r.size();
        for (std::size_t i = 0; i < n; ++i) {
            int a = r[i], b = r[(i + 1) % n];
            directed[{a, b}]++;
            undirected[{std::min(a,b), std::max(a,b)}]++;
        }
    };
    for (const OrientedFace& of : ofaces) {
        countRing(of.vids);
        for (const std::vector<int>& iv : of.innerVids) countRing(iv);  // hole rims
    }
#ifdef FORGE_BOOL_DEBUG
    {
        std::map<int,int> hist;
        for (const auto& kv : undirected) hist[kv.second]++;
        std::fprintf(stderr, "[stitch] faces=%zu verts=%zu edgeMultHist:", ofaces.size(), vpos.size());
        for (auto& h : hist) std::fprintf(stderr, " %dx:%d", h.first, h.second);
        std::fprintf(stderr, "\n");
    }
#endif
    // Runtime diagnostic (env-gated, zero-cost when unset): the corner-notch stitch
    // fails the manifold pre-check; this reports the honest edge-multiplicity
    // histogram + the count of UNMATED undirected edges (mult != 2) so the closure
    // work can be measured before/after without a special compile.
    if (std::getenv("FORGE_BOOL_DIAG")) {
        std::map<int,int> hist;
        int unmated = 0, unopp = 0;
        for (const auto& kv : undirected) { hist[kv.second]++; if (kv.second != 2) ++unmated; }
        for (const auto& kv : directed) {
            auto opp = directed.find({kv.first.second, kv.first.first});
            if (kv.second != 1 || opp == directed.end() || opp->second != 1) ++unopp;
        }
        std::fprintf(stderr, "[bool-diag stitch '%s'] faces=%zu verts=%zu edgeMultHist:",
                     reason ? reason : "?", ofaces.size(), vpos.size());
        for (auto& h : hist) std::fprintf(stderr, " %dx:%d", h.first, h.second);
        std::fprintf(stderr, " | UNMATED(mult!=2)=%d unoppositelyMated=%d wtol=%.3g\n",
                     unmated, unopp, wtol);
        if (std::getenv("FORGE_BOOL_DIAG_EDGES")) {
            for (const auto& kv : undirected) {
                if (kv.second == 2) continue;
                const Vec3& a = vpos[kv.first.first];
                const Vec3& b = vpos[kv.first.second];
                std::fprintf(stderr, "    [unmated x%d] (%.6g,%.6g,%.6g)-(%.6g,%.6g,%.6g)\n",
                             kv.second, a.x, a.y, a.z, b.x, b.y, b.z);
                // Name every oface that uses this undirected edge (surface kind + normal
                // + ring centroid) so the contributing faces are identified directly.
                int e0 = kv.first.first, e1 = kv.first.second;
                for (const OrientedFace& of : ofaces) {
                    auto usesEdge = [&](const std::vector<int>& r) {
                        std::size_t n = r.size();
                        for (std::size_t i = 0; i < n; ++i) {
                            int x = r[i], y = r[(i + 1) % n];
                            if ((x == e0 && y == e1) || (x == e1 && y == e0)) return true;
                        }
                        return false;
                    };
                    bool hit = usesEdge(of.vids);
                    for (const auto& iv : of.innerVids) if (usesEdge(iv)) hit = true;
                    if (!hit) continue;
                    Vec3 cc{0,0,0}; for (int vv : of.vids) cc = vadd(cc, vpos[vv]);
                    if (!of.vids.empty()) cc = vscale(cc, 1.0 / of.vids.size());
                    const SubFace* sf = of.sf;
                    std::fprintf(stderr, "        used by kind=%d fromA=%d axis=(%.2g,%.2g,%.2g) nring=%zu centroid=(%.5g,%.5g,%.5g)\n",
                                 sf ? (int)sf->kind : -1, sf ? (int)sf->fromA : -1,
                                 sf ? sf->axis.x : 0.0, sf ? sf->axis.y : 0.0, sf ? sf->axis.z : 0.0,
                                 of.vids.size(), cc.x, cc.y, cc.z);
                }
            }
        }
    }
    for (const auto& kv : undirected)
        if (kv.second != 2) { res.reason = "analytic stitch: edge not shared by exactly 2 faces"; return res; }
    for (const auto& kv : directed) {
        if (kv.second != 1) { res.reason = "analytic stitch: duplicated directed edge (non-manifold)"; return res; }
        auto opp = directed.find({kv.first.second, kv.first.first});
        if (opp == directed.end() || opp->second != 1) {
            res.reason = "analytic stitch: edge not oppositely mated (non-manifold)"; return res;
        }
    }

    // ---- PASS 2: now SAFE to build the topology (proven 2-manifold above).
    auto owner = std::make_shared<TopologyBuilder>();
    Solid* solid = owner->makeSolid();
    Shell* shell = owner->makeShell();
    owner->addShellToSolid(solid, shell);

    std::vector<Vertex*> verts(vpos.size(), nullptr);
    for (std::size_t i = 0; i < vpos.size(); ++i)
        verts[i] = owner->makeVertex({vpos[i].x, vpos[i].y, vpos[i].z});

    // LINEAGE (PD-7): for each undirected welded edge (vid pair) record which input
    // solid(s) the faces using it came from. An edge touched by BOTH an A piece and
    // a B piece is an imprinted SSI cut edge (GENERATED — on neither input). 0x1 ==
    // touched by an A face, 0x2 == touched by a B face.
    std::map<std::pair<int,int>, int> edgeProvenance;

    for (const OrientedFace& of : ofaces) {
        SubFace& sf = *of.sf;
        std::vector<Vertex*> vring;
        vring.reserve(of.vids.size());
        for (int id : of.vids) vring.push_back(verts[id]);

        Face* f = owner->makeFace();
        owner->addFaceToShell(shell, f);
        owner->addOuterLoopToFace(f, vring);

        // HOLED FACE: attach each (already CW-oriented) inner hole loop. The bore
        // wall band re-uses the SAME welded rim vertices, so addInnerLoopToFace
        // shares the edges + mates the coedges (closed 2-manifold).
        for (const std::vector<int>& iv : of.innerVids) {
            std::vector<Vertex*> ivv; ivv.reserve(iv.size());
            for (int id : iv) ivv.push_back(verts[id]);
            if (ivv.size() >= 3) owner->addInnerLoopToFace(f, ivv);
        }
        f->boolHoled = of.boolHoled;

        Surface* surf = owner->makeSurface();
        surf->kind = sf.kind; surf->origin = sf.origin; surf->axis = sf.axis;
        surf->refDir = sf.refDir; surf->r1 = sf.r1; surf->r2 = sf.r2; surf->param = sf.param;
        surf->reversed = sf.reversedFlag;
        f->surface = surf;

        f->u0 = sf.u0; f->u1 = sf.u1; f->v0 = sf.v0; f->v1 = sf.v1;
        f->paramTri = sf.paramTri;
        // For a CURVED (paramTri) sub-face, the parameter triangle (carried in
        // `of.uv`, kept in sync with the final ring order) IS the integration
        // domain — use it verbatim. For a PLANAR face, vertexUV is the in-plane
        // polygon coords (recompute from the surface frame).
        f->vertexUV.clear();
        if (sf.paramTri) {
            f->vertexUV = of.uv;
        } else {
            for (int id : of.vids) {
                double u, v;
                if (projectToUV(surf, vpos[id], u, v)) f->vertexUV.push_back({u, v});
            }
        }

        // LINEAGE: record this result face's provenance + mark its edges' input(s).
        if (lineage) {
            lineage->faceProv.push_back({f, sf.fromA, sf.parentFaceIdx});
            auto markRing = [&](const std::vector<int>& r) {
                std::size_t n = r.size();
                for (std::size_t i = 0; i < n; ++i) {
                    int a = r[i], b = r[(i + 1) % n];
                    edgeProvenance[{std::min(a,b), std::max(a,b)}] |= (sf.fromA ? 0x1 : 0x2);
                }
            };
            markRing(of.vids);
            for (const std::vector<int>& iv : of.innerVids) markRing(iv); // hole rims
        }
    }

    if (!owner->isClosedTwoManifold()) {
        res.ok = false; res.reason = "analytic stitch not a closed 2-manifold"; return res;
    }
    EulerCounts c = owner->counts();
    if (c.faces == 0 || c.edges == 0 || c.vertices == 0) {
        res.ok = false; res.reason = "analytic stitch empty topology"; return res;
    }

    // LINEAGE (PD-7): collect the GENERATED edges = result edges whose two adjacent
    // faces come from DIFFERENT inputs (provenance 0x3 == 0x1|0x2). Those are the
    // imprinted SSI cut curves — they bound a surviving A piece against a surviving
    // B piece and existed on neither input. (An original input edge is always
    // shared by two faces of the SAME input, provenance 0x1 or 0x2 only.) Map each
    // such welded vid-pair back to its concrete result Edge* by walking the result
    // faces' coedges once. This is exact + cleanly separable from the SSI data.
    if (lineage) {
        // Map Vertex* -> welded vid so an Edge's (start,end) becomes a vid pair.
        std::map<const Vertex*, int> vToId;
        for (std::size_t i = 0; i < verts.size(); ++i) vToId[verts[i]] = (int)i;
        std::map<std::pair<int,int>, Edge*> uniqueEdge;
        auto collectLoopEdges = [&](Loop* lp) {
            if (!lp) return;
            Coedge* ce = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Edge* e = ce->edge;
                auto its = vToId.find(e->start), ite = vToId.find(e->end);
                if (its != vToId.end() && ite != vToId.end()) {
                    int a = its->second, b = ite->second;
                    uniqueEdge[{std::min(a,b), std::max(a,b)}] = e;
                }
                ce = ce->next;
            }
        };
        for (Shell* sh : solid->shells)
            for (Face* f : sh->faces) {
                collectLoopEdges(f->outerLoop);
                for (Loop* il : f->innerLoops) collectLoopEdges(il); // hole rims
            }
        for (const auto& kv : edgeProvenance)
            if (kv.second == 0x3) {
                auto it = uniqueEdge.find(kv.first);
                if (it != uniqueEdge.end()) lineage->generatedEdges.push_back(it->second);
            }
    }

    res.ok = true; res.reason = reason; res.solid = solid; res.owner = owner;
    res.usedMeshFallback = false;
    return res;
}

// The analytic boolean. Returns ok=false (reason set) when the configuration is
// outside the analytic envelope; the caller then routes to the mesh fallback.
BooleanResult booleanSolidAnalytic(const Solid& A, const Solid& B, BoolOp op,
                                   const BooleanOptions& opts) {
    BooleanResult fail; // ok=false by default; reason filled on the abort path

    // Gather faces.
    std::vector<Face*> fa, fb;
    for (Shell* sh : A.shells) for (Face* f : sh->faces) if (f->surface) fa.push_back(f);
    for (Shell* sh : B.shells) for (Face* f : sh->faces) if (f->surface) fb.push_back(f);
    if (fa.empty() || fb.empty()) { fail.reason = "analytic: empty face set"; return fail; }

    // Every face surface must be a kind the analytic path handles. If any face is
    // NURBS / Torus we defer the whole op (honest).
    auto kindOK = [](SurfaceKind k) {
        return k == SurfaceKind::Plane || k == SurfaceKind::Cylinder ||
               k == SurfaceKind::Cone  || k == SurfaceKind::Sphere;
    };
    for (Face* f : fa) if (!kindOK(f->surface->kind)) { fail.reason = "analytic: A has non-quadric face"; return fail; }
    for (Face* f : fb) if (!kindOK(f->surface->kind)) { fail.reason = "analytic: B has non-quadric face"; return fail; }

    // Precompute face AABBs.
    std::vector<Aabb> ba(fa.size()), bb(fb.size());
    for (std::size_t i = 0; i < fa.size(); ++i) ba[i] = faceAabb(fa[i]);
    for (std::size_t j = 0; j < fb.size(); ++j) bb[j] = faceAabb(fb[j]);

    // For each face, collect the imprint curves (in 3-D) from every crossing
    // partner face. If a crossing pair has NO closed-form SSI we must defer.
    // Per face: a list of imprint curves, each curve a 3-D polyline densely and
    // exactly sampled INSIDE the overlap region of the two faces (so a Line cut —
    // sampled over a huge span by the SSI — produces enough points crossing the
    // small face, not 1-2 grazing points).
    std::vector<std::vector<std::vector<Vec3>>> curvesForA(fa.size()), curvesForB(fb.size());
    SurfaceIntersectOptions sio; sio.sampleN = 256;
    // FUZZY BOOLEAN (C-FUZZY): widen the SSI geometric coincidence tolerance by the
    // fuzz so a pair of surfaces within `fuzz` is treated as coincident (not a
    // spurious sliver crossing). fuzz=0 leaves the exact 1e-9 default untouched.
    if (opts.fuzz > sio.tol) sio.tol = opts.fuzz;

    // FUZZY BOOLEAN (C-FUZZY): the face-pair overlap pad that decides which pairs
    // get imprinted is widened by the fuzz so near-coincident faces separated by a
    // gap <= fuzz are still mated. fuzz=0 leaves the exact 1e-7 pad untouched.
    const double padAabb = std::max(1e-7, opts.fuzz);
    for (std::size_t i = 0; i < fa.size(); ++i) {
        for (std::size_t j = 0; j < fb.size(); ++j) {
            if (!ba[i].overlaps(bb[j], padAabb)) continue;
            // overlap box of the two faces (where any imprint curve must live)
            Aabb ov;
            ov.lo.x = std::max(ba[i].lo.x, bb[j].lo.x); ov.hi.x = std::min(ba[i].hi.x, bb[j].hi.x);
            ov.lo.y = std::max(ba[i].lo.y, bb[j].lo.y); ov.hi.y = std::min(ba[i].hi.y, bb[j].hi.y);
            ov.lo.z = std::max(ba[i].lo.z, bb[j].lo.z); ov.hi.z = std::min(ba[i].hi.z, bb[j].hi.z);
            Surface sa = normalizeForSSI(*fa[i]->surface);
            Surface sb = normalizeForSSI(*fb[j]->surface);
            SurfaceIntersectResult r = intersectSurfaces(sa, sb, sio);
            if (!r.ok) { fail.reason = "analytic: a crossing pair has no closed-form SSI"; return fail; }
            if (!r.allClosedForm) { fail.reason = "analytic: SSI returned a marched curve"; return fail; }

            // When one face of the pair is a curved sector (cylinder/cone), the cut
            // CIRCLE must be discretized at THAT surface's angular vertices so the
            // planar face's imprinted hole mates EXACTLY with the curved wall's rim
            // (both sides get the SAME polyline -> welded vertices -> closed). The
            // curved face's sector width u1-u0 fixes its segment count.
            const Surface* curvedS = nullptr; double secW = 0;
            if (fa[i]->surface->kind == SurfaceKind::Cylinder || fa[i]->surface->kind == SurfaceKind::Cone) {
                curvedS = fa[i]->surface; secW = fa[i]->u1 - fa[i]->u0;
            } else if (fb[j]->surface->kind == SurfaceKind::Cylinder || fb[j]->surface->kind == SurfaceKind::Cone) {
                curvedS = fb[j]->surface; secW = fb[j]->u1 - fb[j]->u0;
            }
            for (const IntersectionCurve& cu : r.curves) {
                if (cu.kind == CurveKind::Empty || cu.kind == CurveKind::Point) continue;
                std::vector<Vec3> poly;
                if (cu.kind == CurveKind::Circle && curvedS && secW > 1e-9)
                    poly = sampleCircleOnCurved(cu, *curvedS, secW, ov);
                else
                    poly = sampleCurveInBox(cu, ov);
                if (poly.size() < 2) continue;
                curvesForA[i].push_back(poly);
                curvesForB[j].push_back(poly);
            }
        }
    }

    // Build OTHER-solid soups once for classification (weld grid from options).
    SoupCache soupA, soupB;
    buildSoup(A, soupA, opts.weldTol);
    buildSoup(B, soupB, opts.weldTol);

    // Imprint every face of A (classified vs B) and every face of B (vs A).
    std::vector<SubFace> subsA, subsB;
    for (std::size_t i = 0; i < fa.size(); ++i) {
        std::vector<SubFace> out;
        if (!imprintFace(fa[i], /*fromA=*/true, /*parentFaceIdx=*/(int)i, curvesForA[i], out)) {
            fail.reason = "analytic: imprint of an A face failed (CDT)"; return fail;
        }
        for (SubFace& sf : out) { classify(sf, soupB); subsA.push_back(std::move(sf)); }
    }
    for (std::size_t j = 0; j < fb.size(); ++j) {
        std::vector<SubFace> out;
        if (!imprintFace(fb[j], /*fromA=*/false, /*parentFaceIdx=*/(int)j, curvesForB[j], out)) {
            fail.reason = "analytic: imprint of a B face failed (CDT)"; return fail;
        }
        for (SubFace& sf : out) { classify(sf, soupA); subsB.push_back(std::move(sf)); }
    }

    // SELECT per op (ORIENTATION is decided geometrically in stitch, so no flip
    // flag here — the sphere pole-fan winds opposite the cylinder, so a per-op flip
    // is unreliable; stitch probes the material side instead).
    //   Fuse   : A-outside-B  ∪  B-outside-A
    //   Cut    : A-outside-B  ∪  B-inside-A
    //   Common : A-inside-B   ∪  B-inside-A
    std::vector<SubFace> chosen;
    auto take = [&](std::vector<SubFace>& src, bool wantInside) {
        for (SubFace& sf : src) {
            if (sf.insideOther != wantInside) continue;
            chosen.push_back(sf);
        }
    };
    switch (op) {
    case BoolOp::Fuse:
        take(subsA, /*inside=*/false);
        take(subsB, /*inside=*/false);
        break;
    case BoolOp::Cut:
        take(subsA, /*inside=*/false);
        take(subsB, /*inside=*/true);
        break;
    case BoolOp::Common:
        take(subsA, /*inside=*/true);
        take(subsB, /*inside=*/true);
        break;
    }
    if (chosen.empty()) { fail.reason = "analytic: empty selection"; return fail; }

    // Material predicate for the result: orient each face out of the material.
    // Use a small inward nudge to keep boundary samples robust (an ON-surface probe
    // would be ambiguous; the eps step in stitch resolves it).
    auto material = [&](const Vec3& p) -> bool {
        bool inA = pointInSoup(soupA, p);
        bool inB = pointInSoup(soupB, p);
        switch (op) {
        case BoolOp::Fuse:   return inA || inB;
        case BoolOp::Cut:    return inA && !inB;
        case BoolOp::Common: return inA && inB;
        }
        return false;
    };

#ifdef FORGE_BOOL_DEBUG
    {
        int na=0, nb=0; for (auto& sf : chosen) (sf.fromA?na:nb)++;
        std::fprintf(stderr, "[analytic %d] subsA=%zu subsB=%zu chosen=%zu (A=%d B=%d)\n",
                     (int)op, subsA.size(), subsB.size(), chosen.size(), na, nb);
        // print A-side counts inside/outside and B-side
        int aIn=0,aOut=0,bIn=0,bOut=0;
        for(auto&sf:subsA)(sf.insideOther?aIn:aOut)++;
        for(auto&sf:subsB)(sf.insideOther?bIn:bOut)++;
        std::fprintf(stderr,"   A in=%d out=%d ; B in=%d out=%d\n",aIn,aOut,bIn,bOut);
    }
#endif

    const char* tag = (op == BoolOp::Fuse) ? "ok (analytic fuse)"
                    : (op == BoolOp::Cut)  ? "ok (analytic cut)"
                                           : "ok (analytic common)";
    StitchLineage lin;
    // FUZZY BOOLEAN (C-FUZZY): pass the fuzz-widened corner-weld grid so the
    // near-coincident operand corners collapse to shared vertices in the stitch.
    BooleanResult res = stitch(chosen, tag, material, &lin, std::max(1e-7, opts.fuzz));
    if (!res.ok) return res;

    // ===================== BUILD THE LINEAGE MAPS (PD-7) =====================
    // MODIFIED: index each result face under the (fromA, parentFaceIdx) it came
    // from. An input face's list of result faces is its "modified" pieces.
    res.modifiedFromA.assign(fa.size(), {});
    res.modifiedFromB.assign(fb.size(), {});
    for (const StitchLineage::FaceProv& fp : lin.faceProv) {
        if (fp.parentFaceIdx < 0) continue;  // never on the analytic path
        if (fp.fromA) {
            if (fp.parentFaceIdx < (int)fa.size())
                res.modifiedFromA[fp.parentFaceIdx].push_back(fp.face);
        } else {
            if (fp.parentFaceIdx < (int)fb.size())
                res.modifiedFromB[fp.parentFaceIdx].push_back(fp.face);
        }
    }
    // IS-DELETED: an input face with ZERO surviving result faces was entirely
    // consumed by the op (e.g. a face fully inside the other solid for a Cut, or a
    // coincident-face net-cancellation in stitch). deleted == modified-list empty.
    res.deletedA.assign(fa.size(), false);
    res.deletedB.assign(fb.size(), false);
    for (std::size_t i = 0; i < fa.size(); ++i) res.deletedA[i] = res.modifiedFromA[i].empty();
    for (std::size_t j = 0; j < fb.size(); ++j) res.deletedB[j] = res.modifiedFromB[j].empty();
    // GENERATED edges: the imprinted SSI cut curves (collected in stitch).
    res.generatedEdges = std::move(lin.generatedEdges);
    return res;
}

} // namespace

// ===========================================================================
// TANGENT / NEAR-TANGENT PINCH PRE-DETECTOR — see Boolean.hpp. Pure geometry, no
// boolean / no tessellation. Scans every cylinder/equal-cone feature of either
// operand against every PLANAR face of the OTHER operand whose plane the feature
// axis is PARALLEL to (the only configuration whose tangency is a LINE pinch), and
// reports `degenerate` when the perpendicular axis->plane distance equals the radius
// to within a model-scaled eps AND the feature spatially reaches that face. A normal
// interior hole (wall thickness >> eps) is never flagged. Reuses the TU-local
// faceRing / Aabb helpers above (internal linkage, visible for the rest of the TU).
// ===========================================================================
TangentPinchReport detectBooleanTangentPinch(const Solid& A, const Solid& B, BoolOp /*op*/) {
    TangentPinchReport rep;

    // Per-solid AABB (and the combined extent that sets the model-scaled tolerance).
    auto solidAabb = [](const Solid& S) {
        Aabb b;
        for (Shell* sh : S.shells) for (Face* f : sh->faces)
            for (const Vec3& p : faceRing(f)) b.add(p);
        return b;
    };
    const Aabb aabbA = solidAabb(A), aabbB = solidAabb(B);
    Aabb all = aabbA; all.add(aabbB.lo); all.add(aabbB.hi);
    const double scale = std::max({1.0, all.hi.x - all.lo.x,
                                        all.hi.y - all.lo.y, all.hi.z - all.lo.z});
    const double eps    = std::max(1e-6, 1e-7 * scale);  // tangency / pinch band
    const double sinTol = 1e-4;                           // axis-∥-plane band (|cos|)
    rep.eps = eps;

    // A cylinder, or the equal-radius cone the SolidFactory emits for buildCylinder
    // (kind==Cone with r1==r2), both carry a single radius + axis line.
    auto cylRadius = [](const Surface* s, double& r) -> bool {
        if (!s) return false;
        if (s->kind == SurfaceKind::Cylinder) { r = s->r1; return r > 0.0; }
        if (s->kind == SurfaceKind::Cone && std::fabs(s->r1 - s->r2) < 1e-9) { r = s->r1; return r > 0.0; }
        return false;
    };

    // tool = the operand contributing the cylindrical wall; body = the operand whose
    // planar face that wall may pinch against. Both directions are scanned (a hole
    // tool may live in either operand, for any op).
    auto scan = [&](const Solid& tool, const Aabb& toolBB, const Solid& body) -> bool {
        // Gather the body's planar faces once (normal, point, AABB).
        struct PF { Vec3 n, p0; Aabb bb; };
        std::vector<PF> planes;
        for (Shell* sh : body.shells) for (Face* f : sh->faces) {
            const Surface* sp = f->surface;
            if (!sp || sp->kind != SurfaceKind::Plane) continue;
            PF pf; pf.n = vnorm(sp->axis); pf.p0 = sp->origin;
            for (const Vec3& p : faceRing(f)) pf.bb.add(p);
            planes.push_back(pf);
        }
        if (planes.empty()) return false;

        for (Shell* sh : tool.shells) for (Face* f : sh->faces) {
            double r;
            if (!cylRadius(f->surface, r)) continue;
            const Vec3 axis = vnorm(f->surface->axis);
            const Vec3 o    = f->surface->origin;          // a point on the axis line
            for (const PF& pf : planes) {
                // The pinch is a LINE only when the cylinder axis is parallel to the
                // plane (axis ⊥ plane normal). A non-parallel axis just punches the
                // face (a through-hole) — not a tangent pinch.
                if (std::fabs(vdot(axis, pf.n)) > sinTol) continue;
                // The feature must actually reach this face's region (reject a tangency
                // to a distant coplanar face elsewhere in a multi-body operand).
                if (!toolBB.overlaps(pf.bb, eps + 1e-6 * scale)) continue;
                // axis->plane signed distance (constant along an axis ∥ the plane).
                const double dist = vdot(vsub(o, pf.p0), pf.n);
                const double wall = std::fabs(dist) - r;   // ~0 => tangent / sub-eps sliver
                if (std::fabs(wall) < eps) {
                    rep.degenerate = true;
                    rep.radius   = r;
                    rep.perpDist = std::fabs(dist);
                    rep.wall     = wall;
                    return true;
                }
            }
        }
        return false;
    };

    if (scan(B, aabbB, A)) return rep;   // hole tool in B vs body A (the cut case)
    if (scan(A, aabbA, B)) return rep;   // symmetric (tool in A vs body B)
    return rep;                          // degenerate stays false
}

// ===========================================================================
// PUBLIC ENTRY — analytic first, flagged mesh fallback on any analytic miss.
// ===========================================================================
BooleanResult booleanSolid(const Solid& A, const Solid& B, BoolOp op,
                           const BooleanOptions& opts) {
    BooleanResult a = booleanSolidAnalytic(A, B, op, opts);
    if (a.ok) return a;
#ifdef FORGE_BOOL_DEBUG
    std::fprintf(stderr, "[booleanSolid] analytic miss: %s\n", a.reason);
#endif
    if (std::getenv("FORGE_BOOL_DIAG"))
        std::fprintf(stderr, "[bool-diag] analytic miss -> mesh fallback: %s\n",
                     a.reason ? a.reason : "(no reason)");
    // Analytic envelope miss — route through the proven mesh arrangement, FLAGGED.
    return booleanSolidMeshFallback(A, B, op, opts);
}

} // namespace brep
} // namespace native
} // namespace forge
