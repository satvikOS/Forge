// Forge-318 — Steel column base plate on concrete pedestal (AISC 360-22 §J9
// concrete bearing strength + AISC Design Guide 1 §3 plate thickness).
//
// Companion to Forge-232 (column compression §E3) and Forge-238 (RC beam) —
// closes the load path from a steel column down to a concrete pier or
// footing. Required for every gravity column landing on concrete.
//
// Concrete bearing strength (§J9):
//   P_p = 0.85 · f'_c · A_1                            (Eq. J9-1, on full A_2)
//   P_p = 0.85 · f'_c · A_1 · √(A_2/A_1)              (Eq. J9-2, on partial A_2)
//   where A_1 = base plate area B·N, A_2 = concrete support area B_2·N_2
//   The factor √(A_2/A_1) is capped at 2 (i.e. A_2/A_1 ≤ 4).
//
//   φ = 0.65, Ω = 2.31 (§J9)
//
// Required plate thickness (DG1 Eq. 3.3.13a):
//   t_p,req = max(m, n, λn') · √(2·P_u / (φ·F_y·B·N))
//
//   m = (N − 0.95·d) / 2
//   n = (B − 0.80·b_f) / 2
//   λn' = λ · √(d·b_f) / 4  with λ from Thornton 1990 (simplified λ = 1.0)
//
// We expose all three projections plus the governing required thickness.

#pragma once

namespace forge::baseplate {

struct Input {
    double appliedAxialKn;       // P_u (factored)
    double plateWidthB_mm;       // base-plate B
    double plateLengthN_mm;      // base-plate N
    double columnDepthD_mm;      // d (column depth)
    double columnFlangeBf_mm;    // b_f (column flange width)
    double supportWidthB2_mm;    // pedestal/footing B_2
    double supportLengthN2_mm;   // pedestal/footing N_2
    double fc_MPa;               // f'_c
    double Fy_MPa;               // base-plate F_y (typ A36 = 250 MPa)
};

struct Result {
    double A_1_mm2;
    double A_2_mm2;
    double sqrtA2A1;                  // capped at 2
    double bearingStrength_Pp_kN;
    double LRFD_phiPp_kN;             // 0.65 · P_p
    double ASD_PpOverOmega_kN;        // P_p / 2.31
    double projection_m_mm;
    double projection_n_mm;
    double thorntonLambda_nprime_mm;
    double governingProjection_mm;
    double requiredPlateThickness_mm;
    bool   bearingPasses;             // P_u ≤ φP_p
};

Result analyse(const Input& in);

}  // namespace forge::baseplate
