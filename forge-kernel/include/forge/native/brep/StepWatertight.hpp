// forge/native/brep/StepWatertight.hpp
//
// K6 WATERTIGHT-SOUP keystone for the FOREIGN STEP reader (StepRead.cpp).
//
// The foreign reader builds each ADVANCED_FACE INDEPENDENTLY (its own densified
// boundary + analytic surface) and then SEWS the faces (Sew.hpp) — welding
// coincident boundary vertices and sharing edges. The mass-properties path
// (MassProps.cpp) integrates each face ANALYTICALLY, so it never needs a mesh.
// But every ORIENTATION oracle (deciding whether a face's normal points OUT of
// the material) needs a WATERTIGHT triangle soup: a ray/parity or generalized-
// winding-number (GWN) probe leaks through cracks and reads ~0 at an interior
// point even for a correctly-built part.
//
// The decisive realization this file rests on: the sew already makes the shell an
// oriented 2-manifold — every welded edge is shared by exactly TWO coedges in
// OPPOSITE traversal order. So if we tessellate every face by FANNING its sewn
// boundary loops IN COEDGE-TRAVERSAL ORDER using the SHARED welded vertices, then
// (a) every boundary segment between two consecutive welded loop vertices is used
// by exactly two faces with opposite direction — the soup is WATERTIGHT with no
// geometric cracks; and (b) the whole triangle set is a consistently-oriented
// closed 2-cycle, so the GWN of an interior point is +/-1 EXACTLY (independent of
// the fan surface chosen, by Stokes: a face's contributed solid angle depends only
// on its oriented boundary loop, which the fan reproduces vertex-for-vertex).
//
// This is the OCCT-free, additive keystone: a brand-new header+TU that REUSES
// Topology.hpp (Vertex/Edge/Coedge/Loop/Face/Shell/Solid) and Surface.hpp (the
// Vec3 helpers + Surface::normalAt/evaluate). It does NOT edit the topology, the
// sew, or the mass integrator. Pure C++20 + stdlib. namespace forge::native::brep.

#ifndef FORGE_NATIVE_BREP_STEPWATERTIGHT_HPP
#define FORGE_NATIVE_BREP_STEPWATERTIGHT_HPP

#include <cstddef>

#include "forge/native/brep/Topology.hpp"   // Solid / Shell / Face / Loop / Coedge / Vertex
#include "forge/native/brep/Surface.hpp"    // Vec3 + Surface

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// WatertightReport — the watertightness self-test signature of a tessellated
// soup. `freeEdges`/`nonManifoldEdges` are counted over the LOOP-BOUNDARY edges
// of the tessellation (an undirected welded-vertex pair used by != 2 face uses is
// a free/non-manifold edge), and `wnCentroid` is the generalized winding number
// of the soup's vertex centroid over the oriented triangle set. A WATERTIGHT,
// consistently-oriented soup has freeEdges == 0 and |wnCentroid| ~= 1.
// ---------------------------------------------------------------------------
struct WatertightReport {
    std::size_t faces = 0;             // faces tessellated
    std::size_t triangles = 0;         // fan triangles emitted
    std::size_t boundaryEdges = 0;     // distinct undirected loop-boundary edges
    std::size_t freeEdges = 0;         // boundary edges used by != 2 face-uses
    std::size_t nonManifoldEdges = 0;  // boundary edges used by > 2 face-uses
    double      wnCentroid = 0.0;      // GWN at the soup vertex centroid
    double      wnBestInterior = 0.0;  // cleanest near-integer |GWN| over interior probes
    int         interiorNearOne = 0;   // # probe points reading |GWN| ~= 1
    int         interiorSamples = 0;   // # probe points evaluated
    int         orientationConflicts = 0; // BFS shared-edge orientation clashes (0 = orientable)
    bool        watertight = false;    // freeEdges==0 && nonManifoldEdges==0 && interior |GWN|~=1
};

// Probe the WELDED soup: fan every face's SEWN loops (outer + holes) in coedge-
// traversal order using the shared welded vertices, then measure the free-edge
// count and the interior GWN. This is the watertight tessellation the reorienter
// consumes; on a topologically-closed part it reports freeEdges==0, |wn|~=1.
WatertightReport probeWatertightWelded(const Solid& solid);

// Probe a NAIVE per-face soup (the "before"): each CURVED analytic face is meshed
// on an INDEPENDENT (u,v) parameter grid over its own trim rectangle, planar faces
// are fanned. Adjacent faces sample their shared curved edge on DIFFERENT grids, so
// the union has geometric cracks — the free-edge count is high and the interior GWN
// collapses toward 0 even for a topologically-closed part. This is the contrast
// that proves the welded soup is a genuine watertightness improvement.
WatertightReport probeWatertightNaive(const Solid& solid);

// ---------------------------------------------------------------------------
// ReorientResult — the outcome of the GWN face-reorientation pass.
// ---------------------------------------------------------------------------
struct ReorientResult {
    int    faces = 0;         // faces considered
    int    flipped = 0;       // faces whose Surface::reversed was toggled
    double wnSign = 0.0;      // global orientation sign of the welded soup (+/-1)
    bool   reliable = false;  // the welded soup was watertight enough to trust
};

// STEP 2 (reorientation, EXPERIMENTAL — keep OFF by default). Using a BFS-
// consistently-oriented welded soup as an orientation-independent oracle, set each
// face's Surface::reversed so its analytic outward normal agrees with the material
// EXTERIOR (a point stepped along the normal that lands OUTSIDE the soup — GWN ~= 0
// — confirms the normal points out; one that lands INSIDE means it points in, so the
// flag is toggled). It is a NO-OP unless the soup is CLOSED (0 free / non-manifold
// loop edges), cleanly ORIENTABLE (0 BFS conflicts) and has a clean interior winding
// number — so an open/degenerate shell is never corrupted; it mutates ONLY
// Surface::reversed.
//
// MEASURED CAVEAT (gpt56 corpus, 2026-07-21): this does NOT currently improve foreign
// A/B parity and must stay behind its env flag. The orientation-defective targets
// (111/120/117/202/207) are all OPEN shells (the sew leaves 48..328 free loop edges),
// so the oracle is UNAVAILABLE for exactly them; and on the few closed+orientable
// parts that DO qualify, the per-face GWN vote occasionally mis-flips a face, nudging
// parity 63 -> 62. The watertight substrate below (Step 1) is the bankable result;
// this is the honest next-step consumer + its negative finding, left dormant.
ReorientResult reorientByGWN(const Solid& solid);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_STEPWATERTIGHT_HPP
