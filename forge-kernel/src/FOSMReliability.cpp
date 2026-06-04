#include "forge/FOSMReliability.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::fosm {

static double phiCDF(double z) {
    return 0.5 * std::erfc(-z / std::sqrt(2.0));
}

Result analyse(const Input& in) {
    if (in.sigmaR < 0)        throw std::runtime_error("σ_R >= 0");
    if (in.sigmaS < 0)        throw std::runtime_error("σ_S >= 0");
    if (in.correlation_rho < -1 || in.correlation_rho > 1)
        throw std::runtime_error("ρ in [-1, 1]");

    const double mu_g = in.meanR - in.meanS;
    const double sigma_g = std::sqrt(in.sigmaR * in.sigmaR + in.sigmaS * in.sigmaS
                                    - 2.0 * in.correlation_rho * in.sigmaR * in.sigmaS);
    if (sigma_g <= 0) throw std::runtime_error("σ_g > 0");
    const double beta = mu_g / sigma_g;
    const double pf = phiCDF(-beta);

    Result r;
    r.mean_g                 = mu_g;
    r.sigma_g                = sigma_g;
    r.beta                   = beta;
    r.probabilityOfFailure   = pf;
    r.safetyMarginCV         = mu_g != 0 ? sigma_g / std::fabs(mu_g) : 0.0;
    return r;
}

}  // namespace forge::fosm
