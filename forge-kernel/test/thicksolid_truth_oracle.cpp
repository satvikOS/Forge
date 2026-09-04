// thicksolid_truth_oracle.cpp — WHAT IS THE CORRECT ANSWER, WITHOUT AN OFFSET ENGINE?
//
// THE PROBLEM. Family G's flip gate scores the native engine against OCCT's
// MakeThickSolidByJoin. reports/corpus_ab/THICKSOLID_ATTRIBUTION.md §4 measured
// that every one of that baseline's successes fails BRepCheck, and
// test/thicksolid_bar_census.cpp measures WHY. Neither engine can therefore serve
// as the oracle for "what should this part's hollow have been".
//
// But the operation HAS a definition that needs no offset engine at all. Hollowing
// a solid S by wall t with face F removed is the morphological erosion of S by a
// ball of radius t, taken over the boundary MINUS F:
//
//     cavity  C(t) = { p in int(S) : d(p, dS \ F) > t }
//     result  R(t) = S \ C(t)
//
// That is exactly the convention MakeThickSolidByJoin's default GeomAbs_Arc join
// implements — a convex corner stays sharp, a reflex corner is rounded at radius
// t — so the two are comparable. This probe evaluates the definition directly:
//
//   VOLUME, by Monte Carlo. N uniform points in the bounding box, each tested for
//   membership in S (parity ray cast against the tessellation) and for
//   d(p, dS\F) <= t (bounded-radius query against a triangle grid). The estimate
//   carries its own standard error, and the SAME sample also estimates vol(S),
//   which BRepGProp knows exactly — so every part carries a built-in control and
//   a part whose mesh or ray cast is wrong reports itself rather than producing a
//   plausible number.
//
//   TOPOLOGY, by voxels. The cavity is rasterised and its Betti numbers are
//   counted: components b0, enclosed voids b2, Euler characteristic X, and
//   handles h = b0 + b2 - X. Comparing the cavity's handle count with the
//   source's answers the question the census raises and no volume can:
//   DOES THE CORRECT ANSWER AT THIS WALL HAVE A DIFFERENT TOPOLOGY FROM THE
//   BODY IT IS CUT FROM? A cavity that has lost a handle is one where the grown
//   holes have merged, and no exact re-trim of the original faces can express
//   that — which is the capability question, stated as a measurement rather than
//   as an inference from a defer label.
//
// IT LINKS NO OFFSET ENGINE. The only OCCT used is the STEP reader, the mesher
// and BRepGProp (for the control). Neither BRepOffsetAPI nor any forge native
// engine is in this binary, so nothing it reports can be an artefact of the code
// whose baseline it is auditing.
//
// THE DERIVED OPERATION IS COPIED, NOT REINVENTED — bounds from VERTICES,
// scale = min bbox extent (or 0.05*diag when that is ~0), wall = 0.05*scale,
// removed face = largest planar face with the same deterministic tie-break, all
// mirrored from test/corpus_ab_coverage.cpp.
//
// BUILD: test/build_thicksolid_truth_oracle.sh (runs --selftest; refuses to emit
// a binary if the controls are red).

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

namespace {

struct V3 { double x, y, z; };
struct Tri { V3 a, b, c; };

// ─────────────────────────────────────── derivation, mirrored from the A/B
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
    GProp_GProps g; try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; } return g.Mass();
}
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g; try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0,0,0); }
    return g.CentreOfMass();
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
bool betterFace(const TopoDS_Face& cand, double ca, const TopoDS_Face& best, double ba) {
    if (best.IsNull()) return ca > 0.0;
    if (ca > ba * (1.0 + 1e-12)) return true;
    if (ca < ba * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}
TopoDS_Face largestPlanarFace(const TopoDS_Shape& sh, int* nPlanar) {
    TopoDS_Face best; double bestArea = 0.0; int np = 0;
    TopTools_IndexedMapOfShape fm; TopExp::MapShapes(sh, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        const double a = faceArea(f);
        if (!(a > 0.0)) continue;
        gp_Pln pl; if (!planeOf(f, pl)) continue;
        ++np;
        if (betterFace(f, a, best, bestArea)) { best = f; bestArea = a; }
    }
    if (nPlanar) *nPlanar = np;
    return best;
}

// ─────────────────────────────────────────────────────────── tessellation
// Triangles are split until no edge exceeds maxEdge, so a single 250 mm planar
// triangle cannot be bucketed into ten thousand grid cells and cannot make the
// bounded-radius distance query degenerate into a linear scan.
void splitTri(const Tri& t, double maxEdge2, std::vector<Tri>& out, int depth) {
    auto d2 = [](const V3& p, const V3& q) {
        const double dx=p.x-q.x, dy=p.y-q.y, dz=p.z-q.z; return dx*dx+dy*dy+dz*dz;
    };
    const double ab = d2(t.a,t.b), bc = d2(t.b,t.c), ca = d2(t.c,t.a);
    const double m = std::max(ab, std::max(bc, ca));
    if (depth >= 12 || m <= maxEdge2) { out.push_back(t); return; }
    V3 p, q, r, mid;
    if (m == ab)      { p=t.a; q=t.b; r=t.c; }
    else if (m == bc) { p=t.b; q=t.c; r=t.a; }
    else              { p=t.c; q=t.a; r=t.b; }
    mid = { 0.5*(p.x+q.x), 0.5*(p.y+q.y), 0.5*(p.z+q.z) };
    splitTri(Tri{p, mid, r}, maxEdge2, out, depth+1);
    splitTri(Tri{mid, q, r}, maxEdge2, out, depth+1);
}

int gFacesNoTri = 0, gFacesTotal = 0;
double gMeshArea = 0.0;

// `all` is the RAW tessellation and is what the parity rays see: splitting a
// triangle for the sake of a grid introduces slivers, and a dropped sliver is a
// hole in the surface. `keep` is the split tessellation minus the removed face
// and is what the bounded-radius distance query sees, where a sliver is harmless
// and an unsplit 200 mm triangle would be bucketed into every cell of the grid.
bool tessellate(const TopoDS_Shape& shape, const TopoDS_Face& skip, double defl, double maxEdge,
                std::vector<Tri>& all, std::vector<Tri>& keep) {
    gFacesNoTri = gFacesTotal = 0; gMeshArea = 0.0;
    try { BRepMesh_IncrementalMesh m(shape, defl, Standard_False, 0.3, Standard_True); (void)m; }
    catch (...) { return false; }
    const double me2 = maxEdge * maxEdge;
    TopTools_IndexedMapOfShape fm; TopExp::MapShapes(shape, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm(i));
        TopLoc_Location L;
        ++gFacesTotal;
        Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(f, L);
        if (tri.IsNull()) { ++gFacesNoTri; continue; }
        const gp_Trsf tr = L.Transformation();
        const bool isSkip = !skip.IsNull() && f.IsSame(skip);
        std::vector<Tri> tmp;
        for (int k = 1; k <= tri->NbTriangles(); ++k) {
            int n1, n2, n3; tri->Triangle(k).Get(n1, n2, n3);
            gp_Pnt p1 = tri->Node(n1).Transformed(tr);
            gp_Pnt p2 = tri->Node(n2).Transformed(tr);
            gp_Pnt p3 = tri->Node(n3).Transformed(tr);
            Tri t{{p1.X(),p1.Y(),p1.Z()},{p2.X(),p2.Y(),p2.Z()},{p3.X(),p3.Y(),p3.Z()}};
            { const double ux=p2.X()-p1.X(), uy=p2.Y()-p1.Y(), uz=p2.Z()-p1.Z();
              const double vx=p3.X()-p1.X(), vy=p3.Y()-p1.Y(), vz=p3.Z()-p1.Z();
              const double cx=uy*vz-uz*vy, cy=uz*vx-ux*vz, cz=ux*vy-uy*vx;
              gMeshArea += 0.5*std::sqrt(cx*cx+cy*cy+cz*cz); }
            all.push_back(t);
            if (isSkip) continue;
            tmp.clear();
            splitTri(t, me2, tmp, 0);
            for (const Tri& s : tmp) keep.push_back(s);
        }
    }
    return !all.empty();
}

