#include "forge/RailBeam.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::railbeam {

Result analyse(const Input& in) {
    if (in.wheelLoad_kN <= 0)                   throw std::runtime_error("P > 0");
    if (in.railE_GPa <= 0)                      throw std::runtime_error("E > 0");
    if (in.railI_cm4 <= 0)                      throw std::runtime_error("I > 0");
    if (in.railSectionModulusBase_cm3 <= 0)     throw std::runtime_error("S > 0");
    if (in.trackModulus_MPaPerM <= 0)           throw std::runtime_error("u > 0");

    const double P_N    = in.wheelLoad_kN * 1.0e3;
    const double E_Pa   = in.railE_GPa * 1.0e9;
    const double I_m4   = in.railI_cm4 * 1.0e-8;       // cm^4 → m^4
    const double S_m3   = in.railSectionModulusBase_cm3 * 1.0e-6;
    const double u_Npm2 = in.trackModulus_MPaPerM * 1.0e6;  // MN/m/m → N/m/m

    const double L_e   = std::pow(4.0 * E_Pa * I_m4 / u_Npm2, 0.25);
    const double y_max = P_N / (2.0 * L_e * u_Npm2);
    const double M_max = P_N * L_e / 4.0;
    const double sigma = M_max / S_m3;

    Result r;
    r.characteristicLength_m  = L_e;
    r.maxRailDeflection_mm    = y_max * 1.0e3;
    r.maxBendingMoment_kNm    = M_max * 1.0e-3;
    r.maxRailStress_MPa       = sigma * 1.0e-6;
    return r;
}

}  // namespace forge::railbeam
