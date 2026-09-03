// ─────────────────────────────────────────────────────────────────────────────
// thicksolid_g_flip_cost.cpp — WHAT DOES FLIPPING FORGE_THICKSOLID_DROP_NATIVE
// ACTUALLY COST, on the input distribution the shipped call sites produce?
//
// The 600-part A/B answers a different question. It measures the corpus of
// imported reference solids, where the option deletes 133 OCCT answers. It does
// NOT measure the inputs `forge::part::shell` is actually called with — a BOX,
// a CYL, an EXTRUDE, a plate with a hole; the things ft/FeatureTreeCompiler
// opShell and the UI's "Shell Body" command produce.
//
// With the option ON, part::shell routes to forge::occtoffset::makeThickSolid
// and a null return becomes a THROWN ERROR. So the cost of the flip on those
// inputs is exactly: which of them does the NATIVE engine decline?
//
// This runs BOTH engines side by side on the same canonical cases and checks
// each against a CLOSED FORM derived here — never against the other engine,
// because §4 of THICKSOLID_ATTRIBUTION establishes OCCT is not a valid oracle
// for this operation. Volume, area, face census and BRepCheck are all reported;
// volume alone cannot validate geometry.
//
// Links the native engine archive; the closed forms are independent of both.
// ─────────────────────────────────────────────────────────────────────────────
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <gp_Vec.hxx>
#include <STEPControl_Reader.hxx>
#include <TopExp_Explorer.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Plane.hxx>
#include <gp_Pln.hxx>
#include <gp_Ax2.hxx>
#include <Standard_Failure.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <map>
#include "forge/native/brep/NativeThickSolid.hpp"

static double vol(const TopoDS_Shape& s){GProp_GProps g;BRepGProp::VolumeProperties(s,g);return g.Mass();}
static double area(const TopoDS_Shape& s){GProp_GProps g;BRepGProp::SurfaceProperties(s,g);return g.Mass();}
static int nfc(const TopoDS_Shape& s){TopTools_IndexedMapOfShape m;TopExp::MapShapes(s,TopAbs_FACE,m);return m.Extent();}
static int okv(const TopoDS_Shape& s){try{BRepCheck_Analyzer a(s);return a.IsValid()?1:0;}catch(...){return -1;}}
// ★ VOLUME ALONE CANNOT VALIDATE GEOMETRY. Where the two engines disagree, the
// SURFACE-TYPE census says WHY in a way a scalar cannot: an arc join leaves a
// cylinder of radius t behind, and a sharp join does not.
static std::string surfaceCensus(const TopoDS_Shape& s) {
    TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, TopAbs_FACE, m);
    std::map<std::string,int> k;
    for (int i=1;i<=m.Extent();++i) {
        BRepAdaptor_Surface a(TopoDS::Face(m(i)));
        switch (a.GetType()) {
            case GeomAbs_Plane: k["Plane"]++; break;
            case GeomAbs_Cylinder: { char b[48];
                std::snprintf(b,sizeof b,"Cyl R=%.6g", a.Cylinder().Radius()); k[b]++; break; }
            case GeomAbs_Cone: k["Cone"]++; break;
            case GeomAbs_Sphere: k["Sphere"]++; break;
            case GeomAbs_Torus: k["Torus"]++; break;
            default: k["other"]++; break;
        }
    }
    std::string out;
    for (auto& kv : k) { if(!out.empty()) out += ", "; out += kv.first + " x" + std::to_string(kv.second); }
    return out;
}

static double fA(const TopoDS_Face& f){GProp_GProps g;BRepGProp::SurfaceProperties(f,g);return g.Mass();}

static TopoDS_Face axisFace(const TopoDS_Shape& s, double az) {
    TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, TopAbs_FACE, m);
    TopoDS_Face best; double bestA = 0;
    for (int i=1;i<=m.Extent();++i){
        TopoDS_Face f=TopoDS::Face(m(i));
        Handle(Geom_Plane) pl=Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f));
        if(pl.IsNull()) continue;
        gp_Dir n=pl->Pln().Axis().Direction();
        if(f.Orientation()==TopAbs_REVERSED) n.Reverse();
        const double proj = (az==0.0) ? n.X() : n.Z()*az;   // az==0 selects the +X face
        if(proj<0.9) continue;
        const double a=fA(f);
        if(best.IsNull()||a>bestA){best=f;bestA=a;}
    }
    return best;
}