// ────────────────────────────────────────── a 2D (y,z) grid for parity rays
struct RayGrid {
    double y0=0, z0=0, cy=1, cz=1; int ny=1, nz=1;
    std::vector<int> start; std::vector<int> items;
    void build(const std::vector<Tri>& T, const double bb[6], int target) {
        const double dy = std::max(1e-12, bb[4]-bb[1]), dz = std::max(1e-12, bb[5]-bb[2]);
        const double n = std::max(1.0, std::sqrt((double)target));
        ny = (int)std::max(1.0, std::min(1024.0, n)); nz = ny;
        y0 = bb[1] - 1e-9*dy; z0 = bb[2] - 1e-9*dz;
        cy = (dy*(1+2e-9))/ny; cz = (dz*(1+2e-9))/nz;
        std::vector<int> cnt(ny*nz+1, 0);
        auto range = [&](const Tri& t, int& j0, int& j1, int& k0, int& k1) {
            const double ymin=std::min(t.a.y,std::min(t.b.y,t.c.y)), ymax=std::max(t.a.y,std::max(t.b.y,t.c.y));
            const double zmin=std::min(t.a.z,std::min(t.b.z,t.c.z)), zmax=std::max(t.a.z,std::max(t.b.z,t.c.z));
            j0=(int)std::floor((ymin-y0)/cy); j1=(int)std::floor((ymax-y0)/cy);
            k0=(int)std::floor((zmin-z0)/cz); k1=(int)std::floor((zmax-z0)/cz);
            j0=std::max(0,j0); k0=std::max(0,k0); j1=std::min(ny-1,j1); k1=std::min(nz-1,k1);
        };
        for (const Tri& t : T) { int j0,j1,k0,k1; range(t,j0,j1,k0,k1);
            for (int j=j0;j<=j1;++j) for (int k=k0;k<=k1;++k) ++cnt[j*nz+k+1]; }
        start.assign(ny*nz+1, 0);
        for (int i = 0; i < ny*nz; ++i) start[i+1] = start[i] + cnt[i+1];
        items.assign(start[ny*nz], 0);
        std::vector<int> fill(start.begin(), start.end()-1);
        for (size_t i = 0; i < T.size(); ++i) { int j0,j1,k0,k1; range(T[i],j0,j1,k0,k1);
            for (int j=j0;j<=j1;++j) for (int k=k0;k<=k1;++k) items[fill[j*nz+k]++] = (int)i; }
    }
    int cellOf(double y, double z) const {
        int j = (int)std::floor((y-y0)/cy), k = (int)std::floor((z-z0)/cz);
        if (j<0||k<0||j>=ny||k>=nz) return -1;
        return j*nz+k;
    }
};

