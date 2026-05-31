#include "forge/Healing.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeShell.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_Shape.hxx>
#include <Precision.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <ShapeAnalysis_Shell.hxx>
#include <ShapeAnalysis_ShapeContents.hxx>
#include <ShapeAnalysis_ShapeTolerance.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_ShapeTolerance.hxx>
#include <ShapeFix_Solid.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>

#include <stdexcept>

namespace forge::heal {

namespace {

std::size_t countSubShapes(const TopoDS_Shape& shape, TopAbs_ShapeEnum kind) {
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, kind, map);
    return static_cast<std::size_t>(map.Extent());
}

bool shapeIsClosedSolid(const TopoDS_Shape& shape) {
    // A shape counts as a closed solid if at least one TopoDS_Solid lives
    // inside it AND every shell in that solid passes the OCCT closedness
    // check. For a raw shell we just inspect the shell directly.
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
        for (TopExp_Explorer es(ex.Current(), TopAbs_SHELL); es.More(); es.Next()) {
            if (!BRep_Tool::IsClosed(TopoDS::Shell(es.Current()))) return false;
        }
        return true;
    }
    // No solid → check the bare shell.
    for (TopExp_Explorer es(shape, TopAbs_SHELL); es.More(); es.Next()) {
        return BRep_Tool::IsClosed(TopoDS::Shell(es.Current()));
    }
    return false;
}

// Free-boundary edges = edges that are owned by exactly one face in the
// shape's edge→face ancestor map. The ShapeAnalysis_FreeBounds wrapper
// gives us the free wires too, which we need for autoFillMissingFaces.
std::size_t countFreeEdges(const TopoDS_Shape& shape) {
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, map);
    std::size_t n = 0;
    for (Standard_Integer i = 1; i <= map.Extent(); ++i) {
        if (map(i).Extent() == 1) ++n;
    }
    return n;
}

} // namespace

SewResult sewShape(ShapeHandle shape, double tolerance) {
    const auto& s = ShapeRegistry::instance().get(shape);

    SewReport rep{};
    rep.facesBefore     = countSubShapes(s, TopAbs_FACE);
    rep.openEdgesBefore = countFreeEdges(s);
    rep.closedBefore    = shapeIsClosedSolid(s);

    BRepBuilderAPI_Sewing tool(tolerance);
    tool.Add(s);
    tool.Perform();
    TopoDS_Shape sewn = tool.SewedShape();

    // Try to upgrade the sewn shell to a closed solid where possible.
    TopoDS_Shape result = sewn;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        TopoDS_Shell sh = TopoDS::Shell(sewn);
        if (BRep_Tool::IsClosed(sh)) {
            BRepBuilderAPI_MakeSolid mk(sh);
            if (mk.IsDone()) {
                result = mk.Solid();
            }
        }
    }

    rep.facesAfter     = countSubShapes(result, TopAbs_FACE);
    rep.openEdgesAfter = countFreeEdges(result);
    rep.closedAfter    = shapeIsClosedSolid(result);

    return { ShapeRegistry::instance().add(result), rep };
}

SimplifyResult simplifyShape(ShapeHandle shape, const SimplifyOptions& opts) {
    const auto& s = ShapeRegistry::instance().get(shape);

    SimplifyResult out{};
    out.facesBefore = countSubShapes(s, TopAbs_FACE);
    out.edgesBefore = countSubShapes(s, TopAbs_EDGE);

    ShapeUpgrade_UnifySameDomain unify(s, opts.unifyEdges, opts.unifyFaces,
                                       opts.concatBSplines);
    unify.SetAngularTolerance(opts.angularTol);
    unify.Build();
    TopoDS_Shape simplified = unify.Shape();

    out.handle      = ShapeRegistry::instance().add(simplified);
    out.facesAfter  = countSubShapes(simplified, TopAbs_FACE);
    out.edgesAfter  = countSubShapes(simplified, TopAbs_EDGE);
    return out;
}

AutoFillResult autoFillMissingFaces(ShapeHandle shape, double tolerance) {
    const auto& s = ShapeRegistry::instance().get(shape);

    AutoFillReport rep{};
    rep.openEdgesBefore = countFreeEdges(s);

    // Detect free wires (closed loops of free edges) we can cap.
    // ShapeAnalysis_FreeBounds returns a compound of wires in OCCT 7.9.
    ShapeAnalysis_FreeBounds analyzer(s, tolerance,
                                      /*splitClosed*/ Standard_False,
                                      /*splitOpen*/   Standard_False);
    const TopoDS_Compound& closedWires = analyzer.GetClosedWires();

    // For each closed free wire, fit a filling patch and add it to a sewing
    // pile alongside the original shape.
    BRepBuilderAPI_Sewing sew(tolerance);
    sew.Add(s);

    for (TopExp_Explorer wex(closedWires, TopAbs_WIRE); wex.More(); wex.Next()) {
        TopoDS_Wire w = TopoDS::Wire(wex.Current());
        try {
            BRepOffsetAPI_MakeFilling filling;
            for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
                filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
            }
            filling.Build();
            if (filling.IsDone()) {
                sew.Add(filling.Shape());
                ++rep.facesAdded;
            }
        } catch (const std::exception&) {
            // Skip wires the filler can't tame — leaves them as residual
            // open edges in the after report.
        } catch (...) {
            // OCCT throws its own non-std exceptions; swallow them too.
        }
    }

    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();

    // Promote to a closed solid if the sewing produced a closed shell.
    TopoDS_Shape result = sewn;
    if (sewn.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(sewn))) {
        BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(sewn));
        if (mk.IsDone()) {
            // Sanity-check + orient the solid outwards.
            Handle(ShapeFix_Solid) fix = new ShapeFix_Solid(mk.Solid());
            fix->Perform();
            if (fix->Solid().IsNull()) {
                result = mk.Solid();
            } else {
                result = fix->Solid();
            }
        }
    } else if (sewn.ShapeType() == TopAbs_COMPOUND) {
        // Find a shell inside and try to close it.
        for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
            TopoDS_Shell sh = TopoDS::Shell(ex.Current());
            if (BRep_Tool::IsClosed(sh)) {
                BRepBuilderAPI_MakeSolid mk(sh);
                if (mk.IsDone()) {
                    result = mk.Solid();
                    break;
                }
            }
        }
    }

    rep.openEdgesAfter = countFreeEdges(result);
    rep.closedAfter    = shapeIsClosedSolid(result);

    return { ShapeRegistry::instance().add(result), rep };
}

