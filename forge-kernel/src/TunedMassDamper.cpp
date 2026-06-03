// Forge-265 — Tuned mass damper implementation.

#include "forge/TunedMassDamper.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::tmd {

namespace {
constexpr double pi = std::numbers::pi;
}

SizingResult sizeAbsorber(const SizingInput& in) {
    if (in.primaryMassKg <= 0.0)
        throw std::invalid_argument("primary mass must be > 0");
    if (in.primaryFrequencyHz <= 0.0)
        throw std::invalid_argument("primary frequency must be > 0");
    if (in.massRatio <= 0.0 || in.massRatio > 1.0)
        throw std::invalid_argument("μ must be in (0, 1]");

    SizingResult r{};
    const double mu = in.massRatio;
    const double omega_p = 2.0 * pi * in.primaryFrequencyHz;

    r.absorberMassKg = mu * in.primaryMassKg;
    r.frequencyRatioOptimum = 1.0 / (1.0 + mu);
    r.dampingRatioOptimum = std::sqrt(3.0 * mu / (8.0 * std::pow(1.0 + mu, 3.0)));

    const double omega_a = r.frequencyRatioOptimum * omega_p;
    r.absorberFrequencyHz = omega_a / (2.0 * pi);
    r.absorberStiffnessNPerM = r.absorberMassKg * omega_a * omega_a;
    r.absorberDampingNsm = 2.0 * r.dampingRatioOptimum
                          * r.absorberMassKg * omega_a;
    // Peak transmissibility at Den Hartog tuning: TR ≈ √((1+μ)/μ)·(some const).
    // Common closed form: TR_peak = √(1 + 2/μ).
    r.peakTransmissibility = std::sqrt(1.0 + 2.0 / mu);
    return r;
}

}  // namespace forge::tmd
