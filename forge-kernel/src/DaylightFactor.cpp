#include "forge/DaylightFactor.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::daylight {

Result analyse(const Input& in) {
    if (in.visibleTransmittance <= 0 || in.visibleTransmittance > 1)
        throw std::runtime_error("T in (0, 1]");
    if (in.skyAngleDeg <= 0 || in.skyAngleDeg > 180)
        throw std::runtime_error("θ in (0, 180]");
    if (in.glazingArea_m2 <= 0)         throw std::runtime_error("A_g > 0");
    if (in.maintenanceFactor <= 0 || in.maintenanceFactor > 1)
        throw std::runtime_error("M in (0, 1]");
    if (in.totalSurfaceArea_m2 <= 0)    throw std::runtime_error("A_tot > 0");
    if (in.avgReflectance <= 0 || in.avgReflectance >= 1)
        throw std::runtime_error("ρ in (0, 1)");

    const double rho2 = in.avgReflectance * in.avgReflectance;
    const double DF =
        (in.visibleTransmittance * in.skyAngleDeg * in.glazingArea_m2 * in.maintenanceFactor)
        / (in.totalSurfaceArea_m2 * (1.0 - rho2));

    Result r;
    r.daylightFactorPct = DF;        // formula already returns percent
    r.meetsLeed2pct     = DF >= 2.0;
    r.meetsLeed3pct     = DF >= 3.0;
    return r;
}

}  // namespace forge::daylight
