// forge/native/brep/DraftAnalytic.cpp
//
// Implementation of forge::native::brep::draftBoxAnalytic — the analytic uniform
// FACE DRAFT (mold-release taper about a neutral plane) on the native ANALYTIC
// B-rep, the analytic SIBLING of the flat-bevel chamfer in ChamferAnalytic.cpp
// (READ that first; this mirrors its structure exactly). See DraftAnalytic.hpp for
// the full specification and the honest scope boundary. Pure C++20, stdlib +
// existing brep headers only. No OCCT, no WASM.
//
// THE DRAFT (uniform alpha about the base neutral plane z=0, pull dir +Z)
// ---------------------------------------------------------------------------
// The box [0,L]^3 has four PLANAR side walls. Each wall meets the neutral plane
// z=0 in a fixed PIVOT LINE (its base edge). The draft rotates each wall by alpha
// about its pivot line, leaning the wall IN (toward the +Z pull, the mold-release
// taper). A wall point at height z is displaced TANGENT to the neutral plane, into
// the material, by  z*tan(alpha): its horizontal offset from the pivot line shrinks
// by z*tan(alpha). The base ring (z=0) is the neutral section and does not move.
//
// For the box, the two opposite walls in each horizontal direction both lean in by
// z*tan(alpha), so the cross-section at height z is a CENTRED square of side
//     s(z) = L - 2 z tan(alpha).
// The top corners (z=L) move inward by L*tan(alpha) in BOTH horizontal directions:
//     v4(0,0,L)  -> ( g,    g,   L)
//     v5(L,0,L)  -> ( L-g,  g,   L)
//     v6(L,L,L)  -> ( L-g,  L-g, L)
//     v7(0,L,L)  -> ( g,    L-g, L)        with g = L*tan(alpha).
// Two drafted walls that share a vertical box edge re-meet at the new tilted-plane
// intersection — for the box that mutual intersection is exactly the slanted edge
// joining the (fixed) base corner to the (moved-in) top corner, so the re-trim is
// closed-form and every side face stays a PLANAR trapezoid. The bottom cap (z=0) is
// unchanged; the top cap (z=L) is the shrunk square through the four moved corners.
//
// The result is a square FRUSTUM. Its volume, integrated exactly here by the
// analytic divergence-theorem MassProps over the planar trapezoid walls + the two
// square caps, equals  ∫_0^L (L - 2 z tan(alpha))^2 dz  (asserted in the gate).
//
// Every emitted face is PLANAR, so it carries an analytic Plane Surface (via the
// same attachPlanarFace helper validated in ChamferAnalytic.cpp) and the
// polygon-moment integrator is bit-exact to rounding.

#include "forge/native/brep/DraftAnalytic.hpp"

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

AnalyticDraftResult fail(const char* why) {
    AnalyticDraftResult r;
    r.ok = false;
    r.reason = why;
    return r;
}

// Newell area-normal of a closed vertex ring (robust to non-convexity). Identical
// to the validated helper in ChamferAnalytic.cpp.
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
// reverse it in place otherwise — so every emitted face's coedge winding is
// consistently outward and every shared edge is mated by two opposite-sense
// coedges (a strictly closed 2-manifold).
void orientRingCCW(std::vector<Vertex*>& ring, const Vec3& outwardNormal) {
    if (vdot(ringNormal(ring), outwardNormal) < 0.0)
        std::reverse(ring.begin(), ring.end());
}

// Attach a planar analytic Surface to a face whose CCW (from outside) ring lies in
// a known plane. vertexUV[i] = in-plane coords of ring[i]; the mass integrator does
// an EXACT polygon-moment integral over them. `outwardNormal` orients the stored
// plane normal to point OUT of the solid. (Mirrors the validated ChamferAnalytic.cpp
// attachPlanarFace, kept local so this TU is self-sufficient.)
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

// Emit one planar face from a CCW-orientable ring + its outward normal. Picks two
// non-collinear in-plane spanning directions from the ring (so a trapezoid whose
// ring[0]->ring[1] and ring[0]->ring[3] happen to be near-parallel still gets a
// valid frame).
Face* emitPlanarFace(TopologyBuilder& tb, Shell* shell,
                     std::vector<Vertex*> ring, const Vec3& outwardNormal) {
    orientRingCCW(ring, outwardNormal);
    Face* f = tb.makeFace();
    tb.addFaceToShell(shell, f);
    tb.addOuterLoopToFace(f, ring);
    Vec3 o = P2V(ring[0]->point);
    Vec3 uD = vsub(P2V(ring[1]->point), o);
    Vec3 vD = vsub(P2V(ring[2]->point), o);
    if (vlen(vcross(uD, vD)) < 1e-12) vD = vsub(P2V(ring[3]->point), o);
    attachPlanarFace(tb, f, ring, o, uD, vD, outwardNormal);
    return f;
}

} // namespace

