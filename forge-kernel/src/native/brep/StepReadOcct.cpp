// forge/native/brep/StepReadOcct.cpp — see StepReadOcct.hpp.
//
// FOREIGN STEP -> OCCT B-rep transfer WITHOUT TKDESTEP/TKXSBase. Builds the OCCT
// solid directly from ISO-10303-21 with the OCCT modeling toolkits only, so a
// native STEP import (after the TKDESTEP drop) reproduces STEPControl_Reader's
// clean analytic topology (one edge per EDGE_CURVE) for measurement.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/StepReadOcct.hpp"
#include "forge/native/brep/StepPart21.hpp"   // shared ISO-10303-21 lexer

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <gp_Lin.hxx>
#include <ElCLib.hxx>
#include <Geom_Plane.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <Standard_Failure.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Tool.hxx>
#include <TopAbs.hxx>
#include <BRep_Builder.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <ShapeAnalysis_Curve.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepLib.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeFix_Shell.hxx>
#include <ShapeFix_Solid.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <Precision.hxx>

namespace forge {
namespace native {
namespace brep {
namespace {

using p21::Instance;
using p21::splitTopLevel;
using p21::parseRef;
using p21::parseList;
using p21::stepNum;

using Table = std::unordered_map<std::uint64_t, Instance>;

[[noreturn]] void fail(const std::string& why) {
    throw std::runtime_error("foreignStepToOcct: " + why);
}

// ------------------------------------------------------------------ resolver
struct Resolver {
    const Table& tab;
    bool get(std::uint64_t id, Instance& out) const {
        auto it = tab.find(id);
        if (it == tab.end()) return false;
        out = it->second;
        return true;
    }
};

bool getPoint(const Resolver& R, std::uint64_t id, double scale, gp_Pnt& out) {
    Instance ins;
    if (!R.get(id, ins) || ins.type != "CARTESIAN_POINT") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 2) return false;
    std::vector<std::string> xyz;
    if (!parseList(p[1], xyz) || xyz.size() < 3) return false;
    double x, y, z;
    if (!stepNum(xyz[0], x) || !stepNum(xyz[1], y) || !stepNum(xyz[2], z)) return false;
    out = gp_Pnt(x * scale, y * scale, z * scale);
    return true;
}

bool getDir(const Resolver& R, std::uint64_t id, gp_Dir& out) {
    Instance ins;
    if (!R.get(id, ins) || ins.type != "DIRECTION") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 2) return false;
    std::vector<std::string> xyz;
    if (!parseList(p[1], xyz) || xyz.size() < 3) return false;
    double x, y, z;
    if (!stepNum(xyz[0], x) || !stepNum(xyz[1], y) || !stepNum(xyz[2], z)) return false;
    if (x * x + y * y + z * z < 1e-24) return false;
    out = gp_Dir(x, y, z);
    return true;
}

// AXIS2_PLACEMENT_3D('', location, axis(Z, optional), ref_direction(X, optional)).
// Missing axis defaults to +Z, missing ref to +X (with Gram-Schmidt against axis).
bool getAxis2(const Resolver& R, std::uint64_t id, double scale, gp_Ax2& out) {
    Instance ins;
    if (!R.get(id, ins) || ins.type != "AXIS2_PLACEMENT_3D") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 2) return false;
    std::uint64_t locId = 0;
    if (!parseRef(p[1], locId)) return false;
    gp_Pnt loc;
    if (!getPoint(R, locId, scale, loc)) return false;
    gp_Dir zdir(0, 0, 1), xdir(1, 0, 0);
    bool haveZ = false;
    if (p.size() >= 3 && p[2] != "$" && p[2] != "*") {
        std::uint64_t zId = 0;
        if (parseRef(p[2], zId)) { if (getDir(R, zId, zdir)) haveZ = true; }
    }
    bool haveX = false;
    if (p.size() >= 4 && p[3] != "$" && p[3] != "*") {
        std::uint64_t xId = 0;
        if (parseRef(p[3], xId)) { if (getDir(R, xId, xdir)) haveX = true; }
    }
    (void)haveZ;
    // Gram-Schmidt: make xdir orthogonal to zdir; if degenerate, synthesise one.
    gp_Vec zv(zdir), xv(xdir);
    gp_Vec xperp = xv - zv.Multiplied(zv.Dot(xv));
    if (xperp.Magnitude() < 1e-9) {
        // ref parallel to axis (or absent+coincident) — pick any in-plane axis.
        gp_Vec trial = std::fabs(zv.X()) < 0.9 ? gp_Vec(1, 0, 0) : gp_Vec(0, 1, 0);
        xperp = trial - zv.Multiplied(zv.Dot(trial));
    }
    if (xperp.Magnitude() < 1e-9) return false;
    out = gp_Ax2(loc, zdir, gp_Dir(xperp));
    (void)haveX;
    return true;
}

// AXIS1_PLACEMENT('', location, axis(optional)) -> gp_Ax1. Missing axis -> +Z.
bool getAxis1(const Resolver& R, std::uint64_t id, double scale, gp_Ax1& out) {
    Instance ins;
    if (!R.get(id, ins) || ins.type != "AXIS1_PLACEMENT") return false;
    auto p = splitTopLevel(ins.params);
    if (p.size() < 2) return false;
    std::uint64_t locId = 0;
    if (!parseRef(p[1], locId)) return false;
    gp_Pnt loc;
    if (!getPoint(R, locId, scale, loc)) return false;
    gp_Dir d(0, 0, 1);
    if (p.size() >= 3 && p[2] != "$" && p[2] != "*") {
        std::uint64_t dId = 0;
        if (parseRef(p[2], dId)) { if (!getDir(R, dId, d)) return false; }
    }
    out = gp_Ax1(loc, d);
    return true;
}

// ------------------------------------------------------------------ units
// Resolve the file's length unit to a millimetre scale. Robust-in-practice:
// finds the LENGTH_UNIT SI_UNIT (prefix,.METRE.) or a CONVERSION_BASED_UNIT
// (inch/foot). Defaults to 1.0 (millimetre) when unresolved — the common
// build123d / OCCT-writer case (SI_UNIT(.MILLI.,.METRE.)).
double resolveScale(const Table& tab) {
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        // SI length unit appears as a COMPLEX record: (... LENGTH_UNIT() SI_UNIT(prefix,.METRE.) ...)
        if (!ins.type.empty()) continue;
        const std::string& s = ins.params;
        if (s.find("LENGTH_UNIT") == std::string::npos) continue;
        if (s.find(".METRE.") == std::string::npos) continue;
        // metre with a prefix.
        double base = 1000.0; // metre -> mm
        if (s.find(".MILLI.") != std::string::npos) return base * 1e-3;   // 1.0
        if (s.find(".CENTI.") != std::string::npos) return base * 1e-2;   // 10
        if (s.find(".KILO.")  != std::string::npos) return base * 1e3;
        if (s.find(".MICRO.") != std::string::npos) return base * 1e-6;
        // bare .METRE. with no prefix.
        return base;
    }
    return 1.0;
}

