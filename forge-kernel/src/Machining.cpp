// Forge-258 — Machining implementation.

#include "forge/Machining.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::machining {

namespace {
constexpr double pi = std::numbers::pi;

void requireDiameter(double D) {
    if (D <= 0.0) throw std::invalid_argument("diameter must be > 0");
}
void requireSpeed(double V_c) {
    if (V_c <= 0.0) throw std::invalid_argument("cutting speed must be > 0");
}
void requireFeed(double f) {
    if (f <= 0.0) throw std::invalid_argument("feed must be > 0");
}
void requireDepth(double a) {
    if (a <= 0.0) throw std::invalid_argument("depth must be > 0");
}
void requireK_c(double K) {
    if (K <= 0.0) throw std::invalid_argument("K_c must be > 0");
}
void requireEta(double e) {
    if (e <= 0.0 || e > 1.0) throw std::invalid_argument("η in (0, 1]");
}
}  // namespace

TurningResult turning(const TurningInput& in) {
    requireDiameter(in.diameterMm);
    requireSpeed(in.cuttingSpeedM_min);
    requireFeed(in.feedPerRevMm);
    requireDepth(in.depthOfCutMm);
    requireK_c(in.specificCuttingForceN_mm2);
    requireEta(in.machineEfficiency);
    if (in.leadAngleDeg <= 0.0 || in.leadAngleDeg > 90.0)
        throw std::invalid_argument("κ in (0, 90]");

    TurningResult r{};
    r.spindleSpeedRpm = in.cuttingSpeedM_min * 1000.0 / (pi * in.diameterMm);
    // Sandvik form: Q (cm³/min) = V_c (m/min) · f (mm/rev) · a_p (mm)
    r.mrrCm3Min = in.cuttingSpeedM_min * in.feedPerRevMm * in.depthOfCutMm;
    // h = f_n · sin κ; b = a_p / sin κ (so b·h = f_n · a_p product invariant).
    const double sinkappa = std::sin(in.leadAngleDeg * pi / 180.0);
    const double h = in.feedPerRevMm * sinkappa;
    const double b = in.depthOfCutMm / sinkappa;
    r.cuttingForceN = in.specificCuttingForceN_mm2 * b * h;
    r.powerKw = r.cuttingForceN * in.cuttingSpeedM_min / 60.0 / 1000.0
                / in.machineEfficiency;
    return r;
}

MillingResult milling(const MillingInput& in) {
    requireDiameter(in.diameterMm);
    requireSpeed(in.cuttingSpeedM_min);
    requireFeed(in.feedPerToothMm);
    requireDepth(in.axialDepthMm);
    if (in.radialDepthMm <= 0.0) throw std::invalid_argument("a_e must be > 0");
    if (in.numberOfTeeth < 1) throw std::invalid_argument("teeth ≥ 1");
    requireK_c(in.specificCuttingForceN_mm2);
    requireEta(in.machineEfficiency);

    MillingResult r{};
    r.spindleSpeedRpm = in.cuttingSpeedM_min * 1000.0 / (pi * in.diameterMm);
    r.feedRateMmMin   = in.feedPerToothMm * in.numberOfTeeth * r.spindleSpeedRpm;
    r.mrrCm3Min       = in.axialDepthMm * in.radialDepthMm * r.feedRateMmMin / 1000.0;
    // Tangential cutting force per tooth: F_t = K_c · a_p · f_z (chip area).
    const double F_t_per_tooth = in.specificCuttingForceN_mm2
                              * in.axialDepthMm * in.feedPerToothMm;
    // Engaged teeth (average) ≈ z · a_e/(π·D) for face milling.
    const double engagedTeeth = static_cast<double>(in.numberOfTeeth)
                              * in.radialDepthMm / (pi * in.diameterMm);
    r.cuttingForceN = F_t_per_tooth * (engagedTeeth > 1.0 ? engagedTeeth : 1.0);
    r.powerKw = r.cuttingForceN * in.cuttingSpeedM_min / 60.0 / 1000.0
                / in.machineEfficiency;
    return r;
}

DrillingResult drilling(const DrillingInput& in) {
    requireDiameter(in.diameterMm);
    requireSpeed(in.cuttingSpeedM_min);
    requireFeed(in.feedPerRevMm);
    requireK_c(in.specificCuttingForceN_mm2);
    requireEta(in.machineEfficiency);

    DrillingResult r{};
    r.spindleSpeedRpm = in.cuttingSpeedM_min * 1000.0 / (pi * in.diameterMm);
    r.feedRateMmMin   = in.feedPerRevMm * r.spindleSpeedRpm;
    r.mrrCm3Min       = pi * in.diameterMm * in.diameterMm / 4.0
                       * r.feedRateMmMin / 1000.0;
    // Thrust: approximately K_c·D·f_n/4 (per cutting edge × 2 edges).
    // Use approximation F_thrust ≈ K_c · D · f_n / 4 for two flutes.
    r.thrustForceN = in.specificCuttingForceN_mm2 * in.diameterMm
                    * in.feedPerRevMm / 4.0;
    // Torque: K_c · D² · f_n / 8.
    const double torqueNmm = in.specificCuttingForceN_mm2
                          * in.diameterMm * in.diameterMm * in.feedPerRevMm / 8.0;
    r.torqueNm = torqueNmm / 1000.0;
    r.powerKw = r.torqueNm * 2.0 * pi * r.spindleSpeedRpm / 60.0 / 1000.0
                / in.machineEfficiency;
    return r;
}

}  // namespace forge::machining
