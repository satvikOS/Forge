// forge/test/native_vs_occt_trimmed_face.cpp
//
// K1.2 TRIMMED-NURBS FACE — 1:1 A/B CROSS-ORACLE CERTIFICATION vs OCCT 7.9.3.
//
// This is the OCCT cross-oracle the in-house TrimmedFace (TrimmedFace.hpp/.cpp)
// must pass before K1.2 is considered certified. It is a STANDALONE C++20 program
// that LINKS OCCT (it is therefore deliberately NOT part of the pure-native gate,
// which forbids OCCT). It builds, for each test case, the SAME face geometry two
// ways — once with the forge native kernel and once with OCCT — and compares:
//
//   (c) POINT-IN-TRIM: forge::classifyPointInTrim  vs  BRepTopAdaptor_FClass2d
//       over a >=100x100 (u,v) grid across the knot domain. GATE: 0 off-band
//       in/out disagreements (nodes within 1e-6 param of any trim pcurve are
//       exempted as the ON band).
//   (d) AREA: forge::trimmedFaceArea(face).area  vs  BRepGProp::SurfaceProperties
//       GATE: planar-exact rel-err <= 1e-6 ; curved rel-err <= 1e-4.
//   (e) TESSELLATION HAUSDORFF: forge::tessellateTrimmedFace verts vs the
//       BRepMesh_IncrementalMesh triangulation verts, symmetric Hausdorff.
//       GATE: <= deflection.
//
// CASE 1: PLANAR Geom_BSplineSurface S(u,v)=(L u, L v, 0), degree-1 bilinear plane,
//         trimmed by an outer unit square + an inner circular hole — IDENTICAL
//         (L, r) construction to trimmed_face_test.cpp's makePlane / squareOuter /
//         circleHole helpers, so native + OCCT build the SAME face.
// CASE 2: CURVED quarter-cylinder Geom_BSplineSurface (rational degree-2 arc in U,
//         linear in V) trimmed by an ANGULAR WEDGE sub-rectangle in (u,v) —
//         mirrors trimmed_face_test.cpp's makeQuarterCylinder + subRectLoop.
//
// Build + run (manual line; OCCT via brew):
//   OCCT_INC=/opt/homebrew/opt/opencascade/include/opencascade
//   OCCT_LIB=/opt/homebrew/opt/opencascade/lib
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include -I $OCCT_INC -L $OCCT_LIB \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/TrimmedFace.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Nurbs.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsSurface.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/brep/Curve.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/geom/Geom.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/geom/Delaunay.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/src/native/Predicates.cpp \
//     /Users/account_clawteam1/archdisc-Mech/forge-kernel/test/native_vs_occt_trimmed_face.cpp \
//     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo -lTKBRep \
//     -lTKTopAlgo -lTKPrim -lTKMesh \
//     -o /tmp/native_vs_occt_trimmed_face && /tmp/native_vs_occt_trimmed_face

// ---- forge native ----------------------------------------------------------
#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsSurface.hpp"
#include "forge/native/brep/Curve.hpp"

// ---- OCCT ------------------------------------------------------------------
#include <Geom_BSplineSurface.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Ax2d.hxx>
#include <gp_Ax22d.hxx>
#include <gp_Circ2d.hxx>
#include <gp_Lin2d.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepLib.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <TopAbs_State.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopLoc_Location.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <IMeshTools_Parameters.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <Precision.hxx>

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>

using namespace forge::native::brep;

static constexpr double kPi  = 3.14159265358979323846;
static constexpr double k2Pi = 6.28318530717958647692;

static int   g_pass  = 0;
static int   g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

// ===========================================================================
// NATIVE-SIDE builders — IDENTICAL to trimmed_face_test.cpp.
// ===========================================================================

