#include "forge/GearPair.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace gearpair {

namespace { constexpr double kPi = 3.14159265358979323846; }

double lewisFormFactor(double teeth) {
    if (teeth < 12) throw std::invalid_argument("lewisFormFactor: N ≥ 12");
    // Fit to Shigley Table 14-2 for 20° full-depth involute.
    return 0.484 - 0.2745 / std::sqrt(teeth);
}

Outputs analyse(const Inputs& in) {
    if (in.module <= 0)         throw std::invalid_argument("gearpair: module > 0");
    if (in.teeth1 < 12)         throw std::invalid_argument("gearpair: N1 ≥ 12");
    if (in.teeth2 < 12)         throw std::invalid_argument("gearpair: N2 ≥ 12");
    if (in.faceWidth <= 0)      throw std::invalid_argument("gearpair: faceWidth > 0");
    if (in.torque1 <= 0)        throw std::invalid_argument("gearpair: torque1 > 0");
    if (in.materialE1 <= 0 || in.materialE2 <= 0)
        throw std::invalid_argument("gearpair: E > 0");
    if (in.materialNu1 <= 0 || in.materialNu1 >= 0.5 ||
        in.materialNu2 <= 0 || in.materialNu2 >= 0.5)
        throw std::invalid_argument("gearpair: ν ∈ (0, 0.5)");

    Outputs out{};
    const double r1 = in.module * in.teeth1 / 2.0;  // mm
    const double r2 = in.module * in.teeth2 / 2.0;  // mm
    out.centreDistance = r1 + r2;
    out.gearRatio      = in.teeth2 / in.teeth1;
    out.pitchDiameter1 = 2.0 * r1;
    out.pitchDiameter2 = 2.0 * r2;

    // Tangential force (N): T in N·mm, r in mm → W in N.
    out.tangentialLoadN = in.torque1 / r1;

    out.lewisFormFactor1 = lewisFormFactor(in.teeth1);
    out.lewisFormFactor2 = lewisFormFactor(in.teeth2);

    // Lewis bending stress σ = W_t / (b · m · Y) [N / (mm · mm) = N/mm² = MPa]
    // Multiply by 1e6 to convert MPa → Pa.
    out.bendingStressLewis1 =
        out.tangentialLoadN / (in.faceWidth * in.module * out.lewisFormFactor1) * 1e6;
    out.bendingStressLewis2 =
        out.tangentialLoadN / (in.faceWidth * in.module * out.lewisFormFactor2) * 1e6;

    const double F = in.KO * in.KV * in.KS * in.KH * in.KB;
    out.bendingStressAGMA1 = out.bendingStressLewis1 * F;
    out.bendingStressAGMA2 = out.bendingStressLewis2 * F;

    // Hertz contact stress at pitch point.
    const double phi = in.pressureAngleDeg * kPi / 180.0;
    const double I = (std::sin(phi) * std::cos(phi) * out.gearRatio) /
                     (2.0 * (out.gearRatio + 1.0));
    const double ZE = std::sqrt(1.0 / (kPi *
        ((1.0 - in.materialNu1 * in.materialNu1) / in.materialE1 +
         (1.0 - in.materialNu2 * in.materialNu2) / in.materialE2)));
    // σ_H = ZE · √(W_t / (b · d_1 · I))  [b, d_1 in mm → use 1e-3 to get m]
    // ZE [Pa^½], W_t [N], b·d_1 in mm² → convert b·d_1 to m²: × 1e-6.
    const double denominator = (in.faceWidth * 1e-3) * (out.pitchDiameter1 * 1e-3) * I;
    out.contactStressHertz = ZE * std::sqrt(out.tangentialLoadN / denominator);

    return out;
}

}} // namespace forge::gearpair
