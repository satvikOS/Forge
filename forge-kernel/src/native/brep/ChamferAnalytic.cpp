// forge/native/brep/ChamferAnalytic.cpp
//
// Implementation of forge::native::brep::chamferBoxEdgeAnalytic — the analytic
// SYMMETRIC FLAT-BEVEL edge chamfer on the native ANALYTIC B-rep, the flat sibling
// of the rolling-ball fillet in FilletAnalytic.cpp (READ that first; this mirrors
// its structure exactly). See ChamferAnalytic.hpp for the full specification and
// the honest scope boundary. Pure C++20, stdlib + existing brep headers only. No
// OCCT, no WASM.
//
// THE FLAT BEVEL (symmetric setback d, planar-planar convex straight edge)
// -------------------------------------------------------------------------
// Two planar faces A, B meet at a convex straight edge from P0 to P1 along the
// unit direction e. Their OUTWARD unit normals are nA, nB. The chamfer cuts each
// face back from the sharp edge by `d` measured ALONG the face (perpendicular to
// the edge, into the material). The in-plane "into-A" direction (lying in plane A,
// perpendicular to e, pointing away from the edge into face A's interior) is, for
// the orthogonal box edge, exactly -nB; symmetrically "into-B" is -nA. So the two
// SETBACK LINES are
//     TA(t) = P0 + t*e + d*(-nB)        (the cut on face A)
//     TB(t) = P0 + t*e + d*(-nA)        (the cut on face B)
// and the flat chamfer face is the PLANE through TA and TB — a planar quad band
// of length L (the edge) and chord width |TA - TB| = d*sqrt(2) for the 90-degree
// edge. Its OUTWARD normal bisects nA and nB:  bevelN = normalize(nA + nB).
//
// RE-TRIM. Faces A and B move their two sharp-edge corners (P0,P1) to the setback
// points (TA0,TA1 for A; TB0,TB1 for B). The two PERPENDICULAR END faces each lose
// the d x d right-triangle corner at the sharp endpoint: the square corner is
// clipped by the straight bevel chord (TA endpoint -> TB endpoint), turning the
// quad into a CONVEX pentagon (square with one corner sliced off). The bevel chord
// edges of the two end pentagons MATE the two short ends of the bevel quad.
//
// REMOVED VOLUME: the bevel removes the right-triangle prism whose cross-section is
// the right triangle with legs d (on A) and d (on B): area = (1/2) d^2, over the
// edge length L. So the chamfered solid volume is  V_box - (1/2) d^2 L — measured
// here EXACTLY by the analytic MassProps integrator over the re-trimmed planar
// faces + the planar bevel + the clipped end pentagons (every face is planar, so
// the polygon-moment path is bit-exact to rounding).

#include "forge/native/brep/ChamferAnalytic.hpp"

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

