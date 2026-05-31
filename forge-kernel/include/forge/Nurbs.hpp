#pragma once

// Forge-36 — NURBS surface authoring on top of the OCCT B-rep kernel.
//
// `buildNurbsPatch` lifts a 2D control-point grid into a Geom_BSplineSurface
// and wraps it in BRepBuilderAPI_MakeFace. `trimNurbsFace` constrains the
// face to a UV trim wire. `sewNurbsFaces` stitches a list of free patches
// into a single shell using BRepBuilderAPI_Sewing. `refineNurbs` rebuilds
// the underlying BSpline at a higher degree using
// ShapeUpgrade_ShapeDivideContinuity. `evalSurface` reports point + first
// derivatives + Gauss/mean curvature via BRepAdaptor_Surface D2.
// `intersectSurfaces` cuts two NURBS faces with BRepAlgoAPI_Section.
// `projectPointToSurface` falls back on GeomAPI_ProjectPointOnSurf to find
// the closest UV/point on the underlying surface. `classAAnalyse` returns
// a curvature summary that Class-A surfacing QA panels can render as a
// scalar field.
//
// Every function returns a ShapeHandle into the global ShapeRegistry, so
// the JS side never sees a TopoDS_Shape pointer. Errors surface as
// std::invalid_argument / std::runtime_error and are converted to JS
// Errors by binding.cpp's safe() wrapper.

#include <array>
#include <cstdint>
#include <vector>

#include "forge/ShapeRegistry.hpp"

namespace forge { namespace surfacing {

// ---------- types --------------------------------------------------------

// A control point grid is stored row-major (u runs fastest in OCCT's
// TColgp_Array2OfPnt convention). `uCount * vCount` entries of 3 doubles.
struct ControlGrid {
    std::uint32_t uCount;
    std::uint32_t vCount;
    std::vector<double> xyz;        // length = uCount * vCount * 3
};

// Surface evaluation report — point, first derivatives, unit normal,
// Gauss + mean curvature at the requested (u, v).
struct SurfaceEval {
    std::array<double, 3> point;
    std::array<double, 3> du;
    std::array<double, 3> dv;
    std::array<double, 3> normal;
    double gaussian;
    double mean;
};

// `projectPointToSurface` result.
struct PointOnSurface {
    double u;
    double v;
    std::array<double, 3> point;
    double distance;
};

// Class-A QA summary — extreme curvatures, average curvature, and an
// isophote bucket count that scales with surface fairness.
struct ClassASummary {
    double minK;
    double maxK;
    double avgK;
    std::uint32_t isophoteCount;
};

// ---------- public API ---------------------------------------------------

// Build a Geom_BSplineSurface from a 2D control grid. Knot vectors default
// to uniform clamped (Bezier-multiplicity at the boundary). `uDegree` and
// `vDegree` default to 3 (cubic). Custom knot vectors must satisfy the
// usual NURBS knot-count invariants:
//     uKnots.size() = uCount + uDegree + 1
//     vKnots.size() = vCount + vDegree + 1
ShapeHandle buildNurbsPatch(const ControlGrid& grid,
                            std::uint32_t uDegree = 3,
                            std::uint32_t vDegree = 3,
                            const std::vector<double>& uKnots = {},
                            const std::vector<double>& vKnots = {});

// Cut a NURBS face with a 2D trim wire expressed in the face's UV space.
// The trim wire is supplied as a flat vector of (u, v) pairs (2*N
// doubles); when fewer than 3 points are supplied the call is rejected.
ShapeHandle trimNurbsFace(ShapeHandle face, const std::vector<double>& trimUV);

// Sew a list of free NURBS faces into a single shell with
// BRepBuilderAPI_Sewing. The result is registered as a fresh handle.
ShapeHandle sewNurbsFaces(const std::vector<ShapeHandle>& faces,
                          double tolerance = 1e-3);

// Refine a NURBS face by increasing the underlying BSpline degree.
// `uTimes` / `vTimes` are added to the current degrees.
ShapeHandle refineNurbs(ShapeHandle face, std::uint32_t uTimes, std::uint32_t vTimes);

// Evaluate position + first derivatives + curvature at parametric (u, v).
SurfaceEval evalSurface(ShapeHandle face, double u, double v);

// Intersect two faces and register the resulting compound of intersection
// edges. Internally we use BRepAlgoAPI_Section which copes with both
// analytic and free-form surfaces.
ShapeHandle intersectSurfaces(ShapeHandle faceA, ShapeHandle faceB);

// Project a 3D point onto a face and report the nearest (u, v) + point.
PointOnSurface projectPointToSurface(ShapeHandle face,
                                     double px, double py, double pz);

// Class-A surfacing QA: sample the face on a regular UV grid and return
// the curvature spread + an isophote-bucket count. A "perfect" sphere or
// plane will register a tight (minK ≈ maxK) range with a single isophote
// bucket — the canonical Class-A reference.
ClassASummary classAAnalyse(ShapeHandle face, std::uint32_t samples = 16);

}}  // namespace forge::surfacing
