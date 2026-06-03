// Forge-258 — Machining feeds + speeds + cutting force + spindle power.
//
// Turning:
//   V_c (m/min) = π·D·n / 1000      → n (rpm) = V_c·1000 / (π·D)
//   f (mm/rev) = f_n (per-revolution feed)
//   MRR (cm³/min) = V_c · f · a_p · 10
//   F_c (N) = K_c · b · h     where K_c (specific cutting force, N/mm²),
//                                  b = a_p, h = f_n·sin(κ).
//   P_c (kW) = F_c · V_c / 60 / 1000
//
// Milling (face/end mill):
//   V_c = π·D·n / 1000   → n = V_c·1000 / (π·D)
//   F (mm/min) = f_z · z · n         (f_z = chip per tooth, z = teeth)
//   MRR (cm³/min) = a_p · a_e · F / 1000
//
// Drilling:
//   V_c = π·D·n / 1000
//   F (mm/min) = f_n · n
//   MRR (cm³/min) = π·D²/4 · F / 1000

#pragma once

namespace forge::machining {

struct TurningInput {
    double diameterMm;       // D
    double cuttingSpeedM_min; // V_c
    double feedPerRevMm;     // f_n
    double depthOfCutMm;     // a_p
    double specificCuttingForceN_mm2; // K_c
    double machineEfficiency; // η (0.7-0.85 typical)
    double leadAngleDeg;     // κ (90° = perpendicular)
};

struct TurningResult {
    double spindleSpeedRpm;
    double mrrCm3Min;
    double cuttingForceN;
    double powerKw;
};

TurningResult turning(const TurningInput& in);

struct MillingInput {
    double diameterMm;
    double cuttingSpeedM_min;
    double feedPerToothMm;   // f_z
    int    numberOfTeeth;    // z
    double axialDepthMm;     // a_p
    double radialDepthMm;    // a_e
    double specificCuttingForceN_mm2;
    double machineEfficiency;
};

struct MillingResult {
    double spindleSpeedRpm;
    double feedRateMmMin;
    double mrrCm3Min;
    double cuttingForceN;    // F_t per tooth × engaged teeth (average)
    double powerKw;
};

MillingResult milling(const MillingInput& in);

struct DrillingInput {
    double diameterMm;
    double cuttingSpeedM_min;
    double feedPerRevMm;
    double specificCuttingForceN_mm2;
    double machineEfficiency;
};

struct DrillingResult {
    double spindleSpeedRpm;
    double feedRateMmMin;
    double mrrCm3Min;
    double thrustForceN;
    double torqueNm;
    double powerKw;
};

DrillingResult drilling(const DrillingInput& in);

}  // namespace forge::machining
