// Forge-317 — implementation; see header for derivation references.

#include "forge/DetentionBasin.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::detention {

Result analyse(const Input& in) {
    if (in.areaHa <= 0.0)
        throw std::runtime_error("areaHa must be > 0");
    if (in.runoffCoeffPre <= 0.0 || in.runoffCoeffPre > 1.0)
        throw std::runtime_error("runoffCoeffPre must be in (0, 1]");
    if (in.runoffCoeffPost <= 0.0 || in.runoffCoeffPost > 1.0)
        throw std::runtime_error("runoffCoeffPost must be in (0, 1]");
    if (in.designIntensityMmHr <= 0.0)
        throw std::runtime_error("designIntensityMmHr must be > 0");
    if (in.allowableReleaseRatio <= 0.0)
        throw std::runtime_error("allowableReleaseRatio must be > 0");
    if (in.timeOfConcentrationMin <= 0.0)
        throw std::runtime_error("timeOfConcentrationMin must be > 0");
    if (in.designStormDurationMin <= 0.0)
        throw std::runtime_error("designStormDurationMin must be > 0");

    const double A_m2 = in.areaHa * 1.0e4;
    const double Q_pre  = in.runoffCoeffPre  * in.designIntensityMmHr / 3.6e6 * A_m2;
    const double Q_post = in.runoffCoeffPost * in.designIntensityMmHr / 3.6e6 * A_m2;
    const double Q_rel  = in.allowableReleaseRatio * Q_pre;
    const double V_m3   = std::max(0.0,
                                   60.0 * (Q_post - Q_rel)
                                        * in.designStormDurationMin);

    Result r;
    r.areaM2                  = A_m2;
    r.preDevQM3PerS           = Q_pre;
    r.postDevQM3PerS          = Q_post;
    r.allowableReleaseQM3PerS = Q_rel;
    r.detentionVolumeM3       = V_m3;
    r.detentionVolumeAcreFt   = V_m3 * 0.000810714;
    r.detentionRequired       = Q_post > Q_rel;
    return r;
}

}  // namespace forge::detention
