// forge/native/brep/NativeVariableFillet.cpp — TKFillet-free VARIABLE-radius fillet.
// See NativeVariableFillet.hpp for the full specification and honest scope.
//
// This is the variable-radius sibling of NativeFilletChamfer.cpp (R3). It reuses
// R3's LOCAL-NEIGHBOURHOOD idiom UNCHANGED — retrim the two adjacent planar faces,
// clip the two end faces at the edge endpoints, re-use every other face verbatim,
// sew watertight (BRepBuilderAPI_Sewing + BRepLib::OrientClosedSolid +
// positive-volume reverse). The ONLY new geometry is the blend patch: instead of
// R3's constant Geom_CylindricalSurface it is an EXACT rational Geom_BSplineSurface
// (degree-2 rational arc x degree-1 edge) that sweeps the varying quarter(-ish) arc
// — the same exact surface FilletAnalytic::filletBoxEdgeVariable emits for the
// native-analytic box path, here on an OCCT TopoDS_Shape.
//
// No BRepFilletAPI / ChFi3d symbol is referenced, so this TU carries none of
// TKFillet's exclusive symbols. Every geometric primitive is built directly from a
// Geom_ analytic/spline surface (TKG3d) with BRepBuilderAPI / BRepTools
// (TKBRep/TKTopAlgo), gp_ (TKMath) and forge::occtlaw::Law (pure std).
//
// NOTE (de-dup follow-up): the neighbourhood helpers below are faithful copies of
// NativeFilletChamfer.cpp's file-local helpers so this TU builds independently
// (R3 keeps them in its own anonymous namespace). A future refactor may hoist the
// shared set into an internal header (forge/native/brep/detail/FilletNeighbourhood.hpp)
// that BOTH TUs include; it is deliberately NOT done here to avoid touching the
// frozen, verified constant-radius path in the same change.

#include "forge/native/brep/NativeVariableFillet.hpp"

#ifdef FORGE_NATIVE_BREP

#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <Geom_BSplineSurface.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopAbs.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAbs_CurveType.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepLib.hxx>
#include <Precision.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace forge {
namespace occtfillet {
namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double kTol = 1e-7;   // geometric coincidence tolerance (mm-ish)

Result defer(const std::string& why) {
    Result r; r.ok = false; r.reason = why; return r;
}

inline bool pntEq(const gp_Pnt& a, const gp_Pnt& b, double tol = kTol) {
    return a.Distance(b) <= tol;
}
inline gp_Pnt shift(const gp_Pnt& p, const gp_Dir& d, double s) {
    return gp_Pnt(p.X() + d.X() * s, p.Y() + d.Y() * s, p.Z() + d.Z() * s);
}

// Outward unit normal of a GEOMETRICALLY PLANAR face (orientation-corrected).
// false only if the face is genuinely curved.
//
// ★ Same correction as NativeFilletChamfer.cpp (see the long note there):
//   `GetType() == GeomAbs_Plane` is a REPRESENTATION test, not a planarity test.
//   The side faces of an EXTRUDE / PRISM body carry Geom_SurfaceOfLinearExtrusion
//   (MEASURED: RECT+EXTRUDE -> Plane x2 + SurfaceOfLinearExtrusion x4), which is a
//   plane, and which OCCT's own BRepFilletAPI blends. Refusing it drops the
//   capability rather than the library.
bool planarFaceNormal(const TopoDS_Face& f, gp_Pln& pln, gp_Dir& outN) {
    BRepAdaptor_Surface as(f);
    if (as.GetType() == GeomAbs_Plane) {
        pln = as.Plane();
        outN = pln.Axis().Direction();
    } else {
        const double u0 = as.FirstUParameter(), u1 = as.LastUParameter();
        const double v0 = as.FirstVParameter(), v1 = as.LastVParameter();
        if (!std::isfinite(u0) || !std::isfinite(u1) ||
            !std::isfinite(v0) || !std::isfinite(v1)) return false;
        if (!(u1 - u0 > 1e-12) || !(v1 - v0 > 1e-12)) return false;
        gp_Pnt P; gp_Vec dU, dV;
        as.D1(0.5 * (u0 + u1), 0.5 * (v0 + v1), P, dU, dV);
        const gp_Vec nv = dU.Crossed(dV);
        if (nv.Magnitude() <= 1e-7) return false;
        const gp_Dir N(nv);
        const gp_Vec Nv(N);
        for (int i = 0; i <= 4; ++i)
            for (int j = 0; j <= 4; ++j) {
                const gp_Pnt Q = as.Value(u0 + (u1 - u0) * i * 0.25,
                                          v0 + (v1 - v0) * j * 0.25);
                if (std::fabs(gp_Vec(P, Q).Dot(Nv)) > 1e-7) return false;   // curved
            }
        pln = gp_Pln(P, N);
        outN = N;
    }
    if (f.Orientation() == TopAbs_REVERSED) outN.Reverse();
    return true;
}

// Straight-edge endpoints + unit direction. false if the edge is not a line.
bool lineEdge(const TopoDS_Edge& e, gp_Pnt& p0, gp_Pnt& p1, gp_Dir& dir) {
    BRepAdaptor_Curve ac(e);
    if (ac.GetType() != GeomAbs_Line) return false;
    p0 = ac.Value(ac.FirstParameter());
    p1 = ac.Value(ac.LastParameter());
    const gp_Vec v(p0, p1);
    if (v.Magnitude() <= kTol) return false;
    dir = gp_Dir(v);
    return true;
}

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps sp;
    BRepGProp::SurfaceProperties(f, sp);
    return sp.CentreOfMass();
}

