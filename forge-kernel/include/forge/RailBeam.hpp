// Forge-330e — Rail beam-on-elastic-foundation (Zimmermann / Talbot, AREMA Ch 16).
//   Single wheel-load P on rail of bending stiffness EI on track of modulus u (N/m/m):
//     L_e  = (4·EI / u)^(1/4)               characteristic length
//     y_max = P / (2·L_e·u)                  rail deflection at load
//     M_max = P · L_e / 4                   bending moment at load
//     σ_max = M_max · c / I                  extreme-fibre stress at rail head/foot.

#pragma once

namespace forge::railbeam {

struct Input {
    double wheelLoad_kN;
    double railE_GPa;
    double railI_cm4;
    double railSectionModulusBase_cm3;       // S = I/c, base (or head) section modulus
    double trackModulus_MPaPerM;             // u, MN/m/m (per metre of rail)
};

struct Result {
    double characteristicLength_m;
    double maxRailDeflection_mm;
    double maxBendingMoment_kNm;
    double maxRailStress_MPa;
};

Result analyse(const Input& in);

}  // namespace forge::railbeam
