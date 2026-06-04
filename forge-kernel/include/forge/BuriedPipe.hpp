// Forge-319b — Buried-pipe earth load (Marston 1913 trench-condition formula).
//
//   W_d = C_d · γ · B_d²       kN/m (per unit pipe length)
//
//   C_d = (1 − e^(−2·K·μ′·(H/B_d))) / (2·K·μ′)
//     K   = Rankine active = (1 − sin φ)/(1 + sin φ)
//     μ′  = tan(φ_backfill_wall)  (typ 0.5·tan φ)
//
// Trench condition: B_d = trench width at top of pipe, H = fill above top.
// Used for storm sewers, sanitary mains, water mains, fibre-optic conduit.

#pragma once

namespace forge::buriedpipe {

struct Input {
    double trenchWidthBd_m;       // B_d
    double fillHeightH_m;         // H above top of pipe
    double soilFrictionAngleDeg;  // φ
    double soilUnitWeightKnPerM3; // γ
};

struct Result {
    double K_Rankine;
    double mu_prime;
    double C_d;
    double earthLoadKnPerM;
};

Result analyse(const Input& in);

}  // namespace forge::buriedpipe
