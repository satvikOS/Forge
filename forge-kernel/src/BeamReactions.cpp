#include "forge/BeamReactions.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::beamreact {

Result analyse(const Input& in) {
    if (in.span_m <= 0)                          throw std::runtime_error("L > 0");
    if (in.pointLoadPosition_m < 0 || in.pointLoadPosition_m > in.span_m)
        throw std::runtime_error("a in [0, L]");
    if (in.pointLoad_kN < 0)                     throw std::runtime_error("P >= 0");
    if (in.udl_kNm < 0)                          throw std::runtime_error("w >= 0");
    if (in.EI_kNm2 < 0)                          throw std::runtime_error("EI >= 0");

    const double L = in.span_m;
    const double a = in.pointLoadPosition_m;
    const double P = in.pointLoad_kN;
    const double w = in.udl_kNm;

    // Reactions (left & right) — superposition.
    const double R_L = P * (L - a) / L + w * L / 2.0;
    const double R_R = P * a / L      + w * L / 2.0;

    // Max bending moment (sample at point load + at midspan).
    const double M_at_P  = R_L * a - w * a * a / 2.0;          // moment at x = a
    const double M_mid   = R_L * L / 2.0 - w * (L / 2.0) * (L / 2.0) / 2.0
                         - (a < L / 2.0 ? P * (L / 2.0 - a) : 0.0);
    const double M_max   = std::max(std::abs(M_at_P), std::abs(M_mid));
    const double V_max   = std::max(R_L, R_R);

    double delta_mm = 0.0;
    if (in.EI_kNm2 > 0) {
        // Closed-form deflection (point load only — separately) + UDL (closed-form).
        double delta_P_m = 0.0;
        if (P > 0) {
            const double rad = (L * L - a * a) / 3.0;
            if (rad > 0) {
                const double x_loc = std::sqrt(rad);
                delta_P_m = P * a * std::pow(L * L - a * a, 1.5) /
                            (9.0 * std::sqrt(3.0) * in.EI_kNm2 * L);
                (void)x_loc;
            }
        }
        const double delta_w_m = 5.0 * w * std::pow(L, 4.0) / (384.0 * in.EI_kNm2);
        delta_mm = (delta_P_m + delta_w_m) * 1000.0;
    }

    Result r;
    r.leftReaction_kN       = R_L;
    r.rightReaction_kN      = R_R;
    r.maxBendingMoment_kNm  = M_max;
    r.maxShear_kN           = V_max;
    r.maxDeflection_mm      = delta_mm;
    return r;
}

}  // namespace forge::beamreact
