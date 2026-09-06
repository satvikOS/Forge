// thrusections_engine_census.cpp — WHICH PRECONDITION does the native ruled
// loft decline on, per corpus part, AS REPORTED BY THE ENGINE ITSELF.
//
// WHY A SECOND CENSUS. test/thrusections_defer_census.cpp answered the 0/600
// row with a REPLICA classifier — a copy of the engine's predicates living in
// the test. A replica is the right tool when the question is "is there a fix at
// all", and it found one (the ring-correspondence defect, 0.0% -> 51.5%). It is
// the WRONG tool for ranking what is LEFT: a replica can only report causes its
// author already thought to encode, and it agrees with the engine only until
// somebody edits either side. This file reads
// forge::occtloft::lastDeferReason() — the label the ENGINE recorded on the way
// out — so the histogram cannot drift from the code it describes.
//
// THE INPUT IS THE CORPUS A/B's INPUT, verbatim: the outer wires of the two
// largest planar faces that do not share a plane, ties broken on the candidate
// centroid ordered lexicographically (corpus_ab_coverage.cpp pickInputs, and the
// THRUSECTIONS derivation quoted at its line 71). Any other derivation would
// produce a histogram of a different question.
//
// CONTROLS (--selftest, fatal in the runner). Two constants agreeing prove
// nothing, so the self-test requires the engine to be seen taking BOTH answers
// AND the reason channel to be seen taking several distinct values:
//   * a frustum                  -> SHAPE, an EMPTY reason (polygonal path)
//   * EQUAL circles, offset in z -> SHAPE, reason "prof_edge_not_line" and a
//                                  volume equal to pi r^2 h — the polygonal path
//                                  declined and the TRANSLATED-SECTION path built
//                                  it, exactly. This is the control for the path
//                                  the deletion-bucket fix added; without it a
//                                  census could report the fix live while it was
//                                  compiled out.
//   * a 45-degree twisted pair   -> NULL,  "quad_nonplanar|xlate_not_a_translate"
//   * UNEQUAL circles            -> NULL,  "prof_edge_not_line|xlate_not_a_translate"
//   * a 4-vs-5 vertex pair       -> NULL,  "loft_vertex_count_mismatch|xlate_edge_count_mismatch"
// The reasons are CHAINS because both engines are asked in turn and each records
// why it declined; the expected strings are exact, never prefixes.
//
// COLUMNS (tab separated)
//   part  engine  reason  nEdge1  nEdge2  nLine1  nLine2  nWire1  nWire2
//   code1  code2  parallel  translate
// nEdge/nLine are the outer wire's edge count and how many of those edges are
// supported by a LINE; nWire is the face's total wire count (more than one wire
// means holes); code is the run-length curve-type signature ("L4C4" = four lines
// then four circles); parallel is 1 when the two face planes are parallel; and
// translate is |T| when section 2 is a rigid translate of section 1 under some
// edge-aligned rotation/orientation, "-" otherwise. Those columns exist so the
// single defer label can be sub-ranked without a third census.
//
// BUILD+RUN: test/run_thrusections_engine_census.sh
// Exit 0 iff every requested part produced a row.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Edge.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <Geom_Surface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BezierCurve.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <GeomAbs_CurveType.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Circ.hxx>
#include <gp_Ax2.hxx>

#include "forge/native/brep/NativeLoftPipe.hpp"

