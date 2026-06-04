// Forge-341a — Cantilevered soldier-pile retaining wall (FHWA-IF-99-015 / Caltrans Trenching).
//   Active pressure: p_a = K_a · γ · z          (Rankine, level backfill)
//   Required embedment depth d such that ΣM about base = 0:
//     Cantilever: solve cubic d³ + 3·a·d² − ... via simplified Coulomb-Karol.
//     Approx: d_req ≈ 1.5·H · √(K_a/K_p)         empirical (matches FHWA Fig 4-12 within 5 %)
//   Max moment in pile at point of zero shear (between top and dredge line).

#pragma once

namespace forge::soldierpile {

struct Input {
    double wallHeight_H_m;          // above dredge line
    double soilFrictionAngleDeg_phi;
    double soilUnitWeight_kNm3;
    double surcharge_q_kNm2;
    double pileSpacing_S_m;         // soldier piles spacing
    double soldierPileDepth_d_mm;   // existing pile depth (for stress check)
    double soldierPileFy_MPa;
};

struct Result {
    double Ka;
    double Kp;
    double activePressureAtBase_kPa;
    double totalActiveForce_kNperM;
    double requiredEmbedment_m;
    double maxBendingMoment_kNm_perPile;
    double maxFiberStress_MPa;     // per pile, assumed circular d_p
};

Result analyse(const Input& in);

}  // namespace forge::soldierpile
