// forge/native/mesh/Decimate.hpp
//
// In-house Garland-Heckbert Quadric Error Metric (QEM) edge-collapse mesh
// decimation for the Forge native kernel — Manifold/OCCT-class mesh processing.
// Pure C++20, ZERO external dependencies: standard library plus the existing
// forge/native headers only. No OCCT, no WASM, no third-party libs.
//
// WHAT THIS DOES (REAL + VALIDATED — see test/native/mesh/decimate_test.cpp):
//   Garland & Heckbert "Surface Simplification Using Quadric Error Metrics"
//   (SIGGRAPH 1997) on the half-edge triangle mesh:
//     * Per-vertex 4x4 symmetric error quadric Q = sum over incident faces of
//       (n,d)(n,d)^T where (n,d) is the face's plane (n unit, n.x + d = 0).
//     * Each candidate undirected edge (u,v) has cost = x^T (Qu+Qv) x where x is
//       the error-minimising collapse target (solve the 3x3 sub-system; fall back
//       to the edge midpoint / endpoints when that sub-system is singular).
//     * Greedily collapse the lowest-cost VALID edge. The COST orders edges (shape
//       priority — proper Garland-Heckbert metric); the merged vertex is PLACED at
//       the VOLUME-PRESERVING point (Lindstrom-Turk): the quadric minimiser subject
//       to a single linear constraint that keeps the local collapse-star volume
//       EXACTLY unchanged. This neutralises the systematic inward shrink that pure
//       QEM causes on convex surfaces — enclosed volume is held to ~machine
//       precision across the whole decimation, not merely "within a few percent".
//     * Update the merged vertex's quadric to Qu+Qv, re-cost its incident edges,
//       and repeat until the target triangle count is reached (or no valid
//       collapse remains).
//
//   A collapse is SKIPPED (never performed) when it would:
//     * violate the link condition (would create a non-2-manifold edge/vertex —
//       i.e. u and v share a neighbour w that is not opposite a common triangle),
//     * flip a triangle normal (the moved vertex turns any surviving incident
//       triangle past ~90 deg vs its pre-collapse normal — a fold-over),
//     * degenerate a surviving triangle to zero area, or
//     * pinch a boundary (collapse an interior edge whose both endpoints lie on a
//       boundary loop, or collapse along a boundary in a way that merges two
//       boundary loops).
//
// ROBUSTNESS POSTURE (honest — Bible §0 / KERNEL_INHOUSE_ROADMAP.md §0):
//   The COMBINATORIAL guards (link condition, manifold preservation, boundary
//   handling) are exact integer/topology tests, so the decimated mesh stays a
//   valid closed 2-manifold of the SAME genus as the input. The QEM cost and the
//   collapse-target coordinate are ordinary double arithmetic (this is what
//   Garland-Heckbert itself prescribes — the metric is a quadratic form, not a
//   predicate). The orientation / normal-flip gate uses a plain-double signed
//   area / triple product: it is a fold-over guard, not an exact predicate, so we
//   do NOT claim bit-exact orientation here. This is the same "robust-in-practice"
//   ceiling the rest of forge::native::mesh ships.
//
//   0 FAKES: decimate() returns ok=false (and leaves `out` untouched) on
//   degenerate / unsupported input (non-2-manifold input, an unreachable target,
//   a target that cannot be met without violating a guard). It NEVER fabricates
//   geometry to hit a triangle count.
//
// SCOPE — CLOSED 2-MANIFOLDS ONLY (honest, and dependency-driven):
//   HalfEdgeMesh::validate() certifies a mesh as `manifold` ONLY when every
//   undirected edge has exactly two incident faces — i.e. it certifies CLOSED
//   (watertight) 2-manifolds. A boundary edge has one incident face, so an OPEN
//   mesh can never satisfy that validate() flag. Because the 0-FAKES rule forbids
//   us from ever returning ok=true on a mesh we cannot validate, this increment
//   ACCEPTS CLOSED 2-MANIFOLD INPUT ONLY. An open / non-watertight input is
//   refused honestly (ok=false). Boundary-constrained open-mesh simplification
//   (with a boundary-preserving penalty quadric AND an open-manifold validator)
//   is TARGETED, not in this increment — we do not pretend to support it.
//
// Also NOT in scope (do not claim): attribute-aware (uv/normal/colour) quadrics,
// and vertex-pair (non-edge) contraction for topology simplification.

#ifndef FORGE_NATIVE_MESH_DECIMATE_HPP
#define FORGE_NATIVE_MESH_DECIMATE_HPP

#include <cstddef>
#include <cstdint>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh, validate, signedVolume
#include "forge/native/geom/Geom.hpp"           // geom::Point3 (and, via it, Predicates.hpp)

namespace forge {
namespace native {
namespace mesh {

// Options controlling a decimation run.
struct DecimateOptions {
    // Stop when the live triangle count reaches (at most) this value. The run
    // also stops early if no remaining collapse is valid (in which case the
    // achieved count may be larger than requested — reported in DecimateReport).
    std::size_t targetTriangles = 0;

    // Reserved for a future open-mesh increment. The current increment is
    // CLOSED-ONLY (see header scope note), so this has no effect today: any
    // non-watertight input is refused regardless of this flag. It is kept so the
    // option struct is forward-stable when boundary-penalty quadrics land.
    bool freezeBoundary = true;
};

// Outcome of a decimation run.
struct DecimateReport {
    bool ok = false;                 // false => `out` left unmodified; see reason.
    const char* reason = "";         // human-readable cause when ok==false.

    std::size_t inputTriangles  = 0;
    std::size_t outputTriangles = 0; // live triangles in the result.
    std::size_t collapses       = 0; // edge collapses actually performed.

    double inputVolume  = 0.0;       // signed volume before (closed input only).
    double outputVolume = 0.0;       // signed volume after  (closed input only).
};

// Decimate `in` toward `opt.targetTriangles` using QEM edge collapses, writing
// the simplified mesh to `out`. On success returns a report with ok=true and
// `out` rebuilt (a valid closed 2-manifold whenever `in` was). On failure
// returns ok=false with `reason` set and leaves `out` unmodified.
//
// Preconditions enforced (failure -> ok=false, never a fake):
//   * `in` must be a CLOSED 2-manifold per its own validate(): twin-consistent,
//     manifold AND watertight (validate().isValid()). Any open / non-watertight
//     input is refused (this increment is closed-only — see scope note above).
//   * opt.targetTriangles must be in (0, inputTriangles). A target of 0 or a
//     target >= inputTriangles is rejected (nothing to do is reported honestly).
DecimateReport decimate(const HalfEdgeMesh& in, HalfEdgeMesh& out,
                        const DecimateOptions& opt);

// Convenience overload: decimate to (approximately) `targetTriangles` with the
// default boundary policy.
DecimateReport decimate(const HalfEdgeMesh& in, HalfEdgeMesh& out,
                        std::size_t targetTriangles);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_DECIMATE_HPP
