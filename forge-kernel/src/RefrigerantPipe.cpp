#include "forge/RefrigerantPipe.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::refpipe {

Result analyse(const Input& in) {
    if (in.coolingDutyKw <= 0.0) throw std::runtime_error("coolingDuty > 0");
    if (in.enthalpyChangeKJpkg <= 0.0) throw std::runtime_error("enthalpyChange > 0");
    if (in.specificVolumeM3pkg <= 0.0) throw std::runtime_error("specificVolume > 0");
    if (in.velocityLimitMs <= 0.0) throw std::runtime_error("velocityLimit > 0");

    constexpr double PI = 3.141592653589793;

    const double m_dot = in.coolingDutyKw / in.enthalpyChangeKJpkg;       // kg/s
    const double V_dot = m_dot * in.specificVolumeM3pkg;                   // m³/s
    const double A = V_dot / in.velocityLimitMs;                            // m²
    const double D_mm = std::sqrt(4.0 * A / PI) * 1000.0;

    Result r;
    r.massFlowKgPerS      = m_dot;
    r.volumeFlowM3PerS    = V_dot;
    r.requiredAreaMm2     = A * 1.0e6;
    r.requiredDiameterMm  = D_mm;
    return r;
}

}  // namespace forge::refpipe
