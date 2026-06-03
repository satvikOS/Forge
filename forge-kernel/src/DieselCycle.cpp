// Forge-277 — implementation; see header for derivation references.

#include "forge/DieselCycle.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::dieselcycle {

constexpr double R_AIR_KJ_KGK = 0.287;

Result analyse(const Input& in) {
    if (in.compressionRatio <= 1.0)
        throw std::runtime_error("compressionRatio must be > 1");
    if (in.cutoffRatio < 1.0)
        throw std::runtime_error("cutoffRatio must be ≥ 1");
    if (in.cutoffRatio >= in.compressionRatio)
        throw std::runtime_error("cutoffRatio must be < compressionRatio");
    if (in.intakeTemperatureK <= 0.0)
        throw std::runtime_error("intakeTemperatureK must be > 0");
    if (in.intakePressureKPa <= 0.0)
        throw std::runtime_error("intakePressureKPa must be > 0");
    if (in.specificHeatRatio <= 1.0)
        throw std::runtime_error("specificHeatRatio must be > 1");

    const double r     = in.compressionRatio;
    const double rc    = in.cutoffRatio;
    const double T1    = in.intakeTemperatureK;
    const double p1    = in.intakePressureKPa;
    const double gamma = in.specificHeatRatio;

    const double cV = R_AIR_KJ_KGK / (gamma - 1.0);
    const double cP = gamma * cV;

    const double T2 = T1 * std::pow(r, gamma - 1.0);
    const double p2 = p1 * std::pow(r, gamma);
    const double T3 = T2 * rc;
    const double p3 = p2;                            // constant-pressure 2→3
    const double T4 = T3 * std::pow(rc / r, gamma - 1.0);
    const double p4 = p3 * std::pow(rc / r, gamma);

    const double v1 = R_AIR_KJ_KGK * T1 / p1;
    const double v2 = v1 / r;

    const double q_in  = cP * (T3 - T2);
    const double q_out = cV * (T4 - T1);
    const double w_net = q_in - q_out;

    // Closed-form Diesel efficiency:
    //   η = 1 − (1 / r^(γ−1)) · (r_c^γ − 1) / (γ · (r_c − 1))
    // Special-case r_c → 1 (Otto limit) — keep the L’Hospital form 1 − r^(−(γ−1)).
    double eta;
    if (std::abs(rc - 1.0) < 1e-12) {
        eta = 1.0 - std::pow(r, -(gamma - 1.0));
    } else {
        eta = 1.0 - std::pow(r, -(gamma - 1.0))
                    * (std::pow(rc, gamma) - 1.0)
                    / (gamma * (rc - 1.0));
    }

    const double MEP = w_net / (v1 - v2);

    Result r_;
    r_.cVKJkgK                  = cV;
    r_.cPKJkgK                  = cP;
    r_.t2K                      = T2;
    r_.t3K                      = T3;
    r_.t4K                      = T4;
    r_.p2KPa                    = p2;
    r_.p3KPa                    = p3;
    r_.p4KPa                    = p4;
    r_.specificVolume1M3kg      = v1;
    r_.specificVolume2M3kg      = v2;
    r_.qInKJkg                  = q_in;
    r_.qOutKJkg                 = q_out;
    r_.wNetKJkg                 = w_net;
    r_.thermalEfficiency        = eta;
    r_.meanEffectivePressureKPa = MEP;
    return r_;
}

}  // namespace forge::dieselcycle
