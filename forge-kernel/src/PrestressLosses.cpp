#include "forge/PrestressLosses.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::prestress {

Result analyse(const Input& in) {
    if (in.initialStress_fpj_MPa <= 0)              throw std::runtime_error("f_pj > 0");
    if (in.concreteStrengthAtTransfer_fci_MPa <= 0) throw std::runtime_error("f'_ci > 0");
    if (in.finalConcreteStrength_fc_MPa <= 0)       throw std::runtime_error("f'_c > 0");
    if (in.fcgp_MPa <= 0)                           throw std::runtime_error("f_cgp > 0");
    if (in.fcdp_MPa < 0)                            throw std::runtime_error("f_cdp >= 0");
    if (in.strandModulus_GPa <= 0)                  throw std::runtime_error("E_p > 0");
    if (in.humidityH_pct <= 0 || in.humidityH_pct > 100)
        throw std::runtime_error("H in (0, 100]");
    if (in.shrinkageStrain_e6 <= 0)                 throw std::runtime_error("ε_sh > 0");

    // E_ci concrete at transfer (ACI 318): E_ci = 4700·√f'_ci  MPa
    const double E_ci = 4700.0 * std::sqrt(in.concreteStrengthAtTransfer_fci_MPa);
    const double E_p_MPa = in.strandModulus_GPa * 1000.0;

    const double K_h = (in.humidityH_pct <= 80.0) ?
        2.0 - 0.0143 * in.humidityH_pct
        : 2.0 - 0.0143 * 80.0 - 0.04 * (in.humidityH_pct - 80.0);

    const double dF_ES = (E_p_MPa / E_ci) * in.fcgp_MPa;
    const double dF_SR = K_h * (in.shrinkageStrain_e6 * 1.0e-6) * E_p_MPa;
    const double dF_CR = 12.0 * in.fcgp_MPa - 7.0 * in.fcdp_MPa;
    const double dF_RE = 0.040 * in.initialStress_fpj_MPa
                       - 0.040 * (dF_ES + dF_CR + dF_SR) / 3.0;

    const double total = dF_ES + dF_SR + std::max(0.0, dF_CR) + std::max(0.0, dF_RE);
    const double f_pe = in.initialStress_fpj_MPa - total;

    Result r;
    r.loss_ES_MPa       = dF_ES;
    r.loss_SR_MPa       = dF_SR;
    r.loss_CR_MPa       = std::max(0.0, dF_CR);
    r.loss_RE_MPa       = std::max(0.0, dF_RE);
    r.totalLoss_MPa     = total;
    r.totalLossPercent  = 100.0 * total / in.initialStress_fpj_MPa;
    r.finalStress_MPa   = f_pe;
    return r;
}

}  // namespace forge::prestress
