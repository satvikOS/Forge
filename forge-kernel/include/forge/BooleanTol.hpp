#pragma once

// PUSH-18 — Tolerant ("fuzzy") boolean operations.
//
// The standard BRepAlgoAPI_{Fuse,Cut,Common} ops in OCCT use a precision
// derived from each operand's tolerance map. For dirty imports (STEP/IGES
// with mis-matched edge tolerances, sloppy STL conversions, …) the
// operation can fail with "BOPAlgo_GeomAdmissible" or leave hanging
// faces. The fuzzy variant calls BRepAlgoAPI_BooleanOperation::SetFuzzyValue
// (an additional global tolerance, in millimetres) before .Build(), giving
// the algorithm slack to coalesce coincident-within-tolerance entities.
//
// The functions here are siblings to forge::{fuse,cut,common} from
// Booleans.hpp and return a fresh ShapeHandle on success. They throw
// std::runtime_error on real OCCT failure — no swallowing.

#include "forge/ShapeRegistry.hpp"

namespace forge::booleantol {

ShapeHandle fuse(ShapeHandle a, ShapeHandle b, double fuzz);
ShapeHandle cut(ShapeHandle a, ShapeHandle b, double fuzz);
ShapeHandle common(ShapeHandle a, ShapeHandle b, double fuzz);

} // namespace forge::booleantol