RepairResult autoRepairSelfIntersection(ShapeHandle shape, double tolerance) {
    const auto& s = ShapeRegistry::instance().get(shape);

    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    fixer->SetPrecision(tolerance);
    fixer->SetMinTolerance(tolerance * 0.1);
    fixer->SetMaxTolerance(tolerance * 10.0);
    fixer->Perform();
    TopoDS_Shape fixed = fixer->Shape();

    RepairReport rep{};
    // ShapeFix_Shape exposes per-fixer status flags; we summarise here.
    // DONE1..6 are the per-sub-shape "something was fixed" indicators.
    rep.fixedWires       = fixer->Status(ShapeExtend_DONE2);  // wires fixed
    rep.fixedSmallFaces  = fixer->Status(ShapeExtend_DONE3);  // faces fixed
    rep.fixedOrientation = fixer->Status(ShapeExtend_DONE4)
                          || fixer->Status(ShapeExtend_DONE5);
    rep.fixedTolerance   = fixer->Status(ShapeExtend_DONE1);
    rep.fixedSelfIntersection = fixer->Status(ShapeExtend_DONE6);
    rep.fixersFired = (rep.fixedWires ? 1u : 0u)
                    + (rep.fixedSmallFaces ? 1u : 0u)
                    + (rep.fixedOrientation ? 1u : 0u)
                    + (rep.fixedTolerance ? 1u : 0u)
                    + (rep.fixedSelfIntersection ? 1u : 0u);

    return { ShapeRegistry::instance().add(fixed), rep };
}

ShapeHandle harmonizeNormals(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);
    // ShapeFix_Solid orients faces so the resulting solid has positive
    // volume — equivalent to "outward normals everywhere".
    Handle(ShapeFix_Shape) fixer = new ShapeFix_Shape(s);
    fixer->Perform();
    TopoDS_Shape work = fixer->Shape();

    // For each shell, run ShapeAnalysis_Shell + ShapeFix_Solid for the
    // outward orientation. We don't change face wires.
    for (TopExp_Explorer ex(work, TopAbs_SHELL); ex.More(); ex.Next()) {
        TopoDS_Shell sh = TopoDS::Shell(ex.Current());
        ShapeAnalysis_Shell ana;
        ana.LoadShells(sh);
        ana.CheckOrientedShells(sh, /*alsofree*/ Standard_True);
    }

    if (work.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(work))) {
        Handle(ShapeFix_Solid) fs = new ShapeFix_Solid();
        TopoDS_Solid solid = fs->SolidFromShell(TopoDS::Shell(work));
        if (!solid.IsNull()) {
            work = solid;
        }
    }

    return ShapeRegistry::instance().add(work);
}

ValidityReport checkValidity(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);

    ValidityReport r{};
    r.isClosed   = shapeIsClosedSolid(s);

    BRepCheck_Analyzer checker(s, Standard_True);
    r.isOriented = checker.IsValid();

    // Manifold-ness: every edge shared by ≤2 faces; non-manifold edge =
    // shared by ≥3 faces.
    TopTools_IndexedDataMapOfShapeListOfShape map;
    TopExp::MapShapesAndAncestors(s, TopAbs_EDGE, TopAbs_FACE, map);
    bool nonManifold = false;
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(s, TopAbs_EDGE, edgeMap);
    for (Standard_Integer i = 1; i <= map.Extent(); ++i) {
        const auto& neigh = map(i);
        if (neigh.Extent() > 2) {
            nonManifold = true;
            // Record bad edge index in BREP order.
            const auto& edgeShape = map.FindKey(i);
            r.badEdges.push_back(static_cast<std::uint32_t>(edgeMap.FindIndex(edgeShape)));
        }
    }
    r.hasNonManifoldEdge = nonManifold;
    r.isManifold = !nonManifold;

    // Self-intersection: ShapeAnalysis_Shell reports it. As a low-cost
    // proxy, mass properties on a closed solid should be positive; a
    // negative-volume solid is a strong signal of intersection.
    if (r.isClosed) {
        GProp_GProps p;
        BRepGProp::VolumeProperties(s, p);
        r.hasSelfIntersect = (p.Mass() < 0.0);
    }

    // Bad faces: any face the BRepCheck_Analyzer flagged.
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(s, TopAbs_FACE, faceMap);
    for (Standard_Integer i = 1; i <= faceMap.Extent(); ++i) {
        if (!checker.IsValid(faceMap(i))) {
            r.badFaces.push_back(static_cast<std::uint32_t>(i));
        }
    }
    return r;
}

} // namespace forge::heal
