// forge/native/mesh/Smooth.hpp
//
// SHRINK-FREE Taubin (lambda/mu) MESH SMOOTHING for the in-house Forge native
// kernel. Pure C++20, ZERO external dependencies — no OCCT, no WASM, no third-
// party libs. Uses only the standard library plus the existing forge/native
// mesh half-edge data structure (HalfEdgeMesh.hpp) for the soup<->mesh round
// trip, the connectivity audit, and the signed-volume measure.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS MODULE DOES (Taubin, "A signal processing approach to fair surface
// design", SIGGRAPH 1995):
//
//   A plain Laplacian smoothing pass moves every vertex toward the centroid of
//   its 1-ring neighbours:
//        p_i  <-  p_i + lambda * L(p_i),   L(p_i) = (mean of neighbours) - p_i
//   This is a low-pass filter on the mesh, but with lambda > 0 it has a transfer
//   gain f(k) = (1 - lambda*k) < 1 for every non-zero graph frequency k, so it
//   monotonically shrinks the surface — a sphere collapses toward its centroid.
//
//   Taubin alternates each POSITIVE-lambda (shrinking) pass with a NEGATIVE-mu
//   (un-shrinking) pass, with  mu < -lambda < 0  chosen so the combined two-pass
//   transfer function
//        f(k) = (1 - lambda*k)(1 - mu*k)
//   has a PASS-BAND BOUNDARY  k_PB = 1/lambda + 1/mu > 0  where f(k_PB) = 1:
//   low graph frequencies (k < k_PB, the overall shape) are preserved with gain
//   ~1 while high frequencies (k > k_PB, the noise) are attenuated. The net
//   effect is denoising WITHOUT the volumetric shrinkage of plain Laplacian
//   smoothing — the mean radius of a smoothed sphere is held, while the
//   per-vertex radius VARIANCE (the noise) collapses.
//
//   N full Taubin "passes" here means N (lambda then mu) pairs, i.e. 2N Laplacian
//   sweeps. N == 0 is the IDENTITY (the soup is returned byte-for-byte unchanged).
//
//   The graph Laplacian weighting is UNIFORM (umbrella operator): every 1-ring
//   neighbour contributes equally. This is the operator Taubin analyses and is
//   the only one whose pass-band / shrink-free guarantee follows from the scalar
//   transfer function above; cotangent weights are intentionally NOT used here
//   because their eigenvalues are not bounded into the [0, k_max] range Taubin's
//   mu-selection assumes, so the shrink-free property would no longer be exact.
//
// PRESERVATION GUARANTEES (honest — see Smooth.cpp):
//   * TOPOLOGY / 2-MANIFOLDNESS: smoothing only MOVES vertices; the half-edge
//     connectivity (twin/next/prev/face wiring) is never touched, so a closed
//     2-manifold input yields a closed 2-manifold output by construction. We
//     still re-audit the result through HalfEdgeMesh::buildFromSoup + validate()
//     and only return ok=true if that audit confirms watertight + 2-manifold.
//   * BOUNDARY: boundary vertices (those incident to a boundary half-edge, i.e.
//     a half-edge with no twin) are, by default, PINNED — they are not moved at
//     all, so an open mesh keeps its exact boundary polyline. (Optionally they
//     may be smoothed only along the 1-D boundary curve; see SmoothOptions.)
//   * SHRINK-FREE: with the default lambda/mu the two-pass transfer gain at the
//     low frequencies that carry the bulk shape is ~1, so the mean radius of a
//     smoothed sphere is preserved to well within 1% even after many passes —
//     unlike plain Laplacian, which collapses it.
//
// 0-FAKES (Bible §0/§9): on degenerate or unsupported input (non-manifold soup,
// negative iteration count, a NaN/inf parameter, an out-of-range lambda/mu that
// would not satisfy 0 < lambda < -mu, or an empty mesh with N>0) we return
// ok=false and DO NOT fabricate geometry. ok=true is returned ONLY after the
// result round-trips through HalfEdgeMesh::buildFromSoup + validate() as a real
// 2-manifold mesh (or, for N==0, the unchanged valid input).
//
// ROBUSTNESS POSTURE (honest): this is a linear vertex filter in plain double
// precision. There is no half-edge surgery, so there is nothing for an exact
// predicate to guard — the connectivity is preserved exactly (integer index
// bookkeeping is untouched) and only the double-precision coordinates move. The
// validation gate (watertight 2-manifold in/out, radius-variance collapse,
// mean-radius held within 1%, N==0 identity) is asserted on a fresh random seed.
// ─────────────────────────────────────────────────────────────────────────────

