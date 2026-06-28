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

} // namespace forge::em
