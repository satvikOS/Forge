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
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <unordered_set>
#include <utility>
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

// ===========================================================================
// GENERAL-ANGLE (non-orthogonal) SECTOR emitters — the DIHEDRAL broadening of the
// quarter emitters above. The quarter emitters hard-code a pi/2 arc between two
// ORTHOGONAL radial directions (dirA . dirB == 0); these take ANY two unit radial
// directions dirA,dirB and span the FULL arc angle  theta = acos(dirA . dirB) in
// (0,pi), so a fillet on a NON-orthogonal convex planar-planar edge (a prism /
// wedge / dovetail / angled bracket) builds the EXACT sector cylinder + sector-disk
// caps instead of deferring to OCCT BRepFilletAPI. They REDUCE to the quarter
// emitters at theta == pi/2 (same vertices, same trim, same Circle), so they are a
// strict generalisation. NOTE the rolling-ball tangent point on plane A is ALWAYS
// axisFoot + R*nA — the foot is signed-distance -R from plane A, so its
// perpendicular foot onto A is foot + R*nA — INDEPENDENT of the dihedral angle; only
// the arc SWEEP and the axis-foot OFFSET change with the angle, not the algebra.
// ===========================================================================

// The exact circular arc from center+R*originDir to center+R*destDir spanning the
// full angle theta = acos(originDir . destDir) between the two unit radial dirs (the
// quarterArc above is the theta == pi/2 special case; identical Circle there).
Curve sectorArc(const Vec3& center, double R, const Vec3& originDir, const Vec3& destDir) {
    const Vec3 axis = vnorm(vcross(originDir, destDir));   // rotation axis originDir->destDir
    const double c = std::max(-1.0, std::min(1.0, vdot(originDir, destDir)));
    const double theta = std::acos(c);
    return Curve::makeCircle(center, originDir, axis, R, 0.0, theta);
}

// Bind the (already-created) arc edge between vP (at center+R*dirP) and vQ (at
// center+R*dirQ) to its sector Circle running in the edge's own start->end sense.
void bindSectorArcEdge(TopologyBuilder& tb, Edge* edge, const Vec3& center, double R,
                       Vertex* vP, const Vec3& dirP, Vertex* vQ, const Vec3& dirQ) {
    (void)vQ;  // the other endpoint, by construction at center+R*dirQ
    if (edge->start == vP) edge->curve = tb.makeCurve(sectorArc(center, R, dirP, dirQ));
    else                   edge->curve = tb.makeCurve(sectorArc(center, R, dirQ, dirP));
}

// The in-plane unit vector perpendicular to dirA, in the (dirA,dirB) arc plane and
// pointing toward dirB — the surface-frame BINORMAL of a sector patch whose refDir
// is dirA (for orthogonal dirs this is exactly dirB).
Vec3 sectorBinormal(const Vec3& dirA, const Vec3& dirB) {
    return vnorm(vsub(dirB, vscale(dirA, vdot(dirA, dirB))));
}

// Emit a SECTOR-DISK cap fragment (annular sector, inner 0 .. outer R) centred at
// `center`, in the plane with outward normal `outward`, spanning the arc from +dirA
// to +dirB (angle theta = acos(dirA . dirB)). Generalises emitQuarterDisk to any
// theta in (0,pi). The two straight radius edges run center->A and center->B; the arc
// A->B is bound to its exact sector Circle. `axisForFrame` is the surface frame axis
// (the edge dir) so binormal = axis x refDir points toward dirB.
Face* emitSectorDisk(TopologyBuilder& tb, const Vec3& center, double R,
                     const Vec3& dirA, const Vec3& dirB, const Vec3& axisForFrame,
                     const Vec3& outward) {
    const Vec3 A = vadd(center, vscale(dirA, R));
    const Vec3 B = vadd(center, vscale(dirB, R));
    Vertex* vC = tb.makeVertex(V2P(center));
    Vertex* vA = tb.makeVertex(V2P(A));
    Vertex* vB = tb.makeVertex(V2P(B));
    std::vector<Vertex*> ring = {vC, vA, vB};
    orientRingCCW(ring, outward);
    Face* fD = tb.makeFace();
    tb.addOuterLoopToFace(fD, ring);
    Coedge* ce = fD->outerLoop->first;
    for (std::size_t s = 0; s < fD->outerLoop->coedgeCount; ++s) {
        Vertex* o = ce->originVertex();
        Vertex* dst = ce->destVertex();
        const bool arc = (o == vA && dst == vB) || (o == vB && dst == vA);
        if (arc) bindSectorArcEdge(tb, ce->edge, center, R, vA, dirA, vB, dirB);
        ce = ce->next;
    }
    const Vec3 bn = sectorBinormal(dirA, dirB);
    const double theta = std::acos(std::max(-1.0, std::min(1.0, vdot(dirA, dirB))));
    Surface* sd = tb.makeSurface();
    sd->kind = SurfaceKind::Plane;
    sd->origin = center;
    sd->refDir = dirA;
    // axis (== +-axisForFrame, both perpendicular to the arc plane) chosen so that
    // binormal = axis x refDir points toward dirB (== sectorBinormal).
    sd->axis = (vdot(vcross(axisForFrame, dirA), bn) >= 0.0) ? axisForFrame
                                                             : vscale(axisForFrame, -1.0);
    sd->reversed = (vdot(sd->axis, outward) < 0.0);
    sd->isDisk = true;
    sd->diskOuter = R;
    sd->diskInner = 0.0;
    fD->surface = sd;
    fD->u0 = 0.0; fD->u1 = theta;   // angular trim (the sector angle, not a fixed quarter)
    fD->v0 = 0.0; fD->v1 = R;       // radial trim
    return fD;
}

// Emit the SECTOR-CYLINDER fillet patch fragment over the edge from axis base
// `axis0` to `axis1`, radius R, spanning the arc from +dirA to +dirB (angle theta).
// Generalises emitCylinderPatch to any theta in (0,pi). See emitCylinderPatch for the
// ringOrient / surfNormalDir convention (unchanged here).
Face* emitCylinderSectorPatch(TopologyBuilder& tb, const Vec3& axis0, const Vec3& axis1,
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

    const Vec3 bn = sectorBinormal(dirA, dirB);
    const double theta = std::acos(std::max(-1.0, std::min(1.0, vdot(dirA, dirB))));
    // axis chosen so binormal = axis x refDir == sectorBinormal (theta 0 -> dirA).
    Vec3 cylAxis = (vdot(vcross(edgeDir, dirA), bn) >= 0.0) ? edgeDir : vscale(edgeDir, -1.0);
    const bool axisFlipped = (vdot(cylAxis, edgeDir) < 0.0);
    const Vec3 cylOrigin = axisFlipped ? axis1 : axis0;

    Coedge* ce = f->outerLoop->first;
    for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
        Vertex* o = ce->originVertex();
        Vertex* dst = ce->destVertex();
        auto isArc = [&](Vertex* a, Vertex* b) {
            return (o == a && dst == b) || (o == b && dst == a);
        };
        if (isArc(vTA0, vTB0)) bindSectorArcEdge(tb, ce->edge, axis0, R, vTA0, dirA, vTB0, dirB);
        else if (isArc(vTA1, vTB1)) bindSectorArcEdge(tb, ce->edge, axis1, R, vTA1, dirA, vTB1, dirB);
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
        // Compare the geometric normal at the ARC MIDPOINT (theta/2, radial == the
        // bisector of dirA,dirB) against surfNormalDir; set `reversed` accordingly.
        Vec3 sp, du, dv;
        s->evaluateDeriv(0.5 * theta, 0.5 * edgeLen, sp, du, dv);
        Vec3 nrm = vnorm(vcross(du, dv));
        s->reversed = (vdot(nrm, surfNormalDir) < 0.0);
    }
    f->surface = s;
    f->u0 = 0.0; f->u1 = theta;
    f->v0 = 0.0; f->v1 = edgeLen;
    const double zStart = axisFlipped ? edgeLen : 0.0;
    const double zFar = axisFlipped ? 0.0 : edgeLen;
    f->vertexUV = {
        {0.0, zStart}, {theta, zStart}, {theta, zFar}, {0.0, zFar},
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
// TOPOLOGY-SOURCED single convex straight edge fillet (the OCCT-zero keystone).
// Same rolling-ball math as filletBoxEdgeAnalytic, but the edge + its adjacent
// and perpendicular-end faces are resolved by WALKING the real B-rep of `src`.
// ===========================================================================
namespace {

// The ordered outer-loop vertices of a face (origin vertices in coedge order).
std::vector<Vertex*> outerRingVerts(const Face* f) {
    std::vector<Vertex*> vs;
    if (!f->outerLoop || !f->outerLoop->first) return vs;
    Coedge* c = f->outerLoop->first;
    for (std::size_t i = 0; i < f->outerLoop->coedgeCount; ++i, c = c->next)
        vs.push_back(c->originVertex());
    return vs;
}

// Faithful INDEPENDENT-fragment copy of a face: fresh vertices at the same
// positions for the outer loop and every inner (hole) loop, the analytic
// Surface copied verbatim (plane / quadric / NURBS / disk), plus the trim
// window, vertexUV and paramTri flag. Edge 3D-curves are intentionally NOT
// copied: the sewer welds coincident edges by their shared endpoints (a chord
// match), and the EXACT mass is integrated from the copied Surface + trim, so
// the copy is watertight AND mass-exact without re-binding curves. Used for the
// faces of `src` that touch NEITHER endpoint of the filleted edge.
Face* copyFaceFragment(TopologyBuilder& tb, const Face* src) {
    auto freshRing = [&](Loop* lp) {
        std::vector<Vertex*> vs;
        if (!lp || !lp->first) return vs;
        Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next)
            vs.push_back(tb.makeVertex(c->originVertex()->point));
        return vs;
    };
    Face* f = tb.makeFace();
    tb.addOuterLoopToFace(f, freshRing(src->outerLoop));
    for (Loop* il : src->innerLoops) {
        std::vector<Vertex*> inner = freshRing(il);
        if (!inner.empty()) tb.addInnerLoopToFace(f, inner);
    }
    if (src->surface) {
        Surface* s = tb.makeSurface();
        *s = *src->surface;          // value copy (PODs + NurbsSurface vectors)
        f->surface = s;
    }
    f->u0 = src->u0; f->u1 = src->u1; f->v0 = src->v0; f->v1 = src->v1;
    f->vertexUV = src->vertexUV;
    f->paramTri = src->paramTri;
    return f;
}

} // namespace

std::vector<Edge*> enumerateSolidStraightEdges(const Solid& src) {
    std::vector<Edge*> edges;
    if (src.shells.empty() || src.shells[0] == nullptr) return edges;
    std::unordered_set<Edge*> seen;
    auto collectLoop = [&](Loop* lp) {
        if (!lp || !lp->first) return;
        Coedge* c = lp->first;
        for (std::size_t i = 0; i < lp->coedgeCount; ++i, c = c->next)
            if (c->edge && c->edge->start && c->edge->end && seen.insert(c->edge).second)
                edges.push_back(c->edge);
    };
    for (Face* f : src.shells[0]->faces) {
        collectLoop(f->outerLoop);
        for (Loop* il : f->innerLoops) collectLoop(il);
    }
    // Canonical (midpoint, sign-canonical direction) sort — mirrors the
    // enumerateSharpConvexEdges ordering so an edgeId is backend-stable.
    auto midDir = [](Edge* e, Vec3& mid, Vec3& dir) {
        Vec3 a = P2V(e->start->point), b = P2V(e->end->point);
        mid = vscale(vadd(a, b), 0.5);
        Vec3 d = vsub(b, a);
        // sign-canonical: point from the lexicographically-smaller endpoint to
        // the larger one (independent of edge->start/end labelling).
        const double eps = 1e-12;
        bool flip = (a.x > b.x + eps) ||
                    (std::fabs(a.x - b.x) <= eps && (a.y > b.y + eps ||
                    (std::fabs(a.y - b.y) <= eps && a.z > b.z + eps)));
        if (flip) d = vscale(d, -1.0);
        const double L = vlen(d);
        dir = (L > 0.0) ? vscale(d, 1.0 / L) : Vec3{0, 0, 0};
    };
    std::sort(edges.begin(), edges.end(), [&](Edge* a, Edge* b) {
        Vec3 ma, da, mb, db; midDir(a, ma, da); midDir(b, mb, db);
        if (ma.x != mb.x) return ma.x < mb.x;
        if (ma.y != mb.y) return ma.y < mb.y;
        if (ma.z != mb.z) return ma.z < mb.z;
        if (da.x != db.x) return da.x < db.x;
        if (da.y != db.y) return da.y < db.y;
        return da.z < db.z;
    });
    return edges;
}

