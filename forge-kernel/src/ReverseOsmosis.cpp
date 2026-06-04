// Forge-320d — see header.

#include "forge/ReverseOsmosis.hpp"

#include <stdexcept>

namespace forge::ro {

Result analyse(const Input& in) {
    if (in.feedFlowLpm <= 0.0)
        throw std::runtime_error("feedFlowLpm must be > 0");
    if (in.recoveryFraction <= 0.0 || in.recoveryFraction >= 1.0)
        throw std::runtime_error("recoveryFraction must be in (0, 1)");
    if (in.feedTdsPpm < 0.0)
        throw std::runtime_error("feedTdsPpm must be ≥ 0");
    if (in.appliedPressureBar <= 0.0)
        throw std::runtime_error("appliedPressureBar must be > 0");
    if (in.temperatureC < -20.0 || in.temperatureC > 100.0)
        throw std::runtime_error("temperatureC must be in (-20, 100)");
    if (in.vantHoffFactorI <= 0.0)
        throw std::runtime_error("vantHoffFactorI must be > 0");

    const double Q_perm  = in.feedFlowLpm * in.recoveryFraction;
    const double Q_conc  = in.feedFlowLpm - Q_perm;
    const double CF      = 1.0 / (1.0 - in.recoveryFraction);
    const double brine   = in.feedTdsPpm * CF;
    const double avgTds  = (in.feedTdsPpm + brine) / 2.0;

    // Empirical: 80 kPa per 1000 ppm NaCl at 25 °C scaled linearly by van't Hoff i
    // and by absolute temperature ratio.
    constexpr double T_ref_K = 298.15;
    const double T_K = in.temperatureC + 273.15;
    const double pi_avg = 0.080 * avgTds * (in.vantHoffFactorI / 2.0) * (T_K / T_ref_K);  // kPa

    const double NDP = in.appliedPressureBar * 100.0 - pi_avg;     // bar→kPa minus π

    Result r;
    r.permeateFlowLpm             = Q_perm;
    r.concentrateFlowLpm          = Q_conc;
    r.concentrationFactor         = CF;
    r.brineTdsPpm                 = brine;
    r.averageOsmoticPressureKpa   = pi_avg;
    r.netDrivingPressureKpa       = NDP;
    r.pressureSufficient          = NDP > 0.0;
    return r;
}

}  // namespace forge::ro
