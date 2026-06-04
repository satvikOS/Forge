// Forge-336d — HVAC air-side economizer (ASHRAE 90.1 §6.5.1).
//   Outside-air OA temperature/humidity vs return; if OA enthalpy < return ⇒ open OA.
//   Mixed-air enthalpy h_m = X_oa·h_oa + (1−X_oa)·h_ret
//   Free cooling Q = ṁ·(h_ret − h_m) when economizing.
//   Dry-bulb control: h_oa < h_ret AND T_oa < high-limit (typ 24 °C climate-1).
//   Returns recommended OA fraction and free-cooling capacity.

#pragma once

namespace forge::econ {

struct Input {
    double oaDryBulb_C;
    double oaWetBulb_C;
    double returnDryBulb_C;
    double returnWetBulb_C;
    double airMassFlow_kgPerS;
    double minimumOAfraction;       // IAQ minimum (e.g., 0.15)
    double highLimitT_C;             // dry-bulb cutoff (e.g., 24)
    double highLimitH_kJperKg;       // enthalpy cutoff (e.g., 65)
    int    controlType;              // 0 dry-bulb, 1 enthalpy
};

struct Result {
    double oaEnthalpy_kJperKg;
    double returnEnthalpy_kJperKg;
    double recommendedOAfraction;
    double mixedEnthalpy_kJperKg;
    double freeCoolingCapacity_kW;
    bool   economizerActive;
};

Result analyse(const Input& in);

}  // namespace forge::econ
