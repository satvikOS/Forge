#include "forge/MSEPullout.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::msepull {

Result analyse(const Input& in) {
    if (in.wallHeight_H_m <= 0)            throw std::runtime_error("H > 0");
    if (in.depthBelowCrest_z_m < 0)        throw std::runtime_error("z >= 0");
    if (in.depthBelowCrest_z_m > in.wallHeight_H_m)
        throw std::runtime_error("z <= H");
    if (in.verticalSpacing_Sv_m <= 0)      throw std::runtime_error("S_v > 0");
    if (in.soilFrictionAngleDeg_phi <= 0 || in.soilFrictionAngleDeg_phi >= 90)
        throw std::runtime_error("φ in (0, 90)");
    if (in.soilUnitWeight_gamma_kNm3 <= 0) throw std::runtime_error("γ > 0");
    if (in.surchargeQ_kNm2 < 0)            throw std::runtime_error("q >= 0");
    if (in.reinforcementCoverage_Rc <= 0 || in.reinforcementCoverage_Rc > 1)
        throw std::runtime_error("R_c in (0, 1]");
    if (in.pulloutResistanceFactor_F <= 0) throw std::runtime_error("F* > 0");
    if (in.scaleEffectAlpha <= 0)          throw std::runtime_error("α > 0");
    if (in.safetyFactorSF <= 0)            throw std::runtime_error("SF > 0");

    const double phi_rad = in.soilFrictionAngleDeg_phi * M_PI / 180.0;
    const double K_a = std::pow(std::tan(M_PI / 4.0 - phi_rad / 2.0), 2.0);

    // FHWA Fig 4-9 simplified linear interpolation of K_r/K_a vs z:
    //   bars: 1.7 @ z=0, 1.2 @ z=6 m, 1.0 below 6 m
    //   grids: 1.2 @ z=0, 1.0 below
    double KrOverKa;
    if (in.isInextensibleBar) {
        const double z_clip = std::min(in.depthBelowCrest_z_m, 6.0);
        KrOverKa = 1.7 - (1.7 - 1.2) * (z_clip / 6.0);
        if (in.depthBelowCrest_z_m > 6.0) KrOverKa = 1.0;
    } else {
        const double z_clip = std::min(in.depthBelowCrest_z_m, 6.0);
        KrOverKa = 1.2 - (1.2 - 1.0) * (z_clip / 6.0);
        if (in.depthBelowCrest_z_m > 6.0) KrOverKa = 1.0;
    }
    const double K_r = KrOverKa * K_a;

    const double sigma_v = in.soilUnitWeight_gamma_kNm3 * in.depthBelowCrest_z_m
                         + in.surchargeQ_kNm2;
    const double T_max = K_r * sigma_v * in.verticalSpacing_Sv_m;

    // Pullout resistance per unit width: P_r = 2·F*·α·σ_v·R_c·L_e per metre of width;
    // SF = P_r / T_max → L_e = T_max·SF / (2·F*·α·σ_v·R_c)
    const double L_e = sigma_v > 0
        ? T_max * in.safetyFactorSF / (2.0 * in.pulloutResistanceFactor_F
                                        * in.scaleEffectAlpha * sigma_v
                                        * in.reinforcementCoverage_Rc)
        : 0.0;
    const double L_a = (in.wallHeight_H_m - in.depthBelowCrest_z_m)
                     * std::tan(M_PI / 4.0 - phi_rad / 2.0);
    const double L_total = L_a + L_e;

    Result r;
    r.Ka                                 = K_a;
    r.KrOverKa                           = KrOverKa;
    r.Kr                                 = K_r;
    r.verticalEffectiveStress_sigmaV_kPa = sigma_v;
    r.maxLayerTension_Tmax_kNperM        = T_max;
    r.requiredEmbedmentLength_Le_m       = L_e;
    r.activeZoneLength_La_m              = L_a;
    r.totalReinforcementLength_L_m       = L_total;
    return r;
}

}  // namespace forge::msepull
