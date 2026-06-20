// forge/native/mesh/HalfEdgeMesh.hpp
//
// In-house half-edge triangle mesh for the Forge native kernel — Stage 2 of
// KERNEL_INHOUSE_ROADMAP.md. Pure C++20, ZERO external dependencies, no OCCT,
// no WASM, no third-party libs.
//
// SCOPE OF THIS INCREMENT (honest — Bible §0/§9):
//   This is the FIRST increment of a multi-year, Manifold/CGAL-class mesh
//   engine. What is REAL and VALIDATED here:
//     (1) A half-edge data structure (vertices / half-edges / faces) with
//         twin / next / prev wiring, built from an indexed triangle soup.
//     (2) Validity checks: 2-manifold, watertight (closed), Euler characteristic.
//     (3) ONE boolean operation: a robust PLANE-CLIP of a closed mesh — cut by a
//         plane, re-triangulate the cross-section and cap it so the result stays
//         closed.
//
//   TARGETED (NOT in this increment — do not claim these work yet):
//     * General mesh booleans A∩B / A∪B / A−B between two arbitrary solids
//       (needs triangle–triangle arrangement + in/out classification — the hard
//       part of Stage 2; this file deliberately does NOT pretend to do it).
//     * Snap-rounding / exact arrangement for coincident-coplanar stacks.
//     * Non-triangular faces (this engine is triangles-only for now).
//     * Genus > 0 robustness hardening of the cap re-triangulation (the current
//       capper handles convex-or-simple section loops; a non-convex / multiply-
//       connected section is TARGETED — see MeshBoolean.cpp cap notes).
//
// ROBUSTNESS LEVEL (stated up front, do NOT overclaim): robust-in-practice.
// The plane-side classification uses the re-derived exact predicate
// forge::native::orient3d (Predicates.hpp) so the *combinatorial* in/out/on
// decision per vertex cannot be corrupted by rounding. Coordinate placement of
// the new intersection vertices is plain double (linear interpolation). This is
// the same honest ceiling Manifold itself ships — NOT CGAL-exact.

#ifndef FORGE_NATIVE_MESH_HALFEDGEMESH_HPP
#define FORGE_NATIVE_MESH_HALFEDGEMESH_HPP

#include <cstdint>
#include <vector>
#include <array>

namespace forge {
namespace native {
namespace mesh {

// Sentinel for "no element".
inline constexpr std::uint32_t kInvalid = 0xFFFFFFFFu;

struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;
};

// A half-edge: a directed edge belonging to exactly one triangle face.
// `origin` is the vertex it points away from; `twin` is the opposite-direction
// half-edge of the same undirected edge (kInvalid only on a boundary, i.e. a
// non-watertight mesh); `next`/`prev` walk the triangle CCW; `face` owns it.
struct HalfEdge {
    std::uint32_t origin = kInvalid;
    std::uint32_t twin   = kInvalid;
    std::uint32_t next   = kInvalid;
    std::uint32_t prev   = kInvalid;
    std::uint32_t face   = kInvalid;
};

struct Vertex {
    Vec3 position;
    // One outgoing half-edge (any) — kInvalid for an isolated vertex.
    std::uint32_t halfEdge = kInvalid;
};

// A triangular face; `halfEdge` is one of its three half-edges.
struct Face {
    std::uint32_t halfEdge = kInvalid;
};

// Result of a validity audit. `eulerChar` = V - E + F.
struct ValidityReport {
    std::uint32_t numVertices = 0;
    std::uint32_t numEdges    = 0;   // undirected edges
    std::uint32_t numFaces    = 0;
    int           eulerChar   = 0;
    bool          twinsConsistent = false;  // every he.twin.twin == he, origins match
    bool          manifold    = false;      // every undirected edge has exactly 2 incident faces, fan-manifold vertices
    bool          watertight  = false;      // closed: no boundary half-edge (every twin set)
    bool          isValid() const { return twinsConsistent && manifold && watertight; }
};

class HalfEdgeMesh {
public:
    HalfEdgeMesh() = default;

    // Build from an indexed triangle soup. Returns false (and leaves the mesh
    // empty) if any face is degenerate-indexed (a repeated vertex index) or an
    // index is out of range, or if the same directed edge (a->b) appears in two
    // faces (non-manifold / inconsistent winding) — those are surfaced as a
    // build failure, NOT silently repaired.
    //   positions : flat xyz triples, length == 3*numVertices
    //   indices   : flat triangle indices, length == 3*numTriangles
    bool buildFromSoup(const std::vector<double>& positions,
                       const std::vector<std::uint32_t>& indices);

    // Audit the structure. Cheap; recomputes from scratch.
    ValidityReport validate() const;

    // Signed volume via the divergence theorem (sum of tetra (origin,a,b,c)/6).
    // Meaningful only for a closed, consistently-wound mesh; positive for
    // outward-facing CCW triangles.
    double signedVolume() const;

    // Total surface area.
    double surfaceArea() const;

    // ---- boolean op (this increment): plane clip --------------------------
    // Clip this (closed) mesh by the plane  n.(p) = d  (i.e. keep the half-space
    // n·p <= d), re-triangulating crossed faces and capping the section so the
    // result is closed again. Returns the clipped mesh. `ok` is set false if the
    // input is not closed (precondition) or the cap could not be formed.
    // Implemented in MeshBoolean.cpp.
    HalfEdgeMesh planeClip(const Vec3& n, double d, bool& ok) const;

    // ---- accessors --------------------------------------------------------
    const std::vector<Vertex>&   vertices()  const { return verts_; }
    const std::vector<HalfEdge>& halfEdges() const { return halfEdges_; }
    const std::vector<Face>&     faces()     const { return faces_; }

    std::size_t vertexCount() const { return verts_.size(); }
    std::size_t faceCount()   const { return faces_.size(); }

    // Export back to an indexed triangle soup (positions flat xyz, indices flat).
    void toSoup(std::vector<double>& positions,
                std::vector<std::uint32_t>& indices) const;

private:
    std::vector<Vertex>   verts_;
    std::vector<HalfEdge> halfEdges_;
    std::vector<Face>     faces_;

    friend HalfEdgeMesh buildPlaneClip(const HalfEdgeMesh&, const Vec3&, double, bool&);
};

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_HALFEDGEMESH_HPP
