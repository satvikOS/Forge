// Forge-333b — Ogee crest spillway discharge (USACE EM 1110-2-1603 / USBR).
//   Q = C · L_e · H^1.5
//   C  discharge coefficient (typ 2.18 SI for H/H_d = 1.0; reduces for partial heads)
//   L_e = L − 2·(N·K_p + K_a)·H            end-contraction correction
//     N = # piers, K_p ≈ 0.01 round-nose, K_a ≈ 0.10 wing abutment.
//   Crest profile (downstream face):  y / H_d = K · (x / H_d)^n     K≈0.50, n≈1.85 (USBR)
//   Returns Q + sample crest coords.

#pragma once

#include <vector>

namespace forge::ogee {

struct Input {
    double headOverCrest_H_m;      // H actual
    double designHead_Hd_m;        // H_d crest design
    double crestLength_L_m;        // L gross
    int    pierCount_N;            // N
    double pierContraction_Kp;     // K_p
    double abutmentContraction_Ka; // K_a
    double dischargeCoefficient_C; // C (≈ 2.18 design)
    int    profileSamples;         // # crest coord samples returned (0 → skip)
};

struct Result {
    double effectiveLength_Le_m;
    double dischargeQ_m3s;
    double specificDischarge_q_m2s;
    std::vector<double> profileX_m;
    std::vector<double> profileY_m;
};

Result analyse(const Input& in);

}  // namespace forge::ogee