// Planar bilinear B-spline plane S(u,v)=(L u, L v, 0) over [0,1]^2 (degree 1).
static NurbsSurface makePlane(double L) {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = { { {0,0,0}, {0,L,0} }, { {L,0,0}, {L,L,0} } };
    s.weights = { {1,1}, {1,1} };
    s.knotsU = {0,0,1,1};
    s.knotsV = {0,0,1,1};
    return s;
}
static TrimLoop squareOuterLoop() {
    TrimLoop loop; loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({0,0},{1,0}));
    loop.segments.push_back(PCurve::makeLine2({1,0},{1,1}));
    loop.segments.push_back(PCurve::makeLine2({1,1},{0,1}));
    loop.segments.push_back(PCurve::makeLine2({0,1},{0,0}));
    return loop;
}
static TrimLoop circleHoleLoop(double cu, double cv, double rho) {
    TrimLoop loop; loop.isOuter = false;
    loop.segments.push_back(PCurve::makeCircle2({cu,cv}, rho, k2Pi, 0.0)); // CW
    return loop;
}
// Quarter-cylinder: rational deg-2 arc (R) in U, linear (Hc) in V.
static NurbsSurface makeQuarterCylinder(double R, double Hc) {
    NurbsSurface s;
    s.degreeU = 2; s.degreeV = 1;
    const double w = std::sqrt(2.0) / 2.0;
    s.control = {
        { {R,0,0}, {R,0,Hc} },
        { {R,R,0}, {R,R,Hc} },
        { {0,R,0}, {0,R,Hc} },
    };
    s.weights = { {1.0,1.0}, {w,w}, {1.0,1.0} };
    s.knotsU = {0,0,0,1,1,1};
    s.knotsV = {0,0,1,1};
    return s;
}
// Sub-rectangle [a,b]x[c,d] outer loop (the angular wedge in (u,v)).
static TrimLoop subRectLoop(double a, double b, double c, double d) {
    TrimLoop loop; loop.isOuter = true;
    loop.segments.push_back(PCurve::makeLine2({a,c},{b,c}));
    loop.segments.push_back(PCurve::makeLine2({b,c},{b,d}));
    loop.segments.push_back(PCurve::makeLine2({b,d},{a,d}));
    loop.segments.push_back(PCurve::makeLine2({a,d},{a,c}));
    return loop;
}

// ===========================================================================
// OCCT-SIDE: build the SAME Geom_BSplineSurface from a NurbsSurface.
//
// The native NurbsSurface stores control[i][j] with i over U, j over V; knot
// vectors are the FULL clamped vectors. OCCT's Geom_BSplineSurface wants poles
// indexed [1..nU][1..nV] plus DISTINCT knots + multiplicities. The clamped
// vectors here are simple ({0,0,..,1,1} -> knots {0,1} with mult {p+1,p+1}).
// ===========================================================================
static Handle(Geom_BSplineSurface) occtSurface(const NurbsSurface& s) {
    const int nU = (int)s.control.size();
    const int nV = (int)s.control[0].size();

    TColgp_Array2OfPnt poles(1, nU, 1, nV);
    TColStd_Array2OfReal wts(1, nU, 1, nV);
    for (int i = 0; i < nU; ++i)
        for (int j = 0; j < nV; ++j) {
            poles.SetValue(i + 1, j + 1,
                gp_Pnt(s.control[i][j].x, s.control[i][j].y, s.control[i][j].z));
            wts.SetValue(i + 1, j + 1, s.weights[i][j]);
        }

    // Compress a clamped full knot vector into (distinct knots, multiplicities).
    auto compress = [](const std::vector<double>& kv,
                       std::vector<double>& uk, std::vector<int>& um) {
        for (double k : kv) {
            if (!uk.empty() && std::fabs(uk.back() - k) < 1e-12) um.back()++;
            else { uk.push_back(k); um.push_back(1); }
        }
    };
    std::vector<double> ukU, ukV; std::vector<int> umU, umV;
    compress(s.knotsU, ukU, umU);
    compress(s.knotsV, ukV, umV);

    TColStd_Array1OfReal    uknots(1, (int)ukU.size());
    TColStd_Array1OfInteger umult (1, (int)umU.size());
    for (int i = 0; i < (int)ukU.size(); ++i) { uknots.SetValue(i+1, ukU[i]); umult.SetValue(i+1, umU[i]); }
    TColStd_Array1OfReal    vknots(1, (int)ukV.size());
    TColStd_Array1OfInteger vmult (1, (int)umV.size());
    for (int j = 0; j < (int)ukV.size(); ++j) { vknots.SetValue(j+1, ukV[j]); vmult.SetValue(j+1, umV[j]); }

    return new Geom_BSplineSurface(poles, wts, uknots, vknots, umult, vmult,
                                   (int)s.degreeU, (int)s.degreeV);
}

