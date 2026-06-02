#include "forge/Buckling.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace buckling {

namespace { constexpr double kPi = 3.14159265358979323846; }

double effectiveLengthFactor(EndCondition c) {
    switch (c) {
        case EndCondition::PinnedPinned: return 1.0;
        case EndCondition::FixedFixed:   return 0.5;
        case EndCondition::FixedFree:    return 2.0;
        case EndCondition::FixedPinned:  return 0.699;
    }
    return 1.0;
}

Section sectionRectangle(double b, double h) {
    if (b <= 0 || h <= 0) throw std::invalid_argument("rectangle: b, h > 0");
    Section s{};
    s.area = b * h;
    s.secondMomentI = b * h * h * h / 12.0;
    if (h > b) s.secondMomentI = h * b * b * b / 12.0;  // weak axis
    return s;
}

Section sectionSolidCircle(double d) {
    if (d <= 0) throw std::invalid_argument("solid circle: d > 0");
    Section s{};
    s.area = kPi * d * d / 4.0;
    s.secondMomentI = kPi * d * d * d * d / 64.0;
    return s;
}

Section sectionHollowCircle(double dOuter, double dInner) {
    if (dOuter <= 0 || dInner < 0 || dInner >= dOuter)
        throw std::invalid_argument("hollow circle: 0 ≤ dInner < dOuter");
    Section s{};
    s.area = kPi * (dOuter * dOuter - dInner * dInner) / 4.0;
    s.secondMomentI = kPi * (std::pow(dOuter, 4) - std::pow(dInner, 4)) / 64.0;
    return s;
}

Outputs analyse(const Inputs& in) {
    if (in.area <= 0)             throw std::invalid_argument("analyse: area > 0");
    if (in.secondMomentI <= 0)    throw std::invalid_argument("analyse: I > 0");
    if (in.length <= 0)           throw std::invalid_argument("analyse: L > 0");
    if (in.youngsModulus <= 0)    throw std::invalid_argument("analyse: E > 0");
    if (in.yieldStrength <= 0)    throw std::invalid_argument("analyse: σy > 0");

    Outputs out{};
    const double K = effectiveLengthFactor(in.ends);
    out.radiusOfGyration   = std::sqrt(in.secondMomentI / in.area);
    out.slenderness        = K * in.length / out.radiusOfGyration;
    out.slendernessTransition = std::sqrt(2.0 * kPi * kPi * in.youngsModulus
                                         / in.yieldStrength);
    if (out.slenderness >= out.slendernessTransition) {
        out.criticalLoad = kPi * kPi * in.youngsModulus * in.secondMomentI
                         / std::pow(K * in.length, 2);
        out.mode = "euler";
    } else {
        const double lam = out.slenderness;
        const double term = 1.0 - in.yieldStrength * lam * lam
                                / (4.0 * kPi * kPi * in.youngsModulus);
        out.criticalLoad = in.yieldStrength * in.area * term;
        out.mode = "johnson";
    }
    out.allowableLoad = out.criticalLoad;     // safety factor applied externally
    return out;
}

}} // namespace forge::buckling
