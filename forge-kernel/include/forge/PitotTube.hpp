// Forge-288 — Pitot tube velocity measurement (incompressible Bernoulli form).
//
// Used for HVAC duct traverse, wind-tunnel calibration, aircraft airspeed
// indication (with later Mach correction), open-water ship-speed logs, and
// any low-Mach flow measurement where the static-stagnation pressure
// difference can be observed.
//
//   v = C · √(2 · Δp / ρ)
//
//   Q = v · A             (volume flow rate)
//   ṁ = ρ · v · A         (mass flow rate)
//
// where:
//   Δp = p_stagnation − p_static  (dynamic / impact pressure) [Pa]
//   ρ   = fluid density           [kg/m³]
//   C   = Pitot probe coefficient (0.98–1.00 for well-aligned ASHRAE probes,
//                                  drops to ~0.6 for a poorly aligned probe)
//   A   = cross-sectional area for which Q and ṁ are reported [m²]
//
// Reports the dynamic-pressure head h_v = Δp / (ρ·g) (m of fluid column)
// as a sanity check (the kind a manometer reads directly).
//
// Compressibility note: for air at v > ~100 m/s (Ma > 0.3), use the
// compressible form  v = √( 2·c_p·T·((p_t/p_s)^((γ−1)/γ) − 1) )  — TBD
// in a future slice.

#pragma once

namespace forge::pitot {

struct Input {
    double dynamicPressurePa;     // Δp
    double densityKgM3;           // ρ
    double pitotCoefficient;      // C (1.0 ideal)
    double flowAreaM2;            // A — set 0 to skip Q/ṁ
};

struct Result {
    double velocityMs;
    double velocityHeadM;         // Δp / (ρ·g)
    double volumeFlowM3S;         // 0 when A = 0
    double massFlowKgS;           // 0 when A = 0
};

Result analyse(const Input& in);

}  // namespace forge::pitot
