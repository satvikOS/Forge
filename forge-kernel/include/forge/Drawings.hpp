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
};

// projectShape — run HLR for `direction` and return the three polyline
// lists. Throws std::runtime_error on HLR failure. If HLR produces no
// visible polylines (some OCCT versions need tessellation before HLR
// will see curved faces), we tessellate first and re-run.
ProjectedView projectShape(ShapeHandle h, ProjectionDirection direction);

} // namespace forge
