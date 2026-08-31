// thrusections_probe2.cpp — deeper diagnosis of the THRUSECTIONS 0/600 row.
//
// Adds to probe #1:
//   * a POSITIVE CONTROL (--selftest): a prism and a frustum built here, where
//     the classifier must say H_reached_sew AND the engine must return a SHAPE.
//     Without it, "classifier says DEFER, engine says NULL" on 600 constant rows
//     is two constants agreeing and proves nothing.
//   * geometry of the derived pair: angle between the two face normals, whether
//     the two faces SHARE an edge (adjacent), and the min bad-quad count over
//     every rotation x orientation of the second ring (the best correspondence
//     any re-indexing fix could reach).

#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>

#include "forge/native/brep/NativeLoftPipe.hpp"

namespace {

struct PartInfo {
    TopoDS_Shape shape;
    double bb[6] = {0,0,0,0,0,0};
    double minExt = 0.0, diag = 0.0;
};

bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) { bb[0]=bb[3]=p.X(); bb[1]=bb[4]=p.Y(); bb[2]=bb[5]=p.Z(); first=false; }
        else {
            bb[0]=std::min(bb[0],p.X()); bb[3]=std::max(bb[3],p.X());
            bb[1]=std::min(bb[1],p.Y()); bb[4]=std::max(bb[4],p.Y());
            bb[2]=std::min(bb[2],p.Z()); bb[5]=std::max(bb[5],p.Z());
        }
    }
    return !first;
}
double faceArea(const TopoDS_Face& f) {
    GProp_GProps g; try { BRepGProp::SurfaceProperties(f,g);} catch(...) {return 0.0;} return g.Mass();
}
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g; try { BRepGProp::SurfaceProperties(f,g);} catch(...) {return gp_Pnt(0,0,0);} return g.CentreOfMass();
}
bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(s);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}
bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea*(1.0+1e-12)) return true;
    if (candArea < bestArea*(1.0-1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X()!=b.X()) return a.X()<b.X();
    if (a.Y()!=b.Y()) return a.Y()<b.Y();
    return a.Z()<b.Z();
}
struct Picks {
    TopoDS_Face planarBig;    double planarBigArea = 0.0;  gp_Pln planarBigPln;
    TopoDS_Face planarSecond; double planarSecondArea = 0.0; gp_Pln planarSecondPln;
    int nPlanar = 0, nFaces = 0;
};
Picks pickInputs(const PartInfo& part) {
    Picks p;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(part.shape, TopAbs_FACE, fm);
    p.nFaces = fm.Extent();
    for (int i=1;i<=fm.Extent();++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a>0.0)) continue;
        gp_Pln pl;
        if (planeOf(f,pl)) {
            ++p.nPlanar;
            if (betterFace(f,a,p.planarBig,p.planarBigArea)) { p.planarBig=f; p.planarBigArea=a; p.planarBigPln=pl; }
        }
    }
    if (!p.planarBig.IsNull()) {
        for (int i=1;i<=fm.Extent();++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            if (f.IsSame(p.planarBig)) continue;
            gp_Pln pl;
            if (!planeOf(f,pl)) continue;
            const double a = faceArea(f);
            if (!(a>0.0)) continue;
            const bool sameNormal = pl.Axis().Direction().IsParallel(p.planarBigPln.Axis().Direction(),1e-6);
            const bool samePlane = sameNormal &&
                std::fabs(p.planarBigPln.Distance(pl.Location())) < 1e-7*std::max(1.0,part.diag);
            if (samePlane) continue;
            if (betterFace(f,a,p.planarSecond,p.planarSecondArea)) {
                p.planarSecond=f; p.planarSecondArea=a; p.planarSecondPln=pl;
            }
        }
    }
    return p;
}

