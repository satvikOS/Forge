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

// Outward unit normal of a PLANAR face (orientation-corrected). Returns false if
// the face is not planar.
bool planarFaceNormal(const TopoDS_Face& f, gp_Pln& pln, gp_Dir& outN) {
    BRepAdaptor_Surface as(f);
    if (as.GetType() != GeomAbs_Plane) return false;
    pln = as.Plane();
    outN = pln.Axis().Direction();
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
        }
        segs.swap(r);
    }

    BRepBuilderAPI_MakeWire mw;
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = segs[i].p;
        const gp_Pnt& b = segs[(i + 1) % n].p;
        if (a.Distance(b) < 1e-9) continue;          // degenerate
        TopoDS_Edge e;
        if (segs[i].isArc) {
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
// geometry (midpoint + direction), so a multi-edge request can be applied
// sequentially. Returns a null edge if no unique match (caller defers).
TopoDS_Edge resolveEdge(const TopoDS_Shape& shape, const TopoDS_Edge& ref) {
    gp_Pnt rp0, rp1; gp_Dir rd;
    if (!lineEdge(ref, rp0, rp1, rd)) return TopoDS_Edge();
    const gp_Pnt rmid((rp0.X() + rp1.X()) * 0.5, (rp0.Y() + rp1.Y()) * 0.5, (rp0.Z() + rp1.Z()) * 0.5);
    TopoDS_Edge hit; int nHit = 0;
    for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        gp_Pnt p0, p1; gp_Dir d;
        if (!lineEdge(e, p0, p1, d)) continue;
        const gp_Pnt mid((p0.X() + p1.X()) * 0.5, (p0.Y() + p1.Y()) * 0.5, (p0.Z() + p1.Z()) * 0.5);
        if (mid.Distance(rmid) <= 1e-6 && std::fabs(std::fabs(gp_Vec(d).Dot(gp_Vec(rd))) - 1.0) <= 1e-6) {
            hit = e; ++nHit;
        }
    }
    return (nHit == 1) ? hit : TopoDS_Edge();
}

}  // namespace

// ------------------------------- public API ----------------------------------
Result makeChamfer(const TopoDS_Shape& shape, const std::vector<ChamferSpec>& specs) {
    if (shape.IsNull()) return defer("null shape");
    if (specs.empty())  return defer("no chamfer edges supplied");
    TopoDS_Shape work = shape;
    try {
        for (std::size_t i = 0; i < specs.size(); ++i) {
            ChamferSpec s = specs[i];
            if (i > 0) {                      // re-resolve against the rebuilt shape
                s.edge = resolveEdge(work, specs[i].edge);
                if (s.edge.IsNull()) return defer("could not re-resolve a chamfer edge after a prior op");
            }
            Result r = chamferOneEdge(work, s);
            if (!r.ok) return r;              // honest deferral -> whole op defers
            work = r.shape;
        }
    } catch (...) {
        return defer("native chamfer raised an OCCT exception — deferring");
    }
    Result r; r.ok = true; r.shape = work;
    r.reason = "native chamfer (prismatic convex edges)";
    return r;
}

Result makeFillet(const TopoDS_Shape& shape, const std::vector<FilletSpec>& specs) {
    if (shape.IsNull()) return defer("null shape");
    if (specs.empty())  return defer("no fillet edges supplied");
    TopoDS_Shape work = shape;
    try {
        for (std::size_t i = 0; i < specs.size(); ++i) {
            FilletSpec s = specs[i];
            if (i > 0) {
                s.edge = resolveEdge(work, specs[i].edge);
                if (s.edge.IsNull()) return defer("could not re-resolve a fillet edge after a prior op");
            }
            Result r = filletOneEdge(work, s);
            if (!r.ok) return r;
            work = r.shape;
        }
    } catch (...) {
        return defer("native fillet raised an OCCT exception — deferring");
    }
    Result r; r.ok = true; r.shape = work;
    r.reason = "native fillet (prismatic convex edges)";
    return r;
}

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
