// forge/OcctPrimBuilder.cpp — TKPrim-free analytic OCCT primitive solids.
// See header. Every primitive is built DIRECTLY from a Geom_ analytic surface
// (TKG3d) with BRepBuilderAPI (TKBRep/TKTopAlgo) — NO BRepPrimAPI (TKPrim).

#include "forge/OcctPrimBuilder.hpp"

#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <gp_Circ.hxx>
#include <gp_Ax1.hxx>
#include <gp_Trsf.hxx>
#include <gp_Lin.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Curve.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Compound.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepLib.hxx>
#include <Precision.hxx>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace forge {
namespace {

constexpr double kTwoPi = 6.28318530717958647692;

// Wrap a single already-closed periodic face (sphere / torus) as a solid, oriented
// to positive volume. The lone face's natural bounds carry the seam + degenerate
// pole edges, so the one-face shell is a valid closed 2-manifold.
TopoDS_Solid singleFaceSolid(const TopoDS_Face& f) {
    if (f.IsNull()) throw std::runtime_error("occtPrim: null periodic face");
    BRep_Builder bb;
    TopoDS_Shell sh;
    bb.MakeShell(sh);
    bb.Add(sh, f);
    sh.Closed(Standard_True);
    TopoDS_Solid sol;
    bb.MakeSolid(sol);
    bb.Add(sol, sh);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(sol, vp);
    if (vp.Mass() < 0.0) sol.Reverse();
    return sol;
}

// Sew a set of analytic faces into a single closed shell -> solid, oriented to
// positive volume (mirrors occtAnalyticFromNativeSolid's sew+orient path).
TopoDS_Solid sewToSolid(const std::vector<TopoDS_Face>& faces) {
    BRepBuilderAPI_Sewing sew(1e-6);
    for (const TopoDS_Face& f : faces) {
        if (f.IsNull()) throw std::runtime_error("occtPrim: null face in sew set");
        sew.Add(f);
    }
    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) throw std::runtime_error("occtPrim: sew produced null shape");
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) throw std::runtime_error("occtPrim: sew produced no shell");
    shell.Closed(Standard_True);
    BRep_Builder bb;
    TopoDS_Solid sol;
    bb.MakeSolid(sol);
    bb.Add(sol, shell);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(sol, vp);
    if (vp.Mass() < 0.0) sol.Reverse();
    return sol;
}

// A planar circular cap face at `capAx` (location = circle centre, direction =
// plane normal), radius r.
TopoDS_Face circleCap(const gp_Ax2& capAx, double r) {
    gp_Circ circ(capAx, r);
    TopoDS_Edge e = BRepBuilderAPI_MakeEdge(circ).Edge();
    TopoDS_Wire w = BRepBuilderAPI_MakeWire(e).Wire();
    gp_Pln pln(capAx.Location(), capAx.Direction());
    BRepBuilderAPI_MakeFace mf(pln, w);
    if (!mf.IsDone()) throw std::runtime_error("occtPrim: circular cap face failed");
    return mf.Face();
}

}  // namespace

// -------------------------------------------------------------------- SPHERE
TopoDS_Solid occtSphereSolid(const gp_Ax2& ax, double r) {
    if (!(r > Precision::Confusion()))
        throw std::runtime_error("occtSphereSolid: radius must be > 0");
    Handle(Geom_SphericalSurface) s = new Geom_SphericalSurface(ax, r);
    BRepBuilderAPI_MakeFace mf(s, Precision::Confusion());
    if (!mf.IsDone()) throw std::runtime_error("occtSphereSolid: face build failed");
    TopoDS_Face f = mf.Face();
    BRepLib::SameParameter(f, 1e-7, Standard_True);
    return singleFaceSolid(f);
}
TopoDS_Solid occtSphereSolid(double r) {
    return occtSphereSolid(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), r);
}

