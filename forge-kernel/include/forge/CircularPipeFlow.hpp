// Forge-289 — Storm-sewer / circular-pipe partial-flow Manning calculation.
//
// Used for storm-drain and sanitary-sewer hydraulic design, culvert sizing,
// pipe-flow with free water surface (gravity flow), and the classic
// Camp-curve partial-flow ratios that engineers use to determine velocity
// at design depth versus capacity at full bore.
//
// For a circular pipe of inside diameter D, flowing at water depth d:
//
//   Central angle (subtended at centre by water-surface chord):
//       θ = 2 · arccos(1 − 2·d/D)               (radians)
//
//   Flow area:                A = D²/8 · (θ − sin θ)
//   Wetted perimeter:         P = D · θ / 2
//   Hydraulic radius:         R = A / P
//   Manning velocity:         V = (1/n) · R^(2/3) · √S
//   Discharge:                Q = A · V
//
// Full-flow reference values (d = D, θ = 2π):
//   A_full = π·D²/4,   P_full = π·D,   R_full = D/4
//
// SI metric throughout: D and d in m, S dimensionless, n in s/m^(1/3) (the
// SI form, so n = 0.013 for concrete pipe), V in m/s, Q in m³/s.

#pragma once

namespace forge::circpipe {

struct Input {
    double pipeDiameterM;       // D
    double waterDepthM;         // d (≤ D)
    double manningN;            // n  (SI: 0.013 concrete, 0.024 corrugated metal)
    double slope;               // S = ΔH / L
};

struct Result {
    double depthRatio;           // d / D
    double centralAngleRad;      // θ
    double flowAreaM2;           // A
    double wettedPerimeterM;     // P
    double hydraulicRadiusM;     // R
    double velocityMs;           // V
    double dischargeM3S;         // Q
    double dischargeLs;          // Q × 1000
    // Camp-curve ratios (vs full-flow):
    double areaRatio;            // A / A_full
    double velocityRatio;        // V / V_full
    double dischargeRatio;       // Q / Q_full
};

Result analyse(const Input& in);

}  // namespace forge::circpipe