// Build a TopoDS_Edge from a forge PCurve as a Geom2d pcurve ON the surface,
// PRESERVING the loop's traversal sense (so the wire winds exactly the way the
// forge loop is given — this is what makes OCCT's material side agree with the
// native even-odd region).
static TopoDS_Edge occtEdge(const PCurve& pc, const Handle(Geom_Surface)& surf) {
    if (pc.kind == GeomPCurveKind::Line2) {
        UVCoord a = pc.evaluate(pc.t0), b = pc.evaluate(pc.t1);
        gp_Pnt2d pa(a.u, a.v), pb(b.u, b.v);
        gp_Vec2d dir(pb.X() - pa.X(), pb.Y() - pa.Y());
        const double len = dir.Magnitude();
        Handle(Geom2d_Line) line = new Geom2d_Line(pa, gp_Dir2d(dir));
        BRepBuilderAPI_MakeEdge me(line, surf, 0.0, len);
        return me.Edge();
    } else { // Circle2
        gp_Pnt2d c(pc.centre.u, pc.centre.v);
        // A gp_Circ2d with +X / +Y frame parameterises as (cos t, sin t) — the
        // SAME as forge's Circle2 — and has +sense (CCW) in (u,v). The forge loop
        // may be traversed CW (t0=2pi, t1=0). We build the edge on the increasing
        // canonical range [0,2pi] and reverse it iff the forge sense is CW, so the
        // edge's traversal direction matches the forge loop exactly.
        gp_Ax22d ax(c, gp_Dir2d(1, 0), gp_Dir2d(0, 1));
        gp_Circ2d circ(ax, pc.r);
        Handle(Geom2d_Circle) gc = new Geom2d_Circle(circ);
        double p1 = std::min(pc.t0, pc.t1), p2 = std::max(pc.t0, pc.t1);
        BRepBuilderAPI_MakeEdge me(gc, surf, p1, p2);
        TopoDS_Edge e = me.Edge();
        const bool forgeCW = (pc.t1 < pc.t0);  // forge traversal decreasing => CW
        if (forgeCW) e.Reverse();
        return e;
    }
}

// Signed area enclosed by a loop in (u,v) (shoelace on a dense flatten), >0 CCW.
static double loopSignedAreaUV(const TrimLoop& loop) {
    std::vector<UVCoord> ring;
    for (const auto& pc : loop.segments) {
        const int N = 256;
        for (int i = 0; i < N; ++i) {
            double t = pc.t0 + (pc.t1 - pc.t0) * (double(i)/N);
            ring.push_back(pc.evaluate(t));
        }
    }
    double a = 0.0;
    const int n = (int)ring.size();
    for (int i = 0; i < n; ++i) {
        const UVCoord& p = ring[i];
        const UVCoord& q = ring[(i+1)%n];
        a += p.u * q.v - q.u * p.v;
    }
    return 0.5 * a;
}

static TopoDS_Wire occtWire(const TrimLoop& loop, const Handle(Geom_Surface)& surf) {
    BRepBuilderAPI_MakeWire mw;
    for (const auto& pc : loop.segments) mw.Add(occtEdge(pc, surf));
    return mw.Wire();
}

