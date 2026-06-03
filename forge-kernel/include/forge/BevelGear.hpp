// Forge-291 — Straight bevel gear pair (Tredgold approximation + AGMA 2003).
//
// Bevel gears transmit power between intersecting shafts (90 ° is most
// common, but any angle ≥ 5 ° works). The geometry is the truncated cone
// rolled on a mating cone. We expose the standard design-handbook outputs:
//
//   Pitch (large-end) diameters:    d_p = N_p · m,   d_g = N_g · m
//   Pinion cone angle (90 ° shafts): γ_p = arctan(N_p / N_g)
//   Gear cone angle:                 γ_g = 90 ° − γ_p
//   Cone distance:                    R   = √((d_p/2)² + (d_g/2)²)
//   Mean cone radius (centroid of tooth):
//       r_m_p = (R − F/2) · sin γ_p
//   Tredgold equivalent spur gear teeth (used to look up Lewis form factor):
//       N_ep = N_p / cos γ_p,    N_eg = N_g / cos γ_g
//
// Force resolution on the pinion at mean radius (φ_n = normal pressure
// angle, typically 20 ° for straight-bevel; for spiral-bevel substitute the
// transverse component):
//       W_t = T_p / r_m_p                    (tangential)
//       W_r = W_t · tan φ_n · cos γ_p        (radial — toward pinion axis)
//       W_a = W_t · tan φ_n · sin γ_p        (axial — along pinion axis)
//
// SI units throughout. m mm, F mm, T_p N·m, output W in N.

#pragma once

namespace forge::bevelgear {

struct Input {
    double moduleMm;            // m  (axial / large-end module)
    int    pinionTeeth;         // N_p
    int    gearTeeth;           // N_g
    double faceWidthMm;         // F
    double pressureAngleDeg;    // φ_n (normal pressure angle)
    double pinionTorqueNm;      // T_p
};

struct Result {
    double gearRatio;                 // i = N_g / N_p
    double pinionConeAngleDeg;        // γ_p
    double gearConeAngleDeg;          // γ_g
    double pinionPitchDiameterMm;     // d_p (large end)
    double gearPitchDiameterMm;       // d_g
    double coneDistanceMm;            // R
    double pinionMeanRadiusMm;        // r_m_p
    double equivalentPinionTeeth;     // N_ep
    double equivalentGearTeeth;       // N_eg
    double tangentialForceN;          // W_t
    double radialForceN;              // W_r
    double axialForceN;               // W_a
};

Result analyse(const Input& in);

}  // namespace forge::bevelgear
