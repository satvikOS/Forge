// Forge-319 — implementation; see header for derivation references.

#include "forge/HydraulicJump.hpp"

#include <cmath>
#include <stdexcept>
#include <string>

namespace forge::hydjump {

Result analyse(const Input& in) {
    if (in.channelWidthB_m <= 0.0)
        throw std::runtime_error("channelWidthB_m must be > 0");
    if (in.upstreamDepthY1_m <= 0.0)
        throw std::runtime_error("upstreamDepthY1_m must be > 0");
    if (in.dischargeQM3PerS <= 0.0)
        throw std::runtime_error("dischargeQM3PerS must be > 0");
    if (in.gravityMs2 <= 0.0)
        throw std::runtime_error("gravityMs2 must be > 0");

    const double b = in.channelWidthB_m;
    const double y1 = in.upstreamDepthY1_m;
    const double Q = in.dischargeQM3PerS;
    const double g = in.gravityMs2;

    const double V1 = Q / (b * y1);
    const double Fr1 = V1 / std::sqrt(g * y1);
    if (Fr1 <= 1.0)
        throw std::runtime_error("Upstream Fr ≤ 1 — flow is subcritical, no jump");

    const double y2 = 0.5 * y1 * (std::sqrt(1.0 + 8.0 * Fr1 * Fr1) - 1.0);
    const double V2 = Q / (b * y2);
    const double Fr2 = V2 / std::sqrt(g * y2);

    const double E1 = y1 + V1 * V1 / (2.0 * g);
    const double E2 = y2 + V2 * V2 / (2.0 * g);
    const double dE = std::pow(y2 - y1, 3.0) / (4.0 * y1 * y2);
    const double eff = (E1 > 0.0) ? 100.0 * E2 / E1 : 0.0;
    const double L_jump = 6.1 * y2;

    std::string type;
    if      (Fr1 <= 1.7) type = "undular";
    else if (Fr1 <= 2.5) type = "weak";
    else if (Fr1 <= 4.5) type = "oscillating";
    else if (Fr1 <= 9.0) type = "steady";
    else                 type = "strong";

    Result r;
    r.upstreamVelocityV1_ms       = V1;
    r.upstreamFroudeNumber        = Fr1;
    r.sequentDepthY2_m            = y2;
    r.downstreamVelocityV2_ms     = V2;
    r.downstreamFroudeNumber      = Fr2;
    r.upstreamSpecificEnergyM     = E1;
    r.downstreamSpecificEnergyM   = E2;
    r.energyHeadLossM             = dE;
    r.jumpEfficiencyPercent       = eff;
    r.jumpLengthM                 = L_jump;
    r.jumpType                    = type;
    return r;
}

}  // namespace forge::hydjump