// Build the full OCCT trimmed face: surface + outer wire + hole wires.
// Material convention (matching native even-odd): the OUTER loop is forced CCW in
// (u,v) (material on its left) and each HOLE loop is forced CW (material on its
// left as a hole boundary). Wires whose given sense is wrong are reversed so the
// resulting face's material region is exactly outer_minus_holes.
static TopoDS_Face occtFace(const NurbsSurface& nsurf,
                            const std::vector<TrimLoop>& loops) {
    Handle(Geom_Surface) surf = occtSurface(nsurf);
    int outer = -1;
    for (int i = 0; i < (int)loops.size(); ++i) if (loops[i].isOuter) { outer = i; break; }
    if (outer < 0) outer = 0;

    // Outer wire: force CCW (signed area > 0).
    TopoDS_Wire ow = occtWire(loops[outer], surf);
    if (loopSignedAreaUV(loops[outer]) < 0.0) ow.Reverse();

    BRepBuilderAPI_MakeFace mf(surf, ow, /*Inside=*/Standard_False);
    for (int i = 0; i < (int)loops.size(); ++i) {
        if (i == outer) continue;
        TopoDS_Wire hw = occtWire(loops[i], surf);
        // Hole wire: force CW (signed area < 0) so it subtracts material.
        if (loopSignedAreaUV(loops[i]) > 0.0) hw.Reverse();
        mf.Add(hw);
    }
    TopoDS_Face f = mf.Face();
    // Give the pcurve edges 3D curves (needed for meshing + area properties).
    BRepLib::BuildCurves3d(f);
    return f;
}

// ===========================================================================
// (c) POINT-IN-TRIM A/B over a regular grid.
// ===========================================================================
// Distance (param) from (u,v) to the nearest point of any flattened trim pcurve,
// so we can exempt the ON band. We flatten each pcurve densely and take the min
// point-to-segment distance.
static double distToTrim(const std::vector<TrimLoop>& loops, double u, double v) {
    double best = std::numeric_limits<double>::max();
    auto segd = [&](double ax, double ay, double bx, double by) {
        double dx = bx - ax, dy = by - ay, l2 = dx*dx + dy*dy;
        double t = (l2 > 0) ? ((u-ax)*dx + (v-ay)*dy)/l2 : 0.0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        double px = ax + t*dx, py = ay + t*dy;
        return std::hypot(u - px, v - py);
    };
    for (const auto& loop : loops) {
        for (const auto& pc : loop.segments) {
            const int N = 400;
            UVCoord prev = pc.evaluate(pc.t0);
            for (int i = 1; i <= N; ++i) {
                double t = pc.t0 + (pc.t1 - pc.t0) * (double(i)/N);
                UVCoord cur = pc.evaluate(t);
                best = std::min(best, segd(prev.u, prev.v, cur.u, cur.v));
                prev = cur;
            }
        }
    }
    return best;
}

static void pointInTrimAB(const TrimmedFace& nf, const TopoDS_Face& of,
                          double u0, double u1, double v0, double v1,
                          int grid, const std::string& tag,
                          int& offBandDisagree, int& onBand, int& tested) {
    BRepTopAdaptor_FClass2d fclass(of, Precision::PConfusion());
    const double onBandParam = 1e-6;
    offBandDisagree = 0; onBand = 0; tested = 0;
    for (int i = 0; i <= grid; ++i) {
        for (int j = 0; j <= grid; ++j) {
            double u = u0 + (u1 - u0) * (double(i)/grid);
            double v = v0 + (v1 - v0) * (double(j)/grid);

            // Native classification -> IN/OUT/ON.
            TrimClass nc = classifyPointInTrim(nf, {u, v}, 1e-9);

            // OCCT classification.
            TopAbs_State st = fclass.Perform(gp_Pnt2d(u, v));
            bool occtIn  = (st == TopAbs_IN);
            bool occtOut = (st == TopAbs_OUT);
            bool occtOn  = (st == TopAbs_ON);

            // ON-band exemption: skip nodes within onBandParam of any trim pcurve,
            // or where either oracle says ON.
            double d = distToTrim(nf.loops, u, v);
            if (d <= onBandParam || nc == TrimClass::On || occtOn) { ++onBand; continue; }

            ++tested;
            bool nativeIn = (nc == TrimClass::Inside);
            // Compare IN vs OUT only (both oracles definitive here).
            if (nativeIn != occtIn) {
                ++offBandDisagree;
                if (offBandDisagree <= 8)
                    std::printf("       [%s] DISAGREE @ (%.5f,%.5f): native=%s occt=%s d=%.2e\n",
                        tag.c_str(), u, v, nativeIn?"IN":"OUT",
                        occtIn?"IN":(occtOut?"OUT":"ON"), d);
            }
        }
    }
}

