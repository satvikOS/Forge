// fillet_defer_census.cpp — WHY does each FILLET pair land in the bucket it does?
//
// THE QUESTION. The 600-part corpus A/B (reports/CORPUS_AB_COVERAGE.md §3)
// measures family FILLET at native 32.8% against OCCT 76.8%, with a bucket split
// no other family has:
//
//     BOTH_OK 146   OCCT_ONLY 315   NATIVE_ONLY 51   NEITHER 88
//
// Two of those cells are unexplained and they point in opposite directions.
//   * 315 OCCT_ONLY — the deletion the FORGE_FILLET_DROP_NATIVE option would
//     cause. A count alone cannot say whether those are a CAPABILITY GAP (the
//     rolling-ball-on-two-planes method does not cover these edges) or a
//     PREDICATE the engine could legitimately relax.
//   * 51 NATIVE_ONLY — the only family besides OFFSETSHAPE where the native
//     engine answers a set OCCT does not. That is a capability OCCT lacks and
//     it was never characterised.
// This probe names the guard, on both sides, per part.
//
// METHOD. The part derivation is copied VERBATIM from test/corpus_ab_coverage.cpp
// (boundsOf / faceArea / faceCentroid / betterFace / the longest-LINE-edge pick
// and the FILLET case's r = 0.05 * scale) so the input distribution is the same
// one the A/B measured; a census over a different distribution would answer a
// different question. It then calls the SAME entry point the A/B's native arm
// calls — forge::occtfillet::makeFillet — and reports Result::reason, so the
// attribution is the ENGINE's own guard text and not a re-implementation of its
// predicates that could drift from them.
//
// The OCCT arm is likewise the A/B's exact call (BRepFilletAPI_MakeFillet +
// Add(r,e) + Build()), with two extra observables that the A/B does not record
// and that turn "OCCT threw" into an attributable answer:
//   * NbContours() AFTER Add and BEFORE Build. BRepFilletAPI_MakeFillet::Add
//     silently declines to open a contour for an edge it will not blend, and
//     Build() then raises StdFail_NotDone("There are no suitable edges for
//     chamfer or fillet"). NbContours()==0 separates "OCCT refused the EDGE"
//     from "OCCT accepted the edge and the BUILD failed" — two different facts
//     that the A/B recorded as one THREW.
//   * ChFi3d::IsTangentFaces and ChFi3d::DefineConnectType on the picked edge,
//     which are the predicates Add itself consults.
//
// The geometric columns (dihedral, setback, adjacent-surface types, the blend's
// own closed-form volume) are DESCRIPTIVE. They are recomputed here rather than
// read out of the engine, and they are never used to classify a part — the
// engine's reason string is. A drift between this file's replication and the
// engine's own predicates can therefore mislead a reader of one column but
// cannot corrupt a count.
//
// CONTROLS. --selftest proves, before any corpus number exists:
//   POSITIVE  a 10 mm box edge: native OK, OCCT OK, one contour, and BOTH arms'
//             volume change within 3% of the closed form (1-pi/4)R^2 L. A census
//             that reported "declined" because it was mis-wired, or that computed
//             the closed form wrongly, would look exactly like a real result.
//   NEGATIVE  a cylinder fused onto a box: the native engine must DECLINE with a
//             non-planar-adjacent-face reason.
//   TANGENT   a box edge already rounded by OCCT, then re-offered to OCCT at the
//             cylinder/plane seam: OCCT must open ZERO contours and throw, which
//             is the exact mechanism this probe attributes the NATIVE_ONLY cell
//             to. A tangency detector that never fired would make that whole
//             column read as a clean zero.
//
// Prints one JSON object per part on stdout. Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <ChFi3d.hxx>
#include <ChFiDS_TypeOfConcavity.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopTools_MapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "forge/native/brep/NativeFilletChamfer.hpp"

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

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}

