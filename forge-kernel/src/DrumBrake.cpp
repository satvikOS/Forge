// Forge-300 — implementation; see header for derivation references.

#include "forge/DrumBrake.hpp"

#include <stdexcept>

namespace forge::drumbrake {

Result analyse(const Input& in) {
    if (in.leverForceP_N <= 0.0)
        throw std::runtime_error("leverForceP_N must be > 0");
    if (in.leverLength_c_m <= 0.0)
        throw std::runtime_error("leverLength_c_m must be > 0");
    if (in.contactArm_a_m <= 0.0)
        throw std::runtime_error("contactArm_a_m must be > 0");
    if (in.drumRadius_r_m <= 0.0)
        throw std::runtime_error("drumRadius_r_m must be > 0");
    if (in.friction_mu <= 0.0)
        throw std::runtime_error("friction_mu must be > 0");

    const double P  = in.leverForceP_N;
    const double c  = in.leverLength_c_m;
    const double a  = in.contactArm_a_m;
    const double r  = in.drumRadius_r_m;
    const double mu = in.friction_mu;

    const double margin = a - mu * r;
    const bool   locked = in.selfEnergizing && margin <= 0.0;

    double N;
    if (in.selfEnergizing) {
        if (margin <= 0.0)
            throw std::runtime_error(
                "self-energizing brake is self-locked: a - mu*r <= 0");
        N = P * c / margin;
    } else {
        N = P * c / (a + mu * r);
    }

    const double F = mu * N;
    const double T = F * r;

    Result res;
    res.normalForceN         = N;
    res.frictionForceN       = F;
    res.brakingTorqueNm      = T;
    res.mechanicalAdvantage  = T / (P * r);
    res.selfLockingMargin    = margin;
    res.selfLocked           = locked;
    return res;
}

}  // namespace forge::drumbrake
