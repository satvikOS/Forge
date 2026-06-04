// Forge-332a — Pad-eye lifting lug (ASME BTH-1-2020 §3-2.6).
//   Required minimum thickness:
//     t_req = P / (Φ · σ_allow · D_pin)         bearing
//     Net-section tension across hole: A_n = (D_pad − D_pin) · t
//     Shear tear-out:  A_v = 2 · (R − r_pin) · t
//     Φ_t = 0.45 (Design Cat A) — ASME BTH-1 Table 3-2.6-3.

#pragma once

namespace forge::padeye {

struct Input {
    double designLoad_kN;        // P
    double padThickness_mm;      // t
    double padDiameter_mm;       // D_pad (overall)
    double holeDiameter_mm;      // d_h
    double pinDiameter_mm;       // d_pin
    double cheekToEdge_mm;       // R − r_pin (tear-out length per side)
    double yieldStrength_MPa;    // F_y
    double designCategory;       // 1.0 (A) or 0.6 (B)
};

struct Result {
    double bearingStress_MPa;
    double tensionAcrossHole_MPa;
    double shearTearOut_MPa;
    double allowableTensile_MPa;     // Φ · F_y · 0.45
    double allowableShear_MPa;       // Φ · F_y · 0.36
    double governingUtilisation;     // max(bearing, tens, shear) / allow
    bool   passes;
};

Result analyse(const Input& in);

}  // namespace forge::padeye
