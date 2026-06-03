// Forge-269 — implementation; see header for derivation references.

#include "forge/PowerScrew.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::powerscrew {

constexpr double PI = 3.14159265358979323846;
constexpr double ACME_HALF_ANGLE_DEG = 14.5;

Result analyse(const Input& in) {
    if (in.axialForceN <= 0.0)
        throw std::runtime_error("axialForceN must be > 0");
    if (in.meanDiameterMm <= 0.0)
        throw std::runtime_error("meanDiameterMm must be > 0");
    if (in.leadMm <= 0.0)
        throw std::runtime_error("leadMm must be > 0");
    if (in.threadFriction < 0.0)
        throw std::runtime_error("threadFriction must be ≥ 0");
    if (in.collarFriction < 0.0)
        throw std::runtime_error("collarFriction must be ≥ 0");
    if (in.collarMeanDiameterMm < 0.0)
        throw std::runtime_error("collarMeanDiameterMm must be ≥ 0");

    const double F  = in.axialForceN;
    const double dm = in.meanDiameterMm * 1e-3;       // m
    const double L  = in.leadMm         * 1e-3;       // m
    const double dc = in.collarMeanDiameterMm * 1e-3; // m

    double mu_eff = in.threadFriction;
    if (in.threadType == ThreadType::Acme) {
        const double alpha = ACME_HALF_ANGLE_DEG * PI / 180.0;
        mu_eff = in.threadFriction / std::cos(alpha);
    }

    const double tan_lambda = L / (PI * dm);
    const double lambda     = std::atan(tan_lambda);
    const double phi        = std::atan(mu_eff);

    // Raising torque.
    const double T_raise = (F * dm / 2.0) * (L + PI * mu_eff * dm)
                                          / (PI * dm - mu_eff * L);
    // Lowering torque (can be negative ⇒ self-locking).
    const double T_lower = (F * dm / 2.0) * (PI * mu_eff * dm - L)
                                          / (PI * dm + mu_eff * L);
    // Collar torque (uniform-pressure assumption).
    const double T_collar = F * in.collarFriction * dc / 2.0;

    // Raising efficiency, screw only (no collar).
    const double eta = (F * L) / (2.0 * PI * T_raise);

    Result r;
    r.leadAngleDeg          = lambda * 180.0 / PI;
    r.frictionAngleDeg      = phi    * 180.0 / PI;
    r.effectiveFriction     = mu_eff;
    r.raiseTorqueNm         = T_raise;
    r.lowerTorqueNm         = T_lower;
    r.collarTorqueNm        = T_collar;
    r.totalRaiseTorqueNm    = T_raise + T_collar;
    r.totalLowerTorqueNm    = T_lower + T_collar;
    r.efficiencyPct         = eta * 100.0;
    r.selfLocking           = mu_eff > tan_lambda;
    return r;
}

}  // namespace forge::powerscrew