double edgeLength(const TopoDS_Edge& e) {
    GProp_GProps g;
    try { BRepGProp::LinearProperties(e, g); } catch (...) { return 0.0; }
    return g.Mass();
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
// ── end verbatim copy ───────────────────────────────────────────────────────

gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
    return g.CentreOfMass();
}

double solidVolume(const TopoDS_Shape& s) {
    if (s.IsNull()) return 0.0;
    GProp_GProps g;
    try { BRepGProp::VolumeProperties(s, g); } catch (...) { return 0.0; }
    return g.Mass();
}

const char* surfTypeName(const TopoDS_Face& f) {
    BRepAdaptor_Surface ad;
    try { ad.Initialize(f); } catch (...) { return "unreadable"; }
    switch (ad.GetType()) {
        case GeomAbs_Plane:              return "Plane";
        case GeomAbs_Cylinder:           return "Cylinder";
        case GeomAbs_Cone:               return "Cone";
        case GeomAbs_Sphere:             return "Sphere";
        case GeomAbs_Torus:              return "Torus";
        case GeomAbs_BezierSurface:      return "Bezier";
        case GeomAbs_BSplineSurface:     return "BSpline";
        case GeomAbs_SurfaceOfRevolution:return "Revolution";
        case GeomAbs_SurfaceOfExtrusion: return "Extrusion";
        case GeomAbs_OffsetSurface:      return "Offset";
        default:                         return "Other";
    }
}

const char* concavityName(ChFiDS_TypeOfConcavity t) {
    switch (t) {
        case ChFiDS_Concave:     return "Concave";
        case ChFiDS_Convex:      return "Convex";
        case ChFiDS_Tangential:  return "Tangential";
        case ChFiDS_FreeBound:   return "FreeBound";
        case ChFiDS_Other:       return "Other";
        case ChFiDS_Mixed:       return "Mixed";
    }
    return "Unknown";
}

std::string jesc(const std::string& s) {
    std::string o;
    for (unsigned char ch : s) {
        if (ch == '"' || ch == '\\') { o += '\\'; o += static_cast<char>(ch); }
        else if (ch < 0x20) o += ' ';
        else if (ch < 0x80) o += static_cast<char>(ch);
        else o += '?';   // the engine's reason text carries a U+03C0; keep JSON ASCII
    }
    return o;
}

// Descriptive replication of the engine's EdgeContext. NEVER used to classify a
// part — the engine's own reason string is. See the file banner.
struct Ctx {
    int    adjN = 0;
    bool   ok = false;          // exactly two adjacent faces, both planar, both normals _|_ e
    bool   planarA = false, planarB = false, perpA = false, perpB = false;
    bool   convex = false;
    bool   sameFace = false;    // the two "adjacent" faces are ONE face: a periodic seam
    bool   closedEdge = false;  // BRep_Tool::IsClosed(e, F): the edge is that face's seam
    double dihedral = 0.0;      // radians
    double L = 0.0;
    std::string surfA, surfB;
};

