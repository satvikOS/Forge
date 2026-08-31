// thicksolid_input_census.cpp — WHAT IS IN THE CORPUS, for family THICKSOLID?
//
// THE QUESTION. The 600-part corpus A/B (reports/CORPUS_AB_COVERAGE.md §3)
// measures THICKSOLID at native 1.2% (7/600) against an OCCT baseline of 22.2%
// (133/600). Two facts about that row are not decidable from the A/B's own
// output and both change what the row MEANS:
//
//   1. Is the INPUT sound? Every downstream shape inherits its source's defects.
//      If the corpus's solids were themselves invalid, "both arms return an
//      invalid solid" would be a fact about the corpus, not about either engine.
//   2. What does the native engine's SCOPE actually exclude here? The engine's
//      quadric path admits only Geom_{Plane,Cylindrical,Conical,Spherical,
//      Toroidal} faces, and among those admits a PLANAR face only when every one
//      of its wires is exactly one full circle. Whether that second rule or the
//      surface-type rule binds first is the difference between "the corpus is
//      NURBS" (a capability bound) and "the corpus is analytic but mixed"
//      (a bounded engine gap).
//
// This probe answers both by MEASURING the input, with no engine in the loop —
// it links no forge source at all, only OCCT — so nothing it reports can be an
// artefact of the code under test.
//
// Per part it prints one JSON object with:
//   src_valid          BRepCheck_Analyzer on the imported shape  (1/0/-1 threw)
//   nsolid/nshell/nface/nedge
//   face-type census   plane / cyl / cone / sph / tor / other, over the basis
//                      surface (Geom_RectangularTrimmedSurface unwrapped), the
//                      same classification src/native/brep/NativeThickSolid.cpp
//                      uses
//   edge-type census   line / circle / other, over the basis curve
//   planar_wire_census for PLANAR faces only: how many carry exactly one wire
//                      that is exactly one full circle (the engine's admissible
//                      form), and how many do not
//   curved_multiwire   non-planar faces carrying more than one wire
//   curved_partial_u   non-planar faces whose u-range is not a full 2*pi
//
// CONTROL. --selftest builds three shapes whose answers are known independently
// of this file and requires them back: a 10 mm BOX (valid, 6 planar faces, 12
// line edges, 0 admissible circular planar wires), a CYLINDER (valid, 1 cyl +
// 2 planar faces, and BOTH planar faces admissible — one full-circle wire each),
// and a box with a through-hole (2 planar faces carrying TWO wires each, so
// NOT admissible under the one-full-circle rule). A census that classified
// everything as "other" would look exactly like a real result on a NURBS corpus.
//
// BUILD: test/build_thicksolid_input_census.sh
// Exit 0 iff the part imported.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>
#include <TopExp.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Iterator.hxx>
#include <gp_Circ.hxx>

