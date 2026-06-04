#include "forge/SluiceGate.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::sluice {

Result analyse(const Input& in) {
    if (in.gateOpening_a_m <= 0)        throw std::runtime_error("a > 0");
    if (in.upstreamHead_h_m <= 0)       throw std::runtime_error("h > 0");
    if (in.upstreamHead_h_m <= in.gateOpening_a_m) throw std::runtime_error("h > a");
    if (in.gateWidth_b_m <= 0)          throw std::runtime_error("b > 0");
    if (in.tailwaterDepth_yt_m < 0)     throw std::runtime_error("y_t >= 0");

    constexpr double g = 9.80665;
    const double Cd = in.useContractedCd
                    ? 0.61 / std::sqrt(1.0 + 0.61 * in.gateOpening_a_m / in.upstreamHead_h_m)
                    : 0.60;
    const double q = Cd * in.gateOpening_a_m * std::sqrt(2.0 * g * in.upstreamHead_h_m);
    const double Q = q * in.gateWidth_b_m;
    const double y2 = 0.61 * in.gateOpening_a_m;
    const bool submerged = in.tailwaterDepth_yt_m > y2;

    Result r;
    r.dischargeCoefficient_Cd = Cd;
    r.specificDischarge_qPerM = q;
    r.totalDischarge_Q_m3s    = Q;
    r.venaContracta_y2_m      = y2;
    r.isSubmerged             = submerged;
    return r;
}

}  // namespace forge::sluice