// The file's declared accuracy: UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(x),..)
// (either a standalone typed instance or embedded in a COMPLEX context record).
// Returns x in mm (0.0 when the file declares none). A conforming writer promises
// its topology closes within this tolerance — rejecting such a file with the hard
// Precision::Confusion() 1e-7 was the dfm_critic finding.
double resolveUncertainty(const Table& tab, double scale) {
    double best = 0.0;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        const bool isU =
            ins.type == "UNCERTAINTY_MEASURE_WITH_UNIT" ||
            (ins.type.empty() &&
             ins.params.find("UNCERTAINTY_MEASURE_WITH_UNIT") != std::string::npos);
        if (!isU) continue;
        const std::string& s = ins.params;
        std::size_t lm = s.find("LENGTH_MEASURE(");
        if (lm == std::string::npos) continue;
        const std::size_t b = lm + 15;                    // past "LENGTH_MEASURE("
        const std::size_t e = s.find(')', b);
        if (e == std::string::npos) continue;
        double v = 0;
        if (!stepNum(s.substr(b, e - b), v)) continue;
        if (v > 0.0 && v > best) best = v;                // largest declared wins
    }
    return best * scale;
}

// ------------------------------------------------------------ complex records
// A COMPLEX/combined instance "#id=(A(..)B(..)C(..))" is stored by the p21 lexer
// with type "" and params == the record body. Split it into its typed
// sub-records (same approach as StepRead.cpp's splitComplex — kept local to this
// TU so the two readers stay independently buildable).
struct SubRecord { std::string type; std::string params; };

std::vector<SubRecord> splitComplex(const std::string& rawParams) {
    std::string s = rawParams;
    {   // strip one layer of outer parens if present.
        std::size_t b = 0, e = s.size();
        while (b < e && (s[b] == ' ' || s[b] == '\n' || s[b] == '\t' || s[b] == '\r')) ++b;
        while (e > b && (s[e-1] == ' ' || s[e-1] == '\n' || s[e-1] == '\t' || s[e-1] == '\r')) --e;
        s = s.substr(b, e - b);
        if (!s.empty() && s.front() == '(' && s.back() == ')') s = s.substr(1, s.size() - 2);
    }
    std::vector<SubRecord> out;
    std::size_t i = 0, n = s.size();
    while (i < n) {
        while (i < n && (s[i] == ' ' || s[i] == '\n' || s[i] == '\t' || s[i] == '\r')) ++i;
        if (i >= n) break;
        std::size_t tb = i;                 // a type keyword [A-Z0-9_]+
        while (i < n && (s[i] == '_' || (s[i] >= 'A' && s[i] <= 'Z') ||
                         (s[i] >= '0' && s[i] <= '9'))) ++i;
        if (i == tb) break;                 // not a complex record
        std::string type = s.substr(tb, i - tb);
        while (i < n && (s[i] == ' ' || s[i] == '\n')) ++i;
        if (i >= n || s[i] != '(') break;   // malformed
        int depth = 0; bool inStr = false; std::size_t j = i;   // balanced parens
        for (; j < n; ++j) {
            char c = s[j];
            if (inStr) { if (c == '\'') { if (j+1 < n && s[j+1]=='\'') ++j; else inStr=false; } continue; }
            if (c == '\'') inStr = true;
            else if (c == '(') ++depth;
            else if (c == ')') { --depth; if (depth == 0) break; }
        }
        if (j >= n) break;
        std::string params = s.substr(i + 1, j - (i + 1));
        out.push_back({std::move(type), std::move(params)});
        i = j + 1;
    }
    return out;
}

// ------------------------------------------------------------------ surfaces
// (defined in the 3D-curves section below; the swept surfaces need it for their
// basis curve.)
Handle(Geom_Curve) buildCurve3d(const Resolver& R, std::uint64_t rawId, double scale,
                                std::string& kind);

