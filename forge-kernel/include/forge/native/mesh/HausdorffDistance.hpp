// forge/native/mesh/HausdorffDistance.hpp
//
// In-house SAMPLED Hausdorff / surface-deviation distance between two triangle
// meshes — forge::native::mesh. Pure C++20, standard library only. NO OCCT,
// NO WASM, NO third-party libs. Builds ONLY on the existing forge native
// headers (by #include), never re-implementing what they already provide:
//   * forge/native/geom/Geom.hpp        (Point3 — geom interop)
//   * forge/native/geom/AABBTree.hpp    (closestPoint over a triangle soup)
//   * forge/native/mesh/HalfEdgeMesh.hpp (Vec3, the triangle-soup vertex type)
//
// PURPOSE (mesh-comparison QA — "how far did the surface move?"):
//   Given two meshes A and B (each an indexed triangle soup), measure how far
//   the surface of A lies from the surface of B. This is the bread-and-butter
//   metric of mesh QA: comparing a decimated / remeshed / repaired mesh against
//   its original, validating a reconstruction, or gauging a manufacturing scan
//   against nominal CAD.
//
//   The classical (continuous) Hausdorff distance between surfaces S_A and S_B
//   is
//       H(A,B) = max( h(A,B), h(B,A) ),
//       h(A,B) = sup_{a in S_A} inf_{b in S_B} |a - b|.
//   The inner inf_{b} |a-b| is exactly the closest-point distance from a to the
//   surface of B — which geom::AABBTree::closestPoint computes O(log n). The
//   outer sup over the *entire continuous* surface of A is what makes the exact
//   value hard; we approximate it by a DENSE, controllable SAMPLING of A's
//   surface (every vertex plus a barycentric grid of face samples). This is the
//   same honest posture as Metro / MeshLab's Hausdorff filter and CloudCompare's
//   C2M distance: a SAMPLED estimate, not a proven bound.
//
// WHAT IS REAL AND VALIDATED (see test/native/mesh/hausdorffdistance_test.cpp):
//   (H1) IDENTICAL meshes  -> Hausdorff ~ 0 and mean ~ 0 (< sampling eps).
//   (H2) Sphere radius R vs radius R+d (concentric) -> directed and symmetric
//        Hausdorff ~ d AND mean ~ d, within a sampling tolerance that SHRINKS as
//        the sample count rises (so the limit is real, not a tuned constant).
//   (H3) A locally-BUMPED copy of a mesh -> Hausdorff ~ the bump height (it is a
//        sup — driven by the single worst point), while the mean stays small
//        (the bump is local). The argmax sample lands AT the bump.
//   (H4) REFINEMENT: raising the sampling density reduces the estimate's
//        run-to-run variance and tightens the estimate toward ground truth.
//
// HONEST ENVELOPE (do NOT overclaim — Bible §0):
//   * This is a ONE-SIDED-and-symmetric SAMPLED estimate. The reported Hausdorff
//     is a LOWER bound on the true continuous Hausdorff (a finite sample can only
//     under-estimate a sup). The bound tightens as `facesSamples` rises; we
//     report the achieved sampling density so the caller can reason about it.
//   * The closest-point side is EXACT for the sampled points (AABBTree returns
//     the true nearest point on the target triangle soup, plain IEEE-754 double).
//   * Degenerate / unsupported input is reported via ok=false — NEVER papered
//     over: empty soup, indices not a multiple of 3, index out of range,
//     non-finite coordinate, or a soup the target AABBTree refuses to build
//     (e.g. it contains a zero-area triangle) all yield ok=false.

#ifndef FORGE_NATIVE_MESH_HAUSDORFFDISTANCE_HPP
#define FORGE_NATIVE_MESH_HAUSDORFFDISTANCE_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/geom/Geom.hpp"          // Point3 (geom interop)
#include "forge/native/geom/AABBTree.hpp"       // closestPoint over a triangle soup
#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3 — the triangle-soup vertex type

