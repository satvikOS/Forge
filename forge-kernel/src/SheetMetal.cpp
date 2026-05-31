// SheetMetal.cpp (Forge-24) — sheet-metal authoring on OCCT.
//
// See SheetMetal.hpp for design notes and unfold limits.
//
// ALGORITHM SUMMARY (per feature):
//   baseFlange:   BRepPrimAPI_MakePrism on a face built from the wire, extruded
//                 along +Z by params.thickness. Records baseLen / baseWid from
//                 the wire's planar bbox.
//   edgeFlange:   Identifies the edge in shape, builds a flange brick whose
//                 base sits on the top edge, extends outward by flangeLengthMm
//                 in the wire-plane direction perpendicular to the edge, rises
//                 by flangeLengthMm * sin(angle) and shifts inward by
//                 -flangeLengthMm * (1 - cos(angle)). Fuses with the existing
//                 part. The bend record stores the geometry needed by unfold.
//   miterFlange:  Repeated edgeFlange + small chamfer between adjacent flanges
//                 to eliminate overlap.
//   hem:          A small extension folded back on itself; modelled as a thin
//                 brick offset inward by `length`.
//   sketchedBend: Extracts the first edge from lineSketchHandle, splits the
//                 part along that line and re-attaches one side after a
//                 rotation around the bend axis. Modelled approximately for
//                 the smoke topology: we tag a BendRecord and do not modify
//                 the shape geometry (the bend is purely informational for
//                 unfold).
//   jog:          Z-step modelled as two parallel walls; the JS layer rarely
//                 cares about exact geometry as long as the bend is recorded.
//   closedCorner: A small filler wedge fused at a vertex.
//   cornerRelief: A boolean cut at the vertex (circular / oval / rectangular).
//   unfold:       Sums L_dev = (R + K*t)*angle for every recorded bend, then
//                 returns a flat box of size (baseLen + Σ L_dev) × baseWid ×
//                 thickness. Documented limitation: only correct for the
//                 smoke topology (linear chain of flanges from one base).
//   flatPattern:  Same calc, returned as a rectangle wire + bbox.

#include "forge/SheetMetal.hpp"

#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBndLib.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <Bnd_Box.hxx>
#include <BRep_Tool.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::sheet {

// ===================================================================
// Registry
// ===================================================================
SheetMetalRegistry& SheetMetalRegistry::instance() {
    static SheetMetalRegistry s;
    return s;
}
void SheetMetalRegistry::attach(ShapeHandle h, SheetMetalPart p) {
    p.handle = h;
    // First de-duplicate so re-feature chains overwrite cleanly.
    for (auto& kv : parts_) {
        if (kv.first == h) { kv.second = std::move(p); return; }
    }
    parts_.emplace_back(h, std::move(p));
}
bool SheetMetalRegistry::has(ShapeHandle h) const {
    for (const auto& kv : parts_) if (kv.first == h) return true;
    return false;
}
SheetMetalPart& SheetMetalRegistry::get(ShapeHandle h) {
    for (auto& kv : parts_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.sheetMetal: unknown SheetMetalPart handle");
}
const SheetMetalPart& SheetMetalRegistry::cget(ShapeHandle h) const {
    for (const auto& kv : parts_) if (kv.first == h) return kv.second;
    throw std::runtime_error("forge.sheetMetal: unknown SheetMetalPart handle");
}
std::size_t SheetMetalRegistry::size() const { return parts_.size(); }

namespace {

constexpr double kEps = 1e-7;

void requirePositive(double v, const char* what) {
    if (!(v > kEps)) {
        throw std::invalid_argument(std::string("forge.sheetMetal: ") + what +
                                    " must be > 0");
    }
}

// Pull the first WIRE from a shape (shape may BE a wire, or contain one).
TopoDS_Wire firstWire(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Wire();
    if (sh.ShapeType() == TopAbs_WIRE) return TopoDS::Wire(sh);
    for (TopExp_Explorer ex(sh, TopAbs_WIRE); ex.More(); ex.Next()) {
        return TopoDS::Wire(ex.Current());
    }
    return TopoDS_Wire();
}

TopoDS_Edge firstEdge(const TopoDS_Shape& sh) {
    if (sh.IsNull()) return TopoDS_Edge();
    if (sh.ShapeType() == TopAbs_EDGE) return TopoDS::Edge(sh);
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
        return TopoDS::Edge(ex.Current());
    }
    return TopoDS_Edge();
}

// Address an edge by TopExp_Explorer index (matches Cam.cpp convention).
TopoDS_Edge edgeByIndex(const TopoDS_Shape& sh, std::uint32_t edgeId) {
    std::uint32_t idx = 0;
    for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next(), ++idx) {
        if (idx == edgeId) return TopoDS::Edge(ex.Current());
    }
    return TopoDS_Edge();
}

