// Forge-305 — implementation; see header for derivation references.

#include "forge/HertzPoint.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::hertzpoint {

Result analyse(const Input& in) {
    if (in.normalForceN <= 0.0)
        throw std::runtime_error("normalForceN must be > 0");
    if (in.radius1Mm <= 0.0 || in.radius2Mm <= 0.0)
        throw std::runtime_error("radii must be > 0 (use 1e9 mm for a plane)");
    if (in.E1_MPa <= 0.0 || in.E2_MPa <= 0.0)
        throw std::runtime_error("Young's moduli must be > 0");
    if (in.nu1 <= 0.0 || in.nu1 >= 0.5 || in.nu2 <= 0.0 || in.nu2 >= 0.5)
        throw std::runtime_error("Poisson's ratios must be in (0, 0.5)");

    constexpr double PI = 3.141592653589793;

    const double F  = in.normalForceN;
    const double R1 = in.radius1Mm;
    const double R2 = in.radius2Mm;
    const double E1 = in.E1_MPa;
    const double E2 = in.E2_MPa;
    const double v1 = in.nu1;
    const double v2 = in.nu2;

    const double oneOverEstar = (1.0 - v1 * v1) / E1 + (1.0 - v2 * v2) / E2;
    const double Estar = 1.0 / oneOverEstar;

    const double oneOverRstar = 1.0 / R1 + 1.0 / R2;
    const double Rstar = 1.0 / oneOverRstar;

    const double a = std::cbrt(3.0 * F * Rstar / (4.0 * Estar));      // mm
    const double pmax  = 3.0 * F / (2.0 * PI * a * a);                // MPa (N/mm²)
    const double pmean = F / (PI * a * a);                             // MPa
    const double delta = std::cbrt(9.0 * F * F
                                   / (16.0 * Estar * Estar * Rstar)); // mm
    const double tmax  = 0.31 * pmax;
    const double zmax  = 0.48 * a;

    Result r;
    r.effectiveModulusMPa = Estar;
    r.effectiveRadiusMm   = Rstar;
    r.contactRadiusMm     = a;
    r.maxPressureMPa      = pmax;
    r.meanPressureMPa     = pmean;
    r.mutualApproachMm    = delta;
    r.maxShearStressMPa   = tmax;
    r.depthOfMaxShearMm   = zmax;
    return r;
}

}  // namespace forge::hertzpoint