// Reconstruct a Geom_BSplineSurface from the B_SPLINE_SURFACE_WITH_KNOTS field
// set. `fields` is POST-NAME:
//   0:uDeg 1:vDeg 2:ctrlGrid 3:surfForm 4:uClosed 5:vClosed 6:selfInt
//   7:uMult 8:vMult 9:uKnots 10:vKnots [11:knotSpec]
// (the same layout StepRead.cpp's buildBSplineSurface consumes — the COMPLEX
// rational form concatenates B_SPLINE_SURFACE's 7 fields with WITH_KNOTS' 4).
// `weightGridField`, when non-null, is the RATIONAL_B_SPLINE_SURFACE weight grid
// "((w,..),..)" — nU rows x nV cols like the control grid. Control points are
// CARTESIAN_POINTs (mm-scaled by getPoint); knots are PARAMETRIC (unscaled).
// STEP's control-grid outer index is U (rows), inner is V — matching OCCT's
// Poles(u,v). Only the CLAMPED/open knot form is built (sum(mult) == nPoles +
// degree + 1); a periodic-form file fails honestly.
Handle(Geom_Surface) buildBSplineSurfaceGeom(const Resolver& R,
                                             const std::vector<std::string>& fields,
                                             const std::string* weightGridField,
                                             double scale) {
    if (fields.size() < 11) fail("B_SPLINE_SURFACE arity");
    double du = 0, dv = 0;
    if (!stepNum(fields[0], du) || !stepNum(fields[1], dv)) fail("B_SPLINE_SURFACE degree");
    const int uDeg = static_cast<int>(std::lround(du));
    const int vDeg = static_cast<int>(std::lround(dv));
    if (uDeg < 1 || vDeg < 1) fail("B_SPLINE_SURFACE degree range");

    // control grid: a list of U rows, each row a list of #refs (V columns).
    std::vector<std::string> rows;
    if (!parseList(fields[2], rows) || rows.empty()) fail("B_SPLINE_SURFACE control grid");
    const int nU = static_cast<int>(rows.size());
    int nV = 0;
    TColgp_Array2OfPnt poles;
    for (int iu = 0; iu < nU; ++iu) {
        std::vector<std::string> refs;
        if (!parseList(rows[iu], refs) || refs.empty()) fail("B_SPLINE_SURFACE control row");
        if (iu == 0) {
            nV = static_cast<int>(refs.size());
            poles.Resize(1, nU, 1, nV, Standard_False);
        } else if (static_cast<int>(refs.size()) != nV) {
            fail("B_SPLINE_SURFACE ragged control grid");
        }
        for (int iv = 0; iv < nV; ++iv) {
            std::uint64_t pid = 0; gp_Pnt cp;
            if (!parseRef(refs[iv], pid) || !getPoint(R, pid, scale, cp))
                fail("B_SPLINE_SURFACE pole");
            poles.SetValue(iu + 1, iv + 1, cp);
        }
    }

    // knots + multiplicities (distinct-knot + mult form, as OCCT wants them).
    std::vector<std::string> umS, vmS, ukS, vkS;
    if (!parseList(fields[7], umS) || !parseList(fields[8], vmS) ||
        !parseList(fields[9], ukS) || !parseList(fields[10], vkS))
        fail("B_SPLINE_SURFACE knot data");
    if (ukS.empty() || vkS.empty() || umS.size() != ukS.size() || vmS.size() != vkS.size())
        fail("B_SPLINE_SURFACE knot/mult length mismatch");
    TColStd_Array1OfReal    uKnots(1, static_cast<int>(ukS.size()));
    TColStd_Array1OfReal    vKnots(1, static_cast<int>(vkS.size()));
    TColStd_Array1OfInteger uMults(1, static_cast<int>(umS.size()));
    TColStd_Array1OfInteger vMults(1, static_cast<int>(vmS.size()));
    long uSum = 0, vSum = 0;
    for (int i = 0; i < static_cast<int>(ukS.size()); ++i) {
        double kv = 0, mv = 0;
        if (!stepNum(ukS[i], kv) || !stepNum(umS[i], mv)) fail("B_SPLINE_SURFACE u-knot value");
        uKnots.SetValue(i + 1, kv);
        const int m = static_cast<int>(std::lround(mv));
        uMults.SetValue(i + 1, m);
        uSum += m;
    }
    for (int i = 0; i < static_cast<int>(vkS.size()); ++i) {
        double kv = 0, mv = 0;
        if (!stepNum(vkS[i], kv) || !stepNum(vmS[i], mv)) fail("B_SPLINE_SURFACE v-knot value");
        vKnots.SetValue(i + 1, kv);
        const int m = static_cast<int>(std::lround(mv));
        vMults.SetValue(i + 1, m);
        vSum += m;
    }
    if (uSum != nU + uDeg + 1 || vSum != nV + vDeg + 1)
        fail("B_SPLINE_SURFACE periodic/knot-sum form unsupported");

    // optional rational weights (COMPLEX RATIONAL_B_SPLINE_SURFACE sub-record).
    bool rational = false;
    TColStd_Array2OfReal weights(1, nU, 1, nV);
    weights.Init(1.0);
    if (weightGridField) {
        std::vector<std::string> wrows;
        if (!parseList(*weightGridField, wrows) || static_cast<int>(wrows.size()) != nU)
            fail("RATIONAL_B_SPLINE_SURFACE weight grid");
        for (int iu = 0; iu < nU; ++iu) {
            std::vector<std::string> ws;
            if (!parseList(wrows[iu], ws) || static_cast<int>(ws.size()) != nV)
                fail("RATIONAL_B_SPLINE_SURFACE weight row");
            for (int iv = 0; iv < nV; ++iv) {
                double w = 0;
                if (!stepNum(ws[iv], w) || !(w > 0.0)) fail("RATIONAL_B_SPLINE_SURFACE weight");
                weights.SetValue(iu + 1, iv + 1, w);
                if (std::fabs(w - 1.0) > 1e-12) rational = true;
            }
        }
    }

    try {
        if (rational)
            return new Geom_BSplineSurface(poles, weights, uKnots, vKnots, uMults, vMults,
                                           uDeg, vDeg, Standard_False, Standard_False);
        return new Geom_BSplineSurface(poles, uKnots, vKnots, uMults, vMults,
                                       uDeg, vDeg, Standard_False, Standard_False);
    } catch (const Standard_Failure& e) {
        const char* m = e.GetMessageString();
        fail(std::string("Geom_BSplineSurface construction: ") + (m && *m ? m : "invalid data"));
    }
}

Handle(Geom_Surface) buildSurface(const Resolver& R, std::uint64_t id, double scale) {
    Instance ins;
    if (!R.get(id, ins)) fail("dangling surface #" + std::to_string(id));
    auto p = splitTopLevel(ins.params);
    auto axis2 = [&](std::size_t f, gp_Ax3& ax) -> bool {
        std::uint64_t ax2 = 0;
        if (p.size() <= f || !parseRef(p[f], ax2)) return false;
        gp_Ax2 a;
        if (!getAxis2(R, ax2, scale, a)) return false;
        ax = gp_Ax3(a);
        return true;
    };
    if (ins.type == "PLANE") {
        gp_Ax3 ax;
        if (!axis2(1, ax)) fail("PLANE placement");
        return new Geom_Plane(ax);
    }
    if (ins.type == "CYLINDRICAL_SURFACE") {
        gp_Ax3 ax; double r = 0;
        if (!axis2(1, ax) || p.size() < 3 || !stepNum(p[2], r)) fail("CYLINDRICAL_SURFACE");
        return new Geom_CylindricalSurface(ax, r * scale);
    }
    if (ins.type == "CONICAL_SURFACE") {
        gp_Ax3 ax; double r = 0, ang = 0;
        if (!axis2(1, ax) || p.size() < 4 || !stepNum(p[2], r) || !stepNum(p[3], ang))
            fail("CONICAL_SURFACE");
        return new Geom_ConicalSurface(ax, ang, r * scale);
    }
    if (ins.type == "SPHERICAL_SURFACE") {
        gp_Ax3 ax; double r = 0;
        if (!axis2(1, ax) || p.size() < 3 || !stepNum(p[2], r)) fail("SPHERICAL_SURFACE");
        return new Geom_SphericalSurface(ax, r * scale);
    }
    if (ins.type == "TOROIDAL_SURFACE") {
        gp_Ax3 ax; double rMaj = 0, rMin = 0;
        if (!axis2(1, ax) || p.size() < 4 || !stepNum(p[2], rMaj) || !stepNum(p[3], rMin))
            fail("TOROIDAL_SURFACE");
        return new Geom_ToroidalSurface(ax, rMaj * scale, rMin * scale);
    }
    if (ins.type == "B_SPLINE_SURFACE_WITH_KNOTS") {
        // plain (non-rational) form — drop the leading name field.
        if (p.size() < 12) fail("B_SPLINE_SURFACE_WITH_KNOTS arity");
        std::vector<std::string> fields(p.begin() + 1, p.end());
        return buildBSplineSurfaceGeom(R, fields, nullptr, scale);
    }
    if (ins.type == "SURFACE_OF_LINEAR_EXTRUSION") {
        // ('name', swept_curve, extrusion VECTOR). OCCT sweeps the UNIT direction;
        // the STEP vector magnitude only rescales the v-parameter, which face
        // building never relies on (pcurves are re-projected by ShapeFix), so the
        // surface geometry is identical.
        std::uint64_t curveId = 0, vecId = 0;
        if (p.size() < 3 || !parseRef(p[1], curveId) || !parseRef(p[2], vecId))
            fail("SURFACE_OF_LINEAR_EXTRUSION refs");
        std::string kind;
        Handle(Geom_Curve) basis = buildCurve3d(R, curveId, scale, kind);
        Instance vi;
        if (!R.get(vecId, vi) || vi.type != "VECTOR") fail("SURFACE_OF_LINEAR_EXTRUSION vector");
        auto vp = splitTopLevel(vi.params);
        std::uint64_t dirId = 0; gp_Dir d;
        if (vp.size() < 2 || !parseRef(vp[1], dirId) || !getDir(R, dirId, d))
            fail("SURFACE_OF_LINEAR_EXTRUSION direction");
        return new Geom_SurfaceOfLinearExtrusion(basis, d);
    }
    if (ins.type == "SURFACE_OF_REVOLUTION") {
        // ('name', swept_curve, AXIS1_PLACEMENT).
        std::uint64_t curveId = 0, axId = 0;
        if (p.size() < 3 || !parseRef(p[1], curveId) || !parseRef(p[2], axId))
            fail("SURFACE_OF_REVOLUTION refs");
        std::string kind;
        Handle(Geom_Curve) basis = buildCurve3d(R, curveId, scale, kind);
        gp_Ax1 ax;
        if (!getAxis1(R, axId, scale, ax)) fail("SURFACE_OF_REVOLUTION axis");
        return new Geom_SurfaceOfRevolution(basis, ax);
    }
    if (ins.type.empty()) {
        // COMPLEX surface record: (BOUNDED_SURFACE() B_SPLINE_SURFACE(...)
        //   B_SPLINE_SURFACE_WITH_KNOTS(...) ... RATIONAL_B_SPLINE_SURFACE(w) ...)
        // — the rational form OCCT's own writer emits. Assemble the post-name
        // field list from the two B-spline sub-records + the optional weights.
        auto subs = splitComplex(ins.params);
        const SubRecord* base = nullptr;      // B_SPLINE_SURFACE (deg + ctrl + form)
        const SubRecord* knots = nullptr;     // B_SPLINE_SURFACE_WITH_KNOTS (mult + knots)
        const SubRecord* rational = nullptr;  // RATIONAL_B_SPLINE_SURFACE (weights)
        for (const auto& sr : subs) {
            if (sr.type == "B_SPLINE_SURFACE") base = &sr;
            else if (sr.type == "B_SPLINE_SURFACE_WITH_KNOTS") knots = &sr;
            else if (sr.type == "RATIONAL_B_SPLINE_SURFACE") rational = &sr;
        }
        if (base && knots) {
            // B_SPLINE_SURFACE: uDeg,vDeg,ctrlGrid,form,uClosed,vClosed,selfInt
            // B_SPLINE_SURFACE_WITH_KNOTS: uMult,vMult,uKnots,vKnots[,knotSpec]
            auto bf = splitTopLevel(base->params);
            auto kf = splitTopLevel(knots->params);
            if (bf.size() < 7 || kf.size() < 4) fail("complex B_SPLINE_SURFACE arity");
            std::vector<std::string> fields;
            fields.reserve(11);
            for (int i = 0; i < 7; ++i) fields.push_back(bf[i]);
            for (int i = 0; i < 4; ++i) fields.push_back(kf[i]);
            std::string weightGrid;
            const std::string* wp = nullptr;
            if (rational) {
                auto rf = splitTopLevel(rational->params);
                if (rf.empty()) fail("RATIONAL_B_SPLINE_SURFACE arity");
                weightGrid = rf[0];
                wp = &weightGrid;
            }
            return buildBSplineSurfaceGeom(R, fields, wp, scale);
        }
    }
    fail("unsupported surface entity '" + (ins.type.empty() ? std::string("COMPLEX") : ins.type) + "'");
}

