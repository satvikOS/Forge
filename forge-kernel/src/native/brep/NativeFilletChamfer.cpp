// forge/native/brep/NativeFilletChamfer.cpp — TKFillet-free edge fillet / chamfer.
// See NativeFilletChamfer.hpp for the full specification and honest scope.
//
// Every geometric primitive here is built DIRECTLY from a Geom_ analytic surface
// (TKG3d) with BRepBuilderAPI / BRepTools (TKBRep/TKTopAlgo) and gp_ (TKMath) —
// NO BRepFilletAPI / ChFi3d symbol is referenced, so this TU carries none of the
// 11 exclusive TKFillet symbols. It mirrors OcctPrimBuilder.cpp's construction
// idiom (planar quad via MakePolygon+MakeFace, watertight sew via
// BRepBuilderAPI_Sewing + BRepLib::OrientClosedSolid + positive-volume reverse).
//
// GEOMETRY (one CONVEX straight edge P0->P1 shared by two PLANAR faces A,B):
//   nA,nB          outward unit normals of A,B (orientation-corrected).
//   e              unit edge direction (P0->P1).
//   tA = in-plane-A dir ⟂ e, pointing into A's interior (away from the edge);
//   tB = in-plane-B dir ⟂ e, pointing into B's interior.
//     For the orthogonal box edge tA == -nB and tB == -nA (matches ChamferAnalytic).
//   interior dihedral θ = acos(tA·tB).  Convex iff tA·nB < 0.
//   CHAMFER: setback SA = P + dA·tA on A, SB = P + dB·tB on B; the bevel is the
//     single plane through the SA-line and SB-line.  Removed cross-section =
//     ½·dA·dB·sin θ (== ½ dA dB for θ=90°).
//   FILLET (radius R): rolling-ball tangent distance s = R / tan(θ/2) (== R for
//     θ=90°); tangent lines SA = P + s·tA, SB = P + s·tB; cylinder axis parallel
//     to e through  axisPoint = SA + R·(-nA) ( == SB + R·(-nB) ), radius R; the
//     exposed patch spans the arc (π-θ) between the two tangent generators.
//   RE-TRIM: faces A,B move their two edge-endpoint corners to SA0/SA1 (SB0/SB1);
//     the two perpendicular END faces get their corner at P0/P1 clipped — by a
//     straight chord SA–SB (chamfer) or a circular arc SA→SB radius R centred at
//     the axis piercing point (fillet); a new bevel/cylinder patch closes the gap.
//   All other faces are re-used VERBATIM; the whole set is sewn watertight.

#include "forge/native/brep/NativeFilletChamfer.hpp"

#ifdef FORGE_NATIVE_BREP

#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Vec.hxx>
#include <gp_Pln.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
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
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
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
#include <map>
#include <utility>
#include <vector>

namespace forge {
namespace occtfillet {
namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double kTol = 1e-7;   // geometric coincidence tolerance (mm-ish)

Result defer(const std::string& why) {
    Result r; r.ok = false; r.reason = why; return r;
}

// The FT compiler's FILLET/CHAMFER ops swallow the kernel's exception text and
// report only "kernel declined at every radius", which hides WHICH predicate
// refused. FORGE_FILLET_DEBUG=1 prints the real reason to stderr. Silent by
// default — this is a diagnostic channel, not behaviour.
void debugDefer(const char* op, const std::string& why) {
    if (std::getenv("FORGE_FILLET_DEBUG"))
        std::fprintf(stderr, "[occtfillet] %s deferred: %s\n", op, why.c_str());
}

inline bool pntEq(const gp_Pnt& a, const gp_Pnt& b, double tol = kTol) {
    return a.Distance(b) <= tol;
}

// Outward unit normal of a GEOMETRICALLY PLANAR face (orientation-corrected).
// Returns false if the face is genuinely curved.
//
// ★ MEASURED 2026-07-31: a `GeomAbs_Plane` test alone is NOT a planarity test, it
//   is a REPRESENTATION test, and it silently deleted capability. The side faces of
//   an EXTRUDE or a PRISM carry `Geom_SurfaceOfLinearExtrusion` — a straight edge
//   swept along a straight direction, i.e. a plane in every measurable sense, and
//   one OCCT's own BRepFilletAPI blends without complaint. Dumped types:
//     BOX(120,80,10)             -> Plane x6
//     RECT(120,80)+EXTRUDE(10)   -> Plane x2, SurfaceOfLinearExtrusion x4
//     PRISM(4,20,12)             -> Plane x2, SurfaceOfLinearExtrusion x4
//   That single line is why `FILLET(BOX...)` succeeded while the identical
//   `FILLET(RECT+EXTRUDE...)` — the ft_smoke plate — deferred with "adjacent face A
//   is not planar". Refusing it is exactly the Law 9 failure mode: dropping the
//   library by dropping the capability. So: keep the fast path for a true Geom_Plane
//   and otherwise VERIFY planarity by sampling, synthesising the gp_Pln from the
//   surface's own first derivatives (dU x dV, the same convention Geom_Plane uses,
//   so the REVERSED flip below stays correct). Anything genuinely curved still
//   returns false and the caller still defers.
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
        if (nv.Magnitude() <= kTol) return false;
        const gp_Dir N(nv);
        const gp_Vec Nv(N);
        for (int i = 0; i <= 4; ++i) {
            for (int j = 0; j <= 4; ++j) {
                const gp_Pnt Q = as.Value(u0 + (u1 - u0) * i * 0.25,
                                          v0 + (v1 - v0) * j * 0.25);
                if (std::fabs(gp_Vec(P, Q).Dot(Nv)) > 1e-7) return false;  // curved
            }
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

// Centroid of a face (surface centre of mass) — used to fix the sign of the
// in-plane "into the face interior" direction.
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps sp;
    BRepGProp::SurfaceProperties(f, sp);
    return sp.CentreOfMass();
}

// One edge of an outer boundary: its start vertex, and — when the edge is a
// circular arc — the circle it lies on.
//
// A ring of POINTS cannot describe an arc, which is why the retrim used to reject
// any face whose outer boundary was not entirely straight. That rejection is what
// blocked the TKFillet drop: makeFillet applies specs sequentially, so the FIRST
// filleted edge leaves a circular arc on each of its two adjacent faces, and every
// later edge then hit "adjacent face has a non-straight outer boundary". A ring of
// SEGMENTS carries the arc through, so the second edge is no longer poisoned by
// the first.
struct RingSeg {
    gp_Pnt  p;                 // start vertex of this segment
    bool    isArc = false;
    gp_Circ circ;              // valid when isArc
    bool    arcSense = true;   // edge orientation is FORWARD on the circle
    // A NEW corner-clip arc emitted by the blend (not read from the input face).
    // Rebuilt as the MINOR arc from this point to the next about `arcCtr`, so it is
    // immune to the ring-winding reversal below — the stored-circle path cannot be,
    // because reversing the ring swaps (a,b) and flips minor/major.
    bool    newArc = false;
    gp_Pnt  arcCtr;
    double  arcR = 0.0;
};

// Ordered outer boundary of a face as segments. `allStraight` still reports whether
// every edge is a line, for callers that genuinely need a polygon.
bool orderedOuterRing(const TopoDS_Face& f,
                      std::vector<RingSeg>& segs, bool& allStraight) {
    segs.clear();
    allStraight = true;
    const TopoDS_Wire ow = BRepTools::OuterWire(f);
    if (ow.IsNull()) return false;
    for (BRepTools_WireExplorer ex(ow, f); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ac(ex.Current());
        RingSeg sg;
        sg.p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (ac.GetType() == GeomAbs_Circle) {
            sg.isArc = true;
            sg.circ = ac.Circle();
            sg.arcSense = (ex.Current().Orientation() != TopAbs_REVERSED);
        } else if (ac.GetType() != GeomAbs_Line) {
            allStraight = false;   // ellipse/bspline: still not retrimmable
        }
        segs.push_back(sg);
    }
    return segs.size() >= 3;
}

// Point-only view, kept for callers that only need the corners.
bool orderedOuterVertices(const TopoDS_Face& f,
                          std::vector<gp_Pnt>& pts, bool& allStraight) {
    std::vector<RingSeg> segs;
    if (!orderedOuterRing(f, segs, allStraight)) return false;
    pts.clear();
    for (const RingSeg& sg : segs) pts.push_back(sg.p);
    return pts.size() >= 3;
}

// True when every segment is a line or a circular arc — i.e. this ring can be
// rebuilt exactly. Arcs are fine; anything else is not.
bool ringIsRebuildable(const std::vector<RingSeg>& segs, bool allStraight) {
    if (!allStraight) return false;          // an ellipse/bspline was seen
    return segs.size() >= 3;
}

// The inner (hole) wires of a face, preserved verbatim on re-trim.
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

// Newell area-normal of an ordered point ring (for CCW orientation vs a target).
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

// Build a planar face from an ordered outer ring (CCW-oriented to `outN`) plus
// any preserved inner wires. `pln` supplies the support plane. Returns a null
// face on failure (caller defers).
// Rebuild a planar face from a ring of SEGMENTS, preserving circular arcs.
// Straight segments become lines; arcs are rebuilt on their own circle through the
// (possibly moved) endpoints, so a retrim that does not touch an arc's ends
// reproduces it exactly.
TopoDS_Face planarFaceFromSegs(std::vector<RingSeg> segs, const gp_Pln& pln,
                               const gp_Dir& outN,
                               const std::vector<TopoDS_Wire>& inner) {
    const std::size_t n = segs.size();
    if (n < 3) return TopoDS_Face();

    std::vector<gp_Pnt> pts;
    pts.reserve(n);
    for (const RingSeg& sg : segs) pts.push_back(sg.p);
    if (ringNormal(pts).Dot(gp_Vec(outN)) < 0.0) {
        std::reverse(segs.begin(), segs.end());
        // after reversal each segment's curve now spans to the PREVIOUS point, so
        // rotate the curve data one step to keep (start -> next) pairing intact
        std::vector<RingSeg> r = segs;
        for (std::size_t i = 0; i < n; ++i) {
            r[i].p = segs[i].p;
            const RingSeg& src = segs[(i + 1) % n];
            r[i].isArc = src.isArc; r[i].circ = src.circ;
            r[i].arcSense = !src.arcSense;
            r[i].newArc = src.newArc; r[i].arcCtr = src.arcCtr; r[i].arcR = src.arcR;
        }
        segs.swap(r);
    }

    BRepBuilderAPI_MakeWire mw;
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = segs[i].p;
        const gp_Pnt& b = segs[(i + 1) % n].p;
        if (a.Distance(b) < 1e-9) continue;          // degenerate
        TopoDS_Edge e;
        if (segs[i].newArc) {
            // MINOR arc a -> b about arcCtr: derive the circle axis from the two
            // endpoints so the traversal direction (and any ring reversal) cannot
            // select the reflex complement.
            const gp_Vec va(segs[i].arcCtr, a), vb(segs[i].arcCtr, b);
            const gp_Vec nrm = va.Crossed(vb);
            if (nrm.Magnitude() > 1e-12) {
                const gp_Ax2 ax(segs[i].arcCtr, gp_Dir(nrm), gp_Dir(va));
                BRepBuilderAPI_MakeEdge me(gp_Circ(ax, segs[i].arcR), a, b);
                if (me.IsDone()) e = me.Edge();
            }
            if (e.IsNull()) return TopoDS_Face();
        }
        if (e.IsNull() && segs[i].isArc) {
            // Only reuse the arc when BOTH endpoints still lie on its circle —
            // a retrim that moved an end makes the old circle wrong, and a
            // silently wrong arc is worse than a chord.
            const double R = segs[i].circ.Radius();
            const gp_Pnt O = segs[i].circ.Location();
            const double da = std::fabs(O.Distance(a) - R);
            const double db = std::fabs(O.Distance(b) - R);
            if (da < 1e-6 && db < 1e-6) {
                BRepBuilderAPI_MakeEdge me(segs[i].circ, a, b);
                if (me.IsDone()) e = me.Edge();
            }
        }
        if (e.IsNull()) {
            BRepBuilderAPI_MakeEdge me(a, b);
            if (!me.IsDone()) return TopoDS_Face();
            e = me.Edge();
        }
        mw.Add(e);
    }
    if (!mw.IsDone()) return TopoDS_Face();