AnalyticChamferResult fail(const char* why) {
    AnalyticChamferResult r;
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
// edge / frame handedness is being chamfered.
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

AnalyticChamferResult chamferBoxEdgeAnalytic(TopologyBuilder& tb,
                                             double L, double d, int edgeIndex) {
    // -------- input screening (honest refusal, never a faked solid) ----------
    if (!(L > 0.0) || !std::isfinite(L)) return fail("box edge length L must be positive and finite");
    if (!(d > 0.0) || !std::isfinite(d)) return fail("chamfer setback d must be positive and finite");
    if (edgeIndex < 0 || edgeIndex > 11) return fail("edgeIndex out of range [0,11]");
    if (!(d < L)) return fail("chamfer setback d must be < L (setback line would overflow the face)");

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

    // -------- the flat bevel (analytic) --------------------------------------
    // "into-A" (in plane A, perpendicular to e, away from the edge) == -nB;
    // "into-B" == -nA. The setback lines: TA = P + d*(-nB) on A, TB = P + d*(-nA)
    // on B. (Exact for the orthogonal box: nA ⟂ nB, so -nB lies in plane A and
    // -nA lies in plane B.)
    const Vec3 iA = vscale(nA, -1.0);   // -nA: into-B direction (lies in plane B)
    const Vec3 iB = vscale(nB, -1.0);   // -nB: into-A direction (lies in plane A)
    const Vec3 TA0 = vadd(P0, vscale(iB, d));   // setback on face A @ start
    const Vec3 TB0 = vadd(P0, vscale(iA, d));   // setback on face B @ start
    const Vec3 TA1 = vadd(P1, vscale(iB, d));   // setback on face A @ far
    const Vec3 TB1 = vadd(P1, vscale(iA, d));   // setback on face B @ far

    const Vec3 bevelN = vnorm(vadd(nA, nB));    // bevel outward normal (bisector)
    // bevel angle vs each face plane: acos(nA . bevelN).
    const double chamferAngleDeg =
        std::acos(std::max(-1.0, std::min(1.0, vdot(nA, bevelN)))) * 180.0 / kPi;

    // -------- assemble the chamfered solid on the analytic B-rep -------------
    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // Surviving box-corner vertices (the two sharp-edge endpoints vanish).
    std::vector<Vertex*> cv(8, nullptr);
    for (int i = 0; i < 8; ++i)
        if (i != be.c0 && i != be.c1) cv[i] = tb.makeVertex(V2P(C[i]));

    // The four setback corners, shared between the bevel face, the trimmed faces,
    // and the clipped end pentagons.
    Vertex* vTA0 = tb.makeVertex(V2P(TA0));
    Vertex* vTB0 = tb.makeVertex(V2P(TB0));
    Vertex* vTA1 = tb.makeVertex(V2P(TA1));
    Vertex* vTB1 = tb.makeVertex(V2P(TB1));

    AnalyticChamferResult res;

    // A face's outward normal identifies its role: face A (== nA), face B (== nB),
    // or a perpendicular END face (touches one sharp endpoint, normal perpendicular
    // to the edge). The two faces that DON'T touch the edge are unchanged quads.
    for (const auto& dd : kBoxFaces) {
        const Vec3 fn = vnorm(dd.normal);
        const bool isFaceA = veq(fn, nA);
        const bool isFaceB = veq(fn, nB);
        // Does this face contain a sharp endpoint?
        int sharpAt = -1;                       // ring slot of the sharp corner
        int sharpCorner = -1;
        int sharpCount = 0;
        for (int k = 0; k < 4; ++k)
            if (dd.idx[k] == be.c0 || dd.idx[k] == be.c1) { sharpAt = k; sharpCorner = dd.idx[k]; ++sharpCount; }

        if (sharpCount == 0) {
            // Untouched original quad face.
            std::vector<Vertex*> ring = {cv[dd.idx[0]], cv[dd.idx[1]], cv[dd.idx[2]], cv[dd.idx[3]]};
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
            // be.c1) move to this face's setback corners (TA* for A, TB* for B).
            std::vector<Vertex*> ring;
            for (int k = 0; k < 4; ++k) {
                const int ci = dd.idx[k];
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

        // PERPENDICULAR END FACE: exactly one sharp corner. Re-trim by CLIPPING the
        // d x d right-triangle corner at the sharp endpoint with the straight bevel
        // chord (the setback point on A -> the setback point on B). The quad becomes
        // a CONVEX pentagon: the sharp corner is replaced by the two setback points
        // [ <setback nearer prev> , <setback nearer next> ]. The chord edge between
        // those two setback points MATES the bevel quad's short end. A convex
        // pentagon is integrated EXACTLY by the planar polygon-moment path, so no
        // triangulation is needed (unlike the fillet's L-shaped non-convex notch).
        const bool atStart = (sharpCorner == be.c0);
        Vertex* vtA = atStart ? vTA0 : vTA1;
        Vertex* vtB = atStart ? vTB0 : vTB1;

        // Decide which setback point is nearer the ring's PREV neighbour so the
        // pentagon stays simple (no self-crossing) in this face's CCW order.
        const int prevCi = dd.idx[(sharpAt + 3) % 4];
        const Vec3 prevPos = C[prevCi];     // a perpendicular face's neighbours are never sharp
        const double dA = vlen(vsub(P2V(vtA->point), prevPos));
        const double dB = vlen(vsub(P2V(vtB->point), prevPos));
        Vertex* nearPrev = (dA <= dB) ? vtA : vtB;
        Vertex* nearNext = (dA <= dB) ? vtB : vtA;

        std::vector<Vertex*> ring;
        for (int k = 0; k < 4; ++k) {
            if (k == sharpAt) {
                ring.push_back(nearPrev);
                ring.push_back(nearNext);
            } else {
                ring.push_back(cv[dd.idx[k]]);
            }
        }
        orientRingCCW(ring, fn);
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = P2V(ring[0]->point);
        // Pick two non-collinear in-plane spanning directions from the ring.
        Vec3 uD = vsub(P2V(ring[1]->point), o);
        Vec3 vD = vsub(P2V(ring[2]->point), o);
        if (vlen(vcross(uD, vD)) < 1e-12) vD = vsub(P2V(ring[3]->point), o);
        attachPlanarFace(tb, f, ring, o, uD, vD, fn);
    }

    // ---- the flat bevel PATCH (planar quad band) ----------------------------
    // Quad ring TA0 -> TB0 (start chord) -> TB1 (along edge, B side) -> TA1 (far
    // chord) -> back to TA0. The two chord edges (TA0-TB0 and TA1-TB1) MATE the
    // two end pentagons' bevel chords; the two axial edges (TB0-TB1, TA1-TA0)
    // MATE the re-trimmed faces B and A.
    {
        std::vector<Vertex*> ring = {vTA0, vTB0, vTB1, vTA1};
        orientRingCCW(ring, bevelN);
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, ring);
        Vec3 o = P2V(ring[0]->point);
        attachPlanarFace(tb, f, ring, o,
                         vsub(P2V(ring[1]->point), o),
                         vsub(P2V(ring[3]->point), o), bevelN);
        res.bevelFace = f;
    }

    res.ok              = true;
    res.solid           = solid;
    res.setback         = d;
    res.edgeLength      = edgeLen;
    res.dihedralDeg     = interiorDihedralDeg;
    res.chamferAngleDeg = chamferAngleDeg;
    res.bevelNormal     = bevelN;
    res.tangentA        = TA0;
    res.tangentB        = TB0;
    res.reason          = "ok (analytic symmetric flat-bevel chamfer, "
                          "planar-planar convex straight edge)";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
