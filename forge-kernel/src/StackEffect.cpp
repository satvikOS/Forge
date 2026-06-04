#include "forge/StackEffect.hpp"

#include <stdexcept>

namespace forge::stackeffect {

Result analyse(const Input& in) {
    if (in.stackHeightM <= 0.0) throw std::runtime_error("stackHeightM > 0");
    if (in.indoorTempC < -100.0 || in.indoorTempC > 1000.0)
        throw std::runtime_error("indoorTempC out of range");
    if (in.outdoorTempC < -100.0 || in.outdoorTempC > 1000.0)
        throw std::runtime_error("outdoorTempC out of range");
    if (in.atmPressureKPa <= 0.0) throw std::runtime_error("atmPressureKPa > 0");

    constexpr double R = 287.0;
    constexpr double g = 9.80665;
    const double T_i = in.indoorTempC + 273.15;
    const double T_o = in.outdoorTempC + 273.15;
    const double p   = in.atmPressureKPa * 1000.0;
    const double rho_i = p / (R * T_i);
    const double rho_o = p / (R * T_o);
    const double dP = g * in.stackHeightM * (rho_o - rho_i);     // Pa (sign indicates direction)

    Result r;
    r.indoorDensityKgPerM3                = rho_i;
    r.outdoorDensityKgPerM3               = rho_o;
    r.stackPressurePa                     = dP;
    r.stackPressurePascalAtMidHeight      = dP * 0.5;
    r.airflowDirection                    = (dP > 0.0) ? 1.0 : (dP < 0.0 ? -1.0 : 0.0);
    return r;
}

}  // namespace forge::stackeffect
