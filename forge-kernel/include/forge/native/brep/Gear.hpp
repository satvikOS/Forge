// forge/native/brep/Gear.hpp
//
// IN-HOUSE KERNEL — STANDARD EXTERNAL INVOLUTE SPUR GEAR generator on the Forge
// native B-rep. A real mechanical part (CADGenBench carries a planetary-gear part
// type): given the gear's defining parameters it produces ONE closed, oriented
// 2-manifold ANALYTIC brep::Solid whose cross-section is the EXACT involute tooth
// profile, with a central bore.
//
// It builds ON TOP of, and REUSES (no re-derivation):
//   * TopologyBuilder (Topology.hpp)  — makeVertex/Face/Shell/Solid,
//                                       addOuterLoopToFace / addInnerLoopToFace
//                                       (shared-edge mating), isClosedTwoManifold,
//   * SolidFactory  (Primitives.hpp)  — owns the builder + the analytic surfaces,
//   * Surface       (Surface.hpp)     — SurfaceKind::Plane / Cylinder analytic
//                                       face geometry (point/partials/normal),
//   * Pattern       (Pattern.hpp)     — patternTransforms(Circular): the EXACT
//                                       rigid rotation enumeration about the gear
//                                       axis used to place all N teeth (the same
//                                       circular-pattern machinery a bolt circle
//                                       uses), and
//   * MassProps     (MassProps.hpp)   — massProperties() divergence-theorem volume.
//
// ============================ GEAR GEOMETRY (the real spur-gear math) ========
// A standard external involute spur gear with:
//   * module        m      (mm of pitch diameter per tooth),
//   * tooth count   N,
//   * pressure angle alpha (rad; the 20° standard),
//   * face width    w      (axial thickness),
//   * bore radius   rb     (central through-hole radius).
//
// Derived (ISO/AGMA standard full-depth proportions):
//   pitch diameter   d  = m * N           => pitch radius  rp = d/2 = m*N/2
//   base circle      r_base = rp * cos(alpha)
//   addendum         a  = 1*m             => addendum radius  ra = rp + m
//   dedendum         b  = 1.25*m          => dedendum radius   rf = rp - 1.25*m
//   circular pitch   p  = pi*m            (arc on the pitch circle per tooth)
//   tooth thickness on the pitch circle = p/2  (= half the pitch).
//
// The flank is the INVOLUTE OF THE BASE CIRCLE. With the unrolling parameter
// `t` (radians of base-circle arc unrolled), the right flank of the centred tooth
// is the closed-form involute:
//
//     x(t) = r_base * ( cos t + t * sin t )
//     y(t) = r_base * ( sin t - t * cos t )
//
// Its polar radius is  r(t) = r_base * sqrt(1 + t^2)  and its involute ("roll" /
// pressure) angle is  inv(t) = t - atan(t)  =  tan(phi) - phi  at the pressure
// angle phi where cos(phi) = r_base / r.  The DEFINING involute identity this
// generator and its gate use is the tangent-line / base-arc equality: the length
// of the taut string (the line from the involute point tangent to the base
// circle) equals the base-circle arc it has unrolled,
//
//     | involute_point - tangent_contact_on_base_circle |  ==  r_base * t,
//
// which is exactly the analytic relation the closed form above guarantees.
//
// The tooth flank runs from the base circle (t = 0) out to the addendum circle
// (t = t_a where r_base*sqrt(1+t_a^2) = ra). Below the base circle the flank is
// completed by a radial / root fillet down to the dedendum (root) circle, and the
// gap between adjacent teeth is closed by a root arc on the dedendum circle. The
// two flanks of one tooth are mirror images across the tooth's centre line, placed
// so the tooth thickness measured on the pitch circle equals p/2.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL geometry only, pure C++20 + stdlib (no new deps, no OCCT, no WASM).
// ADDITIVE: a brand-new header + TU; Topology / Surface / Pattern / Boolean /
// Primitives / MassProps are NOT edited, and binding.cpp / CMakeLists / the native
// gate are NOT touched (the parent batches those at the train pause).
//
// HONEST SCOPE of THIS increment (the rest are NAMED follow-ups, not faked here):
//   * STANDARD EXTERNAL involute spur gear, CONSTANT module, full-depth 20°-class
//     proportions, parameterised pressure angle, with a simple root arc + radial
//     root fillet. The tooth FLANK is the exact closed-form involute of the base
//     circle (verified vs the parametric x(t),y(t) to <= 1e-9 in the gate).
//   * The solid is built as a SINGLE extruded toothed cross-section: the full
//     outer profile (N teeth assembled by the EXACT circular-pattern rotations
//     from Pattern.hpp) is one closed outer loop, the bore is one inner loop; the
//     profile is extruded to the face width with planar annular caps and planar
//     flank side walls. Every face carries an analytic Surface, so the
//     divergence-theorem volume is exact for this prismatic body.
//
// NAMED FOLLOW-UPS (explicitly NOT in this increment): HELICAL gears (the profile
// twists along the axis), BEVEL gears (conical), INTERNAL (ring) gears, PROFILE
// SHIFT / non-standard addendum, trochoidal hob-generated root fillets, undercut
// detection, backlash/tip-relief modification, and a true involute-NURBS flank
// SURFACE (here the flank is a fine analytic-involute polyline extruded to planar
// micro-facets — volume-exact for the prism, faceted on the flank, stated plainly).
//
// CONVENTIONS: namespace forge::native::brep. The gear axis is +Z, the gear is
// centred on the origin, the bottom face on z=0 and the top face on z=w.

