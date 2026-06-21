// forge/native/mesh/FeatureEdges.hpp
//
// In-house sharp-feature detection on the half-edge triangle mesh —
// forge::native::mesh::FeatureEdges. Pure C++20, standard library only. NO OCCT,
// NO WASM, NO third-party libs. Builds ONLY on the existing forge native headers
// (by #include, never re-deriving them):
//   * forge/native/Predicates.hpp        (robust orient3d — only as a degeneracy
//                                          oracle for zero-area triangles)
//   * forge/native/geom/Geom.hpp          (Point3, the canonical geom point type)
//   * forge/native/geom/Delaunay3D.hpp    (part of the mandated reuse surface;
//                                          included so this module sits on the
//                                          same geom stack — no query required by
//                                          the dihedral math)
//   * forge/native/brep/Nurbs.hpp         (reuse surface — surface analytics stack)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate — the topology this runs on)
//   * forge/native/implicit/SdfTree.hpp   (reuse surface — implicit stack)
//   * forge/native/implicit/IsoMesher.hpp (reuse surface — implicit stack)
//
// WHAT THIS MODULE COMPUTES (REAL and VALIDATED — see featureedges_test.cpp):
//   SHARP FEATURE EDGES and CORNERS of a triangle mesh by DIHEDRAL ANGLE.
//
//   For every undirected edge of the mesh:
//     * A MANIFOLD edge (exactly two incident faces) is a FEATURE edge when the
//       DIHEDRAL ANGLE between the two incident face normals exceeds a threshold
//       (default 30 deg). The dihedral angle here is the turn angle of the
//       surface across the edge: 0 for two coplanar same-facing triangles, larger
//       as the surface creases. Concretely it is the angle between the two
//       OUTWARD face normals (n0, n1): theta = atan2(|n0 x n1|, n0 . n1), in
//       [0, pi]. A flat fan (icosphere face-to-face) has theta ~ 0; a cube edge
//       has theta = pi/2 = 90 deg, well above 30.
//     * A BOUNDARY edge (exactly one incident face — an open mesh) is ALWAYS a
//       feature edge (the surface terminates there). A non-manifold edge (three
//       or more incident faces) is reported via ok=false: this detector is a
//       2-manifold-(-with-boundary) operator and does NOT silently guess.
//
//   For every vertex, the count of incident FEATURE edges classifies it:
//     * >= 3 incident feature edges  -> CORNER  (a cube vertex meets 3 edges).
//     * exactly 2 incident feature edges -> CREASE vertex (a feature curve passes
//       smoothly through; the two edges continue one ridge/valley line).
//     * 0 or 1 -> not a feature vertex (an isolated 1 is a dangling feature-edge
//       endpoint and is reported in the count but is not a crease/corner).
//
// THRESHOLD MONOTONICITY (a structural guarantee asserted by the gate):
//   The feature-edge set is { boundary edges } UNION { manifold edges whose
//   dihedral angle > threshold }. The boundary set is threshold-independent and
//   the manifold-angle set only SHRINKS as the threshold rises, so RAISING the
//   threshold can NEVER INCREASE the feature-edge count. This is exact (no tuned
//   tolerance), and is asserted across a sweep of thresholds.
//
// ROBUSTNESS POSTURE (honest — Bible §0):
//   The dihedral angle is a plain IEEE-754 double evaluation of an exact formula
//   (atan2 of the cross/dot of two un-normalised face normals — numerically the
//   most stable angle form, valid across the whole [0, pi] range without a
//   cos-clamp). The COMBINATORIAL feature decision (> threshold) is a single
//   comparison; the boundary classification is purely topological (twin ==
//   kInvalid) and therefore exact. orient3d is used only as an oracle to reject a
//   zero-area (degenerate) triangle before its normal is trusted. Degenerate /
//   unsupported input is reported via ok=false, never papered over: an empty
//   mesh, a soup the kernel cannot build (out-of-range index, repeated vertex in
//   a face, inconsistent winding), a non-finite coordinate, a zero-area triangle,
//   or a non-manifold edge (>2 incident faces) all fail loudly. 0 FAKES.

