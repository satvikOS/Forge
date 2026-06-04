// Forge-328a — Curtain-wall mullion deflection (AAMA / IBC §2403.3).
//   Simply supported under uniform wind load:
//     δ_max = 5·w·L⁴ / (384·E·I)
//   Limit: L/175 typical (AAMA TIR-A11).

#pragma once

namespace forge::mullion {

struct Input {
    double spanLengthMm;            // L
    double windPressureKnM2;         // w_in
    double tributaryWidthMm;         // half-bay width either side
    double E_MPa;                    // aluminium 70000, steel 200000
    double momentOfInertiaMm4;       // I
    double deflectionLimitDivisor;   // 175 typ
};

struct Result {
    double linearLoadKnPerM;
    double midspanDeflectionMm;
    double deflectionLimitMm;
    bool   passes;
};

Result analyse(const Input& in);

}  // namespace forge::mullion