AnalyticFilletResult filletSolidStraightEdgeAnalytic(TopologyBuilder& tb,
                                                     const Solid& src,
                                                     std::uint32_t edgeId,
                                                     double R) {
    if (!(R > 0.0) || !std::isfinite(R)) return fail("fillet radius R must be positive and finite");
    if (src.shells.empty() || src.shells[0] == nullptr) return fail("solid has no shell");

    std::vector<Edge*> edges = enumerateSolidStraightEdges(src);
    if (edges.empty()) return fail("solid has no enumerable edges");
    if (edgeId >= edges.size()) return fail("edgeId out of range for this solid's edge enumeration");
    Edge* E = edges[edgeId];

    // -------- resolve the two adjacent faces (via the edge's two coedges) -----
    if (!E->coedgeA || !E->coedgeB) return fail("edge is not shared by two coedges (open / non-manifold)");
    if (!E->coedgeA->loop || !E->coedgeB->loop) return fail("edge coedge has no loop");
    Face* FA = E->coedgeA->loop->face;
    Face* FB = E->coedgeB->loop->face;
    if (!FA || !FB || FA == FB) return fail("could not resolve two distinct adjacent faces");
    if (!FA->surface || FA->surface->kind != SurfaceKind::Plane ||
        !FB->surface || FB->surface->kind != SurfaceKind::Plane)
        return fail("both adjacent faces must be PLANAR (curved-face fillet is the torus follow-up)");
    if (!FA->innerLoops.empty() || !FB->innerLoops.empty())
        return fail("an adjacent face has inner (hole) loops; holed-face re-trim is a follow-up");

    Vertex* VP0 = E->start;
    Vertex* VP1 = E->end;
    const Vec3 P0 = P2V(VP0->point);
    const Vec3 P1 = P2V(VP1->point);
    Vec3 e = vsub(P1, P0);
    const double edgeLen = vlen(e);
    if (!(edgeLen > 0.0)) return fail("degenerate (zero-length) edge");
    e = vscale(e, 1.0 / edgeLen);
    if (!(R < edgeLen)) return fail("fillet radius R must be < the edge length");

    // Outward normals from the real loop winding (CCW-from-outside -> outward).
    const Vec3 nA = vnorm(ringNormal(outerRingVerts(FA)));
    const Vec3 nB = vnorm(ringNormal(outerRingVerts(FB)));

    // Orthogonal-only scope (the exact filletBoxEdgeAnalytic envelope).
    const double ndot = vdot(nA, nB);
    if (std::fabs(ndot) > 1e-7)
        return fail("adjacent face normals are not orthogonal (only the 90-degree "
                    "convex straight edge is in this increment's scope)");

    // Convex test: face A's in-plane interior direction must lie on the MATERIAL
    // (inner) side of plane B (iA . nB < 0). Concave (reflex) edges are refused.
    Coedge* cA = (E->coedgeA->loop->face == FA) ? E->coedgeA : E->coedgeB;
    const Vec3 dA = vnorm(vsub(P2V(cA->destVertex()->point), P2V(cA->originVertex()->point)));
    const Vec3 iA = vnorm(vcross(nA, dA));   // points into FA's interior, in-plane
    if (!(vdot(iA, nB) < -1e-7))
        return fail("edge is concave (reflex) or tangent — convex-only in this increment");

    const double interiorDihedralDeg =
        180.0 - std::acos(std::max(-1.0, std::min(1.0, ndot))) * 180.0 / kPi;

    // -------- rolling-ball contact (identical math to filletBoxEdgeAnalytic) --
    const Vec3 iAn = vscale(nA, -1.0), iBn = vscale(nB, -1.0);
    const Vec3 A0 = vadd(P0, vadd(vscale(iAn, R), vscale(iBn, R)));   // axis foot @ P0
    const Vec3 A1 = vadd(A0, vscale(e, edgeLen));                     // axis foot @ P1
    const Vec3 TA0 = vadd(A0, vscale(nA, R)), TB0 = vadd(A0, vscale(nB, R));
    const Vec3 TA1 = vadd(A1, vscale(nA, R)), TB1 = vadd(A1, vscale(nB, R));

    AnalyticFilletResult res;
    std::vector<Face*> frags;
    int adjacentCount = 0, endCount = 0;

    // -------- classify + re-emit every face of src as an independent fragment -
    for (Face* F : src.shells[0]->faces) {
        std::vector<Vertex*> ring = outerRingVerts(F);
        if (ring.empty()) return fail("a face has an empty outer loop");
        bool has0 = false, has1 = false;
        for (Vertex* v : ring) { if (v == VP0) has0 = true; if (v == VP1) has1 = true; }

        if (has0 && has1) {
            // ADJACENT face (FA or FB): re-trim its two sharp-edge corners to the
            // tangent contacts; the rest of the polygon is unchanged.
            if (F != FA && F != FB)
                return fail("a non-adjacent face contains both edge endpoints (unsupported topology)");
            ++adjacentCount;
            const bool isA = (F == FA);
            const Vec3 fn = isA ? nA : nB;
            const Vec3 T0 = isA ? TA0 : TB0;
            const Vec3 T1 = isA ? TA1 : TB1;
            std::vector<Vec3> rp;
            rp.reserve(ring.size());
            for (Vertex* v : ring) {
                if (v == VP0)      rp.push_back(T0);
                else if (v == VP1) rp.push_back(T1);
                else               rp.push_back(P2V(v->point));
            }
            Face* rf = emitPlanarPolygon(tb, rp, fn);
            frags.push_back(rf);
            if (isA) res.trimmedFaceA = rf; else res.trimmedFaceB = rf;
            continue;
        }

        if (has0 || has1) {
            // PERPENDICULAR END face (exactly one sharp corner). Must be planar,
            // hole-free, and perpendicular to the edge (box/prism local topology).
            if (!F->surface || F->surface->kind != SurfaceKind::Plane || !F->innerLoops.empty())
                return fail("an edge endpoint meets a non-planar or holed face (setback follow-up)");
            const Vec3 fn = vnorm(ringNormal(ring));
            if (!(std::fabs(vdot(fn, e)) > 1.0 - 1e-6))
                return fail("an end face is not perpendicular to the edge (mitre/setback follow-up)");
            ++endCount;
            const bool atStart = has0;
            Vertex* Vsharp = atStart ? VP0 : VP1;
            const Vec3 center = atStart ? A0 : A1;
            const Vec3 Ta = atStart ? TA0 : TA1;   // tangent on FA's plane at this end
            const Vec3 Tb = atStart ? TB0 : TB1;   // tangent on FB's plane at this end

            const int n = static_cast<int>(ring.size());
            int slot = -1;
            for (int k = 0; k < n; ++k) if (ring[k] == Vsharp) { slot = k; break; }
            if (slot < 0) return fail("internal: sharp corner not located in end-face loop");
            const Vec3 prevPos = P2V(ring[(slot - 1 + n) % n]->point);
            const double dTa = vlen(vsub(Ta, prevPos)), dTb = vlen(vsub(Tb, prevPos));
            const Vec3 nearPrev = (dTa <= dTb) ? Ta : Tb;
            const Vec3 nearNext = (dTa <= dTb) ? Tb : Ta;

            // L-polygon: the box ring with the sharp corner replaced by the chain
            // [nearPrev, center, nearNext]; it is star-shaped from `center`, so it
            // fans into convex triangles (the analytic planar integrator is exact
            // per convex triangle). The two radius edges + the disk's radii + the
            // disk arc make the rounded corner watertight.
            std::vector<Vec3> Lring;
            for (int k = 0; k < n; ++k) {
                if (k == slot) { Lring.push_back(nearPrev); Lring.push_back(center); Lring.push_back(nearNext); }
                else           { Lring.push_back(P2V(ring[k]->point)); }
            }
            int ci = 0;
            for (int k = 0; k < static_cast<int>(Lring.size()); ++k) if (veq(Lring[k], center)) { ci = k; break; }
            const int Ln = static_cast<int>(Lring.size());
            for (int step = 1; step + 1 < Ln; ++step) {
                std::vector<Vec3> tri = { center, Lring[(ci + step) % Ln], Lring[(ci + step + 1) % Ln] };
                frags.push_back(emitPlanarPolygon(tb, tri, fn));
            }
            // The quarter-disk cap (radii nA -> nB, centred on the axis foot).
            frags.push_back(emitQuarterDisk(tb, center, R, nA, nB, e, fn));
            continue;
        }

        // UNTOUCHED face: faithful independent copy (any surface, holes preserved).
        frags.push_back(copyFaceFragment(tb, F));
    }

    if (adjacentCount != 2)
        return fail("the edge is not shared by exactly two re-trimmable adjacent faces");
    if (endCount != 2)
        return fail("the edge does not terminate against exactly two perpendicular end faces");

    // -------- the cylindrical fillet PATCH (convex: ring & normal == +bisector) -
    const Vec3 outward = vnorm(vadd(nA, nB));
    Face* cyl = emitCylinderPatch(tb, A0, A1, R, nA, nB, e, edgeLen, outward, outward);
    frags.push_back(cyl);
    res.filletFace = cyl;

    // -------- sew every fragment into one closed 2-manifold -------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    res.solid       = solid;
    res.radius      = R;
    res.edgeLength  = edgeLen;
    res.dihedralDeg = interiorDihedralDeg;
    res.axisPoint   = A0;
    res.axisDir     = e;
    res.tangentA    = TA0;
    res.tangentB    = TB0;
    res.ok = sr.ok && sr.diagnosis.closed;
    res.reason = res.ok
        ? "ok (analytic constant-radius rolling-ball fillet of a TOPOLOGY-SOURCED "
          "convex straight planar-planar edge; watertight closed 2-manifold)"
        : "topology-sourced fillet assembly did not sew into a closed shell";
    return res;
}

