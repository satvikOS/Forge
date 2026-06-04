// Forge-298 — Vehicle braking energy + brake disc heat dissipation.
//
// Closes the energy balance for the most common dynamic-stop problem in
// automotive, rail, and aircraft braking system design:
//
//   Initial kinetic energy:   KE_0 = ½ · m · v_0²                 [J]
//   Stop time:                t    = v_0 / a                       [s]
//   Stop distance:            d    = v_0² / (2 · a)                [m]
//   Brake force total:        F    = m · a                          [N]
//   Per-corner force:         F_each = F / n_brakes                  [N]
//   Per-corner heat absorbed: Q_each = KE_0 / n_brakes               [J]
//   Per-disc temperature rise (assuming all energy stays in the disc):
//       ΔT = Q_each / (c_p · m_disc)                                 [K]
//   Average dissipation power:  P_avg = KE_0 / t                     [W]
//
// SI throughout. Speed converted from km/h internally to m/s.

#pragma once

namespace forge::vehbrake {

struct Input {
    double vehicleMassKg;
    double initialSpeedKmH;
    double decelerationMs2;
    int    brakeCount;            // n disks
    double discMassKg;            // single disc mass
    double discSpecificHeatJkgK;  // c_p (≈460 cast iron, ≈900 Al)
};

struct Result {
    double initialSpeedMs;
    double initialKineticEnergyJ;
    double stopTimeS;
    double stopDistanceM;
    double brakeForceTotalN;
    double brakeForcePerBrakeN;
    double heatPerBrakeJ;
    double discTemperatureRiseK;
    double averagePowerW;
};

Result analyse(const Input& in);

}  // namespace forge::vehbrake
