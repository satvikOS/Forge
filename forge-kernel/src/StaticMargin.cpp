#include "forge/StaticMargin.hpp"

#include <stdexcept>

namespace forge::staticmargin {

Result analyse(const Input& in) {
    if (in.tailVolumeCoefficient < 0.0)
        throw std::runtime_error("tailVolumeCoefficient ≥ 0");
    if (in.tailToWingCLalphaRatio <= 0.0)
        throw std::runtime_error("tailToWingCLalphaRatio > 0");
    if (in.downwashGradient < 0.0 || in.downwashGradient > 1.0)
        throw std::runtime_error("downwashGradient in [0, 1]");

    const double xNP = in.xACwing_normalized
                     + in.tailVolumeCoefficient * in.tailToWingCLalphaRatio
                     * (1.0 - in.downwashGradient);
    const double SM = xNP - in.xCG_normalized;

    Result r;
    r.xNP_normalized              = xNP;
    r.staticMargin                = SM;
    r.stable                      = SM > 0.0;
    r.meetsTypicalDesignTarget    = (SM >= 0.05 && SM <= 0.15);
    return r;
}

}  // namespace forge::staticmargin
