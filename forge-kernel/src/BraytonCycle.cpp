// Forge-278 — implementation; see header for derivation references.

#include "forge/BraytonCycle.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::brayton {

constexpr double R_AIR_KJ_KGK = 0.287;

Result analyse(const Input& in) {
    if (in.pressureRatio <= 1.0)
        throw std::runtime_error("pressureRatio must be > 1");
    if (in.intakeTemperatureK <= 0.0)
        throw std::runtime_error("intakeTemperatureK must be > 0");
    if (in.intakePressureKPa <= 0.0)
        throw std::runtime_error("intakePressureKPa must be > 0");
    if (in.turbineInletTemperatureK <= in.intakeTemperatureK)
        throw std::runtime_error("turbineInletTemperatureK must be > T_1");
    if (in.specificHeatRatio <= 1.0)
        throw std::runtime_error("specificHeatRatio must be > 1");
    if (in.compressorIsentropicEff <= 0.0 || in.compressorIsentropicEff > 1.0)
        throw std::runtime_error("compressorIsentropicEff must be in (0, 1]");
    if (in.turbineIsentropicEff <= 0.0 || in.turbineIsentropicEff > 1.0)
        throw std::runtime_error("turbineIsentropicEff must be in (0, 1]");

    const double rp    = in.pressureRatio;
    const double T1    = in.intakeTemperatureK;
    const double p1    = in.intakePressureKPa;
    const double T3    = in.turbineInletTemperatureK;
    const double gamma = in.specificHeatRatio;
    const double eta_c = in.compressorIsentropicEff;
    const double eta_t = in.turbineIsentropicEff;

    const double cV = R_AIR_KJ_KGK / (gamma - 1.0);
    const double cP = gamma * cV;

    const double exp_ratio = (gamma - 1.0) / gamma;

    const double T2s = T1 * std::pow(rp, exp_ratio);
    const double T2  = T1 + (T2s - T1) / eta_c;
    const double p2  = p1 * rp;
    const double p3  = p2;                      // constant-pressure combustor
    const double T4s = T3 * std::pow(rp, -exp_ratio);
    const double T4  = T3 - eta_t * (T3 - T4s);
    const double p4  = p1;                      // constant-pressure exhaust

    if (T2 >= T3)
        throw std::runtime_error("compressor outlet T_2 ≥ T_3 — no combustion possible");

    const double w_c = cP * (T2 - T1);
    const double w_t = cP * (T3 - T4);
    const double q_in  = cP * (T3 - T2);
    const double q_out = cP * (T4 - T1);
    const double w_net = w_t - w_c;
    const double eta   = w_net / q_in;
    const double BWR   = w_c / w_t;

    Result r;
    r.cPKJkgK              = cP;
    r.t2sK                 = T2s;
    r.t2K                  = T2;
    r.t3K                  = T3;
    r.t4sK                 = T4s;
    r.t4K                  = T4;
    r.p2KPa                = p2;
    r.p3KPa                = p3;
    r.p4KPa                = p4;
    r.compressorWorkKJkg   = w_c;
    r.turbineWorkKJkg      = w_t;
    r.qInKJkg              = q_in;
    r.qOutKJkg             = q_out;
    r.wNetKJkg             = w_net;
    r.thermalEfficiency    = eta;
    r.backWorkRatio        = BWR;
    return r;
}

}  // namespace forge::brayton