bool orderedOuterVertices(const TopoDS_Face& f,
                          std::vector<gp_Pnt>& pts, bool& allStraight) {
    pts.clear();
    allStraight = true;
    const TopoDS_Wire ow = BRepTools::OuterWire(f);
    if (ow.IsNull()) return false;
    for (BRepTools_WireExplorer ex(ow, f); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ac(ex.Current());
        if (ac.GetType() != GeomAbs_Line) allStraight = false;
        pts.push_back(BRep_Tool::Pnt(ex.CurrentVertex()));
    }
    return pts.size() >= 3;
}

std::vector<TopoDS_Wire> innerWires(const TopoDS_Face& f) {
    std::vector<TopoDS_Wire> inner;
    const TopoDS_Wire ow = BRepTools::OuterWire(f);
    for (TopoDS_Iterator it(f); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_WIRE) continue;
        const TopoDS_Wire w = TopoDS::Wire(it.Value());
        if (!w.IsSame(ow)) inner.push_back(w);
    }
    return inner;
}

gp_Vec ringNormal(const std::vector<gp_Pnt>& r) {
    gp_Vec n(0, 0, 0);
    const std::size_t m = r.size();
    for (std::size_t i = 0; i < m; ++i) {
        const gp_Pnt& a = r[i];
        const gp_Pnt& b = r[(i + 1) % m];
        n.SetX(n.X() + (a.Y() - b.Y()) * (a.Z() + b.Z()));
        n.SetY(n.Y() + (a.Z() - b.Z()) * (a.X() + b.X()));
        n.SetZ(n.Z() + (a.X() - b.X()) * (a.Y() + b.Y()));
    }
    return n;
}

TopoDS_Face planarFaceFromRing(std::vector<gp_Pnt> ring, const gp_Pln& pln,
                               const gp_Dir& outN,
                               const std::vector<TopoDS_Wire>& inner) {
    if (ring.size() < 3) return TopoDS_Face();
    if (ringNormal(ring).Dot(gp_Vec(outN)) < 0.0)
        std::reverse(ring.begin(), ring.end());
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& p : ring) poly.Add(p);
    poly.Close();
    if (!poly.IsDone()) return TopoDS_Face();
    gp_Pln facePln(pln.Location(), outN);
    BRepBuilderAPI_MakeFace mf(facePln, poly.Wire());
    if (!mf.IsDone()) return TopoDS_Face();
    for (const TopoDS_Wire& w : inner) mf.Add(w);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

TopoDS_Shape sewToSolid(const std::vector<TopoDS_Face>& faces) {
    BRepBuilderAPI_Sewing sew(1e-6);
    for (const TopoDS_Face& f : faces) {
        if (f.IsNull()) return TopoDS_Shape();
        sew.Add(f);
    }
    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) return TopoDS_Shape();
    TopoDS_Shell shell;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shell = TopoDS::Shell(sewn);
    } else {
        TopExp_Explorer ex(sewn, TopAbs_SHELL);
        if (ex.More()) shell = TopoDS::Shell(ex.Current());
    }
    if (shell.IsNull()) return TopoDS_Shape();
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

