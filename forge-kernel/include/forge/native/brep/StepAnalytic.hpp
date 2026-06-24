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
//   SurfaceKind::Nurbs    -> B_SPLINE_SURFACE_WITH_KNOTS when the NurbsSurface is
//                            populated; otherwise the face is HONESTLY faceted
//                            (the rest of the solid stays analytic).
//
// LOOP MAP: a face's peripheral loop -> FACE_OUTER_BOUND; every inner (hole) loop
// (Face::innerLoops) -> a FACE_BOUND on the same ADVANCED_FACE, so a bored / holed
// face round-trips its holes (the readers rebuild them via addInnerLoopToFace).
//
// EDGE MAP: a straight coedge -> EDGE_CURVE(LINE); an arc lying on the boundary
// of a curved face -> EDGE_CURVE(CIRCLE) when the two endpoints + the parent
// surface frame pin an exact circle; otherwise -> EDGE_CURVE with no geometry
// curve ('*'), which the reader treats as a straight chord (a faithful, never-
// faked degradation that keeps the topology exact even if the curve is implicit).
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
