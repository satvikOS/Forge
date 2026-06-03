// Forge-257 — RC column implementation.

#include "forge/RcColumn.hpp"

#include <stdexcept>

namespace forge::rccolumn {

namespace {
double beta1FromFc(double fc_Pa) {
    const double fc_MPa = fc_Pa / 1.0e6;
    if (fc_MPa <= 28.0) return 0.85;
    if (fc_MPa >= 55.0) return 0.65;
    return 0.85 - 0.05 * (fc_MPa - 28.0) / 7.0;
}
}  // namespace

Result analyse(const Input& in) {
    if (in.grossAreaM2 <= 0.0 || in.widthM <= 0.0 || in.overallDepthM <= 0.0)
        throw std::invalid_argument("section geometry must be positive");
    if (in.effectiveDepthM <= 0.0 || in.effectiveDepthM >= in.overallDepthM)
        throw std::invalid_argument("d must be in (0, h)");
    if (in.steelAreaTotalM2 <= 0.0 || in.steelAreaTotalM2 >= in.grossAreaM2)
        throw std::invalid_argument("A_st must be in (0, A_g)");
    if (in.concreteFcPa <= 0.0 || in.steelFyPa <= 0.0)
        throw std::invalid_argument("f'_c, f_y must be positive");
    if (in.coverM < 0.0 || in.coverM >= in.effectiveDepthM)
        throw std::invalid_argument("d' must be in [0, d)");

    Result r{};
    r.beta1 = beta1FromFc(in.concreteFcPa);

    // Pure compression nominal.
    const double concreteArea = in.grossAreaM2 - in.steelAreaTotalM2;
    r.nominalAxialN = 0.85 * in.concreteFcPa * concreteArea
                    + in.steelFyPa * in.steelAreaTotalM2;

    // φ and max factor by tie type.
    if (in.tieType == TieType::Spiral) {
        r.phi = 0.75;
        r.maxFactor = 0.85;
    } else {
        r.phi = 0.65;
        r.maxFactor = 0.80;
    }
    r.designMaxAxialN = r.maxFactor * r.phi * r.nominalAxialN;

    // Balanced point (symmetric A_s = A_s' = A_st/2 assumed).
    const double As = in.steelAreaTotalM2 * 0.5;  // tension
    const double As_ = As;                         // compression
    const double c_b = (0.003 / (0.003 + 0.002)) * in.effectiveDepthM;  // 0.6 d
    const double a_b = r.beta1 * c_b;
    const double C_c = 0.85 * in.concreteFcPa * in.widthM * a_b;
    const double C_s = As_ * (in.steelFyPa - 0.85 * in.concreteFcPa);
    const double T = As * in.steelFyPa;

    r.balancedAxialN = C_c + C_s - T;
    const double h2 = in.overallDepthM * 0.5;
    r.balancedMomentNm = C_c * (h2 - a_b * 0.5)
                       + C_s * (h2 - in.coverM)
                       + T * (in.effectiveDepthM - h2);

    r.designBalancedAxialN  = r.phi * r.balancedAxialN;
    r.designBalancedMomentNm = r.phi * r.balancedMomentNm;
    return r;
}

}  // namespace forge::rccolumn
