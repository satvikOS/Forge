// forge/native/brep/FilletAnalytic.cpp
//
// Implementation of forge::native::brep::filletBoxEdgeAnalytic — the analytic
// constant-radius ROLLING-BALL edge fillet on the native ANALYTIC B-rep. See
// FilletAnalytic.hpp for the full specification, the rolling-ball contact
// derivation, and the honest scope boundary. Pure C++20, stdlib + existing brep
// headers only. No OCCT, no WASM.
//
// THE ROLLING-BALL CONTACT (constant R, planar-planar convex straight edge)
// -------------------------------------------------------------------------
// Two planar faces A, B meet at a convex straight edge from P0 to P1 along the
// unit direction e. Their OUTWARD unit normals are nA, nB; the material side of
// each plane is along the INWARD normal -nA, -nB. A ball of radius R rolling in
// the convex valley stays tangent to both planes from the material side, so its
// centre lies a distance R inside each plane:
//
//     axisPoint(t) = P0 + R*(-nA) + R*(-nB) + t*e            (t in [0, edgeLen])
//
// (Exact for the box: nA ⟂ nB, so moving R inward off plane A and R inward off
// plane B places the centre exactly R from each plane — the 90-degree corner ball
// centre.) The locus of centres is the AXIS of the fillet CYLINDER (radius R).
//
// The cylinder touches plane A along the TANGENT LINE through  axisPoint + R*nA
// and plane B along  axisPoint + R*nB. Those tangent lines are the new trim
// boundaries: faces A and B are RE-TRIMMED back from the sharp edge to them. The
// quarter-cylinder patch spans the 90-degree arc from the +nA radial direction to
// +nB, over the edge length.
//
// END CAPS (watertight + mass-EXACT). The cylinder's two end cross-sections are
// QUARTER-CIRCLE arcs lying in the two faces PERPENDICULAR to the edge. Each such
// perpendicular end face is therefore re-trimmed into TWO exact pieces:
//   * an L-shaped planar polygon (the square minus the R×R corner) — integrated
//     EXACTLY by the polygon-moment path, and
//   * a QUARTER-DISK annular sector (inner radius 0, outer radius R, centred on
//     the axis foot) that fills the rounded corner — integrated EXACTLY in polar
//     coordinates (Surface::isDisk path) and whose ARC edge mates with the
//     cylinder end. (square − R² corner + π/4 R² quarter-disk = square − (1−π/4)R²,
//     so the cross-section the fillet removes is exactly (1 − π/4) R².)
//
// REMOVED VOLUME: (1 − π/4) R² per unit edge length, so the filleted solid volume
// is V_box − (1 − π/4) R² L — measured here EXACTLY by the analytic MassProps
// integrator over the re-trimmed planar faces + the quadric patch + the disk caps.

#include "forge/native/brep/FilletAnalytic.hpp"

#include "forge/native/brep/Surface.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 P2V(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
inline Point3 V2P(const Vec3& v) { return Point3{v.x, v.y, v.z}; }

AnalyticFilletResult fail(const char* why) {
    AnalyticFilletResult r;
    r.ok = false;
    r.reason = why;
    return r;
}

inline bool veq(const Vec3& a, const Vec3& b) { return vlen(vsub(a, b)) < 1e-9; }

