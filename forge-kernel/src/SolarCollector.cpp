#include "forge/SolarCollector.hpp"

#include <stdexcept>

namespace forge::solarcoll {

Result analyse(const Input& in) {
    if (in.collectorAreaM2 <= 0) throw std::runtime_error("A > 0");
    if (in.opticalEfficiency_F_R_tau_alpha <= 0 || in.opticalEfficiency_F_R_tau_alpha > 1)
        throw std::runtime_error("F_R·τα in (0, 1]");
    if (in.overallLossCoeff_U_L <= 0) throw std::runtime_error("U_L > 0");
    if (in.F_R <= 0 || in.F_R > 1) throw std::runtime_error("F_R in (0, 1]");
    if (in.globalIrradianceWm2 <= 0) throw std::runtime_error("G_T > 0");

    const double dT = in.inletTempC - in.ambientTempC;
    const double q_u = in.collectorAreaM2
                     * (in.opticalEfficiency_F_R_tau_alpha * in.globalIrradianceWm2
                        - in.F_R * in.overallLossCoeff_U_L * dT);
    const double eta = q_u / (in.collectorAreaM2 * in.globalIrradianceWm2);

    Result r;
    r.usefulHeatGainW              = q_u;
    r.instantaneousEfficiency      = eta;
    r.reducedTemperature           = dT / in.globalIrradianceWm2;
    return r;
}

}  // namespace forge::solarcoll
