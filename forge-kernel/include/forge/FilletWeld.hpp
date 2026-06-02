// Forge-237 — Fillet weld design (AISC 360 §J2 / AWS D1.1).
//
// Equal-leg fillet weld between two plates.
//   Effective throat: t_e = 0.707·w   (sin 45° = 1/√2)
//   Weld electrode nominal shear: F_nw = 0.60·F_EXX
//   Nominal per-unit-length:      r_n = F_nw · t_e   (N/m)
//   LRFD design per-unit-length:  φr_n = 0.75 · r_n  (φ_w = 0.75 J2-4)
//   Total capacity:               φR_n = φr_n · L_total
//
// AWS D1.1 minimum leg (Table 5.7 / 4.7 simplified, for SMAW):
//   t_thicker ≤ 6 mm   →  w_min = 3 mm
//   6 < t ≤ 13 mm      →  w_min = 5 mm
//   13 < t ≤ 19 mm     →  w_min = 6 mm
//   t > 19 mm          →  w_min = 8 mm
// Maximum leg per AISC J2.2b along the *edge* of a plate:
//   t < 6.4 mm  → w_max = t
//   t ≥ 6.4 mm  → w_max = t − 1.6 mm
//
// Directional-strength increase (J2-5) is *not* applied; the simple
// 0.60·F_EXX value is conservative.

#pragma once

namespace forge::filletweld {

struct Input {
    double legSizeM;         // w (m)
    double weldLengthM;      // L_total (m) — sum of all weld segments
    double electrodeFexxPa;  // F_EXX (Pa)  — e.g. 480e6 for E70xx
    double thickerPlateM;    // t_thicker (m) for AWS minimum-leg check
    double edgePlateM;       // t_edge (m) for AISC maximum-leg check (along edge)
    double phi;              // 0.75 LRFD
};

struct Result {
    double effectiveThroatM;        // t_e
    double nominalPerUnitNPerM;     // r_n
    double designPerUnitNPerM;      // φr_n
    double totalDesignN;            // φR_n
    double awsMinLegM;              // w_min per AWS D1.1
    double aiscMaxLegM;             // w_max per AISC J2.2b
    bool legBelowAwsMin;            // w < w_min
    bool legAboveAiscMax;           // w > w_max
};

Result analyse(const Input& in);

}  // namespace forge::filletweld