// ===========================================================================
// (e) symmetric Hausdorff between the two TRIANGULATIONS.
//
// The fidelity metric is each mesh's vertices' distance to the OTHER mesh's
// SURFACE (nearest point on any triangle), not nearest vertex — a flat OCCT
// triangle needs no interior nodes, so a vertex-to-vertex distance would falsely
// report ~triangle/2 even when the two surfaces coincide. Symmetric Hausdorff =
// max over both directions of max-over-verts of point-to-triangle-set distance.
// ===========================================================================
struct Tri3 { Vec3 a, b, c; };

// Squared distance from point p to triangle (a,b,c) (Ericson / closest-point).
static double pointTriDist2(const Vec3& p, const Vec3& a, const Vec3& b, const Vec3& c) {
    auto sub = [](const Vec3& u, const Vec3& v){ return Vec3{u.x-v.x,u.y-v.y,u.z-v.z}; };
    auto dot = [](const Vec3& u, const Vec3& v){ return u.x*v.x+u.y*v.y+u.z*v.z; };
    Vec3 ab = sub(b,a), ac = sub(c,a), ap = sub(p,a);
    double d1 = dot(ab,ap), d2 = dot(ac,ap);
    if (d1 <= 0 && d2 <= 0) { Vec3 d = sub(p,a); return dot(d,d); }
    Vec3 bp = sub(p,b);
    double d3 = dot(ab,bp), d4 = dot(ac,bp);
    if (d3 >= 0 && d4 <= d3) { Vec3 d = sub(p,b); return dot(d,d); }
    double vc = d1*d4 - d3*d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        double v = d1/(d1-d3);
        Vec3 q{a.x+v*ab.x, a.y+v*ab.y, a.z+v*ab.z}; Vec3 d = sub(p,q); return dot(d,d);
    }
    Vec3 cp = sub(p,c);
    double d5 = dot(ab,cp), d6 = dot(ac,cp);
    if (d6 >= 0 && d5 <= d6) { Vec3 d = sub(p,c); return dot(d,d); }
    double vb = d5*d2 - d1*d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        double w = d2/(d2-d6);
        Vec3 q{a.x+w*ac.x, a.y+w*ac.y, a.z+w*ac.z}; Vec3 d = sub(p,q); return dot(d,d);
    }
    double va = d3*d6 - d5*d4;
    if (va <= 0 && (d4-d3) >= 0 && (d5-d6) >= 0) {
        double w = (d4-d3)/((d4-d3)+(d5-d6));
        Vec3 q{b.x+w*(c.x-b.x), b.y+w*(c.y-b.y), b.z+w*(c.z-b.z)};
        Vec3 d = sub(p,q); return dot(d,d);
    }
    double denom = 1.0/(va+vb+vc);
    double v = vb*denom, w = vc*denom;
    Vec3 q{a.x+ab.x*v+ac.x*w, a.y+ab.y*v+ac.y*w, a.z+ab.z*v+ac.z*w};
    Vec3 d = sub(p,q); return dot(d,d);
}

static double hausdorffMesh(const std::vector<Vec3>& AV, const std::vector<Tri3>& AT,
                            const std::vector<Vec3>& BV, const std::vector<Tri3>& BT) {
    auto oneSided = [](const std::vector<Vec3>& V, const std::vector<Tri3>& T) {
        double maxmin = 0.0;
        for (const auto& p : V) {
            double mind = std::numeric_limits<double>::max();
            for (const auto& t : T) {
                double d2 = pointTriDist2(p, t.a, t.b, t.c);
                if (d2 < mind) mind = d2;
            }
            maxmin = std::max(maxmin, std::sqrt(mind));
        }
        return maxmin;
    };
    // Each set's verts measured against the other set's TRIANGLES.
    return std::max(oneSided(AV, BT), oneSided(BV, AT));
}

