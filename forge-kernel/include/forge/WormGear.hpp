// Forge-290 — Worm gear drive (Shigley §13 / AGMA 6034-B92).
//
// A worm gear pair offers large speed reduction (typical i = 20–100) in a
// single stage, with the worm (screw-like driver) meshing with the worm
// wheel (gear). Used in elevators, conveyor drives, packaging machines,
// and any application needing high reduction with self-locking optional.
//
//   Velocity ratio:      i = N_g / N_w
//   Lead:                L = N_w · m_axial · π     (m_axial = worm axial module)
//   Lead angle:          γ = arctan( L / (π · d_w) ) = arctan( N_w · m / d_w )
//   Gear pitch diameter: d_g = N_g · m
//   Centre distance:     C   = (d_w + d_g) / 2
//   Sliding velocity:    V_s = π · d_w · n_w / (60 · 1000 · cos γ)    [m/s]
//   Friction angle:      φ   = arctan(μ)
//   Efficiency (forward, worm driving):
//       η_f = tan γ / tan(γ + φ)
//   Self-locking when φ > γ (worm cannot be back-driven — desired for
//   elevators / hoists, undesired where reverse drive is needed).
//   Output torque (worm driving):
//       T_g = T_w · i · η_f
//   Output speed:        n_g = n_w / i
//
// SI throughout. Module mm, diameter mm, speed rpm, torque N·m.

#pragma once

namespace forge::wormgear {

struct Input {
    double moduleMm;             // axial module of worm = tangential module of gear
    int    wormStarts;           // N_w (1, 2, 3, 4 typical)
    int    gearTeeth;            // N_g (≥ 24 typical for non-Hindley worms)
    double wormPitchDiameterMm;  // d_w (designer's choice — typical ψ = d_w/m = 8-12)
    double frictionCoefficient;  // μ
    double inputSpeedRpm;        // n_w
    double inputTorqueNm;        // T_w
};

struct Result {
    double velocityRatio;        // i
    double leadMm;               // L
    double leadAngleDeg;         // γ
    double frictionAngleDeg;     // φ
    double gearPitchDiameterMm;  // d_g
    double centreDistanceMm;     // C
    double slidingVelocityMs;    // V_s
    double efficiencyPct;        // η_f · 100
    double outputSpeedRpm;       // n_g
    double outputTorqueNm;       // T_g
    bool   selfLocking;          // φ > γ
};

Result analyse(const Input& in);

}  // namespace forge::wormgear