namespace {

double faceArea(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return 0.0; }
    return g.Mass();
}
gp_Pnt faceCentroid(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::SurfaceProperties(f, g); } catch (...) { return gp_Pnt(0, 0, 0); }
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
// corpus_ab_coverage.cpp betterFace, verbatim: area first, then the centroid
// ordered lexicographically so the pick is deterministic under ties.
bool betterFace(const TopoDS_Face& cand, double candArea,
                const TopoDS_Face& best, double bestArea) {
    if (best.IsNull()) return candArea > 0.0;
    if (candArea > bestArea * (1.0 + 1e-12)) return true;
    if (candArea < bestArea * (1.0 - 1e-12)) return false;
    const gp_Pnt a = faceCentroid(cand), b = faceCentroid(best);
    if (a.X() != b.X()) return a.X() < b.X();
    if (a.Y() != b.Y()) return a.Y() < b.Y();
    return a.Z() < b.Z();
}
bool isLineEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    while (!c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
        c = Handle(Geom_TrimmedCurve)::DownCast(c)->BasisCurve();
    return !c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_Line));
}
void wireCensus(const TopoDS_Wire& w, int& nEdge, int& nLine) {
    nEdge = 0;
    nLine = 0;
    if (w.IsNull()) return;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        ++nEdge;
        if (isLineEdge(ex.Current())) ++nLine;
    }
}
// Compact curve-type signature of a wire's edges in WireExplorer order, run-length
// encoded: "L4C4" is four lines then four circles. This is the sub-ranking column:
// the engine's single defer label says "an edge is not a LINE", and this says WHICH
// curve it is instead, which is what decides whether an exact native lateral face
// exists for it.
char curveCode(const TopoDS_Edge& e) {
    BRepAdaptor_Curve ac(e);
    switch (ac.GetType()) {
        case GeomAbs_Line:            return 'L';
        case GeomAbs_Circle:          return 'C';
        case GeomAbs_Ellipse:         return 'E';
        case GeomAbs_Hyperbola:       return 'H';
        case GeomAbs_Parabola:        return 'P';
        case GeomAbs_BezierCurve:     return 'Z';
        case GeomAbs_BSplineCurve:    return 'S';
        case GeomAbs_OffsetCurve:     return 'O';
        default:                      return '?';
    }
}
std::string wireCode(const TopoDS_Wire& w) {
    std::string raw;
    if (w.IsNull()) return "-";
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) raw.push_back(curveCode(ex.Current()));
    std::string out;
    for (std::size_t i = 0; i < raw.size();) {
        std::size_t j = i;
        while (j < raw.size() && raw[j] == raw[i]) ++j;
        out.push_back(raw[i]);
        out += std::to_string(j - i);
        i = j;
    }
    return out.empty() ? std::string("-") : out;
}

// Ordered sample of a wire: for each edge, its start vertex plus four interior
// points of the ORIENTED parameter range. Endpoints alone would call two arcs of
// different radius "the same"; the interior samples are what make the translation
// test below a statement about the CURVES rather than about their corners.
bool wireSamples(const TopoDS_Wire& w, std::vector<gp_Pnt>& out, int& nEdge) {
    out.clear();
    nEdge = 0;
    if (w.IsNull()) return false;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ac(ex.Current());
        const double a = ac.FirstParameter(), b = ac.LastParameter();
        const bool rev = (ex.Current().Orientation() == TopAbs_REVERSED);
        for (int k = 0; k < 5; ++k) {
            const double u = k / 5.0;
            const double t = rev ? (b + (a - b) * u) : (a + (b - a) * u);
            out.push_back(ac.Value(t));
        }
        ++nEdge;
    }
    return nEdge > 0;
}

// Is section 2 a rigid TRANSLATE of section 1 under some edge-aligned rotation
// and orientation of its sample ring? If it is, the ruled loft between them is
// EXACTLY the linear extrusion of section 1 along that vector, for ANY edge
// geometry — which is the property this column exists to count.
bool translateOf(const std::vector<gp_Pnt>& a, const std::vector<gp_Pnt>& b,
                 double tol, gp_Vec& outT) {
    const std::size_t n = a.size();
    if (n == 0 || b.size() != n || (n % 5) != 0) return false;
    const std::size_t ne = n / 5;
    for (int rev = 0; rev < 2; ++rev) {
        std::vector<gp_Pnt> c = b;
        if (rev) {
            // reverse the RING, not the vector: sample k of edge e becomes
            // sample (5-k)%5 of the edge before it, traversed the other way.
            std::vector<gp_Pnt> r(n);
            for (std::size_t i = 0; i < n; ++i) r[i] = b[(n - i) % n];
            c = r;
        }
        for (std::size_t se = 0; se < ne; ++se) {
            const std::size_t s = se * 5;
            const gp_Vec T(a[0], c[s % n]);
            bool ok = true;
            for (std::size_t i = 0; i < n && ok; ++i) {
                const gp_Pnt& q = c[(i + s) % n];
                if (gp_Vec(a[i], q).Subtracted(T).Magnitude() > tol) ok = false;
            }
            if (ok) { outT = T; return true; }
        }
    }
    return false;
}

