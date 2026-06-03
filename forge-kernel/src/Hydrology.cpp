// Forge-256 — Hydrology implementation.

#include "forge/Hydrology.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::hydrology {

double rationalDischarge(const RunoffInput& in) {
    if (in.runoffCoefficient < 0.0 || in.runoffCoefficient > 1.0)
        throw std::invalid_argument("C must be in [0, 1]");
    if (in.rainfallIntensityMmHr < 0.0)
        throw std::invalid_argument("i must be ≥ 0");
    if (in.drainageAreaM2 < 0.0)
        throw std::invalid_argument("A must be ≥ 0");
    return in.runoffCoefficient * (in.rainfallIntensityMmHr / 3.6e6)
           * in.drainageAreaM2;
}

double kirpichTimeOfConcentrationMin(double L, double S) {
    if (L <= 0.0) throw std::invalid_argument("flow path must be > 0");
    if (S <= 0.0) throw std::invalid_argument("slope must be > 0");
    return 0.0195 * std::pow(L, 0.77) * std::pow(S, -0.385);
}

double idfIntensityMmHr(const IdfInput& in) {
    if (in.durationMin <= 0.0) throw std::invalid_argument("duration must be > 0");
    if (in.c <= 0.0) throw std::invalid_argument("c must be > 0");
    return in.a / std::pow(in.durationMin + in.b, in.c);
}

}  // namespace forge::hydrology
