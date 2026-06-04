#pragma once

// PUSH-18 — Multi-edge, law-driven variable-radius fillet.
//
// forge::part::variableFilletEdge already handles single edges via a
// TColgp_Array1OfPnt2d of (u, r) anchors. This module is the Law_Function
// path: each entry specifies an edge plus a start radius and an end
// radius, and OCCT receives an actual Handle(Law_Linear) (or Law_S for
// smoother blends) so the radius interpolation is C^0 / C^1 as requested.
//
// `edgeIndex` is a 0-based index into the parent shape's TopAbs_EDGE
// traversal order (same convention as forge::part::filletEdges /
// chamferEdges).

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <vector>

namespace forge::varfillet {

struct EdgeSpec {
    std::uint32_t edgeIndex   = 0;
    double        radiusStart = 0.0;
    double        radiusEnd   = 0.0;
};

// `smooth=false` → Law_Linear (linear interpolation between start/end).
// `smooth=true`  → Law_S (S-shaped, C^1 zero-slope at both ends).
ShapeHandle fillet(ShapeHandle solid,
                   const std::vector<EdgeSpec>& specs,
                   bool smooth = false);

}  // namespace forge::varfillet
