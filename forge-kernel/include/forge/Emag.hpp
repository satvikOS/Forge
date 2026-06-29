// forge-kernel — native electromagnetic field solvers (Elmer-track E1)
//
// Forge's first native EM solver: 2D axisymmetric magnetostatics for the magnetic
// vector potential A_φ. In axisymmetry the vector potential has the single
// azimuthal component A_φ(r,z), so the curl-curl operator ∇×(ν ∇×A)=J collapses to
// the SCALAR elliptic operator
//
//     −∇·( (ν/r) ∇(r A_φ) ) = J_φ            (ν = 1/μ reluctivity)
//
// With the modified potential u = r·A_φ this is exactly −∇·(c∇u)=f over the r-z
// plane with coefficient c = ν/r and source f = J_φ. It is discretised on a
// structured r-z grid lifted to a thin Cartesian slab of 8-node hexes so the
// SHARED scalar-elliptic assembler (forge::native::fea::scalar_elliptic, the same
// kernel the thermal solver uses) is reused with coefficient c = ν/(T·r) on a
// slab of thickness T — the slab t-integration supplies the factor T so the
// effective r-z operator is exactly −∇·((ν/r)∇u) above (source s = J_φ/T; the 1/T
// cancels between K and f). The two slab node-layers tie to the same r-z DOF, which
// recovers the 2D axisymmetric quad operator exactly while reusing the 3D hex
// element math (HexElement.hpp) — no 2D shape functions are re-derived.
//
// Post-process B = ∇×A from nodal gradients:  B_r = −∂A_φ/∂z = −(1/r)∂u/∂z,
//                                             B_z = (1/r)∂(rA_φ)/∂r = (1/r)∂u/∂r.
// Far-field is handled by truncation: A_φ = 0 (u = 0) on the outer r/z boundary,
// and u = 0 on the axis (r=0) since A_φ is finite there.

#pragma once

#include <cstdint>
#include <vector>

