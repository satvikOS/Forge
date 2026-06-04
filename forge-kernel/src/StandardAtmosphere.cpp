#include "forge/StandardAtmosphere.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::isa {

Result analyse(const Input& in) {
    if (in.altitudeM < -500 || in.altitudeM > 11000)
        throw std::runtime_error("altitude in [-500, 11000] m (troposphere)");

    constexpr double T0 = 288.15;
    constexpr double p0 = 101.325e3;
    constexpr double L = 0.0065;
    constexpr double R = 287.0;
    constexpr double g = 9.80665;
    constexpr double k = 1.4;

    const double T = T0 - L * in.altitudeM;
    const double p = p0 * std::pow(T / T0, g / (R * L));
    const double rho = p / (R * T);
    const double a = std::sqrt(k * R * T);

    Result r;
    r.temperatureK   = T;
    r.temperatureC   = T - 273.15;
    r.pressureKpa    = p / 1000.0;
    r.densityKgM3    = rho;
    r.speedOfSoundMs = a;
    return r;
}

}  // namespace forge::isa
