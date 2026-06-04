#include "forge/HorizontalSight.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::hsd {

Result analyse(const Input& in) {
    if (in.curveRadius_m <= 0)        throw std::runtime_error("R > 0");
    if (in.sightDistance_m <= 0)      throw std::runtime_error("S > 0");
    if (in.offsetAvailable_m < 0)     throw std::runtime_error("m_avail >= 0");

    // AASHTO Green Book Eq 3-37:  m = R·(1 − cos(28.65 · S / R))   [deg]
    const double angle_deg = 28.65 * in.sightDistance_m / in.curveRadius_m;
    const double angle_rad = angle_deg * M_PI / 180.0;
    const double m_req = in.curveRadius_m * (1.0 - std::cos(angle_rad));

    // Solving for S from m_avail:  S = (R / 28.65) · arccos(1 − m/R)
    double S_max = 0.0;
    if (in.offsetAvailable_m < in.curveRadius_m) {
        const double arg = 1.0 - in.offsetAvailable_m / in.curveRadius_m;
        S_max = (in.curveRadius_m / 28.65) * std::acos(arg) * 180.0 / M_PI;
    }

    Result r;
    r.middleOrdinateRequired_m   = m_req;
    r.maxSafeSightDistance_m     = S_max;
    r.meetsAvailableClearance    = in.offsetAvailable_m >= m_req;
    return r;
}

}  // namespace forge::hsd
