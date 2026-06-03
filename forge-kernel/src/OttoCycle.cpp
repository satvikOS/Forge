// Forge-276 — implementation; see header for derivation references.

#include "forge/OttoCycle.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::ottocycle {

constexpr double R_AIR_KJ_KGK = 0.287;   // = R_u / M_air, used to close c_v.

Result analyse(const Input& in) {
    if (in.compressionRatio <= 1.0)
        throw std::runtime_error("compressionRatio must be > 1");
    if (in.intakeTemperatureK <= 0.0)
        throw std::runtime_error("intakeTemperatureK must be > 0");
    if (in.intakePressureKPa <= 0.0)
        throw std::runtime_error("intakePressureKPa must be > 0");
    if (in.peakTemperatureK <= in.intakeTemperatureK)
        throw std::runtime_error("peakTemperatureK must be > intakeTemperatureK");
    if (in.specificHeatRatio <= 1.0)
        throw std::runtime_error("specificHeatRatio must be > 1");

    const double r     = in.compressionRatio;
    const double T1    = in.intakeTemperatureK;
    const double p1    = in.intakePressureKPa;
    const double T3    = in.peakTemperatureK;
    const double gamma = in.specificHeatRatio;

    const double cV    = R_AIR_KJ_KGK / (gamma - 1.0);   // kJ/(kg·K)

    // States via isentropic and constant-volume relations.
    const double T2 = T1 * std::pow(r, gamma - 1.0);
    const double p2 = p1 * std::pow(r, gamma);

    if (T3 <= T2)
        throw std::runtime_error("peakTemperatureK must exceed T_2 (after compression)");

    const double p3 = p2 * (T3 / T2);   // constant-volume heat input
    const double T4 = T3 * std::pow(r, -(gamma - 1.0));
    const double p4 = p3 * std::pow(r, -gamma);

    // Specific volumes (m³/kg) at state 1, 2.
    const double v1 = R_AIR_KJ_KGK * T1 / p1;   // R [kJ/(kg·K)] · T [K] / p [kPa] = m³/kg
    const double v2 = v1 / r;

    const double q_in  = cV * (T3 - T2);                  // kJ/kg
    const double q_out = cV * (T4 - T1);                  // kJ/kg
    const double w_net = q_in - q_out;                    // kJ/kg
    const double eta   = 1.0 - std::pow(r, -(gamma - 1.0));

    // MEP: w_net [kJ/kg] / (v_1 − v_2) [m³/kg] = kJ/m³ = kPa.
    const double MEP = w_net / (v1 - v2);

    Result r_;
    r_.cVKJkgK                  = cV;
    r_.t2K                      = T2;
    r_.t3K                      = T3;
    r_.t4K                      = T4;
    r_.p2KPa                    = p2;
    r_.p3KPa                    = p3;
    r_.p4KPa                    = p4;
    r_.v1OverV2                 = r;
    r_.specificVolume1M3kg      = v1;
    r_.specificVolume2M3kg      = v2;
    r_.qInKJkg                  = q_in;
    r_.qOutKJkg                 = q_out;
    r_.wNetKJkg                 = w_net;
    r_.thermalEfficiency        = eta;
    r_.meanEffectivePressureKPa = MEP;
    return r_;
}

}  // namespace forge::ottocycle
