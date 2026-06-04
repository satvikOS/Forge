// PUSH-18 — Multi-shape sewing wrapper.
//
// Builds a BRepBuilderAPI_Sewing instance at the user's tolerance, adds
// every input shape, runs Perform(), and registers the resulting compound
// shape. The report captures the four counters the algorithm exposes:
// free edges (still open), multiple edges (non-manifold join sites),
// contiguous edges (the ones that actually fused), and degenerated
// shapes (singular geometry).

#include "forge/Sewing.hpp"

#include <BRepBuilderAPI_Sewing.hxx>
#include <Precision.hxx>
#include <TopoDS_Shape.hxx>

#include <stdexcept>
#include <string>

namespace forge::sewing {

SewResult sew(const std::vector<ShapeHandle>& shapes, double tolerance) {
    if (shapes.empty()) {
        throw std::invalid_argument(
            "forge.sewing.sew: must pass at least one shape handle");
    }
    if (tolerance <= 0.0) {
        throw std::invalid_argument(
            "forge.sewing.sew: tolerance must be > 0 (got " +
            std::to_string(tolerance) + ")");
    }

    // Defaults Option=Standard_True (use BRep) + Cutting=Standard_True
    // (split overlapping edges at intersections) + NonManifold=False
    // (return manifold compound). Same as OCCT's default ctor.
    BRepBuilderAPI_Sewing tool(tolerance);
    for (auto h : shapes) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.sewing.sew: shape handle " + std::to_string(h) +
                " resolves to a null shape");
        }
        tool.Add(s);
    }
    tool.Perform();

    const TopoDS_Shape& result = tool.SewedShape();
    if (result.IsNull()) {
        throw std::runtime_error(
            "forge.sewing.sew: BRepBuilderAPI_Sewing returned a null shape");
    }

    SewResult out{};
    out.handle = ShapeRegistry::instance().add(result);
    out.report.inputShapeCount   = shapes.size();
    out.report.freeEdges         = static_cast<std::size_t>(tool.NbFreeEdges());
    out.report.multipleEdges     = static_cast<std::size_t>(tool.NbMultipleEdges());
    out.report.contiguousEdges   = static_cast<std::size_t>(tool.NbContigousEdges());
    out.report.degeneratedShapes = static_cast<std::size_t>(tool.NbDegeneratedShapes());
    return out;
}

}  // namespace forge::sewing
