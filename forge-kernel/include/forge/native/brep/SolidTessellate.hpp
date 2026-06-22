// forge/native/brep/SolidTessellate.hpp
//
// Watertight B-rep Solid -> triangle mesh tessellator for the Forge native
// kernel (KERNEL_INHOUSE_ROADMAP Stage 6 brep/). Turns a closed brep::Solid into
// an indexed triangle soup / mesh::HalfEdgeMesh with NO cracks: shared
// topological vertices produce coincident mesh vertices (welded by position
// dedup), so every interior edge is shared by exactly two triangles.
//
// ============================ HONESTY (Bible §0/§9) ========================
// What is REAL here: each Face is fan-triangulated over its outer-loop vertices
// (already finely segmented for the curved primitives, so the chord error is set
// by the primitive's nSeg/nBand). Output vertices are welded across faces by
// snapping equal positions, which is exact for the canonical primitives because
// adjacent faces share the SAME topological Vertex on every shared edge. The
// result validates as a closed 2-manifold via mesh::HalfEdgeMesh::validate().
//
// TARGETED (not here): adaptive curvature-driven refinement, in-face grid
// subdivision with matched boundary sampling (the curved faces are already the
// refinement unit), trimmed-NURBS faces with inner loops.
//
// Pure C++20, ZERO external deps (stdlib + forge native headers). No OCCT/WASM.

#ifndef FORGE_NATIVE_BREP_SOLIDTESSELLATE_HPP
#define FORGE_NATIVE_BREP_SOLIDTESSELLATE_HPP

#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace brep {

// Triangulate a closed solid into a flat indexed soup. Vertices are welded by
// quantized position (weldTol). `positions` is flat xyz; `indices` flat tri.
void tessellateSolid(const Solid& solid,
                     std::vector<double>& positions,
                     std::vector<std::uint32_t>& indices,
                     double weldTol = 1e-9);

// Convenience: build a mesh::HalfEdgeMesh from the soup above. `ok` is false if
// the soup did not assemble into a valid half-edge mesh.
mesh::HalfEdgeMesh tessellateSolidToMesh(const Solid& solid, bool& ok,
                                         double weldTol = 1e-9);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SOLIDTESSELLATE_HPP
