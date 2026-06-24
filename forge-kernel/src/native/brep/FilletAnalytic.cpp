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
#include "forge/native/brep/Sew.hpp"

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

// ===========================================================================
// SHARED FRAGMENT EMITTERS (used by the CONCAVE L-block path and the EDGE-CHAIN
// path). Each emits an INDEPENDENT face fragment that owns its own vertices/edges
// — the caller sews them all into one closed shell with sewFaces. This is the
// real STEP-import assembly model (Sew.hpp): coincident boundaries are distinct
// until welded, and arcs are bound to their exact Circle curve so the sewer's
// midpoint match welds the cap arc to the cylinder arc (not the chord).
// ===========================================================================

// Emit a planar CONVEX polygon face fragment (its own fresh vertices), with the
// stored plane normal oriented to `outwardNormal`. The mass integrator's exact
// polygon-moment path is exact for a convex ring. Returns the face.
Face* emitPlanarPolygon(TopologyBuilder& tb, const std::vector<Vec3>& ringPts,
                        const Vec3& outwardNormal) {
    std::vector<Vertex*> ring;
    ring.reserve(ringPts.size());
    for (const Vec3& p : ringPts) ring.push_back(tb.makeVertex(V2P(p)));
    orientRingCCW(ring, outwardNormal);
    Face* f = tb.makeFace();
    tb.addOuterLoopToFace(f, ring);
    Vec3 o = P2V(ring[0]->point);
    attachPlanarFace(tb, f, ring, o,
                     vsub(P2V(ring[1]->point), o),
                     vsub(P2V(ring[2]->point), o), outwardNormal);
    return f;
}

// Build the exact quarter Circle running from the point at center+R*originDir to
// the point at center+R*destDir (origin/dest are the EDGE's start/end radial dirs),
// so binding it to that edge agrees with the edge's start->end traversal (the sewer
// samples curves directionally — a wrong-sense circle defeats the midpoint match).
Curve quarterArc(const Vec3& center, double R, const Vec3& originDir, const Vec3& destDir) {
    // refDir = originDir (t=0); at t=pi/2 the point is center + R*binormal, so we need
    // binormal = destDir, i.e. axis x originDir = destDir -> axis = originDir x destDir.
    Vec3 axis = vnorm(vcross(originDir, destDir));
    return Curve::makeCircle(center, originDir, axis, R, 0.0, 0.5 * kPi);
}

// Bind the (already-created) arc edge between vP (at center+R*dirP) and vQ (at
// center+R*dirQ) to a Circle running in the edge's own start->end sense.
void bindArcEdge(TopologyBuilder& tb, Edge* edge, const Vec3& center, double R,
                 Vertex* vP, const Vec3& dirP, Vertex* vQ, const Vec3& dirQ) {
    (void)vQ;  // the other endpoint, by construction at center+R*dirQ (kept for clarity)
    if (edge->start == vP) edge->curve = tb.makeCurve(quarterArc(center, R, dirP, dirQ));
    else                   edge->curve = tb.makeCurve(quarterArc(center, R, dirQ, dirP));
}

