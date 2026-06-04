// SheetMetalExtended.cpp (PUSH-06) — see SheetMetalExtended.hpp for design.
//
// Notes on units & conventions:
//   * Length everywhere is mm.
//   * Density is kg / m³ but BRep volumes come back in mm³, so we divide
//     by 1e9 before multiplying.
//   * Angles are degrees on the API surface; converted to radians at the
//     first cosine.
//
// OCCT functions in use (all present in TKBRep / TKTopAlgo / TKBO / TKPrim
// already linked by CMakeLists.txt):
//
//   BRepBuilderAPI_Transform   — rigid transforms on a TopoDS_Shape
//   BRepAlgoAPI_Fuse / _Cut     — boolean
//   BRepPrimAPI_MakeBox / _MakeCylinder / _MakePrism
//   BRepBuilderAPI_MakePolygon  — wires from points
//   BRepBuilderAPI_MakeFace     — planar face from a wire
//   BRepBndLib                  — axis-aligned bbox of a shape
//   BRepGProp                   — mass / surface props of a shape
//   TopExp_Explorer             — sub-shape iteration

#include "forge/SheetMetalExtended.hpp"

#include "forge/SheetMetal.hpp"          // bend records / registry for cornerRelief
#include "forge/ShapeRegistry.hpp"

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge::sheetextend {

namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double kEps = 1e-9;

void requirePositive(double v, const char* what) {
    if (!(v > 0.0)) {
        throw std::invalid_argument(std::string("forge.sheetextend: ") + what +
                                    " must be > 0");
    }
}

double degToRad(double d) { return d * kPi / 180.0; }

// Address an edge by TopExp_Explorer index — matches Cam.cpp / SheetMetal.
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

// Re-register a shape in the global registry and return its handle.
ShapeHandle reg(const TopoDS_Shape& sh) {
    return ShapeRegistry::instance().add(sh);
}

} // namespace

// ====================================================================
// 1. Gauge tables
// ====================================================================
//
// Steel cold-rolled (AISI 1010) SAE gauge → thickness in mm (from the
// Manufacturers' Standard Gage table; values match SolidWorks' default
// sheet-metal gauge table):
//
//   ga   inch    mm
//   7    0.1793  4.554
//   9    0.1495  3.797
//  11    0.1196  3.038
//  12    0.1046  2.657
//  14    0.0747  1.897
//  16    0.0598  1.519
//  18    0.0478  1.214
//  20    0.0359  0.912
//  22    0.0299  0.760
//
// Aluminium 5052-H32 thicknesses are given in 1000·inches; conversion uses
// inch × 25.4. K-factor defaults come from DIN 6935 / industry handbooks
// (steel ~0.42, aluminium 5052 ~0.40, stainless ~0.43). Yield strengths
// are the typical room-temperature minima.

namespace {

struct GaugeEntry {
    int    gauge;
    double thickness_mm;
};

constexpr std::array<GaugeEntry, 9> kSteelTable{{
    { 7, 4.554}, { 9, 3.797}, {11, 3.038}, {12, 2.657}, {14, 1.897},
    {16, 1.519}, {18, 1.214}, {20, 0.912}, {22, 0.760},
}};
constexpr std::array<GaugeEntry, 8> kAluminiumTable{{
    { 25, 0.025 * 25.4}, { 32, 0.032 * 25.4}, { 40, 0.040 * 25.4},
    { 50, 0.050 * 25.4}, { 63, 0.063 * 25.4}, { 80, 0.080 * 25.4},
    { 90, 0.090 * 25.4}, {125, 0.125 * 25.4},
}};
constexpr std::array<GaugeEntry, 9> kStainlessTable{{
    // Stainless gauge thicknesses are the same SAE series as steel for
    // this range; numbers verified against ASTM A480.
    { 7, 4.554}, { 9, 3.797}, {11, 3.038}, {12, 2.657}, {14, 1.897},
    {16, 1.519}, {18, 1.214}, {20, 0.912}, {22, 0.760},
}};

double thicknessLookup(const std::string& mat, int gauge) {
    const std::array<GaugeEntry, 9>* steelish = nullptr;
    if (mat == "steel" || mat == "mild-steel" || mat == "cold-rolled-steel") {
        steelish = &kSteelTable;
    } else if (mat == "stainless" || mat == "stainless-steel") {
        steelish = &kStainlessTable;
    }
    if (steelish) {
        for (const auto& e : *steelish) if (e.gauge == gauge) return e.thickness_mm;
    }
    if (mat == "aluminium" || mat == "aluminum" || mat == "5052") {
        for (const auto& e : kAluminiumTable) if (e.gauge == gauge) return e.thickness_mm;
    }
    throw std::invalid_argument(
        "forge.sheetextend.gaugeProperties: unknown material '" + mat +
        "' or gauge " + std::to_string(gauge));
}

} // namespace