Ctx contextOf(const TopoDS_Shape& shape, const TopoDS_Edge& edge) {
    Ctx c;
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    try { TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap); }
    catch (...) { return c; }
    if (!efMap.Contains(edge)) return c;
    const TopTools_ListOfShape& fl = efMap.FindFromKey(edge);
    c.adjN = fl.Extent();
    if (c.adjN != 2) return c;
    TopTools_ListIteratorOfListOfShape it(fl);
    const TopoDS_Face A = TopoDS::Face(it.Value()); it.Next();
    const TopoDS_Face B = TopoDS::Face(it.Value());
    c.surfA = surfTypeName(A);
    c.surfB = surfTypeName(B);
    // A full periodic face (a 360 degree cylinder) meets ITSELF along its u-wrap
    // seam, so MapShapesAndAncestors lists that one face TWICE for the seam edge.
    // Extent()==2 therefore does NOT mean "two faces"; this column separates them.
    c.sameFace = A.IsSame(B) == Standard_True;
    try { c.closedEdge = BRep_Tool::IsClosed(edge, A) == Standard_True; } catch (...) {}
    gp_Pln plA, plB;
    c.planarA = planeOf(A, plA);
    c.planarB = planeOf(B, plB);
    if (!c.planarA || !c.planarB) return c;
    const gp_Dir nA = plA.Axis().Direction(), nB = plB.Axis().Direction();

    double first = 0.0, last = 0.0;
    Handle(Geom_Curve) cu = BRep_Tool::Curve(edge, first, last);
    if (cu.IsNull()) return c;
    const gp_Pnt P0 = cu->Value(first), P1 = cu->Value(last);
    c.L = P0.Distance(P1);
    if (!(c.L > 0.0)) return c;
    const gp_Dir e(gp_Vec(P0, P1));
    c.perpA = std::fabs(gp_Vec(nA).Dot(gp_Vec(e))) <= 1e-6;
    c.perpB = std::fabs(gp_Vec(nB).Dot(gp_Vec(e))) <= 1e-6;
    if (!c.perpA || !c.perpB) return c;

    const gp_Pnt mid((P0.X() + P1.X()) * 0.5, (P0.Y() + P1.Y()) * 0.5, (P0.Z() + P1.Z()) * 0.5);
    gp_Vec tA = gp_Vec(nA).Crossed(gp_Vec(e));
    gp_Vec tB = gp_Vec(nB).Crossed(gp_Vec(e));
    if (tA.Magnitude() <= 1e-7 || tB.Magnitude() <= 1e-7) return c;
    tA.Normalize(); tB.Normalize();
    if (tA.Dot(gp_Vec(mid, faceCentroid(A))) < 0.0) tA.Reverse();
    if (tB.Dot(gp_Vec(mid, faceCentroid(B))) < 0.0) tB.Reverse();
    const double d = std::max(-1.0, std::min(1.0, tA.Dot(tB)));
    c.dihedral = std::acos(d);
    c.convex = (tA.Dot(gp_Vec(nB)) < 0.0);
    c.ok = true;
    return c;
}

// |dV| of one constant-radius blend, the general closed form the engine uses
// internally (blendCrossSection * L). Collapses to (1-pi/4)R^2 L at 90 degrees.
double idealBlendVolume(const Ctx& c, double R) {
    if (!c.ok) return 0.0;
    const double halfTan = std::tan(0.5 * c.dihedral);
    if (!(halfTan > 1e-12) || !(R > 0.0)) return 0.0;
    const double s = R / halfTan;
    return (s * R - 0.5 * R * R * (kPi - c.dihedral)) * c.L;
}

struct OcctArm {
    std::string status = "DEFER";   // OK | DEFER | THREW
    std::string msg;
    int    contours = -1;
    double vol = 0.0;
};

OcctArm runOcct(const TopoDS_Shape& src, const TopoDS_Edge& e, double r) {
    OcctArm a;
    try {
        BRepFilletAPI_MakeFillet mk(src);
        mk.Add(r, e);
        try { a.contours = mk.NbContours(); } catch (...) { a.contours = -1; }
        mk.Build();
        if (!mk.IsDone()) { a.status = "DEFER"; return a; }
        const TopoDS_Shape s = mk.Shape();
        if (s.IsNull()) { a.status = "DEFER"; return a; }
        a.status = "OK";
        a.vol = solidVolume(s);
    } catch (const Standard_Failure& ex) {
        a.status = "THREW";
        a.msg = ex.GetMessageString() ? ex.GetMessageString() : "Standard_Failure";
    } catch (const std::exception& ex) {
        a.status = "THREW"; a.msg = ex.what();
    } catch (...) {
        a.status = "THREW"; a.msg = "unknown throw";
    }
    return a;
}

