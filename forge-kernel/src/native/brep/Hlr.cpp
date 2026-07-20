// forge/native/brep/Hlr.cpp
//
// Implementation of hidden-line removal on the Forge native B-rep (Hlr.hpp).
// Pure C++20, no external deps. See the header for the honest scope envelope.

#include "forge/native/brep/Hlr.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double k2Pi = 6.28318530717958647692;

inline bool finite3(const Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

// ----------------------------------------------------------------------------
// One occlusion triangle in the VIEW (U,V,depth) frame: vertices carry their 2D
// drawing coordinate (u,v) and their depth along +N (smaller == nearer viewer).
// `faceId` is the source Face id so an edge can skip its own incident faces.
// ----------------------------------------------------------------------------
struct ViewTri {
    double u[3], v[3], d[3];   // (u,v,depth) of the three corners
    std::uint32_t faceId = 0;
    bool isHole = false;       // triangle of an inner (hole) loop — a view WINDOW,
                               // not an occluder (the view passes through it)
};

// orient2d sign of (b-a)x(c-a) in the (u,v) plane.
inline double orient2d(double ax, double ay, double bx, double by,
                       double cx, double cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Build the right-handed (U,V,N) view frame from a (non-unit) view direction.
// N == normalize(viewDir). Returns false on a zero / non-finite direction.
bool makeFrame(const Vec3& viewDir, const Vec3& origin, HlrViewFrame& fr) {
    if (!finite3(viewDir)) return false;
    double n = vlen(viewDir);
    if (!(n > 0.0) || !std::isfinite(n)) return false;
    Vec3 N = vscale(viewDir, 1.0 / n);
    // Pick a helper axis least parallel to N, build U ⟂ N, then V = N x U.
    Vec3 helper = (std::fabs(N.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    Vec3 U = vnorm(vcross(helper, N));
    Vec3 V = vcross(N, U);   // already unit (N,U orthonormal)
    fr.origin = origin;
    fr.U = U;
    fr.V = V;
    fr.N = N;
    return true;
}

// Map a 3D point into (u, v, depth) of the view frame.
inline void project(const HlrViewFrame& fr, const Vec3& p,
                    double& u, double& v, double& depth) {
    Vec3 r = vsub(p, fr.origin);
    u = vdot(r, fr.U);
    v = vdot(r, fr.V);
    depth = vdot(r, fr.N);
}

// ----------------------------------------------------------------------------
// FEATURE-EDGE test: do faces `a` and `b` lie on the SAME underlying analytic
// surface across their shared edge (so the edge is a triangulation diagonal / a
// smooth tessellation seam, NOT a real model feature edge)? Returns true only
// when BOTH faces carry an analytic Surface of the same kind whose defining
// geometry coincides:
//   * Plane    — coplanar: parallel normals AND b's origin lies in a's plane.
//   * Cylinder — same axis LINE (parallel axes + zero perpendicular offset) and
//                equal radius (an edge on one wall of a faceted/tessellated cyl).
//   * Sphere   — same centre + equal radius.
//   * Cone     — same axis/apex frame + equal base/top radius + equal height.
//   * Torus    — same centre + axis + major/minor radius.
//   * Nurbs / bare-polygon (surface==nullptr) — NEVER coincident (kept): the
//     free-form tangent case is a follow-up, and null-surface faces (native
//     buildBox) are unaffected so the A/B-exact box results never change.
// The tolerance is relative so it is scale-free across mm/m models.
// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// Do two NURBS Surfaces carry the SAME rational control net? importOcctSolid
// facets ONE freeform source face into many tiny sub-faces that each hold a VALUE
// COPY of that face's single NurbsSurface (identical poles / weights / knots /
// degrees), while two DISTINCT source faces carry DIFFERENT nets. Comparing the
// full net (with dims / degrees / knot-endpoint early-outs) therefore tells a
// tessellation seam of ONE surface (true -> a smooth facet chord to suppress /
// silhouette) apart from a real face-face boundary (false -> a kept feature edge)
// even when the two patches share their boundary control row (C0 adjacency): the
// interior + far-side poles still differ. relTol is scale-relative.
// ----------------------------------------------------------------------------
inline bool sameNurbsSurface(const Surface* sa, const Surface* sb, double relTol) {
    if (!sa || !sb) return false;
    const NurbsSurface& A = sa->nurbs;
    const NurbsSurface& B = sb->nurbs;
    if (!A.valid() || !B.valid()) return false;
    if (A.degreeU != B.degreeU || A.degreeV != B.degreeV) return false;
    if (A.control.size() != B.control.size() || A.control.empty()) return false;
    if (A.control[0].size() != B.control[0].size()) return false;
    if (A.knotsU.size() != B.knotsU.size() ||
        A.knotsV.size() != B.knotsV.size()) return false;
    auto poleClose = [&](const Vec3& p, const Vec3& q) {
        double s = 1.0 + vlen(p) + vlen(q);
        return vlen(vsub(p, q)) <= relTol * s;
    };
    for (std::size_t i = 0; i < A.control.size(); ++i) {
        if (A.control[i].size() != B.control[i].size()) return false;
        for (std::size_t j = 0; j < A.control[i].size(); ++j)
            if (!poleClose(A.control[i][j], B.control[i][j])) return false;
    }
    auto knotClose = [&](const std::vector<double>& a, const std::vector<double>& b) {
        for (std::size_t i = 0; i < a.size(); ++i) {
            double s = 1.0 + std::fabs(a[i]) + std::fabs(b[i]);
            if (std::fabs(a[i] - b[i]) > relTol * s) return false;
        }
        return true;
    };
    if (!knotClose(A.knotsU, B.knotsU) || !knotClose(A.knotsV, B.knotsV)) return false;
    return true;
}

inline bool sameUnderlyingSurface(const Face* a, const Face* b, double relTol) {
    if (!a || !b) return false;
    const Surface* sa = a->surface;
    const Surface* sb = b->surface;
    if (!sa || !sb) return false;
    if (sa->kind != sb->kind) return false;
    auto parallel = [&](const Vec3& u, const Vec3& v) {
        double lu = vlen(u), lv = vlen(v);
        if (!(lu > 0.0) || !(lv > 0.0)) return false;
        return std::fabs(vdot(u, v) / (lu * lv)) > 1.0 - relTol;
    };
    auto nearVal = [&](double x, double y, double scale) {
        return std::fabs(x - y) <= relTol * (1.0 + std::fabs(scale));
    };
    switch (sa->kind) {
        case SurfaceKind::Plane: {
            if (!parallel(sa->axis, sb->axis)) return false;
            Vec3 d = vsub(sb->origin, sa->origin);
            Vec3 axn = vnorm(sa->axis);
            double scale = 1.0 + vlen(sa->origin) + vlen(sb->origin);
            return std::fabs(vdot(axn, d)) <= relTol * scale;  // b-origin in a-plane
        }
        case SurfaceKind::Cylinder: {
            if (!parallel(sa->axis, sb->axis)) return false;
            if (!nearVal(sa->r1, sb->r1, sa->r1)) return false;
            Vec3 d = vsub(sb->origin, sa->origin);
            Vec3 axn = vnorm(sa->axis);
            Vec3 perp = vsub(d, vscale(axn, vdot(d, axn)));   // offset ⟂ to axis
            return vlen(perp) <= relTol * (1.0 + sa->r1);
        }
        case SurfaceKind::Sphere: {
            return nearVal(sa->r1, sb->r1, sa->r1) &&
                   vlen(vsub(sa->origin, sb->origin)) <= relTol * (1.0 + sa->r1);
        }
        case SurfaceKind::Cone:
        case SurfaceKind::Torus: {
            return parallel(sa->axis, sb->axis) &&
                   nearVal(sa->r1, sb->r1, sa->r1) &&
                   nearVal(sa->r2, sb->r2, sa->r2) &&
                   nearVal(sa->param, sb->param, sa->param) &&
                   vlen(vsub(sa->origin, sb->origin)) <=
                       relTol * (1.0 + sa->r1 + std::fabs(sa->param));
        }
        case SurfaceKind::Nurbs:
            // Two facet sub-faces of ONE freeform source face carry identical
            // NurbsSurface copies -> coincident -> the interior chord is a smooth
            // tessellation seam (suppressed, then re-added view-dependently as a
            // MESH SILHOUETTE). A real boundary between two DISTINCT Nurbs faces
            // has a different net -> kept as a feature edge.
            return sameNurbsSurface(sa, sb, relTol);
        default:
            return false;  // free-form: keep (conservative)
    }
}

// The two DISTINCT incident faces of an edge (via its mated coedge slots), or
// {a,nullptr}. A non-manifold / boundary edge yields a null second face.
inline void edgeIncidentFaces(const Edge* e, Face*& fa, Face*& fb) {
    fa = (e && e->coedgeA && e->coedgeA->loop) ? e->coedgeA->loop->face : nullptr;
    fb = (e && e->coedgeB && e->coedgeB->loop) ? e->coedgeB->loop->face : nullptr;
}

// True iff `e` is a NON-FEATURE edge that should be suppressed under `opt`:
// a manifold edge whose two distinct incident faces coincide on one surface.
inline bool isSuppressedFeatureEdge(const Edge* e, const HlrOptions& opt) {
    if (!opt.cullSmoothEdges) return false;
    Face* fa; Face* fb;
    edgeIncidentFaces(e, fa, fb);
    if (!fa || !fb || fa == fb) return false;       // boundary / seam -> keep
    return sameUnderlyingSurface(fa, fb, opt.smoothTol);
}

// ----------------------------------------------------------------------------
// Sample a B-rep edge into an ordered 3D polyline of (n+1) points start->end.
// Uses the exact analytic Curve when the edge carries one (curved edges), else a
// straight segment between the two vertex positions.
// ----------------------------------------------------------------------------
std::vector<Vec3> sampleEdge(const Edge* e, std::size_t n) {
    std::vector<Vec3> pts;
    if (n < 1) n = 1;
    pts.reserve(n + 1);
    if (e->curve) {
        const Curve* c = e->curve;
        for (std::size_t i = 0; i <= n; ++i) {
            double t = c->t0 + (c->t1 - c->t0) * (double(i) / double(n));
            pts.push_back(c->evaluate(t));
        }
    } else {
        Vec3 a{e->start->point.x, e->start->point.y, e->start->point.z};
        Vec3 b{e->end->point.x, e->end->point.y, e->end->point.z};
        for (std::size_t i = 0; i <= n; ++i) {
            double s = double(i) / double(n);
            pts.push_back(vadd(vscale(a, 1.0 - s), vscale(b, s)));
        }
    }
    return pts;
}

// ----------------------------------------------------------------------------
// Collect the ordered 3D corner points of a face's outer loop.
// ----------------------------------------------------------------------------
std::vector<Vec3> loopCorners(const Loop* lp) {
    std::vector<Vec3> pts;
    if (!lp || !lp->first) return pts;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        Vertex* o = c->originVertex();
        pts.push_back(Vec3{o->point.x, o->point.y, o->point.z});
        c = c->next;
    }
    return pts;
}

// ----------------------------------------------------------------------------
// Outward normal of a FACET Face from its outer-loop winding. importOcctSolid
// orients every facet CCW-about-outward, so vnorm((c1-c0)x(c2-c0)) points OUT of
// the solid consistently across all sibling facets of one surface — which is all
// the mesh-silhouette straddle needs (it detects a SIGN CHANGE, invariant under a
// consistent global flip). Falls back to the reversed-aware analytic normalAt at
// the facet centroid if the ring is degenerate.
// ----------------------------------------------------------------------------
inline Vec3 facetOutwardNormal(const Face* f) {
    std::vector<Vec3> c = loopCorners(f->outerLoop);
    if (c.size() >= 3) {
        Vec3 n = vcross(vsub(c[1], c[0]), vsub(c[2], c[0]));
        if (vlen(n) > 0.0) return vnorm(n);
    }
    if (f->surface)
        return f->surface->normalAt(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1));
    return Vec3{0, 0, 1};
}

// ----------------------------------------------------------------------------
// Emit occlusion triangles for one face into `tris` (in the view frame).
//   * Planar / no-surface faces: fan-triangulate the outer-loop polygon (inner
//     hole loops are NOT filled — a hole lets the view through, exactly what an
//     occlusion test wants).
//   * Analytic curved faces (cylinder/cone/sphere/torus/nurbs): tessellate the
//     (u,v) trim rectangle into a grid of quads -> triangles.
// ----------------------------------------------------------------------------
void emitFaceTris(const HlrViewFrame& fr, const Face* f,
                  std::size_t curveTess, std::vector<ViewTri>& tris) {
    const Surface* s = f->surface;
    bool curved = s && s->kind != SurfaceKind::Plane;

    auto pushTri = [&](const Vec3& a, const Vec3& b, const Vec3& c,
                       bool hole) {
        ViewTri t;
        t.faceId = f->id;
        t.isHole = hole;
        project(fr, a, t.u[0], t.v[0], t.d[0]);
        project(fr, b, t.u[1], t.v[1], t.d[1]);
        project(fr, c, t.u[2], t.v[2], t.d[2]);
        tris.push_back(t);
    };

    if (curved) {
        std::size_t nu = std::max<std::size_t>(curveTess, 4);
        std::size_t nv = std::max<std::size_t>(8, curveTess / 6);
        for (std::size_t i = 0; i < nu; ++i) {
            double u0 = f->u0 + (f->u1 - f->u0) * (double(i) / double(nu));
            double u1 = f->u0 + (f->u1 - f->u0) * (double(i + 1) / double(nu));
            for (std::size_t j = 0; j < nv; ++j) {
                double v0 = f->v0 + (f->v1 - f->v0) * (double(j) / double(nv));
                double v1 = f->v0 + (f->v1 - f->v0) * (double(j + 1) / double(nv));
                Vec3 p00 = s->evaluate(u0, v0);
                Vec3 p10 = s->evaluate(u1, v0);
                Vec3 p11 = s->evaluate(u1, v1);
                Vec3 p01 = s->evaluate(u0, v1);
                pushTri(p00, p10, p11, false);
                pushTri(p00, p11, p01, false);
            }
        }
        return;
    }

    // Planar (or bare) face: fan over its outer-loop polygon (the occluder),
    // then fan each inner (hole) loop as WINDOW triangles so an occlusion test
    // that lands inside the hole passes through instead of being blocked.
    std::vector<Vec3> pts = loopCorners(f->outerLoop);
    if (pts.size() < 3) return;
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        pushTri(pts[0], pts[t], pts[t + 1], false);
    }
    for (const Loop* il : f->innerLoops) {
        std::vector<Vec3> hp = loopCorners(il);
        if (hp.size() < 3) continue;
        for (std::size_t t = 1; t + 1 < hp.size(); ++t) {
            pushTri(hp[0], hp[t], hp[t + 1], true);
        }
    }
}

// ----------------------------------------------------------------------------
// ANALYTIC visible/hidden classification (orthographic).
//
// The old classifier tested each edge span MIDPOINT at 1/samplesPerEdge sampled
// steps — a z-buffer whose visible/hidden boundary landed within one step of the
// true crossing (the ~5-9% split error the gate flagged). We replace the SAMPLED
// SPLIT with an ANALYTIC one: for a straight projected segment A->B we compute
// every parameter t at which its visibility can change, namely
//   (a) where its projection ENTERS/LEAVES an occluder face's projected outline
//       (segment vs projected-triangle clip endpoints — an outline crossing), and
//   (b) where its depth CROSSES an occluder face's plane depth (the in-front /
//       behind swap — both depths are linear in t, so this is one exact root).
// The segment is cut at those exact t's and each resulting piece is classified by
// a single ROBUST interior-midpoint depth test (hole-aware, with depthBias) — the
// same point-in-front test that reproduces the classic box counts exactly. Split
// points are therefore analytic (not sampled) while classification stays robust
// against silhouette grazing.
// ----------------------------------------------------------------------------

// Clip segment param t∈[0,1] of (uA,vA)->(uB,vB) to the INTERIOR of triangle T's
// (u,v) projection. Returns the positive-length overlap [te,tx] or false.
inline bool insideSegTri(const ViewTri& T,
                         double uA, double vA, double uB, double vB,
                         double& te, double& tx) {
    double area = orient2d(T.u[0], T.v[0], T.u[1], T.v[1], T.u[2], T.v[2]);
    if (std::fabs(area) < 1e-18) return false;      // edge-on / degenerate tri
    double sgn = area > 0.0 ? 1.0 : -1.0;
    double t0 = 0.0, t1 = 1.0;
    for (int e = 0; e < 3; ++e) {
        int a = e, b = (e + 1) % 3;
        double f0 = sgn * orient2d(T.u[a], T.v[a], T.u[b], T.v[b], uA, vA);
        double f1 = sgn * orient2d(T.u[a], T.v[a], T.u[b], T.v[b], uB, vB);
        if (f0 < 0.0 && f1 < 0.0) return false;     // wholly outside this edge
        if (f0 >= 0.0 && f1 >= 0.0) continue;       // wholly inside this edge
        double tc = f0 / (f0 - f1);                 // half-plane crossing
        if (f0 < 0.0) t0 = std::max(t0, tc);        // entering
        else          t1 = std::min(t1, tc);        // leaving
        if (t0 >= t1) return false;
    }
    te = t0; tx = t1;
    return t1 > t0;
}

// Depth of triangle T's plane at the (u,v) point (barycentric interpolation).
inline double planeDepthAt(const ViewTri& T, double qu, double qv) {
    double area = orient2d(T.u[0], T.v[0], T.u[1], T.v[1], T.u[2], T.v[2]);
    double b0 = orient2d(T.u[1], T.v[1], T.u[2], T.v[2], qu, qv) / area;
    double b1 = orient2d(T.u[2], T.v[2], T.u[0], T.v[0], qu, qv) / area;
    double b2 = orient2d(T.u[0], T.v[0], T.u[1], T.v[1], qu, qv) / area;
    return b0 * T.d[0] + b1 * T.d[1] + b2 * T.d[2];
}

// Is (qu,qv) inside triangle T's (u,v) projection (barycentric, small slack)?
inline bool pointInTri(const ViewTri& T, double qu, double qv, double slack) {
    double area = orient2d(T.u[0], T.v[0], T.u[1], T.v[1], T.u[2], T.v[2]);
    if (std::fabs(area) < 1e-18) return false;
    double inv = 1.0 / area;
    double b0 = orient2d(T.u[1], T.v[1], T.u[2], T.v[2], qu, qv) * inv;
    double b1 = orient2d(T.u[2], T.v[2], T.u[0], T.v[0], qu, qv) * inv;
    double b2 = orient2d(T.u[0], T.v[0], T.u[1], T.v[1], qu, qv) * inv;
    return b0 >= -slack && b1 >= -slack && b2 >= -slack;
}

// ===========================================================================
// OccluderBVH — a 2D bounding-volume hierarchy over the PROJECTED occluder
// triangle soup (the view (u,v) plane), the ACCELERATION structure that turns
// the per-piece occlusion tests from O(triangles) into O(log n).
//
// The two hot occlusion tests (occludedPoint, segmentSplitCandidates) each used
// to scan EVERY occluder triangle of EVERY face per edge piece — O(edges ×
// samples × triangles). For a drilled box (~50k occluder triangles) that is the
// ~5–20 s/view wall the K4 attempt-3 log measured. The BVH answers the two
// spatial queries those tests actually need:
//   * queryPoint(u,v)          -> triangles whose 2D AABB CONTAINS the point
//   * queryBox(bbox of segment) -> triangles whose 2D AABB OVERLAPS the segment box
// and the callers run the EXACT SAME interior tests (pointInTri / insideSegTri /
// planeDepthAt) over that pruned candidate set.
//
// OUTPUT-PRESERVING (byte-for-byte): the BVH returns a conservative SUPERSET of
// the triangles that could contribute — a triangle whose 2D AABB does not meet
// the query cannot pass pointInTri / insideSegTri anyway, so it never added a
// cut or an occlusion in the brute-force scan either. Every stored AABB is padded
// by a tiny relative epsilon (>= the interior tests' 1e-9 / 1e-12 barycentric
// slack footprint) so a triangle those tests would accept AT THEIR TOLERANCE is
// never pruned. Both occlusion results are therefore identical to the pre-BVH
// scan: the split-candidate MULTISET is identical (same triangles, same
// arithmetic; sort+unique is order-independent) and the occludedPoint boolean is
// identical (a per-face predicate OR'd over faces, order-independent).
// The tree splits by the MEDIAN INDEX on the longer centroid axis, so depth is
// log2(n) regardless of coordinate degeneracy.
// ===========================================================================
struct OccluderBVH {
    struct Item {
        double bmin[2], bmax[2];   // padded 2D AABB (u,v)
        double cx, cy;             // centroid (for the split)
        const ViewTri* tri;        // into the caller's stable triangle soup
    };
    struct Node {
        double bmin[2], bmax[2];
        std::uint32_t start = 0, count = 0;   // count>0 => leaf owning items[start..)
        std::uint32_t left = 0, right = 0;    // internal children
    };
    std::vector<Item> items;
    std::vector<Node> nodes;

    void build(const std::vector<ViewTri>& tris) {
        items.clear();
        nodes.clear();
        if (tris.empty()) return;
        items.reserve(tris.size());
        double ext = 0.0;
        for (const ViewTri& t : tris) {
            Item it;
            it.tri = &t;
            it.bmin[0] = std::min({t.u[0], t.u[1], t.u[2]});
            it.bmax[0] = std::max({t.u[0], t.u[1], t.u[2]});
            it.bmin[1] = std::min({t.v[0], t.v[1], t.v[2]});
            it.bmax[1] = std::max({t.v[0], t.v[1], t.v[2]});
            it.cx = 0.5 * (it.bmin[0] + it.bmax[0]);
            it.cy = 0.5 * (it.bmin[1] + it.bmax[1]);
            ext = std::max(ext, std::max(it.bmax[0] - it.bmin[0],
                                         it.bmax[1] - it.bmin[1]));
            items.push_back(it);
        }
        // Pad each AABB by a tiny relative epsilon (far above the interior tests'
        // ~1e-9·extent slack footprint) so pruning can NEVER drop a triangle the
        // exact tests would accept -> output stays byte-for-byte identical.
        const double pad = 1e-7 * (ext > 0.0 ? ext : 1.0);
        for (Item& it : items) {
            it.bmin[0] -= pad; it.bmin[1] -= pad;
            it.bmax[0] += pad; it.bmax[1] += pad;
        }
        nodes.reserve(2 * items.size());
        buildRange(0, static_cast<std::uint32_t>(items.size()));
    }

    void queryPoint(double qu, double qv, std::vector<const ViewTri*>& out) const {
        if (nodes.empty()) return;
        std::uint32_t stack[64];
        int sp = 0;
        stack[sp++] = 0;
        while (sp > 0) {
            const Node& nd = nodes[stack[--sp]];
            if (qu < nd.bmin[0] || qu > nd.bmax[0] ||
                qv < nd.bmin[1] || qv > nd.bmax[1]) continue;
            if (nd.count > 0) {
                for (std::uint32_t i = 0; i < nd.count; ++i) {
                    const Item& it = items[nd.start + i];
                    if (qu >= it.bmin[0] && qu <= it.bmax[0] &&
                        qv >= it.bmin[1] && qv <= it.bmax[1])
                        out.push_back(it.tri);
                }
            } else {
                stack[sp++] = nd.left;
                stack[sp++] = nd.right;
            }
        }
    }

    void queryBox(double xmin, double ymin, double xmax, double ymax,
                  std::vector<const ViewTri*>& out) const {
        if (nodes.empty()) return;
        std::uint32_t stack[64];
        int sp = 0;
        stack[sp++] = 0;
        while (sp > 0) {
            const Node& nd = nodes[stack[--sp]];
            if (xmax < nd.bmin[0] || xmin > nd.bmax[0] ||
                ymax < nd.bmin[1] || ymin > nd.bmax[1]) continue;
            if (nd.count > 0) {
                for (std::uint32_t i = 0; i < nd.count; ++i) {
                    const Item& it = items[nd.start + i];
                    if (xmax >= it.bmin[0] && xmin <= it.bmax[0] &&
                        ymax >= it.bmin[1] && ymin <= it.bmax[1])
                        out.push_back(it.tri);
                }
            } else {
                stack[sp++] = nd.left;
                stack[sp++] = nd.right;
            }
        }
    }

private:
    std::uint32_t buildRange(std::uint32_t first, std::uint32_t last) {
        const std::uint32_t ni = static_cast<std::uint32_t>(nodes.size());
        nodes.push_back(Node{});
        Node nd;
        nd.bmin[0] = nd.bmin[1] = std::numeric_limits<double>::infinity();
        nd.bmax[0] = nd.bmax[1] = -std::numeric_limits<double>::infinity();
        for (std::uint32_t i = first; i < last; ++i) {
            nd.bmin[0] = std::min(nd.bmin[0], items[i].bmin[0]);
            nd.bmin[1] = std::min(nd.bmin[1], items[i].bmin[1]);
            nd.bmax[0] = std::max(nd.bmax[0], items[i].bmax[0]);
            nd.bmax[1] = std::max(nd.bmax[1], items[i].bmax[1]);
        }
        const std::uint32_t n = last - first;
        constexpr std::uint32_t kLeaf = 4;
        if (n <= kLeaf) {
            nd.start = first;
            nd.count = n;
            nodes[ni] = nd;              // indices (not refs) survive vector growth
            return ni;
        }
        const int axis = (nd.bmax[0] - nd.bmin[0]) >= (nd.bmax[1] - nd.bmin[1]) ? 0 : 1;
        const std::uint32_t mid = first + n / 2;
        std::nth_element(items.begin() + first, items.begin() + mid,
                         items.begin() + last,
                         [axis](const Item& a, const Item& b) {
                             return (axis == 0 ? a.cx : a.cy) <
                                    (axis == 0 ? b.cx : b.cy);
                         });
        const std::uint32_t l = buildRange(first, mid);
        const std::uint32_t r = buildRange(mid, last);
        nd.count = 0;
        nd.left = l;
        nd.right = r;
        nodes[ni] = nd;
        return ni;
    }
};

// ROBUST point occlusion (hole-aware): is the projected point (uq,vq,dq) hidden
// by some face of the solid other than the edge's own incident faces? A face F
// hides the point iff the point lands inside F's outer projection, F's plane sits
// strictly in front (nearer the viewer by > depthBias), and the point is NOT
// inside one of F's hole windows (which would let the view straight through F).
// BVH-accelerated: only triangles whose 2D AABB contains the point are tested;
// per-face flags (bit0 = a solid tri occludes, bit1 = a window tri passes through)
// are OR-aggregated over that candidate set, then a face hides iff bit0 && !bit1.
// This is the SAME per-face predicate the pre-BVH scan applied, OR'd over faces.
inline bool occludedPoint(const OccluderBVH& bvh,
                          double uq, double vq, double dq,
                          const std::unordered_set<std::uint32_t>& skipFaces,
                          double depthBias) {
    static thread_local std::vector<const ViewTri*> refs;
    refs.clear();
    bvh.queryPoint(uq, vq, refs);
    if (refs.empty()) return false;
    static thread_local std::vector<std::pair<std::uint32_t, unsigned char>> agg;
    agg.clear();
    auto flags = [&](std::uint32_t fid) -> unsigned char& {
        for (auto& pr : agg) if (pr.first == fid) return pr.second;
        agg.emplace_back(fid, static_cast<unsigned char>(0));
        return agg.back().second;
    };
    for (const ViewTri* T : refs) {
        if (skipFaces.count(T->faceId)) continue;
        if (T->isHole) {
            if (pointInTri(*T, uq, vq, 1e-9)) flags(T->faceId) |= 0x2;   // through
        } else {
            if (pointInTri(*T, uq, vq, 1e-12)) {
                double dT = planeDepthAt(*T, uq, vq);
                if (dT < dq - depthBias) flags(T->faceId) |= 0x1;        // in front
            }
        }
    }
    for (const auto& pr : agg)
        if ((pr.second & 0x1) && !(pr.second & 0x2)) return true;
    return false;
}

// ANALYTIC split candidates: every param t∈(0,1) at which the visibility of the
// straight projected segment A->B could change — outline entry/exit against each
// occluder / window triangle, plus the depth crossing of each occluder plane.
// BVH-accelerated: only triangles whose 2D AABB overlaps the segment's bounding
// box are tested; insideSegTri then filters to the exact contributing set, so the
// candidate MULTISET (hence the sorted+unique result) is identical to the scan.
inline std::vector<double> segmentSplitCandidates(
        const OccluderBVH& bvh,
        double uA, double vA, double dA,
        double uB, double vB, double dB,
        const std::unordered_set<std::uint32_t>& skipFaces) {
    std::vector<double> cuts;
    auto add = [&](double t) {
        if (t > 1e-12 && t < 1.0 - 1e-12) cuts.push_back(t);
    };
    auto handle = [&](const ViewTri& T, bool depthToo) {
        double te, tx;
        if (!insideSegTri(T, uA, vA, uB, vB, te, tx)) return;
        add(te);                       // outline crossing (enter)
        add(tx);                       // outline crossing (leave)
        if (!depthToo) return;
        // depth crossing g(t)=depth_seg-depth_plane==0 within the overlap.
        double ue = uA + te * (uB - uA), ve = vA + te * (vB - vA);
        double ux = uA + tx * (uB - uA), vx = vA + tx * (vB - vA);
        double ge = (dA + te * (dB - dA)) - planeDepthAt(T, ue, ve);
        double gx = (dA + tx * (dB - dA)) - planeDepthAt(T, ux, vx);
        if ((ge <= 0.0) != (gx <= 0.0)) {
            double denom = gx - ge;
            if (std::fabs(denom) > 1e-300)
                add(te + (-ge / denom) * (tx - te));
        }
    };
    static thread_local std::vector<const ViewTri*> refs;
    refs.clear();
    const double qxmin = std::min(uA, uB), qxmax = std::max(uA, uB);
    const double qymin = std::min(vA, vB), qymax = std::max(vA, vB);
    bvh.queryBox(qxmin, qymin, qxmax, qymax, refs);
    for (const ViewTri* T : refs) {
        if (skipFaces.count(T->faceId)) continue;
        handle(*T, !T->isHole);        // solid -> depth crossing too; window -> no
    }
    std::sort(cuts.begin(), cuts.end());
    cuts.erase(std::unique(cuts.begin(), cuts.end(),
               [](double a, double b) { return std::fabs(a - b) < 1e-12; }),
               cuts.end());
    return cuts;
}

// ===========================================================================
// GROUPED ANALYTIC SILHOUETTE reconstruction for curved analytic faces.
//
// A curved analytic face imported by importOcctSolid is split into MANY narrow
// (u,v) sub-faces (each a paramTri / rectangle strip carrying the SAME underlying
// analytic Surface). A per-sub-face silhouette march scans only that strip's tiny
// [u0,u1]x[v0,v1] window, so no single strip spans the tangent locus where the
// surface normal is perpendicular to the view direction -> the outline is lost.
//
// We rebuild it by GROUPING the curved sub-faces by shared analytic-surface
// SIGNATURE (quantised kind/axis/radii/origin) AND shared-edge connectivity — the
// SAME grouping analyticFaceInventory (Query.cpp) uses to merge a STEP cylinder's
// strips back into one logical face — then trace the silhouette over each GROUP's
// FULL parameter range:
//   * Cylinder / Cone: the silhouette is the ISO-U line(s) (u const, v spans) where
//     the lateral normal is perpendicular to the view dir; solved in closed form
//     (a cos u + b sin u + c == 0) -> the 2 axis-parallel / slant outline lines.
//   * Sphere: the silhouette is the great circle in the plane through the centre
//     perpendicular to the view dir (exact), clipped to the face's (u,v) trim.
//   * Torus: the silhouette locus is traced by marching the grouped (u,v) grid in
//     BOTH directions for normal.viewDir sign changes, greedily stitched (no closed
//     form; strictly better than the per-strip march which finds none on an import).
// Each emitted curve carries the whole group's face-id set as its skip set, so the
// surface it lies on does not self-occlude its own outline (matching OCCT, which
// classifies the silhouette via OutLineVCompound).
// ===========================================================================
struct SilhouetteCurve {
    std::vector<Vec3> poly3d;
    std::unordered_set<std::uint32_t> skipFaces;   // the group's own faces
};

// Quantised analytic-surface signature (CURVED kinds only). Plane / Nurbs / null
// return a per-face UNIQUE key so they never group and never source a silhouette.
inline std::string curvedSurfaceSignature(const Face* f, std::size_t seed) {
    const Surface* s = f ? f->surface : nullptr;
    if (!s) return "U" + std::to_string(seed);
    SurfaceKind kind = s->kind;
    if (kind == SurfaceKind::Cone && std::fabs(s->r1 - s->r2) <= 1e-12)
        kind = SurfaceKind::Cylinder;             // a zero-taper cone IS a cylinder
    switch (kind) {
        case SurfaceKind::Cylinder:
        case SurfaceKind::Cone:
        case SurfaceKind::Sphere:
        case SurfaceKind::Torus:
            break;
        default:
            return "U" + std::to_string(seed);    // plane / nurbs -> unique
    }
    auto q = [](double x) { return std::llround(x / 1e-6); };
    const Vec3 ax = vnorm(s->axis);
    std::string key = "K" + std::to_string(static_cast<int>(kind));
    auto app = [&](double x) { key += '|'; key += std::to_string(q(x)); };
    app(ax.x); app(ax.y); app(ax.z);
    app(s->r1); app(s->r2);
    app(s->origin.x); app(s->origin.y); app(s->origin.z);
    return key;
}

// Is angle u (modulo 2*pi) within the trim window [lo,hi]?
inline bool angleInRange(double u, double lo, double hi) {
    for (int k = -2; k <= 2; ++k) {
        double uu = u + k * k2Pi;
        if (uu >= lo - 1e-9 && uu <= hi + 1e-9) return true;
    }
    return false;
}
// The representative of angle u shifted into [lo,hi] (call only when in range).
inline double angleRepresentative(double u, double lo, double hi) {
    for (int k = -2; k <= 2; ++k) {
        double uu = u + k * k2Pi;
        if (uu >= lo - 1e-9 && uu <= hi + 1e-9) return uu;
    }
    return u;
}

std::vector<SilhouetteCurve> computeSilhouettes(
        const std::vector<const Face*>& faces,
        const HlrViewFrame& fr,
        const HlrOptions& opt) {
    std::vector<SilhouetteCurve> out;

    // (1) Collect curved analytic faces (skip planes / nurbs / bare polygons).
    std::vector<const Face*> cf;
    cf.reserve(faces.size());
    for (const Face* f : faces) {
        const Surface* s = f ? f->surface : nullptr;
        if (!s) continue;
        if (s->kind == SurfaceKind::Plane || s->kind == SurfaceKind::Nurbs) continue;
        cf.push_back(f);
    }
    const std::size_t n = cf.size();
    if (n == 0) return out;

    // (2) Signature + shared-edge union-find (== analyticFaceInventory grouping).
    std::unordered_map<const Face*, std::size_t> idx;
    idx.reserve(n * 2);
    for (std::size_t i = 0; i < n; ++i) idx.emplace(cf[i], i);
    std::vector<std::string> sig(n);
    for (std::size_t i = 0; i < n; ++i) sig[i] = curvedSurfaceSignature(cf[i], i);
    std::vector<std::size_t> parent(n);
    for (std::size_t i = 0; i < n; ++i) parent[i] = i;
    auto find = [&](std::size_t x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    auto unite = [&](std::size_t a, std::size_t b) {
        std::size_t ra = find(a), rb = find(b);
        if (ra != rb) parent[std::max(ra, rb)] = std::min(ra, rb);
    };
    std::unordered_set<const Edge*> seen;
    for (const Face* f : cf) {
        std::vector<const Loop*> loops;
        if (f->outerLoop) loops.push_back(f->outerLoop);
        for (const Loop* il : f->innerLoops) loops.push_back(il);
        for (const Loop* lp : loops) {
            if (!lp || !lp->first) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount && c; ++i, c = c->next) {
                Edge* e = c->edge;
                if (!e || !seen.insert(e).second) continue;
                Face* fa; Face* fb; edgeIncidentFaces(e, fa, fb);
                if (!fa || !fb || fa == fb) continue;
                auto ia = idx.find(fa), ib = idx.find(fb);
                if (ia == idx.end() || ib == idx.end()) continue;
                if (sig[ia->second] == sig[ib->second]) unite(ia->second, ib->second);
            }
        }
    }

    // (3) Aggregate each component: rep surface + full (u,v) range + face-id set.
    struct Grp {
        const Surface* rep = nullptr;
        double uMin =  std::numeric_limits<double>::infinity();
        double uMax = -std::numeric_limits<double>::infinity();
        double vMin =  std::numeric_limits<double>::infinity();
        double vMax = -std::numeric_limits<double>::infinity();
        std::unordered_set<std::uint32_t> faceIds;
    };
    std::unordered_map<std::size_t, std::size_t> rootToGrp;
    std::vector<Grp> grps;
    for (std::size_t i = 0; i < n; ++i) {
        std::size_t r = find(i);
        std::size_t gi;
        auto it = rootToGrp.find(r);
        if (it == rootToGrp.end()) {
            gi = grps.size(); rootToGrp.emplace(r, gi);
            grps.push_back(Grp{}); grps[gi].rep = cf[r]->surface;
        } else gi = it->second;
        Grp& g = grps[gi];
        g.faceIds.insert(cf[i]->id);
        g.uMin = std::min(g.uMin, cf[i]->u0); g.uMax = std::max(g.uMax, cf[i]->u1);
        g.vMin = std::min(g.vMin, cf[i]->v0); g.vMax = std::max(g.vMax, cf[i]->v1);
    }

    // (4) Trace each group's silhouette analytically over its FULL parameter range.
    const Vec3 N = fr.N;
    for (const Grp& g : grps) {
        const Surface* s = g.rep;
        if (!s) continue;
        const Vec3 rd = vnorm(s->refDir);
        const Vec3 ax = vnorm(s->axis);
        const Vec3 bn = vcross(ax, rd);
        std::vector<std::vector<Vec3>> polylines;

        if (s->kind == SurfaceKind::Cylinder || s->kind == SurfaceKind::Cone) {
            // Lateral normal(u) direction is (see Surface.cpp evaluateDeriv):
            //   cylinder: (cos u, sin u, 0)          in the (refDir,binormal,axis) frame
            //   cone:     (param cos u, param sin u, -(r2-r1))
            // so normal.N == 0  <=>  a cos u + b sin u + c == 0 with:
            double a, b, c;
            if (s->kind == SurfaceKind::Cylinder) {
                a = vdot(rd, N); b = vdot(bn, N); c = 0.0;
            } else {
                a = s->param * vdot(rd, N);
                b = s->param * vdot(bn, N);
                c = -(s->r2 - s->r1) * vdot(ax, N);
            }
            double R = std::hypot(a, b);
            if (R > 1e-12) {                          // else: viewing along the axis
                double rhs = -c / R;
                if (rhs >= -1.0 - 1e-9 && rhs <= 1.0 + 1e-9) {
                    rhs = std::clamp(rhs, -1.0, 1.0);
                    double psi = std::atan2(b, a);    // a=R cos psi, b=R sin psi
                    double d = std::acos(rhs);
                    int nRoots = (d < 1e-9 || d > kPi - 1e-9) ? 1 : 2;
                    double roots[2] = { psi + d, psi - d };
                    for (int k = 0; k < nRoots; ++k) {
                        double u = roots[k];
                        if (!angleInRange(u, g.uMin, g.uMax)) continue;
                        double uu = angleRepresentative(u, g.uMin, g.uMax);
                        polylines.push_back({ s->evaluate(uu, g.vMin),
                                              s->evaluate(uu, g.vMax) });
                    }
                }
            }
        } else if (s->kind == SurfaceKind::Sphere) {
            // Silhouette == great circle in the plane through the centre perp to N.
            double r = s->r1;
            if (r > 0.0) {
                Vec3 helper = (std::fabs(N.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
                Vec3 e1 = vnorm(vcross(helper, N));
                Vec3 e2 = vcross(N, e1);
                std::size_t M = std::max<std::size_t>(opt.curveTess, 24);
                std::vector<Vec3> run;
                auto flush = [&]() {
                    if (run.size() >= 2) polylines.push_back(run);
                    run.clear();
                };
                for (std::size_t i = 0; i <= M; ++i) {
                    double t = k2Pi * (double(i) / double(M));
                    Vec3 p = vadd(s->origin,
                                  vadd(vscale(e1, r * std::cos(t)),
                                       vscale(e2, r * std::sin(t))));
                    Vec3 rel = vsub(p, s->origin);
                    double v = std::acos(std::clamp(vdot(rel, ax) / r, -1.0, 1.0));
                    double u = std::atan2(vdot(rel, bn), vdot(rel, rd));
                    bool inTrim = (v >= g.vMin - 1e-6 && v <= g.vMax + 1e-6) &&
                                  angleInRange(u, g.uMin, g.uMax);
                    if (inTrim) run.push_back(p);
                    else flush();
                }
                flush();
            }
        } else if (s->kind == SurfaceKind::Torus) {
            // No closed form: march normal.N == 0 over the FULL grouped (u,v) range
            // in BOTH scan directions, then greedily stitch the crossing points.
            std::size_t nu = std::max<std::size_t>(opt.curveTess, 24);
            std::size_t nv = std::max<std::size_t>(opt.curveTess, 24);
            auto dotN = [&](double u, double v) { return vdot(s->normalAt(u, v), N); };
            std::vector<Vec3> pts;
            for (std::size_t i = 0; i <= nu; ++i) {           // u-columns, scan v
                double u = g.uMin + (g.uMax - g.uMin) * (double(i) / double(nu));
                double prev = dotN(u, g.vMin);
                for (std::size_t j = 1; j <= nv; ++j) {
                    double v = g.vMin + (g.vMax - g.vMin) * (double(j) / double(nv));
                    double cur = dotN(u, v);
                    if ((prev <= 0.0) != (cur <= 0.0)) {
                        double vp = g.vMin + (g.vMax - g.vMin) * (double(j - 1) / double(nv));
                        double den = cur - prev;
                        double tc = std::fabs(den) > 1e-300 ? (-prev / den) : 0.5;
                        pts.push_back(s->evaluate(u, vp + (v - vp) * tc));
                    }
                    prev = cur;
                }
            }
            for (std::size_t j = 0; j <= nv; ++j) {           // v-rows, scan u
                double v = g.vMin + (g.vMax - g.vMin) * (double(j) / double(nv));
                double prev = dotN(g.uMin, v);
                for (std::size_t i = 1; i <= nu; ++i) {
                    double u = g.uMin + (g.uMax - g.uMin) * (double(i) / double(nu));
                    double cur = dotN(u, v);
                    if ((prev <= 0.0) != (cur <= 0.0)) {
                        double up = g.uMin + (g.uMax - g.uMin) * (double(i - 1) / double(nu));
                        double den = cur - prev;
                        double tc = std::fabs(den) > 1e-300 ? (-prev / den) : 0.5;
                        pts.push_back(s->evaluate(up + (u - up) * tc, v));
                    }
                    prev = cur;
                }
            }
            if (pts.size() >= 2) {
                double diag = vlen(vsub(s->evaluate(g.uMax, g.vMax),
                                        s->evaluate(g.uMin, g.vMin)));
                double gap = 0.15 * (diag > 0.0 ? diag : 1.0);
                std::vector<char> used(pts.size(), 0);
                std::size_t cur = 0; used[0] = 1;
                std::vector<Vec3> run{ pts[0] };
                for (std::size_t count = 1; count < pts.size(); ) {
                    double best = 1e300; std::size_t bi = pts.size();
                    for (std::size_t k = 0; k < pts.size(); ++k) {
                        if (used[k]) continue;
                        double dd = vlen(vsub(pts[k], pts[cur]));
                        if (dd < best) { best = dd; bi = k; }
                    }
                    if (bi == pts.size()) break;
                    used[bi] = 1; ++count;
                    if (best > gap) {
                        if (run.size() >= 2) polylines.push_back(run);
                        run.clear();
                    }
                    run.push_back(pts[bi]); cur = bi;
                }
                if (run.size() >= 2) polylines.push_back(run);
            }
        }

        for (std::vector<Vec3>& pl : polylines) {
            if (pl.size() < 2) continue;
            SilhouetteCurve sc;
            sc.poly3d = std::move(pl);
            sc.skipFaces = g.faceIds;
            out.push_back(std::move(sc));
        }
    }
    return out;
}

// ===========================================================================
// FREEFORM MESH (FACET) SILHOUETTE — the non-analytic sibling of
// computeSilhouettes. A freeform/NURBS source face imports as a FACET SOUP of
// tiny sub-faces that all carry a copy of ONE NurbsSurface and share real B-rep
// edges (mated coedges). The analytic tracer above skips Nurbs, so freeform parts
// had NO outline (the WALL-A defer to OCCT). Here we reconstruct it LOCALLY:
//
//   walk each distinct MANIFOLD facet edge whose two incident facets lie on the
//   SAME underlying Nurbs surface (sameNurbsSurface); if the two facets' outward
//   normals STRADDLE the view direction — dot(n_a,N) and dot(n_b,N) have opposite
//   sign (orthographic) — the shared edge is on the silhouette locus and is
//   emitted as a Silhouette EdgeJob. Its skip set is ONLY its two facets, so the
//   surface's own far-side facets still correctly hide the parts that wrap behind
//   on a non-convex body (unlike the analytic path which skips the whole group).
//
// No union-find / (u,v) aggregation is needed (unlike computeSilhouettes) because
// the mesh silhouette is purely LOCAL per edge. The result is CHORDED along the
// tessellation (staircases), valid and convergent under refinement. Fires ONLY
// when BOTH incident faces are kind==Nurbs, so buildBox / Plane / Cylinder faces
// are never touched. Classified visible/hidden by the UNCHANGED main loop.
// ===========================================================================
std::vector<SilhouetteCurve> computeMeshSilhouettes(
        const std::vector<const Face*>& faces,
        const HlrViewFrame& fr,
        const HlrOptions& opt) {
    std::vector<SilhouetteCurve> out;
    if (!opt.meshSilhouette) return out;
    const Vec3 N = fr.N;
    std::unordered_map<std::uint32_t, Vec3> nrmCache;   // facet normal, once per id
    auto fnorm = [&](const Face* f) -> Vec3 {
        auto it = nrmCache.find(f->id);
        if (it != nrmCache.end()) return it->second;
        Vec3 n = facetOutwardNormal(f);
        nrmCache.emplace(f->id, n);
        return n;
    };
    std::unordered_set<const Edge*> seen;
    for (const Face* f : faces) {
        const Surface* sf = f ? f->surface : nullptr;
        if (!sf || sf->kind != SurfaceKind::Nurbs) continue;
        std::vector<const Loop*> loops;
        if (f->outerLoop) loops.push_back(f->outerLoop);
        for (const Loop* il : f->innerLoops) loops.push_back(il);
        for (const Loop* lp : loops) {
            if (!lp || !lp->first) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount && c; ++i, c = c->next) {
                Edge* e = c->edge;
                if (!e || !seen.insert(e).second) continue;
                Face* fa; Face* fb; edgeIncidentFaces(e, fa, fb);
                if (!fa || !fb || fa == fb) continue;
                const Surface* sa = fa->surface;
                const Surface* sb = fb->surface;
                if (!sa || !sb) continue;
                if (sa->kind != SurfaceKind::Nurbs ||
                    sb->kind != SurfaceKind::Nurbs) continue;
                // A real face-face boundary (distinct nets) is NOT a facet seam.
                if (!sameNurbsSurface(sa, sb, opt.smoothTol)) continue;
                double da = vdot(fnorm(fa), N);
                double db = vdot(fnorm(fb), N);
                if ((da <= 0.0) == (db <= 0.0)) continue;   // no straddle -> interior
                SilhouetteCurve sc;
                sc.poly3d = sampleEdge(e, opt.samplesPerEdge);
                sc.skipFaces.insert(fa->id);
                sc.skipFaces.insert(fb->id);
                out.push_back(std::move(sc));
            }
        }
    }
    return out;
}

} // namespace

// ===========================================================================
// hiddenLineRemoval
// ===========================================================================
HlrResult hiddenLineRemoval(const Solid& solid,
                            const Vec3& viewDir,
                            const HlrOptions& opt) {
    HlrResult out;

    // --- Gather all faces + a model-bbox centre for the view origin. ---------
    std::vector<const Face*> faces;
    Vec3 lo{ std::numeric_limits<double>::infinity(),
             std::numeric_limits<double>::infinity(),
             std::numeric_limits<double>::infinity() };
    Vec3 hi{ -std::numeric_limits<double>::infinity(),
             -std::numeric_limits<double>::infinity(),
             -std::numeric_limits<double>::infinity() };
    bool any = false;
    for (const Shell* sh : solid.shells) {
        for (const Face* f : sh->faces) {
            faces.push_back(f);
            std::vector<Vec3> pts = loopCorners(f->outerLoop);
            for (const Vec3& p : pts) {
                lo.x = std::min(lo.x, p.x); lo.y = std::min(lo.y, p.y); lo.z = std::min(lo.z, p.z);
                hi.x = std::max(hi.x, p.x); hi.y = std::max(hi.y, p.y); hi.z = std::max(hi.z, p.z);
                any = true;
            }
        }
    }
    if (faces.empty() || !any) {
        out.reason = "empty solid (no faces / no geometry)";
        return out;
    }

    Vec3 centre{0.5 * (lo.x + hi.x), 0.5 * (lo.y + hi.y), 0.5 * (lo.z + hi.z)};
    HlrViewFrame fr;
    if (!makeFrame(viewDir, centre, fr)) {
        out.reason = "zero or non-finite view direction";
        return out;
    }
    out.frame = fr;

    // --- Build the occlusion triangle soup (view frame) + a 2D BVH over it. ---
    // The BVH is built ONCE per view; the per-piece occlusion tests below query
    // it (O(log n)) instead of scanning every triangle (O(n)). `tris` must outlive
    // the BVH (it holds ViewTri pointers into it) — it does (function-local).
    std::vector<ViewTri> tris;
    for (const Face* f : faces) emitFaceTris(fr, f, opt.curveTess, tris);
    OccluderBVH occBvh;
    occBvh.build(tris);

    // --- Collect distinct B-rep edges + their incident face ids. -------------
    struct EdgeJob {
        const Edge* edge = nullptr;
        std::unordered_set<std::uint32_t> incidentFaces;
        std::vector<Vec3> poly3d;        // sampled 3D polyline
        HlrEdgeKind kind = HlrEdgeKind::BRep;
    };
    std::vector<EdgeJob> jobs;
    std::unordered_set<const Edge*> seenEdge;
    std::unordered_set<const Edge*> suppressedEdges;   // non-feature (culled) edges

    for (const Face* f : faces) {
        // walk outer + inner loops
        std::vector<const Loop*> loops;
        if (f->outerLoop) loops.push_back(f->outerLoop);
        for (const Loop* il : f->innerLoops) loops.push_back(il);
        for (const Loop* lp : loops) {
            if (!lp || !lp->first) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Edge* e = c->edge;
                if (e) {
                    if (seenEdge.insert(e).second) {
                        // First sight: a NON-FEATURE edge (facet diagonal / smooth
                        // seam between two coincident analytic faces) is culled
                        // instead of drawn — the OCCT-HLR feature-edge behaviour.
                        if (isSuppressedFeatureEdge(e, opt)) {
                            suppressedEdges.insert(e);
                        } else {
                            EdgeJob j;
                            j.edge = e;
                            j.poly3d = sampleEdge(e, opt.samplesPerEdge);
                            jobs.push_back(std::move(j));
                        }
                    }
                    // Record this face as incident to the (kept) edge.
                    if (!suppressedEdges.count(e)) {
                        for (EdgeJob& j : jobs) {
                            if (j.edge == e) { j.incidentFaces.insert(f->id); break; }
                        }
                    }
                }
                c = c->next;
            }
        }
    }

    // --- Add SILHOUETTE edges of curved analytic faces (GROUPED). ------------
    // A faceted importOcctSolid body splits each curved face into many narrow
    // (u,v) sub-faces, so a per-sub-face silhouette march never spans the tangent
    // locus (and for a cylinder the radial normal is CONSTANT along v, so a v-scan
    // finds no crossing at all). We GROUP the sub-faces by shared analytic-surface
    // signature + shared-edge connectivity (like analyticFaceInventory) and trace
    // the silhouette over each GROUP's FULL parameter range — closed form for
    // cylinder/cone (iso-u outline lines) and sphere (great circle), marched for
    // torus. Each curve skips its own group's faces so the surface does not
    // self-occlude its outline (OCCT classifies the silhouette as OutLineVCompound).
    for (SilhouetteCurve& sc : computeSilhouettes(faces, fr, opt)) {
        if (sc.poly3d.size() < 2) continue;
        EdgeJob j;
        j.edge = nullptr;
        j.kind = HlrEdgeKind::Silhouette;
        j.incidentFaces = std::move(sc.skipFaces);
        j.poly3d = std::move(sc.poly3d);
        jobs.push_back(std::move(j));
    }

    // --- Add FREEFORM MESH (FACET) SILHOUETTE edges (non-analytic faces). ------
    // A freeform/NURBS body imports as a facet soup sharing one NurbsSurface; the
    // analytic tracer above skips it, so its interior facet chords were suppressed
    // as smooth seams with NO outline re-added (WALL A). Here we re-add the
    // view-dependent CHORDED outline: each same-surface facet chord whose two
    // incident facets' outward normals STRADDLE the view is a silhouette edge. It
    // skips ONLY its two facets, so the body's far side still hides wrap-behind
    // portions. Classified by the UNCHANGED main loop below.
    for (SilhouetteCurve& sc : computeMeshSilhouettes(faces, fr, opt)) {
        if (sc.poly3d.size() < 2) continue;
        EdgeJob j;
        j.edge = nullptr;
        j.kind = HlrEdgeKind::Silhouette;
        j.incidentFaces = std::move(sc.skipFaces);
        j.poly3d = std::move(sc.poly3d);
        jobs.push_back(std::move(j));
    }

    out.totalEdges = static_cast<std::uint32_t>(jobs.size());

    // --- Classify each edge into visible / hidden spans (ANALYTIC split). -----
    for (const EdgeJob& j : jobs) {
        const std::vector<Vec3>& P = j.poly3d;
        if (P.size() < 2) continue;

        // Cut the polyline at the EXACT occlusion crossings. For every straight
        // sub-segment P[k]->P[k+1] we compute the analytic hidden intervals and
        // split the sub-segment at their boundaries; `pts` collects the ordered
        // cut points (3D) and `pieceHidden[i]` the class of the piece between
        // pts[i] and pts[i+1].
        std::vector<Vec3> pts;
        std::vector<char> pieceHidden;
        pts.push_back(P[0]);
        for (std::size_t k = 0; k + 1 < P.size(); ++k) {
            const Vec3& A = P[k];
            const Vec3& B = P[k + 1];
            double uA, vA, dA, uB, vB, dB;
            project(fr, A, uA, vA, dA);
            project(fr, B, uB, vB, dB);

            // Analytic split points, then classify each piece by a robust
            // interior-midpoint depth test (hole-aware).
            std::vector<double> cuts = segmentSplitCandidates(
                occBvh, uA, vA, dA, uB, vB, dB, j.incidentFaces);
            cuts.insert(cuts.begin(), 0.0);
            cuts.push_back(1.0);

            for (std::size_t c = 0; c + 1 < cuts.size(); ++c) {
                double ta = cuts[c], tb = cuts[c + 1];
                if (tb - ta < 1e-15) continue;   // collapsed piece
                double tm = 0.5 * (ta + tb);
                double um = uA + tm * (uB - uA);
                double vm = vA + tm * (vB - vA);
                double dm = dA + tm * (dB - dA);
                char h = occludedPoint(occBvh, um, vm, dm,
                                       j.incidentFaces, opt.depthBias) ? 1 : 0;
                Vec3 end = vadd(vscale(A, 1.0 - tb), vscale(B, tb));  // point at tb
                pts.push_back(end);
                pieceHidden.push_back(h);
            }
        }

        // Merge consecutive same-class pieces into HlrSegments.
        bool sawVisible = false, sawHidden = false;
        std::size_t nseg = pieceHidden.size();
        std::size_t k = 0;
        while (k < nseg) {
            char cls = pieceHidden[k];
            std::size_t start = k;
            while (k < nseg && pieceHidden[k] == cls) ++k;
            // covers points [start .. k] inclusive
            HlrSegment seg;
            seg.visibility = cls ? HlrVisibility::Hidden : HlrVisibility::Visible;
            seg.kind = j.kind;
            seg.edgeId = j.edge ? j.edge->id : 0u;
            double len2d = 0.0;
            for (std::size_t m = start; m <= k; ++m) {
                seg.poly3d.push_back(pts[m]);
                double u, v, d;
                project(fr, pts[m], u, v, d);
                seg.poly2d.push_back({u, v});
                if (m > start) {
                    double du = seg.poly2d[seg.poly2d.size() - 1][0] - seg.poly2d[seg.poly2d.size() - 2][0];
                    double dv = seg.poly2d[seg.poly2d.size() - 1][1] - seg.poly2d[seg.poly2d.size() - 2][1];
                    len2d += std::sqrt(du * du + dv * dv);
                }
            }
            seg.length2d = len2d;
            if (cls) { ++out.hiddenSegments; out.hiddenLength2d += len2d; sawHidden = true; }
            else     { ++out.visibleSegments; out.visibleLength2d += len2d; sawVisible = true; }
            out.segments.push_back(std::move(seg));
        }

        if (sawVisible && sawHidden) ++out.partialEdges;
        else if (sawVisible)         ++out.fullyVisibleEdges;
        else if (sawHidden)          ++out.fullyHiddenEdges;
    }

    out.ok = true;
    out.reason = "";
    return out;
}