#ifndef FORGE_NATIVE_MESH_SMOOTH_HPP
#define FORGE_NATIVE_MESH_SMOOTH_HPP

#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

// Tuning knobs for the Taubin smoother. Defaults follow Taubin (1995): a small
// positive lambda and a slightly larger-magnitude negative mu so the pass-band
// boundary k_PB = 1/lambda + 1/mu is a small positive frequency.
struct SmoothOptions {
    // Number of FULL Taubin passes (each = one +lambda sweep then one -mu sweep).
    // 0 == identity (input returned unchanged). Must be >= 0.
    int    iterations = 10;

    // Positive shrinking factor (the low-pass step). Must satisfy 0 < lambda.
    double lambda     = 0.330;

    // Negative un-shrinking factor (the high-pass / inflate step). Must satisfy
    // mu < -lambda < 0  (i.e. |mu| > lambda) so the combined filter is shrink-free
    // with a positive pass-band boundary. Default gives k_PB = 1/lambda + 1/mu.
    double mu         = -0.331;

    // If true, boundary vertices (on an open mesh) are smoothed ALONG the 1-D
    // boundary polyline only (their two boundary neighbours), never off it. If
    // false (default), boundary vertices are fully PINNED. Closed meshes have no
    // boundary, so this knob is inert there.
    bool   smoothBoundaryAlongCurve = false;
};

// Diagnostics returned alongside the smoothed soup.
struct SmoothReport {
    bool          ok               = false; // true ONLY for a validated 2-manifold
    const char*   reason           = "";    // why ok==false (for diagnostics)

    std::uint32_t numVertices      = 0;     // V (unchanged by smoothing)
    std::uint32_t numFaces         = 0;     // F (unchanged by smoothing)
    int           passes           = 0;     // Taubin passes actually applied
    int           laplacianSweeps  = 0;     // == 2 * passes

    double        lambda           = 0.0;   // echo of the factors actually used
    double        mu               = 0.0;
    double        passBandFreq     = 0.0;   // k_PB = 1/lambda + 1/mu (> 0)

    double        volumeBefore     = 0.0;   // signed volume in / out (closed mesh)
    double        volumeAfter      = 0.0;

    bool          watertight       = false; // out mesh closed (== in)
    bool          manifold         = false; // out mesh 2-manifold (== in)
    std::uint32_t boundaryVertices = 0;     // # pinned/curve-smoothed boundary verts
    std::uint32_t movedVertices    = 0;     // # interior verts actually relaxed
};

// Taubin-smooth an indexed triangle soup in place into outPositions/outIndices.
//
//   positions    : flat xyz triples (length == 3*numVertices)
//   indices      : flat triangle indices (length == 3*numTriangles)
//   options      : iteration count + lambda/mu + boundary policy
//   outPositions / outIndices : the smoothed soup (only meaningful if ok==true).
//                  The CONNECTIVITY (outIndices) always equals the input indices;
//                  only outPositions move (and not at all when iterations == 0).
//
// Returns a SmoothReport. On ANY failure (bad input, non-manifold soup, negative
// iteration count, a NaN/inf or out-of-band lambda/mu, or an empty mesh with
// iterations > 0) ok==false and the out-soup is left empty — NO geometry is
// fabricated. For iterations == 0 on a valid mesh the input is echoed verbatim
// with ok==true.
SmoothReport taubinSmooth(const std::vector<double>&        positions,
                          const std::vector<std::uint32_t>& indices,
                          const SmoothOptions&              options,
                          std::vector<double>&              outPositions,
                          std::vector<std::uint32_t>&       outIndices);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_SMOOTH_HPP
