#include "forge/BoltedFlange.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::flange {

Result analyse(const Input& in) {
    if (in.designPressure_MPa <= 0)          throw std::runtime_error("P > 0");
    if (in.gasketOD_mm <= in.gasketID_mm)    throw std::runtime_error("OD > ID");
    if (in.gasketFactorM < 1.0)              throw std::runtime_error("m >= 1");
    if (in.seatingStress_y_MPa <= 0)         throw std::runtime_error("y > 0");
    if (in.allowableBoltStress_Sa_MPa <= 0)  throw std::runtime_error("S_a > 0");
    if (in.allowableBoltStressAtm_Satm_MPa <= 0) throw std::runtime_error("S_atm > 0");
    if (in.singleBoltArea_mm2 <= 0)          throw std::runtime_error("A_bolt > 0");

    const double N = (in.gasketOD_mm - in.gasketID_mm) / 2.0;          // raw gasket width
    const double b0 = N / 2.0;                                          // ASME Table 2-5.2 fa
    const double b = (b0 <= 6.0) ? b0 : 2.52 * std::sqrt(b0);
    const double G = (b0 <= 6.0)
        ? (in.gasketOD_mm + in.gasketID_mm) / 2.0
        : (in.gasketOD_mm - 2.0 * b);

    const double P = in.designPressure_MPa;
    const double Hd = (M_PI / 4.0) * G * G * P;                         // N (G mm, P MPa = N/mm²)
    const double Hp = 2.0 * b * M_PI * G * in.gasketFactorM * P;
    const double Wm1 = Hd + Hp;                                         // N
    const double Wm2 = M_PI * b * G * in.seatingStress_y_MPa;           // N

    const double Am_oper   = Wm1 / in.allowableBoltStress_Sa_MPa;
    const double Am_seat   = Wm2 / in.allowableBoltStressAtm_Satm_MPa;
    const double Am        = std::max(Am_oper, Am_seat);
    const int    nBolts    = static_cast<int>(std::ceil(Am / in.singleBoltArea_mm2));

    Result r;
    r.gasketWidth_b0_mm      = b0;
    r.effectiveWidth_b_mm    = b;
    r.effectiveDiameter_G_mm = G;
    r.Hd_kN                  = Hd / 1000.0;
    r.Hp_kN                  = Hp / 1000.0;
    r.Wm1_kN                 = Wm1 / 1000.0;
    r.Wm2_kN                 = Wm2 / 1000.0;
    r.Am_required_mm2        = Am;
    r.boltCountRequired      = nBolts;
    return r;
}

}  // namespace forge::flange
