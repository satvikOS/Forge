#include "forge/LightningProtection.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::lightning {

Result analyse(const Input& in) {
    if (in.rollingSphereRadiusM <= 0.0) throw std::runtime_error("R > 0");
    if (in.mastHeightM <= 0.0) throw std::runtime_error("mastHeight > 0");
    if (in.mastHeightM > in.rollingSphereRadiusM)
        throw std::runtime_error("mastHeight ≤ R for single-mast formula");
    if (in.protectedObjectHeightM < 0.0)
        throw std::runtime_error("protectedObjectHeight ≥ 0");
    if (in.protectedObjectHeightM >= in.mastHeightM)
        throw std::runtime_error("protectedObjectHeight < mastHeight");

    const double R = in.rollingSphereRadiusM;
    const double h = in.mastHeightM;
    const double h_obj = in.protectedObjectHeightM;

    const double r_ground = std::sqrt(h * (2.0 * R - h));
    const double r_obj = std::sqrt((h - h_obj) * (2.0 * R - (h - h_obj)));

    Result r;
    r.groundProtectedRadiusM       = r_ground;
    r.objectProtectedRadiusM       = r_obj;
    r.maximumProtectionConeRatio   = r_ground / h;
    return r;
}

}  // namespace forge::lightning