namespace forge::em {

// An azimuthal-current coil region (axisymmetric rectangle in the r-z plane).
struct CoilRegion {
    double rLo = 0, rHi = 0;   // radial extent (m)
    double zLo = 0, zHi = 0;   // axial extent (m)
    double Jphi = 0;           // azimuthal current density J_φ (A/m²)
};

struct MagnetostaticsConfig {
    double rMax = 1.0;         // outer radial truncation boundary (m), r ∈ [0, rMax]
    double zMin = -1.0;        // axial domain bounds (m)
    double zMax =  1.0;
    int    nr   = 24;          // radial element count
    int    nz   = 120;         // axial element count
    double mu   = 1.25663706143591729e-6; // permeability (default μ₀); ν = 1/μ
    std::vector<CoilRegion> coils;         // current sources
};

struct MagnetostaticsResult {
    int nr = 0, nz = 0;                    // element grid dimensions
    // r-z node grid: (nr+1)*(nz+1) nodes, row-major as iz*(nr+1)+ir.
    std::vector<double> nodeR, nodeZ;      // node coords (m)
    std::vector<double> Aphi;              // nodal A_φ (Wb/m) [= u/r, 0 on axis]
    // Per-element (nr*nz, row-major iz*nr+ir) centroid field.
    std::vector<double> elemR, elemZ;      // element centroid (m)
    std::vector<double> Br, Bz, Bmag;      // centroid flux density (T)
    double energy   = 0.0;                 // total magnetic energy ½∫B·H dV (J)
    double residual = 0.0;                 // ‖K u − f‖∞ after BC application
};

// Solve axisymmetric magnetostatics for the given coils + domain. Throws
// std::runtime_error on a degenerate grid or a non-SPD assembled system.
MagnetostaticsResult magnetostatics(const MagnetostaticsConfig& cfg);

// ====================================================================
// Elmer-track E2 — electrostatics  −∇·(ε∇φ) = 0
// ====================================================================
//
// The electrostatic potential φ obeys the SAME scalar-elliptic operator the
// thermal/magnetostatic paths use, with coefficient c = ε (permittivity). For
// the three canonical capacitor geometries the field is one-dimensional in the
// separation/radial coordinate, so φ is solved on a 1-D chain of 8-node hexes
// (unit transverse slab, the two transverse node-layers tied to one DOF — the
// SAME tying trick the axisymmetric magnetostatics solver uses) assembled
// through forge::native::fea::scalar_elliptic::elementStiffnessVar with the
// geometry-weighted coefficient
//
//     planar       c(x) = ε            (Cartesian gap; φ linear)
//     cylindrical  c(x) = ε·r          (coaxial; −(rε φ')'=0 ⇒ φ ∝ ln(b/r))
//     spherical    c(x) = ε·r²         (sphere; −(r²ε φ')'=0 ⇒ φ ∝ 1/r)
//
// — exactly mirroring how the magnetostatic solver folds the axisymmetric 1/r
// weighting into c. The stored electrostatic energy is the FE-exact element
// energy W = geomFactor·½ Σ_e φ_eᵀ K_e φ_e (geomFactor = plate area A for
// planar, 2π·length for cylindrical [→ capacitance per unit length], 4π for
// spherical), and the capacitance follows from C = 2W/V².
enum class ElectroGeometry { Planar, Cylindrical, Spherical };

struct ElectrostaticsConfig {
    ElectroGeometry geometry = ElectroGeometry::Planar;
    double eps    = 8.8541878128e-12; // permittivity (F/m); default ε₀
    double rInner = 0.0;              // inner coord: planar 0, coax a, sphere R
    double rOuter = 1.0;              // outer coord: planar d, coax b, sphere R_out
    double V      = 1.0;             // applied potential (inner = V, outer = 0)
    int    n      = 400;             // radial/gap element count
    double area   = 1.0;            // planar plate area A (m²) — planar only
    double length = 1.0;            // axial length (m) — cylindrical only (C per this length)
};

struct ElectrostaticsResult {
    int n = 0;
    std::vector<double> nodeR;   // (n+1) node coordinate along the gap/radius (m)
    std::vector<double> phi;     // (n+1) nodal potential (V)
    std::vector<double> elemR;   // (n) element-centroid coordinate (m)
    std::vector<double> Efield;  // (n) field magnitude |E| = |dφ/dr| at centroid (V/m)
    double energy      = 0.0;    // electrostatic energy W = ½∫ε|∇φ|² dV (J)
    double capacitance = 0.0;    // C = 2W/V² (F)
    double residual    = 0.0;    // ‖K φ − f‖∞ after BC application
};

// Solve electrostatics for the chosen capacitor geometry. Throws
// std::invalid_argument on a degenerate config and std::runtime_error on a
// non-SPD assembled system.
ElectrostaticsResult electrostatics(const ElectrostaticsConfig& cfg);

// ====================================================================
// Elmer-track E3 — current conduction + Joule→thermal coupling
// ====================================================================
//
// Forge's FIRST native multiphysics coupling. On a structured hex bar the
// electric potential V is solved from the steady current-conservation law
//     −∇·(σ∇V) = 0          (σ = electrical conductivity)
// which is the SAME scalar-elliptic operator with c = σ — so it is solved by
// REUSING forge::fea::solveThermal with k := σ (no new Laplacian). The recovered
// current density magnitude |J| = σ|∇V| gives the volumetric Joule source
//     q''' = σ|∇V|² = |J|²/σ      (W/m³)
// per element, which is INJECTED as a ThermalElemSource into the SAME
// forge::fea::solveThermal (now with k = thermal conductivity) to obtain the
// coupled temperature field — a one-way V→q→T staggered coupling that leaves the
// thermal solver byte-for-byte unchanged (it already supports element sources).
struct CurrentConductionConfig {
    double Lx = 0.10, Ly = 0.01, Lz = 0.01; // bar dimensions (m); current flows ∥ x
    int    nx = 40, ny = 4, nz = 4;          // element counts per axis
    double sigma = 1.0e7;                    // electrical conductivity (S/m)
    double V     = 1.0;                      // applied voltage (x=0 → V, x=Lx → 0)
    double k     = 50.0;                     // thermal conductivity (W/(m·K))
    double T0    = 0.0;                      // fixed end temperature at x=0 and x=Lx
};

struct CurrentConductionResult {
    int nNodes = 0, nElems = 0;
    std::vector<double> nodeX, nodeY, nodeZ; // node coords (m)
    std::vector<double> V;                    // nodal potential (V)
    std::vector<double> Jmag;                 // per-element |J| = σ|∇V| (A/m²)
    std::vector<double> joule;                // per-element q''' = σ|∇V|² (W/m³)
    std::vector<double> T;                    // nodal temperature (coupled) (°C/K)
    double elemVol     = 0.0;                 // uniform element volume (m³)
    double dissipation = 0.0;                 // ∫σ|∇V|² dV (W)
    double resistance  = 0.0;                 // R = L/(σA) (Ω)
    double current     = 0.0;                 // I = V/R (A)
    double maxT = 0.0, minT = 0.0;            // coupled temperature extremes
    double residualV = 0.0, residualT = 0.0;  // solver residuals
};

// Solve current conduction in the bar and the coupled Joule-heated temperature.
// Throws std::invalid_argument on a degenerate config.
CurrentConductionResult currentConduction(const CurrentConductionConfig& cfg);

// ====================================================================
// Elmer-track E4 — transient eddy-current / magnetic diffusion (skin effect)
// ====================================================================
//
// Forge's FIRST native TRANSIENT EM solver. The magnetic-diffusion equation for
// the flux density B in a conductor exposed to a time-varying surface field,
//     ∂B/∂t = (1/(μσ))∇²B          (σ ∂B/∂t = (1/μ)∇²B),
// is the SAME parabolic operator the TRANSIENT-THERMAL solver assembles
// (ρc ∂T/∂t = ∇·(k∇T)) under the EM substitution conductance k:=ν=1/μ (the E1
// magnetostatic reluctivity) and capacitance ρc:=σ (the E3 conductivity), giving
// the magnetic diffusivity α=k/ρc=1/(μσ). It is therefore solved by REUSING
// forge::native::fea::transient_thermal verbatim — assembleKC (K=∫ν∇N∇N,
// C=∫σ NN) and the backward-Euler ThetaThermalIntegrator (A=C/Δt+K factored ONCE,
// factor-once/solve-many) — the ONLY new ingredient being a time-varying Dirichlet
// surface BC B(0,t)=B0·cos(ωt) applied through ThetaThermalIntegrator::stepBC.
// See forge/native/em/MagneticDiffusion.hpp for the solver; this is the thin
// .node adapter onto forge::native::em::solveSkinEffect.
//
// Known answer (semi-infinite conductor): B(x,t)≈B0·e^{−x/δ}·cos(ωt−x/δ),
// skin depth δ=√(2/(μσω)). The result carries the analytic δ and the δ fitted
// from BOTH the amplitude decay (−ln(A/B0)=x/δ) and the phase lag (φ=x/δ).
struct MagneticDiffusionConfig {
    double L     = 0.0;        // conductor depth modelled (m); ≤0 ⇒ default 8δ
    int    N     = 80;         // elements through the depth
    double mu    = 1.25663706143591729e-6; // permeability (default μ₀)
    double sigma = 5.8e7;      // electrical conductivity (S/m) (default copper)
    double freq  = 1000.0;     // surface-field frequency (Hz); ω = 2πf
    double B0    = 1.0;        // surface field amplitude (T)
    int    stepsPerPeriod  = 160;  // backward-Euler steps per AC period
    int    periodsToSteady = 20;   // periods marched to sinusoidal steady state
};

struct MagneticDiffusionResult {
    double skinDepth      = 0.0;   // analytic δ = √(2/(μσω)) (m)
    double skinDepthAmp   = 0.0;   // δ fitted from the amplitude decay e^{−x/δ}
    double skinDepthPhase = 0.0;   // δ fitted from the phase lag x/δ
    double dt = 0.0;               // backward-Euler step (s)
    int    nSteps = 0;             // total steps marched (steady + measurement)
    std::vector<double> depth;     // sample depths x (m)
    std::vector<double> ampNum, ampAna;     // |B|(x): measured / analytic B0 e^{−x/δ}
    std::vector<double> phaseNum, phaseAna; // phase lag (rad): measured / analytic x/δ
    bool   ok = false;             // backward-Euler operator factorised (SPD)
};

// Solve transient magnetic diffusion (skin effect) for the sinusoidal surface
// field and recover δ from amplitude + phase. Throws std::invalid_argument on a
// degenerate config (N<2, or non-positive μ/σ/freq).
MagneticDiffusionResult magneticDiffusion(const MagneticDiffusionConfig& cfg);

} // namespace forge::em
