// offsetshape_defer_census.cpp — WHY does family H (OFFSETSHAPE) defer, and how
// much of that column has a BOUNDED fix?
//
// THE QUESTION. The 600-part corpus A/B (reports/CORPUS_AB_COVERAGE.md §3)
// measured OFFSETSHAPE at native 1.2% against OCCT 6.3%, with a bucket split
//
//     BOTH_OK 0   OCCT_ONLY 38   NATIVE_ONLY 7   NEITHER 555
//
// and two unexplained facts: 593 native defers with no attribution at all, and
// a BOTH_OK of ZERO — a reference implementation and its replacement answering
// DISJOINT sets of parts, which is not what those two things normally look like.
//
// METHOD. Attribution comes from the ENGINE'S OWN defer trail
// (forge::occtoffset::lastOffsetDeferReason, the same channel
// test/corpus_ab_coverage.cpp records into the A/B's `note` field), never from a
// re-implementation of its predicates here. A census that re-derives the guards
// drifts away from the engine it is measuring and then reports the drift as a
// finding. The part derivation is copied VERBATIM from corpus_ab_coverage.cpp
// (boundsOf, the flat/minExt scale fallback, family H's d = 0.02 * scale), so
// the input distribution is the one the A/B measured.
//
// WHAT IT FOUND, in order, each step re-measured over the same 600 parts:
//   593 defers -> 368 "a planar face's wire is not one full circle"
//                 223 "a face is not one of the five analytic surfaces"
//   Relaxing the planar wire guard to admit a LINE POLYGON (the corner solve
//   planarOffsetShape already had) moved the whole 368 forward to a new wall:
//   227 "the two offset meridians do not meet", ALL of them plane+plane — a
//   full circle IMPRINTED across a split coplanar face, where the correct offset
//   edge is the edge riding its own surface. 7 -> 36.
//   Then 198 "corner under 3 planes", all planes=1: IMPRINT VERTICES interior to
//   one plane, not corners at all. Rank-aware projection replaced the rank-3
//   corner solve. 36 -> 24 after the validity gate below, then unchanged.
//   Then 271 multi-body compounds, every one of them a TOUCHING assembly whose
//   union's offset is a boolean this engine does not do: DECLINED, and OCCT
//   declines all 197 of them too.
//   Remaining single-body blockers are both genuine capability gaps, not
//   predicates: 150 non-analytic surfaces and 141 arc-bearing planar profiles.
//
// CORRECTNESS IS NOT COVERAGE. 12 of the 36 results were BRepCheck INVALID
// (IntersectingWires) from inputs that were all valid — the sharp offset of a
// solid whose features are closer than 2*dist is exact face by face and still
// overlaps itself. Those are now defers, so 24 results, all valid, all grown.
//
// WHAT IS DESCRIPTIVE AND WHAT IS NOT. The geometry columns (face-kind and
// edge-curve histograms, wire shapes, manifoldness) are DESCRIPTIVE and are
// never used to classify a part — the engine's reason string is. `mixed_*` is
// explicitly a PREDICTION about a guard set, published so it can be falsified by
// building it and re-measuring; it predicted 191 eligible and 24 built, because
// it did not model multi-body compounds. It is labelled a prediction in the
// output and must never be read as a result.
//
// CONTROLS. --selftest proves, before any corpus number exists, and every
// POSITIVE one against a CLOSED FORM (a control that only asks "did something
// come back" cannot tell a correct offset from a plausible wrong one):
//   BOX          all-planar cube, the PLANAR path: (L+2d)^3.
//   CYLINDER     the quadric path's known success case: pi(R+d)^2 (H+2d).
//   HOLED_BOX    polygon boundary + circular hole, the shape the corpus is full
//                of and the one the MIXED path exists for. The bore SHRINKS while
//                the block grows: (L+2d)^3 - pi(R-d)^2 (L+2d).
//   L_PRISM      a REFLEX corner. Both notch walls slide the same way as the far
//                outer walls, so the notch TRANSLATES and keeps its size:
//                ((W+2d)(H+2d) - a*b)(T+2d). A corner solve that only handled
//                convex apexes would fail here and pass everything above.
//   ARC_BOX      a planar wire of lines AND AN ARC must still be DECLINED —
//                without it, "accept a polygon" and "accept anything" look
//                identical from the corpus numbers.
//   TWO_BODIES   two boxes far apart: the compound of the two closed forms.
//   TWO_TOUCHING the same two boxes face to face must be DECLINED — growing them
//                independently would return interpenetrating bodies.
//   NURBS_BOX    the cube through BRepBuilderAPI_NurbsConvert must be DECLINED.
//
// Modes: <part.step> (one JSON row), --selftest, --dump (full-circle edges with
// both neighbours' surface kinds), --dumpv (vertices no 3 planes pin), --check
// (what BRepCheck objects to in the result), --occt (what OCCT's own
// BRepOffsetAPI_MakeOffsetShape returns, under FOUR configurations).
// Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepCheck_Result.hxx>
#include <BRepCheck_Face.hxx>
#include <BRepCheck_ListOfStatus.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffset_Mode.hxx>
#include <string>
#include <GeomAbs_JoinType.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Line.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_SurfaceOfRevolution.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include "forge/native/brep/NativeThickSolid.hpp"

namespace {

constexpr double kPi = 3.14159265358979323846;

// ── copied verbatim from test/corpus_ab_coverage.cpp ────────────────────────
bool boundsOf(const TopoDS_Shape& s, double bb[6]) {
    bool first = true;
    for (TopExp_Explorer ex(s, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        if (first) {
            bb[0] = bb[3] = p.X(); bb[1] = bb[4] = p.Y(); bb[2] = bb[5] = p.Z();
            first = false;
        } else {
            bb[0] = std::min(bb[0], p.X()); bb[3] = std::max(bb[3], p.X());
            bb[1] = std::min(bb[1], p.Y()); bb[4] = std::max(bb[4], p.Y());
            bb[2] = std::min(bb[2], p.Z()); bb[5] = std::max(bb[5], p.Z());
        }
    }
    return !first;
}

// ── descriptive geometry (NEVER used to classify: see the banner) ───────────
Handle(Geom_Surface) basis(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) c = s;
    for (int g = 0; g < 8 && !c.IsNull(); ++g) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(c);
        if (rt.IsNull()) break;
        c = rt->BasisSurface();
    }
    return c;
}

