#include "forge/RunoffCN.hpp"

#include <stdexcept>

namespace forge::cn {

Result analyse(const Input& in) {
    if (in.curveNumber_CN < 30 || in.curveNumber_CN > 100)
        throw std::runtime_error("CN in [30, 100]");
    if (in.rainfall_P_mm < 0)            throw std::runtime_error("P >= 0");
    if (in.drainageArea_km2 <= 0)        throw std::runtime_error("A > 0");
    if (in.timeOfConcentration_Tc_h <= 0) throw std::runtime_error("T_c > 0");

    const double S = 25400.0 / in.curveNumber_CN - 254.0;
    const double Ia = 0.2 * S;
    double Q = 0.0;
    if (in.rainfall_P_mm > Ia) {
        const double num = (in.rainfall_P_mm - Ia);
        Q = num * num / (in.rainfall_P_mm + 0.8 * S);
    }
    // Runoff volume = Q[mm] · A[km²] · 1000 m²/km² · 1m/1000mm = Q·A·1000 m³.
    const double Vol_m3 = Q * 1.0e-3 * in.drainageArea_km2 * 1.0e6;
    // Placeholder peak: q_p = 0.208·A·Q / T_c (TR-55 simplified, CFS form converted).
    const double qp_m3s = 0.208 * in.drainageArea_km2 * Q
                        / (in.timeOfConcentration_Tc_h * 3600.0)
                        * 1.0e6 * 1.0e-3;

    Result r;
    r.maxRetention_S_mm        = S;
    r.initialAbstraction_Ia_mm = Ia;
    r.runoffDepth_Q_mm         = Q;
    r.runoffVolume_m3          = Vol_m3;
    r.peakFlow_qp_m3PerS       = qp_m3s;
    return r;
}

}  // namespace forge::cn
