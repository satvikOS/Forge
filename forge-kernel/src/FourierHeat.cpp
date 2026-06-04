#include "forge/FourierHeat.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::fourier {

Result analyse(const Input& in) {
    if (in.thermalConductivity_k_WmK <= 0) throw std::runtime_error("k > 0");
    if (in.density_rho_kgM3 <= 0)          throw std::runtime_error("ρ > 0");
    if (in.specificHeat_cp_JkgK <= 0)      throw std::runtime_error("c_p > 0");
    if (in.depth_x_m < 0)                  throw std::runtime_error("x >= 0");
    if (in.time_t_s <= 0)                  throw std::runtime_error("t > 0");

    const double alpha = in.thermalConductivity_k_WmK
                        / (in.density_rho_kgM3 * in.specificHeat_cp_JkgK);
    const double sqrt_at = std::sqrt(alpha * in.time_t_s);
    const double eta = in.depth_x_m / (2.0 * sqrt_at);
    const double T = in.initialTemperature_Tinf_C
                   + (in.surfaceTemperature_Ts_C - in.initialTemperature_Tinf_C) * std::erfc(eta);
    const double q_s = (in.surfaceTemperature_Ts_C - in.initialTemperature_Tinf_C)
                     * std::sqrt(in.thermalConductivity_k_WmK
                               * in.density_rho_kgM3
                               * in.specificHeat_cp_JkgK
                               / (M_PI * in.time_t_s));
    const double delta = 4.0 * sqrt_at;

    Result r;
    r.thermalDiffusivity_alpha_m2pers = alpha;
    r.normalisedDepth_eta             = eta;
    r.temperatureAtDepth_C            = T;
    r.surfaceHeatFlux_Wm2             = q_s;
    r.penetrationDepth_m              = delta;
    return r;
}

}  // namespace forge::fourier
