#include "forge/MSEWall.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::mse {

Result analyse(const Input& in) {
    if (in.wallHeightH_m <= 0) throw std::runtime_error("H > 0");
    if (in.soilFrictionAngleDeg <= 0 || in.soilFrictionAngleDeg >= 60)
        throw std::runtime_error("φ in (0, 60)");
    if (in.foundationFrictionAngleDeg <= 0 || in.foundationFrictionAngleDeg >= 60)
        throw std::runtime_error("φ_f in (0, 60)");
    if (in.soilUnitWeightKnM3 <= 0) throw std::runtime_error("γ > 0");
    if (in.reinforcementLengthM < 0) throw std::runtime_error("L ≥ 0");
    if (in.surchargeKnM2 < 0) throw std::runtime_error("q ≥ 0");

    const double phi = in.soilFrictionAngleDeg * 3.141592653589793 / 180.0;
    const double phi_f = in.foundationFrictionAngleDeg * 3.141592653589793 / 180.0;
    const double K_a = (1.0 - std::sin(phi)) / (1.0 + std::sin(phi));

    const double H = in.wallHeightH_m;
    const double Fd = 0.5 * K_a * in.soilUnitWeightKnM3 * H * H
                    + in.surchargeKnM2 * K_a * H;

    const double L = in.reinforcementLengthM > 0
                   ? in.reinforcementLengthM
                   : std::max(0.7 * H, 2.4);

    // Wall mass approximated as L·H wedge of reinforced fill
    const double W_wall = in.soilUnitWeightKnM3 * L * H;
    const double R = (W_wall + in.surchargeKnM2 * L) * std::tan(phi_f);
    const double FOS = R / Fd;

    Result r;
    r.K_active                       = K_a;
    r.drivingForceKnPerM             = Fd;
    r.effectiveReinforcementLengthM  = L;
    r.resistingForceKnPerM           = R;
    r.slidingFOS                     = FOS;
    r.meetsFOS                       = FOS >= 1.5;
    return r;
}

}  // namespace forge::mse
