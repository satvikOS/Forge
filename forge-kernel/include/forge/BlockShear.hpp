// Forge-310 — Block-shear rupture of bolted/welded steel connections
// (AISC 360-22 §J4.3).
//
// Block shear is the limit state where a block of metal tears out of a
// connected element along a combined shear plane (parallel to load) and
// tension plane (perpendicular to load). It governs shear-tab plate
// connections, coped beam ends, gusset plates at brace endings, single-
// angle tension members, and bolted clip angles.
//
//   R_n = min[ 0.6·F_u·A_nv + U_bs·F_u·A_nt ,            (shear rupture path)
//              0.6·F_y·A_gv + U_bs·F_u·A_nt ]            (shear yielding path)
//                                                         (Eq. J4-5)
//
// where A_gv / A_nv are gross / net shear areas (mm²) and A_nt is the net
// tension area. U_bs = 1.0 for uniform tension stress distribution (typical),
// 0.5 for non-uniform (e.g. coped beam with single-row bolts).
//
// LRFD φ = 0.75 (§J4.3.1)
// ASD Ω = 2.00 (§J4.3.1)

#pragma once

namespace forge::blockshear {

struct Input {
    double A_gv_mm2;     // gross shear area
    double A_nv_mm2;     // net shear area (after bolt-hole deduction)
    double A_nt_mm2;     // net tension area
    double U_bs;         // 1.0 uniform / 0.5 non-uniform
    double Fy_MPa;       // base-metal yield
    double Fu_MPa;       // base-metal tensile
};

struct Result {
    double shearRuptureCapN;        // 0.6·F_u·A_nv
    double shearYieldingCapN;       // 0.6·F_y·A_gv
    double tensionRuptureN;         // U_bs·F_u·A_nt
    double governingShearN;         // smaller of (shearRupt, shearYield)
    double nominalCapN;             // R_n = governingShear + tensionRupture
    double LRFDcapN;                // 0.75·R_n
    double ASDcapN;                 // R_n / 2.00
    int    governingPath;           // 1 = shear-rupture path | 2 = shear-yield path
};

Result analyse(const Input& in);

}  // namespace forge::blockshear