double solidVolume(const TopoDS_Shape& s) {
    GProp_GProps vp;
    BRepGProp::VolumeProperties(s, vp);
    return std::fabs(vp.Mass());
}

// ---- the two-adjacent-faces map for a selected edge (identical to R3) --------
struct EdgeContext {
    TopoDS_Face A, B;
    gp_Pln plnA, plnB;
    gp_Dir nA, nB;             // outward normals
    gp_Pnt P0, P1;             // edge endpoints
    gp_Dir e;                  // edge direction P0->P1
    double L = 0.0;            // edge length
    gp_Dir tA, tB;             // in-plane interior directions (perp e)
    double dihedral = 0.0;     // interior dihedral theta (rad)
    bool convex = false;
};

bool buildEdgeContext(const TopoDS_Shape& shape, const TopoDS_Edge& edge,
                      EdgeContext& c, std::string& why) {
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
    if (!efMap.Contains(edge)) { why = "edge not found in shape"; return false; }
    const TopTools_ListOfShape& fl = efMap.FindFromKey(edge);
    if (fl.Extent() != 2) { why = "edge is not shared by exactly two faces"; return false; }
    TopTools_ListIteratorOfListOfShape it(fl);
    c.A = TopoDS::Face(it.Value()); it.Next();
    c.B = TopoDS::Face(it.Value());

    if (!planarFaceNormal(c.A, c.plnA, c.nA)) { why = "adjacent face A is not planar"; return false; }
    if (!planarFaceNormal(c.B, c.plnB, c.nB)) { why = "adjacent face B is not planar"; return false; }
    if (!lineEdge(edge, c.P0, c.P1, c.e))     { why = "edge is not a straight line"; return false; }
    c.L = c.P0.Distance(c.P1);

    if (std::fabs(gp_Vec(c.nA).Dot(gp_Vec(c.e))) > 1e-6) { why = "face A normal not perp edge"; return false; }
    if (std::fabs(gp_Vec(c.nB).Dot(gp_Vec(c.e))) > 1e-6) { why = "face B normal not perp edge"; return false; }

    const gp_Pnt mid((c.P0.X() + c.P1.X()) * 0.5,
                     (c.P0.Y() + c.P1.Y()) * 0.5,
                     (c.P0.Z() + c.P1.Z()) * 0.5);
    gp_Vec tA = gp_Vec(c.nA).Crossed(gp_Vec(c.e));   // perp both -> lies in plane A
    gp_Vec tB = gp_Vec(c.nB).Crossed(gp_Vec(c.e));
    if (tA.Magnitude() <= kTol || tB.Magnitude() <= kTol) { why = "degenerate face frame"; return false; }
    tA.Normalize(); tB.Normalize();
    if (tA.Dot(gp_Vec(mid, faceCentroid(c.A))) < 0.0) tA.Reverse();
    if (tB.Dot(gp_Vec(mid, faceCentroid(c.B))) < 0.0) tB.Reverse();
    c.tA = gp_Dir(tA);
    c.tB = gp_Dir(tB);

    const double d = std::max(-1.0, std::min(1.0, tA.Dot(tB)));
    c.dihedral = std::acos(d);
    c.convex = (tA.Dot(gp_Vec(c.nB)) < 0.0);
    return true;
}

// Substitute the two edge-endpoint corners of an adjacent face's outer ring by the
// (per-end) setback points, rebuild the planar face (inner holes preserved). For a
// variable fillet s0 != s1, so the retrimmed face is a TRAPEZOID — the same helper
// as R3, which already moves each endpoint corner independently. (Identical to R3.)
TopoDS_Face retrimAdjacentFace(const EdgeContext& c, const TopoDS_Face& f,
                               const gp_Dir& outN, const gp_Pln& pln,
                               const gp_Pnt& s0, const gp_Pnt& s1) {
    std::vector<gp_Pnt> ring; bool straight = false;
    if (!orderedOuterVertices(f, ring, straight) || !straight) return TopoDS_Face();
    for (gp_Pnt& p : ring) {
        if      (pntEq(p, c.P0)) p = s0;
        else if (pntEq(p, c.P1)) p = s1;
    }
    return planarFaceFromRing(ring, pln, outN, innerWires(f));
}

