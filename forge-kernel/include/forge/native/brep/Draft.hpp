// forge/native/brep/Draft.hpp
//
// In-house injection-molding DRAFT operation for the Forge native kernel —
// forge::native::brep::Draft. Pure C++20, ZERO external dependencies (no OCCT,
// no WASM, no third-party libs). Builds ONLY on the existing forge/native
// headers (by #include — it does NOT re-implement any of them):
//   * forge/native/Predicates.hpp        (robust orient3d — degeneracy oracle)
//   * forge/native/geom/Geom.hpp          (Point2/Point3, the canonical geom
//                                          point types — reuse surface)
//   * forge/native/geom/AABBTree.hpp      (reuse surface — spatial-query stack)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate — the topology this runs on)
//   * forge/native/mesh/FeatureEdges.hpp  (reuse surface — feature/topology stack)
//   * forge/native/mesh/TriTriIntersect.hpp (reuse surface — intersection stack)
//
// WHAT THIS MODULE DOES (honest scope, Bible §0):
//   Applies a DRAFT (taper) angle to a set of selected mesh faces relative to a
//   PULL DIRECTION P and a NEUTRAL PLANE (a point Q on the plane; the plane's
//   normal is the pull direction). This is the mold-design draft: the selected
//   walls are tilted so the part can be ejected. Concretely, for a drafted face
//   whose outward normal is m, every vertex of that face is displaced TANGENT to
//   the neutral plane (it slides ALONG the neutral plane — never along P) by
//
//       delta = - h * tan(angle) * t̂
//
//   where h = P·(v - Q) is the vertex's signed height above the neutral plane
//   measured along the pull direction, and t̂ is the unit in-neutral-plane
//   component of the face's outward normal m (i.e. m with its P-component
//   removed, normalized). A vertex shared by several drafted faces accumulates
//   the per-face contributions, so a top corner of a box (touched by two side
//   walls) draws inward in BOTH wall directions and the top shrinks correctly.
//
//   GEOMETRIC GUARANTEE (the validated envelope, see draft_test.cpp):
//     For an AXIS-ALIGNED, PLANAR, prismatic wall that is PERPENDICULAR to the
//     neutral plane (the canonical box-side case: pull = +Z, neutral = bottom),
//     after drafting by `angle` degrees:
//       * the drafted face is tilted by exactly `angle` about its intersection
//         line with the neutral plane, so the face normal now makes (90 - angle)
//         degrees with the pull direction (within 1e-6),
//       * vertices ON the neutral plane (h == 0) do NOT move (the bottom ring is
//         unchanged exactly),
//       * vertices at height h move inward by h·tan(angle) along the wall's
//         in-plane normal, so the top ring of a box shrinks by 2·h·tan(angle)
//         per side (each top corner is pulled by its two adjacent walls),
//       * the mesh stays watertight, 2-manifold, and consistently wound.
//
//   HONEST ENVELOPE & REFUSALS (0 FAKES — see header note below and the gate):
//     A face PARALLEL to the pull direction in the sense of m being PARALLEL to
//     P (a horizontal cap, |m·P| == |m|) has NO in-plane normal component — there
//     is no well-defined draft tangent — so such a face is NOT drafted (its
//     contribution is identity); it is reported as `skippedParallel`. angle == 0
//     is an exact identity (no displacement). Inputs that the kernel cannot build
//     (out-of-range / repeated-vertex / inconsistently-wound soup), a non-finite
//     coordinate, a zero-length pull direction, a |angle| >= 90, a face index out
//     of range, or a result that fails to re-build as a 2-manifold are all
//     reported via ok == false with a human-readable reason — never papered over.
//
//   This DISPLACEMENT-FIELD draft is exact for prismatic walls perpendicular to
//   the neutral plane (the dominant mold-design case and the validated envelope).
//   For a wall that is already oblique to P it still applies the honest tangent
//   displacement, but the resulting angle-to-pull is only guaranteed to equal
//   (90 - angle) for the perpendicular-prismatic case; the gate asserts the
//   guarantee only inside that envelope, and the API reports the achieved angle
//   per drafted face so a caller can verify. Anything beyond a per-vertex
//   displacement (e.g. silhouette/parting-line split drafting, variable draft)
//   is TARGETED and intentionally absent from this increment.
//
// ROBUSTNESS POSTURE (honest — Bible §0): the displacement is a plain IEEE-754
// double evaluation of an exact closed form. The COMBINATORIAL decisions (which
// faces have a usable in-plane tangent; whether the rebuilt soup is a closed
// 2-manifold) are topological/sign decisions, and orient3d (Predicates.hpp) is
// used only as an oracle to reject a zero-area triangle before its normal is
// trusted. This is "robust-in-practice with exact predicates", the same honest
// ceiling as the rest of forge::native — NOT an exact (rational) kernel.

