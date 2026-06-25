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

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <map>
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

    std::vector<double> ap, bp;
    std::vector<std::uint32_t> ai, bi;
    tessellateSolid(A, ap, ai, opts.weldTol);
    tessellateSolid(B, bp, bi, opts.weldTol);
    if (ai.empty() || bi.empty()) { res.reason = "empty input tessellation"; return res; }
    ensurePositiveWinding(ap, ai);
    ensurePositiveWinding(bp, bi);

    mesh::BoolResultN br = mesh::meshBooleanNative(ap, ai, bp, bi, toMeshOp(op));
    if (!br.ok) { res.reason = br.reason ? br.reason : "mesh boolean ok=false"; return res; }

    auto owner = std::make_shared<TopologyBuilder>();
    Solid* solid = nullptr;
    if (!reconstructPlanar(br.mesh, *owner, solid)) {
        res.reason = "fallback reconstruction hit a degenerate triangle"; return res;
    }
    if (!owner->isClosedTwoManifold()) {
        res.reason = "fallback reconstructed solid is not a closed 2-manifold"; return res;
    }
    res.ok = true; res.reason = "ok (mesh fallback)"; res.solid = solid; res.owner = owner;
    return res;
}

} // namespace

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
    std::vector<Vec3> ring;                     // ordered 3-D corner points
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
        // collect distinct cut v-levels strictly inside (sv0,sv1)
        std::vector<double> cutsV;
        for (const auto& cv : curves3D) {
            double vmin = 1e300, vmax = -1e300; bool any = false;
            for (const Vec3& p : cv) {
                double u, v; if (!toParam(p, u, v)) continue;
                // only count samples whose u lies within this sector
                if (u < su0 - 1e-7 || u > su1 + 1e-7) continue;
                vmin = std::min(vmin, v); vmax = std::max(vmax, v); any = true;
            }
            if (!any) continue;
            if (vmax - vmin > 1e-4 * vspan) return false; // not constant-v -> defer
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
                     MaterialFn&& material, StitchLineage* lineage = nullptr) {
    BooleanResult res;

    // ---- PASS 1: weld 3-D corners to integer vertex ids and orient each ring
    // so its winding follows the (op-adjusted) analytic outward normal. We do NOT
    // touch the TopologyBuilder yet — first we PROVE the candidate is a closed
    // 2-manifold combinatorially (every undirected edge used exactly twice, in
    // opposite directions). makeCoedge ASSERTS on a 3rd use, so we must never feed
    // it a non-manifold ring set; instead we detect it here and return ok=false
    // (the caller then falls back honestly).
    std::map<std::tuple<long long, long long, long long>, int> weld;
    std::vector<Vec3> vpos;
    const double wtol = 1e-7;
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
        std::vector<int> vids;     // welded vertex ids in final CCW order
        std::vector<std::array<double,2>> uv; // (u,v) per vid (final order)
        SubFace* sf = nullptr;
    };
    std::vector<OrientedFace> ofaces;

    // Characteristic size for the orientation probe step.
    double diag = 0.0;
    {
        Aabb bb;
        for (SubFace& sf : subs) for (const Vec3& p : sf.ring) bb.add(p);
        diag = vlen(vsub(bb.hi, bb.lo));
    }
    const double eps = std::max(1e-7, 1e-5 * diag);

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

        OrientedFace of; of.vids = std::move(vring); of.uv = std::move(uv); of.sf = &sf;
        ofaces.push_back(std::move(of));
    }

    if (ofaces.empty()) { res.reason = "analytic stitch: no faces survived"; return res; }

    // ---- Combinatorial manifold pre-check: every directed edge (a->b) must be
    // matched by exactly one opposite directed edge (b->a), and no undirected
    // edge may appear more than twice.
    std::map<std::pair<int,int>, int> directed;        // (a,b) -> count
    std::map<std::pair<int,int>, int> undirected;      // (min,max) -> count
    for (const OrientedFace& of : ofaces) {
        std::size_t n = of.vids.size();
        for (std::size_t i = 0; i < n; ++i) {
            int a = of.vids[i], b = of.vids[(i + 1) % n];
            directed[{a, b}]++;
            undirected[{std::min(a,b), std::max(a,b)}]++;
        }
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
            std::size_t n = of.vids.size();
            for (std::size_t i = 0; i < n; ++i) {
                int a = of.vids[i], b = of.vids[(i + 1) % n];
                edgeProvenance[{std::min(a,b), std::max(a,b)}] |= (sf.fromA ? 0x1 : 0x2);
            }
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
        for (Shell* sh : solid->shells)
            for (Face* f : sh->faces) {
                Loop* lp = f->outerLoop;
                if (!lp) continue;
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

    const double padAabb = 1e-7;
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
    BooleanResult res = stitch(chosen, tag, material, &lin);
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
// PUBLIC ENTRY — analytic first, flagged mesh fallback on any analytic miss.
// ===========================================================================
BooleanResult booleanSolid(const Solid& A, const Solid& B, BoolOp op,
                           const BooleanOptions& opts) {
    BooleanResult a = booleanSolidAnalytic(A, B, op, opts);
    if (a.ok) return a;
#ifdef FORGE_BOOL_DEBUG
    std::fprintf(stderr, "[booleanSolid] analytic miss: %s\n", a.reason);
#endif
    // Analytic envelope miss — route through the proven mesh arrangement, FLAGGED.
    return booleanSolidMeshFallback(A, B, op, opts);
}

} // namespace brep
} // namespace native
} // namespace forge