// The A/B's own pick: the longest LINE edge of the shape.
TopoDS_Edge pickLineEdge(const TopoDS_Shape& shape, double& lenOut) {
    TopoDS_Edge best; double bestLen = 0.0;
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(shape, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em(i));
        BRepAdaptor_Curve ad;
        try { ad.Initialize(e); } catch (...) { continue; }
        if (ad.GetType() != GeomAbs_Line) continue;
        const double L = edgeLength(e);
        if (L > bestLen * (1.0 + 1e-12)) { best = e; bestLen = L; }
    }
    lenOut = bestLen;
    return best;
}

int selftest() {
    int bad = 0;

    // POSITIVE: a 10 mm box edge. Both arms must build, OCCT must open exactly one
    // contour, and both must move (1-pi/4)R^2 L of material to within 3%.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        double len = 0.0;
        const TopoDS_Edge e = pickLineEdge(box, len);
        const double R = 1.0;
        const Ctx c = contextOf(box, e);
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = e; sp[0].radius = R;
        const forge::occtfillet::Result nat = forge::occtfillet::makeFillet(box, sp);
        const OcctArm oc = runOcct(box, e, R);
        const double v0 = solidVolume(box);
        const double ideal = idealBlendVolume(c, R);
        const double natD = nat.ok ? std::fabs(solidVolume(nat.shape) - v0) : -1.0;
        const double occD = oc.status == "OK" ? std::fabs(oc.vol - v0) : -1.0;
        const bool idealOk = ideal > 0.0 &&
            std::fabs(ideal - (1.0 - kPi / 4.0) * R * R * c.L) / ideal < 1e-9;
        if (!nat.ok || oc.status != "OK" || oc.contours != 1 || !idealOk ||
            std::fabs(natD - ideal) / ideal > 0.03 || std::fabs(occD - ideal) / ideal > 0.03) {
            std::printf("  POSITIVE CONTROL FAILED: nat.ok=%d(%s) occt=%s contours=%d "
                        "ideal=%.10g natD=%.10g occD=%.10g idealOk=%d\n",
                        nat.ok ? 1 : 0, nat.reason.c_str(), oc.status.c_str(), oc.contours,
                        ideal, natD, occD, idealOk ? 1 : 0);
            bad = 1;
        } else {
            std::printf("  positive control: box edge, native OK, OCCT OK 1 contour, "
                        "both dV=%.6g/%.6g vs closed form %.6g ok\n", natD, occD, ideal);
        }
    }

    // NEGATIVE: an edge with a cylindrical adjacent face. The native engine must
    // DECLINE, naming a non-planar adjacent face.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10.0, 10.0, 10.0).Shape();
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(3.0, 14.0).Shape();
        TopoDS_Shape fused;
        try { fused = BRepAlgoAPI_Fuse(box, cyl).Shape(); } catch (...) {}
        if (fused.IsNull()) { std::printf("  selftest: fuse failed\n"); return 1; }
        // the seam circle is not a line, so pick a cylinder-adjacent edge by hand
        TopoDS_Edge target;
        TopTools_IndexedDataMapOfShapeListOfShape efMap;
        TopExp::MapShapesAndAncestors(fused, TopAbs_EDGE, TopAbs_FACE, efMap);
        for (int i = 1; i <= efMap.Extent() && target.IsNull(); ++i) {
            const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
            if (efMap(i).Extent() != 2) continue;
            bool anyCyl = false;
            for (TopTools_ListIteratorOfListOfShape it(efMap(i)); it.More(); it.Next())
                if (std::string(surfTypeName(TopoDS::Face(it.Value()))) == "Cylinder") anyCyl = true;
            if (anyCyl) target = e;
        }
        if (target.IsNull()) { std::printf("  selftest: no cylinder-adjacent edge\n"); return 1; }
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = target; sp[0].radius = 0.5;
        const forge::occtfillet::Result nat = forge::occtfillet::makeFillet(fused, sp);
        if (nat.ok || nat.reason.find("not planar") == std::string::npos) {
            std::printf("  NEGATIVE CONTROL FAILED: ok=%d reason='%s'\n",
                        nat.ok ? 1 : 0, nat.reason.c_str());
            bad = 1;
        } else {
            std::printf("  negative control: cylinder-adjacent edge defers '%s' ok\n",
                        nat.reason.c_str());
        }
    }

    // TANGENT: round a box edge with OCCT, then re-offer OCCT the SEAM between the
    // new cylinder and the plane it is tangent to. OCCT must open ZERO contours
    // and throw — the exact mechanism this probe attributes the NATIVE_ONLY cell
    // to. A tangency check that never fired would make that column a clean zero.
    {
        const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
        double len = 0.0;
        const TopoDS_Edge e0 = pickLineEdge(box, len);
        TopoDS_Shape rounded;
        try {
            BRepFilletAPI_MakeFillet mk(box);
            mk.Add(1.0, e0);
            mk.Build();
            if (mk.IsDone()) rounded = mk.Shape();
        } catch (...) {}
        if (rounded.IsNull()) { std::printf("  selftest: could not pre-round a box\n"); return 1; }
        TopoDS_Edge seam; bool sawTangent = false;
        TopTools_IndexedDataMapOfShapeListOfShape efMap;
        TopExp::MapShapesAndAncestors(rounded, TopAbs_EDGE, TopAbs_FACE, efMap);
        for (int i = 1; i <= efMap.Extent() && seam.IsNull(); ++i) {
            const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
            if (efMap(i).Extent() != 2) continue;
            BRepAdaptor_Curve ad;
            try { ad.Initialize(e); } catch (...) { continue; }
            if (ad.GetType() != GeomAbs_Line) continue;
            TopTools_ListIteratorOfListOfShape it(efMap(i));
            const TopoDS_Face A = TopoDS::Face(it.Value()); it.Next();
            const TopoDS_Face B = TopoDS::Face(it.Value());
            bool tan = false;
            try { tan = ChFi3d::IsTangentFaces(e, A, B) == Standard_True; } catch (...) {}
            if (tan) { seam = e; sawTangent = true; }
        }
        if (!sawTangent) {
            std::printf("  TANGENT CONTROL FAILED: no tangent seam found on a rounded box\n");
            bad = 1;
        } else {
            const OcctArm oc = runOcct(rounded, seam, 0.2);
            if (oc.contours != 0 || oc.status != "THREW") {
                std::printf("  TANGENT CONTROL FAILED: contours=%d status=%s msg='%s'\n",
                            oc.contours, oc.status.c_str(), oc.msg.c_str());
                bad = 1;
            } else {
                std::printf("  tangent control: OCCT opens 0 contours and throws '%s' ok\n",
                            oc.msg.c_str());
            }
        }
    }

    // SEAM: a full 360-degree cylinder. Its longest LINE edge is the u-wrap seam,
    // where ONE face meets ITSELF — so MapShapesAndAncestors reports two entries
    // that are the same face, ChFi3d calls the connection Tangential, and OCCT
    // opens zero contours and throws. There is genuinely no material at such an
    // edge, so the ONLY honest native answers are "declined"; returning the INPUT
    // UNCHANGED with ok==true would be a fillet that did nothing reported as a
    // fillet that worked, and the corpus A/B would score it as a native win.
    // This control asserts both halves: the mechanism, and that the engine does
    // not take the third option.
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape();
        double len = 0.0;
        const TopoDS_Edge e = pickLineEdge(cyl, len);
        if (e.IsNull()) { std::printf("  selftest: no line edge on a cylinder\n"); return 1; }
        const Ctx c = contextOf(cyl, e);
        const OcctArm oc = runOcct(cyl, e, 0.5);
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = e; sp[0].radius = 0.5;
        const forge::occtfillet::Result nat = forge::occtfillet::makeFillet(cyl, sp);
        const double v0 = solidVolume(cyl);
        const double v1 = nat.ok ? solidVolume(nat.shape) : 0.0;
        const bool mech = c.adjN == 2 && c.sameFace && oc.contours == 0 && oc.status == "THREW";
        const bool honest = !nat.ok || v1 != v0;
        if (!mech || !honest) {
            std::printf("  SEAM CONTROL FAILED: adj_n=%d same_face=%d contours=%d occt=%s "
                        "| native ok=%d v0=%.10g v1=%.10g reason='%s'\n",
                        c.adjN, c.sameFace ? 1 : 0, oc.contours, oc.status.c_str(),
                        nat.ok ? 1 : 0, v0, v1, nat.reason.c_str());
            bad = 1;
        } else {
            std::printf("  seam control: cylinder seam, one face twice, OCCT 0 contours; "
                        "native declines '%s' ok\n", nat.reason.c_str());
        }
    }

    std::printf(bad ? "SELFTEST FAIL\n" : "SELFTEST PASS\n");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    std::string stepPath, partName;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a.rfind("--name=", 0) == 0) partName = a.substr(7);
        else if (a.rfind("--", 0) != 0) stepPath = a;
    }
    if (stepPath.empty()) {
        std::fprintf(stderr, "usage: fillet_defer_census <part.step> [--name=ID]\n"
                             "       fillet_defer_census --selftest\n");
        return 2;
    }
    if (partName.empty()) {
        const size_t slash = stepPath.find_last_of('/');
        partName = (slash == std::string::npos) ? stepPath : stepPath.substr(slash + 1);
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
    double bb[6] = {0, 0, 0, 0, 0, 0};
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

    int nFaces = 0, nPlanar = 0;
    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(shape, TopAbs_FACE, fm);
    nFaces = fm.Extent();
    // A body made of more than one LUMP is the single most consequential thing a
    // whole-shape rebuild can get wrong: an engine that re-sews every face and then
    // keeps one shell silently deletes the other lump. Count them.
    TopTools_IndexedMapOfShape shm, solm;
    TopExp::MapShapes(shape, TopAbs_SHELL, shm);
    TopExp::MapShapes(shape, TopAbs_SOLID, solm);
    const int nShells = shm.Extent(), nSolids = solm.Extent();
    for (int i = 1; i <= fm.Extent(); ++i) {
        gp_Pln pl;
        if (planeOf(TopoDS::Face(fm(i)), pl) && faceArea(TopoDS::Face(fm(i))) > 0.0) ++nPlanar;
    }

    double edgeLen = 0.0;
    const TopoDS_Edge e = pickLineEdge(shape, edgeLen);
    if (e.IsNull()) {
        std::printf("{\"part\":\"%s\",\"applicable\":false,\"na_reason\":\"no_line_edge\","
                    "\"nfaces\":%d,\"nplanar\":%d}\n", partName.c_str(), nFaces, nPlanar);
        return 0;
    }
    const double R = 0.05 * scale;

    const Ctx c = contextOf(shape, e);
    const double v0 = solidVolume(shape);
    const double ideal = idealBlendVolume(c, R);

    // native arm — the engine's own guard text is the attribution
    forge::occtfillet::Result nat;
    std::string natStatus = "DEFER";
    try {
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = e; sp[0].radius = R;
        nat = forge::occtfillet::makeFillet(shape, sp);
        natStatus = nat.ok ? "OK" : "DEFER";
    } catch (const Standard_Failure& ex) {
        natStatus = "THREW";
        nat.reason = ex.GetMessageString() ? ex.GetMessageString() : "Standard_Failure";
    } catch (const std::exception& ex) {
        natStatus = "THREW"; nat.reason = ex.what();
    } catch (...) { natStatus = "THREW"; nat.reason = "unknown throw"; }
    const double natVol = nat.ok ? solidVolume(nat.shape) : 0.0;

    const OcctArm oc = runOcct(shape, e, R);

    // OCCT's own edge predicates, only meaningful with exactly two adjacent faces
    int tangent = -1;
    std::string connect = "";
    if (c.adjN == 2) {
        TopTools_IndexedDataMapOfShapeListOfShape efMap;
        TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, efMap);
        const TopTools_ListOfShape& fl = efMap.FindFromKey(e);
        TopTools_ListIteratorOfListOfShape it(fl);
        const TopoDS_Face A = TopoDS::Face(it.Value()); it.Next();
        const TopoDS_Face B = TopoDS::Face(it.Value());
        try { tangent = ChFi3d::IsTangentFaces(e, A, B) == Standard_True ? 1 : 0; } catch (...) {}
        try { connect = concavityName(ChFi3d::DefineConnectType(e, A, B, 1.0e-4, Standard_False)); }
        catch (...) { connect = "throw"; }
    }

    const char* bucket = (natStatus == "OK" && oc.status == "OK")   ? "BOTH_OK"
                       : (natStatus == "OK")                        ? "NATIVE_ONLY"
                       : (oc.status == "OK")                        ? "OCCT_ONLY"
                                                                    : "NEITHER";
    const double natD = nat.ok ? std::fabs(natVol - v0) : 0.0;
    const double occD = oc.status == "OK" ? std::fabs(oc.vol - v0) : 0.0;

    std::printf(
        "{\"part\":\"%s\",\"applicable\":true,\"bucket\":\"%s\","
        "\"nfaces\":%d,\"nplanar\":%d,\"nshells\":%d,\"nsolids\":%d,"
        "\"diag\":%.10g,\"min_ext\":%.10g,\"flat\":%s,"
        "\"edge_len\":%.10g,\"radius\":%.10g,"
        "\"adj_n\":%d,\"surf_a\":\"%s\",\"surf_b\":\"%s\",\"ctx_ok\":%s,"
        "\"planar_a\":%s,\"planar_b\":%s,\"perp_a\":%s,\"perp_b\":%s,"
        "\"same_face\":%s,\"closed_edge\":%s,"
        "\"dihedral_deg\":%.6f,\"convex\":%s,"
        "\"v0\":%.10g,\"ideal_dv\":%.10g,"
        "\"native_status\":\"%s\",\"native_reason\":\"%s\",\"native_vol\":%.10g,"
        "\"native_dv\":%.10g,\"native_ratio\":%.6f,\"native_noop\":%s,"
        "\"occt_status\":\"%s\",\"occt_msg\":\"%s\",\"occt_contours\":%d,"
        "\"occt_vol\":%.10g,\"occt_dv\":%.10g,\"occt_ratio\":%.6f,"
        "\"occt_tangent\":%d,\"occt_connect\":\"%s\"}\n",
        partName.c_str(), bucket,
        nFaces, nPlanar, nShells, nSolids, diag, minExt, flat ? "true" : "false",
        edgeLen, R,
        c.adjN, c.surfA.c_str(), c.surfB.c_str(), c.ok ? "true" : "false",
        c.planarA ? "true" : "false", c.planarB ? "true" : "false",
        c.perpA ? "true" : "false", c.perpB ? "true" : "false",
        c.sameFace ? "true" : "false", c.closedEdge ? "true" : "false",
        c.dihedral * 180.0 / kPi, c.convex ? "true" : "false",
        v0, ideal,
        natStatus.c_str(), jesc(nat.reason).c_str(), natVol,
        natD, ideal > 0.0 ? natD / ideal : -1.0,
        (natStatus == "OK" && natVol == v0) ? "true" : "false",
        oc.status.c_str(), jesc(oc.msg).c_str(), oc.contours,
        oc.vol, occD, ideal > 0.0 ? occD / ideal : -1.0,
        tangent, connect.c_str());
    return 0;
}
