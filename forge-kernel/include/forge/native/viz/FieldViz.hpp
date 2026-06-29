// forge/native/viz/FieldViz.hpp
//
// forge::native::viz — the CAE FIELD-VISUALIZATION pipeline (#65, the
// "ParaView-native" track). Turns a SOLVED result field (FEA / CFD) sampled on a
// mesh into RENDERABLE GEOMETRY so the validated solvers become VISIBLE.
//
// The solvers (forge::native::fea / Cfd / MultibodyDynamics …) are already
// numerically validated; this module is the post-processing layer that maps
// their nodal result fields to geometry a viewer can draw. It is the native
// analogue of ParaView's three workhorse filters:
//
//   1. WARP BY VECTOR   — deform the geometry by a nodal displacement field,
//                         x' = x + scale·u  (the canonical "show the deformed
//                         shape"). The trivial-but-essential first filter.
//   2. SCALAR COLORMAP  — map a nodal scalar field (von-Mises stress,
//                         temperature, pressure) through a perceptually-uniform
//                         colormap (VIRIDIS) to per-vertex RGB, auto-ranging
//                         [vmin,vmax]. The "color by" surface render.
//   3. CONTOUR / ISOSURFACE — extract the {field = isovalue} surface of a
//                         scalar field on a structured grid as a triangle mesh.
//                         ParaView's "Contour" filter.
//   4. STREAMLINE       — integrate a tracer through a velocity field with RK4,
//                         producing a polyline (ParaView's "Stream Tracer").
//                         (The optional fourth filter; rigorously gated below.)
//
// DEDUP / REUSE (mandatory sweep done — Bible §0/§9; nothing re-derived):
//   * MARCHING CUBES is NOT re-implemented. The contour filter REUSES the
//     validated forge::native::implicit::IsoMesher (the Lorensen-Cline 256-case
//     edge/triangle tables, linear edge interpolation, edge-keyed shared-vertex
//     de-duplication, outward-normal winding) by presenting the structured
//     scalar field to it as an implicit::Sdf adapter — exactly the pattern the
//     voxel stage already uses (voxel::GridFieldSdf). No second mesher, no
//     second 256-case table.
//   * The geometry output type is implicit::Mesh (positions + triangles +
//     volume()/area()) — REUSED, not re-declared.
//   * Vector math (x+scale·u, length, dot) REUSES implicit::Vec3 and its
//     operators — no new vector type, no re-derived arithmetic.
//
// WHAT IS GENUINELY NEW HERE (no pre-existing equivalent — grep-confirmed):
//   * warpByVector  — nodal displacement -> deformed positions.
//   * viridis / colormapField — a native value->RGB colormap (luminance-monotonic
//     by construction) + per-vertex colorization with auto-range.
//   * StructuredScalarField / StructuredVectorField — trilinearly-sampled regular
//     grids of a result field (the bridge from "field array on a grid" to the
//     IsoMesher Sdf adapter and to the RK4 integrator).
//   * contour — the structured-field isosurface (delegates to IsoMesher).
//   * streamline — RK4 integration of a tracer through a velocity field.
//
// HONESTY (Bible §0/§9):
//   - The isosurface inherits the marching-cubes O(h²) chordal/iso sampling
//     error and the (TARGETED) MC33 saddle ambiguity of IsoMesher — we MEASURE
//     it (the radial-field sphere gate reports the radial tol and audits that the
//     soup is a closed 2-manifold with no cracks), never claim an exact surface.
//   - RK4 streamline error is O(Δt⁴) per step; the rotation gate MEASURES the
//     radius drift over a full revolution against the analytic circle.
//   - Colormap "monotonic" means: the scalar normalization t=(v-vmin)/(vmax-vmin)
//     is monotone + clamped, and the colormap's perceived LUMINANCE increases
//     monotonically along t (the defining property of viridis) — both gated.
//
// Pure C++20, standard library only. NO external deps, NO OCCT, NO WASM.

#ifndef FORGE_NATIVE_VIZ_FIELDVIZ_HPP
#define FORGE_NATIVE_VIZ_FIELDVIZ_HPP

#include <vector>

#include "forge/native/implicit/IsoMesher.hpp"   // implicit::Mesh / GridSpec / IsoMesher
#include "forge/native/implicit/SdfTree.hpp"     // implicit::Vec3 / Sdf (pulled by IsoMesher)