// Choose the arc plane normal so the circle's positive sense from p1 to p2 runs the
// CORNER-SIDE minor arc (the material-rounding arc), robust to traversal. (R3.)
gp_Dir chooseArcNormal(const gp_Pnt& O, double R, const gp_Pnt& p1, const gp_Pnt& p2,
                       const gp_Pnt& corner, const gp_Dir& endN) {
    const gp_Vec cornerDir(O, corner);
    gp_Dir N = endN;
    for (int flip = 0; flip < 2; ++flip) {
        const gp_Dir xdir(gp_Vec(O, p1));
        const gp_Vec ydir = gp_Vec(N).Crossed(gp_Vec(xdir));
        const gp_Vec v2(O, p2);
        double a2 = std::atan2(v2.Dot(ydir), v2.Dot(gp_Vec(xdir)));
        if (a2 < 0.0) a2 += 2.0 * kPi;
        const double amid = 0.5 * a2;
        const gp_Vec mid = gp_Vec(xdir) * (R * std::cos(amid)) + ydir * (R * std::sin(amid));
        if (mid.Dot(cornerDir) > 0.0) return N;
        N.Reverse();
    }
    return endN;
}

// Fillet end face: clip the sharp corner with a CIRCULAR ARC (radius Rend, centre =
// axis piercing point Fend in the end plane) joining the two per-end setbacks.
// Built as an explicit wire (straight edges + one arc). (Identical to R3.)
TopoDS_Face clipEndFaceFillet(const TopoDS_Face& f, const gp_Pnt& corner,
                              const gp_Pnt& sA, const gp_Pnt& sB,
                              const gp_Pnt& arcCentre, double R,
                              const gp_Dir& endOutN) {
    gp_Pln pln; gp_Dir outN;
    if (!planarFaceNormal(f, pln, outN)) return TopoDS_Face();
    std::vector<gp_Pnt> ring; bool straight = false;
    if (!orderedOuterVertices(f, ring, straight) || !straight) return TopoDS_Face();
    const std::size_t n = ring.size();
    std::size_t k = n;
    for (std::size_t i = 0; i < n; ++i) if (pntEq(ring[i], corner)) { k = i; break; }
    if (k == n) return TopoDS_Face();
    const gp_Pnt& prev = ring[(k + n - 1) % n];
    const bool aFirst = prev.Distance(sA) <= prev.Distance(sB);
    const gp_Pnt p1 = aFirst ? sA : sB;
    const gp_Pnt p2 = aFirst ? sB : sA;
    std::vector<gp_Pnt> seq;
    for (std::size_t i = 0; i < n; ++i)
        if (i != k) seq.push_back(ring[i]); else { seq.push_back(p1); seq.push_back(p2); }
    if (ringNormal(seq).Dot(gp_Vec(outN)) < 0.0) std::reverse(seq.begin(), seq.end());
    BRepBuilderAPI_MakeWire mw;
    const std::size_t m = seq.size();
    for (std::size_t i = 0; i < m; ++i) {
        const gp_Pnt& a = seq[i];
        const gp_Pnt& b = seq[(i + 1) % m];
        TopoDS_Edge ed;
        const bool isArc = (pntEq(a, p1) && pntEq(b, p2)) || (pntEq(a, p2) && pntEq(b, p1));
        if (isArc) {
            const gp_Dir arcN = chooseArcNormal(arcCentre, R, a, b, corner, endOutN);
            gp_Ax2 arcAx(arcCentre, arcN, gp_Dir(gp_Vec(arcCentre, a)));
            gp_Circ circ(arcAx, R);
            BRepBuilderAPI_MakeEdge me(circ, a, b);
            if (!me.IsDone()) return TopoDS_Face();
            ed = me.Edge();
        } else {
            if (a.Distance(b) <= kTol) continue;
            BRepBuilderAPI_MakeEdge me(a, b);
            if (!me.IsDone()) return TopoDS_Face();
            ed = me.Edge();
        }
        mw.Add(ed);
    }
    if (!mw.IsDone()) return TopoDS_Face();
    gp_Pln facePln(pln.Location(), outN);
    BRepBuilderAPI_MakeFace mf(facePln, mw.Wire());
    if (!mf.IsDone()) return TopoDS_Face();
    for (const TopoDS_Wire& w : innerWires(f)) mf.Add(w);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

std::vector<TopoDS_Face> endFacesAt(const TopoDS_Shape& shape, const gp_Pnt& corner,
                                    const TopoDS_Face& A, const TopoDS_Face& B) {
    std::vector<TopoDS_Face> out;
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face f = TopoDS::Face(fe.Current());
        if (f.IsSame(A) || f.IsSame(B)) continue;
        for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next()) {
            if (pntEq(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())), corner)) { out.push_back(f); break; }
        }
    }
    return out;
}

