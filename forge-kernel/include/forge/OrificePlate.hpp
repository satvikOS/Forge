// Forge-266 — Orifice plate flow meter (ISO 5167-2 corner/D-D/2 taps).
//
// Mass flow rate:
//   β = d / D
//   A_d = π·d²/4
//   ṁ = (C·ε / √(1 − β⁴)) · A_d · √(2·ρ·ΔP)
//
// Reader-Harris/Gallagher (R-H/G) discharge coefficient (corner taps,
// 1991 simplified form, valid 0.1 < β < 0.75, Re_D > 5000):
//
//   C = 0.5961 + 0.0261·β² − 0.216·β⁸
//     + 0.000521·(10⁶·β/Re_D)^0.7
//     + (0.0188 + 0.0063·A)·β^3.5·(10⁶/Re_D)^0.3
//     where A = (19000·β/Re_D)^0.8 (drainage hole tap term ≈ 0 for D-tap)
//
// Expansibility factor ε for compressible gas (κ = c_p/c_v, p1, p2):
//   ε = 1 − (0.351 + 0.256·β⁴ + 0.93·β⁸)·(1 − (p₂/p₁)^(1/κ))
//
// Incompressible liquid: ε = 1.

#pragma once

namespace forge::orificeplate {

struct Input {
    double pipeDiameterM;      // D
    double orificeDiameterM;   // d
    double upstreamDensityKgM3;
    double dynamicViscosityPas; // μ
    double differentialPressurePa; // ΔP = p_1 − p_2
    bool   compressible;       // true → use ε
    double kappaSpecHeatRatio; // κ (gas only)
    double upstreamPressurePa; // p_1 (gas)
};

struct Result {
    double betaRatio;
    double throatAreaM2;
    double reynoldsNumberD;
    double dischargeCoefficient;     // C
    double expansibilityFactor;      // ε
    double massFlowKgS;
    double volumeFlowM3S;
};

Result analyse(const Input& in);

}  // namespace forge::orificeplate
