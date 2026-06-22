// forge/native/brep/MassProps.hpp
//
// In-house EXACT mass-properties on a native B-rep Solid for the Forge kernel
// (KERNEL_INHOUSE_ROADMAP Stage 6 brep/, the OCCT GProp replacement).
//
// ============================ HONESTY (Bible §0/§9) ========================
// Computes volume, centre of mass and the full inertia tensor about the COM of
// a closed brep::Solid via the DIVERGENCE (Gauss) theorem applied face by face:
//   * each volume moment  ∫_V f dV  is converted to a boundary integral
//     ∮_∂V F·n dA  with div F = f, then integrated over every Face's surface.
//   * PLANAR faces are integrated EXACTLY with closed-form polygon moment
//     formulas (Green's theorem on the trimmed polygon), so box/prism/wedge/
//     pyramid are bit-exact (to rounding).
//   * QUADRIC faces (cylinder/cone/sphere/torus) are integrated with tensor
//     GAUSS-LEGENDRE quadrature over their parameter trim window using the
//     analytic |S_u x S_v| Jacobian and the analytic normal — convergent to ~1e-12
//     for these low-degree integrands.
//
// The result matches the OCCT convention in forge/MassProps.hpp EXACTLY:
//   inertia ABOUT THE CENTRE OF MASS (Huygens-shifted from the origin moments),
//   symmetric, row-major inertiaCom[9]. Unit density (mass == volume).
//
// Pure C++20, ZERO external deps. No OCCT, no WASM.

#ifndef FORGE_NATIVE_BREP_MASSPROPS_HPP
#define FORGE_NATIVE_BREP_MASSPROPS_HPP

#include "forge/native/brep/Topology.hpp"

namespace forge {
namespace native {
namespace brep {

struct MassProps {
    double volume = 0.0;
    double area   = 0.0;
    double com[3] = {0, 0, 0};      // centre of mass
    double inertiaCom[9] = {0, 0, 0, 0, 0, 0, 0, 0, 0}; // about COM, row-major
};

// Compute the mass properties of a closed solid. `gaussN` is the 1-D Gauss order
// per parameter direction for quadric/NURBS faces (planar faces ignore it and
// use the exact polygon formula). The default 8 is exact-to-rounding for the
// canonical quadrics.
MassProps massProperties(const Solid& solid, int gaussN = 8);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_MASSPROPS_HPP
