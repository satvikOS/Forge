// Forge-333a — Raised-face bolted pipe flange (ASME Sec VIII Div 1 App 2 — B16.5).
//   Operating bolt load   W_m1 = H_D + H_P
//     H_D = (π/4)·G²·P                  end load on flange face
//     H_P = 2·b·π·G·m·P                 joint contact load (gasket factor m)
//   Seating bolt load     W_m2 = π·b·G·y             gasket seating
//   Required bolt area   A_m = max(W_m1/S_a, W_m2/S_atm)
//   Effective gasket width  b = b_0 if b_0 ≤ 6 mm else 2.52·√b_0
//   G effective diameter = mid-gasket if b_0 ≤ 6 mm, else OD − 2·b
//   Flange thickness from longitudinal hub stress (simplified).

#pragma once

namespace forge::flange {

struct Input {
    double designPressure_MPa;     // P
    double gasketOD_mm;            // outer ring
    double gasketID_mm;            // inner ring
    double gasketFactorM;          // ASME Table 2-5.1 (1.25 PTFE, 2.50 spiral wound, 3.00 metallic)
    double seatingStress_y_MPa;    // y
    double allowableBoltStress_Sa_MPa;    // operating
    double allowableBoltStressAtm_Satm_MPa;  // ambient
    double singleBoltArea_mm2;     // root area per bolt
};

struct Result {
    double gasketWidth_b0_mm;
    double effectiveWidth_b_mm;
    double effectiveDiameter_G_mm;
    double Hd_kN;
    double Hp_kN;
    double Wm1_kN;
    double Wm2_kN;
    double Am_required_mm2;
    int    boltCountRequired;
};

Result analyse(const Input& in);

}  // namespace forge::flange