    gp_Pln facePln(pln.Location(), outN);
    BRepBuilderAPI_MakeFace mf(facePln, mw.Wire());
    if (!mf.IsDone()) return TopoDS_Face();
    for (const TopoDS_Wire& w : inner) mf.Add(w);
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
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

// Sew a mixed set of pristine + rebuilt faces into one closed outward solid.
// Returns a null shape if no closed shell forms (caller defers).
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

// ---- the two-adjacent-faces map for a selected edge --------------------------
struct EdgeContext {
    TopoDS_Face A, B;
    gp_Pln plnA, plnB;
    gp_Dir nA, nB;             // outward normals
    gp_Pnt P0, P1;             // edge endpoints
    gp_Dir e;                  // edge direction P0->P1
    double L = 0.0;            // edge length
    gp_Dir tA, tB;             // in-plane interior directions (⟂ e)
    double dihedral = 0.0;     // interior dihedral θ (rad)
    bool convex = false;
};

// Resolve the edge's two planar adjacent faces + the local frame. Returns a
// deferral reason (empty on success) in `why`.
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

    // A planar face containing the edge has its normal ⟂ e; require it (this is
    // what makes the end-plane section a circle and the setback lines edge-parallel).
    if (std::fabs(gp_Vec(c.nA).Dot(gp_Vec(c.e))) > 1e-6) { why = "face A normal not ⟂ edge"; return false; }
    if (std::fabs(gp_Vec(c.nB).Dot(gp_Vec(c.e))) > 1e-6) { why = "face B normal not ⟂ edge"; return false; }

    // In-plane interior direction on each face: ⟂ e, lying in the face, sign
    // fixed so it points from the edge toward that face's centroid.
    const gp_Pnt mid((c.P0.X() + c.P1.X()) * 0.5,
                     (c.P0.Y() + c.P1.Y()) * 0.5,
                     (c.P0.Z() + c.P1.Z()) * 0.5);
    gp_Vec tA = gp_Vec(c.nA).Crossed(gp_Vec(c.e));   // ⟂ both -> lies in plane A
    gp_Vec tB = gp_Vec(c.nB).Crossed(gp_Vec(c.e));
    if (tA.Magnitude() <= kTol || tB.Magnitude() <= kTol) { why = "degenerate face frame"; return false; }
    tA.Normalize(); tB.Normalize();
    if (tA.Dot(gp_Vec(mid, faceCentroid(c.A))) < 0.0) tA.Reverse();
    if (tB.Dot(gp_Vec(mid, faceCentroid(c.B))) < 0.0) tB.Reverse();
    c.tA = gp_Dir(tA);
    c.tB = gp_Dir(tB);

