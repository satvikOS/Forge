// Forge-239 — Soil bearing capacity implementation.

#include "forge/BearingCapacity.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>
#include <string>

namespace forge::bearingcap {

namespace {
constexpr double pi = std::numbers::pi;
}

Shape shapeFromString(const char* s) {
    std::string ss(s);
    if (ss == "strip")    return Shape::Strip;
    if (ss == "square")   return Shape::Square;
    if (ss == "circular") return Shape::Circular;
    throw std::invalid_argument("unknown shape: " + ss);
}

Result analyse(const Input& in) {
    if (in.widthM <= 0.0) throw std::invalid_argument("B must be positive");
    if (in.depthM < 0.0)  throw std::invalid_argument("D must be ≥ 0");
    if (in.cohesionPa < 0.0) throw std::invalid_argument("c must be ≥ 0");
    if (in.surchargeKnPerM3 <= 0.0)
        throw std::invalid_argument("γ must be positive");
    if (in.frictionAngleDeg < 0.0 || in.frictionAngleDeg > 50.0)
        throw std::invalid_argument("φ must be in [0°, 50°]");
    if (in.factorOfSafety <= 0.0)
        throw std::invalid_argument("FS must be positive");

    Result r{};
    const double phi = in.frictionAngleDeg * pi / 180.0;
    const double tanphi = std::tan(phi);
    const double sinphi = std::sin(phi);

    // Meyerhof bearing capacity factors.
    r.Nq = std::exp(pi * tanphi) * std::pow(std::tan(0.25 * pi + 0.5 * phi), 2);
    if (phi == 0.0) {
        r.Nc = 5.14;  // limit
    } else {
        r.Nc = (r.Nq - 1.0) / tanphi;
    }
    r.Ngamma = (r.Nq - 1.0) * std::tan(1.4 * phi);
    if (r.Ngamma < 0.0) r.Ngamma = 0.0;

    // Shape factors.
    switch (in.shape) {
        case Shape::Strip:
            r.shapeFactorC = 1.0;
            r.shapeFactorQ = 1.0;
            r.shapeFactorGamma = 1.0;
            break;
        case Shape::Square:
        case Shape::Circular:
            r.shapeFactorC = 1.0 + (r.Nq / r.Nc);
            r.shapeFactorQ = 1.0 + tanphi;
            r.shapeFactorGamma = 0.6;
            break;
    }

    // Depth factors (Brinch-Hansen, D/B ≤ 1).
    const double dOverB = in.depthM / in.widthM;
    r.depthFactorC = 1.0 + 0.4 * dOverB;
    r.depthFactorQ = 1.0 + 2.0 * tanphi * (1.0 - sinphi) * (1.0 - sinphi) * dOverB;
    r.depthFactorGamma = 1.0;

    r.surchargePa = in.surchargeKnPerM3 * in.depthM;
    r.ultimateBearingPa =
        in.cohesionPa * r.Nc * r.shapeFactorC * r.depthFactorC
        + r.surchargePa * r.Nq * r.shapeFactorQ * r.depthFactorQ
        + 0.5 * in.surchargeKnPerM3 * in.widthM * r.Ngamma
            * r.shapeFactorGamma * r.depthFactorGamma;
    r.allowableBearingPa = r.ultimateBearingPa / in.factorOfSafety;
    return r;
}

}  // namespace forge::bearingcap
