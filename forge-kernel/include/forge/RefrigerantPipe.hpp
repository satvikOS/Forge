// Forge-323b — Refrigerant pipe sizing (ASHRAE Handbook — Refrigeration Ch.2).
//   ṁ_ref = Q / Δh
//   A     = ṁ · v_g / v_target
//   D     = √(4A/π)
// Standard velocity limits: 6 m/s suction (oil-return), 18 m/s discharge,
// 1 m/s liquid.

#pragma once

namespace forge::refpipe {

struct Input {
    double coolingDutyKw;
    double enthalpyChangeKJpkg;        // Δh refrigerant
    double specificVolumeM3pkg;        // v_g at line condition
    double velocityLimitMs;            // 6/18/1 by line type
};

struct Result {
    double massFlowKgPerS;
    double volumeFlowM3PerS;
    double requiredAreaMm2;
    double requiredDiameterMm;
};

Result analyse(const Input& in);

}  // namespace forge::refpipe
