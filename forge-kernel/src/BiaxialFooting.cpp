#include "forge/BiaxialFooting.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::biaxfoot {

Result analyse(const Input& in) {
    if (in.axialLoad_P_kN <= 0)       throw std::runtime_error("P > 0");
    if (in.footingBx_m <= 0)          throw std::runtime_error("B_x > 0");
    if (in.footingBy_m <= 0)          throw std::runtime_error("B_y > 0");
    if (in.allowableBearing_kPa <= 0) throw std::runtime_error("σ_allow > 0");

    const double e_x = in.momentMy_kNm / in.axialLoad_P_kN;
    const double e_y = in.momentMx_kNm / in.axialLoad_P_kN;
    const double A   = in.footingBx_m * in.footingBy_m;
    const double sigma0 = in.axialLoad_P_kN / A;

    Result r;
    r.eccentricity_ex_m = e_x;
    r.eccentricity_ey_m = e_y;
    const int signs[4][2] = {{+1,+1}, {+1,-1}, {-1,+1}, {-1,-1}};
    for (int k = 0; k < 4; ++k) {
        r.cornerStresses_kPa[k] = sigma0
            * (1.0 + signs[k][0] * 6.0 * e_x / in.footingBx_m
                   + signs[k][1] * 6.0 * e_y / in.footingBy_m);
    }
    r.sigmaMax_kPa = *std::max_element(r.cornerStresses_kPa, r.cornerStresses_kPa + 4);
    r.sigmaMin_kPa = *std::min_element(r.cornerStresses_kPa, r.cornerStresses_kPa + 4);
    r.upliftDetected = r.sigmaMin_kPa < 0.0;
    if (r.upliftDetected) {
        r.meyerhofBx_m = std::max(0.0, in.footingBx_m - 2.0 * e_x);
        r.meyerhofBy_m = std::max(0.0, in.footingBy_m - 2.0 * e_y);
        if (r.meyerhofBx_m > 0 && r.meyerhofBy_m > 0)
            r.sigmaMax_kPa = in.axialLoad_P_kN / (r.meyerhofBx_m * r.meyerhofBy_m);
    } else {
        r.meyerhofBx_m = in.footingBx_m;
        r.meyerhofBy_m = in.footingBy_m;
    }
    r.stable = !r.upliftDetected && r.sigmaMax_kPa <= in.allowableBearing_kPa;
    return r;
}

}  // namespace forge::biaxfoot
