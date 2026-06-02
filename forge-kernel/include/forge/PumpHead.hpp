#pragma once

// Forge-229 — Pump head / pipe flow (Darcy-Weisbach + Bernoulli).
//
// For incompressible liquid flow in a single circular pipe:
//
//   V    = Q / (π D² / 4)                  (mean velocity)
//   Re   = ρ V D / μ
//   f    = 64 / Re                         (laminar, Re < 2300)
//        = (Swamee-Jain explicit, turbulent):
//          1/√f = −2 · log₁₀(ε/(3.7 D) + 5.74 / Re^0.9)
//   h_f  = f · (L/D) · V² / (2 g)          (Darcy-Weisbach friction head)
//   H    = staticHead + h_f                (total pump head)
//   P    = ρ g Q H / η                     (hydraulic power / efficiency)
//
// All inputs in SI: Q (m³/s), D (m), L (m), ε (m), ρ (kg/m³), μ
// (Pa·s), staticHead (m), η ∈ (0, 1].

namespace forge { namespace pumphead {

double reynoldsNumber(double meanVelocity, double diameter,
                      double density, double dynamicViscosity);

double swameeJainFrictionFactor(double Re, double diameter, double roughness);

double frictionFactor(double Re, double diameter, double roughness);

struct Inputs {
    double flowRate;          // Q, m³/s
    double diameter;          // D, m
    double pipeLength;        // L, m
    double roughness;         // ε, m
    double density;           // ρ, kg/m³
    double dynamicViscosity;  // μ, Pa·s
    double staticHead;        // m (elevation + pressure head delta)
    double pumpEfficiency;    // η
};

struct Outputs {
    double meanVelocity;      // m/s
    double reynolds;
    double frictionFactor;
    double frictionHead;      // m
    double totalHead;         // m (pump-developed)
    double hydraulicPower;    // W (ρ·g·Q·H_friction, ideal)
    double shaftPower;        // W (= ρ·g·Q·H_total / η)
};

Outputs analyse(const Inputs& in);

}} // namespace forge::pumphead
