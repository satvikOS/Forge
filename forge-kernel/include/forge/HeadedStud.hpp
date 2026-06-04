// Forge-296 — Headed shear-stud connector for composite beams (AISC 360-22 §I8).
//
// Used to size the row of headed studs (typically 5/8"–7/8" ASTM A108)
// welded to the top flange of a steel W-shape to develop horizontal shear
// between the steel beam and the concrete slab in composite construction.
//
//   Concrete modulus:    E_c = w_c^1.5 · 0.043 · √f'_c               [MPa]
//   Nominal stud strength (single):
//       Q_n_conc = 0.5 · A_sc · √(f'_c · E_c)                          (Eq. I8-1)
//       Q_n_steel = R_g · R_p · A_sc · F_u                              (Eq. I8-1 upper bound)
//       Q_n      = min(Q_n_conc, Q_n_steel)
//
//   R_g group factor:    1.0 single in line, 0.85 pair across (Type A
//                        deck rib), 0.7 pair across small rib.
//   R_p position factor: 1.0 strong (solid slab), 0.75 weak (deck).
//   F_u = 415 MPa default for A108 Grade 1015.
//
//   Total horizontal shear capacity:  ΣQ_n = n · Q_n
//   Demand:                            V_h (kN, from composite design)
//   DCR  = V_h · 1000 / ΣQ_n
//
// SI units throughout. Stress MPa, diameter mm, concrete density kg/m³.

#pragma once

namespace forge::headedstud {

struct Input {
    double studDiameterMm;          // d_sc
    double concreteStrengthMPa;     // f'_c
    double concreteUnitWeightKgM3;  // w_c (2400 normal-weight)
    double studUltimateStressMPa;   // F_u (415 typical)
    double groupFactorRg;           // R_g
    double positionFactorRp;        // R_p
    int    studCount;               // n
    double requiredHorizShearKN;    // V_h
};

struct Result {
    double studAreaMm2;             // A_sc
    double concreteModulusMPa;      // E_c
    double qNominalConcreteN;       // Q_n,conc (per stud)
    double qNominalSteelN;          // Q_n,steel (per stud)
    double qNominalSingleN;         // min of above
    double totalCapacityKN;         // ΣQ_n
    double demandCapacityRatio;     // V_h/ΣQ_n
    bool   passes;
};

Result analyse(const Input& in);

}  // namespace forge::headedstud
