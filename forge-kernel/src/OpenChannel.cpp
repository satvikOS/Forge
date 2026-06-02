// Forge-242 — Open-channel flow implementation.

#include "forge/OpenChannel.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::openchannel {

SectionResult sectionAtDepth(const GeomInput& g, double y) {
    if (y <= 0.0) throw std::invalid_argument("depth must be positive");
    if (g.bottomWidthM < 0.0) throw std::invalid_argument("b must be ≥ 0");
    if (g.sideSlopeM < 0.0) throw std::invalid_argument("m must be ≥ 0");
    SectionResult r{};
    r.area = (g.bottomWidthM + g.sideSlopeM * y) * y;
    r.wetPerim = g.bottomWidthM + 2.0 * y * std::sqrt(1.0 + g.sideSlopeM * g.sideSlopeM);
    r.hydraulicRadius = (r.wetPerim > 0.0) ? (r.area / r.wetPerim) : 0.0;
    r.topWidth = g.bottomWidthM + 2.0 * g.sideSlopeM * y;
    return r;
}

double manningDischarge(const UniformInput& u) {
    if (u.manningN <= 0.0) throw std::invalid_argument("n must be positive");
    if (u.slope <= 0.0)    throw std::invalid_argument("S must be positive");
    const SectionResult s = sectionAtDepth(u.geom, u.depthM);
    return (1.0 / u.manningN) * s.area * std::pow(s.hydraulicRadius, 2.0 / 3.0)
           * std::sqrt(u.slope);
}

double normalDepth(const NormalDepthInput& in) {
    if (in.targetDischarge <= 0.0)
        throw std::invalid_argument("Q must be positive");
    // Newton-Raphson on Q(y) − Q_target with central-difference derivative.
    double y = 1.0;  // initial guess
    for (int iter = 0; iter < 200; ++iter) {
        const double dy = std::max(1e-6, y * 1e-4);
        UniformInput uPlus = { in.geom, in.manningN, in.slope, y + dy };
        UniformInput uMinus = { in.geom, in.manningN, in.slope,
                                std::max(1e-9, y - dy) };
        UniformInput u0 = { in.geom, in.manningN, in.slope, y };
        const double F = manningDischarge(u0) - in.targetDischarge;
        const double dF = (manningDischarge(uPlus) - manningDischarge(uMinus))
                          / (2.0 * dy);
        if (std::abs(dF) < 1e-12) break;
        const double y_next = y - F / dF;
        if (!std::isfinite(y_next) || y_next <= 0.0) {
            y *= 0.5;  // bisection-ish fallback
            continue;
        }
        if (std::abs(y_next - y) < 1e-9) {
            y = y_next;
            break;
        }
        y = y_next;
    }
    return y;
}

double criticalDepth(const CriticalDepthInput& in) {
    if (in.dischargeQ <= 0.0) throw std::invalid_argument("Q must be positive");
    if (in.gravityG <= 0.0)   throw std::invalid_argument("g must be positive");
    // Solve f(y) = Q² · T(y) / (g · A(y)³) − 1 = 0.
    auto f = [&](double y) {
        const SectionResult s = sectionAtDepth(in.geom, y);
        return in.dischargeQ * in.dischargeQ * s.topWidth
               / (in.gravityG * s.area * s.area * s.area) - 1.0;
    };
    double y = 1.0;
    for (int iter = 0; iter < 200; ++iter) {
        const double dy = std::max(1e-6, y * 1e-4);
        const double f0 = f(y);
        const double fp = f(y + dy);
        const double fm = f(std::max(1e-9, y - dy));
        const double df = (fp - fm) / (2.0 * dy);
        if (std::abs(df) < 1e-12) break;
        const double y_next = y - f0 / df;
        if (!std::isfinite(y_next) || y_next <= 0.0) {
            y *= 0.5;
            continue;
        }
        if (std::abs(y_next - y) < 1e-9) {
            y = y_next;
            break;
        }
        y = y_next;
    }
    return y;
}

FlowRegimeResult flowRegime(const FlowRegimeInput& in) {
    if (in.dischargeQ <= 0.0) throw std::invalid_argument("Q must be positive");
    if (in.gravityG <= 0.0)   throw std::invalid_argument("g must be positive");
    FlowRegimeResult r{};
    const SectionResult s = sectionAtDepth(in.geom, in.depthM);
    r.area = s.area;
    r.topWidth = s.topWidth;
    r.hydraulicDepth = (s.topWidth > 0.0) ? (s.area / s.topWidth) : 0.0;
    r.velocity = in.dischargeQ / s.area;
    r.froude = r.velocity / std::sqrt(in.gravityG * r.hydraulicDepth);
    if (r.froude < 1.0 - 1e-9)      r.regime = +1;  // subcritical
    else if (r.froude > 1.0 + 1e-9) r.regime = -1;  // supercritical
    else                            r.regime = 0;
    return r;
}

}  // namespace forge::openchannel
