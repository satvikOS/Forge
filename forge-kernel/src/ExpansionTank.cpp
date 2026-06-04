#include "forge/ExpansionTank.hpp"

#include <stdexcept>

namespace forge::extank {

namespace {
double water_density(double TC) {
    return 999.97 + 0.0156 * TC - 0.00574 * TC * TC + 1.49e-5 * TC * TC * TC;
}
}

Result analyse(const Input& in) {
    if (in.systemVolumeLiters <= 0.0)
        throw std::runtime_error("systemVolume > 0");
    if (in.maxTempC <= in.minTempC)
        throw std::runtime_error("maxTempC > minTempC");
    if (in.minPressureBarAbs <= 0.0)
        throw std::runtime_error("minPressure > 0");
    if (in.maxPressureBarAbs <= in.minPressureBarAbs)
        throw std::runtime_error("maxPressure > minPressure");

    const double rho_min_T = water_density(in.minTempC);
    const double rho_max_T = water_density(in.maxTempC);
    // ρ decreases with T, so density at min T > density at max T → v_max > v_min
    const double exp_frac = rho_min_T / rho_max_T - 1.0;
    const double exp_vol = exp_frac * in.systemVolumeLiters;

    constexpr double P_atm = 1.01325;
    const double Kp = P_atm
        / (in.minPressureBarAbs * (1.0 - in.minPressureBarAbs / in.maxPressureBarAbs));
    const double V_tank = exp_vol * Kp;

    Result r;
    r.densityMinKgPerM3     = rho_min_T;
    r.densityMaxKgPerM3     = rho_max_T;
    r.expansionFraction     = exp_frac;
    r.expansionVolumeLiters = exp_vol;
    r.pressureFactor        = Kp;
    r.tankVolumeLiters      = V_tank;
    return r;
}

}  // namespace forge::extank
