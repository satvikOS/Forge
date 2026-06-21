// forge/native/brep/Chamfer.hpp
//
// In-house MESH edge CHAMFER for the Forge native kernel —
// forge::native::brep::Chamfer. Pure C++20, ZERO external dependencies: the
// standard library plus the existing forge/native headers ONLY. No OCCT, no
// WASM, no third-party libs. Builds on the existing headers by #include — it
// does NOT re-implement any of them:
//   * forge/native/Predicates.hpp        (robust orient3d — degeneracy oracle)
//   * forge/native/geom/Geom.hpp          (Point3 — the canonical geom point type)
//   * forge/native/geom/AABBTree.hpp      (reuse surface — spatial query stack)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (Vec3 / HalfEdgeMesh / validate /
//                                          signedVolume — the topology this runs on)
//   * forge/native/mesh/FeatureEdges.hpp  (the dihedral feature-edge detector that
//                                          decides WHICH edges to chamfer)
//   * forge/native/mesh/TriTriIntersect.hpp (reuse surface — intersection stack)
//
// ============================================================================
// WHAT THIS MODULE DOES  (honest scope — Bible §0/§9)
// ============================================================================
// The classic edge CHAMFER (a flat bevel along a sharp edge), implemented as a
// MESH operation — NOT an analytic B-rep fillet/chamfer. Given a closed,
// 2-manifold triangle mesh:
//
//   1. Detect the SHARP CONVEX feature edges via the dihedral test (reusing
//      forge::native::mesh::detectFeatureEdges). A manifold edge is "sharp" when
//      its dihedral angle exceeds `angleThresholdDeg` (default 30 deg). It is
//      "convex" when the surface folds OUTWARD across it (the dihedral is a
//      convex ridge, not a concave valley) — decided by the sign of the volume
//      that the two outward face normals enclose at the edge (an exact-in-double
//      reflex test). Only sharp CONVEX edges are chamfered; concave edges and
//      smooth edges are left untouched.
//
//   2. For each chamfered edge, BEVEL it by a setback distance `d`: the two
//      adjacent faces are trimmed back by `d` along their in-face perpendiculars
//      to that edge, and the resulting two offset edges are bridged by a flat
//      CHAMFER FACE (a quad, split into two triangles).
//
//   3. At each ORIGINAL vertex where chamfered edges meet, the per-incident-face
//      trimmed corners are connected by a CORNER FACE (a fan), so the corner is
//      faceted consistently. Vertices are SHARED between the shrunk original
//      face, the two chamfer faces of each edge, and the corner face — so the
//      result stays watertight and 2-manifold.
//
// The construction is a VERTEX-SPLIT + FACE-OFFSET chamfer: every original
// vertex `v` is split into one new vertex per incident face, displaced inward in
// that face's plane by `d` away from each chamfered edge of that face at `v`.
// For a convex polyhedron this reproduces the exact chamfered solid (the 12
// rectangular bevels + 8 triangular corner facets of a chamfered cube fall out
// automatically — pure edge chamfering forms the corner facets for free).
//
// ============================================================================
// HONEST ENVELOPE  (the LARGEST honestly-validated domain — Bible §0)
// ============================================================================
// This operator is VALIDATED and returns ok==true on CLOSED, 2-manifold,
// CONVEX, PLANAR-FACETED meshes whose chamfered feature edges share corners
// cleanly (the canonical target: the unit cube and convex prisms/boxes). On
// such inputs it guarantees, within a mesh tolerance:
//   * the result is watertight, 2-manifold (validate().isValid()),
//   * its volume equals  inputVolume - removedWedgeVolume  (the analytic removed
//     bevel material — 12 edge wedges + 8 corner pieces for a cube),
//   * every original sharp convex edge is REPLACED by a chamfer face: no edge
//     with dihedral > angleThresholdDeg survives EXCEPT the new chamfer-face
//     borders (which are the shallow seams the bevel introduces, below the
//     original sharpness).
//
// OUTSIDE that envelope ok is returned FALSE, honestly, never a fake:
//   * `d` <= 0, or `d` >= half the shortest mesh edge length (the trim would
//     collapse or invert a face / overrun a neighbouring edge),
//   * a non-closed / non-2-manifold / non-finite / degenerate input,
//   * a NON-CONVEX mesh whose offset would self-intersect, or a vertex where the
//     trimmed corners cannot be faceted into a simple fan (surfaced when the
//     rebuilt soup is not a valid 2-manifold — we do NOT emit a broken solid).
// A concave-only or smooth input with no sharp convex edges yields ok==true with
// the mesh returned UNCHANGED and numChamferedEdges==0 (a faithful no-op).
//
// THIS IS A MESH CHAMFER (do NOT overclaim): the bevel is a FLAT facet between
// two straight offset edges. It is exact for planar-faceted convex inputs; on a
// curved/tessellated surface it chamfers the tessellation's sharp edges (the
// same honest ceiling a mesh-modeller chamfer ships), not an analytic B-rep
// rolling-ball chamfer. Coordinates are plain IEEE-754 double; the combinatorial
// feature/convexity decisions ride on the exact dihedral + orient3d machinery.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when the rebuilt mesh passes the
// kernel's own validate().isValid(); any failure is surfaced as ok==false with a
// human-readable `reason`. Geometry is NEVER fabricated to pass a test.