#ifndef FORGE_NATIVE_MESH_FEATUREEDGES_HPP
#define FORGE_NATIVE_MESH_FEATUREEDGES_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/Delaunay3D.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/implicit/SdfTree.hpp"
#include "forge/native/implicit/IsoMesher.hpp"

namespace forge {
namespace native {
namespace mesh {

// One detected/analysed undirected edge of the mesh.
struct FeatureEdge {
    std::uint32_t v0 = kInvalid;   // endpoint vertex indices, v0 < v1
    std::uint32_t v1 = kInvalid;
    double dihedralDeg = 0.0;      // dihedral angle in DEGREES, [0,180]; for a
                                   // boundary edge this is left 0 (undefined —
                                   // only one incident face) and `boundary` set.
    bool boundary = false;         // true iff exactly one incident face (open)
    bool feature  = false;         // true iff this edge is a feature edge
};

// Classification of a vertex by its incident feature-edge count.
enum class VertexKind : std::uint8_t {
    SMOOTH = 0,   // 0 or 1 incident feature edges
    CREASE = 1,   // exactly 2 incident feature edges (a ridge line passes through)
    CORNER = 2    // >= 3 incident feature edges
};

// Result of a feature-edge / corner analysis. All per-edge / per-vertex vectors
// are populated when ok==true (empty when ok==false). `featureEdges` lists EVERY
// undirected edge with its dihedral/feature classification (not only the sharp
// ones); the convenience counts summarise it.
struct FeatureSet {
    bool ok = false;
    const char* reason = "";

    double thresholdDeg = 30.0;          // the threshold actually applied

    std::uint32_t numVertices = 0;
    std::uint32_t numEdges    = 0;       // undirected edges
    std::uint32_t numFaces    = 0;

    // Every undirected edge of the mesh, in ascending (v0,v1) order.
    std::vector<FeatureEdge> edges;

    // Per-vertex incident-feature-edge count and the derived kind. Indexed by
    // input vertex order, sized numVertices.
    std::vector<std::uint32_t> vertexFeatureDegree;
    std::vector<VertexKind>    vertexKind;

    // Convenience summary counts.
    std::uint32_t numFeatureEdges    = 0;   // edges with feature == true
    std::uint32_t numBoundaryEdges   = 0;   // edges with boundary == true
    std::uint32_t numCreaseVertices  = 0;   // vertexKind == CREASE
    std::uint32_t numCornerVertices  = 0;   // vertexKind == CORNER
};

// Detect sharp feature edges and corners of an indexed triangle soup by dihedral
// angle. `thresholdDeg` is the dihedral-angle threshold in DEGREES (default 30):
// a manifold edge is a feature when its dihedral exceeds this; a boundary edge is
// always a feature. ok=false (with an empty result and a populated `reason`) on:
//   * empty input / index length not a multiple of 3,
//   * a soup the kernel cannot build (out-of-range index, repeated vertex in a
//     face, inconsistent winding),
//   * a non-finite coordinate,
//   * a degenerate (zero-area) triangle,
//   * a non-manifold edge (more than two incident faces),
//   * a threshold outside [0, 180].
// A mesh WITH a clean open boundary is accepted (boundary edges are reported as
// features; interior edges are classified by their dihedral angle).
FeatureSet detectFeatureEdges(const std::vector<double>& positions,
                              const std::vector<std::uint32_t>& indices,
                              double thresholdDeg = 30.0);

// Convenience overload: analyse an already-built half-edge mesh. Same semantics;
// the mesh is re-audited internally.
FeatureSet detectFeatureEdges(const HalfEdgeMesh& mesh,
                              double thresholdDeg = 30.0);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_FEATUREEDGES_HPP
