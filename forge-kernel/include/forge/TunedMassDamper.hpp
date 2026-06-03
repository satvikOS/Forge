// Forge-265 — Tuned mass damper (Den Hartog 1947).
//
// For a harmonically excited primary mass m_p with natural frequency
// ω_p attached to an auxiliary "absorber" mass m_a via a spring k_a
// (and viscous damper c_a), Den Hartog showed the following optima
// for minimising the peak transmissibility at the primary mass:
//
//   μ      = m_a / m_p                      (mass ratio)
//   f_opt  = ω_a / ω_p = 1 / (1 + μ)         (frequency ratio)
//   ζ_opt  = √(3·μ / (8·(1 + μ)³))           (absorber damping ratio)
//   TR_peak ≈ √(2/(2 + μ))·(1+μ) ≈ √((1+μ)/μ)  (Den Hartog form, broadband)
//
// Practical sizing: given m_p, ω_p, choose μ ∈ [0.05, 0.20], then
//   m_a = μ·m_p
//   ω_a = f_opt·ω_p
//   k_a = m_a·ω_a²
//   c_a = 2·ζ_opt·m_a·ω_a

#pragma once

namespace forge::tmd {

struct SizingInput {
    double primaryMassKg;        // m_p
    double primaryFrequencyHz;   // f_p (Hz, primary natural frequency)
    double massRatio;             // μ  (auxiliary / primary mass)
};

struct SizingResult {
    double absorberMassKg;
    double frequencyRatioOptimum;        // f_opt
    double dampingRatioOptimum;          // ζ_opt
    double absorberStiffnessNPerM;       // k_a
    double absorberDampingNsm;           // c_a
    double absorberFrequencyHz;          // f_a
    double peakTransmissibility;
};

SizingResult sizeAbsorber(const SizingInput& in);

}  // namespace forge::tmd
