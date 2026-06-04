#include "forge/NRCAcoustic.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::nrc {

Result analyse(const Input& in) {
    if (in.alpha250 < 0 || in.alpha500 < 0 || in.alpha1000 < 0 || in.alpha2000 < 0)
        throw std::runtime_error("all α ≥ 0");
    if (in.alpha250 > 1.5 || in.alpha500 > 1.5 || in.alpha1000 > 1.5 || in.alpha2000 > 1.5)
        throw std::runtime_error("all α ≤ 1.5 (Sabine cap)");

    const double raw = (in.alpha250 + in.alpha500 + in.alpha1000 + in.alpha2000) / 4.0;
    const double rounded = std::round(raw / 0.05) * 0.05;

    Result r;
    r.nrcRaw              = raw;
    r.nrcRounded          = rounded;
    r.meetsAbsorbentClass = rounded >= 0.50;
    return r;
}

}  // namespace forge::nrc
