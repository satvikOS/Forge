#include "forge/Waveguide.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::waveguide {

Result analyse(const Input& in) {
    if (in.broadDim_a_mm <= 0)         throw std::runtime_error("a > 0");
    if (in.narrowDim_b_mm <= 0)        throw std::runtime_error("b > 0");
    if (in.dielectric_eps_r <= 0)      throw std::runtime_error("ε_r > 0");
    if (in.operatingFreq_GHz <= 0)     throw std::runtime_error("f > 0");
    if (in.modeM < 0 || in.modeN < 0 || (in.modeM == 0 && in.modeN == 0))
        throw std::runtime_error("modes ≥ 0, not both zero");

    constexpr double c0 = 299792458.0;
    const double a = in.broadDim_a_mm * 1.0e-3;
    const double b = in.narrowDim_b_mm * 1.0e-3;
    const double sqrt_eps = std::sqrt(in.dielectric_eps_r);
    const double m = in.modeM, n = in.modeN;
    const double kc = M_PI * std::sqrt((m / a) * (m / a) + (n / b) * (n / b));
    const double fc_Hz = c0 / (2.0 * sqrt_eps) * std::sqrt((m / a) * (m / a) + (n / b) * (n / b));
    const double lambda_c = c0 / (fc_Hz * sqrt_eps);

    const double f_Hz = in.operatingFreq_GHz * 1.0e9;
    const double omega = 2.0 * M_PI * f_Hz;
    const double k0 = omega * sqrt_eps / c0;
    const bool propagating = k0 > kc;
    double beta = 0.0, lambda_g = 0.0, vg = 0.0;
    if (propagating) {
        beta = std::sqrt(k0 * k0 - kc * kc);
        lambda_g = 2.0 * M_PI / beta;
        vg = beta * c0 * c0 / (omega * in.dielectric_eps_r);
    }

    Result r;
    r.cutoffFreq_GHz          = fc_Hz / 1.0e9;
    r.cutoffWavelength_mm     = lambda_c * 1000.0;
    r.phaseConstant_beta_perM = beta;
    r.guidedWavelength_mm     = lambda_g * 1000.0;
    r.groupVelocity_mps       = vg;
    r.isPropagating           = propagating;
    return r;
}

}  // namespace forge::waveguide