static std::vector<Vec3> occtMeshVerts(const TopoDS_Face& f, double deflection,
                                       std::vector<Tri3>* tris) {
    // Mesh at the SAME chord deflection as the native tessellation tolerance, with
    // a tight angular deflection and small min-size so the OCCT mesh is dense
    // enough that the Hausdorff measures GEOMETRIC agreement, not mesh sparsity.
    IMeshTools_Parameters params;
    params.Deflection = deflection;
    params.Angle      = 0.1;           // ~5.7 deg — fine curved sampling
    params.MinSize    = deflection * 0.05;
    params.Relative   = Standard_False;
    params.InParallel = Standard_False;
    BRepMesh_IncrementalMesh mesher(f, params);
    mesher.Perform();
    std::vector<Vec3> out;
    if (tris) tris->clear();
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(f, loc);
    if (tri.IsNull()) return out;
    const gp_Trsf& trsf = loc.Transformation();
    std::vector<Vec3> nodes(tri->NbNodes());
    for (int i = 1; i <= tri->NbNodes(); ++i) {
        gp_Pnt p = tri->Node(i);
        p.Transform(trsf);
        nodes[i-1] = Vec3{p.X(), p.Y(), p.Z()};
        out.push_back(nodes[i-1]);
    }
    if (tris) {
        for (int i = 1; i <= tri->NbTriangles(); ++i) {
            int n1, n2, n3;
            tri->Triangle(i).Get(n1, n2, n3);
            tris->push_back(Tri3{nodes[n1-1], nodes[n2-1], nodes[n3-1]});
        }
    }
    return out;
}

// ===========================================================================
// Run one case end-to-end.
// ===========================================================================
struct CaseResult {
    std::string name;
    int    grid = 0, offBand = 0, onBand = 0, tested = 0;
    double areaNative = 0, areaOCCT = 0, areaRel = 0;
    double deflection = 0, haus = 0;
    bool   planar = false;
    bool   pass = true;
};

static CaseResult runCase(const std::string& name,
                          const NurbsSurface& nsurf,
                          const std::vector<TrimLoop>& loops,
                          double u0, double u1, double v0, double v1,
                          bool planar, double deflection) {
    CaseResult R; R.name = name; R.planar = planar; R.deflection = deflection;
    std::printf("\n=== CASE: %s ===\n", name.c_str());

    TrimmedFace nf; nf.surface = nsurf; nf.loops = loops;
    const char* vr = nullptr;
    check(nf.valid(&vr), std::string("native face valid (") + (vr ? vr : "") + ")");

    TopoDS_Face of = occtFace(nsurf, loops);
    check(!of.IsNull(), "OCCT face constructed");

    // (c) point-in-trim
    R.grid = 120;
    pointInTrimAB(nf, of, u0, u1, v0, v1, R.grid, name, R.offBand, R.onBand, R.tested);
    std::printf("   (c) point-in-trim: grid=%dx%d tested=%d on-band(exempt)=%d off-band-disagree=%d\n",
                R.grid+1, R.grid+1, R.tested, R.onBand, R.offBand);
    bool pcPass = (R.offBand == 0);
    check(pcPass, "point-in-trim: 0 off-band IN/OUT disagreements vs FClass2d");
    R.pass = R.pass && pcPass;

    // (d) area
    TrimmedMassProps mp = trimmedFaceArea(nf, /*quadRefine=*/4);
    check(mp.ok, "native area op ok");
    R.areaNative = mp.area;
    GProp_GProps g;
    BRepGProp::SurfaceProperties(of, g);
    R.areaOCCT = g.Mass();
    double absErr = std::fabs(R.areaNative - R.areaOCCT);
    R.areaRel = absErr / std::max(std::fabs(R.areaOCCT), 1e-300);
    std::printf("   (d) area: native=%.12f  occt=%.12f  abs=%.3e  rel=%.3e\n",
                R.areaNative, R.areaOCCT, absErr, R.areaRel);
    double areaTol = planar ? 1e-6 : 1e-4;
    bool areaPass = (R.areaRel <= areaTol);
    check(areaPass, std::string("area rel-err <= ") + (planar ? "1e-6 (planar)" : "1e-4 (curved)"));
    R.pass = R.pass && areaPass;

    // (e) tessellation Hausdorff
    TessellateOptions topt;
    topt.loopSamples = 128;
    topt.interiorGrid = 28;
    TrimMesh nm = tessellateTrimmedFace(nf, topt);
    check(nm.ok && !nm.positions.empty(), std::string("native tessellation ok (") + nm.reason + ")");
    // Native triangles in 3D.
    std::vector<Tri3> nativeT;
    nativeT.reserve(nm.triangles.size());
    for (const auto& t : nm.triangles)
        nativeT.push_back(Tri3{nm.positions[t[0]], nm.positions[t[1]], nm.positions[t[2]]});
    // OCCT mesh verts + triangles.
    std::vector<Tri3> occtT;
    std::vector<Vec3> occtV = occtMeshVerts(of, deflection, &occtT);
    check(!occtV.empty() && !occtT.empty(), "OCCT BRepMesh produced a triangulation");
    R.haus = hausdorffMesh(nm.positions, nativeT, occtV, occtT);
    std::printf("   (e) Hausdorff(vert->tri): native_verts=%zu/tris=%zu  occt_verts=%zu/tris=%zu deflection=%.4f  haus=%.6f\n",
                nm.positions.size(), nativeT.size(), occtV.size(), occtT.size(), deflection, R.haus);
    bool hausPass = (R.haus <= deflection);
    check(hausPass, "symmetric Hausdorff <= deflection");
    R.pass = R.pass && hausPass;

    return R;
}