// NEGATIVE CONTROL. A column that only ever prints EXACT is indistinguishable
// from a column that cannot print anything else. `main` takes an optional STEP
// path — a corpus part the 600-part A/B records as a native DEFER — and runs it
// through the SAME code path, so the NATIVE column is shown able to say DEFER
// and to name the guard. Without this, "NATIVE: defers 0" is unfalsifiable.
static bool loadStep(const char* path, TopoDS_Shape& out, double& wall, TopoDS_Face& rm) {
    STEPControl_Reader rd;
    if (rd.ReadFile(path) != IFSelect_RetDone) return false;
    rd.TransferRoots();
    out = rd.OneShape();
    if (out.IsNull()) return false;
    double bb[6]; bool first = true;
    for (TopExp_Explorer ex(out, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first){bb[0]=bb[3]=p.X();bb[1]=bb[4]=p.Y();bb[2]=bb[5]=p.Z();first=false;}
        else {bb[0]=std::min(bb[0],p.X());bb[3]=std::max(bb[3],p.X());
              bb[1]=std::min(bb[1],p.Y());bb[4]=std::max(bb[4],p.Y());
              bb[2]=std::min(bb[2],p.Z());bb[5]=std::max(bb[5],p.Z());}
    }
    if (first) return false;
    const double dx=bb[3]-bb[0],dy=bb[4]-bb[1],dz=bb[5]-bb[2];
    const double mn=std::min(dx,std::min(dy,dz));
    const double dg=std::sqrt(dx*dx+dy*dy+dz*dz);
    wall = 0.05 * ((mn > 1e-9*dg) ? mn : dg*0.05);
    TopTools_IndexedMapOfShape m; TopExp::MapShapes(out, TopAbs_FACE, m);
    double bigA=0;
    for (int i=1;i<=m.Extent();++i){
        TopoDS_Face f=TopoDS::Face(m(i));
        if (Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(f)).IsNull()) continue;
        const double a=fA(f);
        if (a>bigA*(1.0+1e-12)) { rm=f; bigA=a; }
    }
    return !rm.IsNull();
}