// Peel SURFACE_CURVE / SEAM_CURVE / INTERSECTION_CURVE wrappers to the 3D curve.
std::uint64_t resolve3dCurve(const Resolver& R, std::uint64_t id) {
    for (int g = 0; g < 8; ++g) {
        Instance ci;
        if (!R.get(id, ci)) return id;
        if (ci.type != "SURFACE_CURVE" && ci.type != "SEAM_CURVE" &&
            ci.type != "INTERSECTION_CURVE" && ci.type != "BOUNDED_SURFACE_CURVE")
            return id;
        auto cp = splitTopLevel(ci.params);
        std::uint64_t inner = 0;
        if (cp.size() < 2 || !parseRef(cp[1], inner)) return id;
        id = inner;
    }
    return id;
}

// Reconstruct a Geom_BSplineCurve from the B_SPLINE_CURVE_WITH_KNOTS field set.
// `fields` is POST-NAME:
//   0:degree 1:ctrlPts 2:form 3:closed 4:selfInt 5:mults 6:knots [7:knotSpec]
// (the COMPLEX rational form concatenates B_SPLINE_CURVE's 5 fields with
// WITH_KNOTS' 2-3 — the same split the surface builder uses). `weightsField`,
// when non-null, is the RATIONAL_B_SPLINE_CURVE weight list "(w,..)" — one
// weight per pole. Poles are CARTESIAN_POINTs (mm-scaled by getPoint); knots
// are PARAMETRIC (unscaled). Only the CLAMPED/open knot form is built.
Handle(Geom_Curve) buildBSplineCurveGeom(const Resolver& R,
                                         const std::vector<std::string>& fields,
                                         const std::string* weightsField,
                                         double scale) {
    if (fields.size() < 7) fail("B_SPLINE arity");
    double degd = 0;
    if (!stepNum(fields[0], degd)) fail("B_SPLINE degree");
    const int degree = static_cast<int>(std::lround(degd));
    if (degree < 1) fail("B_SPLINE degree range");
    std::vector<std::string> ctrlToks, multToks, knotToks;
    if (!parseList(fields[1], ctrlToks) || ctrlToks.empty()) fail("B_SPLINE control points");
    if (!parseList(fields[5], multToks) || multToks.empty()) fail("B_SPLINE multiplicities");
    if (!parseList(fields[6], knotToks) || knotToks.empty()) fail("B_SPLINE knots");
    if (knotToks.size() != multToks.size()) fail("B_SPLINE knot/mult length mismatch");
    const int nPoles = static_cast<int>(ctrlToks.size());
    TColgp_Array1OfPnt poles(1, nPoles);
    for (int i = 0; i < nPoles; ++i) {
        std::uint64_t cpId = 0; gp_Pnt cp;
        if (!parseRef(ctrlToks[i], cpId) || !getPoint(R, cpId, scale, cp)) fail("B_SPLINE pole");
        poles.SetValue(i + 1, cp);
    }
    TColStd_Array1OfReal    knots(1, static_cast<int>(knotToks.size()));
    TColStd_Array1OfInteger mults(1, static_cast<int>(multToks.size()));
    for (int i = 0; i < static_cast<int>(knotToks.size()); ++i) {
        double kv = 0, mv = 0;
        if (!stepNum(knotToks[i], kv) || !stepNum(multToks[i], mv)) fail("B_SPLINE knot/mult value");
        knots.SetValue(i + 1, kv);
        mults.SetValue(i + 1, static_cast<int>(std::lround(mv)));
    }
    // optional rational weights (COMPLEX RATIONAL_B_SPLINE_CURVE sub-record).
    bool rational = false;
    TColStd_Array1OfReal weights(1, nPoles);
    weights.Init(1.0);
    if (weightsField) {
        std::vector<std::string> ws;
        if (!parseList(*weightsField, ws) || static_cast<int>(ws.size()) != nPoles)
            fail("RATIONAL_B_SPLINE_CURVE weight count");
        for (int i = 0; i < nPoles; ++i) {
            double w = 0;
            if (!stepNum(ws[i], w) || !(w > 0.0)) fail("RATIONAL_B_SPLINE_CURVE weight");
            weights.SetValue(i + 1, w);
            if (std::fabs(w - 1.0) > 1e-12) rational = true;
        }
    }
    // STEP 'closed' flag -> build non-periodic; a clamped closed spline simply has
    // coincident first/last poles, which OCCT handles as an open range.
    try {
        if (rational)
            return new Geom_BSplineCurve(poles, weights, knots, mults, degree, Standard_False);
        return new Geom_BSplineCurve(poles, knots, mults, degree, Standard_False);
    } catch (const Standard_Failure& e) {
        const char* m = e.GetMessageString();
        fail(std::string("Geom_BSplineCurve construction: ") + (m && *m ? m : "invalid data"));
    }
}

