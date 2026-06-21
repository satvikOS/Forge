// forge/native/mesh/Parameterize.hpp
//
// In-house UV parameterization of a disk-topology triangle patch —
// forge::native::mesh. Pure C++20, ZERO external dependencies: no OCCT, no WASM,
// no third-party libs, NO external linear-algebra package. Builds ONLY on the
// parallel native headers (#include, never re-implemented):
//   * forge/native/Predicates.hpp        — EXACT orient2d (flip / signed-area test)
//   * forge/native/geom/Geom.hpp         — Point2 / Point3 (interop types)
//   * forge/native/geom/AABBTree.hpp     — (header reuse; soup-BVH neighbour type)
//   * forge/native/mesh/HalfEdgeMesh.hpp — Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate / signedVolume / surfaceArea
//
// WHAT THIS MODULE DOES (REAL + VALIDATED — see test/native/mesh/parameterize_test.cpp)
// ------------------------------------------------------------------------------------
// Given an indexed triangle soup that is a DISK-TOPOLOGY patch — a 2-manifold
// with EXACTLY ONE boundary loop (genus 0, single hole) — parameterize() computes
// a 2D UV coordinate per vertex via the classical Tutte / harmonic embedding:
//
//   (1) Detect the single boundary loop (boundary half-edges are those whose twin
//       is absent, kInvalid). The input is accepted ONLY if there is exactly one
//       such loop and the interior is connected manifold-with-boundary; a closed
//       mesh (no boundary), a mesh with >1 boundary loop, or a non-manifold build
//       is rejected honestly (ok=false).
//
//   (2) FIX the boundary vertices onto a convex polygon — the unit circle —
//       spaced by their accumulated boundary chord length (a convex, injective
//       boundary map). By Tutte's barycentric-embedding theorem, when the boundary
//       is mapped to a convex polygon and every interior vertex is placed at a
//       convex combination of its neighbours, the resulting straight-line drawing
//       is a VALID (flip-free) planar embedding.
//
//   (3) SOLVE the harmonic Laplacian system for the interior UVs — each interior
//       vertex's UV is the weighted average of its neighbours' UVs — by an
//       in-house iterative solver (Gauss-Seidel, with a Jacobi option) run to
//       convergence. NO external linear-algebra dependency. Two weightings:
//         * UNIFORM (Tutte): every neighbour weight 1 — guaranteed convex-combo,
//           hence a guaranteed flip-free embedding (the theorem's hypothesis).
//         * COTANGENT (harmonic): the discrete Laplace–Beltrami weights, which
//           minimise Dirichlet energy and reproduce an AFFINE map exactly on a
//           flat patch (lowest distortion). Cotangent weights of a well-shaped
//           patch are positive, so the embedding is still flip-free in practice;
//           on a badly-shaped patch a negative weight could in principle flip a
//           triangle — we VERIFY the result and report it rather than assume it.
//
//   (4) VALIDATE the embedding: every triangle's signed UV area is checked with
//       the EXACT orient2d predicate (never a float tolerance). `allPositive` is
//       true iff no triangle flipped (a valid Tutte embedding). For a flat planar
//       patch we additionally measure the affine/conformal distortion and report
//       it (a flat patch maps to an affine image — near-zero distortion).
//
// GUARANTEE (honest): for a disk patch with the UNIFORM (Tutte) weighting and the
// convex circular boundary, the produced UV map is a proven-class flip-free
// embedding — and we re-check every triangle's orientation with the exact
// predicate, so `report.allPositive` is a verified fact, not a hope. The COTANGENT
// weighting is the low-distortion harmonic map; it is flip-free for well-shaped
// input and we report `allPositive` honestly when it is not. Coordinates of the
// UVs are ordinary doubles produced by the iterative solve (the solve is to a
// convergence tolerance, NOT exact arithmetic); the FLIP CLASSIFICATION is exact.
//
// 0 FAKES: non-disk input (closed mesh / multiple boundary loops / non-manifold /
// empty / malformed soup / a degenerate boundary with < 3 vertices) returns
// ok=false honestly with a reason. We never emit a partial or guessed UV map.

