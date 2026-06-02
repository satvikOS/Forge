// Forge-240 — Retaining wall implementation (Rankine, level backfill).

#include "forge/RetainingWall.hpp"

#include <cmath>
#include <limits>
#include <numbers>
#include <stdexcept>

namespace forge::retwall {

namespace {
constexpr double pi = std::numbers::pi;
}

Result analyse(const Input& in) {
    if (in.totalHeightM <= 0.0 || in.baseWidthM <= 0.0)
        throw std::invalid_argument("H, B_base must be positive");
    if (in.embedmentDepthM < 0.0) throw std::invalid_argument("D must be ≥ 0");
    if (in.toeWidthM < 0.0 || in.toeWidthM > in.baseWidthM)
        throw std::invalid_argument("toe width out of range");
    if (in.stemThicknessM <= 0.0 || in.baseThicknessM <= 0.0)
        throw std::invalid_argument("stem and base thickness must be positive");
    if (in.unitWeightSoilNPerM3 <= 0.0 || in.unitWeightConcreteNPerM3 <= 0.0)
        throw std::invalid_argument("unit weights must be positive");
    if (in.frictionAngleDeg < 0.0 || in.frictionAngleDeg > 50.0)
        throw std::invalid_argument("φ must be in [0°, 50°]");
    if (in.allowableBearingPa <= 0.0)
        throw std::invalid_argument("q_allow must be positive");

    Result r{};
    const double phi = in.frictionAngleDeg * pi / 180.0;
    const double sinphi = std::sin(phi);
    r.Ka = (1.0 - sinphi) / (1.0 + sinphi);
    r.Kp = (1.0 + sinphi) / (1.0 - sinphi);

    const double H = in.totalHeightM;
    const double D = in.embedmentDepthM;
    const double gamma = in.unitWeightSoilNPerM3;
    const double qs = in.surchargePa;

    // Active forces (per unit length of wall).
    const double P_soil = 0.5 * r.Ka * gamma * H * H;
    const double P_surch = r.Ka * qs * H;
    r.activeForceN = P_soil + P_surch;
    // Moments about toe (driving): triangular at H/3, rectangular at H/2.
    r.activeMomentNm = P_soil * (H / 3.0) + P_surch * (H / 2.0);

    // Passive resistance.
    r.passiveForceN = 0.5 * r.Kp * gamma * D * D;

    // Resisting moments — gather vertical-load contributions about toe.
    const double B = in.baseWidthM;
    const double t = in.stemThicknessM;
    const double tb = in.baseThicknessM;
    const double toe = in.toeWidthM;
    const double gc = in.unitWeightConcreteNPerM3;

    // Stem rectangle: arm = toe + t/2.
    const double W_stem = gc * t * H;
    const double x_stem = toe + t * 0.5;

    // Base rectangle: arm = B/2.
    const double W_base = gc * B * tb;
    const double x_base = B * 0.5;

    // Soil over heel: width = (B − toe − t). arm = toe + t + (B − toe − t)/2.
    const double heelWidth = B - toe - t;
    const double soilOnHeelHeight = H;  // approximation: backfill full stem height
    const double W_soil = (heelWidth > 0.0) ? (gamma * heelWidth * soilOnHeelHeight)
                                            : 0.0;
    const double x_soil = (heelWidth > 0.0) ? (toe + t + heelWidth * 0.5) : 0.0;

    // Surcharge on heel: w = q_s · heelWidth.
    const double W_surch = (heelWidth > 0.0) ? (qs * heelWidth) : 0.0;
    const double x_surch = x_soil;

    r.weightTotalN = W_stem + W_base + W_soil + W_surch;
    r.resistingMomentNm = W_stem * x_stem + W_base * x_base
                        + W_soil * x_soil + W_surch * x_surch;

    r.overturningMomentNm = r.activeMomentNm;
    r.safetyFactorOverturning = r.resistingMomentNm / r.overturningMomentNm;

    // Sliding resistance: μ·N + cohesion at base + passive force.
    const double F_resist = in.frictionCoeffBase * r.weightTotalN
                          + in.cohesionPa * B
                          + r.passiveForceN;
    r.safetyFactorSliding = F_resist / r.activeForceN;

    // Bearing pressure under base.
    const double M_net = r.resistingMomentNm - r.overturningMomentNm;
    r.resultantArmM = M_net / r.weightTotalN;
    r.eccentricityM = B * 0.5 - r.resultantArmM;
    const double avgQ = r.weightTotalN / B;
    const double dQ = 6.0 * r.weightTotalN * r.eccentricityM / (B * B);
    r.toeBearingPa = avgQ + dQ;
    r.heelBearingPa = avgQ - dQ;
    r.safetyFactorBearing = (r.toeBearingPa > 0.0)
                              ? in.allowableBearingPa / r.toeBearingPa
                              : std::numeric_limits<double>::infinity();
    return r;
}

}  // namespace forge::retwall
