#include "forge/TankAnchor.hpp"

#include <stdexcept>

namespace forge::tankanchor {

Result analyse(const Input& in) {
    if (in.tankDiameter_m <= 0)        throw std::runtime_error("D > 0");
    if (in.tankHeight_m <= 0)          throw std::runtime_error("H > 0");
    if (in.shellWeight_kN <= 0)        throw std::runtime_error("W_shell > 0");
    if (in.fluidWeight_kN < 0)         throw std::runtime_error("W_fluid >= 0");
    if (in.windSpeed_ms <= 0)          throw std::runtime_error("V > 0");
    if (in.anchorCount <= 0)           throw std::runtime_error("n_anchor > 0");
    if (in.importanceFactorKs <= 0)    throw std::runtime_error("K_s > 0");

    const double P_w_Pa = 0.86 * in.windSpeed_ms * in.windSpeed_ms * in.importanceFactorKs;
    const double P_w_kPa = P_w_Pa / 1000.0;
    const double M_w = P_w_kPa * in.tankHeight_m * in.tankDiameter_m * (in.tankHeight_m / 2.0);
    const double M_dl = (in.shellWeight_kN + 0.4 * in.fluidWeight_kN) * in.tankDiameter_m / 2.0;

    const double M_net = M_w - M_dl;
    const double N_per_bolt = M_net > 0 ?
        M_net * 4.0 / (static_cast<double>(in.anchorCount) * in.tankDiameter_m)
        : 0.0;

    Result r;
    r.windPressure_kPa     = P_w_kPa;
    r.overturningMoment_kNm = M_w;
    r.restoringMoment_kNm  = M_dl;
    r.netUplift_kN         = N_per_bolt;
    r.safetyFactor         = M_w > 0 ? M_dl / M_w : 0.0;
    r.anchorageRequired    = M_w > M_dl;
    return r;
}

}  // namespace forge::tankanchor