int faceWireCount(const TopoDS_Face& f) {
    int n = 0;
    for (TopExp_Explorer ex(f, TopAbs_WIRE); ex.More(); ex.Next()) ++n;
    return n;
}

TopoDS_Wire polyWire(const std::vector<gp_Pnt>& r) {
    BRepBuilderAPI_MakePolygon mp;
    for (const gp_Pnt& p : r) mp.Add(p);
    mp.Close();
    return mp.Wire();
}
TopoDS_Wire circleWire(double z, double rad) {
    const gp_Circ c(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), rad);
    BRepBuilderAPI_MakeEdge me(c);
    BRepBuilderAPI_MakeWire mw(me.Edge());
    return mw.Wire();
}
// The same circle with its centre moved OFF the z axis, for the oblique-cone
// control below.
TopoDS_Wire circleWireAt(double z, double rad, double x) {
    const gp_Circ c(gp_Ax2(gp_Pnt(x, 0, z), gp_Dir(0, 0, 1)), rad);
    BRepBuilderAPI_MakeEdge me(c);
    BRepBuilderAPI_MakeWire mw(me.Edge());
    return mw.Wire();
}

struct Probe {
    TopoDS_Shape shape;
    std::string reason;
};
Probe callEngine(const TopoDS_Shape& a, const TopoDS_Shape& b) {
    Probe p;
    std::vector<TopoDS_Shape> secs;
    secs.push_back(a);
    secs.push_back(b);
    try { p.shape = forge::occtloft::thruSections(secs, true, true, 1.0e-6); } catch (...) {}
    const char* r = forge::occtloft::lastDeferReason();
    p.reason = (r && *r) ? r : "";
    return p;
}

