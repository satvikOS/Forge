// Forge-335c — Air receiver / pressure vessel (ASME Sec VIII Div 1 §UG-27).
//   Cylindrical shell, internal pressure:
//     t_circ (long. weld) = P·R / (S·E − 0.6·P)        circumferential stress controls
//     t_long (girth weld) = P·R / (2·S·E + 0.4·P)      longitudinal stress controls
//   Required minimum thickness = max(t_circ, t_long) + CA
//   MAWP back-calc with as-built t_a:
//     MAWP = S·E·t / (R + 0.6·t)        circ controls typical
//   Blowdown frequency (idealised polytropic n):
//     t_charge = V/Q_in · ln((P_max + P_atm)/(P_min + P_atm))     (isothermal approx).

#pragma once

namespace forge::airrcv {

struct Input {
    double internalPressure_MPa;   // P (gauge)
    double insideRadius_mm;        // R
    double allowableStress_S_MPa;
    double jointEfficiency_E;      // 0.7–1.0
    double corrosionAllowance_mm;
    double asBuiltThickness_mm;    // for MAWP (0 → skip)
    double volume_L;               // for blowdown
    double flowIn_LperS;
    double pressureMax_MPa;        // for cycle
    double pressureMin_MPa;
};

struct Result {
    double tCirc_mm;
    double tLong_mm;
    double requiredThickness_mm;   // max + CA
    double MAWP_MPa;               // 0 if as-built not provided
    double chargeTime_s;           // 0 if Q_in not provided
};

Result analyse(const Input& in);

}  // namespace forge::airrcv
