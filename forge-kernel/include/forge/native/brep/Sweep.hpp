// forge/native/brep/Sweep.hpp
//
// In-house linear sweep / extrude-along-path for the Forge native kernel.
// Pure C++20, ZERO external dependencies — no OCCT, no WASM, no third-party
// libs. Builds ONLY on the existing forge/native headers:
//
//   * forge/native/Predicates.hpp        — exact orient2d for ear-clipping.
//   * forge/native/geom/Geom.hpp         — Point2 / Point3 value types.
//   * forge/native/mesh/HalfEdgeMesh.hpp — Vec3 + the half-edge solid we emit
//                                          (buildFromSoup / validate /
//                                          signedVolume).
//
// WHAT THIS IS (honest scope — Bible §0 / KERNEL_INHOUSE_ROADMAP):
//   An OCCT-class linear sweep ("BRepPrimAPI_MakePrism" generalised to a
//   polyline spine, i.e. "BRepOffsetAPI_MakePipeShell" restricted to a polyline
//   path with a fixed cross-section). A SIMPLE closed 2D profile — one CCW outer
//   loop plus zero or more CW hole loops — is swept along a 3D polyline path and
//   meshed into a WATERTIGHT, 2-MANIFOLD triangle solid:
//
//     * Side walls: every profile edge sweeps a quad per path segment, split
//       into two triangles with globally consistent (outward) winding.
//     * Caps: the start and end cross-sections are ear-clip triangulated using
//       the EXACT orient2d predicate (no tolerance decides an ear), the start
//       cap wound inward (CW seen from outside) and the end cap outward, so the
//       solid closes.
//
//   For a single straight segment the result is exactly a PRISM: a square
//   profile swept a distance L has volume == area * L to within rounding.
//   Profiles with holes keep their genus (a square-with-square-hole tube swept
//   straight is a genus-0 closed shell of two nested prisms joined by caps).
//
// PARALLEL TRANSPORT (multi-segment paths):
//   Interior path vertices use the ANGLE-BISECTOR (miter) plane between the two
//   incident segment directions, and the profile frame is carried along the
//   spine by a rotation-minimising (double-reflection) transport so the tube
//   does not spuriously twist. The cross-section is scaled into the miter plane
//   so consecutive segment walls meet edge-to-edge (watertight).
//
// HONEST LIMITS (return ok=false — never a fake result):
//   * A degenerate path (fewer than 2 distinct points, a zero-length segment,
//     or a 180-degree reversal where the miter plane is undefined) -> ok=false.
//   * A SELF-INTERSECTING path (any two non-adjacent segments crossing, or an
//     adjacent pair folding back) -> ok=false: the swept tube would self-overlap
//     and could not be a clean 2-manifold.
//   * A NON-SIMPLE profile (outer loop not simple / not CCW, a hole not simple /
//     not CW, a hole touching the outer or another hole, fewer than 3 vertices)
//     -> ok=false.
//   * A sharp miter whose section would be scaled past a self-overlap
//     (turn angle approaching 180 degrees relative to the section size)
//     -> ok=false.
//   Nothing here silently "repairs" bad input; the validity of the EMITTED solid
//   is additionally re-checked with HalfEdgeMesh::validate() before ok is set.

#ifndef FORGE_NATIVE_BREP_SWEEP_HPP
#define FORGE_NATIVE_BREP_SWEEP_HPP

#include <cstdint>
#include <vector>

#include "forge/native/geom/Geom.hpp"          // Point2, Point3
#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh

namespace forge {
namespace native {
namespace brep {

// A closed 2D profile in the sweep's local sketch plane (the plane the spine
// starts orthogonal to). `outer` MUST be a simple polygon in COUNTER-CLOCKWISE
// order (positive signed area). Each `hole` MUST be a simple polygon in
// CLOCKWISE order (negative signed area) lying strictly inside `outer` and not
// touching any other hole. Loops are given WITHOUT a repeated closing vertex.
struct Profile {
    std::vector<geom::Point2>              outer;
    std::vector<std::vector<geom::Point2>> holes;
};

// Result of a sweep: the emitted half-edge solid plus an honest status.
struct SweepResult {
    bool                ok = false;     // true iff a watertight 2-manifold solid
                                        // was produced from valid input.
    mesh::HalfEdgeMesh  solid;          // the swept solid (only when ok).
    const char*         reason = "";    // why ok == false, for diagnostics.

    // Reported geometry of the emitted solid (only meaningful when ok).
    double              volume = 0.0;   // signed volume (> 0, outward winding).
    double              area   = 0.0;   // total surface area.
    int                 eulerChar = 0;  // V - E + F of the emitted solid.

    // Indexed triangle soup of the emitted solid (mirrors `solid`), so callers
    // that do not want the half-edge structure can still consume the mesh.
    std::vector<double>        positions;  // flat xyz triples
    std::vector<std::uint32_t> indices;    // flat triangle indices
};

// Sweep `profile` along the polyline `path` (>= 2 points), producing a closed
// solid. See the header comment for the validity contract; on ANY invalid input
// the result has ok == false, an explanatory `reason`, and an empty solid.
SweepResult sweep(const Profile& profile,
                  const std::vector<geom::Point3>& path);

// Convenience: a straight prism — sweep `profile` a distance `length` along
// +Z. Equivalent to sweep(profile, {(0,0,0), (0,0,length)}). `length` must be
// strictly positive.
SweepResult prism(const Profile& profile, double length);

// Signed area of a 2D loop (positive == CCW). Exposed because it is the
// reference quantity for the prism volume gate (volume == area * length).
double signedArea(const std::vector<geom::Point2>& loop);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SWEEP_HPP