gp_Vec newell(const std::vector<gp_Pnt>& r) {
    double nx=0,ny=0,nz=0; const std::size_t n=r.size();
    for (std::size_t i=0;i<n;++i) {
        const gp_Pnt& a=r[i]; const gp_Pnt& b=r[(i+1)%n];
        nx += (a.Y()-b.Y())*(a.Z()+b.Z());
        ny += (a.Z()-b.Z())*(a.X()+b.X());
        nz += (a.X()-b.X())*(a.Y()+b.Y());
    }
    return gp_Vec(0.5*nx,0.5*ny,0.5*nz);
}
bool ringPlanar(const std::vector<gp_Pnt>& r, double tol, double& area) {
    if (r.size()<3) return false;
    const gp_Vec nv = newell(r);
    area = nv.Magnitude();
    if (area <= tol*tol) return false;
    const gp_Vec u = nv/area;
    for (const gp_Pnt& p : r) if (std::fabs(gp_Vec(r[0],p).Dot(u)) > tol) return false;
    return true;
}
bool quadPlanar(const gp_Pnt&a,const gp_Pnt&b,const gp_Pnt&c,const gp_Pnt&d,double tol){
    const std::vector<gp_Pnt> q{a,b,c,d}; double ar=0; return ringPlanar(q,tol,ar);
}
bool isLineEdge(const TopoDS_Edge& e) {
    Standard_Real f=0,l=0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e,f,l);
    while (!c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
        c = Handle(Geom_TrimmedCurve)::DownCast(c)->BasisCurve();
    return !c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_Line));
}
int polygonRingWhy(const TopoDS_Wire& w, std::vector<gp_Pnt>& out, double tol) {
    out.clear();
    if (w.IsNull()) return 3;
    int nEdge=0;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) return 1;
        ++nEdge;
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (out.empty() || p.Distance(out.back())>tol) out.push_back(p);
    }
    if (nEdge<3 || out.size()<3) return 3;
    if (!BRep_Tool::IsClosed(w)) return 2;
    if (out.front().Distance(out.back())<=tol) out.pop_back();
    return out.size()>=3 ? 0 : 3;
}

int badQuadCount(const std::vector<gp_Pnt>& r1, const std::vector<gp_Pnt>& r2, double tol) {
    const std::size_t n = r1.size();
    int bad = 0;
    for (std::size_t i=0;i<n;++i) {
        const std::size_t j=(i+1)%n;
        if (!quadPlanar(r1[i],r1[j],r2[j],r2[i],tol)) ++bad;
    }
    return bad;
}

// Best bad-quad count over every rotation x orientation of ring2 — the ceiling
// on what a correspondence-search fix could buy.
int bestBadOverCorrespondence(const std::vector<gp_Pnt>& r1,
                              const std::vector<gp_Pnt>& r2, double tol) {
    const std::size_t n = r1.size();
    int best = (int)n + 1;
    for (int rev=0; rev<2; ++rev) {
        std::vector<gp_Pnt> b = r2;
        if (rev) std::reverse(b.begin(), b.end());
        for (std::size_t s=0; s<n; ++s) {
            std::vector<gp_Pnt> c(n);
            for (std::size_t i=0;i<n;++i) c[i] = b[(i+s)%n];
            best = std::min(best, badQuadCount(r1, c, tol));
            if (best==0) return 0;
        }
    }
    return best;
}

bool sharesEdge(const TopoDS_Face& a, const TopoDS_Face& b) {
    TopTools_IndexedMapOfShape ea, eb;
    TopExp::MapShapes(a, TopAbs_EDGE, ea);
    TopExp::MapShapes(b, TopAbs_EDGE, eb);
    for (int i=1;i<=ea.Extent();++i)
        for (int j=1;j<=eb.Extent();++j)
            if (ea(i).IsSame(eb(j))) return true;
    return false;
}

TopoDS_Wire polyWire(const std::vector<gp_Pnt>& r) {
    BRepBuilderAPI_MakePolygon mp;
    for (const gp_Pnt& p : r) mp.Add(p);
    mp.Close();
    return mp.Wire();
}