// --------------------------------------------------------------------- TORUS
TopoDS_Solid occtTorusSolid(const gp_Ax2& ax, double majorR, double minorR) {
    if (!(majorR > Precision::Confusion()) || !(minorR > Precision::Confusion()))
        throw std::runtime_error("occtTorusSolid: radii must be > 0");
    Handle(Geom_ToroidalSurface) s = new Geom_ToroidalSurface(ax, majorR, minorR);
    BRepBuilderAPI_MakeFace mf(s, Precision::Confusion());
    if (!mf.IsDone()) throw std::runtime_error("occtTorusSolid: face build failed");
    TopoDS_Face f = mf.Face();
    BRepLib::SameParameter(f, 1e-7, Standard_True);
    return singleFaceSolid(f);
}
TopoDS_Solid occtTorusSolid(double majorR, double minorR) {
    return occtTorusSolid(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)),
                          majorR, minorR);
}

// ------------------------------------------------------------------ CYLINDER
TopoDS_Solid occtCylinderSolid(const gp_Ax2& ax, double r, double h) {
    if (!(r > Precision::Confusion()) || !(h > Precision::Confusion()))
        throw std::runtime_error("occtCylinderSolid: radius/height must be > 0");
    const gp_Pnt O = ax.Location();
    const gp_Dir A = ax.Direction();
    // Lateral: one cylindrical face over the full [0,2pi] x [0,h] patch.
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(gp_Ax3(ax), r);
    BRepBuilderAPI_MakeFace latMf(cyl, 0.0, kTwoPi, 0.0, h, Precision::Confusion());
    if (!latMf.IsDone()) throw std::runtime_error("occtCylinderSolid: lateral failed");
    TopoDS_Face lat = latMf.Face();
    BRepLib::SameParameter(lat, 1e-7, Standard_True);
    // Caps: base at O (normal -A), top at O + h*A (normal +A).
    const gp_Pnt topO = O.Translated(gp_Vec(A) * h);
    TopoDS_Face capBot = circleCap(gp_Ax2(O, gp_Dir(gp_Vec(A) * -1.0), ax.XDirection()), r);
    TopoDS_Face capTop = circleCap(gp_Ax2(topO, A, ax.XDirection()), r);
    return sewToSolid({lat, capBot, capTop});
}
TopoDS_Solid occtCylinderSolid(double r, double h) {
    return occtCylinderSolid(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), r, h);
}

// ------------------------------------------------------------------ CONE
TopoDS_Solid occtConeSolid(const gp_Ax2& ax, double r1, double r2, double h) {
    if (r1 < 0.0 || r2 < 0.0)
        throw std::runtime_error("occtConeSolid: radii must be >= 0");
    if (!(h > Precision::Confusion()))
        throw std::runtime_error("occtConeSolid: height must be > 0");
    // Equal radii degenerates to a cylinder (no half-angle).
    if (std::fabs(r1 - r2) <= Precision::Confusion())
        return occtCylinderSolid(ax, r1, h);
    const gp_Pnt O = ax.Location();
    const gp_Dir A = ax.Direction();
    // Geom_ConicalSurface(ax, semiAngle, refRadius): radius at v=0 is r1 (refRadius),
    // and grows/shrinks as r1 + v*sin(semiAngle) along the axis. For MakeCone(r1,r2,h)
    // the radius goes r1 -> r2 over axial distance h, so the reference radius is r1 at
    // O and the semi-angle's tangent is (r2 - r1)/h.
    const double semiAng = std::atan2(r2 - r1, h);  // signed: r2<r1 -> negative
    Handle(Geom_ConicalSurface) cone = new Geom_ConicalSurface(gp_Ax3(ax), semiAng, r1);
    // v runs along the axis such that a point at axial height t has v = t / cos(semiAng)
    // (v is the slant distance). Bound the lateral to [0, h/cos(semiAng)].
    const double vMax = h / std::cos(semiAng);
    BRepBuilderAPI_MakeFace latMf(cone, 0.0, kTwoPi,
                                 std::min(0.0, vMax), std::max(0.0, vMax),
                                 Precision::Confusion());
    if (!latMf.IsDone()) throw std::runtime_error("occtConeSolid: lateral failed");
    TopoDS_Face lat = latMf.Face();
    BRepLib::SameParameter(lat, 1e-7, Standard_True);
    std::vector<TopoDS_Face> faces;
    faces.push_back(lat);
    // Base cap (radius r1 at O) unless the base is a point.
    if (r1 > Precision::Confusion())
        faces.push_back(circleCap(gp_Ax2(O, gp_Dir(gp_Vec(A) * -1.0), ax.XDirection()), r1));
    // Top cap (radius r2 at O + h*A) unless the top is a point.
    if (r2 > Precision::Confusion()) {
        const gp_Pnt topO = O.Translated(gp_Vec(A) * h);
        faces.push_back(circleCap(gp_Ax2(topO, A, ax.XDirection()), r2));
    }
    return sewToSolid(faces);
}
TopoDS_Solid occtConeSolid(double r1, double r2, double h) {
    return occtConeSolid(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)),
                         r1, r2, h);
}

