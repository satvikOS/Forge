#include "forge/DuctLeakage.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::ductleak {

Result analyse(const Input& in) {
    if (in.ductSurfaceAreaM2 <= 0.0)
        throw std::runtime_error("ductSurfaceAreaM2 > 0");
    if (in.testPressureInchWC <= 0.0)
        throw std::runtime_error("testPressureInchWC > 0");
    if (in.leakageClassCL <= 0.0)
        throw std::runtime_error("leakageClassCL > 0");

    constexpr double m2_per_100ft2 = 9.2903;       // 100 ft² → m²
    constexpr double cfm_per_lps   = 2.119;

    const double Q_per_100ft2 = in.leakageClassCL
                              * std::pow(in.testPressureInchWC / 0.04, 0.65);
    const double Q_per_m2_cfm = Q_per_100ft2 / m2_per_100ft2;
    const double Q_per_m2_lps = Q_per_m2_cfm / cfm_per_lps;
    const double Q_total_lps  = Q_per_m2_lps * in.ductSurfaceAreaM2;
    const double Q_total_cfm  = Q_total_lps * cfm_per_lps;

    Result r;
    r.leakageRateCfmPer100ft2 = Q_per_100ft2;
    r.leakageRateLPerSperM2   = Q_per_m2_lps;
    r.totalLeakageLPerS       = Q_total_lps;
    r.totalLeakageCfm         = Q_total_cfm;
    return r;
}

}  // namespace forge::ductleak