#ifndef FORGE_NATIVE_BREP_GEAR_HPP
#define FORGE_NATIVE_BREP_GEAR_HPP

#include <memory>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Point3, TopologyBuilder, Solid
#include "forge/native/brep/Primitives.hpp" // SolidFactory (owns builder + surfaces)
#include "forge/native/brep/Nurbs.hpp"      // Vec3

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// GearType — the gear FAMILY this spec describes (ADDITIVE; External is the
// original, unchanged behaviour and the default so every existing caller is
// byte-identical). The gear-family completion for the CADGenBench planetary-gear
// part type adds the two meshing partners of a planet:
//   * External — a standard external involute spur gear (teeth point OUTWARD).
//   * Internal — a RING gear: an annular rim whose teeth point INWARD; the tooth
//                space is the external-tooth shape, the rim is solid OUTSIDE the
//                (inward) addendum. This is the ring that a planet meshes against.
//   * Bevel    — a STRAIGHT bevel gear: the involute profile lies on the BACK
//                CONE (pitch-cone angle) and the teeth taper toward the apex.
//
// HONEST SCOPE of this increment: straight bevel + internal spur. SPIRAL bevel,
// HELICAL-internal and HYPOID are named follow-ups (not faked here).
// ---------------------------------------------------------------------------
enum class GearType {
    External = 0,  // original external involute spur gear (unchanged)
    Internal = 1,  // ring / annulus gear (teeth point inward)
    Bevel    = 2   // straight bevel gear (teeth on the back cone, taper to apex)
};

// ---------------------------------------------------------------------------
// GearSpec — the defining parameters of a standard external involute spur gear.
// ---------------------------------------------------------------------------
struct GearSpec {
    GearType gearType   = GearType::External; // ADDITIVE; default keeps External

    double module       = 2.0;   // m  (mm of pitch diameter per tooth)
    int    teeth        = 20;    // N  (tooth count, >= 4 for a sane involute gear)
    double pressureAngle = 0.34906585039886591; // alpha (rad) = 20 degrees
    double faceWidth    = 10.0;  // w  (axial thickness)
    double boreRadius   = 8.0;   // rb (central through-hole radius; 0 => no bore)

    // Flank tessellation: number of polyline samples along ONE involute flank from
    // the base/root start to the addendum. Higher => finer flank facets (the gate's
    // involute-equation residual is checked on the analytic samples, independent of
    // this count). The mass/volume is exact for the extruded prism regardless.
    int    flankSamples = 24;

    // INTERNAL (ring) gear only: the OUTER rim radius of the annulus (the rim OD/2).
    // The teeth (the inner toothed bore) point inward; the rim is solid from the
    // (outward) dedendum circle out to rimOuterRadius. Must exceed the internal
    // dedendum radius (rp + 1.25*m). 0 => default rp + 2.5*m (a sane rim wall).
    double rimOuterRadius = 0.0;

