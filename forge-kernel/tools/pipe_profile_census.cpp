// forge-kernel/tools/pipe_profile_census.cpp
//
// WHAT SHAPE IS THE PROFILE FACE family E is actually handed, and does the
// ARC-CHAIN DECOMPOSITION the engine rests on reproduce OCCT's own measurement
// of it? One row of JSON per part.
//
// WHY IT EXISTS. src/native/brep/NativeLoftPipe.cpp's arc-swept lateral face
// decomposes the region bounded by a ring of LINE and CIRCULAR-ARC edges as
//
//     region = chordPolygon (+) every arc bulging AWAY from it
//                           (-) every arc bulging INTO it
//
// and then assembles the SWEPT SOLID with that same boolean expression over
// swept atoms. Two things have to be true before a single solid is built:
//
//   1. the corpus really is made of that shape, and in what proportion — the
//      engine's scope should be measured, not assumed;
//   2. the decomposition itself is right, INDEPENDENTLY of any B-rep the engine
//      might produce. This tool checks it the only way that is independent: it
//      computes the region's area and centroid in CLOSED FORM (chord-polygon
//      shoelace, plus (r^2/2)(D - sin D) per circular segment with centroid
//      4 r sin^3(D/2) / (3(D - sin D)) along the bisector) and compares them to
//      OCCT's BRepGProp::SurfaceProperties on the same face. If those agree,
//      the ADD/SUB decision was right on every arc of every ring.
//
// The face picked is exactly the one test/corpus_ab_coverage.cpp feeds to
// forge::occtloft::pipe: the LARGEST PLANAR face, ties broken by centroid.
//
// build:
//   clang++ -std=c++20 -O2 -I$OCCT/include/opencascade tools/pipe_profile_census.cpp \
//     -L$OCCT/lib -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep \
//     -lTKTopAlgo -lTKGeomAlgo -lTKDESTEP -lTKXSBase -o pipe_profile_census
// run:
//   pipe_profile_census <part.step> [more.step ...] > census.jsonl
//
// This tool is a MEASUREMENT, not a gate: it links no forge code and calls no
// forge engine, so it cannot be made to agree with the engine by changing the
// engine.
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>

#include <BRepGProp.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_Plane.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Transient.hxx>
#include <STEPControl_Reader.hxx>
#include <Standard_Type.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Pln.hxx>

namespace {

const double kPi = 3.14159265358979323846;
const double kTwoPi = 6.28318530717958647692;

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
// The SAME deterministic pick test/corpus_ab_coverage.cpp uses.
bool betterFace(const TopoDS_Face& c, double ca, const TopoDS_Face& b, double ba) {
    if (b.IsNull()) return ca > 0.0;
    if (ca > ba * (1.0 + 1e-12)) return true;
    if (ca < ba * (1.0 - 1e-12)) return false;
    const gp_Pnt x = faceCentroid(c), y = faceCentroid(b);
    if (x.X() != y.X()) return x.X() < y.X();
    if (x.Y() != y.Y()) return x.Y() < y.Y();
    return x.Z() < y.Z();
}

struct Seg { bool arc = false; gp_Pnt a, b, c; double r = 0.0, dth = 0.0; };

// Parse a wire into an ordered LINE / ARC chain. `why` names the first thing
// that made it not one.
bool parseRing(const TopoDS_Wire& w, const gp_Dir& n, std::vector<Seg>& out,
               const char*& why, std::string& types, std::string& badType) {
    out.clear();
    types.clear();
    gp_Ax2 fr(gp_Pnt(0, 0, 0), n);
    const gp_Vec e1(fr.XDirection()), e2(fr.YDirection());
    std::vector<Seg> got;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge e = ex.Current();
        Standard_Real f = 0.0, l = 0.0;
        Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
        while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
            cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
        if (cv.IsNull()) { why = "no_curve"; return false; }
        Seg s;
        s.a = BRep_Tool::Pnt(ex.CurrentVertex());
        if (cv->IsKind(STANDARD_TYPE(Geom_Line))) {
            types += "L";
        } else if (cv->IsKind(STANDARD_TYPE(Geom_Circle))) {
            const gp_Circ ci = Handle(Geom_Circle)::DownCast(cv)->Circ();
            if (!ci.Axis().Direction().IsParallel(n, 1.0e-7)) { why = "arc_axis"; return false; }
            types += "C";
            s.arc = true;
            s.c = ci.Location();
            s.r = ci.Radius();
            double sgn = (e.Orientation() == TopAbs_REVERSED) ? -1.0 : 1.0;
            if (ci.Axis().Direction().Dot(n) < 0.0) sgn = -sgn;
            s.dth = sgn * std::fabs(l - f);
        } else {
            // ★ REPORT WHAT IT ACTUALLY IS. An earlier draft wrote "S" for every
            // curve that was neither a line nor a circle, which would have made
            // the claim "the 106 out-of-reach parts are B-SPLINES" unverifiable
            // from this tool's own output -- an ellipse or a Bezier would have
            // read identically. The OCCT type name is recorded instead.
            badType = cv->DynamicType()->Name();
            types += "?";
            why = "edge_type";
            return false;
        }
        got.push_back(s);
    }
    if (got.empty()) { why = "empty"; return false; }
    for (std::size_t i = 0; i < got.size(); ++i) got[i].b = got[(i + 1) % got.size()].a;
    (void)e1; (void)e2;
    out.swap(got);
    return true;
}

