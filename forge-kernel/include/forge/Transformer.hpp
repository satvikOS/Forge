// Forge-245 — Single-phase transformer equivalent circuit.
//
// Open-circuit test (rated voltage on LV / measured at LV):
//   P_oc = core losses (W); V_oc = rated; I_oc = no-load.
//   cosφ_oc = P_oc / (V_oc·I_oc); φ_oc = acos.
//   I_c = I_oc·cosφ_oc;     I_m = I_oc·sinφ_oc
//   R_c = V_oc / I_c        (core-loss resistance, Ω, parallel)
//   X_m = V_oc / I_m        (magnetising reactance, Ω, parallel)
//
// Short-circuit test (reduced voltage on HV / measured at HV):
//   I_sc = rated HV current; V_sc = reduced voltage to drive I_sc;
//   P_sc = copper losses.
//   R_eq = P_sc / I_sc²        (referred to HV)
//   Z_eq = V_sc / I_sc
//   X_eq = √(Z_eq² − R_eq²)
//
// Voltage regulation at load I_L = a·I_2,rated with pf cosφ:
//   ΔV = I_L · (R_eq·cosφ + X_eq·sinφ)     [lag, +; lead, sin negative]
//   reg = ΔV / V_LL_rated_HV  (or referred side; same %)
//
// Efficiency at fraction x of full load, pf cosφ:
//   η = (x·S·cosφ) / (x·S·cosφ + P_oc + x²·P_sc)

#pragma once

namespace forge::transformer {

struct OcTestInput {
    double openCircuitVoltageV;     // V_oc
    double openCircuitCurrentA;     // I_oc
    double openCircuitPowerW;       // P_oc
};

struct OcTestResult {
    double cosPhiOc;
    double coreResistanceOhm;       // R_c
    double magnetisingReactanceOhm; // X_m
};

OcTestResult openCircuitTest(const OcTestInput& in);

struct ScTestInput {
    double shortCircuitCurrentA;    // I_sc (HV referred)
    double shortCircuitVoltageV;    // V_sc
    double shortCircuitPowerW;      // P_sc
};

struct ScTestResult {
    double equivalentResistanceOhm; // R_eq
    double equivalentImpedanceOhm;  // Z_eq
    double equivalentReactanceOhm;  // X_eq
};

ScTestResult shortCircuitTest(const ScTestInput& in);

struct RegInput {
    double equivalentResistanceOhm;
    double equivalentReactanceOhm;
    double ratedHvCurrentA;
    double loadFraction;            // x ∈ [0, 1]+
    double powerFactor;             // cosφ
    bool   leading;
    double ratedHvVoltageV;
};

struct RegResult {
    double voltageDropV;            // ΔV
    double regulationPct;           // ΔV/V · 100
};

RegResult voltageRegulation(const RegInput& in);

struct EffInput {
    double ratedKva;
    double openCircuitPowerW;       // P_oc (≈ core loss)
    double shortCircuitPowerW;      // P_sc (≈ copper at full load)
    double loadFraction;            // x
    double powerFactor;             // cosφ
};

double efficiency(const EffInput& in);
double maximumEfficiencyLoadFraction(double Poc, double Psc);

}  // namespace forge::transformer
