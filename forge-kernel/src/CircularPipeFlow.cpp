// Forge-289 — implementation; see header for derivation references.

#include "forge/CircularPipeFlow.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::circpipe {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.pipeDiameterM <= 0.0)
        throw std::runtime_error("pipeDiameterM must be > 0");
    if (in.waterDepthM <= 0.0)
        throw std::runtime_error("waterDepthM must be > 0");
    if (in.waterDepthM > in.pipeDiameterM)
        throw std::runtime_error("waterDepthM must be ≤ pipeDiameterM (free surface)");
    if (in.manningN <= 0.0)
        throw std::runtime_error("manningN must be > 0");
    if (in.slope <= 0.0)
        throw std::runtime_error("slope must be > 0");

    const double D = in.pipeDiameterM;
    const double d = in.waterDepthM;
    const double n = in.manningN;
    const double S = in.slope;

    // Cap argument of arccos to [-1, 1] to handle the d = D edge case
    // (where 1 - 2·d/D = -1) without nan.
    double cosArg = 1.0 - 2.0 * d / D;
    if (cosArg < -1.0) cosArg = -1.0;
    if (cosArg >  1.0) cosArg =  1.0;
    const double theta = 2.0 * std::acos(cosArg);

    const double A   = D * D / 8.0 * (theta - std::sin(theta));
    const double P   = D * theta / 2.0;
    const double R   = (P > 0.0) ? A / P : 0.0;
    const double V   = (R > 0.0) ? std::pow(R, 2.0/3.0) * std::sqrt(S) / n : 0.0;
    const double Q   = A * V;

    // Full flow reference.
    const double A_full = PI * D * D / 4.0;
    const double R_full = D / 4.0;
    const double V_full = std::pow(R_full, 2.0/3.0) * std::sqrt(S) / n;
    const double Q_full = A_full * V_full;

    Result r;
    r.depthRatio        = d / D;
    r.centralAngleRad   = theta;
    r.flowAreaM2        = A;
    r.wettedPerimeterM  = P;
    r.hydraulicRadiusM  = R;
    r.velocityMs        = V;
    r.dischargeM3S      = Q;
    r.dischargeLs       = Q * 1000.0;
    r.areaRatio         = A / A_full;
    r.velocityRatio     = (V_full > 0.0) ? V / V_full : 0.0;
    r.dischargeRatio    = (Q_full > 0.0) ? Q / Q_full : 0.0;
    return r;
}

}  // namespace forge::circpipe