// ------------------------------------------------------------------ BOX
namespace {
// A planar quad face from 4 corner points (CCW as seen from outside).
TopoDS_Face quadFace(const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c, const gp_Pnt& d) {
    BRepBuilderAPI_MakePolygon poly(a, b, c, d, Standard_True);
    if (!poly.IsDone()) throw std::runtime_error("occtPrim: quad wire failed");
    BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);  // OnlyPlane
    if (!mf.IsDone()) throw std::runtime_error("occtPrim: quad face failed");
    return mf.Face();
}
}  // namespace

TopoDS_Solid occtBoxSolid(const gp_Pnt& lo, const gp_Pnt& hi) {
    const double x0 = lo.X(), y0 = lo.Y(), z0 = lo.Z();
    const double x1 = hi.X(), y1 = hi.Y(), z1 = hi.Z();
    if (!(x1 - x0 > Precision::Confusion()) ||
        !(y1 - y0 > Precision::Confusion()) ||
        !(z1 - z0 > Precision::Confusion()))
        throw std::runtime_error("occtBoxSolid: degenerate box extents");
    const gp_Pnt p000(x0, y0, z0), p100(x1, y0, z0), p110(x1, y1, z0), p010(x0, y1, z0);
    const gp_Pnt p001(x0, y0, z1), p101(x1, y0, z1), p111(x1, y1, z1), p011(x0, y1, z1);
    std::vector<TopoDS_Face> faces;
    faces.push_back(quadFace(p000, p010, p110, p100));  // z = z0 (bottom, -Z out)
    faces.push_back(quadFace(p001, p101, p111, p011));  // z = z1 (top, +Z out)
    faces.push_back(quadFace(p000, p100, p101, p001));  // y = y0 (-Y out)
    faces.push_back(quadFace(p010, p011, p111, p110));  // y = y1 (+Y out)
    faces.push_back(quadFace(p000, p001, p011, p010));  // x = x0 (-X out)
    faces.push_back(quadFace(p100, p110, p111, p101));  // x = x1 (+X out)
    return sewToSolid(faces);
}
TopoDS_Solid occtBoxSolid(double dx, double dy, double dz) {
    return occtBoxSolid(gp_Pnt(0, 0, 0), gp_Pnt(dx, dy, dz));
}

