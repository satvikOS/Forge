#include "forge/HunterFlow.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::hunter {

Result analyse(const Input& in) {
    if (in.totalFixtureUnits <= 0)
        throw std::runtime_error("totalFixtureUnits > 0");

    const double FU = in.totalFixtureUnits;
    double Q_gpm;
    if (FU <= 500.0) {
        Q_gpm = 6.5 * std::pow(FU, 0.42);
    } else {
        Q_gpm = 2.5 * std::pow(FU, 0.55);
    }
    if (in.flushValveMix) {
        Q_gpm *= 1.20;   // flush-valve adjustment
    }

    Result r;
    r.designFlowGpm = Q_gpm;
    r.designFlowLps = Q_gpm * 0.06309;     // gpm → L/s
    return r;
}

}  // namespace forge::hunter
