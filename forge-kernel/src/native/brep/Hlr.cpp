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

// A planar/curved face's occlusion triangles, split into occluders + windows.
struct FaceOccluder {
    std::uint32_t faceId = 0;
    std::vector<ViewTri> solid;   // outer-loop / surface triangles (occluders)
    std::vector<ViewTri> window;  // inner-loop (hole) triangles (let view through)
};

// Group the flat triangle soup by source face into occluder records.
inline std::vector<FaceOccluder> groupByFace(const std::vector<ViewTri>& tris) {
    std::map<std::uint32_t, std::size_t> idx;
    std::vector<FaceOccluder> out;
    for (const ViewTri& t : tris) {
        auto it = idx.find(t.faceId);
        std::size_t k;
        if (it == idx.end()) { k = out.size(); idx[t.faceId] = k;
                               out.push_back(FaceOccluder{t.faceId, {}, {}}); }
        else k = it->second;
        (t.isHole ? out[k].window : out[k].solid).push_back(t);
    }
    return out;
}

// ROBUST point occlusion (hole-aware): is the projected point (uq,vq,dq) hidden
// by some face of the solid other than the edge's own incident faces? A face F
// hides the point iff the point lands inside F's outer projection, F's plane sits
// strictly in front (nearer the viewer by > depthBias), and the point is NOT
// inside one of F's hole windows (which would let the view straight through F).
inline bool occludedPoint(const std::vector<FaceOccluder>& faces,
                          double uq, double vq, double dq,
                          const std::unordered_set<std::uint32_t>& skipFaces,
                          double depthBias) {
    for (const FaceOccluder& F : faces) {
        if (skipFaces.count(F.faceId)) continue;
        bool inFront = false;
        for (const ViewTri& T : F.solid) {
            if (!pointInTri(T, uq, vq, 1e-12)) continue;
            double dT = planeDepthAt(T, uq, vq);
            if (dT < dq - depthBias) { inFront = true; break; }
        }
        if (!inFront) continue;
        bool through = false;
        for (const ViewTri& T : F.window)
            if (pointInTri(T, uq, vq, 1e-9)) { through = true; break; }
        if (!through) return true;
    }
    return false;
}

// ANALYTIC split candidates: every param t∈(0,1) at which the visibility of the
// straight projected segment A->B could change — outline entry/exit against each
// occluder / window triangle, plus the depth crossing of each occluder plane.
inline std::vector<double> segmentSplitCandidates(
        const std::vector<FaceOccluder>& faces,
        double uA, double vA, double dA,
        double uB, double vB, double dB,
        const std::unordered_set<std::uint32_t>& skipFaces) {
    std::vector<double> cuts;
    auto add = [&](double t) {
        if (t > 1e-12 && t < 1.0 - 1e-12) cuts.push_back(t);
    };
    for (const FaceOccluder& F : faces) {
        if (skipFaces.count(F.faceId)) continue;
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
        for (const ViewTri& T : F.solid)  handle(T, true);
        for (const ViewTri& T : F.window) handle(T, false);
    }
    std::sort(cuts.begin(), cuts.end());
    cuts.erase(std::unique(cuts.begin(), cuts.end(),
               [](double a, double b) { return std::fabs(a - b) < 1e-12; }),
               cuts.end());
    return cuts;
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

    // --- Build the occlusion triangle soup (view frame) + per-face grouping. --
    std::vector<ViewTri> tris;
    for (const Face* f : faces) emitFaceTris(fr, f, opt.curveTess, tris);
    std::vector<FaceOccluder> occFaces = groupByFace(tris);

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
                occFaces, uA, vA, dA, uB, vB, dB, j.incidentFaces);
            cuts.insert(cuts.begin(), 0.0);
            cuts.push_back(1.0);

            for (std::size_t c = 0; c + 1 < cuts.size(); ++c) {
                double ta = cuts[c], tb = cuts[c + 1];
                if (tb - ta < 1e-15) continue;   // collapsed piece
                double tm = 0.5 * (ta + tb);
                double um = uA + tm * (uB - uA);
                double vm = vA + tm * (vB - vA);
                double dm = dA + tm * (dB - dA);
                char h = occludedPoint(occFaces, um, vm, dm,
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