// ===========================================================================
// PERSPECTIVE HLR
// ===========================================================================
namespace {

// ----------------------------------------------------------------------------
// One 3D occlusion triangle (world coordinates) + its source Face id. The
// perspective path ray-casts a REAL 3D ray from the eye against these, so unlike
// the orthographic ViewTri we keep the unprojected corners.
// ----------------------------------------------------------------------------
struct WorldTri {
    Vec3 a, b, c;
    std::uint32_t faceId = 0;
};

// Emit world-space occlusion triangles for one face into `tris` (planar fan /
// analytic-quadric (u,v) grid — mirrors emitFaceTris but keeps 3D corners).
void emitFaceTrisWorld(const Face* f, std::size_t curveTess,
                       std::vector<WorldTri>& tris) {
    const Surface* s = f->surface;
    bool curved = s && s->kind != SurfaceKind::Plane;
    auto pushTri = [&](const Vec3& a, const Vec3& b, const Vec3& c) {
        tris.push_back(WorldTri{a, b, c, f->id});
    };
    if (curved) {
        std::size_t nu = std::max<std::size_t>(curveTess, 4);
        std::size_t nv = std::max<std::size_t>(8, curveTess / 6);
        for (std::size_t i = 0; i < nu; ++i) {
            double u0 = f->u0 + (f->u1 - f->u0) * (double(i) / double(nu));
            double u1 = f->u0 + (f->u1 - f->u0) * (double(i + 1) / double(nu));
            for (std::size_t j = 0; j < nv; ++j) {
                double v0 = f->v0 + (f->v1 - f->v0) * (double(j) / double(nv));
                double v1 = f->v0 + (f->v1 - f->v0) * (double(j + 1) / double(nv));
                Vec3 p00 = s->evaluate(u0, v0);
                Vec3 p10 = s->evaluate(u1, v0);
                Vec3 p11 = s->evaluate(u1, v1);
                Vec3 p01 = s->evaluate(u0, v1);
                pushTri(p00, p10, p11);
                pushTri(p00, p11, p01);
            }
        }
        return;
    }
    std::vector<Vec3> pts = loopCorners(f->outerLoop);
    if (pts.size() < 3) return;
    for (std::size_t t = 1; t + 1 < pts.size(); ++t)
        pushTri(pts[0], pts[t], pts[t + 1]);
}

// Build the camera basis: N = look (eye->target), U = right, V = up. Returns
// false on eye==target or `up` parallel to the look direction.
bool makeCameraFrame(const HlrCamera& cam, HlrViewFrame& fr) {
    Vec3 look = vsub(cam.target, cam.eye);
    if (!finite3(look)) return false;
    double ln = vlen(look);
    if (!(ln > 0.0) || !std::isfinite(ln)) return false;
    Vec3 N = vscale(look, 1.0 / ln);
    if (!finite3(cam.up)) return false;
    Vec3 U = vcross(N, cam.up);          // right = look x up
    double un = vlen(U);
    if (!(un > 1e-12) || !std::isfinite(un)) return false;  // up parallel to look
    U = vscale(U, 1.0 / un);
    Vec3 V = vcross(U, N);               // true up, orthonormal (unit)
    fr.origin = cam.eye;
    fr.U = U;
    fr.V = V;
    fr.N = N;
    return true;
}

// Perspective-project a world point through the eye onto the image plane.
//   depth = (p - eye)·N  (eye-relative depth; > 0 is in front of the eye)
//   u_img = focal * (p-eye)·U / depth ,  v_img = focal * (p-eye)·V / depth
// Returns false when depth <= 0 (point on / behind the eye plane).
inline bool projectPersp(const HlrViewFrame& fr, double focal, const Vec3& p,
                         double& uImg, double& vImg, double& depth) {
    Vec3 r = vsub(p, fr.origin);
    depth = vdot(r, fr.N);
    if (!(depth > 0.0) || !std::isfinite(depth)) return false;
    double su = vdot(r, fr.U);
    double sv = vdot(r, fr.V);
    uImg = focal * su / depth;
    vImg = focal * sv / depth;
    return true;
}

// Möller–Trumbore: does the ray eye + t*dir (t in (0, tMax)) pierce triangle
// (a,b,c)? On a hit sets `tHit` (the ray parameter). Both faces accepted
// (single-sided culling is wrong for a closed solid viewed from outside).
bool rayHitsTri(const Vec3& eye, const Vec3& dir,
                const Vec3& a, const Vec3& b, const Vec3& c,
                double tMax, double& tHit) {
    const double EPS = 1e-12;
    Vec3 e1 = vsub(b, a);
    Vec3 e2 = vsub(c, a);
    Vec3 pvec = vcross(dir, e2);
    double det = vdot(e1, pvec);
    if (std::fabs(det) < EPS) return false;       // ray parallel to triangle
    double inv = 1.0 / det;
    Vec3 tvec = vsub(eye, a);
    double bu = vdot(tvec, pvec) * inv;
    if (bu < -1e-9 || bu > 1.0 + 1e-9) return false;
    Vec3 qvec = vcross(tvec, e1);
    double bv = vdot(dir, qvec) * inv;
    if (bv < -1e-9 || bu + bv > 1.0 + 1e-9) return false;
    double t = vdot(e2, qvec) * inv;
    if (t <= EPS || t >= tMax) return false;
    tHit = t;
    return true;
}

// Is the world point `p` occluded as seen from `eye`? Cast the ray eye->p and
// ask whether any face triangle (not in skipFaces) is pierced strictly nearer
// the eye than p itself. `depthBias` shrinks the search range so a face is only
// occluding when it sits in front by more than the bias (suppresses self-grazes).
bool occludedPersp(const std::vector<WorldTri>& tris, const Vec3& eye,
                   const Vec3& p,
                   const std::unordered_set<std::uint32_t>& skipFaces,
                   double depthBias) {
    Vec3 dir = vsub(p, eye);
    double dlen = vlen(dir);
    if (!(dlen > 0.0)) return false;
    // Parametrise the ray as eye + t*dir with the sample at t == 1. A blocker is
    // any hit at t in (eps, 1 - bias/dlen): strictly between the eye and sample.
    double tMax = 1.0 - depthBias / dlen;
    if (!(tMax > 0.0)) return false;
    double tHit;
    for (const WorldTri& t : tris) {
        if (skipFaces.count(t.faceId)) continue;
        if (rayHitsTri(eye, dir, t.a, t.b, t.c, tMax, tHit)) return true;
    }
    return false;
}

// ----------------------------------------------------------------------------
// ANALYTIC perspective split (the perspective analogue of segmentSplitCandidates).
//
// Under a pin-hole projection the image coordinates u_img,v_img of a straight
// world segment A->B are RATIONAL (non-linear) in the segment parameter t: the
// numerator dot(P-eye,U) is linear, the denominator depth=dot(P-eye,N) is linear,
// so the ratio is a Moebius map of t (the "post-projection depth non-linear in t"
// the orthographic image-space clip does NOT model). But EVERY perspective
// visibility change is exactly a WORLD-SPACE plane crossing that IS linear in t, so
// the exact split parameters are recovered in world space without dividing by depth:
//
//   * OUTLINE / SILHOUETTE crossing against an occluder triangle EDGE (Qi,Qj): the
//     projected segment crosses the projected occluder edge exactly where the eye
//     E, Qi, Qj and the segment point P(t) become COPLANAR, i.e.
//        dot(P(t)-E, (Qi-E)x(Qj-E)) == 0 .
//     That plane through the eye and the occluder edge maps, under central
//     projection, to the image line of the occluder edge - so its crossing is the
//     true silhouette/outline event (where the edge slips behind / out from an
//     occluder's projected boundary).
//   * DEPTH crossing (the in-front/behind swap) against the occluder FACE plane:
//     where P(t) pierces the triangle's supporting plane, dot(P(t)-Qa, m) == 0 with
//     m the face normal (Qb-Qa)x(Qc-Qa).
//   * EYE-PLANE crossing: where depth dot(P(t)-E, N) == 0 (the segment crosses the
//     image plane; ahead projects, behind cannot).
//
// Each condition is f(t)=fa+t(fb-fa)==0 with fa,fb the plane function evaluated at
// A,B - one exact root when fa,fb straddle 0. We collect every such root in (0,1),
// split there, and classify each piece by ONE exact eye-ray in-front test
// (occludedPersp) at its interior midpoint. So - exactly like the orthographic
// analytic path - a STRAIGHT edge is split at the TRUE crossings independent of
// samplesPerEdge (which now only pre-chords CURVED edges), not on a sampling grid.
// ----------------------------------------------------------------------------

// Exact root t in (0,1) of the plane function g(t)=dot(P(t)-ref, n), P(t)=A+t(B-A);
// appended to `cuts` only on a real sign straddle (a genuine crossing).
inline void addPlaneCrossing(std::vector<double>& cuts,
                             const Vec3& A, const Vec3& B,
                             const Vec3& ref, const Vec3& n) {
    double fa = vdot(vsub(A, ref), n);
    double fb = vdot(vsub(B, ref), n);
    bool na = (fa <= 0.0), nb = (fb <= 0.0);
    if (na == nb) return;                        // no sign change -> no crossing
    double denom = fa - fb;
    if (!(std::fabs(denom) > 1e-300)) return;
    double t = fa / denom;                       // g(t)==0
    if (t > 1e-12 && t < 1.0 - 1e-12) cuts.push_back(t);
}

// All analytic split parameters t in (0,1) at which the straight world segment
// A->B can change perspective visibility: the eye/image-plane crossing plus, per
// occluder triangle (excluding the edge's own incident faces), its three eye-edge
// silhouette planes and its supporting depth plane.
inline std::vector<double> perspSplitCandidates(
        const std::vector<WorldTri>& tris, const Vec3& eye, const Vec3& N,
        const Vec3& A, const Vec3& B,
        const std::unordered_set<std::uint32_t>& skipFaces) {
    std::vector<double> cuts;
    addPlaneCrossing(cuts, A, B, eye, N);                     // eye/image plane
    for (const WorldTri& t : tris) {
        if (skipFaces.count(t.faceId)) continue;
        // three planes through the eye and each triangle edge (outline events)
        addPlaneCrossing(cuts, A, B, eye, vcross(vsub(t.a, eye), vsub(t.b, eye)));
        addPlaneCrossing(cuts, A, B, eye, vcross(vsub(t.b, eye), vsub(t.c, eye)));
        addPlaneCrossing(cuts, A, B, eye, vcross(vsub(t.c, eye), vsub(t.a, eye)));
        // the triangle's own supporting plane (in-front/behind depth swap)
        addPlaneCrossing(cuts, A, B, t.a, vcross(vsub(t.b, t.a), vsub(t.c, t.a)));
    }
    std::sort(cuts.begin(), cuts.end());
    cuts.erase(std::unique(cuts.begin(), cuts.end(),
               [](double x, double y) { return std::fabs(x - y) < 1e-12; }),
               cuts.end());
    return cuts;
}

} // namespace

