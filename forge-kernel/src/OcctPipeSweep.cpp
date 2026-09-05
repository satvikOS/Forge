// forge/OcctPipeSweep.cpp — implementation of the TKOffset-free polyline pipe sweep.
// See OcctPipeSweep.hpp for the scope / exactness / validity contract.

#include "forge/OcctPipeSweep.hpp"
#include "forge/OcctPrimBuilder.hpp"   // occtPrism — analytic linear sweep

#include <algorithm>
#include <cmath>
#include <stdexcept>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Line.hxx>
#include <Precision.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace {

// Any direction perpendicular to `d` (stable: pick the smallest component axis).
gp_Dir anyPerp(const gp_Dir& d) {
    const double ax = std::fabs(d.X()), ay = std::fabs(d.Y()), az = std::fabs(d.Z());
    gp_Vec other = (ax <= ay && ax <= az) ? gp_Vec(1, 0, 0)
                 : (ay <= az)             ? gp_Vec(0, 1, 0)
                                          : gp_Vec(0, 0, 1);
    gp_Vec p = gp_Vec(d).Crossed(other);
    return gp_Dir(p);
}

// ---------------------------------------------------------------------------
// CANONICAL lateral faces.
//
// occtPrism emits every lateral as a Geom_SurfaceOfLinearExtrusion. That is exact
// (the extrusion of an exact circle IS the exact cylinder — nothing is sampled), but
// OCCT reports it as GeomAbs_SurfaceOfExtrusion, so faceInventory classifies it
// "other" instead of "cylinder"/"plane". Everything downstream that switches on face
// KIND — bore counting, hole recognition, resizeBore, DFM — would then silently stop
// recognising a swept pipe's walls. Emitting the CANONICAL analytic surface keeps the
// native result classifiable exactly like OCCT MakePipe's.
//
// Returns a null face when the edge has no canonical form; the caller then falls back
// to the (still exact) surface-of-extrusion path.
// ---------------------------------------------------------------------------

// A straight profile edge sweeps to a PLANAR parallelogram. Built from its 4 corners
// so the boundary is the true parallelogram even for an oblique sweep.
TopoDS_Face lateralPlaneFace(const TopoDS_Edge& e, const gp_Vec& vec) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull()) return TopoDS_Face();
    if (Handle(Geom_Line)::DownCast(c).IsNull()) return TopoDS_Face();
    const gp_Pnt p1 = c->Value(f);
    const gp_Pnt p2 = c->Value(l);
    if (p1.Distance(p2) < Precision::Confusion()) return TopoDS_Face();
    // Degenerate if the sweep is along the edge itself (zero-area wall).
    gp_Vec along(p1, p2);
    if (along.Crossed(vec).Magnitude() < Precision::Confusion()) return TopoDS_Face();
    BRepBuilderAPI_MakePolygon poly(p1, p2, p2.Translated(vec), p1.Translated(vec), Standard_True);
    if (!poly.IsDone()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(poly.Wire(), /*OnlyPlane*/ Standard_True);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// A circular profile edge swept ALONG ITS OWN AXIS sweeps to a true CYLINDER.
// The cylinder frame is the circle's own (loc, Z, X), so the surface u-parameter
// coincides with the circle's — the edge param range transfers unchanged.
TopoDS_Face lateralCylinderFace(const TopoDS_Edge& e, const gp_Vec& vec) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    if (c.IsNull()) return TopoDS_Face();
    Handle(Geom_Circle) gc = Handle(Geom_Circle)::DownCast(c);
    if (gc.IsNull()) return TopoDS_Face();
    const gp_Circ ci = gc->Circ();
    const gp_Dir zc = ci.Axis().Direction();
    const double len = vec.Magnitude();
    if (len < Precision::Confusion()) return TopoDS_Face();
    const gp_Dir vd(vec);
    const double al = std::fabs(gp_Vec(zc).Dot(gp_Vec(vd)));
    if (al < 1.0 - 1e-9) return TopoDS_Face();   // oblique sweep -> not a cylinder
    const gp_Ax3 ax(ci.Location(), zc, ci.XAxis().Direction());
    Handle(Geom_CylindricalSurface) s = new Geom_CylindricalSurface(ax, ci.Radius());
    // v runs along +zc; the sweep may go the other way.
    const bool fwd = gp_Vec(zc).Dot(vec) > 0.0;
    const double v0 = fwd ? 0.0 : -len;
    const double v1 = fwd ? len : 0.0;
    BRepBuilderAPI_MakeFace mf(s, f, l, v0, v1, Precision::Confusion());
    if (!mf.IsDone()) return TopoDS_Face();
    TopoDS_Face face = mf.Face();
    BRepLib::BuildCurves3d(face);
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// Sew a swept face set into ONE closed outward-oriented solid (mirrors
// OcctPrimBuilder's sewSweptToSolid, which lives in its own anonymous namespace).
TopoDS_Solid sewToSolid(const std::vector<TopoDS_Face>& faces) {
    BRepBuilderAPI_Sewing sew(1e-6);
    for (const TopoDS_Face& f : faces) {
        if (f.IsNull()) throw std::runtime_error("occtPipePolyline: null face in sew set");
        sew.Add(f);
    }
    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) throw std::runtime_error("occtPipePolyline: sew produced null shape");
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) throw std::runtime_error("occtPipePolyline: sew produced no closed shell");
    shell.Closed(Standard_True);
    BRep_Builder bb;
    TopoDS_Solid sol;
    bb.MakeSolid(sol);
    bb.Add(sol, shell);
    BRepLib::OrientClosedSolid(sol);
    GProp_GProps vp;
    BRepGProp::VolumeProperties(sol, vp);
    if (vp.Mass() < 0.0) sol.Reverse();
    return sol;
}

