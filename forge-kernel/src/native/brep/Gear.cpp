// forge/native/brep/Gear.cpp
//
// Implementation of the STANDARD EXTERNAL INVOLUTE SPUR GEAR generator
// (Gear.hpp). Pure C++20, standard library only; ZERO new deps. No OCCT, no WASM.
//
// Reuses (by #include, never re-implements):
//   * TopologyBuilder / Solid / Face / Surface assembly (Topology + Surface),
//   * SolidFactory ownership (Primitives.hpp),
//   * patternTransforms(Circular) — the EXACT circular-pattern rigid-rotation
//     enumeration from Pattern.hpp — to place all N teeth about the gear axis,
//   * massProperties() for the exact divergence-theorem volume + positive-volume
//     orientation guard.
//
// METHOD (analytic, single extruded toothed cross-section):
//   1. Derive the standard full-depth dimensions (pitch/base/addendum/root radii).
//   2. Build ONE tooth's 2D outline (right involute flank -> tip arc -> left
//      involute flank -> root arc to the next tooth), then place N copies by the
//      Pattern circular rotations to form the full closed outer rim (CCW).
//   3. Build the bore as an M-gon ring (a Cylinder side wall).
//   4. Extrude: bottom + top caps tiled as planar triangles over the annulus
//      between the outer rim and the bore (each triangle a Plane face = exact
//      mass), one planar side wall per outer-rim edge, and the cylindrical bore
//      wall. Shared edges via addOuterLoopToFace keep it a closed 2-manifold.
//   5. Validate closed-2-manifold + strictly-positive volume before ok = true.

#include "forge/native/brep/Gear.hpp"