// Moller-Trumbore, ray along +X from (px,py,pz). Returns hit distance or -1.
inline double rayHitX(const Tri& t, double px, double py, double pz) {
    const double e1x=t.b.x-t.a.x, e1y=t.b.y-t.a.y, e1z=t.b.z-t.a.z;
    const double e2x=t.c.x-t.a.x, e2y=t.c.y-t.a.y, e2z=t.c.z-t.a.z;
    // d = (1,0,0); h = d x e2
    const double hx = 0.0*e2z - 0.0*e2y;   // 0
    const double hy = 0.0*e2x - 1.0*e2z;
    const double hz = 1.0*e2y - 0.0*e2x;
    const double a = e1x*hx + e1y*hy + e1z*hz;
    // A sliver triangle has a tiny |a| for a reason that is not "parallel to the
    // ray", and an ABSOLUTE epsilon here silently drops it -- which punches a hole
    // in the surface and flips the parity of every ray behind it. Measured on the
    // corpus that cost up to 35.7% of a part's volume with a mesh whose area was
    // right to 0.2%. The test is therefore relative to the triangle's own scale.
    const double e1n2 = e1x*e1x + e1y*e1y + e1z*e1z;
    const double hn2  = hx*hx + hy*hy + hz*hz;
    if (a*a <= 1e-26 * e1n2 * hn2) return -1.0;
    const double f = 1.0/a;
    const double sx=px-t.a.x, sy=py-t.a.y, sz=pz-t.a.z;
    const double u = f*(sx*hx + sy*hy + sz*hz);
    if (u < 0.0 || u > 1.0) return -1.0;
    const double qx = sy*e1z - sz*e1y, qy = sz*e1x - sx*e1z, qz = sx*e1y - sy*e1x;
    const double v = f*(1.0*qx);
    if (v < 0.0 || u+v > 1.0) return -1.0;
    const double tt = f*(e2x*qx + e2y*qy + e2z*qz);
    return tt > 1e-12 ? tt : -1.0;
}

inline bool insideParity(const std::vector<Tri>& T, const RayGrid& g,
                         double px, double py, double pz) {
    const int c = g.cellOf(py, pz);
    if (c < 0) return false;
    int hits = 0;
    for (int i = g.start[c]; i < g.start[c+1]; ++i) {
        const double d = rayHitX(T[g.items[i]], px, py, pz);
        if (d > 0.0) ++hits;
    }
    return (hits & 1) != 0;
}

// ─────────────────────────────────────── a 3D grid for bounded-radius distance
struct TriGrid {
    double o[3]={0,0,0}; double c=1; int n[3]={1,1,1};
    std::vector<int> start, items;
    void build(const std::vector<Tri>& T, const double bb[6], double cell) {
        c = std::max(cell, 1e-9);
        for (int a = 0; a < 3; ++a) {
            o[a] = bb[a] - c;
            n[a] = (int)std::max(1.0, std::ceil((bb[a+3]-bb[a]+2*c)/c));
            n[a] = std::min(n[a], 512);
        }
        // recompute c if clamped so the grid still spans the box
        for (int a = 0; a < 3; ++a) {
            const double need = (bb[a+3]-bb[a]+2*c)/n[a];
            if (need > c) c = need;
        }
        for (int a = 0; a < 3; ++a) { o[a] = bb[a] - c;
            n[a] = (int)std::max(1.0, std::ceil((bb[a+3]-bb[a]+2*c)/c)); n[a]=std::min(n[a],512); }
        const long total = (long)n[0]*n[1]*n[2];
        std::vector<int> cnt(total+1, 0);
        auto rng = [&](const Tri& t, int lo[3], int hi[3]) {
            const double mn[3]={std::min(t.a.x,std::min(t.b.x,t.c.x)),std::min(t.a.y,std::min(t.b.y,t.c.y)),std::min(t.a.z,std::min(t.b.z,t.c.z))};
            const double mx[3]={std::max(t.a.x,std::max(t.b.x,t.c.x)),std::max(t.a.y,std::max(t.b.y,t.c.y)),std::max(t.a.z,std::max(t.b.z,t.c.z))};
            for (int a=0;a<3;++a){ lo[a]=std::max(0,(int)std::floor((mn[a]-o[a])/c));
                                   hi[a]=std::min(n[a]-1,(int)std::floor((mx[a]-o[a])/c)); }
        };
        for (const Tri& t : T) { int lo[3],hi[3]; rng(t,lo,hi);
            for (int i=lo[0];i<=hi[0];++i) for (int j=lo[1];j<=hi[1];++j) for (int k=lo[2];k<=hi[2];++k)
                ++cnt[((long)i*n[1]+j)*n[2]+k+1]; }
        start.assign(total+1, 0);
        for (long i = 0; i < total; ++i) start[i+1] = start[i] + cnt[i+1];
        items.assign(start[total], 0);
        std::vector<int> fill(start.begin(), start.end()-1);
        for (size_t s = 0; s < T.size(); ++s) { int lo[3],hi[3]; rng(T[s],lo,hi);
            for (int i=lo[0];i<=hi[0];++i) for (int j=lo[1];j<=hi[1];++j) for (int k=lo[2];k<=hi[2];++k)
                items[fill[((long)i*n[1]+j)*n[2]+k]++] = (int)s; }
    }
};

inline double pointTriDist2(const Tri& t, double px, double py, double pz) {
    const double ax=t.a.x, ay=t.a.y, az=t.a.z;
    const double abx=t.b.x-ax, aby=t.b.y-ay, abz=t.b.z-az;
    const double acx=t.c.x-ax, acy=t.c.y-ay, acz=t.c.z-az;
    const double apx=px-ax,   apy=py-ay,   apz=pz-az;
    const double d1 = abx*apx+aby*apy+abz*apz;
    const double d2 = acx*apx+acy*apy+acz*apz;
    auto q2 = [&](double qx,double qy,double qz){ const double dx=px-qx,dy=py-qy,dz=pz-qz; return dx*dx+dy*dy+dz*dz; };
    if (d1 <= 0 && d2 <= 0) return q2(ax,ay,az);
    const double bpx=px-t.b.x, bpy=py-t.b.y, bpz=pz-t.b.z;
    const double d3 = abx*bpx+aby*bpy+abz*bpz, d4 = acx*bpx+acy*bpy+acz*bpz;
    if (d3 >= 0 && d4 <= d3) return q2(t.b.x,t.b.y,t.b.z);
    const double vc = d1*d4 - d3*d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const double v = d1/(d1-d3);
        return q2(ax+v*abx, ay+v*aby, az+v*abz); }
    const double cpx=px-t.c.x, cpy=py-t.c.y, cpz=pz-t.c.z;
    const double d5 = abx*cpx+aby*cpy+abz*cpz, d6 = acx*cpx+acy*cpy+acz*cpz;
    if (d6 >= 0 && d5 <= d6) return q2(t.c.x,t.c.y,t.c.z);
    const double vb = d5*d2 - d1*d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const double w = d2/(d2-d6);
        return q2(ax+w*acx, ay+w*acy, az+w*acz); }
    const double va = d3*d6 - d5*d4;
    if (va <= 0 && (d4-d3) >= 0 && (d5-d6) >= 0) { const double w = (d4-d3)/((d4-d3)+(d5-d6));
        return q2(t.b.x+w*(t.c.x-t.b.x), t.b.y+w*(t.c.y-t.b.y), t.b.z+w*(t.c.z-t.b.z)); }
    const double den = 1.0/(va+vb+vc);
    const double v = vb*den, w = vc*den;
    return q2(ax+abx*v+acx*w, ay+aby*v+acy*w, az+abz*v+acz*w);
}

