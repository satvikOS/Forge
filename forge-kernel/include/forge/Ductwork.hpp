#pragma once

// Forge-186 — HVAC ductwork sizing + pressure-drop analysis.
//
// Per-segment analysis of an air-distribution route. Supports:
//
//   * Round and rectangular straight runs.
//   * 90° / 45° / 22.5° elbows (radius-ratio K factors).
//   * Round ↔ rectangular transitions.
//   * Straight-through and branch tees.
//
// Per segment we compute:
//   * Cross-sectional area A.
//   * Velocity V = Q / A.
//   * Reynolds Re = V·Dh / ν.
//   * Friction factor f (Swamee-Jain explicit Colebrook-White).
//   * Friction drop ΔP_f = f·(L/Dh)·ρ·V²/2.
//   * Fitting drop ΔP_K = K·ρ·V²/2.
//
// Equivalent diameter for rectangular ducts (ASHRAE 2017 Ch 21):
//   De = 1.30·(a·b)^0.625 / (a + b)^0.25
//
// Default standard-air properties (20 °C, 101.325 kPa):
//   ρ = 1.204 kg/m³,  ν = 1.516e-5 m²/s,  ε = 0.09 mm (galvanised steel).

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace duct {

enum class SegKind : std::uint8_t {
    RoundRun        = 0,
    RectRun         = 1,
    Elbow90         = 2,
    Elbow45         = 3,
    Elbow22         = 4,
    TransRoundRect  = 5,
    TeeStraight     = 6,
    TeeBranch       = 7,
};

struct Segment {
    SegKind kind;
    // Common geometry — interpretation varies per kind.
    double diameterMm;     // round run / elbow on round
    double widthMm;        // rect run / elbow on rect
    double heightMm;       // rect run / elbow on rect
    double lengthM;        // straight runs only
    double rOverD;         // elbow centreline-radius / diameter (1.0 std)
};

struct DuctAir {
    double rhoKgM3;        // air density
    double nuM2s;          // kinematic viscosity
    double epsilonMm;      // wall roughness (galvanised ≈ 0.09)
};

struct DuctInputs {
    std::vector<Segment> route;
    double               flowRateM3s;   // volumetric flow
    DuctAir              air;
};

struct SegResult {
    SegKind kind;
    double  hydraulicDiameterMm;
    double  areaMm2;
    double  velocityMs;
    double  reynolds;
    double  frictionFactor;
    double  lossCoefficientK;
    double  frictionDropPa;
    double  fittingDropPa;
    double  totalDropPa;
    double  lengthM;
};

struct DuctResult {
    std::vector<SegResult> segments;
    double totalDropPa;
    double maxVelocityMs;
    double totalLengthM;
};

DuctResult compute(const DuctInputs& in);

// ASHRAE friction-rate sizing helper: given Q (m³/s), pick a round
// diameter (mm) that achieves a target frictional gradient ΔP/L (Pa/m).
// Iterative bisection on D ∈ [50, 1500] mm.
double sizeRoundForFriction(double flowM3s, double targetPaPerM, const DuctAir& air);

}} // namespace forge::duct
