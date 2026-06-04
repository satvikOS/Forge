#pragma once

// PUSH-18 — One-shot ShapeFix_Shape::Perform() wrapper.
//
// forge::heal::autoRepairSelfIntersection already runs ShapeFix_Shape but
// only surfaces the OCCT DONE bits as booleans. This module exposes the
// full DONE1..8 / FAIL1..8 list as a human-readable log so dashboards can
// show "what got fixed". Returns a fresh ShapeHandle of the fixed shape.

#include "forge/ShapeRegistry.hpp"

#include <string>
#include <vector>

namespace forge::shapefix {

struct RepairResult {
    ShapeHandle              handle = kInvalidHandle;
    std::vector<std::string> log;  // ordered list of fixers that fired
};

// Optional tolerance triple: precision, minTol, maxTol (mm).
// Passing tol == 0 keeps OCCT defaults.
RepairResult repair(ShapeHandle shape,
                    double precision = 0.0,
                    double minTol = 0.0,
                    double maxTol = 0.0);

}  // namespace forge::shapefix
