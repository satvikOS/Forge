// Forge-332e — Pretensioned concrete prestress losses (AASHTO LRFD §5.9).
//   Total = ΔF_ES  + ΔF_SR + ΔF_CR + ΔF_R
//   ES (elastic shortening):  ΔF_ES = (E_p / E_ci) · f_cgp
//   SR (shrinkage):           ΔF_SR = K_h · ε_sh · E_p
//   CR (creep):               ΔF_CR = 12·f_cgp − 7·f_cdp
//   RE (relaxation, low-relax): ΔF_R = 0.040·f_pj − 0.040·(ΔF_ES+ΔF_CR+ΔF_SR)/3

#pragma once

namespace forge::prestress {

struct Input {
    double initialStress_fpj_MPa;        // f_pj jacking
    double concreteStrengthAtTransfer_fci_MPa;
    double finalConcreteStrength_fc_MPa;
    double fcgp_MPa;                     // stress at CG of strand from prestress + sw
    double fcdp_MPa;                     // additional dead-load stress at CG
    double strandModulus_GPa;            // E_p ≈ 196
    double humidityH_pct;                // ambient RH (40-80 %)
    double shrinkageStrain_e6;           // ε_sh in microstrain (typ 400-600)
};

struct Result {
    double loss_ES_MPa;
    double loss_SR_MPa;
    double loss_CR_MPa;
    double loss_RE_MPa;
    double totalLoss_MPa;
    double totalLossPercent;
    double finalStress_MPa;              // f_pe = f_pj − Σ losses
};

Result analyse(const Input& in);

}  // namespace forge::prestress
