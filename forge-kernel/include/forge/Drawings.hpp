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

// ============================================================================
// PUSH-05 — forge::drawings (nested namespace)
//
// Adds a stricter, self-contained 2D drawing surface on top of the same
// HLR pipeline: a View2D struct that pairs polylines with an explicit
// 2D bbox, a SectionView struct that separates the cut-plane intersection
// from the geometry that lies behind it, and two text emitters (DXF / SVG)
// that turn a list of views + dimensions into a portable drawing file.
//
// This is intentionally narrower than the rich `forge::ProjectedView` above:
// it gives the Studio/Forge JS layer exactly what it needs to produce a
// shop drawing (visible + hidden polylines, bbox, section cut, and a
// linear-dimension list), with no detail/broken-view bookkeeping.
//
// Coordinates are in projection-plane mm; (0,0) is the projector origin
// (same convention as projectShape() above). The bbox is computed across
// both visible and hidden buckets.
//
// All four functions live in forge::drawings:
//   * projectView(shape, dir)         — HLR projection in one of FRONT/TOP/RIGHT/ISO.
//   * sectionView(shape, plane)       — cut the shape with `plane` and project
//                                        the intersection wires PLUS the HLR
//                                        of the back half (behindEdges).
//   * emitDXF(views, dimensions)      — AutoCAD R12 DXF text (SECTION/ENTITIES
//                                        with LWPOLYLINE per polyline; LINE for
//                                        each dimension leader).
//   * emitSVG(view)                   — single-view standalone SVG <path> per
//                                        polyline (black 0.35mm visible,
//                                        dashed hidden).
// ============================================================================

#include <TopoDS_Shape.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt2d.hxx>

#include <string>
#include <utility>
#include <vector>

namespace forge {
namespace drawings {

// Polyline2D = sequence of 2D screen-space points.
using Polyline = std::vector<gp_Pnt2d>;

// Standard view direction presets (right-hand world: X right, Y back, Z up).
//   FRONT — camera looks down -Y; screen X = world X, screen Y = world Z.
//   TOP   — camera looks down -Z; screen X = world X, screen Y = world Y.
//   RIGHT — camera looks down -X; screen X = world Y, screen Y = world Z.
//   ISO   — south-east isometric.
enum class ViewDirection { FRONT, TOP, RIGHT, ISO };

// View2D — the projected drawing of one shape from one ViewDirection.
struct View2D {
    std::vector<Polyline> visibleEdges;   // sharp visible edges (HLR V)
    std::vector<Polyline> hiddenEdges;    // sharp hidden edges (HLR H)
    double minX;
    double minY;
    double maxX;
    double maxY;
};

// projectView — run HLR + extract VCompound / HCompound (with outline
// merged into visibleEdges), discretise edges into polylines, and
// compute the 2D bbox. Throws std::runtime_error if shape is null or
// HLR produces no edges at all.
View2D projectView(const TopoDS_Shape& shape, ViewDirection dir);

// SectionView — the cross-section through a cutting plane.
//   sectionEdges = polylines from the intersection of `shape` with the
//                  cutting plane (BRepAlgoAPI_Section).
//   behindEdges  = HLR-visible polylines of the half-space behind the
//                  cutting plane, projected onto the plane.
struct SectionView {
    std::vector<Polyline> sectionEdges;
    std::vector<Polyline> behindEdges;
};

// sectionView — intersect `shape` with `cuttingPlane`, return the cross-
// section outline plus the visible HLR of the back half. The 2D
// coordinate frame is the cutting plane's local (X, Y).
SectionView sectionView(const TopoDS_Shape& shape, gp_Pln cuttingPlane);

// emitDXF — minimal valid AutoCAD R12 ASCII DXF.
//   * Begins with `0\nSECTION\n2\nENTITIES`.
//   * One LWPOLYLINE per polyline, visible on layer "VISIBLE", hidden on
//     layer "HIDDEN" (DXF doesn't natively dash — colour 1 = red is the
//     legacy convention but we use layer name semantics).
//   * `dimensions` is a list of (start, end) point pairs; each emits a
//     plain LINE entity on layer "DIMS".
//   * Ends with `0\nENDSEC\n0\nEOF`.
std::string emitDXF(const std::vector<View2D>& views,
                    const std::vector<std::pair<gp_Pnt2d, gp_Pnt2d>>& dimensions);

// emitSVG — self-contained <svg> with one <path d="M ... L ..."/> per
// polyline. visible: `stroke="black" stroke-width="0.35" fill="none"`.
// hidden:  same plus `stroke-dasharray="2,2"`.
//
// The SVG's viewBox is the view's bbox padded by 5 mm on each side; Y
// is flipped so that screen-Y points down (SVG convention) without
// disturbing the model-space coordinates handed to dimensions / layout.
std::string emitSVG(const View2D& view);

} // namespace drawings
} // namespace forge