// ===========================================================================
// TOPOLOGY-SOURCED single convex straight edge fillet — GENERAL DIHEDRAL ANGLE
// (K3 non-orthogonal broadening). Identical rolling-ball contact + re-trim + cap
// machinery as filletSolidStraightEdgeAnalytic, but WITHOUT the 90-degree gate, so
// ANY convex straight edge between two PLANAR faces meeting at an arbitrary dihedral
// (a prism / wedge / dovetail / angled bracket, angle strictly in (0,180)) is
// filleted native + exact. At a 90-degree edge it reduces to the orthogonal path
// bit-for-bit (same tangent points, same removed cross-section, same Circle arcs).
// This shrinks the OCCT BRepFilletAPI include-surface: a non-orthogonal edge that
// previously deferred to OCCT / the mesh bridge now stays OCCT-free.
//
// GENERAL rolling-ball geometry (outward unit normals nA,nB, c = nA . nB in (-1,1)):
//   * the ball centre is a distance R inside BOTH planes, so its cross-section foot
//     is  A0 = P0 - (R/(1+c)) * (nA + nB)  (the c==0 orthogonal case is P0-R(nA+nB),
//     exactly the filletSolidStraightEdgeAnalytic foot). Verify: (A0-P0).nA
//     = -(R/(1+c))(1 + c) = -R, i.e. signed distance -R from plane A (likewise B).
//   * the tangent contact on plane A is A0 + R*nA (the perpendicular foot of A0 onto
//     plane A, since A0 is signed-distance -R from it) — INDEPENDENT of the angle;
//     likewise A0 + R*nB on plane B.
//   * the blend is a CYLINDER of radius R whose arc spans theta = acos(c) from the
//     +nA radial to the +nB radial. Interior dihedral delta = 180 - theta (deg).
//   * removed cross-section area (kite minus circular sector) is
//         R^2 * ( cot(delta/2) - theta/2 )   [ = (1 - pi/4) R^2 at delta = 90 ],
//     so the removed volume is that times the edge length L (the closed-form GT the
//     A/B checks against OCCT). Everything else (face classification, adjacent-face
//     re-trim to the tangent points, perpendicular-end L-polygon fan + sector-disk
//     cap, faithful copy of untouched faces, watertight sew) is UNCHANGED.
//
// HONEST SCOPE (each REFUSED with `reason`, never faked): straight CONVEX edge shared
// by two PLANAR faces at a genuine dihedral (faces neither coplanar nor flat), ending
// against two PLANAR faces PERPENDICULAR to the edge; a curved / concave / coplanar /
// holed / oblique-end input is refused. `ok` is true only when the sew is watertight.
// ===========================================================================
AnalyticFilletResult filletSolidStraightConvexEdgeAnalytic(TopologyBuilder& tb,
                                                           const Solid& src,
                                                           std::uint32_t edgeId,
                                                           double R) {
    if (!(R > 0.0) || !std::isfinite(R)) return fail("fillet radius R must be positive and finite");
    if (src.shells.empty() || src.shells[0] == nullptr) return fail("solid has no shell");

    std::vector<Edge*> edges = enumerateSolidStraightEdges(src);
    if (edges.empty()) return fail("solid has no enumerable edges");
    if (edgeId >= edges.size()) return fail("edgeId out of range for this solid's edge enumeration");
    Edge* E = edges[edgeId];

    // -------- resolve the two adjacent faces (via the edge's two coedges) -----
    if (!E->coedgeA || !E->coedgeB) return fail("edge is not shared by two coedges (open / non-manifold)");
    if (!E->coedgeA->loop || !E->coedgeB->loop) return fail("edge coedge has no loop");
    Face* FA = E->coedgeA->loop->face;
    Face* FB = E->coedgeB->loop->face;
    if (!FA || !FB || FA == FB) return fail("could not resolve two distinct adjacent faces");
    if (!FA->surface || FA->surface->kind != SurfaceKind::Plane ||
        !FB->surface || FB->surface->kind != SurfaceKind::Plane)
        return fail("both adjacent faces must be PLANAR (curved-face fillet is the torus follow-up)");
    if (!FA->innerLoops.empty() || !FB->innerLoops.empty())
        return fail("an adjacent face has inner (hole) loops; holed-face re-trim is a follow-up");

    Vertex* VP0 = E->start;
    Vertex* VP1 = E->end;
    const Vec3 P0 = P2V(VP0->point);
    const Vec3 P1 = P2V(VP1->point);
    Vec3 e = vsub(P1, P0);
    const double edgeLen = vlen(e);
    if (!(edgeLen > 0.0)) return fail("degenerate (zero-length) edge");
    e = vscale(e, 1.0 / edgeLen);
    if (!(R < edgeLen)) return fail("fillet radius R must be < the edge length");

    // Outward normals from the real loop winding (CCW-from-outside -> outward).
    const Vec3 nA = vnorm(ringNormal(outerRingVerts(FA)));
    const Vec3 nB = vnorm(ringNormal(outerRingVerts(FB)));

    // GENERAL dihedral scope: any genuine convex edge. Refuse only DEGENERATE angles:
    // c -> +1 (faces coplanar, no real edge) and c -> -1 (faces flat/anti-parallel,
    // a 180-degree smooth join with nothing to blend). The orthogonal c==0 case is a
    // subset handled bit-for-bit; the certified orthogonal path (which the dispatch
    // tries first) is unaffected — this only runs when that path declines.
    const double ndot = vdot(nA, nB);
    if (ndot > 1.0 - 1e-7)
        return fail("adjacent faces are (near) coplanar — no genuine dihedral edge to fillet");
    if (ndot < -1.0 + 1e-7)
        return fail("adjacent faces are (near) flat/anti-parallel — a smooth 180-degree join, nothing to blend");
    // Fillet must fit: the sharp-corner set-back distance R/tan(delta/2) = R/tan(theta_c)
    // uses theta_c = (pi - theta)/2; guard 1+ndot away from 0 already covers a spike.

    // Convex test: face A's in-plane interior direction must lie on the MATERIAL
    // (inner) side of plane B (iA . nB < 0). Concave (reflex) edges are refused.
    Coedge* cA = (E->coedgeA->loop->face == FA) ? E->coedgeA : E->coedgeB;
    const Vec3 dA = vnorm(vsub(P2V(cA->destVertex()->point), P2V(cA->originVertex()->point)));
    const Vec3 iA = vnorm(vcross(nA, dA));   // points into FA's interior, in-plane
    if (!(vdot(iA, nB) < -1e-7))
        return fail("edge is concave (reflex) or tangent — convex-only in this increment");

    const double theta = std::acos(std::max(-1.0, std::min(1.0, ndot)));   // fillet arc sweep
    const double interiorDihedralDeg = 180.0 - theta * 180.0 / kPi;

    // -------- GENERAL rolling-ball contact (axis foot = P0 - R/(1+c) (nA+nB)) --
    const double foot = R / (1.0 + ndot);
    const Vec3 A0 = vsub(P0, vscale(vadd(nA, nB), foot));   // axis foot @ P0
    const Vec3 A1 = vadd(A0, vscale(e, edgeLen));           // axis foot @ P1
    const Vec3 TA0 = vadd(A0, vscale(nA, R)), TB0 = vadd(A0, vscale(nB, R));
    const Vec3 TA1 = vadd(A1, vscale(nA, R)), TB1 = vadd(A1, vscale(nB, R));

    AnalyticFilletResult res;
    std::vector<Face*> frags;
    int adjacentCount = 0, endCount = 0;

    // -------- classify + re-emit every face of src as an independent fragment -
    for (Face* F : src.shells[0]->faces) {
        std::vector<Vertex*> ring = outerRingVerts(F);
        if (ring.empty()) return fail("a face has an empty outer loop");
        bool has0 = false, has1 = false;
        for (Vertex* v : ring) { if (v == VP0) has0 = true; if (v == VP1) has1 = true; }

        if (has0 && has1) {
            // ADJACENT face (FA or FB): re-trim its two sharp-edge corners to the
            // tangent contacts; the rest of the polygon is unchanged.
            if (F != FA && F != FB)
                return fail("a non-adjacent face contains both edge endpoints (unsupported topology)");
            ++adjacentCount;
            const bool isA = (F == FA);
            const Vec3 fn = isA ? nA : nB;
            const Vec3 T0 = isA ? TA0 : TB0;
            const Vec3 T1 = isA ? TA1 : TB1;
            std::vector<Vec3> rp;
            rp.reserve(ring.size());
            for (Vertex* v : ring) {
                if (v == VP0)      rp.push_back(T0);
                else if (v == VP1) rp.push_back(T1);
                else               rp.push_back(P2V(v->point));
            }
            Face* rf = emitPlanarPolygon(tb, rp, fn);
            frags.push_back(rf);
            if (isA) res.trimmedFaceA = rf; else res.trimmedFaceB = rf;
            continue;
        }

        if (has0 || has1) {
            // PERPENDICULAR END face (exactly one sharp corner). Must be planar,
            // hole-free, and perpendicular to the edge (box/prism local topology).
            if (!F->surface || F->surface->kind != SurfaceKind::Plane || !F->innerLoops.empty())
                return fail("an edge endpoint meets a non-planar or holed face (setback follow-up)");
            const Vec3 fn = vnorm(ringNormal(ring));
            if (!(std::fabs(vdot(fn, e)) > 1.0 - 1e-6))
                return fail("an end face is not perpendicular to the edge (mitre/setback follow-up)");
            ++endCount;
            const bool atStart = has0;
            Vertex* Vsharp = atStart ? VP0 : VP1;
            const Vec3 center = atStart ? A0 : A1;
            const Vec3 Ta = atStart ? TA0 : TA1;   // tangent on FA's plane at this end
            const Vec3 Tb = atStart ? TB0 : TB1;   // tangent on FB's plane at this end

            const int n = static_cast<int>(ring.size());
            int slot = -1;
            for (int k = 0; k < n; ++k) if (ring[k] == Vsharp) { slot = k; break; }
            if (slot < 0) return fail("internal: sharp corner not located in end-face loop");
            const Vec3 prevPos = P2V(ring[(slot - 1 + n) % n]->point);
            const double dTa = vlen(vsub(Ta, prevPos)), dTb = vlen(vsub(Tb, prevPos));
            const Vec3 nearPrev = (dTa <= dTb) ? Ta : Tb;
            const Vec3 nearNext = (dTa <= dTb) ? Tb : Ta;

            // L-polygon: the corner replaced by [nearPrev, center, nearNext]; star-
            // shaped from `center`, so it fans into convex triangles (exact planar
            // integrator per triangle). The sector-disk cap fills the rounded corner.
            std::vector<Vec3> Lring;
            for (int k = 0; k < n; ++k) {
                if (k == slot) { Lring.push_back(nearPrev); Lring.push_back(center); Lring.push_back(nearNext); }
                else           { Lring.push_back(P2V(ring[k]->point)); }
            }
            int ci = 0;
            for (int k = 0; k < static_cast<int>(Lring.size()); ++k) if (veq(Lring[k], center)) { ci = k; break; }
            const int Ln = static_cast<int>(Lring.size());
            for (int step = 1; step + 1 < Ln; ++step) {
                std::vector<Vec3> tri = { center, Lring[(ci + step) % Ln], Lring[(ci + step + 1) % Ln] };
                frags.push_back(emitPlanarPolygon(tb, tri, fn));
            }
            // The sector-disk cap (radii nA -> nB spanning theta, centred on the foot).
            frags.push_back(emitSectorDisk(tb, center, R, nA, nB, e, fn));
            continue;
        }

        // UNTOUCHED face: faithful independent copy (any surface, holes preserved).
        frags.push_back(copyFaceFragment(tb, F));
    }

    if (adjacentCount != 2)
        return fail("the edge is not shared by exactly two re-trimmable adjacent faces");
    if (endCount != 2)
        return fail("the edge does not terminate against exactly two perpendicular end faces");

    // -------- the sector cylindrical fillet PATCH (convex: ring & normal == +bisector) -
    const Vec3 outward = vnorm(vadd(nA, nB));
    Face* cyl = emitCylinderSectorPatch(tb, A0, A1, R, nA, nB, e, edgeLen, outward, outward);
    frags.push_back(cyl);
    res.filletFace = cyl;

    // -------- sew every fragment into one closed 2-manifold -------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    res.solid       = solid;
    res.radius      = R;
    res.edgeLength  = edgeLen;
    res.dihedralDeg = interiorDihedralDeg;
    res.axisPoint   = A0;
    res.axisDir     = e;
    res.tangentA    = TA0;
    res.tangentB    = TB0;
    res.ok = sr.ok && sr.diagnosis.closed;
    res.reason = res.ok
        ? "ok (analytic constant-radius rolling-ball fillet of a TOPOLOGY-SOURCED "
          "convex straight planar-planar edge at a GENERAL dihedral angle; watertight)"
        : "general-dihedral fillet assembly did not sew into a closed shell";
    return res;
}

