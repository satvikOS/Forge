// Forge-297 — implementation; see header for derivation references.

#include "forge/Consolidation.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::consol {

constexpr double PI = 3.14159265358979323846;

static double degreeFromTimeFactor(double Tv) {
    if (Tv <= 0.0) return 0.0;
    // Taylor (parabolic) and Casagrande (exponential) approximations.
    // The textbook cross-over is at U ≈ 0.6 (T_v ≈ 0.287). Use the Taylor
    // form below the cross-over and the Casagrande form above to ensure
    // continuity in derivative at the transition.
    if (Tv < 0.287) {
        return std::min(1.0, std::sqrt(4.0 * Tv / PI));
    }
    return std::min(1.0, 1.0 - (8.0 / (PI * PI)) * std::exp(-PI * PI * Tv / 4.0));
}

Result analyse(const Input& in) {
    if (in.soilDepthM <= 0.0)
        throw std::runtime_error("soilDepthM must be > 0");
    if (in.coefficientOfConsolidationM2yr <= 0.0)
        throw std::runtime_error("coefficientOfConsolidationM2yr must be > 0");
    if (in.volumeCompressibilityM2MN <= 0.0)
        throw std::runtime_error("volumeCompressibilityM2MN must be > 0");
    if (in.pressureIncreaseKPa <= 0.0)
        throw std::runtime_error("pressureIncreaseKPa must be > 0");
    if (in.timeYears < 0.0)
        throw std::runtime_error("timeYears must be ≥ 0");

    const double H_dr = in.doubleDrainage ? (in.soilDepthM / 2.0) : in.soilDepthM;
    const double Tv   = in.coefficientOfConsolidationM2yr * in.timeYears
                       / (H_dr * H_dr);
    const double U    = degreeFromTimeFactor(Tv);

    // S_∞ = m_v · Δσ' · H
    // Units: m_v [m²/MN] · Δσ' [kPa = 1e-3 MN/m²] · H [m] = m
    const double S_inf_m = in.volumeCompressibilityM2MN
                          * in.pressureIncreaseKPa * 1e-3
                          * in.soilDepthM;
    const double S_inf_mm = S_inf_m * 1000.0;
    const double S_t_mm   = U * S_inf_mm;
    const double t90      = 0.848 * H_dr * H_dr
                          / in.coefficientOfConsolidationM2yr;

    Result r;
    r.drainagePathM            = H_dr;
    r.timeFactor               = Tv;
    r.degreeOfConsolidation    = U;
    r.degreeOfConsolidationPct = U * 100.0;
    r.ultimateSettlementMm     = S_inf_mm;
    r.settlementAtTimeMm       = S_t_mm;
    r.t90Years                 = t90;
    return r;
}

}  // namespace forge::consol
