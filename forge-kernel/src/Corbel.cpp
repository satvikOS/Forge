#include "forge/Corbel.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::corbel {

Result analyse(const Input& in) {
    if (in.Vu_kN <= 0)       throw std::runtime_error("V_u > 0");
    if (in.Nuc_kN < 0)       throw std::runtime_error("N_uc >= 0");
    if (in.a_mm <= 0)        throw std::runtime_error("a > 0");
    if (in.bw_mm <= 0)       throw std::runtime_error("b > 0");
    if (in.d_mm <= 0)        throw std::runtime_error("d > 0");
    if (in.h_mm < in.d_mm)   throw std::runtime_error("h >= d");
    if (in.fc_MPa <= 0)      throw std::runtime_error("f'_c > 0");
    if (in.fy_MPa <= 0)      throw std::runtime_error("f_y > 0");
    if (in.frictionMu <= 0)  throw std::runtime_error("μ > 0");
    if (in.phi <= 0)         throw std::runtime_error("φ > 0");

    // Cap on V_n (ACI 16.5.4.2): for normal weight concrete:
    //   V_n,max = min(0.2·f'_c·b·d, (3.3 + 0.08·f'_c)·b·d, 11·b·d)  in MPa·mm² → N
    const double cap1 = 0.20 * in.fc_MPa * in.bw_mm * in.d_mm;
    const double cap2 = (3.3 + 0.08 * in.fc_MPa) * in.bw_mm * in.d_mm;
    const double cap3 = 11.0 * in.bw_mm * in.d_mm;
    const double Vn_max_N = std::min({cap1, cap2, cap3});
    const double Vn_max_kN = Vn_max_N / 1000.0;

    const double Vu_N = in.Vu_kN * 1000.0;
    const double Nuc_N = in.Nuc_kN * 1000.0;

    const double Avf = Vu_N / (in.phi * in.fy_MPa * in.frictionMu);
    const double jd = 0.875 * in.d_mm;
    const double Mu_Nmm = Vu_N * in.a_mm + Nuc_N * (in.h_mm - in.d_mm);
    const double Af = Mu_Nmm / (in.phi * in.fy_MPa * jd);
    const double An = Nuc_N / (in.phi * in.fy_MPa);
    const double As_min_codify = 0.04 * in.fc_MPa / in.fy_MPa * in.bw_mm * in.d_mm;
    const double As_pri = std::max({Af + An, (2.0 / 3.0) * Avf + An, As_min_codify});
    const double Ah = 0.5 * (As_pri - An);

    Result r;
    r.Vn_max_kN          = Vn_max_kN;
    r.Avf_required_mm2   = Avf;
    r.As_primary_mm2     = As_pri;
    r.Ah_stirrups_mm2    = std::max(0.0, Ah);
    r.momentArm_jd_mm    = jd;
    r.shearOK            = in.Vu_kN <= in.phi * Vn_max_kN;
    return r;
}

}  // namespace forge::corbel
