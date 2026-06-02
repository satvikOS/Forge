#include "forge/Fatigue.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace fatigue {

Material materialDefaults(const std::string& name) {
    // Conservative typical-of-class values from common references
    // (Shigley's MED + MMPDS-14). Real engineering work should derive
    // from coupon tests — these are starting points for screening.
    if (name == "mild-steel" || name == "1018-steel" || name == "1020-steel") {
        return { 1000.0, -0.085 };
    }
    if (name == "4340-steel") {
        return { 1500.0, -0.095 };
    }
    if (name == "7075-T6" || name == "aluminium-7075") {
        return { 1466.0, -0.143 };
    }
    if (name == "2024-T3" || name == "aluminium-2024") {
        return { 900.0, -0.110 };
    }
    if (name == "Ti-6Al-4V" || name == "ti64") {
        return { 2030.0, -0.104 };
    }
    if (name == "ductile-iron" || name == "65-45-12") {
        return { 850.0, -0.080 };
    }
    throw std::invalid_argument("materialDefaults: unknown material " + name);
}

double cyclesToFailure(double sigma_a, double sigmaF, double b) {
    if (sigma_a <= 0)                    throw std::invalid_argument("cyclesToFailure: σa > 0");
    if (sigmaF  <= 0)                    throw std::invalid_argument("cyclesToFailure: σ'f > 0");
    if (b >= 0 || b <= -1)               throw std::invalid_argument("cyclesToFailure: b ∈ (-1,0)");
    return 0.5 * std::pow(sigma_a / sigmaF, 1.0 / b);
}

Outputs cumulativeDamage(const std::vector<LoadBlock>& blocks,
                         const Material& material) {
    Outputs out{};
    out.perBlock.reserve(blocks.size());
    out.totalDamage = 0.0;
    double worstAmpN = 0.0;
    double worstAmpD = 0.0;
    for (const auto& b : blocks) {
        if (b.appliedCycles < 0) throw std::invalid_argument("cumulativeDamage: appliedCycles ≥ 0");
        const double Nf = cyclesToFailure(b.stressAmplitudeMPa,
                                          material.sigmaFCoef,
                                          material.bExponent);
        const double d = b.appliedCycles / Nf;
        out.perBlock.push_back({ Nf, d });
        out.totalDamage += d;
        if (b.stressAmplitudeMPa > worstAmpD) {
            worstAmpD = b.stressAmplitudeMPa;
            worstAmpN = Nf;
        }
    }
    out.failed = out.totalDamage >= 1.0;
    if (!out.failed && worstAmpN > 0) {
        out.cyclesRemaining = (1.0 - out.totalDamage) * worstAmpN;
    }
    return out;
}

}} // namespace forge::fatigue