Handle(Geom_Curve) curveBasis(const TopoDS_Edge& e) {
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    for (int g = 0; g < 8 && !c.IsNull(); ++g) {
        Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(c);
        if (tc.IsNull()) break;
        c = tc->BasisCurve();
    }
    return c;
}

enum SKind { S_PLANE = 0, S_CYL, S_CONE, S_SPH, S_TOR, S_BSPLINE, S_BEZIER,
             S_REVOL, S_EXTRU, S_OTHER, S_N };
const char* kSKindName[S_N] = {"plane", "cylinder", "cone", "sphere", "torus",
                               "bspline", "bezier", "revolution", "extrusion", "other"};

SKind kindOf(const Handle(Geom_Surface)& s) {
    if (s.IsNull()) return S_OTHER;
    if (!Handle(Geom_Plane)::DownCast(s).IsNull())                    return S_PLANE;
    if (!Handle(Geom_CylindricalSurface)::DownCast(s).IsNull())       return S_CYL;
    if (!Handle(Geom_ConicalSurface)::DownCast(s).IsNull())           return S_CONE;
    if (!Handle(Geom_SphericalSurface)::DownCast(s).IsNull())         return S_SPH;
    if (!Handle(Geom_ToroidalSurface)::DownCast(s).IsNull())          return S_TOR;
    if (!Handle(Geom_BSplineSurface)::DownCast(s).IsNull())           return S_BSPLINE;
    if (!Handle(Geom_BezierSurface)::DownCast(s).IsNull())            return S_BEZIER;
    if (!Handle(Geom_SurfaceOfRevolution)::DownCast(s).IsNull())      return S_REVOL;
    if (!Handle(Geom_SurfaceOfLinearExtrusion)::DownCast(s).IsNull()) return S_EXTRU;
    return S_OTHER;
}

enum CKind { C_LINE = 0, C_FULLCIRC, C_ARC, C_ELLIPSE, C_BSPLINE, C_OTHER, C_N };
const char* kCKindName[C_N] = {"line", "full_circle", "circle_arc", "ellipse",
                               "bspline", "other"};

CKind curveKindOf(const TopoDS_Edge& e) {
    if (BRep_Tool::Degenerated(e)) return C_OTHER;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = curveBasis(e);
    if (c.IsNull()) return C_OTHER;
    if (!Handle(Geom_Line)::DownCast(c).IsNull()) return C_LINE;
    if (!Handle(Geom_Circle)::DownCast(c).IsNull()) {
        BRep_Tool::Range(e, f, l);
        return (std::fabs(std::fabs(l - f) - 2.0 * kPi) <= 1.0e-6) ? C_FULLCIRC : C_ARC;
    }
    if (!Handle(Geom_Ellipse)::DownCast(c).IsNull()) return C_ELLIPSE;
    if (!Handle(Geom_BSplineCurve)::DownCast(c).IsNull()) return C_BSPLINE;
    return C_OTHER;
}

struct Census {
    int nface = 0, nedge = 0, nvert = 0, nsolid = 0;
    int skind[S_N] = {0};
    int ckind[C_N] = {0};
    int maxFacesPerEdge = 0;
    int planarFaces = 0, planarMultiWire = 0;
    int planarWireAllCircle = 0;      // every wire of the face is one full circle
    int planarWireLinePolyOrCircle = 0;  // every wire is a full circle OR an all-LINE ring
    int curvedFaces = 0, curvedFullRev = 0, curvedSingleWire = 0;
    // A "solid" whose faces enclose no volume is a flat sheet, not a body. It
    // cannot be slid outward along a normal at all, so its presence in the shape
    // is a fact about the INPUT, not about either engine.
    int solidsDegenerate = 0;
    double smallestSolidVol = 0.0;
    // PREDICTION, not a result — see the banner.
    bool mixedEligible = false;
    std::string mixedBlock;           // first sub-condition that fails
};

void addBlock(Census& c, const char* w) { if (c.mixedBlock.empty()) c.mixedBlock = w; }

