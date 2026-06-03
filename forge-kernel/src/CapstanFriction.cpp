// Forge-286 — implementation; see header for derivation references.

#include "forge/CapstanFriction.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::capstan {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.holdingForceN <= 0.0)
        throw std::runtime_error("holdingForceN must be > 0");
    if (in.frictionCoefficient <= 0.0 || in.frictionCoefficient > 1.0)
        throw std::runtime_error("frictionCoefficient must be in (0, 1]");
    if (in.wrapAngleDeg <= 0.0 || in.wrapAngleDeg > 7200.0)
        throw std::runtime_error("wrapAngleDeg must be in (0, 7200]");   // ≤ 20 turns

    const double theta_rad = in.wrapAngleDeg * PI / 180.0;
    const double amp       = std::exp(in.frictionCoefficient * theta_rad);
    const double T1        = in.holdingForceN * amp;
    const double MA        = amp - 1.0;

    Result r;
    r.wrapAngleRad          = theta_rad;
    r.amplificationRatio    = amp;
    r.maxLoadN              = T1;
    r.mechanicalAdvantage   = MA;
    return r;
}

}  // namespace forge::capstan
