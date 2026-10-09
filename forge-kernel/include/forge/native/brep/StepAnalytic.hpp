// forge/native/brep/StepAnalytic.hpp
//
// In-house ANALYTIC STEP (ISO-10303-21 / AP242) codec for the Forge native
// kernel — forge::native::brep::StepAnalytic. Pure C++20, standard library ONLY.
// No OCCT, no WASM, no third-party libs. write() returns a std::string and
// read() reconstructs a brep::Solid into a caller-provided TopologyBuilder.
//
// ============================ HONESTY (Bible §0/§9) ========================
// THIS IS THE ANALYTIC SIBLING OF StepFaceted. Where StepFaceted serialises a
// triangle MESH (every face a flat PLANE triangle), StepAnalytic serialises the
// real analytic B-rep: each Face carries its OWN analytic Surface (a true
// cylinder stays a CYLINDRICAL_SURFACE, a sphere a SPHERICAL_SURFACE, …), and
// each Edge a real curve (LINE / CIRCLE / B_SPLINE_CURVE). The emitted file is an
// ADVANCED_BREP_SHAPE_REPRESENTATION over a MANIFOLD_SOLID_BREP / CLOSED_SHELL /
// ADVANCED_FACE graph, wrapped in the minimal AP242 product context so it is a
// structurally valid ISO-10303-21 part-21 document.
//
// SURFACE MAP (native -> STEP), 1:1 and EXACT for the quadrics:
//   SurfaceKind::Plane    -> PLANE              (AXIS2_PLACEMENT_3D)
//   SurfaceKind::Cylinder -> CYLINDRICAL_SURFACE(ax2, radius)
//   SurfaceKind::Cone     -> CONICAL_SURFACE    (ax2, ref_radius, half_angle)
//   SurfaceKind::Sphere   -> SPHERICAL_SURFACE  (ax2, radius)
//   SurfaceKind::Torus    -> TOROIDAL_SURFACE   (ax2, major_R, minor_r)
//   SurfaceKind::Nurbs    -> B_SPLINE_SURFACE_WITH_KNOTS when every weight is 1;
//                            otherwise the RATIONAL complex form
//                            (BOUNDED_SURFACE()B_SPLINE_SURFACE(..)
//                             B_SPLINE_SURFACE_WITH_KNOTS(..)...
//                             RATIONAL_B_SPLINE_SURFACE((weights))...) carrying
//                            EVERY weight. A face whose NurbsSurface is incomplete
//                            (or has a non-positive / mis-sized weight) fails the
//                            write — it is never written with its weights dropped.
//                            (T-158: the weights WERE dropped, and the exact
//                            rational 1.5 mm blend read back as 1.590990 mm.)
//
// LOOP MAP: a face's peripheral loop -> FACE_OUTER_BOUND; every inner (hole) loop
// (Face::innerLoops) -> a FACE_BOUND on the same ADVANCED_FACE, so a bored / holed
// face round-trips its holes (the readers rebuild them via addInnerLoopToFace).
//
// EDGE MAP, in priority order (T-158):
//   1. the edge's OWN exact geometry, Edge::curve, when it spans the edge's two
//      vertices: Line -> LINE, Circle -> CIRCLE, Ellipse -> ELLIPSE, Parabola ->
//      PARABOLA, Hyperbola -> HYPERBOLA, BSpline -> B_SPLINE_CURVE_WITH_KNOTS (or
//      its RATIONAL complex form when any weight != 1), with EDGE_CURVE same_sense
//      set from the curve's parameter direction;
//   2. an exact arc INFERRED from an adjacent quadric: a latitude circle about
//      the surface axis, or -- for an edge interior to ONE shared surface (a
//      primitive's iso-parameter tiling) -- a sphere meridian / torus minor circle;
//   3. otherwise a straight LINE between the endpoints. Such a line is exact only
//      when the edge IS straight; the writer checks the chord against BOTH
//      adjacent surfaces and COUNTS the ones it cannot verify in
//      AnalyticWriteResult::edgesChord. A non-zero edgesChord means the solid's
//      producer left Edge::curve empty for a curved edge (the defect is upstream;
//      the count makes it visible rather than silent).
//   No PCURVE / SURFACE_CURVE is emitted: Coedge::pcurve is assigned by no
//   production builder (census in test/step_rational_weights_gate.cpp), so there
//   is nothing truthful to write.
//
// HONESTY POSTURE / 0 FAKES: write() returns ok=false (empty text) if a face has
// no analytic surface AND no faceted fallback is possible (it never emits a
// fabricated surface). read() returns ok=false (and leaves the builder unused)
// on ANY malformed/unsupported input — broken envelope, dangling ref, an
// ADVANCED_FACE whose surface entity it cannot reconstruct, a non-closing loop.
//
// ROUND-TRIP GUARANTEE: write(solid) -> read(...) reconstructs a Solid with the
// SAME faces/edges/vertices (and hence the same analytic volume / COM / inertia
// to ~1e-9, NOT a tessellation tolerance — the cylinder is STILL a cylinder).
// This now INCLUDES B-spline faces (simple and rational: the reader rebuilds the
// NurbsSurface with its weights and inverts the loop vertices for the trim
// window) and the edges' exact curves (read() re-attaches Edge::curve from the
// EDGE_CURVE geometry it understands). Two documented exceptions: a closed
// sphere comes back re-faceted into sectors over the SAME analytic surface, and
// an edge written as a chord (edgesChord > 0) comes back as the chord it is.
// Pinned by test/step_rational_weights_gate.cpp against CLOSED-FORM geometry,
// read back by BOTH this reader and the independent readForeignStep.
//
// B-SPLINE READ BOUNDARY (T-158): read() gives a B-spline face a (u,v)
// RECTANGLE of the knot domain, and accepts the face ONLY when the face IS that
// rectangle: no inner bound, and every loop vertex and boundary-edge sample
// (taken along the edge's file geometry) on the image of one of the rectangle's
// four sides -- the side's free parameter clamped INTO the rectangle, so a point
// on the iso-line v = v0 beyond [u0,u1] does not count. The rectangle is the box
// of the loop vertices inverted onto the surface; on a CLOSED surface (first and
// last iso-lines coincide) a vertex ON the seam is u0 and u1 at once, so it does
// not bound the box, and the face is read only when exactly one of the
// candidate rectangles [ua,hi], [lo,ub], [ua,ub] passes the side test (the
// 270->360 deg wall face of a split B-spline cylinder was read as u[0,0.75],
// ok=1, +50.6 % volume, before this rule). A trimmed or holed B-spline face, and
// a face that crosses a closed surface's seam (it has no rectangle in the knot
// domain), is REFUSED with a reason (importStep then falls through to
// readForeignStep, which carries real trim regions) -- never read as a wrong
// rectangle. Every B-spline face this writer gets from Forge's own builders is
// such a rectangle; a B-spline face IMPORTED with a general trim is not, and is
// outside the guarantee above. (The read rectangle is exact; massProperties()
// integrates it with ONE Gauss rule, which is exact only when no interior knot
// lies inside the rectangle -- a MassProps limit, not this reader's.)
//
// KNOWN PRE-EXISTING VIOLATION (measured, NOT introduced or fixed by T-158): a
// CURVED quadric face whose trim is not its (u,v) rectangle -- the readForeign-
// Step import of a general trimmed cylinder/cone/torus face (Face::regionUV) --
// is also read back as its vertex rectangle, with NO refusal. On the 126-file
// in-tree corpus, 35 of the 42 solids the import ladder reads via
// readForeignStep round-trip write()->read() ok=1 with volume error > 1e-9,
// worst 111.9 % (cadgenbench_81_FINAL_20260702/102); the 18 solids read via
// read() itself round-trip exactly. The written FILE is right (readForeignStep
// re-reads it to ~1e-14); the defect is in read().