    // Convex iff face A's interior direction points to B's material side (tA·nB<0);
    // dihedral θ = acos(tA·tB).
    const double d = std::max(-1.0, std::min(1.0, tA.Dot(tB)));
    c.dihedral = std::acos(d);
    c.convex = (tA.Dot(gp_Vec(c.nB)) < 0.0);
    return true;
}

inline gp_Pnt shift(const gp_Pnt& p, const gp_Dir& d, double s) {
    return gp_Pnt(p.X() + d.X() * s, p.Y() + d.Y() * s, p.Z() + d.Z() * s);
}

// Substitute the two edge-endpoint corners of an adjacent face's outer ring by
// the setback points, rebuild the planar face (inner holes preserved).
TopoDS_Face retrimAdjacentFace(const EdgeContext& c, const TopoDS_Face& f,
                               const gp_Dir& outN, const gp_Pln& pln,
                               const gp_Pnt& s0, const gp_Pnt& s1) {
    std::vector<RingSeg> segs; bool straight = false;
    if (!orderedOuterRing(f, segs, straight) || !ringIsRebuildable(segs, straight))
        return TopoDS_Face();
    for (RingSeg& sg : segs) {
        if      (pntEq(sg.p, c.P0)) sg.p = s0;
        else if (pntEq(sg.p, c.P1)) sg.p = s1;
    }
    return planarFaceFromSegs(segs, pln, outN, innerWires(f));
}

// Chamfer end face: clip the corner at `corner` (== P0 or P1) — replace it in the
// ring by the two setback points (SA,SB) in the order that keeps the ring simple.
TopoDS_Face clipEndFaceChamfer(const TopoDS_Face& f, const gp_Pnt& corner,
                               const gp_Pnt& sA, const gp_Pnt& sB) {
    gp_Pln pln; gp_Dir outN;
    if (!planarFaceNormal(f, pln, outN)) return TopoDS_Face();
    std::vector<RingSeg> segs; bool straight = false;
    if (!orderedOuterRing(f, segs, straight) || !ringIsRebuildable(segs, straight))
        return TopoDS_Face();
    const std::size_t n = segs.size();
    std::size_t k = n;
    for (std::size_t i = 0; i < n; ++i) if (pntEq(segs[i].p, corner)) { k = i; break; }
    if (k == n) return TopoDS_Face();
    // Order the two setbacks so the one nearer the previous ring vertex comes first.
    const gp_Pnt& prev = segs[(k + n - 1) % n].p;
    const bool aFirst = prev.Distance(sA) <= prev.Distance(sB);
    std::vector<RingSeg> out;
    for (std::size_t i = 0; i < n; ++i) {
        if (i == k) {
            // the clipped corner becomes two straight setbacks; the chamfer face
            // between them is built separately
            RingSeg a; a.p = aFirst ? sA : sB;
            RingSeg b; b.p = aFirst ? sB : sA;
            b.isArc = segs[i].isArc; b.circ = segs[i].circ; b.arcSense = segs[i].arcSense;
            out.push_back(a); out.push_back(b);
        } else {
            out.push_back(segs[i]);
        }
    }
    return planarFaceFromSegs(out, pln, outN, innerWires(f));
}

// Choose the circle-axis normal (± the end-plane normal) so the arc traversed in
// the circle's positive sense from p1 to p2 is the CORNER-SIDE minor arc (the one
// that rounds the sharp corner off), not its reflex complement.
gp_Dir chooseArcNormal(const gp_Pnt& O, double R, const gp_Pnt& p1, const gp_Pnt& p2,
                       const gp_Pnt& corner, const gp_Dir& endN) {
    const gp_Vec cornerDir(O, corner);
    gp_Dir N = endN;
    for (int flip = 0; flip < 2; ++flip) {
        const gp_Dir xdir(gp_Vec(O, p1));
        const gp_Vec ydir = gp_Vec(N).Crossed(gp_Vec(xdir));   // unit (N⟂xdir)
        const gp_Vec v2(O, p2);
        double a2 = std::atan2(v2.Dot(ydir), v2.Dot(gp_Vec(xdir)));  // p2 angle from p1
        if (a2 < 0.0) a2 += 2.0 * kPi;                              // forward CCW sweep 0->a2
        const double amid = 0.5 * a2;
        const gp_Vec mid = gp_Vec(xdir) * (R * std::cos(amid)) + ydir * (R * std::sin(amid));
        if (mid.Dot(cornerDir) > 0.0) return N;                    // midpoint on the corner side
        N.Reverse();
    }
    return endN;   // fallback (shouldn't hit); the volume self-check backstops errors
}

// Fillet end face: same corner clip, but the two setbacks are joined by a
// CIRCULAR ARC (radius R, centre = axis piercing point in the end plane) instead
// of a straight chord. Built as an explicit wire (straight edges + one arc).
TopoDS_Face clipEndFaceFillet(const TopoDS_Face& f, const gp_Pnt& corner,
                              const gp_Pnt& sA, const gp_Pnt& sB,
                              const gp_Pnt& arcCentre, double R,
                              const gp_Dir& endOutN) {
    gp_Pln pln; gp_Dir outN;
    if (!planarFaceNormal(f, pln, outN)) return TopoDS_Face();
    // Segments, not points: an end face that already carries a fillet arc from an
    // EARLIER edge must keep it. Rejecting it here is what made multi-edge fillets
    // fail after the first edge.
    std::vector<RingSeg> segs; bool straight = false;
    if (!orderedOuterRing(f, segs, straight) || !ringIsRebuildable(segs, straight))
        return TopoDS_Face();
    const std::size_t n = segs.size();
    std::size_t k = n;
    for (std::size_t i = 0; i < n; ++i) if (pntEq(segs[i].p, corner)) { k = i; break; }
    if (k == n) return TopoDS_Face();
    const gp_Pnt& prev = segs[(k + n - 1) % n].p;
    const bool aFirst = prev.Distance(sA) <= prev.Distance(sB);
    const gp_Pnt p1 = aFirst ? sA : sB;   // setback nearer the previous ring vertex
    const gp_Pnt p2 = aFirst ? sB : sA;   // setback nearer the next ring vertex
    // Clipped ring: replace the sharp corner by [p1, p2] (keeps the loop simple).
    // Pre-existing arcs travel with their start vertex.
    std::vector<RingSeg> segSeq;
    for (std::size_t i = 0; i < n; ++i) {
        if (i != k) { segSeq.push_back(segs[i]); }
        else {
            RingSeg a; a.p = p1;                       // the new fillet arc, added below
            RingSeg b; b.p = p2;
            b.isArc = segs[i].isArc; b.circ = segs[i].circ; b.arcSense = segs[i].arcSense;
            segSeq.push_back(a); segSeq.push_back(b);
        }
    }
    std::vector<gp_Pnt> seq;
    seq.reserve(segSeq.size());
    for (const RingSeg& sg : segSeq) seq.push_back(sg.p);
    // Orient the loop CCW wrt the OUTWARD normal so MakeFace bounds the FINITE side
    // (a REVERSED source face would otherwise wind CW -> the complementary region).
    // The arc is approximated by its chord for this winding-sign test.
    if (ringNormal(seq).Dot(gp_Vec(outN)) < 0.0) std::reverse(seq.begin(), seq.end());
    BRepBuilderAPI_MakeWire mw;
    const std::size_t m = seq.size();
    for (std::size_t i = 0; i < m; ++i) {
        const gp_Pnt& a = seq[i];
        const gp_Pnt& b = seq[(i + 1) % m];
        TopoDS_Edge ed;
        // The one consecutive {p1,p2} pair (either traversal order) becomes the arc.
        const bool isArc = (pntEq(a, p1) && pntEq(b, p2)) || (pntEq(a, p2) && pntEq(b, p1));
        if (isArc) {
            // Orient the circle so its positive sense runs a->b along the corner-side
            // (material-rounding) minor arc, robust to the traversal direction.
            const gp_Dir arcN = chooseArcNormal(arcCentre, R, a, b, corner, endOutN);
            gp_Ax2 arcAx(arcCentre, arcN, gp_Dir(gp_Vec(arcCentre, a)));
            gp_Circ circ(arcAx, R);
            BRepBuilderAPI_MakeEdge me(circ, a, b);
            if (!me.IsDone()) return TopoDS_Face();
            ed = me.Edge();
        } else {
            if (a.Distance(b) <= kTol) continue;
            // A segment that was ALREADY an arc (from an earlier filleted edge)
            // is reproduced on its own circle, provided both ends still lie on it.
            const RingSeg* src = nullptr;
            for (const RingSeg& sg : segSeq) if (pntEq(sg.p, a)) { src = &sg; break; }
            if (src && src->isArc) {
                const double R0 = src->circ.Radius();
                const gp_Pnt O0 = src->circ.Location();
                if (std::fabs(O0.Distance(a) - R0) < 1e-6 &&
                    std::fabs(O0.Distance(b) - R0) < 1e-6) {
                    BRepBuilderAPI_MakeEdge mea(src->circ, a, b);
                    if (mea.IsDone()) ed = mea.Edge();
                }
            }
            if (ed.IsNull()) {
                BRepBuilderAPI_MakeEdge me(a, b);
                if (!me.IsDone()) return TopoDS_Face();
                ed = me.Edge();
            }
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

// The flat bevel patch: planar quad SA0->SB0->SB1->SA1.
TopoDS_Face bevelQuad(const gp_Pnt& sA0, const gp_Pnt& sB0,
                      const gp_Pnt& sB1, const gp_Pnt& sA1) {
    BRepBuilderAPI_MakePolygon poly(sA0, sB0, sB1, sA1, Standard_True);
    if (!poly.IsDone()) return TopoDS_Face();
    BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);  // OnlyPlane
    if (!mf.IsDone()) return TopoDS_Face();
    return mf.Face();
}

// The cylindrical fillet patch: Geom_CylindricalSurface(axis ‖ e, radius R),
// trimmed to the arc (π-θ) between the two tangent generators over v∈[0,L].
TopoDS_Face filletCylinder(const gp_Pnt& axis0, const gp_Dir& e, double R,
                           const gp_Pnt& sA0, const gp_Pnt& sB0, double L) {
    const gp_Dir dA(gp_Vec(axis0, sA0));
    const gp_Dir dB(gp_Vec(axis0, sB0));
    const double ang = std::acos(std::max(-1.0, std::min(1.0, dA.Dot(dB))));  // π-θ
    if (!(ang > 1e-9)) return TopoDS_Face();
    // Pick the ref direction so a +CCW sweep (about e) of `ang` runs the SHORT arc.
    const bool aFirst = gp_Vec(dA).Crossed(gp_Vec(dB)).Dot(gp_Vec(e)) > 0.0;
    const gp_Dir ref = aFirst ? dA : dB;
    gp_Ax3 ax(axis0, e, ref);
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(ax, R);
    BRepBuilderAPI_MakeFace mf(cyl, 0.0, ang, 0.0, L, Precision::Confusion());
    if (!mf.IsDone()) return TopoDS_Face();
    TopoDS_Face face = mf.Face();
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// Faces touching a given endpoint that are NOT the two adjacent faces A,B.
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

// -------------------------- one-edge chamfer ---------------------------------
Result chamferOneEdge(const TopoDS_Shape& shape, const ChamferSpec& spec) {
    EdgeContext c; std::string why;
    if (!buildEdgeContext(shape, spec.edge, c, why)) return defer(why);
    if (!c.convex) return defer("concave (reflex) edge — out of scope");

    // Resolve which face gets dist vs dist2 (asymmetric via `contact`).
    double dA = spec.dist, dB = (spec.dist2 > Precision::Confusion()) ? spec.dist2 : spec.dist;
    if (spec.dist2 > Precision::Confusion() && !spec.contact.IsNull()) {
        if (spec.contact.IsSame(c.B)) { dA = spec.dist2; dB = spec.dist; }  // dist on `contact` (B)
        // else contact==A (or unknown): dA=dist on A, dB=dist2 — already set.
    }
    if (!(dA > 0.0) || !(dB > 0.0)) return defer("non-positive chamfer distance");

    // Setback corners.
    const gp_Pnt SA0 = shift(c.P0, c.tA, dA), SA1 = shift(c.P1, c.tA, dA);
    const gp_Pnt SB0 = shift(c.P0, c.tB, dB), SB1 = shift(c.P1, c.tB, dB);

    std::vector<TopoDS_Face> faces;
    // Re-trimmed adjacent faces.
    TopoDS_Face rA = retrimAdjacentFace(c, c.A, c.nA, c.plnA, SA0, SA1);
    TopoDS_Face rB = retrimAdjacentFace(c, c.B, c.nB, c.plnB, SB0, SB1);
    if (rA.IsNull() || rB.IsNull()) return defer("adjacent face has a non-straight outer boundary");
    faces.push_back(rA); faces.push_back(rB);

    // End faces at each endpoint (clip the corner with the straight bevel chord).
    for (int end = 0; end < 2; ++end) {
        const gp_Pnt corner = end == 0 ? c.P0 : c.P1;
        const gp_Pnt sA = end == 0 ? SA0 : SA1;
        const gp_Pnt sB = end == 0 ? SB0 : SB1;
        const std::vector<TopoDS_Face> ends = endFacesAt(shape, corner, c.A, c.B);
        if (ends.size() != 1) return defer("vertex is not a simple 3-face corner");
        TopoDS_Face clipped = clipEndFaceChamfer(ends[0], corner, sA, sB);
        if (clipped.IsNull()) return defer("end face is not a straight-boundary corner");
        faces.push_back(clipped);
    }

    // The bevel patch.
    TopoDS_Face bevel = bevelQuad(SA0, SB0, SB1, SA1);
    if (bevel.IsNull()) return defer("bevel face build failed");
    faces.push_back(bevel);

    // Every other face verbatim.
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face f = TopoDS::Face(fe.Current());
        if (f.IsSame(c.A) || f.IsSame(c.B)) continue;
        bool isEnd = false;
        for (int end = 0; end < 2 && !isEnd; ++end) {
            for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next())
                if (pntEq(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())), end == 0 ? c.P0 : c.P1)) { isEnd = true; break; }
        }
        if (!isEnd) faces.push_back(f);
    }

