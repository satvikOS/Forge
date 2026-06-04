#include "forge/CompositeSlab.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::compslab {

Result analyse(const Input& in) {
    if (in.slabConcreteStrength_fc_MPa <= 0) throw std::runtime_error("f'_c > 0");
    if (in.slabThickness_mm <= 0)            throw std::runtime_error("t_s > 0");
    if (in.ribHeight_hr_mm < 0)              throw std::runtime_error("h_r >= 0");
    if (in.effectiveWidth_b_mm <= 0)         throw std::runtime_error("b > 0");
    if (in.studCapacity_Qn_kN <= 0)          throw std::runtime_error("Q_n > 0");
    if (in.studCount_perSpan <= 0)           throw std::runtime_error("n_stud > 0");
    if (in.steelArea_mm2 <= 0)               throw std::runtime_error("A_s > 0");
    if (in.steelDepth_mm <= 0)               throw std::runtime_error("d_b > 0");
    if (in.steelYield_Fy_MPa <= 0)           throw std::runtime_error("F_y > 0");
    if (in.Es_GPa <= 0)                      throw std::runtime_error("E_s > 0");
    if (in.Ec_GPa <= 0)                      throw std::runtime_error("E_c > 0");
    if (in.span_m <= 0)                      throw std::runtime_error("L > 0");
    if (in.serviceLoad_w_kNm < 0)            throw std::runtime_error("w >= 0");
    if (in.steelI_mm4 <= 0)                  throw std::runtime_error("I_s > 0");

    const double C_concrete_N = 0.85 * in.slabConcreteStrength_fc_MPa
                              * in.effectiveWidth_b_mm * in.slabThickness_mm;
    const double C_studs_N    = in.studCount_perSpan * in.studCapacity_Qn_kN * 1.0e3;
    const double C_steel_N    = in.steelArea_mm2 * in.steelYield_Fy_MPa;
    const double C_N = std::min({C_concrete_N, C_studs_N, C_steel_N});

    const double a_mm = C_N / (0.85 * in.slabConcreteStrength_fc_MPa * in.effectiveWidth_b_mm);
    const double leverArm_mm = in.steelDepth_mm + in.ribHeight_hr_mm
                             + 0.5 * in.slabThickness_mm - 0.5 * a_mm;
    const double phiMn_kNm = 0.9 * C_N * leverArm_mm * 1.0e-6;

    const double n_modular = in.Es_GPa / in.Ec_GPa;
    const double I_concrete_eq = in.effectiveWidth_b_mm * std::pow(in.slabThickness_mm, 3.0)
                                / (12.0 * n_modular);
    const double I_tr = in.steelI_mm4 + I_concrete_eq;
    const double w_Npm = in.serviceLoad_w_kNm * 1.0e3;
    const double L_m = in.span_m;
    const double EI = in.Es_GPa * 1.0e9 * (I_tr * 1.0e-12);          // Pa·m⁴
    const double delta_m = 5.0 * w_Npm * std::pow(L_m, 4.0) / (384.0 * EI);

    Result r;
    r.C_compression_kN   = C_N / 1.0e3;
    r.aDepth_mm          = a_mm;
    r.phiMn_kNm          = phiMn_kNm;
    r.Itransformed_mm4   = I_tr;
    r.serviceDeflection_mm = delta_m * 1000.0;
    r.partialComposite   = (C_studs_N < C_concrete_N) && (C_studs_N < C_steel_N);
    return r;
}

}  // namespace forge::compslab
