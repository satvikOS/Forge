// PUSH-18 — Full BRepCheck_Analyzer wrapper.
//
// Walks every sub-shape kind (solid → shell → face → wire → edge → vertex),
// asks the analyser whether each sub-shape is valid, and for those that
// aren't pulls the BRepCheck_Result status list and translates each
// BRepCheck_Status enum into a human-readable string.

#include "forge/ShapeCheck.hpp"

#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Status.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>

#include <sstream>
#include <stdexcept>

namespace forge::shapecheck {

namespace {

const char* statusName(BRepCheck_Status s) {
    switch (s) {
        case BRepCheck_NoError:                       return "NoError";
        case BRepCheck_InvalidPointOnCurve:           return "InvalidPointOnCurve";
        case BRepCheck_InvalidPointOnCurveOnSurface:  return "InvalidPointOnCurveOnSurface";
        case BRepCheck_InvalidPointOnSurface:         return "InvalidPointOnSurface";
        case BRepCheck_No3DCurve:                     return "No3DCurve";
        case BRepCheck_Multiple3DCurve:               return "Multiple3DCurve";
        case BRepCheck_Invalid3DCurve:                return "Invalid3DCurve";
        case BRepCheck_NoCurveOnSurface:              return "NoCurveOnSurface";
        case BRepCheck_InvalidCurveOnSurface:         return "InvalidCurveOnSurface";
        case BRepCheck_InvalidCurveOnClosedSurface:   return "InvalidCurveOnClosedSurface";
        case BRepCheck_InvalidSameRangeFlag:          return "InvalidSameRangeFlag";
        case BRepCheck_InvalidSameParameterFlag:      return "InvalidSameParameterFlag";
        case BRepCheck_InvalidDegeneratedFlag:        return "InvalidDegeneratedFlag";
        case BRepCheck_FreeEdge:                      return "FreeEdge";
        case BRepCheck_InvalidMultiConnexity:         return "InvalidMultiConnexity";
        case BRepCheck_InvalidRange:                  return "InvalidRange";
        case BRepCheck_EmptyWire:                     return "EmptyWire";
        case BRepCheck_RedundantEdge:                 return "RedundantEdge";
        case BRepCheck_SelfIntersectingWire:          return "SelfIntersectingWire";
        case BRepCheck_NoSurface:                     return "NoSurface";
        case BRepCheck_InvalidWire:                   return "InvalidWire";
        case BRepCheck_RedundantWire:                 return "RedundantWire";
        case BRepCheck_IntersectingWires:             return "IntersectingWires";
        case BRepCheck_InvalidImbricationOfWires:     return "InvalidImbricationOfWires";
        case BRepCheck_EmptyShell:                    return "EmptyShell";
        case BRepCheck_RedundantFace:                 return "RedundantFace";
        case BRepCheck_InvalidImbricationOfShells:    return "InvalidImbricationOfShells";
        case BRepCheck_UnorientableShape:             return "UnorientableShape";
        case BRepCheck_NotClosed:                     return "NotClosed";
        case BRepCheck_NotConnected:                  return "NotConnected";
        case BRepCheck_SubshapeNotInShape:            return "SubshapeNotInShape";
        case BRepCheck_BadOrientation:                return "BadOrientation";
        case BRepCheck_BadOrientationOfSubshape:      return "BadOrientationOfSubshape";
        case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
        case BRepCheck_InvalidToleranceValue:         return "InvalidToleranceValue";
        case BRepCheck_EnclosedRegion:                return "EnclosedRegion";
        case BRepCheck_CheckFail:                     return "CheckFail";
    }
    return "UnknownStatus";
}

const char* shapeKindName(TopAbs_ShapeEnum k) {
    switch (k) {
        case TopAbs_COMPOUND:  return "compound";
        case TopAbs_COMPSOLID: return "compsolid";
        case TopAbs_SOLID:     return "solid";
        case TopAbs_SHELL:     return "shell";
        case TopAbs_FACE:      return "face";
        case TopAbs_WIRE:      return "wire";
        case TopAbs_EDGE:      return "edge";
        case TopAbs_VERTEX:    return "vertex";
        case TopAbs_SHAPE:     return "shape";
    }
    return "unknown";
}

void collectFaultsFor(const BRepCheck_Analyzer& chk,
                      const TopoDS_Shape& parent,
                      const TopoDS_Shape& sub,
                      std::size_t index,
                      std::vector<std::string>& out) {
    if (chk.IsValid(sub)) return;
    // Pull the per-sub-shape status list from the analyser.
    Handle(BRepCheck_Result) res = chk.Result(sub);
    if (res.IsNull()) {
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index
            << ": invalid (no detailed BRepCheck_Result)";
        out.push_back(oss.str());
        return;
    }
    // Status() returns the list pertaining to `sub` (myShape inside the
    // result). InContext / OnShape lists are richer but for our gate use
    // case this is enough.
    const BRepCheck_ListOfStatus& statuses = res->Status();
    if (statuses.IsEmpty()) {
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index << ": invalid";
        out.push_back(oss.str());
        return;
    }
    BRepCheck_ListIteratorOfListOfStatus it(statuses);
    for (; it.More(); it.Next()) {
        if (it.Value() == BRepCheck_NoError) continue;
        std::ostringstream oss;
        oss << shapeKindName(sub.ShapeType()) << "#" << index
            << ": " << statusName(it.Value());
        out.push_back(oss.str());
    }
    (void)parent;
}

}  // namespace

AnalysisReport analyse(ShapeHandle shape) {
    const auto& s = ShapeRegistry::instance().get(shape);
    if (s.IsNull()) {
        throw std::invalid_argument("forge.shapecheck.analyse: null shape");
    }

    // GeomFill checks + curve-on-surface checks all on (true = run).
    BRepCheck_Analyzer chk(s, Standard_True);

    AnalysisReport rep{};
    rep.valid = chk.IsValid();

    // Top-level shape itself.
    if (!chk.IsValid(s)) {
        ++rep.faultyCount;
        collectFaultsFor(chk, s, s, 0, rep.faultStrings);
    }

    // Walk every shape kind so callers get a complete fault inventory.
    constexpr TopAbs_ShapeEnum kinds[] = {
        TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_WIRE,
        TopAbs_EDGE,  TopAbs_VERTEX
    };
    for (auto kind : kinds) {
        TopTools_IndexedMapOfShape sub;
        TopExp::MapShapes(s, kind, sub);
        for (Standard_Integer i = 1; i <= sub.Extent(); ++i) {
            const TopoDS_Shape& sh = sub(i);
            if (!chk.IsValid(sh)) {
                ++rep.faultyCount;
                collectFaultsFor(chk, s, sh, static_cast<std::size_t>(i),
                                 rep.faultStrings);
            }
        }
    }

    return rep;
}

}  // namespace forge::shapecheck