#ifndef FORGE_NATIVE_BREP_DRAFT_HPP
#define FORGE_NATIVE_BREP_DRAFT_HPP

#include <cstdint>
#include <string>
#include <vector>

#include "forge/native/Predicates.hpp"            // exact orient3d (degeneracy)
#include "forge/native/geom/Geom.hpp"             // Point2/Point3 (reuse surface)
#include "forge/native/geom/AABBTree.hpp"         // reuse surface (spatial stack)
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // Vec3, HalfEdgeMesh, validate
#include "forge/native/mesh/FeatureEdges.hpp"     // reuse surface (feature stack)
#include "forge/native/mesh/TriTriIntersect.hpp"  // reuse surface (intersect)

namespace forge {
namespace native {
namespace brep {

// Per-drafted-face diagnostic. `faceIndex` indexes the input triangle soup
// (the i-th triangle = indices[3i..3i+2]). `anglePullDeg` is the angle (in
// DEGREES) between this face's OUTWARD normal and the pull direction AFTER the
// draft; for a perpendicular-prismatic wall drafted by `angle` this is
// (90 - angle) within 1e-6. `drafted` is false (and the face left identity) when
// the face has no usable in-neutral-plane tangent (normal parallel to pull) or
// angle == 0.
struct DraftFaceInfo {
    std::uint32_t faceIndex = 0;
    double anglePullDeg = 0.0;     // angle(outward normal, pull) AFTER draft, deg
    bool   drafted = false;        // false => left identity (parallel / angle 0)
    bool   skippedParallel = false;// true => normal was parallel to pull
};

// Result of a draft. `mesh` is meaningful only when ok == true; when ok is false
// `reason` explains why honestly and `mesh` is left empty.
struct DraftResult {
    bool ok = false;
    std::string reason;
    mesh::HalfEdgeMesh mesh;

    // Per-selected-face diagnostics (one entry per requested face index, in the
    // requested order). Populated only when ok == true.
    std::vector<DraftFaceInfo> faces;

    // Convenience read-outs (valid only when ok). `volume` is the signed volume
    // of the (closed) drafted solid; `area` its total surface area; `numDrafted`
    // the count of faces actually tilted (excludes parallel / angle-0 skips).
    double volume = 0.0;
    double area = 0.0;
    std::uint32_t numDrafted = 0;
};

// Apply a DRAFT of `angleDeg` degrees to the selected `faceIndices` of the
// triangle soup (positions: flat xyz, length 3*V; indices: flat triangle
// indices, length 3*T), relative to:
//   pullDir      : the mold-pull direction (need not be unit; must be non-zero).
//                  The neutral plane's normal is this direction.
//   neutralPoint : any point ON the neutral plane (vertices on this plane,
//                  measured along pullDir, do not move).
//
// A POSITIVE angle tapers the wall INWARD on the +pull side (the standard draft
// that shrinks the far end so the part releases). `angleDeg` must satisfy
// |angleDeg| < 90 (a draft of 90 deg would lay the wall flat — refused).
//
// Returns ok == false with a reason for any degenerate / unsupported input
// (see header-top envelope). Never throws.
DraftResult applyDraft(const std::vector<double>& positions,
                       const std::vector<std::uint32_t>& indices,
                       const std::vector<std::uint32_t>& faceIndices,
                       const mesh::Vec3& pullDir,
                       const mesh::Vec3& neutralPoint,
                       double angleDeg);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_DRAFT_HPP