    // BEVEL gear only: the PITCH-CONE ANGLE gamma (rad) measured from the gear axis
    // to the pitch cone. A 45-degree pitch-cone bevel meshing an equal mate uses
    // gamma = pi/4. The back-cone pitch radius equals m*N/2 (so the back-cone pitch
    // diameter == m*N exactly); faceWidth is the cone-distance band of the teeth
    // (the slant extent from the back cone toward the apex).
    double pitchConeAngle = 0.78539816339744831; // pi/4 = 45 degrees
};

// ---------------------------------------------------------------------------
// GearGeometry — the derived standard-gear dimensions (closed form), filled by
// gearDimensions(). All radii in model units; angles in radians.
// ---------------------------------------------------------------------------
struct GearGeometry {
    double pitchDiameter = 0.0;  // d  = m*N         (EXACT)
    double pitchRadius   = 0.0;  // rp = d/2
    double baseRadius    = 0.0;  // r_base = rp*cos(alpha)
    double addendumRadius= 0.0;  // ra = rp + m       (External/Bevel: outward tip)
                                 //                   (Internal: rp - m, INWARD tip)
    double rootRadius    = 0.0;  // rf = rp - 1.25*m  (External/Bevel: inward root)
                                 //                   (Internal: rp + 1.25*m, OUTWARD root)
    double circularPitch = 0.0;  // p  = pi*m
    double toothAngle    = 0.0;  // 2*pi/N  (angular pitch per tooth)

    // INTERNAL (ring) gear: the solid annular rim's outer radius (rim OD/2). 0 for
    // External/Bevel. For an Internal gear addendumRadius < pitchRadius < rootRadius
    // (the teeth point inward) and rimOuterRadius > rootRadius.
    double rimOuterRadius = 0.0;

    // BEVEL gear: the pitch-cone half-angle gamma (rad). 0 for External/Internal.
    // The BACK-CONE pitch radius equals pitchRadius (so the back-cone pitch diameter
    // == m*N exactly); coneDistance is the slant length from apex to the back cone.
    double pitchConeAngle = 0.0;
    double coneDistance   = 0.0; // R = pitchRadius / sin(gamma)  (apex->back-cone)
};

// Derive the standard full-depth involute-gear dimensions from a spec. Pure math,
// no topology — usable on its own (the gate asserts pitchDiameter == m*N exactly).
GearGeometry gearDimensions(const GearSpec& spec);

// ---------------------------------------------------------------------------
// involutePoint — the EXACT closed-form involute of a circle of radius rBase at
// unrolling parameter t (radians of base-circle arc unrolled). The flank passes
// through (rBase,0) at t=0 and spirals out CCW:
//     x = rBase*(cos t + t sin t),  y = rBase*(sin t - t cos t).
// Returned in the XY plane (z = 0). This IS the parametric form the gate verifies
// the generated flank against to <= 1e-9.
// ---------------------------------------------------------------------------
Vec3 involutePoint(double rBase, double t);

// involuteTangentContact — the point on the base circle where the taut "string"
// of the involute at parameter t is tangent (the unrolling contact). For the
// closed form above this is rBase*(cos t, sin t, 0). The DEFINING involute
// identity is | involutePoint(rBase,t) - involuteTangentContact(rBase,t) | ==
// rBase * t (tangent-line length == unrolled base arc length), which the gate
// asserts to <= 1e-9 over a sweep of t.
Vec3 involuteTangentContact(double rBase, double t);

// involuteParamForRadius — solve r_base*sqrt(1+t^2) == rTarget for t >= 0, i.e.
// the unrolling parameter at which the involute flank reaches polar radius
// rTarget. Closed form: t = sqrt((rTarget/rBase)^2 - 1) for rTarget >= rBase
// (returns 0 if rTarget <= rBase).
double involuteParamForRadius(double rBase, double rTarget);

// ---------------------------------------------------------------------------
// gearToothProfile2D — the closed 2D outline (XY, z=0) of ONE tooth's contribution
// to the gear's outer rim, as an ordered CCW polyline: up the right involute
// flank from the root, across the addendum (tip) arc, down the left (mirror)
// involute flank to the root, then along the root arc to the start of the NEXT
// tooth's right flank. Concatenating this for all N teeth (each rotated by the
// circular-pattern angle k*2pi/N) yields the full closed outer rim. Exposed so the
// gate can verify the involute-equation residual on the actual emitted flank
// points. The tooth is centred on the +X axis (its centre line is +X).
// ---------------------------------------------------------------------------
std::vector<Vec3> gearToothProfile2D(const GearSpec& spec, const GearGeometry& g);

