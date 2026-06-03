// Forge-288 — implementation; see header for derivation references.

#include "forge/PitotTube.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::pitot {

constexpr double G = 9.80665;

Result analyse(const Input& in) {
    if (in.dynamicPressurePa < 0.0)
        throw std::runtime_error("dynamicPressurePa must be ≥ 0");
    if (in.densityKgM3 <= 0.0)
        throw std::runtime_error("densityKgM3 must be > 0");
    if (in.pitotCoefficient <= 0.0 || in.pitotCoefficient > 1.05)
        throw std::runtime_error("pitotCoefficient must be in (0, 1.05]");
    if (in.flowAreaM2 < 0.0)
        throw std::runtime_error("flowAreaM2 must be ≥ 0");

    const double v = in.pitotCoefficient
                    * std::sqrt(2.0 * in.dynamicPressurePa / in.densityKgM3);
    const double h = in.dynamicPressurePa / (in.densityKgM3 * G);

    Result r;
    r.velocityMs      = v;
    r.velocityHeadM   = h;
    r.volumeFlowM3S   = (in.flowAreaM2 > 0.0) ? v * in.flowAreaM2 : 0.0;
    r.massFlowKgS     = (in.flowAreaM2 > 0.0) ? in.densityKgM3 * v * in.flowAreaM2 : 0.0;
    return r;
}

}  // namespace forge::pitot
