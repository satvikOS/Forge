// Forge-331b — API 650 §5.11 anchored tank wind / overturning.
//   Wind pressure P_w = 0.86·V²·K_s     V[m/s], P[Pa]   (API 650 Annex V approx.)
//   Overturning moment M_w = P_w · H_tank · D · (H_tank/2)         lateral pressure on cylinder
//   Resisting moment   M_dl = (W_shell + 0.4·W_fluid) · D/2          (60 % fluid neglected)
//   Anchor uplift  N_anchor = (M_w − M_dl) · 4 / (n·D)               per bolt, kN

#pragma once

namespace forge::tankanchor {

struct Input {
    double tankDiameter_m;
    double tankHeight_m;
    double shellWeight_kN;
    double fluidWeight_kN;
    double windSpeed_ms;
    int    anchorCount;
    double importanceFactorKs;     // 1.0 typ
};

struct Result {
    double windPressure_kPa;
    double overturningMoment_kNm;
    double restoringMoment_kNm;
    double netUplift_kN;           // per bolt; <0 = compression
    double safetyFactor;
    bool   anchorageRequired;      // M_w > M_dl
};

Result analyse(const Input& in);

}  // namespace forge::tankanchor
