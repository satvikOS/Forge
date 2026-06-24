// forge/native/brep/DraftAnalytic.hpp
//
// K-series ANALYTIC FACE DRAFT (mold-release taper about a NEUTRAL PLANE) on the
// Forge native ANALYTIC B-rep (Topology/Surface/MassProps/Sew) — the REAL B-rep
// draft, the analytic SIBLING of ChamferAnalytic.hpp / FilletAnalytic.hpp, NOT the
// mesh-bridge vertex-displacement taper that Draft.cpp builds on the triangle
// HalfEdgeMesh. Same analytic B-rep family, same honest scope discipline.
//
// WHAT IT DOES (the genuine analytic draft / OCCT BRepOffsetAPI_DraftAngle analogue):
//   For a uniform draft angle `alpha` about a NEUTRAL PLANE, it tilts a set of
//   PLANAR SIDE faces of a prismatic solid:
//     * Each selected side face PIVOTS about its intersection LINE with the neutral
//       plane (the line where that face meets the neutral plane stays fixed). The
//       face rotates by `alpha` about that pivot line, leaning IN (positive alpha,
//       the mold-release direction) so the wall tapers toward the pull direction.
//     * A vertex of a drafted face at signed height h above the neutral plane is
//       displaced TANGENT to the neutral plane, into the material, by h*tan(alpha):
//       its in-plane offset from the pivot line shrinks by h*tan(alpha). A vertex ON
//       the neutral plane (h == 0) does not move; the pivot line is fixed.
//     * Where two drafted side faces meet, their shared vertical edge is re-trimmed
//       to the NEW mutual intersection of the two tilted planes (the surface-surface
//       intersection line of the two drafted planes — here computed in closed form
//       since both stay planar). The top/bottom CAP faces are NOT tilted; the top
//       cap shrinks because its boundary corners follow the drafted walls inward.
//   The re-trimmed (tilted) side faces + the unchanged caps are assembled (K1.4 sew
//   semantics — every edge mated by two opposite-sense coedges) into an updated
//   closed 2-manifold Solid whose mass the analytic MassProps integrator measures
//   EXACTLY (every face is PLANAR, so the polygon-moment path is bit-exact).
//
//   RESULT for the canonical box [0,L]^3 drafted on all 4 side faces about the base
//   plane z=0 by alpha: a square FRUSTUM (truncated pyramid). At height z the cross-
//   section is a square of side  s(z) = L - 2 z tan(alpha)  (each of the two opposite
//   walls leans in by z tan(alpha)). The drafted VOLUME is therefore the exact
//   integral of the linearly-shrinking cross-section:
//       V = ∫_0^L (L - 2 z tan(alpha))^2 dz
//         = L^3 ( 1 - 2 L t + (4/3) L^2 t^2 ) / 1   with t = tan(alpha)/L scaled,
//   i.e. the standard square-frustum volume (h/3)(A_b + A_t + sqrt(A_b A_t)) with
//   A_b = L^2, A_t = (L - 2 L t)^2, h = L. Each drafted face makes angle exactly
//   `alpha` with the original VERTICAL wall (and 90-alpha with the neutral plane).
//
// HONEST SCOPE (Bible §0/§9 — REAL, no MVP/stub/fake; explicit boundary):
//   THIS INCREMENT: PLANAR side faces of a prismatic solid, a SINGLE neutral plane,
//   a UNIFORM draft angle alpha (the same on every drafted face), with the pull
//   direction == the neutral-plane normal. The canonical gate drafts all 4 side
//   faces of a box about its base.
//   EXPLICIT FOLLOW-UPS (NOT built here, surfaced in `reason`, never faked):
//     * CURVED side faces (a cylinder/cone wall drafts to a cone/curved taper, not a
//       plane — the intersection with neighbours is then a conic, not a line),
//     * PER-FACE / variable draft angle (a different alpha on each wall),
//     * a NEUTRAL CURVE / parting line that is not a planar section,
//     * drafting only a SUBSET of the walls of a closed box (leaves a non-prismatic
//       remnant whose re-trim needs general SSI, not the box-symmetric closed form).
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native brep
// headers only). No OCCT, no WASM. ADDITIVE: a brand-new header + TU; Topology /
// Surface / MassProps / Sew are NOT edited. CONVENTIONS: namespace
// forge::native::brep.

#ifndef FORGE_NATIVE_BREP_DRAFTANALYTIC_HPP
#define FORGE_NATIVE_BREP_DRAFTANALYTIC_HPP

#include <vector>

#include "forge/native/brep/Topology.hpp"   // Point3, Solid, TopologyBuilder, Surface
#include "forge/native/brep/Surface.hpp"    // Vec3 helpers, SurfaceKind

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// AnalyticDraftResult — the drafted solid + the analytic diagnostics a caller /
// A/B harness inspects (mirrors AnalyticChamferResult / AnalyticFilletResult).
// ---------------------------------------------------------------------------
struct AnalyticDraftResult {
    bool   ok = false;
    Solid* solid = nullptr;     // the drafted closed 2-manifold solid (owned by tb)

    // The drafted (tilted) planar SIDE faces, in selection order.
    std::vector<Face*> draftedFaces;

    // The analytic draft geometry, reported for verification.
    double angleDeg = 0.0;      // the draft angle alpha (uniform)
    double neutralZ = 0.0;      // signed height of the neutral plane along the pull dir
    int    numDrafted = 0;      // how many side faces were tilted

    // The achieved angle (degrees) between each drafted face and the ORIGINAL
    // vertical wall it replaced (should equal alpha for every drafted face). Same
    // order as draftedFaces.
    std::vector<double> faceAngleVsVerticalDeg;

    const char* reason = "";
};

// ---------------------------------------------------------------------------
// draftBoxAnalytic — build the analytic uniform-angle face draft of an axis-
// aligned box [0,L]^3, tilting ALL FOUR side faces about the base NEUTRAL PLANE
// z=0 (pull direction +Z) by `alphaDeg`, on the analytic B-rep. `tb` owns the
// resulting topology/geometry. The bottom cap (z=0) is the neutral section and is
// unchanged; the top cap (z=L) shrinks as its corners follow the drafted walls.
//
// Requires L > 0 finite and 0 < alphaDeg < arctan(L/(2L)) bound so the top cross-
// section stays positive (s(L) = L - 2 L tan(alpha) > 0  =>  tan(alpha) < 1/2);
// alpha must be in (0, 90) and is rejected (with a `reason`) when the taper would
// collapse the top face. Returns the closed drafted Solid (a square frustum) + the
// diagnostics. `ok` is false (with a `reason`) for any out-of-scope input — never a
// faked/broken solid.
//
// Box vertex / face layout (matches FilletAnalytic.hpp / ChamferAnalytic.hpp /
// Topology::buildBox):
//   bottom face z=0 ring  v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0)
//   top    face z=L ring  v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)
// The four SIDE faces (front y=0, right x=L, back y=L, left x=0) are tilted; the
// two CAP faces (bottom z=0, top z=L) stay planar.
// ---------------------------------------------------------------------------
AnalyticDraftResult draftBoxAnalytic(TopologyBuilder& tb,
                                     double L, double alphaDeg);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_DRAFTANALYTIC_HPP
