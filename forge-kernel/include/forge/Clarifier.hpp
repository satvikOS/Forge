// Forge-334b — Wastewater clarifier sizing (Metcalf-Eddy Ch 8 + Ten States Std).
//   Surface overflow rate SOR = Q / A_s        m³/m²·d
//   Weir loading WLR = Q / L_w                  m³/m·d
//   Hydraulic retention time HRT = V / Q        h
//   Side-water depth SWD: typical 3.0–4.5 m
//   Solids loading rate SLR = (Q + Q_R)·X / A_s   kg/m²·d  (secondary)
//   Pass criteria: primary SOR ≤ 40 m/d, secondary SOR ≤ 24 m/d, WLR ≤ 250.

#pragma once

namespace forge::clarifier {

struct Input {
    double designFlow_m3d;         // Q
    double tankDiameter_m;
    double tankDepth_m;
    double weirLength_m;           // L_w (perimeter or trough)
    double returnSludgeRatio;      // R = Q_R / Q (0 for primary)
    double mixedLiquorMLSS_kgM3;   // X (for SLR)
    int    clarifierType;          // 0 = primary, 1 = secondary
};

struct Result {
    double surfaceArea_m2;
    double tankVolume_m3;
    double SOR_mPerD;              // m/day equivalent
    double WLR_m3PerMpD;
    double HRT_h;
    double SLR_kgPerM2D;
    bool   meetsSOR;
    bool   meetsWLR;
};

Result analyse(const Input& in);

}  // namespace forge::clarifier
