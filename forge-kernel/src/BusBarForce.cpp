#include "forge/BusBarForce.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::busbar {

Result analyse(const Input& in) {
    if (in.shortCircuitCurrentKaRms <= 0.0)
        throw std::runtime_error("shortCircuitCurrentKaRms > 0");
    if (in.asymmetryFactorKappa < 1.0 || in.asymmetryFactorKappa > 2.0)
        throw std::runtime_error("kappa in [1, 2]");
    if (in.conductorSpacingMm <= 0.0)
        throw std::runtime_error("conductorSpacingMm > 0");
    if (in.spanLengthM <= 0.0)
        throw std::runtime_error("spanLengthM > 0");

    const double Isc_A   = in.shortCircuitCurrentKaRms * 1000.0;
    const double Ipeak_A = in.asymmetryFactorKappa * std::sqrt(2.0) * Isc_A;
    const double a_m     = in.conductorSpacingMm / 1000.0;
    const double F_per_m = 2.0e-7 * Ipeak_A * Ipeak_A / a_m;
    const double F_total = F_per_m * in.spanLengthM;
    const double M_max   = F_total * in.spanLengthM / 8.0;

    Result r;
    r.peakCurrentKa        = Ipeak_A / 1000.0;
    r.forcePerLengthNm     = F_per_m;
    r.totalForcePerSpanN   = F_total;
    r.maxBendingMomentNm   = M_max;
    return r;
}

}  // namespace forge::busbar
