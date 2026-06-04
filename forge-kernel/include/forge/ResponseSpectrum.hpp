// Forge-333d — Single-DOF response spectrum (Newmark β-method).
//   Equation:   m·ẍ + c·ẋ + k·x = −m·ü_g(t)
//   ζ damping ratio,   ω_n = √(k/m),   c = 2·ζ·ω_n·m
//   For each natural period T in [T_min, T_max]:
//     ω = 2π/T,  k = m·ω², c = 2·ζ·ω·m
//     Newmark constant-average-acceleration  γ=1/2, β=1/4
//     Track peak |x|, |ẋ|, |ẍ + ü_g|
//   Output spectra:  S_d(T), S_v(T), S_a(T).

#pragma once

#include <vector>

namespace forge::rspect {

struct Input {
    std::vector<double> time_s;        // sample times (uniform Δt)
    std::vector<double> accel_ms2;     // ü_g(t)
    double dampingRatio;               // ζ
    double Tmin_s;
    double Tmax_s;
    int    nSpectralPoints;
};

struct Point {
    double T_s;
    double Sd_m;
    double Sv_mps;
    double Sa_mps2;
};

struct Result {
    std::vector<Point> spectrum;
    double peakGroundAccel_ms2;
};

Result analyse(const Input& in);

}  // namespace forge::rspect