// Would a MIXED planar+quadric guard set admit this part? Every clause below is
// a proposal, and the only thing that can settle it is building the path and
// re-measuring the A/B. Written as a single pass so the FIRST failing clause is
// reported, which is what makes the prediction rankable.
void predictMixed(const TopoDS_Shape& sh, Census& c) {
    TopTools_IndexedDataMapOfShapeListOfShape efMap, vfMap;
    TopExp::MapShapesAndAncestors(sh, TopAbs_EDGE, TopAbs_FACE, efMap);
    TopExp::MapShapesAndAncestors(sh, TopAbs_VERTEX, TopAbs_FACE, vfMap);

    // 1. every face is one of the five analytic surfaces; curved faces are a
    //    single full-revolution wire (the quadric path's existing requirement).
    for (TopExp_Explorer ex(sh, TopAbs_FACE); ex.More(); ex.Next()) {
        const TopoDS_Face f = TopoDS::Face(ex.Current());
        const SKind k = kindOf(basis(BRep_Tool::Surface(f)));
        if (k > S_TOR) { addBlock(c, "surface_not_analytic"); return; }
        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (k != S_PLANE) {
            if (nWires != 1) { addBlock(c, "curved_face_multi_wire"); return; }
            double u1 = 0, u2 = 0, v1 = 0, v2 = 0;
            BRepTools::UVBounds(f, u1, u2, v1, v2);
            if (std::fabs((u2 - u1) - 2.0 * kPi) > 1.0e-7) {
                addBlock(c, "curved_face_partial_revolution"); return;
            }
        } else {
            // 2. THE RELAXATION. Today a planar face is admitted only when every
            //    wire is exactly one full circle. The proposal also admits a ring
            //    of LINE edges — the polygon the existing intersectPlanes corner
            //    solve already offsets exactly in planarOffsetShape.
            if (nWires < 1) { addBlock(c, "planar_face_no_wire"); return; }
            for (TopoDS_Iterator it(f); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0, nLine = 0, nCirc = 0;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    const CKind ck = curveKindOf(TopoDS::Edge(ee.Current()));
                    if (ck == C_LINE) ++nLine; else if (ck == C_FULLCIRC) ++nCirc;
                }
                const bool oneCircle = (nE == 1 && nCirc == 1);
                const bool linePoly  = (nE >= 3 && nLine == nE);
                if (!oneCircle && !linePoly) {
                    addBlock(c, "planar_wire_not_polygon_or_circle"); return;
                }
            }
        }
    }

    // 3. per edge, with the SAME face de-duplication the engine's re-trim does
    //    (quadricOffsetShape step 3: a seam lists one distinct face and is
    //    skipped; anything other than two distinct faces is non-manifold).
    //    A SEAM that happens to be a LINE (every cylinder has one) is not a
    //    corner edge and must not be judged as one.
    TopTools_IndexedMapOfShape cornerVerts;
    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (BRep_Tool::Degenerated(e)) continue;
        std::vector<TopoDS_Face> nb;
        int nPlanar = 0;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face nf = TopoDS::Face(it.Value());
            bool seen = false;
            for (const TopoDS_Face& g : nb) if (g.IsSame(nf)) { seen = true; break; }
            if (seen) continue;
            nb.push_back(nf);
            if (kindOf(basis(BRep_Tool::Surface(nf))) == S_PLANE) ++nPlanar;
        }
        if (nb.size() == 1) continue;                       // seam
        if (nb.size() != 2) { addBlock(c, "edge_not_two_manifold"); return; }
        const CKind ck = curveKindOf(e);
        if (ck == C_FULLCIRC) continue;                     // existing circle re-trim
        if (ck == C_LINE) {
            // A LINE between two planes is the corner solve. A LINE between a
            // plane and a quadric (a tangent seam) has no closed-form offset in
            // this machinery and is counted AGAINST the proposal.
            if (nPlanar != 2) { addBlock(c, "line_edge_not_between_two_planes"); return; }
            for (TopExp_Explorer ev(e, TopAbs_VERTEX); ev.More(); ev.Next())
                cornerVerts.Add(ev.Current());
            continue;
        }
        addBlock(c, "edge_neither_line_nor_full_circle"); return;
    }

    // 4. every vertex a CORNER line edge ends at must be a pure plane corner:
    //    all its incident faces planar, and at least three of them, or the
    //    offset corner is not pinned by intersectPlanes.
    for (int i = 1; i <= vfMap.Extent(); ++i) {
        if (!cornerVerts.Contains(vfMap.FindKey(i))) continue;
        std::vector<TopoDS_Face> nb;
        int nPlanar = 0;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face nf = TopoDS::Face(it.Value());
            bool seen = false;
            for (const TopoDS_Face& g : nb) if (g.IsSame(nf)) { seen = true; break; }
            if (seen) continue;
            nb.push_back(nf);
            if (kindOf(basis(BRep_Tool::Surface(nf))) == S_PLANE) ++nPlanar;
        }
        if (static_cast<int>(nb.size()) != nPlanar) {
            addBlock(c, "line_vertex_touches_curved_face"); return;
        }
        if (nPlanar < 3) { addBlock(c, "line_vertex_under_3_planes"); return; }
    }
    c.mixedEligible = true;
}

Census censusOf(const TopoDS_Shape& sh) {
    Census c;
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(sh, TopAbs_FACE, m);   c.nface  = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_EDGE, m);   c.nedge  = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_VERTEX, m); c.nvert  = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_SOLID, m);  c.nsolid = m.Extent(); m.Clear();

    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(sh, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        const SKind k = kindOf(basis(BRep_Tool::Surface(f)));
        ++c.skind[k];
        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;
        if (k == S_PLANE) {
            ++c.planarFaces;
            if (nWires > 1) ++c.planarMultiWire;
            bool allCircle = true, allPolyOrCircle = true;
            for (TopoDS_Iterator it(f); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0, nLine = 0, nCirc = 0;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    const CKind ck = curveKindOf(TopoDS::Edge(ee.Current()));
                    if (ck == C_LINE) ++nLine; else if (ck == C_FULLCIRC) ++nCirc;
                }
                const bool oneCircle = (nE == 1 && nCirc == 1);
                const bool linePoly  = (nE >= 3 && nLine == nE);
                if (!oneCircle) allCircle = false;
                if (!oneCircle && !linePoly) allPolyOrCircle = false;
            }
            if (nWires >= 1 && allCircle) ++c.planarWireAllCircle;
            if (nWires >= 1 && allPolyOrCircle) ++c.planarWireLinePolyOrCircle;
        } else {
            ++c.curvedFaces;
            if (nWires == 1) ++c.curvedSingleWire;
            double u1 = 0, u2 = 0, v1 = 0, v2 = 0;
            BRepTools::UVBounds(f, u1, u2, v1, v2);
            if (std::fabs((u2 - u1) - 2.0 * kPi) <= 1.0e-7) ++c.curvedFullRev;
        }
    }

    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(sh, TopAbs_EDGE, TopAbs_FACE, efMap);
    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        ++c.ckind[curveKindOf(e)];
        int nf = 0;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) ++nf;
        c.maxFacesPerEdge = std::max(c.maxFacesPerEdge, nf);
    }

    {
        TopTools_IndexedMapOfShape sol;
        TopExp::MapShapes(sh, TopAbs_SOLID, sol);
        bool first = true;
        for (int k = 1; k <= sol.Extent(); ++k) {
            double v = 0.0;
            GProp_GProps g;
            try { BRepGProp::VolumeProperties(sol.FindKey(k), g); v = std::fabs(g.Mass()); }
            catch (...) { v = 0.0; }
            if (v < 1.0e-9) ++c.solidsDegenerate;
            if (first || v < c.smallestSolidVol) { c.smallestSolidVol = v; first = false; }
        }
    }
    predictMixed(sh, c);
    return c;
}

// ── one part ────────────────────────────────────────────────────────────────
struct Row {
    std::string status = "DEFER";
    std::string reason;
    double volIn = 0.0, volOut = 0.0;
    int    valid = -1, validIn = -1, nfaceOut = 0;
    Census cen;
};

