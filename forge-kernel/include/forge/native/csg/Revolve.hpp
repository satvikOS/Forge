// forge/native/csg/Revolve.hpp
//
// In-house solid-of-revolution constructor — forge::native::csg::revolve.
//
// Sweep a closed, simple 2D profile around an axis line in 3D by a given angle
// to produce a WATERTIGHT, closed 2-manifold forge::native::mesh::HalfEdgeMesh.
// Pure C++20, standard library only. ZERO external deps, no OCCT, no WASM.
//
// REUSE (by #include only — never re-implemented here):
//   * forge/native/Predicates.hpp        — exact orient2d (profile orientation,
//                                           ear-clip triangulation of the caps).
//   * forge/native/geom/Geom.hpp         — Point2 (the profile vertex type).
//   * forge/native/mesh/HalfEdgeMesh.hpp  — Vec3, HalfEdgeMesh, validate(),
//                                           signedVolume() (the output solid).
//
// WHAT IS REAL AND VALIDATED HERE (honest — Bible §0/§9):
//   The profile is a SIMPLE polygon given as an ordered ring of 2D points
//   (u,v): u is the distance ALONG the axis, v is the (signed) distance from the
//   axis (the radial coordinate). The profile is revolved about that axis.
//
//   (1) Full 360° revolve: the side surface is a closed band of quads (one per
//       profile edge per angular segment), triangulated; the band wraps so the
//       first and last angular rings are the SAME ring — no caps, no seam. The
//       result is a closed genus-(0 or 1) 2-manifold.
//
//   (2) Partial revolve (0 < angle < 360): the side band does NOT wrap; the two
//       open ends are capped by two flat copies of the profile polygon, each
//       ear-clip triangulated with the exact orient2d predicate so a non-convex
//       (but simple) profile is handled. The result stays closed and 2-manifold.
//
//   (3) Volume is checked against PAPPUS'S theorem  V = θ · R̄ · A
//       (θ in radians, R̄ = radial centroid distance, A = profile area). The
//       facetised volume converges to the analytic value as `segments` grows;
//       the gate uses a resolution-shrinking tolerance.
//
// ROBUSTNESS POSTURE (do NOT overclaim): robust-in-practice. The COMBINATORIAL
// decisions — profile winding and the cap ear-clip — use the exact orient2d
// predicate so they cannot be corrupted by rounding. Vertex COORDINATES are
// ordinary doubles (sin/cos of the sweep). This is the same honest ceiling the
// rest of the native mesh stack ships.
//
// HONEST ENVELOPE (returns ok=false, never a self-intersecting fake):
//   * profile with < 3 vertices, or zero/near-zero signed area (degenerate);
//   * a profile that is NOT entirely on one side of the axis (some v < 0 and
//     some v > 0) — that would self-intersect through the axis on revolve;
//   * segments < 2 (full) / < 1 (partial), or |angle| outside (0, 360];
//   * any vertex landing on the axis (v == 0) for a partial-angle cap is fine,
//     but a FULL profile touching the axis collapses an edge — reported.
//   NO fallback, no stub: an unsupported input yields ok=false and an empty mesh.

#ifndef FORGE_NATIVE_CSG_REVOLVE_HPP
#define FORGE_NATIVE_CSG_REVOLVE_HPP

#include <vector>

#include "forge/native/geom/Geom.hpp"          // forge::native::geom::Point2
#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh

namespace forge {
namespace native {
namespace csg {

// Axis of revolution: a point on the line and a (non-zero) direction.
struct Axis {
    mesh::Vec3 point;      // any point on the axis line
    mesh::Vec3 direction;  // axis direction (need not be unit; normalised inside)
};

// Outcome of a revolve. `ok` true iff a closed 2-manifold solid was produced.
struct RevolveResult {
    bool             ok{false};
    mesh::HalfEdgeMesh mesh;      // the solid of revolution (empty when !ok)
    const char*      reason{""};  // diagnostic when ok == false
    double           pappusVolume{0.0};  // θ·R̄·A analytic reference (for callers)
    bool             fullRevolution{false};
};

// Revolve a simple 2D profile around `axis` by `angleDeg` degrees (CCW about the
// axis direction by the right-hand rule), using `segments` angular subdivisions
// over the swept angle. `profile2D` is an ordered ring (NOT repeating the first
// point at the end); (x = along-axis u, y = radial v).
//
// Convenience overload taking the axis as (point, dir) Vec3 pair matching the
// task signature revolve(profile2D, axisPoint, axisDir, angleDeg, segments).
RevolveResult revolve(const std::vector<geom::Point2>& profile2D,
                      const mesh::Vec3& axisPoint,
                      const mesh::Vec3& axisDir,
                      double angleDeg,
                      int segments);

// Same, taking a packed Axis.
RevolveResult revolve(const std::vector<geom::Point2>& profile2D,
                      const Axis& axis,
                      double angleDeg,
                      int segments);

} // namespace csg
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_CSG_REVOLVE_HPP