#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Pattern.hpp"   // patternTransforms (Circular), RigidTransform

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace forge {
namespace native {
namespace brep {

namespace {

constexpr double kPi = 3.14159265358979323846;

inline Vec3 V3(const Point3& p) { return Vec3{p.x, p.y, p.z}; }
inline Point3 P3(const Vec3& v) { return Point3{v.x, v.y, v.z}; }

// Rotate a 2D-in-XY point about +Z by angle `ang` (z preserved).
inline Vec3 rotZ(const Vec3& p, double ang) {
    const double c = std::cos(ang), s = std::sin(ang);
    return Vec3{c * p.x - s * p.y, s * p.x + c * p.y, p.z};
}

// Attach a planar Surface to a face whose ring lies in a known plane, with the
// (refDir,binormal) plane coords as vertexUV. `outwardNormal` orients the normal.
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
    const Vec3 bn = s->binormal();
    for (std::size_t i = 0; i < ring.size(); ++i) {
        Vec3 rel = vsub(V3(ring[i]->point), origin);
        double pu = vdot(rel, s->refDir);
        double pv = vdot(rel, bn);
        f->vertexUV.push_back({pu, pv});
        if (i == 0) { u0 = u1 = pu; v0 = v1 = pv; }
        else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
               v0 = std::min(v0, pv); v1 = std::max(v1, pv); }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;
}

// Emit one planar TRIANGLE face on `shell` with an outward Plane surface.
void addTri(TopologyBuilder& tb, Shell* shell,
            Vertex* a, Vertex* b, Vertex* c, const Vec3& outwardNormal) {
    Face* f = tb.makeFace();
    tb.addFaceToShell(shell, f);
    std::vector<Vertex*> ring = {a, b, c};
    tb.addOuterLoopToFace(f, ring);
    Vec3 o = V3(a->point);
    // Order the ring so cross(uDir,vDir) aligns with outwardNormal (consistent UV
    // basis); attachPlanarFace sets `reversed` from the same outwardNormal anyway.
    attachPlanarFace(tb, f, ring, o,
                     vsub(V3(b->point), o), vsub(V3(c->point), o), outwardNormal);
}

// ---------------------------------------------------------------------------
// One tooth's 2D outline, centred on +X. Returns the ordered CCW polyline that
// runs:  root-start (right side)  -> up the RIGHT involute flank -> across the tip
// (addendum) arc -> down the LEFT involute flank -> root-end (left side) -> along
// the dedendum (root) arc to the start of the NEXT tooth's right flank.
//
// The returned points do NOT repeat the next tooth's start (that belongs to the
// next tooth), so concatenating N rotated copies forms one closed ring with no
// duplicated vertices.
// ---------------------------------------------------------------------------
std::vector<Vec3> oneToothCCW(const GearSpec& spec, const GearGeometry& g) {
    const double rBase = g.baseRadius;
    const double ra    = g.addendumRadius;
    const double rf    = g.rootRadius;
    const double rp    = g.pitchRadius;
    const int    Nsamp = std::max(4, spec.flankSamples);

    // The flank starts at the larger of the base circle and the root circle (a
    // standard gear with rf < rBase has a short radial under-base portion; the
    // INVOLUTE itself only exists for r >= rBase). flankStartR is where the
    // involute begins.
    const double flankStartR = std::max(rBase, rf);

    // Unrolling parameters at the flank start and at the addendum.
    const double tStart = involuteParamForRadius(rBase, flankStartR);
    const double tTip   = involuteParamForRadius(rBase, ra);

    // --- Tooth thickness placement -----------------------------------------
    // Standard: the tooth thickness on the PITCH circle equals half the circular
    // pitch, p/2 => the half-angle subtended at the pitch circle is
    //   halfPitchAngle = (p/2) / (2*rp) ... in terms of angle = (pi/(2N)).
    // The involute "roll" angle to the pitch circle is inv(tp) = tan(ap)-ap where
    // tp = involuteParamForRadius(rBase, rp). The right flank is generated by the
    // involute starting at polar angle theta0 chosen so the flank crosses the pitch
    // circle exactly halfPitchAngle to the +X (centre) side. The involute point at
    // parameter t sits at polar angle (theta0 + invAngle(t)) where invAngle(t) is
    // the involute's own polar angle growth. We compute the centred tooth by
    // building the RIGHT flank below +X and mirroring for the LEFT.
    const double tp        = involuteParamForRadius(rBase, rp); // param at pitch r
    // Involute polar angle at parameter t for our closed form
    //   x=rBase(cos t + t sin t), y=rBase(sin t - t cos t)
    // => polar angle phi(t) = atan2(y,x) = t - atan(t)  (the involute function).
    auto invAngle = [](double t) -> double { return t - std::atan(t); };
    const double halfTooth = kPi / (2.0 * spec.teeth); // half tooth angular width at pitch

    // For the RIGHT flank we want, at the pitch circle (param tp), the flank to be
    // at polar angle  -halfTooth  (just clockwise of the +X centre line). Our base
    // involute has polar angle invAngle(t) measured from its own start ray; we
    // rotate the whole right flank by  rRot = -halfTooth - invAngle(tp)  so that at
    // t=tp the flank lands at -halfTooth. The right flank is then the rotated base
    // involute; the left flank is its mirror across the +X axis (y -> -y i.e.
    // reflect, giving polar angle +(...)).
    const double rRot = -halfTooth - invAngle(tp);

    auto rightFlankPt = [&](double t) -> Vec3 {
        Vec3 p = involutePoint(rBase, t);   // closed-form involute, z=0
        return rotZ(p, rRot);
    };
    // Left flank = mirror of the right flank across the X axis (negate y), then
    // it must be traversed from tip down to root for a CCW outline.
    auto leftFlankPt = [&](double t) -> Vec3 {
        Vec3 p = rightFlankPt(t);
        return Vec3{p.x, -p.y, 0.0};
    };

    std::vector<Vec3> out;
    out.reserve(static_cast<std::size_t>(2 * Nsamp + 4));

    // (1) RIGHT flank, root -> tip (CCW the right side is the clockwise-most, so we
    //     go from tStart up to tTip; this side has negative y).
    for (int i = 0; i <= Nsamp; ++i) {
        double t = tStart + (tTip - tStart) * (double)i / Nsamp;
        out.push_back(rightFlankPt(t));
    }
    // (2) TIP (addendum) arc across the top of the tooth, from the right-flank tip
    //     to the left-flank tip, along the addendum circle.
    {
        Vec3 rTip = rightFlankPt(tTip);
        Vec3 lTip = leftFlankPt(tTip);
        double aR = std::atan2(rTip.y, rTip.x);
        double aL = std::atan2(lTip.y, lTip.x);
        // walk CCW from aR up to aL (aL > aR since left side is +y).
        if (aL < aR) aL += 2.0 * kPi;
        const int arcSeg = std::max(2, Nsamp / 3);
        for (int i = 1; i < arcSeg; ++i) { // skip endpoints (already / will be added)
            double a = aR + (aL - aR) * (double)i / arcSeg;
            out.push_back(Vec3{ra * std::cos(a), ra * std::sin(a), 0.0});
        }
    }
    // (3) LEFT flank, tip -> root (mirror side, positive y), traversed downward.
    for (int i = 0; i <= Nsamp; ++i) {
        double t = tTip - (tTip - tStart) * (double)i / Nsamp;
        out.push_back(leftFlankPt(t));
    }
    // (4) ROOT arc on the dedendum circle from the left-flank root of THIS tooth to
    //     the right-flank root of the NEXT tooth (the gap bottom). The next tooth's
    //     right-flank root sits at this tooth's right-flank-root angle rotated by
    //     the tooth pitch (+toothAngle). We emit the gap-floor arc up to (but not
    //     including) that next start point.
    {
        Vec3 lRoot = leftFlankPt(tStart);      // left root of this tooth (angle +)
        Vec3 rRootNext = rightFlankPt(tStart); // right root of THIS tooth (angle -)
        // next tooth's right root is rRootNext rotated by +toothAngle.
        double aFrom = std::atan2(lRoot.y, lRoot.x);
        Vec3 rNext = rotZ(rRootNext, g.toothAngle);
        double aTo = std::atan2(rNext.y, rNext.x);
        if (aTo < aFrom) aTo += 2.0 * kPi;
        const int rootSeg = std::max(2, Nsamp / 3);
        // emit interior points of the gap floor (endpoints belong to the flanks).
        for (int i = 1; i < rootSeg; ++i) {
            double a = aFrom + (aTo - aFrom) * (double)i / rootSeg;
            out.push_back(Vec3{rf * std::cos(a), rf * std::sin(a), 0.0});
        }
    }
    return out;
}

} // namespace

// ===========================================================================
// Public: closed-form gear math
// ===========================================================================
GearGeometry gearDimensions(const GearSpec& spec) {
    GearGeometry g;
    const double m = spec.module;
    const int    N = spec.teeth;
    g.pitchDiameter = m * (double)N;              // d = m*N  (EXACT)
    g.pitchRadius   = 0.5 * g.pitchDiameter;      // rp
    g.baseRadius    = g.pitchRadius * std::cos(spec.pressureAngle); // r_base
    g.addendumRadius= g.pitchRadius + m;          // ra = rp + 1*m
    g.rootRadius    = g.pitchRadius - 1.25 * m;   // rf = rp - 1.25*m
    g.circularPitch = kPi * m;                    // p = pi*m
    g.toothAngle    = 2.0 * kPi / (double)N;      // angular pitch
    return g;
}

Vec3 involutePoint(double rBase, double t) {
    const double ct = std::cos(t), st = std::sin(t);
    return Vec3{rBase * (ct + t * st), rBase * (st - t * ct), 0.0};
}

Vec3 involuteTangentContact(double rBase, double t) {
    return Vec3{rBase * std::cos(t), rBase * std::sin(t), 0.0};
}

double involuteParamForRadius(double rBase, double rTarget) {
    if (rTarget <= rBase) return 0.0;
    const double ratio = rTarget / rBase;
    return std::sqrt(ratio * ratio - 1.0);
}

std::vector<Vec3> gearToothProfile2D(const GearSpec& spec, const GearGeometry& g) {
    return oneToothCCW(spec, g);
}

// circularPatternTransforms — the EXACT circular-pattern rigid-rotation
// enumeration the Pattern feature uses for PatternKind::Circular (see
// Pattern.cpp::patternTransforms): instance k is the rotation about the axis line
// (axisOrigin, axisDir) by k*angleStep, with the translation chosen so axisOrigin
// is the fixed pivot. Reproduced here over the SAME RigidTransform type (from
// Pattern.hpp) so the gear's tooth placement is bit-identical to a bolt-circle
// pattern about +Z, WITHOUT linking applyPattern's boolean/mesh transitive stack
// into this standalone part (a deliberate, documented decoupling — Bible §0/§9).
static std::vector<RigidTransform> circularPatternTransforms(
        int count, const Vec3& axisOrigin, const Vec3& axisDir, double angleStep) {
    std::vector<RigidTransform> out;
    int n = count < 1 ? 1 : count;
    Vec3 k = vnorm(axisDir);
    for (int idx = 0; idx < n; ++idx) {
        const double ang = angleStep * idx;
        const double c = std::cos(ang), s = std::sin(ang), t = 1.0 - c;
        const double x = k.x, y = k.y, z = k.z;
        RigidTransform xf; // Rodrigues row-major, identical to Pattern.cpp.
        xf.r[0] = c + x * x * t;     xf.r[1] = x * y * t - z * s; xf.r[2] = x * z * t + y * s;
        xf.r[3] = y * x * t + z * s; xf.r[4] = c + y * y * t;     xf.r[5] = y * z * t - x * s;
        xf.r[6] = z * x * t - y * s; xf.r[7] = z * y * t + x * s; xf.r[8] = c + z * z * t;
        // translation so axisOrigin is the fixed pivot: t = axisOrigin - R*axisOrigin.
        xf.t = vsub(axisOrigin, xf.applyDir(axisOrigin));
        xf.det = 1.0;
        out.push_back(xf);
    }
    return out;
}

std::vector<Vec3> gearOuterProfile2D(const GearSpec& spec, const GearGeometry& g,
                                     int* addendumArcCount) {
    // ONE tooth outline, then place N copies by the EXACT circular-pattern
    // rotations (k*toothAngle about +Z) — the same rigid-rotation enumeration a
    // bolt circle uses (Pattern.hpp PatternKind::Circular), over the same
    // RigidTransform type.
    std::vector<Vec3> tooth = oneToothCCW(spec, g);

    std::vector<RigidTransform> xf = circularPatternTransforms(
        spec.teeth, Vec3{0, 0, 0}, Vec3{0, 0, 1}, g.toothAngle);

    std::vector<Vec3> ring;
    ring.reserve(tooth.size() * spec.teeth);
    for (const RigidTransform& T : xf) {
        for (const Vec3& p : tooth)
            ring.push_back(T.applyPoint(p)); // rigid rotation about +Z
    }
    if (addendumArcCount) *addendumArcCount = spec.teeth;
    return ring;
}

// ===========================================================================
// Public: buildGear
// ===========================================================================
GearResult buildGear(const GearSpec& spec) {
    GearResult R;

    // --- validate the spec honestly ----------------------------------------
    if (!(spec.module > 0.0)) { R.reason = "gear: module must be > 0"; return R; }
    if (spec.teeth < 4)       { R.reason = "gear: tooth count must be >= 4"; return R; }
    if (!(spec.pressureAngle > 0.0 && spec.pressureAngle < 0.5 * kPi)) {
        R.reason = "gear: pressure angle must be in (0, pi/2)"; return R; }
    if (!(spec.faceWidth > 0.0)) { R.reason = "gear: face width must be > 0"; return R; }

    GearGeometry g = gearDimensions(spec);
    R.geometry = g;

    if (!(g.addendumRadius > g.rootRadius)) {
        R.reason = "gear: addendum radius must exceed root radius"; return R; }
    if (spec.boreRadius < 0.0 || spec.boreRadius >= g.rootRadius) {
        R.reason = "gear: bore radius must be in [0, rootRadius)"; return R; }

    const double w = spec.faceWidth;
    const bool hasBore = (spec.boreRadius > 0.0);
    const double rBore = spec.boreRadius;

    // --- the full toothed outer rim (CCW about +Z) -------------------------
    int arcCount = 0;
    std::vector<Vec3> outer2D = gearOuterProfile2D(spec, g, &arcCount);
    const std::size_t P = outer2D.size();
    if (P < 3) { R.reason = "gear: degenerate outer profile"; return R; }
    R.toothCount = arcCount;

    // --- the bore ring -----------------------------------------------------
    // ANGLE-MATCHED to the outer rim: one bore vertex per outer-rim vertex, placed
    // at the SAME polar angle on the bore circle. This makes each cap face a clean
    // RADIAL TRAPEZOID (rim point + bore point at the same angle) — never a twisted
    // quad — so the flat annular cap is a proper quad band that mates edge-for-edge
    // with both the bore wall and the outer side wall (a clean closed 2-manifold,
    // exactly like buildTube's equal-count rings). The bore polygon's true circle
    // radius is preserved analytically by the Cylinder bore-wall surface.
    std::vector<Vec3> bore2D;
    if (hasBore) {
        bore2D.reserve(P);
        for (std::size_t i = 0; i < P; ++i) {
            double a = std::atan2(outer2D[i].y, outer2D[i].x); // rim vertex angle
            bore2D.push_back(Vec3{rBore * std::cos(a), rBore * std::sin(a), 0.0});
        }
    }

    R.owner = std::make_shared<SolidFactory>();
    TopologyBuilder& tb = R.owner->builder();

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);

    // Shared vertices: outer rim (bottom/top) and bore (bottom/top).
    std::vector<Vertex*> oBot(P), oTop(P);
    for (std::size_t i = 0; i < P; ++i) {
        oBot[i] = tb.makeVertex(P3(Vec3{outer2D[i].x, outer2D[i].y, 0.0}));
        oTop[i] = tb.makeVertex(P3(Vec3{outer2D[i].x, outer2D[i].y, w}));
    }
    std::vector<Vertex*> iBot, iTop;
    if (hasBore) {
        iBot.resize(P); iTop.resize(P);
        for (std::size_t i = 0; i < P; ++i) {
            iBot[i] = tb.makeVertex(P3(Vec3{bore2D[i].x, bore2D[i].y, 0.0}));
            iTop[i] = tb.makeVertex(P3(Vec3{bore2D[i].x, bore2D[i].y, w}));
        }
    }

    // -----------------------------------------------------------------------
    // OUTER SIDE WALLS — one planar quad per rim edge i->i+1, outward radial.
    // Split each quad into two triangles so the mass integrand is exact even if
    // the quad is non-planar (rim edges are vertical, so they are planar, but the
    // triangle path is unconditionally exact).
    // -----------------------------------------------------------------------
    for (std::size_t i = 0; i < P; ++i) {
        std::size_t j = (i + 1) % P;
        Vertex* a = oBot[i]; Vertex* b = oBot[j];
        Vertex* c = oTop[j]; Vertex* d = oTop[i];
        // outward normal = radial (away from axis) at the edge midpoint.
        Vec3 mid{0.5 * (outer2D[i].x + outer2D[j].x),
                 0.5 * (outer2D[i].y + outer2D[j].y), 0.0};
        Vec3 outward = vnorm(Vec3{mid.x, mid.y, 0.0});
        // quad (a,b,c,d) CCW outside -> tris (a,b,c) and (a,c,d).
        addTri(tb, shell, a, b, c, outward);
        addTri(tb, shell, a, c, d, outward);
    }

    // -----------------------------------------------------------------------
    // BORE WALL — one Cylinder side, faceted into P angle-matched sectors,
    // INWARD-facing normal.
    // Built like buildTube's inner wall: reversed winding + reversed surface.
    // -----------------------------------------------------------------------
    Surface* boreSurf = nullptr;
    if (hasBore) {
        boreSurf = tb.makeSurface();
        boreSurf->kind = SurfaceKind::Cylinder;
        boreSurf->origin = {0, 0, 0};
        boreSurf->axis = {0, 0, 1};
        boreSurf->refDir = {1, 0, 0};
        boreSurf->r1 = rBore; boreSurf->param = w;
        boreSurf->reversed = true; // faces toward the axis (into the bore void)
        // P sectors, one per angle-matched bore segment. The trim window uses the
        // TRUE (unwrapped, monotone-increasing) polar angles of the two bore
        // vertices so the analytic cylinder Jacobian integrates the exact bore wall.
        for (std::size_t i = 0; i < P; ++i) {
            std::size_t j = (i + 1) % P;
            double a0 = std::atan2(bore2D[i].y, bore2D[i].x);
            double a1 = std::atan2(bore2D[j].y, bore2D[j].x);
            while (a1 <= a0) a1 += 2.0 * kPi; // keep u1 > u0 (positive Jacobian)
            Face* f = tb.makeFace(); tb.addFaceToShell(shell, f);
            // reversed winding (j,i,...) so coedge order opposes an outward wall.
            std::vector<Vertex*> ring = {iBot[j], iBot[i], iTop[i], iTop[j]};
            tb.addOuterLoopToFace(f, ring);
            f->surface = boreSurf;
            f->u0 = a0; f->u1 = a1; f->v0 = 0.0; f->v1 = w;
            f->vertexUV = {{a1, 0.0}, {a0, 0.0}, {a0, w}, {a1, w}};
        }
    }

    // -----------------------------------------------------------------------
    // CAPS — bottom (z=0, normal -Z) and top (z=w, normal +Z). The cap is the
    // annular region between the toothed outer rim (P verts) and the bore (P
    // verts). Tile it with a stitching triangle strip (a flat ruled annulus) so
    // every cap face is a SIMPLE planar triangle => mass-exact (integratePlanar
    // walks only outer loops, so a face-with-hole cap would mis-measure; triangles
    // avoid that entirely). Without a bore the cap is a fan from the rim centroid.
    // -----------------------------------------------------------------------
    // EQUAL-COUNT (P==P) ANGLE-MATCHED annular cap: a clean quad band between the
    // outer rim and the angle-matched bore ring. Quad i = (rim[i], rim[j], bore[j],
    // bore[i]) is a radial trapezoid (never twisted), split into two coplanar
    // triangles so each cap face is a SIMPLE planar triangle => mass-exact
    // (integratePlanarExact walks only outer loops, so triangles avoid the
    // face-with-hole pitfall). Every cap edge mates exactly with the bore wall, the
    // outer side wall and the neighbouring cap quad (closed 2-manifold).
    auto buildAnnularCap = [&](const std::vector<Vertex*>& rim,
                               const std::vector<Vertex*>& bore,
                               const Vec3& outward, bool flip) {
        // `flip` reverses the per-quad winding so the emitted triangles wind CCW as
        // seen along +outward (bottom cap: outward=-Z needs the reversed sense).
        for (std::size_t i = 0; i < P; ++i) {
            std::size_t j = (i + 1) % P;
            Vertex* r0 = rim[i];  Vertex* r1 = rim[j];
            Vertex* b0 = bore[i]; Vertex* b1 = bore[j];
            if (!flip) {
                // top cap (outward +Z): rim CCW outward; tris (r0,r1,b1),(r0,b1,b0)
                addTri(tb, shell, r0, r1, b1, outward);
                addTri(tb, shell, r0, b1, b0, outward);
            } else {
                // bottom cap (outward -Z): reverse the loop sense.
                addTri(tb, shell, r1, r0, b0, outward);
                addTri(tb, shell, r1, b0, b1, outward);
            }
        }
    };
    auto buildSolidCap = [&](const std::vector<Vertex*>& rim, const Vec3& outward,
                             bool flip) {
        // No bore: a simple polygon fan from rim[0]. Each tri planar => exact.
        for (std::size_t t = 1; t + 1 < P; ++t) {
            if (!flip) addTri(tb, shell, rim[0], rim[t], rim[t + 1], outward);
            else       addTri(tb, shell, rim[0], rim[t + 1], rim[t], outward);
        }
    };

    if (hasBore) {
        buildAnnularCap(oBot, iBot, Vec3{0, 0, -1}, /*flip=*/true);   // bottom
        buildAnnularCap(oTop, iTop, Vec3{0, 0,  1}, /*flip=*/false);  // top
    } else {
        buildSolidCap(oBot, Vec3{0, 0, -1}, /*flip=*/true);
        buildSolidCap(oTop, Vec3{0, 0,  1}, /*flip=*/false);
    }

    // --- validate -----------------------------------------------------------
    if (!tb.isClosedTwoManifold()) {
        R.reason = "gear: assembled solid is not a closed 2-manifold (edge-mate wiring failed)";
        return R;
    }
    MassProps mp = massProperties(*solid, 8);
    if (!(mp.volume > 0.0)) {
        R.reason = "gear: non-positive volume (inverted shell)";
        return R;
    }

    EulerCounts c = tb.counts();
    R.ok = true;
    R.solid = solid;
    R.volume = mp.volume;
    R.area = mp.area;
    R.vertices = c.vertices;
    R.edges = c.edges;
    R.faces = c.faces;
    R.closedManifold = true;
    R.reason = "";
    return R;
}

} // namespace brep
} // namespace native
} // namespace forge