Row runPart(const TopoDS_Shape& sh, double d) {
    Row r;
    r.cen = censusOf(sh);
    { GProp_GProps g; try { BRepGProp::VolumeProperties(sh, g); r.volIn = std::fabs(g.Mass()); }
      catch (...) {} }
    // Was the INPUT already invalid? An offset that inherits its input's
    // invalidity is a different fact from an offset that creates one.
    try { BRepCheck_Analyzer an(sh); r.validIn = an.IsValid() ? 1 : 0; } catch (...) { r.validIn = -1; }
    TopoDS_Shape out;
    try {
        out = forge::occtoffset::offsetSolidShape(sh, d, 1.0e-7);
    } catch (const Standard_Failure& e) {
        r.status = "THREW";
        r.reason = e.GetMessageString() ? e.GetMessageString() : "Standard_Failure";
        return r;
    } catch (...) {
        r.status = "THREW"; r.reason = "unknown throw"; return r;
    }
    if (out.IsNull()) {
        r.status = "DEFER";
        const char* why = forge::occtoffset::lastOffsetDeferReason();
        r.reason = (why && *why) ? why : "(engine recorded no label)";
        return r;
    }
    r.status = "OK";
    { GProp_GProps g; try { BRepGProp::VolumeProperties(out, g); r.volOut = std::fabs(g.Mass()); }
      catch (...) {} }
    try { BRepCheck_Analyzer an(out); r.valid = an.IsValid() ? 1 : 0; } catch (...) { r.valid = -1; }
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(out, TopAbs_FACE, fm);
    r.nfaceOut = fm.Extent();
    return r;
}

void printRow(const char* part, double d, const Row& r) {
    std::string j;
    char buf[1024];
    std::snprintf(buf, sizeof buf,
        "{\"part\":\"%s\",\"d\":%.10g,\"status\":\"%s\",\"reason\":\"%s\","
        "\"vol_in\":%.10g,\"vol_out\":%.10g,\"valid_in\":%d,\"valid\":%d,\"nface_out\":%d,"
        "\"nface\":%d,\"nedge\":%d,\"nvert\":%d,\"nsolid\":%d,"
        "\"max_faces_per_edge\":%d,\"solids_degenerate\":%d,\"smallest_solid_vol\":%.10g,"
        "\"planar_faces\":%d,\"planar_multi_wire\":%d,"
        "\"planar_all_circle_wires\":%d,\"planar_poly_or_circle_wires\":%d,"
        "\"curved_faces\":%d,\"curved_full_rev\":%d,\"curved_single_wire\":%d,"
        "\"mixed_eligible_PREDICTION\":%s,\"mixed_block_PREDICTION\":\"%s\"",
        part, d, r.status.c_str(), r.reason.c_str(),
        r.volIn, r.volOut, r.validIn, r.valid, r.nfaceOut,
        r.cen.nface, r.cen.nedge, r.cen.nvert, r.cen.nsolid, r.cen.maxFacesPerEdge,
        r.cen.solidsDegenerate, r.cen.smallestSolidVol,
        r.cen.planarFaces, r.cen.planarMultiWire,
        r.cen.planarWireAllCircle, r.cen.planarWireLinePolyOrCircle,
        r.cen.curvedFaces, r.cen.curvedFullRev, r.cen.curvedSingleWire,
        r.cen.mixedEligible ? "true" : "false", r.cen.mixedBlock.c_str());
    j = buf;
    j += ",\"surf\":{";
    for (int i = 0; i < S_N; ++i) {
        std::snprintf(buf, sizeof buf, "%s\"%s\":%d", i ? "," : "", kSKindName[i], r.cen.skind[i]);
        j += buf;
    }
    j += "},\"curve\":{";
    for (int i = 0; i < C_N; ++i) {
        std::snprintf(buf, sizeof buf, "%s\"%s\":%d", i ? "," : "", kCKindName[i], r.cen.ckind[i]);
        j += buf;
    }
    j += "}}";
    std::printf("%s\n", j.c_str());
}

