// Forge-267 — implementation; see header for derivation references.

#include "forge/RcPunching.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::rcpunching {

Result analyse(const Input& in) {
    if (in.concreteStrengthMPa <= 0.0)
        throw std::runtime_error("concreteStrengthMPa must be > 0");
    if (in.effectiveDepthMm <= 0.0)
        throw std::runtime_error("effectiveDepthMm must be > 0");
    if (in.columnWidthMm <= 0.0 || in.columnDepthMm <= 0.0)
        throw std::runtime_error("column dimensions must be > 0");
    if (in.lambdaLightweight <= 0.0 || in.lambdaLightweight > 1.0)
        throw std::runtime_error("lambdaLightweight must be in (0, 1]");
    if (in.factoredShearN < 0.0)
        throw std::runtime_error("factoredShearN must be ≥ 0");

    const double c1 = in.columnWidthMm;
    const double c2 = in.columnDepthMm;
    const double d  = in.effectiveDepthMm;

    double b0 = 0.0;
    double alphaS = 0.0;
    switch (in.location) {
        case Location::Interior:
            b0     = 2.0 * (c1 + d) + 2.0 * (c2 + d);
            alphaS = 40.0;
            break;
        case Location::Edge:
            b0     = 2.0 * (c1 + 0.5 * d) + (c2 + d);
            alphaS = 30.0;
            break;
        case Location::Corner:
            b0     = (c1 + 0.5 * d) + (c2 + 0.5 * d);
            alphaS = 20.0;
            break;
    }

    const double betaC = std::max(c1, c2) / std::min(c1, c2);
    const double lambda = in.lambdaLightweight;
    const double sqrtFc = std::sqrt(in.concreteStrengthMPa);

    const double vc1 = 0.33 * lambda * sqrtFc;
    const double vc2 = (0.17 + 0.33 / betaC) * lambda * sqrtFc;
    const double vc3 = (0.083 * alphaS * d / b0 + 0.17) * lambda * sqrtFc;
    const double vc  = std::min({vc1, vc2, vc3});

    const double VcN     = vc * b0 * d;   // MPa·mm² = N
    const double phiVcN  = 0.75 * VcN;
    const double dcr     = (phiVcN > 0.0) ? (in.factoredShearN / phiVcN) : 0.0;

    Result r;
    r.betaC                = betaC;
    r.alphaS               = alphaS;
    r.criticalPerimeterMm  = b0;
    r.sqrtFcMPa            = sqrtFc;
    r.vc1MPa               = vc1;
    r.vc2MPa               = vc2;
    r.vc3MPa               = vc3;
    r.vcMPa                = vc;
    r.VcN                  = VcN;
    r.phiVcN               = phiVcN;
    r.demandCapacityRatio  = dcr;
    r.passes               = dcr <= 1.0;
    return r;
}

}  // namespace forge::rcpunching