// One pipe leg: the profile face swept along `vec`, with CANONICAL analytic laterals
// wherever the profile edge admits one. Returns a null shape if any edge has no
// canonical form — the caller then uses occtPrism (exact surface-of-extrusion).
TopoDS_Shape canonicalLeg(const TopoDS_Face& profile, const gp_Vec& vec) {
    std::vector<TopoDS_Face> faces;
    for (TopExp_Explorer ex(profile, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = TopoDS::Edge(ex.Current());
        if (BRep_Tool::Degenerated(e)) continue;
        TopoDS_Face lat = lateralPlaneFace(e, vec);
        if (lat.IsNull()) lat = lateralCylinderFace(e, vec);
        if (lat.IsNull()) return TopoDS_Shape();      // no canonical form for this edge
        faces.push_back(lat);
    }
    if (faces.empty()) return TopoDS_Shape();
    faces.push_back(profile);                          // base cap
    gp_Trsf tr;
    tr.SetTranslation(vec);
    BRepBuilderAPI_Transform mv(profile, tr, Standard_True);
    if (!mv.IsDone()) return TopoDS_Shape();
    faces.push_back(TopoDS::Face(mv.Shape()));         // top cap
    TopoDS_Solid sol;
    try { sol = sewToSolid(faces); } catch (...) { return TopoDS_Shape(); }
    // Closed-form self-check, same contract as occtPrism: V == area * |vec . n|.
    GProp_GProps sp, vp;
    BRepGProp::SurfaceProperties(profile, sp);
    BRepAdaptor_Surface as(profile);
    if (as.GetType() == GeomAbs_Plane) {
        const gp_Dir n = as.Plane().Axis().Direction();
        const double expected = sp.Mass() * std::fabs(vec.Dot(gp_Vec(n)));
        BRepGProp::VolumeProperties(sol, vp);
        const double denom = std::max(expected, 1e-9);
        if (std::fabs(std::fabs(vp.Mass()) - expected) / denom > 1e-6) return TopoDS_Shape();
    }
    return sol;
}

}  // namespace