// ------------------------------------------------------------------ WEDGE
TopoDS_Solid occtWedgeSolid(double dx, double dy, double dz, double ltx) {
    if (!(dx > Precision::Confusion()) || !(dy > Precision::Confusion()) ||
        !(dz > Precision::Confusion()))
        throw std::runtime_error("occtWedgeSolid: degenerate extents");
    if (ltx < 0.0 || ltx > dx + Precision::Confusion())
        throw std::runtime_error("occtWedgeSolid: ltx must be in [0, dx]");
    // y=0 face spans x in [0,dx]; y=dy face spans x in [0,ltx]; z in [0,dz] both.
    const gp_Pnt a000(0, 0, 0), a100(dx, 0, 0), aL10(ltx, dy, 0), a010(0, dy, 0);
    const gp_Pnt a001(0, 0, dz), a101(dx, 0, dz), aL11(ltx, dy, dz), a011(0, dy, dz);
    std::vector<TopoDS_Face> faces;
    faces.push_back(quadFace(a000, a010, aL10, a100));  // z = 0 (bottom)
    faces.push_back(quadFace(a001, a101, aL11, a011));  // z = dz (top)
    faces.push_back(quadFace(a000, a100, a101, a001));  // y = 0
    faces.push_back(quadFace(a010, a011, aL11, aL10));  // y = dy (width ltx)
    faces.push_back(quadFace(a000, a001, a011, a010));  // x = 0
    faces.push_back(quadFace(a100, aL10, aL11, a101));  // slanted x = dx -> ltx
    return sewToSolid(faces);
}

// =================================================== SWEEPS (prism / revolve)
//
// TKPrim-free re-implementation of BRepPrimAPI_MakePrism / BRepPrimAPI_MakeRevol.
// A translation/rotation sweep is: sweep every boundary EDGE of the profile into a
// lateral surface (Geom_SurfaceOfLinearExtrusion / Geom_SurfaceOfRevolution — both
// TKG3d), trim it to the edge's param range x the sweep param, then close with cap
// faces and sew (TKBRep). This is exactly what BRepSweep does internally, minus the
// TKPrim wrapper — so the resulting analytic B-rep is the SAME one MakePrism/MakeRevol
// would emit (verified A/B against the independent native sweep in native_vs_occt_core).
namespace {

// Sew a swept face set into ONE closed, outward-oriented solid. Unlike sewToSolid
// (whose inputs are already consistently pre-oriented), swept lateral faces inherit
// whatever orientation the Geom_ surface's dU x dV gives, so we let
// BRepLib::OrientClosedSolid propagate a consistent outward orientation over the
// closed shell; the positive-volume reverse is the belt-and-braces fallback.
TopoDS_Solid sewSweptToSolid(const std::vector<TopoDS_Face>& faces) {
    BRepBuilderAPI_Sewing sew(1e-6);
    for (const TopoDS_Face& f : faces) {
        if (f.IsNull()) throw std::runtime_error("occtSweep: null face in sew set");
        sew.Add(f);
    }
    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) throw std::runtime_error("occtSweep: sew produced null shape");
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) throw std::runtime_error("occtSweep: sew produced no closed shell");
    shell.Closed(Standard_True);
    BRep_Builder bb;
    TopoDS_Solid sol;
    bb.MakeSolid(sol);
    bb.Add(sol, shell);
    BRepLib::OrientClosedSolid(sol);  // consistent outward orientation over the shell
    GProp_GProps vp;
    BRepGProp::VolumeProperties(sol, vp);
    if (vp.Mass() < 0.0) sol.Reverse();
    return sol;
}

// Perpendicular distance from point P to the axis line.
double distToAxis(const gp_Pnt& p, const gp_Ax1& ax) {
    return gp_Lin(ax).Distance(p);
}

