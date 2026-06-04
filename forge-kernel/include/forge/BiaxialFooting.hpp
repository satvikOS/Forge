// Forge-337a — Rectangular footing under biaxial moment (ACI 318-19 §13.3 / Bowles).
//   Axial P at eccentricity (e_x, e_y) — equivalent to (P, M_x = P·e_y, M_y = P·e_x).
//   Stress at four corners:  σ = P/A · (1 ± 6·e_x/B_x ± 6·e_y/B_y)
//   If both eccentricities ≤ kern (e_x ≤ B_x/6, e_y ≤ B_y/6) → full compression.
//   Otherwise partial-uplift triangular bearing — Meyerhof effective footprint:
//     B'_x = B_x − 2·e_x, B'_y = B_y − 2·e_y; σ_max = P/(B'_x · B'_y).

#pragma once

namespace forge::biaxfoot {

struct Input {
    double axialLoad_P_kN;
    double momentMx_kNm;        // about x-axis (causes e_y)
    double momentMy_kNm;        // about y-axis (causes e_x)
    double footingBx_m;
    double footingBy_m;
    double allowableBearing_kPa;
};

struct Result {
    double eccentricity_ex_m;
    double eccentricity_ey_m;
    double cornerStresses_kPa[4];  // [+ex+ey, +ex−ey, −ex+ey, −ex−ey]
    double sigmaMax_kPa;
    double sigmaMin_kPa;
    bool   upliftDetected;          // any corner < 0
    bool   stable;                  // σ_max ≤ σ_allow AND no uplift
    double meyerhofBx_m;            // effective width if uplift
    double meyerhofBy_m;
};

Result analyse(const Input& in);

}  // namespace forge::biaxfoot
