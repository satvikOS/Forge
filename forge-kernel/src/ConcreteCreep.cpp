// Forge-316 — implementation; see header for derivation references.

#include "forge/ConcreteCreep.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::creep {

Result analyse(const Input& in) {
    if (in.sustainedStressMPa <= 0.0)
        throw std::runtime_error("sustainedStressMPa must be > 0");
    if (in.concreteModulusMPa <= 0.0)
        throw std::runtime_error("concreteModulusMPa must be > 0");
    if (in.ambientHumidityPercent <= 0.0 || in.ambientHumidityPercent > 100.0)
        throw std::runtime_error("ambientHumidityPercent must be in (0, 100]");
    if (in.loadingAgeDays <= 0.0)
        throw std::runtime_error("loadingAgeDays must be > 0");
    if (in.timeAfterLoadingDays <= 0.0)
        throw std::runtime_error("timeAfterLoadingDays must be > 0");

    const double H = in.ambientHumidityPercent;

    // ACI 209R humidity correction (H > 40%):
    //   γ_h,creep = 1.27 − 0.0067·H
    //   γ_h,shrink = 1.40 − 0.0102·H  (kicks in at H > 40)
    double gh_c, gh_sh;
    if (H > 40.0) {
        gh_c  = 1.27 - 0.0067 * H;
        gh_sh = 1.40 - 0.0102 * H;
    } else {
        gh_c  = 1.0;
        gh_sh = 1.0;
    }

    // Loading-age factor (moist-cured): γ_la = 1.25 · t_la^−0.118
    const double gla = 1.25 * std::pow(in.loadingAgeDays, -0.118);

    // Ultimate values (user override or ACI baseline)
    const double phi_u   = (in.ultimateCreepCoeff > 0.0) ? in.ultimateCreepCoeff
                                                          : 2.35 * gh_c * gla;
    const double eps_shu = (in.ultimateShrinkageStrain > 0.0) ? in.ultimateShrinkageStrain
                                                              : 780e-6 * gh_sh;

    const double dt = in.timeAfterLoadingDays;
    const double dt06 = std::pow(dt, 0.6);
    const double phi = phi_u * dt06 / (10.0 + dt06);
    const double eps_sh = eps_shu * dt / (35.0 + dt);

    const double eps_inst = in.sustainedStressMPa / in.concreteModulusMPa;
    const double eps_cr   = eps_inst * phi;
    const double eps_total = eps_inst * (1.0 + phi) + eps_sh;

    Result r;
    r.humidityFactorCreep      = gh_c;
    r.humidityFactorShrink     = gh_sh;
    r.loadAgeFactor            = gla;
    r.appliedUltimateCreep     = phi_u;
    r.appliedUltimateShrink    = eps_shu;
    r.creepCoefficient         = phi;
    r.shrinkageStrain          = eps_sh;
    r.instantaneousStrain      = eps_inst;
    r.totalLongTermStrain      = eps_total;
    r.creepStrain              = eps_cr;
    return r;
}

}  // namespace forge::creep
