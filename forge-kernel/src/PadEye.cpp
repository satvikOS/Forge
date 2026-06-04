#include "forge/PadEye.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::padeye {

Result analyse(const Input& in) {
    if (in.designLoad_kN <= 0)             throw std::runtime_error("P > 0");
    if (in.padThickness_mm <= 0)           throw std::runtime_error("t > 0");
    if (in.padDiameter_mm <= 0)            throw std::runtime_error("D_pad > 0");
    if (in.holeDiameter_mm <= 0)           throw std::runtime_error("d_h > 0");
    if (in.pinDiameter_mm <= 0)            throw std::runtime_error("d_pin > 0");
    if (in.cheekToEdge_mm <= 0)            throw std::runtime_error("cheek > 0");
    if (in.yieldStrength_MPa <= 0)         throw std::runtime_error("F_y > 0");
    if (in.designCategory <= 0)            throw std::runtime_error("Cat > 0");
    if (in.padDiameter_mm <= in.holeDiameter_mm)
        throw std::runtime_error("D_pad > d_h");

    const double P_N = in.designLoad_kN * 1.0e3;

    const double A_bearing_mm2 = in.pinDiameter_mm * in.padThickness_mm;
    const double sigma_bearing = P_N / A_bearing_mm2;     // MPa
    const double A_n_mm2 = (in.padDiameter_mm - in.holeDiameter_mm) * in.padThickness_mm;
    const double sigma_t = P_N / A_n_mm2;
    const double A_v_mm2 = 2.0 * in.cheekToEdge_mm * in.padThickness_mm;
    const double tau_v = P_N / A_v_mm2;

    const double sigma_allow = 0.45 * in.yieldStrength_MPa * in.designCategory;
    const double tau_allow   = 0.36 * in.yieldStrength_MPa * in.designCategory;

    const double u_b = sigma_bearing / (1.8 * in.yieldStrength_MPa * in.designCategory);
    const double u_t = sigma_t / sigma_allow;
    const double u_v = tau_v / tau_allow;

    Result r;
    r.bearingStress_MPa        = sigma_bearing;
    r.tensionAcrossHole_MPa    = sigma_t;
    r.shearTearOut_MPa         = tau_v;
    r.allowableTensile_MPa     = sigma_allow;
    r.allowableShear_MPa       = tau_allow;
    r.governingUtilisation     = std::max({u_b, u_t, u_v});
    r.passes                   = r.governingUtilisation <= 1.0;
    return r;
}

}  // namespace forge::padeye
