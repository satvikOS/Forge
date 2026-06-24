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
// GearSpec — the defining parameters of a standard external involute spur gear.
// ---------------------------------------------------------------------------
struct GearSpec {
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
};

// ---------------------------------------------------------------------------
// GearGeometry — the derived standard-gear dimensions (closed form), filled by
// gearDimensions(). All radii in model units; angles in radians.
// ---------------------------------------------------------------------------
struct GearGeometry {
    double pitchDiameter = 0.0;  // d  = m*N         (EXACT)
    double pitchRadius   = 0.0;  // rp = d/2
    double baseRadius    = 0.0;  // r_base = rp*cos(alpha)
    double addendumRadius= 0.0;  // ra = rp + m
    double rootRadius    = 0.0;  // rf = rp - 1.25*m
    double circularPitch = 0.0;  // p  = pi*m
    double toothAngle    = 0.0;  // 2*pi/N  (angular pitch per tooth)
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
// buildGear — the part op. Build the standard external involute spur gear solid.
// ===========================================================================
//
// 1. derive the standard dimensions (gearDimensions),
// 2. assemble the full toothed outer rim from N involute-tooth profiles placed by
//    the EXACT circular-pattern rotations (Pattern::patternTransforms, Circular),
// 3. extrude that closed profile to the face width as a prism: bottom + top
//    ANNULAR caps (the bore is an inner loop on each cap), and one planar side
//    wall per outer-profile edge (analytic Plane) + one Cylinder bore wall,
// 4. validate closed-2-manifold + strictly-positive divergence-theorem volume.
//
// Returns GearResult; on the first structural failure returns ok=false with the
// failing reason (never a wrong solid).
GearResult buildGear(const GearSpec& spec);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_GEAR_HPP