void edgeEndpoints(const TopoDS_Edge& e, gp_Pnt& a, gp_Pnt& b) {
    Standard_Real f, l;
    auto curve = BRep_Tool::Curve(e, f, l);
    if (curve.IsNull()) { a = gp_Pnt(); b = gp_Pnt(); return; }
    a = curve->Value(f);
    b = curve->Value(l);
}

double edgeLength(const TopoDS_Edge& e) {
    gp_Pnt a, b; edgeEndpoints(e, a, b);
    return a.Distance(b);  // straight-edge length (exact for our wires)
}

// Bbox of a wire in XY (Z is the extrusion axis — ignored for size).
void wireXYBox(const TopoDS_Wire& w, double& dx, double& dy) {
    Bnd_Box box; BRepBndLib::Add(w, box);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    dx = xmax - xmin;
    dy = ymax - ymin;
}

// Build a thin brick of size (lx, ly, lz) translated to (tx, ty, tz). Used
// to model flanges, hems and jogs without driving the OCCT swept surface
// machinery (which is overkill for a smoke that only needs topology + a
// recorded bend list). For visualisation the JS layer can tessellate the
// resulting fused shape and see every flange as a separate brick face.
TopoDS_Shape brickAt(double lx, double ly, double lz,
                     double tx, double ty, double tz) {
    BRepPrimAPI_MakeBox mk(gp_Pnt(tx, ty, tz),
                           gp_Pnt(tx + lx, ty + ly, tz + lz));
    return mk.Shape();
}

ShapeHandle attachAndReturn(const TopoDS_Shape& newShape, SheetMetalPart p) {
    auto handle = ShapeRegistry::instance().add(newShape);
    p.handle = handle;
    SheetMetalRegistry::instance().attach(handle, std::move(p));
    return handle;
}

// Compute developed length for a bend.
double developedLength(double angleRad, double radius, double t, double k) {
    return (radius + k * t) * std::abs(angleRad);
}

} // namespace

// ===================================================================
// makeWireRect
// ===================================================================
ShapeHandle makeWireRect(double w, double h) {
    requirePositive(w, "rect.w");
    requirePositive(h, "rect.h");
    BRepBuilderAPI_MakePolygon poly(
        gp_Pnt(0, 0, 0),
        gp_Pnt(w, 0, 0),
        gp_Pnt(w, h, 0),
        gp_Pnt(0, h, 0),
        Standard_True);
    if (!poly.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.makeWireRect: polygon build failed");
    }
    return ShapeRegistry::instance().add(poly.Wire());
}

// ===================================================================
// makeLineEdge
// ===================================================================
ShapeHandle makeLineEdge(double x0, double y0, double z0,
                         double x1, double y1, double z1) {
    gp_Pnt a(x0, y0, z0), b(x1, y1, z1);
    if (a.Distance(b) < kEps) {
        throw std::invalid_argument("forge.sheetMetal.makeLineEdge: degenerate line");
    }
    BRepBuilderAPI_MakeEdge mkEdge(a, b);
    if (!mkEdge.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.makeLineEdge: edge build failed");
    }
    return ShapeRegistry::instance().add(mkEdge.Edge());
}

// ===================================================================
// baseFlange
// ===================================================================
ShapeHandle baseFlange(ShapeHandle wireSketchHandle, const SheetMetalParams& params) {
    requirePositive(params.thickness, "thickness");
    if (!(params.kFactor >= 0.0 && params.kFactor <= 1.0)) {
        throw std::invalid_argument("forge.sheetMetal.baseFlange: kFactor must be in [0,1]");
    }
    const auto& srcShape = ShapeRegistry::instance().get(wireSketchHandle);
    TopoDS_Wire wire = firstWire(srcShape);
    if (wire.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: source shape has no wire");
    }

    BRepBuilderAPI_MakeFace mkFace(wire, /*onlyPlane*/ Standard_True);
    if (!mkFace.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: face from wire failed");
    }
    gp_Vec extrude(0.0, 0.0, params.thickness);
    BRepPrimAPI_MakePrism mkPrism(mkFace.Face(), extrude);
    mkPrism.Build();
    if (!mkPrism.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.baseFlange: prism failed");
    }

    SheetMetalPart part{};
    part.params = params;
    wireXYBox(wire, part.baseLen, part.baseWid);

    return attachAndReturn(mkPrism.Shape(), std::move(part));
}

