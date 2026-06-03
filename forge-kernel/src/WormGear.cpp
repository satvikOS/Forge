// Forge-290 — implementation; see header for derivation references.

#include "forge/WormGear.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::wormgear {

constexpr double PI = 3.14159265358979323846;

Result analyse(const Input& in) {
    if (in.moduleMm <= 0.0)
        throw std::runtime_error("moduleMm must be > 0");
    if (in.wormStarts < 1 || in.wormStarts > 6)
        throw std::runtime_error("wormStarts must be in [1, 6]");
    if (in.gearTeeth < 8 || in.gearTeeth > 200)
        throw std::runtime_error("gearTeeth must be in [8, 200]");
    if (in.wormPitchDiameterMm <= 0.0)
        throw std::runtime_error("wormPitchDiameterMm must be > 0");
    if (in.frictionCoefficient < 0.0 || in.frictionCoefficient > 0.5)
        throw std::runtime_error("frictionCoefficient must be in [0, 0.5]");
    if (in.inputSpeedRpm <= 0.0)
        throw std::runtime_error("inputSpeedRpm must be > 0");
    if (in.inputTorqueNm <= 0.0)
        throw std::runtime_error("inputTorqueNm must be > 0");

    const double m  = in.moduleMm;
    const int    Nw = in.wormStarts;
    const int    Ng = in.gearTeeth;
    const double dw = in.wormPitchDiameterMm;
    const double mu = in.frictionCoefficient;
    const double nw = in.inputSpeedRpm;
    const double Tw = in.inputTorqueNm;

    const double i = static_cast<double>(Ng) / static_cast<double>(Nw);
    const double L = static_cast<double>(Nw) * m * PI;
    const double gamma = std::atan(static_cast<double>(Nw) * m / dw);
    const double phi   = std::atan(mu);
    const double dg = static_cast<double>(Ng) * m;
    const double C  = (dw + dg) / 2.0;

    // Sliding velocity at the pitch circle (m/s).
    const double Vs = PI * dw * nw / (60.0 * 1000.0 * std::cos(gamma));

    // Efficiency, worm driving forward.
    double eta = 0.0;
    if (mu > 0.0) {
        const double tan_lambda_plus_phi = std::tan(gamma + phi);
        eta = std::tan(gamma) / tan_lambda_plus_phi;
    } else {
        eta = 1.0;
    }

    const double ng = nw / i;
    const double Tg = Tw * i * eta;
    const bool   self_locking = phi > gamma;

    Result r;
    r.velocityRatio        = i;
    r.leadMm               = L;
    r.leadAngleDeg         = gamma * 180.0 / PI;
    r.frictionAngleDeg     = phi   * 180.0 / PI;
    r.gearPitchDiameterMm  = dg;
    r.centreDistanceMm     = C;
    r.slidingVelocityMs    = Vs;
    r.efficiencyPct        = eta * 100.0;
    r.outputSpeedRpm       = ng;
    r.outputTorqueNm       = Tg;
    r.selfLocking          = self_locking;
    return r;
}

}  // namespace forge::wormgear