#ifndef FORGE_NATIVE_MESH_PARAMETERIZE_HPP
#define FORGE_NATIVE_MESH_PARAMETERIZE_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// A 2D UV coordinate.
struct UV {
    double u = 0.0;
    double v = 0.0;
};

// Neighbour weighting for the harmonic Laplacian system.
enum class ParamWeight {
    Uniform,    // Tutte barycentric: every neighbour weight 1 (guaranteed convex
                // combination -> proven flip-free embedding). DEFAULT.
    Cotangent   // discrete Laplace-Beltrami (cotangent) weights: minimal Dirichlet
                // energy, reproduces an affine map exactly on a flat patch.
};

// Which boundary shape the (convex) boundary loop is fixed to. The unit circle is
// convex and is the canonical Tutte boundary; the unit square is also convex.
enum class ParamBoundary {
    Circle,     // unit circle, arc-length spaced (DEFAULT)
    Square      // unit square [-1,1]^2 perimeter, chord-length spaced
};

// Iterative-solver kind for the interior system. Both converge to the same
// harmonic solution; Gauss-Seidel is faster (in-place updates).
enum class ParamSolver {
    GaussSeidel,   // in-place sweeps (DEFAULT)
    Jacobi         // simultaneous updates (double-buffered)
};

struct ParamOptions {
    ParamWeight   weight     = ParamWeight::Uniform;
    ParamBoundary boundary   = ParamBoundary::Circle;
    ParamSolver   solver     = ParamSolver::GaussSeidel;
    // Convergence: stop when the maximum per-vertex UV update across a sweep falls
    // below `tol`, or after `maxIters` sweeps (whichever first).
    double        tol        = 1e-10;
    std::uint32_t maxIters   = 20000;
};

// Per-run report. `ok` is true ONLY when a UV was produced for every vertex from a
// validated single-boundary disk patch.
struct ParamReport {
    bool          ok            = false;
    const char*   reason        = "";   // why ok==false, for diagnostics

    std::uint32_t numVertices   = 0;
    std::uint32_t numBoundary   = 0;    // boundary-loop vertex count
    std::uint32_t numInterior   = 0;
    std::uint32_t numFaces      = 0;

    std::uint32_t iterations    = 0;    // solver sweeps performed
    double        residual      = 0.0;  // final max per-vertex update (< tol on converge)
    bool          converged     = false;

    // EXACT flip audit (orient2d on every UV triangle):
    bool          allPositive   = false; // no flipped triangle (valid embedding)
    std::uint32_t numFlipped    = 0;     // triangles with non-positive signed UV area
    std::uint32_t numZeroArea   = 0;     // triangles exactly collinear in UV (orient2d==0)

    // Distortion diagnostics (meaningful for a flat / near-flat patch):
    //   maxAreaRatioDev — max | (uvArea/uvTotal) - (xyzArea/xyzTotal) | over faces,
    //   the area-distortion of the map. ~0 for an affine image of a flat patch.
    double        maxAreaRatioDev = 0.0;
    double        uvTotalArea      = 0.0; // total |signed UV area| (should ~= pi for circle, fully covered)
};

// Compute UVs for `inMesh`. On success `outUV` has one entry per mesh vertex (in
// vertex-index order) and the report has ok=true; on failure ok=false, `outUV` is
// left empty, and `reason` explains why.
ParamReport parameterize(const HalfEdgeMesh& inMesh,
                         const ParamOptions& opt,
                         std::vector<UV>& outUV);

// Soup-level convenience overload: build the half-edge mesh, parameterize, return
// the per-vertex UVs (vertex-index order matches the input `positions`).
ParamReport parameterize(const std::vector<double>& positions,
                         const std::vector<std::uint32_t>& indices,
                         const ParamOptions& opt,
                         std::vector<UV>& outUV);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_PARAMETERIZE_HPP
