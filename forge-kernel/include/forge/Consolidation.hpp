// Forge-297 — 1D soil consolidation analysis (Terzaghi 1925).
//
// Used for time-dependent foundation settlement on saturated clay subgrades.
// The Terzaghi theory of one-dimensional consolidation gives:
//
//   Time factor:                  T_v = c_v · t / H_dr²
//   Degree of consolidation:      U(T_v) from the textbook series
//                                  U ≈ √(4·T_v/π)   for U < 0.6   (Taylor)
//                                  U ≈ 1 − (8/π²)·exp(−π²·T_v/4) for U > 0.6 (Casagrande)
//   Ultimate primary settlement:  S_∞ = m_v · Δσ' · H              [m]
//   Settlement at time t:         S(t) = U(t) · S_∞
//   t_90 (90% consolidation):     T_v(0.9) = 0.848 ⇒ t_90 = 0.848·H_dr²/c_v
//
// H_dr is the longest drainage path:
//   single-sided drainage:  H_dr = H  (impermeable boundary at the bottom)
//   double-sided drainage:  H_dr = H/2
//
// SI units throughout: H m, c_v m²/year, m_v m²/MN, Δσ' kPa, t years.

#pragma once

namespace forge::consol {

struct Input {
    double soilDepthM;                // H
    bool   doubleDrainage;            // true → H_dr = H/2
    double coefficientOfConsolidationM2yr; // c_v
    double volumeCompressibilityM2MN; // m_v
    double pressureIncreaseKPa;       // Δσ'
    double timeYears;
};

struct Result {
    double drainagePathM;             // H_dr
    double timeFactor;                // T_v
    double degreeOfConsolidation;     // U ∈ [0, 1]
    double degreeOfConsolidationPct;  // ×100
    double ultimateSettlementMm;      // S_∞
    double settlementAtTimeMm;        // S(t)
    double t90Years;                  // 90% consolidation
};

Result analyse(const Input& in);

}  // namespace forge::consol
