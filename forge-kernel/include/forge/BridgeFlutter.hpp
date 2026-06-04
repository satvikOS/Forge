// Forge-341e — Bridge-deck flutter onset (Selberg / Theodorsen reduced — Simiu §11).
//   Critical flutter wind speed (Selberg empirical for thin closed deck):
//     U_cr = 0.6·b·ω_α · √(μ·(1 − (ω_h/ω_α)²))
//     b  = deck half-width
//     ω_α torsional natural frequency (rad/s)
//     ω_h heave (vertical) freq
//     μ  = mass ratio m / (π·ρ·b²)  per metre of deck.
//   Reduced velocity  U_r = U / (f·B)        (Theodorsen flutter onset U_r ≈ 5–8 typical).

#pragma once

namespace forge::flutter {

struct Input {
    double deckWidth_B_m;          // full width = 2·b
    double linearMass_kgPerM;       // m per metre
    double torsionalFreq_falpha_Hz; // f_α
    double heaveFreq_fh_Hz;
    double airDensity_kgM3;        // 1.225
    double designWindSpeed_Vd_mps; // for comparison
};

struct Result {
    double halfWidth_b_m;
    double massRatio_mu;
    double criticalWindSpeed_Ucr_mps;
    double reducedVelocity_atVd;
    double safetyFactorUcrOverVd;
    bool   stable;                 // U_cr > V_d
};

Result analyse(const Input& in);

}  // namespace forge::flutter
