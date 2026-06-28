#pragma once

// Forge-12 — Native FEA solvers: linear static + modal + dynamic (Newmark-β).
//
// Scope and honest simplifications for this slice:
//   * Element: 8-node linear hexahedron (constant-strain brick) on a
//     boundary-clipped axis-aligned grid mesh. The task spec sketched a
//     constant-strain tetrahedron + Delaunay refinement; that mesher is a
//     full-slice project of its own. The authorised fallback is "hex/8-node
//     brick on a regular grid clipped to the shape's AABB and inside-tested
//     via BRepClass3d_SolidClassifier". That's what `meshFromBRep()` does.
//     A follow-up slice can replace the mesher without touching the solver.
//
//   * `Mesh::tets` despite the name carries 8 indices per cell — we keep
//     the name to match the spec header and avoid breaking the agreed
//     binding. Each element therefore occupies `tets[8*i .. 8*i+7]` and the
//     mesh's `elemNodeCount` reports 8 so callers can iterate honestly.
//
//   * Static solve: SimplicialLDLT on the assembled K, with pinned DOFs
//     eliminated by row/column zeroing + diagonal-1 substitution.
//   * Modal solve: a small dense GeneralisedSelfAdjointEigenSolver. Eigen's
//     sparse path through Spectra/ARPACK is out of scope for the kernel;
//     the dense fallback works comfortably up to ~1500 DOFs, which is more
//     than enough for the cantilever smoke (~300 DOFs).
//   * Dynamic solve: Newmark-β with β=1/4, γ=1/2 (unconditionally stable
//     constant-average-acceleration). The effective system matrix
//     M + γΔt·C + βΔt²·K is factored exactly once per call so every
//     subsequent step is just a forward / back substitution.
//
// All quantities are in SI (length=m, mass=kg, time=s, force=N). The smoke
// scales millimetre cantilever dimensions to metres before feeding the
// solver.

#include "forge/ShapeRegistry.hpp"

#include <array>
#include <cstdint>
#include <vector>

