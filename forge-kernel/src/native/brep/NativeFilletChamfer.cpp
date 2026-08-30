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
#include <gp_Ax1.hxx>
#include <gp_Cylinder.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Compound.hxx>
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

// Sew a mixed set of pristine + rebuilt faces into one closed outward body.
// Returns a null shape if no closed shell forms (caller defers).
//
// ★ MEASURED 2026-08-30 over the 600-part corpus A/B, and it accounted for the
//   ENTIRE largest defer bucket of the FILLET row. Of the 344 parts that reach
//   this routine, the sew closes perfectly on all of them — 0 free edges and 0
//   multiple edges on every one — but it closes into ONE shell on 146 and into
//   TWO on 198, and those 198 are two-LUMP bodies (the corpus's STEP files carry
//   two disjoint solids). This routine used to take TopExp_Explorer's FIRST shell
//   and build a solid from it, silently deleting the other lump: on ho1274 that
//   kept 15 of 89 faces and returned 326199.6 where the body is 337988.1. All 198
//   were caught by the (1-pi/4)R^2 L volume self-check downstream and reported as
//   "fillet volume disagrees", which named the symptom and hid the cause — the
//   ratio of removed-to-expected material ran from 27x to 273x.
//   So: keep EVERY shell the sew produced, and assemble them the way the INPUT
//   assembles its own — see the note at the multi-shell branch for why the input,
//   not a classifier, is the authority on lump-vs-void.
//   The free-edge check is the other half: forcing Closed(true) on a shell that is
//   not closed still yields a volume, and a wrong one.
TopoDS_Shape sewToSolid(const std::vector<TopoDS_Face>& faces,
                        const TopoDS_Shape& src) {
    BRepBuilderAPI_Sewing sew(1e-6);
    for (const TopoDS_Face& f : faces) {
        if (f.IsNull()) return TopoDS_Shape();
        sew.Add(f);
    }
    sew.Perform();
    const TopoDS_Shape sewn = sew.SewedShape();
    if (sewn.IsNull()) return TopoDS_Shape();

    std::vector<TopoDS_Shell> shells;
    if (sewn.ShapeType() == TopAbs_SHELL) {
        shells.push_back(TopoDS::Shell(sewn));
    } else {
        for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next())
            shells.push_back(TopoDS::Shell(ex.Current()));
    }
    int nShellFaces = 0;
    for (const TopoDS_Shell& sh : shells)
        for (TopExp_Explorer x(sh, TopAbs_FACE); x.More(); x.Next()) ++nShellFaces;

    if (std::getenv("FORGE_FILLET_DEBUG")) {
        int nfSewn = 0;
        for (TopExp_Explorer x(sewn, TopAbs_FACE); x.More(); x.Next()) ++nfSewn;
        std::fprintf(stderr,
            "[occtfillet] sewToSolid in=%d sewn_faces=%d shells=%d shell_faces=%d "
            "loose=%d free_edges=%d multi_edges=%d\n",
            static_cast<int>(faces.size()), nfSewn, static_cast<int>(shells.size()),
            nShellFaces, nfSewn - nShellFaces,
            sew.NbFreeEdges(), sew.NbMultipleEdges());
    }

    if (shells.empty()) return TopoDS_Shape();
    // An edge left on exactly one face: the sew did not close.
    if (sew.NbFreeEdges() != 0) return TopoDS_Shape();
    // Every face handed in must survive into some shell.
    if (nShellFaces != static_cast<int>(faces.size())) return TopoDS_Shape();

    BRep_Builder bb;
    std::vector<TopoDS_Solid> lumps;
    lumps.reserve(shells.size());
    for (TopoDS_Shell sh : shells) {
        sh.Closed(Standard_True);
        TopoDS_Solid s;
        bb.MakeSolid(s);
        bb.Add(s, sh);
        BRepLib::OrientClosedSolid(s);
        GProp_GProps vp;
        BRepGProp::VolumeProperties(s, vp);
        if (vp.Mass() < 0.0) s.Reverse();
        lumps.push_back(s);
    }
    if (lumps.size() == 1) return lumps.front();

    // Several closed shells: either disjoint LUMPS of a multi-body part, or one
    // shell is an internal VOID of another. The two assemble with OPPOSITE signs,
    // so the case has to be decided rather than guessed — and the decision is
    // already in the INPUT, which the blend does not change: a blend on one lump's
    // edge cannot create, destroy or nest a lump.
    // So mirror the input's own partition, and require it to be the unambiguous
    // one: as many SOLIDs as SHELLs (every solid bounded by exactly one shell,
    // i.e. no input void) and as many shells as we just sewed. Anything else —
    // an input carrying a void, or a shell count the blend changed — is declined.
    // `src`'s volume is then the sum over its solids, which is what the caller's
    // v0 measures, so v1 is comparable to it term by term.
    int nSrcSolids = 0, nSrcShells = 0;
    for (TopExp_Explorer x(src, TopAbs_SOLID); x.More(); x.Next()) ++nSrcSolids;
    for (TopExp_Explorer x(src, TopAbs_SHELL); x.More(); x.Next()) ++nSrcShells;
    if (nSrcSolids != nSrcShells) return TopoDS_Shape();
    if (nSrcShells != static_cast<int>(lumps.size())) return TopoDS_Shape();
    TopoDS_Compound comp;
    bb.MakeCompound(comp);
    for (const TopoDS_Solid& s : lumps) bb.Add(comp, s);
    return comp;
}

