// Forge-309 — implementation; see header for derivation references.

#include "forge/MononobeOkabe.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::mokabe {

namespace {
double deg2rad(double d) { return d * 3.141592653589793 / 180.0; }
}

Result analyse(const Input& in) {
    if (in.soilFrictionAngleDeg <= 0.0 || in.soilFrictionAngleDeg >= 90.0)
        throw std::runtime_error("soilFrictionAngleDeg must be in (0, 90)");
    if (in.wallFrictionAngleDeg < 0.0 || in.wallFrictionAngleDeg >= in.soilFrictionAngleDeg)
        throw std::runtime_error("wallFrictionAngleDeg must be in [0, φ)");
    if (in.backfillSlopeDeg < -90.0 || in.backfillSlopeDeg >= in.soilFrictionAngleDeg)
        throw std::runtime_error("backfillSlopeDeg must be < φ for finite K_AE");
    if (in.wallTiltDeg <= -90.0 || in.wallTiltDeg >= 90.0)
        throw std::runtime_error("wallTiltDeg must be in (−90, 90)");
    if (in.horizontalSeismicCoeff < 0.0)
        throw std::runtime_error("horizontalSeismicCoeff must be ≥ 0");
    if (in.verticalSeismicCoeff >= 1.0)
        throw std::runtime_error("verticalSeismicCoeff must be < 1");
    if (in.soilUnitWeightKnPerM3 <= 0.0)
        throw std::runtime_error("soilUnitWeightKnPerM3 must be > 0");
    if (in.wallHeightM <= 0.0)
        throw std::runtime_error("wallHeightM must be > 0");

    const double phi   = deg2rad(in.soilFrictionAngleDeg);
    const double delta = deg2rad(in.wallFrictionAngleDeg);
    const double i     = deg2rad(in.backfillSlopeDeg);
    const double beta  = deg2rad(in.wallTiltDeg);
    const double kh    = in.horizontalSeismicCoeff;
    const double kv    = in.verticalSeismicCoeff;
    const double gamma = in.soilUnitWeightKnPerM3;
    const double H     = in.wallHeightM;

    const double theta = std::atan(kh / (1.0 - kv));

    auto K_coeff = [&](double th) {
        const double a = phi - th - beta;
        const double num = std::cos(a) * std::cos(a);
        const double den_outer = std::cos(th)
                                * std::cos(beta) * std::cos(beta)
                                * std::cos(delta + beta + th);
        const double inner_num = std::sin(phi + delta) * std::sin(phi - th - i);
        const double inner_den = std::cos(delta + beta + th) * std::cos(i - beta);
        if (inner_den == 0.0 || den_outer == 0.0)
            throw std::runtime_error("degenerate geometry — coefficient diverges");
        const double sqrtN = std::sqrt(std::max(0.0, inner_num / inner_den));
        const double bracket = (1.0 + sqrtN);
        return num / (den_outer * bracket * bracket);
    };

    const double Kae = K_coeff(theta);
    const double Ka  = K_coeff(0.0);

    const double P_a   = 0.5 * gamma * H * H * Ka;
    const double P_AE  = 0.5 * gamma * H * H * Kae * (1.0 - kv);
    const double dP    = P_AE - P_a;

    // Seed & Whitman composite point of application
    double yBar;
    if (P_AE > 0.0) {
        yBar = (P_a * (H / 3.0) + dP * (0.6 * H)) / P_AE;
    } else {
        yBar = H / 3.0;
    }

    Result r;
    r.staticKa                       = Ka;
    r.seismicKae                     = Kae;
    r.seismicInertiaAngleDeg         = theta * 180.0 / 3.141592653589793;
    r.staticForceKnPerM              = P_a;
    r.totalSeismicForceKnPerM        = P_AE;
    r.seismicIncrementKnPerM         = dP;
    r.pointOfApplicationFromBaseM    = yBar;
    return r;
}

}  // namespace forge::mokabe
