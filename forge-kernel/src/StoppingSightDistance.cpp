// Forge-284 — implementation; see header for derivation references.

#include "forge/StoppingSightDistance.hpp"

#include <stdexcept>

namespace forge::ssd {

constexpr double G_GRAV = 9.81;
constexpr double M_PER_FT = 0.3048;

Result analyse(const Input& in) {
    if (in.designSpeedKmH <= 0.0)
        throw std::runtime_error("designSpeedKmH must be > 0");
    if (in.perceptionTimeS <= 0.0)
        throw std::runtime_error("perceptionTimeS must be > 0");
    if (in.frictionCoefficient <= 0.0 || in.frictionCoefficient > 1.0)
        throw std::runtime_error("frictionCoefficient must be in (0, 1]");
    if (in.gradePct < -15.0 || in.gradePct > 15.0)
        throw std::runtime_error("gradePct must be in [-15, +15]");

    const double v = in.designSpeedKmH / 3.6;   // m/s
    const double a = G_GRAV * (in.frictionCoefficient + in.gradePct / 100.0);
    if (a <= 0.0)
        throw std::runtime_error("Effective deceleration ≤ 0 — friction too low for grade");

    const double d_perception = v * in.perceptionTimeS;
    const double d_braking    = v * v / (2.0 * a);
    const double total_m      = d_perception + d_braking;

    Result r;
    r.designSpeedMs             = v;
    r.effectiveDecelerationMs2  = a;
    r.perceptionDistanceM       = d_perception;
    r.brakingDistanceM          = d_braking;
    r.totalSsdM                 = total_m;
    r.totalSsdFt                = total_m / M_PER_FT;
    return r;
}

}  // namespace forge::ssd
