// Forge-327c — Snow load on solar PV array (ASCE 7-22 §7.13).
//   p_f = 0.7·c_t·c_e·p_g                                    flat-roof snow
//   c_s slope coefficient by θ:
//       θ ≤ 30°  → 1.0
//       30 < θ ≤ 70°  → (70 − θ)/40
//       θ > 70°  → 0
//   p_s = c_s · p_f

#pragma once

namespace forge::snowpv {

struct Input {
    double groundSnowKnM2;     // p_g
    double slopeAngleDeg;
    double thermalC_t;         // 1.0 typ, 1.2 unheated
    double exposureC_e;        // 1.0 typ
    double importanceI_s;      // 1.0 ordinary, 1.2 critical
};

struct Result {
    double slopeCoefficient_C_s;
    double flatRoofSnowKnM2;
    double slopedRoofSnowKnM2;
    bool   meetsMinimum;       // ≥ 0.96 kN/m² (~20 psf)
};

Result analyse(const Input& in);

}  // namespace forge::snowpv