AnalyticDraftResult draftBoxAnalytic(TopologyBuilder& tb,
                                     double L, double alphaDeg) {
    // -------- input screening (honest refusal, never a faked solid) ----------
    if (!(L > 0.0) || !std::isfinite(L))
        return fail("box edge length L must be positive and finite");
    if (!std::isfinite(alphaDeg) || !(alphaDeg > 0.0) || !(alphaDeg < 90.0))
        return fail("draft angle alpha must satisfy 0 < alpha < 90 degrees");

    const double t = std::tan(alphaDeg * kPi / 180.0);   // tan(alpha)
    // Top cross-section side  s(L) = L - 2 L t  must stay strictly positive, i.e.
    // tan(alpha) < 1/2  (alpha < ~26.565 deg) for the all-four-wall box draft.
    if (!(2.0 * t < 1.0))
        return fail("draft angle too large: top face would collapse "
                    "(need tan(alpha) < 1/2 for an all-four-wall box draft)");

    const double g = L * t;   // inward offset of every top corner per direction

    // -------- the eight drafted vertices (base fixed, top pulled in) ---------
    // Base ring (neutral section z=0) — unchanged.
    const Vec3 b0{0, 0, 0}, b1{L, 0, 0}, b2{L, L, 0}, b3{0, L, 0};
    // Top ring (z=L) — each corner pulled inward by g in BOTH horizontal axes.
    const Vec3 u0{g,     g,     L};
    const Vec3 u1{L - g, g,     L};
    const Vec3 u2{L - g, L - g, L};
    const Vec3 u3{g,     L - g, L};

    Vertex* vb0 = tb.makeVertex(V2P(b0));
    Vertex* vb1 = tb.makeVertex(V2P(b1));
    Vertex* vb2 = tb.makeVertex(V2P(b2));
    Vertex* vb3 = tb.makeVertex(V2P(b3));
    Vertex* vu0 = tb.makeVertex(V2P(u0));
    Vertex* vu1 = tb.makeVertex(V2P(u1));
    Vertex* vu2 = tb.makeVertex(V2P(u2));
    Vertex* vu3 = tb.makeVertex(V2P(u3));

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    AnalyticDraftResult res;
    res.draftedFaces.reserve(4);
    res.faceAngleVsVerticalDeg.reserve(4);

    // -------- the two CAP faces (planar, NOT tilted) -------------------------
    // Bottom cap z=0 (neutral section): outward normal -Z, ring b0,b1,b2,b3.
    emitPlanarFace(tb, shell, {vb0, vb1, vb2, vb3}, Vec3{0, 0, -1});
    // Top cap z=L (shrunk square through the moved corners): outward normal +Z.
    emitPlanarFace(tb, shell, {vu0, vu1, vu2, vu3}, Vec3{0, 0, 1});

    // -------- the four DRAFTED SIDE faces (planar trapezoids) ----------------
    // Each is the trapezoid: base edge (fixed) + the two slanted edges to the
    // (moved-in) top corners + the top edge. The original (pre-draft) wall normal
    // is the axis-aligned outward normal; we record the achieved angle between the
    // tilted wall and that original vertical wall (== alpha).
    struct Wall {
        Vertex *bA, *bB, *uB, *uA;   // CCW-ish ring: baseA, baseB, topB, topA
        Vec3 origNormal;             // original (pre-draft) outward wall normal
    };
    const Wall walls[4] = {
        {vb0, vb1, vu1, vu0, Vec3{0, -1, 0}},  // front  y=0
        {vb1, vb2, vu2, vu1, Vec3{1,  0, 0}},  // right  x=L
        {vb2, vb3, vu3, vu2, Vec3{0,  1, 0}},  // back   y=L
        {vb3, vb0, vu0, vu3, Vec3{-1, 0, 0}},  // left   x=0
    };

    for (const Wall& w : walls) {
        std::vector<Vertex*> ring = {w.bA, w.bB, w.uB, w.uA};
        // The drafted wall leans IN, so its outward normal tilts UP from the
        // original horizontal outward normal toward +Z. Build the true tilted
        // outward normal from the trapezoid geometry: outward ~ origNormal then
        // rotated by alpha about the (horizontal) pivot direction. We derive it
        // directly from the ring's Newell normal (the planar trapezoid's own
        // normal), sign-fixed to agree with the original outward direction so the
        // wall faces OUT of the solid.
        Vec3 nn = vnorm(ringNormal(ring));
        if (vdot(nn, w.origNormal) < 0.0) nn = vscale(nn, -1.0);

        Face* f = emitPlanarFace(tb, shell, ring, nn);
        res.draftedFaces.push_back(f);

        // Angle between the tilted wall and the ORIGINAL vertical wall == alpha.
        const double c = std::max(-1.0, std::min(1.0, vdot(nn, vnorm(w.origNormal))));
        res.faceAngleVsVerticalDeg.push_back(std::acos(c) * 180.0 / kPi);
    }

    res.ok          = true;
    res.solid       = solid;
    res.angleDeg    = alphaDeg;
    res.neutralZ    = 0.0;
    res.numDrafted  = 4;
    res.reason      = "ok (analytic uniform face draft about the base neutral plane, "
                      "planar side walls -> square frustum)";
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