// ── controls ────────────────────────────────────────────────────────────────
int selftest() {
    int bad = 0;
    auto check = [&](const char* what, const Row& r,
                     const char* wantStatus, const char* wantReason,
                     bool wantElig) {
        const bool okS = r.status == wantStatus;
        const bool okR = (wantReason == nullptr) || r.reason == wantReason;
        const bool okE = r.cen.mixedEligible == wantElig;
        std::printf("  %-12s %-6s %-46s elig=%-5s %-32s %s\n", what, r.status.c_str(),
                    r.reason.c_str(), r.cen.mixedEligible ? "true" : "false",
                    r.cen.mixedBlock.c_str(), (okS && okR && okE) ? "ok" : "FAIL");
        if (!(okS && okR && okE)) {
            std::printf("               wanted %s / %s / elig=%s\n", wantStatus,
                        wantReason ? wantReason : "(any)", wantElig ? "true" : "false");
            ++bad;
        }
        return okS && okR && okE;
    };
    // A control that only asks "did something come back" cannot tell a correct
    // offset from a plausible wrong one, so every POSITIVE control below is
    // checked against a CLOSED FORM for the shape it must have produced.
    auto checkVol = [&](const char* what, const Row& r, double want) {
        const bool ok = r.status == "OK" &&
                        std::fabs(r.volOut - want) <= 1.0e-6 * std::max(1.0, want);
        std::printf("     %-9s volume %.9g   want %.9g   valid=%d  %s\n", what,
                    r.volOut, want, r.valid, ok ? "ok" : "FAIL");
        if (!ok) ++bad;
    };

    const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
    const double d = 0.2;
    Row rb = runPart(box, d);
    check("BOX", rb, "OK", nullptr, true);
    checkVol("BOX", rb, 10.4 * 10.4 * 10.4);          // (L+2d)^3, the planar path

    const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
    Row rc = runPart(cyl, d);
    check("CYLINDER", rc, "OK", nullptr, true);
    checkVol("CYLINDER", rc, kPi * 5.2 * 5.2 * 10.4); // pi(R+d)^2 (H+2d)

    // HOLED BOX — the shape the corpus is full of, and the one the MIXED path
    // exists for: a polygon planar boundary plus a circular hole. Growing the
    // solid slides the hole WALL along ITS outward normal, which points at the
    // axis, so the bore SHRINKS from R to R-d while the block grows.
    TopoDS_Shape holed;
    {
        BRepPrimAPI_MakeCylinder tool(2.0, 30.0);
        gp_Trsf t; t.SetTranslation(gp_Vec(5.0, 5.0, -10.0));
        TopoDS_Shape drill = BRepBuilderAPI_Transform(tool.Shape(), t, Standard_True).Shape();
        BRepAlgoAPI_Cut cut(box, drill);
        cut.Build();
        if (cut.IsDone()) holed = cut.Shape();
    }
    if (holed.IsNull()) { std::printf("  HOLED_BOX    could not be built — CONTROL INERT\n"); ++bad; }
    else {
        Row rh = runPart(holed, d);
        check("HOLED_BOX", rh, "OK", nullptr, true);
        checkVol("HOLED_BOX", rh, 10.4 * 10.4 * 10.4 - kPi * 1.8 * 1.8 * 10.4);
    }

    // L-PRISM — a REFLEX corner. Base 10x8x6 with the corner x>=6, y>=5 removed,
    // so the notch is a x b = 4 x 3. The sharp join slides EVERY plane along its
    // own outward normal by d, and at this reflex corner the notch's two walls
    // (x=6 outward +x, y=5 outward +y) slide the SAME way as the far outer walls
    // (x=10, y=8). The notch therefore TRANSLATES by (d,d) and keeps its size;
    // only the outer rectangle grows:
    //   V = ((W+2d)(H+2d) - a*b) * (T+2d)
    // A corner solve that only handled convex apexes would fail here and pass
    // everything above. (The first draft of this control asserted (a-d)(b-d) and
    // was wrong; the engine's answer is what corrected it.)
    TopoDS_Shape lprism;
    {
        const TopoDS_Shape base = BRepPrimAPI_MakeBox(10.0, 8.0, 6.0).Shape();
        BRepPrimAPI_MakeBox notch(gp_Pnt(6.0, 5.0, -1.0), 5.0, 4.0, 8.0);
        BRepAlgoAPI_Cut cut(base, notch.Shape());
        cut.Build();
        if (cut.IsDone()) lprism = cut.Shape();
    }
    if (lprism.IsNull()) { std::printf("  L_PRISM      could not be built — CONTROL INERT\n"); ++bad; }
    else {
        Row rl = runPart(lprism, d);
        check("L_PRISM", rl, "OK", nullptr, true);
        checkVol("L_PRISM", rl, (10.4 * 8.4 - 4.0 * 3.0) * 6.4);
    }

    // ARC BOX — a planar wire of LINES **and an ARC**. The relaxation admits a
    // polygon and a circle and NOTHING ELSE; without this control "accept a
    // polygon" and "accept anything" look identical from the corpus numbers.
    TopoDS_Shape arcBox;
    {
        TopoDS_Edge pick;
        for (TopExp_Explorer ex(box, TopAbs_EDGE); ex.More(); ex.Next()) {
            const TopoDS_Edge e = TopoDS::Edge(ex.Current());
            double f = 0.0, l = 0.0;
            Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
            if (c.IsNull()) continue;
            gp_Pnt p0 = c->Value(f), p1 = c->Value(l);
            if (std::fabs(p0.Z() - p1.Z()) > 1.0e-9) { pick = e; break; }  // vertical
        }
        if (!pick.IsNull()) {
            BRepFilletAPI_MakeFillet mk(box);
            mk.Add(1.5, pick);
            try { mk.Build(); if (mk.IsDone()) arcBox = mk.Shape(); } catch (...) {}
        }
    }
    if (arcBox.IsNull()) { std::printf("  ARC_BOX      could not be built — CONTROL INERT\n"); ++bad; }
    else {
        Row ra = runPart(arcBox, d);
        check("ARC_BOX", ra, "DEFER", "quadric/planar_wire_not_polygon_or_circle", false);
    }

    // TWO BODIES, FAR APART — 271 of the 600 corpus parts import as a compound
    // of two or three solids. Separated by more than 2d, the offset of the whole
    // IS the compound of the offsets, and its volume is the sum of the two
    // closed forms.
    TopoDS_Shape twoFar;
    {
        BRep_Builder bb; TopoDS_Compound c; bb.MakeCompound(c);
        bb.Add(c, box);
        bb.Add(c, BRepPrimAPI_MakeBox(gp_Pnt(40.0, 0.0, 0.0), 6.0, 6.0, 6.0).Shape());
        twoFar = c;
    }
    {
        Row r2 = runPart(twoFar, d);
        check("TWO_BODIES", r2, "OK", nullptr, true);
        checkVol("TWO_BODIES", r2, 10.4 * 10.4 * 10.4 + 6.4 * 6.4 * 6.4);
    }

    // TWO BODIES, TOUCHING — the same two boxes placed face to face. Growing
    // each independently would return interpenetrating bodies; the engine must
    // decline instead. Without this control "handle compounds" and "return
    // overlapping garbage on compounds" look identical from the corpus numbers.
    TopoDS_Shape twoTouch;
    {
        BRep_Builder bb; TopoDS_Compound c; bb.MakeCompound(c);
        bb.Add(c, box);
        bb.Add(c, BRepPrimAPI_MakeBox(gp_Pnt(10.0, 0.0, 0.0), 6.0, 6.0, 6.0).Shape());
        twoTouch = c;
    }
    {
        Row r3 = runPart(twoTouch, d);
        check("TWO_TOUCHING", r3, "DEFER", "entry/bodies_not_separated_by_2dist", true);
    }

    TopoDS_Shape nurbs;
    {
        BRepBuilderAPI_NurbsConvert nc(box, Standard_True);
        if (nc.IsDone()) nurbs = nc.Shape();
    }
    if (nurbs.IsNull()) { std::printf("  NURBS_BOX    could not be built — CONTROL INERT\n"); ++bad; }
    else {
        Row rn = runPart(nurbs, d);
        check("NURBS_BOX", rn, "DEFER", "quadric/unsupported_surface", false);
    }

    std::printf(bad ? "FAIL: %d control(s) red\n" : "PASS: %d control(s) red\n", bad);
    return bad ? 1 : 0;
}


