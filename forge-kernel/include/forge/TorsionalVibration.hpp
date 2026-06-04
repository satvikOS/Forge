// Forge-336b — Crankshaft torsional vibration (Holzer method / Den Hartog).
//   Discrete inertia-spring chain (J_1...J_n inertias, k_1...k_(n−1) torsional stiffnesses).
//   For each trial frequency ω, propagate Holzer table from free end:
//     T_i = T_{i−1} + ω² · J_i · θ_i
//     θ_{i+1} = θ_i − T_i / k_i
//   Free-end natural frequency at ω where T_n → 0 (residual torque).
//   Bisection over ω in [ω_lo, ω_hi].
//   Critical orders: f_engine_speed × harmonic order ν = f_n → resonance.

#pragma once

#include <vector>

namespace forge::torvib {

struct Input {
    std::vector<double> inertias_kgm2;        // J_1...J_n
    std::vector<double> stiffnesses_NmPerRad; // k_1...k_(n−1)
    double frequencyLowerBound_Hz;
    double frequencyUpperBound_Hz;
    int    nModesSought;                       // search for the first N modes
};

struct Mode {
    double frequency_Hz;
    std::vector<double> shape;                 // θ_1...θ_n normalised
};

struct Result {
    std::vector<Mode> modes;
    int    iterationsTotal;
};

Result analyse(const Input& in);

}  // namespace forge::torvib