// ===========================================================================
// TOPOLOGY-SOURCED MULTI-EDGE fillet (the OCCT-zero multi-edge keystone). Fillet a
// SET of straight convex planar-planar edges of an arbitrary native Solid in one
// watertight result. Same rolling-ball math + re-trim as the single-edge path, but
// every face is re-trimmed for ALL the requested edges that touch it at once, and
// the re-trimmed planar faces (which can become NON-convex, e.g. a rounded-rectangle
// cap) are decomposed into CONVEX triangles so the exact polygon-moment mass stays
// exact. Pairwise-vertex-disjoint edges only; a shared vertex is reported, not faked.
// ===========================================================================
namespace {

// Triangulate a SIMPLE planar polygon `ring` (3D points coplanar with outward
// normal `fn`) into CONVEX triangles — returned as explicit 3D point-triples — so
// MassProps' per-triangle exact moment integral stays exact even where the re-trim
// makes a face NON-convex (a rounded-rectangle cap). EVERY ring edge is preserved as
// a triangle edge, so each load-bearing boundary vertex (a notch centre that welds
// to a quarter-disk apex; a tangent point that welds to a cylinder/disk arc) is kept.
//
// PRIMARY: fan from the polygon's vertex-average when that point lies in the polygon
// KERNEL (strictly on the interior side of EVERY edge) — i.e. the polygon is
// star-shaped from it, the case for a convex face with shallow corner notches (the
// box/plate re-trim family). This is the multi-corner generalisation of the
// single-edge path's fan-from-notch-centre, and it produces clean, degenerate-free
// triangles preserving all boundary edges.
// FALLBACK: ear-clipping. If ear-clipping stalls or would strand a degenerate
// (collinear) triangle, EMPTY is returned so the caller refuses honestly (mesh-bridge
// fallback) rather than emit a zero-area face. Pure, allocation-only.
std::vector<std::array<Vec3, 3>> triangulatePlanarPolygon(const std::vector<Vec3>& ring,
                                                          const Vec3& fn) {
    std::vector<std::array<Vec3, 3>> tris;
    const int n = static_cast<int>(ring.size());
    if (n < 3) return tris;

    // In-plane 2D frame (u, w) with u along the first non-degenerate ring edge.
    Vec3 u{0, 0, 0};
    for (int i = 0; i < n; ++i) {
        Vec3 d = vsub(ring[(i + 1) % n], ring[i]);
        if (vlen(d) > 1e-9) { u = vnorm(d); break; }
    }
    if (vlen(u) < 0.5) return tris;
    const Vec3 w = vnorm(vcross(fn, u));     // in-plane, (u, w, fn) right-handed
    const Vec3 o = ring[0];
    std::vector<std::array<double, 2>> P(n);
    for (int i = 0; i < n; ++i) {
        Vec3 r = vsub(ring[i], o);
        P[i] = {vdot(r, u), vdot(r, w)};
    }
    auto cross2 = [&](const std::array<double, 2>& a, const std::array<double, 2>& b,
                      const std::array<double, 2>& c) {
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    };
    double area2 = 0.0;
    for (int i = 0; i < n; ++i) area2 += P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1];
    const double sgn = (area2 >= 0.0) ? 1.0 : -1.0;      // +1 if the ring runs CCW in (u,w)

    // ---- PRIMARY: fan from the vertex-average if it lies in the polygon kernel ----
    std::array<double, 2> ctr{0.0, 0.0};
    for (const auto& p : P) { ctr[0] += p[0]; ctr[1] += p[1]; }
    ctr[0] /= n; ctr[1] /= n;
    bool inKernel = true;
    for (int i = 0; i < n; ++i) {
        const double cr = cross2(P[i], P[(i + 1) % n], ctr);   // interior side is sgn-positive
        if (sgn * cr <= 1e-9) { inKernel = false; break; }
    }
    if (inKernel) {
        Vec3 c3{0, 0, 0};
        for (const auto& p : ring) c3 = vadd(c3, p);
        c3 = vscale(c3, 1.0 / n);
        for (int i = 0; i < n; ++i) {
            const Vec3& a = ring[i];
            const Vec3& b = ring[(i + 1) % n];
            if (vlen(vsub(a, b)) < 1e-9) continue;             // skip a zero-length boundary edge
            tris.push_back({c3, a, b});
        }
        return tris;
    }

    // ---- FALLBACK: ear-clipping (refuse on a stall / stranded degenerate) --------
    std::vector<int> V(n);
    for (int i = 0; i < n; ++i) V[i] = i;
    if (sgn < 0.0) std::reverse(V.begin(), V.end());           // make V CCW in (u,w)
    auto cr3 = [&](int ia, int ib, int ic) { return cross2(P[ia], P[ib], P[ic]); };
    auto strictlyInside = [&](int ia, int ib, int ic, int ip) {
        return cr3(ia, ib, ip) > 1e-12 && cr3(ib, ic, ip) > 1e-12 && cr3(ic, ia, ip) > 1e-12;
    };
    int guard = 0;
    while (static_cast<int>(V.size()) > 3 && guard++ < 8 * n) {
        const int m = static_cast<int>(V.size());
        bool clipped = false;
        for (int i = 0; i < m; ++i) {
            const int ia = V[(i + m - 1) % m], ib = V[i], ic = V[(i + 1) % m];
            if (cr3(ia, ib, ic) <= 1e-12) continue;            // reflex/collinear: not an ear
            bool ear = true;
            for (int j = 0; j < m; ++j) {
                const int ip = V[j];
                if (ip == ia || ip == ib || ip == ic) continue;
                if (strictlyInside(ia, ib, ic, ip)) { ear = false; break; }
            }
            if (!ear) continue;
            tris.push_back({ring[ia], ring[ib], ring[ic]});
            V.erase(V.begin() + i);
            clipped = true;
            break;
        }
        if (!clipped) return {};                               // stalled -> honest refusal
    }
    if (static_cast<int>(V.size()) == 3) {
        if (std::fabs(cr3(V[0], V[1], V[2])) < 1e-12) return {};   // degenerate final triangle
        tris.push_back({ring[V[0]], ring[V[1]], ring[V[2]]});
    }
    return tris;
}

// Emit the SPHERICAL-OCTANT corner blend fragment that rounds an ORTHOGONAL
// TRIHEDRAL vertex where three mutually-orthogonal filleted edges meet. The three
// corner faces have OUTWARD unit normals m0,m1,m2 (mutually orthogonal). The sphere
// of radius R centred at `center` is tangent to all three planes; its three TANGENT
// POINTS  Vi = center + R*mi  are the octant's vertices, and its three boundary arcs
// are QUARTER GREAT CIRCLES — the arc between Vi and Vj lies in the plane through
// `center` spanned by mi,mj and IS the set-back cylinder END of the edge shared by
// faces i,j (foot == center, radii mi -> mj). Binding each octant arc to the SAME
// quarterArc(center,R,mi,mj) the cylinder cap binds makes the sewer weld them.
//
// Carried as a real SurfaceKind::Sphere face: frame axis = m0 (so phi=0 is the pole
// V0) and refDir chosen from {m1,m2} so binormal = axis x refDir is the remaining
// normal; the trim rectangle theta,phi in [0,pi/2]^2 maps EXACTLY onto the octant
// (the phi=0 edge degenerates to the pole — handled as a 3-edge TRIANGULAR loop, so
// no zero-length edge is created), and the analytic |S_u x S_v| Jacobian integrates
// the corner's contribution to the mass EXACTLY (the pole's vanishing Jacobian is a
// Gauss-interior limit). `reversed` is set so the stored normal points OUT of the
// solid (radially away from `center`). The loop is wound CCW about that outward
// normal, so each octant arc opposes its cylinder-cap coedge (a closed 2-manifold).
Face* emitSphereOctant(TopologyBuilder& tb, const Vec3& center, double R,
                       const Vec3& m0, const Vec3& m1, const Vec3& m2) {
    const std::array<Vec3, 3> m = {m0, m1, m2};
    const std::array<Vec3, 3> V = {vadd(center, vscale(m0, R)),
                                   vadd(center, vscale(m1, R)),
                                   vadd(center, vscale(m2, R))};
    std::vector<Vertex*> ring = {tb.makeVertex(V2P(V[0])),
                                 tb.makeVertex(V2P(V[1])),
                                 tb.makeVertex(V2P(V[2]))};
    // Outward of the octant (toward the rounded-off corner exterior) is the SUM of
    // the three outward face normals; wind the chord triangle CCW about it.
    const Vec3 octOut = vnorm(vadd(vadd(m0, m1), m2));
    orientRingCCW(ring, octOut);

    Face* f = tb.makeFace();
    tb.addOuterLoopToFace(f, ring);

    // Bind every loop coedge (a side of the octant triangle) to its quarter great
    // circle so it welds to the matching set-back cylinder cap.
    auto idxOf = [&](Vertex* x) -> int {
        for (int i = 0; i < 3; ++i) if (veq(P2V(x->point), V[i])) return i;
        return -1;
    };
    Coedge* ce = f->outerLoop->first;
    for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
        const int i = idxOf(ce->originVertex());
        const int j = idxOf(ce->destVertex());
        if (i >= 0 && j >= 0 && i != j)
            ce->edge->curve = tb.makeCurve(quarterArc(center, R, m[i], m[j]));
        ce = ce->next;
    }

    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Sphere;
    s->origin = center;
    s->r1 = R;
    s->axis = m0;
    // refDir so that binormal = axis x refDir is the third normal (the octant maps
    // to [0,pi/2]^2): for a right-handed {m0,m1,m2} m0 x m1 == m2 -> refDir = m1;
    // for left-handed m0 x m1 == -m2 (and m0 x m2 == m1) -> refDir = m2.
    s->refDir = veq(vcross(m0, m1), m2) ? m1 : m2;
    {
        Vec3 sp, du, dv;
        s->evaluateDeriv(0.25 * kPi, 0.25 * kPi, sp, du, dv);   // patch midpoint
        const Vec3 nrm = vnorm(vcross(du, dv));
        const Vec3 wantOut = vnorm(vsub(sp, center));           // radially outward
        s->reversed = (vdot(nrm, wantOut) < 0.0);
    }
    f->surface = s;
    f->paramTri = false;
    f->u0 = 0.0; f->u1 = 0.5 * kPi;   // theta
    f->v0 = 0.0; f->v1 = 0.5 * kPi;   // phi (phi=0 == pole == V0)
    return f;
}

} // namespace