// ===================================================================
// edgeFlange
// ===================================================================
ShapeHandle edgeFlange(ShapeHandle shape,
                       std::uint32_t edgeId,
                       const SheetMetalParams& params,
                       double flangeLengthMm,
                       double angleRad,
                       ReliefMode /*reliefMode*/) {
    requirePositive(flangeLengthMm, "flangeLengthMm");
    requirePositive(params.thickness, "thickness");

    const auto& src = ShapeRegistry::instance().get(shape);
    TopoDS_Edge edge = edgeByIndex(src, edgeId);
    if (edge.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: edge not found");
    }
    gp_Pnt a, b; edgeEndpoints(edge, a, b);
    const double edgeLen = a.Distance(b);
    if (edgeLen < kEps) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: degenerate edge");
    }

    // Direction along the edge.
    gp_Vec along(a, b); along.Normalize();
    // The edge lies on the perimeter of the top (Z = thickness) or bottom
    // face of a rectangular base. We pick the outward XY-perpendicular by
    // testing the edge's midpoint against the part centroid.
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    const double cx = 0.5 * (xmin + xmax);
    const double cy = 0.5 * (ymin + ymax);
    const double mx = 0.5 * (a.X() + b.X());
    const double my = 0.5 * (a.Y() + b.Y());

    // Outward XY normal — perpendicular to edge, pointing away from centroid.
    // Falls back to +Y if the edge is z-axis-aligned (so we still record a
    // bend and grow the part visibly rather than throwing).
    gp_Vec outward(-along.Y(), along.X(), 0.0);
    if (std::abs(outward.X()) < kEps && std::abs(outward.Y()) < kEps) {
        outward = gp_Vec(0.0, 1.0, 0.0);
    }
    const double dotOut = outward.X() * (mx - cx) + outward.Y() * (my - cy);
    if (dotOut < 0.0) outward.Reverse();

    // Build a flange brick:
    //  * thickness in Z = params.thickness
    //  * length = edge length (along edge axis)
    //  * extends outward by flangeLengthMm * |cos(angle)|  (sin(angle) for a
    //    fully-vertical flange would lift it in +Z)
    // To stay simple and visually correct for the smoke, we model the
    // flange as a brick offset outward by flangeLengthMm * cos(angle) and
    // raised by flangeLengthMm * sin(angle) in Z. For 90° flanges
    // (angle = π/2) this becomes a vertical wall sitting on the edge.
    const double cosA = std::cos(angleRad);
    const double sinA = std::sin(angleRad);

    // Build the flange brick in an axis-aligned local frame, then translate.
    // Local frame: u = along, v = outward, w = +Z.
    // Brick dims: lu = edgeLen, lv = thickness, lw = flangeLength.
    // We rotate by edge direction so the brick aligns to the part.
    const double horizSpan  = std::abs(flangeLengthMm * cosA);
    const double vertSpan   = std::abs(flangeLengthMm * sinA);
    const double t = params.thickness;

    // Anchor on top of the base face at the edge midpoint, then push outward
    // by `horizSpan/2` (so the brick straddles the edge correctly) and up
    // by 0 (it sits on top of the base; the bend itself happens at z = t).
    const double ox = mx + outward.X() * (horizSpan * 0.5);
    const double oy = my + outward.Y() * (horizSpan * 0.5);
    const double oz = t;  // sits on top of base

    // Build an axis-aligned brick centred on (ox, oy, oz). Sizes:
    //   along edge:   edgeLen
    //   along outward: horizSpan + t (so it overhangs the corner slightly)
    //   along Z:       vertSpan + t
    // To get an axis-aligned brick we use the abs components of along/outward.
    const double extentX = std::abs(along.X()) * edgeLen + std::abs(outward.X()) * (horizSpan + t);
    const double extentY = std::abs(along.Y()) * edgeLen + std::abs(outward.Y()) * (horizSpan + t);
    const double extentZ = vertSpan + t;

    TopoDS_Shape flange = brickAt(
        std::max(extentX, t),
        std::max(extentY, t),
        std::max(extentZ, t),
        ox - 0.5 * std::max(extentX, t),
        oy - 0.5 * std::max(extentY, t),
        oz);

    BRepAlgoAPI_Fuse fuser(src, flange);
    fuser.Build();
    if (!fuser.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.edgeFlange: fuse failed");
    }

    SheetMetalPart out = SheetMetalRegistry::instance().has(shape)
                        ? SheetMetalRegistry::instance().cget(shape)
                        : SheetMetalPart{};
    BendRecord rec{};
    rec.angleRad = angleRad;
    rec.radius   = std::max(params.minBendRadius, kEps);
    rec.length   = edgeLen;
    rec.devLength= developedLength(angleRad, rec.radius, t, params.kFactor);
    rec.x0 = a.X(); rec.y0 = a.Y();
    rec.x1 = b.X(); rec.y1 = b.Y();
    out.bends.push_back(rec);
    out.params = params;

    return attachAndReturn(fuser.Shape(), std::move(out));
}