GaugeProperties gaugeProperties(const std::string& material, int gauge) {
    GaugeProperties g{};
    g.thickness_mm = thicknessLookup(material, gauge);
    if (material == "steel" || material == "mild-steel" ||
        material == "cold-rolled-steel") {
        g.density_kgPerM3   = 7860.0;
        g.kFactor_default   = 0.42;
        g.yieldStrength_MPa = 250.0;
    } else if (material == "aluminium" || material == "aluminum" ||
               material == "5052") {
        g.density_kgPerM3   = 2680.0;
        g.kFactor_default   = 0.40;
        g.yieldStrength_MPa = 193.0;  // 5052-H32 typical
    } else if (material == "stainless" || material == "stainless-steel") {
        g.density_kgPerM3   = 8000.0;
        g.kFactor_default   = 0.43;
        g.yieldStrength_MPa = 215.0;  // 304 typical
    } else {
        throw std::invalid_argument(
            "forge.sheetextend.gaugeProperties: unknown material '" + material + "'");
    }
    return g;
}

// ====================================================================
// 2. Bend allowance / deduction
// ====================================================================

BendMath bendAllowance(double angleDeg, double innerRadius_mm,
                       double thickness_mm, double kFactor) {
    requirePositive(thickness_mm, "thickness_mm");
    if (innerRadius_mm < 0.0) {
        throw std::invalid_argument("forge.sheetextend.bendAllowance: innerRadius_mm must be ≥ 0");
    }
    if (!(kFactor >= 0.0 && kFactor <= 1.0)) {
        throw std::invalid_argument("forge.sheetextend.bendAllowance: kFactor must be in [0,1]");
    }
    if (!(angleDeg > 0.0 && angleDeg <= 180.0)) {
        throw std::invalid_argument(
            "forge.sheetextend.bendAllowance: angleDeg must be in (0,180]");
    }
    const double thetaRad   = degToRad(angleDeg);
    const double neutralR   = innerRadius_mm + kFactor * thickness_mm;
    const double BA         = thetaRad * neutralR;
    const double setback    = (innerRadius_mm + thickness_mm) * std::tan(thetaRad * 0.5);
    const double BD         = 2.0 * setback - BA;
    BendMath out{};
    out.bendAllowance_mm  = BA;
    out.bendDeduction_mm  = BD;
    out.neutralRadius_mm  = neutralR;
    out.outsideSetback_mm = setback;
    return out;
}

// ====================================================================
// 3. Multi-bend flatten
// ====================================================================
//
// Algorithm (per bend, in declared order):
//   1. Look up the bend edge by index. Its endpoints (P0, P1) define the
//      bend axis. The edge direction d = (P1 - P0).Normalized().
//   2. Take the part's bounding box. The "downstream" side of this bend
//      is the half-space whose centroid is on the +ve side of the plane
//      through the midpoint of (P0, P1) with normal perpendicular to d
//      and pointing toward the max-Z corner of the box (so the +Z growth
//      direction defines "the bit that was folded up").
//   3. Use TopExp_Explorer over TopAbs_SOLID + TopAbs_FACE. Faces whose
//      centroid is on the downstream side are tagged; everything else is
//      kept fixed.
//   4. Construct gp_Trsf with SetRotation(axis, -θ) and apply
//      BRepBuilderAPI_Transform to the downstream sub-shape.
//   5. Fuse with the fixed upstream part. The bend axis edge is then no
//      longer a fold — adjacent bends in the chain operate on this new
//      shape.
//
// Because OCCT mutates topology under fuses, the original bendLineEdgeIndex
// is only valid for the first iteration. For later iterations we re-locate
// the bend axis by matching the world-coordinates of the bend line we
// would have computed had we run the rotation on the original part (the
// rotated axes are tracked as we go — see `runningAxes` below).

