// PUSH-18 — Tolerant ("fuzzy") boolean operations.
//
// Mirrors forge::Booleans but with an extra `fuzz` (mm) value passed to
// BRepAlgoAPI_BooleanOperation::SetFuzzyValue() before .Build(). The
// fuzz value is a *relaxation*: OCCT will consider entities coincident
// when their distance is < (tolerance + fuzz). Use it sparingly — too
// large a value collapses real geometric features.

#include "forge/BooleanTol.hpp"

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <Precision.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

namespace forge::booleantol {

namespace {

template <typename Op>
ShapeHandle runFuzzy(ShapeHandle a, ShapeHandle b, double fuzz, const char* name) {
    if (fuzz < 0.0) {
        throw std::invalid_argument(
            std::string("forge.booleantol.") + name +
            ": fuzz must be >= 0 (got " + std::to_string(fuzz) + ")");
    }
    const auto& sa = ShapeRegistry::instance().get(a);
    const auto& sb = ShapeRegistry::instance().get(b);
    Op op(sa, sb);
    // SetFuzzyValue is inherited from BOPAlgo_Options via
    // BRepAlgoAPI_BuilderAlgo. A value of 0 leaves OCCT in classic
    // tolerance-only mode; any positive value relaxes the algorithm by
    // that many millimetres on top of the per-shape tolerance maps.
    op.SetFuzzyValue(fuzz);
    op.Build();
    if (!op.IsDone()) {
        throw std::runtime_error(
            std::string("forge.booleantol.") + name +
            ": OCCT BRepAlgoAPI failed (fuzz=" + std::to_string(fuzz) + ")");
    }
    return ShapeRegistry::instance().add(op.Shape());
}

}  // namespace

ShapeHandle fuse(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Fuse>(a, b, fuzz, "fuse");
}

ShapeHandle cut(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Cut>(a, b, fuzz, "cut");
}

ShapeHandle common(ShapeHandle a, ShapeHandle b, double fuzz) {
    return runFuzzy<BRepAlgoAPI_Common>(a, b, fuzz, "common");
}

}  // namespace forge::booleantol