AnalyticChainFilletResult filletSolidStraightEdgesAnalytic(
    TopologyBuilder& tb, const Solid& src,
    const std::vector<std::uint32_t>& edgeIds, double R) {
    AnalyticChainFilletResult out;
    auto bad = [&](const char* why) { out.ok = false; out.solid = nullptr; out.reason = why; return out; };
    if (!(R > 0.0) || !std::isfinite(R)) return bad("fillet radius R must be positive and finite");
    if (src.shells.empty() || src.shells[0] == nullptr) return bad("solid has no shell");
    if (edgeIds.empty()) return bad("no edges requested");

    std::vector<Edge*> allEdges = enumerateSolidStraightEdges(src);
    if (allEdges.empty()) return bad("solid has no enumerable edges");

    // Dedup + range-check the requested ids.
    std::vector<std::uint32_t> ids;
    for (std::uint32_t id : edgeIds) {
        if (id >= allEdges.size()) return bad("edgeId out of range for this solid's edge enumeration");
        if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
    }

    // Per requested edge: resolve adjacent faces, validate the single-edge scope
    // (straight / convex / orthogonal-planar), compute the rolling-ball contact.
    struct EdgeBlend {
        std::uint32_t id = 0;
        Edge* E = nullptr;
        Face* FA = nullptr; Face* FB = nullptr;
        Vertex* V0 = nullptr; Vertex* V1 = nullptr;
        Vec3 nA{}, nB{}, e{};
        double edgeLen = 0.0;
        Vec3 A0{}, A1{}, TA0{}, TB0{}, TA1{}, TB1{};
        double sb0 = 0.0, sb1 = 0.0;     // set-back at the V0 / V1 ends (R at a shared corner)
    };
    std::vector<EdgeBlend> blends;
    blends.reserve(ids.size());
    for (std::uint32_t id : ids) {
        Edge* E = allEdges[id];
        EdgeBlend b; b.id = id; b.E = E;
        if (!E->coedgeA || !E->coedgeB) return bad("a requested edge is not shared by two coedges (open/non-manifold)");
        if (!E->coedgeA->loop || !E->coedgeB->loop) return bad("a requested edge coedge has no loop");
        b.FA = E->coedgeA->loop->face;
        b.FB = E->coedgeB->loop->face;
        if (!b.FA || !b.FB || b.FA == b.FB) return bad("could not resolve two distinct adjacent faces for a requested edge");
        if (!b.FA->surface || b.FA->surface->kind != SurfaceKind::Plane ||
            !b.FB->surface || b.FB->surface->kind != SurfaceKind::Plane)
            return bad("a requested edge's adjacent face is not PLANAR (curved-face fillet is a follow-up)");
        if (!b.FA->innerLoops.empty() || !b.FB->innerLoops.empty())
            return bad("a requested edge's adjacent face has inner (hole) loops (holed-face re-trim is a follow-up)");
        b.V0 = E->start; b.V1 = E->end;
        const Vec3 P0 = P2V(b.V0->point), P1 = P2V(b.V1->point);
        Vec3 e = vsub(P1, P0);
        b.edgeLen = vlen(e);
        if (!(b.edgeLen > 0.0)) return bad("a requested edge is degenerate (zero length)");
        b.e = vscale(e, 1.0 / b.edgeLen);
        if (!(R < b.edgeLen)) return bad("fillet radius R must be < every requested edge's length");
        b.nA = vnorm(ringNormal(outerRingVerts(b.FA)));
        b.nB = vnorm(ringNormal(outerRingVerts(b.FB)));
        if (std::fabs(vdot(b.nA, b.nB)) > 1e-7)
            return bad("a requested edge's adjacent faces are not orthogonal (only 90-degree convex straight edges in scope)");
        Coedge* cA = (E->coedgeA->loop->face == b.FA) ? E->coedgeA : E->coedgeB;
        const Vec3 dA = vnorm(vsub(P2V(cA->destVertex()->point), P2V(cA->originVertex()->point)));
        const Vec3 iA = vnorm(vcross(b.nA, dA));
        if (!(vdot(iA, b.nB) < -1e-7))
            return bad("a requested edge is concave (reflex) or tangent — convex-only in this increment");
        const Vec3 iAn = vscale(b.nA, -1.0), iBn = vscale(b.nB, -1.0);
        b.A0 = vadd(P0, vadd(vscale(iAn, R), vscale(iBn, R)));
        b.A1 = vadd(b.A0, vscale(b.e, b.edgeLen));
        b.TA0 = vadd(b.A0, vscale(b.nA, R)); b.TB0 = vadd(b.A0, vscale(b.nB, R));
        b.TA1 = vadd(b.A1, vscale(b.nA, R)); b.TB1 = vadd(b.A1, vscale(b.nB, R));
        blends.push_back(b);
    }

    // Vertex -> requested blends touching it (an endpoint). A vertex touched by >= 2
    // requested edges is a SHARED corner (the vertex-blend follow-up).
    std::unordered_map<Vertex*, std::vector<int>> vtxBlends;
    for (int k = 0; k < static_cast<int>(blends.size()); ++k) {
        vtxBlends[blends[k].V0].push_back(k);
        vtxBlends[blends[k].V1].push_back(k);
    }
    out.filletedEdgeCount = static_cast<int>(blends.size());
    out.radius = R;

    // -------- classify every SHARED vertex (>= 2 meeting fillets) ----------------
    // The supported shared vertex is the ORTHOGONAL TRIHEDRAL CORNER: exactly three
    // meeting edges whose six adjacent faces reduce to three DISTINCT faces (each
    // shared by two of the three edges) with mutually-orthogonal outward normals (a
    // convex box corner). Such a corner is closed by a spherical octant; the three
    // meeting cylinders are SET BACK by R there. ANY other shared-vertex config (two
    // edges, four+, non-trihedral / non-orthogonal) is the honest follow-up boundary:
    // it is reported in unblendedCorners and the whole op refuses (mesh-bridge).
    struct Corner {
        Vertex* v = nullptr;
        Vec3 center{};            // sphere centre = v + R*(sum of the 3 inward normals)
        Vec3 m0{}, m1{}, m2{};    // the 3 distinct face OUTWARD normals
    };
    std::vector<Corner> corners;
    std::unordered_map<Vertex*, int> cornerOf;       // shared vertex -> index in `corners`

    bool anyUnsupported = false;
    for (const auto& kv : vtxBlends) {
        if (kv.second.size() < 2) continue;
        Vertex* v = kv.first;
        const std::vector<int>& bs = kv.second;
        bool supported = false;
        Corner c; c.v = v;
        if (bs.size() == 3) {
            // Collect the distinct adjacent faces + their normals; each must appear
            // in exactly two of the three edges.
            struct FN { Face* f; Vec3 n; int count; };
            std::vector<FN> fs;
            auto addF = [&](Face* f, const Vec3& n) {
                for (auto& x : fs) if (x.f == f) { ++x.count; return; }
                fs.push_back({f, n, 1});
            };
            for (int k : bs) { addF(blends[k].FA, blends[k].nA); addF(blends[k].FB, blends[k].nB); }
            if (fs.size() == 3 && fs[0].count == 2 && fs[1].count == 2 && fs[2].count == 2) {
                const Vec3 a = fs[0].n, b2 = fs[1].n, c2 = fs[2].n;
                if (std::fabs(vdot(a, b2)) <= 1e-7 && std::fabs(vdot(b2, c2)) <= 1e-7 &&
                    std::fabs(vdot(a, c2)) <= 1e-7) {
                    // Convex corner: the inward step -R*(a+b2+c2) from v must land R
                    // inside each plane — already guaranteed by the per-edge convex
                    // test. center = v + R*(inward sum) = v - R*(sum of outward).
                    c.m0 = a; c.m1 = b2; c.m2 = c2;
                    c.center = vsub(P2V(v->point), vscale(vadd(vadd(a, b2), c2), R));
                    supported = true;
                }
            }
        }
        if (supported) {
            cornerOf[v] = static_cast<int>(corners.size());
            corners.push_back(c);
        } else {
            anyUnsupported = true;
            UnblendedCorner uc;
            uc.position = P2V(v->point);
            uc.cornerIndex = -1;                  // topology-sourced: no box-corner index
            uc.edgeA = static_cast<int>(blends[bs[0]].id);
            uc.edgeB = static_cast<int>(blends[bs[1]].id);
            uc.meetingFilletCount = static_cast<int>(bs.size());
            out.unblendedCorners.push_back(uc);
        }
    }
    if (anyUnsupported) {
        out.ok = false;
        out.solid = nullptr;
        out.reason = "partial (honest): a shared VERTEX is not the supported orthogonal "
                     "trihedral (3-edge box) corner — the 2-edge spherical-lune / 4+-edge / "
                     "non-orthogonal vertex blend is a documented follow-up, so it is reported "
                     "in unblendedCorners and NOT fabricated; the caller falls back to the "
                     "mesh-bridge for this selection";
        return out;
    }

    // -------- set-back: a corner end pulls its cylinder back by R --------------
    auto isCornerV = [&](Vertex* v) { return cornerOf.count(v) > 0; };
    for (EdgeBlend& b : blends) {
        b.sb0 = isCornerV(b.V0) ? R : 0.0;
        b.sb1 = isCornerV(b.V1) ? R : 0.0;
        if (!(b.edgeLen - b.sb0 - b.sb1 > 1e-9))
            return bad("a requested edge is too short for the corner set-backs (radius too large "
                       "for the shared-vertex spacing)");
    }

    // -------- re-emit every face, re-trimmed for all the edges that touch it -----
    auto isAdjFace = [&](const Face* F, int k, bool& isA) {
        if (F == blends[k].FA) { isA = true;  return true; }
        if (F == blends[k].FB) { isA = false; return true; }
        return false;
    };

    std::vector<Face*> frags;
    for (Face* F : src.shells[0]->faces) {
        const std::vector<Vertex*> ring = outerRingVerts(F);
        if (ring.empty()) return bad("a face has an empty outer loop");
        const int n = static_cast<int>(ring.size());

        bool touched = false;
        for (Vertex* v : ring) if (vtxBlends.count(v)) { touched = true; break; }
        if (!touched) { frags.push_back(copyFaceFragment(tb, F)); continue; }

        // A re-trimmed face must be planar + hole-free (adjacent or perpendicular end).
        if (!F->surface || F->surface->kind != SurfaceKind::Plane || !F->innerLoops.empty())
            return bad("a re-trimmed face is non-planar or holed (curved/holed fillet is a follow-up)");
        const Vec3 fn = vnorm(ringNormal(ring));    // outward (CCW-from-outside loop)

        std::vector<Vec3> mod;
        mod.reserve(static_cast<std::size_t>(n) + 8);
        for (int slot = 0; slot < n; ++slot) {
            Vertex* v = ring[slot];
            auto cit = cornerOf.find(v);
            if (cit != cornerOf.end()) {
                // SHARED TRIHEDRAL CORNER: F is one of the corner's three faces, so it
                // is ADJACENT to two of the meeting edges and the PERPENDICULAR (set-
                // back) end of the third. The single sharp vertex collapses to ONE
                // inset point = the sphere's tangent point on F = center + R*fn (where
                // the two adjacent edges' tangent lines on F meet); the third (set-back)
                // edge contributes NOTHING here — the spherical octant rounds it.
                mod.push_back(vadd(corners[cit->second].center, vscale(fn, R)));
                continue;
            }
            auto it = vtxBlends.find(v);
            if (it == vtxBlends.end()) { mod.push_back(P2V(v->point)); continue; }
            const int k = it->second.front();           // vertex-disjoint -> exactly one
            const EdgeBlend& b = blends[k];
            const bool isV1 = (b.V1 == v);
            bool isA = false;
            if (isAdjFace(F, k, isA)) {
                // ADJACENT face: pull the sharp corner back to its tangent contact.
                const Vec3 tp = isA ? (isV1 ? b.TA1 : b.TA0)
                                    : (isV1 ? b.TB1 : b.TB0);
                mod.push_back(tp);
            } else {
                // PERPENDICULAR END face: validate, round the corner, cap the quarter.
                if (!(std::fabs(vdot(fn, b.e)) > 1.0 - 1e-6))
                    return bad("an edge endpoint meets a face that is neither adjacent nor "
                               "perpendicular to the edge (mitre/oblique end is a follow-up)");
                const Vec3 center = isV1 ? b.A1 : b.A0;
                const Vec3 Ta = isV1 ? b.TA1 : b.TA0;    // tangent on FA at this end
                const Vec3 Tb = isV1 ? b.TB1 : b.TB0;    // tangent on FB at this end
                const Vec3 prevPos = P2V(ring[(slot - 1 + n) % n]->point);
                const double dTa = vlen(vsub(Ta, prevPos)), dTb = vlen(vsub(Tb, prevPos));
                const Vec3 nearPrev = (dTa <= dTb) ? Ta : Tb;
                const Vec3 nearNext = (dTa <= dTb) ? Tb : Ta;
                mod.push_back(nearPrev);
                mod.push_back(center);
                mod.push_back(nearNext);
                frags.push_back(emitQuarterDisk(tb, center, R, b.nA, b.nB, b.e, fn));
            }
        }

        // Decompose the re-trimmed (possibly non-convex) planar polygon into CONVEX
        // triangles so the polygon-moment mass integral stays exact.
        std::vector<std::array<Vec3, 3>> tris = triangulatePlanarPolygon(mod, fn);
        if (tris.empty())
            return bad("a re-trimmed face could not be triangulated (degenerate/overlapping "
                       "re-trim — radius too large for this face?)");
        for (const auto& t : tris)
            frags.push_back(emitPlanarPolygon(tb, {t[0], t[1], t[2]}, fn));
    }

    // -------- one cylindrical blend patch per requested edge --------------------
    // A set-back end (shared trihedral corner) shortens the cylinder by R there; its
    // end cross-section then IS the adjacent spherical octant's quarter-arc (foot ==
    // sphere centre), so no quarter-disk cap is emitted at that end — the octant
    // closes it. A flush (non-corner) end is still capped by the perpendicular end
    // face's quarter-disk emitted in the face loop above.
    double removed = 0.0;
    for (const EdgeBlend& b : blends) {
        const Vec3 A0s = vadd(b.A0, vscale(b.e, b.sb0));     // near foot, advanced by set-back
        const Vec3 A1s = vsub(b.A1, vscale(b.e, b.sb1));     // far  foot, pulled in by set-back
        const double cylLen = b.edgeLen - b.sb0 - b.sb1;
        const Vec3 outward = vnorm(vadd(b.nA, b.nB));
        Face* cyl = emitCylinderPatch(tb, A0s, A1s, R, b.nA, b.nB, b.e, cylLen, outward, outward);
        frags.push_back(cyl);
        out.filletFaces.push_back(cyl);
        removed += (1.0 - kPi / 4.0) * R * R * cylLen;
    }

    // -------- one spherical octant per shared trihedral corner ------------------
    // Each corner removes (1 - pi/6) R^3 of material (the corner cube R^3 minus the
    // eighth-ball of radius R that remains).
    for (const Corner& c : corners) {
        Face* oct = emitSphereOctant(tb, c.center, R, c.m0, c.m1, c.m2);
        frags.push_back(oct);
        out.cornerFaces.push_back(oct);
        removed += (1.0 - kPi / 6.0) * R * R * R;
    }

    // -------- sew every fragment into one closed 2-manifold ----------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    out.solid = solid;
    out.removedVolume = removed;
    out.ok = sr.ok && sr.diagnosis.closed;
    out.reason = out.ok
        ? (corners.empty()
            ? "ok (analytic constant-radius rolling-ball fillet of MULTIPLE topology-sourced "
              "convex straight planar-planar edges, pairwise vertex-disjoint; watertight closed "
              "2-manifold; exact removed volume)"
            : "ok (analytic constant-radius rolling-ball fillet of MULTIPLE topology-sourced "
              "convex straight planar-planar edges WITH spherical-octant corner blends at the "
              "shared orthogonal trihedral vertices; watertight closed 2-manifold; exact volume)")
        : "multi-edge fillet assembly did not sew into a closed shell";
    return out;
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

// ===========================================================================
// CURVED-FACE fillet: the CONVEX CIRCULAR edge where a cylinder's CYLINDRICAL
// side (radius Rc, axis +Z, z in [0,H]) meets its FLAT TOP CAP (plane z=H).
//
// Because one contact face is a CYLINDER and the other a PLANE, the rolling-ball
// blend is a TORUS — the ball centre sweeps the SPINE circle of radius (Rc-R) at
// z = H-R, so the blend surface has tube (minor) radius r2 = R and ring (major)
// radius r1 = Rc-R. The two tangent contact circles (radius Rc at z=H-R on the
// wall; radius Rc-R at z=H on the cap) become the new trim boundaries.
//
// Assembly (axisymmetric, sewn from independent fragments like the L-block path):
// per angular segment k over [theta_k, theta_{k+1}] we emit four fragments —
//   * a WALL quad on the cylinder radius Rc, z in [0, H-R] (re-trimmed wall),
//   * a TORUS blend quad, theta in segment, phi in [0, pi/2]
//        (phi=0 -> radius Rc, z=H-R touches the wall; phi=pi/2 -> radius Rc-R,
//         z=H touches the cap), with its phi=0 and phi=pi/2 boundary edges bound
//        to their exact contact CIRCLES so the sewer welds them to the wall top
//        rim and the shrunk cap rim,
//   * a TOP-CAP sector (axis centre -> shrunk rim radius Rc-R at z=H), and
//   * a BOTTOM-CAP sector (axis centre -> rim radius Rc at z=0).
// All fragments are sewn into one closed genus-0 2-manifold.
//
// EXACT removed corner volume (revolved quarter-round, Pappus + 2nd radial moment):
//     removed = 2*pi*(Rc-R)*(1 - pi/4)*R^2 + (pi/3)*R^3
// so the filleted volume == pi*Rc^2*H - removed, measured EXACTLY by the analytic
// integrator (the torus patch via its analytic |S_u x S_v| quadrature).
// ===========================================================================
AnalyticTorusFilletResult filletCylinderTopEdgeAnalytic(TopologyBuilder& tb,
                                                        double Rc, double H, double R,
                                                        int nSeg) {
    AnalyticTorusFilletResult out;
    auto bad = [&](const char* why) { out.ok = false; out.reason = why; return out; };
    if (!(Rc > 0.0) || !std::isfinite(Rc)) return bad("cylinder radius Rc must be positive finite");
    if (!(H  > 0.0) || !std::isfinite(H )) return bad("cylinder height H must be positive finite");
    if (!(R  > 0.0) || !std::isfinite(R )) return bad("fillet radius R must be positive finite");
    if (!(R < Rc)) return bad("fillet radius R must be < Rc (the spine radius Rc-R must stay positive)");
    if (!(R < H )) return bad("fillet radius R must be < H (the wall re-trim must stay above z=0)");
    if (nSeg < 8)  return bad("nSeg must be >= 8 for a faithful revolution");

    const double ringR = Rc - R;          // torus major / spine-circle radius
    const double zSpine = H - R;           // spine-circle plane height
    const Vec3 ZP{0, 0, 1};

    // One SHARED torus surface for every blend segment (centre = spine plane centre).
    // S(theta,phi) = origin + (r1 + r2 cos phi)(cos th refDir + sin th binorm)
    //              + r2 sin phi * axis,  origin=(0,0,zSpine), r1=ringR, r2=R.
    // phi in [0,pi/2]: phi=0 -> radius Rc,z=zSpine (wall); phi=pi/2 -> radius ringR,z=H (cap).
    Surface* torus = tb.makeSurface();
    torus->kind = SurfaceKind::Torus;
    torus->origin = {0, 0, zSpine};
    torus->axis = {0, 0, 1};
    torus->refDir = {1, 0, 0};
    torus->r1 = ringR;   // major
    torus->r2 = R;       // minor (tube)
    {
        // Orient the stored normal OUTWARD (away from the spine circle): at the
        // arc midpoint (phi=pi/4) the geometric (Su x Sv) normal points radially-
        // outward+up; set `reversed` so it agrees with that outward direction.
        Vec3 sp, du, dv;
        torus->evaluateDeriv(0.0, 0.25 * kPi, sp, du, dv);   // theta=0, phi=pi/4
        Vec3 nrm = vnorm(vcross(du, dv));
        // outward at theta=0, phi=pi/4 has +x and +z components (away from spine).
        Vec3 wantOut = vnorm(Vec3{std::cos(0.25 * kPi), 0.0, std::sin(0.25 * kPi)});
        torus->reversed = (vdot(nrm, wantOut) < 0.0);
    }

    // One SHARED cylinder surface for the re-trimmed wall (radius Rc, z in [0,zSpine]).
    Surface* wall = tb.makeSurface();
    wall->kind = SurfaceKind::Cylinder;
    wall->origin = {0, 0, 0};
    wall->axis = {0, 0, 1};
    wall->refDir = {1, 0, 0};
    wall->r1 = Rc;
    wall->param = zSpine;
    {
        Vec3 sp, du, dv;
        wall->evaluateDeriv(0.0, 0.5 * zSpine, sp, du, dv);
        Vec3 nrm = vnorm(vcross(du, dv));
        wall->reversed = (vdot(nrm, Vec3{1, 0, 0}) < 0.0);   // outward == +radial
    }

    std::vector<Face*> frags;

    // Per-angular-segment fragments. Each segment owns its own vertices; the sewer
    // welds coincident boundaries (the arc edges are bound to their exact circles).
    auto ringPt = [&](double r, double th, double z) -> Vec3 {
        return Vec3{r * std::cos(th), r * std::sin(th), z};
    };

    // Bind the coedge whose endpoints are {va,vb} (an arc at constant z on the
    // circle of radius `cr` in the plane z=cz) to its EXACT Circle curve, in the
    // coedge's start->end sense. The circle uses the GLOBAL +X refDir so its angle
    // parameter equals the world azimuth (the sewer maps f in [0,1] over [t0,t1]),
    // and t0/t1 are the world azimuths of the start/end vertices so the sampled
    // mid-points of two coincident arcs (from neighbouring fragments) agree.
    auto azim = [](const Vec3& p) { return std::atan2(p.y, p.x); };
    auto bindArc = [&](Coedge* ce, Vertex* va, Vertex* vb,
                       double cr, double cz, double tA, double tB) {
        Vertex* o = ce->originVertex();
        const bool startIsA = (o == va);
        double t0c = startIsA ? tA : tB;
        double t1c = startIsA ? tB : tA;
        // Keep the parameter monotone in the start->end direction; the two
        // neighbouring segments share azimuths exactly so no wrap arises within
        // a single sub-2*pi segment.
        ce->edge->curve = tb.makeCurve(
            Curve::makeCircle(Vec3{0, 0, cz}, Vec3{1, 0, 0}, ZP, cr, t0c, t1c));
        (void)va; (void)vb;
    };

    for (int k = 0; k < nSeg; ++k) {
        const double t0 = 2.0 * kPi * k / nSeg;
        const double t1 = 2.0 * kPi * (k + 1) / nSeg;

        // --- WALL quad (cylinder Rc, z in [0,zSpine]), outward radial ----------
        {
            Vertex* v00 = tb.makeVertex(V2P(ringPt(Rc, t0, 0.0)));
            Vertex* v10 = tb.makeVertex(V2P(ringPt(Rc, t1, 0.0)));
            Vertex* v11 = tb.makeVertex(V2P(ringPt(Rc, t1, zSpine)));
            Vertex* v01 = tb.makeVertex(V2P(ringPt(Rc, t0, zSpine)));
            std::vector<Vertex*> ring = {v00, v10, v11, v01};
            Face* f = tb.makeFace();
            tb.addOuterLoopToFace(f, ring);
            // Bind the two z-constant arc edges (v00-v10 at z=0; v01-v11 at z=zSpine).
            Coedge* ce = f->outerLoop->first;
            for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
                Vertex* o = ce->originVertex(); Vertex* d = ce->destVertex();
                auto isE = [&](Vertex* a, Vertex* b){ return (o==a&&d==b)||(o==b&&d==a); };
                if (isE(v00, v10))      bindArc(ce, v00, v10, Rc, 0.0,    t0, t1);
                else if (isE(v01, v11)) bindArc(ce, v01, v11, Rc, zSpine, t0, t1);
                ce = ce->next;
            }
            f->surface = wall;
            f->paramTri = false;
            f->u0 = t0; f->u1 = t1; f->v0 = 0.0; f->v1 = zSpine;
            f->vertexUV = {{t0,0.0},{t1,0.0},{t1,zSpine},{t0,zSpine}};
            frags.push_back(f);
        }

        // --- TORUS blend quad (theta in [t0,t1], phi in [0,pi/2]) --------------
        {
            // phi=0 -> radius Rc, z=zSpine ; phi=pi/2 -> radius ringR, z=H.
            Vertex* p00 = tb.makeVertex(V2P(ringPt(Rc,    t0, zSpine))); // (t0,phi0)
            Vertex* p10 = tb.makeVertex(V2P(ringPt(Rc,    t1, zSpine))); // (t1,phi0)
            Vertex* p11 = tb.makeVertex(V2P(ringPt(ringR, t1, H)));      // (t1,phi1)
            Vertex* p01 = tb.makeVertex(V2P(ringPt(ringR, t0, H)));      // (t0,phi1)
            std::vector<Vertex*> ring = {p00, p10, p11, p01};
            Face* f = tb.makeFace();
            tb.addOuterLoopToFace(f, ring);
            // Bind the two phi-constant arc edges to their exact contact circles so
            // they weld to the wall top rim (phi=0, radius Rc, z=zSpine) and to the
            // shrunk top-cap rim (phi=pi/2, radius ringR, z=H).
            Coedge* ce = f->outerLoop->first;
            for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
                Vertex* o = ce->originVertex(); Vertex* d = ce->destVertex();
                auto isE = [&](Vertex* a, Vertex* b){ return (o==a&&d==b)||(o==b&&d==a); };
                if (isE(p00, p10))      bindArc(ce, p00, p10, Rc,    zSpine, t0, t1);
                else if (isE(p01, p11)) bindArc(ce, p01, p11, ringR, H,      t0, t1);
                ce = ce->next;
            }
            f->surface = torus;
            f->paramTri = false;
            f->u0 = t0; f->u1 = t1; f->v0 = 0.0; f->v1 = 0.5 * kPi;  // phi in [0,pi/2]
            f->vertexUV = {{t0,0.0},{t1,0.0},{t1,0.5*kPi},{t0,0.5*kPi}};
            frags.push_back(f);
            out.blendFaces.push_back(f);
            if (out.filletFace == nullptr) out.filletFace = f;
        }

        // --- TOP-CAP sector (axis centre -> shrunk rim radius ringR at z=H) ----
        // Outward +Z. Ring: centre -> rim@t0 -> (arc) -> rim@t1. To mate the torus
        // cap rim (which welds at phi=pi/2), the cap's outer arc is the SAME circle.
        {
            const Vec3 ctr{0, 0, H};
            Vertex* vc = tb.makeVertex(V2P(ctr));
            Vertex* vA = tb.makeVertex(V2P(ringPt(ringR, t0, H)));
            Vertex* vB = tb.makeVertex(V2P(ringPt(ringR, t1, H)));
            std::vector<Vertex*> ring = {vc, vA, vB};
            orientRingCCW(ring, ZP);
            Face* f = tb.makeFace();
            tb.addOuterLoopToFace(f, ring);
            Coedge* ce = f->outerLoop->first;
            for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
                Vertex* o = ce->originVertex(); Vertex* d = ce->destVertex();
                if ((o==vA&&d==vB)||(o==vB&&d==vA)) bindArc(ce, vA, vB, ringR, H, t0, t1);
                ce = ce->next;
            }
            Surface* sd = tb.makeSurface();
            sd->kind = SurfaceKind::Plane;
            sd->origin = ctr;
            sd->refDir = {1, 0, 0};
            sd->axis = {0, 0, 1};
            sd->reversed = (vdot(sd->axis, ZP) < 0.0);
            sd->isDisk = true;
            sd->diskOuter = ringR;
            sd->diskInner = 0.0;
            f->surface = sd;
            f->u0 = t0; f->u1 = t1;
            f->v0 = 0.0; f->v1 = ringR;
            frags.push_back(f);
        }

        // --- BOTTOM-CAP sector (axis centre -> rim radius Rc at z=0) -----------
        // Outward -Z. CCW as seen from below.
        {
            const Vec3 ctr{0, 0, 0};
            Vertex* vc = tb.makeVertex(V2P(ctr));
            Vertex* vA = tb.makeVertex(V2P(ringPt(Rc, t0, 0.0)));
            Vertex* vB = tb.makeVertex(V2P(ringPt(Rc, t1, 0.0)));
            std::vector<Vertex*> ring = {vc, vA, vB};
            orientRingCCW(ring, Vec3{0, 0, -1});
            Face* f = tb.makeFace();
            tb.addOuterLoopToFace(f, ring);
            Coedge* ce = f->outerLoop->first;
            for (std::size_t s = 0; s < f->outerLoop->coedgeCount; ++s) {
                Vertex* o = ce->originVertex(); Vertex* d = ce->destVertex();
                if ((o==vA&&d==vB)||(o==vB&&d==vA)) bindArc(ce, vA, vB, Rc, 0.0, t0, t1);
                ce = ce->next;
            }
            Surface* sd = tb.makeSurface();
            sd->kind = SurfaceKind::Plane;
            sd->origin = ctr;
            sd->refDir = {1, 0, 0};
            sd->axis = {0, 0, 1};
            sd->reversed = (vdot(sd->axis, Vec3{0,0,-1}) < 0.0);
            sd->isDisk = true;
            sd->diskOuter = Rc;
            sd->diskInner = 0.0;
            f->surface = sd;
            f->u0 = t0; f->u1 = t1;
            f->v0 = 0.0; f->v1 = Rc;
            frags.push_back(f);
        }
    }
    (void)azim;

    // -- sew all fragments into one closed shell ------------------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    out.solid = solid;
    out.radius = R;
    out.tubeRadius = R;
    out.ringRadius = ringR;
    out.spineCenter = Vec3{0, 0, zSpine};
    out.cylinderRadius = Rc;
    out.height = H;
    // EXACT toroidal-corner removed volume (derived in the header):
    //   2*pi*(Rc-R)*(1 - pi/4)*R^2  +  (pi/3)*R^3.
    out.removedVolume = 2.0 * kPi * ringR * (1.0 - kPi / 4.0) * R * R
                      + (kPi / 3.0) * R * R * R;
    const bool closed = sr.ok && sr.diagnosis.closed;
    out.ok = closed;
    out.reason = out.ok
        ? "ok (analytic constant-radius rolling-ball fillet, CONVEX circular edge "
          "between a PLANAR cap and a CYLINDRICAL wall; blend surface is a TORUS of "
          "tube radius R and ring radius Rc-R; watertight closed genus-0 2-manifold)"
        : "cylinder-top fillet assembly did not sew into a closed shell";
    return out;
}