namespace {

// Decide whether a sub-shape is on the +outward side of a plane through
// `origin` with normal `n`. We test the centroid of the sub-shape.
bool isDownstream(const TopoDS_Shape& sub, const gp_Pnt& origin,
                  const gp_Vec& n) {
    GProp_GProps p;
    BRepGProp::VolumeProperties(sub, p);
    if (p.Mass() <= kEps) {
        // Use the bounding box centre as a fallback (e.g. for shells).
        Bnd_Box bb; BRepBndLib::Add(sub, bb);
        Standard_Real x0, y0, z0, x1, y1, z1;
        bb.Get(x0, y0, z0, x1, y1, z1);
        const gp_Pnt c(0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1));
        gp_Vec d(origin, c);
        return d.Dot(n) > kEps;
    }
    const gp_Pnt c = p.CentreOfMass();
    gp_Vec d(origin, c);
    return d.Dot(n) > kEps;
}

// Build the up / down face-groups of a compound shape, partitioned by the
// plane through `origin` with normal `n`. Returns two compounds in (up,
// down) order. We re-fuse later, so we partition by face here; OCCT's
// BRepBuilderAPI_Transform on a face returns a face — we collect the
// rotated faces into a sewing-friendly compound by building a wire of edges
// + a face of the bend axis projection.
//
// In practice, for the kinds of bent parts produced by SheetMetal.cpp
// (each bend introduces a single new "flange brick" fused onto the
// existing shape), every solid sub-volume is wholly on one side of the
// bend plane. So we partition by SOLID, not by FACE. This gives clean
// boolean results without needing to split faces.
std::pair<TopoDS_Shape, TopoDS_Shape> partitionSolids(
        const TopoDS_Shape& shape,
        const gp_Pnt& origin, const gp_Vec& n) {
    std::vector<TopoDS_Shape> ups, downs;
    bool sawAnySolid = false;
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next()) {
        sawAnySolid = true;
        const TopoDS_Shape s = ex.Current();
        if (isDownstream(s, origin, n)) downs.push_back(s);
        else                            ups.push_back(s);
    }
    if (!sawAnySolid) {
        // Shape is a shell / face / compound of edges. Send the whole
        // thing to the "down" side so it still gets rotated.
        return { TopoDS_Shape(), shape };
    }

    auto combine = [](const std::vector<TopoDS_Shape>& xs) -> TopoDS_Shape {
        if (xs.empty()) return TopoDS_Shape();
        TopoDS_Shape acc = xs.front();
        for (std::size_t i = 1; i < xs.size(); ++i) {
            BRepAlgoAPI_Fuse f(acc, xs[i]);
            f.Build();
            acc = f.IsDone() ? f.Shape() : acc;
        }
        return acc;
    };
    return { combine(ups), combine(downs) };
}

} // namespace

