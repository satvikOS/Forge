// Forge-238 — RC beam flexure implementation (ACI 318-19 §22.2).

#include "forge/RcBeam.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::rcbeam {

namespace {
double beta1FromFc(double fc_Pa) {
    const double fc_MPa = fc_Pa / 1.0e6;
    if (fc_MPa <= 28.0) return 0.85;
    if (fc_MPa >= 55.0) return 0.65;
    return 0.85 - 0.05 * (fc_MPa - 28.0) / 7.0;
}

double phiFromStrain(double eps_t, double eps_ty) {
    if (eps_t <= eps_ty) return 0.65;
    if (eps_t >= 0.005)  return 0.90;
    return 0.65 + 0.25 * (eps_t - eps_ty) / (0.005 - eps_ty);
}
}  // namespace

Result analyse(const Input& in) {
    if (in.widthM <= 0.0 || in.effectiveDepthM <= 0.0)
        throw std::invalid_argument("b, d must be positive");
    if (in.steelAreaM2 <= 0.0)
        throw std::invalid_argument("A_s must be positive");
    if (in.concreteFcPa <= 0.0 || in.steelFyPa <= 0.0 || in.steelEPa <= 0.0)
        throw std::invalid_argument("f'_c, f_y, E_s must be positive");

    Result r{};
    r.beta1 = beta1FromFc(in.concreteFcPa);

    r.stressBlockDepthM = in.steelAreaM2 * in.steelFyPa
                          / (0.85 * in.concreteFcPa * in.widthM);
    r.neutralAxisDepthM = r.stressBlockDepthM / r.beta1;
    r.steelStrain = 0.003 * (in.effectiveDepthM - r.neutralAxisDepthM)
                          / r.neutralAxisDepthM;
    const double eps_ty = in.steelFyPa / in.steelEPa;
    r.phi = phiFromStrain(r.steelStrain, eps_ty);

    r.nominalMomentNm = in.steelAreaM2 * in.steelFyPa
                        * (in.effectiveDepthM - r.stressBlockDepthM * 0.5);
    r.designMomentNm  = r.phi * r.nominalMomentNm;

    r.rho        = in.steelAreaM2 / (in.widthM * in.effectiveDepthM);
    const double fy_MPa = in.steelFyPa / 1.0e6;
    const double fc_MPa = in.concreteFcPa / 1.0e6;
    r.rhoMin = std::max(1.4 / fy_MPa, std::sqrt(fc_MPa) / (4.0 * fy_MPa));
    r.rhoBalanced = 0.85 * r.beta1 * (fc_MPa / fy_MPa) * (600.0 / (600.0 + fy_MPa));
    r.rhoMax = 0.75 * r.rhoBalanced;

    r.tensionControlled = r.steelStrain >= 0.005;
    r.belowRhoMin = r.rho < r.rhoMin;
    r.aboveRhoMax = r.rho > r.rhoMax;
    return r;
}

}  // namespace forge::rcbeam
