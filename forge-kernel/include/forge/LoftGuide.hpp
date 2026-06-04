#pragma once

// PUSH-18 — Guided loft via BRepOffsetAPI_ThruSections.
//
// OCCT's ThruSections natively accepts an ordered list of section wires
// (and optionally point-sections as TopoDS_Vertex). It does *not* accept
// arbitrary guide curves the way GeomFill_NSections does — those live in
// forge::part::loftWithGuides. This module exposes the ThruSections path
// with `solid` and `ruled` toggles, and treats guide edges as supplemental
// vertex-sections sampled at uniform u along each guide so the surface
// passes through each guide's sample points.
//
// For a pure loft (no guides), `guideEdges` may be empty. The result is
// always a single ShapeHandle pointing at the ThruSections output.

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <vector>

namespace forge::loftguide {

// `profileWires`: ordered list of TopoDS_Wire ShapeHandles.
// `guideEdges`:    optional TopoDS_Edge ShapeHandles whose endpoints (or
//                  midpoints, if requested) get added as point-sections
//                  between the profile wires to nudge the loft surface.
// `solid`:         true → closes the ends into a solid; false → shell.
// `ruled`:         true → straight rulings between sections (no smoothing);
//                  false → BSpline-smoothed surface (default).
ShapeHandle loft(const std::vector<ShapeHandle>& profileWires,
                 const std::vector<ShapeHandle>& guideEdges,
                 bool solid,
                 bool ruled = false);

}  // namespace forge::loftguide