// Lateral face: the profile EDGE's exact 3D curve swept LINEARLY along `vec`.
// P(u,w) = C(u) + w * dir, u in [edge param], w in [0,|vec|]. Returns a null face
// for a curveless/degenerate edge (caller skips it).
TopoDS_Face lateralExtrudeFace(const TopoDS_Edge& e, const gp_Vec& vec) {
    if (BRep_Tool::Degenerated(e)) return TopoDS_Face();
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull()) return TopoDS_Face();
    const double len = vec.Magnitude();
    Handle(Geom_SurfaceOfLinearExtrusion) s =
        new Geom_SurfaceOfLinearExtrusion(c, gp_Dir(vec));
    BRepBuilderAPI_MakeFace mf(s, f, l, 0.0, len, Precision::Confusion());
    if (!mf.IsDone()) throw std::runtime_error("occtPrism: lateral extrude face failed");
    TopoDS_Face face = mf.Face();
    BRepLib::BuildCurves3d(face);
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// Lateral face: the profile EDGE's exact 3D curve REVOLVED about `ax` through
// `angle`. P(u,v) = rotate(C(v), ax, by u), u in [0,angle], v in [edge param].
// Returns a null face for an edge that lies on the axis (degenerate — a pole).
TopoDS_Face lateralRevolFace(const TopoDS_Edge& e, const gp_Ax1& ax, double angle) {
    if (BRep_Tool::Degenerated(e)) return TopoDS_Face();
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull()) return TopoDS_Face();
    // Skip an edge lying ON the axis (its surface of revolution collapses to the axis).
    const gp_Pnt pF = c->Value(f);
    const gp_Pnt pM = c->Value(0.5 * (f + l));
    const gp_Pnt pL = c->Value(l);
    if (distToAxis(pF, ax) <= Precision::Confusion() &&
        distToAxis(pM, ax) <= Precision::Confusion() &&
        distToAxis(pL, ax) <= Precision::Confusion())
        return TopoDS_Face();
    Handle(Geom_SurfaceOfRevolution) s = new Geom_SurfaceOfRevolution(c, ax);
    BRepBuilderAPI_MakeFace mf(s, 0.0, angle, f, l, Precision::Confusion());
    if (!mf.IsDone()) throw std::runtime_error("occtRevol: lateral revolve face failed");
    TopoDS_Face face = mf.Face();
    BRepLib::BuildCurves3d(face);
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// Planar area + unit normal + centroid of a face (for the closed-form self-checks).
bool planarFaceProps(const TopoDS_Face& face, double& area, gp_Dir& n, gp_Pnt& com) {
    BRepAdaptor_Surface as(face);
    if (as.GetType() != GeomAbs_Plane) return false;
    n = as.Plane().Axis().Direction();
    GProp_GProps sp;
    BRepGProp::SurfaceProperties(face, sp);
    area = sp.Mass();
    com = sp.CentreOfMass();
    return area > Precision::Confusion();
}

// Linear-sweep a single FACE into a closed solid (lateral faces + 2 caps).
TopoDS_Solid prismFaceToSolid(const TopoDS_Face& face, const gp_Vec& vec) {
    std::vector<TopoDS_Face> faces;
    for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Face lat = lateralExtrudeFace(TopoDS::Edge(ex.Current()), vec);
        if (!lat.IsNull()) faces.push_back(lat);
    }
    if (faces.empty()) throw std::runtime_error("occtPrism: profile face has no sweepable edges");
    faces.push_back(face);                                   // base cap (profile itself)
    gp_Trsf tr;
    tr.SetTranslation(vec);
    BRepBuilderAPI_Transform mv(face, tr, Standard_True);
    if (!mv.IsDone()) throw std::runtime_error("occtPrism: cap translation failed");
    faces.push_back(TopoDS::Face(mv.Shape()));               // top cap (translated profile)
    TopoDS_Solid sol = sewSweptToSolid(faces);
    // Closed-form self-check for a planar profile: V = area * |vec . n|.
    double area = 0.0; gp_Dir n; gp_Pnt com;
    if (planarFaceProps(face, area, n, com)) {
        const double expected = area * std::fabs(vec.Dot(gp_Vec(n)));
        GProp_GProps vp;
        BRepGProp::VolumeProperties(sol, vp);
        const double actual = std::fabs(vp.Mass());
        const double denom = std::max(expected, 1e-9);
        if (std::fabs(actual - expected) / denom > 1e-3)
            throw std::runtime_error("occtPrism: swept volume disagrees with area*|vec.n| self-check");
    }
    return sol;
}

}  // namespace

