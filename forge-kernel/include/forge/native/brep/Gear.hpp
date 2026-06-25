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
//   * SpiralBevel — a SPIRAL bevel gear: the straight-bevel taper, but the tooth
//                LENGTHWISE trace is a CIRCULAR-ARC spiral on the pitch cone (the
//                standard Gleason approximation). The tooth's lengthwise tangent
//                makes the spiral angle psi_m with the cone radial at the MEAN cone
//                radius; the transverse profile is still the back-cone involute.
//
// HONEST SCOPE of this increment: straight bevel + internal spur + SPIRAL bevel.
// HELICAL-internal and HYPOID remain named follow-ups (not faked here). The spiral
// bevel uses the CIRCULAR-ARC (Gleason) lengthwise spiral and the radially-scaled
// back-cone involute transverse profile (an honest approximation of the exact
// spherical-involute octoid; no crowning / lengthwise tooth-thickness modification).
// ---------------------------------------------------------------------------
enum class GearType {
    External    = 0,  // original external involute spur gear (unchanged)
    Internal    = 1,  // ring / annulus gear (teeth point inward)
    Bevel       = 2,  // straight bevel gear (teeth on the back cone, taper to apex)
    SpiralBevel = 3   // spiral bevel gear (circular-arc Gleason lengthwise spiral)
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

    // BEVEL / SPIRAL-BEVEL gear: the PITCH-CONE ANGLE gamma (rad) measured from the
    // gear axis to the pitch cone. A 45-degree pitch-cone bevel meshing an equal mate
    // uses gamma = pi/4. The back-cone pitch radius equals m*N/2 (so the back-cone
    // pitch diameter == m*N exactly); faceWidth is the cone-distance band of the teeth
    // (the slant extent from the back cone toward the apex).
    double pitchConeAngle = 0.78539816339744831; // pi/4 = 45 degrees

    // SPIRAL-BEVEL gear ONLY: the MEAN SPIRAL ANGLE psi_m (rad) — the angle between
    // the tooth's lengthwise tangent and the cone RADIAL direction, measured at the
    // MEAN cone distance R_m = R - faceWidth/2 (the centre of the toothed band). The
    // tooth centreline is a CIRCULAR ARC in the back-cone development (the standard
    // Gleason approximation) whose tangent makes exactly this angle with the radial at
    // R_m. psi_m = 0 reduces EXACTLY to the straight bevel (the regression anchor).
    // A 35-degree mean spiral angle (the Gleason default) is psi_m = 0.6108652381980153.
    double spiralAngle = 0.6108652381980153; // 35 degrees (Gleason default)
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

    // BEVEL / SPIRAL-BEVEL gear: the pitch-cone half-angle gamma (rad). 0 for
    // External/Internal. The BACK-CONE pitch radius equals pitchRadius (so the
    // back-cone pitch diameter == m*N exactly); coneDistance is the slant length from
    // apex to the back cone.
    double pitchConeAngle = 0.0;
    double coneDistance   = 0.0; // R = pitchRadius / sin(gamma)  (apex->back-cone)

