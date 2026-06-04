// Forge-321a — Ventilation rate procedure (ASHRAE 62.1-2022).
//   V_breathing_zone = R_p · P_z + R_a · A_z       (L/s)
//   V_outdoor_air    = V_breathing_zone / E_z       (zone air distribution effectiveness)

#pragma once

namespace forge::ventilation {

struct Input {
    double occupantsP;
    double zoneAreaM2;
    double R_p_LpsPerPerson;   // 2.5 office, 3.8 classroom, 7.6 dining
    double R_a_LpsPerM2;       // 0.3 office, 0.6 classroom
    double zoneAirDistEffectivenessE_z;   // 0.8-1.2 typical
};

struct Result {
    double breathingZoneFlowLps;
    double outdoorAirFlowLps;
    double outdoorAirFlowCfm;         // m³/min ÷ 0.4719 ... convert L/s→cfm via ×2.119
    double perPersonOAcfm;
};

Result analyse(const Input& in);

}  // namespace forge::ventilation
