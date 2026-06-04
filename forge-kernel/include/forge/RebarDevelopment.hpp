// Forge-320a — Reinforcing-bar tension development length (ACI 318-19 §25.4.2).
//
//   ℓ_d / d_b = (f_y · ψ_t · ψ_e · ψ_s) / (1.1 · λ · √f'_c · (c_b + K_tr)/d_b)
//
// where (c_b + K_tr)/d_b ≤ 2.5 (Eq 25.4.2.4a confinement cap).
// ψ_t  = 1.3 top-cast horizontal bars with > 300 mm fresh concrete below, else 1.0
// ψ_e  = 1.5 epoxy-coated cover < 3 d_b, else 1.0
// ψ_s  = 0.8 bars ≤ #6 (≤ #19 metric), 1.0 larger
// λ    = 1.0 normal-weight, 0.75 all-LW
// Minimum ℓ_d = 300 mm (12 in)

#pragma once

namespace forge::rebardev {

struct Input {
    double barDiameter_db_mm;     // d_b
    double fc_MPa;
    double fy_MPa;
    double psi_t;                 // top cast factor (1.0 or 1.3)
    double psi_e;                 // epoxy coating factor (1.0 or 1.5)
    double psi_s;                 // bar size factor (0.8 or 1.0)
    double lambda;                // lightweight (1.0 or 0.75)
    double clearCover_cb_mm;      // c_b
    double Ktr_mm;                // confinement K_tr (0 typical)
};

struct Result {
    double cbKtrOverDb;           // capped at 2.5
    double developmentLengthMm;   // ℓ_d (≥ 300)
    double rawLengthMm;           // before 300 mm minimum
    bool   minimumGoverned;
};

Result analyse(const Input& in);

}  // namespace forge::rebardev
