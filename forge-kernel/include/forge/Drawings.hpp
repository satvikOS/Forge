#pragma once

// Drawings — OCCT HLR-based 2D projection of a 3D BREP.
//
// Given a TopoDS_Shape (referenced by a ShapeHandle) and a view direction,
// we run Hidden-Line-Removal via HLRBRep_Algo / HLRBRep_HLRToShape and
// emit three classes of polylines, all in the projection plane's local
// (X, Y) coordinates:
//
//   * visible  — sharp edges that are not occluded by the body
//   * hidden   — sharp edges that *are* occluded (rendered dashed by the UI)
//   * outline  — silhouette edges (the body's apparent contour)
//
// Each polyline is a std::vector< std::pair<double,double> >. The HLR
// output is a TopoDS_Compound of TopoDS_Edges, each of which we
// discretise with GCPnts_QuasiUniformDeflection to keep curved arcs
// faithful at modest vertex counts. Lines are emitted as 2-vertex
// polylines.
//
// This is the C++ side of the Forge engineering-drawings system; the
// JS layer (`frontend/src/kernel/forge/Drawings.js`) builds drawing
// sheets and SVG output on top of these polyline lists.

#include "forge/ShapeRegistry.hpp"

#include <utility>
#include <vector>

namespace forge {

// View direction. The HLR projector looks ALONG +Z of the constructed
// gp_Ax2; we synthesise the Ax2 from (dx, dy, dz) at runtime.
struct ProjectionDirection {
    double dx;
    double dy;
    double dz;
};

// Standard view presets — match SolidWorks / Onshape conventions.
// Front view looks down -Y (so screen X = world X, screen Y = world Z).
// Top view looks down -Z (screen X = world X, screen Y = -world Y).
// Right view looks down -X (screen X = world Y, screen Y = world Z).
ProjectionDirection frontView();
ProjectionDirection topView();
ProjectionDirection rightView();
ProjectionDirection isometricView();

using Polyline2D = std::vector<std::pair<double, double>>;

struct ProjectedView {
    std::vector<Polyline2D> visible;  // V-compound + Rg1LineV + RgNLineV (sharp visible)
    std::vector<Polyline2D> hidden;   // H-compound + Rg1LineH + RgNLineH (sharp hidden)
    std::vector<Polyline2D> outline;  // OutLineV (silhouette visible only)
    std::vector<Polyline2D> cut;      // Cut-face polylines from BRepAlgoAPI_Section (section views only)
    std::vector<Polyline2D> hatch;    // Hatch pattern lines (section views only)
};

// projectShape — run HLR for `direction` and return the three polyline
// lists. Throws std::runtime_error on HLR failure. If HLR produces no
// visible polylines (some OCCT versions need tessellation before HLR
// will see curved faces), we tessellate first and re-run.
ProjectedView projectShape(ShapeHandle h, ProjectionDirection direction);

// ---------------------------------------------------------- Forge-32 extensions
//
// Section / detail / broken view projections — extend the basic HLR
// pipeline with cut-plane intersection (section), polyline-clipping by a
// circle (detail) and a break-region cut-out (broken).

// Section view: plane is defined by a point on the plane (origin) and
// the plane normal. We cut the shape with the plane (BRepAlgoAPI_Section),
// project the cut wires onto the view, and emit a 45°-rotated hatch
// pattern at `hatchSpacing` mm to mark the cut material.
struct SectionPlane {
    double ox, oy, oz;   // a point on the plane
    double nx, ny, nz;   // plane normal (need not be unit-length)
};

struct HatchSpec {
    double spacing;   // distance between hatch lines, mm
    double angleDeg;  // hatch orientation in the projection plane (default 45)
};

ProjectedView projectShapeSection(ShapeHandle h,
                                  ProjectionDirection direction,
                                  SectionPlane plane,
                                  HatchSpec hatch);

// Detail view: project normally, then clip polylines to a focus circle
// (in projection-plane coordinates) and scale by `scale` (typically 2-4×)
// about the circle centre. The returned ProjectedView lives in the
// scaled coordinate system.
struct FocusCircle { double x, y, r; };
ProjectedView projectShapeDetail(ShapeHandle h,
                                 ProjectionDirection direction,
                                 FocusCircle focus,
                                 double scale);

// Broken view: project normally, then *remove* every polyline whose
// midpoint along `axis` (0=X, 1=Y) lies in [start, end], and translate
// everything past `end` back by (end - start). Used to shorten the
// drawing of long parts.
struct BreakRegion {
    int axis;        // 0 = horizontal (X), 1 = vertical (Y) of the projection plane
    double start;    // start coordinate (inclusive)
    double end;      // end coordinate (exclusive)
};
ProjectedView projectShapeBroken(ShapeHandle h,
                                 ProjectionDirection direction,
                                 BreakRegion region);

} // namespace forge
