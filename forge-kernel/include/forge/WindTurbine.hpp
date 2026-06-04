// Forge-315 — Horizontal-axis wind turbine power output (Betz/actuator-disc
// theory + drivetrain efficiency; Hau "Wind Turbines" Ch.5, Manwell §3).
//
//   Swept area      A = π · D² / 4
//   Available wind  P_w = 0.5 · ρ · A · V³
//   Betz ceiling    P_betz = (16/27) · P_w           C_P,max ≈ 0.593
//   Mechanical      P_mech = C_P · P_w               C_P design ~ 0.35-0.45 HAWT
//   Electrical      P_elec = η_drivetrain · P_mech   η ~ 0.93-0.96
//
// Tip-speed ratio (optional if rotor RPM provided):
//   λ = ω · R / V_wind  =  π · D · N_rpm / (60 · V_wind)
//
// Annual energy production (single-point estimate at the rated speed):
//   AEP = P_elec · 8760 h · capacity_factor      (capacity factor caller-set)

#pragma once

namespace forge::windturbine {

struct Input {
    double rotorDiameterM;             // D
    double windSpeedMs;                // V_wind
    double airDensityKgPerM3;          // 1.225 default (sea-level 15 °C)
    double powerCoefficient;           // C_P ∈ (0, 16/27]
    double generatorEfficiency;        // η_drivetrain ∈ (0, 1]
    double rotorSpeedRpm;              // 0 = skip λ
    double capacityFactor;             // 0.30 typical onshore HAWT
};

struct Result {
    double sweptAreaM2;
    double availableWindPowerW;
    double betzCeilingPowerW;           // (16/27)·available
    double mechanicalPowerW;
    double electricalPowerW;
    double tipSpeedRatio;               // 0 if rpm not provided
    double annualEnergyMWh;
};

Result analyse(const Input& in);

}  // namespace forge::windturbine
