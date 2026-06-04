#include "forge/BuoyantStability.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::buoyfloat {

Result analyse(const Input& in) {
    if (in.bodyMass_kg <= 0)          throw std::runtime_error("m > 0");
    if (in.fluidDensity_kgM3 <= 0)    throw std::runtime_error("ρ > 0");
    if (in.length_m <= 0)             throw std::runtime_error("L > 0");
    if (in.beam_m <= 0)               throw std::runtime_error("B > 0");
    if (in.KG_m < 0)                  throw std::runtime_error("KG >= 0");
    if (in.heelAngle_deg < 0 || in.heelAngle_deg > 90)
        throw std::runtime_error("φ in [0, 90]");

    constexpr double g = 9.80665;
    const double V = in.bodyMass_kg / in.fluidDensity_kgM3;
    const double T = V / (in.length_m * in.beam_m);
    const double KB = T / 2.0;
    const double I_T = in.length_m * std::pow(in.beam_m, 3.0) / 12.0;
    const double BM = I_T / V;
    const double GM = KB + BM - in.KG_m;
    const double phi_rad = in.heelAngle_deg * M_PI / 180.0;
    const double GZ = GM * std::sin(phi_rad);
    const double M_R_kNm = in.bodyMass_kg * g * GZ / 1000.0;

    Result r;
    r.displacedVolume_m3   = V;
    r.draught_m            = T;
    r.KB_m                 = KB;
    r.BM_m                 = BM;
    r.GM_m                 = GM;
    r.rightingArm_GZ_m     = GZ;
    r.rightingMoment_kNm   = M_R_kNm;
    r.stable               = GM > 0.0;
    return r;
}

}  // namespace forge::buoyfloat
