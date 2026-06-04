#pragma once

// PUSH-18 — Multi-shape sewing.
//
// Unlike forge::heal::sewShape (single shape, single ShapeHandle), this
// takes a *list* of input shapes — typical use case is a STEP/IGES import
// that produced individual faces/shells per surface and you want OCCT to
// build one watertight compound. The returned ShapeHandle points to the
// BRepBuilderAPI_Sewing::SewedShape().
//
// The report tells the caller how many edges got joined (input
// "section" edges that became "boundary" edges in the output) and how
// many edges are still free (open-boundary survivors).

#include "forge/ShapeRegistry.hpp"

#include <cstdint>
#include <vector>

namespace forge::sewing {

struct SewReport {
    std::size_t inputShapeCount = 0;
    std::size_t freeEdges       = 0;  // BRepBuilderAPI_Sewing::NbFreeEdges()
    std::size_t multipleEdges   = 0;  // shared by > 2 faces (non-manifold)
    std::size_t contiguousEdges = 0;  // edges that got joined into the result
    std::size_t degeneratedShapes = 0;
};

struct SewResult {
    ShapeHandle handle = kInvalidHandle;
    SewReport   report;
};

SewResult sew(const std::vector<ShapeHandle>& shapes, double tolerance);

}  // namespace forge::sewing
