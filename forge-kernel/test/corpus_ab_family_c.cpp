// corpus_ab_family_c.cpp — LIVE-OCCT corpus A/B for TKOffset family C.
//
// Compares the PRODUCTION path that src/Healing.cpp now takes —
//     forge::occtfill::fillC0BoundaryDiag(wire, tol)
// against the OCCT code that was DELETED from that call site —
//     BRepOffsetAPI_MakeFilling f; for (e : wire) f.Add(e, GeomAbs_C0);
//     f.Build(); if (f.IsDone()) use f.Shape();
// replicated here verbatim in its own try/catch, exactly as the call site had it.
//
// OCCT IS THE ORACLE, NOT THE SOURCE. Nothing here is copied from OCCT; the OCCT
// arm is invoked through its public API purely to compare answers.
//
// ★ HONEST STATUS OF THE NON-PLANAR CONTROL — MEASURED 2026-09-14 BY MUTATION,
//   and stated here so nobody reads more into this harness than it proves.
//   Disabling the engine's own planarity-residual test (if (residual > t) ->
//   if (false)) does NOT change this corpus's result: the four saddle boundaries
//   are still declined, but by BRepBuilderAPI_MakeFace downstream rather than by
//   the residual test, and the named reason correctly says so. So THIS file does
//   not isolate the residual test. The committed test/ab_native_filling_occt.cpp
//   does, via its TOLERANCE CONTROL (MakeFace is shown to ACCEPT a boundary 1e-7
//   off plane while the engine at tol=1e-9 declines it) — run both. What this
//   harness does establish is coverage, the deletion bucket, agreement on the
//   full observable vector, and the closed-form comparison below.
//
// FULL OBSERVABLE VECTOR per part (the repo rule: volume alone cannot validate
// geometry): surface area, centroid x/y/z, all six bbox bounds, face/edge/vertex
// counts, the supporting surface TYPE, and BRepCheck_Analyzer validity. Where a
// closed form exists (regular polygon, circle, L-shape) it is also checked
// against that, so the comparison does not merely inherit OCCT's error.

#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GProp_GProps.hxx>
#include <Geom_BSplineCurve.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax1.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include "forge/native/brep/NativeFilling.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;

struct Obs {
    bool   built = false;
    bool   valid = false;
    double area = 0, cx = 0, cy = 0, cz = 0;
    double bb[6] = {0, 0, 0, 0, 0, 0};
    int    nF = 0, nE = 0, nV = 0;
    std::string surfType;
};

int countSub(const TopoDS_Shape& s, TopAbs_ShapeEnum k) {
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, k, m);
    return m.Extent();
}

const char* surfName(GeomAbs_SurfaceType t) {
    switch (t) {
        case GeomAbs_Plane: return "Plane";
        case GeomAbs_Cylinder: return "Cylinder";
        case GeomAbs_Cone: return "Cone";
        case GeomAbs_Sphere: return "Sphere";
        case GeomAbs_Torus: return "Torus";
        case GeomAbs_BezierSurface: return "Bezier";
        case GeomAbs_BSplineSurface: return "BSpline";
        case GeomAbs_SurfaceOfRevolution: return "Revolution";
        case GeomAbs_SurfaceOfExtrusion: return "Extrusion";
        case GeomAbs_OffsetSurface: return "Offset";
        default: return "Other";
    }
}

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    o.built = true;
    GProp_GProps g;
    BRepGProp::SurfaceProperties(s, g);
    o.area = g.Mass();
    const gp_Pnt c = g.CentreOfMass();
    o.cx = c.X(); o.cy = c.Y(); o.cz = c.Z();
    Bnd_Box b;
    BRepBndLib::Add(s, b);
    if (!b.IsVoid()) b.Get(o.bb[0], o.bb[1], o.bb[2], o.bb[3], o.bb[4], o.bb[5]);
    o.nF = countSub(s, TopAbs_FACE);
    o.nE = countSub(s, TopAbs_EDGE);
    o.nV = countSub(s, TopAbs_VERTEX);
    o.valid = BRepCheck_Analyzer(s).IsValid() == Standard_True;
    for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
        BRepAdaptor_Surface sa(TopoDS::Face(ex.Current()));
        o.surfType = surfName(sa.GetType());
        break;
    }
    return o;
}