// ===========================================================================
// VARIABLE-RADIUS fillet: a LINEAR radius law R(t) = R0 + (R1-R0)*(t/L) along a
// CONVEX STRAIGHT planar-planar box edge (length L).
//
// THE VARYING ROLLING BALL. The spine is still the edge line, but the ball radius
// varies linearly. At station t in [0,L] the ball of radius R(t) sits tangent to
// both planes from the material side, so its centre (axis foot) is
//     F(t) = P0 + t*e + R(t)*(-nA) + R(t)*(-nB).
// The blend cross-section at t is the quarter circle of radius R(t) centred at
// F(t), running from the +nA radial (contact on face A) to the +nB radial (contact
// on face B). Because R(t) AND F(t) are both LINEAR in t, the swept surface is
// represented EXACTLY by a rational NURBS:
//   * a quarter circle is the degree-2 rational Bezier with control points
//       Q0 = F + R*nA          (weight 1),
//       Q1 = F + R*(nA + nB)    (weight cos45 = sqrt(2)/2),   [the square corner]
//       Q2 = F + R*nB          (weight 1);
//   * each Qi(t) is linear in t (F linear, R linear), so V is degree 1 (2 rows).
// Hence degreeU=2 (arc) x degreeV=1 (edge), weights {1, s2/2, 1} on both rows — an
// EXACT sweep, not a tessellation. Mass is measured by the analytic Nurbs
// |S_u x S_v| quadrature.
//
// RE-TRIM. The tangent lines are now NON-PARALLEL: on face A the line runs from
// F(0)+R0*nA to F(L)+R1*nA; on face B from F(0)+R0*nB to F(L)+R1*nB. Each adjacent
// face becomes a TRAPEZOID (the box face minus the varying-width strip). The two
// end caps gain a quarter-disk of radius R0 (t=0) and R1 (t=L). All fragments are
// sewn into one closed 2-manifold.
//
// REMOVED VOLUME (exact). Per unit edge length the removed cross-section is
// (1 - pi/4) R(t)^2, so
//     removed = (1 - pi/4) INT_0^L R(t)^2 dt
//             = (1 - pi/4) * L * (R0^2 + R0*R1 + R1^2) / 3
// (closed form of INT (R0 + (R1-R0)t/L)^2 dt over [0,L]).
// ===========================================================================
namespace {

constexpr double kSqrt2Over2 = 0.70710678118654752440;  // cos(45 deg), quarter-circle mid weight

// Build the EXACT variable-radius quarter-arc-sweep blend as a rational NURBS face.
// The arc runs from +dirA to +dirB; centre F(t) and radius R(t) are sampled at the
// two ends (t=0 -> F0,R0 ; t=L -> F1,R1) and the surface is the linear loft between
// the two quarter-circle Bezier rows. Boundary edges are bound to their exact
// curves so the sewer welds them: the two end arcs to their Circle curves, the two
// arc-end rails (theta=0 and theta=pi/2) to their Line curves.
Face* emitVariableArcSweep(TopologyBuilder& tb,
                           const Vec3& F0, double R0, const Vec3& F1, double R1,
                           const Vec3& dirA, const Vec3& dirB, const Vec3& edgeDir,
                           const Vec3& surfNormalDir, const Vec3& ringOrient) {
    // Quarter-circle Bezier control rows at each end.
    const Vec3 Q0_0 = vadd(F0, vscale(dirA, R0));               // (theta0, t0)
    const Vec3 Q1_0 = vadd(F0, vscale(vadd(dirA, dirB), R0));   // (square corner, t0)
    const Vec3 Q2_0 = vadd(F0, vscale(dirB, R0));               // (theta pi/2, t0)
    const Vec3 Q0_1 = vadd(F1, vscale(dirA, R1));               // (theta0, t1)
    const Vec3 Q1_1 = vadd(F1, vscale(vadd(dirA, dirB), R1));   // (square corner, t1)
    const Vec3 Q2_1 = vadd(F1, vscale(dirB, R1));               // (theta pi/2, t1)

    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Nurbs;
    NurbsSurface& ns = s->nurbs;
    ns.degreeU = 2;   // arc (theta)
    ns.degreeV = 1;   // edge (t)
    // control[i][j]: i over U (theta, 0..2), j over V (t, 0..1).
    ns.control = {
        { Q0_0, Q0_1 },
        { Q1_0, Q1_1 },
        { Q2_0, Q2_1 },
    };
    ns.weights = {
        { 1.0,          1.0          },
        { kSqrt2Over2,  kSqrt2Over2  },
        { 1.0,          1.0          },
    };
    ns.knotsU = {0.0, 0.0, 0.0, 1.0, 1.0, 1.0};  // clamped degree-2 Bezier
    ns.knotsV = {0.0, 0.0, 1.0, 1.0};            // clamped degree-1

    // Orient the stored normal so it points OUT of the solid. For a CONVEX valley
    // the outward direction is the +radial bisector (across the valley).
    {
        Vec3 sp, du, dv;
        s->evaluateDeriv(0.5, 0.5, sp, du, dv);   // mid arc, mid edge
        Vec3 nrm = vnorm(vcross(du, dv));
        s->reversed = (vdot(nrm, surfNormalDir) < 0.0);
    }

    // The four ring corners (NURBS domain corners) in 3D.
    Vertex* vA0 = tb.makeVertex(V2P(Q0_0));   // (theta0, t0) contact on A at t0
    Vertex* vB0 = tb.makeVertex(V2P(Q2_0));   // (thetaPi/2, t0) contact on B at t0
    Vertex* vB1 = tb.makeVertex(V2P(Q2_1));   // (thetaPi/2, t1) contact on B at t1
    Vertex* vA1 = tb.makeVertex(V2P(Q0_1));   // (theta0, t1) contact on A at t1

    // Ring walk A0 -> B0 (start arc) -> B1 (rail on B) -> A1 (end arc) -> A0.
    std::vector<Vertex*> ring = {vA0, vB0, vB1, vA1};
    orientRingCCW(ring, ringOrient);
    Face* f = tb.makeFace();
    tb.addOuterLoopToFace(f, ring);

    // Bind boundary edges to their exact curves so the sewer welds them.
    Coedge* ce = f->outerLoop->first;
    for (std::size_t k = 0; k < f->outerLoop->coedgeCount; ++k) {
        Vertex* o = ce->originVertex();
        Vertex* d = ce->destVertex();
        auto is = [&](Vertex* a, Vertex* b){ return (o==a&&d==b)||(o==b&&d==a); };
        if (is(vA0, vB0)) {            // start quarter arc, radius R0, centre F0
            if (o == vA0) ce->edge->curve = tb.makeCurve(quarterArc(F0, R0, dirA, dirB));
            else          ce->edge->curve = tb.makeCurve(quarterArc(F0, R0, dirB, dirA));
        } else if (is(vA1, vB1)) {     // end quarter arc, radius R1, centre F1
            if (o == vA1) ce->edge->curve = tb.makeCurve(quarterArc(F1, R1, dirA, dirB));
            else          ce->edge->curve = tb.makeCurve(quarterArc(F1, R1, dirB, dirA));
        } else if (is(vA0, vA1)) {     // rail on face A (theta=0): straight line
            ce->edge->curve = tb.makeCurve(Curve::makeLine(P2V(o->point), P2V(d->point)));
        } else if (is(vB0, vB1)) {     // rail on face B (theta=pi/2): straight line
            ce->edge->curve = tb.makeCurve(Curve::makeLine(P2V(o->point), P2V(d->point)));
        }
        ce = ce->next;
    }

    f->surface = s;
    f->paramTri = false;
    f->u0 = 0.0; f->u1 = 1.0;   // NURBS domain (theta normalised)
    f->v0 = 0.0; f->v1 = 1.0;   // NURBS domain (edge normalised)
    (void)edgeDir;
    return f;
}

} // namespace

