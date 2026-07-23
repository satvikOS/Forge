// forge/native/brep/StepWriteOcct.hpp
//
// ANALYTIC STEP WRITE for an OCCT-BACKED TopoDS_Shape — the write-side sibling
// of StepReadOcct (the TKDESTEP-free reader). Serialises the B-rep's REAL
// surfaces and curves to ISO-10303-21 (AP242) directly from the OCCT handle:
//
//   Geom_Plane                    -> PLANE
//   Geom_CylindricalSurface       -> CYLINDRICAL_SURFACE
//   Geom_ConicalSurface           -> CONICAL_SURFACE
//   Geom_SphericalSurface         -> SPHERICAL_SURFACE
//   Geom_ToroidalSurface          -> TOROIDAL_SURFACE
//   Geom_BSplineSurface           -> B_SPLINE_SURFACE_WITH_KNOTS
//                                    (rational -> the COMPLEX record form)
//   Geom_SurfaceOfLinearExtrusion -> SURFACE_OF_LINEAR_EXTRUSION
//   Geom_SurfaceOfRevolution      -> SURFACE_OF_REVOLUTION
//   Geom_Line / Circle / Ellipse / Geom_BSplineCurve -> LINE / CIRCLE /
//       ELLIPSE / B_SPLINE_CURVE_WITH_KNOTS (rational -> COMPLEX)
//   pcurves (BRep_Tool::CurveOnSurface) -> SURFACE_CURVE + PCURVE +
//       DEFINITIONAL_REPRESENTATION 2D records (seam edges carry BOTH), the
//       exact record set StepReadOcct's P0 pcurve binding consumes.
//
// This closes the reader<->writer roundtrip for OCCT-backed handles WITHOUT
// tessellation: previously an OCCT handle could only export through the
// faceted codec, whose triangle soup came from forge::occtmesh — and a
// B-spline-rich solid the native mesher defers on produced an EMPTY
// tessellation, killing the whole export (the CADGenBench edit-roundtrip
// 0/32 blocker).
//
// HONESTY (Bible §0/§9):
//   * A FACE whose surface class cannot be serialised analytically (offset /
//     exotic surfaces GeomConvert cannot approximate either) falls back
//     PER-FACE: that face alone is faceted (planar-triangle ADVANCED_FACEs via
//     the native mesher); the rest of the solid stays analytic. The count is
//     reported in `facetedFaces` — never a silent whole-shape degradation.
//   * An EDGE curve that cannot be serialised fails the WHOLE write with
//     ok=false + reason (the caller keeps its own faceted fallback) — an edge
//     is shared topology; faking it would corrupt both adjacent faces.
//   * A pcurve that cannot be serialised is OMITTED (the reader then falls
//     back to its projection path) — the file never carries a wrong pcurve.
//
// Pure OCCT *modeling* toolkits only (TKBRep/TKG3d/TKGeomBase/TKGeomAlgo/
// TKTopAlgo) — no TKDESTEP/TKXSBase/TKMesh/TKG2d. 2D pcurve geometry is
// inspected through GeomAPI::To3d into the w=0 plane (mirror of the reader's
// To2d trick) so no Geom2d_* concrete-class symbol is referenced.

#ifndef FORGE_NATIVE_BREP_STEPWRITEOCCT_HPP
#define FORGE_NATIVE_BREP_STEPWRITEOCCT_HPP

#ifdef FORGE_NATIVE_BREP

#include <string>

class TopoDS_Shape;

namespace forge {
namespace native {
namespace brep {

struct OcctStepWriteResult {
    bool        ok{false};
    std::string text;          // the ISO-10303-21 document on success
    std::string reason;        // failure diagnostic (empty on success)
    int         facetedFaces{0};  // faces that fell back to per-face faceting
    int         totalFaces{0};
};

class StepWriteOcct {
public:
    // Serialise an OCCT-backed shape (solid / shell / compound of those) to an
    // analytic AP242 document readable by StepReadOcct::foreignStepToOcct.
    static OcctStepWriteResult write(const TopoDS_Shape& shape,
                                     const std::string& name = "forge_occt_solid");
};

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP
#endif // FORGE_NATIVE_BREP_STEPWRITEOCCT_HPP
