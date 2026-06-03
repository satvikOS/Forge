// Forge-287 — implementation; see header for derivation references.

#include "forge/Prismoidal.hpp"

#include <stdexcept>

namespace forge::prismoidal {

constexpr double CUBIC_YARDS_PER_CUBIC_METER = 1.30795061931439;

Result analyse(const Input& in) {
    if (in.lengthM <= 0.0)
        throw std::runtime_error("lengthM must be > 0");
    if (in.areaStartM2 < 0.0)
        throw std::runtime_error("areaStartM2 must be ≥ 0");
    if (in.areaMiddleM2 < 0.0)
        throw std::runtime_error("areaMiddleM2 must be ≥ 0");
    if (in.areaEndM2 < 0.0)
        throw std::runtime_error("areaEndM2 must be ≥ 0");

    const double V_p = in.lengthM / 6.0
                       * (in.areaStartM2 + 4.0 * in.areaMiddleM2 + in.areaEndM2);
    const double V_aea = in.lengthM * (in.areaStartM2 + in.areaEndM2) / 2.0;

    const double diff = V_p - V_aea;
    const double pct  = (V_p > 0.0) ? 100.0 * (V_aea - V_p) / V_p : 0.0;

    Result r;
    r.prismoidalVolumeM3          = V_p;
    r.averageEndAreaVolumeM3      = V_aea;
    r.differenceM3                = diff;
    r.aeaErrorPct                 = pct;
    r.prismoidalVolumeCubicYards  = V_p * CUBIC_YARDS_PER_CUBIC_METER;
    return r;
}

}  // namespace forge::prismoidal
