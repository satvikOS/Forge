// test/import_conic_prism_gate.cpp — T-247.
//
// importOcctSolid on a PRISM OF A CONIC PROFILE (a linear extrusion whose basis
// curve is a circle or an ellipse, full or an arc), checked against CLOSED FORM
// and against OCCT's own GProp, with the native geometry checked against the
// Geom_ surface at the face's own (u,v).
//
// WHY THIS GATE EXISTS
// --------------------
// 8341ad68 added a 25-station native/OCCT round-trip check to readExtrusionSurface.
// For a conic basis, curveToBSpline returns a rational B-spline whose parameter is
// NOT the conic's angle, so the tensor surface it built put a DIFFERENT point at
// OCCT's (u,v) than the Geom_SurfaceOfLinearExtrusion does; the check saw that and
// declined, and from then on EVERY prism of an ellipse (right or oblique), of a
// circle swept obliquely, and of an elliptical-arc D-profile came back ok=0
// ("extrusion native/OCCT round-trip mismatch"). Before 8341ad68 (c75af519) the
// same solids came back ok=1 over the reparameterised surface.
//
// The fix keeps that check and gives it something true to check: a conic basis
// is laid out as equal-angle EXACT rational-quadratic segments (the circle's
// standard construction; an ellipse is its affine image, with the SAME weights
// and the SAME angle->parameter law), and the importer maps OCCT's u through
// that law, exactly as the surface-of-revolution path already does.
//
// WHAT IS ASSERTED, per fixture (A1/A2 of the ledger entry)
//   [ok]      importOcctSolid returns ok=1 and a solid.
//   [vol]     native massProperties volume == closed form area(profile) x height
//             to 1e-9 relative, AND == OCCT BRepGProp volume to 1e-9 relative.
//   [onsurf]  every native face carved from the extrusion side face lies ON the
//             Geom_ surface: its surface evaluated at the centre of its own (u,v)
//             window, projected onto the OCCT side face's Geom_Surface, is within
//             1e-9 x scale.
//   [vtxuv]   every vertex of every such native face sits at its OWN (u,v): the
//             native surface evaluated at Face::vertexUV[i] reproduces the vertex
//             point. A reparameterised u (the surface's parameter is not the one
//             the importer used to place the boundary) shows here as a gap.
//   [bridge]  the PROPERTY bridge (importOcctFaceSurface) on the same side face
//             still answers OCCT's (u,v) with OCCT's point (T-151's identity map
//             for Form::Extruded) — the solid fix must not route the bridge onto
//             the remapped tensor surface.
//
// Controls: a RIGHT circular prism (OCCT builds a Geom_CylindricalSurface side,
// not an extrusion) and a line-profile prism (a box) — both imported before the
// fix and must stay exact.
//
// NO NODE, NO ADDON: links libforge_kernel_core + OCCT. Exit 0 iff all green.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GC_MakeArcOfEllipse.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GProp_GProps.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Surface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "forge/OcctImport.hpp"
#include "forge/SurfaceProps.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"

namespace nb = forge::native::brep;

// The ledger entry for the planar-cap polygon volume defect (see F3b).
#define KNOWN_CAP_TASK "T-342"

static int g_fail = 0;
static int g_pass = 0;
static constexpr double kPi = 3.14159265358979323846;

static void ck(bool ok, const char* fix, const char* what, const std::string& detail) {
    if (ok) ++g_pass; else ++g_fail;
    std::printf("  [%s] %-28s %-9s %s\n", ok ? "PASS" : "FAIL", fix, what, detail.c_str());
}

static std::string fmt(const char* f, double a, double b = 0, double c = 0) {
    char buf[256];
    std::snprintf(buf, sizeof buf, f, a, b, c);
    return buf;
}

static TopoDS_Face extrusionFace(const TopoDS_Shape& s) {
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        TopoDS_Face f = TopoDS::Face(ex.Current());
        Handle(Geom_Surface) gs = BRep_Tool::Surface(f);
        if (!Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(gs).IsNull()) return f;
    }
    return TopoDS_Face();
}

struct Fixture {
    const char* name;
    TopoDS_Shape shape;
    double closedVol;
    bool expectExtrusion;   // false for the controls
    // Non-null: the VOLUME rows of this fixture are a KNOWN defect OUTSIDE this
    // gate's claim (named by ledger id), reported with the measured error but not
    // counted. Every other row of the fixture is asserted as usual.
    const char* knownVolumeDefect = nullptr;
};

