// Forge-282 — implementation; see header for derivation references.

#include "forge/ReciprocatingCompressor.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::recipcompressor {

Result analyse(const Input& in) {
    if (in.inletPressurePa <= 0.0)
        throw std::runtime_error("inletPressurePa must be > 0");
    if (in.dischargePressurePa <= in.inletPressurePa)
        throw std::runtime_error("dischargePressurePa must be > inletPressurePa");
    if (in.inletTemperatureK <= 0.0)
        throw std::runtime_error("inletTemperatureK must be > 0");
    if (in.massFlowKgS <= 0.0)
        throw std::runtime_error("massFlowKgS must be > 0");
    if (in.polytropicIndexN < 1.0 || in.polytropicIndexN > 2.0)
        throw std::runtime_error("polytropicIndexN must be in [1, 2]");
    if (in.polytropicEfficiency <= 0.0 || in.polytropicEfficiency > 1.0)
        throw std::runtime_error("polytropicEfficiency must be in (0, 1]");
    if (in.clearanceRatioC < 0.0 || in.clearanceRatioC > 0.5)
        throw std::runtime_error("clearanceRatioC must be in [0, 0.5]");
    if (in.gasConstantJkgK <= 0.0)
        throw std::runtime_error("gasConstantJkgK must be > 0");

    const double p1    = in.inletPressurePa;
    const double T1    = in.inletTemperatureK;
    const double p2    = in.dischargePressurePa;
    const double mdot  = in.massFlowKgS;
    const double n     = in.polytropicIndexN;
    const double eta_p = in.polytropicEfficiency;
    const double c     = in.clearanceRatioC;
    const double R     = in.gasConstantJkgK;

    const double pi = p2 / p1;
    const double iso_head = R * T1 * std::log(pi);

    double T2;
    double H_p;
    double eta_v;

    if (std::abs(n - 1.0) < 1e-9) {
        // Isothermal limit.
        T2    = T1;
        H_p   = iso_head;
        eta_v = 1.0 - c * (pi - 1.0);   // limit of 1 + c − c·π^(1/n) as n → 1 is 1 − c(π−1)
    } else {
        const double exp_pow = (n - 1.0) / n;
        T2    = T1 * std::pow(pi, exp_pow);
        H_p   = (n / (n - 1.0)) * R * T1 * (std::pow(pi, exp_pow) - 1.0);
        eta_v = 1.0 + c - c * std::pow(pi, 1.0 / n);
    }

    const double Pb = mdot * H_p / eta_p;

    Result r;
    r.pressureRatio                  = pi;
    r.dischargeTemperatureK          = T2;
    r.temperatureRiseK               = T2 - T1;
    r.polytropicHeadJkg              = H_p;
    r.volumetricEfficiency           = eta_v;
    r.brakePowerW                    = Pb;
    r.isothermalEquivalentHeadJkg    = iso_head;
    return r;
}

}  // namespace forge::recipcompressor