// Emit a QUARTER-DISK cap fragment (annular sector, inner 0 .. outer R) centred at
// `center`, in the plane with outward normal `outward`, spanning the quarter arc
// from +dirA to +dirB (dirA, dirB unit, orthogonal radial directions). The two
// straight radius edges run center->A and center->B; the arc A->B is bound to its
// exact Circle curve (in the edge's traversal sense). `axisForFrame` is the surface
// frame axis (the edge dir) so binormal = axis x refDir = dirB when refDir = dirA.
Face* emitQuarterDisk(TopologyBuilder& tb, const Vec3& center, double R,
                      const Vec3& dirA, const Vec3& dirB, const Vec3& axisForFrame,
                      const Vec3& outward) {
    const Vec3 A = vadd(center, vscale(dirA, R));
    const Vec3 B = vadd(center, vscale(dirB, R));
    Vertex* vC = tb.makeVertex(V2P(center));
    Vertex* vA = tb.makeVertex(V2P(A));
    Vertex* vB = tb.makeVertex(V2P(B));
    // Ring walk center -> A -> (arc) -> B -> center. Orient to the outward normal.
    std::vector<Vertex*> ring = {vC, vA, vB};
    orientRingCCW(ring, outward);
    Face* fD = tb.makeFace();
    tb.addOuterLoopToFace(fD, ring);
    // Bind the arc edge (vA<->vB) to its exact Circle curve so the sewer welds it
    // to the cylinder end arc (and to any neighbouring cap), not to the chord.
    Coedge* ce = fD->outerLoop->first;
    for (std::size_t s = 0; s < fD->outerLoop->coedgeCount; ++s) {
        Vertex* o = ce->originVertex();
        Vertex* dst = ce->destVertex();
        const bool arc = (o == vA && dst == vB) || (o == vB && dst == vA);
        if (arc) bindArcEdge(tb, ce->edge, center, R, vA, dirA, vB, dirB);
        ce = ce->next;
    }
    Surface* sd = tb.makeSurface();
    sd->kind = SurfaceKind::Plane;
    sd->origin = center;
    sd->refDir = dirA;
    sd->axis = (veq(vcross(axisForFrame, dirA), dirB)) ? axisForFrame
                                                       : vscale(axisForFrame, -1.0);
    sd->reversed = (vdot(sd->axis, outward) < 0.0);
    sd->isDisk = true;
    sd->diskOuter = R;
    sd->diskInner = 0.0;
    fD->surface = sd;
    fD->u0 = 0.0; fD->u1 = 0.5 * kPi;   // angular trim (quarter)
    fD->v0 = 0.0; fD->v1 = R;           // radial trim
    return fD;
}

// Emit the quarter-CYLINDER fillet patch fragment over the edge from axis base
// `axis0` to `axis1` (axis0 = centre at edge start, axis1 at edge end), radius R,
// spanning the quarter arc from +dirA to +dirB. Two DISTINCT directions are passed:
//   * `ringOrient` orients the patch's COEDGE WINDING (so its arc edges weld to the
//     two caps in opposite sense — pick the same radial side the caps wind from);
//   * `surfNormalDir` is the radial direction the patch's geometric OUTWARD normal
//     points (set by `reversed`): for a CONVEX valley the material is across the
//     valley, normal == +bisector; for a CONCAVE fillet the empty notch is on the
//     CENTRE side, so the solid's outward normal points back toward the axis centre
//     == +bisector(nA,nB) (the OPPOSITE radial side from the convex case).
// The two arc ends are bound to their Circle curves so the sewer welds them to the
// two caps. Returns the face.
Face* emitCylinderPatch(TopologyBuilder& tb, const Vec3& axis0, const Vec3& axis1,
                        double R, const Vec3& dirA, const Vec3& dirB,
                        const Vec3& edgeDir, double edgeLen,
                        const Vec3& ringOrient, const Vec3& surfNormalDir) {
    const Vec3 TA0 = vadd(axis0, vscale(dirA, R));
    const Vec3 TB0 = vadd(axis0, vscale(dirB, R));
    const Vec3 TA1 = vadd(axis1, vscale(dirA, R));
    const Vec3 TB1 = vadd(axis1, vscale(dirB, R));
    Vertex* vTA0 = tb.makeVertex(V2P(TA0));
    Vertex* vTB0 = tb.makeVertex(V2P(TB0));
    Vertex* vTA1 = tb.makeVertex(V2P(TA1));
    Vertex* vTB1 = tb.makeVertex(V2P(TB1));

    std::vector<Vertex*> ring = {vTA0, vTB0, vTB1, vTA1};
    orientRingCCW(ring, ringOrient);
    Face* f = tb.makeFace();
    tb.addOuterLoopToFace(f, ring);

    // axis chosen so binormal = axis x refDir = dirB (theta 0 -> dirA, pi/2 -> dirB).
    Vec3 cylAxis = (veq(vcross(edgeDir, dirA), dirB)) ? edgeDir : vscale(edgeDir, -1.0);
    const bool axisFlipped = (vdot(cylAxis, edgeDir) < 0.0);
    const Vec3 cylOrigin = axisFlipped ? axis1 : axis0;

    // Bind the two arc edges (TA0<->TB0 and TA1<->TB1) to their Circle curves.
    Coedge* ce = f->outerLoop->first;
    for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
        Vertex* o = ce->originVertex();
        Vertex* dst = ce->destVertex();
        auto isArc = [&](Vertex* a, Vertex* b) {
            return (o == a && dst == b) || (o == b && dst == a);
        };
        if (isArc(vTA0, vTB0)) bindArcEdge(tb, ce->edge, axis0, R, vTA0, dirA, vTB0, dirB);
        else if (isArc(vTA1, vTB1)) bindArcEdge(tb, ce->edge, axis1, R, vTA1, dirA, vTB1, dirB);
        ce = ce->next;
    }

    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Cylinder;
    s->origin = cylOrigin;
    s->axis = cylAxis;
    s->refDir = dirA;
    s->r1 = R;
    s->param = edgeLen;
    {
        // Compare the geometric normal at the ARC MIDPOINT (theta = pi/4, where the
        // radial is the bisector of dirA,dirB) against the desired outward direction
        // surfNormalDir, and set `reversed` so the integrated normal points outward.
        Vec3 sp, du, dv;
        s->evaluateDeriv(0.25 * kPi, 0.5 * edgeLen, sp, du, dv);
        Vec3 nrm = vnorm(vcross(du, dv));
        s->reversed = (vdot(nrm, surfNormalDir) < 0.0);
    }
    f->surface = s;
    f->u0 = 0.0; f->u1 = 0.5 * kPi;
    f->v0 = 0.0; f->v1 = edgeLen;
    const double zStart = axisFlipped ? edgeLen : 0.0;
    const double zFar = axisFlipped ? 0.0 : edgeLen;
    f->vertexUV = {
        {0.0, zStart}, {0.5 * kPi, zStart}, {0.5 * kPi, zFar}, {0.0, zFar},
    };
    return f;
}

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

