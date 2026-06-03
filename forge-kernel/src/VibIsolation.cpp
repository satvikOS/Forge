// Forge-260 — Vibration isolation implementation.

#include "forge/VibIsolation.hpp"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::vibiso {

namespace {
constexpr double pi = std::numbers::pi;
}

ResponseResult response(const ResponseInput& in) {
    if (in.massKg <= 0.0) throw std::invalid_argument("mass must be > 0");
    if (in.stiffnessNPerM <= 0.0) throw std::invalid_argument("k must be > 0");
    if (in.dampingCoefficientNsm < 0.0) throw std::invalid_argument("c must be ≥ 0");
    if (in.drivingFrequencyHz < 0.0) throw std::invalid_argument("f must be ≥ 0");

    ResponseResult r{};
    const double omega_n = std::sqrt(in.stiffnessNPerM / in.massKg);
    r.naturalFrequencyHz = omega_n / (2.0 * pi);
    const double c_crit = 2.0 * std::sqrt(in.stiffnessNPerM * in.massKg);
    r.dampingRatio = in.dampingCoefficientNsm / c_crit;
    const double omega_drive = 2.0 * pi * in.drivingFrequencyHz;
    r.frequencyRatio = omega_drive / omega_n;
    const double zr = 2.0 * r.dampingRatio * r.frequencyRatio;
    const double zr2 = zr * zr;
    const double num = 1.0 + zr2;
    const double denom = (1.0 - r.frequencyRatio * r.frequencyRatio)
                       * (1.0 - r.frequencyRatio * r.frequencyRatio) + zr2;
    r.transmissibility = std::sqrt(num / denom);
    r.isolationPct = std::max(0.0, 100.0 * (1.0 - r.transmissibility));
    return r;
}

SizingResult sizeIsolator(const SizingInput& in) {
    if (in.massKg <= 0.0) throw std::invalid_argument("mass must be > 0");
    if (in.drivingFrequencyHz <= 0.0) throw std::invalid_argument("f must be > 0");
    if (in.targetIsolationPct <= 0.0 || in.targetIsolationPct >= 100.0)
        throw std::invalid_argument("isolation must be in (0, 100)");
    if (in.dampingRatio < 0.0) throw std::invalid_argument("ζ must be ≥ 0");

    SizingResult r{};
    const double TR_target = 1.0 - in.targetIsolationPct / 100.0;
    // Undamped approximation: TR = 1/(r² − 1) for r > √2.
    //   r² = 1 + 1/TR_target.
    const double r2 = 1.0 + 1.0 / TR_target;
    r.requiredFrequencyRatio = std::sqrt(r2);
    const double omega_drive = 2.0 * pi * in.drivingFrequencyHz;
    const double omega_n = omega_drive / r.requiredFrequencyRatio;
    r.requiredNaturalFrequencyHz = omega_n / (2.0 * pi);
    r.requiredStiffnessNPerM = in.massKg * omega_n * omega_n;
    return r;
}

}  // namespace forge::vibiso
