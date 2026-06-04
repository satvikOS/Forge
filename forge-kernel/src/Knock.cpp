#include "forge/Knock.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::knock {

Result analyse(const Input& in) {
    if (in.compressionRatio <= 1)         throw std::runtime_error("CR > 1");
    if (in.intakeTemp_T1_K <= 0)          throw std::runtime_error("T_1 > 0");
    if (in.intakePressure_p1_kPa <= 0)    throw std::runtime_error("p_1 > 0");
    if (in.specificHeatRatio_gamma <= 1)  throw std::runtime_error("γ > 1");
    if (in.octaneRON < 0 || in.octaneRON > 130) throw std::runtime_error("RON in [0,130]");
    if (in.octaneMON < 0 || in.octaneMON > 130) throw std::runtime_error("MON in [0,130]");
    if (in.criticalAutoignition_Ta_K <= 0) throw std::runtime_error("T_a > 0");

    const double T2 = in.intakeTemp_T1_K * std::pow(in.compressionRatio,
                                                    in.specificHeatRatio_gamma - 1.0);
    const double p2 = in.intakePressure_p1_kPa * std::pow(in.compressionRatio,
                                                          in.specificHeatRatio_gamma);
    const double CR_lim = std::pow(in.criticalAutoignition_Ta_K / in.intakeTemp_T1_K,
                                    1.0 / (in.specificHeatRatio_gamma - 1.0));
    const double aki = (in.octaneRON + in.octaneMON) / 2.0;
    // Heuristic: required AKI ≈ 87 for CR=9, +1 per CR step.
    const double ON_required = 87.0 + (in.compressionRatio - 9.0) * 1.0;
    const double margin = aki - ON_required;

    Result r;
    r.endGasTemp_T2_K        = T2;
    r.endGasPressure_p2_kPa  = p2;
    r.knockLimitedCR         = CR_lim;
    r.antiKnockIndex         = aki;
    r.octaneMargin           = margin;
    r.willKnock              = T2 > in.criticalAutoignition_Ta_K;
    return r;
}

}  // namespace forge::knock
