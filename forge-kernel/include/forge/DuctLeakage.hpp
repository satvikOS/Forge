// Forge-323d — SMACNA duct leakage class (SMACNA HVAC Air Duct Leakage Test
// Manual 2nd ed).
//   Q_leak [cfm/100 ft²] = C_L · (ΔP[in H₂O] / 0.04)^0.65
//   Class A: C_L = 12, Class B: 6, Class C: 3, Class 2 (low-leak): 2

#pragma once

namespace forge::ductleak {

struct Input {
    double ductSurfaceAreaM2;
    double testPressureInchWC;        // 0.04 (low) - 10 (high)
    double leakageClassCL;            // 2, 3, 6, 12 typical
};

struct Result {
    double leakageRateCfmPer100ft2;
    double leakageRateLPerSperM2;
    double totalLeakageLPerS;
    double totalLeakageCfm;
};

Result analyse(const Input& in);

}  // namespace forge::ductleak