// ── POSITIVE CONTROL ────────────────────────────────────────────────────────
// A prism and a frustum: both must classify H_reached_sew and the engine must
// return a SHAPE. If either says otherwise the whole harness is inert.
int selftest() {
    const double tol = 1.0e-6;
    int bad = 0;
    struct Case { const char* name; double s2; double dz; };
    const Case cases[] = {{"prism_10x10x20", 10.0, 20.0}, {"frustum_10->4", 4.0, 15.0}};
    for (const Case& c : cases) {
        std::vector<gp_Pnt> r1{{-5,-5,0},{5,-5,0},{5,5,0},{-5,5,0}};
        const double h = c.s2/2.0;
        std::vector<gp_Pnt> r2{{-h,-h,c.dz},{h,-h,c.dz},{h,h,c.dz},{-h,h,c.dz}};
        const int nb = badQuadCount(r1, r2, tol);
        double a1=0,a2=0;
        const bool p1 = ringPlanar(r1,tol,a1), p2 = ringPlanar(r2,tol,a2);
        std::vector<TopoDS_Shape> secs{polyWire(r1), polyWire(r2)};
        TopoDS_Shape nat;
        try { nat = forge::occtloft::thruSections(secs, true, true, tol); } catch(...) {}
        double vol = 0.0;
        if (!nat.IsNull()) { GProp_GProps g; try { BRepGProp::VolumeProperties(nat,g); vol=g.Mass(); } catch(...) {} }
        // closed form: prismatoid volume = h/6 * (A1 + 4*Am + A2), Am the mid section
        const double A1 = 100.0, A2 = c.s2*c.s2;
        const double mid = (10.0 + c.s2)/2.0;
        const double Am = mid*mid;
        const double want = c.dz/6.0*(A1 + 4.0*Am + A2);
        const bool ok = (nb==0) && p1 && p2 && !nat.IsNull() &&
                        std::fabs(vol - want) <= 1e-6*std::max(1.0, want);
        std::printf("SELFTEST %-16s badQuads=%d ringPlanar=%d,%d engine=%s vol=%.9f want=%.9f  %s\n",
                    c.name, nb, (int)p1, (int)p2, nat.IsNull()?"NULL":"SHAPE", vol, want,
                    ok ? "PASS" : "FAIL");
        if (!ok) ++bad;
    }
    // NEGATIVE control: a deliberately twisted pair (rotate the top square 45
    // degrees) must be classified F_lateral_quad_non_planar AND the engine must
    // return NULL. A classifier that never says DEFER is as useless as one that
    // always does.
    {
        std::vector<gp_Pnt> r1{{-5,-5,0},{5,-5,0},{5,5,0},{-5,5,0}};
        const double s = std::sqrt(50.0);
        std::vector<gp_Pnt> r2{{0,-s,20},{s,0,20},{0,s,20},{-s,0,20}};
        const int nb = badQuadCount(r1, r2, tol);
        std::vector<TopoDS_Shape> secs{polyWire(r1), polyWire(r2)};
        TopoDS_Shape nat;
        try { nat = forge::occtloft::thruSections(secs, true, true, tol); } catch(...) {}
        const bool ok = (nb>0) && nat.IsNull();
        std::printf("SELFTEST %-16s badQuads=%d engine=%s  %s\n", "twisted_45",
                    nb, nat.IsNull()?"NULL":"SHAPE", ok?"PASS (negative control)":"FAIL");
        if (!ok) ++bad;
    }
    std::printf("SELFTEST %s\n", bad==0 ? "ALL PASS" : "FAILED");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc>=2 && std::strcmp(argv[1],"--selftest")==0) return selftest();
    if (argc < 2) { std::fprintf(stderr, "usage: probe2 [--selftest] <step>...\n"); return 2; }

    for (int ai=1; ai<argc; ++ai) {
        const std::string path = argv[ai];
        std::string name = path;
        { size_t s=name.find_last_of('/'); if (s!=std::string::npos) name=name.substr(s+1);
          size_t d=name.find_last_of('.'); if (d!=std::string::npos) name=name.substr(0,d); }

        PartInfo part;
        {
            STEPControl_Reader rd;
            IFSelect_ReturnStatus st = IFSelect_RetFail;
            try { st = rd.ReadFile(path.c_str()); } catch(...) { st = IFSelect_RetFail; }
            if (st != IFSelect_RetDone) { std::printf("%s\tERR\tstep_read_failed\t0\t0\t0\t0\t-\t-\t-\n",name.c_str()); continue; }
            try { rd.TransferRoots(); } catch(...) {}
            try { part.shape = rd.OneShape(); } catch(...) {}
            if (part.shape.IsNull()) { std::printf("%s\tERR\tstep_transfer_empty\t0\t0\t0\t0\t-\t-\t-\n",name.c_str()); continue; }
        }
        if (!boundsOf(part.shape, part.bb)) { std::printf("%s\tERR\tno_vertices\t0\t0\t0\t0\t-\t-\t-\n",name.c_str()); continue; }
        { const double dx=part.bb[3]-part.bb[0], dy=part.bb[4]-part.bb[1], dz=part.bb[5]-part.bb[2];
          part.minExt = std::min(dx,std::min(dy,dz));
          part.diag = std::sqrt(dx*dx+dy*dy+dz*dz); }
        if (!(part.diag>0.0)) { std::printf("%s\tERR\tdegenerate_bbox\t0\t0\t0\t0\t-\t-\t-\n",name.c_str()); continue; }

        const Picks pk = pickInputs(part);
        const double tol = 1.0e-6;

        std::string reason = "A_no_two_noncoplanar_planar_faces";
        int n1=0,n2=0,badQ=-1,bestBad=-1;
        double angDeg = -1.0;
        const char* adj = "-";
        const char* engine = "NOTCALLED";

        if (!pk.planarBig.IsNull() && !pk.planarSecond.IsNull()) {
            angDeg = pk.planarBigPln.Axis().Direction().Angle(
                         pk.planarSecondPln.Axis().Direction()) * 180.0 / 3.14159265358979323846;
            adj = sharesEdge(pk.planarBig, pk.planarSecond) ? "ADJACENT" : "disjoint";
            const TopoDS_Wire w1 = BRepTools::OuterWire(pk.planarBig);
            const TopoDS_Wire w2 = BRepTools::OuterWire(pk.planarSecond);
            if (w1.IsNull() || w2.IsNull()) reason = "A_no_outer_wire";
            else {
                std::vector<gp_Pnt> r1, r2;
                const int why1 = polygonRingWhy(w1, r1, tol);
                const int why2 = polygonRingWhy(w2, r2, tol);
                n1=(int)r1.size(); n2=(int)r2.size();
                if (why1==1 || why2==1)      reason = "B_section_has_non_line_edge";
                else if (why1==2 || why2==2) reason = "C_section_wire_not_closed";
                else if (why1==3 || why2==3) reason = "D_section_degenerate_ring";
                else if (r1.size()!=r2.size()) reason = "E_vertex_count_mismatch";
                else {
                    badQ = badQuadCount(r1,r2,tol);
                    bestBad = bestBadOverCorrespondence(r1,r2,tol);
                    if (badQ>0) reason = "F_lateral_quad_non_planar";
                    else {
                        double a1=0,a2=0;
                        if (!ringPlanar(r1,tol,a1) || !ringPlanar(r2,tol,a2)) reason="G_end_section_non_planar";
                        else reason = "H_reached_sew";
                    }
                }
                std::vector<TopoDS_Shape> secs{w1, w2};
                TopoDS_Shape nat;
                try { nat = forge::occtloft::thruSections(secs, true, true, tol); } catch(...) {}
                engine = nat.IsNull() ? "NULL" : "SHAPE";
            }
        }
        std::printf("%s\t%s\t%d\t%d\t%d\t%d\t%.2f\t%s\t%s\n",
                    name.c_str(), reason.c_str(), n1, n2, badQ, bestBad, angDeg, adj, engine);
        std::fflush(stdout);
    }
    return 0;
}