// ------------------------------------------------------------------ 3D curves
Handle(Geom_Curve) buildCurve3d(const Resolver& R, std::uint64_t rawId, double scale,
                                std::string& kind) {
    std::uint64_t id = resolve3dCurve(R, rawId);
    Instance ci;
    if (!R.get(id, ci)) fail("dangling curve #" + std::to_string(id));
    kind = ci.type;
    auto p = splitTopLevel(ci.params);
    if (ci.type == "LINE") {
        // LINE('', point, vector); VECTOR('', direction, magnitude).
        std::uint64_t ptId = 0, vecId = 0;
        if (p.size() < 3 || !parseRef(p[1], ptId) || !parseRef(p[2], vecId)) fail("LINE");
        gp_Pnt o;
        if (!getPoint(R, ptId, scale, o)) fail("LINE point");
        Instance vi;
        if (!R.get(vecId, vi) || vi.type != "VECTOR") fail("LINE vector");
        auto vp = splitTopLevel(vi.params);
        std::uint64_t dirId = 0;
        gp_Dir d;
        if (vp.size() < 2 || !parseRef(vp[1], dirId) || !getDir(R, dirId, d)) fail("LINE dir");
        return new Geom_Line(o, d);
    }
    if (ci.type == "CIRCLE") {
        std::uint64_t axId = 0; double r = 0;
        if (p.size() < 3 || !parseRef(p[1], axId) || !stepNum(p[2], r)) fail("CIRCLE");
        gp_Ax2 ax;
        if (!getAxis2(R, axId, scale, ax)) fail("CIRCLE axis");
        return new Geom_Circle(ax, r * scale);
    }
    if (ci.type == "ELLIPSE") {
        std::uint64_t axId = 0; double a = 0, b = 0;
        if (p.size() < 4 || !parseRef(p[1], axId) || !stepNum(p[2], a) || !stepNum(p[3], b))
            fail("ELLIPSE");
        gp_Ax2 ax;
        if (!getAxis2(R, axId, scale, ax)) fail("ELLIPSE axis");
        return new Geom_Ellipse(ax, a * scale, b * scale);
    }
    if (ci.type == "B_SPLINE_CURVE_WITH_KNOTS") {
        // B_SPLINE_CURVE_WITH_KNOTS('', degree, (ctrl_pts), form, closed, self_int,
        //                           (knot_multiplicities), (knots), knot_spec).
        if (p.size() < 8) fail("B_SPLINE arity");
        std::vector<std::string> fields(p.begin() + 1, p.end());
        return buildBSplineCurveGeom(R, fields, nullptr, scale);
    }
    if (ci.type.empty()) {
        // COMPLEX curve record — the rational form OCCT's own writer emits:
        //   (BOUNDED_CURVE() B_SPLINE_CURVE(deg,(ctrl),form,closed,selfInt)
        //    B_SPLINE_CURVE_WITH_KNOTS((mults),(knots),spec) CURVE() ...
        //    RATIONAL_B_SPLINE_CURVE((weights)) REPRESENTATION_ITEM(''))
        // Assemble the post-name field list from the two B-spline sub-records +
        // the optional weights (same pattern as the COMPLEX surface branch).
        auto subs = splitComplex(ci.params);
        const SubRecord* base = nullptr;      // B_SPLINE_CURVE (deg + ctrl + form)
        const SubRecord* knots = nullptr;     // B_SPLINE_CURVE_WITH_KNOTS (mults + knots)
        const SubRecord* rational = nullptr;  // RATIONAL_B_SPLINE_CURVE (weights)
        for (const auto& sr : subs) {
            if (sr.type == "B_SPLINE_CURVE") base = &sr;
            else if (sr.type == "B_SPLINE_CURVE_WITH_KNOTS") knots = &sr;
            else if (sr.type == "RATIONAL_B_SPLINE_CURVE") rational = &sr;
        }
        if (base && knots) {
            auto bf = splitTopLevel(base->params);   // deg,(ctrl),form,closed,selfInt
            auto kf = splitTopLevel(knots->params);  // (mults),(knots)[,spec]
            if (bf.size() < 5 || kf.size() < 2) fail("complex B_SPLINE_CURVE arity");
            std::vector<std::string> fields;
            fields.reserve(8);
            for (int i = 0; i < 5; ++i) fields.push_back(bf[i]);
            for (std::size_t i = 0; i < kf.size() && i < 3; ++i) fields.push_back(kf[i]);
            std::string weightList;
            const std::string* wp = nullptr;
            if (rational) {
                auto rf = splitTopLevel(rational->params);
                if (rf.empty()) fail("RATIONAL_B_SPLINE_CURVE arity");
                weightList = rf[0];
                wp = &weightList;
            }
            kind = "B_SPLINE_CURVE_WITH_KNOTS";   // edge assembly takes the spline path
            return buildBSplineCurveGeom(R, fields, wp, scale);
        }
    }
    fail("unsupported 3D edge curve '" + (ci.type.empty() ? std::string("COMPLEX") : ci.type) + "'");
}

// ------------------------------------------------------------------ transfer state
struct Xfer {
    Resolver R;
    double scale = 1.0;
    double tol = Precision::Confusion();   // file's declared uncertainty (mm), floored at 1e-7
    std::map<std::uint64_t, TopoDS_Vertex> verts;   // VERTEX_POINT id -> vertex
    std::map<std::uint64_t, TopoDS_Edge>   edges;    // EDGE_CURVE id -> shared edge (v1->v2)
};

