#include "forge/ConveyorPower.hpp"

#include <stdexcept>

namespace forge::conveyor {

Result analyse(const Input& in) {
    if (in.horizontalLengthM <= 0) throw std::runtime_error("L > 0");
    if (in.liftHeightM < 0) throw std::runtime_error("H ≥ 0");
    if (in.beltSpeedMs <= 0) throw std::runtime_error("v > 0");
    if (in.materialMassFlowKgPerS <= 0) throw std::runtime_error("ṁ > 0");
    if (in.beltMassPerLengthKgM <= 0) throw std::runtime_error("W_belt > 0");
    if (in.idlerMassPerLengthKgM <= 0) throw std::runtime_error("W_idler > 0");
    if (in.primaryFriction <= 0) throw std::runtime_error("f > 0");
    if (in.drivetrainEfficiency <= 0 || in.drivetrainEfficiency > 1)
        throw std::runtime_error("η in (0, 1]");

    constexpr double g = 9.80665;
    constexpr double C = 1.1;  // secondary friction factor

    const double W_mat_per_m = in.materialMassFlowKgPerS / in.beltSpeedMs;
    const double F_horiz = C * in.primaryFriction * in.horizontalLengthM * g
                         * (in.beltMassPerLengthKgM
                            + in.idlerMassPerLengthKgM
                            + 2.0 * W_mat_per_m);
    const double F_lift = W_mat_per_m * g * in.liftHeightM;
    const double F_eff = F_horiz + F_lift;
    const double P_kW = F_eff * in.beltSpeedMs / (in.drivetrainEfficiency * 1000.0);

    Result r;
    r.materialPerLengthKgM = W_mat_per_m;
    r.effectiveTensionN    = F_eff;
    r.powerRequiredKW      = P_kW;
    return r;
}

}  // namespace forge::conveyor
