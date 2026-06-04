#include "forge/FirePump.hpp"

#include <stdexcept>

namespace forge::firepump {

Result analyse(const Input& in) {
    if (in.sprinklerDemandLpm <= 0.0) throw std::runtime_error("sprinklerDemandLpm > 0");
    if (in.hoseAllowanceLpm < 0.0) throw std::runtime_error("hose ≥ 0");
    if (in.staticHeadM < 0.0) throw std::runtime_error("staticHeadM ≥ 0");
    if (in.frictionLossM < 0.0) throw std::runtime_error("frictionLossM ≥ 0");
    if (in.residualPressureBar < 0.0) throw std::runtime_error("residualPressureBar ≥ 0");

    const double Q_rated = in.sprinklerDemandLpm + in.hoseAllowanceLpm;
    const double H_total = in.staticHeadM + in.frictionLossM;
    const double P_rated_bar = H_total * 0.0981 + in.residualPressureBar;  // m H₂O → bar (9.81 kPa/m)

    Result r;
    r.ratedFlowLpm                  = Q_rated;
    r.ratedHeadM                    = H_total + in.residualPressureBar / 0.0981;
    r.ratedPressureBar              = P_rated_bar;
    r.pump150PercentFlowLpm         = 1.5 * Q_rated;
    r.pump150PercentMinPressureBar  = 0.65 * P_rated_bar;
    return r;
}

}  // namespace forge::firepump
