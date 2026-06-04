#include "forge/BaseShear.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::baseshear {

Result analyse(const Input& in) {
    if (in.heightAboveBase_m <= 0)         throw std::runtime_error("h_n > 0");
    if (in.seismicWeight_kN <= 0)          throw std::runtime_error("W > 0");
    if (in.sds <= 0 || in.sd1 <= 0)        throw std::runtime_error("S_DS, S_D1 > 0");
    if (in.R <= 0)                         throw std::runtime_error("R > 0");
    if (in.Ie <= 0)                        throw std::runtime_error("I_e > 0");
    if (in.structuralSystem < 0 || in.structuralSystem > 3) throw std::runtime_error("sys 0–3");

    double Ct, x;
    switch (in.structuralSystem) {
        case 0: Ct = 0.0724; x = 0.8;  break;
        case 1: Ct = 0.0466; x = 0.9;  break;
        case 2: Ct = 0.0731; x = 0.75; break;
        default: Ct = 0.0488; x = 0.75; break;
    }
    const double T_a = Ct * std::pow(in.heightAboveBase_m, x);

    const double Cs_calc = in.sds * in.Ie / in.R;
    const double Cs_max  = in.sd1 * in.Ie / (T_a * in.R);
    const double Cs_min  = std::max(0.044 * in.sds * in.Ie, 0.01);
    const double Cs      = std::max(Cs_min, std::min(Cs_calc, Cs_max));
    const double V       = Cs * in.seismicWeight_kN;

    Result r;
    r.approximatePeriod_s = T_a;
    r.Cs                  = Cs;
    r.CsMax               = Cs_max;
    r.CsMin               = Cs_min;
    r.baseShear_kN        = V;
    r.baseShearCoeff      = Cs;
    return r;
}

}  // namespace forge::baseshear