// ============================ THE NEW GEOMETRY ================================
// The VARIABLE-radius blend patch: an EXACT rational Geom_BSplineSurface that
// sweeps the varying arc from the contact line on face A (u=0 rail SA0->SA1) to the
// contact line on face B (u=1 rail SB0->SB1), with the start arc (v=0) of radius R0
// about F0 and the end arc (v=1) of radius R1 about F1.
//
//   arc direction  (U, degree-2 rational Bezier):  the standard 3-pole quarter(-ish)
//     arc {SA, apex, SB}, apex = F + R*(nA+nB)/(1+nA.nB), middle weight cos(alpha/2)
//     = sqrt((1+nA.nB)/2), where alpha = acos(nA.nB) is the arc angle (= pi-theta).
//   edge direction (V, degree-1):  for a LINEAR radius law the three poles move
//     LINEARLY in u, so degree-1 (two pole rows at v=0,1) is EXACT.
//
// The two end poles are taken to be EXACTLY the retrim setbacks SA*/SB* (not
// F+R*n recomputed) so the blend rails coincide with the retrimmed faces' edges and
// the v=0/v=1 arcs coincide with the end-cap clip arcs -> watertight sew.
//
// NON-LINEAR laws (Law_S / general) are NOT built here: the caller gates them out
// (they need degree>1 in V). The exact S-law generalisation is degree-2 x degree-3:
// R(u) is a cubic, so each pole coordinate is a cubic in u and is representable by a
// clamped degree-3 Bezier row (4 pole rows) exactly; weights stay constant. That is
// the next increment; kept out of this TU so the linear-exact path stays simple.
TopoDS_Face variableBlendFace(const gp_Pnt& SA0, const gp_Pnt& SB0,
                              const gp_Pnt& F0, double R0,
                              const gp_Pnt& SA1, const gp_Pnt& SB1,
                              const gp_Pnt& F1, double R1,
                              const gp_Dir& nA, const gp_Dir& nB) {
    const double c = gp_Vec(nA).Dot(gp_Vec(nB));   // cos(alpha), alpha = arc angle
    const double denom = 1.0 + c;                  // = 1 + cos(alpha) = 2 cos^2(alpha/2)
    if (!(denom > 1e-9)) return TopoDS_Face();      // alpha -> pi (flat) : degenerate
    const double w = std::sqrt(0.5 * denom);        // cos(alpha/2) in (0,1]
    const gp_Vec m = gp_Vec(nA) + gp_Vec(nB);       // apex offset direction (unnormalised)
    const gp_Pnt apex0(F0.X() + R0 * m.X() / denom,
                       F0.Y() + R0 * m.Y() / denom,
                       F0.Z() + R0 * m.Z() / denom);
    const gp_Pnt apex1(F1.X() + R1 * m.X() / denom,
                       F1.Y() + R1 * m.Y() / denom,
                       F1.Z() + R1 * m.Z() / denom);

    TColgp_Array2OfPnt poles(1, 3, 1, 2);
    poles.SetValue(1, 1, SA0);   poles.SetValue(1, 2, SA1);   // U=0 rail on face A
    poles.SetValue(2, 1, apex0); poles.SetValue(2, 2, apex1); // U=mid apex
    poles.SetValue(3, 1, SB0);   poles.SetValue(3, 2, SB1);   // U=1 rail on face B

    TColStd_Array2OfReal wts(1, 3, 1, 2);
    wts.SetValue(1, 1, 1.0); wts.SetValue(1, 2, 1.0);
    wts.SetValue(2, 1, w);   wts.SetValue(2, 2, w);
    wts.SetValue(3, 1, 1.0); wts.SetValue(3, 2, 1.0);

    TColStd_Array1OfReal uk(1, 2); uk.SetValue(1, 0.0); uk.SetValue(2, 1.0);
    TColStd_Array1OfReal vk(1, 2); vk.SetValue(1, 0.0); vk.SetValue(2, 1.0);
    TColStd_Array1OfInteger um(1, 2); um.SetValue(1, 3); um.SetValue(2, 3);  // clamped deg-2
    TColStd_Array1OfInteger vm(1, 2); vm.SetValue(1, 2); vm.SetValue(2, 2);  // clamped deg-1

    Handle(Geom_BSplineSurface) surf =
        new Geom_BSplineSurface(poles, wts, uk, vk, um, vm, 2, 1);
    BRepBuilderAPI_MakeFace mf(surf, Precision::Confusion());
    if (!mf.IsDone()) return TopoDS_Face();
    TopoDS_Face face = mf.Face();
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// -------------------------- one-edge variable fillet -------------------------
Result variableFilletOneEdge(const TopoDS_Shape& shape, const VariableFilletSpec& spec) {
    EdgeContext c; std::string why;
    if (!buildEdgeContext(shape, spec.edge, c, why)) return defer(why);
    if (!c.convex) return defer("concave (reflex) edge — out of scope");

    // Radius law sampled at the two endpoints (u=0 at P0, u=1 at P1).
    const double R0 = spec.law.Value(0.0);
    const double R1 = spec.law.Value(1.0);
    if (!(R0 > 0.0) || !(R1 > 0.0)) return defer("non-positive fillet radius from law");

    // Linear-law gate (geometric, not by enum): only an AFFINE law makes the blend
    // exactly degree-1 in V. A non-linear law (Law_S / smooth) DEFERS to OCCT.
    const double Rmid = spec.law.Value(0.5);
    const double scaleR = std::max(1.0, std::max(R0, R1));
    if (std::fabs(Rmid - 0.5 * (R0 + R1)) > 1e-7 * scaleR)
        return defer("non-linear radius law — native blend is degree-1 (linear) only; OCCT fallback");

    // Per-end rolling-ball tangent setback s = R / tan(theta/2) (differs at each end).
    const double halfTan = std::tan(0.5 * c.dihedral);
    if (!(halfTan > 1e-9)) return defer("degenerate dihedral");
    const double s0 = R0 / halfTan, s1 = R1 / halfTan;
    const gp_Pnt SA0 = shift(c.P0, c.tA, s0), SA1 = shift(c.P1, c.tA, s1);
    const gp_Pnt SB0 = shift(c.P0, c.tB, s0), SB1 = shift(c.P1, c.tB, s1);
    // Ball centres (axis feet): step R inward (-nA) from the contact on A.
    const gp_Dir inA(gp_Vec(c.nA).Reversed());
    const gp_Dir inB(gp_Vec(c.nB).Reversed());
    const gp_Pnt F0 = shift(SA0, inA, R0);
    const gp_Pnt F1 = shift(SA1, inA, R1);
    // Rolling-ball consistency: the centre reached from face B must coincide.
    const gp_Pnt F0b = shift(SB0, inB, R0);
    const gp_Pnt F1b = shift(SB1, inB, R1);
    const double frameTol = 1e-6 * scaleR;
    if (F0.Distance(F0b) > frameTol || F1.Distance(F1b) > frameTol)
        return defer("planar pair not rolling-ball consistent (ball centre A != B)");

    std::vector<TopoDS_Face> faces;
    // Re-trimmed adjacent faces (now trapezoids: setback s0 at P0, s1 at P1).
    TopoDS_Face rA = retrimAdjacentFace(c, c.A, c.nA, c.plnA, SA0, SA1);
    TopoDS_Face rB = retrimAdjacentFace(c, c.B, c.nB, c.plnB, SB0, SB1);
    if (rA.IsNull() || rB.IsNull()) return defer("adjacent face has a non-straight outer boundary (or setback overflow)");
    faces.push_back(rA); faces.push_back(rB);

    // End faces: clip each corner with a circular arc of that end's radius/centre.
    for (int end = 0; end < 2; ++end) {
        const gp_Pnt corner = end == 0 ? c.P0 : c.P1;
        const gp_Pnt sA = end == 0 ? SA0 : SA1;
        const gp_Pnt sB = end == 0 ? SB0 : SB1;
        const gp_Pnt ctr = end == 0 ? F0  : F1;
        const double Rend = end == 0 ? R0 : R1;
        const std::vector<TopoDS_Face> ends = endFacesAt(shape, corner, c.A, c.B);
        if (ends.size() != 1) return defer("vertex is not a simple 3-face corner");
        gp_Pln epln; gp_Dir eOutN;
        if (!planarFaceNormal(ends[0], epln, eOutN)) return defer("end face not planar");
        TopoDS_Face clipped = clipEndFaceFillet(ends[0], corner, sA, sB, ctr, Rend, eOutN);
        if (clipped.IsNull()) return defer("end face is not a straight-boundary corner");
        faces.push_back(clipped);
    }

    // The variable-radius blend patch (exact rational NURBS sweep).
    TopoDS_Face blend = variableBlendFace(SA0, SB0, F0, R0, SA1, SB1, F1, R1, c.nA, c.nB);
    if (blend.IsNull()) return defer("variable blend surface build failed");
    faces.push_back(blend);

    // Every other face verbatim.
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face f = TopoDS::Face(fe.Current());
        if (f.IsSame(c.A) || f.IsSame(c.B)) continue;
        bool isEnd = false;
        for (int end = 0; end < 2 && !isEnd; ++end)
            for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next())
                if (pntEq(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())), end == 0 ? c.P0 : c.P1)) { isEnd = true; break; }
        if (!isEnd) faces.push_back(f);
    }

    const TopoDS_Shape sol = sewToSolid(faces);
    if (sol.IsNull()) return defer("sew produced no closed solid");
    // Self-check: a convex fillet removes material. For the orthogonal (theta=90)
    // case the exact removed prism is (1 - pi/4) * L * (R0^2 + R0*R1 + R1^2)/3
    // = (1 - pi/4) * INT_0^L R(t)^2 dt (same closed form as filletBoxEdgeVariable).
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (v0 > 0.0) {
        if (!(v1 < v0)) return defer("variable fillet did not remove material (orientation/geometry check failed)");
        if (std::fabs(c.dihedral - 0.5 * kPi) < 1e-3) {
            const double removed = (1.0 - kPi / 4.0) * c.L * (R0 * R0 + R0 * R1 + R1 * R1) / 3.0;
            if (removed > 0.0 && std::fabs((v0 - v1) - removed) / removed > 0.03)
                return defer("variable fillet volume disagrees with (1-pi/4)*L*(R0^2+R0R1+R1^2)/3 self-check");
        }
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = "native variable-radius rolling-ball fillet (linear law, planar-planar convex straight edge)";
    return r;
}