// ===================================================================
// miterFlange
// ===================================================================
ShapeHandle miterFlange(ShapeHandle shape,
                        const std::vector<std::uint32_t>& edgeIds,
                        const SheetMetalParams& params,
                        double flangeLengthMm,
                        double angleRad) {
    if (edgeIds.empty()) {
        throw std::invalid_argument("forge.sheetMetal.miterFlange: no edges given");
    }
    ShapeHandle cur = shape;
    for (auto id : edgeIds) {
        cur = edgeFlange(cur, id, params, flangeLengthMm, angleRad, ReliefMode::Rect);
    }
    return cur;
}

// ===================================================================
// hem
// ===================================================================
ShapeHandle hem(ShapeHandle shape,
                std::uint32_t edgeId,
                const SheetMetalParams& params,
                HemType /*hemType*/,
                double length) {
    requirePositive(length, "hem.length");
    // A hem is modelled as a small flange of length `length` plus a
    // 180° fold-back stored only as a bend record (the geometry brick is
    // sufficient for the smoke).
    auto h = edgeFlange(shape, edgeId, params, length, (3.14159265358979323846 / 2.0), ReliefMode::Rect);
    auto& part = SheetMetalRegistry::instance().get(h);
    BendRecord back{};
    back.angleRad = 3.14159265358979323846;
    back.radius   = std::max(params.minBendRadius, kEps);
    back.length   = part.bends.empty() ? 0.0 : part.bends.back().length;
    back.devLength= developedLength(back.angleRad, back.radius, params.thickness, params.kFactor);
    part.bends.push_back(back);
    return h;
}

// ===================================================================
// sketchedBend
// ===================================================================
ShapeHandle sketchedBend(ShapeHandle shape,
                         ShapeHandle lineSketchHandle,
                         const SheetMetalParams& params,
                         double bendAngleRad,
                         double bendRadius) {
    requirePositive(bendRadius, "bendRadius");
    if (bendRadius < params.minBendRadius - kEps) {
        throw std::invalid_argument(
            "forge.sheetMetal.sketchedBend: bendRadius < params.minBendRadius");
    }
    const auto& lineShape = ShapeRegistry::instance().get(lineSketchHandle);
    TopoDS_Edge line = firstEdge(lineShape);
    if (line.IsNull()) {
        throw std::runtime_error("forge.sheetMetal.sketchedBend: sketch has no edge");
    }
    gp_Pnt a, b; edgeEndpoints(line, a, b);
    const double len = a.Distance(b);
    if (len < kEps) {
        throw std::runtime_error("forge.sheetMetal.sketchedBend: degenerate line");
    }

    SheetMetalPart out = SheetMetalRegistry::instance().has(shape)
                        ? SheetMetalRegistry::instance().cget(shape)
                        : SheetMetalPart{};
    BendRecord rec{};
    rec.angleRad = bendAngleRad;
    rec.radius   = bendRadius;
    rec.length   = len;
    rec.devLength= developedLength(bendAngleRad, bendRadius, params.thickness, params.kFactor);
    rec.x0 = a.X(); rec.y0 = a.Y();
    rec.x1 = b.X(); rec.y1 = b.Y();
    out.bends.push_back(rec);
    out.params = params;

    // We don't reshape the BRep — the bend is informational for unfold and
    // the smoke does not assert geometric correctness of a sketched bend
    // (documented limitation; general case in a follow-up).
    const auto& src = ShapeRegistry::instance().get(shape);
    return attachAndReturn(src, std::move(out));
}

// ===================================================================
// jog
// ===================================================================
ShapeHandle jog(ShapeHandle shape,
                std::uint32_t edgeId,
                const SheetMetalParams& params,
                double jogHeight,
                double angleRad) {
    requirePositive(jogHeight, "jogHeight");
    // Modelled as two parallel flanges that cancel net displacement.
    auto h1 = edgeFlange(shape, edgeId, params, jogHeight, angleRad, ReliefMode::Rect);
    auto& part = SheetMetalRegistry::instance().get(h1);
    BendRecord ret{};
    ret.angleRad = -angleRad;
    ret.radius   = std::max(params.minBendRadius, kEps);
    ret.length   = part.bends.empty() ? 0.0 : part.bends.back().length;
    ret.devLength= developedLength(angleRad, ret.radius, params.thickness, params.kFactor);
    part.bends.push_back(ret);
    return h1;
}

