// forge/native/voxel/Tpms.hpp
//
// Stage 5 (voxel / lattice), FIRST increment — TPMS level-set generator.
//
// SHIPPED + VALIDATED in this increment:
//   * The gyroid triply-periodic minimal surface (TPMS) scalar field:
//       g(x,y,z) = sin(kx) cos(ky) + sin(ky) cos(kz) + sin(kz) cos(kx)
//     where k = 2*pi / pitch maps one period to `pitch` world units.
//   * Thresholding the field into a solid via an iso value: the solid is the
//     level set { g <= iso }. iso = 0 gives the classic balanced gyroid; a
//     "double gyroid" sheet solid { |g| <= t } is also provided (TARGETED-tested
//     only lightly — see note).
//   * A helper to stamp the gyroid field into a VoxelGrid<float>.
//
// VALIDATED PROPERTIES (see Tpms_gate.cpp):
//   * Over an integer number of periods, the iso=0 gyroid has solid volume
//     fraction -> 0.5 (the field is antisymmetric under g -> -g across a
//     half-period shift, so {g<=0} and {g>0} are congruent => exactly half each
//     in the continuum; the discrete grid converges to 0.5 within tolerance).
//   * The iso=0 gyroid solid is a single connected component that percolates
//     all three axes (the gyroid network is famously bicontinuous).
//
// TARGETED (NOT here): Schwarz-P, Schwarz-D (diamond), Neovius, Fischer-Koch
// variants; graded/conformal pitch; sheet-thickness as a true offset distance
// (the |g|<=t band is an APPROXIMATION of a constant-thickness shell, not an
// exact signed-distance offset — flagged honestly).
//
// Pure C++20, standard library only. No external deps, no OCCT, no WASM.

#ifndef FORGE_NATIVE_VOXEL_TPMS_HPP
#define FORGE_NATIVE_VOXEL_TPMS_HPP

#include <cmath>
#include <functional>
#include "forge/native/voxel/VoxelGrid.hpp"

namespace forge {
namespace native {

// The gyroid implicit field. `pitch` is the world-space length of one period.
// At pitch = 2*pi the argument is just (x,y,z) and the field is the canonical
// unit-frequency gyroid.
inline double gyroidField(double x, double y, double z, double pitch) {
    const double k = 2.0 * M_PI / pitch;
    return std::sin(k * x) * std::cos(k * y)
         + std::sin(k * y) * std::cos(k * z)
         + std::sin(k * z) * std::cos(k * x);
}

// A callable field object (handy for VoxelGrid::fillFromField).
inline std::function<double(double, double, double)>
makeGyroidField(double pitch) {
    return [pitch](double x, double y, double z) {
        return gyroidField(x, y, z, pitch);
    };
}

// Sheet-solid field: |g| - t. The solid { |g| - t <= 0 } = { |g| <= t } is the
// region within `t` of the minimal surface (approximate constant-thickness
// shell). NOTE (honest): this band is NOT an exact signed-distance offset; for
// small t it approximates a wall of roughly-constant thickness. A true offset is
// a TARGETED morphology op (roadmap Morphology.cpp).
inline double gyroidSheetField(double x, double y, double z,
                               double pitch, double t) {
    return std::fabs(gyroidField(x, y, z, pitch)) - t;
}

// Stamp a gyroid field into a VoxelGrid<float> covering [0,cells*pitch_per...]
// Build a grid spanning `periods` periods per axis at `samplesPerPeriod`
// samples, then fill it with the gyroid field. The box spans exactly an integer
// number of periods so the volume-fraction gate sees a balanced field.
inline VoxelGrid<float> buildGyroidGrid(int periods, int samplesPerPeriod,
                                        double pitch = 2.0 * M_PI) {
    if (periods < 1) periods = 1;
    if (samplesPerPeriod < 2) samplesPerPeriod = 2;
    // nodes per axis: one extra node to close the last cell.
    std::size_t n = std::size_t(periods) * std::size_t(samplesPerPeriod) + 1;
    double spacing = pitch / double(samplesPerPeriod);
    Vec3 origin{0.0, 0.0, 0.0};
    VoxelGrid<float> g(n, n, n, origin, spacing);
    g.fillFromField(makeGyroidField(pitch));
    return g;
}

} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_TPMS_HPP
