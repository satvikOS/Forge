// forge/native/brep/Loft.hpp
//
// In-house OCCT-class LOFT / SKIN through parallel section polygons — pure
// C++20, ZERO external dependencies (no OCCT, no WASM, no third-party libs).
// Builds ONLY on the existing forge/native headers (HalfEdgeMesh, Geom,
// Predicates) by #include — it does NOT re-implement any of them.
//
// WHAT THIS MODULE DOES (honest scope, Bible §0):
//   Given N >= 2 *parallel* planar section polygons, each with the SAME number
//   of vertices M >= 3 and a CONSISTENT winding, stacked monotonically along a
//   single axis, it stitches a watertight, closed, oriented 2-manifold solid:
//
//     * SIDE BANDS: between every pair of consecutive sections k and k+1, the
//       i-th edge of section k and the i-th edge of section k+1 bound a quad,
//       split into two triangles, wound so its outward normal points away from
//       the solid interior (the skin / lofted surface).
//     * END CAPS: section 0 (bottom) and section N-1 (top) are triangulated
//       with a fan and oriented outward (bottom normal away along -axis, top
//       normal away along +axis), closing the solid.
//
//   The result is validated to be a closed 2-manifold via
//   forge::native::mesh::HalfEdgeMesh::validate().isValid(): every undirected
//   edge is shared by exactly two consistently-wound faces, no boundary.
//
// ROBUSTNESS POSTURE (honest): the per-section *winding/orientation* decision
// is made from the exact orient2d predicate (Predicates.hpp, via the signed
// area sign of the projected loop), so the outward orientation of every face is
// combinatorially correct, never a tolerance guess. Vertex coordinates are
// plain double. This is "robust-in-practice with exact predicates", the same
// honest ceiling as the rest of forge::native — NOT an exact (rational) kernel.
//
// 0 FAKES: every degenerate / unsupported input is reported as ok == false with
// a human-readable reason. Specifically refused (not silently patched):
//   * fewer than 2 sections,
//   * fewer than 3 vertices in a section,
//   * sections with differing vertex counts (mismatched topology),
//   * any section whose projected loop is degenerate (zero signed area:
//     collinear / self-overlapping in its plane),
//   * sections not monotonically separated along a common axis (would
//     self-intersect / fail to be a simple loft),
//   * inconsistent section winding (a section reversed relative to the others),
//   * a build that does not come out a closed 2-manifold (surfaced, never faked).

#ifndef FORGE_NATIVE_BREP_LOFT_HPP
#define FORGE_NATIVE_BREP_LOFT_HPP

#include <string>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh, validate
#include "forge/native/geom/Geom.hpp"            // Point2/Point3 + convexHull
#include "forge/native/Predicates.hpp"           // exact orient2d (via Geom)

namespace forge {
namespace native {
namespace brep {

// A single planar section polygon: an ordered ring of 3D points. All sections
// in a loft must share the same size and a consistent winding; the points are
// expected to lie (near) a plane perpendicular to the stacking axis. The ring
// is implicitly closed (last vertex connects back to the first).
struct LoftSection {
    std::vector<mesh::Vec3> points;
};

// Result of a loft. `mesh` is meaningful only when `ok == true`. When ok is
// false, `reason` explains why honestly and `mesh` is left empty.
struct LoftResult {
    bool ok = false;
    std::string reason;
    mesh::HalfEdgeMesh mesh;

    // Convenience geometric read-outs (valid only when ok). `volume` is the
    // signed volume of the closed solid (positive for the outward orientation
    // this builder produces); `area` is total surface area.
    double volume = 0.0;
    double area = 0.0;
};

// Loft / skin through the given parallel sections (in stacking order).
//
//   axisHint : the intended stacking axis (need not be unit; a default of +Z is
//              used when the zero vector is passed). The actual axis is derived
//              from the section centroids and cross-checked against this hint to
//              orient the caps; a hint that disagrees in sign is honored (we
//              follow the geometry, the hint only breaks the degenerate tie of a
//              single-step direction). Passing {0,0,0} means "auto / +Z".
//
// Returns ok == false with a reason for any degenerate / unsupported input
// (see header-top list). Never throws.
LoftResult loftSections(const std::vector<LoftSection>& sections,
                        const mesh::Vec3& axisHint = mesh::Vec3{0, 0, 1});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_LOFT_HPP