// ===========================================================================
// CONCAVE (reflex) fillet of the L-prism's single inner edge.
// ===========================================================================
//
// The rolling ball sits OUTSIDE the corner in the empty notch {x>t, y>h}; the
// concave cylinder of radius R, axis at (t+R, h+R) along +Z, ADDS the quarter-
// round wedge (square - quarter-disk = (1 - pi/4) R^2) per unit edge length. The
// two adjacent walls re-trim OUTWARD (face A y=h to x>=t+R; face B x=t to y>=h+R),
// the two end caps gain the square corner with the rounded corner SUBTRACTED (an
// inward-oriented quarter-disk cap), and everything is sewn into one closed solid.
AnalyticFilletResult filletLBlockEdgeAnalytic(TopologyBuilder& tb,
                                              double W, double D, double t, double h,
                                              double Lz, double R) {
    auto bail = [&](const char* why) { return fail(why); };
    if (!(W > 0) || !std::isfinite(W)) return bail("L-block width W must be positive finite");
    if (!(D > 0) || !std::isfinite(D)) return bail("L-block depth D must be positive finite");
    if (!(Lz > 0) || !std::isfinite(Lz)) return bail("L-block length Lz must be positive finite");
    if (!(t > 0 && t < W)) return bail("L-block notch t must satisfy 0 < t < W");
    if (!(h > 0 && h < D)) return bail("L-block notch h must satisfy 0 < h < D");
    if (!(R > 0) || !std::isfinite(R)) return bail("fillet radius R must be positive finite");
    if (!(R <= W - t)) return bail("R must be <= W - t (fillet overflows the bottom leg)");
    if (!(R <= D - h)) return bail("R must be <= D - h (fillet overflows the left leg)");
    if (!(R <= t)) return bail("R must be <= t (tangent line overflows face B's leg)");
    if (!(R <= h)) return bail("R must be <= h (tangent line overflows face A's leg)");

    const Vec3 nA{0, 1, 0};   // face A outward normal (wall y=h)
    const Vec3 nB{1, 0, 0};   // face B outward normal (wall x=t)
    const Vec3 eDir{0, 0, 1}; // reflex edge direction (+Z)
    const double cx = t + R, cy = h + R;          // cylinder axis (x,y)
    const Vec3 A0{cx, cy, 0.0};                    // axis foot @ z=0
    const Vec3 A1{cx, cy, Lz};                     // axis foot @ z=Lz
    // Concave: radial directions to the two tangent lines are -nA and -nB; the
    // patch's material (outward) normal points toward the corner == -bisector.
    const Vec3 dirA = vscale(nA, -1.0);            // (0,-1,0) -> tangent on A at (cx, h)
    const Vec3 dirB = vscale(nB, -1.0);            // (-1,0,0) -> tangent on B at (t, cy)
    // RING orientation: the patch's coedge winding follows the toward-corner radial
    // (the same side the end-cap quarter-disks wind from), giving a watertight weld.
    const Vec3 ringOrient = vnorm(vadd(dirA, dirB));          // toward corner
    // NORMAL: the added wedge material lies on the CORNER side of the cylinder and
    // the empty remaining notch lies on the CENTRE side, so the fillet surface's
    // OUTWARD-of-solid normal points BACK toward the axis centre == +bisector(nA,nB).
    const Vec3 surfNormalDir = vnorm(vscale(vadd(dirA, dirB), -1.0)); // toward centre

    Solid* solid = tb.makeSolid();

    std::vector<Face*> frags;

    // -- the two end caps (z=0 outward -Z, z=Lz outward +Z) ------------------
    // Square-cornered cross-section tiled into 6 convex rectangles, with the
    // rounded corner SUBTRACTED via an inward-oriented quarter-disk cap.
    auto rect = [](double x0, double y0, double x1, double y1, double z) {
        return std::vector<Vec3>{ {x0, y0, z}, {x1, y0, z}, {x1, y1, z}, {x0, y1, z} };
    };
    for (int end = 0; end < 2; ++end) {
        const double z = (end == 0) ? 0.0 : Lz;
        const Vec3 capOut = (end == 0) ? Vec3{0, 0, -1} : Vec3{0, 0, 1};
        // 6 convex rectangles tiling the square-cornered cross-section.
        frags.push_back(emitPlanarPolygon(tb, rect(t + R, 0, W, h, z), capOut));     // 1
        frags.push_back(emitPlanarPolygon(tb, rect(t, 0, t + R, h, z), capOut));     // 2
        frags.push_back(emitPlanarPolygon(tb, rect(0, 0, t, h, z), capOut));         // 3
        frags.push_back(emitPlanarPolygon(tb, rect(0, h, t, h + R, z), capOut));     // 4
        frags.push_back(emitPlanarPolygon(tb, rect(0, h + R, t, D, z), capOut));     // 5
        frags.push_back(emitPlanarPolygon(tb, rect(t, h, t + R, h + R, z), capOut)); // 6 (corner)
        // Subtracted quarter-disk: centre = axis foot, radii to (cx,h) and (t,cy),
        // arc faces the corner. Its outward normal is FLIPPED (== -capOut) so in the
        // boundary integral it removes the rounded-corner region from rectangle 6.
        const Vec3 center{cx, cy, z};
        frags.push_back(emitQuarterDisk(tb, center, R, dirA, dirB, eDir,
                                        vscale(capOut, -1.0)));
    }

    // -- side walls (split at the breakpoints the caps introduce) ------------
    auto wall = [&](const Vec3& a0, const Vec3& a1, const Vec3& outward) {
        // vertical quad from cross-section segment a0->a1 (z=0) up to z=Lz.
        std::vector<Vec3> r = { {a0.x, a0.y, 0}, {a1.x, a1.y, 0},
                                {a1.x, a1.y, Lz}, {a0.x, a0.y, Lz} };
        frags.push_back(emitPlanarPolygon(tb, r, outward));
    };
    const Vec3 mY{0, -1, 0}, mX{-1, 0, 0};
    // y=0 (W0), split at x=t, t+R
    wall({0, 0, 0}, {t, 0, 0}, mY);
    wall({t, 0, 0}, {t + R, 0, 0}, mY);
    wall({t + R, 0, 0}, {W, 0, 0}, mY);
    // x=W (W1)
    wall({W, 0, 0}, {W, h, 0}, nB);
    // y=h face A re-trimmed, x in [t+R, W] (W2)
    wall({W, h, 0}, {t + R, h, 0}, nA);
    // x=t face B re-trimmed, y in [h+R, D] (W3)
    wall({t, h + R, 0}, {t, D, 0}, nB);
    // y=D (W4)
    wall({t, D, 0}, {0, D, 0}, nA);
    // x=0 (W5), split at y=h, h+R
    wall({0, D, 0}, {0, h + R, 0}, mX);
    wall({0, h + R, 0}, {0, h, 0}, mX);
    wall({0, h, 0}, {0, 0, 0}, mX);

    // -- the concave cylindrical fillet patch --------------------------------
    Face* cyl = emitCylinderPatch(tb, A0, A1, R, dirA, dirB, eDir, Lz,
                                  ringOrient, surfNormalDir);
    frags.push_back(cyl);

    // -- sew all fragments into one closed shell -----------------------------
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    AnalyticFilletResult res;
    res.ok = sr.ok && sr.diagnosis.closed;
    res.solid = solid;
    res.filletFace = cyl;
    res.trimmedFaceA = nullptr;
    res.trimmedFaceB = nullptr;
    res.radius = R;
    res.edgeLength = Lz;
    res.dihedralDeg = 270.0;     // interior reflex dihedral
    res.axisPoint = A0;
    res.axisDir = eDir;
    res.tangentA = Vec3{cx, h, 0};   // tangent on face A
    res.tangentB = Vec3{t, cy, 0};   // tangent on face B
    res.reason = res.ok
        ? "ok (analytic constant-radius rolling-ball fillet, planar-planar CONCAVE "
          "reflex straight edge — material added at the inner corner)"
        : "concave fillet assembly did not sew into a closed shell";
    return res;
}

