// Forge-335e — Pedestrian bridge vibration check (EN 1990 Annex A2 / SETRA 2006).
//   Simply-supported deck, first natural frequency:
//     f_1 = (π / 2L²) · √(E·I / m)        m = mass per length (kg/m)
//   Concern range  1.6 ≤ f_1 ≤ 2.4 Hz  vertical  (pedestrians)
//                  0.5 ≤ f_1 ≤ 1.2 Hz  lateral   (London Millennium)
//   Resonant acceleration  a_max = (4 / π) · (n_p · 0.4 / m) · sin(πx_load/L)
//     n_p effective walkers (SETRA Table 2)  for dense crowd ≈ 10.8·√(N_pedestrian)
//   Limit: comfort a < 0.5 m/s² ≈ 5 % g (EN 1990).

#pragma once

namespace forge::pedvib {

struct Input {
    double span_m;             // L
    double EI_kNm2;            // E·I
    double linearMass_kgM;     // m
    double pedestrianCountPerM2;   // d crowd density
    double bridgeDeckWidth_m;
};

struct Result {
    double firstFreq_Hz;
    double resonantPedestrianCount;
    double peakAcceleration_mps2;
    bool   inVerticalResonance;       // 1.6 ≤ f_1 ≤ 2.4
    bool   meetsComfortLimit;         // a ≤ 0.5
};

Result analyse(const Input& in);

}  // namespace forge::pedvib