// true iff SOME triangle is within r of p. Bounded to the cells within r.
inline bool withinR(const std::vector<Tri>& T, const TriGrid& g, double px,double py,double pz,double r) {
    const double r2 = r*r;
    int lo[3], hi[3];
    const double p[3] = {px,py,pz};
    for (int a=0;a<3;++a){
        lo[a]=(int)std::floor((p[a]-r-g.o[a])/g.c); hi[a]=(int)std::floor((p[a]+r-g.o[a])/g.c);
        lo[a]=std::max(0,lo[a]); hi[a]=std::min(g.n[a]-1,hi[a]);
        if (lo[a] > hi[a]) return false;
    }
    for (int i=lo[0];i<=hi[0];++i) for (int j=lo[1];j<=hi[1];++j) for (int k=lo[2];k<=hi[2];++k) {
        const long c = ((long)i*g.n[1]+j)*g.n[2]+k;
        for (int s = g.start[c]; s < g.start[c+1]; ++s)
            if (pointTriDist2(T[g.items[s]], px,py,pz) <= r2) return true;
    }
    return false;
}

// ────────────────────────────────────────────────────── deterministic sampler
struct Rng {
    uint64_t s;
    explicit Rng(uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    inline uint64_t next() { s ^= s<<13; s ^= s>>7; s ^= s<<17; return s; }
    inline double u01() { return (double)(next() >> 11) * (1.0/9007199254740992.0); }
};

// ────────────────────────────────────────── voxel topology of a bit set
struct Vox {
    int nx=0, ny=0, nz=0; double h=1, o[3]={0,0,0};
    std::vector<uint8_t> b;
    inline size_t idx(int i,int j,int k) const { return ((size_t)i*ny+j)*nz+k; }
    inline bool at(int i,int j,int k) const {
        if (i<0||j<0||k<0||i>=nx||j>=ny||k>=nz) return false; return b[idx(i,j,k)] != 0;
    }
};

long eulerOfVoxels(const Vox& v) {
    // Closed cubical complex generated by the set voxels: X = V - E + F - C.
    long V=0, E=0, F=0, C=0;
    for (int i=0;i<=v.nx;++i) for (int j=0;j<=v.ny;++j) for (int k=0;k<=v.nz;++k) {
        bool any=false;
        for (int di=-1; di<=0 && !any; ++di) for (int dj=-1; dj<=0 && !any; ++dj) for (int dk=-1; dk<=0 && !any; ++dk)
            if (v.at(i+di,j+dj,k+dk)) any=true;
        if (any) ++V;
    }
    for (int i=0;i<v.nx;++i) for (int j=0;j<=v.ny;++j) for (int k=0;k<=v.nz;++k) {
        bool any=false;
        for (int dj=-1; dj<=0 && !any; ++dj) for (int dk=-1; dk<=0 && !any; ++dk)
            if (v.at(i,j+dj,k+dk)) any=true;
        if (any) ++E;
    }
    for (int i=0;i<=v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<=v.nz;++k) {
        bool any=false;
        for (int di=-1; di<=0 && !any; ++di) for (int dk=-1; dk<=0 && !any; ++dk)
            if (v.at(i+di,j,k+dk)) any=true;
        if (any) ++E;
    }
    for (int i=0;i<=v.nx;++i) for (int j=0;j<=v.ny;++j) for (int k=0;k<v.nz;++k) {
        bool any=false;
        for (int di=-1; di<=0 && !any; ++di) for (int dj=-1; dj<=0 && !any; ++dj)
            if (v.at(i+di,j+dj,k)) any=true;
        if (any) ++E;
    }
    for (int i=0;i<v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<=v.nz;++k) {
        bool any=false; for (int dk=-1; dk<=0 && !any; ++dk) if (v.at(i,j,k+dk)) any=true; if (any) ++F; }
    for (int i=0;i<v.nx;++i) for (int j=0;j<=v.ny;++j) for (int k=0;k<v.nz;++k) {
        bool any=false; for (int dj=-1; dj<=0 && !any; ++dj) if (v.at(i,j+dj,k)) any=true; if (any) ++F; }
    for (int i=0;i<=v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<v.nz;++k) {
        bool any=false; for (int di=-1; di<=0 && !any; ++di) if (v.at(i+di,j,k)) any=true; if (any) ++F; }
    for (int i=0;i<v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<v.nz;++k) if (v.at(i,j,k)) ++C;
    return V - E + F - C;
}

long componentsOf(const Vox& v, bool wantSet) {
    std::vector<uint8_t> seen(v.b.size(), 0);
    std::vector<int> stack;
    long comps = 0;
    for (int i=0;i<v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<v.nz;++k) {
        const size_t s = v.idx(i,j,k);
        if (seen[s]) continue;
        if ((v.b[s]!=0) != wantSet) continue;
        ++comps;
        stack.clear(); stack.push_back(i); stack.push_back(j); stack.push_back(k);
        seen[s] = 1;
        while (!stack.empty()) {
            const int kk = stack.back(); stack.pop_back();
            const int jj = stack.back(); stack.pop_back();
            const int ii = stack.back(); stack.pop_back();
            static const int d[6][3] = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
            for (int q=0;q<6;++q) {
                const int a=ii+d[q][0], b2=jj+d[q][1], c2=kk+d[q][2];
                if (a<0||b2<0||c2<0||a>=v.nx||b2>=v.ny||c2>=v.nz) continue;
                const size_t t = v.idx(a,b2,c2);
                if (seen[t]) continue;
                if ((v.b[t]!=0) != wantSet) continue;
                seen[t]=1; stack.push_back(a); stack.push_back(b2); stack.push_back(c2);
            }
        }
    }
    return comps;
}

// Enclosed voids: complement components that do NOT touch the grid boundary.
long voidsOf(const Vox& v) {
    std::vector<uint8_t> seen(v.b.size(), 0);
    std::vector<int> stack;
    long voids = 0;
    for (int i=0;i<v.nx;++i) for (int j=0;j<v.ny;++j) for (int k=0;k<v.nz;++k) {
        const size_t s = v.idx(i,j,k);
        if (seen[s] || v.b[s]) continue;
        bool touches = false;
        ++voids;
        stack.clear(); stack.push_back(i); stack.push_back(j); stack.push_back(k); seen[s]=1;
        while (!stack.empty()) {
            const int kk = stack.back(); stack.pop_back();
            const int jj = stack.back(); stack.pop_back();
            const int ii = stack.back(); stack.pop_back();
            if (ii==0||jj==0||kk==0||ii==v.nx-1||jj==v.ny-1||kk==v.nz-1) touches = true;
            static const int d[6][3] = {{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
            for (int q=0;q<6;++q) {
                const int a=ii+d[q][0], b2=jj+d[q][1], c2=kk+d[q][2];
                if (a<0||b2<0||c2<0||a>=v.nx||b2>=v.ny||c2>=v.nz) continue;
                const size_t t = v.idx(a,b2,c2);
                if (seen[t] || v.b[t]) continue;
                seen[t]=1; stack.push_back(a); stack.push_back(b2); stack.push_back(c2);
            }
        }
        if (touches) --voids;
    }
    return voids;
}

struct Betti { long b0=0, b2=0, chi=0, handles=0, cells=0; };
Betti bettiOf(const Vox& v) {
    Betti r;
    r.b0 = componentsOf(v, true);
    r.b2 = voidsOf(v);
    r.chi = eulerOfVoxels(v);
    r.handles = r.b0 + r.b2 - r.chi;
    for (uint8_t x : v.b) if (x) ++r.cells;
    return r;
}

// ─────────────────────────────────────────────────────────── the measurement
struct Result {
    bool ok = false;
    std::string err;
    double mc_src_vol = 0, mc_res_vol = 0, mc_cav_vol = 0, mc_se = 0, bbox_vol = 0;
    long   n_samples = 0, n_in_src = 0, n_in_res = 0;
    double defl = 0, maxedge = 0;
    long   ntri_all = 0, ntri_keep = 0;
    double vox_h = 0; long vox_nx=0, vox_ny=0, vox_nz=0;
    int faces_total = 0, faces_no_tri = 0; double mesh_area = 0.0;
    Betti  src_b, cav_b;
    bool   topo_done = false;
};

Result measure(const TopoDS_Shape& shape, const TopoDS_Face& rm, double wall,
               long nSamples, double voxPerWall, long voxCap) {
    Result R;
    double vbb[6];
    if (!boundsOf(shape, vbb)) { R.err = "no_vertices"; return R; }
    const double vdx=vbb[3]-vbb[0], vdy=vbb[4]-vbb[1], vdz=vbb[5]-vbb[2];
    const double diag = std::sqrt(vdx*vdx+vdy*vdy+vdz*vdz);
    R.defl = std::min(wall / 12.0, diag * 1.0e-3);
    R.maxedge = std::max(wall, diag / 200.0);
    std::vector<Tri> all, keep;
    if (!tessellate(shape, rm, R.defl, R.maxedge, all, keep)) { R.err = "mesh_failed"; return R; }
    R.ntri_all = (long)all.size(); R.ntri_keep = (long)keep.size();
    R.faces_total = gFacesTotal; R.faces_no_tri = gFacesNoTri; R.mesh_area = gMeshArea;

    // ★ THE INTEGRATION BOX IS THE MESH BOX, NOT THE VERTEX BOX. The derived
    //   operation copies the A/B's VERTEX bounds because that is what the gate
    //   measures; but a full circular edge carries ONE seam vertex, so a
    //   cylindrical part's vertex box can exclude most of its own material. A
    //   Monte-Carlo estimate over a box that does not contain the solid is
    //   biased low and looks exactly like a real number: measured on this corpus
    //   it lost up to 35.7% of a part's volume while the tessellated AREA was
    //   right to 0.2%. The sample box is therefore taken from the tessellation,
    //   which covers the geometry rather than its vertices.
    double bb[6] = {all[0].a.x, all[0].a.y, all[0].a.z, all[0].a.x, all[0].a.y, all[0].a.z};
    for (const Tri& t : all) {
        const V3* v[3] = {&t.a, &t.b, &t.c};
        for (int q = 0; q < 3; ++q) {
            bb[0]=std::min(bb[0],v[q]->x); bb[3]=std::max(bb[3],v[q]->x);
            bb[1]=std::min(bb[1],v[q]->y); bb[4]=std::max(bb[4],v[q]->y);
            bb[2]=std::min(bb[2],v[q]->z); bb[5]=std::max(bb[5],v[q]->z);
        }
    }
    const double dx=bb[3]-bb[0], dy=bb[4]-bb[1], dz=bb[5]-bb[2];

    RayGrid rg; rg.build(all, bb, (int)std::min<size_t>(all.size(), 262144));
    TriGrid tg; tg.build(keep, bb, std::max(wall, diag/256.0));

    // ── Monte Carlo volume over the bounding box
    const double pad = 1e-6 * diag;
    const double lo[3] = {bb[0]-pad, bb[1]-pad, bb[2]-pad};
    const double hi[3] = {bb[3]+pad, bb[4]+pad, bb[5]+pad};
    R.bbox_vol = (hi[0]-lo[0])*(hi[1]-lo[1])*(hi[2]-lo[2]);
    Rng rng(0xC0FFEEULL);
    long inSrc = 0, inRes = 0;
    for (long s = 0; s < nSamples; ++s) {
        const double px = lo[0] + (hi[0]-lo[0])*rng.u01();
        const double py = lo[1] + (hi[1]-lo[1])*rng.u01();
        const double pz = lo[2] + (hi[2]-lo[2])*rng.u01();
        if (!insideParity(all, rg, px, py, pz)) continue;
        ++inSrc;
        if (withinR(keep, tg, px, py, pz, wall)) ++inRes;   // d <= wall  => it is WALL
    }
    R.n_samples = nSamples; R.n_in_src = inSrc; R.n_in_res = inRes;
    const double pS = (double)inSrc / (double)nSamples;
    const double pR = (double)inRes / (double)nSamples;
    R.mc_src_vol = pS * R.bbox_vol;
    R.mc_res_vol = pR * R.bbox_vol;
    R.mc_cav_vol = R.mc_src_vol - R.mc_res_vol;
    R.mc_se = R.bbox_vol * std::sqrt(std::max(1e-18, pR*(1.0-pR)/(double)nSamples));

    // ── voxel topology of the source and of the cavity
    double h = wall / voxPerWall;
    for (;;) {
        const double n0 = std::ceil(dx/h)+2, n1 = std::ceil(dy/h)+2, n2 = std::ceil(dz/h)+2;
        if (n0*n1*n2 <= (double)voxCap) break;
        h *= 1.25;
        if (h > diag) break;
    }
    Vox src, cav;
    src.h = cav.h = h;
    src.nx = cav.nx = (int)std::ceil(dx/h)+2;
    src.ny = cav.ny = (int)std::ceil(dy/h)+2;
    src.nz = cav.nz = (int)std::ceil(dz/h)+2;
    for (int a=0;a<3;++a) { src.o[a] = bb[a] - h; cav.o[a] = bb[a] - h; }
    const size_t tot = (size_t)src.nx*src.ny*src.nz;
    if (tot > (size_t)voxCap) { R.ok = true; return R; }
    src.b.assign(tot, 0); cav.b.assign(tot, 0);
    // scanline rasterise along X at voxel centres
    // A SCANLINE RAY THAT LANDS EXACTLY ON A MESH EDGE COUNTS TWO CROSSINGS OR
    // NONE, and a box tessellated by midpoint splitting puts its vertices on
    // exactly the coordinates a regular voxel lattice samples: measured on the
    // K1 control that cost 18.5% of the voxels and reported 29 components for a
    // solid cube. The scanline is therefore offset inside its own voxel by an
    // irrational fraction of h, which moves every ray off the lattice while
    // keeping it inside the voxel it stands for.
    const double jy = 0.01732050807568877 * h;   // sqrt(3)/100
    const double jz = 0.00707106781186547 * h;   // sqrt(2)/200
    std::vector<double> xs;
    for (int j=0;j<src.ny;++j) for (int k=0;k<src.nz;++k) {
        const double py = src.o[1] + (j+0.5)*h + jy, pz = src.o[2] + (k+0.5)*h + jz;
        const int c = rg.cellOf(py, pz);
        if (c < 0) continue;
        xs.clear();
        for (int s = rg.start[c]; s < rg.start[c+1]; ++s) {
            const double d = rayHitX(all[rg.items[s]], src.o[0]-h, py, pz);
            if (d > 0.0) xs.push_back(src.o[0]-h + d);
        }
        if (xs.size() < 2) continue;
        std::sort(xs.begin(), xs.end());
        for (size_t q = 0; q + 1 < xs.size(); q += 2) {
            const double x0 = xs[q], x1 = xs[q+1];
            int i0 = (int)std::ceil((x0 - src.o[0])/h - 0.5);
            int i1 = (int)std::floor((x1 - src.o[0])/h - 0.5);
            i0 = std::max(0, i0); i1 = std::min(src.nx-1, i1);
            for (int i = i0; i <= i1; ++i) src.b[src.idx(i,j,k)] = 1;
        }
    }
    for (int i=0;i<src.nx;++i) for (int j=0;j<src.ny;++j) for (int k=0;k<src.nz;++k) {
        if (!src.b[src.idx(i,j,k)]) continue;
        const double px = src.o[0]+(i+0.5)*h, py = src.o[1]+(j+0.5)*h + jy, pz = src.o[2]+(k+0.5)*h + jz;
        if (!withinR(keep, tg, px, py, pz, wall)) cav.b[cav.idx(i,j,k)] = 1;
    }
    R.src_b = bettiOf(src);
    R.cav_b = bettiOf(cav);
    R.vox_h = h; R.vox_nx = src.nx; R.vox_ny = src.ny; R.vox_nz = src.nz;
    R.topo_done = true;
    R.ok = true;
    return R;
}

// ──────────────────────────────────────────────────────────────── controls
int selftest() {
    int bad = 0;
    auto say = [&](const char* what, bool ok) {
        std::fprintf(stderr, "  %-56s %s\n", what, ok ? "ok" : "FAIL");
        if (!ok) ++bad;
    };
    // K1. Box 20, top removed, t = 1. Closed form 8000 - 18*18*19 = 1844.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(20.,20.,20.).Shape();
        int np=0; const TopoDS_Face rm = largestPlanarFace(box, &np);
        Result r = measure(box, rm, 1.0, 400000, 3.0, 20000000);
        say("K1 measured", r.ok && r.err.empty());
        const double want = 8000.0 - 18.0*18.0*19.0;
        say("K1 MC source volume == 8000 (within 4 SE)", std::fabs(r.mc_src_vol - 8000.0) < 4*r.mc_se + 1.0);
        say("K1 MC hollow volume == 1844 (within 4 SE)", std::fabs(r.mc_res_vol - want) < 4*r.mc_se + 1.0);
        say("K1 source has 0 handles", r.topo_done && r.src_b.handles == 0);
        say("K1 cavity has 1 component", r.topo_done && r.cav_b.b0 == 1);
        say("K1 cavity has 0 handles", r.topo_done && r.cav_b.handles == 0);
    }
    // K2. A THROUGH HOLE must read as one handle, or the handle column is inert.
    {
        TopoDS_Shape plate = BRepPrimAPI_MakeBox(gp_Pnt(-20,-20,0), 40.,40.,10.).Shape();
        gp_Trsf t; t.SetTranslation(gp_Vec(0,0,-5));
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape();
        cyl = BRepBuilderAPI_Transform(cyl, t, Standard_True).Shape();
        TopoDS_Shape holed = BRepAlgoAPI_Cut(plate, cyl).Shape();
        int np=0; const TopoDS_Face rm = largestPlanarFace(holed, &np);
        Result r = measure(holed, rm, 1.0, 400000, 3.0, 20000000);
        say("K2 measured", r.ok && r.err.empty());
        say("K2 source with one through hole reads 1 handle", r.topo_done && r.src_b.handles == 1);
    }
    // K3. TWO HOLES THAT MERGE UNDER EROSION. Centres +-6, r=5, so the gap is 2;
    //     at t=2 the grown holes (r=7, centres +-6) overlap and the cavity loses a
    //     handle. THIS IS THE DIRECTION THE CORPUS QUESTION TURNS ON.
    {
        TopoDS_Shape plate = BRepPrimAPI_MakeBox(gp_Pnt(-25,-25,0), 50.,50.,14.).Shape();
        TopoDS_Shape cut = plate;
        for (double cx : {-6.0, 6.0}) {
            gp_Trsf t; t.SetTranslation(gp_Vec(cx,0,-5));
            TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 30.0).Shape();
            cyl = BRepBuilderAPI_Transform(cyl, t, Standard_True).Shape();
            cut = BRepAlgoAPI_Cut(cut, cyl).Shape();
        }
        int np=0; const TopoDS_Face rm = largestPlanarFace(cut, &np);
        Result r = measure(cut, rm, 2.0, 400000, 4.0, 40000000);
        say("K3 measured", r.ok && r.err.empty());
        say("K3 source with two through holes reads 2 handles", r.topo_done && r.src_b.handles == 2);
        say("K3 cavity LOSES a handle (holes merge)", r.topo_done && r.cav_b.handles < r.src_b.handles);
    }
    // K4. THE SAME PLATE WITH THE HOLES FAR APART MUST NOT LOSE A HANDLE.
    //     Without this the merge detector could simply always fire.
    {
        TopoDS_Shape plate = BRepPrimAPI_MakeBox(gp_Pnt(-25,-25,0), 50.,50.,14.).Shape();
        TopoDS_Shape cut = plate;
        for (double cx : {-14.0, 14.0}) {
            gp_Trsf t; t.SetTranslation(gp_Vec(cx,0,-5));
            TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 30.0).Shape();
            cyl = BRepBuilderAPI_Transform(cyl, t, Standard_True).Shape();
            cut = BRepAlgoAPI_Cut(cut, cyl).Shape();
        }
        int np=0; const TopoDS_Face rm = largestPlanarFace(cut, &np);
        Result r = measure(cut, rm, 2.0, 400000, 4.0, 40000000);
        say("K4 measured", r.ok && r.err.empty());
        say("K4 far-apart holes: source 2 handles", r.topo_done && r.src_b.handles == 2);
        say("K4 far-apart holes: cavity KEEPS both handles", r.topo_done && r.cav_b.handles == r.src_b.handles);
    }
    // K4b. A CYLINDER. Its circular edges carry ONE seam vertex each, so the
    //      VERTEX bounding box is a sliver and a sample box taken from it would
    //      miss most of the solid. The exact volume is pi*R^2*H.
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(10.0, 30.0).Shape();
        int np=0; const TopoDS_Face rm = largestPlanarFace(cyl, &np);
        Result r = measure(cyl, rm, 1.0, 400000, 3.0, 40000000);
        say("K4b cylinder measured", r.ok && r.err.empty());
        const double want = 3.14159265358979323846 * 100.0 * 30.0;
        say("K4b MC source volume == pi*R^2*H (within 4 SE)",
            std::fabs(r.mc_src_vol - want) < 4*r.mc_se + 1.0);
        // hollow: pi*(100*30 - 81*29) = pi*(3000-2349)
        const double wantH = 3.14159265358979323846 * (3000.0 - 81.0*29.0);
        say("K4b MC hollow volume == pi*(3000-81*29) (within 5 SE)",
            std::fabs(r.mc_res_vol - wantH) < 5*r.mc_se + 1.0);
    }

    // K5. A THIN PLATE. Its 200x200 faces are two triangles each; the distance
    //     grid needs them split into thousands, and splitting by midpoint makes
    //     slivers. This is the shape class on which an absolute parallel-ray
    //     epsilon lost 35.7% of the volume with a mesh whose AREA was right to
    //     0.2% -- an area check cannot see it, only a volume check can.
    {
        TopoDS_Shape plate = BRepPrimAPI_MakeBox(gp_Pnt(-100,-100,0), 200.,200.,3.).Shape();
        int np=0; const TopoDS_Face rm = largestPlanarFace(plate, &np);
        Result r = measure(plate, rm, 0.15, 400000, 3.0, 40000000);
        say("K5 thin plate measured", r.ok && r.err.empty());
        const bool areaOk = r.mesh_area > 0 && std::fabs(r.mesh_area - 2.0*(200*200) - 4.0*(200*3)) < 1e-6*80000.0;
        say("K5 tessellated area is exact", areaOk);
        say("K5 MC source volume == 120000 (within 4 SE)",
            std::fabs(r.mc_src_vol - 120000.0) < 4*r.mc_se + 1.0);
    }
    std::fprintf(stderr, bad ? "SELFTEST: %d FAILED\n" : "SELFTEST: all controls pass\n", bad);
    return bad ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
    std::string step, name;
    long nSamples = 300000, voxCap = 40000000;
    double voxPerWall = 3.0;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a.rfind("--name=",0)==0) name = a.substr(7);
        else if (a.rfind("--samples=",0)==0) nSamples = std::atol(a.c_str()+10);
        else if (a.rfind("--vox-per-wall=",0)==0) voxPerWall = std::atof(a.c_str()+15);
        else if (a.rfind("--vox-cap=",0)==0) voxCap = std::atol(a.c_str()+10);
        else if (a.rfind("--",0)!=0) step = a;
    }
    if (step.empty()) { std::fprintf(stderr, "usage: %s <part.step> [--name=N]\n", argv[0]); return 2; }
    if (name.empty()) {
        const size_t sl = step.find_last_of('/');
        name = (sl==std::string::npos)?step:step.substr(sl+1);
        const size_t d = name.find_last_of('.');
        if (d!=std::string::npos) name = name.substr(0,d);
    }
    TopoDS_Shape shape;
    {
        STEPControl_Reader rd; IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(step.c_str()); } catch (...) {}
        if (st != IFSelect_RetDone) { std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str()); return 1; }
    }
    double bb[6];
    if (!boundsOf(shape, bb)) { std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", name.c_str()); return 1; }
    const double dx=bb[3]-bb[0], dy=bb[4]-bb[1], dz=bb[5]-bb[2];
    const double minExt = std::min(dx,std::min(dy,dz));
    const double diag = std::sqrt(dx*dx+dy*dy+dz*dz);
    if (!(diag>0)) { std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", name.c_str()); return 1; }
    const bool flat = !(minExt > 1e-9*diag);
    const double wall = 0.05 * (flat ? diag*0.05 : minExt);
    TopTools_IndexedMapOfShape sm; TopExp::MapShapes(shape, TopAbs_SOLID, sm);
    int np = 0;
    const TopoDS_Face rm = largestPlanarFace(shape, &np);
    if (sm.Extent()==0 || rm.IsNull()) {
        std::printf("{\"part\":\"%s\",\"applicable\":0}\n", name.c_str()); return 0;
    }
    double exactVol = 0.0, exactArea = 0.0;
    { GProp_GProps g; try { BRepGProp::VolumeProperties(shape, g); exactVol = g.Mass(); } catch (...) {} }
    { GProp_GProps g; try { BRepGProp::SurfaceProperties(shape, g); exactArea = g.Mass(); } catch (...) {} }

    Result r = measure(shape, rm, wall, nSamples, voxPerWall, voxCap);
    if (!r.err.empty()) {
        std::printf("{\"part\":\"%s\",\"applicable\":1,\"error\":\"%s\"}\n", name.c_str(), r.err.c_str());
        return 0;
    }
    std::printf(
        "{\"part\":\"%s\",\"applicable\":1,\"wall\":%.17g,\"diag\":%.17g,"
        "\"exact_src_vol\":%.17g,\"mc_src_vol\":%.17g,\"mc_res_vol\":%.17g,"
        "\"mc_cav_vol\":%.17g,\"mc_se\":%.17g,\"bbox_vol\":%.17g,"
        "\"samples\":%ld,\"n_in_src\":%ld,\"n_in_res\":%ld,"
        "\"defl\":%.6g,\"ntri\":%ld,\"ntri_keep\":%ld,"
        "\"faces_total\":%d,\"faces_no_tri\":%d,\"mesh_area\":%.17g,\"exact_area\":%.17g,"
        "\"topo\":%d,\"vox_h\":%.6g,\"vox_dims\":[%ld,%ld,%ld],"
        "\"src_b0\":%ld,\"src_b2\":%ld,\"src_chi\":%ld,\"src_handles\":%ld,\"src_cells\":%ld,"
        "\"cav_b0\":%ld,\"cav_b2\":%ld,\"cav_chi\":%ld,\"cav_handles\":%ld,\"cav_cells\":%ld}\n",
        name.c_str(), wall, diag, exactVol, r.mc_src_vol, r.mc_res_vol, r.mc_cav_vol, r.mc_se,
        r.bbox_vol, r.n_samples, r.n_in_src, r.n_in_res, r.defl, r.ntri_all, r.ntri_keep,
        r.faces_total, r.faces_no_tri, r.mesh_area, exactArea,
        r.topo_done ? 1 : 0, r.vox_h, r.vox_nx, r.vox_ny, r.vox_nz,
        r.src_b.b0, r.src_b.b2, r.src_b.chi, r.src_b.handles, r.src_b.cells,
        r.cav_b.b0, r.cav_b.b2, r.cav_b.chi, r.cav_b.handles, r.cav_b.cells);
    return 0;
}
