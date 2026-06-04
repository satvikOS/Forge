// Forge-314 — implementation; see header for derivation references.

#include "forge/AirPipe.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::airpipe {

namespace {

double nextStandardDN(double requested_mm) {
    static const double DN[] = {
        15.0, 20.0, 25.0, 32.0, 40.0, 50.0, 65.0, 80.0,
       100.0,125.0,150.0,200.0,250.0,300.0,400.0,500.0,
    };
    for (double d : DN)
        if (d >= requested_mm) return d;
    return 600.0;
}

}  // namespace

Result analyse(const Input& in) {
    if (in.supplyPressureBarGauge <= 0.0)
        throw std::runtime_error("supplyPressureBarGauge must be > 0");
    if (in.freeAirDeliveryM3PerMin <= 0.0)
        throw std::runtime_error("freeAirDeliveryM3PerMin must be > 0");
    if (in.velocityLimitMs <= 0.0)
        throw std::runtime_error("velocityLimitMs must be > 0");
    if (in.pipeLengthM <= 0.0)
        throw std::runtime_error("pipeLengthM must be > 0");

    constexpr double PI         = 3.141592653589793;
    constexpr double p_atm_bar  = 1.013;
    constexpr double rho_atm    = 1.225;        // kg/m³ at 15 °C, 1.013 bar

    const double p_abs = in.supplyPressureBarGauge + p_atm_bar;
    const double pratio = p_abs / p_atm_bar;
    const double Q_fad_s = in.freeAirDeliveryM3PerMin / 60.0;   // m³/s
    const double Q_line  = Q_fad_s / pratio;                    // Boyle
    const double rho     = rho_atm * pratio;                     // kg/m³

    const double A_req = Q_line / in.velocityLimitMs;            // m²
    const double D_req = std::sqrt(4.0 * A_req / PI) * 1000.0;   // mm
    const double DN    = nextStandardDN(D_req);
    const double D_m   = DN / 1000.0;
    const double A_act = 0.25 * PI * D_m * D_m;
    const double V     = Q_line / A_act;

    constexpr double f = 0.02;
    const double dPdL_Pa_per_m = f * rho * V * V / (2.0 * D_m);
    const double dP_per_100 = dPdL_Pa_per_m * 100.0 / 1.0e5;
    const double dP_total   = dPdL_Pa_per_m * in.pipeLengthM / 1.0e5;

    Result r;
    r.absolutePressureBar       = p_abs;
    r.actualVolumeFlowM3PerS    = Q_line;
    r.airDensityKgPerM3         = rho;
    r.requiredAreaMm2           = A_req * 1.0e6;
    r.requiredDiameterMm        = D_req;
    r.standardDN                = DN;
    r.actualVelocityMs          = V;
    r.pressureDropBarPer100m    = dP_per_100;
    r.totalPressureDropBar      = dP_total;
    return r;
}

}  // namespace forge::airpipe