// gearOuterProfile2D — the FULL closed outer rim of the gear: all N tooth profiles
// placed by the exact Pattern circular rotations (k*2pi/N about +Z), returned as
// one ordered CCW ring of XY points (z=0). This is the outer loop that is extruded
// to the face width. `addendumArcCount` (out, optional) reports how many addendum
// (tip) arcs were emitted == the tooth count N (the gate's tooth-count check).
std::vector<Vec3> gearOuterProfile2D(const GearSpec& spec, const GearGeometry& g,
                                     int* addendumArcCount = nullptr);

// ---------------------------------------------------------------------------
// GearResult — the analytic gear solid + its mass-properties / topology signature.
// `solid` is a non-owning view into `owner`; keep `owner` alive while using it.
// `ok` is true only when the result is a closed 2-manifold with strictly positive
// volume — never faked. On any honest refusal ok=false and `reason` explains.
// ---------------------------------------------------------------------------
struct GearResult {
    bool   ok = false;
    Solid* solid = nullptr;               // non-owning view into *owner
    std::shared_ptr<SolidFactory> owner;  // owns topology + surfaces for `solid`

    GearGeometry geometry;                // the derived standard dimensions
    int    toothCount = 0;                // N addendum/tip arcs emitted
    double volume = 0.0;                  // massProperties(solid).volume (exact)
    double area   = 0.0;                  // total surface area
    std::size_t vertices = 0;             // topology signature V
    std::size_t edges    = 0;             //                    E
    std::size_t faces    = 0;             //                    F
    bool   closedManifold = false;        // isClosedTwoManifold()

    const char* reason = "";              // honest failure diagnostic when !ok
};

// ===========================================================================
// buildGear — the part op. Dispatches on spec.gearType:
//   External (default, unchanged) — the standard external involute spur gear:
//     1. derive the standard dimensions (gearDimensions),
//     2. assemble the full toothed outer rim from N involute-tooth profiles placed
//        by the EXACT circular-pattern rotations (Pattern, Circular),
//     3. extrude that closed profile to the face width as a prism: bottom + top
//        ANNULAR caps (bore as inner loop), planar flank side walls + Cylinder bore,
//     4. validate closed-2-manifold + strictly-positive divergence-theorem volume.
//   Internal — buildInternalGear (ring gear; teeth point inward).
//   Bevel    — buildBevelGear (straight bevel; teeth on the back cone, taper).
//
// Returns GearResult; on the first structural failure returns ok=false with the
// failing reason (never a wrong solid).
GearResult buildGear(const GearSpec& spec);

// ---------------------------------------------------------------------------
// buildInternalGear — the RING (internal/annulus) gear. The teeth point INWARD:
// the inner toothed boundary is the involute tooth profile with the addendum at the
// SMALLER radius (ra = rp - m, toward the axis) and the dedendum at the LARGER
// radius (rf = rp + 1.25*m, away from the axis); the rim is SOLID from rf out to
// rimOuterRadius. Built as a prism whose OUTER loop is the plain rim circle and
// whose INNER loop is the N-tooth-space toothed profile, with planar caps, a
// Cylinder rim wall and planar inner toothed walls (normals facing into the void).
// Equivalent to: (rim cylinder of rimOuterRadius) MINUS (N internal-tooth-space
// profile extruded). pitchDiameter == m*N exactly; addendumRadius < pitchRadius.
GearResult buildInternalGear(const GearSpec& spec);

// ---------------------------------------------------------------------------
// buildBevelGear — a STRAIGHT bevel gear. The involute tooth profile lies on the
// BACK CONE at pitch radius rp = m*N/2 (back-cone pitch diameter == m*N exactly),
// and the teeth TAPER toward the apex along the pitch cone (pitchConeAngle gamma).
// Built as a lofted toothed frustum: the back-cone toothed cross-section (large)
// and a geometrically-similar toothed cross-section scaled toward the apex (small)
// are joined by ruled planar side walls, with planar caps + a Cylinder/cone bore.
// The teeth shrink in proportion to the cone radius, so they taper to the apex side.
GearResult buildBevelGear(const GearSpec& spec);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_GEAR_HPP