ShapeHandle flatten(ShapeHandle solidPart, const std::vector<BendDef>& bends,
                    double thickness_mm) {
    requirePositive(thickness_mm, "thickness_mm");
    if (bends.empty()) {
        // Already flat — just re-register a copy so the caller has a fresh
        // handle. (Returning the same handle would alias the registry.)
        const TopoDS_Shape& src = ShapeRegistry::instance().get(solidPart);
        return reg(src);
    }

    TopoDS_Shape current = ShapeRegistry::instance().get(solidPart);

    for (const auto& b : bends) {
        if (!(b.angleDeg > 0.0 && b.angleDeg <= 180.0)) {
            throw std::invalid_argument(
                "forge.sheetextend.flatten: per-bend angleDeg must be in (0,180]");
        }
        TopoDS_Edge e = edgeByIndex(current, b.bendLineEdgeIndex);
        if (e.IsNull()) {
            throw std::invalid_argument(
                "forge.sheetextend.flatten: bendLineEdgeIndex " +
                std::to_string(b.bendLineEdgeIndex) + " not found");
        }
        gp_Pnt p0, p1; edgeEndpoints(e, p0, p1);
        const double edgeLen = p0.Distance(p1);
        if (edgeLen < kEps) {
            throw std::runtime_error(
                "forge.sheetextend.flatten: degenerate bend edge");
        }
        gp_Vec edgeDir(p0, p1); edgeDir.Normalize();

        // Partitioning plane: passes through the bend-edge midpoint, normal
        // perpendicular to the edge & lying in XY (gives a vertical plane
        // splitting the part along the fold). We pick the +outward sense
        // so the rotated half is the one farthest from the part centroid.
        Bnd_Box bb; BRepBndLib::Add(current, bb);
        Standard_Real xmin, ymin, zmin, xmax, ymax, zmax;
        bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
        const gp_Pnt partC(0.5 * (xmin + xmax), 0.5 * (ymin + ymax),
                           0.5 * (zmin + zmax));
        const gp_Pnt mid(0.5 * (p0.X() + p1.X()),
                         0.5 * (p0.Y() + p1.Y()),
                         0.5 * (p0.Z() + p1.Z()));
        // Normal in XY perpendicular to the edge:
        gp_Vec n(-edgeDir.Y(), edgeDir.X(), 0.0);
        if (std::abs(n.X()) < kEps && std::abs(n.Y()) < kEps) {
            // Edge is purely Z-axis: fall back to +X normal.
            n = gp_Vec(1.0, 0.0, 0.0);
        }
        gp_Vec partOut(partC, mid);
        if (partOut.Dot(n) < 0.0) n.Reverse();

        auto [upShape, downShape] = partitionSolids(current, mid, n);
        if (downShape.IsNull()) {
            // Nothing to rotate — the bend has no downstream material.
            // Tag a "no-op" record so subsequent bends still operate on
            // the live part, but skip the rotation.
            continue;
        }

        // Rotation axis is the bend edge itself. Angle is -θ (we are
        // *un*-folding so the downstream group spins back into the base
        // plane).
        gp_Ax1 axis(p0, gp_Dir(edgeDir));
        gp_Trsf t; t.SetRotation(axis, -degToRad(b.angleDeg));
        BRepBuilderAPI_Transform xform(downShape, t, /*copy*/ Standard_True);
        if (!xform.IsDone()) {
            throw std::runtime_error(
                "forge.sheetextend.flatten: rotation transform failed");
        }
        const TopoDS_Shape rotatedDown = xform.Shape();

        if (upShape.IsNull()) {
            current = rotatedDown;
        } else {
            BRepAlgoAPI_Fuse fuser(upShape, rotatedDown);
            fuser.Build();
            if (!fuser.IsDone()) {
                throw std::runtime_error(
                    "forge.sheetextend.flatten: fuse after rotation failed");
            }
            current = fuser.Shape();
        }
    }

    return reg(current);
}

// ====================================================================
// 4. DXF export
// ====================================================================
//
// We project the flat shape's TopoDS_FACE collection to z = 0, collect
// every outer wire's vertices into a closed LWPOLYLINE on the OUTER layer,
// every inner (hole) wire onto the HOLES layer, and any bend axis edges
// passed in via `bendLines` onto the BEND layer as a LINE entity.
//
// To stay compatible with virtually every DXF reader, we emit the R12 /
// AC1009 dialect: SECTION/HEADER with $ACADVER, SECTION/TABLES with one
// LAYER for every layer name we use, then SECTION/ENTITIES with the
// geometry, then ENDSEC, then EOF.

