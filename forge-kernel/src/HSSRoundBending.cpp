#include "forge/HSSRoundBending.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::roundhss {

Result analyse(const Input& in) {
    if (in.outsideDiameter_D_mm <= 0)    throw std::runtime_error("D > 0");
    if (in.wallThickness_t_mm <= 0)      throw std::runtime_error("t > 0");
    if (in.outsideDiameter_D_mm <= 2.0 * in.wallThickness_t_mm)
        throw std::runtime_error("D > 2·t");
    if (in.Fy_MPa <= 0)                  throw std::runtime_error("F_y > 0");
    if (in.E_GPa <= 0)                   throw std::runtime_error("E > 0");

    const double D = in.outsideDiameter_D_mm;
    const double t = in.wallThickness_t_mm;
    const double E_MPa = in.E_GPa * 1000.0;
    const double DoT = D / t;
    const double lambda_p = 0.07 * E_MPa / in.Fy_MPa;
    const double lambda_r = 0.31 * E_MPa / in.Fy_MPa;

    // Hollow tube section moduli (D, t):
    const double D_in = D - 2.0 * t;
    const double I = M_PI / 64.0 * (std::pow(D, 4.0) - std::pow(D_in, 4.0));
    const double S = I / (D / 2.0);
    const double Z = (std::pow(D, 3.0) - std::pow(D_in, 3.0)) / 6.0;

    int cls;
    double Mn_Nmm;
    const double Mp_Nmm = in.Fy_MPa * Z;
    if (DoT <= lambda_p) {
        cls = 0;  Mn_Nmm = Mp_Nmm;
    } else if (DoT <= lambda_r) {
        cls = 1;  Mn_Nmm = (0.021 * E_MPa / DoT + in.Fy_MPa) * S;
    } else {
        cls = 2;
        const double F_cr = 0.33 * E_MPa / DoT;
        Mn_Nmm = F_cr * S;
    }
    const double phiMn_Nmm = 0.9 * Mn_Nmm;

    Result r;
    r.DoverT              = DoT;
    r.lambda_p            = lambda_p;
    r.lambda_r            = lambda_r;
    r.classification      = cls;
    r.plasticModulus_Z_mm3= Z;
    r.elasticModulus_S_mm3= S;
    r.Mn_kNm              = Mn_Nmm * 1.0e-6;
    r.phiMn_kNm           = phiMn_Nmm * 1.0e-6;
    return r;
}

}  // namespace forge::roundhss