double areaOf(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
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
    // ★ NAMING, made exact 2026-08-29 when the CONCAVE case landed. `dihedral` is
    //   ALWAYS acos(tA·tB) ∈ [0,π] — the angle between the two in-plane interior
    //   directions. For a CONVEX edge that IS the interior dihedral θ. For a
    //   CONCAVE (reflex) edge the interior dihedral is 2π−dihedral and `dihedral`
    //   is instead the VOID wedge angle φ the rolling ball sits in. Both branches
    //   need the same three numbers off it, which is why one field serves both:
    //     setback     s = R / tan(dihedral/2)           (identical formula)
    //     blend span  = π − dihedral at the cylinder    (identical formula)
    //     |ΔV| / L    = s·R − ½R²(π − dihedral)         (identical formula)
    //   Only the SIGN of the axis offset (−nA convex, +nA concave) and the SIGN of
    //   the volume change differ. Derivation: the ball inscribed in a wedge of apex
    //   angle ψ has tangent-point setback R/tan(ψ/2); the convex fillet's wedge is
    //   the material wedge (ψ = θ = dihedral), the concave fillet's is the void
    //   wedge (ψ = 2π−θ = dihedral). Same ψ either way, hence the same formulae.
    double dihedral = 0.0;     // acos(tA·tB): interior dihedral (convex) / void wedge (concave)
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

// The direction from the tangent line on face A to the blend cylinder axis.
// CONVEX: the ball rolls INSIDE the material, so the axis is R along -nA.
// CONCAVE: the ball rolls in the VOID wedge outside the reflex corner, so the axis
// is R along +nA. (Both give the same point measured from face B, which is the
// consistency the sew then confirms.)
inline gp_Dir axisOffsetDir(const EdgeContext& c) {
    return c.convex ? gp_Dir(gp_Vec(c.nA).Reversed()) : c.nA;
}

// |ΔV| per unit edge length for one constant-radius blend: the kite V-SA-O-SB
// (area s·R) minus the circular sector of angle (π − dihedral) at the axis.
// Removed when convex, ADDED when concave; the magnitude is the same expression.
// For dihedral = π/2 this collapses to the (1 − π/4)R² already baked into the
// one-edge self-check, which is why that check keeps passing unchanged.
inline double blendCrossSection(const EdgeContext& c, double R) {
    const double halfTan = std::tan(0.5 * c.dihedral);
    if (!(halfTan > 1e-12) || !(R > 0.0)) return 0.0;
    const double s = R / halfTan;
    return s * R - 0.5 * R * R * (kPi - c.dihedral);
}

// How far the retrim may move a boundary along `t` before it runs off the far side
// of the face: the largest (V − origin)·t over the face's OUTER ring vertices.
// Negative when the ring cannot be read.
double maxRingProjection(const TopoDS_Face& f, const gp_Pnt& origin, const gp_Dir& t) {
    std::vector<RingSeg> segs; bool straight = false;
    if (!orderedOuterRing(f, segs, straight)) return -1.0;
    double m = 0.0;
    const gp_Vec tv(t);
    for (const RingSeg& sg : segs) m = std::max(m, gp_Vec(origin, sg.p).Dot(tv));
    return m;
}

// The setback must land INSIDE both adjacent faces. When it does not, the retrimmed
// ring folds through the face's far boundary and the sew can STILL close on a solid
// whose volume happens to equal the idealised closed form.
//
// ★ MEASURED 2026-08-29, and the reason this test exists at all. On the L-prism
//   (reflex vertical edge, adjacent faces 20 mm and 10 mm deep) a CONCAVE fillet of
//   R=15 — setback 15 into a face only 10 deep — returned a shape that
//   BRepCheck_Analyzer called VALID, with volume 3586.283305885 = exactly the ideal
//   3200 + (1−π/4)R²L. Both the sign check and the closed-form check passed, because
//   the closed form describes the corner and says nothing about whether the corner
//   fits. OCCT's BRepFilletAPI DECLINES the same request outright. On the CONVEX
//   path the same leak is older and was measured on the pristine HEAD engine: box
//   30×20×10, one edge, R=25 -> the engine returns a shape (BRepCheck INVALID there)
//   where OCCT declines. This is the programme's standing lesson in its exact form:
//   volume agreed to ten significant figures with the wrong solid, so the guard has
//   to be a DIFFERENT observable — the face extent — not a tighter volume tolerance.
bool setbackFitsFaces(const EdgeContext& c, double sA, double sB, std::string& why) {
    const double eA = maxRingProjection(c.A, c.P0, c.tA);
    const double eB = maxRingProjection(c.B, c.P0, c.tB);
    if (!(eA > 0.0) || !(eB > 0.0)) {
        why = "adjacent face extent not measurable — deferring";
        return false;
    }
    if (sA > eA - kTol || sB > eB - kTol) {
        why = "blend setback exceeds the adjacent face extent (radius/distance too "
              "large for this feature) — deferring";
        return false;
    }
    return true;
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

    // Resolve which face gets dist vs dist2 (asymmetric via `contact`).
    double dA = spec.dist, dB = (spec.dist2 > Precision::Confusion()) ? spec.dist2 : spec.dist;
    if (spec.dist2 > Precision::Confusion() && !spec.contact.IsNull()) {
        if (spec.contact.IsSame(c.B)) { dA = spec.dist2; dB = spec.dist; }  // dist on `contact` (B)
        // else contact==A (or unknown): dA=dist on A, dB=dist2 — already set.
    }
    if (!(dA > 0.0) || !(dB > 0.0)) return defer("non-positive chamfer distance");
    if (!setbackFitsFaces(c, dA, dB, why)) return defer(why);

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

    const TopoDS_Shape sol = sewToSolid(faces, shape);
    if (sol.IsNull()) return defer("sew produced no closed solid");
    // Self-check: the bevel moves ½·dA·dB·sin(dihedral)·L of material — REMOVED on a
    // convex edge, ADDED on a concave one (the flat bevel fills the reflex notch).
    // Magnitude identical, sign opposite; asserting the sign is what catches an
    // orientation slip that would otherwise hand back the complement region.
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (v0 > 0.0) {
        if (c.convex && !(v1 < v0))
            return defer("convex chamfer did not remove material (orientation/geometry check failed)");
        if (!c.convex && !(v1 > v0))
            return defer("concave chamfer did not add material (orientation/geometry check failed)");
        const double moved = 0.5 * dA * dB * std::sin(c.dihedral) * c.L;
        if (moved > 0.0 && std::fabs(std::fabs(v1 - v0) - moved) / moved > 0.03)
            return defer("chamfer volume disagrees with ½·dA·dB·sinθ·L self-check");
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = c.convex ? "native flat-bevel chamfer (planar-planar convex straight edge)"
                        : "native flat-bevel chamfer (planar-planar CONCAVE straight edge)";
    return r;
}

// -------------------------- one-edge fillet ----------------------------------
Result filletOneEdge(const TopoDS_Shape& shape, const FilletSpec& spec) {
    EdgeContext c; std::string why;
    if (!buildEdgeContext(shape, spec.edge, c, why)) return defer(why);
    const double R = spec.radius;
    if (!(R > 0.0)) return defer("non-positive fillet radius");

    // Rolling-ball tangent setback s = R / tan(dihedral/2) — the same expression for
    // a convex edge (ball in the material wedge) and a concave one (ball in the void
    // wedge); see the EdgeContext::dihedral note.
    const double halfTan = std::tan(0.5 * c.dihedral);
    if (!(halfTan > 1e-9)) return defer("degenerate dihedral");
    const double s = R / halfTan;
    if (!setbackFitsFaces(c, s, s, why)) return defer(why);
    const gp_Pnt SA0 = shift(c.P0, c.tA, s), SA1 = shift(c.P1, c.tA, s);
    const gp_Pnt SB0 = shift(c.P0, c.tB, s), SB1 = shift(c.P1, c.tB, s);
    // Cylinder axis: from the tangent line on A, step R along -nA (convex) / +nA
    // (concave).
    const gp_Dir axDir = axisOffsetDir(c);
    const gp_Pnt axis0 = shift(SA0, axDir, R);
    const gp_Pnt axis1 = shift(SA1, axDir, R);

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

    const TopoDS_Shape sol = sewToSolid(faces, shape);
    if (sol.IsNull()) return defer("sew produced no closed solid");
    // Self-check: a convex fillet REMOVES material, a concave one ADDS it; for
    // dihedral=90° the magnitude is exactly (1-π/4)R²L in both cases.
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    // Diagnostic channel only (same contract as debugDefer): a defer that says
    // "volume disagrees" without saying BY HOW MUCH cannot be attributed, and the
    // corpus census needs the ratio to tell a wrong retrim from a wrong closed form.
    if (std::getenv("FORGE_FILLET_DEBUG")) {
        const double ideal90 = (1.0 - kPi / 4.0) * R * R * c.L;
        int nIn = 0, nOut = 0;
        for (TopExp_Explorer x(shape, TopAbs_FACE); x.More(); x.Next()) ++nIn;
        for (TopExp_Explorer x(sol, TopAbs_FACE); x.More(); x.Next()) ++nOut;
        std::vector<RingSeg> sgA, sgB; bool stA = false, stB = false;
        orderedOuterRing(c.A, sgA, stA);
        orderedOuterRing(c.B, sgB, stB);
        std::fprintf(stderr,
            "[occtfillet] filletOneEdge R=%.10g L=%.10g dih_deg=%.6f convex=%d s=%.10g "
            "v0=%.10g v1=%.10g dv=%.10g ideal90=%.10g ratio=%.6f "
            "nfaces_in=%d nfaces_shell=%d nfaces_out=%d ringA=%d ringB=%d "
            "areaA=%.10g areaB=%.10g\n",
            R, c.L, c.dihedral * 180.0 / kPi, c.convex ? 1 : 0, s, v0, v1, v1 - v0,
            ideal90, ideal90 > 0.0 ? std::fabs(v1 - v0) / ideal90 : -1.0,
            nIn, static_cast<int>(faces.size()), nOut,
            static_cast<int>(sgA.size()), static_cast<int>(sgB.size()),
            areaOf(c.A), areaOf(c.B));
    }
    if (v0 > 0.0) {
        if (c.convex && !(v1 < v0))
            return defer("convex fillet did not remove material (orientation/geometry check failed)");
        if (!c.convex && !(v1 > v0))
            return defer("concave fillet did not add material (orientation/geometry check failed)");
        if (std::fabs(c.dihedral - 0.5 * kPi) < 1e-3) {
            const double moved = (1.0 - kPi / 4.0) * R * R * c.L;
            if (moved > 0.0 && std::fabs(std::fabs(v1 - v0) - moved) / moved > 0.03)
                return defer("fillet volume disagrees with (1-π/4)R²L self-check");
        }
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = c.convex ? "native rolling-ball fillet (planar-planar convex straight edge)"
                        : "native rolling-ball fillet (planar-planar CONCAVE straight edge)";
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
        s.isFillet = rq.isFillet;
        if (rq.isFillet) {
            if (!(rq.R > 0.0)) return defer("non-positive fillet radius");
            const double halfTan = std::tan(0.5 * s.c.dihedral);
            if (!(halfTan > 1e-9)) return defer("degenerate dihedral");
            s.R = rq.R;
            s.q = rq.R / halfTan;
            s.axis0 = shift(shift(s.c.P0, s.c.tA, s.q), axisOffsetDir(s.c), rq.R);
        } else {
            if (!(rq.d > 0.0)) return defer("non-positive chamfer distance");
            s.q = rq.d;
        }
        if (!setbackFitsFaces(s.c, s.q, s.q, why)) return defer(why);
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
            // The trihedral corner patch is derived for a CONVEX polyhedral corner:
            // the ball centre solve below places C at depth R INSIDE all three faces,
            // and the octant patch assumes the three blends meet there. A corner where
            // any incident blend is CONCAVE is a different surface (the sphere would
            // have to sit outside at least one face) and is NOT authored — defer
            // rather than emit a plausible-looking wrong solid.
            for (int si : v.specs)
                if (!sp[std::size_t(si)].c.convex)
                    return defer("a trihedral corner with a CONCAVE incident blend is not "
                                 "authored — deferring");
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
                    rep.arcCtr = shift(rep.pa, axisOffsetDir(s.c), s.R);
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
    const TopoDS_Shape sol = sewToSolid(faces, shape);
    if (sol.IsNull()) return defer("corner-aware blend produced no closed solid");
    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (!(v1 > 0.0))  return defer("corner-aware blend produced a non-positive volume");

    // DIRECTION + MAGNITUDE self-check. The old test was `v1 < v0`, which is only
    // right while every blend is convex. With CONCAVE edges in the set the sign is
    // per-edge, so the test becomes:
    //   * all-convex  -> the result MUST be smaller;
    //   * all-concave -> the result MUST be larger;
    //   * mixed       -> the sign is genuinely indeterminate, so only the BOUND
    //                    applies.
    // The bound holds in every case and is what actually catches the failure this
    // check exists for: a face-orientation slip hands back the COMPLEMENT region,
    // whose volume differs from v0 by orders of magnitude, not by a blend's worth.
    // Σ|cross-section|·L over the requested edges over-counts (corner patches make
    // the true change smaller), so it is a genuine upper bound; the 1.5 slack
    // absorbs a chamfer's ½dAdB·sin form and the corner overlap in the other
    // direction. This is a gross-error trap, not a precision test — the A/B against
    // OCCT is the precision test.
    bool anyConvex = false, anyConcave = false;
    double bound = 0.0;
    for (const BSpec& s : sp) {
        if (s.c.convex) anyConvex = true; else anyConcave = true;
        const double area = s.isFillet ? blendCrossSection(s.c, s.R)
                                       : 0.5 * s.q * s.q * std::sin(s.c.dihedral);
        bound += std::fabs(area) * s.c.L;
    }
    if (!anyConcave && !(v1 < v0)) return defer("corner-aware convex blend removed no material");
    if (!anyConvex  && !(v1 > v0)) return defer("corner-aware concave blend added no material");
    if (bound > 0.0 && std::fabs(v1 - v0) > 1.5 * bound)
        return defer("corner-aware blend volume change exceeds the per-edge bound");

    Result r; r.ok = true; r.shape = sol;
    r.reason = sp[0].isFillet ? "native corner-aware fillet (trihedral spherical blend)"
                              : "native corner-aware chamfer (trihedral planar corner)";
    if (anyConcave) r.reason += " + concave blends";
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

// ============================ TANGENT-CONTINUOUS RIM =========================
// ★ MEASURED 2026-08-30 over the 600-part corpus A/B, and it is the LARGEST single
//   cause left in the FILLET deletion bucket: 58 of the 117 parts OCCT blends and
//   this engine declined, every one of them with the same guard text ("end face not
//   planar") and the same geometry.
//
//   WHAT THOSE PARTS ARE. One population, no spread. The picked edge is the longest
//   straight segment of a PRISMATIC CAP's outer rim: a planar cap face whose outer
//   ring is `Circle,Line,Circle,Line,Circle,Line,Circle,Line` — a rounded rectangle
//   — G1-TANGENT at all eight junctions (measured worst deviation 0.000e+00 over
//   58/58), with a planar wall behind every line and a quarter-cylinder behind every
//   arc (axis parallel to the cap normal, radius equal to the arc's, 232/232 of them
//   with a four-segment `LCLC` ring and no inner wire), and 4-10 holes in the cap
//   preserved verbatim.
//
//   WHY THE PER-EDGE ENGINE CANNOT ANSWER IT. `filletOneEdge` terminates a blend by
//   CLIPPING the face at each endpoint with the blend's end arc, which requires that
//   face to be planar. Here the face at each endpoint is the corner cylinder, so the
//   guard fires — correctly. And the right answer is not a clipped one-edge blend at
//   all: the rim is tangent-continuous, so OCCT's BRepFilletAPI PROPAGATES the
//   contour around the whole loop. Measured: OCCT removes 2.53x to 4.11x the
//   single-edge closed form on those 58 parts. A one-edge native blend would be a
//   DIFFERENT SOLID reported as the same operation — the exact class of false win
//   the NATIVE_ONLY cell of this row turned out to be.
//
//   WHAT THIS BUILDS. The whole rim, in closed form, with no approximation:
//     * the cap, re-trimmed to its own outer ring OFFSET INWARD BY R — each line
//       moves R along its in-plane inward normal, each arc keeps its centre and
//       takes radius rho-R; tangency makes the two agree at every junction, so the
//       offset ring is exact and the holes are untouched;
//     * every wall face pulled back R from the cap plane (planar walls re-trimmed
//       through the existing ring machinery, cylindrical walls rebuilt as the
//       canonical uv patch they are);
//     * one Geom_CylindricalSurface patch per line segment (the existing
//       filletCylinder), and one Geom_ToroidalSurface patch per arc segment —
//       centre R below the cap, major radius rho-R, minor radius R, v in [0, pi/2],
//       which is tangent to the wall at v=0 and to the offset cap at v=pi/2.
//   Every surface is analytic; nothing is approximated or fitted.
//
//   THE SELF-CHECK IS AN INDEPENDENT CLOSED FORM, not a tolerance on the input:
//       |dV| = SUM_lines (1 - pi/4) R^2 L
//            + SUM_arcs  theta * [ R^2(2rho-R)/2 - R^3/3 - (rho-R) pi R^2/4 ]
//   the second term being Pappus applied to the same kite-minus-quarter-disc
//   section swept about the corner axis. Verified against live OCCT on an exactly
//   built rounded-rectangle prism to 1.9e-15 relative, and against OCCT's answer on
//   all 58 corpus parts to 7.5e-4 (OCCT's own approximation on STEP extrusion
//   surfaces; see run_ab_native_fillet_rim.sh).
//
//   SCOPE, and it defers on everything else: the ring must be closed, all-line-or-
//   arc, tangent at every junction, carry at least one arc (a polygon rim is NOT a
//   propagating contour and must keep the per-edge path), CONVEX throughout, with
//   every wall used exactly once, rho > R, and every wall at least R deep.

// A cylindrical face in ANY representation. The corpus's prismatic walls arrive
// from STEP as Geom_SurfaceOfLinearExtrusion of a circle, which is a cylinder in
// every measurable sense and which a GeomAbs_Cylinder test alone would refuse —
// the same lesson planarFaceNormal records for planes.
bool cylinderFaceAxis(const TopoDS_Face& f, gp_Ax1& axis, double& radius) {
    BRepAdaptor_Surface as(f);
    if (as.GetType() == GeomAbs_Cylinder) {
        const gp_Cylinder c = as.Cylinder();
        axis = c.Axis(); radius = c.Radius();
        return radius > kTol;
    }
    if (as.GetType() != GeomAbs_SurfaceOfExtrusion) return false;
    Handle(Geom_Surface) gs = BRep_Tool::Surface(f);
    Handle(Geom_SurfaceOfLinearExtrusion) ex = Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(gs);
    if (ex.IsNull()) return false;
    Handle(Geom_Curve) bc = ex->BasisCurve();
    while (!bc.IsNull()) {
        Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(bc);
        if (tc.IsNull()) break;
        bc = tc->BasisCurve();
    }
    Handle(Geom_Circle) gc = Handle(Geom_Circle)::DownCast(bc);
    if (gc.IsNull()) return false;
    const gp_Circ c0 = gc->Circ();
    radius = c0.Radius();
    if (!(radius > kTol)) return false;
    axis = gp_Ax1(c0.Location(), ex->Direction());
    return true;
}

// One segment of the rim.
struct RimSeg {
    TopoDS_Edge edge;
    TopoDS_Face wall;          // the face on the other side of this rim edge
    bool   isArc = false;
    gp_Pnt p0, p1;             // ends, in ring traversal order
    gp_Dir dir;                // line only: p0 -> p1
    double len = 0.0;          // line only
    gp_Pnt ctr;                // arc only: centre (in the cap plane)
    double rho = 0.0;          // arc only: radius
    double theta = 0.0;        // arc only: swept angle
    gp_Pnt off0, off1;         // ends of the INWARD-OFFSET ring
};

struct RimContext {
    TopoDS_Face cap;
    gp_Pln  capPln;
    gp_Dir  nCap;              // outward
    std::vector<RimSeg> segs;
    int     nLine = 0, nArc = 0;
    double  predictedDv = 0.0; // the closed form above
    double  bandArea = 0.0;    // area the cap loses to the offset
};

// |dV| of ONE convex corner arc per unit angle: the section moment about the axis.
inline double rimCornerMoment(double rho, double R) {
    return R * R * (2.0 * rho - R) * 0.5 - R * R * R / 3.0 - (rho - R) * kPi * R * R * 0.25;
}

// Unit tangent of a ring edge at its START / END, in TRAVERSAL direction.
bool ringTangents(const TopoDS_Edge& e, gp_Vec& tStart, gp_Vec& tEnd) {
    BRepAdaptor_Curve ac;
    try { ac.Initialize(e); } catch (...) { return false; }
    gp_Pnt p; gp_Vec d;
    const bool rev = (e.Orientation() == TopAbs_REVERSED);
    ac.D1(rev ? ac.LastParameter() : ac.FirstParameter(), p, d);
    if (d.Magnitude() <= kTol) return false;
    tStart = rev ? -d : d;
    ac.D1(rev ? ac.FirstParameter() : ac.LastParameter(), p, d);
    if (d.Magnitude() <= kTol) return false;
    tEnd = rev ? -d : d;
    tStart.Normalize(); tEnd.Normalize();
    return true;
}

// Resolve the rim: which of the picked edge's two faces is the prismatic CAP, and
// what does its outer ring consist of. Empty `why` on success.
bool buildRimContext(const TopoDS_Shape& shape, const TopoDS_Edge& edge, double R,
                     RimContext& rc, std::string& why) {
    if (!(R > 0.0)) { why = "non-positive fillet radius"; return false; }
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
    if (!efMap.Contains(edge)) { why = "rim: edge not found in shape"; return false; }
    const TopTools_ListOfShape& fl0 = efMap.FindFromKey(edge);
    if (fl0.Extent() != 2) { why = "rim: edge is not shared by exactly two faces"; return false; }
    TopTools_ListIteratorOfListOfShape it0(fl0);
    const TopoDS_Face C0 = TopoDS::Face(it0.Value()); it0.Next();
    const TopoDS_Face C1 = TopoDS::Face(it0.Value());
    if (C0.IsSame(C1)) { why = "rim: periodic seam, one face twice"; return false; }

    why = "rim: neither adjacent face is a prismatic cap";
    for (int k = 0; k < 2; ++k) {
        const TopoDS_Face CAP = (k == 0) ? C0 : C1;
        gp_Pln pln; gp_Dir nCap;
        if (!planarFaceNormal(CAP, pln, nCap)) continue;
        const TopoDS_Wire ow = BRepTools::OuterWire(CAP);
        if (ow.IsNull()) continue;

        std::vector<TopoDS_Edge> ring;
        std::vector<gp_Pnt>      start;
        for (BRepTools_WireExplorer wx(ow, CAP); wx.More(); wx.Next()) {
            ring.push_back(wx.Current());
            start.push_back(BRep_Tool::Pnt(wx.CurrentVertex()));
        }
        const std::size_t n = ring.size();
        if (n < 3) continue;
        bool carries = false;
        for (const TopoDS_Edge& re : ring) if (re.IsSame(edge)) { carries = true; break; }
        if (!carries) continue;

        // Every junction must be G1: that, and only that, is what makes OCCT
        // propagate the contour. A polygon rim (a plain box lid) fails here and
        // keeps the per-edge path, which is what already serves it.
        bool tangentAll = true;
        for (std::size_t i = 0; i < n && tangentAll; ++i) {
            gp_Vec a0, a1, b0, b1;
            if (!ringTangents(ring[i], a0, a1) || !ringTangents(ring[(i + 1) % n], b0, b1))
            { tangentAll = false; break; }
            if (std::fabs(1.0 - a1.Dot(b0)) > 1e-6) tangentAll = false;
        }
        if (!tangentAll) { why = "rim: the cap's outer ring is not tangent-continuous "
                                 "(not a propagating contour) — keeping the per-edge path"; continue; }

        // Ring winding: interior is to the LEFT of travel when the ring runs CCW
        // about the OUTWARD normal.
        const double wind = ringNormal(start).Dot(gp_Vec(nCap)) >= 0.0 ? 1.0 : -1.0;

        RimContext c;
        c.cap = CAP; c.capPln = pln; c.nCap = nCap;
        bool ok = true;
        std::vector<TopoDS_Face> usedWalls;
        for (std::size_t i = 0; i < n && ok; ++i) {
            const TopoDS_Edge re = ring[i];
            RimSeg sg;
            sg.edge = re;
            sg.p0 = start[i];
            sg.p1 = start[(i + 1) % n];
            if (!efMap.Contains(re)) { why = "rim: ring edge not in the shape map"; ok = false; break; }
            const TopTools_ListOfShape& fl = efMap.FindFromKey(re);
            if (fl.Extent() != 2) { why = "rim: a ring edge is not 2-manifold"; ok = false; break; }
            for (TopTools_ListIteratorOfListOfShape i2(fl); i2.More(); i2.Next())
                if (!TopoDS::Face(i2.Value()).IsSame(CAP)) sg.wall = TopoDS::Face(i2.Value());
            if (sg.wall.IsNull()) { why = "rim: a ring edge closes onto the cap itself"; ok = false; break; }
            for (const TopoDS_Face& w : usedWalls)
                if (w.IsSame(sg.wall)) { why = "rim: one wall carries two rim segments"; ok = false; }
            if (!ok) break;
            usedWalls.push_back(sg.wall);

            BRepAdaptor_Curve ac;
            try { ac.Initialize(re); } catch (...) { why = "rim: unreadable ring edge"; ok = false; break; }
            if (ac.GetType() == GeomAbs_Line) {
                gp_Pln pw; gp_Dir nw;
                if (!planarFaceNormal(sg.wall, pw, nw))
                { why = "rim: the wall behind a straight rim segment is not planar"; ok = false; break; }
                if (std::fabs(gp_Vec(nw).Dot(gp_Vec(nCap))) > 1e-6)
                { why = "rim: a wall is not prismatic to the cap"; ok = false; break; }
                const gp_Vec v(sg.p0, sg.p1);
                if (v.Magnitude() <= kTol) { why = "rim: degenerate straight segment"; ok = false; break; }
                sg.isArc = false;
                sg.dir = gp_Dir(v);
                sg.len = sg.p0.Distance(sg.p1);
                // inward in-plane normal, fixed by the ring's winding
                gp_Vec m = gp_Vec(nCap).Crossed(gp_Vec(sg.dir)) * wind;
                if (m.Magnitude() <= kTol) { why = "rim: degenerate segment frame"; ok = false; break; }
                m.Normalize();
                // CONVEX: the wall's outward normal must point AWAY from the interior.
                if (m.Dot(gp_Vec(nw)) > -1e-9)
                { why = "rim: a rim segment is not convex"; ok = false; break; }
                sg.off0 = shift(sg.p0, gp_Dir(m), R);
                sg.off1 = shift(sg.p1, gp_Dir(m), R);
                c.predictedDv += (1.0 - kPi / 4.0) * R * R * sg.len;
                c.bandArea    += R * sg.len;
                ++c.nLine;
            } else if (ac.GetType() == GeomAbs_Circle) {
                gp_Ax1 ax; double rad = 0.0;
                if (!cylinderFaceAxis(sg.wall, ax, rad))
                { why = "rim: the wall behind a rim arc is not a cylinder"; ok = false; break; }
                if (std::fabs(std::fabs(gp_Vec(ax.Direction()).Dot(gp_Vec(nCap))) - 1.0) > 1e-6)
                { why = "rim: a corner cylinder's axis is not parallel to the cap normal"; ok = false; break; }
                const gp_Circ ci = ac.Circle();
                sg.isArc = true;
                sg.ctr   = ci.Location();
                sg.rho   = ci.Radius();
                if (std::fabs(sg.rho - rad) > 1e-6 * std::max(1.0, sg.rho))
                { why = "rim: rim arc radius differs from its wall cylinder"; ok = false; break; }
                if (!(sg.rho > R + kTol))
                { why = "rim: the corner radius is not larger than the fillet radius"; ok = false; break; }
                sg.theta = std::fabs(ac.LastParameter() - ac.FirstParameter());
                if (!(sg.theta > kTol) || sg.theta > 2.0 * kPi + kTol)
                { why = "rim: unreadable arc sweep"; ok = false; break; }
                // The offset ring is rebuilt through planarFaceFromSegs's MINOR-arc
                // path, which derives the circle axis from the two endpoints — exact
                // below a half turn, ambiguous at exactly pi (a stadium / slot rim)
                // and wrong above it. Decline rather than take the wrong branch.
                // Every rim arc measured on the corpus is a quarter turn, so this
                // costs no coverage there; the cap-AREA identity below is the backstop.
                if (!(sg.theta < kPi - kTol))
                { why = "rim: a corner arc sweeps half a turn or more"; ok = false; break; }
                // CONVEX corner: both ends must be rho from the centre, and the centre
                // must lie on the material side (the offset shrinks the arc).
                if (std::fabs(sg.ctr.Distance(sg.p0) - sg.rho) > 1e-6 * std::max(1.0, sg.rho) ||
                    std::fabs(sg.ctr.Distance(sg.p1) - sg.rho) > 1e-6 * std::max(1.0, sg.rho))
                { why = "rim: a rim arc's ends are not on its own circle"; ok = false; break; }
                {
                    // the inward normal at p0 points from p0 TOWARD the centre on a
                    // convex corner; check it against the ring winding
                    gp_Vec a0, a1;
                    if (!ringTangents(re, a0, a1)) { why = "rim: unreadable arc tangent"; ok = false; break; }
                    gp_Vec m = gp_Vec(nCap).Crossed(a0) * wind;
                    if (m.Magnitude() <= kTol) { why = "rim: degenerate arc frame"; ok = false; break; }
                    m.Normalize();
                    if (m.Dot(gp_Vec(sg.p0, sg.ctr)) <= 0.0)
                    { why = "rim: a corner arc is concave"; ok = false; break; }
                }
                sg.off0 = shift(sg.p0, gp_Dir(gp_Vec(sg.p0, sg.ctr)), R);
                sg.off1 = shift(sg.p1, gp_Dir(gp_Vec(sg.p1, sg.ctr)), R);
                c.predictedDv += sg.theta * rimCornerMoment(sg.rho, R);
                c.bandArea    += 0.5 * sg.theta * (sg.rho * sg.rho - (sg.rho - R) * (sg.rho - R));
                ++c.nArc;
            } else {
                why = "rim: the cap's outer ring carries a curve that is neither line nor arc";
                ok = false; break;
            }
            c.segs.push_back(sg);
        }
        if (!ok) continue;
        if (c.nArc == 0) {
            why = "rim: an all-straight ring is not a propagating contour — keeping the per-edge path";
            continue;
        }
        // every wall must be at least R deep, and no wall vertex may sit INSIDE the
        // band the retrim is about to sweep through
        for (const RimSeg& sg : c.segs) {
            const TopoDS_Wire wo = BRepTools::OuterWire(sg.wall);
            if (wo.IsNull()) { why = "rim: a wall has no outer wire"; ok = false; break; }
            // Depth first, THEN the band. Both guards are reachable only in this
            // order: a wall shallower than R has every vertex inside the band, so a
            // band test placed first would answer every shallow wall with the wrong
            // sentence and leave the depth test dead code.
            double deepest = 0.0;
            for (TopExp_Explorer vx(wo, TopAbs_VERTEX); vx.More(); vx.Next()) {
                const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
                const double d = gp_Vec(pln.Location(), p).Dot(gp_Vec(nCap));
                if (d > kTol) { why = "rim: a wall reaches past the cap plane"; ok = false; break; }
                deepest = std::min(deepest, d);
            }
            if (!ok) break;
            if (!(deepest < -R - kTol))
            { why = "rim: a wall is shallower than the fillet radius"; ok = false; break; }
            for (TopExp_Explorer vx(wo, TopAbs_VERTEX); vx.More(); vx.Next()) {
                const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
                const double d = gp_Vec(pln.Location(), p).Dot(gp_Vec(nCap));
                if (d < -kTol && d > -R - kTol)
                { why = "rim: a wall feature lies inside the blend band"; ok = false; break; }
            }
            if (!ok) break;
        }
        if (!ok) continue;
        rc = c;
        why.clear();
        return true;
    }
    return false;
}

// The corner blend: a torus tangent to the wall cylinder at v=0 and to the offset
// cap at v=pi/2. Null face on failure (caller defers).
TopoDS_Face rimTorus(const RimSeg& sg, const gp_Dir& nCap, double R) {
    const gp_Pnt O = shift(sg.ctr, gp_Dir(gp_Vec(nCap).Reversed()), R);
    // X so that u=0 is the arc's p0 (or its p1 when the sweep runs the other way).
    for (int flip = 0; flip < 2; ++flip) {
        const gp_Pnt& a = flip == 0 ? sg.p0 : sg.p1;
        const gp_Pnt& b = flip == 0 ? sg.p1 : sg.p0;
        gp_Vec xv(sg.ctr, a);
        xv -= gp_Vec(nCap) * xv.Dot(gp_Vec(nCap));
        if (xv.Magnitude() <= kTol) return TopoDS_Face();
        const gp_Dir X(xv);
        const gp_Vec Y = gp_Vec(nCap).Crossed(gp_Vec(X));
        gp_Vec bv(sg.ctr, b);
        bv -= gp_Vec(nCap) * bv.Dot(gp_Vec(nCap));
        double ub = std::atan2(bv.Dot(Y), bv.Dot(gp_Vec(X)));
        if (ub < 0.0) ub += 2.0 * kPi;
        if (std::fabs(ub - sg.theta) > 1e-6) continue;   // the sweep runs the other way
        const gp_Ax3 ax(O, nCap, X);
        Handle(Geom_ToroidalSurface) tor = new Geom_ToroidalSurface(ax, sg.rho - R, R);
        BRepBuilderAPI_MakeFace mf(tor, 0.0, sg.theta, 0.0, 0.5 * kPi, Precision::Confusion());
        if (!mf.IsDone()) return TopoDS_Face();
        TopoDS_Face f = mf.Face();
        BRepLib::SameParameter(f, 1e-7, Standard_True);
        return f;
    }
    return TopoDS_Face();
}

// A cylindrical wall pulled back R from the cap plane. Rebuilt as the canonical uv
// patch it is; the AREA identity below is what proves the original face WAS that
// patch, so a wall carrying anything else is declined rather than silently reshaped.
TopoDS_Face rimTrimCylWall(const RimSeg& sg, const gp_Pln& capPln, const gp_Dir& nCap, double R) {
    gp_Ax1 ax; double rad = 0.0;
    if (!cylinderFaceAxis(sg.wall, ax, rad)) return TopoDS_Face();
    for (TopoDS_Iterator it(sg.wall); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_WIRE) continue;
        if (!TopoDS::Wire(it.Value()).IsSame(BRepTools::OuterWire(sg.wall))) return TopoDS_Face();
    }
    // measure the wall's extent along +nCap from the axis location
    const TopoDS_Wire wo = BRepTools::OuterWire(sg.wall);
    if (wo.IsNull()) return TopoDS_Face();
    double vmin = 1e300, vmax = -1e300;
    for (TopExp_Explorer vx(wo, TopAbs_VERTEX); vx.More(); vx.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
        const double v = gp_Vec(sg.ctr, p).Dot(gp_Vec(nCap));
        vmin = std::min(vmin, v); vmax = std::max(vmax, v);
    }
    if (!(vmax - vmin > R + kTol)) return TopoDS_Face();
    if (std::fabs(vmax) > 1e-6) return TopoDS_Face();     // the top must be the cap plane
    (void)capPln;
    // the original face must be exactly the uv box rho*theta*(vmax-vmin)
    const double aOld = areaOf(sg.wall);
    const double aBox = sg.rho * sg.theta * (vmax - vmin);
    if (!(aBox > 0.0) || std::fabs(aOld - aBox) > 1e-6 * aBox) return TopoDS_Face();

    for (int flip = 0; flip < 2; ++flip) {
        const gp_Pnt& a = flip == 0 ? sg.p0 : sg.p1;
        const gp_Pnt& b = flip == 0 ? sg.p1 : sg.p0;
        gp_Vec xv(sg.ctr, a);
        xv -= gp_Vec(nCap) * xv.Dot(gp_Vec(nCap));
        if (xv.Magnitude() <= kTol) return TopoDS_Face();
        const gp_Dir X(xv);
        const gp_Vec Y = gp_Vec(nCap).Crossed(gp_Vec(X));
        gp_Vec bv(sg.ctr, b);
        bv -= gp_Vec(nCap) * bv.Dot(gp_Vec(nCap));
        double ub = std::atan2(bv.Dot(Y), bv.Dot(gp_Vec(X)));
        if (ub < 0.0) ub += 2.0 * kPi;
        if (std::fabs(ub - sg.theta) > 1e-6) continue;
        const gp_Ax3 axc(sg.ctr, nCap, X);
        Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(axc, sg.rho);
        BRepBuilderAPI_MakeFace mf(cyl, 0.0, sg.theta, vmin, vmax - R, Precision::Confusion());
        if (!mf.IsDone()) return TopoDS_Face();
        TopoDS_Face f = mf.Face();
        BRepLib::SameParameter(f, 1e-7, Standard_True);
        const double aNew = areaOf(f);
        const double aWant = sg.rho * sg.theta * (vmax - R - vmin);
        if (std::fabs(aNew - aWant) > 1e-6 * aWant) return TopoDS_Face();
        return f;
    }
    return TopoDS_Face();
}

// A planar wall pulled back R: every ring vertex sitting IN the cap plane drops by R.
TopoDS_Face rimTrimPlanarWall(const TopoDS_Face& wall, const gp_Pln& capPln,
                              const gp_Dir& nCap, double R) {
    gp_Pln pw; gp_Dir nw;
    if (!planarFaceNormal(wall, pw, nw)) return TopoDS_Face();
    std::vector<RingSeg> segs; bool straight = false;
    if (!orderedOuterRing(wall, segs, straight) || !ringIsRebuildable(segs, straight))
        return TopoDS_Face();
    int moved = 0;
    for (RingSeg& sg : segs) {
        if (std::fabs(gp_Vec(capPln.Location(), sg.p).Dot(gp_Vec(nCap))) <= 1e-6) {
            sg.p = shift(sg.p, gp_Dir(gp_Vec(nCap).Reversed()), R);
            ++moved;
        }
    }
    if (moved < 2) return TopoDS_Face();
    return planarFaceFromSegs(segs, pw, nw, innerWires(wall));
}

// The whole rim blend. ok==false is an honest deferral, as everywhere else here.
Result filletTangentRim(const TopoDS_Shape& shape, const FilletSpec& spec) {
    RimContext rc; std::string why;
    if (!buildRimContext(shape, spec.edge, spec.radius, rc, why)) return defer(why);
    const double R = spec.radius;

    std::vector<TopoDS_Face> faces;

    // 1. the cap, offset inward by R
    {
        std::vector<RingSeg> segs;
        for (const RimSeg& sg : rc.segs) {
            RingSeg r;
            r.p = sg.off0;
            if (sg.isArc) { r.newArc = true; r.arcCtr = sg.ctr; r.arcR = sg.rho - R; }
            segs.push_back(r);
        }
        const TopoDS_Face capNew = planarFaceFromSegs(segs, rc.capPln, rc.nCap, innerWires(rc.cap));
        if (capNew.IsNull()) return defer("rim: the offset cap ring would not rebuild");
        // AREA, not volume: a hole that the offset ring ran into changes the cap's
        // area and nothing else, and a wrong cap can still close a plausible solid.
        const double aOld = areaOf(rc.cap), aNew = areaOf(capNew);
        if (!(aOld > 0.0)) return defer("rim: unreadable cap area");
        if (std::fabs((aOld - aNew) - rc.bandArea) > 1e-6 * aOld)
            return defer("rim: the offset cap did not lose exactly the blend band "
                         "(a hole or a boundary lies inside it)");
        faces.push_back(capNew);
    }

    // 2. the walls, pulled back R
    for (const RimSeg& sg : rc.segs) {
        const TopoDS_Face w = sg.isArc ? rimTrimCylWall(sg, rc.capPln, rc.nCap, R)
                                       : rimTrimPlanarWall(sg.wall, rc.capPln, rc.nCap, R);
        if (w.IsNull()) return defer(sg.isArc ? "rim: a corner cylinder wall would not re-trim"
                                              : "rim: a planar wall would not re-trim");
        faces.push_back(w);
    }

    // 3. the blend patches
    for (const RimSeg& sg : rc.segs) {
        if (sg.isArc) {
            const TopoDS_Face t = rimTorus(sg, rc.nCap, R);
            if (t.IsNull()) return defer("rim: the corner torus patch would not build");
            faces.push_back(t);
        } else {
            const gp_Dir down(gp_Vec(rc.nCap).Reversed());
            const gp_Pnt axis0 = shift(sg.off0, down, R);
            const gp_Pnt sB0   = shift(sg.p0,  down, R);
            const TopoDS_Face cy = filletCylinder(axis0, sg.dir, R, sg.off0, sB0, sg.len);
            if (cy.IsNull()) return defer("rim: a straight blend patch would not build");
            faces.push_back(cy);
        }
    }

    // 4. everything else verbatim
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        const TopoDS_Face f = TopoDS::Face(fe.Current());
        if (f.IsSame(rc.cap)) continue;
        bool isWall = false;
        for (const RimSeg& sg : rc.segs) if (f.IsSame(sg.wall)) { isWall = true; break; }
        if (!isWall) faces.push_back(f);
    }

    const TopoDS_Shape sol = sewToSolid(faces, shape);
    if (sol.IsNull()) return defer("rim: sew produced no closed solid");

    const double v0 = solidVolume(shape), v1 = solidVolume(sol);
    if (v0 > 0.0) {
        if (!(v1 < v0)) return defer("rim: the blend did not remove material "
                                     "(orientation/geometry check failed)");
        const double moved = v0 - v1;
        if (!(rc.predictedDv > 0.0)) return defer("rim: degenerate closed form");
        // ★ 1e-6, not the per-edge path's 3%: this construction is EXACT (analytic
        //   surfaces throughout, and an offset ring that reproduces the profile
        //   rather than approximating it), and the measurement says so — over the 58
        //   corpus parts the removed volume agrees with the closed form to the last
        //   printed digit on 58/58. A loose bar here would let a wrong patch through
        //   on a shape whose error happened to be small.
        if (std::fabs(moved - rc.predictedDv) / rc.predictedDv > 1e-6)
            return defer("rim: blend volume disagrees with the rim closed form");
    }
    Result r; r.ok = true; r.shape = sol;
    r.reason = "native rim fillet (tangent-continuous prismatic rim: " +
               std::to_string(rc.nLine) + " cylinder + " + std::to_string(rc.nArc) + " torus patches)";
    return r;
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
    int applied = 0;
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
            ++applied;
            first = false;
        }
    } catch (...) {
        seq = defer("native chamfer raised an OCCT exception");
    }
    // Skipping a tangent no-op is right in a MIXED request (one seam edge must not
    // kill the real edges beside it). Skipping EVERY edge is not a chamfer: `work`
    // is still the untouched input, and returning it with ok==true reports a
    // chamfer that did nothing as a chamfer that worked. See makeFillet below for
    // the measurement that found this.
    if (seq.ok && applied == 0)
        seq = defer("every requested chamfer edge is a tangent no-op (a periodic seam "
                    "or a coplanar artefact edge) — nothing to bevel");
    if (seq.ok) {
        seq.shape = work;
        seq.reason = "native chamfer (prismatic straight edges)";
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
    int applied = 0;
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
            ++applied;
            first = false;
        }
    } catch (...) {
        seq = defer("native fillet raised an OCCT exception");
    }
    // ★ MEASURED 2026-08-30 over the 600-part corpus A/B — the whole NATIVE_ONLY
    //   cell of the FILLET row. Skipping a tangent no-op is right in a MIXED
    //   request: one periodic seam or coplanar boolean artefact must not kill the
    //   real edges beside it. But when EVERY requested edge is skipped, `work` is
    //   still the untouched input, `seq.ok` was never cleared, and this returned
    //   the caller's own shape with ok==true and the reason "native fillet
    //   (prismatic straight edges)" — a fillet that did nothing, reported as a
    //   fillet that worked.
    //   That is not an edge case in the measurement: it was 51 of the corpus's
    //   600 parts, every one of them scored a NATIVE_ONLY win over OCCT (which
    //   declines the same request outright), and every one of them returned a
    //   volume BIT-IDENTICAL to the input. It is 8.5 of the 32.8 points the FILLET
    //   row credited to this engine.
    //   Reproduced in three lines with no corpus at all: a plain
    //   BRepPrimAPI_MakeCylinder(5,20), whose longest LINE edge is the u-wrap seam
    //   where one face meets itself — see test/fillet_defer_census.cpp's SEAM
    //   control, and forge-kernel/test/run_ab_native_fillet_concave.sh.
    //   The honest answers at such an edge are "declined" or "applied"; "the input,
    //   unchanged, called a success" is neither, and under
    //   FORGE_FILLET_DROP_NATIVE it would silently discard the user's fillet.
    if (seq.ok && applied == 0)
        seq = defer("every requested fillet edge is a tangent no-op (a periodic seam "
                    "or a coplanar artefact edge) — nothing to blend");
    if (seq.ok) { seq.shape = work; seq.reason = "native fillet (prismatic straight edges)"; return seq; }
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
    // ★ The TANGENT-CONTINUOUS PRISMATIC RIM — see the block above filletTangentRim
    //   for the measurement that motivates it. Tried LAST, on purpose: nothing the
    //   per-edge or corner-aware paths already answer can change, because this runs
    //   only where BOTH declined. It then fires only where the cap's outer ring is a
    //   closed G1 loop carrying at least one arc — which is exactly the condition
    //   under which OCCT's BRepFilletAPI propagates the contour, so it does not
    //   substitute a rim blend for a request the per-edge path would have answered.
    if (uspecs.size() == 1) {
        try {
            Result rim = filletTangentRim(shape, uspecs.front());
            if (rim.ok) return rim;
            seq.reason += " | " + rim.reason;
        } catch (...) {
            seq.reason += " | rim path raised an OCCT exception";
        }
    }
    debugDefer("fillet", seq.reason);
    return seq;
}

}  // namespace occtfillet
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
