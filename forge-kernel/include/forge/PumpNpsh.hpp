// Forge-273 — Pump NPSH-available (Hydraulic Institute ANSI/HI 9.6).
//
// Net Positive Suction Head Available (NPSH_A) for a centrifugal pump:
//
//   NPSH_A = (p_atm − p_v) / (ρ · g)  +  z_s  −  h_f
//
// where (SI throughout):
//   p_atm  = atmospheric pressure at pump elevation [Pa]
//   p_v    = vapour pressure of pumped fluid at operating T [Pa]
//   ρ      = density of pumped fluid [kg/m³]
//   g      = 9.806 65 m/s²
//   z_s    = static suction head [m]; positive when the source liquid
//            surface is ABOVE the pump centreline (flooded suction),
//            negative when it sits below (suction lift)
//   h_f    = total friction head loss in the suction piping [m]
//
// Compare NPSH_A to the pump's NPSH_R (required, from manufacturer's
// curve). Hydraulic Institute recommends a margin of at least 1 m or
// 1.1 × NPSH_R, whichever is greater. We surface:
//
//   margin     = NPSH_A − NPSH_R                (m)
//   marginPct  = (NPSH_A − NPSH_R) / NPSH_R · 100   (%)
//   cavitating = NPSH_A ≤ NPSH_R
//   marginal   = NPSH_A < 1.1 · NPSH_R OR margin < 1.0 m (HI guidance)

#pragma once

namespace forge::pumpnpsh {

struct Input {
    double atmosphericPressurePa;     // p_atm
    double vapourPressurePa;          // p_v
    double densityKgM3;               // ρ
    double staticSuctionHeadM;        // z_s (signed; flooded > 0)
    double frictionHeadM;             // h_f (always ≥ 0)
    double requiredNpshM;             // NPSH_R (pump curve, ≥ 0)
};

struct Result {
    double pressureHeadM;             // (p_atm − p_v) / (ρ·g)
    double availableNpshM;            // NPSH_A
    double marginM;                   // NPSH_A − NPSH_R
    double marginPct;                 // 100·(NPSH_A−NPSH_R)/NPSH_R
    bool   cavitating;
    bool   marginalPerHi;
};

Result analyse(const Input& in);

}  // namespace forge::pumpnpsh
