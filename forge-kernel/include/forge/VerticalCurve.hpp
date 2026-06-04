// Forge-334a — Highway vertical curve (AASHTO Green Book §3.3.3).
//   Parabolic curve y = (A/(200·L))·x²                A = |g2 − g1| (%), x m, y m
//   K = L / A          length per unit grade change.
//   Crest SSD-controlled length (S < L):
//     L_min = A·S² / (100·(√(2h1) + √(2h2))²)         h1=1.08 m driver eye, h2=0.6 m object
//   Sag headlight (S < L):     L_min = A·S² / (120 + 3.5·S)

#pragma once

namespace forge::vcurve {

struct Input {
    double grade1_pct;          // g1 (+ up, − down)
    double grade2_pct;          // g2
    double designSpeed_kmh;     // for SSD calculation
    double curveLength_m;       // L (if provided > 0; else compute from K-method)
    double Kvalue;              // if provided > 0 → L = K·A
    int    curveType;           // 0 = crest, 1 = sag
};

struct Result {
    double algebraicGradeChange_A_pct;     // A
    double computedLength_m;               // L final
    double Kvalue;                         // L/A
    double assumedSSD_m;
    double minLength_AASHTO_m;             // controlling SSD requirement
    double highOrLowPointStation_m;        // x_HP/LP = −g1·L / A
    bool   meetsSightDistance;
};

Result analyse(const Input& in);

}  // namespace forge::vcurve
