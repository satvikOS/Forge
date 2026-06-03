// Forge-282 — Reciprocating (positive-displacement) compressor sizing.
//
// Single-stage polytropic compression. Used for sizing compressors for
// pneumatic systems, instrument air, natural gas, and process applications.
//
//   Pressure ratio:        π = p_2 / p_1
//   Discharge temperature: T_2 = T_1 · π^((n−1)/n)
//   Polytropic head:       H_p = (n/(n−1)) · R · T_1 · (π^((n−1)/n) − 1)    [J/kg]
//   Volumetric efficiency: η_v = 1 + c − c · π^(1/n)
//                          where c = V_clearance / V_swept (typical 0.04–0.10)
//   Brake power (shaft):   P_b = ṁ · H_p / η_polytropic                     [W]
//                          (= work to deliver ṁ across the compression)
//
// Edge case n = 1 (isothermal): use limit H_p = R·T_1·ln(π) and η_v = 1.
//
// Inputs SI: pressures Pa, temperatures K, R in J/(kg·K) (287 for air).
// Output power W, head J/kg, temperature K.

#pragma once

namespace forge::recipcompressor {

struct Input {
    double inletPressurePa;          // p_1
    double inletTemperatureK;        // T_1
    double dischargePressurePa;      // p_2
    double massFlowKgS;              // ṁ
    double polytropicIndexN;         // n   (1.0 = isothermal; 1.4 ≈ isentropic air)
    double polytropicEfficiency;     // η_p (0,1]
    double clearanceRatioC;          // c   (≥ 0)
    double gasConstantJkgK;          // R   (287 air, 8314/M for ideal gas)
};

struct Result {
    double pressureRatio;
    double dischargeTemperatureK;
    double temperatureRiseK;
    double polytropicHeadJkg;
    double volumetricEfficiency;
    double brakePowerW;
    double isothermalEquivalentHeadJkg;  // R·T_1·ln(π)
};

Result analyse(const Input& in);

}  // namespace forge::recipcompressor
