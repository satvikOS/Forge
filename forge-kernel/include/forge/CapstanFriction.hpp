// Forge-286 — Eytelwein's belt-friction / capstan equation.
//
//   T_1 / T_2 = e^(μ · θ)
//
// where θ is wrap angle in radians. The equation gives the maximum
// "amplification" a flexible line (rope, belt, hawser, hose) can
// achieve when wrapped around a cylinder (bollard, capstan drum,
// snub pulley, conveyor head pulley) before slipping.
//
// Applications:
//   * Marine: a mooring hawser around a bollard ⇒ small hand pull holds
//     a massive ship (e.g. μ=0.25, θ = 3 turns = 6π rad ⇒ amplification
//     ~1.5e3).
//   * Pulley belt drive: maximum transmittable torque before slip.
//   * Hoist drum: holding force required to anchor a load on a free drum.
//   * Friction conveyor: pulley grip required to prevent belt slip.
//
// For V-belt with groove half-angle α, replace μ with the effective
// friction μ_eff = μ / sin α (already covered in Forge-227 V-belt drive).
//
// All inputs SI. Force in N, angle wrap in degrees.

#pragma once

namespace forge::capstan {

struct Input {
    double holdingForceN;          // T_2 — the smaller (held) side
    double frictionCoefficient;    // μ
    double wrapAngleDeg;           // θ in degrees (multiply revolutions × 360)
};

struct Result {
    double wrapAngleRad;
    double amplificationRatio;     // e^(μ·θ) = T_1 / T_2
    double maxLoadN;               // T_1 = T_2 · amplification
    double mechanicalAdvantage;    // (T_1 − T_2) / T_2 — net lifting capacity
};

Result analyse(const Input& in);

}  // namespace forge::capstan
