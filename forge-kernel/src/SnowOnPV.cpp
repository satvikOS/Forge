#include "forge/SnowOnPV.hpp"

#include <stdexcept>

namespace forge::snowpv {

Result analyse(const Input& in) {
    if (in.groundSnowKnM2 <= 0) throw std::runtime_error("p_g > 0");
    if (in.slopeAngleDeg < 0 || in.slopeAngleDeg > 90)
        throw std::runtime_error("slope in [0, 90]");
    if (in.thermalC_t <= 0) throw std::runtime_error("c_t > 0");
    if (in.exposureC_e <= 0) throw std::runtime_error("c_e > 0");
    if (in.importanceI_s <= 0) throw std::runtime_error("I_s > 0");

    double Cs;
    if (in.slopeAngleDeg <= 30.0) Cs = 1.0;
    else if (in.slopeAngleDeg <= 70.0) Cs = (70.0 - in.slopeAngleDeg) / 40.0;
    else Cs = 0.0;

    const double pf = 0.7 * in.thermalC_t * in.exposureC_e * in.importanceI_s * in.groundSnowKnM2;
    const double ps = Cs * pf;

    Result r;
    r.slopeCoefficient_C_s = Cs;
    r.flatRoofSnowKnM2     = pf;
    r.slopedRoofSnowKnM2   = ps;
    r.meetsMinimum         = pf >= 0.96;
    return r;
}

}  // namespace forge::snowpv
