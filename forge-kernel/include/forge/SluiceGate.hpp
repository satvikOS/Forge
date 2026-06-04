// Forge-339c — Underflow / sluice gate discharge (USBR HDB / Henderson).
//   Free-flow: q = C_d · a · √(2·g·h)             per metre width
//   C_d = 0.61 / √(1 + 0.61·a/h)                  Henderson (1966) — sharp-edged
//   Total Q = q · b_gate
//   Submerged: introduce tailwater correction Q_sub = Q_free · μ_s.
//   Vena contracta y_2 ≈ 0.61·a (C_c contraction coeff).

#pragma once

namespace forge::sluice {

struct Input {
    double gateOpening_a_m;
    double upstreamHead_h_m;
    double gateWidth_b_m;
    double tailwaterDepth_yt_m;     // for submerged check
    bool   useContractedCd;          // true → C_d = 0.61/√(1+0.61·a/h), false → fixed C_d=0.6
};

struct Result {
    double dischargeCoefficient_Cd;
    double specificDischarge_qPerM;
    double totalDischarge_Q_m3s;
    double venaContracta_y2_m;
    bool   isSubmerged;
};

Result analyse(const Input& in);

}  // namespace forge::sluice
