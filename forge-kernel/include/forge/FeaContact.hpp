#pragma once

// Forge-31 — three remaining §5 Simulation rows:
//
//   * solveBuckling          — linearised Euler buckling on the hex-grid mesh.
//                              First solves a small static problem under the
//                              user-supplied axial pre-load to obtain the
//                              element stress field, then assembles the
//                              geometric stress stiffness K_g and solves the
//                              symmetric generalised eigenproblem
//                                  (K + λ K_g) φ = 0
//                              for the lowest `nModes` eigenvalues. The first
//                              eigenvalue is the critical load factor —
//                              multiply the supplied pre-load by it to obtain
//                              the absolute critical load.
//
//   * solveContact           — penalty-method node-to-surface contact between
//                              two brick meshes A and B. The caller supplies
//                              a list of contact pairs `{nodeA, faceB}` where
//                              `faceB ∈ {0..5}` is one of B's AABB faces.
//                              Each iteration assembles the global stiffness
//                              for the merged-DOF system, adds
//                                  K += Σ α (N N^T)
//                              for every currently active pair (active set
//                              detected from the sign of the gap), and solves
//                              for the merged displacement vector. Iteration
//                              continues until the active set stabilises.
//
//   * solveNonlinearPlastic  — material-nonlinear Newton step using J2
//                              plasticity with linear isotropic hardening.
//                              Element strain → trial stress → radial-return
//                              update of the back-projection onto the yield
//                              surface. Returns per-step displacement and
//                              plastic-strain fields.
//
// Honest scope notes:
//   * The hex-grid mesher is the coarse brick fallback from Forge-12. K_g for
//     buckling uses the constant-stress approximation per element (σ taken
//     at the element centroid). Critical load factor for the steel cantilever
//     smoke comes within ±20 % of the Euler P_cr = π² E I / (2 L)² for the
//     fixed-free column, which is the slice target.
//   * Penalty contact on a brick-grid pair is rough — the prescribed coarse-
//     but-stable α uses an automatic scaling based on the diagonal of K so
//     active-set iteration converges in a handful of passes; convergence
//     rate is logged in the smoke output.
//   * Plasticity is small-strain rate-independent J2 with isotropic linear
//     hardening (no kinematic hardening, no rate effects). The Newton tangent
//     uses the consistent elasto-plastic tangent (the algorithmic D^ep) per
//     Simo & Hughes (1998), §3.5.

#include "forge/Fea.hpp"

#include <cstdint>
#include <vector>

namespace forge::fea {

// ---- buckling -------------------------------------------------------------

struct BucklingResult {
    std::vector<double>              loadFactors;  // length = requested nModes
    std::vector<std::vector<double>> modes;        // each 3N flat
    double                           firstCriticalLoad = 0; // axialPreload × λ₁
    int                              nModes = 0;
    double                           cpuMs = 0;
};

// `axialPreload` is the magnitude (N) of the axial pre-load — the smoke
// applies it as a compressive force distributed across the +X tip face. The
// load direction must be embedded in `staticLoads` (so caller controls the
// sign convention). Returns the eigenvalue λ such that P_cr = λ · |preload|.
BucklingResult solveBuckling(const Mesh& mesh, const Material& mat,
                             const std::vector<LoadNodal>& staticLoads,
                             const std::vector<BCPinned>&  bcs,
                             int nModes);

// ---- contact --------------------------------------------------------------

struct ContactPair {
    std::uint32_t nodeA;   // node id in mesh A (slave point)
    std::uint32_t faceB;   // AABB face id of mesh B (master surface). 0..5
};

struct ContactResult {
    std::vector<double> uA;              // displacements of mesh A (3 * nNodesA)
    std::vector<double> uB;              // displacements of mesh B (3 * nNodesB)
    std::vector<double> contactPressure; // per supplied pair (Pa)
    int    iterations = 0;
    double penaltyUsed = 0;              // final penalty α
    bool   converged = true;
    double cpuMs = 0;
};

// `normalPenalty` may be 0 → auto-scale from diag(K_AA). Otherwise the
// caller-provided value is used verbatim. `loadsA` / `loadsB` / `bcsA` /
// `bcsB` apply to each body's own DOF numbering; the kernel internally
// re-indexes B's DOFs to live above A's so they share one global vector.
ContactResult solveContact(const Mesh& meshA, const Mesh& meshB,
                           const Material& mat,
                           const std::vector<LoadNodal>& loadsA,
                           const std::vector<LoadNodal>& loadsB,
                           const std::vector<BCPinned>&  bcsA,
                           const std::vector<BCPinned>&  bcsB,
                           const std::vector<ContactPair>& contactPairs,
                           double normalPenalty);

// ---- plasticity -----------------------------------------------------------

struct PlasticMaterial {
    double E;        // Young's modulus  (Pa)
    double nu;       // Poisson ratio
    double rho;      // density          (kg/m³)
    double sigmaY;   // initial yield stress (Pa)
    double hardening;// linear isotropic hardening modulus H (Pa)
};

struct PlasticResult {
    std::vector<std::vector<double>> stepDisplacements; // [step][3N]
    std::vector<std::vector<double>> stepPlasticStrain; // [step][nElem] — equivalent plastic strain
    std::vector<std::vector<double>> stepStress;        // [step][nElem] — von-Mises (Pa)
    std::vector<int>                 stepIterations;    // Newton iters
    std::vector<double>              stepResiduals;     // last ‖r‖ / ‖f‖
    bool                             converged = true;
    double                           cpuMs = 0;
};

// Drives an elastic-plastic Newton loop in `loadSteps` even sub-increments.
// At each step it recovers strain → trial stress → if outside the yield
// surface, radial-return projection + plastic-strain increment update +
// consistent elasto-plastic tangent (Simo & Hughes Box 3.2). The history
// variable is the equivalent plastic strain ε_p; isotropic hardening means
// σ_Y(ε_p) = σ_Y0 + H ε_p.
PlasticResult solveNonlinearPlastic(const Mesh& mesh,
                                    const PlasticMaterial& mat,
                                    const std::vector<LoadNodal>& loads,
                                    const std::vector<BCPinned>&  bcs,
                                    int loadSteps);

} // namespace forge::fea
