#include "forge/BoltedTimber.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::boltedtimber {

Result analyse(const Input& in) {
    if (in.boltDiameterMm <= 0) throw std::runtime_error("D > 0");
    if (in.mainMemberThicknessMm <= 0) throw std::runtime_error("t_m > 0");
    if (in.sideMemberThicknessMm <= 0) throw std::runtime_error("t_s > 0");
    if (in.mainEmbedmentMPa <= 0) throw std::runtime_error("F_em > 0");
    if (in.sideEmbedmentMPa <= 0) throw std::runtime_error("F_es > 0");
    if (in.loadDurationFactor <= 0) throw std::runtime_error("C_D > 0");

    // Mode I_m: bearing crush in main member (single bolt, single shear)
    const double Zm_N = 0.65 * in.boltDiameterMm * in.mainMemberThicknessMm
                      * in.mainEmbedmentMPa;
    // Mode I_s: bearing crush in side member
    const double Zs_N = 0.65 * in.boltDiameterMm * in.sideMemberThicknessMm
                      * in.sideEmbedmentMPa;
    const double Z_gov = std::min(Zm_N, Zs_N);
    const double Z_adj = Z_gov * in.loadDurationFactor;

    Result r;
    r.Z_mainMode_kN  = Zm_N / 1000.0;
    r.Z_sideMode_kN  = Zs_N / 1000.0;
    r.governingZ_kN  = Z_gov / 1000.0;
    r.adjustedZ_kN   = Z_adj / 1000.0;
    return r;
}

}  // namespace forge::boltedtimber