namespace forge {
namespace native {
namespace viz {

// Reuse the implicit stage's point/vector and mesh types verbatim (no new
// geometry vocabulary; the field-viz output is an ordinary indexed triangle
// mesh and ordinary 3-vectors).
using Vec3 = implicit::Vec3;
using Mesh = implicit::Mesh;

// ---------------------------------------------------------------------------
// 1) WARP BY VECTOR — deformed node positions x' = x + scale·u.
//
// `positions` and `displacements` are parallel arrays (one displacement vector
// per node). `scale` exaggerates the (usually tiny) deformation for display, as
// every CAE post-processor does. Returns the deformed positions. Throws if the
// two arrays differ in length.
// ---------------------------------------------------------------------------
std::vector<Vec3> warpByVector(const std::vector<Vec3>& positions,
                               const std::vector<Vec3>& displacements,
                               double scale);

// ---------------------------------------------------------------------------
// 2) SCALAR COLORMAP — value -> RGB through the VIRIDIS colormap.
//
// RGB channels are in [0,1]. viridis(v,vmin,vmax) normalizes v to t∈[0,1]
// (CLAMPING out-of-range v to the endpoint colors) and looks the color up in the
// embedded perceptually-uniform viridis table with linear interpolation.
// ---------------------------------------------------------------------------
struct RGB {
    double r = 0.0, g = 0.0, b = 0.0;
};

// Min/max of a scalar field (auto-range). For a constant field vmin==vmax;
// callers that then normalize must guard the zero span (viridis() does: a zero
// span maps every value to t=0).
struct Range {
    double vmin = 0.0, vmax = 0.0;
    double span() const { return vmax - vmin; }
};

Range autoRange(const std::vector<double>& values);

// The raw colormap: t (already in [0,1]) -> RGB. Exposed so the gate can check
// the LUT endpoints and luminance monotonicity directly.
RGB viridisUnit(double t);

// value -> RGB over [vmin,vmax] (clamped). vmin>=vmax maps everything to the
// first color.
RGB viridis(double value, double vmin, double vmax);

// Per-vertex colorization of a nodal scalar field over an explicit [vmin,vmax].
std::vector<RGB> colormapField(const std::vector<double>& values,
                               double vmin, double vmax);

// Per-vertex colorization that AUTO-RANGES the field; the range used is returned
// through `outRange` so the caller can draw a color legend.
std::vector<RGB> colormapFieldAuto(const std::vector<double>& values,
                                   Range& outRange);

// ---------------------------------------------------------------------------
// 3) STRUCTURED SCALAR FIELD — a regular grid of nodal scalar values with
// trilinear sampling. This is the bridge from a solver's result array to the
// (shared) IsoMesher: the field is presented to the mesher as an implicit::Sdf
// whose eval(p) == sample(p).
//
// Index convention matches IsoMesher: nx/ny/nz are CELLS per axis, vertices are
// (nx+1)(ny+1)(nz+1), and value index of vertex (i,j,k) is (k·VY+j)·VX+i with
// VX=nx+1, VY=ny+1. `values.size()` MUST equal the vertex count.
// ---------------------------------------------------------------------------
struct StructuredScalarField {
    Vec3 min, max;                 // axis-aligned box covered by the grid
    int  nx = 1, ny = 1, nz = 1;   // cells per axis
    std::vector<double> values;    // nodal scalar values, (nx+1)(ny+1)(nz+1)

    bool valid() const;            // dims >=1 and values sized correctly
    std::size_t vertexCount() const {
        return static_cast<std::size_t>(nx + 1) * (ny + 1) * (nz + 1);
    }

    // Trilinear sample at an arbitrary point (clamped to the box). At a grid
    // vertex this returns exactly the stored nodal value.
    double sample(const Vec3& p) const;

    Range range() const { return autoRange(values); }
};

// CONTOUR / ISOSURFACE — extract the {field = isovalue} surface as a triangle
// mesh. Delegates to the validated implicit::IsoMesher (no duplicate mesher):
// the field is wrapped as an Sdf adapter and marched over the field's own grid
// at one marching-cubes cell per field cell, so the surface is built from the
// ACTUAL nodal values (the adapter is exact at vertices).
//
// Convention (inherited from IsoMesher): the sub-level set {field < isovalue} is
// treated as the "inside"; emitted triangles wind CCW seen from the {field >
// isovalue} side, so a closed contour (e.g. a radial field's sphere) has a
// POSITIVE Mesh::volume(). Throws if `field` is invalid.
Mesh contour(const StructuredScalarField& field, double isovalue);

// ---------------------------------------------------------------------------
// 4) STRUCTURED VECTOR FIELD + STREAMLINE — a regular grid of nodal 3-vectors
// (e.g. a CFD velocity field) with trilinear sampling, and an RK4 tracer.
// ---------------------------------------------------------------------------
struct StructuredVectorField {
    Vec3 min, max;
    int  nx = 1, ny = 1, nz = 1;
    std::vector<Vec3> values;      // nodal vectors, (nx+1)(ny+1)(nz+1)

    bool valid() const;
    std::size_t vertexCount() const {
        return static_cast<std::size_t>(nx + 1) * (ny + 1) * (nz + 1);
    }

    // Trilinear sample of the vector at p (clamped to the box).
    Vec3 sample(const Vec3& p) const;
};

// Integrate a streamline (a tracer advected by the velocity field) from `seed`
// using classical 4th-order Runge-Kutta with fixed step `dt` for `steps` steps.
// Returns the polyline of visited points (seed first). Integration stops early
// if a point leaves the field box (clamped sampling would otherwise stall).
std::vector<Vec3> streamline(const StructuredVectorField& field,
                             const Vec3& seed, double dt, int steps);

} // namespace viz
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VIZ_FIELDVIZ_HPP
