// Forge-336c — Bridge pier local scour (FHWA HEC-18, 5th ed. Eq 6.1).
//   y_s / y_1 = 2.0 · K_1 · K_2 · K_3 · K_4 · (a / y_1)^0.65 · Fr_1^0.43
//   K_1 pier-shape factor (round nose 1.0, square 1.1, sharp 0.9)
//   K_2 angle-of-attack (cos(θ) + (L/a)·sin(θ))^0.65
//   K_3 bed condition (clear-water 1.1, plane 1.1, dunes 1.1–1.3)
//   K_4 armoring factor
//   Fr_1 = V_1 / √(g·y_1)            approach Froude.

#pragma once

namespace forge::pierscour {

struct Input {
    double approachVelocity_mps;   // V_1
    double approachDepth_m;        // y_1
    double pierWidth_m;            // a (transverse)
    double pierLength_m;           // L (parallel to flow)
    double attackAngleDeg;         // θ
    int    pierShape;              // 0 round / 1 square / 2 sharp
    int    bedCondition;           // 0 plane / 1 dunes / 2 antidunes
    double K4_armoring;            // 1.0 default
};

struct Result {
    double approachFroude_Fr1;
    double K1_shape;
    double K2_angle;
    double K3_bed;
    double scourDepth_ys_m;
    double scourRatio_ysOverY1;
};

Result analyse(const Input& in);

}  // namespace forge::pierscour
