#include "forge/Cyclone.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::cyclone {

Result analyse(const Input& in) {
    if (in.inletVelocityMs <= 0.0) throw std::runtime_error("inletVelocityMs > 0");
    if (in.inletWidthM <= 0.0) throw std::runtime_error("inletWidthM > 0");
    if (in.numberOfTurns <= 0.0) throw std::runtime_error("numberOfTurns > 0");
    if (in.gasViscosityPaS <= 0.0) throw std::runtime_error("gasViscosityPaS > 0");
    if (in.particleDensityKgPerM3 <= in.gasDensityKgPerM3)
        throw std::runtime_error("particle density must exceed gas density");

    constexpr double PI = 3.141592653589793;
    const double denom = 2.0 * PI * in.numberOfTurns * in.inletVelocityMs
                       * (in.particleDensityKgPerM3 - in.gasDensityKgPerM3);
    const double d50_m = std::sqrt(9.0 * in.gasViscosityPaS * in.inletWidthM / denom);

    Result r;
    r.cutDiameterM   = d50_m;
    r.cutDiameterUm  = d50_m * 1.0e6;
    return r;
}

}  // namespace forge::cyclone