int selftest() {
    int bad = 0;
    // POSITIVE: a frustum must BUILD, to the prismatoid closed form, and leave
    // no reason behind.
    {
        std::vector<gp_Pnt> r1;
        r1.push_back(gp_Pnt(-5, -5, 0)); r1.push_back(gp_Pnt(5, -5, 0));
        r1.push_back(gp_Pnt(5, 5, 0));   r1.push_back(gp_Pnt(-5, 5, 0));
        std::vector<gp_Pnt> r2;
        r2.push_back(gp_Pnt(-2, -2, 15)); r2.push_back(gp_Pnt(2, -2, 15));
        r2.push_back(gp_Pnt(2, 2, 15));   r2.push_back(gp_Pnt(-2, 2, 15));
        const Probe p = callEngine(polyWire(r1), polyWire(r2));
        double vol = 0.0;
        if (!p.shape.IsNull()) {
            GProp_GProps g;
            try { BRepGProp::VolumeProperties(p.shape, g); vol = g.Mass(); } catch (...) {}
        }
        const double want = 15.0 / 6.0 * (100.0 + 4.0 * 49.0 + 16.0);
        const bool ok = !p.shape.IsNull() && p.reason.empty() &&
                        std::fabs(vol - want) <= 1e-6 * std::max(1.0, want);
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s vol=%.6f want=%.6f  %s\n",
                    "frustum(positive)", p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(), vol, want,
                    ok ? "PASS" : "FAIL");
        if (!ok) ++bad;
    }
    // NEGATIVE 1: a 45-degree twisted pair -> quad_nonplanar.
    {
        std::vector<gp_Pnt> r1;
        r1.push_back(gp_Pnt(-5, -5, 0)); r1.push_back(gp_Pnt(5, -5, 0));
        r1.push_back(gp_Pnt(5, 5, 0));   r1.push_back(gp_Pnt(-5, 5, 0));
        const double s = std::sqrt(50.0);
        std::vector<gp_Pnt> r2;
        r2.push_back(gp_Pnt(0, -s, 20)); r2.push_back(gp_Pnt(s, 0, 20));
        r2.push_back(gp_Pnt(0, s, 20));  r2.push_back(gp_Pnt(-s, 0, 20));
        const Probe p = callEngine(polyWire(r1), polyWire(r2));
        // ★ The chain has THREE links now, one per engine thruSections tries in
        //   order, and the comparison stays EXACT rather than becoming a
        //   substring test: every time an engine is appended behind the previous
        //   ones this constant must be re-read and re-stated by a human, which is
        //   the point. What is load-bearing here is the FIRST link — the
        //   polygonal path's verdict on a twisted pair.
        const bool ok = p.shape.IsNull() &&
                        p.reason == "quad_nonplanar|xlate_not_a_translate|cone_wire_not_single_edge";
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s  %s\n", "twisted45(negative)",
                    p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(),
                    ok ? "PASS" : "FAIL (want quad_nonplanar|xlate_not_a_translate|"
                                 "cone_wire_not_single_edge)");
        if (!ok) ++bad;
    }
    // POSITIVE for the TRANSLATED-SECTION path: two EQUAL circles offset in z.
    // The polygonal engine declines (prof_edge_not_line) and the translate path
    // builds the exact cylinder, so this control asserts BOTH that the new path
    // is live and that what it builds is right to the closed form. A census run
    // where this cannot be produced is measuring an engine without the fix in it.
    {
        const double r = 5.0, h = 10.0;
        const Probe p = callEngine(circleWire(0.0, r), circleWire(h, r));
        double vol = 0.0;
        if (!p.shape.IsNull()) {
            GProp_GProps g;
            try { BRepGProp::VolumeProperties(p.shape, g); vol = std::fabs(g.Mass()); } catch (...) {}
        }
        const double want = M_PI * r * r * h;
        const bool ok = !p.shape.IsNull() && p.reason == "prof_edge_not_line" &&
                        std::fabs(vol - want) <= 1e-6 * want;
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s vol=%.6f want=%.6f  %s\n",
                    "cylinder(xlate+)", p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(), vol, want,
                    ok ? "PASS" : "FAIL (want SHAPE, prof_edge_not_line, pi r^2 h)");
        if (!ok) ++bad;
    }
    // POSITIVE for the COAXIAL-CIRCLE path: two UNEQUAL coaxial circles.
    // ★ RE-AUTHORED. This was a NEGATIVE control ("unequal circles are not a
    //   translate either"), and it went red the moment the coaxial-circle engine
    //   landed, because that pair is exactly what the third path now builds: the
    //   right circular frustum. Flipping it to a POSITIVE keeps it load-bearing
    //   and makes it say something stronger — the polygonal path declines
    //   (prof_edge_not_line), the translated path declines (xlate_not_a_translate)
    //   and the cone path builds, to the closed form pi h/3 (r0^2+r0 r1+r1^2). A
    //   census run where this cannot be produced is measuring an engine without
    //   that fix in it. The NEGATIVE it used to be is not lost: the off-axis pair
    //   below is the same input with one degree of freedom turned, and it must
    //   still decline.
    {
        const double r0 = 5.0, r1 = 3.0, h = 10.0;
        const Probe p = callEngine(circleWire(0.0, r0), circleWire(h, r1));
        double vol = 0.0;
        if (!p.shape.IsNull()) {
            GProp_GProps g;
            try { BRepGProp::VolumeProperties(p.shape, g); vol = std::fabs(g.Mass()); } catch (...) {}
        }
        const double want = M_PI * h / 3.0 * (r0 * r0 + r0 * r1 + r1 * r1);
        const bool ok = !p.shape.IsNull() &&
                        p.reason == "prof_edge_not_line|xlate_not_a_translate" &&
                        std::fabs(vol - want) <= 1e-6 * want;
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s vol=%.6f want=%.6f  %s\n",
                    "cone(cone+)", p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(), vol, want,
                    ok ? "PASS" : "FAIL (want SHAPE, prof_edge_not_line|xlate_not_a_translate, "
                                 "pi h/3 (r0^2+r0 r1+r1^2))");
        if (!ok) ++bad;
    }
    // NEGATIVE 2: the SAME unequal circles with the second centre moved OFF the
    // common axis. The loft is then an OBLIQUE cone, which no analytic conical
    // surface represents, so all three engines must decline — the control that
    // keeps the coaxial-circle path from being a rubber stamp on any circle pair.
    {
        const Probe p = callEngine(circleWire(0.0, 5.0), circleWireAt(10.0, 3.0, 4.0));
        const bool ok = p.shape.IsNull() &&
                        p.reason == "prof_edge_not_line|xlate_not_a_translate|"
                                    "cone_centres_off_axis";
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s  %s\n", "circles-offaxis(neg)",
                    p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(),
                    ok ? "PASS" : "FAIL (want prof_edge_not_line|xlate_not_a_translate|"
                                 "cone_centres_off_axis)");
        if (!ok) ++bad;
    }
    // NEGATIVE 3: 4 vertices against 5 -> loft_vertex_count_mismatch.
    {
        std::vector<gp_Pnt> r1;
        r1.push_back(gp_Pnt(-5, -5, 0)); r1.push_back(gp_Pnt(5, -5, 0));
        r1.push_back(gp_Pnt(5, 5, 0));   r1.push_back(gp_Pnt(-5, 5, 0));
        std::vector<gp_Pnt> r2;
        r2.push_back(gp_Pnt(-4, -4, 9)); r2.push_back(gp_Pnt(4, -4, 9));
        r2.push_back(gp_Pnt(4, 0, 9));   r2.push_back(gp_Pnt(4, 4, 9));
        r2.push_back(gp_Pnt(-4, 4, 9));
        const Probe p = callEngine(polyWire(r1), polyWire(r2));
        // ★ THIS CONSTANT WAS ALREADY STALE, and it took the WHOLE CENSUS DOWN
        //   with it: the runner treats a failed control as fatal, so nothing here
        //   has emitted a row since. MEASURED at origin/archdisc f53deeae, this
        //   file compiled against that commit's own engine: the reason is
        //   `loft_vertex_count_mismatch|xlate_not_a_translate_length`, not
        //   `...|xlate_edge_count_mismatch`. The translated path gained a LENGTH
        //   discriminator that separates "the same curve with an extra vertex"
        //   from "two different curves", and a 4-gon against a 5-gon of unequal
        //   perimeter is the second — so the engine deliberately stopped saying
        //   the old label for this input and the expectation was never updated.
        //   Corrected here, with the cone path's link appended.
        const bool ok = p.shape.IsNull() &&
                        p.reason == "loft_vertex_count_mismatch|xlate_not_a_translate_length|"
                                    "cone_wire_not_single_edge";
        std::printf("SELFTEST %-22s engine=%-5s reason=%-30s  %s\n", "count4v5(negative)",
                    p.shape.IsNull() ? "NULL" : "SHAPE",
                    p.reason.empty() ? "(none)" : p.reason.c_str(),
                    ok ? "PASS" : "FAIL (want loft_vertex_count_mismatch|"
                                 "xlate_not_a_translate_length|cone_wire_not_single_edge)");
        if (!ok) ++bad;
    }
    std::printf("SELFTEST %s\n", bad == 0 ? "ALL PASS" : "FAILED");
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--selftest") == 0) return selftest();
    if (argc < 2) {
        std::fprintf(stderr, "usage: thrusections_engine_census [--selftest] <step>...\n");
        return 2;
    }

    for (int ai = 1; ai < argc; ++ai) {
        const std::string path = argv[ai];
        std::string name = path;
        {
            size_t s = name.find_last_of('/');
            if (s != std::string::npos) name = name.substr(s + 1);
            size_t d = name.find_last_of('.');
            if (d != std::string::npos) name = name.substr(0, d);
        }

        TopoDS_Shape shape;
        {
            STEPControl_Reader rd;
            IFSelect_ReturnStatus st = IFSelect_RetFail;
            try { st = rd.ReadFile(path.c_str()); } catch (...) { st = IFSelect_RetFail; }
            if (st != IFSelect_RetDone) {
                std::printf("%s\tERR\tstep_read_failed\t0\t0\t0\t0\t0\t0\t-\t-\t0\t-\n", name.c_str());
                continue;
            }
            try { rd.TransferRoots(); } catch (...) {}
            try { shape = rd.OneShape(); } catch (...) {}
            if (shape.IsNull()) {
                std::printf("%s\tERR\tstep_transfer_empty\t0\t0\t0\t0\t0\t0\t-\t-\t0\t-\n", name.c_str());
                continue;
            }
        }

        // bbox diagonal, for the coplanarity test's absolute tolerance (as in the A/B)
        double bb[6] = {0, 0, 0, 0, 0, 0};
        bool first = true;
        for (TopExp_Explorer ex(shape, TopAbs_VERTEX); ex.More(); ex.Next()) {
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
        if (first) {
            std::printf("%s\tERR\tno_vertices\t0\t0\t0\t0\t0\t0\t-\t-\t0\t-\n", name.c_str());
            continue;
        }
        const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
        const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);

        TopoDS_Face big, second;
        double bigA = 0.0, secondA = 0.0;
        gp_Pln bigPln;
        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        for (int i = 1; i <= fm.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(fm(i));
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            if (betterFace(f, a, big, bigA)) { big = f; bigA = a; bigPln = pl; }
        }
        if (!big.IsNull()) {
            for (int i = 1; i <= fm.Extent(); ++i) {
                const TopoDS_Face f = TopoDS::Face(fm(i));
                if (f.IsSame(big)) continue;
                gp_Pln pl;
                if (!planeOf(f, pl)) continue;
                const double a = faceArea(f);
                if (!(a > 0.0)) continue;
                const bool sameNormal =
                    pl.Axis().Direction().IsParallel(bigPln.Axis().Direction(), 1e-6);
                if (sameNormal &&
                    std::fabs(bigPln.Distance(pl.Location())) < 1e-7 * std::max(1.0, diag))
                    continue;
                if (betterFace(f, a, second, secondA)) { second = f; secondA = a; }
            }
        }
        if (big.IsNull() || second.IsNull()) {
            std::printf("%s\tN/A\tneed_two_non_coplanar_planar_faces\t0\t0\t0\t0\t0\t0\t-\t-\t0\t-\n",
                        name.c_str());
            continue;
        }
        const TopoDS_Wire w1 = BRepTools::OuterWire(big);
        const TopoDS_Wire w2 = BRepTools::OuterWire(second);
        if (w1.IsNull() || w2.IsNull()) {
            std::printf("%s\tN/A\tno_outer_wire\t0\t0\t0\t0\t0\t0\t-\t-\t0\t-\n", name.c_str());
            continue;
        }
        int e1 = 0, l1 = 0, e2 = 0, l2 = 0;
        wireCensus(w1, e1, l1);
        wireCensus(w2, e2, l2);
        const Probe pr = callEngine(w1, w2);
        // The translation tolerance is ABSOLUTE and scaled to the part, not a bare
        // 1e-6: these are imported STEP solids whose vertices already carry the
        // reader's own rounding, and a fixed micron on a 500 mm part would answer a
        // question about the importer rather than about the geometry.
        const double ttol = 1.0e-7 * std::max(1.0, diag);
        std::vector<gp_Pnt> s1, s2;
        int ne1 = 0, ne2 = 0;
        gp_Vec T(0, 0, 0);
        const bool haveS = wireSamples(w1, s1, ne1) && wireSamples(w2, s2, ne2);
        const bool isTrans = haveS && translateOf(s1, s2, ttol, T);
        gp_Pln pl2;
        const bool par = planeOf(second, pl2) &&
                         pl2.Axis().Direction().IsParallel(bigPln.Axis().Direction(), 1e-6);
        char tbuf[32];
        if (isTrans) std::snprintf(tbuf, sizeof tbuf, "%.6f", T.Magnitude());
        else std::snprintf(tbuf, sizeof tbuf, "-");
        std::printf("%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%s\t%s\t%d\t%s\n",
                    name.c_str(), pr.shape.IsNull() ? "NULL" : "SHAPE",
                    pr.reason.empty() ? "(none)" : pr.reason.c_str(),
                    e1, e2, l1, l2, faceWireCount(big), faceWireCount(second),
                    wireCode(w1).c_str(), wireCode(w2).c_str(), par ? 1 : 0, tbuf);
        std::fflush(stdout);
    }
    return 0;
}