    // SPIRAL-BEVEL gear: the mean spiral angle psi_m (rad), 0 for the others. The
    // tooth lengthwise trace is a circular arc in the back-cone development whose
    // tangent makes psi_m with the cone radial at the mean cone distance R_m. 0 ==
    // straight bevel.
    double spiralAngle    = 0.0;
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
//   Internal    — buildInternalGear (ring gear; teeth point inward).
//   Bevel       — buildBevelGear (straight bevel; teeth on the back cone, taper).
//   SpiralBevel — buildSpiralBevelGear (bevel taper + circular-arc lengthwise spiral).
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

// ---------------------------------------------------------------------------
// buildSpiralBevelGear — a SPIRAL bevel gear. It is the straight-bevel taper
// (buildBevelGear's lofted toothed frustum, teeth on the back cone tapering to the
// apex) with the tooth LENGTHWISE centreline laid out as a CIRCULAR ARC in the
// back-cone development — the standard Gleason spiral-bevel approximation.
//
// CONSTRUCTION (closed form). Lay the pitch cone flat: a point on the cone at
// cone-distance rho (slant length from the apex) and gear-axis angle phi maps to the
// development plane polar point (rho, phi). The tooth lengthwise CENTRELINE is a
// circular arc of radius `a` in that plane; we choose `a` so the arc's tangent makes
// exactly the prescribed spiral angle psi_m with the RADIAL (rho) direction at the
// MEAN cone distance R_m = R - faceWidth/2. For a circular arc, the local spiral
// angle psi(rho) obeys the exact relation
//       rho * sin(psi(rho)) = R_m * sin(psi_m)   (== the arc's constant offset c)
// (the perpendicular distance from the development origin to the arc's tangent line
// is the invariant c = R_m*sin(psi_m)), and the cumulative lengthwise twist of the
// tooth between the back cone (rho=R) and a cone distance rho is
//       Dphi(rho) = ∫_rho^R tan(psi(s))/s ds
//                 = [ acos(c/R) - acos(c/rho) ]   (closed form, c = R_m*sin psi_m).
// Each transverse toothed section at cone distance rho is therefore the radially-
// scaled back-cone involute profile (scale = rho/R, exactly as the straight bevel)
// RIGIDLY ROTATED about the gear axis by Dphi(rho). The two end sections (back cone
// rho=R, small end rho=R-faceWidth) are joined by ruled planar side walls; the spiral
// twist makes the side walls swept rather than straight. psi_m = 0 => c = 0 =>
// Dphi == 0 => this reduces EXACTLY to buildBevelGear (the regression anchor).
//
// The measured spiral angle at the mean cone radius equals the prescribed psi_m to
// machine precision (the gate asserts this from the actual lengthwise tooth tangent).
// pitchDiameter == m*N exactly (back cone); closed 2-manifold; teeth taper to apex.
GearResult buildSpiralBevelGear(const GearSpec& spec);

// ---------------------------------------------------------------------------
// spiralBevelTwist — the closed-form lengthwise twist Dphi(rho) (rad) of the
// Gleason circular-arc spiral between the back cone (rho == coneDistance) and the
// cone distance `rho`, for the SpiralBevel spec/geometry. Dphi(coneDistance) == 0;
// Dphi grows toward the apex. With c = R_m*sin(psi_m), R_m = R - faceWidth/2:
//     Dphi(rho) = acos(c/R) - acos(c/rho).
// Exposed so the gate can MEASURE the spiral angle from the actual lengthwise trace:
// the tooth centreline at cone distance rho sits on the pitch cone at pitch radius
// rp*(rho/R) and gear-axis angle (phi0 + Dphi(rho)); numerically differentiating that
// trace at the MEAN cone distance R_m yields tan(psi) = rho*dphi/drho = c/sqrt(rho^2-c^2),
// i.e. sin(psi(R_m)) == sin(psi_m) EXACTLY. Returns 0 for a non-spiral spec.
double spiralBevelTwist(const GearSpec& spec, const GearGeometry& g, double rho);

// spiralBevelCentrelinePoint — the actual 3D point of a tooth's lengthwise pitch
// centreline at cone distance `rho` (slant from the apex), for the lengthwise angular
// phase `phi0` (rad) of that tooth on the back cone. The point lies on the pitch cone:
//   pitch radius r = rp * (rho / R),  z = (R - rho)*cos(gamma) measured from the back
//   cone (so rho == R gives z == 0, the back-cone section), and gear-axis angle
//   phi0 + spiralBevelTwist(rho). The gate differentiates this trace at the mean cone
//   distance to recover the spiral angle. Matches the as-built solid's section placement.
Vec3 spiralBevelCentrelinePoint(const GearSpec& spec, const GearGeometry& g,
                                double rho, double phi0);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_GEAR_HPP