// ===========================================================================
// EDGE-CHAIN fillet of a connected set of CONVEX box edges (honest shared-vertex
// reporting). Each requested edge is filleted independently (cylinder + two
// quarter-disk caps); the box faces are re-trimmed back to the tangent lines and
// tiled into rectangles split at the {0,R,L-R,L} breakpoints so every fragment
// edge matches its neighbour; everything is sewn into one closed solid. Where two
// filleted edges meet at a SHARED VERTEX the corner is left sharp (the two caps
// keep it watertight) and the vertex is reported in `unblendedCorners`.
// ===========================================================================
namespace {

// A box face's local 2D->3D frame: faceOrigin + s*uDir + t*vDir spans [0,L]^2.
struct FaceFrame { Vec3 origin, uDir, vDir, outward; };

FaceFrame boxFaceFrame(int faceIdx, double L) {
    // faceIdx 0..5 in kBoxFaces order: bottom,top,front(y=0),back(y=L),left(x=0),right(x=L)
    switch (faceIdx) {
        case 0: return {{0,0,0},   {1,0,0}, {0,1,0}, {0,0,-1}}; // bottom z=0
        case 1: return {{0,0,L},   {1,0,0}, {0,1,0}, {0,0,1}};  // top    z=L
        case 2: return {{0,0,0},   {1,0,0}, {0,0,1}, {0,-1,0}}; // front  y=0
        case 3: return {{0,L,0},   {1,0,0}, {0,0,1}, {0,1,0}};  // back   y=L
        case 4: return {{0,0,0},   {0,1,0}, {0,0,1}, {-1,0,0}}; // left   x=0
        case 5: return {{L,0,0},   {0,1,0}, {0,0,1}, {1,0,0}};  // right  x=L
        default: return {{0,0,0},{1,0,0},{0,1,0},{0,0,1}};
    }
}

} // namespace

