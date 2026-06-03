// Forge-266 — Orifice plate implementation.

#include "forge/OrificePlate.hpp"

#include <cmath>
#include <numbers>
#include <stdexcept>

namespace forge::orificeplate {

namespace {
constexpr double pi = std::numbers::pi;

double dischargeCoefficient(double beta, double Re_D) {
    // Reader-Harris/Gallagher simplified (corner taps, no drainage hole).
    const double beta2 = beta * beta;
    const double beta4 = beta2 * beta2;
    const double beta8 = beta4 * beta4;
    const double beta35 = std::pow(beta, 3.5);
    const double oneMillionBetaOverRe = 1.0e6 * beta / Re_D;
    return 0.5961 + 0.0261 * beta2 - 0.216 * beta8
         + 0.000521 * std::pow(oneMillionBetaOverRe, 0.7)
         + 0.0188 * beta35 * std::pow(1.0e6 / Re_D, 0.3);
}

double expansibilityFactor(double beta, double kappa, double p1, double p2) {
    if (kappa <= 0.0) throw std::invalid_argument("κ must be > 0");
    if (p1 <= 0.0)    throw std::invalid_argument("p_1 must be > 0");
    if (p2 < 0.0 || p2 >= p1)
        throw std::invalid_argument("p_2 must be in [0, p_1)");
    const double beta4 = std::pow(beta, 4);
    const double beta8 = beta4 * beta4;
    return 1.0
         - (0.351 + 0.256 * beta4 + 0.93 * beta8)
         * (1.0 - std::pow(p2 / p1, 1.0 / kappa));
}
}  // namespace

Result analyse(const Input& in) {
    if (in.pipeDiameterM <= 0.0) throw std::invalid_argument("D must be > 0");
    if (in.orificeDiameterM <= 0.0 || in.orificeDiameterM >= in.pipeDiameterM)
        throw std::invalid_argument("d must be in (0, D)");
    if (in.upstreamDensityKgM3 <= 0.0)
        throw std::invalid_argument("ρ must be > 0");
    if (in.dynamicViscosityPas <= 0.0)
        throw std::invalid_argument("μ must be > 0");
    if (in.differentialPressurePa <= 0.0)
        throw std::invalid_argument("ΔP must be > 0");

    Result r{};
    r.betaRatio = in.orificeDiameterM / in.pipeDiameterM;
    if (r.betaRatio < 0.1 || r.betaRatio > 0.75)
        throw std::invalid_argument("β must be in [0.10, 0.75] for ISO 5167-2");
    r.throatAreaM2 = pi * in.orificeDiameterM * in.orificeDiameterM / 4.0;

    // Iterate on Re_D ↔ C ↔ ṁ.
    double C = 0.61;
    double mdot = 0.0;
    for (int iter = 0; iter < 50; ++iter) {
        if (in.compressible) {
            r.expansibilityFactor = expansibilityFactor(
                r.betaRatio, in.kappaSpecHeatRatio,
                in.upstreamPressurePa,
                in.upstreamPressurePa - in.differentialPressurePa);
        } else {
            r.expansibilityFactor = 1.0;
        }
        const double mflux = (C * r.expansibilityFactor
                             / std::sqrt(1.0 - std::pow(r.betaRatio, 4)))
                           * r.throatAreaM2
                           * std::sqrt(2.0 * in.upstreamDensityKgM3
                                        * in.differentialPressurePa);
        const double Re_D = 4.0 * mflux
                          / (pi * in.pipeDiameterM * in.dynamicViscosityPas);
        if (Re_D <= 0.0) break;
        if (Re_D < 5000.0)
            throw std::invalid_argument("Re_D < 5000 — outside ISO 5167-2 validity");
        const double C_new = dischargeCoefficient(r.betaRatio, Re_D);
        if (std::abs(C_new - C) < 1e-8) {
            C = C_new;
            mdot = mflux;
            r.reynoldsNumberD = Re_D;
            break;
        }
        C = C_new;
        mdot = mflux;
        r.reynoldsNumberD = Re_D;
    }
    r.dischargeCoefficient = C;
    r.massFlowKgS = mdot;
    r.volumeFlowM3S = mdot / in.upstreamDensityKgM3;
    return r;
}

}  // namespace forge::orificeplate
