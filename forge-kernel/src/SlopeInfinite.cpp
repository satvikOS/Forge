#include "forge/SlopeInfinite.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::slope {

Result analyse(const Input& in) {
    if (in.cohesion_kPa < 0)            throw std::runtime_error("c' >= 0");
    if (in.unitWeight_kNm3 <= 0)        throw std::runtime_error("γ > 0");
    if (in.sliceDepth_m <= 0)           throw std::runtime_error("h > 0");
    if (in.slopeAngleDeg <= 0 || in.slopeAngleDeg >= 90) throw std::runtime_error("β in (0,90)");
    if (in.frictionAngleDeg < 0 || in.frictionAngleDeg >= 90) throw std::runtime_error("φ' in [0,90)");
    if (in.waterTableDepth_m < 0)       throw std::runtime_error("z_w >= 0");

    constexpr double gamma_w = 9.80665;
    const double beta  = in.slopeAngleDeg * M_PI / 180.0;
    const double phi   = in.frictionAngleDeg * M_PI / 180.0;
    const double cb = std::cos(beta), sb = std::sin(beta);

    // Pore-pressure: water table at depth z_w below surface.
    // h_w = max(0, h - z_w) is the saturated portion above slip surface.
    const double h_w = std::max(0.0, in.sliceDepth_m - in.waterTableDepth_m);
    const double u_kPa = gamma_w * h_w * cb * cb;
    const double total_normal_kPa = in.unitWeight_kNm3 * in.sliceDepth_m * cb * cb;
    const double effective_normal_kPa = std::max(0.0, total_normal_kPa - u_kPa);
    const double tau_d_kPa = in.unitWeight_kNm3 * in.sliceDepth_m * cb * sb;
    const double tau_r_kPa = in.cohesion_kPa + effective_normal_kPa * std::tan(phi);
    const double FS = tau_d_kPa > 0 ? tau_r_kPa / tau_d_kPa : 0;

    Result r;
    r.slipDepth_m                = in.sliceDepth_m;
    r.effectiveNormalStress_kPa  = effective_normal_kPa;
    r.mobilisedShearStress_kPa   = tau_d_kPa;
    r.resistingShearStress_kPa   = tau_r_kPa;
    r.factorOfSafety             = FS;
    r.stable                     = FS >= 1.5;
    return r;
}

}  // namespace forge::slope