#ifndef FORGE_NATIVE_BREP_STEPANALYTIC_HPP
#define FORGE_NATIVE_BREP_STEPANALYTIC_HPP

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

namespace forge {
namespace native {
namespace brep {

// Result of StepAnalytic::write().
struct AnalyticWriteResult {
    bool        ok{false};
    std::string text;    // the ISO-10303-21 document on success
    std::string reason;  // empty on success

    // Provenance of what was written (computed on success). Each topological
    // Edge lands in exactly one of the four edge counters.
    std::size_t rationalSurfaces{0}; // B-spline surfaces written WITH their weights
    std::size_t edgesFromCurve{0};   // written from the edge's own Edge::curve
    std::size_t edgesInferredArc{0}; // CIRCLE inferred from an adjacent quadric
    std::size_t edgesLine{0};        // LINE verified to lie on both adjacent surfaces
    std::size_t edgesChord{0};       // LINE that could NOT be verified: no Edge::curve
                                     // and no exact inference -- a straight chord
};

// Result of StepAnalytic::read(): on success `solid` is a non-owning view into
// `owner` (which keeps the reconstructed topology + surfaces alive). On failure
// both are null and `reason` carries the diagnostic.
struct AnalyticReadResult {
    bool ok{false};
    std::shared_ptr<TopologyBuilder> owner;  // owns the reconstructed topology
    Solid* solid{nullptr};                   // non-owning view into *owner
    std::string reason;                      // empty on success

    // Diagnostics (also computed on success): how many faces used each path.
    std::size_t facesAnalytic{0};  // reconstructed with a real analytic surface
    std::size_t facesPlanar{0};    // PLANE faces
    std::size_t facesNurbs{0};     // B-spline faces (subset of facesAnalytic)
    std::size_t edgesWithCurve{0}; // edges whose Edge::curve was re-attached
};

// ---------------------------------------------------------------------------
// StepAnalytic — the analytic STEP codec. Static methods; no global state.
// ---------------------------------------------------------------------------
class StepAnalytic {
public:
    // Serialize a closed analytic brep::Solid to an AP242 ISO-10303-21 document.
    // `name` is echoed in FILE_NAME. Returns ok=false on a face with no surface
    // (and no fallback) or a structurally broken solid.
    static AnalyticWriteResult write(const Solid& solid,
                                     const std::string& name = "forge_analytic_solid");

    // Parse an analytic STEP document (produced by write(), or an OCCT/AP242
    // analytic export of the supported entity set) back into a brep::Solid.
    // Strict: malformed / unsupported input yields ok=false (0 FAKES).
    static AnalyticReadResult read(const std::string& text);
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_STEPANALYTIC_HPP
