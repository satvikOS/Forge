// Forge-323c — Bus-bar short-circuit force (IEC 60865-1).
//   F = (μ₀ / 2π) · (I_peak² / a) · L          parallel-conductor pair
//     = 2 × 10⁻⁷ · I² / a · L                   N (I in A, a + L in m)
//   I_peak = κ · √2 · I_sc,rms   (κ = 1.8 typical with full DC offset)
//   M_max = F · L / 8  (single span, simply supported)

#pragma once

namespace forge::busbar {

struct Input {
    double shortCircuitCurrentKaRms;
    double asymmetryFactorKappa;    // 1.0–2.0; 1.8 typical (X/R=15)
    double conductorSpacingMm;      // a between parallel conductors
    double spanLengthM;             // L between supports
};

struct Result {
    double peakCurrentKa;
    double forcePerLengthNm;
    double totalForcePerSpanN;
    double maxBendingMomentNm;
};

Result analyse(const Input& in);

}  // namespace forge::busbar