static void runFixture(const Fixture& fx) {
    const char* n = fx.name;
    GProp_GProps gp;
    BRepGProp::VolumeProperties(fx.shape, gp);
    const double occVol = gp.Mass();
    ck(std::fabs(occVol - fx.closedVol) <= 1e-9 * std::fabs(fx.closedVol), n, "fixture",
       fmt("OCCT GProp vol %.12f vs closed form %.12f (the fixture itself)", occVol, fx.closedVol));

    TopoDS_Face side = extrusionFace(fx.shape);
    ck(side.IsNull() != fx.expectExtrusion, n, "fixture",
       fx.expectExtrusion ? "has a Geom_SurfaceOfLinearExtrusion side face"
                          : "control: no extrusion face");

    forge::ImportResult ir = forge::importOcctSolid(fx.shape);
    ck(ir.ok && ir.solid != nullptr, n, "ok",
       ir.ok ? std::string("importOcctSolid ok=1") : ("ok=0 reason: " + ir.reason));
    if (!ir.ok || !ir.solid) return;

    nb::MassProps mp = nb::massProperties(*ir.solid, 10);
    const double rC = std::fabs(mp.volume - fx.closedVol) / std::fabs(fx.closedVol);
    const double rO = std::fabs(mp.volume - occVol) / std::fabs(occVol);
    if (fx.knownVolumeDefect) {
        std::printf("  [KNOWN %s] %-21s vol       native %.12f closed %.12f rel %.3e "
                    "(not this gate's claim; see the ledger entry)\n",
                    fx.knownVolumeDefect, n, mp.volume, fx.closedVol, rC);
    } else {
        ck(rC <= 1e-9, n, "vol", fmt("native %.12f closed %.12f rel %.3e", mp.volume, fx.closedVol, rC));
        ck(rO <= 1e-9, n, "vol", fmt("native %.12f OCCT   %.12f rel %.3e", mp.volume, occVol, rO));
    }

    if (side.IsNull()) return;
    Handle(Geom_Surface) gs = BRep_Tool::Surface(side);
    double scale = 1.0;
    // ---- [onsurf] + [vtxuv] over every native face that is a NURBS patch (the
    // side face is the ONLY non-planar face of these prisms). ----------------
    std::size_t nurbsFaces = 0, vtxChecked = 0;
    double worstOn = 0.0, worstVtx = 0.0;
    for (nb::Shell* sh : ir.solid->shells)
        for (nb::Face* f : sh->faces) {
            if (!f || !f->surface) continue;
            const nb::Surface& S = *f->surface;
            if (S.kind == nb::SurfaceKind::Plane) continue;
            ++nurbsFaces;
            // centre of the face's own (u,v) window
            double uc = 0.5 * (f->u0 + f->u1), vc = 0.5 * (f->v0 + f->v1);
            if (!f->vertexUV.empty()) {
                double su = 0, sv = 0;
                for (auto& uv : f->vertexUV) { su += uv[0]; sv += uv[1]; }
                uc = su / f->vertexUV.size(); vc = sv / f->vertexUV.size();
            }
            const nb::Vec3 P = S.evaluate(uc, vc);
            scale = std::max(scale, std::sqrt(P.x * P.x + P.y * P.y + P.z * P.z));
            GeomAPI_ProjectPointOnSurf pr(gp_Pnt(P.x, P.y, P.z), gs);
            if (pr.IsDone() && pr.NbPoints() > 0)
                worstOn = std::max(worstOn, pr.LowerDistance());
            else
                worstOn = std::max(worstOn, 1e300);
            // vertex at its own (u,v)
            if (f->outerLoop && !f->vertexUV.empty()) {
                nb::Coedge* c = f->outerLoop->first;
                std::size_t i = 0;
                do {
                    if (i >= f->vertexUV.size()) break;
                    const nb::Vertex* v = c->originVertex();
                    const nb::Vec3 Q = S.evaluate(f->vertexUV[i][0], f->vertexUV[i][1]);
                    const double d = std::sqrt((Q.x - v->point.x) * (Q.x - v->point.x) +
                                               (Q.y - v->point.y) * (Q.y - v->point.y) +
                                               (Q.z - v->point.z) * (Q.z - v->point.z));
                    worstVtx = std::max(worstVtx, d);
                    ++vtxChecked;
                    c = c->next; ++i;
                } while (c && c != f->outerLoop->first);
            }
        }
    ck(nurbsFaces > 0 && worstOn <= 1e-9 * scale, n, "onsurf",
       fmt("%g native curved faces, worst distance to the Geom_ surface %.3e (tol %.1e)",
           (double)nurbsFaces, worstOn, 1e-9 * scale));
    ck(vtxChecked > 0 && worstVtx <= 1e-9 * scale, n, "vtxuv",
       fmt("%g vertices, worst |S(vertexUV) - vertex| %.3e (tol %.1e)",
           (double)vtxChecked, worstVtx, 1e-9 * scale));

    // ---- [bridge]: the property facade at OCCT's (u,v) ----------------------
    forge::SurfaceImportResult sr = forge::importOcctFaceSurface(side);
    if (!sr.ok) {
        ck(false, n, "bridge", "importOcctFaceSurface ok=0: " + sr.reason);
        return;
    }
    double u0, u1, v0, v1;
    BRepTools::UVBounds(side, u0, u1, v0, v1);
    double worstB = 0.0;
    for (int i = 0; i <= 4; ++i)
        for (int j = 0; j <= 4; ++j) {
            const double u = u0 + (u1 - u0) * (i + 0.37) / 5.0;
            const double v = v0 + (v1 - v0) * (j + 0.61) / 5.0;
            const gp_Pnt o = gs->Value(u, v);
            double un, vn; sr.toNative(u, v, un, vn);
            forge::props::SurfProps sp = forge::props::surfaceProps(sr.surface, un, vn);
            const double d = std::sqrt((sp.p.x - o.X()) * (sp.p.x - o.X()) +
                                       (sp.p.y - o.Y()) * (sp.p.y - o.Y()) +
                                       (sp.p.z - o.Z()) * (sp.p.z - o.Z()));
            worstB = std::max(worstB, d);
        }
    ck(worstB <= 1e-9 * scale, n, "bridge",
       fmt("property bridge S(toNative(u,v)) vs Geom_ Value(u,v): worst %.3e", worstB));
}

