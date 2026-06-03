// Forge-268 — implementation; see header for derivation references.

#include "forge/AnchorBolt.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::anchorbolt {

Result analyse(const Input& in) {
    if (in.effectiveTensileAreaMm2 <= 0.0)
        throw std::runtime_error("effectiveTensileAreaMm2 must be > 0");
    if (in.steelUltimateMPa <= 0.0)
        throw std::runtime_error("steelUltimateMPa must be > 0");
    if (in.steelYieldMPa <= 0.0)
        throw std::runtime_error("steelYieldMPa must be > 0");
    if (in.embedmentDepthMm <= 0.0)
        throw std::runtime_error("embedmentDepthMm must be > 0");
    if (in.concreteStrengthMPa <= 0.0)
        throw std::runtime_error("concreteStrengthMPa must be > 0");
    if (in.minEdgeDistanceMm <= 0.0)
        throw std::runtime_error("minEdgeDistanceMm must be > 0");
    if (in.bearingAreaMm2 <= 0.0)
        throw std::runtime_error("bearingAreaMm2 must be > 0");
    if (in.lambdaLightweight <= 0.0 || in.lambdaLightweight > 1.0)
        throw std::runtime_error("lambdaLightweight must be in (0, 1]");

    // ---------------- Steel strength (§17.6.1) -------------------------
    const double futa_capped = std::min({in.steelUltimateMPa,
                                         1.9 * in.steelYieldMPa,
                                         860.0});
    const double N_sa = in.effectiveTensileAreaMm2 * futa_capped;
    const double phi_steel = 0.75 * N_sa;

    // ---------------- Concrete breakout (§17.6.2) ----------------------
    const double hef = in.embedmentDepthMm;
    const double kc  = in.castInAnchor ? 10.0 : 7.0;
    const double N_b = kc * in.lambdaLightweight
                      * std::sqrt(in.concreteStrengthMPa)
                      * std::pow(hef, 1.5);

    const double A_Nco = 9.0 * hef * hef;
    const double c_min = in.minEdgeDistanceMm;
    const double c_lim = 1.5 * hef;

    double A_Nc = A_Nco;
    double psi_edN = 1.0;
    if (c_min < c_lim) {
        A_Nc    = (c_min + c_lim) * (3.0 * hef);
        psi_edN = 0.7 + 0.3 * c_min / c_lim;
    }

    const double psi_cN = in.crackedConcrete ? 1.0 : 1.25;
    const double N_cb   = (A_Nc / A_Nco) * psi_edN * psi_cN * N_b;
    const double phi_breakout = 0.70 * N_cb;

    // ---------------- Pullout strength (§17.6.3) -----------------------
    const double N_p   = 8.0 * in.bearingAreaMm2 * in.concreteStrengthMPa;
    const double psi_cP = in.crackedConcrete ? 1.0 : 1.4;
    const double N_pn  = psi_cP * N_p;
    const double phi_pullout = 0.70 * N_pn;

    // ---------------- Governing ----------------------------------------
    Result r;
    r.cappedFutaMPa    = futa_capped;
    r.steelNominalN    = N_sa;
    r.phiSteelN        = phi_steel;
    r.aNcoMm2          = A_Nco;
    r.aNcMm2           = A_Nc;
    r.psiEdN           = psi_edN;
    r.psiCN            = psi_cN;
    r.nBN              = N_b;
    r.breakoutNominalN = N_cb;
    r.phiBreakoutN     = phi_breakout;
    r.psiCP            = psi_cP;
    r.nPN              = N_p;
    r.pulloutNominalN  = N_pn;
    r.phiPulloutN      = phi_pullout;
    r.phiGoverningN    = std::min({phi_steel, phi_breakout, phi_pullout});

    if (r.phiGoverningN == phi_steel)         r.governingMode = "steel";
    else if (r.phiGoverningN == phi_breakout) r.governingMode = "breakout";
    else                                      r.governingMode = "pullout";
    return r;
}

}  // namespace forge::anchorbolt