namespace {

constexpr double kPi = 3.14159265358979323846;

// Unwrap to the analytic basis — identical to NativeThickSolid.cpp::basisSurface.
Handle(Geom_Surface) basisSurface(const Handle(Geom_Surface)& s) {
    Handle(Geom_Surface) cur = s;
    for (int g = 0; g < 8 && !cur.IsNull(); ++g) {
        Handle(Geom_RectangularTrimmedSurface) rt =
            Handle(Geom_RectangularTrimmedSurface)::DownCast(cur);
        if (rt.IsNull()) break;
        cur = rt->BasisSurface();
    }
    return cur;
}

Handle(Geom_Curve) basisCurve(const TopoDS_Edge& e, double& f, double& l) {
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    for (int g = 0; g < 8 && !c.IsNull(); ++g) {
        Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(c);
        if (tc.IsNull()) break;
        c = tc->BasisCurve();
    }
    return c;
}

enum SK { SK_PLANE, SK_CYL, SK_CONE, SK_SPH, SK_TOR, SK_OTHER };

SK surfKind(const Handle(Geom_Surface)& s) {
    if (s.IsNull()) return SK_OTHER;
    if (!Handle(Geom_Plane)::DownCast(s).IsNull())              return SK_PLANE;
    if (!Handle(Geom_CylindricalSurface)::DownCast(s).IsNull()) return SK_CYL;
    if (!Handle(Geom_ConicalSurface)::DownCast(s).IsNull())     return SK_CONE;
    if (!Handle(Geom_SphericalSurface)::DownCast(s).IsNull())   return SK_SPH;
    if (!Handle(Geom_ToroidalSurface)::DownCast(s).IsNull())    return SK_TOR;
    return SK_OTHER;
}

// Same predicate as NativeThickSolid.cpp::edgeFullCircle.
bool edgeFullCircle(const TopoDS_Edge& e) {
    if (BRep_Tool::Degenerated(e)) return false;
    double f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = basisCurve(e, f, l);
    if (c.IsNull()) return false;
    if (Handle(Geom_Circle)::DownCast(c).IsNull()) return false;
    return std::fabs(std::fabs(l - f) - 2.0 * kPi) <= 1.0e-6;
}

struct Census {
    int src_valid = -1;
    double src_vol = 0.0, src_area = 0.0;
    int nsolid = 0, nshell = 0, nface = 0, nedge = 0;
    int f_plane = 0, f_cyl = 0, f_cone = 0, f_sph = 0, f_tor = 0, f_other = 0;
    int e_line = 0, e_circle = 0, e_other = 0;
    int planar_admissible = 0, planar_not_admissible = 0;
    int curved_multiwire = 0, curved_partial_u = 0;
    int all_analytic = 0;   // 1 iff f_other == 0
    int all_planar = 0;     // 1 iff every face is a plane