// CLOSED-FORM signed area and first moments of the region a ring bounds.
void ringMoments(const std::vector<Seg>& sg, const gp_Dir& n, const gp_Pnt& org,
                 double& sArea, double& mx, double& my, int& nAdd, int& nSub) {
    gp_Ax2 fr(org, n);
    const gp_Vec e1(fr.XDirection()), e2(fr.YDirection());
    auto uv = [&](const gp_Pnt& p, double& x, double& y) {
        const gp_Vec d(org, p); x = d.Dot(e1); y = d.Dot(e2);
    };
    const std::size_t m = sg.size();
    // a wire that is ONE full circle has a degenerate chord polygon
    if (m == 1 && sg[0].arc && std::fabs(std::fabs(sg[0].dth) - kTwoPi) < 1.0e-9) {
        double cx, cy; uv(sg[0].c, cx, cy);
        sArea = (sg[0].dth > 0 ? 1.0 : -1.0) * kPi * sg[0].r * sg[0].r;
        mx = sArea * cx; my = sArea * cy; nAdd = nSub = 0;
        return;
    }
    std::vector<double> px(m), py(m);
    for (std::size_t i = 0; i < m; ++i) uv(sg[i].a, px[i], py[i]);
    double a2 = 0.0, m1x = 0.0, m1y = 0.0;
    for (std::size_t i = 0; i < m; ++i) {
        const std::size_t k = (i + 1) % m;
        const double cr = px[i] * py[k] - px[k] * py[i];
        a2 += cr; m1x += (px[i] + px[k]) * cr; m1y += (py[i] + py[k]) * cr;
    }
    const double polyA = 0.5 * a2;
    const double wind = (polyA >= 0.0) ? 1.0 : -1.0;
    double area = polyA;
    mx = m1x / 6.0; my = m1y / 6.0;
    nAdd = nSub = 0;
    for (const Seg& s : sg) {
        if (!s.arc) continue;
        const double d = std::fabs(s.dth);
        if (d >= kTwoPi - 1.0e-9) continue;
        const double segA = 0.5 * s.r * s.r * (d - std::sin(d));
        if (!(segA > 0.0)) continue;
        double ax, ay, bx, by, cx, cy;
        uv(s.a, ax, ay); uv(s.b, bx, by); uv(s.c, cx, cy);
        double ox = wind * (by - ay), oy = -wind * (bx - ax);
        const double on = std::sqrt(ox * ox + oy * oy);
        if (!(on > 0.0)) continue;
        ox /= on; oy /= on;
        const double th0 = std::atan2(ay - cy, ax - cx);
        const double thm = th0 + 0.5 * s.dth;
        const double hx = cx + s.r * std::cos(thm), hy = cy + s.r * std::sin(thm);
        const bool add = (hx - 0.5 * (ax + bx)) * ox + (hy - 0.5 * (ay + by)) * oy > 0.0;
        add ? ++nAdd : ++nSub;
        const double dg = 4.0 * s.r * std::pow(std::sin(0.5 * d), 3.0) /
                          (3.0 * (d - std::sin(d)));
        const double gx = cx + dg * (hx - cx) / s.r, gy = cy + dg * (hy - cy) / s.r;
        const double w = (add ? 1.0 : -1.0) * wind * segA;
        area += w; mx += w * gx; my += w * gy;
    }
    sArea = area;
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        const std::string path = argv[i];
        std::string base = path.substr(path.find_last_of('/') + 1);
        if (base.size() > 5 && base.substr(base.size() - 5) == ".step")
            base = base.substr(0, base.size() - 5);
        TopoDS_Shape shape;
        try {
            STEPControl_Reader rd;
            if (rd.ReadFile(path.c_str()) != IFSelect_RetDone) {
                std::printf("{\"part\":\"%s\",\"err\":\"read\"}\n", base.c_str()); continue;
            }
            rd.TransferRoots();
            shape = rd.OneShape();
        } catch (...) {
            std::printf("{\"part\":\"%s\",\"err\":\"throw\"}\n", base.c_str()); continue;
        }
        if (shape.IsNull()) { std::printf("{\"part\":\"%s\",\"err\":\"null\"}\n", base.c_str()); continue; }

        TopTools_IndexedMapOfShape fm;
        TopExp::MapShapes(shape, TopAbs_FACE, fm);
        TopoDS_Face big; double bigA = 0.0; gp_Pln bigP;
        for (int k = 1; k <= fm.Extent(); ++k) {
            const TopoDS_Face f = TopoDS::Face(fm(k));
            const double a = faceArea(f);
            if (!(a > 0.0)) continue;
            gp_Pln pl;
            if (!planeOf(f, pl)) continue;
            if (betterFace(f, a, big, bigA)) { big = f; bigA = a; bigP = pl; }
        }
        if (big.IsNull()) { std::printf("{\"part\":\"%s\",\"err\":\"noplanar\"}\n", base.c_str()); continue; }

        const gp_Dir n = bigP.Axis().Direction();
        const TopoDS_Wire ow = BRepTools::OuterWire(big);
        const gp_Pnt org = bigP.Location();

        // ---- the census: what kind is every ring? --------------------------
        std::string outerTypes, holeTypes, badType;
        int nRing = 0, nHole = 0, nArcRing = 0;
        const char* why = "";
        bool parsed = true;
        double totA = 0.0, totMx = 0.0, totMy = 0.0;
        int nAddT = 0, nSubT = 0;
        for (TopExp_Explorer wx(big, TopAbs_WIRE); wx.More(); wx.Next()) {
            const TopoDS_Wire w = TopoDS::Wire(wx.Current());
            const bool outer = w.IsSame(ow) == Standard_True;
            ++nRing;
            if (!outer) ++nHole;
            std::vector<Seg> sg;
            std::string types;
            if (!parseRing(w, n, sg, why, types, badType)) {
                parsed = false;
                if (outer) outerTypes = types;
                break;
            }
            if (outer) outerTypes = types;
            else if (holeTypes.size() < 64) holeTypes += types + ",";
            bool hasArc = false;
            for (const Seg& s : sg) if (s.arc) hasArc = true;
            if (hasArc) ++nArcRing;
            double a = 0.0, mx = 0.0, my = 0.0;
            int na = 0, ns = 0;
            ringMoments(sg, n, org, a, mx, my, na, ns);
            const double sg2 = (a >= 0.0 ? 1.0 : -1.0);      // sign-normalise
            const double s = outer ? 1.0 : -1.0;
            totA += s * sg2 * a; totMx += s * sg2 * mx; totMy += s * sg2 * my;
            nAddT += na; nSubT += ns;
        }
        if (!parsed) {
            std::printf("{\"part\":\"%s\",\"arcchain\":0,\"why\":\"%s\","
                        "\"bad_type\":\"%s\",\"outer_types\":\"%s\",\"rings\":%d}\n",
                        base.c_str(), why, badType.c_str(), outerTypes.c_str(), nRing);
            std::fflush(stdout);
            continue;
        }
        // ---- the check: closed form vs OCCT on the SAME face ---------------
        const gp_Pnt cg = faceCentroid(big);
        gp_Ax2 fr(org, n);
        const gp_Vec e1(fr.XDirection()), e2(fr.YDirection());
        const gp_Vec dcg(org, cg);
        const double gx = (totA != 0.0) ? totMx / totA : 0.0;
        const double gy = (totA != 0.0) ? totMy / totA : 0.0;
        const double dx = gx - dcg.Dot(e1), dy = gy - dcg.Dot(e2);
        std::printf("{\"part\":\"%s\",\"arcchain\":1,\"rings\":%d,\"holes\":%d,"
                    "\"arcrings\":%d,\"add\":%d,\"sub\":%d,\"outer_types\":\"%s\","
                    "\"hole_types\":\"%s\",\"area_closedform\":%.12g,\"area_occt\":%.12g,"
                    "\"rel_area\":%.4e,\"d_centroid\":%.4e}\n",
                    base.c_str(), nRing, nHole, nArcRing, nAddT, nSubT,
                    outerTypes.c_str(), holeTypes.c_str(), totA, bigA,
                    std::fabs(totA - bigA) / (bigA > 0.0 ? bigA : 1.0),
                    std::sqrt(dx * dx + dy * dy));
        std::fflush(stdout);
    }
    return 0;
}
