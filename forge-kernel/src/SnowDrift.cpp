#include "forge/SnowDrift.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::snowdrift {

Result analyse(const Input& in) {
    if (in.groundSnowLoad_kNm2 <= 0) throw std::runtime_error("p_g > 0");
    if (in.upwindFetchLength_m <= 0) throw std::runtime_error("L_u > 0");

    const double pg = in.groundSnowLoad_kNm2;
    const double Lu = in.upwindFetchLength_m;
    const double gamma = 1.94 * (1.0 - std::exp(-4.6e-3 * pg));
    double hd = 0.13 * std::pow(Lu, 1.0/3.0) * std::pow(pg + 0.2483, 0.25) - 0.5;
    if (hd < 0.0) hd = 0.0;
    if (!in.leewardDrift) hd *= 0.75;  // windward drift coefficient

    Result r;
    r.snowUnitWeight_kNm3 = gamma;
    r.driftHeight_m       = hd;
    r.driftPressure_kNm2  = hd * gamma;
    return r;
}

}  // namespace forge::snowdrift
