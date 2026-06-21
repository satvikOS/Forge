// forge/native/mesh/Repair.hpp
//
// In-house comprehensive mesh repair toward a clean watertight 2-manifold —
// forge::native::mesh::Repair. Pure C++20, ZERO external dependencies: no OCCT,
// no WASM, no third-party libs. Builds ONLY on the parallel native headers
// (#include, never re-implemented):
//   * forge/native/Predicates.hpp        — exact orient2d (ear-clip in-plane test)
//   * forge/native/geom/Geom.hpp         — Point2 / Point3 / Hull / convexHull2D
//   * forge/native/mesh/HalfEdgeMesh.hpp — Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate / signedVolume
//
// WHAT THIS MODULE DOES (REAL + VALIDATED — see test/native/mesh/repair_test.cpp)
// --------------------------------------------------------------------------------
// Given an indexed triangle SOUP that is dirty in the usual ways a scanned /
// imported / Archie-emitted mesh is dirty, repairMesh() drives it toward a clean
// CLOSED 2-MANIFOLD by running, in order:
//
//   (1) VERTEX WELD — near-duplicate vertices (positions within `weldEps`) are
//       merged using a uniform spatial hash (grid cell = weldEps). Coincident and
//       within-eps vertices collapse to a single representative; every face index
//       is remapped. This is what stitches a "triangle soup" (each triangle
//       carrying its own copies of shared corners) back into a shared-vertex mesh
//       so edges can have twins at all.
//
//   (2) DROP DEGENERATE — triangles that, AFTER welding, reference a repeated
//       vertex (a == b, etc.) OR whose area is <= `areaEps` (sliver / zero-area)
//       are removed. These can never be part of a valid 2-manifold.
//
//   (3) DEDUPE FACES — exact-duplicate faces (the SAME unordered vertex triple
//       appearing more than once, in any rotation/reflection) are collapsed to a
//       single face; a doubled face is a classic non-manifold defect.
//
//   (4) CONSISTENT WINDING — per CONNECTED COMPONENT (faces joined through shared
//       undirected edges), a BFS propagates a reference orientation: a neighbor
//       that traverses the shared edge in the SAME direction as the current face
//       is flipped, so across the whole component every interior undirected edge
//       is used once in each direction. After propagation each closed component is
//       globally flipped if needed so its signed volume is POSITIVE (outward
//       winding). Counts the flips.
//
//   (5) FILL SMALL HOLES — remaining boundary loops (undirected edges incident to
//       exactly one face) up to `maxHoleEdges` are sealed with an EAR-CLIP fan in
//       the loop's best-fit plane (ear/containment tests decided by the EXACT
//       orient2d predicate, never a float tolerance), wound to seal consistently
//       with the surrounding surface. Larger loops are left (and reported), so the
//       result is honestly reported as not-watertight rather than guessed.
//
// Finally it REBUILDS a HalfEdgeMesh from the cleaned soup and the caller (and our
// gate) independently re-audits validate().isValid().
//
// GUARANTEE (honest): a sphere "soup" with duplicated vertices, a few flipped
// faces, and a small boundary hole is repaired to a WATERTIGHT 2-MANIFOLD
// (validate().isValid()) whose enclosed volume is within a few percent of the
// clean sphere, with consistent OUTWARD winding (signedVolume > 0). An already
// clean closed 2-manifold is returned UNCHANGED with ok=true and ZERO repairs.
//
// 0 FAKES: degenerate / unsupported input returns ok=false honestly (empty soup,
// malformed soup length, an index out of range, a result that could not be rebuilt
// into a valid manifold — e.g. a genuinely non-manifold soup like two triangles
// sharing one directed edge, or a hole too large to fill within maxHoleEdges). We
// never silently emit a broken or partial result and call it ok.

#ifndef FORGE_NATIVE_MESH_REPAIR_HPP
#define FORGE_NATIVE_MESH_REPAIR_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Options. Defaults are the validated configuration.
struct RepairOptions {
    // Vertices within this Euclidean distance are welded to one representative.
    // Must be > 0. The spatial-hash cell size equals this value.
    double weldEps = 1e-7;
    // Triangles with area <= this (after welding) are dropped as degenerate.
    // Must be >= 0.
    double areaEps = 1e-14;
    // Boundary loops with at most this many edges are filled; larger loops are
    // left open (and reported via holesLeftOpen). Must be >= 3 to fill anything.
    std::uint32_t maxHoleEdges = 200;
    // If true (default), after winding propagation each closed connected component
    // is globally oriented so its signed volume is positive (outward). If false,
    // only RELATIVE consistency within a component is enforced.
    bool orientOutward = true;
};

// Per-run report. `ok` is true ONLY when a watertight 2-manifold result was
// produced (or the input was already a clean closed 2-manifold, returned
// unchanged). Every count is of the repair actually performed.
struct RepairReport {
    bool          ok            = false;
    const char*   reason        = "";   // why ok==false, for diagnostics

    std::uint32_t vertsWelded   = 0;    // input verts removed by welding (in - out)
    std::uint32_t trisDropped   = 0;    // degenerate / zero-area triangles removed
    std::uint32_t dupFacesRemoved = 0;  // exact-duplicate faces collapsed
    std::uint32_t facesFlipped  = 0;    // faces reoriented for consistent winding
    std::uint32_t holesFilled   = 0;    // boundary loops sealed
    std::uint32_t holeTrisAdded = 0;    // triangles added to fill holes
    std::uint32_t holesLeftOpen = 0;    // boundary loops too large to fill

    std::uint32_t components    = 0;    // connected components found (post-clean)

    std::uint32_t vertsIn  = 0, vertsOut = 0;
    std::uint32_t facesIn  = 0, facesOut = 0;

    bool          wasClean     = false; // input was already a clean closed manifold
    bool          totalRepairs() const {
        return vertsWelded || trisDropped || dupFacesRemoved || facesFlipped ||
               holesFilled || holeTrisAdded;
    }
};

// Repair an indexed triangle soup. On success `outPositions`/`outIndices` hold a
// rebuilt, re-validated watertight 2-manifold and the returned report has
// ok=true; on failure ok=false, the outputs are left empty, and `reason`
// explains why. When the input is already a clean closed 2-manifold the outputs
// equal the input soup and report.wasClean / totalRepairs()==0.
RepairReport repairMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        const RepairOptions& opt,
                        std::vector<double>& outPositions,
                        std::vector<std::uint32_t>& outIndices);

// Convenience overload that also returns the rebuilt HalfEdgeMesh (only valid
// when the report's ok==true; left empty otherwise).
RepairReport repairMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        const RepairOptions& opt,
                        HalfEdgeMesh& outMesh);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_REPAIR_HPP