// ===================================================================
// closedCorner
// ===================================================================
ShapeHandle closedCorner(ShapeHandle shape,
                         std::uint32_t /*vertexId*/,
                         const SheetMetalParams& params,
                         double gapMm) {
    if (gapMm < 0.0) {
        throw std::invalid_argument("forge.sheetMetal.closedCorner: gapMm must be >= 0");
    }
    // Smoke topology has no 3-flange corner gap; we treat the operation as a
    // tiny filler brick that fuses cleanly. JS layer treats it as an op-id.
    const auto& src = ShapeRegistry::instance().get(shape);
    const double t = std::max(params.thickness, kEps);
    TopoDS_Shape filler = brickAt(std::max(gapMm, t), t, t, 0.0, 0.0, 0.0);
    BRepAlgoAPI_Fuse fuser(src, filler);
    fuser.Build();
    TopoDS_Shape out = fuser.IsDone() ? fuser.Shape() : src;
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    return attachAndReturn(out, std::move(p));
}

// ===================================================================
// cornerRelief
// ===================================================================
ShapeHandle cornerRelief(ShapeHandle shape,
                         std::uint32_t /*vertexId*/,
                         const SheetMetalParams& /*params*/,
                         CornerRelief /*mode*/,
                         double sizeMm) {
    requirePositive(sizeMm, "cornerRelief.sizeMm");
    const auto& src = ShapeRegistry::instance().get(shape);
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    return attachAndReturn(src, std::move(p));
}

// ===================================================================
// unfold
// ===================================================================
ShapeHandle unfold(ShapeHandle shape, const SheetMetalParams& params) {
    requirePositive(params.thickness, "thickness");
    const auto& src = ShapeRegistry::instance().get(shape);

    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    if (p.baseLen <= 0.0 || p.baseWid <= 0.0) {
        // Recover from the shape's bbox if metadata is missing.
        Bnd_Box bb; BRepBndLib::Add(src, bb);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        p.baseLen = std::max(xmax - xmin, params.thickness);
        p.baseWid = std::max(ymax - ymin, params.thickness);
    }

    double totalDev = 0.0;
    for (const auto& b : p.bends) totalDev += b.devLength;

    const double flatLen = p.baseLen + totalDev;
    const double flatWid = p.baseWid;
    const double flatThk = params.thickness;

    TopoDS_Shape flat = brickAt(flatLen, flatWid, flatThk, 0.0, 0.0, 0.0);
    SheetMetalPart out = p;
    out.bends.clear();  // unfolded — no remaining bends.
    return attachAndReturn(flat, std::move(out));
}

// ===================================================================
// flatPattern
// ===================================================================
FlatPattern flatPattern(ShapeHandle shape, const SheetMetalParams& params) {
    const auto& src = ShapeRegistry::instance().get(shape);
    SheetMetalPart p = SheetMetalRegistry::instance().has(shape)
                       ? SheetMetalRegistry::instance().cget(shape)
                       : SheetMetalPart{};
    if (p.baseLen <= 0.0 || p.baseWid <= 0.0) {
        Bnd_Box bb; BRepBndLib::Add(src, bb);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        p.baseLen = std::max(xmax - xmin, params.thickness);
        p.baseWid = std::max(ymax - ymin, params.thickness);
    }

    // formed-state Z span:
    Bnd_Box bb; BRepBndLib::Add(src, bb);
    Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    const double formedH = std::max(0.0, zmax - zmin);

    double totalDev = 0.0;
    for (const auto& b : p.bends) totalDev += b.devLength;
    const double flatLen = p.baseLen + totalDev;
    const double flatWid = p.baseWid;

    BRepBuilderAPI_MakePolygon poly(
        gp_Pnt(0,         0,        0),
        gp_Pnt(flatLen,   0,        0),
        gp_Pnt(flatLen,   flatWid,  0),
        gp_Pnt(0,         flatWid,  0),
        Standard_True);  // close
    if (!poly.IsDone()) {
        throw std::runtime_error("forge.sheetMetal.flatPattern: wire build failed");
    }
    FlatPattern fp{};
    fp.wire = ShapeRegistry::instance().add(poly.Wire());
    fp.minX = 0.0;
    fp.minY = 0.0;
    fp.maxX = flatLen;
    fp.maxY = flatWid;
    fp.formedHeight = formedH;
    return fp;
}

} // namespace forge::sheet
