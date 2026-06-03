// Forge-275 — implementation; see header for derivation references.

#include "forge/SiloPressure.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::silopressure {

Result analyse(const Input& in) {
    if (in.bulkUnitWeightKnM3 <= 0.0)
        throw std::runtime_error("bulkUnitWeightKnM3 must be > 0");
    if (in.hydraulicRadiusM <= 0.0)
        throw std::runtime_error("hydraulicRadiusM must be > 0");
    if (in.wallFrictionCoefficient <= 0.0)
        throw std::runtime_error("wallFrictionCoefficient must be > 0");
    if (in.horizontalRatioK <= 0.0 || in.horizontalRatioK > 1.0)
        throw std::runtime_error("horizontalRatioK must be in (0, 1]");
    if (in.depthM < 0.0)
        throw std::runtime_error("depthM must be ≥ 0");

    const double gamma = in.bulkUnitWeightKnM3;
    const double R     = in.hydraulicRadiusM;
    const double mu    = in.wallFrictionCoefficient;
    const double k     = in.horizontalRatioK;
    const double z     = in.depthM;

    const double z_c    = R / (mu * k);                            // depth scale
    const double factor = 1.0 - std::exp(-z / z_c);

    const double p_v_inf = gamma * R / (mu * k);
    const double p_w_inf = gamma * R / mu;
    const double tau_inf = gamma * R;

    Result r;
    r.verticalPressureKPa     = p_v_inf * factor;
    r.wallPressureKPa         = p_w_inf * factor;
    r.frictionStressKPa       = tau_inf * factor;
    r.asymptoticVerticalKPa   = p_v_inf;
    r.asymptoticWallKPa       = p_w_inf;
    r.asymptoticFrictionKPa   = tau_inf;
    r.depthRatioToZc          = (z_c > 0.0) ? z / z_c : 0.0;
    return r;
}

}  // namespace forge::silopressure
