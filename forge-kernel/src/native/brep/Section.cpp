// forge/native/brep/Section.cpp
//
// Implementation of the planar SECTION / CUT VIEW (Section.hpp). Pure C++20, no
// external deps. See the header for the honest scope statement.
//
// METHOD (per cut face -> chord/arc; stitch -> closed wires; Green -> props):
//
//   1. For every Face of the solid, gather its outer-loop boundary as an ordered
//      3D point ring. Find where the cutting plane crosses that ring (the signed
//      distance to the plane changes sign along a boundary edge => one crossing
//      point on that edge, placed exactly by linear interpolation in the signed
//      distance; an on-plane boundary vertex is itself a crossing). A transversal
//      face contributes exactly two boundary crossings A,B = the chord endpoints.
//
//   2. SECTION CURVE between A and B:
//        * PLANAR face  -> the straight chord A->B (the plane∩plane line clipped
//          to the face is exactly that segment).
//        * QUADRIC face -> the analytic plane∩surface curve (SurfaceIntersect),
//          sampled and trimmed to the [A,B] span, so the emitted curve is the
//          true circle/ellipse/line arc, not a straight chord. A,B (the exact
//          boundary crossings) are kept as the arc endpoints so the arc welds
//          seamlessly with the neighbouring faces' arcs into one smooth wire.
//
//   3. STITCH the chords/arcs into closed oriented wires: weld endpoints within
//      tol; every section vertex has exactly one in + one out chord on a clean
//      manifold cut, so a greedy next-walk closes each wire. Each wire is wound
//      so the solid material is to its LEFT in the cut-plane CCW frame (decided
//      from the chord's host-face outward normal, exactly as mesh/Slice.cpp).
//
//   4. SECTION PROPERTIES on the closed wires in the cut-plane (u,v) frame:
//        * planar Green's theorem for area + first moments (EXACT for straight
//          wires); a wire detected to be a single analytic CIRCLE uses the exact
//          π R² and the circle centre instead of the sampled-polygon value.
//        * the FILLED area = Σ |outer| − Σ |hole|; centroid = Σ moment / area.

#include "forge/native/brep/Section.hpp"
#include "forge/native/brep/SurfaceIntersect.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 V3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