AnalyticVariableFilletResult filletBoxEdgeVariable(TopologyBuilder& tb,
                                                   double L, double R0, double R1,
                                                   int edgeIndex) {
    AnalyticVariableFilletResult res;
    auto bail = [&](const char* why) { res.ok = false; res.reason = why; return res; };

    if (!(L > 0.0) || !std::isfinite(L)) return bail("box edge length L must be positive finite");
    if (!(R0 > 0.0) || !std::isfinite(R0)) return bail("start radius R0 must be positive finite");
    if (!(R1 > 0.0) || !std::isfinite(R1)) return bail("end radius R1 must be positive finite");
    if (edgeIndex < 0 || edgeIndex > 11) return bail("edgeIndex out of range [0,11]");
    if (!(R0 < L) || !(R1 < L)) return bail("radii R0,R1 must be < L (tangent line would overflow the face)");

    const std::vector<Vec3> C = boxCorners(L);
    const BoxEdge be = boxEdge(edgeIndex);
    const Vec3 P0 = C[be.c0];
    const Vec3 P1 = C[be.c1];
    Vec3 e = vsub(P1, P0);
    const double edgeLen = vlen(e);
    if (!(edgeLen > 0.0)) return bail("degenerate (zero-length) edge");
    e = vscale(e, 1.0 / edgeLen);

    const Vec3 nA = vnorm(be.nA);
    const Vec3 nB = vnorm(be.nB);
    const double ndot = vdot(nA, nB);
    if (std::fabs(ndot) > 1e-9)
        return bail("adjacent face normals are not orthogonal (only the 90-degree "
                    "convex box edge is in this increment's scope)");

    // Rolling-ball spine (axis feet) at the two ends, with the linear radius law.
    // F(t) = P0 + t*e + R(t)*(-nA) + R(t)*(-nB).
    const Vec3 iAB = vscale(vadd(nA, nB), -1.0);
    const Vec3 F0 = vadd(P0, vscale(iAB, R0));              // axis foot @ t=0
    const Vec3 F1 = vadd(vadd(P0, vscale(e, edgeLen)),
                         vscale(iAB, R1));                  // axis foot @ t=L
    // Tangent contacts at each end.
    const Vec3 TA0 = vadd(F0, vscale(nA, R0));   // contact on face A @ t=0
    const Vec3 TB0 = vadd(F0, vscale(nB, R0));   // contact on face B @ t=0
    const Vec3 TA1 = vadd(F1, vscale(nA, R1));   // contact on face A @ t=L
    const Vec3 TB1 = vadd(F1, vscale(nB, R1));   // contact on face B @ t=L

    // The convex-valley outward direction (and the ring/disk winding side).
    const Vec3 bisector = vnorm(vadd(nA, nB));

    std::vector<Face*> frags;

    // -- the two adjacent faces, re-trimmed to the (non-parallel) tangent lines --
    // Each is a TRAPEZOID. Walk the original box face's ring, replacing the two
    // sharp-edge corners (be.c0, be.c1) with the matching tangent contacts.
    for (const auto& d : kBoxFaces) {
        const Vec3 fn = vnorm(d.normal);
        const bool isFaceA = veq(fn, nA);
        const bool isFaceB = veq(fn, nB);
        int sharpCount = 0;
        for (int k = 0; k < 4; ++k)
            if (d.idx[k] == be.c0 || d.idx[k] == be.c1) ++sharpCount;

        if (sharpCount == 0) {
            // Untouched original quad face.
            frags.push_back(emitPlanarPolygon(tb,
                {C[d.idx[0]], C[d.idx[1]], C[d.idx[2]], C[d.idx[3]]}, fn));
            continue;
        }
        if (isFaceA || isFaceB) {
            std::vector<Vec3> ring;
            for (int k = 0; k < 4; ++k) {
                const int ci = d.idx[k];
                if (ci == be.c0)      ring.push_back(isFaceA ? TA0 : TB0);
                else if (ci == be.c1) ring.push_back(isFaceA ? TA1 : TB1);
                else                  ring.push_back(C[ci]);
            }
            Face* f = emitPlanarPolygon(tb, ring, fn);
            frags.push_back(f);
            if (isFaceA) res.trimmedFaceA = f; else res.trimmedFaceB = f;
            continue;
        }

        // PERPENDICULAR END FACE (the cap holding exactly one sharp corner).
        // Re-trim into an L-polygon (square minus the R x R corner) triangulated as a
        // fan from the axis foot + a quarter-disk cap of radius R(end). The cap radius
        // is R0 at the be.c0 end and R1 at the be.c1 end.
        int sharpAt = -1, sharpCorner = -1;
        for (int k = 0; k < 4; ++k)
            if (d.idx[k] == be.c0 || d.idx[k] == be.c1) { sharpAt = k; sharpCorner = d.idx[k]; }
        const bool atStart = (sharpCorner == be.c0);
        const double Rend = atStart ? R0 : R1;
        const Vec3 center = atStart ? F0 : F1;
        const Vec3 tA = atStart ? TA0 : TA1;
        const Vec3 tB = atStart ? TB0 : TB1;

        const int prevCi = d.idx[(sharpAt + 3) % 4];
        const Vec3 prevPos = C[prevCi];
        const double dA = vlen(vsub(tA, prevPos));
        const double dB = vlen(vsub(tB, prevPos));
        const Vec3 nearPrev = (dA <= dB) ? tA : tB;
        const Vec3 nearNext = (dA <= dB) ? tB : tA;

        // L-polygon ring: box ring with the sharp corner replaced by [nearPrev, center, nearNext].
        std::vector<Vec3> Lring;
        for (int k = 0; k < 4; ++k) {
            if (k == sharpAt) { Lring.push_back(nearPrev); Lring.push_back(center); Lring.push_back(nearNext); }
            else              { Lring.push_back(C[d.idx[k]]); }
        }
        // Fan the (non-convex) L-polygon from `center` (it is star-shaped from the
        // notch corner) into convex triangles, one planar face each.
        std::size_t ci = 0;
        for (std::size_t k = 0; k < Lring.size(); ++k)
            if (veq(Lring[k], center)) { ci = k; break; }
        const std::size_t Ln = Lring.size();
        for (std::size_t step = 1; step + 1 < Ln; ++step) {
            const Vec3 a = center;
            const Vec3 b = Lring[(ci + step) % Ln];
            const Vec3 c = Lring[(ci + step + 1) % Ln];
            frags.push_back(emitPlanarPolygon(tb, {a, b, c}, fn));
        }
        // Quarter-disk cap of radius Rend (radial dirs nA -> nB), outward == fn.
        frags.push_back(emitQuarterDisk(tb, center, Rend, nA, nB, e, fn));
    }

    // -- the VARIABLE-RADIUS blend patch (exact rational NURBS sweep) ----------
    Face* blend = emitVariableArcSweep(tb, F0, R0, F1, R1, nA, nB, e,
                                       /*surfNormalDir=*/bisector,
                                       /*ringOrient=*/bisector);
    frags.push_back(blend);

    // -- sew all fragments into one closed shell -------------------------------
    Solid* solid = tb.makeSolid();
    SewOptions so; so.tol = 1e-7; so.midSamples = 3; so.weldVertices = true;
    SewResult sr = sewFaces(tb, frags, so);
    for (Shell* sh : sr.shells) tb.addShellToSolid(solid, sh);

    res.solid       = solid;
    res.filletFace  = blend;
    res.radius0     = R0;
    res.radius1     = R1;
    res.edgeLength  = edgeLen;
    res.dihedralDeg = 90.0;
    res.axisStart   = F0;
    res.axisEnd     = F1;
    res.axisDir     = e;
    res.removedVolume = (1.0 - kPi / 4.0) * edgeLen * (R0 * R0 + R0 * R1 + R1 * R1) / 3.0;
    const bool closed = sr.ok && sr.diagnosis.closed;
    res.ok = closed;
    res.reason = res.ok
        ? "ok (analytic VARIABLE-radius rolling-ball fillet, LINEAR law R(t)=R0+(R1-R0)t/L, "
          "CONVEX straight planar-planar box edge; blend is an EXACT rational NURBS sweep of "
          "the varying quarter-arc; watertight closed 2-manifold)"
        : "variable-radius fillet assembly did not sew into a closed shell";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
