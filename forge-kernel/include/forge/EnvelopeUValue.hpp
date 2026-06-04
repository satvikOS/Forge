// Forge-320e — Building-envelope U-value (ASHRAE Handbook — Fundamentals
// Ch.27, Energy Star, IECC reference).
//
//   1/U_assembly = R_si + Σ R_layer + R_so
//   R_layer       = d / k         d in m, k in W/m·K
//   R_si = 0.13 m²·K/W (interior wall),  R_so = 0.04 (exterior 12 mph wind)
//
//   Heat-flow: Q = U · A · ΔT

#pragma once

#include <vector>

namespace forge::uvalue {

struct Layer {
    double thicknessMm;       // d
    double conductivityWmk;   // k
};

struct Input {
    std::vector<Layer> layers;
    double interiorFilmRSI;        // 0.13 wall, 0.10 ceiling
    double exteriorFilmRSI;        // 0.04 wall/roof
    double areaM2;                 // assembly area
    double designDeltaTKelvin;     // for Q calc
};

struct Result {
    double layerSumRSI;
    double totalRSI;
    double uValueWm2K;             // 1 / totalRSI
    double heatFlowW;              // U·A·ΔT
};

Result analyse(const Input& in);

}  // namespace forge::uvalue
