// Forge-280 — implementation; see header for derivation references.

#include "forge/WireRopeSling.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::wireropesling {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.breakingStrengthN <= 0.0)
        throw std::runtime_error("breakingStrengthN must be > 0");
    if (in.designFactor < 3.0 || in.designFactor > 20.0)
        throw std::runtime_error("designFactor must be in [3, 20]");
    if (in.numberOfLegs < 1 || in.numberOfLegs > 4)
        throw std::runtime_error("numberOfLegs must be in [1, 4]");
    if (in.legAngleFromVerticalDeg < 0.0 || in.legAngleFromVerticalDeg > 89.0)
        throw std::runtime_error("legAngleFromVerticalDeg must be in [0, 89]");

    const double WLL_single = in.breakingStrengthN / in.designFactor;

    double H = 1.0;
    if (in.hitchType == HitchType::Choker)        H = 0.75;
    else if (in.hitchType == HitchType::BasketDouble) H = 2.0;

    const double theta = in.legAngleFromVerticalDeg * PI / 180.0;
    const double cos_t = std::cos(theta);

    const double WLL_assembly = WLL_single * H * static_cast<double>(in.numberOfLegs) * cos_t;
    const double per_leg_at_full = (cos_t > 0.0)
        ? (WLL_assembly / static_cast<double>(in.numberOfLegs)) / cos_t
        : 0.0;

    Result r;
    r.singleLegWllN              = WLL_single;
    r.hitchFactor                = H;
    r.cosTheta                   = cos_t;
    r.assemblyWllN               = WLL_assembly;
    r.perLegLoadAtFullCapacityN  = per_leg_at_full;

    if (in.legAngleFromVerticalDeg <= 45.0)      r.angleStatus = "safe";
    else if (in.legAngleFromVerticalDeg <= 60.0) r.angleStatus = "caution";
    else                                          r.angleStatus = "danger";
    return r;
}

}  // namespace forge::wireropesling
