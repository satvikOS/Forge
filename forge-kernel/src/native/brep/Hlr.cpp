// forge/native/brep/Hlr.cpp
//
// Implementation of hidden-line removal on the Forge native B-rep (Hlr.hpp).
// Pure C++20, no external deps. See the header for the honest scope envelope.

#include "forge/native/brep/Hlr.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <unordered_set>

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

    auto pushTri = [&](const Vec3& a, const Vec3& b, const Vec3& c) {
        ViewTri t;
        t.faceId = f->id;
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
                pushTri(p00, p10, p11);
                pushTri(p00, p11, p01);
            }
        }
        return;
    }

    // Planar (or bare) face: fan over its outer-loop polygon.
    std::vector<Vec3> pts = loopCorners(f->outerLoop);
    if (pts.size() < 3) return;
    for (std::size_t t = 1; t + 1 < pts.size(); ++t) {
        pushTri(pts[0], pts[t], pts[t + 1]);
    }
}

// ----------------------------------------------------------------------------
// Depth test: is the 3D point `p` occluded by the solid as seen by the viewer?
//
// Project p to (uq, vq, dq). The viewer is at depth -infinity, so a face triangle
// occludes p iff the ray u=uq,v=vq pierces the triangle at a depth < dq - bias
// (strictly nearer the viewer). We exclude triangles whose source face is in
// `skipFaces` (the edge's own incident faces) so an edge is never hidden by the
// very faces it bounds.
// ----------------------------------------------------------------------------
bool occluded(const std::vector<ViewTri>& tris, double uq, double vq, double dq,
              const std::unordered_set<std::uint32_t>& skipFaces,
              double depthBias, double rayTol) {
    for (const ViewTri& t : tris) {
        if (skipFaces.count(t.faceId)) continue;
        // Barycentric of (uq,vq) in the triangle's (u,v).
        double area = orient2d(t.u[0], t.v[0], t.u[1], t.v[1], t.u[2], t.v[2]);
        if (std::fabs(area) < 1e-18) continue;     // degenerate / edge-on triangle
        double w0 = orient2d(t.u[1], t.v[1], t.u[2], t.v[2], uq, vq);
        double w1 = orient2d(t.u[2], t.v[2], t.u[0], t.v[0], uq, vq);
        double w2 = orient2d(t.u[0], t.v[0], t.u[1], t.v[1], uq, vq);
        double inv = 1.0 / area;
        double b0 = w0 * inv, b1 = w1 * inv, b2 = w2 * inv;
        double slack = rayTol / std::sqrt(std::fabs(area) + 1e-300);
        if (b0 < -slack || b1 < -slack || b2 < -slack) continue;  // outside tri
        double dhit = b0 * t.d[0] + b1 * t.d[1] + b2 * t.d[2];
        if (dhit < dq - depthBias) return true;    // a face is strictly in front
    }
    return false;
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

    // --- Build the occlusion triangle soup (view frame). ---------------------
    std::vector<ViewTri> tris;
    for (const Face* f : faces) emitFaceTris(fr, f, opt.curveTess, tris);

    // --- Collect distinct B-rep edges + their incident face ids. -------------
    struct EdgeJob {
        const Edge* edge = nullptr;
        std::unordered_set<std::uint32_t> incidentFaces;
        std::vector<Vec3> poly3d;        // sampled 3D polyline
        HlrEdgeKind kind = HlrEdgeKind::BRep;
    };
    std::vector<EdgeJob> jobs;
    std::unordered_set<const Edge*> seenEdge;

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
                        EdgeJob j;
                        j.edge = e;
                        j.poly3d = sampleEdge(e, opt.samplesPerEdge);
                        jobs.push_back(std::move(j));
                    }
                    // Record this face as incident to the edge.
                    for (EdgeJob& j : jobs) {
                        if (j.edge == e) { j.incidentFaces.insert(f->id); break; }
                    }
                }
                c = c->next;
            }
        }
    }

    // --- Add SILHOUETTE edges of curved analytic faces. ----------------------
    // The silhouette is the locus on the face where the surface normal is ⟂ to
    // the view direction (normal·N == 0). For an analytic quadric we find it by
    // marching the curved (u) parameter, sampling the v-curve, and detecting the
    // sign change of (normal·N) along v; the silhouette point is the zero crossing.
    for (const Face* f : faces) {
        const Surface* s = f->surface;
        if (!s || s->kind == SurfaceKind::Plane) continue;
        std::size_t nu = std::max<std::size_t>(opt.curveTess, 8);
        std::size_t nv = std::max<std::size_t>(opt.curveTess, 8);
        // For a cylinder/cone the silhouette runs along the axis (v) at the two
        // u (angle) values where the side normal is ⟂ N; for a sphere it is a
        // great circle. We collect silhouette points per u-isoline by detecting
        // normal·N sign changes across v, then stitch consecutive u columns.
        // General, kind-agnostic march: for each fixed u column, find v where the
        // dot crosses zero; for each fixed v row, find u where it crosses zero.
        auto dotN = [&](double u, double v) {
            return vdot(s->normalAt(u, v), fr.N);
        };
        std::vector<Vec3> sil;
        // March along u: at each u, scan v for a zero crossing of dotN.
        for (std::size_t i = 0; i <= nu; ++i) {
            double u = f->u0 + (f->u1 - f->u0) * (double(i) / double(nu));
            double prev = dotN(u, f->v0);
            for (std::size_t j = 1; j <= nv; ++j) {
                double v = f->v0 + (f->v1 - f->v0) * (double(j) / double(nv));
                double cur = dotN(u, v);
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
            // Order the silhouette points along the view-frame V axis (its long
            // run) so the polyline is monotone; good enough for the depth split.
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

    // --- Classify each edge into visible / hidden spans. ---------------------
    for (const EdgeJob& j : jobs) {
        const std::vector<Vec3>& P = j.poly3d;
        if (P.size() < 2) continue;

        // Per-span classification: a span is the segment P[k]..P[k+1]; we test its
        // midpoint depth against the occlusion soup (skipping the edge's incident
        // faces). Consecutive same-class spans are merged.
        std::size_t nspan = P.size() - 1;
        std::vector<char> spanHidden(nspan, 0);
        for (std::size_t k = 0; k < nspan; ++k) {
            Vec3 mid = vscale(vadd(P[k], P[k + 1]), 0.5);
            double uq, vq, dq;
            project(fr, mid, uq, vq, dq);
            bool h = occluded(tris, uq, vq, dq, j.incidentFaces,
                              opt.depthBias, opt.rayTol);
            spanHidden[k] = h ? 1 : 0;
        }

        // Merge runs of equal class into HlrSegments.
        bool sawVisible = false, sawHidden = false;
        std::size_t k = 0;
        while (k < nspan) {
            char cls = spanHidden[k];
            std::size_t start = k;
            while (k < nspan && spanHidden[k] == cls) ++k;
            // span covers vertices [start .. k] inclusive
            HlrSegment seg;
            seg.visibility = cls ? HlrVisibility::Hidden : HlrVisibility::Visible;
            seg.kind = j.kind;
            seg.edgeId = j.edge ? j.edge->id : 0u;
            double len2d = 0.0;
            for (std::size_t m = start; m <= k; ++m) {
                seg.poly3d.push_back(P[m]);
                double u, v, d;
                project(fr, P[m], u, v, d);
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
                        EdgeJob j;
                        j.edge = e;
                        j.poly3d = sampleEdge(e, opt.samplesPerEdge);
                        jobs.push_back(std::move(j));
                    }
                    for (EdgeJob& j : jobs)
                        if (j.edge == e) { j.incidentFaces.insert(f->id); break; }
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

    // --- Classify each edge into visible / hidden spans. ---------------------
    for (const EdgeJob& j : jobs) {
        const std::vector<Vec3>& P = j.poly3d;
        if (P.size() < 2) continue;
        std::size_t nspan = P.size() - 1;
        std::vector<char> spanHidden(nspan, 0);
        for (std::size_t k = 0; k < nspan; ++k) {
            Vec3 mid = vscale(vadd(P[k], P[k + 1]), 0.5);
            double depth = vdot(vsub(mid, fr.origin), fr.N);
            if (!(depth > 0.0)) { spanHidden[k] = 1; ++behindCount; continue; }
            bool h = occludedPersp(tris, cam.eye, mid, j.incidentFaces,
                                   opt.depthBias);
            spanHidden[k] = h ? 1 : 0;
        }

        bool sawVisible = false, sawHidden = false;
        std::size_t k = 0;
        while (k < nspan) {
            char cls = spanHidden[k];
            std::size_t start = k;
            while (k < nspan && spanHidden[k] == cls) ++k;
            HlrSegment seg;
            seg.visibility = cls ? HlrVisibility::Hidden : HlrVisibility::Visible;
            seg.kind = j.kind;
            seg.edgeId = j.edge ? j.edge->id : 0u;
            double len2d = 0.0;
            for (std::size_t m = start; m <= k; ++m) {
                seg.poly3d.push_back(P[m]);
                double uu, vv, dd;
                if (projectPersp(fr, focal, P[m], uu, vv, dd)) {
                    seg.poly2d.push_back({uu, vv});
                } else {
                    // Behind the eye plane: cannot project; mark with a sentinel
                    // so length accounting skips this span boundary cleanly.
                    seg.poly2d.push_back({uu = 0.0, vv = 0.0});
                }
                if (m > start && seg.poly2d.size() >= 2) {
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
    out.reason = (behindCount > 0)
        ? "ok (some samples were on/behind the eye plane; treated as hidden)"
        : "";
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
