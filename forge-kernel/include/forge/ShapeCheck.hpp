#pragma once

// PUSH-18 — BRepCheck_Analyzer-backed shape validation.
//
// Unlike forge::heal::checkValidity (which reports a topological summary
// — non-manifold edges, closed-solid, …), forge::shapecheck::analyse runs
// the full OCCT BRepCheck_Analyzer and returns *every* BRepCheck_Status
// flag the analyser raised, stringified, plus the count of faulty
// sub-shapes. Use this for "is this CAD import production-ready?" gates.

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace forge::shapecheck {

struct AnalysisReport {
    bool                     valid = false;        // BRepCheck_Analyzer::IsValid()
    std::int32_t             faultyCount = 0;      // # of sub-shapes that failed
    std::vector<std::string> faultStrings;         // human-readable issue list
};

AnalysisReport analyse(ShapeHandle shape);

}  // namespace forge::shapecheck