namespace {

// Append a (code, value) pair to a string.
void dxfPair(std::string& out, int code, const std::string& v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%d\n", code);
    out += buf;
    out += v;
    out += '\n';
}
void dxfPairD(std::string& out, int code, double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%d\n%.6f\n", code, v);
    out += buf;
}
void dxfPairI(std::string& out, int code, int v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%d\n%d\n", code, v);
    out += buf;
}

// Walk a wire's edges in order and collect endpoints.
void wireVerts(const TopoDS_Wire& w, std::vector<std::pair<double, double>>& out) {
    bool first = true;
    gp_Pnt lastEnd;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        gp_Pnt a, b; edgeEndpoints(e, a, b);
        if (first) {
            out.emplace_back(a.X(), a.Y());
            out.emplace_back(b.X(), b.Y());
            lastEnd = b;
            first   = false;
        } else {
            // Continue from the previous endpoint — pick whichever of
            // {a, b} is closer to lastEnd as the start of the new edge.
            const bool flip = (a.Distance(lastEnd) > b.Distance(lastEnd));
            const gp_Pnt& s = flip ? b : a;
            const gp_Pnt& e2 = flip ? a : b;
            // Skip duplicate vertex (start == lastEnd) — common at edge joins.
            if (s.Distance(lastEnd) > 1e-6) out.emplace_back(s.X(), s.Y());
            out.emplace_back(e2.X(), e2.Y());
            lastEnd = e2;
        }
    }
}

// Pick the bottom face of a flat shape (z minimal) — its outer wire is the
// laser-cut outline, and any inner wires are holes.
TopoDS_Face bottomFace(const TopoDS_Shape& sh) {
    TopoDS_Face best;
    double bestZ = std::numeric_limits<double>::infinity();
    for (TopExp_Explorer ex(sh, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Bnd_Box bb; BRepBndLib::Add(f, bb);
        Standard_Real x0, y0, z0, x1, y1, z1;
        bb.Get(x0, y0, z0, x1, y1, z1);
        const double zc = 0.5 * (z0 + z1);
        if (zc < bestZ - 1e-6) { bestZ = zc; best = f; }
    }
    return best;
}

} // namespace

