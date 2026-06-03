// Forge-283 — implementation; see header for derivation references.

#include "forge/ChainDrive.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::chaindrive {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.pitchMm <= 0.0)
        throw std::runtime_error("pitchMm must be > 0");
    if (in.driverTeeth < 9 || in.driverTeeth > 200)
        throw std::runtime_error("driverTeeth must be in [9, 200]");
    if (in.drivenTeeth < 9 || in.drivenTeeth > 200)
        throw std::runtime_error("drivenTeeth must be in [9, 200]");
    if (in.centerDistanceMm <= 0.0)
        throw std::runtime_error("centerDistanceMm must be > 0");
    if (in.driverSpeedRpm <= 0.0)
        throw std::runtime_error("driverSpeedRpm must be > 0");

    const double p  = in.pitchMm;
    const int N1    = in.driverTeeth;
    const int N2    = in.drivenTeeth;
    const double C  = in.centerDistanceMm;
    const double n1 = in.driverSpeedRpm;

    const double d1 = p / std::sin(PI / static_cast<double>(N1));
    const double d2 = p / std::sin(PI / static_cast<double>(N2));

    const double ratio = static_cast<double>(N2) / static_cast<double>(N1);
    const double n2    = n1 / ratio;

    // ANSI velocity (mm·rev / mm/min → m/s): v_m_per_s = N_1·p·n_1 / (60·1000)
    const double v = static_cast<double>(N1) * p * n1 / 60000.0;

    // Approximate chain length.
    const double L = 2.0 * C
                   + (static_cast<double>(N1 + N2)) * p / 2.0
                   + std::pow(static_cast<double>(N2 - N1), 2) * p * p
                       / (4.0 * PI * PI * C);

    const double L_pitches = L / p;
    int L_round = static_cast<int>(std::ceil(L_pitches));
    if (L_round % 2 != 0) ++L_round;          // chain length must be even pitches

    // Recompute C so the final chain length matches the rounded pitches.
    const double A = static_cast<double>(L_round) - 0.5 * (N1 + N2);
    const double B = static_cast<double>(N2 - N1) / (2.0 * PI);
    const double disc = A * A - 8.0 * B * B;
    if (disc < 0.0)
        throw std::runtime_error("Chain length too short for these sprockets");
    const double C_pitches = (A + std::sqrt(disc)) / 4.0;
    const double C_final = C_pitches * p;

    Result r;
    r.driverPitchDiameterMm   = d1;
    r.drivenPitchDiameterMm   = d2;
    r.speedRatio              = ratio;
    r.drivenSpeedRpm          = n2;
    r.chainVelocityMs         = v;
    r.approxLengthMm          = L;
    r.lengthInPitches         = L_pitches;
    r.lengthInPitchesRounded  = L_round;
    r.finalCenterDistanceMm   = C_final;
    return r;
}

}  // namespace forge::chaindrive
