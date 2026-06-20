// forge/native/implicit/IsoMesher.hpp
//
// In-house marching-cubes isosurface mesher — Stage 4 of
// KERNEL_INHOUSE_ROADMAP.md. Extracts the zero-isosurface {f = 0} of an Sdf
// over a regular grid using the classic Lorensen-Cline marching-cubes
// edge/triangle tables.
//
// ALGORITHM (standard marching cubes)
// -----------------------------------
//  1. Sample the SDF at every grid vertex of an Nx*Ny*Nz lattice covering an
//     axis-aligned bounding box.
//  2. For each cell (8 corners), build an 8-bit index from the sign of f at
//     each corner (bit set if f < isovalue, i.e. INSIDE).
//  3. edgeTable[index] tells which of the 12 cube edges the surface crosses.
//  4. On each crossed edge, place a vertex by LINEAR interpolation of f between
//     the two corners (root of the linear field on that edge).
//  5. triTable[index] lists the triangles (as edge triples) for that case.
//
// The output is an indexed triangle soup (positions + triangle indices). The
// roadmap's eventual target is a HalfEdgeMesh (Stage 2); this first increment
// emits a plain Mesh so the implicit class can be validated independently of
// the (parallel) mesh class. Marking the HalfEdgeMesh hand-off TARGETED.
//
// HONESTY: marching cubes is a SAMPLING method. The reconstructed surface has
// chordal/iso error O(h^2) in the cell size h, and sharp features are softened
// at low resolution (the roadmap notes dual contouring as the future fix —
// TARGETED). The validation gate MEASURES that the meshed-sphere volume
// converges to 4/3·π·r^3 as h shrinks; it never claims an exact surface.
//
// The standard Lorensen-Cline marching-cubes tables are a well-known public
// lookup table (the geometry of the 256 cube cases / 15 base configurations).
// We embed our own copy here; it is data, not third-party source code.
//
// RELATIONSHIP TO forge::native::Predicates (the parallel build):
//   Marching cubes is a SAMPLING mesher. Its only combinatorial decision is the
//   sign of f at each grid corner (f < 0 ? inside : outside) — a single
//   double comparison, not a determinant — so the exact orientation/in-sphere
//   predicates are NOT required here and are intentionally not used. (The
//   Predicates header IS needed by the Stage-2 mesh-boolean / arrangement code,
//   which is the robust consumer.) This is an honest "not needed yet", not a
//   silent omission.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_ISOMESHER_HPP
#define FORGE_NATIVE_IMPLICIT_ISOMESHER_HPP

#include <array>
#include <cstdint>
#include <vector>

#include "forge/native/implicit/SdfTree.hpp"

namespace forge {
namespace native {
namespace implicit {

// Indexed triangle mesh: positions[] + triangles[] (triples of vertex indices,
// CCW seen from outside / increasing f).
struct Mesh {
    std::vector<Vec3> positions;
    std::vector<std::array<int, 3>> triangles;

    bool empty() const { return triangles.empty(); }

    // Signed volume via the divergence theorem (sum of signed tetra volumes of
    // each triangle with the origin). For a CLOSED, consistently-oriented mesh
    // this equals the enclosed volume; positive when triangles wind CCW seen
    // from outside (the orientation marching cubes produces here).
    double volume() const;

    // Total surface area (sum of triangle areas).
    double area() const;
};

// Axis-aligned grid spec for the mesher.
struct GridSpec {
    Vec3 min;            // lower corner of the sampling box
    Vec3 max;            // upper corner
    int nx = 16;         // number of CELLS along x (>=1); vertices = nx+1
    int ny = 16;
    int nz = 16;
};

// Marching-cubes mesher.
class IsoMesher {
public:
    // Extract the {f = isovalue} surface of `sdf` over `grid`. Default
    // isovalue 0 (the SDF surface). Returns an indexed triangle mesh.
    static Mesh march(const Sdf& sdf, const GridSpec& grid, double isovalue = 0.0);

    // Convenience: build a cubic grid of `n` cells per axis over the box
    // [min,max], then march. Useful for the convergence gate.
    static Mesh marchCubic(const Sdf& sdf, const Vec3& min, const Vec3& max,
                           int n, double isovalue = 0.0);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_ISOMESHER_HPP
