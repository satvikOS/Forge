// Forge-319b — see header.

#include "forge/BuriedPipe.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::buriedpipe {

Result analyse(const Input& in) {
    if (in.trenchWidthBd_m <= 0.0)
        throw std::runtime_error("trenchWidthBd_m must be > 0");
    if (in.fillHeightH_m <= 0.0)
        throw std::runtime_error("fillHeightH_m must be > 0");
    if (in.soilFrictionAngleDeg <= 0.0 || in.soilFrictionAngleDeg >= 60.0)
        throw std::runtime_error("soilFrictionAngleDeg must be in (0, 60)");
    if (in.soilUnitWeightKnPerM3 <= 0.0)
        throw std::runtime_error("soilUnitWeightKnPerM3 must be > 0");

    const double phi = in.soilFrictionAngleDeg * 3.141592653589793 / 180.0;
    const double K  = (1.0 - std::sin(phi)) / (1.0 + std::sin(phi));
    const double mu = 0.5 * std::tan(phi);  // Marston wall-friction assumption
    const double exponent = 2.0 * K * mu * in.fillHeightH_m / in.trenchWidthBd_m;
    const double Cd = (1.0 - std::exp(-exponent)) / (2.0 * K * mu);
    const double Wd = Cd * in.soilUnitWeightKnPerM3 * in.trenchWidthBd_m * in.trenchWidthBd_m;

    Result r;
    r.K_Rankine        = K;
    r.mu_prime         = mu;
    r.C_d              = Cd;
    r.earthLoadKnPerM  = Wd;
    return r;
}

}  // namespace forge::buriedpipe