    // ---- the CEILING of the candidate fix (see the banner, question 3) ------
    // A planar face's wire is one of three shapes. Only the second is admissible
    // today; the candidate fix adds the first.
    int pw_all_line = 0;      // wire is a closed loop of LINE edges (a polygon)
    int pw_one_circle = 0;    // wire is exactly ONE full circle  (admissible now)
    int pw_mixed = 0;         // anything else: line+circle in one wire, splines, arcs
    // Every LINE edge's two neighbours. The candidate fix offsets a line edge as
    // the meet of the two OFFSET PLANES, which needs both neighbours planar.
    int el_plane_plane = 0, el_other = 0;
    int e_nonmanifold = 0;    // != 2 distinct adjacent faces and not a seam
    int e_neither_line_nor_circle = 0;
    // 1 iff every precondition the candidate fix would still impose holds.
    int hybrid_admissible = 0;
};

Census censusOf(const TopoDS_Shape& sh) {
    Census c;
    try { BRepCheck_Analyzer an(sh); c.src_valid = an.IsValid() ? 1 : 0; }
    catch (...) { c.src_valid = -1; }

    // The SOURCE volume is what makes the OCCT arm's result readable: a hollow of
    // wall t must have a volume STRICTLY BELOW the solid it was cut from, and by
    // roughly (surface area * t). A "success" whose volume equals or exceeds the
    // source did not hollow anything.
    try { GProp_GProps g; BRepGProp::VolumeProperties(sh, g); c.src_vol = std::fabs(g.Mass()); }
    catch (...) { c.src_vol = 0.0; }
    try { GProp_GProps g; BRepGProp::SurfaceProperties(sh, g); c.src_area = g.Mass(); }
    catch (...) { c.src_area = 0.0; }

    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(sh, TopAbs_SOLID, m); c.nsolid = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_SHELL, m); c.nshell = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_FACE,  m); c.nface  = m.Extent(); m.Clear();
    TopExp::MapShapes(sh, TopAbs_EDGE,  m); c.nedge  = m.Extent(); m.Clear();

    TopTools_IndexedMapOfShape fm;
    TopExp::MapShapes(sh, TopAbs_FACE, fm);
    for (int i = 1; i <= fm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(fm.FindKey(i));
        const Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
        const SK k = surfKind(s);
        switch (k) {
            case SK_PLANE: ++c.f_plane; break;
            case SK_CYL:   ++c.f_cyl;   break;
            case SK_CONE:  ++c.f_cone;  break;
            case SK_SPH:   ++c.f_sph;   break;
            case SK_TOR:   ++c.f_tor;   break;
            default:       ++c.f_other; break;
        }

        int nWires = 0;
        for (TopoDS_Iterator it(f); it.More(); it.Next())
            if (it.Value().ShapeType() == TopAbs_WIRE) ++nWires;

        if (k == SK_PLANE) {
            // The engine's admissible planar form: every wire is exactly ONE
            // full circle (NativeThickSolid.cpp step 2).
            bool ok = nWires >= 1;
            for (TopoDS_Iterator it(f); ok && it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    ++nE;
                    if (!edgeFullCircle(TopoDS::Edge(ee.Current()))) { ok = false; break; }
                }
                if (nE != 1) ok = false;
            }
            if (ok) ++c.planar_admissible; else ++c.planar_not_admissible;

            // The finer shape census the candidate fix is scoped against.
            for (TopoDS_Iterator it(f); it.More(); it.Next()) {
                if (it.Value().ShapeType() != TopAbs_WIRE) continue;
                int nE = 0, nLine = 0, nCirc = 0;
                for (TopExp_Explorer ee(it.Value(), TopAbs_EDGE); ee.More(); ee.Next()) {
                    const TopoDS_Edge e = TopoDS::Edge(ee.Current());
                    ++nE;
                    double a = 0, b = 0;
                    Handle(Geom_Curve) cu = basisCurve(e, a, b);
                    if (!cu.IsNull() && !Handle(Geom_Line)::DownCast(cu).IsNull()) ++nLine;
                    else if (edgeFullCircle(e)) ++nCirc;
                }
                if (nE >= 3 && nLine == nE)          ++c.pw_all_line;
                else if (nE == 1 && nCirc == 1)      ++c.pw_one_circle;
                else                                 ++c.pw_mixed;
            }
        } else {
            if (nWires != 1) ++c.curved_multiwire;
            double u1 = 0, u2 = 0, v1 = 0, v2 = 0;
            BRepTools::UVBounds(f, u1, u2, v1, v2);
            if (std::fabs((u2 - u1) - 2.0 * kPi) > 1.0e-7) ++c.curved_partial_u;
        }
    }

    // Edge census, with the ADJACENT-FACE kinds the candidate fix depends on.
    // The engine's step-3 loop walks exactly this map, so the neighbour rule
    // measured here is the one it would apply.
    TopTools_IndexedDataMapOfShapeListOfShape efMap;
    TopExp::MapShapesAndAncestors(sh, TopAbs_EDGE, TopAbs_FACE, efMap);
    for (int i = 1; i <= efMap.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(efMap.FindKey(i));
        double f = 0, l = 0;
        Handle(Geom_Curve) cu = basisCurve(e, f, l);
        const bool isLine = !cu.IsNull() && !Handle(Geom_Line)::DownCast(cu).IsNull();
        const bool isCirc = !cu.IsNull() && !Handle(Geom_Circle)::DownCast(cu).IsNull();
        if (isLine)      ++c.e_line;
        else if (isCirc) ++c.e_circle;
        else             ++c.e_other;

        if (BRep_Tool::Degenerated(e)) continue;
        if (!isLine && !edgeFullCircle(e)) ++c.e_neither_line_nor_circle;

        // Distinct adjacent faces. One face listed twice is a SEAM, which the
        // engine skips; anything other than one or two distinct faces is
        // non-manifold for its purposes.
        TopTools_IndexedMapOfShape nb;
        for (TopTools_ListIteratorOfListOfShape it(efMap.FindFromIndex(i)); it.More(); it.Next())
            nb.Add(it.Value());
        if (nb.Extent() == 1) continue;               // seam
        if (nb.Extent() != 2) { ++c.e_nonmanifold; continue; }
        if (isLine) {
            const SK ka = surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(nb.FindKey(1)))));
            const SK kb = surfKind(basisSurface(BRep_Tool::Surface(TopoDS::Face(nb.FindKey(2)))));
            if (ka == SK_PLANE && kb == SK_PLANE) ++c.el_plane_plane;
            else                                  ++c.el_other;
        }
    }

    c.all_analytic = (c.f_other == 0) ? 1 : 0;
    c.all_planar   = (c.nface > 0 && c.f_plane == c.nface) ? 1 : 0;

    // ---- the candidate fix's own precondition set, all of it -----------------
    // Admit a planar face whose wires are POLYGONS as well as single circles, and
    // offset a LINE edge as the meet of its two offset PLANES. Everything else
    // the engine already demands stays: analytic surfaces only, curved faces a
    // full revolution with one wire, every edge a line or a full circle, manifold.
    c.hybrid_admissible =
        (c.all_analytic == 1 && c.nface > 0 &&
         c.pw_mixed == 0 &&
         c.curved_multiwire == 0 && c.curved_partial_u == 0 &&
         c.e_neither_line_nor_circle == 0 &&
         c.e_nonmanifold == 0 &&
         c.el_other == 0) ? 1 : 0;
    return c;
}

