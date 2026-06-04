// Forge-329c — Bolted timber connection (NDS 2018 yield-mode equations).
//   Reference design value Z parallel to grain (Mode I_m):
//     Z_l = D · l · F_em / 4              (main-member crushing parallel)
//   Mode III_s side-plate yield:
//     Z_l = D · l_s · F_es · k_3 / (1.6·(1+2·R_e))
//   Just use the simplified empirical NDS Table 12B value as a closed-form:
//     Z_parallel = 0.65 · D[mm] · t_main[mm] · F_em[MPa]   (Mode I_m)

#pragma once

namespace forge::boltedtimber {

struct Input {
    double boltDiameterMm;        // D
    double mainMemberThicknessMm; // t_m
    double sideMemberThicknessMm; // t_s
    double mainEmbedmentMPa;      // F_em (~38 MPa Douglas-Fir parallel)
    double sideEmbedmentMPa;      // F_es
    double loadDurationFactor;    // C_D = 1.0 normal, 1.6 wind, 2.0 impact
};

struct Result {
    double Z_mainMode_kN;          // Mode I_m
    double Z_sideMode_kN;          // Mode I_s
    double governingZ_kN;
    double adjustedZ_kN;           // Z · C_D
};

Result analyse(const Input& in);

}  // namespace forge::boltedtimber
