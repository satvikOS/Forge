#include "forge/Ashrae62Residential.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::ashrae62r {

Result analyse(const Input& in) {
    if (in.conditionedFloorAreaM2 <= 0.0)
        throw std::runtime_error("floor area > 0");
    if (in.bedroomCount < 0)
        throw std::runtime_error("bedroomCount ≥ 0");
    if (in.infiltrationCreditCfm < 0.0)
        throw std::runtime_error("infiltrationCredit ≥ 0");

    const double area_ft2 = in.conditionedFloorAreaM2 * 10.7639;
    const double Q_req = 0.03 * area_ft2 + 7.5 * (in.bedroomCount + 1);
    const double Q_net = std::max(0.0, Q_req - in.infiltrationCreditCfm);

    Result r;
    r.requiredVentilationCfm = Q_req;
    r.netVentilationCfm      = Q_net;
    r.netVentilationLps      = Q_net / 2.119;
    r.complies               = Q_req <= in.infiltrationCreditCfm + Q_req;  // always
    return r;
}

}  // namespace forge::ashrae62r
