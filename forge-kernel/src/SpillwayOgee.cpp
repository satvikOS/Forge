#include "forge/SpillwayOgee.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::ogee {

Result analyse(const Input& in) {
    if (in.headOverCrest_H_m <= 0)         throw std::runtime_error("H > 0");
    if (in.designHead_Hd_m <= 0)           throw std::runtime_error("H_d > 0");
    if (in.crestLength_L_m <= 0)           throw std::runtime_error("L > 0");
    if (in.pierCount_N < 0)                throw std::runtime_error("N >= 0");
    if (in.pierContraction_Kp < 0)         throw std::runtime_error("K_p >= 0");
    if (in.abutmentContraction_Ka < 0)     throw std::runtime_error("K_a >= 0");
    if (in.dischargeCoefficient_C <= 0)    throw std::runtime_error("C > 0");

    const double H = in.headOverCrest_H_m;
    const double L_e = in.crestLength_L_m
                     - 2.0 * (in.pierCount_N * in.pierContraction_Kp + in.abutmentContraction_Ka) * H;
    const double Q = in.dischargeCoefficient_C * L_e * std::pow(H, 1.5);
    const double q = Q / std::max(1e-9, L_e);

    Result r;
    r.effectiveLength_Le_m   = L_e;
    r.dischargeQ_m3s         = Q;
    r.specificDischarge_q_m2s= q;

    if (in.profileSamples > 0) {
        constexpr double K = 0.50, n = 1.85;
        for (int i = 0; i <= in.profileSamples; ++i) {
            const double xRel = static_cast<double>(i) / in.profileSamples;
            const double x_m = xRel * 2.0 * in.designHead_Hd_m;   // 2·H_d range downstream
            const double y_m = K * in.designHead_Hd_m * std::pow(x_m / in.designHead_Hd_m, n);
            r.profileX_m.push_back(x_m);
            r.profileY_m.push_back(y_m);
        }
    }
    return r;
}

}  // namespace forge::ogee
