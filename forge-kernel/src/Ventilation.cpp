#include "forge/Ventilation.hpp"

#include <stdexcept>

namespace forge::ventilation {

Result analyse(const Input& in) {
    if (in.occupantsP < 0.0) throw std::runtime_error("occupantsP must be ≥ 0");
    if (in.zoneAreaM2 <= 0.0) throw std::runtime_error("zoneAreaM2 must be > 0");
    if (in.R_p_LpsPerPerson < 0.0) throw std::runtime_error("R_p must be ≥ 0");
    if (in.R_a_LpsPerM2 < 0.0) throw std::runtime_error("R_a must be ≥ 0");
    if (in.zoneAirDistEffectivenessE_z <= 0.0)
        throw std::runtime_error("E_z must be > 0");

    const double V_bz = in.R_p_LpsPerPerson * in.occupantsP
                     + in.R_a_LpsPerM2 * in.zoneAreaM2;
    const double V_oz = V_bz / in.zoneAirDistEffectivenessE_z;
    const double V_cfm = V_oz * 2.119;     // L/s → cfm
    const double perP  = (in.occupantsP > 0.0) ? V_cfm / in.occupantsP : 0.0;

    Result r;
    r.breathingZoneFlowLps = V_bz;
    r.outdoorAirFlowLps    = V_oz;
    r.outdoorAirFlowCfm    = V_cfm;
    r.perPersonOAcfm       = perP;
    return r;
}

}  // namespace forge::ventilation
