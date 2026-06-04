#include "forge/GeothermalLoop.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::geothermal {

Result analyse(const Input& in) {
    if (in.coolingLoadKw <= 0) throw std::runtime_error("Q > 0");
    if (in.soilConductivityWmk <= 0) throw std::runtime_error("k_soil > 0");
    if (in.boreRadiusM <= 0) throw std::runtime_error("r_bore > 0");
    if (in.pipeOuterDiameterMm <= 0) throw std::runtime_error("D_pipe > 0");
    if (in.pipeConductivityWmk <= 0) throw std::runtime_error("k_pipe > 0");
    if (in.groutConductivityWmk <= 0) throw std::runtime_error("k_grout > 0");
    if (in.designTempDiffK <= 0) throw std::runtime_error("ΔT > 0");

    constexpr double PI = 3.141592653589793;
    const double r_pipe = in.pipeOuterDiameterMm / 2000.0;     // m
    // R_pipe (laminar inner, conduction outer)
    const double R_pipe = std::log((r_pipe + 0.005) / r_pipe)
                        / (2.0 * PI * in.pipeConductivityWmk);
    const double R_grout = std::log(in.boreRadiusM / r_pipe)
                         / (2.0 * PI * in.groutConductivityWmk);
    // Carslaw-Jaeger steady-state cylinder in semi-infinite medium
    const double R_soil = std::log(2.0)            // dimensionless 0.693 approx
                        / (2.0 * PI * in.soilConductivityWmk);
    const double R_tot = R_pipe + R_grout + R_soil;

    const double q_w = in.coolingLoadKw * 1000.0;
    const double L = (q_w * R_tot) / in.designTempDiffK;       // m
    const double mPerTon = L / (in.coolingLoadKw / 3.517);     // 1 ton = 3.517 kW

    Result r;
    r.pipeResistanceMpwK    = R_pipe;
    r.groutResistanceMpwK   = R_grout;
    r.soilResistanceMpwK    = R_soil;
    r.totalResistanceMpwK   = R_tot;
    r.requiredBoreLengthM   = L;
    r.mPerTon               = mPerTon;
    return r;
}

}  // namespace forge::geothermal
