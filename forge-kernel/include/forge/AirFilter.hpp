// Forge-294 — Air filter pressure drop, fan energy, and operating cost.
//
// Used for HVAC filter sizing and total-cost-of-ownership analysis. Captures
// the four design quantities every filter sizing exercise needs:
//
//   Face velocity:   v_face = Q / A
//   Avg pressure:    Δp_avg = (Δp_initial + Δp_final) / 2   (linear loading)
//   Fan power:       P_fan  = Δp_avg · Q / η_fan_total
//                            (η_fan_total ≈ 0.55 default for HVAC mixed-flow)
//   Energy:          E_kWh  = P_fan · t / 1000
//   Cost:            $      = E_kWh · electricity_rate
//
// Face velocity sanity range:
//   0.5 < v < 2.5 m/s  is the ASHRAE-recommended band; outside this range
//   the filter either oversizes (low v, large pressure-drop savings) or
//   loses efficiency from turbulence (high v).
//
// SI throughout: Q m³/s, A m², Δp Pa, t hours, $ per kWh.

#pragma once

namespace forge::airfilter {

struct Input {
    double flowRateM3S;
    double faceAreaM2;
    double initialPressureDropPa;
    double finalPressureDropPa;
    double runHours;
    double fanEfficiency;              // η_total, 0.55 default
    double electricityRatePerKWh;      // $/kWh
};

struct Result {
    double faceVelocityMs;
    bool   faceVelocityInRange;        // 0.5 < v < 2.5
    double averagePressureDropPa;
    double fanPowerW;
    double energyKWh;
    double energyCost;
};

Result analyse(const Input& in);

}  // namespace forge::airfilter
