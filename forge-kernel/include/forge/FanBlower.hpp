#pragma once

// Forge-231 — Fan / blower sizing (incompressible flow + affinity laws).
//
// For a centrifugal fan or blower:
//   V_outlet = Q / A_outlet
//   Δp_v   = ½ · ρ · V_outlet²              (velocity pressure)
//   Δp_t   = Δp_s + Δp_v                    (total pressure rise)
//   P_hyd  = Q · Δp_t                       (hydraulic / air power, W)
//   P_shaft= P_hyd / η                      (shaft power, W)
//
// Fan affinity laws (geometrically similar fan, same point of rating):
//   Q ∝ N
//   Δp ∝ N² · (ρ_2 / ρ_1)
//   P  ∝ N³ · (ρ_2 / ρ_1)
//
// All inputs SI: Q (m³/s), ρ (kg/m³), Δp (Pa), A (m²), N (any rate).

namespace forge { namespace fanblower {

struct SizeInputs {
    double flowRate;            // Q, m³/s
    double deltaPStatic;        // Δp_s, Pa
    double density;             // ρ, kg/m³
    double outletArea;          // A, m²
    double fanEfficiency;       // η ∈ (0, 1]
};

struct SizeOutputs {
    double velocityOutlet;      // m/s
    double velocityPressure;    // Pa
    double totalPressure;       // Pa
    double hydraulicPower;      // W (Q · Δp_t)
    double shaftPower;          // W (= hyd / η)
};

SizeOutputs analyse(const SizeInputs& in);

struct AffinityInputs {
    double Q1;                  // rated point
    double dP1;
    double P1;
    double N1;
    double rho1;
    double N2;                  // operating point
    double rho2;
};

struct AffinityOutputs {
    double Q2;
    double dP2;
    double P2;
};

AffinityOutputs scaleByAffinity(const AffinityInputs& in);

}} // namespace forge::fanblower
