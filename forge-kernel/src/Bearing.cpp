#include "forge/Bearing.hpp"

#include <cmath>
#include <stdexcept>

namespace forge { namespace bearing {

Kind kindFromString(const std::string& s) {
    if (s == "ball")   return Kind::Ball;
    if (s == "roller") return Kind::Roller;
    throw std::invalid_argument("bearing: kind must be ball|roller");
}

double reliabilityFactor(double r) {
    // ISO 281 table (interpolated piecewise constant for the 5 canonical
    // points; reject out-of-table values).
    if (std::fabs(r - 90.0)  < 0.01) return 1.00;
    if (std::fabs(r - 95.0)  < 0.01) return 0.62;
    if (std::fabs(r - 99.0)  < 0.01) return 0.21;
    if (std::fabs(r - 99.5)  < 0.01) return 0.13;
    if (std::fabs(r - 99.9)  < 0.01) return 0.04;
    throw std::invalid_argument("bearing: reliability must be 90/95/99/99.5/99.9");
}

double equivalentLoad(double Fr, double Fa, double X, double Y) {
    if (Fr < 0)  throw std::invalid_argument("equivalentLoad: F_r ≥ 0");
    if (Fa < 0)  throw std::invalid_argument("equivalentLoad: F_a ≥ 0");
    if (X < 0)   throw std::invalid_argument("equivalentLoad: X ≥ 0");
    if (Y < 0)   throw std::invalid_argument("equivalentLoad: Y ≥ 0");
    return X * Fr + Y * Fa;
}

double ratingLife10(double C, double P, Kind kind) {
    if (C <= 0)  throw std::invalid_argument("ratingLife10: C > 0");
    if (P <= 0)  throw std::invalid_argument("ratingLife10: P > 0");
    const double p = (kind == Kind::Ball) ? 3.0 : (10.0 / 3.0);
    return std::pow(C / P, p);
}

Outputs analyse(const Inputs& in) {
    Outputs out{};
    out.equivalentLoad = equivalentLoad(in.Fr, in.Fa, in.X, in.Y);
    out.L10MegaRev = ratingLife10(in.C, out.equivalentLoad, in.kind);
    out.reliabilityFactor = reliabilityFactor(in.reliabilityPercent);
    out.LnaMegaRev = out.reliabilityFactor * out.L10MegaRev;
    if (in.rpm > 0) {
        // L (hours) = L(10^6 rev) · 1e6 / (60 · rpm)
        out.L10Hours = out.L10MegaRev * 1e6 / (60.0 * in.rpm);
        out.LnaHours = out.LnaMegaRev * 1e6 / (60.0 * in.rpm);
    }
    return out;
}

}} // namespace forge::bearing
