// Forge-270 — implementation; see header for derivation references.

#include "forge/SteelBeamLtb.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::steelbeam {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.yieldMPa <= 0.0)             throw std::runtime_error("yieldMPa must be > 0");
    if (in.elasticModulusMPa <= 0.0)    throw std::runtime_error("elasticModulusMPa must be > 0");
    if (in.sectionModulusXMm3 <= 0.0)   throw std::runtime_error("sectionModulusXMm3 must be > 0");
    if (in.plasticModulusXMm3 <= 0.0)   throw std::runtime_error("plasticModulusXMm3 must be > 0");
    if (in.torsionConstantMm4 <= 0.0)   throw std::runtime_error("torsionConstantMm4 must be > 0");
    if (in.radiusYMm <= 0.0)            throw std::runtime_error("radiusYMm must be > 0");
    if (in.radiusTsMm <= 0.0)           throw std::runtime_error("radiusTsMm must be > 0");
    if (in.distanceBetweenFlangeCentroidsMm <= 0.0)
        throw std::runtime_error("distanceBetweenFlangeCentroidsMm must be > 0");
    if (in.warpingCoefficient <= 0.0)   throw std::runtime_error("warpingCoefficient must be > 0");
    if (in.unbracedLengthMm <= 0.0)     throw std::runtime_error("unbracedLengthMm must be > 0");
    if (in.cb <= 0.0)                   throw std::runtime_error("cb must be > 0");

    const double Fy  = in.yieldMPa;
    const double E   = in.elasticModulusMPa;
    const double Sx  = in.sectionModulusXMm3;
    const double Zx  = in.plasticModulusXMm3;
    const double J   = in.torsionConstantMm4;
    const double ry  = in.radiusYMm;
    const double rts = in.radiusTsMm;
    const double ho  = in.distanceBetweenFlangeCentroidsMm;
    const double c   = in.warpingCoefficient;
    const double Lb  = in.unbracedLengthMm;
    const double Cb  = in.cb;

    // M_p = F_y·Z_x
    const double Mp = Fy * Zx;

    // L_p = 1.76·r_y·√(E/F_y)
    const double Lp = 1.76 * ry * std::sqrt(E / Fy);

    // L_r via F2-6.
    const double tau     = J * c / (Sx * ho);
    const double inner   = std::sqrt(tau * tau + 6.76 * std::pow(0.7 * Fy / E, 2));
    const double Lr      = 1.95 * rts * (E / (0.7 * Fy)) * std::sqrt(tau + inner);

    double Mn   = Mp;
    double Fcr  = 0.0;
    std::string regime;

    if (Lb <= Lp) {
        // Region (a): plastic.
        Mn = Mp;
        regime = "plastic";
    } else if (Lb <= Lr) {
        // Region (b): inelastic LTB.
        const double Mnb = Cb * (Mp - (Mp - 0.7 * Fy * Sx) * (Lb - Lp) / (Lr - Lp));
        Mn = std::min(Mnb, Mp);
        regime = "inelastic-LTB";
    } else {
        // Region (c): elastic LTB.
        const double ratio = Lb / rts;
        Fcr = (Cb * PI * PI * E / (ratio * ratio))
              * std::sqrt(1.0 + 0.078 * tau * ratio * ratio);
        const double Mnc = Fcr * Sx;
        Mn = std::min(Mnc, Mp);
        regime = "elastic-LTB";
    }

    Result r;
    r.mPlasticNmm    = Mp;
    r.lpMm           = Lp;
    r.lrMm           = Lr;
    r.mNnominalNmm   = Mn;
    r.fCrMPa         = Fcr;
    r.phiMnNmm       = 0.9 * Mn;
    r.mnOverOmegaNmm = Mn / 1.67;
    r.regime         = regime;
    return r;
}

}  // namespace forge::steelbeam
