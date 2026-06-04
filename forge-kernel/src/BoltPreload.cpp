#include "forge/BoltPreload.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::boltpre {

Result analyse(const Input& in) {
    if (in.proofStrength_MPa <= 0)        throw std::runtime_error("S_p > 0");
    if (in.tensileArea_mm2 <= 0)          throw std::runtime_error("A_t > 0");
    if (in.boltDiameter_mm <= 0)          throw std::runtime_error("d > 0");
    if (in.boltLengthGrip_mm <= 0)        throw std::runtime_error("l_b > 0");
    if (in.memberGripThickness_mm <= 0)   throw std::runtime_error("l_m > 0");
    if (in.boltE_GPa <= 0)                throw std::runtime_error("E_b > 0");
    if (in.memberE_GPa <= 0)              throw std::runtime_error("E_m > 0");
    if (in.externalLoadP_kN < 0)          throw std::runtime_error("P >= 0");
    if (in.torqueCoefficient <= 0)        throw std::runtime_error("K > 0");
    if (in.preloadFraction <= 0 || in.preloadFraction > 1.0)
        throw std::runtime_error("preload fraction in (0,1]");

    const double F_i_N = in.preloadFraction * in.proofStrength_MPa * in.tensileArea_mm2;
    const double F_i_kN = F_i_N / 1000.0;
    const double T_Nm = in.torqueCoefficient * F_i_N * (in.boltDiameter_mm * 1.0e-3);

    // Bolt stiffness k_b = (A_t · E_b) / l_b   (N/mm convert to N/m)
    const double A_t_m2 = in.tensileArea_mm2 * 1.0e-6;
    const double l_b_m  = in.boltLengthGrip_mm * 1.0e-3;
    const double l_m_m  = in.memberGripThickness_mm * 1.0e-3;
    const double d_m    = in.boltDiameter_mm * 1.0e-3;
    const double E_b    = in.boltE_GPa * 1.0e9;
    const double E_m    = in.memberE_GPa * 1.0e9;

    const double k_b = A_t_m2 * E_b / l_b_m;
    // Wileman fit (Shigley Table 8-8): k_m = E_m·d·A·exp(B·d/l_m), A=0.787, B=0.628 (steel)
    const double k_m = E_m * d_m * 0.787 * std::exp(0.628 * d_m / l_m_m);
    const double C = k_b / (k_b + k_m);

    const double P_N = in.externalLoadP_kN * 1.0e3;
    const double F_b_N = F_i_N + C * P_N;
    const double F_m_N = F_i_N - (1.0 - C) * P_N;
    const double P_sep_N = F_i_N / (1.0 - C);
    const double n_static = (in.proofStrength_MPa * in.tensileArea_mm2 - F_i_N) /
                            (C * P_N > 0 ? C * P_N : 1.0);

    Result r;
    r.recommendedPreload_kN     = F_i_kN;
    r.tighteningTorque_Nm       = T_Nm;
    r.bolt_stiffness_NperM      = k_b;
    r.member_stiffness_NperM    = k_m;
    r.jointStiffnessRatio_C     = C;
    r.boltLoad_kN               = F_b_N / 1000.0;
    r.memberLoad_kN             = F_m_N / 1000.0;
    r.separationLoad_kN         = P_sep_N / 1000.0;
    r.staticSafetyFactor        = P_N > 0 ? n_static : 0.0;
    return r;
}

}  // namespace forge::boltpre
