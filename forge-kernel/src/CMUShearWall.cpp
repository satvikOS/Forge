#include "forge/CMUShearWall.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::cmushear {

Result analyse(const Input& in) {
    if (in.Vu_kN <= 0)                          throw std::runtime_error("V_u > 0");
    if (in.Mu_kNm < 0)                          throw std::runtime_error("M_u >= 0");
    if (in.netArea_An_mm2 <= 0)                 throw std::runtime_error("A_n > 0");
    if (in.wallLength_dv_mm <= 0)               throw std::runtime_error("d_v > 0");
    if (in.primeMasonryStrength_fm_MPa <= 0)    throw std::runtime_error("f'_m > 0");
    if (in.horizReinfArea_Av_mm2 < 0)           throw std::runtime_error("A_v >= 0");
    if (in.horizReinfSpacing_s_mm <= 0)         throw std::runtime_error("s > 0");
    if (in.horizReinfYield_fy_MPa <= 0)         throw std::runtime_error("f_y > 0");
    if (in.phi <= 0)                            throw std::runtime_error("φ > 0");

    const double M_over_Vd = (in.Mu_kNm * 1.0e3) / (in.Vu_kN * in.wallLength_dv_mm * 1.0e-3);
    const double ratio_for_Vnm = std::clamp(M_over_Vd, 0.0, 1.0);  // clamp coefficient
    const double Vnm_kN = (4.0 - 1.75 * ratio_for_Vnm)
                         * in.netArea_An_mm2 * 0.083
                         * std::sqrt(in.primeMasonryStrength_fm_MPa) / 1000.0;
    const double Vns_kN = 0.5 * (in.horizReinfArea_Av_mm2 / in.horizReinfSpacing_s_mm)
                         * in.horizReinfYield_fy_MPa * in.wallLength_dv_mm / 1000.0;
    const double Vn_kN = Vnm_kN + Vns_kN;

    double cap_coeff;
    if (M_over_Vd <= 0.25)      cap_coeff = 0.5;
    else if (M_over_Vd >= 1.0)  cap_coeff = 0.33;
    else                        cap_coeff = 0.5 - (M_over_Vd - 0.25) * (0.5 - 0.33) / 0.75;

    const double VnMax_kN = cap_coeff * in.netArea_An_mm2
                           * std::sqrt(in.primeMasonryStrength_fm_MPa) / 1000.0;
    const double Vn_gov = std::min(Vn_kN, VnMax_kN);
    const double phiVn = in.phi * Vn_gov;

    Result r;
    r.M_over_Vd        = M_over_Vd;
    r.Vnm_kN           = Vnm_kN;
    r.Vns_kN           = Vns_kN;
    r.Vn_kN            = Vn_kN;
    r.VnMax_kN         = VnMax_kN;
    r.Vn_governed_kN   = Vn_gov;
    r.phiVn_kN         = phiVn;
    r.meetsDemand      = phiVn >= in.Vu_kN;
    return r;
}

}  // namespace forge::cmushear