namespace forge {
namespace native {
namespace mesh {

// One triangle soup, as the indexed form the rest of the kernel speaks.
//   positions : flat xyz triples, length == 3*numVertices
//   indices   : flat triangle indices, length == 3*numTriangles
struct SoupRef {
    const std::vector<double>&        positions;
    const std::vector<std::uint32_t>& indices;
};

// How densely to sample a source surface before querying the target.
//   Every source VERTEX is always sampled. In addition, each source TRIANGLE is
//   sampled at `facesSamples` interior barycentric points laid on a regular
//   sub-triangle grid (0 => vertices only). Higher density tightens the sup
//   estimate (H4) at O(n) cost. The default is a sensible mesh-QA density.
struct HausdorffParams {
    std::uint32_t facesSamples = 6;  // interior barycentric samples per source face
};

// One directed sampled distance  h(src -> dst) = max over src samples of the
// closest-point distance to dst's surface, plus the mean over those samples and
// the worst-case (argmax) sample for diagnostics / bump localisation.
struct DirectedDistance {
    double     maxDistance  = 0.0;   // the directed Hausdorff h(src,dst) (a sup)
    double     meanDistance = 0.0;   // average closest-point distance over samples
    double     rmsDistance  = 0.0;   // root-mean-square closest-point distance
    Vec3       argmaxPoint{};        // the src sample achieving maxDistance
    Vec3       argmaxClosest{};      // its closest point ON dst's surface
    std::size_t sampleCount = 0;     // how many src samples were evaluated
};

// Symmetric result. `hausdorff` = max of the two directed maxima.
struct HausdorffResult {
    bool   ok = false;               // false (and all else 0) on degenerate input

    double hausdorff = 0.0;          // symmetric: max(aToB.max, bToA.max)
    double meanDistance = 0.0;       // symmetric mean: sample-weighted mean of both
    double rmsDistance  = 0.0;       // symmetric RMS over all samples of both sides

    DirectedDistance aToB;           // h(A -> B)
    DirectedDistance bToA;           // h(B -> A)

    // Honest reporting of the sampling that produced the estimate.
    std::size_t totalSamples = 0;    // aToB.sampleCount + bToA.sampleCount
    double      meanSampleSpacing = 0.0;  // avg distance between adjacent samples
                                          // (a coarse bound on the sup under-estimate)
    const char* reason = "";         // why ok==false, for diagnostics
};

// ---------------------------------------------------------------------------
// Directed sampled distance  h(src -> dst).
//   Samples src (every vertex + `params.facesSamples` barycentric face samples)
//   and, for each sample, finds its closest point on dst via geom::AABBTree.
//   Returns ok=false on degenerate src/dst (see header top). The dst tree is
//   built internally; pass a prebuilt tree via the overload below to share it.
// ---------------------------------------------------------------------------
bool directedHausdorff(const SoupRef& src, const SoupRef& dst,
                       const HausdorffParams& params,
                       DirectedDistance& out);

// Same, but against a PREBUILT target tree (amortise the build across both
// directions / many sources). `dst` must already be built (non-empty); if it is
// empty this returns false.
bool directedHausdorff(const SoupRef& src, const geom::AABBTree& dstTree,
                       const HausdorffParams& params,
                       DirectedDistance& out);

// ---------------------------------------------------------------------------
// Symmetric sampled Hausdorff distance between meshes A and B.
//   hausdorff = max( h(A,B), h(B,A) ); also reports the symmetric mean / RMS and
//   the achieved sampling density. ok=false (everything zeroed) on degenerate
//   input on either side — never papered over.
// ---------------------------------------------------------------------------
HausdorffResult hausdorffDistance(const SoupRef& a, const SoupRef& b,
                                  const HausdorffParams& params = {});

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_HAUSDORFFDISTANCE_HPP