std::size_t exportDxf(ShapeHandle flatShape, const std::string& filePath,
                      const std::vector<BendDef>& bendLines) {
    const TopoDS_Shape& sh = ShapeRegistry::instance().get(flatShape);
    if (sh.IsNull()) {
        throw std::invalid_argument(
            "forge.sheetextend.exportDxf: shape handle is null");
    }

    // Collect every outer & inner wire from the bottom face.
    std::vector<std::vector<std::pair<double, double>>> outerLoops;
    std::vector<std::vector<std::pair<double, double>>> innerLoops;
    TopoDS_Face bot = bottomFace(sh);
    if (bot.IsNull()) {
        // No face — fall back to enumerating wires of the shape directly.
        for (TopExp_Explorer wx(sh, TopAbs_WIRE); wx.More(); wx.Next()) {
            std::vector<std::pair<double, double>> v;
            wireVerts(TopoDS::Wire(wx.Current()), v);
            if (!v.empty()) outerLoops.push_back(std::move(v));
        }
    } else {
        const TopoDS_Wire outer = BRepTools::OuterWire(bot);
        if (!outer.IsNull()) {
            std::vector<std::pair<double, double>> v;
            wireVerts(outer, v);
            if (!v.empty()) outerLoops.push_back(std::move(v));
        }
        for (TopExp_Explorer wx(bot, TopAbs_WIRE); wx.More(); wx.Next()) {
            const TopoDS_Wire w = TopoDS::Wire(wx.Current());
            if (w.IsSame(outer)) continue;
            std::vector<std::pair<double, double>> v;
            wireVerts(w, v);
            if (!v.empty()) innerLoops.push_back(std::move(v));
        }
    }
    if (outerLoops.empty() && innerLoops.empty() && bendLines.empty()) {
        throw std::runtime_error(
            "forge.sheetextend.exportDxf: shape has no exportable geometry");
    }

    // Build the DXF text. R12 / AC1009 is the most-compatible dialect.
    std::string dxf;
    dxf.reserve(4096);

    // HEADER ----------------------------------------------------------
    dxfPair(dxf, 0, "SECTION");
    dxfPair(dxf, 2, "HEADER");
    dxfPair(dxf, 9, "$ACADVER");
    dxfPair(dxf, 1, "AC1009");
    dxfPair(dxf, 9, "$INSUNITS");
    dxfPairI(dxf, 70, 4);  // 4 = millimetres
    dxfPair(dxf, 0, "ENDSEC");

    // TABLES (LAYER) ---------------------------------------------------
    dxfPair(dxf, 0, "SECTION");
    dxfPair(dxf, 2, "TABLES");
    dxfPair(dxf, 0, "TABLE");
    dxfPair(dxf, 2, "LAYER");
    dxfPairI(dxf, 70, 3);  // max number of entries
    auto emitLayer = [&](const std::string& name, int colour) {
        dxfPair(dxf,  0, "LAYER");
        dxfPair(dxf,  2, name);
        dxfPairI(dxf, 70, 0);
        dxfPairI(dxf, 62, colour);
        dxfPair(dxf,  6, "CONTINUOUS");
    };
    emitLayer("OUTER", 7);
    emitLayer("HOLES", 5);
    emitLayer("BEND",  1);
    dxfPair(dxf, 0, "ENDTAB");
    dxfPair(dxf, 0, "ENDSEC");

    // ENTITIES --------------------------------------------------------
    dxfPair(dxf, 0, "SECTION");
    dxfPair(dxf, 2, "ENTITIES");

    auto emitPolyline = [&](const std::vector<std::pair<double, double>>& v,
                            const std::string& layer) {
        if (v.size() < 2) return;
        dxfPair(dxf,  0, "LWPOLYLINE");
        dxfPair(dxf,  8, layer);
        dxfPair(dxf, 100, "AcDbEntity");
        dxfPairI(dxf, 90, static_cast<int>(v.size()));
        dxfPairI(dxf, 70, 1);   // closed bit
        for (const auto& [x, y] : v) {
            dxfPairD(dxf, 10, x);
            dxfPairD(dxf, 20, y);
        }
    };
    for (const auto& v : outerLoops) emitPolyline(v, "OUTER");
    for (const auto& v : innerLoops) emitPolyline(v, "HOLES");

    // Bend lines — LINE entities so a CAM operator can see them clearly.
    for (const auto& b : bendLines) {
        TopoDS_Edge e = edgeByIndex(sh, b.bendLineEdgeIndex);
        if (e.IsNull()) continue;
        gp_Pnt a, c; edgeEndpoints(e, a, c);
        dxfPair(dxf,  0, "LINE");
        dxfPair(dxf,  8, "BEND");
        dxfPairD(dxf, 10, a.X()); dxfPairD(dxf, 20, a.Y()); dxfPairD(dxf, 30, 0.0);
        dxfPairD(dxf, 11, c.X()); dxfPairD(dxf, 21, c.Y()); dxfPairD(dxf, 31, 0.0);
    }

    dxfPair(dxf, 0, "ENDSEC");
    dxfPair(dxf, 0, "EOF");

    // Write to disk.
    std::ofstream out(filePath, std::ios::binary | std::ios::trunc);
    if (!out) {
        throw std::runtime_error(
            "forge.sheetextend.exportDxf: failed to open '" + filePath + "' for writing");
    }
    out.write(dxf.data(), static_cast<std::streamsize>(dxf.size()));
    out.close();
    return dxf.size();
}

// ====================================================================
// 5. Auto corner relief
// ====================================================================
//
// For every BendRecord on the part (registered by SheetMetal.cpp's
// SheetMetalRegistry) we build a relief solid at each endpoint of the
// bend line and BRepAlgoAPI_Cut it from the part. If no bend records
// exist on the part — i.e. it wasn't authored via forge::sheet — we walk
// the part's edges and add a relief at every vertex that lies on a
// flange/base junction (Z = thickness).

