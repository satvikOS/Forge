#include "forge/CathodicProtection.hpp"

#include <stdexcept>

namespace forge::cp {

Result analyse(const Input& in) {
    if (in.protectedAreaM2 <= 0.0) throw std::runtime_error("protectedAreaM2 > 0");
    if (in.currentDensityMaPerM2 <= 0.0) throw std::runtime_error("currentDensity > 0");
    if (in.designLifeYears <= 0.0) throw std::runtime_error("designLife > 0");
    if (in.anodeConsumptionKgPerAmpYr <= 0.0) throw std::runtime_error("consumption > 0");
    if (in.anodeUtilizationFactor <= 0.0 || in.anodeUtilizationFactor > 1.0)
        throw std::runtime_error("utilization in (0, 1]");

    const double I = in.currentDensityMaPerM2 * in.protectedAreaM2 / 1000.0;  // A
    const double m = (I * in.designLifeYears * in.anodeConsumptionKgPerAmpYr)
                   / in.anodeUtilizationFactor;

    Result r;
    r.totalCurrentRequiredA        = I;
    r.anodeMassRequiredKg          = m;
    r.currentDensityMaPerM2Echo    = in.currentDensityMaPerM2;
    return r;
}

}  // namespace forge::cp
