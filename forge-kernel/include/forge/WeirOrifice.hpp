// Forge-243 — Sharp-crested weir / V-notch / orifice flow.
//
// Sharp-crested rectangular weir:
//   Q = (2/3) · C_d · L · √(2g) · H^(3/2)            (no end contraction)
//   With end contractions (Francis): L_eff = L − 0.1·n·H, n = #contractions
//
// V-notch (triangular) weir, half-angle θ:
//   Q = (8/15) · C_d · √(2g) · tan(θ/2) · H^(5/2)
//
// Orifice (small, submerged or free) of area A under head H:
//   Q = C_d · A · √(2g·H)
//
// Defaults: C_d = 0.62 (rectangular), 0.58 (V-notch), 0.62 (orifice),
// g = 9.81 m/s².

#pragma once

namespace forge::weir {

struct RectInput {
    double crestLengthM;        // L
    double headM;               // H
    double dischargeCoeff;      // C_d
    int endContractions;        // 0, 1, or 2 (Francis)
    double gravityG;            // g
};

double rectWeirDischarge(const RectInput& in);

struct VNotchInput {
    double notchAngleDeg;       // total notch angle θ
    double headM;
    double dischargeCoeff;
    double gravityG;
};

double vNotchDischarge(const VNotchInput& in);

struct OrificeInput {
    double areaM2;              // A
    double headM;               // H
    double dischargeCoeff;
    double gravityG;
};

double orificeDischarge(const OrificeInput& in);

}  // namespace forge::weir
