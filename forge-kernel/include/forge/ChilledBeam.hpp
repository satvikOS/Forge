// Forge-340c — Active chilled-beam unit (ASHRAE Handbook HVAC Apps Ch 18 / REHVA Guide).
//   Primary-air sensible cooling Q_pa = ṁ_pa · c_pa · (T_zone − T_pa_supply)
//   Induction ratio K_i = (ṁ_induced + ṁ_pa) / ṁ_pa     (typ 3–4)
//   Coil sensible cooling Q_coil = K_pa · ṁ_pa · c_pa · (T_zone − T_coil_air_off)·LMTD·UA/...
//   Simplified (manufacturer-rated curve): Q_coil = a · ṁ_water · ΔT_water + b
//   Total Q_zone = Q_pa + Q_coil.
//   Outside air per occupant (ASHRAE 62.1): 5 L/s person + 0.6 L/s·m².

#pragma once

namespace forge::chbeam {

struct Input {
    double zoneTemp_C;
    double primaryAirTemp_C;            // T_pa supply
    double primaryAirFlow_LperS;
    double chilledWaterFlow_LperMin;
    double chilledWaterIn_C;
    double chilledWaterOut_C;
    double inductionRatio_Ki;
    double zoneArea_m2;
    int    occupantCount;
};

struct Result {
    double primaryAirSensible_kW;
    double coilSensible_kW;             // ṁ_w · c_w · ΔT
    double totalCooling_kW;
    double requiredOutsideAir_LperS;    // per ASHRAE 62.1 VRP
    double oaCompliance;                // ratio supplied/required
    bool   meetsOA;
};

Result analyse(const Input& in);

}  // namespace forge::chbeam
