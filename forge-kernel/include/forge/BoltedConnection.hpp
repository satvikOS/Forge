// Forge-236 — Bolted connection check (AISC 360 J3 / Eurocode 3 §3.6).
//
// One bolted bearing-type lap connection in shear.
//   Bolt shear (single shear, threads in shear plane):
//     R_n_v = F_nv · A_b                   (AISC J3-1, F_nv ≈ 0.45·F_ub for A325-N)
//     φR_v  = 0.75 · R_n_v                 (AISC LRFD)
//   Bearing on plate (deformation considered):
//     R_n_p = min(1.2·L_c·t·F_u, 2.4·d_b·t·F_u)   (AISC J3-6a)
//     φR_p  = 0.75 · R_n_p
//   Block shear / minimum spacing / minimum edge distance are
//     out of scope for the calculator (handled in a future slice);
//     we surface only the per-bolt design value and the controlling
//     limit state.
//
//   Net tension:
//     P_n = F_y · A_g (yielding) ; P_n = F_u · A_e (rupture)
//     A_e = U · A_n , A_n = (W - n·d_h)·t
//     φ_y = 0.9, φ_u = 0.75      (AISC D2)
//
// Pure SI units throughout. Stresses in Pa, areas in m², forces in N.

#pragma once

namespace forge::boltconn {

struct ShearInput {
    double boltAreaM2;        // A_b (m²) — gross bolt area in shear plane
    double boltUltimatePa;    // F_ub (Pa) — nominal bolt ultimate (e.g. 825 MPa for A325)
    double plateThicknessM;   // t (m)
    double boltNominalDiamM;  // d_b (m)
    double edgeClearanceM;    // L_c (m) — clear distance from hole edge to plate edge / next hole
    double plateUltimatePa;   // F_u of the plate (Pa)
    int shearPlanes;          // 1 (single shear) or 2 (double shear)
    double phiShear;          // resistance factor for bolt shear (default 0.75)
    double phiBearing;        // resistance factor for plate bearing (default 0.75)
};

struct ShearResult {
    double boltShearN;        // R_n_v = n_planes · F_nv · A_b  (uses F_nv = 0.45·F_ub for "threads in shear plane")
    double bearingN;          // R_n_p
    double bearingLcN;        // 1.2·L_c·t·F_u
    double bearingDbN;        // 2.4·d_b·t·F_u  (upper bound)
    double designShearN;      // φR_v
    double designBearingN;    // φR_p
    double governingN;        // min(designShearN, designBearingN)
    bool governedByShear;     // true if bolt shear < bearing
};

ShearResult analyseShear(const ShearInput& in);

struct TensionInput {
    double grossAreaM2;       // A_g (m²)
    double yieldPa;           // F_y (Pa)
    double ultimatePa;        // F_u (Pa)
    double plateWidthM;       // W (m)
    double plateThicknessM;   // t (m)
    int boltsAcross;          // n bolts across the section
    double holeDiameterM;     // d_h (m) = d_b + 1.5 mm typically; user supplies
    double shearLagU;         // U (≤ 1)
    double phiYield;          // 0.9
    double phiRupture;        // 0.75
};

struct TensionResult {
    double netAreaM2;         // A_n
    double effectiveAreaM2;   // A_e = U·A_n
    double yieldingN;         // P_n,y = F_y·A_g
    double ruptureN;          // P_n,r = F_u·A_e
    double designYieldN;      // φ·P_n,y
    double designRuptureN;    // φ·P_n,r
    double governingN;        // min of design values
    bool governedByRupture;
};

TensionResult analyseTension(const TensionInput& in);

}  // namespace forge::boltconn
