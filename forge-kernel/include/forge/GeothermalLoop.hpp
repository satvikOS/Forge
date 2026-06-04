// Forge-329a — Vertical-bore geothermal ground loop (IGSHPA / Kavanaugh-Rafferty).
//   L_bore = (q · R_pipe + q · R_soil + q · R_grout) / ΔT_design
// Simplified rule-of-thumb: 50-65 m of bore per ton (3.5 kW) of cooling in
// 1.5-2.5 W/m·K soil with R_total ≈ 0.15-0.20 K·m/W.

#pragma once

namespace forge::geothermal {

struct Input {
    double coolingLoadKw;
    double soilConductivityWmk;     // 1.5 dry sandstone, 2.5 saturated rock
    double boreRadiusM;             // typ 0.075 (150 mm dia)
    double pipeOuterDiameterMm;     // typ 32 (HDPE SDR-11)
    double pipeConductivityWmk;     // HDPE 0.40
    double groutConductivityWmk;    // thermally enhanced 1.5
    double designTempDiffK;         // ΔT_F - T_soil
};

struct Result {
    double pipeResistanceMpwK;       // R_pipe per m
    double groutResistanceMpwK;      // R_grout per m
    double soilResistanceMpwK;       // R_soil per m (steady-state Carslaw-Jaeger)
    double totalResistanceMpwK;
    double requiredBoreLengthM;
    double mPerTon;                   // bore length per RT
};

Result analyse(const Input& in);

}  // namespace forge::geothermal