HlrResult hlrPerspective(const Solid& solid,
                         const HlrCamera& cam,
                         const HlrOptions& opt) {
    HlrResult out;

    // --- Validate the camera. -----------------------------------------------
    HlrViewFrame fr;
    if (!makeCameraFrame(cam, fr)) {
        out.reason = "degenerate camera (eye==target or up parallel to look)";
        return out;
    }
    if (!(cam.fovYRadians > 0.0) || !(cam.fovYRadians < kPi) ||
        !std::isfinite(cam.fovYRadians)) {
        out.reason = "fov out of range (0, pi)";
        return out;
    }
    double focal = 1.0 / std::tan(0.5 * cam.fovYRadians);
    out.frame = fr;

    // --- Gather faces. ------------------------------------------------------
    std::vector<const Face*> faces;
    for (const Shell* sh : solid.shells)
        for (const Face* f : sh->faces) faces.push_back(f);
    if (faces.empty()) {
        out.reason = "empty solid (no faces)";
        return out;
    }

    // --- World-space occlusion triangle soup (for eye-ray casting). ----------
    std::vector<WorldTri> tris;
    for (const Face* f : faces) emitFaceTrisWorld(f, opt.curveTess, tris);

    // --- Collect distinct B-rep edges + incident faces (mirrors the ortho path).
    struct EdgeJob {
        const Edge* edge = nullptr;
        std::unordered_set<std::uint32_t> incidentFaces;
        std::vector<Vec3> poly3d;
        HlrEdgeKind kind = HlrEdgeKind::BRep;
    };
    std::vector<EdgeJob> jobs;
    std::unordered_set<const Edge*> seenEdge;
    std::unordered_set<const Edge*> suppressedEdges;   // non-feature (culled) edges
    for (const Face* f : faces) {
        std::vector<const Loop*> loops;
        if (f->outerLoop) loops.push_back(f->outerLoop);
        for (const Loop* il : f->innerLoops) loops.push_back(il);
        for (const Loop* lp : loops) {
            if (!lp || !lp->first) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Edge* e = c->edge;
                if (e) {
                    if (seenEdge.insert(e).second) {
                        if (isSuppressedFeatureEdge(e, opt)) {
                            suppressedEdges.insert(e);
                        } else {
                            EdgeJob j;
                            j.edge = e;
                            j.poly3d = sampleEdge(e, opt.samplesPerEdge);
                            jobs.push_back(std::move(j));
                        }
                    }
                    if (!suppressedEdges.count(e)) {
                        for (EdgeJob& j : jobs)
                            if (j.edge == e) { j.incidentFaces.insert(f->id); break; }
                    }
                }
                c = c->next;
            }
        }
    }

    // --- Silhouette edges of curved analytic faces (perspective grazing). ----
    // The perspective silhouette is where the surface normal is ⟂ to the ray
    // FROM THE EYE to the surface point (normal·(p - eye) == 0); we march the
    // (u,v) grid and detect sign changes of that dot exactly like the ortho path
    // but with a per-sample eye direction.
    for (const Face* f : faces) {
        const Surface* s = f->surface;
        if (!s || s->kind == SurfaceKind::Plane) continue;
        std::size_t nu = std::max<std::size_t>(opt.curveTess, 8);
        std::size_t nv = std::max<std::size_t>(opt.curveTess, 8);
        auto dotEye = [&](double u, double v) {
            Vec3 p = s->evaluate(u, v);
            return vdot(s->normalAt(u, v), vsub(p, cam.eye));
        };
        std::vector<Vec3> sil;
        for (std::size_t i = 0; i <= nu; ++i) {
            double u = f->u0 + (f->u1 - f->u0) * (double(i) / double(nu));
            double prev = dotEye(u, f->v0);
            for (std::size_t j = 1; j <= nv; ++j) {
                double v = f->v0 + (f->v1 - f->v0) * (double(j) / double(nv));
                double cur = dotEye(u, v);
                if ((prev <= 0.0 && cur > 0.0) || (prev >= 0.0 && cur < 0.0)) {
                    double vprev = f->v0 + (f->v1 - f->v0) * (double(j - 1) / double(nv));
                    double denom = (cur - prev);
                    double tcross = (std::fabs(denom) > 1e-300) ? (-prev / denom) : 0.5;
                    double vz = vprev + (v - vprev) * tcross;
                    sil.push_back(s->evaluate(u, vz));
                }
                prev = cur;
            }
        }
        if (sil.size() >= 2) {
            std::sort(sil.begin(), sil.end(), [&](const Vec3& a, const Vec3& b) {
                return vdot(vsub(a, fr.origin), fr.V) < vdot(vsub(b, fr.origin), fr.V);
            });
            EdgeJob j;
            j.edge = nullptr;
            j.kind = HlrEdgeKind::Silhouette;
            j.incidentFaces.insert(f->id);
            j.poly3d = std::move(sil);
            jobs.push_back(std::move(j));
        }
    }

    out.totalEdges = static_cast<std::uint32_t>(jobs.size());

    // Track whether any geometry fell on / behind the eye plane (cannot project).
    std::uint32_t behindCount = 0;

    // --- Classify each edge into visible / hidden spans (ANALYTIC split). -----
    // Mirrors the orthographic analytic path: for every straight sub-segment we
    // solve the EXACT world-space crossing parameters (perspSplitCandidates) and
    // cut the sub-segment there, then classify each piece by ONE exact eye-ray
    // in-front test at its interior midpoint. Straight edges are therefore split
    // at the true silhouette/occlusion crossings regardless of samplesPerEdge.
    for (const EdgeJob& j : jobs) {
        const std::vector<Vec3>& P = j.poly3d;
        if (P.size() < 2) continue;

        // Cut every straight sub-segment at its analytic crossings; `pts` collects
        // the ordered 3D cut points and `pieceHidden[i]` the class of the piece
        // between pts[i] and pts[i+1] (mirrors the orthographic path exactly).
        std::vector<Vec3> pts;
        std::vector<char> pieceHidden;
        pts.push_back(P[0]);
        for (std::size_t k = 0; k + 1 < P.size(); ++k) {
            const Vec3& A = P[k];
            const Vec3& B = P[k + 1];
            std::vector<double> cuts = perspSplitCandidates(
                tris, cam.eye, fr.N, A, B, j.incidentFaces);
            cuts.insert(cuts.begin(), 0.0);
            cuts.push_back(1.0);
            for (std::size_t c = 0; c + 1 < cuts.size(); ++c) {
                double ta = cuts[c], tb = cuts[c + 1];
                if (tb - ta < 1e-15) continue;               // collapsed piece
                double tm = 0.5 * (ta + tb);
                Vec3 mid = vadd(vscale(A, 1.0 - tm), vscale(B, tm));
                char h;
                double depth = vdot(vsub(mid, fr.origin), fr.N);
                if (!(depth > 0.0)) { h = 1; ++behindCount; }  // behind eye -> hidden
                else h = occludedPersp(tris, cam.eye, mid, j.incidentFaces,
                                       opt.depthBias) ? 1 : 0;
                Vec3 end = vadd(vscale(A, 1.0 - tb), vscale(B, tb));  // point at tb
                pts.push_back(end);
                pieceHidden.push_back(h);
            }
        }

        // Merge consecutive same-class pieces into HlrSegments. Image coordinates
        // come from the perspective projection; a piece boundary on/behind the eye
        // plane cannot project (sentinel) and breaks the running length so no
        // spurious length is accrued across the projective singularity.
        bool sawVisible = false, sawHidden = false;
        std::size_t nseg = pieceHidden.size();
        std::size_t k = 0;
        while (k < nseg) {
            char cls = pieceHidden[k];
            std::size_t start = k;
            while (k < nseg && pieceHidden[k] == cls) ++k;
            HlrSegment seg;
            seg.visibility = cls ? HlrVisibility::Hidden : HlrVisibility::Visible;
            seg.kind = j.kind;
            seg.edgeId = j.edge ? j.edge->id : 0u;
            double len2d = 0.0;
            bool havePrev = false;
            double prevU = 0.0, prevV = 0.0;
            for (std::size_t m = start; m <= k; ++m) {
                seg.poly3d.push_back(pts[m]);
                double uu, vv, dd;
                if (projectPersp(fr, focal, pts[m], uu, vv, dd)) {
                    seg.poly2d.push_back({uu, vv});
                    if (havePrev) {
                        double du = uu - prevU, dv = vv - prevV;
                        len2d += std::sqrt(du * du + dv * dv);
                    }
                    prevU = uu; prevV = vv; havePrev = true;
                } else {
                    seg.poly2d.push_back({0.0, 0.0});   // on/behind eye plane sentinel
                    havePrev = false;
                }
            }
            seg.length2d = len2d;
            if (cls) { ++out.hiddenSegments; out.hiddenLength2d += len2d; sawHidden = true; }
            else     { ++out.visibleSegments; out.visibleLength2d += len2d; sawVisible = true; }
            out.segments.push_back(std::move(seg));
        }

        if (sawVisible && sawHidden) ++out.partialEdges;
        else if (sawVisible)         ++out.fullyVisibleEdges;
        else if (sawHidden)          ++out.fullyHiddenEdges;
    }

    out.ok = true;
    out.reason = (behindCount > 0)
        ? "ok (some samples were on/behind the eye plane; treated as hidden)"
        : "";
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