// Newell area-normal of a closed vertex ring (robust to non-convexity).
Vec3 ringNormal(const std::vector<Vertex*>& ring) {
    Vec3 n{0, 0, 0};
    const std::size_t m = ring.size();
    for (std::size_t i = 0; i < m; ++i) {
        const Vec3 a = P2V(ring[i]->point);
        const Vec3 b = P2V(ring[(i + 1) % m]->point);
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n;
}

// Orient a ring so its right-hand (Newell) normal points along `outwardNormal`;
// reverse it in place otherwise. This makes EVERY emitted face's topological
// coedge winding consistently outward, so every shared edge is used by two
// opposite-sense coedges (a strictly closed 2-manifold) regardless of which box
// edge / frame handedness is being filleted.
void orientRingCCW(std::vector<Vertex*>& ring, const Vec3& outwardNormal) {
    if (vdot(ringNormal(ring), outwardNormal) < 0.0)
        std::reverse(ring.begin(), ring.end());
}

// Attach a planar analytic Surface to a face whose CCW (from outside) ring lies
// in a known plane. vertexUV[i] = in-plane coords of ring[i]; the mass integrator
// does an EXACT polygon-moment integral over them. `outwardNormal` orients the
// stored plane normal to point OUT of the solid. (Mirrors the validated
// Primitives.cpp attachPlanarFace, kept local so this TU is self-sufficient.)
void attachPlanarFace(TopologyBuilder& tb, Face* f,
                      const std::vector<Vertex*>& ring,
                      const Vec3& origin, const Vec3& uDir, const Vec3& vDir,
                      const Vec3& outwardNormal) {
    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Plane;
    s->origin = origin;
    s->refDir = vnorm(uDir);
    s->axis   = vnorm(vcross(uDir, vDir));
    s->reversed = (vdot(s->axis, outwardNormal) < 0.0);
    f->surface = s;
    f->vertexUV.clear();
    f->vertexUV.reserve(ring.size());
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    for (std::size_t i = 0; i < ring.size(); ++i) {
        Vec3 rel = vsub(P2V(ring[i]->point), origin);
        double pu = vdot(rel, s->refDir);
        double pv = vdot(rel, s->binormal());
        f->vertexUV.push_back({pu, pv});
        if (i == 0) { u0 = u1 = pu; v0 = v1 = pv; }
        else {
            u0 = std::min(u0, pu); u1 = std::max(u1, pu);
            v0 = std::min(v0, pv); v1 = std::max(v1, pv);
        }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
}

std::vector<Vec3> boxCorners(double L) {
    return {
        {0, 0, 0}, {L, 0, 0}, {L, L, 0}, {0, L, 0},   // 0..3 bottom z=0
        {0, 0, L}, {L, 0, L}, {L, L, L}, {0, L, L},    // 4..7 top    z=L
    };
}

struct BoxEdge {
    int c0, c1;        // endpoint corner indices (edge runs c0 -> c1)
    Vec3 nA, nB;       // outward normals of the two faces sharing the edge
};

BoxEdge boxEdge(int i) {
    const Vec3 mZ{0, 0, -1}, pZ{0, 0, 1};
    const Vec3 mY{0, -1, 0}, pY{0, 1, 0};
    const Vec3 mX{-1, 0, 0}, pX{1, 0, 0};
    switch (i) {
        case 0:  return {0, 1, mZ, mY};
        case 1:  return {1, 2, mZ, pX};
        case 2:  return {2, 3, mZ, pY};
        case 3:  return {3, 0, mZ, mX};
        case 4:  return {4, 5, pZ, mY};   // top-front (CANONICAL): +X at y=0,z=L
        case 5:  return {5, 6, pZ, pX};
        case 6:  return {6, 7, pZ, pY};
        case 7:  return {7, 4, pZ, mX};
        case 8:  return {0, 4, mY, mX};
        case 9:  return {1, 5, mY, pX};
        case 10: return {2, 6, pY, pX};
        case 11: return {3, 7, pY, mX};
        default: return {-1, -1, {}, {}};
    }
}

// Standard box face rings (CCW from outside) + outward normal.
struct FaceDef { int idx[4]; Vec3 normal; };
const FaceDef kBoxFaces[6] = {
    {{0, 3, 2, 1}, {0, 0, -1}}, // bottom
    {{4, 5, 6, 7}, {0, 0, 1}},  // top
    {{0, 1, 5, 4}, {0, -1, 0}}, // front (y=0)
    {{2, 3, 7, 6}, {0, 1, 0}},  // back  (y=L)
    {{0, 4, 7, 3}, {-1, 0, 0}}, // left  (x=0)
    {{1, 2, 6, 5}, {1, 0, 0}},  // right (x=L)
};

} // namespace

AnalyticFilletResult filletBoxEdgeAnalytic(TopologyBuilder& tb,
                                           double L, double R, int edgeIndex) {
    // -------- input screening (honest refusal, never a faked solid) ----------
    if (!(L > 0.0) || !std::isfinite(L)) return fail("box edge length L must be positive and finite");
    if (!(R > 0.0) || !std::isfinite(R)) return fail("fillet radius R must be positive and finite");
    if (edgeIndex < 0 || edgeIndex > 11) return fail("edgeIndex out of range [0,11]");
    if (!(R < L)) return fail("fillet radius R must be < L (tangent line would overflow the face)");

    const std::vector<Vec3> C = boxCorners(L);
    const BoxEdge be = boxEdge(edgeIndex);

    const Vec3 P0 = C[be.c0];
    const Vec3 P1 = C[be.c1];
    Vec3 e = vsub(P1, P0);
    const double edgeLen = vlen(e);
    if (!(edgeLen > 0.0)) return fail("degenerate (zero-length) edge");
    e = vscale(e, 1.0 / edgeLen);

    const Vec3 nA = vnorm(be.nA);
    const Vec3 nB = vnorm(be.nB);

    // Only the orthogonal (90-degree convex) box edge is in this increment's scope.
    const double ndot = vdot(nA, nB);
    if (std::fabs(ndot) > 1e-9)
        return fail("adjacent face normals are not orthogonal (only the 90-degree "
                    "convex box edge is in this increment's scope)");
    const double interiorDihedralDeg =
        180.0 - std::acos(std::max(-1.0, std::min(1.0, ndot))) * 180.0 / kPi;

    // -------- rolling-ball contact (analytic) --------------------------------
    const Vec3 iA = vscale(nA, -1.0);
    const Vec3 iB = vscale(nB, -1.0);
    const Vec3 A0 = vadd(P0, vadd(vscale(iA, R), vscale(iB, R)));  // axis base @ P0
    const Vec3 along = vscale(e, edgeLen);
    const Vec3 A1 = vadd(A0, along);                              // axis base @ P1
    const Vec3 TA0 = vadd(A0, vscale(nA, R));   // tangent on face A @ start
    const Vec3 TB0 = vadd(A0, vscale(nB, R));   // tangent on face B @ start
    const Vec3 TA1 = vadd(A1, vscale(nA, R));   // tangent on face A @ far
    const Vec3 TB1 = vadd(A1, vscale(nB, R));   // tangent on face B @ far

    // -------- cylinder frame so the quarter arc runs nA -> nB ----------------
    // S(theta,z) = origin + R*(cos th refDir + sin th binormal) + z*axis, with
    // binormal = axis x refDir. We want refDir = nA (theta=0 -> TA) and binormal =
    // nB (theta=pi/2 -> TB): so axis x nA must equal nB. Pick axis = +/-e for that.
    Vec3 cylAxis = e;
    if (!veq(vcross(cylAxis, nA), nB)) {
        cylAxis = vscale(e, -1.0);
        if (!veq(vcross(cylAxis, nA), nB))
            return fail("could not orient the fillet cylinder frame (degenerate frame)");
    }
    const bool axisFlipped = (vdot(cylAxis, e) < 0.0);
    const Vec3 cylOrigin = axisFlipped ? A1 : A0;   // so z in [0,edgeLen] spans the edge

    // -------- assemble the filleted solid on the analytic B-rep --------------
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // Surviving box-corner vertices (the two sharp-edge endpoints vanish).
    std::vector<Vertex*> cv(8, nullptr);
    for (int i = 0; i < 8; ++i)
        if (i != be.c0 && i != be.c1) cv[i] = tb.makeVertex(V2P(C[i]));

    // The four tangent corners + the two end-cap axis-foot centres, shared between
    // the fillet patch, the trimmed faces, and the end-cap pieces.
    Vertex* vTA0 = tb.makeVertex(V2P(TA0));
    Vertex* vTB0 = tb.makeVertex(V2P(TB0));
    Vertex* vTA1 = tb.makeVertex(V2P(TA1));
    Vertex* vTB1 = tb.makeVertex(V2P(TB1));
    Vertex* vA0  = tb.makeVertex(V2P(A0));   // axis foot @ start (disk-cap centre)
    Vertex* vA1  = tb.makeVertex(V2P(A1));   // axis foot @ far

    AnalyticFilletResult res;

    // A face's outward normal identifies its role: face A (== nA), face B (== nB),
    // or a perpendicular END face (touches one sharp endpoint, normal perpendicular
    // to the edge). The two faces that DON'T touch the edge are unchanged quads.
    for (const auto& d : kBoxFaces) {
        const Vec3 fn = vnorm(d.normal);
        const bool isFaceA = veq(fn, nA);
        const bool isFaceB = veq(fn, nB);
        // Does this face contain a sharp endpoint?
        int sharpAt = -1;                       // ring slot of the sharp corner
        int sharpCorner = -1;
        int sharpCount = 0;
        for (int k = 0; k < 4; ++k)
            if (d.idx[k] == be.c0 || d.idx[k] == be.c1) { sharpAt = k; sharpCorner = d.idx[k]; ++sharpCount; }

        if (sharpCount == 0) {
            // Untouched original quad face.
            std::vector<Vertex*> ring = {cv[d.idx[0]], cv[d.idx[1]], cv[d.idx[2]], cv[d.idx[3]]};
            orientRingCCW(ring, fn);
            Face* f = tb.makeFace();
            tb.addFaceToShell(shell, f);
            tb.addOuterLoopToFace(f, ring);
            Vec3 o = P2V(ring[0]->point);
            attachPlanarFace(tb, f, ring, o,
                             vsub(P2V(ring[1]->point), o),
                             vsub(P2V(ring[3]->point), o), fn);
            continue;
        }

        if (isFaceA || isFaceB) {
            // RE-TRIMMED adjacent face: both its sharp-edge corners (be.c0 and
            // be.c1) move to this face's tangent corners (TA* for A, TB* for B).
            std::vector<Vertex*> ring;
            for (int k = 0; k < 4; ++k) {
                const int ci = d.idx[k];
                if (ci == be.c0)      ring.push_back(isFaceA ? vTA0 : vTB0);
                else if (ci == be.c1) ring.push_back(isFaceA ? vTA1 : vTB1);
                else                  ring.push_back(cv[ci]);
            }
            orientRingCCW(ring, fn);
            Face* f = tb.makeFace();
            tb.addFaceToShell(shell, f);
            tb.addOuterLoopToFace(f, ring);
            Vec3 o = P2V(ring[0]->point);
            attachPlanarFace(tb, f, ring, o,
                             vsub(P2V(ring[1]->point), o),
                             vsub(P2V(ring[3]->point), o), fn);
            if (isFaceA) res.trimmedFaceA = f;
            else         res.trimmedFaceB = f;
            continue;
        }

        // PERPENDICULAR END FACE: exactly one sharp corner. Re-trim into an
        // L-polygon (square minus the R×R corner) + a quarter-disk cap.
        // The disk centre is the axis foot at this end (vA0 @ be.c0, vA1 @ be.c1).
        const bool atStart = (sharpCorner == be.c0);
        Vertex* vCenter = atStart ? vA0 : vA1;
        Vertex* vtA     = atStart ? vTA0 : vTA1;
        Vertex* vtB     = atStart ? vTB0 : vTB1;
        const Vec3 center = atStart ? A0 : A1;

        // The sharp corner sits at ring slot sharpAt; its ring neighbours are prev
        // and next. The fillet-side boundary replaces the single sharp corner with
        // the chain [ <tangent nearer prev> , center , <tangent nearer next> ] so
        // the L-polygon's two inner edges are exactly the disk's two straight radii
        // (tangent->center), which MATE the quarter-disk cap. The disk's arc edge
        // (vtA -> vtB) mates the cylinder end cross-section.
        const int prevCi = d.idx[(sharpAt + 3) % 4];
        const Vec3 prevPos = C[prevCi];     // a perpendicular face's neighbours are never sharp
        const double dA = vlen(vsub(P2V(vtA->point), prevPos));
        const double dB = vlen(vsub(P2V(vtB->point), prevPos));
        Vertex* nearPrev = (dA <= dB) ? vtA : vtB;
        Vertex* nearNext = (dA <= dB) ? vtB : vtA;

        // The re-trimmed end face minus the rounded corner is the L-SHAPED polygon
        //   [ ... nearPrev, vCenter, nearNext ... ]  (the box ring with the sharp
        // corner replaced by the two tangent points and the axis foot). That L
        // polygon is NON-CONVEX (the notch at vCenter), and the analytic planar
        // mass integrator's polygon path fans from vertex 0 with UNSIGNED triangle
        // areas — exact only for a CONVEX polygon. So we do NOT hand it one
        // non-convex face; instead we TRIANGULATE the L polygon as a fan from
        // vCenter (the notch corner — the L shape is star-shaped from it, so every
        // fan triangle lies strictly inside) and emit ONE planar triangular FACE per
        // fan triangle. The internal fan edges (vCenter -> a box corner) are shared
        // by exactly two of these coplanar triangles (2 coedges = manifold); the
        // outer edges mate the adjacent box faces; the two radius edges
        // (vCenter->nearPrev, nearNext->vCenter) mate the quarter-disk cap.
        std::vector<Vertex*> Lring;
        for (int k = 0; k < 4; ++k) {
            if (k == sharpAt) {
                Lring.push_back(nearPrev);
                Lring.push_back(vCenter);
                Lring.push_back(nearNext);
            } else {
                Lring.push_back(cv[d.idx[k]]);
            }
        }
        // Locate vCenter in the L ring; fan from it over the remaining chain.
        std::size_t ci = 0;
        for (std::size_t k = 0; k < Lring.size(); ++k) if (Lring[k] == vCenter) { ci = k; break; }
        const std::size_t Ln = Lring.size();
        for (std::size_t step = 1; step + 1 < Ln; ++step) {
            Vertex* a = vCenter;
            Vertex* b = Lring[(ci + step) % Ln];
            Vertex* c = Lring[(ci + step + 1) % Ln];
            std::vector<Vertex*> tri = {a, b, c};
            orientRingCCW(tri, fn);
            Face* ft = tb.makeFace();
            tb.addFaceToShell(shell, ft);
            tb.addOuterLoopToFace(ft, tri);
            Vec3 o = P2V(tri[0]->point);
            attachPlanarFace(tb, ft, tri, o,
                             vsub(P2V(tri[1]->point), o),
                             vsub(P2V(tri[2]->point), o), fn);
        }

        // Quarter-disk cap (annular sector, inner 0 .. outer R), centred at the
        // axis foot, spanning the quarter arc nA -> nB in this end plane. The
        // L-polygon walks  ... nearPrev -> vCenter -> nearNext ...  so to MATE it
        // (every shared edge used in opposite senses by exactly two faces) the disk
        // ring must walk  vCenter -> nearPrev -> (arc) -> nearNext -> vCenter, i.e.
        // {vCenter, nearPrev, nearNext}: its radius edges vCenter->nearPrev and
        // nearNext->vCenter oppose the L-polygon's nearPrev->vCenter and
        // vCenter->nearNext, and its arc (nearPrev->nearNext) mates the cylinder end.
        Face* fD = tb.makeFace();
        tb.addFaceToShell(shell, fD);
        {
            std::vector<Vertex*> dring = {vCenter, nearPrev, nearNext};
            orientRingCCW(dring, fn);
            tb.addOuterLoopToFace(fD, dring);
            // Bind the arc edge (nearPrev -> nearNext) to its exact Circle curve so
            // the cap boundary is the true quarter circle (the third loop coedge).
            Coedge* ce = fD->outerLoop->first;
            for (std::size_t s = 0; s < fD->outerLoop->coedgeCount; ++s) {
                Vertex* o = ce->originVertex();
                Vertex* dst = ce->destVertex();
                const bool arc = (o == nearPrev && dst == nearNext) ||
                                 (o == nearNext && dst == nearPrev);
                if (arc) {
                    Curve cc = Curve::makeCircle(center, nA, e, R, 0.0, 0.5 * kPi);
                    ce->edge->curve = tb.makeCurve(cc);
                }
                ce = ce->next;
            }
            Surface* sd = tb.makeSurface();
            sd->kind = SurfaceKind::Plane;
            sd->origin = center;
            sd->refDir = nA;
            // axis chosen so binormal = axis x refDir = nB (theta 0->nA, pi/2->nB).
            sd->axis = (veq(vcross(e, nA), nB)) ? e : vscale(e, -1.0);
            sd->reversed = (vdot(sd->axis, fn) < 0.0);
            sd->isDisk = true;
            sd->diskOuter = R;
            sd->diskInner = 0.0;
            fD->surface = sd;
            fD->u0 = 0.0; fD->u1 = 0.5 * kPi;     // angular trim (quarter)
            fD->v0 = 0.0; fD->v1 = R;             // radial trim
            // vertexUV not used by the disk integrator; leave default.
        }

        (void)vCenter;
    }

    // ---- the cylindrical fillet PATCH ---------------------------------------
    // Quad ring (CCW seen from OUTSIDE the solid). TA0 -> TB0 (start arc) ->
    // TB1 (along edge, B side) -> TA1 (far arc) -> back to TA0. The two arc edges
    // (TA0-TB0 and TA1-TB1) MATE the two quarter-disk caps' arcs; the two axial
    // edges (TB0-TB1, TA1-TA0) MATE the re-trimmed faces B and A.
    {
        std::vector<Vertex*> ring = {vTA0, vTB0, vTB1, vTA1};
        // Outward of the fillet patch is the +radial direction; orient the ring so
        // its topological winding matches it (handedness-independent across edges).
        orientRingCCW(ring, vnorm(vadd(nA, nB)));
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);

        // Bind the two arc edges to their exact Circle curves (matching the cap arcs).
        Coedge* ce = f->outerLoop->first;
        for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
            Vertex* o = ce->originVertex();
            Vertex* dst = ce->destVertex();
            auto isArc = [&](Vertex* a, Vertex* b) {
                return (o == a && dst == b) || (o == b && dst == a);
            };
            if (isArc(vTA0, vTB0)) {
                if (ce->edge->curve == nullptr)
                    ce->edge->curve = tb.makeCurve(Curve::makeCircle(A0, nA, e, R, 0.0, 0.5 * kPi));
            } else if (isArc(vTA1, vTB1)) {
                if (ce->edge->curve == nullptr)
                    ce->edge->curve = tb.makeCurve(Curve::makeCircle(A1, nA, e, R, 0.0, 0.5 * kPi));
            }
            ce = ce->next;
        }

        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Cylinder;
        s->origin = cylOrigin;
        s->axis   = cylAxis;
        s->refDir = nA;
        s->r1     = R;
        s->param  = edgeLen;
        {
            Vec3 sp, du, dv;
            s->evaluateDeriv(0.0, 0.5 * edgeLen, sp, du, dv);
            Vec3 nrm = vnorm(vcross(du, dv));
            s->reversed = (vdot(nrm, nA) < 0.0);   // outward == +radial (== +nA at theta 0)
        }
        f->surface = s;
        f->u0 = 0.0; f->u1 = 0.5 * kPi;
        f->v0 = 0.0; f->v1 = edgeLen;
        const double zStart = axisFlipped ? edgeLen : 0.0;
        const double zFar   = axisFlipped ? 0.0 : edgeLen;
        f->vertexUV = {
            {0.0,       zStart},   // TA0
            {0.5 * kPi, zStart},   // TB0
            {0.5 * kPi, zFar},     // TB1
            {0.0,       zFar},     // TA1
        };
        res.filletFace = f;
    }

    res.ok          = true;
    res.solid       = solid;
    res.radius      = R;
    res.edgeLength  = edgeLen;
    res.dihedralDeg = interiorDihedralDeg;
    res.axisPoint   = A0;
    res.axisDir     = e;
    res.tangentA    = TA0;
    res.tangentB    = TB0;
    res.reason      = "ok (analytic constant-radius rolling-ball fillet, "
                      "planar-planar convex straight edge)";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
