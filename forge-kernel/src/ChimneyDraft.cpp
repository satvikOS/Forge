#include "forge/ChimneyDraft.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::chimney {

Result analyse(const Input& in) {
    if (in.stackHeightM <= 0) throw std::runtime_error("h > 0");
    if (in.flueDiameterM <= 0) throw std::runtime_error("D > 0");
    if (in.flueGasTempC <= in.ambientTempC)
        throw std::runtime_error("flue > ambient temperature");
    if (in.flueMassFlowKgPerS <= 0) throw std::runtime_error("ṁ > 0");
    if (in.atmPressureKPa <= 0) throw std::runtime_error("p_atm > 0");

    constexpr double R = 287.0;
    constexpr double g = 9.80665;
    constexpr double PI = 3.141592653589793;
    constexpr double f = 0.025;        // commercial brick stack typical

    const double p = in.atmPressureKPa * 1000.0;
    const double rho_amb = p / (R * (in.ambientTempC + 273.15));
    const double rho_flue = p / (R * (in.flueGasTempC + 273.15));

    const double dP_avail = g * in.stackHeightM * (rho_amb - rho_flue);
    const double A = 0.25 * PI * in.flueDiameterM * in.flueDiameterM;
    const double V = in.flueMassFlowKgPerS / (rho_flue * A);
    const double dP_f = f * (in.stackHeightM / in.flueDiameterM)
                      * 0.5 * rho_flue * V * V;
    const double dP_net = dP_avail - dP_f;

    Result r;
    r.rhoAmbient        = rho_amb;
    r.rhoFlue           = rho_flue;
    r.availableDraftPa  = dP_avail;
    r.flueVelocityMs    = V;
    r.frictionLossPa    = dP_f;
    r.netDraftPa        = dP_net;
    r.draftAdequate     = dP_net > 5.0;
    return r;
}

}  // namespace forge::chimney
