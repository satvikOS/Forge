// ============================================================================
// src/ArcHelix.cpp — helical spine + sweep-along-an-arbitrary-wire.
//
// The whole translation unit is inside FORGE_FT_ARCHELIX. With the flag OFF it
// compiles to an empty object file, so the OFF build cannot differ from the
// kernel that preceded it by anything more than an empty .o.
//
// A NOTE ON WHY THIS IS NOT ROUTED THROUGH part::sweepPolyline. That function
// takes a POLYLINE spine and builds it with BRepBuilderAPI_MakePolygon; a helix
// is not a polyline, and approximating it with one is the tessellation the ARC/
// HELIX work exists to remove. CMakeLists.txt already records (FORGE_OFFSET_DROP_
// MAKEPIPE block) that the FT SWEEP op "emits corrupt solids for any bent path"
// via that route — measured volume ratio 0.500 on a 90-degree two-segment bend.
// MakePipeShell with a real spine and an explicit profile placement is a
// different construction, not a tuning of that one.
// ============================================================================

#ifdef FORGE_FT_ARCHELIX

#include "forge/ArcHelix.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Features.hpp"

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <stdexcept>
#include <vector>

namespace forge {
namespace archelix {
namespace {

constexpr double kPi = 3.14159265358979323846;

}  // namespace

// --------------------------------------------------------------- helixWire
ShapeHandle helixWire(double pitch, double height, double radius,
                      double cx, double cy, double cz,
                      double ax, double ay, double az,
                      bool lefthand) {
    if (!(pitch > 0.0))
        throw std::invalid_argument("forge.archelix.helixWire: pitch must be > 0");
    if (!(height > 0.0))
        throw std::invalid_argument("forge.archelix.helixWire: height must be > 0");
    if (!(radius > 0.0))
        throw std::invalid_argument("forge.archelix.helixWire: radius must be > 0");
    const double alen = std::sqrt(ax * ax + ay * ay + az * az);
    if (alen < 1e-12)
        throw std::invalid_argument("forge.archelix.helixWire: axis direction is zero");

    // 1. the cylinder the helix lives on
    const gp_Ax3 frame(gp_Pnt(cx, cy, cz), gp_Dir(ax / alen, ay / alen, az / alen));
    Handle(Geom_CylindricalSurface) surf = new Geom_CylindricalSurface(frame, radius);

    // 2. a straight line in (u,v): du per unit v is the pitch. gp_Dir2d normalises,
    //    so the curve parameter is arc length in the (u,v) plane and the trim below
    //    is a length, not an angle.
    Handle(Geom2d_Line) line = new Geom2d_Line(
        gp_Pnt2d(0.0, 0.0),
        lefthand ? gp_Dir2d(-2.0 * kPi, pitch) : gp_Dir2d(2.0 * kPi, pitch));

    // 3. trim to exactly `height` of rise: n_turns * |(2pi, pitch)|
    const double nTurns = height / pitch;
    const double uvLen  = nTurns * std::sqrt((2.0 * kPi) * (2.0 * kPi) + pitch * pitch);
    Handle(Geom2d_TrimmedCurve) seg = new Geom2d_TrimmedCurve(line, 0.0, uvLen);

    BRepBuilderAPI_MakeEdge mkEdge(seg, surf);
    if (!mkEdge.IsDone())
        throw std::runtime_error("forge.archelix.helixWire: helical edge build failed");
    BRepBuilderAPI_MakeWire mkWire(mkEdge.Edge());
    if (!mkWire.IsDone())
        throw std::runtime_error("forge.archelix.helixWire: helical wire build failed");
    TopoDS_Wire w = mkWire.Wire();

    // 4. an edge defined only by a pcurve has no 3D curve yet. Without this the
    //    wire measures as empty downstream — a silent nothing, not an error.
    BRepLib::BuildCurves3d(w, 1.0e-6, GeomAbs_C1, 14, 2000);

    return ShapeRegistry::instance().add(w);
}

// ------------------------------------------------------- sweepProfileAlongWire
ShapeHandle sweepProfileAlongWire(SketchHandle profile, ShapeHandle pathWire,
                                  double rotDeg, double rx, double ry, double rz,
                                  double tx, double ty, double tz,
                                  bool frenet) {
    // --- the spine ---------------------------------------------------------
    const TopoDS_Shape& spineShape = ShapeRegistry::instance().get(pathWire);
    TopoDS_Wire spine;
    if (spineShape.ShapeType() == TopAbs_WIRE) {
        spine = TopoDS::Wire(spineShape);
    } else if (spineShape.ShapeType() == TopAbs_EDGE) {
        BRepBuilderAPI_MakeWire mk(TopoDS::Edge(spineShape));
        if (!mk.IsDone())
            throw std::runtime_error("forge.archelix.sweep: spine edge is not a wire");
        spine = mk.Wire();
    } else {
        TopExp_Explorer ex(spineShape, TopAbs_WIRE);
        if (!ex.More())
            throw std::runtime_error(
                "forge.archelix.sweep: path handle carries no WIRE — SWEEP's path "
                "argument must be a HELIX (or another wire-valued op), not a solid");
        spine = TopoDS::Wire(ex.Current());
    }

    // --- the section, placed ----------------------------------------------
    std::vector<TopoDS_Wire> profWires = extractWires(profile);
    if (profWires.empty())
        throw std::invalid_argument(
            "forge.archelix.sweep: the profile sketch has no extractable closed wire");
    TopoDS_Wire prof = profWires[0];
    gp_Trsf T;
    if (std::fabs(rotDeg) > 0.0) {
        const double rlen = std::sqrt(rx * rx + ry * ry + rz * rz);
        if (rlen < 1e-12)
            throw std::invalid_argument("forge.archelix.sweep: rotation axis is zero");
        T.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(rx / rlen, ry / rlen, rz / rlen)),
                      rotDeg * kPi / 180.0);
    }
    if (tx != 0.0 || ty != 0.0 || tz != 0.0) {
        gp_Trsf Tr;
        Tr.SetTranslation(gp_Vec(tx, ty, tz));
        T = Tr * T;                       // rotate about the origin, THEN translate
    }
    if (T.Form() != gp_Identity) {
        BRepBuilderAPI_Transform mv(prof, T, /*copy*/ Standard_True);
        if (!mv.IsDone())
            throw std::runtime_error("forge.archelix.sweep: profile placement failed");
        prof = TopoDS::Wire(mv.Shape());
    }

    // --- the sweep ---------------------------------------------------------
    BRepOffsetAPI_MakePipeShell mk(spine);
    mk.SetMode(frenet ? Standard_True : Standard_False);
    mk.SetTransitionMode(BRepBuilderAPI_RightCorner);   // CadQuery's default
    mk.Add(prof, /*WithContact*/ Standard_False, /*WithCorrection*/ Standard_False);
    mk.Build();
    if (!mk.IsDone())
        throw std::runtime_error("forge.archelix.sweep: pipe shell build failed");
    if (!mk.MakeSolid())
        throw std::runtime_error(
            "forge.archelix.sweep: the swept shell does not close into a SOLID "
            "(an open or self-intersecting section along this spine)");
    return ShapeRegistry::instance().add(mk.Shape());
}

}  // namespace archelix
}  // namespace forge

#endif  // FORGE_FT_ARCHELIX