TopoDS_Vertex vertexOf(Xfer& X, std::uint64_t vpId) {
    auto it = X.verts.find(vpId);
    if (it != X.verts.end()) return it->second;
    Instance vp;
    if (!X.R.get(vpId, vp) || vp.type != "VERTEX_POINT") fail("VERTEX_POINT #" + std::to_string(vpId));
    auto p = splitTopLevel(vp.params);
    std::uint64_t cp = 0;
    gp_Pnt pt;
    if (p.size() < 2 || !parseRef(p[1], cp) || !getPoint(X.R, cp, X.scale, pt)) fail("VERTEX_POINT point");
    TopoDS_Vertex v = BRepBuilderAPI_MakeVertex(pt);
    if (X.tol > Precision::Confusion()) {
        // carry the file's declared accuracy — a conforming writer only promises
        // its vertices sit on their curves within THIS tolerance, not 1e-7.
        BRep_Builder b;
        b.UpdateVertex(v, X.tol);
    }
    X.verts.emplace(vpId, v);
    return v;
}

// Parameter of P on curve c: robust ShapeAnalysis projection (never "no result",
// unlike GeomAPI extrema on high-degree splines) with an exact endpoint snap —
// a vertex that lies on a curve END within tolerance gets the EXACT boundary
// parameter, so full-span trimmed edges use the curve's own range.
double paramOnCurve(const Handle(Geom_Curve)& c, const gp_Pnt& P, double tol, double& dist) {
    const double cf = c->FirstParameter(), cl = c->LastParameter();
    gp_Pnt proj;
    double u = cf;
    ShapeAnalysis_Curve sac;
    dist = sac.Project(c, P, Precision::Confusion(), proj, u, Standard_False);
    const double dF = P.Distance(c->Value(cf));
    const double dL = P.Distance(c->Value(cl));
    if (dF <= dist + tol && dF <= dL) { dist = dF; return cf; }
    if (dL <= dist + tol) { dist = dL; return cl; }
    return u;
}

// Build the edge v1(u1) -> v2(u2) on `c` (u1 < u2 required; u2 may exceed the
// period for periodic curves) via a tolerance LADDER:
//   1. OCCT-validated BRepBuilderAPI_MakeEdge with explicit parameters;
//   2. inflate the vertex tolerances to the actual parameter-point gap, retry
//      (covers conforming files whose declared 1e-6 accuracy the hard 1e-7
//      check rejects, and reconstructed high-degree splines whose trim points
//      land ~1e-6 off-curve);
//   3. manual BRep_Builder edge with the same curve/vertices/range — structurally
//      valid by construction; the post-transfer ShapeFix + SameParameter pass
//      reconciles tolerances exactly as it does for every other edge.
// A gap beyond 1.0mm fails honestly (a wrong parameter branch, not file slop).
// 1.0mm is OCCT's own reader ceiling (read.maxprecision.val default) — the
// fixture corpus needs it: slop tops out at 0.62mm (an almost-closed spline
// loop whose clamped ends the writer left 0.617mm apart), which TKDESTEP's
// STEPControl_Reader accepts through exactly this tolerance inflation.
TopoDS_Edge ladderEdge(const Handle(Geom_Curve)& c, const TopoDS_Vertex& v1,
                       const TopoDS_Vertex& v2, double u1, double u2, const char* what) {
    try {
        BRepBuilderAPI_MakeEdge me(c, v1, v2, u1, u2);
        if (me.IsDone()) return me.Edge();
    } catch (const Standard_Failure&) {}
    const double g1 = c->Value(u1).Distance(BRep_Tool::Pnt(v1));
    const double g2 = c->Value(u2).Distance(BRep_Tool::Pnt(v2));
    if (g1 > 1.0 || g2 > 1.0)
        fail(std::string(what) + " trim gap beyond 1.0mm ceiling (g1=" +
             std::to_string(g1) + " g2=" + std::to_string(g2) + ")");
    BRep_Builder b;
    b.UpdateVertex(v1, std::max(BRep_Tool::Tolerance(v1), g1 * 1.001 + Precision::Confusion()));
    b.UpdateVertex(v2, std::max(BRep_Tool::Tolerance(v2), g2 * 1.001 + Precision::Confusion()));
    try {
        BRepBuilderAPI_MakeEdge me(c, v1, v2, u1, u2);
        if (me.IsDone()) return me.Edge();
    } catch (const Standard_Failure&) {}
    TopoDS_Edge e;
    b.MakeEdge(e, c, Precision::Confusion());
    b.Add(e, TopoDS::Vertex(v1.Oriented(TopAbs_FORWARD)));
    b.Add(e, TopoDS::Vertex(v2.Oriented(TopAbs_REVERSED)));
    b.Range(e, u1, u2);
    return e;
}