bool occtPipeSpineIsPolyline(const TopoDS_Wire& spine) {
    if (spine.IsNull()) return false;
    bool any = false;
    for (TopExp_Explorer ex(spine, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = TopoDS::Edge(ex.Current());
        if (BRep_Tool::Degenerated(e)) continue;
        BRepAdaptor_Curve ac(e);
        if (ac.GetType() != GeomAbs_Line) return false;   // arc / circle / spline
        any = true;
    }
    return any;
}

std::vector<gp_Pnt> occtPipeSpinePoints(const TopoDS_Wire& spine) {
    std::vector<gp_Pnt> pts;
    if (spine.IsNull()) return pts;
    // BRepTools_WireExplorer, NOT TopExp_Explorer: only the former walks a wire in
    // CONNECTION order and yields each edge already oriented along the walk. A plain
    // TopExp_Explorer returns edges in storage order, which would make a perfectly
    // good polyline look disconnected and be refused.
    for (BRepTools_WireExplorer ex(spine); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (BRep_Tool::Degenerated(e)) continue;
        TopoDS_Vertex v1, v2;
        TopExp::Vertices(e, v1, v2, Standard_True);   // oriented along the walk
        if (v1.IsNull() || v2.IsNull()) return {};
        const gp_Pnt p1 = BRep_Tool::Pnt(v1);
        const gp_Pnt p2 = BRep_Tool::Pnt(v2);
        if (pts.empty()) {
            pts.push_back(p1);
        } else if (pts.back().Distance(p1) > 1e-7) {
            return {};                                 // not a connected chain
        }
        if (pts.back().Distance(p2) > 1e-9) pts.push_back(p2);
    }
    return pts;
}

TopoDS_Shape occtPipePolyline(const TopoDS_Shape& profileFace,
                              const std::vector<gp_Pnt>& spineIn) {
    if (profileFace.IsNull())
        throw std::runtime_error("occtPipePolyline: null profile");
    if (profileFace.ShapeType() != TopAbs_FACE)
        throw std::runtime_error("occtPipePolyline: profile must be a FACE");

    // ---- 1. distinct spine points ------------------------------------------------
    std::vector<gp_Pnt> P;
    for (const gp_Pnt& q : spineIn) {
        if (P.empty() || P.back().Distance(q) > Precision::Confusion()) P.push_back(q);
    }
    if (P.size() < 2)
        throw std::runtime_error("occtPipePolyline: spine needs >= 2 distinct points");

    const std::size_t nSeg = P.size() - 1;

    // ---- 1b. reject a DEGENERATE placement up front, with a specific reason -------
    // A planar profile swept along d encloses area*|d.n|. If the profile plane
    // CONTAINS the first segment direction (n perpendicular to d) the swept body has
    // zero volume. That is the documented "profile and path are coplanar" collapse of
    // forge::part::sweep — every sketch lives on Z=0, so a Z=0 path with a Z=0 profile
    // always lands here. Say so, instead of failing later inside the corner union.
    {
        BRepAdaptor_Surface as(TopoDS::Face(profileFace));
        if (as.GetType() == GeomAbs_Plane) {
            const gp_Dir n = as.Plane().Axis().Direction();
            gp_Vec d0(P[0], P[1]);
            if (d0.Magnitude() > Precision::Confusion() &&
                std::fabs(gp_Vec(n).Dot(gp_Dir(d0))) < 1e-9) {
                throw std::runtime_error(
                    "occtPipePolyline: profile plane contains the spine direction — the swept "
                    "body has zero volume (profile and path are coplanar)");
            }
        }
    }

    // ---- 2. segment directions ---------------------------------------------------
    std::vector<gp_Dir> D;
    D.reserve(nSeg);
    for (std::size_t i = 0; i < nSeg; ++i) {
        gp_Vec v(P[i], P[i + 1]);
        if (v.Magnitude() < Precision::Confusion())
            throw std::runtime_error("occtPipePolyline: zero-length spine segment");
        D.push_back(gp_Dir(v));
    }

    // ---- 3. discrete rotation-minimising transport of the profile ----------------
    // Frame 0 is the profile's own placement: origin P[0], Z along D[0]. For each
    // later segment rotate the frame by the MINIMAL rotation taking D[i-1] to D[i]
    // (axis D[i-1] x D[i]); that is the rotation-minimising frame for a polyline, so
    // a non-symmetric profile is carried without spurious twist.
    const gp_Dir x0 = anyPerp(D[0]);
    const gp_Ax3 frame0(P[0], D[0], x0);

    std::vector<gp_Ax3> frames;
    frames.reserve(nSeg);
    frames.push_back(frame0);

    gp_Dir curX = x0;
    for (std::size_t i = 1; i < nSeg; ++i) {
        const gp_Dir& a = D[i - 1];
        const gp_Dir& b = D[i];
        const double dot = std::max(-1.0, std::min(1.0, gp_Vec(a).Dot(gp_Vec(b))));
        if (dot < -1.0 + 1e-12)
            throw std::runtime_error(
                "occtPipePolyline: 180-degree spine reversal — transport undefined");
        if (dot < 1.0 - 1e-15) {
            const gp_Vec axv = gp_Vec(a).Crossed(gp_Vec(b));
            if (axv.Magnitude() > 1e-12) {
                gp_Trsf rot;
                rot.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(axv)), std::acos(dot));
                curX = gp_Dir(gp_Vec(curX).Transformed(rot));
            }
        }
        frames.push_back(gp_Ax3(P[i], D[i], curX));
    }

    // ---- 4. one analytic prism per segment ---------------------------------------
    std::vector<TopoDS_Shape> legs;
    legs.reserve(nSeg);
    for (std::size_t i = 0; i < nSeg; ++i) {
        TopoDS_Shape prof = profileFace;
        if (i > 0) {
            gp_Trsf t;
            t.SetDisplacement(frame0, frames[i]);          // frame0 -> frame i
            BRepBuilderAPI_Transform mv(profileFace, t, Standard_True);
            if (!mv.IsDone())
                throw std::runtime_error("occtPipePolyline: profile transport failed");
            prof = mv.Shape();
        }
        const gp_Vec seg(P[i], P[i + 1]);
        // Prefer CANONICAL analytic laterals (plane / cylinder) so faceInventory
        // classifies the pipe walls exactly as OCCT MakePipe's do; fall back to
        // occtPrism's surface-of-extrusion (equally exact, just not canonical) for
        // profile edges with no canonical swept form (ellipse, spline, ...).
        TopoDS_Shape leg = canonicalLeg(TopoDS::Face(prof), seg);
        if (leg.IsNull()) leg = occtPrism(prof, seg);
        legs.push_back(leg);
    }

    // ---- 5. union the legs (exact boolean on analytic surfaces) ------------------
    TopoDS_Shape acc = legs[0];
    for (std::size_t i = 1; i < legs.size(); ++i) {
        BRepAlgoAPI_Fuse op(acc, legs[i]);
        op.Build();
        if (!op.IsDone())
            throw std::runtime_error("occtPipePolyline: corner union failed");
        acc = op.Shape();
    }
    if (acc.IsNull())
        throw std::runtime_error("occtPipePolyline: union produced a null shape");

    // ---- 6. honest self-check: a real solid has positive volume ------------------
    GProp_GProps vp;
    BRepGProp::VolumeProperties(acc, vp);
    if (!(vp.Mass() > Precision::Confusion()))
        throw std::runtime_error("occtPipePolyline: swept body has non-positive volume");

    return acc;
}

}  // namespace forge