void emit(const char* part, const Census& c) {
    std::printf(
        "{\"part\":\"%s\",\"src_valid\":%d,\"src_vol\":%.10g,\"src_area\":%.10g,"
        "\"nsolid\":%d,\"nshell\":%d,\"nface\":%d,"
        "\"nedge\":%d,\"f_plane\":%d,\"f_cyl\":%d,\"f_cone\":%d,\"f_sph\":%d,"
        "\"f_tor\":%d,\"f_other\":%d,\"e_line\":%d,\"e_circle\":%d,\"e_other\":%d,"
        "\"planar_admissible\":%d,\"planar_not_admissible\":%d,"
        "\"curved_multiwire\":%d,\"curved_partial_u\":%d,"
        "\"all_analytic\":%d,\"all_planar\":%d,"
        "\"pw_all_line\":%d,\"pw_one_circle\":%d,\"pw_mixed\":%d,"
        "\"el_plane_plane\":%d,\"el_other\":%d,\"e_nonmanifold\":%d,"
        "\"e_neither_line_nor_circle\":%d,\"hybrid_admissible\":%d}\n",
        part, c.src_valid, c.src_vol, c.src_area,
        c.nsolid, c.nshell, c.nface, c.nedge, c.f_plane, c.f_cyl,
        c.f_cone, c.f_sph, c.f_tor, c.f_other, c.e_line, c.e_circle, c.e_other,
        c.planar_admissible, c.planar_not_admissible, c.curved_multiwire,
        c.curved_partial_u, c.all_analytic, c.all_planar,
        c.pw_all_line, c.pw_one_circle, c.pw_mixed,
        c.el_plane_plane, c.el_other, c.e_nonmanifold,
        c.e_neither_line_nor_circle, c.hybrid_admissible);
}

