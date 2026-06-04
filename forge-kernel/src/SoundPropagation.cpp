#include "forge/SoundPropagation.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::soundprop {

Result analyse(const Input& in) {
    if (in.distanceM <= 0) throw std::runtime_error("r > 0");
    if (in.directivityQ <= 0) throw std::runtime_error("Q > 0");

    constexpr double PI = 3.141592653589793;
    const double term = in.directivityQ / (4.0 * PI * in.distanceM * in.distanceM);
    const double prop = 10.0 * std::log10(term);
    const double Lp = in.soundPowerLevelDbW + prop;

    Result r;
    r.soundPressureLevelDbA = Lp;
    r.inverseSquareLossDb   = -prop;     // positive loss
    return r;
}

}  // namespace forge::soundprop