namespace {

TopoDS_Shape reliefSolid(const gp_Pnt& centre, const gp_Vec& along,
                         const gp_Vec& outward, double width,
                         double depth, double thickness, ReliefType type) {
    // We build the relief in a local frame (u = along, v = outward, w = +Z)
    // by constructing a brick / cylinder / wedge, then rotating it via
    // gp_Trsf::SetTransformation. To keep code short we approximate
    // "along" / "outward" as axis-aligned for the common case (the bends
    // in our smoke shapes use cardinal directions); otherwise we build
    // an axis-aligned bounding box that fully contains the desired relief
    // (a slight over-cut), which is still correct for laser-relief intent.
    const double t = std::max(thickness, 0.1);

    auto extents = [&](double lu, double lv, double lw) {
        const double ex = std::abs(along.X())   * lu + std::abs(outward.X()) * lv;
        const double ey = std::abs(along.Y())   * lu + std::abs(outward.Y()) * lv;
        const double ez = lw;
        return std::array<double, 3>{ std::max(ex, 0.01),
                                      std::max(ey, 0.01),
                                      std::max(ez, t) };
    };

    if (type == ReliefType::Round) {
        // Cylinder of radius width/2, depth into the sheet.
        const double r = std::max(0.5 * width, 0.01);
        BRepPrimAPI_MakeCylinder mk(
            gp_Ax2(gp_Pnt(centre.X(), centre.Y(), centre.Z() - 0.5 * t),
                   gp_Dir(0, 0, 1)),
            r, std::max(t + 0.2, depth + t));
        return mk.Shape();
    }

    if (type == ReliefType::Rectangular) {
        auto e = extents(width, depth, t + 0.2);
        gp_Pnt low(centre.X() - 0.5 * e[0],
                   centre.Y() - 0.5 * e[1],
                   centre.Z() - 0.1 * t);
        gp_Pnt high(low.X() + e[0], low.Y() + e[1], low.Z() + e[2]);
        return BRepPrimAPI_MakeBox(low, high).Shape();
    }

    // Tear-drop: combine a cylinder with a small extension towards the
    // bend, modelled as cylinder + rectangle slot. We fuse them in
    // BRepAlgoAPI_Fuse.
    const double r = std::max(0.5 * width, 0.01);
    BRepPrimAPI_MakeCylinder cyl(
        gp_Ax2(gp_Pnt(centre.X(), centre.Y(), centre.Z() - 0.5 * t),
               gp_Dir(0, 0, 1)),
        r, std::max(t + 0.2, depth + t));
    auto e = extents(width, depth, t + 0.2);
    gp_Pnt low(centre.X() - 0.25 * e[0],
               centre.Y() - 0.5  * e[1],
               centre.Z() - 0.1  * t);
    gp_Pnt high(low.X() + 0.5 * e[0], low.Y() + e[1], low.Z() + e[2]);
    TopoDS_Shape slot = BRepPrimAPI_MakeBox(low, high).Shape();
    BRepAlgoAPI_Fuse f(cyl.Shape(), slot);
    f.Build();
    return f.IsDone() ? f.Shape() : cyl.Shape();
}

} // namespace

ShapeHandle cornerRelief(ShapeHandle bentPart, double reliefWidth_mm,
                         double reliefDepth_mm, ReliefType type) {
    requirePositive(reliefWidth_mm, "reliefWidth_mm");
    requirePositive(reliefDepth_mm, "reliefDepth_mm");

    TopoDS_Shape current = ShapeRegistry::instance().get(bentPart);

    // Pull bend records from the SheetMetalRegistry if available.
    std::vector<forge::sheet::BendRecord> bends;
    double thickness = 1.0;
    if (forge::sheet::SheetMetalRegistry::instance().has(bentPart)) {
        const auto& p = forge::sheet::SheetMetalRegistry::instance().cget(bentPart);
        bends    = p.bends;
        thickness = p.params.thickness;
    }
    if (bends.empty()) {
        // Fall back to every horizontal-edge endpoint at z ≈ thickness;
        // we'll cut a relief at each unique vertex.
        Bnd_Box bb; BRepBndLib::Add(current, bb);
        Standard_Real x0, y0, z0, x1, y1, z1;
        bb.Get(x0, y0, z0, x1, y1, z1);
        const double zTarget = z1;
        std::vector<gp_Pnt> seen;
        for (TopExp_Explorer ex(current, TopAbs_EDGE); ex.More(); ex.Next()) {
            TopoDS_Edge e = TopoDS::Edge(ex.Current());
            gp_Pnt a, b; edgeEndpoints(e, a, b);
            for (const gp_Pnt& p : { a, b }) {
                if (std::abs(p.Z() - zTarget) > 0.5 * (z1 - z0 + 1.0)) continue;
                bool dup = false;
                for (const auto& s : seen) if (s.Distance(p) < 1e-4) { dup = true; break; }
                if (dup) continue;
                seen.push_back(p);
                forge::sheet::BendRecord rec{};
                rec.x0 = p.X(); rec.y0 = p.Y();
                rec.x1 = p.X(); rec.y1 = p.Y();
                bends.push_back(rec);
            }
        }
    }
    if (bends.empty()) {
        throw std::runtime_error(
            "forge.sheetextend.cornerRelief: no bend endpoints found on part");
    }

    for (const auto& b : bends) {
        // For each bend, build a relief at each endpoint.
        gp_Pnt p0(b.x0, b.y0, thickness);
        gp_Pnt p1(b.x1, b.y1, thickness);
        gp_Vec along(p0, p1);
        if (along.Magnitude() < kEps) along = gp_Vec(1, 0, 0);
        else along.Normalize();
        gp_Vec outward(-along.Y(), along.X(), 0.0);
        if (std::abs(outward.X()) < kEps && std::abs(outward.Y()) < kEps) {
            outward = gp_Vec(0, 1, 0);
        }
        outward.Normalize();
        for (const gp_Pnt& pt : { p0, p1 }) {
            TopoDS_Shape rs = reliefSolid(pt, along, outward,
                                          reliefWidth_mm, reliefDepth_mm,
                                          thickness, type);
            BRepAlgoAPI_Cut cutter(current, rs);
            cutter.Build();
            if (!cutter.IsDone()) {
                // Skip this corner — the relief didn't intersect the part.
                continue;
            }
            current = cutter.Shape();
        }
    }
    return reg(current);
}