AnalyticChainFilletResult filletBoxEdgeChainAnalytic(TopologyBuilder& tb,
                                                     double L, double R,
                                                     const std::vector<int>& edgeIndices) {
    AnalyticChainFilletResult out;
    auto bad = [&](const char* why) { out.ok = false; out.reason = why; return out; };
    if (!(L > 0) || !std::isfinite(L)) return bad("box L must be positive finite");
    if (!(R > 0) || !std::isfinite(R)) return bad("R must be positive finite");
    if (!(2.0 * R < L)) return bad("need 2R < L (two opposing tangent insets must not cross)");
    if (edgeIndices.empty()) return bad("no edges requested");
    for (int ei : edgeIndices)
        if (ei < 0 || ei > 11) return bad("edgeIndex out of range [0,11]");
    // dedup
    std::vector<int> edges;
    for (int ei : edgeIndices) if (std::find(edges.begin(), edges.end(), ei) == edges.end()) edges.push_back(ei);

    const std::vector<Vec3> C = boxCorners(L);

    // Count how many requested edges touch each box corner (a corner touched by >=2
    // is a SHARED vertex where two fillets meet — the unblended corner).
    int cornerCount[8] = {0,0,0,0,0,0,0,0};
    for (int ei : edges) {
        const BoxEdge be = boxEdge(ei);
        if (std::fabs(vdot(vnorm(be.nA), vnorm(be.nB))) > 1e-9)
            return bad("a requested edge is not a 90-degree convex box edge");
        cornerCount[be.c0]++;
        cornerCount[be.c1]++;
    }

    // Per edge, decide the SETBACK at each end: if that endpoint is a shared corner
    // we set the cylinder back by R so the two perpendicular fillets do NOT overlap
    // (leaving a small sharp corner cube the caller is told about); a non-shared end
    // runs flush to the box's perpendicular face (capped in that face like the
    // single-edge path). Returns the axis span [z0,z1] (z measured from c0 along e).
    auto endSetback = [&](int corner) -> double { return cornerCount[corner] >= 2 ? R : 0.0; };

    // Each filleted edge removes an axis-aligned BOX REGION of the box surface near
    // the edge: a WORLD-coordinate rectangular slab (the R-wide strip along the edge
    // on its two faces, plus the R x R corner cells of any non-shared cap). We record
    // each removed region as a world AABB on the box SURFACE, and collect global
    // breakpoint planes per world axis so EVERY face is split consistently (so every
    // shared edge is split identically on both faces — no T-junctions).
    struct Box3 { double lo[3], hi[3]; };
    std::vector<Box3> removedRegions;
    std::vector<double> brk[3];                 // global breakpoints per world axis
    for (int a = 0; a < 3; ++a) { brk[a].push_back(0.0); brk[a].push_back(L); }
    auto addBreak = [&](int axis, double v) { brk[axis].push_back(v); };
    auto addRemoved = [&](const Vec3& lo, const Vec3& hi) {
        Box3 b; b.lo[0]=std::min(lo.x,hi.x); b.hi[0]=std::max(lo.x,hi.x);
        b.lo[1]=std::min(lo.y,hi.y); b.hi[1]=std::max(lo.y,hi.y);
        b.lo[2]=std::min(lo.z,hi.z); b.hi[2]=std::max(lo.z,hi.z);
        removedRegions.push_back(b);
        for (int a = 0; a < 3; ++a) { addBreak(a, b.lo[a]); addBreak(a, b.hi[a]); }
    };

    std::vector<Face*> frags;
    double removedTotal = 0.0;

    // -- per-edge cylinder patch + caps; accumulate the face re-trim regions --
    for (int ei : edges) {
        const BoxEdge be = boxEdge(ei);
        const Vec3 P0 = C[be.c0], P1 = C[be.c1];
        Vec3 e = vsub(P1, P0);
        const double fullLen = vlen(e);
        e = vscale(e, 1.0 / fullLen);
        const Vec3 nA = vnorm(be.nA), nB = vnorm(be.nB);
        const double sb0 = endSetback(be.c0);   // setback at the c0 end
        const double sb1 = endSetback(be.c1);   // setback at the c1 end
        const double z0 = sb0, z1 = fullLen - sb1;     // cylinder axis span
        const double cylLen = z1 - z0;
        if (!(cylLen > 0)) return bad("edge too short for the requested setbacks");
        // convex valley axis: R inside both planes, then advanced by the setback.
        const Vec3 footBase = vadd(P0, vscale(vadd(nA, nB), -R));
        const Vec3 A0 = vadd(footBase, vscale(e, z0));   // near cap foot
        const Vec3 A1 = vadd(footBase, vscale(e, z1));   // far  cap foot
        const Vec3 dirA = nA, dirB = nB;
        const Vec3 outward = vnorm(vadd(nA, nB));        // convex: ring & normal agree
        Face* cyl = emitCylinderPatch(tb, A0, A1, R, dirA, dirB, e, cylLen, outward, outward);
        out.filletFaces.push_back(cyl);
        frags.push_back(cyl);
        removedTotal += (1.0 - kPi / 4.0) * R * R * cylLen;

        // The two caps. A SHARED end (setback) caps with a fresh quarter-disk in the
        // interior plane perpendicular to the edge; a NON-shared end caps IN the box's
        // perpendicular face (its R x R corner cell is removed and the disk rounds it).
        // -- near (c0) end cap (outward along -e) --
        frags.push_back(emitQuarterDisk(tb, A0, R, dirA, dirB, e, vscale(e, -1.0)));
        if (sb0 == 0.0) addRemoved(P0, A0);   // corner cell on the perpendicular face
        // -- far (c1) end cap (outward along +e) --
        frags.push_back(emitQuarterDisk(tb, A1, R, dirA, dirB, e, e));
        if (sb1 == 0.0) addRemoved(P1, A1);

        // Removed R-strip on each adjacent face: the slab between the edge line and
        // the tangent line, from z0 to z1 along the edge. On the face with normal nA
        // the strip extends INTO that face along -nB (the in-face perpendicular to the
        // edge); on the nB face it extends along -nA.
        const Vec3 q0 = vadd(P0, vscale(e, z0));
        const Vec3 q1 = vadd(P0, vscale(e, z1));
        addRemoved(q0, vadd(q1, vscale(nB, -R)));   // strip on face A (normal nA), toward -nB
        addRemoved(q0, vadd(q1, vscale(nA, -R)));   // strip on face B (normal nB), toward -nA
    }

    // -- consistent global breakpoints; tile every face; drop removed cells -
    for (int a = 0; a < 3; ++a) {
        std::sort(brk[a].begin(), brk[a].end());
        brk[a].erase(std::unique(brk[a].begin(), brk[a].end(),
                     [](double x, double y){ return std::fabs(x - y) < 1e-7; }), brk[a].end());
    }
    // axis indices each face frame's (uDir,vDir) point along, for breakpoint lookup.
    auto axisOf = [](const Vec3& d) -> int {
        if (std::fabs(d.x) > 0.5) return 0; if (std::fabs(d.y) > 0.5) return 1; return 2;
    };
    // A face cell is dropped iff its centre lies in some removed region: STRICT
    // containment in the two in-face axes, INCLUSIVE on the face-normal axis (so a
    // strip slab that hugs the face plane still removes the cell whose centre is
    // exactly on that plane).
    auto cellRemoved = [&](const Vec3& centre, int normAxis) {
        const double c[3] = {centre.x, centre.y, centre.z};
        for (const Box3& b : removedRegions) {
            bool in = true;
            for (int a = 0; a < 3; ++a) {
                if (a == normAxis) { if (c[a] < b.lo[a]-1e-7 || c[a] > b.hi[a]+1e-7) { in = false; break; } }
                else               { if (c[a] < b.lo[a]+1e-9 || c[a] > b.hi[a]-1e-9) { in = false; break; } }
            }
            if (in) return true;
        }
        return false;
    };
    for (int fi = 0; fi < 6; ++fi) {
        const FaceFrame fr = boxFaceFrame(fi, L);
        const int ua = axisOf(fr.uDir), va = axisOf(fr.vDir);
        const int na = axisOf(fr.outward);
        auto P = [&](double s, double t){ return vadd(fr.origin, vadd(vscale(fr.uDir, s), vscale(fr.vDir, t))); };
        const std::vector<double>& ub = brk[ua];
        const std::vector<double>& vb = brk[va];
        for (std::size_t iu = 0; iu + 1 < ub.size(); ++iu) {
            for (std::size_t iv = 0; iv + 1 < vb.size(); ++iv) {
                const double s0 = ub[iu], s1 = ub[iu+1], t0 = vb[iv], t1 = vb[iv+1];
                if (s1 - s0 < 1e-9 || t1 - t0 < 1e-9) continue;
                const Vec3 ctr = P(0.5*(s0+s1), 0.5*(t0+t1));
                if (cellRemoved(ctr, na)) continue;
                frags.push_back(emitPlanarPolygon(tb, {P(s0,t0), P(s1,t0), P(s1,t1), P(s0,t1)}, fr.outward));
            }
        }
    }

    // -- honest shared-vertex reporting -------------------------------------
    // (cornerCount already populated above; here we just record the first two edges
    // meeting at each shared corner.)
    int cornerEdgeA[8], cornerEdgeB[8], seen[8] = {0,0,0,0,0,0,0,0};
    for (int& v : cornerEdgeA) v = -1;
    for (int& v : cornerEdgeB) v = -1;
    for (int ei : edges) {
        const BoxEdge be = boxEdge(ei);
        for (int corner : {be.c0, be.c1}) {
            if (seen[corner] == 0) cornerEdgeA[corner] = ei;
            else if (seen[corner] == 1) cornerEdgeB[corner] = ei;
            seen[corner]++;
        }
    }
    for (int c = 0; c < 8; ++c) {
        if (cornerCount[c] >= 2) {
            UnblendedCorner uc;
            uc.position = C[c];
            uc.cornerIndex = c;
            uc.edgeA = cornerEdgeA[c];
            uc.edgeB = cornerEdgeB[c];
            uc.meetingFilletCount = cornerCount[c];
            out.unblendedCorners.push_back(uc);
        }
    }

    // -- sew all fragments into one closed shell ----------------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    out.solid = solid;
    out.filletedEdgeCount = static_cast<int>(edges.size());
    out.radius = R;
    out.removedVolume = removedTotal;
    const bool closed = sr.ok && sr.diagnosis.closed;
    const bool hasShared = !out.unblendedCorners.empty();
    // HONEST scope: a chain with NO shared vertex sews into a fully CLOSED 2-manifold
    // (each edge's cylinder + caps + re-trimmed faces). A chain WHERE two fillets MEET
    // at a shared vertex needs the setback/spherical VERTEX BLEND — NOT built this
    // pass. Rather than fabricate a subtly-wrong corner, each edge is still filleted
    // (its cylinder patch is in filletFaces) and the shared vertex is reported in
    // unblendedCorners; ok is true ONLY for the genuinely closed (no-shared) result.
    out.ok = closed && !hasShared;
    out.reason = out.ok
        ? "ok (analytic constant-radius rolling-ball fillet of a CONVEX box edge chain; "
          "all edges blended, watertight closed 2-manifold, no shared-vertex corners)"
        : hasShared
            ? "partial (honest): each requested edge IS filleted, but the chain shares "
              "a vertex where two fillets meet — the spherical/setback VERTEX BLEND is a "
              "documented follow-up, so that corner is reported in unblendedCorners and "
              "NOT fabricated"
            : "edge-chain fillet assembly did not sew into a closed shell";
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
