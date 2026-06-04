#include "forge/AirReceiver.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::airrcv {

Result analyse(const Input& in) {
    if (in.internalPressure_MPa <= 0)        throw std::runtime_error("P > 0");
    if (in.insideRadius_mm <= 0)             throw std::runtime_error("R > 0");
    if (in.allowableStress_S_MPa <= 0)       throw std::runtime_error("S > 0");
    if (in.jointEfficiency_E <= 0 || in.jointEfficiency_E > 1.0)
        throw std::runtime_error("E in (0, 1]");
    if (in.corrosionAllowance_mm < 0)        throw std::runtime_error("CA >= 0");

    const double SE = in.allowableStress_S_MPa * in.jointEfficiency_E;
    const double t_circ = in.internalPressure_MPa * in.insideRadius_mm
                        / (SE - 0.6 * in.internalPressure_MPa);
    const double t_long = in.internalPressure_MPa * in.insideRadius_mm
                        / (2.0 * SE + 0.4 * in.internalPressure_MPa);
    const double t_req = std::max(t_circ, t_long) + in.corrosionAllowance_mm;

    double MAWP = 0.0;
    if (in.asBuiltThickness_mm > 0) {
        const double t_corroded = std::max(0.0, in.asBuiltThickness_mm - in.corrosionAllowance_mm);
        MAWP = SE * t_corroded / (in.insideRadius_mm + 0.6 * t_corroded);
    }

    double chargeTime = 0.0;
    if (in.flowIn_LperS > 0
        && in.pressureMax_MPa > in.pressureMin_MPa
        && in.volume_L > 0) {
        // Isothermal charge: V/Q_in_eq · ln(P_max_abs / P_min_abs).
        const double P_atm = 0.101325;
        const double pmax_abs = in.pressureMax_MPa + P_atm;
        const double pmin_abs = in.pressureMin_MPa + P_atm;
        chargeTime = in.volume_L / in.flowIn_LperS * std::log(pmax_abs / pmin_abs);
    }

    Result r;
    r.tCirc_mm             = t_circ;
    r.tLong_mm             = t_long;
    r.requiredThickness_mm = t_req;
    r.MAWP_MPa             = MAWP;
    r.chargeTime_s         = chargeTime;
    return r;
}

}  // namespace forge::airrcv