// Build (once) the shared, FORWARD edge (running v0 -> v1 in the file's start->end
// sense) for an EDGE_CURVE. Circles/ellipses honour same_sense so the correct arc
// is taken; a full closed curve (v0==v1) becomes a closed edge.
TopoDS_Edge edgeOf(Xfer& X, std::uint64_t ecId) {
    auto it = X.edges.find(ecId);
    if (it != X.edges.end()) return it->second;
    Instance ec;
    if (!X.R.get(ecId, ec) || ec.type != "EDGE_CURVE") fail("EDGE_CURVE #" + std::to_string(ecId));
    auto p = splitTopLevel(ec.params);
    if (p.size() < 5) fail("EDGE_CURVE arity");
    std::uint64_t vS = 0, vE = 0, curveId = 0;
    if (!parseRef(p[1], vS) || !parseRef(p[2], vE)) fail("EDGE_CURVE vertices");
    const bool sameSense = (p[4] == ".T.");
    TopoDS_Vertex Vs = vertexOf(X, vS);
    TopoDS_Vertex Ve = vertexOf(X, vE);
    gp_Pnt Ps = BRep_Tool::Pnt(Vs);
    gp_Pnt Pe = BRep_Tool::Pnt(Ve);

    // curve geometry absent ('*'/'$') -> a straight segment between the vertices.
    std::string kind;
    Handle(Geom_Curve) curve;
    if (p[3] == "*" || p[3] == "$") {
        gp_Vec dv(Ps, Pe);
        if (dv.Magnitude() < 1e-12) fail("degenerate topological edge");
        curve = new Geom_Line(Ps, gp_Dir(dv));
        kind = "LINE";
    } else {
        if (!parseRef(p[3], curveId)) fail("EDGE_CURVE curve ref");
        curve = buildCurve3d(X.R, curveId, X.scale, kind);
    }

    TopoDS_Edge e;
    if (kind == "LINE") {
        // Explicit parameters via exact line projection (ElCLib), then the ladder —
        // MakeEdge's internal projection rejects conforming files whose vertices sit
        // ~declared-uncertainty off the reconstructed line.
        gp_Lin lin = Handle(Geom_Line)::DownCast(curve)->Lin();
        const double u0 = ElCLib::Parameter(lin, Ps);
        const double u1 = ElCLib::Parameter(lin, Pe);
        if (std::fabs(u1 - u0) <= Precision::Confusion()) fail("MakeEdge(line) degenerate");
        if (u1 > u0) e = ladderEdge(curve, Vs, Ve, u0, u1, "MakeEdge(line)");
        else         e = TopoDS::Edge(ladderEdge(curve, Ve, Vs, u1, u0, "MakeEdge(line)").Reversed());
    } else if (kind == "B_SPLINE_CURVE_WITH_KNOTS") {
        // PARAMETER-SPACE trimming: locate both trim parameters by robust projection
        // (+ exact endpoint snap), then build with EXPLICIT parameters through the
        // tolerance ladder. This clears the deferred edge-trim hard case — the
        // kernel-writer's own degree-8 / rational exports whose projected vertices
        // land ~1e-6 off the reconstructed curve and failed the hard-1e-7 MakeEdge.
        const double cf = curve->FirstParameter(), cl = curve->LastParameter();
        double u0 = 0, u1 = 0, d0 = 0, d1 = 0;
        u0 = paramOnCurve(curve, Ps, X.tol, d0);
        u1 = paramOnCurve(curve, Pe, X.tol, d1);
        (void)d0; (void)d1;   // gap re-measured inside the ladder
        // Full-loop edge ONLY when the trim parameters actually coincide (one
        // vertex, or two stacked at the seam). Two DISTINCT near-coincident
        // vertices with distinct parameters are a short arc, not a loop.
        const bool closed =
            (Vs.IsSame(Ve) || (Ps.Distance(Pe) <= std::max(X.tol, 1e-7) &&
                               std::fabs(u1 - u0) <= Precision::PConfusion()));
        if (closed) {
            // closed spline edge -> the curve's full natural span.
            e = ladderEdge(curve, Vs, Ve, cf, cl, "MakeEdge(bspline,closed)");
        } else if (u1 > u0 + Precision::PConfusion()) {
            e = ladderEdge(curve, Vs, Ve, u0, u1, "MakeEdge(bspline)");
        } else if (u0 > u1 + Precision::PConfusion()) {
            // edge runs v0->v1 along DECREASING parameter: build forward, reverse.
            e = TopoDS::Edge(ladderEdge(curve, Ve, Vs, u1, u0, "MakeEdge(bspline)").Reversed());
        } else {
            fail("B_SPLINE degenerate trim (coincident parameters)");
        }
    } else {
        // CIRCLE / ELLIPSE — periodic. Parameterise the two vertices on the curve
        // and pick the arc respecting same_sense (curve natural dir vs edge dir).
        const double twoPi = 2.0 * M_PI;
        double u0, u1;
        if (kind == "CIRCLE") {
            gp_Circ c = Handle(Geom_Circle)::DownCast(curve)->Circ();
            u0 = ElCLib::Parameter(c, Ps);
            u1 = ElCLib::Parameter(c, Pe);
        } else {
            gp_Elips c = Handle(Geom_Ellipse)::DownCast(curve)->Elips();
            u0 = ElCLib::Parameter(c, Ps);
            u1 = ElCLib::Parameter(c, Pe);
        }
        auto norm = [&](double a) { a = std::fmod(a, twoPi); if (a < 0) a += twoPi; return a; };
        u0 = norm(u0); u1 = norm(u1);
        const bool closed = Ps.Distance(Pe) <= std::max(X.tol, 1e-7);
        if (sameSense) {
            double a = u0, b = u1;
            if (closed) b = a + twoPi;
            else if (b <= a + 1e-9) b += twoPi;
            e = ladderEdge(curve, Vs, Ve, a, b, "MakeEdge(arc,+)");
        } else {
            // edge runs v0->v1 along DECREASING param: build v1->v0 forward, reverse.
            double a = u1, b = u0;
            if (closed) b = a + twoPi;
            else if (b <= a + 1e-9) b += twoPi;
            e = TopoDS::Edge(ladderEdge(curve, Ve, Vs, a, b, "MakeEdge(arc,-)").Reversed());
        }
    }
    X.edges.emplace(ecId, e);
    return e;
}

// EDGE_LOOP -> wire of oriented shared edges.
TopoDS_Wire buildWire(Xfer& X, std::uint64_t loopId) {
    Instance li;
    if (!X.R.get(loopId, li) || li.type != "EDGE_LOOP") fail("EDGE_LOOP #" + std::to_string(loopId));
    auto lp = splitTopLevel(li.params);
    std::vector<std::string> oeRefs;
    if (lp.size() < 2 || !parseList(lp[1], oeRefs) || oeRefs.empty()) fail("EDGE_LOOP list");
    BRepBuilderAPI_MakeWire mw;
    for (const auto& oref : oeRefs) {
        std::uint64_t oeId = 0;
        if (!parseRef(oref, oeId)) fail("ORIENTED_EDGE ref");
        Instance oi;
        if (!X.R.get(oeId, oi) || oi.type != "ORIENTED_EDGE") fail("ORIENTED_EDGE #" + std::to_string(oeId));
        auto op = splitTopLevel(oi.params);
        if (op.size() < 5) fail("ORIENTED_EDGE arity");
        std::uint64_t ecId = 0;
        if (!parseRef(op[3], ecId)) fail("ORIENTED_EDGE edge ref");
        const bool orient = (op[4] == ".T.");
        TopoDS_Edge e = edgeOf(X, ecId);   // forward (v0->v1)
        TopoDS_Edge oe = orient ? e : TopoDS::Edge(e.Reversed());
        mw.Add(oe);
    }
    // NB: MakeWire may report NotDone on an out-of-order add; the healer fixes it.
    return mw.Wire();
}

}  // anonymous namespace