int main(int argc, char** argv) {
    struct C { const char* name; TopoDS_Shape src; double expect; const char* expr; double t; double az; };
    std::vector<C> cs;
    cs.push_back({"box 10^3, top open", BRepPrimAPI_MakeBox(10.,10.,10.).Shape(), 1000.-8.*8.*9., "1000-8*8*9", 1.0, 1.0});
    cs.push_back({"box 40x40x20, top open", BRepPrimAPI_MakeBox(40.,40.,20.).Shape(), 32000.-38.*38.*19., "32000-38*38*19", 1.0, 1.0});
    cs.push_back({"cyl R10 H30, top open", BRepPrimAPI_MakeCylinder(10.,30.).Shape(), M_PI*(3000.-81.*29.), "pi(3000-81*29)", 1.0, 1.0});
    {
        TopoDS_Shape b=BRepPrimAPI_MakeBox(40.,40.,20.).Shape();
        gp_Ax2 ax(gp_Pnt(20,20,-1),gp_Dir(0,0,1));
        BRepAlgoAPI_Cut cut(b, BRepPrimAPI_MakeCylinder(ax,5.,22.).Shape()); cut.Build();
        cs.push_back({"plate 40x40x20 + R5 hole, top open", cut.Shape(),
                      (32000.-20.*M_PI*25.)-(38.*38.*19.-19.*M_PI*36.), "(32000-500pi)-(27436-684pi)", 1.0, 1.0});
    }
    cs.push_back({"IR SHELL box 60x40x30 t=3, -Z open", BRepPrimAPI_MakeBox(60.,40.,30.).Shape(),
                  72000.-54.*34.*27., "72000-54*34*27", 3.0, -1.0});

    // ── non-convex, multi-hole, curved, and a SIDE opening ────────────────
    // (6) L-shaped prism, top open. Outer L polygon
    //     (0,0)(60,0)(60,20)(30,20)(30,40)(0,40), area 1800, extruded h=30.
    //     Inward offset by t=2 is the L (2,2)(58,2)(58,18)(28,18)(28,38)(2,38),
    //     area 56*16+26*20 = 1416. Cavity height 30-2 = 28.
    //     V = 1800*30 - 1416*28 = 14352.   NON-CONVEX: it has a reflex corner.
    {
        BRepBuilderAPI_MakePolygon poly;
        poly.Add(gp_Pnt(0,0,0)); poly.Add(gp_Pnt(60,0,0)); poly.Add(gp_Pnt(60,20,0));
        poly.Add(gp_Pnt(30,20,0)); poly.Add(gp_Pnt(30,40,0)); poly.Add(gp_Pnt(0,40,0));
        poly.Close();
        TopoDS_Shape f = BRepBuilderAPI_MakeFace(poly.Wire()).Face();
        TopoDS_Shape pr = BRepPrimAPI_MakePrism(f, gp_Vec(0,0,30)).Shape();
        cs.push_back({"L-prism 1800mm2 h30 t=2, top open", pr, 1800.*30. - 1416.*28., "54000-1416*28", 2.0, 1.0});
    }
    // (7) TUBE: cyl R10 H30 minus coaxial R4 through hole, top open, t=1.
    //     source pi*84*30; cavity annulus r 5..9 over h 29 -> pi*56*29.
    //     V = pi*(2520-1624) = 896pi.
    {
        TopoDS_Shape c = BRepPrimAPI_MakeCylinder(10.,30.).Shape();
        gp_Ax2 ax(gp_Pnt(0,0,-1), gp_Dir(0,0,1));
        BRepAlgoAPI_Cut cut(c, BRepPrimAPI_MakeCylinder(ax,4.,32.).Shape()); cut.Build();
        cs.push_back({"tube R10/R4 H30 t=1, top open", cut.Shape(), 896.*M_PI, "896pi", 1.0, 1.0});
    }
    // (8) plate 40x40x20 with TWO R5 through holes, top open, t=1.
    //     V = (32000-1000pi) - (27436-1368pi) = 4564 + 368pi.
    {
        TopoDS_Shape b = BRepPrimAPI_MakeBox(40.,40.,20.).Shape();
        BRepAlgoAPI_Cut c1(b, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(10,20,-1),gp_Dir(0,0,1)),5.,22.).Shape()); c1.Build();
        BRepAlgoAPI_Cut c2(c1.Shape(), BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30,20,-1),gp_Dir(0,0,1)),5.,22.).Shape()); c2.Build();
        cs.push_back({"plate + TWO R5 holes t=1, top open", c2.Shape(), 4564. + 368.*M_PI, "4564+368pi", 1.0, 1.0});
    }
    // (9) SIDE opening: box 60x40x30, t=3, the +X face removed.
    //     cavity x 3..60, y 3..37, z 3..27 -> 57*34*24 = 46512. V = 25488.
    {
        cs.push_back({"box 60x40x30 t=3, +X SIDE open", BRepPrimAPI_MakeBox(60.,40.,30.).Shape(),
                      72000. - 57.*34.*24., "72000-57*34*24", 3.0, 0.0});   // az 0 => +X picker
    }
    // (10) right isoceles triangular prism, legs 40, h 20, t=1, top open.
    //      inradius r = 40 - 20*sqrt(2); the inward offset is the SIMILAR
    //      triangle scaled by (r-t)/r. V = 800*20 - 800*((r-1)/r)^2 * 19.
    {
        BRepBuilderAPI_MakePolygon poly;
        poly.Add(gp_Pnt(0,0,0)); poly.Add(gp_Pnt(40,0,0)); poly.Add(gp_Pnt(0,40,0));
        poly.Close();
        TopoDS_Shape f = BRepBuilderAPI_MakeFace(poly.Wire()).Face();
        TopoDS_Shape pr = BRepPrimAPI_MakePrism(f, gp_Vec(0,0,20)).Shape();
        const double r = 40.0 - 20.0*std::sqrt(2.0);
        const double sc = (r - 1.0)/r;
        cs.push_back({"tri prism legs40 h20 t=1, top open", pr, 800.*20. - 800.*sc*sc*19.,
                      "16000-800*((r-1)/r)^2*19", 1.0, 1.0});
    }

    std::printf("FLIP COST — both engines on the inputs the SHIPPED call sites produce\n");
    std::printf("(with FORGE_THICKSOLID_DROP_NATIVE=ON a native DEFER becomes a THROWN ERROR)\n\n");
    std::printf("%-36s %-34s %-34s\n", "case", "NATIVE (the drop's only path)", "OCCT (what the drop removes)");
    int nativeDefers=0, nativeWrong=0, occtDefers=0, occtWrong=0, occtInvalid=0, nativeInvalid=0;
    for (auto& c : cs) {
        TopoDS_Face f = axisFace(c.src, c.az);
        char nb[200]="?", ob[200]="?";
        if (f.IsNull()) { std::printf("%-36s NO FACE\n", c.name); continue; }
        TopTools_ListOfShape rm; rm.Append(f);
        // NATIVE (convention: +t hollows inward)
        TopoDS_Shape nat;
        try { nat = ::forge::occtoffset::makeThickSolid(c.src, c.t, rm, 1.0e-3); } catch (...) {}
        if (nat.IsNull()) {
            const char* why = ::forge::occtoffset::lastThickSolidDeferReason();
            std::snprintf(nb,sizeof nb,"DEFER %s", (why&&*why)?why:"(no label)");
            ++nativeDefers;
        } else {
            const double V=vol(nat); const int vv=okv(nat);
            const bool good = std::fabs(V-c.expect) <= 1e-7*std::max(1.0,std::fabs(c.expect));
            std::snprintf(nb,sizeof nb,"V=%.12g %s f=%d %s", V, good?"EXACT":"WRONG", nfc(nat),
                          vv==1?"VALID":(vv==0?"INVALID":"chk-threw"));
            if(!good) ++nativeWrong;
            if(vv!=1) ++nativeInvalid;
        }
        // OCCT (convention: -t hollows inward)
        TopoDS_Shape oc; bool done=false;
        try { BRepOffsetAPI_MakeThickSolid mk; mk.MakeThickSolidByJoin(c.src, rm, -c.t, 1.0e-3);
              mk.Build(); done=mk.IsDone(); if(done) oc=mk.Shape(); } catch (...) {}
        if (!done || oc.IsNull()) { std::snprintf(ob,sizeof ob,"DEFER (IsDone false)"); ++occtDefers; }
        else {
            const double V=vol(oc); const int vv=okv(oc);
            const bool good = std::fabs(V-c.expect) <= 1e-7*std::max(1.0,std::fabs(c.expect));
            std::snprintf(ob,sizeof ob,"V=%.12g %s f=%d %s", V, good?"EXACT":"WRONG", nfc(oc),
                          vv==1?"VALID":(vv==0?"INVALID":"chk-threw"));
            if(!good) ++occtWrong;
            if(vv!=1) ++occtInvalid;
        }
        std::printf("%-36s %-42s %-42s   [closed form %s = %.9g]\n", c.name, nb, ob, c.expr, c.expect);
        // Print the surface-type census whenever the two engines differ on
        // volume or on face count — that is where the interesting answer is.
        if (!nat.IsNull() && !oc.IsNull() &&
            (nfc(nat) != nfc(oc) ||
             std::fabs(vol(nat) - vol(oc)) > 1e-9 * std::max(1.0, std::fabs(vol(nat))))) {
            std::printf("      surfaces  NATIVE: %s\n", surfaceCensus(nat).c_str());
            std::printf("      surfaces  OCCT  : %s\n", surfaceCensus(oc).c_str());
        }
    }
    // ── the negative control ────────────────────────────────────────────────
    int ctlDefer = 0, ctlRan = 0;
    for (int i = 1; i < argc; ++i) {
        TopoDS_Shape src; double wall = 0; TopoDS_Face rm;
        if (!loadStep(argv[i], src, wall, rm)) { std::printf("\nCONTROL %s: could not load\n", argv[i]); continue; }
        ++ctlRan;
        TopoDS_Shape nat;
        try { nat = ::forge::occtoffset::makeThickSolid(src, wall, [&]{TopTools_ListOfShape l;l.Append(rm);return l;}(), 1.0e-3); } catch(...){}
        if (nat.IsNull()) {
            const char* why = ::forge::occtoffset::lastThickSolidDeferReason();
            std::printf("\nNEGATIVE CONTROL %s (wall %.4g): NATIVE DEFER, label \"%s\"\n",
                        argv[i], wall, (why&&*why)?why:"(none)");
            ++ctlDefer;
        } else {
            std::printf("\nNEGATIVE CONTROL %s (wall %.4g): NATIVE BUILT V=%.9g valid=%d\n",
                        argv[i], wall, vol(nat), okv(nat));
        }
    }
    if (ctlRan) std::printf("negative control: %d/%d printed DEFER — the NATIVE column CAN say no\n", ctlDefer, ctlRan);
    else std::printf("\n(no negative control given: pass corpus .step paths as arguments)\n");

    std::printf("\ncases: %zu\n", cs.size());
    std::printf("NATIVE: defers %d, volume-wrong %d, not-BRepCheck-valid %d\n", nativeDefers, nativeWrong, nativeInvalid);
    std::printf("OCCT  : defers %d, volume-wrong %d, not-BRepCheck-valid %d\n", occtDefers, occtWrong, occtInvalid);
    std::printf("\nEVERY case the NATIVE column defers on is a case the flip turns into a\n"
                "THROWN ERROR at ft/FeatureTreeCompiler opShell and the UI 'Shell Body' command.\n");
    return 0;
}