// Build an orthonormal in-plane basis (e1,e2) for a plane with unit normal n.
void planeBasis(const Vec3& n, Vec3& e1, Vec3& e2) {
    Vec3 t = (std::fabs(n.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    e1 = vnorm(vcross(n, t));
    e2 = vnorm(vcross(n, e1));
}

// A directed chord/arc segment on the cut plane: an ordered 3D polyline whose
// FIRST point is the chord origin and LAST the chord destination. Interior
// points (for a curved face's arc) lie between, ordered origin->dest. Material
// is on the LEFT of origin->dest in the cut-plane CCW frame.
struct Chord {
    std::vector<Vec3> pts;          // >= 2 points; pts.front()=origin, pts.back()=dest
    bool   curved = false;          // came from a quadric face
    bool   fromCircle = false;      // the host curve was an exact analytic Circle
    double circleR = 0.0;
    Vec3   circleC{0, 0, 0};
    Vec3   circleAxis{0, 0, 1};
};

// Ordered boundary ring (3D points) of a face's outer loop.
std::vector<Vec3> faceRing(const Face* f) {
    std::vector<Vec3> ring;
    const Loop* lp = f->outerLoop;
    if (!lp || lp->coedgeCount < 2) return ring;
    ring.reserve(lp->coedgeCount);
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        ring.push_back(V3(c->originVertex()->point));
        c = c->next;
    }
    return ring;
}

// Sample an analytic IntersectionCurve into a 3D polyline (closed circle/ellipse
// already carry dense `samples`; lines are sampled over a wide span). We just
// reuse the curve's own `samples` if present, else fall back.
const std::vector<Vec3>& curveSamples(const IntersectionCurve& c) {
    return c.samples;
}

// Find the point on a (closed or open) sampled curve nearest to a query, return
// its index. Used to map a face-boundary crossing onto the analytic curve.
std::size_t nearestSampleIdx(const std::vector<Vec3>& s, const Vec3& q) {
    std::size_t best = 0;
    double bd = 1e300;
    for (std::size_t i = 0; i < s.size(); ++i) {
        double d = vlen(vsub(s[i], q));
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

// Extract the arc of a CLOSED analytic curve `s` running from index ia to ib in
// the direction that stays SHORT (the minor arc between the two boundary
// crossings of one small sector face). Endpoints are replaced by the exact
// boundary crossings A,B so neighbouring faces' arcs weld seamlessly.
std::vector<Vec3> closedArc(const std::vector<Vec3>& s,
                            std::size_t ia, std::size_t ib,
                            const Vec3& A, const Vec3& B) {
    const std::size_t n = s.size();
    if (n == 0) return {A, B};
    // forward step count ia->ib
    std::size_t fwd = (ib + n - ia) % n;
    std::size_t bwd = n - fwd;
    std::vector<Vec3> out;
    out.push_back(A);
    if (fwd <= bwd) {
        for (std::size_t k = 1; k < fwd; ++k) out.push_back(s[(ia + k) % n]);
    } else {
        for (std::size_t k = 1; k < bwd; ++k) out.push_back(s[(ia + n - k) % n]);
    }
    out.push_back(B);
    return out;
}

} // namespace

SectionResult sectionSolid(const Solid& solid,
                           const SectionPlane& plane,
                           const SectionOptions& opt) {
    SectionResult res;

    // ---- cut-plane frame -----------------------------------------------------
    const double nl = vlen(plane.normal);
    if (!(nl > 0.0)) { res.reason = "degenerate cut-plane normal"; return res; }
    const Vec3 N = vscale(plane.normal, 1.0 / nl);
    const Vec3 P = plane.point;
    Vec3 U, Vv; planeBasis(N, U, Vv);
    res.planeOrigin = P; res.planeNormal = N; res.uDir = U; res.vDir = Vv;

    auto sdist = [&](const Vec3& p) { return vdot(vsub(p, P), N); };

    // Gather all faces + a model extent for tolerances.
    std::vector<Face*> faces;
    double extent = 0.0;
    for (Shell* sh : solid.shells)
        for (Face* f : sh->faces) {
            faces.push_back(f);
            for (const Vec3& p : faceRing(f))
                extent = std::max(extent, vlen(vsub(p, P)));
        }
    if (faces.empty()) { res.ok = true; res.numWires = 0; return res; }
    const double eps  = (extent > 0.0 ? extent : 1.0) * 1e-9;       // on-plane band
    const double weld = (extent > 0.0 ? extent : 1.0) * std::max(opt.weldTol, 1e-12);

    // ---- per-face chords -----------------------------------------------------
    std::vector<Chord> chords;
    for (Face* f : faces) {
        std::vector<Vec3> ring = faceRing(f);
        const std::size_t m = ring.size();
        if (m < 2) continue;

        // Boundary crossings of the plane against the closed ring.
        std::vector<Vec3> cross;
        for (std::size_t i = 0; i < m; ++i) {
            const Vec3& a = ring[i];
            const Vec3& b = ring[(i + 1) % m];
            double sa = sdist(a), sb = sdist(b);
            int za = (sa > eps) ? 1 : (sa < -eps ? -1 : 0);
            int zb = (sb > eps) ? 1 : (sb < -eps ? -1 : 0);
            // On-plane vertex `a`: a crossing point (deduped below).
            if (za == 0) cross.push_back(a);
            // Strict sign change across the edge interior => one interpolated pt.
            if (za * zb < 0) {
                double t = sa / (sa - sb);
                cross.push_back(vadd(a, vscale(vsub(b, a), t)));
            }
        }
        // Dedup near-coincident boundary crossings (an on-plane vertex shared by
        // two edges is found twice; a tangent vertex collapses to nothing useful).
        std::vector<Vec3> uniq;
        for (const Vec3& c : cross) {
            bool dup = false;
            for (const Vec3& u : uniq) if (vlen(vsub(c, u)) <= weld) { dup = true; break; }
            if (!dup) uniq.push_back(c);
        }
        if (uniq.size() != 2) continue;   // not a clean transversal chord => skip

        Vec3 A = uniq[0], B = uniq[1];

        // Orient A->B so the SOLID material is on the LEFT (cut-plane CCW about
        // +N). Use the host face's OUTWARD normal: (N x dir) must point opposite
        // the in-plane part of the outward normal (material is opposite outward).
        Vec3 outwardN{0, 0, 0};
        if (f->surface) {
            // representative outward normal at the face centre param.
            outwardN = f->surface->normalAt(0.5 * (f->u0 + f->u1),
                                            0.5 * (f->v0 + f->v1));
        }
        if (vlen(outwardN) < 1e-12) {
            // fall back to the polygon normal of the ring.
            for (std::size_t i = 0; i + 2 < m; ++i)
                outwardN = vadd(outwardN, vcross(vsub(ring[i + 1], ring[0]),
                                                 vsub(ring[i + 2], ring[0])));
            if (vlen(outwardN) > 0) outwardN = vnorm(outwardN);
        }
        Vec3 dir = vsub(B, A);
        Vec3 leftDir = vcross(N, dir);
        if (vdot(leftDir, outwardN) > 0.0) std::swap(A, B);

        Chord ch;
        ch.pts = {A, B};

        // For a CURVED (quadric) face, replace the straight chord with the exact
        // analytic plane∩surface arc between A and B.
        if (f->surface && f->surface->kind != SurfaceKind::Plane &&
            f->surface->kind != SurfaceKind::Nurbs) {
            Surface planeSurf;
            planeSurf.kind = SurfaceKind::Plane;
            planeSurf.origin = P; planeSurf.axis = N;
            Vec3 pe1, pe2; planeBasis(N, pe1, pe2);
            planeSurf.refDir = pe1;

            // Normalise a degenerate CONE (r1==r2, built by SolidFactory's cylinder
            // path as a Cone) into a true Cylinder so the analytic plane∩cylinder
            // solver runs (the cone solver rejects a zero-taper cone honestly).
            Surface faceSurf = *f->surface;
            if (faceSurf.kind == SurfaceKind::Cone &&
                std::fabs(faceSurf.r1 - faceSurf.r2) <= 1e-12) {
                faceSurf.kind = SurfaceKind::Cylinder;
                // Cylinder convention: r1 = radius, param = height (already set).
            }

            SurfaceIntersectOptions sio;
            sio.sampleN = std::max(8, opt.circleSamples);
            sio.tol = std::max(weld, 1e-12);
            SurfaceIntersectResult sir =
                intersectSurfaces(planeSurf, faceSurf, sio);

            if (!sir.ok) { res.reason = "deferred face∩plane (non-quadric / NURBS)"; return res; }

            // Pick the intersection curve whose sample set passes nearest BOTH A,B.
            const IntersectionCurve* best = nullptr;
            double bestScore = 1e300;
            for (const auto& c : sir.curves) {
                const auto& s = curveSamples(c);
                if (s.empty()) continue;
                double dA = vlen(vsub(s[nearestSampleIdx(s, A)], A));
                double dB = vlen(vsub(s[nearestSampleIdx(s, B)], B));
                double sc = dA + dB;
                if (sc < bestScore) { bestScore = sc; best = &c; }
            }
            if (best) {
                const auto& s = curveSamples(*best);
                if (best->kind == CurveKind::Circle) {
                    ch.fromCircle = true;
                    ch.circleR = best->r1;
                    ch.circleC = best->origin;
                    ch.circleAxis = best->axis;
                }
                std::size_t ia = nearestSampleIdx(s, A);
                std::size_t ib = nearestSampleIdx(s, B);
                std::vector<Vec3> arc;
                if (best->closed) {
                    arc = closedArc(s, ia, ib, A, B);
                } else {
                    // open curve (line/conic): take the inclusive slice ia..ib.
                    if (ia > ib) std::swap(ia, ib);
                    arc.push_back(A);
                    for (std::size_t k = ia + 1; k < ib; ++k) arc.push_back(s[k]);
                    arc.push_back(B);
                }
                // Preserve orientation: arc currently runs A->B; that IS our
                // oriented chord direction, so keep as-is.
                ch.pts = std::move(arc);
                ch.curved = true;
            }
        }
        chords.push_back(std::move(ch));
    }

    if (chords.empty()) { res.ok = true; res.numWires = 0; return res; }

    // ---- weld chord endpoints into a shared section-vertex pool --------------
    std::vector<Vec3> verts;                  // welded section vertices
    auto vid = [&](const Vec3& p) -> std::uint32_t {
        for (std::uint32_t i = 0; i < verts.size(); ++i)
            if (vlen(vsub(verts[i], p)) <= weld) return i;
        verts.push_back(p);
        return static_cast<std::uint32_t>(verts.size() - 1);
    };

    // Each chord => an oriented edge (origin id -> dest id) carrying its interior
    // points (origin->dest) so curved arcs survive into the final wire.
    struct DEdge {
        std::uint32_t a, b;
        std::vector<Vec3> interior;  // strictly-between points, origin->dest order
        bool fromCircle = false; double circleR = 0; Vec3 circleC{0,0,0};
    };
    std::vector<DEdge> edges;
    edges.reserve(chords.size());
    // Dedup chords that connect the SAME welded vertex pair (either direction).
    // Two adjacent faces that GRAZE the plane along their shared boundary edge
    // each report that edge as a chord; the section edge is ONE, not two — without
    // this collapse the shared vertices would have out-degree 2 (false branchy).
    // Keep the FIRST occurrence (it carries a valid orientation + any arc points).
    std::vector<std::pair<std::uint32_t, std::uint32_t>> seen;
    auto isDup = [&](std::uint32_t a, std::uint32_t b) {
        for (const auto& s : seen)
            if ((s.first == a && s.second == b) || (s.first == b && s.second == a))
                return true;
        return false;
    };
    for (const Chord& ch : chords) {
        DEdge e;
        e.a = vid(ch.pts.front());
        e.b = vid(ch.pts.back());
        if (e.a == e.b) continue;          // collapsed chord
        if (isDup(e.a, e.b)) continue;     // grazing duplicate of an existing chord
        seen.push_back({e.a, e.b});
        for (std::size_t k = 1; k + 1 < ch.pts.size(); ++k) e.interior.push_back(ch.pts[k]);
        e.fromCircle = ch.fromCircle; e.circleR = ch.circleR; e.circleC = ch.circleC;
        edges.push_back(std::move(e));
    }
    if (edges.empty()) { res.ok = true; res.numWires = 0; return res; }

    // ---- stitch into closed wires (greedy next-walk on out-adjacency) --------
    const std::uint32_t M = static_cast<std::uint32_t>(verts.size());
    std::vector<int> nextOf(M, -1), indeg(M, 0), outdeg(M, 0);
    bool branchy = false;
    for (std::size_t i = 0; i < edges.size(); ++i) {
        std::uint32_t a = edges[i].a, b = edges[i].b;
        if (nextOf[a] != -1) branchy = true;
        nextOf[a] = static_cast<int>(i);   // store edge index out of a
        ++outdeg[a]; ++indeg[b];
    }
    for (std::uint32_t v = 0; v < M; ++v)
        if (outdeg[v] != indeg[v] || outdeg[v] > 1 || indeg[v] > 1) branchy = true;
    if (branchy) {
        res.reason = "section is not a union of simple closed wires "
                     "(self-touching / non-manifold at the plane)";
        return res;
    }

    std::vector<bool> used(edges.size(), false);
    // sum over the FILLED region:
    double netArea = 0.0;          // signed planar area summed over wires
    double momU = 0.0, momV = 0.0; // first moments * (for centroid), planar
    double totLen = 0.0;

    auto uvOf = [&](const Vec3& p, double& u, double& vv) {
        Vec3 d = vsub(p, P);
        u  = vdot(d, U);
        vv = vdot(d, Vv);
    };

    for (std::size_t s0 = 0; s0 < edges.size(); ++s0) {
        if (used[s0]) continue;
        // Walk the cycle of edges starting at edge s0.
        SectionWire wire;
        std::vector<Vec3> wpts;            // dense wire points (with arc interiors)
        std::uint32_t start = edges[s0].a;
        std::size_t ei = s0;
        std::size_t guard = 0;
        bool closed = false;
        bool anyCircle = false; double circR = 0; Vec3 circC{0,0,0};
        while (guard++ <= edges.size() + 1) {
            if (used[ei]) { closed = (edges[ei].a == start); break; }
            used[ei] = true;
            const DEdge& e = edges[ei];
            wpts.push_back(verts[e.a]);
            for (const Vec3& q : e.interior) wpts.push_back(q);
            if (e.fromCircle) { anyCircle = true; circR = e.circleR; circC = e.circleC; }
            std::uint32_t nv = e.b;
            if (nv == start) { closed = true; break; }
            int ni = nextOf[nv];
            if (ni < 0) { closed = false; break; }
            ei = static_cast<std::size_t>(ni);
        }
        if (!closed || wpts.size() < 3) {
            res.reason = "open / degenerate section wire (solid not watertight "
                         "across the cut)";
            return res;
        }

        // signed planar area + first moments via Green's theorem in (u,v).
        double aSum = 0.0, mu = 0.0, mv = 0.0, peri = 0.0;
        const std::size_t np = wpts.size();
        for (std::size_t k = 0; k < np; ++k) {
            double u0, v0, u1, v1;
            uvOf(wpts[k], u0, v0);
            uvOf(wpts[(k + 1) % np], u1, v1);
            double cr = (u0 * v1 - u1 * v0);
            aSum += cr;
            mu   += (u0 + u1) * cr;
            mv   += (v0 + v1) * cr;
            peri += vlen(vsub(wpts[(k + 1) % np], wpts[k]));
        }
        double signedArea = 0.5 * aSum;

        // If the whole wire is one analytic circle, use the EXACT area + centroid.
        // (Detected: every contributing chord came from the SAME circle AND every
        // wire point is equidistant from that centre to tolerance.)
        bool isCircle = false;
        if (anyCircle && circR > 0) {
            double maxErr = 0.0;
            // circle centre in (u,v)
            double cu, cv; uvOf(circC, cu, cv);
            for (const Vec3& p : wpts) {
                double pu, pv; uvOf(p, pu, pv);
                double rr = std::sqrt((pu - cu) * (pu - cu) + (pv - cv) * (pv - cv));
                maxErr = std::max(maxErr, std::fabs(rr - circR));
            }
            if (maxErr <= std::max(1e-7 * circR, weld)) {
                isCircle = true;
                double exactA = kPi * circR * circR;
                // keep the sign from the polygon winding
                signedArea = (signedArea >= 0 ? exactA : -exactA);
                wire.circular = true;
                wire.circleRadius = circR;
                wire.circleCentre = circC;
                // exact centroid is the circle centre.
                mu = 0; mv = 0;            // recompute moment from exact below
            }
        }

        wire.points = wpts;
        wire.closed = true;
        wire.area = signedArea;
        res.wires.push_back(std::move(wire));

        netArea += signedArea;
        if (isCircle) {
            double cu, cv; uvOf(circC, cu, cv);
            momU += signedArea * cu;       // ∫u dA = area * centroid_u (exact)
            momV += signedArea * cv;
        } else {
            momU += mu / 6.0;              // ∫u dA over the polygon
            momV += mv / 6.0;
        }
        totLen += peri;
    }

    // ---- assemble filled-region properties -----------------------------------
    res.perimeter = totLen;
    double filled = std::fabs(netArea);
    res.area = filled;
    if (filled > 0.0) {
        double cu = momU / netArea;        // net signed area cancels hole signs
        double cv = momV / netArea;
        res.centroid = vadd(P, vadd(vscale(U, cu), vscale(Vv, cv)));
    } else {
        res.centroid = P;
    }
    res.numWires = res.wires.size();
    res.ok = true;
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