TopoDS_Shape foreignStepToOcct(const std::string& text) {
    std::size_t dB = 0, dE = 0; std::string why;
    if (!p21::locateSections(text, dB, dE, why)) fail(why);
    Table tab;
    if (!p21::parseInstances(text, dB, dE, tab, why)) fail(why);
    if (tab.empty()) fail("empty DATA section");

    Xfer X{Resolver{tab}};
    X.scale = resolveScale(tab);
    X.tol = std::max(Precision::Confusion(), resolveUncertainty(tab, X.scale));
    const Resolver& R = X.R;

    // --- collect the shells (MANIFOLD_SOLID_BREP / SHELL_BASED / bare CLOSED_SHELL) ---
    std::vector<std::uint64_t> shellIds;
    std::map<std::uint64_t, bool> shellSeen;
    auto addShell = [&](std::uint64_t sid) {
        Instance si;
        if (R.get(sid, si) && (si.type == "CLOSED_SHELL" || si.type == "OPEN_SHELL")) {
            if (!shellSeen[sid]) { shellSeen[sid] = true; shellIds.push_back(sid); }
        }
    };
    bool anyRoot = false;
    for (const auto& kv : tab) {
        const Instance& ins = kv.second;
        if (ins.type == "MANIFOLD_SOLID_BREP" || ins.type == "BREP_WITH_VOIDS") {
            auto p = splitTopLevel(ins.params);
            if (p.size() >= 2) { std::uint64_t s; if (parseRef(p[1], s)) addShell(s); }
            anyRoot = true;
        } else if (ins.type == "SHELL_BASED_SURFACE_MODEL") {
            auto p = splitTopLevel(ins.params);
            std::vector<std::string> refs;
            if (p.size() >= 2 && parseList(p[1], refs))
                for (const auto& r : refs) { std::uint64_t s; if (parseRef(r, s)) addShell(s); }
            anyRoot = true;
        }
    }
    if (!anyRoot)
        for (const auto& kv : tab)
            if (kv.second.type == "CLOSED_SHELL" || kv.second.type == "OPEN_SHELL") addShell(kv.first);
    if (shellIds.empty()) fail("no CLOSED_SHELL/OPEN_SHELL found");

    BRep_Builder BB;
    std::vector<TopoDS_Shell> builtShells;

    for (std::uint64_t sid : shellIds) {
        Instance si; R.get(sid, si);
        auto sp = splitTopLevel(si.params);
        std::vector<std::string> frefs;
        if (sp.size() < 2 || !parseList(sp[1], frefs) || frefs.empty()) fail("shell face list");

        TopoDS_Shell shell;
        BB.MakeShell(shell);
        int nFaces = 0;

        for (const auto& fr : frefs) {
            std::uint64_t fid = 0;
            if (!parseRef(fr, fid)) fail("face ref");
            Instance fi;
            if (!R.get(fid, fi) || (fi.type != "ADVANCED_FACE" && fi.type != "FACE_SURFACE"))
                fail("ADVANCED_FACE #" + std::to_string(fid));
            auto fp = splitTopLevel(fi.params);
            if (fp.size() < 4) fail("ADVANCED_FACE arity");
            std::vector<std::string> boundRefs;
            if (!parseList(fp[1], boundRefs) || boundRefs.empty()) fail("face bounds");
            std::uint64_t surfId = 0;
            if (!parseRef(fp[2], surfId)) fail("face surface ref");
            const bool faceSame = (fp[3] == ".T.");

            Handle(Geom_Surface) surf = buildSurface(R, surfId, X.scale);

            // Build every EDGE_LOOP bound's wire; pick the OUTER (FACE_OUTER_BOUND,
            // else the widest 3D bbox). Apply each FACE_BOUND orientation to its wire.
            // A VERTEX_LOOP (degenerate, single-vertex) bound carries no edge — it
            // marks a face that spans the WHOLE surface (a closed sphere / torus wrap
            // written as one face with a seam-point loop). Such a face is built over
            // the surface's NATURAL parametric bounds (no wire).
            struct B { TopoDS_Wire w; bool outer; double diag; };
            std::vector<B> bounds;
            for (const auto& br : boundRefs) {
                std::uint64_t bid = 0;
                if (!parseRef(br, bid)) fail("bound ref");
                Instance bi;
                if (!R.get(bid, bi) || (bi.type != "FACE_BOUND" && bi.type != "FACE_OUTER_BOUND"))
                    fail("FACE_BOUND #" + std::to_string(bid));
                auto bp = splitTopLevel(bi.params);
                std::uint64_t loopId = 0;
                if (bp.size() < 3 || !parseRef(bp[1], loopId)) fail("FACE_BOUND loop");
                const bool bOrient = (bp[2] == ".T.");
                Instance li;
                if (!R.get(loopId, li)) fail("dangling loop #" + std::to_string(loopId));
                if (li.type == "VERTEX_LOOP") continue;      // degenerate -> natural bounds
                if (li.type != "EDGE_LOOP")
                    fail("unsupported loop '" + li.type + "' #" + std::to_string(loopId));
                TopoDS_Wire w = buildWire(X, loopId);
                if (!bOrient) w = TopoDS::Wire(w.Reversed());
                Bnd_Box bb; BRepBndLib::Add(w, bb);
                double xmin, ymin, zmin, xmax, ymax, zmax;
                double diag = 0;
                if (!bb.IsVoid()) {
                    bb.Get(xmin, ymin, zmin, xmax, ymax, zmax);
                    diag = (xmax - xmin) * (xmax - xmin) + (ymax - ymin) * (ymax - ymin) +
                           (zmax - zmin) * (zmax - zmin);
                }
                bounds.push_back({w, bi.type == "FACE_OUTER_BOUND", diag});
            }

            TopoDS_Face face;
            if (bounds.empty()) {
                // whole-surface face (all bounds degenerate) — natural parametric bounds.
                BRepBuilderAPI_MakeFace mkf(surf, Precision::Confusion());
                if (!mkf.IsDone()) fail("MakeFace(natural) failed");
                face = mkf.Face();
            } else {
                // choose outer
                int outerIdx = -1;
                for (std::size_t i = 0; i < bounds.size(); ++i)
                    if (bounds[i].outer) { outerIdx = (int)i; break; }
                if (outerIdx < 0) {
                    double best = -1;
                    for (std::size_t i = 0; i < bounds.size(); ++i)
                        if (bounds[i].diag > best) { best = bounds[i].diag; outerIdx = (int)i; }
                }
                if (outerIdx < 0) fail("no outer bound");

                BRepBuilderAPI_MakeFace mkf(surf, bounds[outerIdx].w, Standard_False);
                if (!mkf.IsDone()) fail("MakeFace failed");
                for (std::size_t i = 0; i < bounds.size(); ++i)
                    if ((int)i != outerIdx) mkf.Add(bounds[i].w);
                face = mkf.Face();
            }
            if (face.IsNull()) fail("null face");
            if (!faceSame) face = TopoDS::Face(face.Reversed());
            BB.Add(shell, face);
            ++nFaces;
        }
        if (nFaces == 0) fail("shell has no faces");
        builtShells.push_back(shell);
    }

    // Assemble a solid from the (first/only) shell; heal pcurves + orientation.
    TopoDS_Shape raw;
    if (builtShells.size() == 1) {
        TopoDS_Solid solid;
        BB.MakeSolid(solid);
        BB.Add(solid, builtShells[0]);
        raw = solid;
    } else {
        TopoDS_Compound comp;
        BB.MakeCompound(comp);
        for (auto& sh : builtShells) BB.Add(comp, sh);
        raw = comp;
    }

    // ShapeFix: add the missing analytic pcurves (project each 3D edge onto its
    // adjacent surfaces), fix same-parameter and face/shell orientation.
    Handle(ShapeFix_Shape) sfs = new ShapeFix_Shape(raw);
    sfs->SetPrecision(std::max(1e-6, X.tol));
    sfs->SetMaxTolerance(1.0);   // OCCT reader parity (read.maxprecision.val default)
    sfs->Perform();
    TopoDS_Shape fixed = sfs->Shape();
    BRepLib::SameParameter(fixed, 1e-6, Standard_True);

    // Orient by volume sign so the outward normal is consistent. Type-agnostic:
    // ShapeFix may return the solid wrapped in a compound (fixtures 243/246
    // measured inside-out under the solid-only check).
    {
        GProp_GProps vp;
        BRepGProp::VolumeProperties(fixed, vp);
        if (vp.Mass() < 0.0) fixed = fixed.Reversed();
    }
    if (fixed.IsNull()) fail("transfer produced a null shape");
    return fixed;
}

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP
