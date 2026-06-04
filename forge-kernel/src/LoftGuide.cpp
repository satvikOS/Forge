// PUSH-18 — Guided loft via BRepOffsetAPI_ThruSections.
//
// Loads every profile-wire handle, adds each as a section via AddWire(),
// and for each guide edge samples one point at its midpoint that gets
// added as a point-section via AddVertex(). This is OCCT's only built-in
// way to direct a ThruSections operation toward intermediate points; for
// true guide-curve interpolation the caller should use
// forge::part::loftWithGuides which builds a GeomFill_NSections surface.

#include "forge/LoftGuide.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <Precision.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>

#include <stdexcept>
#include <string>

namespace forge::loftguide {

namespace {

TopoDS_Wire asWire(const TopoDS_Shape& s, ShapeHandle h) {
    if (s.ShapeType() != TopAbs_WIRE) {
        // Accept compounds/edges if they carry exactly one wire — that's a
        // common idiom for sketches that resolved into a TopoDS_Compound.
        TopExp_Explorer ex(s, TopAbs_WIRE);
        if (ex.More()) {
            TopoDS_Wire w = TopoDS::Wire(ex.Current());
            ex.Next();
            if (!ex.More()) return w;
        }
        throw std::invalid_argument(
            "forge.loftguide.loft: profile handle " + std::to_string(h) +
            " is not a single TopoDS_Wire");
    }
    return TopoDS::Wire(s);
}

TopoDS_Edge asEdge(const TopoDS_Shape& s, ShapeHandle h) {
    if (s.ShapeType() != TopAbs_EDGE) {
        TopExp_Explorer ex(s, TopAbs_EDGE);
        if (ex.More()) return TopoDS::Edge(ex.Current());
        throw std::invalid_argument(
            "forge.loftguide.loft: guide handle " + std::to_string(h) +
            " is not a TopoDS_Edge");
    }
    return TopoDS::Edge(s);
}

}  // namespace

ShapeHandle loft(const std::vector<ShapeHandle>& profileWires,
                 const std::vector<ShapeHandle>& guideEdges,
                 bool solid,
                 bool ruled) {
    if (profileWires.size() < 2) {
        throw std::invalid_argument(
            "forge.loftguide.loft: need at least 2 profile wires (got " +
            std::to_string(profileWires.size()) + ")");
    }

    BRepOffsetAPI_ThruSections mk(
        /*isSolid*/ solid ? Standard_True : Standard_False,
        /*ruled*/  ruled ? Standard_True : Standard_False,
        /*pres3d*/ 1.0e-6);

    // Profile sections.
    for (auto h : profileWires) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.loftguide.loft: profile handle " + std::to_string(h) +
                " is null");
        }
        mk.AddWire(asWire(s, h));
    }

    // Guide edges become supplementary vertex sections (one mid-point per
    // guide). This is the only built-in ThruSections affordance for
    // steering the surface toward intermediate points; for proper
    // guide-curve interpolation use forge::part::loftWithGuides instead.
    for (auto h : guideEdges) {
        const auto& s = ShapeRegistry::instance().get(h);
        if (s.IsNull()) {
            throw std::runtime_error(
                "forge.loftguide.loft: guide handle " + std::to_string(h) +
                " is null");
        }
        TopoDS_Edge e = asEdge(s, h);
        BRepAdaptor_Curve curve(e);
        const Standard_Real pFirst = curve.FirstParameter();
        const Standard_Real pLast  = curve.LastParameter();
        const Standard_Real pMid   = 0.5 * (pFirst + pLast);
        gp_Pnt mid = curve.Value(pMid);
        BRepBuilderAPI_MakeVertex mkv(mid);
        if (!mkv.IsDone()) {
            throw std::runtime_error(
                "forge.loftguide.loft: failed to make vertex from guide edge midpoint");
        }
        mk.AddVertex(mkv.Vertex());
    }

    mk.Build();
    if (!mk.IsDone()) {
        throw std::runtime_error(
            "forge.loftguide.loft: BRepOffsetAPI_ThruSections build failed");
    }
    return ShapeRegistry::instance().add(mk.Shape());
}

}  // namespace forge::loftguide
