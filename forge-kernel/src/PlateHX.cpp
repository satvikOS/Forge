#include "forge/PlateHX.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::ehx {

Result analyse(const Input& in) {
    if (in.hotInletTemp_Th_in_C <= in.coldInletTemp_Tc_in_C)
        throw std::runtime_error("T_h,in > T_c,in");
    if (in.hotMassFlow_kgPerS <= 0)      throw std::runtime_error("ṁ_h > 0");
    if (in.coldMassFlow_kgPerS <= 0)     throw std::runtime_error("ṁ_c > 0");
    if (in.hotCp_kJperKgK <= 0)          throw std::runtime_error("cp_h > 0");
    if (in.coldCp_kJperKgK <= 0)         throw std::runtime_error("cp_c > 0");
    if (in.UA_kWperK <= 0)               throw std::runtime_error("UA > 0");
    if (in.flowArrangement < 0 || in.flowArrangement > 1)
        throw std::runtime_error("flow 0/1");

    const double C_h = in.hotMassFlow_kgPerS * in.hotCp_kJperKgK;
    const double C_c = in.coldMassFlow_kgPerS * in.coldCp_kJperKgK;
    const double C_min = std::min(C_h, C_c);
    const double C_max = std::max(C_h, C_c);
    const double C_r   = C_min / C_max;
    const double NTU   = in.UA_kWperK / C_min;
    const double dT_max = in.hotInletTemp_Th_in_C - in.coldInletTemp_Tc_in_C;

    double eps;
    if (in.flowArrangement == 0) {
        if (std::fabs(C_r - 1.0) < 1e-9) {
            eps = NTU / (1.0 + NTU);
        } else {
            const double e = std::exp(-NTU * (1.0 - C_r));
            eps = (1.0 - e) / (1.0 - C_r * e);
        }
    } else {
        eps = (1.0 - std::exp(-NTU * (1.0 + C_r))) / (1.0 + C_r);
    }

    const double Q = eps * C_min * dT_max;
    const double T_h_out = in.hotInletTemp_Th_in_C - Q / C_h;
    const double T_c_out = in.coldInletTemp_Tc_in_C + Q / C_c;

    Result r;
    r.Cmin_kWperK     = C_min;
    r.Cmax_kWperK     = C_max;
    r.Cr              = C_r;
    r.NTU             = NTU;
    r.effectiveness   = eps;
    r.heatTransfer_kW = Q;
    r.hotOutletTemp_C = T_h_out;
    r.coldOutletTemp_C= T_c_out;
    return r;
}

}  // namespace forge::ehx
