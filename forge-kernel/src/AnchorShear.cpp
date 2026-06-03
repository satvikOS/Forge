// Forge-271 — implementation; see header for derivation references.

#include "forge/AnchorShear.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::anchorshear {

Result analyse(const Input& in) {
    if (in.effectiveShearAreaMm2 <= 0.0)
        throw std::runtime_error("effectiveShearAreaMm2 must be > 0");
    if (in.steelUltimateMPa <= 0.0)
        throw std::runtime_error("steelUltimateMPa must be > 0");
    if (in.steelYieldMPa <= 0.0)
        throw std::runtime_error("steelYieldMPa must be > 0");
    if (in.anchorDiameterMm <= 0.0)
        throw std::runtime_error("anchorDiameterMm must be > 0");
    if (in.loadBearingLengthMm <= 0.0)
        throw std::runtime_error("loadBearingLengthMm must be > 0");
    if (in.concreteStrengthMPa <= 0.0)
        throw std::runtime_error("concreteStrengthMPa must be > 0");
    if (in.edgeDistanceCa1Mm <= 0.0)
        throw std::runtime_error("edgeDistanceCa1Mm must be > 0");
    if (in.edgeDistanceCa2Mm <= 0.0)
        throw std::runtime_error("edgeDistanceCa2Mm must be > 0");
    if (in.memberThicknessHaMm <= 0.0)
        throw std::runtime_error("memberThicknessHaMm must be > 0");
    if (in.lambdaLightweight <= 0.0 || in.lambdaLightweight > 1.0)
        throw std::runtime_error("lambdaLightweight must be in (0, 1]");

    // Steel (§17.7.1).
    const double futa_capped = std::min({in.steelUltimateMPa,
                                         1.9 * in.steelYieldMPa,
                                         860.0});
    const double V_sa     = 0.6 * in.effectiveShearAreaMm2 * futa_capped;
    const double phiSteel = 0.65 * V_sa;

    // Concrete breakout (§17.7.2).
    const double d_a    = in.anchorDiameterMm;
    const double le_use = std::min(in.loadBearingLengthMm, 8.0 * d_a);
    const double ca1    = in.edgeDistanceCa1Mm;
    const double ca2    = in.edgeDistanceCa2Mm;
    const double ha     = in.memberThicknessHaMm;

    const double V_b = 0.6
                       * std::pow(le_use / d_a, 0.2)
                       * std::sqrt(d_a)
                       * in.lambdaLightweight
                       * std::sqrt(in.concreteStrengthMPa)
                       * std::pow(ca1, 1.5);

    const double A_Vco = 4.5 * ca1 * ca1;
    const double thickLim = 1.5 * ca1;

    const double A_Vc = (ha >= thickLim) ? A_Vco : (2.0 * thickLim * ha);

    double psi_edV = 1.0;
    if (ca2 < thickLim) psi_edV = 0.7 + 0.3 * ca2 / thickLim;

    const double psi_cV = in.crackedConcrete ? 1.0 : 1.4;

    double psi_hV = std::sqrt(thickLim / ha);
    if (psi_hV < 1.0) psi_hV = 1.0;

    const double V_cb     = (A_Vc / A_Vco) * psi_edV * psi_cV * psi_hV * V_b;
    const double phiBreak = 0.70 * V_cb;

    Result r;
    r.cappedFutaMPa     = futa_capped;
    r.steelNominalN     = V_sa;
    r.phiSteelN         = phiSteel;
    r.aVcoMm2           = A_Vco;
    r.aVcMm2            = A_Vc;
    r.psiEdV            = psi_edV;
    r.psiCV             = psi_cV;
    r.psiHV             = psi_hV;
    r.vBN               = V_b;
    r.breakoutNominalN  = V_cb;
    r.phiBreakoutN      = phiBreak;
    r.phiGoverningN     = std::min(phiSteel, phiBreak);
    r.governingMode     = (r.phiGoverningN == phiSteel) ? "steel" : "breakout";
    return r;
}

}  // namespace forge::anchorshear