// The DELETED call-site sequence, replicated verbatim as the oracle arm.
TopoDS_Shape occtFill(const TopoDS_Wire& w) {
    try {
        BRepOffsetAPI_MakeFilling filling;
        for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next())
            filling.Add(TopoDS::Edge(ex.Current()), GeomAbs_C0);
        filling.Build();
        if (filling.IsDone()) return filling.Shape();
    } catch (const std::exception&) {
    } catch (...) {
    }
    return TopoDS_Shape();
}

struct Part {
    std::string name;
    TopoDS_Wire wire;
    double      closedFormArea = -1.0;   // <0 = none
};

gp_Trsf poseFor(int i) {
    // Deterministic pose: rotate about a skew axis then translate. Exercises
    // arbitrary plane orientations, not just axis-aligned ones.
    gp_Trsf r, t;
    const double ang = 0.23 * i;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0.3 + 0.1 * (i % 5), 0.5, 0.8)), ang);
    t.SetTranslation(gp_Vec(1.7 * i, -0.9 * i, 0.4 * i));
    return t * r;
}

TopoDS_Wire xf(const TopoDS_Wire& w, const gp_Trsf& tr) {
    BRepBuilderAPI_Transform b(w, tr, Standard_True);
    return TopoDS::Wire(b.Shape());
}

// Regular n-gon of circumradius R in z=0. Area = (1/2) n R^2 sin(2pi/n).
TopoDS_Wire ngon(int n, double R) {
    BRepBuilderAPI_MakePolygon p;
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * kPi * i / n;
        p.Add(gp_Pnt(R * std::cos(a), R * std::sin(a), 0.0));
    }
    p.Close();
    return p.Wire();
}

// Circle of radius R as FOUR arcs in z=0. Closed-form area = pi R^2.
TopoDS_Wire circle4(double R) {
    BRepBuilderAPI_MakeWire mw;
    for (int k = 0; k < 4; ++k) {
        const double a0 = k * kPi / 2, a1 = (k + 1) * kPi / 2, am = (a0 + a1) / 2;
        const gp_Pnt p0(R * std::cos(a0), R * std::sin(a0), 0);
        const gp_Pnt pm(R * std::cos(am), R * std::sin(am), 0);
        const gp_Pnt p1(R * std::cos(a1), R * std::sin(a1), 0);
        GC_MakeArcOfCircle arc(p0, pm, p1);
        mw.Add(BRepBuilderAPI_MakeEdge(arc.Value()).Edge());
    }
    return mw.Wire();
}

// L-shaped (NON-CONVEX) planar polygon in z=0. Area = 3 s^2.
TopoDS_Wire lshape(double s) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(gp_Pnt(0, 0, 0));      p.Add(gp_Pnt(2 * s, 0, 0));
    p.Add(gp_Pnt(2 * s, s, 0));  p.Add(gp_Pnt(s, s, 0));
    p.Add(gp_Pnt(s, 2 * s, 0));  p.Add(gp_Pnt(0, 2 * s, 0));
    p.Close();
    return p.Wire();
}

// A planar B-spline loop: wobbly closed spline, all control points in z=0.
TopoDS_Wire splineLoop(double R, int n) {
    TColgp_Array1OfPnt pts(1, n + 1);
    for (int i = 0; i <= n; ++i) {
        const double a  = 2.0 * kPi * i / n;
        const double rr = R * (1.0 + 0.15 * std::cos(3 * a));
        pts.SetValue(i + 1, gp_Pnt(rr * std::cos(a), rr * std::sin(a), 0.0));
    }
    Handle(Geom_BSplineCurve) c = GeomAPI_PointsToBSpline(pts).Curve();
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(c).Edge());
    return mw.Wire();
}

// NON-PLANAR saddle quad: corners alternating +/- h in z. The frontier case.
TopoDS_Wire saddle(double s, double h) {
    BRepBuilderAPI_MakePolygon p;
    p.Add(gp_Pnt(0, 0, h));  p.Add(gp_Pnt(s, 0, -h));
    p.Add(gp_Pnt(s, s, h));  p.Add(gp_Pnt(0, s, -h));
    p.Close();
    return p.Wire();
}

double relDiff(double a, double b) {
    const double d = std::fabs(a - b);
    const double m = std::max(std::fabs(a), std::fabs(b));
    return m > 1e-12 ? d / m : d;
}

}  // namespace