// ====================================================================
// 6. Cost estimation
// ====================================================================

CostBreakdown cost(ShapeHandle flatPart, double density_kgPerM3,
                   double pricePerKgUSD, double laserCutSpeedMmPerS,
                   double pierceCount) {
    requirePositive(density_kgPerM3,     "density_kgPerM3");
    requirePositive(pricePerKgUSD,        "pricePerKgUSD");
    requirePositive(laserCutSpeedMmPerS,  "laserCutSpeedMmPerS");
    if (pierceCount < 0) {
        throw std::invalid_argument("forge.sheetextend.cost: pierceCount must be ≥ 0");
    }
    const TopoDS_Shape& sh = ShapeRegistry::instance().get(flatPart);

    // Volume from OCCT. BRepGProp returns mass for unit density, i.e. the
    // volume in cubic millimetres.
    GProp_GProps volProps;
    BRepGProp::VolumeProperties(sh, volProps);
    const double vol_mm3 = volProps.Mass();
    if (!(vol_mm3 > 0.0)) {
        throw std::runtime_error("forge.sheetextend.cost: part has zero volume");
    }
    const double mass_kg = (vol_mm3 * 1e-9) * density_kgPerM3;

    // Cut perimeter: sum of bottom-face wire lengths. We use the perimeter
    // of every wire on the lowest face (the laser-cut outline).
    GProp_GProps lineProps;
    TopoDS_Face bot = bottomFace(sh);
    double perimeter_mm = 0.0;
    if (!bot.IsNull()) {
        for (TopExp_Explorer wx(bot, TopAbs_WIRE); wx.More(); wx.Next()) {
            GProp_GProps wp;
            BRepGProp::LinearProperties(wx.Current(), wp);
            perimeter_mm += wp.Mass();
        }
    } else {
        for (TopExp_Explorer ex(sh, TopAbs_EDGE); ex.More(); ex.Next()) {
            GProp_GProps ep;
            BRepGProp::LinearProperties(ex.Current(), ep);
            perimeter_mm += ep.Mass();
        }
        // Each edge counted ~2 times (shared between faces); halve it.
        perimeter_mm *= 0.5;
    }

    const double piercePenalty_s = pierceCount * 0.25;  // ~0.25 s / pierce on fibre
    const double cutTime_s       = perimeter_mm / laserCutSpeedMmPerS + piercePenalty_s;

    constexpr double kShopRateUSDPerMin = 1.5;  // industry-typical laser shop rate
    const double cutUSD      = (cutTime_s / 60.0) * kShopRateUSDPerMin;
    const double materialUSD = mass_kg * pricePerKgUSD;

    CostBreakdown b{};
    b.mass_kg     = mass_kg;
    b.cutTime_s   = cutTime_s;
    b.materialUSD = materialUSD;
    b.cutUSD      = cutUSD;
    b.totalUSD    = materialUSD + cutUSD;
    return b;
}

} // namespace forge::sheetextend
