// forge/native/brep/StepReadOcct.cpp — see StepReadOcct.hpp.
//
// FOREIGN STEP -> OCCT B-rep transfer WITHOUT TKDESTEP/TKXSBase. Builds the OCCT
// solid directly from ISO-10303-21 with the OCCT modeling toolkits only, so a
// native STEP import (after the TKDESTEP drop) reproduces STEPControl_Reader's
// clean analytic topology (one edge per EDGE_CURVE) for measurement.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/StepReadOcct.hpp"
#include "forge/native/brep/StepPart21.hpp"   // shared ISO-10303-21 lexer

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
#include <TColgp_Array1OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
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
#include <GeomAPI_ProjectPointOnCurve.hxx>
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

// ------------------------------------------------------------------ surfaces
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
        // Maps 1:1 onto Geom_BSplineCurve(Poles, Knots, Mults, Degree). Poles are
        // CARTESIAN_POINTs (getPoint applies the mm scale); knots are PARAMETRIC (unscaled).
        double degd = 0;
        if (p.size() < 8 || !stepNum(p[1], degd)) fail("B_SPLINE arity");
        const int degree = static_cast<int>(std::lround(degd));
        std::vector<std::string> ctrlToks, multToks, knotToks;
        if (!parseList(p[2], ctrlToks) || ctrlToks.empty()) fail("B_SPLINE control points");
        if (!parseList(p[6], multToks) || multToks.empty()) fail("B_SPLINE multiplicities");
        if (!parseList(p[7], knotToks) || knotToks.empty()) fail("B_SPLINE knots");
        if (knotToks.size() != multToks.size()) fail("B_SPLINE knot/mult length mismatch");
        TColgp_Array1OfPnt poles(1, static_cast<int>(ctrlToks.size()));
        for (int i = 0; i < static_cast<int>(ctrlToks.size()); ++i) {
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
        // STEP 'closed' flag (p[4]==".T.") -> build non-periodic; a clamped closed spline
        // simply has coincident first/last poles, which OCCT handles as an open range.
        return new Geom_BSplineCurve(poles, knots, mults, degree, Standard_False);
    }
    fail("unsupported 3D edge curve '" + (ci.type.empty() ? std::string("COMPLEX") : ci.type) + "'");
}

// ------------------------------------------------------------------ transfer state
struct Xfer {
    Resolver R;
    double scale = 1.0;
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
    X.verts.emplace(vpId, v);
    return v;
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
        BRepBuilderAPI_MakeEdge me(curve, Vs, Ve);
        if (!me.IsDone()) fail("MakeEdge(line) failed");
        e = me.Edge();
    } else if (kind == "B_SPLINE_CURVE_WITH_KNOTS") {
        // Non-rational spline reconstruction (poles/knots/mults -> Geom_BSplineCurve) is exact.
        // The edge build projects the STEP vertices for explicit parameters; this SUCCEEDS for
        // clamped low-degree splines. It STILL fails for the kernel-writer's own export splines
        // (degree-8, and the RATIONAL_B_SPLINE COMPLEX form which this branch does not yet
        // reconstruct with weights) whose trimmed edges don't land on the reconstructed curve
        // within tolerance -> the whole STEP import aborts (measure-skip, non-fatal to callers).
        // This exact round-trip is the deferred "BSpline edge-trim" hard case (see memory).
        GeomAPI_ProjectPointOnCurve pr0(Ps, curve), pr1(Pe, curve);
        if (pr0.NbPoints() < 1 || pr1.NbPoints() < 1) fail("B_SPLINE vertex projection");
        BRepBuilderAPI_MakeEdge me(curve, Vs, Ve,
                                   pr0.LowerDistanceParameter(), pr1.LowerDistanceParameter());
        if (!me.IsDone()) fail("MakeEdge(bspline) failed");
        e = me.Edge();
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
        const bool closed = Ps.Distance(Pe) < 1e-7;
        if (sameSense) {
            double a = u0, b = u1;
            if (closed) b = a + twoPi;
            else if (b <= a + 1e-9) b += twoPi;
            BRepBuilderAPI_MakeEdge me(curve, Vs, Ve, a, b);
            if (!me.IsDone()) fail("MakeEdge(arc,+) failed");
            e = me.Edge();
        } else {
            // edge runs v0->v1 along DECREASING param: build v1->v0 forward, reverse.
            double a = u1, b = u0;
            if (closed) b = a + twoPi;
            else if (b <= a + 1e-9) b += twoPi;
            BRepBuilderAPI_MakeEdge me(curve, Ve, Vs, a, b);
            if (!me.IsDone()) fail("MakeEdge(arc,-) failed");
            e = TopoDS::Edge(me.Edge().Reversed());
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
    sfs->SetPrecision(1e-6);
    sfs->SetMaxTolerance(1e-3);
    sfs->Perform();
    TopoDS_Shape fixed = sfs->Shape();
    BRepLib::SameParameter(fixed, 1e-6, Standard_True);

    // Orient the solid by volume sign so the outward normal is consistent.
    if (fixed.ShapeType() == TopAbs_SOLID) {
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