// --dump <part.step>: every FULL-CIRCLE edge with the surface kinds of its two
// distinct neighbour faces, so "the meridians do not meet on a plane+plane pair"
// can be looked at instead of reasoned about.
void dumpCircles(const TopoDS_Shape& sh) {
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(sh, TopAbs_EDGE, TopAbs_FACE, efMap);
    TopTools_IndexedMapOfShape sm;
    TopExp::MapShapes(sh, TopAbs_SOLID, sm);
    std::printf("solids=%d\n", sm.Extent());
    // which SOLID does each face belong to? (0 = none/ambiguous)
    auto solidOf = [&](const TopoDS_Face& f) {
        for (int k = 1; k <= sm.Extent(); ++k) {
            for (TopExp_Explorer ex(sm.FindKey(k), TopAbs_FACE); ex.More(); ex.Next())
                if (ex.Current().IsSame(f)) return k;
        }
        return 0;
    };
    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        if (curveKindOf(e) != C_FULLCIRC) continue;
        std::vector<TopoDS_Face> nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face f = TopoDS::Face(it.Value());
            bool seen = false;
            for (const TopoDS_Face& g : nb) if (g.IsSame(f)) { seen = true; break; }
            if (!seen) nb.push_back(f);
        }
        std::string kinds;
        for (const TopoDS_Face& f : nb) {
            if (!kinds.empty()) kinds += "+";
            kinds += kSKindName[kindOf(basis(BRep_Tool::Surface(f)))];
        }
        if (nb.size() == 2 &&
            kindOf(basis(BRep_Tool::Surface(nb[0]))) == S_PLANE &&
            kindOf(basis(BRep_Tool::Surface(nb[1]))) == S_PLANE) {
            double f0 = 0, l0 = 0;
            Handle(Geom_Circle) gc = Handle(Geom_Circle)::DownCast(curveBasis(e));
            const gp_Circ c = gc->Circ();
            BRep_Tool::Range(e, f0, l0);
            std::printf("CIRCLE r=%.6g centre=(%.6g,%.6g,%.6g) axis=(%.4g,%.4g,%.4g) kinds=%s\n",
                        c.Radius(), c.Location().X(), c.Location().Y(), c.Location().Z(),
                        c.Axis().Direction().X(), c.Axis().Direction().Y(),
                        c.Axis().Direction().Z(), kinds.c_str());
            for (const TopoDS_Face& f : nb) {
                Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
                int nW = 0, nE = 0;
                for (TopoDS_Iterator it(f); it.More(); it.Next())
                    if (it.Value().ShapeType() == TopAbs_WIRE) ++nW;
                for (TopExp_Explorer ee(f, TopAbs_EDGE); ee.More(); ee.Next()) ++nE;
                GProp_GProps g; BRepGProp::SurfaceProperties(f, g);
                std::printf("    face n=(%.4g,%.4g,%.4g) loc=(%.6g,%.6g,%.6g) wires=%d edges=%d area=%.6g orient=%s\n",
                            pl->Position().Direction().X(), pl->Position().Direction().Y(),
                            pl->Position().Direction().Z(), pl->Position().Location().X(),
                            pl->Position().Location().Y(), pl->Position().Location().Z(),
                            nW, nE, g.Mass(),
                            f.Orientation() == TopAbs_REVERSED ? "REV" : "FWD");
                std::printf("        solid=%d\n", solidOf(f));
            }
        }
    }
}


// --check <part.step>: WHAT does BRepCheck_Analyzer object to in the offset
// result? A count of invalid results cannot say whether the shape is wrong or
// merely out of tolerance, and those call for opposite responses.
const char* bcStatus(BRepCheck_Status st) {
    switch (st) {
        case BRepCheck_NoError: return "NoError";
        case BRepCheck_InvalidPointOnCurve: return "InvalidPointOnCurve";
        case BRepCheck_InvalidPointOnCurveOnSurface: return "InvalidPointOnCurveOnSurface";
        case BRepCheck_InvalidPointOnSurface: return "InvalidPointOnSurface";
        case BRepCheck_No3DCurve: return "No3DCurve";
        case BRepCheck_Multiple3DCurve: return "Multiple3DCurve";
        case BRepCheck_Invalid3DCurve: return "Invalid3DCurve";
        case BRepCheck_NoCurveOnSurface: return "NoCurveOnSurface";
        case BRepCheck_InvalidCurveOnSurface: return "InvalidCurveOnSurface";
        case BRepCheck_InvalidCurveOnClosedSurface: return "InvalidCurveOnClosedSurface";
        case BRepCheck_InvalidSameRangeFlag: return "InvalidSameRangeFlag";
        case BRepCheck_InvalidSameParameterFlag: return "InvalidSameParameterFlag";
        case BRepCheck_InvalidDegeneratedFlag: return "InvalidDegeneratedFlag";
        case BRepCheck_FreeEdge: return "FreeEdge";
        case BRepCheck_InvalidMultiConnexity: return "InvalidMultiConnexity";
        case BRepCheck_InvalidRange: return "InvalidRange";
        case BRepCheck_EmptyWire: return "EmptyWire";
        case BRepCheck_RedundantEdge: return "RedundantEdge";
        case BRepCheck_SelfIntersectingWire: return "SelfIntersectingWire";
        case BRepCheck_NoSurface: return "NoSurface";
        case BRepCheck_InvalidWire: return "InvalidWire";
        case BRepCheck_RedundantWire: return "RedundantWire";
        case BRepCheck_IntersectingWires: return "IntersectingWires";
        case BRepCheck_InvalidImbricationOfWires: return "InvalidImbricationOfWires";
        case BRepCheck_EmptyShell: return "EmptyShell";
        case BRepCheck_RedundantFace: return "RedundantFace";
        case BRepCheck_UnorientableShape: return "UnorientableShape";
        case BRepCheck_NotClosed: return "NotClosed";
        case BRepCheck_NotConnected: return "NotConnected";
        case BRepCheck_SubshapeNotInShape: return "SubshapeNotInShape";
        case BRepCheck_BadOrientation: return "BadOrientation";
        case BRepCheck_BadOrientationOfSubshape: return "BadOrientationOfSubshape";
        case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
        case BRepCheck_InvalidToleranceValue: return "InvalidToleranceValue";
        default: return "other";
    }
}