int main() {
    std::vector<Part> corpus;

    const double scales[] = {0.01, 0.5, 1.0, 12.5, 250.0, 5000.0};
    const int    sides[]  = {3, 4, 5, 6, 8, 12, 24};
    int idx = 0;
    for (double S : scales) {
        for (int n : sides) {
            Part p;
            p.name = "ngon" + std::to_string(n) + "@" + std::to_string(S);
            p.closedFormArea = 0.5 * n * S * S * std::sin(2 * kPi / n);
            p.wire = xf(ngon(n, S), poseFor(idx++));
            corpus.push_back(p);
        }
        {
            Part p; p.name = "circle4@" + std::to_string(S);
            p.closedFormArea = kPi * S * S;
            p.wire = xf(circle4(S), poseFor(idx++)); corpus.push_back(p);
        }
        {
            Part p; p.name = "Lshape@" + std::to_string(S);
            p.closedFormArea = 3.0 * S * S;
            p.wire = xf(lshape(S), poseFor(idx++)); corpus.push_back(p);
        }
        {
            Part p; p.name = "spline@" + std::to_string(S);
            p.wire = xf(splineLoop(S, 12), poseFor(idx++)); corpus.push_back(p);
        }
    }
    // The documented capability frontier: non-planar boundaries.
    for (double h : {0.001, 0.05, 1.0, 10.0}) {
        Part p; p.name = "saddle_h" + std::to_string(h);
        p.wire = xf(saddle(10.0, h), poseFor(idx++));
        corpus.push_back(p);
    }

    const double tol = 1.0e-6;
    int bothOK = 0, natOnly = 0, occtOnly = 0, neither = 0;
    int agree = 0, disagreeKind = 0;
    double worstArea = 0, worstCom = 0, worstBox = 0;
    double worstNatCF = 0, worstOcctCF = 0;
    int natValid = 0, occtValid = 0;
    std::vector<std::string> deletionBucket;
    std::vector<std::string> namedRefusals;
    std::vector<std::string> offenders;
    std::string worstAreaPart, worstComPart, worstBoxPart;
    double worstNatVsWire = 0, worstOcctVsWire = 0;

    std::printf("== corpus A/B: native fillC0BoundaryDiag vs OCCT BRepOffsetAPI_MakeFilling ==\n");
    std::printf("   parts=%zu  tol=%g\n\n", corpus.size(), tol);

    for (const Part& p : corpus) {
        const forge::occtfill::FillDiagnosis d =
            forge::occtfill::fillC0BoundaryDiag(p.wire, tol);
        const Obs nat  = observe(d.ok ? d.shape : TopoDS_Shape());
        const Obs occt = observe(occtFill(p.wire));

        if (nat.built && occt.built) {
            ++bothOK;
        } else if (nat.built) {
            ++natOnly;
        } else if (occt.built) {
            ++occtOnly;
            deletionBucket.push_back(p.name + "  [native reason: " + d.reason + "]");
        } else {
            ++neither;
        }

        if (!d.ok) {
            if (d.reason.empty()) {
                std::printf("  FATAL: defer with EMPTY reason on %s\n", p.name.c_str());
                return 2;
            }
            namedRefusals.push_back(p.name + " -> " + d.reason);
        }
        if (nat.built)  natValid  += nat.valid  ? 1 : 0;
        if (occt.built) occtValid += occt.valid ? 1 : 0;

        if (nat.built && occt.built) {
            // ── WHICH ARM'S BBOX IS RIGHT? ──────────────────────────────────
            // A cap face is bounded by its own boundary, so the TRUE bbox of the
            // cap is the bbox of the WIRE. Measure both arms against that rather
            // than against each other: the native face is a Geom_Plane trimmed by
            // the wire, so it should match; OCCT's face sits on a B-spline support
            // that extends past the trim, so it should OVERSHOOT.
            const Obs wireObs = observe(p.wire);
            double natVsWire = 0, occtVsWire = 0;
            for (int i = 0; i < 6; ++i) {
                natVsWire  = std::max(natVsWire,  std::fabs(nat.bb[i]  - wireObs.bb[i]));
                occtVsWire = std::max(occtVsWire, std::fabs(occt.bb[i] - wireObs.bb[i]));
            }
            double wdiag = 0;
            for (int i = 0; i < 3; ++i) {
                const double e = wireObs.bb[i + 3] - wireObs.bb[i];
                wdiag += e * e;
            }
            wdiag = std::sqrt(wdiag);
            if (wdiag > 0) {
                worstNatVsWire  = std::max(worstNatVsWire,  natVsWire  / wdiag);
                worstOcctVsWire = std::max(worstOcctVsWire, occtVsWire / wdiag);
            }
            const double da = relDiff(nat.area, occt.area);
            double dc = 0, db = 0;
            dc = std::max(dc, std::fabs(nat.cx - occt.cx));
            dc = std::max(dc, std::fabs(nat.cy - occt.cy));
            dc = std::max(dc, std::fabs(nat.cz - occt.cz));
            for (int i = 0; i < 6; ++i) db = std::max(db, std::fabs(nat.bb[i] - occt.bb[i]));
            // SCALE-NORMALISE. The corpus spans 0.01 to 5000 model units, so a
            // raw millimetre deviation is meaningless across it; divide by the
            // part's own bbox diagonal to get a comparable figure.
            double diag = 0;
            for (int i = 0; i < 3; ++i) {
                const double e = nat.bb[i + 3] - nat.bb[i];
                diag += e * e;
            }
            diag = std::sqrt(diag);
            const double dcN = diag > 0 ? dc / diag : dc;
            const double dbN = diag > 0 ? db / diag : db;
            if (da  > worstArea) { worstArea = da;  worstAreaPart = p.name; }
            if (dcN > worstCom)  { worstCom  = dcN; worstComPart  = p.name; }
            if (dbN > worstBox)  { worstBox  = dbN; worstBoxPart  = p.name; }
            if (dbN > 1e-6 || da > 1e-6) {
                char buf[512];
                std::snprintf(buf, sizeof buf,
                    "%-22s diag=%.4g  relArea=%.3e  relCom=%.3e  relBox=%.3e  "
                    "natArea=%.10g occtArea=%.10g  nat=%s occt=%s",
                    p.name.c_str(), diag, da, dcN, dbN, nat.area, occt.area,
                    nat.surfType.c_str(), occt.surfType.c_str());
                offenders.push_back(buf);
            }
            const bool sameScalars = da <= 1e-6 && nat.nF == occt.nF &&
                                     nat.nE == occt.nE && nat.nV == occt.nV;
            if (sameScalars) ++agree;
            if (nat.surfType != occt.surfType) ++disagreeKind;
        }
        if (p.closedFormArea > 0) {
            if (nat.built)  worstNatCF  = std::max(worstNatCF,  relDiff(nat.area,  p.closedFormArea));
            if (occt.built) worstOcctCF = std::max(worstOcctCF, relDiff(occt.area, p.closedFormArea));
        }
    }

    std::printf("-- coverage --\n");
    std::printf("   both built       : %d\n", bothOK);
    std::printf("   native only      : %d\n", natOnly);
    std::printf("   OCCT only        : %d   <-- DELETION BUCKET\n", occtOnly);
    std::printf("   neither          : %d\n", neither);
    std::printf("   native valid     : %d / %d built\n", natValid, bothOK + natOnly);
    std::printf("   OCCT   valid     : %d / %d built\n", occtValid, bothOK + occtOnly);

    std::printf("\n-- agreement on shared successes (%d pairs) --\n", bothOK);
    std::printf("   agree on area+F/E/V   : %d / %d\n", agree, bothOK);
    std::printf("   differ on surface KIND: %d / %d\n", disagreeKind, bothOK);
    std::printf("   worst relative area deviation : %.6e  (%s)\n", worstArea, worstAreaPart.c_str());
    std::printf("   worst centroid dev / bbox diag: %.6e  (%s)\n", worstCom, worstComPart.c_str());
    std::printf("   worst bbox dev  / bbox diag   : %.6e  (%s)\n", worstBox, worstBoxPart.c_str());

    std::printf("\n-- every pair deviating by more than 1e-6 relative (%zu) --\n", offenders.size());
    for (const auto& s2 : offenders) std::printf("   %s\n", s2.c_str());

    std::printf("\n-- WHOSE BBOX IS CORRECT? (deviation from the WIRE's own bbox / diag) --\n");
    std::printf("   native face vs its own boundary : %.6e   <- should be ~0\n", worstNatVsWire);
    std::printf("   OCCT   face vs its own boundary : %.6e   <- untrimmed support overshoot\n", worstOcctVsWire);

    std::printf("\n-- against CLOSED FORM (does not inherit OCCT's error) --\n");
    std::printf("   worst native rel. area error : %.6e\n", worstNatCF);
    std::printf("   worst OCCT   rel. area error : %.6e\n", worstOcctCF);

    std::printf("\n-- deletion bucket (OCCT built, native declined): %zu --\n",
                deletionBucket.size());
    for (const auto& s : deletionBucket) std::printf("   %s\n", s.c_str());

    std::printf("\n-- named refusals: %zu (every one carries a reason) --\n",
                namedRefusals.size());
    for (const auto& s : namedRefusals) std::printf("   %s\n", s.c_str());

    return 0;
}
