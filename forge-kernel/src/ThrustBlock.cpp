#include "forge/ThrustBlock.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::thrustblk {

Result analyse(const Input& in) {
    if (in.pipeOuterDiameter_mm <= 0)        throw std::runtime_error("D > 0");
    if (in.designPressure_MPa <= 0)          throw std::runtime_error("P > 0");
    if (in.bendAngleDeg < 0 || in.bendAngleDeg > 180)
        throw std::runtime_error("θ in [0, 180]");
    if (in.soilBearingPressure_kPa <= 0)     throw std::runtime_error("σ_soil > 0");
    if (in.safetyFactor <= 0)                throw std::runtime_error("SF > 0");
    if (in.fittingType < 0 || in.fittingType > 3) throw std::runtime_error("type 0-3");

    const double A_mm2 = M_PI / 4.0 * in.pipeOuterDiameter_mm * in.pipeOuterDiameter_mm;
    const double P_MPa = in.designPressure_MPa;
    const double T_kN_per_mm2 = P_MPa / 1000.0;            // MPa·mm² → kN

    double T_kN = 0;
    switch (in.fittingType) {
        case 0: {                              // bend
            const double half = in.bendAngleDeg * M_PI / 360.0;
            T_kN = 2.0 * P_MPa * A_mm2 * std::sin(half) / 1000.0;
            break;
        }
        case 1:                                 // tee
        case 2:                                 // cap
            T_kN = P_MPa * A_mm2 / 1000.0;
            break;
        case 3: {                              // reducer
            if (in.reducerOD2_mm <= 0 || in.reducerOD2_mm >= in.pipeOuterDiameter_mm)
                throw std::runtime_error("reducer OD2 in (0, OD1)");
            const double A2_mm2 = M_PI / 4.0 * in.reducerOD2_mm * in.reducerOD2_mm;
            T_kN = P_MPa * (A_mm2 - A2_mm2) / 1000.0;
            break;
        }
    }
    (void)T_kN_per_mm2;

    const double A_req_m2 = T_kN * in.safetyFactor / in.soilBearingPressure_kPa;
    const double side_m = std::sqrt(A_req_m2);
    const double mass_t = (side_m * side_m * side_m / 2.0) * 2400.0 / 1000.0;

    Result r;
    r.pipeArea_mm2              = A_mm2;
    r.thrustForce_kN            = T_kN;
    r.requiredBearingArea_m2    = A_req_m2;
    r.squareBlockSide_m         = side_m;
    r.blockMassEstimate_t       = mass_t;
    return r;
}

}  // namespace forge::thrustblk