void checkResult(const TopoDS_Shape& sh, double d) {
    TopoDS_Shape out = forge::occtoffset::offsetSolidShape(sh, d, 1.0e-7);
    if (out.IsNull()) { std::printf("DEFER %s\n", forge::occtoffset::lastOffsetDeferReason()); return; }
    BRepCheck_Analyzer an(out);
    std::printf("valid=%d\n", an.IsValid() ? 1 : 0);
    const TopAbs_ShapeEnum kinds[4] = {TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE, TopAbs_FACE};
    const char* kn[4] = {"VERTEX", "EDGE", "WIRE", "FACE"};
    for (int k = 0; k < 4; ++k) {
        TopTools_IndexedMapOfShape m;
        TopExp::MapShapes(out, kinds[k], m);
        int shown = 0;
        for (int i = 1; i <= m.Extent(); ++i) {
            bool sv = true;
            try { sv = an.IsValid(m.FindKey(i)); } catch (...) { continue; }
            if (sv) continue;
            std::string st;
            try {
                const Handle(BRepCheck_Result)& res = an.Result(m.FindKey(i));
                if (res.IsNull()) continue;
                for (BRepCheck_ListIteratorOfListOfStatus it(res->StatusOnShape()); it.More(); it.Next()) {
                    if (it.Value() == BRepCheck_NoError) continue;
                    if (!st.empty()) st += ",";
                    st += bcStatus(it.Value());
                }
            } catch (...) { st.clear(); }
            if (kinds[k] == TopAbs_FACE) {
                // The shell-context status is not always stored on the face, so
                // ask BRepCheck_Face itself rather than reporting "unknown".
                const TopoDS_Face ff = TopoDS::Face(m.FindKey(i));
                BRepCheck_Face bf(ff);
                const BRepCheck_Status s1 = bf.IntersectWires();
                const BRepCheck_Status s2 = bf.ClassifyWires();
                const BRepCheck_Status s3 = bf.OrientationOfWires();
                char b[192];
                int nW = 0, nE = 0;
                for (TopoDS_Iterator it(ff); it.More(); it.Next())
                    if (it.Value().ShapeType() == TopAbs_WIRE) ++nW;
                for (TopExp_Explorer ee(ff, TopAbs_EDGE); ee.More(); ee.Next()) ++nE;
                GProp_GProps gg; BRepGProp::SurfaceProperties(ff, gg);
                std::snprintf(b, sizeof b,
                    "%s wires=%d edges=%d area=%.6g surf=%s Intersect=%s Classify=%s Orient=%s",
                    st.empty() ? "" : st.c_str(), nW, nE, gg.Mass(),
                    kSKindName[kindOf(basis(BRep_Tool::Surface(ff)))],
                    bcStatus(s1), bcStatus(s2), bcStatus(s3));
                st = b;
            }
            if (st.empty()) st = "(no stored result)";
            if (st.empty()) continue;
            if (shown++ < 6) std::printf("  %s #%d: %s\n", kn[k], i, st.c_str());
        }
        if (shown) std::printf("  %s invalid: %d of %d\n", kn[k], shown, m.Extent());
    }
}


// --dumpv <part.step>: the vertices the corner solve cannot pin, with every
// incident face's plane and owning solid. "planes=1,faces=8" is not a shape
// anybody can picture; this prints the shape.
void dumpVerts(const TopoDS_Shape& sh) {
    TopTools_IndexedMapOfShape sm;
    TopExp::MapShapes(sh, TopAbs_SOLID, sm);
    std::printf("solids=%d\n", sm.Extent());
    auto solidOf = [&](const TopoDS_Shape& f) {
        for (int k = 1; k <= sm.Extent(); ++k)
            for (TopExp_Explorer ex(sm.FindKey(k), TopAbs_FACE); ex.More(); ex.Next())
                if (ex.Current().IsSame(f)) return k;
        return 0;
    };
    TopTools_IndexedDataMapOfShapeListOfShape vfMap;
    TopExp::MapShapesAndAncestors(sh, TopAbs_VERTEX, TopAbs_FACE, vfMap);
    int shown = 0;
    for (int i = 1; i <= vfMap.Extent() && shown < 3; ++i) {
        std::vector<TopoDS_Face> nb;
        for (TopTools_ListIteratorOfListOfShape it(vfMap.FindFromIndex(i)); it.More(); it.Next()) {
            const TopoDS_Face f = TopoDS::Face(it.Value());
            bool seen = false;
            for (const TopoDS_Face& g : nb) if (g.IsSame(f)) { seen = true; break; }
            if (!seen) nb.push_back(f);
        }
        std::vector<gp_Pln> pls;
        bool allPlanar = true;
        for (const TopoDS_Face& f : nb) {
            Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
            if (pl.IsNull()) { allPlanar = false; break; }
            bool dup = false;
            for (const gp_Pln& g : pls)
                if (g.Axis().Direction().IsParallel(pl->Pln().Axis().Direction(), 1.0e-7) &&
                    g.Distance(pl->Pln().Location()) < 1.0e-7) { dup = true; break; }
            if (!dup) pls.push_back(pl->Pln());
        }
        if (!allPlanar || pls.size() >= 3) continue;
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vfMap.FindKey(i)));
        std::printf("VERTEX (%.6g,%.6g,%.6g) faces=%d distinct_planes=%d\n",
                    p.X(), p.Y(), p.Z(), (int)nb.size(), (int)pls.size());
        for (const TopoDS_Face& f : nb) {
            Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis(BRep_Tool::Surface(f)));
            GProp_GProps g; BRepGProp::SurfaceProperties(f, g);
            int nE = 0;
            for (TopExp_Explorer ee(f, TopAbs_EDGE); ee.More(); ee.Next()) ++nE;
            std::printf("    n=(%.4g,%.4g,%.4g) loc=(%.6g,%.6g,%.6g) area=%.6g edges=%d solid=%d %s\n",
                        pl->Position().Direction().X(), pl->Position().Direction().Y(),
                        pl->Position().Direction().Z(), pl->Position().Location().X(),
                        pl->Position().Location().Y(), pl->Position().Location().Z(),
                        g.Mass(), nE, solidOf(f),
                        f.Orientation() == TopAbs_REVERSED ? "REV" : "FWD");
        }
        ++shown;
    }
    if (!shown) std::printf("(no under-3-plane vertex found)\n");
}