#ifndef FORGE_NATIVE_BREP_CHAMFER_HPP
#define FORGE_NATIVE_BREP_CHAMFER_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/mesh/FeatureEdges.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"

namespace forge {
namespace native {
namespace brep {

// Result of a mesh chamfer. `mesh` is meaningful only when `ok == true`; when ok
// is false, `reason` explains why honestly and `mesh` is left empty/unchanged.
struct ChamferResult {
    bool        ok = false;
    std::string reason;            // "" / "ok" on success; the failure cause otherwise
    mesh::HalfEdgeMesh mesh;       // the chamfered solid (valid only when ok==true)

    // ---- diagnostics (populated whenever the input parsed) -------------------
    double angleThresholdDeg = 30.0;  // dihedral threshold actually applied
    double setback           = 0.0;   // the `d` actually requested

    std::uint32_t inputVertices  = 0;
    std::uint32_t inputFaces     = 0;
    std::uint32_t outputVertices = 0;
    std::uint32_t outputFaces    = 0;

    std::uint32_t numSharpEdges      = 0;  // sharp manifold edges (convex+concave)
    std::uint32_t numChamferedEdges  = 0;  // sharp CONVEX edges actually chamfered
    std::uint32_t numChamferFaces    = 0;  // chamfer facets emitted (2 tris each)
    std::uint32_t numCornerFaces     = 0;  // corner facets emitted (vertex fans)

    double shortestEdge = 0.0;             // shortest mesh edge length (the d limit)
    double inputVolume  = 0.0;             // signed volume of the input solid
    double outputVolume = 0.0;             // signed volume of the chamfered solid
    double removedVolume = 0.0;            // inputVolume - outputVolume (bevel wedge)
};

// Chamfer every sharp CONVEX feature edge of a closed 2-manifold triangle mesh by
// setback distance `d`.
//
//   positions          : flat xyz triples, length == 3 * numVertices
//   indices            : flat triangle indices, length == 3 * numTriangles
//   d                  : the chamfer setback (in-face trim) distance, > 0
//   angleThresholdDeg  : dihedral threshold (deg) above which an edge is "sharp"
//
// Returns ok==false (with `reason` set, `mesh` empty) when:
//   * the soup is empty / ragged / has a non-finite coordinate / out-of-range
//     index / a degenerate (zero-area) triangle,
//   * the kernel cannot build a closed 2-manifold from it (validate fails),
//   * d <= 0, or d >= 0.5 * shortestEdge (the trim would collapse/overrun),
//   * the chamfered soup does not rebuild into a valid closed 2-manifold (e.g. a
//     non-convex configuration whose offset self-intersects — surfaced, never
//     faked).
// Returns ok==true with the mesh UNCHANGED and numChamferedEdges==0 when there
// are no sharp convex edges (a faithful no-op).
ChamferResult chamferEdges(const std::vector<double>& positions,
                           const std::vector<std::uint32_t>& indices,
                           double d,
                           double angleThresholdDeg = 30.0);

// Convenience overload operating on an already-built half-edge mesh.
ChamferResult chamferEdges(const mesh::HalfEdgeMesh& mesh,
                           double d,
                           double angleThresholdDeg = 30.0);

// Build the closed, outward-wound 12-triangle triangle soup of an axis-aligned
// cube [0,L]^3 placed at `origin`. Exposed for testing / reuse (the canonical
// chamfer validation target). `positions` is flat xyz, `indices` flat triangles.
void makeCubeSoup(double L, const ::forge::native::mesh::Vec3& origin,
                  std::vector<double>& positions,
                  std::vector<std::uint32_t>& indices);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CHAMFER_HPP