// Re-resolve a reference edge in a rebuilt shape by geometry (identical to R3), so a
// multi-edge request can be applied sequentially against the running shape.
//
// ★ Carries the SAME two corrections as NativeFilletChamfer.cpp::resolveEdge:
//   (1) TopExp_Explorer visits a shared edge ONCE PER ADJACENT FACE (measured: 24
//       visits for a box's 12 edges), so the old `nHit == 1` test could never
//       succeed and EVERY multi-edge request deferred at spec #2. Walk the UNIQUE
//       edge map.
//   (2) A neighbouring blend SHORTENS this edge, moving its midpoint; fall back to
//       the unique COLLINEAR, span-overlapping survivor.
TopoDS_Edge resolveEdge(const TopoDS_Shape& shape, const TopoDS_Edge& ref) {
    gp_Pnt rp0, rp1; gp_Dir rd;
    if (!lineEdge(ref, rp0, rp1, rd)) return TopoDS_Edge();
    const gp_Pnt rmid((rp0.X() + rp1.X()) * 0.5, (rp0.Y() + rp1.Y()) * 0.5, (rp0.Z() + rp1.Z()) * 0.5);
    const double refLen = rp0.Distance(rp1);

    TopTools_IndexedMapOfShape emap;
    TopExp::MapShapes(shape, TopAbs_EDGE, emap);

    TopoDS_Edge hit; int nHit = 0;
    for (int i = 1; i <= emap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(emap(i));
        gp_Pnt p0, p1; gp_Dir d;
        if (!lineEdge(e, p0, p1, d)) continue;
        const gp_Pnt mid((p0.X() + p1.X()) * 0.5, (p0.Y() + p1.Y()) * 0.5, (p0.Z() + p1.Z()) * 0.5);
        if (mid.Distance(rmid) <= 1e-6 &&
            std::fabs(std::fabs(gp_Vec(d).Dot(gp_Vec(rd))) - 1.0) <= 1e-6) { hit = e; ++nHit; }
    }
    if (nHit == 1) return hit;

    TopoDS_Edge best; double bestOv = 0.0; int nBest = 0;
    const gp_Vec rdv(rd);
    for (int i = 1; i <= emap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(emap(i));
        gp_Pnt p0, p1; gp_Dir d;
        if (!lineEdge(e, p0, p1, d)) continue;
        if (std::fabs(std::fabs(gp_Vec(d).Dot(rdv)) - 1.0) > 1e-6) continue;
        const gp_Vec v0(rp0, p0), v1(rp0, p1);
        const double t0 = v0.Dot(rdv), t1 = v1.Dot(rdv);
        if ((v0 - rdv * t0).Magnitude() > 1e-6) continue;
        if ((v1 - rdv * t1).Magnitude() > 1e-6) continue;
        const double lo = std::min(t0, t1), hi = std::max(t0, t1);
        const double ov = std::min(hi, refLen) - std::max(lo, 0.0);
        if (!(ov > 1e-9)) continue;
        if (ov > bestOv + 1e-9)      { bestOv = ov; best = e; nBest = 1; }
        else if (ov > bestOv - 1e-9) { ++nBest; }
    }
    return (nBest == 1) ? best : TopoDS_Edge();
}

}  // namespace