int main() {
    std::printf("=== K1.2 TRIMMED-NURBS FACE — NATIVE vs OCCT 7.9.3 CROSS-ORACLE ===\n");

    std::vector<CaseResult> results;

    // ---- CASE 1: planar plane, square outer + circular hole (L=3, rho=0.25). ----
    {
        const double L = 3.0, rho = 0.25;
        NurbsSurface s = makePlane(L);
        std::vector<TrimLoop> loops = { squareOuterLoop(), circleHoleLoop(0.5, 0.5, rho) };
        // Physical scale: domain is [0,1]^2; deflection in MODEL units. The face is
        // L x L; pick a chord deflection of L * 0.01.
        results.push_back(runCase(
            "planar square-with-circular-hole (L=3, rho=0.25)",
            s, loops, 0.0, 1.0, 0.0, 1.0, /*planar=*/true, /*deflection=*/L * 0.01));
    }

    // ---- CASE 2: curved quarter-cylinder, angular-wedge sub-rectangle. ----
    {
        const double R = 2.0, Hc = 5.0;
        NurbsSurface s = makeQuarterCylinder(R, Hc);
        // Angular wedge: u in [0.2,0.8] (a slice of the quarter sweep), full height.
        std::vector<TrimLoop> loops = { subRectLoop(0.2, 0.8, 0.0, 1.0) };
        results.push_back(runCase(
            "curved quarter-cylinder angular-wedge (R=2,Hc=5, u in [0.2,0.8])",
            s, loops, 0.0, 1.0, 0.0, 1.0, /*planar=*/false, /*deflection=*/R * 0.02));
    }

    std::printf("\n=== SUMMARY ===\n");
    bool allPass = true;
    for (const auto& r : results) {
        std::printf(" %-55s %s\n", r.name.c_str(), r.pass ? "PASS" : "FAIL");
        std::printf("    point-in-trim off-band disagree = %d (tested %d, on-band %d)\n",
                    r.offBand, r.tested, r.onBand);
        std::printf("    area native=%.10f occt=%.10f abs=%.3e rel=%.3e (%s)\n",
                    r.areaNative, r.areaOCCT, std::fabs(r.areaNative - r.areaOCCT),
                    r.areaRel, r.planar ? "planar<=1e-6" : "curved<=1e-4");
        std::printf("    Hausdorff = %.6f (deflection %.4f)\n", r.haus, r.deflection);
        allPass = allPass && r.pass;
    }
    std::printf("\n=== CHECKS: %d/%d passed ; VERDICT: %s ===\n",
                g_pass, g_total, (allPass && g_pass == g_total) ? "PASS" : "FAIL");
    return (allPass && g_pass == g_total) ? 0 : 1;
}
