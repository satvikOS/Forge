// forge/native/mesh/WallThickness.hpp
//
// In-house minimum wall-thickness DFM (Design-For-Manufacturing) analysis for
// the Forge native kernel. Pure C++20, ZERO external dependencies — standard
// library plus the existing forge/native headers only. No OCCT, no WASM, no
// third-party libs.
//
// WHAT THIS COMPUTES (honest scope — Bible §0 / KERNEL_INHOUSE_ROADMAP §0):
//   Given a closed, consistently-wound triangle soup (a solid surface), for
//   every surface SAMPLE (we sample at the mesh vertices) we shoot a ray
//   INWARD along the negated outward surface normal and find where it next
//   strikes the surface (the "opposite wall") using the existing accelerated
//   geom::AABBTree ray query. The hit distance is the LOCAL wall thickness at
//   that sample — exactly the gauge a moulding / casting / sheet-metal DFM
//   checker reports. We aggregate this into:
//       * the GLOBAL minimum thickness over all sampled vertices,
//       * a per-vertex thickness FIELD (one value per input vertex), and
//       * the world-space LOCATION of the thinnest sample (and its normal).
//
//   This is the standard "ray-from-surface / opposite-wall" thickness gauge
//   (a.k.a. the ray method), the same family used by commercial DFM tools.
//   It is a SAMPLED lower-frequency measure: it reports thickness AT the
//   vertices along the inward surface normal. It is NOT the rolling-ball
//   (medial-axis / sphere) thickness — that is a different, TARGETED measure
//   and is intentionally not claimed here.
//
// ROBUSTNESS / SELF-HIT (stated up front, do NOT overclaim):
//   The ray originates exactly ON the surface (at the sample vertex), so a
//   naive forward query would "hit" the vertex's own incident triangles at
//   t≈0. We therefore (a) build the inward normal robustly from the
//   area-weighted incident face normals, (b) nudge the ray origin a small
//   eps INWARD along that normal, and (c) require the accepted hit to be at a
//   parametric distance strictly greater than that eps. The eps is scaled to
//   the model size so it is invariant to units. The hit DISTANCE itself is the
//   nudged-origin t plus the nudge — i.e. measured from the true surface
//   sample, not the nudged point. All arithmetic is plain IEEE-754 double
//   (the geom::AABBTree is an acceleration structure, not exact arithmetic);
//   the validated promise is "thickness within a coarse-mesh tolerance of the
//   analytic gauge", which the standalone gate enforces on random instances.
//
// 0-FAKES: degenerate / unsupported input (ragged arrays, empty soup, an open
//   / non-watertight mesh, out-of-range indices, a vertex with no well-defined
//   normal) is reported via ok=false with a reason — never papered over with a
//   fabricated thickness.

#ifndef FORGE_NATIVE_MESH_WALLTHICKNESS_HPP
#define FORGE_NATIVE_MESH_WALLTHICKNESS_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3 (the soup vertex type)

namespace forge {
namespace native {
namespace mesh {

// Per-vertex outcome of the inward thickness probe.
struct VertexThickness {
    bool   measured = false;   // true if the inward ray struck an opposite wall
    double thickness = 0.0;    // local wall thickness (hit distance); meaningful
                               // only when measured==true
    Vec3   position{};         // the sampled surface point (the input vertex)
    Vec3   inwardDir{};        // unit inward normal used for the probe
    Vec3   hitPoint{};         // world-space opposite-wall hit (measured==true)
};

// Aggregate report of a wall-thickness analysis.
struct WallThicknessResult {
    bool ok = false;           // false on degenerate / unsupported input
    const char* reason = "";   // why ok==false, for diagnostics

    // Global minimum over all MEASURED vertices.
    bool   hasMin = false;     // false if NO vertex found an opposite wall
    double minThickness = 0.0; // the global minimum wall thickness
    std::size_t minVertex = 0; // index (into the input soup) of the thinnest vertex
    Vec3   minLocation{};      // world-space location of the thinnest sample
    Vec3   minInwardDir{};     // inward normal at the thinnest sample

    // Statistics over MEASURED vertices (meaningful only when hasMin==true).
    double maxThickness = 0.0;
    double meanThickness = 0.0;
    std::size_t measuredCount = 0;  // how many vertices found an opposite wall

    // Per-vertex field, length == number of input vertices, index-aligned.
    std::vector<VertexThickness> perVertex;
};

// Analyze the minimum wall thickness of a closed, consistently-wound triangle
// soup. The mesh must be watertight (a solid surface) so that "shoot inward and
// hit the opposite wall" is well-defined.
//
//   positions : flat xyz triples, length == 3*numVertices
//   indices   : flat triangle indices, length == 3*numTriangles
//
// Returns ok=false (with a reason, and an empty field) for:
//   * positions.size() not a multiple of 3, or indices.size() not a multiple of 3
//   * empty soup (no triangles or no vertices)
//   * any index out of range
//   * any non-finite coordinate
//   * an open / non-watertight / non-manifold mesh (validate().isValid() fails)
//   * any individual vertex whose incident faces give no well-defined normal is
//     marked measured=false for that vertex (NOT a whole-analysis failure).
WallThicknessResult analyzeWallThickness(const std::vector<double>& positions,
                                         const std::vector<std::uint32_t>& indices);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_WALLTHICKNESS_HPP