// ------------------------------- public API ----------------------------------
Result makeVariableFillet(const TopoDS_Shape& shape,
                          const std::vector<VariableFilletSpec>& specs) {
    if (shape.IsNull()) return defer("null shape");
    if (specs.empty())  return defer("no variable-fillet edges supplied");
    // Repeat requests for the SAME topological edge: the call sites address edges by
    // TopExp INDEX, and that stream visits a shared edge once per adjacent face, so a
    // selector delivers each edge twice. Applying it twice is fatal (the second pass
    // cannot re-resolve what the first consumed). FIRST spec wins.
    std::vector<VariableFilletSpec> uspecs;
    for (const VariableFilletSpec& s : specs) {
        if (s.edge.IsNull()) continue;
        bool dup = false;
        for (const VariableFilletSpec& u : uspecs) if (u.edge.IsSame(s.edge)) { dup = true; break; }
        if (!dup) uspecs.push_back(s);
    }
    if (uspecs.empty()) return defer("no variable-fillet edges supplied");
    TopoDS_Shape work = shape;
    try {
        for (std::size_t i = 0; i < uspecs.size(); ++i) {
            VariableFilletSpec s = uspecs[i];
            if (i > 0) {                      // re-resolve against the rebuilt shape
                s.edge = resolveEdge(work, uspecs[i].edge);
                if (s.edge.IsNull()) {
                    if (std::getenv("FORGE_FILLET_DEBUG"))
                        std::fprintf(stderr, "[occtvarfillet] deferred: could not re-resolve\n");
                    return defer("could not re-resolve a variable-fillet edge after a prior op");
                }
            }
            Result r = variableFilletOneEdge(work, s);
            if (!r.ok) {                      // honest deferral -> whole op defers
                if (std::getenv("FORGE_FILLET_DEBUG"))
                    std::fprintf(stderr, "[occtvarfillet] deferred: %s\n", r.reason.c_str());
                return r;
            }
            work = r.shape;
        }
    } catch (...) {
        Result e = defer("native variable fillet raised an OCCT exception");
        if (std::getenv("FORGE_FILLET_DEBUG"))
            std::fprintf(stderr, "[occtvarfillet] deferred: %s\n", e.reason.c_str());
        return e;
    }
    Result r; r.ok = true; r.shape = work;
    r.reason = "native variable-radius fillet (prismatic convex edges, linear law)";
    return r;
}

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