int main() {
    std::printf("== T-247 import_conic_prism_gate: importOcctSolid on conic-profile prisms ==\n");
    std::vector<Fixture> fx;

    // F1 full ELLIPSE, RIGHT sweep.  vol = pi a b h
    {
        const gp_Ax2 ax(gp_Pnt(0.2, -0.3, 0.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Elips(ax, 3.0, 1.25)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        fx.push_back({"ellipse/right", BRepPrimAPI_MakePrism(p, gp_Vec(0, 0, 2.5)).Shape(),
                      kPi * 3.0 * 1.25 * 2.5, true});
    }
    // F2 full ELLIPSE, OBLIQUE sweep (the T-151 property fixture). height = 2.5
    {
        const gp_Ax2 ax(gp_Pnt(0.2, -0.3, 0.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Elips(ax, 3.0, 1.25)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        fx.push_back({"ellipse/oblique", BRepPrimAPI_MakePrism(p, gp_Vec(0.6, -0.4, 2.5)).Shape(),
                      kPi * 3.0 * 1.25 * 2.5, true});
    }
    // F3 full ELLIPSE in a TILTED plane (normal in the y-z plane) with a rotated
    //    major axis, oblique sweep. vol = pi a b (sweep . n). MassProps' volume is
    //    the divergence integral of x n_x, so a cap whose normal has no x component
    //    contributes nothing and the volume row reads the SIDE WALL alone.
    {
        const gp_Dir nrm(0.0, -0.35, 0.9367496998);
        const gp_Ax2 ax(gp_Pnt(1.0, 2.0, -0.5), nrm, gp_Dir(gp_Vec(nrm).Crossed(gp_Vec(0.4, 1.0, 0.1))));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Elips(ax, 2.2, 0.9)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        const gp_Vec sweep(-0.5, 0.8, 3.1);
        fx.push_back({"ellipse/tilted-yz", BRepPrimAPI_MakePrism(p, sweep).Shape(),
                      kPi * 2.2 * 0.9 * std::fabs(sweep.Dot(gp_Vec(nrm))), true});
    }
    // F3b the same with a cap normal that HAS an x component. The side wall is
    //    asserted exactly as everywhere else; the VOLUME is not this gate's claim:
    //    the planar caps are bounded by an ellipse, which the importer hands
    //    MassProps as its 64-gon chord polygon (only a circle gets the exact
    //    isDisk path), and with n_x != 0 that polygon enters the x n_x integral.
    //    MEASURED: rel 9.330e-05, the SAME on c75af519 and here, and equal to
    //    -(1 - sin(2pi/64)/(2pi/64)) x cap area x sum(n_x xbar) over the two caps.
    {
        const gp_Dir nrm(0.3, -0.2, 0.9327379053);
        const gp_Ax2 ax(gp_Pnt(1.0, 2.0, -0.5), nrm, gp_Dir(gp_Vec(nrm).Crossed(gp_Vec(0.2, 1.0, 0.1))));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Elips(ax, 2.2, 0.9)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        const gp_Vec sweep(-0.5, 0.8, 3.1);
        Fixture f{"ellipse/tilted-x", BRepPrimAPI_MakePrism(p, sweep).Shape(),
                  kPi * 2.2 * 0.9 * std::fabs(sweep.Dot(gp_Vec(nrm))), true};
        f.knownVolumeDefect = KNOWN_CAP_TASK;
        fx.push_back(f);
    }
    // F4 full CIRCLE, OBLIQUE sweep.  vol = pi r^2 h
    {
        const gp_Ax2 ax(gp_Pnt(-0.4, 0.5, 0.2), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Circ(ax, 2.0)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        fx.push_back({"circle/oblique", BRepPrimAPI_MakePrism(p, gp_Vec(0.7, 0.3, 3.0)).Shape(),
                      kPi * 4.0 * 3.0, true});
    }
    // F5/F6 elliptical-ARC D-profile (arc + chord), both arc senses. The segment
    // between eccentric angles t1,t2 has area (ab/2)[(t2-t1) - sin(t2-t1)].
    for (int sense = 0; sense < 2; ++sense) {
        const gp_Elips E(gp_Ax2(gp_Pnt(-0.4, 0.1, 0.3), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), 2.5, 1.5);
        Handle(Geom_TrimmedCurve) arc =
            GC_MakeArcOfEllipse(E, 0.35, 2.65, sense == 0 ? Standard_True : Standard_False).Value();
        TopoDS_Edge ea = BRepBuilderAPI_MakeEdge(arc).Edge();
        TopoDS_Edge ch = BRepBuilderAPI_MakeEdge(arc->EndPoint(), arc->StartPoint()).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(ea, ch).Wire()).Face();
        const double area = 0.5 * 2.5 * 1.5 * ((2.65 - 0.35) - std::sin(2.65 - 0.35));
        fx.push_back({sense == 0 ? "ellipse-arc D/fwd" : "ellipse-arc D/rev",
                      BRepPrimAPI_MakePrism(p, gp_Vec(0.0, 0.5, 3.0)).Shape(), area * 3.0, true});
    }
    // F7 CIRCULAR-arc D-profile (> half turn, crosses the conic's seam angle 0),
    //    oblique. Segment area (r^2/2)(theta - sin theta).
    {
        const gp_Circ C(gp_Ax2(gp_Pnt(0.3, 0.3, 0.0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), 1.8);
        Handle(Geom_TrimmedCurve) arc = GC_MakeArcOfCircle(C, -2.0, 2.4, Standard_True).Value();
        TopoDS_Edge ea = BRepBuilderAPI_MakeEdge(arc).Edge();
        TopoDS_Edge ch = BRepBuilderAPI_MakeEdge(arc->EndPoint(), arc->StartPoint()).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(ea, ch).Wire()).Face();
        const double th = 4.4;
        fx.push_back({"circle-arc D/oblique", BRepPrimAPI_MakePrism(p, gp_Vec(-0.6, 0.2, 2.0)).Shape(),
                      0.5 * 1.8 * 1.8 * (th - std::sin(th)) * 2.0, true});
    }
    // CONTROLS (imported before the fix; must stay exact)
    {
        const gp_Ax2 ax(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0));
        TopoDS_Edge e = BRepBuilderAPI_MakeEdge(gp_Circ(ax, 2.0)).Edge();
        TopoDS_Face p = BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e).Wire()).Face();
        fx.push_back({"control circle/right", BRepPrimAPI_MakePrism(p, gp_Vec(0, 0, 3.0)).Shape(),
                      kPi * 4.0 * 3.0, false});
    }
    {
        BRepBuilderAPI_MakePolygon poly(gp_Pnt(0, 0, 0), gp_Pnt(4, 0, 0), gp_Pnt(4, 3, 0),
                                        gp_Pnt(0, 3, 0), Standard_True);
        TopoDS_Face p = BRepBuilderAPI_MakeFace(poly.Wire()).Face();
        fx.push_back({"control box/oblique", BRepPrimAPI_MakePrism(p, gp_Vec(0.5, 0.25, 2.0)).Shape(),
                      12.0 * 2.0, false});
    }

    for (const Fixture& f : fx) {
        std::printf("-- %s\n", f.name);
        runFixture(f);
    }
    std::printf("== %d passed, %d failed ==\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
