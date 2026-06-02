#include "forge/FanBlower.hpp"

#include <stdexcept>

namespace forge { namespace fanblower {

SizeOutputs analyse(const SizeInputs& in) {
    if (in.flowRate <= 0)      throw std::invalid_argument("fan.analyse: Q > 0");
    if (in.deltaPStatic < 0)   throw std::invalid_argument("fan.analyse: Δp_s ≥ 0");
    if (in.density <= 0)       throw std::invalid_argument("fan.analyse: ρ > 0");
    if (in.outletArea <= 0)    throw std::invalid_argument("fan.analyse: A > 0");
    if (in.fanEfficiency <= 0 || in.fanEfficiency > 1)
        throw std::invalid_argument("fan.analyse: η ∈ (0, 1]");

    SizeOutputs out{};
    out.velocityOutlet   = in.flowRate / in.outletArea;
    out.velocityPressure = 0.5 * in.density * out.velocityOutlet * out.velocityOutlet;
    out.totalPressure    = in.deltaPStatic + out.velocityPressure;
    out.hydraulicPower   = in.flowRate * out.totalPressure;
    out.shaftPower       = out.hydraulicPower / in.fanEfficiency;
    return out;
}

AffinityOutputs scaleByAffinity(const AffinityInputs& in) {
    if (in.N1 <= 0)   throw std::invalid_argument("affinity: N_1 > 0");
    if (in.N2 < 0)    throw std::invalid_argument("affinity: N_2 ≥ 0");
    if (in.rho1 <= 0) throw std::invalid_argument("affinity: ρ_1 > 0");
    if (in.rho2 <= 0) throw std::invalid_argument("affinity: ρ_2 > 0");
    const double r = in.N2 / in.N1;
    const double rhoRatio = in.rho2 / in.rho1;
    AffinityOutputs out{};
    out.Q2  = in.Q1 * r;
    out.dP2 = in.dP1 * r * r * rhoRatio;
    out.P2  = in.P1 * r * r * r * rhoRatio;
    return out;
}

}} // namespace forge::fanblower