namespace forge::fea {

struct Material {
    double E;   // Young's modulus  (Pa)
    double nu;  // Poisson ratio    (dimensionless)
    double rho; // density          (kg/m³)
    double alpha = 0.0; // Inc1c: coefficient of thermal expansion (1/K); 0 ⇒ no thermoelastic
};

struct LoadNodal {
    std::uint32_t nodeId;
    double fx, fy, fz; // N
};

struct LoadPressure {
    std::uint32_t faceId; // 0..5 brick AABB faces: 0=-X,1=+X,2=-Y,3=+Y,4=-Z,5=+Z
    double pressure;       // Pa (positive = outward; converted to equivalent nodal loads)
};

struct BCPinned {
    std::uint32_t nodeId;
    bool fx, fy, fz; // true → that translational DOF is constrained
    // Inc1c — general BCs. Each constrained DOF takes a PRESCRIBED displacement
    // value (default 0 ⇒ classic homogeneous pin; non-zero ⇒ enforced motion;
    // a single-axis fix with value 0 expresses a SYMMETRY plane = zero normal
    // component on an axis-aligned face). Node-set selection (by source-BRep
    // face id via mesh.nodeToFace, or a geometric predicate) is done caller-side.
    double ux = 0.0, uy = 0.0, uz = 0.0;
};

struct StaticResult {
    std::vector<double> u;          // 3N flat displacement (m)
    std::vector<double> vonMises;   // per element (Pa)
    double maxVonMises;             // Pa
    std::uint32_t maxAtElem;        // element index of max stress
    double residual;                // ‖Ku − f‖_∞ on the reduced system
    // Inc1b — full Cauchy stress tensor + principal stresses, per-element AND
    // nodal-recovered (unweighted average of incident-element stresses), so a
    // NAFEMS probe point reads a real σ_yy/σ_zz. Voigt order {sxx,syy,szz,sxy,syz,szx}.
    std::vector<std::array<double, 6>> elemStress;     // per element, Pa
    std::vector<std::array<double, 3>> elemPrincipal;  // per element {s1≥s2≥s3}, Pa
    std::vector<std::array<double, 6>> nodalStress;     // per node, Pa
    std::vector<std::array<double, 3>> nodalPrincipal;  // per node {s1≥s2≥s3}, Pa
    std::vector<double>                nodalVonMises;   // per node, Pa
};

struct ModalResult {
    std::vector<double> eigenvalues;                  // ω² (rad²/s²), nModes entries
    std::vector<std::vector<double>> eigenvectors;    // each 3N flat
    int nModes;
};

struct DynamicResult {
    std::vector<std::vector<double>> displacements; // [step][3N]
    std::vector<std::vector<double>> velocities;    // [step][3N] — same cadence as displacements
    std::vector<double> times;                       // length = steps+1 (including t=0)
    std::vector<double> maxStressEnvelope;           // per element (Pa) — max over time
    std::vector<double> maxDisp;                      // per step: max |nodal displacement| (m)
    std::vector<double> kineticEnergy;                // per step: ½ u̇ᵀ M u̇ (J)
    std::vector<double> potentialEnergy;              // per step: ½ uᵀ K u (J)
    std::vector<double> totalEnergy;                  // per step: KE + PE (J)
    double cpuMs;                                    // wall-clock for the integration loop
};

// Optional configuration for the transient solver. The defaults reproduce the
// historical behaviour exactly: zero initial conditions, lumped mass.
//   * u0 / v0: initial nodal displacement / velocity (3N flat). Empty ⇒ zero.
//     A pinned DOF entry is forced to zero regardless of what is supplied.
//   * useConsistentMass: when true the Newmark integrator uses the SAME
//     consistent mass M = ρ∫NᵀN dV the modal solver uses, so a transient
//     period matches the modal frequency (used by the energy / cantilever
//     period validation gates). When false (default) the lumped ρV/8 diagonal
//     is used, preserving the legacy fast path.
struct DynamicOptions {
    std::vector<double> u0;             // size 0 or 3N
    std::vector<double> v0;             // size 0 or 3N
    bool useConsistentMass = false;
};

struct Mesh {
    std::vector<double>        nodes;      // 3N flat (m)
    std::vector<std::uint32_t> tets;       // see header note — 8 indices / hex
    std::vector<std::uint32_t> nodeToFace; // per node: bitfield of AABB faces it sits on
    std::uint32_t              elemNodeCount = 8; // 8 for hex
};

// ---- mesh extraction ----
//
// Builds an axis-aligned hex grid clipped to the shape's bounding box,
// keeping only voxels whose centroid lies inside the solid (via OCCT's
// BRepClass3d_SolidClassifier). `targetElemSize` is the desired voxel edge
// length in metres — the actual size snaps to the nearest divisor of the
// bounding box's longest axis so the mesh stays consistent across AABB
// faces. The output nodes are unique (no duplicates across shared faces).
//
// Note: target sizes giving fewer than 1 element per axis are clamped to 1.
Mesh meshFromBRep(ShapeHandle h, double targetElemSize);

// ---- solvers ----
StaticResult  solveStatic (const Mesh& m, const Material& mat,
                           const std::vector<LoadNodal>&    loads,
                           const std::vector<LoadPressure>& pressureLoads,
                           const std::vector<BCPinned>&     bcs);

// Inc1c — thermoelastic overload. `nodeDeltaT` is the per-node temperature rise
// ΔT (size nNodes, or empty for the isothermal case). Each element forms a
// constant initial strain ε₀ = α·ΔT̄ₑ·[1,1,1,0,0,0] (α = mat.alpha), assembled
// into an equivalent nodal load f_th = ∫ Bᵀ D ε₀ dV; the recovered stress is the
// true σ = D·(ε − ε₀). The 5-arg form above forwards here with an empty ΔT.
StaticResult  solveStatic (const Mesh& m, const Material& mat,
                           const std::vector<LoadNodal>&    loads,
                           const std::vector<LoadPressure>& pressureLoads,
                           const std::vector<BCPinned>&     bcs,
                           const std::vector<double>&       nodeDeltaT);

ModalResult   solveModal  (const Mesh& m, const Material& mat,
                           const std::vector<BCPinned>& bcs,
                           int nModes);

DynamicResult solveDynamic(const Mesh& m, const Material& mat,
                           const std::vector<LoadNodal>& loads,
                           const std::vector<BCPinned>&  bcs,
                           double tEnd, double dt,
                           double rayleighAlpha, double rayleighBeta);

// Overload with explicit initial conditions / mass choice. The 8-argument
// form above forwards to this with default options.
DynamicResult solveDynamic(const Mesh& m, const Material& mat,
                           const std::vector<LoadNodal>& loads,
                           const std::vector<BCPinned>&  bcs,
                           double tEnd, double dt,
                           double rayleighAlpha, double rayleighBeta,
                           const DynamicOptions& opts);

// =====================================================================
// Forge-12b additions: steady thermal, nonlinear-geometric static,
// fatigue life from a stress history.
// =====================================================================

// ---- steady thermal ------------------------------------------------------
//
// Solves ∇·(k ∇T) = q on the same hex mesh used by solveStatic.
// Element K-matrix is the standard 3D conduction stiffness on the 8-node
// linear hex; element heat source is lumped equally to corner nodes; convective
// BCs are applied face-by-face with the standard Robin condition
// (k ∂T/∂n + h (T − T∞) = 0). Dirichlet temperatures are imposed by row/col
// elimination as in the structural path.
struct ThermalMaterial {
    double k; // thermal conductivity (W/(m·K))
};
struct ThermalNodalT {
    std::uint32_t nodeId;
    double        T; // K (or °C — only the difference matters in steady)
};
struct ThermalElemSource {
    std::uint32_t elemId;
    double        q; // volumetric source W/m³
};
struct ThermalConvection {
    std::uint32_t faceId;   // 0..5 AABB face id
    double        h;        // convective coefficient (W/(m²·K))
    double        Tinf;     // ambient temperature
};
struct ThermalResult {
    std::vector<double> T;           // nodal temperatures
    std::vector<double> elemFluxMag; // per element |q| (W/m²)
    double maxT = 0;
    double minT = 0;
    double residual = 0;
};
ThermalResult solveThermal(const Mesh& m, const ThermalMaterial& mat,
                           const std::vector<ThermalNodalT>&     dirichlet,
                           const std::vector<ThermalElemSource>& sources,
                           const std::vector<ThermalConvection>& convection);

// ---- nonlinear static (geometric only) -----------------------------------
//
// Newton-Raphson over geometric nonlinearity using the updated Lagrangian
// formulation truncated to total-Lagrangian first order:
//   K_T(u) = K_L + K_σ(σ(u))   (material + geometric tangent)
//   residual r(u) = K_L u − f_ext − f_int_correction
// where f_int_correction comes from the second-order strain term. We solve
// f_ext at each load step in `loadSteps` sub-increments, updating K_T each
// Newton iteration. Convergence is measured on the relative norm of the
// out-of-balance force ‖r‖ / ‖f_ext‖.
//
// Honest scope: material nonlinearity (plasticity / hyperelasticity) is
// queued for a follow-up slice — the current implementation includes
// geometric softening only.
struct NonlinearConfig {
    int    loadSteps     = 5;
    int    maxNewton     = 20;
    double residualTol   = 1e-3;  // ‖r‖ / ‖f_ext‖
};
struct NonlinearResult {
    std::vector<std::vector<double>> stepDisplacements; // [step][3N]
    std::vector<double>              stepResiduals;     // last ‖r‖ / ‖f‖ per step
    std::vector<int>                 stepIterations;    // Newton iters used per step
    bool                             converged = true;
    double                           cpuMs = 0;
};
NonlinearResult solveNonlinearStatic(const Mesh& m, const Material& mat,
                                     const std::vector<LoadNodal>& loads,
                                     const std::vector<BCPinned>&  bcs,
                                     const NonlinearConfig& cfg);

// ---- fatigue life --------------------------------------------------------
//
// Inputs:
//   stressHistory  — flat array, [nElem * nSteps] storing scalar stress
//                    amplitude per element per time step (use von-Mises or
//                    principal). For sinusoidal loading at frequency f, just
//                    pass two columns (min, max) and `cyclesPerSample = 1`.
//   sn             — { N: [...], S: [...] } sorted by N ascending. Stress
//                    units = Pa; cycles = dimensionless.
//   meanCorrection — kGoodman | kSoderberg | kNone.
//   ultimateStress / yieldStress — required for Goodman / Soderberg.
//   cyclesPerSample — multiplier for cycle counts (sinusoidal: 1 per pair).
//
// Returns per-element cycles-to-failure (Inf if below endurance, 0 if
// already failed) plus the worst-case element id.
enum MeanStressCorrection : int {
    kNone      = 0,
    kGoodman   = 1,
    kSoderberg = 2,
};
struct SNCurve {
    std::vector<double> N;
    std::vector<double> S;
};
struct FatigueConfig {
    SNCurve sn;
    int     meanCorrection = kNone;
    double  ultimateStress = 0;
    double  yieldStress    = 0;
    double  cyclesPerSample = 1.0;
};
struct FatigueResult {
    std::vector<double> cyclesToFailure; // per element
    double minLife       = 0;            // min over all elements
    std::uint32_t minLifeElem = 0;
    double maxAmplitude  = 0;            // worst per-element stress amplitude (Pa)
};
FatigueResult fatigueLife(const std::vector<double>& stressHistory,
                          std::size_t nElem, std::size_t nSteps,
                          const FatigueConfig& cfg);

} // namespace forge::fea