TopoDS_Shape occtPrism(const TopoDS_Shape& profile, const gp_Vec& vec) {
    if (profile.IsNull()) throw std::runtime_error("occtPrism: null profile");
    if (vec.Magnitude() < Precision::Confusion())
        throw std::runtime_error("occtPrism: sweep vector is zero-length");
    switch (profile.ShapeType()) {
        case TopAbs_FACE:
            return prismFaceToSolid(TopoDS::Face(profile), vec);
        case TopAbs_WIRE: {
            // Open profile -> open shell of lateral faces (no caps).
            BRep_Builder bb;
            TopoDS_Shell sh;
            bb.MakeShell(sh);
            bool any = false;
            for (TopExp_Explorer ex(profile, TopAbs_EDGE); ex.More(); ex.Next()) {
                TopoDS_Face lat = lateralExtrudeFace(TopoDS::Edge(ex.Current()), vec);
                if (!lat.IsNull()) { bb.Add(sh, lat); any = true; }
            }
            if (!any) throw std::runtime_error("occtPrism: wire has no sweepable edges");
            return sh;
        }
        case TopAbs_EDGE: {
            TopoDS_Face lat = lateralExtrudeFace(TopoDS::Edge(profile), vec);
            if (lat.IsNull()) throw std::runtime_error("occtPrism: edge not sweepable");
            return lat;
        }
        case TopAbs_SHELL: {
            // Sweep each face into a solid; gather into a compound (matches the
            // shell-swept BRepPrimAPI_MakePrism result: one prism per shell face).
            BRep_Builder bb;
            TopoDS_Compound comp;
            bb.MakeCompound(comp);
            bool any = false;
            for (TopExp_Explorer ex(profile, TopAbs_FACE); ex.More(); ex.Next()) {
                bb.Add(comp, prismFaceToSolid(TopoDS::Face(ex.Current()), vec));
                any = true;
            }
            if (!any) throw std::runtime_error("occtPrism: shell has no faces to sweep");
            return comp;
        }
        default:
            throw std::runtime_error("occtPrism: unsupported profile shape type");
    }
}

TopoDS_Shape occtRevol(const TopoDS_Shape& profile, const gp_Ax1& ax, double angle) {
    if (profile.IsNull()) throw std::runtime_error("occtRevol: null profile");
    if (!(angle > Precision::Angular()) || angle > kTwoPi + Precision::Angular())
        throw std::runtime_error("occtRevol: angle must be in (0, 2pi]");
    if (profile.ShapeType() != TopAbs_FACE)
        throw std::runtime_error("occtRevol: profile must be a face");
    const TopoDS_Face face = TopoDS::Face(profile);
    const bool full = (angle >= kTwoPi - 1e-9);

    std::vector<TopoDS_Face> faces;
    for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Face lat = lateralRevolFace(TopoDS::Edge(ex.Current()), ax, angle);
        if (!lat.IsNull()) faces.push_back(lat);
    }
    if (faces.empty()) throw std::runtime_error("occtRevol: profile face has no revolvable edges");
    if (!full) {
        // Partial sweep: cap the pie with the profile at theta=0 and at theta=angle.
        faces.push_back(face);
        gp_Trsf rot;
        rot.SetRotation(ax, angle);
        BRepBuilderAPI_Transform mv(face, rot, Standard_True);
        if (!mv.IsDone()) throw std::runtime_error("occtRevol: end-wall rotation failed");
        faces.push_back(TopoDS::Face(mv.Shape()));
    }
    TopoDS_Solid sol = sewSweptToSolid(faces);
    // Closed-form Pappus self-check for a planar profile: V = area * angle * R_com.
    double area = 0.0; gp_Dir n; gp_Pnt com;
    if (planarFaceProps(face, area, n, com)) {
        const double rCom = distToAxis(com, ax);
        const double expected = area * angle * rCom;
        GProp_GProps vp;
        BRepGProp::VolumeProperties(sol, vp);
        const double actual = std::fabs(vp.Mass());
        const double denom = std::max(expected, 1e-9);
        if (std::fabs(actual - expected) / denom > 2e-3)
            throw std::runtime_error("occtRevol: swept volume disagrees with Pappus self-check");
    }
    return sol;
}

}  // namespace forge
