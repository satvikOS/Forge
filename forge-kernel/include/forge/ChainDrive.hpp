// Forge-283 — Roller-chain drive geometry (ANSI B29.1 / ASME B29).
//
// Used for power transmission between parallel shafts using standard ANSI
// chain numbers (40 = 1/2", 60 = 3/4", 80 = 1" pitch, etc.).
//
//   Pitch diameter:   d = p / sin(π / N)               for each sprocket
//   Speed ratio:      i = N_2 / N_1                    (driven / driver)
//   Driven speed:     n_2 = n_1 / i
//   Chain velocity:   v = N_1 · p · n_1 / (60 · 1000)  [m/s]    (with p in mm)
//   Approximate
//     chain length:   L ≈ 2·C + (N_1 + N_2) · p / 2
//                          + (N_2 − N_1)² · p² / (4·π²·C)        [mm]
//   Length in pitches L_p = L / p, rounded up to next even integer (chain
//                          length must be in even pitches to splice).
//   Recalculated C    after L_p rounding so the design matches an available
//                    chain length:
//        Let A = L_p − (N_1 + N_2)/2
//        Let B = (N_2 − N_1) / (2π)
//        C_new (in pitches) = (A + √(A² − 8·B²)) / 4
//        C_new_mm = C_new · p
//
// Inputs SI throughout.

#pragma once

namespace forge::chaindrive {

struct Input {
    double pitchMm;                 // p
    int    driverTeeth;             // N_1
    int    drivenTeeth;             // N_2
    double centerDistanceMm;        // C (initial / desired)
    double driverSpeedRpm;          // n_1
};

struct Result {
    double driverPitchDiameterMm;   // d_1
    double drivenPitchDiameterMm;   // d_2
    double speedRatio;              // i
    double drivenSpeedRpm;          // n_2
    double chainVelocityMs;         // v
    double approxLengthMm;          // L raw
    double lengthInPitches;         // L / p, raw
    int    lengthInPitchesRounded;  // even integer ≥ L/p
    double finalCenterDistanceMm;   // C after L rounding
};

Result analyse(const Input& in);

}  // namespace forge::chaindrive
