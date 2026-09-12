// ============================================================================
// forge/ArcHelix.hpp — the two geometry backends the ARC and HELIX feature-tree
// ops need, and nothing else.
//
// WHY A SEPARATE HEADER. Both entry points exist ONLY when the candidate flag
// FORGE_FT_ARCHELIX is on. Keeping them out of Features.hpp means the flag-OFF
// build of that header is byte-identical to what it was, so the "OFF reproduces
// the previous kernel exactly" claim does not depend on reading a diff.
//
// WHAT THEY ARE FOR (measured over the 17,900 BenchCAD GT programs):
//
//   helixWire      — cq.Wire.makeHelix appears in 405 rows (torsion_spring 171,
//                    worm_screw 157, pan_head_screw 53, bolt 24) and is ALWAYS a
//                    sweep SPINE, never a standalone body. A polyline standing in
//                    for it is a tessellation, i.e. exactly the lossy substitution
//                    this work exists to delete, so the helix is built as a true
//                    pcurve on a cylinder — the same construction CadQuery uses.
//
//   sweepProfileAlongWire
//                  — the consumer. The GT profile is NOT perpendicular to the
//                    helix tangent (the lead angle is 10.1 deg on worm_screw), so
//                    a sweep that re-frames the profile onto the spine tangent
//                    would shrink the swept section by cos(lead) ~ 1.6% — inside
//                    the 5% volume gate and therefore SILENT. The profile is
//                    placed by an EXPLICIT rigid transform instead, the same
//                    rotate-about-origin-then-translate composition every other
//                    op in the feature tree is placed by.
// ============================================================================
#pragma once

#ifdef FORGE_FT_ARCHELIX

#include "forge/ShapeHandle.hpp"
#include "forge/Sketcher.hpp"

namespace forge {
namespace archelix {

// A true helical WIRE: pitch (rise per turn), height (total axial rise), radius,
// about the axis through `center` along `dir`. `lefthand` reverses the winding.
// Returns a ShapeHandle wrapping a TopoDS_Wire — a loft/sweep spine, NOT a solid.
//
// Construction is CadQuery's, term for term (cadquery/occ_impl/shapes.py
// Wire.makeHelix): a straight line in the (u,v) parameter domain of a
// Geom_CylindricalSurface, trimmed to n_turns * sqrt((2pi)^2 + pitch^2), lifted
// to 3D with BRepLib::BuildCurves3d. Matching the reference implementation is
// the point: the corpus gate scores this against the STEP that same call exports.
//
// Throws std::invalid_argument on pitch <= 0, height <= 0, radius <= 0 or a
// degenerate axis.
ShapeHandle helixWire(double pitch, double height, double radius,
                      double cx, double cy, double cz,
                      double ax, double ay, double az,
                      bool lefthand);

// Sweep a Z=0 sketch profile along an arbitrary WIRE spine.
//
// The profile is first placed by `rotDeg` about the axis (rx,ry,rz) THROUGH THE
// WORLD ORIGIN and then translated by (tx,ty,tz) — identical in meaning and in
// order to the IR's own ROTATE + TRANSLATE, so the caller computes the placement
// exactly once and it means the same thing everywhere.
//
// `frenet` selects BRepOffsetAPI_MakePipeShell's Frenet law (cq's isFrenet);
// the transition mode is RightCorner, which is CadQuery's default ("right").
//
// Throws std::runtime_error if the pipe shell does not build or does not close
// into a solid — never returns a shell pretending to be one.
ShapeHandle sweepProfileAlongWire(SketchHandle profile, ShapeHandle pathWire,
                                  double rotDeg, double rx, double ry, double rz,
                                  double tx, double ty, double tz,
                                  bool frenet);

}  // namespace archelix
}  // namespace forge

#endif  // FORGE_FT_ARCHELIX
