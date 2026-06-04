// Forge-322d — Heat-trace cable wattage for pipe freeze protection
// (IEEE 515.1, Thermon design manual).
//   q' = 2π · (T_pipe − T_amb) / (ln(D_out/D_pipe) / k_ins + 2/(h_o · D_out))
//   Recommended cable: q' · 1.25 safety, rounded up to standard W/m

#pragma once

namespace forge::heattrace {

struct Input {
    double pipeOuterDiameterMm;
    double insulationThicknessMm;
    double insulationConductivityWmk;   // 0.04 fibreglass, 0.03 polyiso
    double outdoorFilmCoefficientWm2K;  // 25 typical 5 m/s wind
    double pipeTargetTempC;
    double ambientTempC;
    double safetyFactor;                // 1.25 typical
};

struct Result {
    double insulationOD_mm;
    double heatLossWPerM;
    double recommendedCableWperM;
};

Result analyse(const Input& in);

}  // namespace forge::heattrace
