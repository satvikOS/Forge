// Forge-339d — Spark-ignition engine knock margin (Heywood §9, Stone §2).
//   End-gas temperature during compression:
//     T_2 = T_1 · (V_1/V_2)^(γ−1) = T_1 · CR^(γ−1)
//   Pressure: p_2 = p_1 · CR^γ
//   Critical autoignition T_a from Douaud-Eyzat correlation:
//     τ = A·(ON/100)^a · p^(−b) · exp(B/T)
//   Knock-Limited Compression Ratio (Heywood Eq 9.18):
//     CR_lim = (T_a/T_1)^(1/(γ−1))
//   Octane margin = (ON − ON_required).
//   Approximate Anti-Knock Index AKI = (RON + MON)/2.

#pragma once

namespace forge::knock {

struct Input {
    double compressionRatio;            // CR
    double intakeTemp_T1_K;              // T_1
    double intakePressure_p1_kPa;
    double specificHeatRatio_gamma;      // 1.34 typical hot mix
    double octaneRON;
    double octaneMON;
    double criticalAutoignition_Ta_K;   // table input
};

struct Result {
    double endGasTemp_T2_K;
    double endGasPressure_p2_kPa;
    double knockLimitedCR;
    double antiKnockIndex;
    double octaneMargin;
    bool   willKnock;                    // T_2 > T_a
};

Result analyse(const Input& in);

}  // namespace forge::knock
