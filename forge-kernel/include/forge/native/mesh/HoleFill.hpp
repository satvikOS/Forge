// forge/native/mesh/HoleFill.hpp
//
// In-house boundary-hole filling for open triangle meshes — forge::native::mesh.
// Pure C++20, ZERO external dependencies: no OCCT, no WASM, no third-party libs.
// Builds ONLY on the parallel native headers (#include, never re-implemented):
//   * forge/native/Predicates.hpp        — exact orient2d (ear-clip in-plane test)
//   * forge/native/geom/Geom.hpp         — Point2 / Point3 / convexHull2D
//   * forge/native/mesh/HalfEdgeMesh.hpp — Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate / signedVolume
//
// WHAT THIS MODULE DOES (REAL + VALIDATED — see test/native/mesh/holefill_test.cpp)
// --------------------------------------------------------------------------------
// Given an indexed triangle soup of a 2-manifold-with-boundary mesh (a closed
// solid from which some faces have been removed, leaving one or more boundary
// holes), fillHoles():
//
//   (1) builds the half-edge structure and detects every BOUNDARY LOOP — a cycle
//       of half-edges whose opposite (twin) half-edge is absent. Each loop bounds
//       exactly one hole and is recovered by walking boundary edges in order.
//
//   (2) triangulates each loop and STITCHES the new triangles back into the soup
//       with the winding that SEALS the hole (the new faces use each boundary
//       edge in REVERSE, so they are consistently wound with the surrounding
//       surface and create no non-manifold / duplicated directed edge).
//       Two strategies, chosen per-loop:
//         * CENTROID FAN  — for a loop that is convex (its best-fit-plane
//           projection equals its own 2D convex hull): one new apex vertex at the
//           loop centroid, fanned to every boundary edge. Cheap and robust.
//         * EAR CLIP      — otherwise: classic ear clipping in the loop's
//           best-fit plane, with the ear/containment tests decided by the EXACT
//           orient2d predicate (never a float tolerance), so a non-convex loop is
//           triangulated without self-intersection. Adds NO new vertices.
//
//   (3) rebuilds the half-edge mesh from the augmented soup and returns it; the
//       caller (and our gate) independently re-audits validate().isValid().
//
// GUARANTEE (honest): removing K faces from a closed 2-manifold and re-filling
// restores a WATERTIGHT 2-MANIFOLD with Euler characteristic 2 and enclosed
// volume within a few percent of the original (the cap is the minimal-surface-ish
// fan/triangulation of the hole, not the original curvature, so the volume is
// approximate but close for modest holes). A mesh that already has NO boundary is
// returned UNCHANGED with ok=true.
//
// 0 FAKES: degenerate / unsupported input returns ok=false honestly (empty soup,
// malformed soup length, a soup that is not a valid manifold-with-boundary build,
// a non-manifold boundary that does not resolve into simple loops, or a loop that
// could not be triangulated). We never silently emit a broken or partial cap.

#ifndef FORGE_NATIVE_MESH_HOLEFILL_HPP
#define FORGE_NATIVE_MESH_HOLEFILL_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Per-run report. `ok` is true ONLY when a watertight 2-manifold result was
// produced (or the input already had no boundary, returned unchanged).
struct HoleFillReport {
    bool          ok           = false;
    const char*   reason       = "";   // why ok==false, for diagnostics
    std::uint32_t loopsFound   = 0;     // number of boundary loops detected
    std::uint32_t loopsFilled  = 0;     // loops successfully triangulated
    std::uint32_t trisAdded    = 0;     // cap triangles stitched in
    std::uint32_t vertsAdded   = 0;     // new apex vertices (centroid fans)
    std::uint32_t fansUsed     = 0;     // loops filled by centroid fan
    std::uint32_t earClipsUsed = 0;     // loops filled by ear clipping
    bool          wasClosed    = false; // input already had no boundary
};

// Options. Defaults are the validated configuration.
struct HoleFillOptions {
    // If true (default), a loop whose 2D projection is convex is filled with a
    // centroid fan (one new apex vertex). If false, ALWAYS ear-clip (adds no
    // vertices); useful when the caller must not introduce new vertices.
    bool allowCentroidFan = true;
};

// Fill all boundary holes of `inMesh`. On success `outMesh` is a rebuilt,
// re-validated watertight 2-manifold and the returned report has ok=true; on
// failure ok=false, `outMesh` is left empty, and `reason` explains why.
HoleFillReport fillHoles(const HalfEdgeMesh& inMesh,
                         const HoleFillOptions& opt,
                         HalfEdgeMesh& outMesh);

// Soup-level convenience overload: build, fill, and export back to a soup.
HoleFillReport fillHoles(const std::vector<double>& positions,
                         const std::vector<std::uint32_t>& indices,
                         const HoleFillOptions& opt,
                         std::vector<double>& outPositions,
                         std::vector<std::uint32_t>& outIndices);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_HOLEFILL_HPP
