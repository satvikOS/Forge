#include "forge/TensionMember.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::tension {

Result analyse(const Input& in) {
    if (in.grossArea_mm2 <= 0) throw std::runtime_error("A_g > 0");
    if (in.netArea_mm2 <= 0 || in.netArea_mm2 > in.grossArea_mm2)
        throw std::runtime_error("A_n in (0, A_g]");
    if (in.xBar_mm < 0) throw std::runtime_error("x̄ ≥ 0");
    if (in.connectionLength_mm <= 0) throw std::runtime_error("L > 0");
    if (in.Fy_MPa <= 0) throw std::runtime_error("F_y > 0");
    if (in.Fu_MPa <= 0) throw std::runtime_error("F_u > 0");

    double U = 1.0 - in.xBar_mm / in.connectionLength_mm;
    U = std::max(0.0, U);
    const double Ae = U * in.netArea_mm2;
    const double Py = in.Fy_MPa * in.grossArea_mm2 / 1000.0;   // kN
    const double Pr = in.Fu_MPa * Ae / 1000.0;                  // kN
    const double Pd = std::min(0.9 * Py, 0.75 * Pr);

    Result r;
    r.shearLag_U          = U;
    r.effectiveArea_mm2   = Ae;
    r.yieldCapacity_kN    = Py;
    r.ruptureCapacity_kN  = Pr;
    r.designCapacity_kN   = Pd;
    return r;
}

}  // namespace forge::tension