// --occt <part.step>: what does BRepOffsetAPI_MakeOffsetShape ACTUALLY return
// on this part? The corpus A/B's OCCT arm keeps only the FIRST shell of a
// compound result, so a small measured volume there could be the harness
// discarding geometry rather than OCCT producing a fragment. This reads the RAW
// mk.Shape(): its type, its shell count, and the volume with EVERY shell
// wrapped into a solid. Prints one JSON object.
void occtProbe(const char* part, const TopoDS_Shape& sh, double d) {
    double volIn = 0.0;
    { GProp_GProps g; try { BRepGProp::VolumeProperties(sh, g); volIn = std::fabs(g.Mass()); } catch (...) {} }

    // FOUR CONFIGURATIONS, not one. The shipped call site (Features.cpp:1361)
    // passes Intersection=false with a sharp GeomAbs_Intersection join; a
    // sibling family in this programme was once judged wrong when it was OCCT's
    // arm that had been mis-configured, so "OCCT returns a fragment" is only
    // worth saying after the other settings have been tried on the same part.
    struct Cfg { const char* name; Standard_Boolean inter; GeomAbs_JoinType join; };
    const Cfg cfgs[4] = {
        {"shipped_noInter_sharp", Standard_False, GeomAbs_Intersection},
        {"inter_sharp",           Standard_True,  GeomAbs_Intersection},
        {"noInter_arc",           Standard_False, GeomAbs_Arc},
        {"inter_arc",             Standard_True,  GeomAbs_Arc},
    };
    std::string j = "{\"part\":\"";
    j += part;
    char buf[256];
    std::snprintf(buf, sizeof buf, "\",\"d\":%.10g,\"vol_in\":%.10g,\"cfg\":{", d, volIn);
    j += buf;
    for (int k = 0; k < 4; ++k) {
        const char* status = "DEFER";
        int nshell = 0, validRaw = -1;
        double volAll = 0.0;
        try {
            BRepOffsetAPI_MakeOffsetShape mk;
            mk.PerformByJoin(sh, d, 1.0e-7, BRepOffset_Skin,
                             cfgs[k].inter, Standard_False, cfgs[k].join);
            if (!mk.IsDone()) status = "NOTDONE";
            else {
                TopoDS_Shape off = mk.Shape();
                if (off.IsNull()) status = "NULLSHAPE";
                else {
                    status = "OK";
                    for (TopExp_Explorer ex(off, TopAbs_SHELL); ex.More(); ex.Next()) {
                        ++nshell;
                        BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(ex.Current()));
                        if (!ms.IsDone()) continue;
                        GProp_GProps g;
                        try { BRepGProp::VolumeProperties(ms.Solid(), g); volAll += std::fabs(g.Mass()); }
                        catch (...) {}
                    }
                    if (nshell == 0) {
                        GProp_GProps g;
                        try { BRepGProp::VolumeProperties(off, g); volAll = std::fabs(g.Mass()); } catch (...) {}
                    }
                    try { validRaw = BRepCheck_Analyzer(off).IsValid() ? 1 : 0; } catch (...) { validRaw = -1; }
                }
            }
        } catch (const Standard_Failure&) { status = "THREW"; }
        catch (...) { status = "THREW"; }
        std::snprintf(buf, sizeof buf,
            "%s\"%s\":{\"status\":\"%s\",\"nshell\":%d,\"vol_all\":%.10g,\"valid\":%d}",
            k ? "," : "", cfgs[k].name, status, nshell, volAll, validRaw);
        j += buf;
    }
    j += "}}";
    std::printf("%s\n", j.c_str());
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
    bool wantDump = false, wantCheck = false;
    if (argc >= 3 && std::strcmp(argv[1], "--dump") == 0) { wantDump = true; --argc; ++argv; }
    if (argc >= 3 && std::strcmp(argv[1], "--check") == 0) { wantCheck = true; --argc; ++argv; }
    bool wantDumpV = false;
    if (argc >= 3 && std::strcmp(argv[1], "--dumpv") == 0) { wantDumpV = true; --argc; ++argv; }
    bool wantOcct = false;
    if (argc >= 3 && std::strcmp(argv[1], "--occt") == 0) { wantOcct = true; --argc; ++argv; }
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> | --selftest\n", argv[0]); return 2; }

    const std::string stepPath = argv[1];
    std::string partName = stepPath;
    {
        const size_t slash = partName.find_last_of('/');
        if (slash != std::string::npos) partName = partName.substr(slash + 1);
        const size_t dot = partName.find_last_of('.');
        if (dot != std::string::npos) partName = partName.substr(0, dot);
    }

    TopoDS_Shape shape;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", partName.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { shape = rd.OneShape(); } catch (...) {}
        if (shape.IsNull()) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", partName.c_str());
            return 1;
        }
    }
    double bb[6];
    if (!boundsOf(shape, bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", partName.c_str());
        return 1;
    }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double minExt = std::min(dx, std::min(dy, dz));
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diag > 0.0)) {
        std::printf("{\"part\":\"%s\",\"error\":\"degenerate_bbox\"}\n", partName.c_str());
        return 1;
    }
    const bool flat = !(minExt > 1e-9 * diag);
    const double scale = flat ? diag * 0.05 : minExt;
    const double d = 0.02 * scale;          // family H's argument, verbatim

    if (wantDump) { dumpCircles(shape); return 0; }
    if (wantCheck) { checkResult(shape, d); return 0; }
    if (wantDumpV) { dumpVerts(shape); return 0; }
    if (wantOcct) { occtProbe(partName.c_str(), shape, d); return 0; }
    printRow(partName.c_str(), d, runPart(shape, d));
    return 0;
}