int selftest() {
    int bad = 0;
    auto want = [&](const char* what, long got, long expect) {
        const bool ok = (got == expect);
        std::printf("  %-38s got %-6ld expect %-6ld %s\n", what, got, expect,
                    ok ? "ok" : "FAIL");
        if (!ok) ++bad;
    };
    auto wantD = [&](const char* what, double got, double expect) {
        const bool ok = std::fabs(got - expect) <= 1e-9 * std::max(1.0, std::fabs(expect));
        std::printf("  %-38s got %-14.8g expect %-14.8g %s\n", what, got, expect,
                    ok ? "ok" : "FAIL");
        if (!ok) ++bad;
    };

    const TopoDS_Shape box = BRepPrimAPI_MakeBox(10.0, 10.0, 10.0).Shape();
    Census b = censusOf(box);
    want("box src_valid", b.src_valid, 1);
    want("box f_plane", b.f_plane, 6);
    want("box f_other", b.f_other, 0);
    want("box e_line", b.e_line, 12);
    want("box planar_admissible", b.planar_admissible, 0);
    want("box all_planar", b.all_planar, 1);
    wantD("box src_vol", b.src_vol, 1000.0);
    wantD("box src_area", b.src_area, 600.0);
    want("box pw_all_line", b.pw_all_line, 6);
    want("box pw_one_circle", b.pw_one_circle, 0);
    want("box pw_mixed", b.pw_mixed, 0);
    want("box el_plane_plane", b.el_plane_plane, 12);
    want("box el_other", b.el_other, 0);
    want("box e_nonmanifold", b.e_nonmanifold, 0);
    want("box hybrid_admissible", b.hybrid_admissible, 1);

    const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 20.0).Shape();
    Census y = censusOf(cyl);
    want("cylinder src_valid", y.src_valid, 1);
    want("cylinder f_cyl", y.f_cyl, 1);
    want("cylinder f_plane", y.f_plane, 2);
    want("cylinder planar_admissible", y.planar_admissible, 2);
    want("cylinder planar_not_admissible", y.planar_not_admissible, 0);
    want("cylinder all_planar", y.all_planar, 0);
    want("cylinder all_analytic", y.all_analytic, 1);
    wantD("cylinder src_vol", y.src_vol, kPi * 25.0 * 20.0);
    wantD("cylinder src_area", y.src_area, 2.0 * kPi * 25.0 + 2.0 * kPi * 5.0 * 20.0);
    want("cylinder pw_one_circle", y.pw_one_circle, 2);
    want("cylinder pw_all_line", y.pw_all_line, 0);
    want("cylinder pw_mixed", y.pw_mixed, 0);
    want("cylinder hybrid_admissible", y.hybrid_admissible, 1);

    // A box with a through-hole: the two capping planes now carry TWO wires each
    // (an outer square and an inner circle), so neither is admissible.
    const TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(5.0, 5.0, -1.0), gp_Dir(0, 0, 1)), 2.0, 12.0).Shape();
    TopoDS_Shape holed;
    try { holed = BRepAlgoAPI_Cut(box, drill).Shape(); } catch (...) {}
    if (holed.IsNull()) { std::printf("  holed-box cut FAILED\n"); ++bad; }
    else {
        Census h = censusOf(holed);
        want("holed box f_cyl", h.f_cyl, 1);
        want("holed box f_plane", h.f_plane, 6);
        want("holed box planar_admissible", h.planar_admissible, 0);
        want("holed box planar_not_admissible", h.planar_not_admissible, 6);
        want("holed box all_analytic", h.all_analytic, 1);
        wantD("holed box src_vol", h.src_vol, 1000.0 - kPi * 4.0 * 10.0);
        // 6 square outer wires + 2 circular hole wires (top and bottom cap).
        want("holed box pw_all_line", h.pw_all_line, 6);
        want("holed box pw_one_circle", h.pw_one_circle, 2);
        want("holed box pw_mixed", h.pw_mixed, 0);
        want("holed box el_plane_plane", h.el_plane_plane, 12);
        want("holed box el_other", h.el_other, 0);
        // THE CASE THE CANDIDATE FIX EXISTS FOR: a polygonal plate with a
        // cylindrical hole is inadmissible today and admissible after.
        want("holed box planar_admissible (today)", h.planar_admissible, 0);
        want("holed box hybrid_admissible", h.hybrid_admissible, 1);
    }

    std::printf(bad ? "FAIL: %d control(s) wrong\n" : "PASS: every control matched\n", bad);
    return bad ? 1 : 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
    if (argc < 2) { std::fprintf(stderr, "usage: %s <part.step> | --selftest\n", argv[0]); return 2; }

    std::string path = argv[1];
    std::string name = path;
    {
        const size_t slash = name.find_last_of('/');
        if (slash != std::string::npos) name = name.substr(slash + 1);
        const size_t dot = name.find_last_of('.');
        if (dot != std::string::npos) name = name.substr(0, dot);
    }

    STEPControl_Reader rd;
    IFSelect_ReturnStatus st = IFSelect_RetFail;
    try { st = rd.ReadFile(path.c_str()); } catch (...) { st = IFSelect_RetFail; }
    if (st != IFSelect_RetDone) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str());
        return 1;
    }
    try { rd.TransferRoots(); } catch (...) {}
    TopoDS_Shape sh;
    try { sh = rd.OneShape(); } catch (...) {}
    if (sh.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str());
        return 1;
    }
    emit(name.c_str(), censusOf(sh));
    return 0;
}
