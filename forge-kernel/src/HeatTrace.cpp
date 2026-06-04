#include "forge/HeatTrace.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::heattrace {

Result analyse(const Input& in) {
    if (in.pipeOuterDiameterMm <= 0.0) throw std::runtime_error("pipeOD > 0");
    if (in.insulationThicknessMm <= 0.0) throw std::runtime_error("insTh > 0");
    if (in.insulationConductivityWmk <= 0.0) throw std::runtime_error("k > 0");
    if (in.outdoorFilmCoefficientWm2K <= 0.0) throw std::runtime_error("h_o > 0");
    if (in.safetyFactor < 1.0) throw std::runtime_error("safetyFactor ≥ 1");

    constexpr double PI = 3.141592653589793;

    const double D_p = in.pipeOuterDiameterMm / 1000.0;
    const double D_o = D_p + 2.0 * in.insulationThicknessMm / 1000.0;
    const double dT  = in.pipeTargetTempC - in.ambientTempC;

    const double R_ins = std::log(D_o / D_p) / in.insulationConductivityWmk;
    const double R_film = 2.0 / (in.outdoorFilmCoefficientWm2K * D_o);
    const double q_per_m = 2.0 * PI * dT / (R_ins + R_film);

    Result r;
    r.insulationOD_mm        = D_o * 1000.0;
    r.heatLossWPerM          = q_per_m;
    r.recommendedCableWperM  = q_per_m * in.safetyFactor;
    return r;
}

}  // namespace forge::heattrace
