// Forge-314 — Compressed-air pipe sizing (CAGI / Atlas Copco / Ingersoll Rand
// utility-air piping design guides).
//
// Complements Forge-303 (Hazen-Williams water) and Forge-313 (saturated
// steam) — completes the in-plant utility-piping triad with compressed air.
// Used for shop air mains, robot cells, paint booths, pneumatic actuators,
// and instrument air laterals.
//
//   p_abs[bar] = p_gauge + 1.013                          isothermal Boyle
//   Q_line[m³/s] = Q_FAD / (p_abs / 1.013)                FAD → line volume
//   ρ_air        = 1.225 · (p_abs / 1.013)                15 °C dry-air ideal-gas
//
//   A_req = Q_line / v_limit                               velocity-based
//   D_req = √(4·A_req / π)
//
//   ΔP/L = f · ρ · V² / (2·D)                              Darcy, f ≈ 0.02
//
// Velocity limits (CAGI Handbook §4.4): 6-9 m/s mains, 10-15 m/s branches,
// 15-20 m/s drops. Velocities above ~25 m/s cause moisture-carryover issues
// and elbow erosion.

#pragma once

namespace forge::airpipe {

struct Input {
    double supplyPressureBarGauge;     // p_g (typical 7-9 barg shop air)
    double freeAirDeliveryM3PerMin;    // Q_FAD (at 1.013 bar, 15 °C standard)
    double velocityLimitMs;            // v_lim
    double pipeLengthM;                // L
};

struct Result {
    double absolutePressureBar;
    double actualVolumeFlowM3PerS;      // Q at line pressure
    double airDensityKgPerM3;
    double requiredAreaMm2;
    double requiredDiameterMm;
    double standardDN;
    double actualVelocityMs;
    double pressureDropBarPer100m;
    double totalPressureDropBar;
};

Result analyse(const Input& in);

}  // namespace forge::airpipe
