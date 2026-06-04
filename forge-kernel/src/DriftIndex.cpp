#include "forge/DriftIndex.hpp"

#include <stdexcept>

namespace forge::drift {

Result analyse(const Input& in) {
    if (in.topDeflectionMm <= 0) throw std::runtime_error("δ > 0");
    if (in.buildingHeightM <= 0) throw std::runtime_error("H > 0");
    if (in.numberOfStories <= 0) throw std::runtime_error("N > 0");
    if (in.driftLimitDivisor <= 0) throw std::runtime_error("divisor > 0");

    const double idx = in.topDeflectionMm / (in.buildingHeightM * 1000.0);
    const double limit = 1.0 / in.driftLimitDivisor;
    const double storey_avg = in.topDeflectionMm / in.numberOfStories;

    Result r;
    r.overallDriftIndex     = idx;
    r.overallLimit          = limit;
    r.storeyDriftAverageMm  = storey_avg;
    r.meetsOverallLimit     = idx <= limit;
    return r;
}

}  // namespace forge::drift
