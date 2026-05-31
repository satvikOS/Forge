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

#include <cstdint>
#include <vector>

namespace forge::fea {

struct Material {
    double E;   // Young's modulus  (Pa)
    double nu;  // Poisson ratio    (dimensionless)
    double rho; // density          (kg/m³)
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
    bool fx, fy, fz; // true → that translational DOF is fixed (zero displacement)
};

struct StaticResult {
    std::vector<double> u;          // 3N flat displacement (m)
    std::vector<double> vonMises;   // per element (Pa)
    double maxVonMises;             // Pa
    std::uint32_t maxAtElem;        // element index of max stress
    double residual;                // ‖Ku − f‖_∞ on the reduced system
};

struct ModalResult {
    std::vector<double> eigenvalues;                  // ω² (rad²/s²), nModes entries
    std::vector<std::vector<double>> eigenvectors;    // each 3N flat
    int nModes;
};

struct DynamicResult {
    std::vector<std::vector<double>> displacements; // [step][3N]
    std::vector<double> times;                       // length = steps+1 (including t=0)
    std::vector<double> maxStressEnvelope;           // per element (Pa) — max over time
    double cpuMs;                                    // wall-clock for the integration loop
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

ModalResult   solveModal  (const Mesh& m, const Material& mat,
                           const std::vector<BCPinned>& bcs,
                           int nModes);

DynamicResult solveDynamic(const Mesh& m, const Material& mat,
                           const std::vector<LoadNodal>& loads,
                           const std::vector<BCPinned>&  bcs,
                           double tEnd, double dt,
                           double rayleighAlpha, double rayleighBeta);

} // namespace forge::fea
