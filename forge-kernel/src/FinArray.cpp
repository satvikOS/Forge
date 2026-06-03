// Forge-295 — implementation; see header for derivation references.

#include "forge/FinArray.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::finarray {

Result analyse(const Input& in) {
    if (in.baseWidthMm <= 0.0)
        throw std::runtime_error("baseWidthMm must be > 0");
    if (in.baseLengthMm <= 0.0)
        throw std::runtime_error("baseLengthMm must be > 0");
    if (in.finCount < 2 || in.finCount > 1000)
        throw std::runtime_error("finCount must be in [2, 1000]");
    if (in.finThicknessMm <= 0.0)
        throw std::runtime_error("finThicknessMm must be > 0");
    if (in.finLengthMm <= 0.0)
        throw std::runtime_error("finLengthMm must be > 0");
    if (in.materialConductivityWmK <= 0.0)
        throw std::runtime_error("materialConductivityWmK must be > 0");
    if (in.convectionCoefficientWm2K <= 0.0)
        throw std::runtime_error("convectionCoefficientWm2K must be > 0");
    if (in.baseTemperatureC <= in.ambientTemperatureC)
        throw std::runtime_error("baseTemperatureC must be > ambientTemperatureC");
    if (static_cast<double>(in.finCount) * in.finThicknessMm >= in.baseLengthMm)
        throw std::runtime_error("Fin count × fin thickness must be < baseLengthMm");

    // Convert dimensions to metres for heat-transfer math.
    const double W      = in.baseWidthMm   * 1e-3;
    const double b      = in.baseLengthMm  * 1e-3;
    const double t      = in.finThicknessMm * 1e-3;
    const double L_f    = in.finLengthMm   * 1e-3;
    const double k      = in.materialConductivityWmK;
    const double h      = in.convectionCoefficientWm2K;
    const double N      = static_cast<double>(in.finCount);
    const double dT     = in.baseTemperatureC - in.ambientTemperatureC;

    const double m   = std::sqrt(2.0 * h / (k * t));
    const double L_c = L_f + t / 2.0;
    const double mLc = m * L_c;
    const double eta_f = std::tanh(mLc) / mLc;

    const double A_f       = 2.0 * L_c * W;
    const double A_f_tot   = N * A_f;
    const double A_b       = (b - N * t) * W;
    const double A_t       = A_f_tot + A_b;

    const double eta_o = 1.0 - (A_f_tot / A_t) * (1.0 - eta_f);
    const double R_t   = 1.0 / (eta_o * h * A_t);
    const double Q     = dT / R_t;

    Result r;
    r.finParameterPerM           = m;
    r.correctedLengthMm          = L_c * 1000.0;
    r.singleFinEfficiency        = eta_f;
    r.singleFinAreaMm2           = A_f * 1e6;
    r.totalFinAreaMm2            = A_f_tot * 1e6;
    r.baseAreaMm2                = A_b * 1e6;
    r.totalAreaMm2               = A_t * 1e6;
    r.overallSurfaceEfficiency   = eta_o;
    r.thermalResistanceKW        = R_t;
    r.heatDissipatedW            = Q;
    return r;
}

}  // namespace forge::finarray