    const TopoDS_Shape sol = sewToSolid(faces);
    if (sol.IsNull()) return defer("sew produced no closed solid");
    // Self-check: chamfer removes ½·dA·dB·sinθ·L of material (exact for θ=90°).
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (v0 > 0.0) {
        if (!(v1 < v0)) return defer("chamfer did not remove material (orientation/geometry check failed)");
        const double removed = 0.5 * dA * dB * std::sin(c.dihedral) * c.L;
        if (removed > 0.0 && std::fabs((v0 - v1) - removed) / removed > 0.03)
            return defer("chamfer volume disagrees with ½·dA·dB·sinθ·L self-check");
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = "native flat-bevel chamfer (planar-planar convex straight edge)";
    return r;
}

// -------------------------- one-edge fillet ----------------------------------
Result filletOneEdge(const TopoDS_Shape& shape, const FilletSpec& spec) {
    EdgeContext c; std::string why;
    if (!buildEdgeContext(shape, spec.edge, c, why)) return defer(why);
    if (!c.convex) return defer("concave (reflex) edge — out of scope");
    const double R = spec.radius;
    if (!(R > 0.0)) return defer("non-positive fillet radius");

    // Rolling-ball tangent setback s = R / tan(θ/2).
    const double halfTan = std::tan(0.5 * c.dihedral);
    if (!(halfTan > 1e-9)) return defer("degenerate dihedral");
    const double s = R / halfTan;
    const gp_Pnt SA0 = shift(c.P0, c.tA, s), SA1 = shift(c.P1, c.tA, s);
    const gp_Pnt SB0 = shift(c.P0, c.tB, s), SB1 = shift(c.P1, c.tB, s);
    // Cylinder axis: from the tangent line on A, step R along the inward normal -nA.
    const gp_Dir inA(gp_Vec(c.nA).Reversed());
    const gp_Pnt axis0 = shift(SA0, inA, R);
    const gp_Pnt axis1 = shift(SA1, inA, R);

    std::vector<TopoDS_Face> faces;
    TopoDS_Face rA = retrimAdjacentFace(c, c.A, c.nA, c.plnA, SA0, SA1);
    TopoDS_Face rB = retrimAdjacentFace(c, c.B, c.nB, c.plnB, SB0, SB1);
    if (rA.IsNull() || rB.IsNull()) return defer("adjacent face has a non-straight outer boundary");
    faces.push_back(rA); faces.push_back(rB);

    // End faces: clip the corner with the circular arc (centre = axis piercing point).
    for (int end = 0; end < 2; ++end) {
        const gp_Pnt corner = end == 0 ? c.P0 : c.P1;
        const gp_Pnt sA = end == 0 ? SA0 : SA1;
        const gp_Pnt sB = end == 0 ? SB0 : SB1;
        const gp_Pnt ctr = end == 0 ? axis0 : axis1;
        const std::vector<TopoDS_Face> ends = endFacesAt(shape, corner, c.A, c.B);
        if (ends.size() != 1) return defer("vertex is not a simple 3-face corner");
        // End-face outward normal for the arc plane axis.
        gp_Pln epln; gp_Dir eOutN;
        if (!planarFaceNormal(ends[0], epln, eOutN)) return defer("end face not planar");
        TopoDS_Face clipped = clipEndFaceFillet(ends[0], corner, sA, sB, ctr, R, eOutN);
        if (clipped.IsNull()) return defer("end face is not a straight-boundary corner");
        faces.push_back(clipped);
    }

    // The cylindrical fillet patch.
    TopoDS_Face cyl = filletCylinder(axis0, c.e, R, SA0, SB0, c.L);
    if (cyl.IsNull()) return defer("cylinder patch build failed");
    faces.push_back(cyl);

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
    // Self-check: a convex fillet removes material; for θ=90° exactly (1-π/4)R²L.
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (v0 > 0.0) {
        if (!(v1 < v0)) return defer("fillet did not remove material (orientation/geometry check failed)");
        if (std::fabs(c.dihedral - 0.5 * kPi) < 1e-3) {
            const double removed = (1.0 - kPi / 4.0) * R * R * c.L;
            if (removed > 0.0 && std::fabs((v0 - v1) - removed) / removed > 0.03)
                return defer("fillet volume disagrees with (1-π/4)R²L self-check");
        }
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = "native rolling-ball fillet (planar-planar convex straight edge)";
    return r;
}

// Re-resolve a reference edge (from the original shape) in a rebuilt shape by
// geometry, so a multi-edge request can be applied sequentially. Returns a null
// edge if no unique match (caller defers).
//
// ★ MEASURED 2026-07-31 — this routine, not the retrim and not the corner blend,
//   was THE blocker on the whole TKFillet drop. Two independent defects:
//
//   (1) TopExp_Explorer(shape, TopAbs_EDGE) visits a SHARED edge ONCE PER ADJACENT
//       FACE. A box's 12 edges produce 24 visits (measured directly: TopExp walk
//       count = 24, TopExp::MapShapes unique = 12). The old `nHit == 1` uniqueness
//       test ran over that duplicating stream, so nHit was ALWAYS >= 2 and this
//       function returned a NULL edge for EVERY well-formed edge of a solid. Spec
//       #2 of any multi-edge request therefore always deferred with "could not
//       re-resolve a ... edge after a prior op" — the arc-tolerant retrim and the
//       corner blend were never reached at all. Fix: walk the UNIQUE edge map.
//
//   (2) Matching on the MIDPOINT is wrong the moment a neighbouring edge has been
//       filleted: that fillet legitimately SHORTENS this edge by the setback at one
//       or both ends, moving its midpoint by up to R. The edge still lies on the
//       SAME infinite line. Fix: pass 1 keeps the exact midpoint match (cheap, and
//       unambiguous when nothing moved); pass 2 accepts the unique COLLINEAR,
//       span-overlapping survivor.
TopoDS_Edge resolveEdge(const TopoDS_Shape& shape, const TopoDS_Edge& ref) {
    gp_Pnt rp0, rp1; gp_Dir rd;
    if (!lineEdge(ref, rp0, rp1, rd)) return TopoDS_Edge();
    const gp_Pnt rmid((rp0.X() + rp1.X()) * 0.5, (rp0.Y() + rp1.Y()) * 0.5, (rp0.Z() + rp1.Z()) * 0.5);
    const double refLen = rp0.Distance(rp1);

    TopTools_IndexedMapOfShape emap;
    TopExp::MapShapes(shape, TopAbs_EDGE, emap);

    // Pass 1 — exact midpoint + direction (nothing touched this edge yet).
    TopoDS_Edge hit; int nHit = 0;
    for (int i = 1; i <= emap.Extent(); ++i) {
        if (emap(i).ShapeType() != TopAbs_EDGE) continue;
        const TopoDS_Edge e = TopoDS::Edge(emap(i));
        gp_Pnt p0, p1; gp_Dir d;
        if (!lineEdge(e, p0, p1, d)) continue;
        const gp_Pnt mid((p0.X() + p1.X()) * 0.5, (p0.Y() + p1.Y()) * 0.5, (p0.Z() + p1.Z()) * 0.5);
        if (mid.Distance(rmid) <= 1e-6 &&
            std::fabs(std::fabs(gp_Vec(d).Dot(gp_Vec(rd))) - 1.0) <= 1e-6) {
            hit = e; ++nHit;
        }
    }
    if (nHit == 1) return hit;

    // Pass 2 — same infinite line, overlapping span; keep the LARGEST overlap and
    // require it to be strictly the best (a tie is genuinely ambiguous -> defer).
    TopoDS_Edge best; double bestOv = 0.0; int nBest = 0;
    const gp_Vec rdv(rd);
    for (int i = 1; i <= emap.Extent(); ++i) {
        if (emap(i).ShapeType() != TopAbs_EDGE) continue;
        const TopoDS_Edge e = TopoDS::Edge(emap(i));
        gp_Pnt p0, p1; gp_Dir d;
        if (!lineEdge(e, p0, p1, d)) continue;
        if (std::fabs(std::fabs(gp_Vec(d).Dot(rdv)) - 1.0) > 1e-6) continue;
        // both endpoints must sit on the reference line
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

// A TANGENT-CONTINUOUS edge is a fillet/chamfer NO-OP, not a deferral.
//
// The interior dihedral there is pi, so the rolling-ball setback s = R/tan(theta/2)
// is exactly ZERO and the blend removes no material. OCCT's BRepFilletAPI silently
// no-ops such an edge, and the FT selectors hand us plenty of them: MEASURED, the
// OCCT baseline for `FILLET(holed plate, 3, VERTICAL)` removes exactly
// 4 x (1-pi/4)R^2 L = 77.256661 mm^3 — the four corner edges only — while the
// selector ALSO passes the two u-wrap SEAM edges of the Ø12 bore. Declining the
// whole request because of them (the old behaviour: "adjacent face A is not
// planar") loses a capability OCCT has; skipping them reproduces OCCT exactly and
// the volume gate proves it.
// ============================================================================
// F2 — SIMULTANEOUS, CORNER-AWARE blend (the trihedral corner patch)
// ============================================================================
//
// The sequential engine above rebuilds one edge at a time. That is exact while the
// blended edges do not meet, and it now reproduces OCCT to the last digit for such
// sets. It CANNOT close a VERTEX where two or three blended edges meet: the second
// edge's endpoint has already been consumed by the first blend, so `endFacesAt`
// finds no simple end face and the op honestly defers ("end face not planar").
//
// This routine builds the whole request AT ONCE for the case that matters — a
// convex polyhedral corner where all three incident edges are blended. It is
// closed-form, not iterative. Derivation, and the ORACLE MEASUREMENT that fixes
// every constant (dumped from OCCT's own result for BOX(30,20,10)):
//
//   FILLET r=3, all 12 edges  -> 6 planes + 12 cylinders + 8 SPHERES
//       sphere centres exactly (+-12, +-7, {3,7}); each patch area = pi*R^2/2, an
//       exact spherical OCTANT; volume 5572.619358586 = the Minkowski sum
//       (L-2R)-box (+) ball(R): a^3 + 6a^2 R + 3 pi R^2 a + 4/3 pi R^3.
//   CHAMFER d=2, all 12 edges -> 26 planes; each corner patch is the EQUILATERAL
//       triangle of side d*sqrt2, area d^2*sqrt3/2 = 3.464102, centroid at
//       V + (2d/3)(u1+u2+u3); volume 5562.666666667.
//
// The construction that produces both, uniformly:
//
//   * setback  q = R/tan(theta/2)  (fillet)  or  d  (chamfer)   [in-face]
//   * For every FACE F and every corner V of F: the new corner is the intersection,
//     IN F's PLANE, of the two boundary lines at V after each blended one has been
//     offset inward by q. Call it T(F,V). This single rule covers a corner with one
//     blended face-edge (the old `V + q*t`) and with two (the trihedral corner).
//   * BALL CENTRE at a 3-blended-edge vertex: the unique point at depth R inside all
//     three faces, i.e. the 3x3 solve  n_i . C = n_i . V - R  with OUTWARD normals.
//     VERIFIED against the oracle: V=(-15,-10,0) -> C=(-12,-7,3). C lies ON all
//     three cylinder axes, which is why the sphere meets each cylinder in a great
//     circle and the join is exactly tangent.
//   * BLEND PATCH TRIM: the cylinder / bevel for edge e is trimmed at endpoint V at
//     the axial parameter (T(A,V) - axis0).e — again one rule for both cases (0 at a
//     lone vertex, s at a trihedral one), because n_A is perpendicular to e.
//   * CORNER PATCH: fillet -> the spherical octant u,v in [0,pi/2] of
//     Geom_SphericalSurface(gp_Ax3(C, n3, n1), R) with (n1,n2,n3) right-handed;
//     chamfer -> the planar triangle T(F1,V) T(F2,V) T(F3,V).
//
// HONEST SCOPE — anything else returns ok==false and the caller keeps its previous
// behaviour (there is no faking): a vertex with exactly TWO blended edges (the blend
// there is a partial sphere/torus, not authored), a vertex that is not a 3-edge /
// 3-planar-face corner, non-mutually-orthogonal corner normals (the spherical
// triangle stops being a UV rectangle), mixed radii, concave or curved edges.
struct BReq {
    TopoDS_Edge edge;
    bool        isFillet = true;
    double      R = 0.0;      // fillet radius
    double      d = 0.0;      // chamfer setback (symmetric)
};

struct BSpec {
    EdgeContext c;
    double      q = 0.0;      // in-face setback on BOTH faces
    double      R = 0.0;
    bool        isFillet = true;
    gp_Pnt      axis0;        // fillet cylinder axis point, foot of P0
};

struct BVert {
    gp_Pnt                   P;
    std::vector<int>         specs;   // blended edges meeting here
    std::vector<TopoDS_Face> faces;   // unique incident faces
    int                      nEdges = 0;
    bool                     k3 = false;
    gp_Pnt                   C;       // ball centre (k3)
};

// Replacement for one (face, vertex) corner.
struct CornerRep {
    bool   transverse = false;  // this face is an END face of a lone blended edge
    gp_Pnt p;                   // single replacement point            (!transverse)
    gp_Pnt pa, pb;              // the two clip points on faces A,B     (transverse)
    gp_Pnt arcCtr;              // fillet arc centre in this face plane (transverse)
    double arcR = 0.0;
    bool   isArcClip = false;   // fillet -> arc, chamfer -> straight chord
};

// Intersection of two coplanar lines (plane normal n). false if parallel.
bool lineIsect(const gp_Pnt& p1, const gp_Vec& d1,
               const gp_Pnt& p2, const gp_Vec& d2,
               const gp_Dir& n, gp_Pnt& out) {
    const gp_Vec nv(n);
    const double den = d1.Crossed(d2).Dot(nv);
    if (std::fabs(den) < 1e-12) return false;
    const gp_Vec w(p1, p2);
    const double lam = w.Crossed(d2).Dot(nv) / den;
    out = gp_Pnt(p1.X() + d1.X() * lam, p1.Y() + d1.Y() * lam, p1.Z() + d1.Z() * lam);
    return true;
}

// The cylindrical fillet patch trimmed to an explicit axial range [v0,v1].
TopoDS_Face filletCylinderRange(const gp_Pnt& axis0, const gp_Dir& e, double R,
                                const gp_Pnt& refA, const gp_Pnt& refB,
                                double v0, double v1) {
    if (!(v1 - v0 > 1e-9)) return TopoDS_Face();
    // radial reference directions, taken perpendicular to the axis
    const gp_Vec ea(e);
    gp_Vec va(axis0, refA); va -= ea * va.Dot(ea);
    gp_Vec vb(axis0, refB); vb -= ea * vb.Dot(ea);
    if (va.Magnitude() <= kTol || vb.Magnitude() <= kTol) return TopoDS_Face();
    const gp_Dir dA(va), dB(vb);
    const double ang = std::acos(std::max(-1.0, std::min(1.0, dA.Dot(dB))));
    if (!(ang > 1e-9)) return TopoDS_Face();
    const bool aFirst = gp_Vec(dA).Crossed(gp_Vec(dB)).Dot(ea) > 0.0;
    const gp_Ax3 ax(axis0, e, aFirst ? dA : dB);
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(ax, R);
    BRepBuilderAPI_MakeFace mf(cyl, 0.0, ang, v0, v1, Precision::Confusion());
    if (!mf.IsDone()) return TopoDS_Face();
    TopoDS_Face face = mf.Face();
    BRepLib::SameParameter(face, 1e-7, Standard_True);
    return face;
}

// The spherical corner octant: the patch of sphere(C,R) spanned by three MUTUALLY
// ORTHOGONAL outward normals. Returns a null face when the normals are not an
// orthonormal frame (the caller then defers — a general spherical triangle is not
// a UV rectangle and is deliberately not faked here).
TopoDS_Face sphericalCorner(const gp_Pnt& C, double R,
                            gp_Dir n1, gp_Dir n2, const gp_Dir& n3) {
    const gp_Vec v1(n1), v2(n2), v3(n3);
    if (std::fabs(v1.Dot(v2)) > 1e-9 || std::fabs(v1.Dot(v3)) > 1e-9 ||
        std::fabs(v2.Dot(v3)) > 1e-9) return TopoDS_Face();
    if (v1.Crossed(v2).Dot(v3) < 0.0) std::swap(n1, n2);   // make (n1,n2,n3) right-handed
    const gp_Ax3 ax(C, n3, n1);                            // YDirection == n3 ^ n1 == n2
    Handle(Geom_SphericalSurface) sph = new Geom_SphericalSurface(ax, R);
    BRepBuilderAPI_MakeFace mf(sph, 0.0, 0.5 * kPi, 0.0, 0.5 * kPi, Precision::Confusion());
    if (!mf.IsDone()) return TopoDS_Face();
    TopoDS_Face f = mf.Face();
    BRepLib::SameParameter(f, 1e-7, Standard_True);
    return f;
}

// The whole simultaneous build. ok==false is an honest deferral.
Result blendBatch(const TopoDS_Shape& shape, const std::vector<BReq>& reqs) {
    if (reqs.empty()) return defer("no blend edges supplied");

    // ---- 1. resolve every requested edge into a local frame --------------------
    std::vector<BSpec> sp;
    sp.reserve(reqs.size());
    for (const BReq& rq : reqs) {
        BSpec s; std::string why;
        if (!buildEdgeContext(shape, rq.edge, s.c, why)) return defer(why);
        if (!s.c.convex) return defer("concave (reflex) edge — out of scope");
        s.isFillet = rq.isFillet;
        if (rq.isFillet) {
            if (!(rq.R > 0.0)) return defer("non-positive fillet radius");
            const double halfTan = std::tan(0.5 * s.c.dihedral);
            if (!(halfTan > 1e-9)) return defer("degenerate dihedral");
            s.R = rq.R;
            s.q = rq.R / halfTan;
            const gp_Dir inA(gp_Vec(s.c.nA).Reversed());
            s.axis0 = shift(shift(s.c.P0, s.c.tA, s.q), inA, rq.R);
        } else {
            if (!(rq.d > 0.0)) return defer("non-positive chamfer distance");
            s.q = rq.d;
        }
        sp.push_back(s);
    }
    // Equal setback is required by the corner formulae (a mixed-radius corner is a
    // different, unauthored surface) — defer rather than approximate.
    for (std::size_t i = 1; i < sp.size(); ++i) {
        if (std::fabs(sp[i].q - sp[0].q) > 1e-9 || std::fabs(sp[i].R - sp[0].R) > 1e-9 ||
            sp[i].isFillet != sp[0].isFillet)
            return defer("mixed radii / mixed op in one corner-aware blend request");
    }

    // ---- 2. topology tables ----------------------------------------------------
    TopTools_IndexedMapOfShape emap, fmap;
    TopExp::MapShapes(shape, TopAbs_EDGE, emap);
    TopExp::MapShapes(shape, TopAbs_FACE, fmap);

    auto endpointsOf = [](const TopoDS_Edge& e, gp_Pnt& a, gp_Pnt& b) {
        TopoDS_Vertex v0, v1;
        TopExp::Vertices(e, v0, v1);
        if (v0.IsNull() || v1.IsNull()) return false;
        a = BRep_Tool::Pnt(v0); b = BRep_Tool::Pnt(v1);
        return true;
    };

    std::vector<BVert> vts;
    auto vertexAt = [&](const gp_Pnt& p) -> int {
        for (std::size_t i = 0; i < vts.size(); ++i) if (pntEq(vts[i].P, p)) return int(i);
        return -1;
    };
    for (std::size_t i = 0; i < sp.size(); ++i) {
        for (int end = 0; end < 2; ++end) {
            const gp_Pnt P = end == 0 ? sp[i].c.P0 : sp[i].c.P1;
            int vi = vertexAt(P);
            if (vi < 0) { BVert v; v.P = P; vts.push_back(v); vi = int(vts.size()) - 1; }
            vts[vi].specs.push_back(int(i));
        }
    }
    for (BVert& v : vts) {
        for (int i = 1; i <= emap.Extent(); ++i) {
            gp_Pnt a, b;
            if (!endpointsOf(TopoDS::Edge(emap(i)), a, b)) continue;
            if (pntEq(a, v.P) || pntEq(b, v.P)) ++v.nEdges;
        }
        for (int i = 1; i <= fmap.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fmap(i));
            for (TopExp_Explorer ve(f, TopAbs_VERTEX); ve.More(); ve.Next()) {
                if (pntEq(BRep_Tool::Pnt(TopoDS::Vertex(ve.Current())), v.P)) { v.faces.push_back(f); break; }
            }
        }
        if (v.nEdges != 3 || v.faces.size() != 3)
            return defer("blended vertex is not a simple 3-edge / 3-face corner");
        const std::size_t k = v.specs.size();
        if (k == 2) return defer("a vertex with exactly TWO blended edges needs the "
                                 "two-edge corner surface, which is not authored — deferring");
        if (k > 3)  return defer("more than three blended edges meet at a vertex");
        v.k3 = (k == 3);
        if (v.k3) {
            gp_Dir n[3]; gp_Pln pl;
            for (int j = 0; j < 3; ++j)
                if (!planarFaceNormal(v.faces[std::size_t(j)], pl, n[j]))
                    return defer("corner face is not planar");
            // n_i . C = n_i . V - R   (outward normals; C sits R deep inside each face)
            const double R = sp[0].R;
            const double dep = sp[0].isFillet ? R : 0.0;
            double M[3][4];
            for (int r = 0; r < 3; ++r) {
                M[r][0] = n[r].X(); M[r][1] = n[r].Y(); M[r][2] = n[r].Z();
                M[r][3] = gp_Vec(n[r]).Dot(gp_Vec(v.P.X(), v.P.Y(), v.P.Z())) - dep;
            }
            // Cramer
            auto det3 = [](double a00,double a01,double a02,double a10,double a11,double a12,
                           double a20,double a21,double a22){
                return a00*(a11*a22-a12*a21) - a01*(a10*a22-a12*a20) + a02*(a10*a21-a11*a20);
            };
            const double D = det3(M[0][0],M[0][1],M[0][2],M[1][0],M[1][1],M[1][2],M[2][0],M[2][1],M[2][2]);
            if (std::fabs(D) < 1e-12) return defer("degenerate corner (coplanar faces)");
            const double Dx = det3(M[0][3],M[0][1],M[0][2],M[1][3],M[1][1],M[1][2],M[2][3],M[2][1],M[2][2]);
            const double Dy = det3(M[0][0],M[0][3],M[0][2],M[1][0],M[1][3],M[1][2],M[2][0],M[2][3],M[2][2]);
            const double Dz = det3(M[0][0],M[0][1],M[0][3],M[1][0],M[1][1],M[1][3],M[2][0],M[2][1],M[2][3]);
            v.C = gp_Pnt(Dx / D, Dy / D, Dz / D);
        }
    }

    // ---- 3. the T(F,V) corner replacements ------------------------------------
    // key: face index in fmap (1-based) * 4096 + vertex index
    std::map<int, CornerRep> creps;
    auto key = [](int fi, int vi) { return fi * 4096 + vi; };

    for (int fi = 1; fi <= fmap.Extent(); ++fi) {
        const TopoDS_Face F = TopoDS::Face(fmap(fi));
        gp_Pln fpln; gp_Dir fN;
        const bool planar = planarFaceNormal(F, fpln, fN);
        std::vector<RingSeg> segs; bool straight = false;
        const bool haveRing = orderedOuterRing(F, segs, straight) && ringIsRebuildable(segs, straight);
        for (std::size_t vi = 0; vi < vts.size(); ++vi) {
            const BVert& v = vts[vi];
            // is V a corner of this face's OUTER ring?
            std::size_t at = segs.size();
            if (haveRing) for (std::size_t i = 0; i < segs.size(); ++i)
                if (pntEq(segs[i].p, v.P)) { at = i; break; }
            if (!haveRing || at == segs.size()) continue;
            if (!planar) return defer("a blended corner lies on a non-planar face");

            // which blended edges at V lie IN this face?
            std::vector<int> inF;
            for (int si : v.specs)
                if (sp[std::size_t(si)].c.A.IsSame(F) || sp[std::size_t(si)].c.B.IsSame(F)) inF.push_back(si);

            CornerRep rep;
            const std::size_t n = segs.size();
            const gp_Pnt prev = segs[(at + n - 1) % n].p;
            const gp_Pnt next = segs[(at + 1) % n].p;

            // offset line of a blended edge e inside F: through V + q*t_F, along e
            auto offsetLine = [&](int si, gp_Pnt& op, gp_Vec& od) {
                const BSpec& s = sp[std::size_t(si)];
                const bool onA = s.c.A.IsSame(F);
                const gp_Dir t = onA ? s.c.tA : s.c.tB;
                op = shift(v.P, t, s.q);
                od = gp_Vec(s.c.e);
            };

            if (inF.size() == 2) {
                gp_Pnt p1, p2; gp_Vec d1, d2;
                offsetLine(inF[0], p1, d1);
                offsetLine(inF[1], p2, d2);
                if (!lineIsect(p1, d1, p2, d2, fN, rep.p))
                    return defer("blended corner offset lines do not intersect");
            } else if (inF.size() == 1) {
                gp_Pnt p1; gp_Vec d1;
                offsetLine(inF[0], p1, d1);
                // the OTHER boundary line of F at V (the ring neighbour that is not
                // the blended edge itself)
                const BSpec& s = sp[std::size_t(inF[0])];
                const gp_Pnt far = pntEq(s.c.P0, v.P) ? s.c.P1 : s.c.P0;
                const bool prevIsBlend = pntEq(prev, far);
                const gp_Pnt other = prevIsBlend ? next : prev;
                const gp_Vec d2(v.P, other);
                const bool otherIsArc = (prevIsBlend ? segs[at].isArc : segs[(at + n - 1) % n].isArc);
                if (otherIsArc || !lineIsect(p1, d1, v.P, d2, fN, rep.p))
                    rep.p = shift(v.P, s.c.A.IsSame(F) ? s.c.tA : s.c.tB, s.q);
            } else {
                // transverse: F is an END face of exactly one blended edge at V
                if (v.specs.size() != 1)
                    return defer("transverse blend face at a multi-edge corner — deferring");
                const BSpec& s = sp[std::size_t(v.specs[0])];
                rep.transverse = true;
                rep.pa = shift(v.P, s.c.tA, s.q);
                rep.pb = shift(v.P, s.c.tB, s.q);
                if (s.isFillet) {
                    rep.isArcClip = true;
                    rep.arcR = s.R;
                    const gp_Dir inA(gp_Vec(s.c.nA).Reversed());
                    rep.arcCtr = shift(rep.pa, inA, s.R);
                }
            }
            creps[key(fi, int(vi))] = rep;
        }
    }

    // ---- 4. rebuild the touched faces; copy the rest verbatim ------------------
    std::vector<TopoDS_Face> faces;
    for (int fi = 1; fi <= fmap.Extent(); ++fi) {
        const TopoDS_Face F = TopoDS::Face(fmap(fi));
        std::vector<std::pair<std::size_t, CornerRep>> hits;   // ring index -> rep
        std::vector<RingSeg> segs; bool straight = false;
        const bool haveRing = orderedOuterRing(F, segs, straight) && ringIsRebuildable(segs, straight);
        if (haveRing) {
            for (std::size_t vi = 0; vi < vts.size(); ++vi) {
                auto it = creps.find(key(fi, int(vi)));
                if (it == creps.end()) continue;
                for (std::size_t i = 0; i < segs.size(); ++i)
                    if (pntEq(segs[i].p, vts[vi].P)) { hits.emplace_back(i, it->second); break; }
            }
        }
        if (hits.empty()) { faces.push_back(F); continue; }     // untouched -> verbatim

        gp_Pln fpln; gp_Dir fN;
        if (!planarFaceNormal(F, fpln, fN)) return defer("touched face is not planar");

        std::vector<RingSeg> out;
        out.reserve(segs.size() + hits.size());
        for (std::size_t i = 0; i < segs.size(); ++i) {
            const CornerRep* rep = nullptr;
            for (const auto& h : hits) if (h.first == i) { rep = &h.second; break; }
            if (!rep) { out.push_back(segs[i]); continue; }
            if (!rep->transverse) {
                RingSeg s = segs[i];
                s.p = rep->p;
                out.push_back(s);
            } else {
                // order the two clip points so the one nearer the PREVIOUS ring
                // vertex comes first (keeps the loop simple)
                const gp_Pnt prev = segs[(i + segs.size() - 1) % segs.size()].p;
                const bool aFirst = prev.Distance(rep->pa) <= prev.Distance(rep->pb);
                RingSeg a; a.p = aFirst ? rep->pa : rep->pb;
                if (rep->isArcClip) { a.newArc = true; a.arcCtr = rep->arcCtr; a.arcR = rep->arcR; }
                RingSeg b = segs[i];                 // carries the ORIGINAL outgoing curve
                b.p = aFirst ? rep->pb : rep->pa;
                out.push_back(a); out.push_back(b);
            }
        }
        const TopoDS_Face nf = planarFaceFromSegs(out, fpln, fN, innerWires(F));
        if (nf.IsNull()) return defer("could not rebuild a retrimmed face");
        faces.push_back(nf);
    }

    // ---- 5. the blend patches --------------------------------------------------
    for (std::size_t i = 0; i < sp.size(); ++i) {
        const BSpec& s = sp[i];
        // face-corner replacements at both ends, on both adjacent faces
        gp_Pnt tA[2], tB[2];
        for (int end = 0; end < 2; ++end) {
            const gp_Pnt V = end == 0 ? s.c.P0 : s.c.P1;
            const int vi = vertexAt(V);
            if (vi < 0) return defer("internal: blended endpoint has no vertex record");
            bool gotA = false, gotB = false;
            for (int fi = 1; fi <= fmap.Extent(); ++fi) {
                auto it = creps.find(key(fi, vi));
                if (it == creps.end() || it->second.transverse) continue;
                const TopoDS_Face F = TopoDS::Face(fmap(fi));
                if (F.IsSame(s.c.A)) { tA[end] = it->second.p; gotA = true; }
                if (F.IsSame(s.c.B)) { tB[end] = it->second.p; gotB = true; }
            }
            if (!gotA || !gotB) return defer("internal: missing adjacent-face corner");
        }
        if (s.isFillet) {
            const gp_Vec ev(s.c.e);
            const double v0 = gp_Vec(s.axis0, tA[0]).Dot(ev);
            const double v1 = gp_Vec(s.axis0, tA[1]).Dot(ev);
            const TopoDS_Face cyl = filletCylinderRange(s.axis0, s.c.e, s.R, tA[0], tB[0],
                                                        std::min(v0, v1), std::max(v0, v1));
            if (cyl.IsNull()) return defer("cylinder patch build failed");
            faces.push_back(cyl);
        } else {
            const TopoDS_Face bev = bevelQuad(tA[0], tB[0], tB[1], tA[1]);
            if (bev.IsNull()) return defer("bevel face build failed");
            faces.push_back(bev);
        }
    }

    // ---- 6. the corner patches -------------------------------------------------
    for (std::size_t vi = 0; vi < vts.size(); ++vi) {
        const BVert& v = vts[vi];
        if (!v.k3) continue;
        gp_Dir n[3]; gp_Pnt T[3]; gp_Pln pl;
        for (int j = 0; j < 3; ++j) {
            const TopoDS_Face F = v.faces[std::size_t(j)];
            if (!planarFaceNormal(F, pl, n[j])) return defer("corner face is not planar");
            bool got = false;
            for (int fi = 1; fi <= fmap.Extent(); ++fi) {
                if (!TopoDS::Face(fmap(fi)).IsSame(F)) continue;
                auto it = creps.find(key(fi, int(vi)));
                if (it != creps.end() && !it->second.transverse) { T[j] = it->second.p; got = true; }
                break;
            }
            if (!got) return defer("internal: missing corner replacement point");
        }
        if (sp[0].isFillet) {
            const TopoDS_Face sphF = sphericalCorner(v.C, sp[0].R, n[0], n[1], n[2]);
            if (sphF.IsNull())
                return defer("trihedral corner normals are not mutually orthogonal — the "
                             "general spherical triangle is not authored, deferring");
            faces.push_back(sphF);
        } else {
            BRepBuilderAPI_MakePolygon poly(T[0], T[1], T[2], Standard_True);
            if (!poly.IsDone()) return defer("corner triangle build failed");
            BRepBuilderAPI_MakeFace mf(poly.Wire(), Standard_True);
            if (!mf.IsDone()) return defer("corner triangle face build failed");
            faces.push_back(mf.Face());
        }
    }

    // ---- 7. sew + measure ------------------------------------------------------
    const TopoDS_Shape sol = sewToSolid(faces);
    if (sol.IsNull()) return defer("corner-aware blend produced no closed solid");
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (!(v1 > 0.0))  return defer("corner-aware blend produced a non-positive volume");
    if (!(v1 < v0))   return defer("corner-aware blend removed no material");
    Result r; r.ok = true; r.shape = sol;
    r.reason = sp[0].isFillet ? "native corner-aware fillet (trihedral spherical blend)"
                              : "native corner-aware chamfer (trihedral planar corner)";
    return r;
}

// Drop repeat requests for the SAME topological edge.
//
// ★ MEASURED: the call sites address edges by their TopExp_Explorer INDEX
//   (Features.cpp edgeById), and that stream visits a shared edge once per
//   adjacent face — so `FILLET(box, r, VERTICAL)` arrives here as EIGHT specs
//   naming FOUR distinct edges, and `ALL` as TWENTY-FOUR naming twelve. The
//   caller's dedup is by ID, which cannot see that ids 5 and 16 are the same
//   edge. Applying an edge twice is fatal: the second application cannot
//   re-resolve an edge that the first one consumed. OCCT's BRepFilletAPI::Add
//   tolerates a repeat; so must we. FIRST spec wins (matches the caller's own
//   first-wins id dedup).
template <class SpecT>
std::vector<SpecT> dedupSpecs(const std::vector<SpecT>& specs) {
    std::vector<SpecT> uniq;
    uniq.reserve(specs.size());
    for (const SpecT& s : specs) {
        if (s.edge.IsNull()) continue;
        bool dup = false;
        for (const SpecT& u : uniq) if (u.edge.IsSame(s.edge)) { dup = true; break; }
        if (!dup) uniq.push_back(s);
    }
    return uniq;
}

bool edgeIsTangentNoOp(const TopoDS_Shape& shape, const TopoDS_Edge& edge) {
    if (edge.IsNull()) return false;
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
    if (!efMap.Contains(edge)) return false;
    const TopTools_ListOfShape& fl = efMap.FindFromKey(edge);
    if (fl.Extent() != 2) return false;
    TopTools_ListIteratorOfListOfShape it(fl);
    const TopoDS_Face f0 = TopoDS::Face(it.Value()); it.Next();
    const TopoDS_Face f1 = TopoDS::Face(it.Value());
    // The u-wrap seam of a periodic face: both "adjacent" faces are the same face.
    if (f0.IsSame(f1)) return true;
    // Two distinct but CO-PLANAR faces (a boolean artefact edge) — also 180 degrees.
    gp_Pln p0, p1; gp_Dir n0, n1;
    if (planarFaceNormal(f0, p0, n0) && planarFaceNormal(f1, p1, n1) &&
        gp_Vec(n0).Dot(gp_Vec(n1)) > 1.0 - 1e-9) return true;
    return false;
}

}  // namespace

// ------------------------------- public API ----------------------------------
Result makeChamfer(const TopoDS_Shape& shape, const std::vector<ChamferSpec>& specs) {
    if (shape.IsNull()) return defer("null shape");
    if (specs.empty())  return defer("no chamfer edges supplied");
    const std::vector<ChamferSpec> uspecs = dedupSpecs(specs);
    if (uspecs.empty()) return defer("no chamfer edges supplied");
    TopoDS_Shape work = shape;
    Result seq; seq.ok = true;
    try {
        bool first = true;
        for (std::size_t i = 0; i < uspecs.size() && seq.ok; ++i) {
            ChamferSpec s = uspecs[i];
            if (edgeIsTangentNoOp(shape, uspecs[i].edge)) continue;   // 180 deg: no material
            if (!first) {                     // re-resolve against the rebuilt shape
                s.edge = resolveEdge(work, uspecs[i].edge);
                if (s.edge.IsNull()) { seq = defer("could not re-resolve a chamfer edge after a prior op"); break; }
            }
            Result r = chamferOneEdge(work, s);
            if (!r.ok) { seq = r; break; }    // honest deferral -> try the corner-aware path
            work = r.shape;
            first = false;
        }
    } catch (...) {
        seq = defer("native chamfer raised an OCCT exception");
    }
    if (seq.ok) {
        seq.shape = work;
        seq.reason = "native chamfer (prismatic convex edges)";
        return seq;
    }
    // The sequential engine cannot close a VERTEX where blended edges meet. Try the
    // simultaneous corner-aware build (F2) before giving up; it defers honestly too.
    try {
        std::vector<BReq> reqs;
        for (const ChamferSpec& s : uspecs) {
            if (edgeIsTangentNoOp(shape, s.edge)) continue;
            BReq q; q.edge = s.edge; q.isFillet = false;
            q.d = (s.dist2 > Precision::Confusion() && std::fabs(s.dist2 - s.dist) > 1e-12)
                      ? -1.0 : s.dist;                 // asymmetric -> let the batch defer
            reqs.push_back(q);
        }
        Result b = blendBatch(shape, reqs);
        if (b.ok) return b;
        seq.reason += " | corner-aware: " + b.reason;
    } catch (...) {
        seq.reason += " | corner-aware raised an OCCT exception";
    }
    debugDefer("chamfer", seq.reason);
    return seq;
}

Result makeFillet(const TopoDS_Shape& shape, const std::vector<FilletSpec>& specs) {
    if (shape.IsNull()) return defer("null shape");
    if (specs.empty())  return defer("no fillet edges supplied");
    const std::vector<FilletSpec> uspecs = dedupSpecs(specs);
    if (uspecs.empty()) return defer("no fillet edges supplied");
    TopoDS_Shape work = shape;
    Result seq; seq.ok = true;
    try {
        bool first = true;
        for (std::size_t i = 0; i < uspecs.size() && seq.ok; ++i) {
            FilletSpec s = uspecs[i];
            if (edgeIsTangentNoOp(shape, uspecs[i].edge)) continue;   // 180 deg: no material
            if (!first) {
                s.edge = resolveEdge(work, uspecs[i].edge);
                if (s.edge.IsNull()) { seq = defer("could not re-resolve a fillet edge after a prior op"); break; }
            }
            Result r = filletOneEdge(work, s);
            if (!r.ok) { seq = r; break; }
            work = r.shape;
            first = false;
        }
    } catch (...) {
        seq = defer("native fillet raised an OCCT exception");
    }
    if (seq.ok) { seq.shape = work; seq.reason = "native fillet (prismatic convex edges)"; return seq; }
    // Vertex-connected sets need the simultaneous corner-aware build (F2).
    try {
        std::vector<BReq> reqs;
        for (const FilletSpec& s : uspecs) {
            if (edgeIsTangentNoOp(shape, s.edge)) continue;
            BReq q; q.edge = s.edge; q.isFillet = true; q.R = s.radius;
            reqs.push_back(q);
        }
        Result b = blendBatch(shape, reqs);
        if (b.ok) return b;
        seq.reason += " | corner-aware: " + b.reason;
    } catch (...) {
        seq.reason += " | corner-aware raised an OCCT exception";
    }
    debugDefer("fillet", seq.reason);
    return seq;
}

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
