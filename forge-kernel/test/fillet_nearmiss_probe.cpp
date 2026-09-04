// fillet_nearmiss_probe.cpp — WHAT IS THE FILLET FAMILY'S 2-5e-6 MADE OF?
//
// THE QUESTION. `reports/corpus_ab/FLIP_GATE_REPLACEABILITY_2026-09-03.md` §3.1
// classes FILLET's 58 valid-pair disagreements as "a numerical margin": the two
// arms' total volumes sit at ratio 0.999995-0.999998, i.e. 2-5e-6 relative
// against the A/B comparator's 1e-6 relative bound, and that document explicitly
// leaves "whether FILLET's 58 pairs at 2-5e-6 are a defect or a tolerance"
// unanswered (§6). Widening the bound is not on the table. So the question this
// file asks is the other one: WHERE DOES THE 2-5e-6 COME FROM.
//
// Three hypotheses, and they need different answers:
//   (a) GENUINE GEOMETRY  — the two arms bound different solids. Then it is a
//       correctness finding and no tolerance change is defensible.
//   (b) INTEGRATION ERROR — the two solids are the same, and the harness's
//       volume integrator is not converged on one of the two representations.
//       Then it is a MEASUREMENT defect: compute the comparison so it does not
//       accumulate, and the disagreement should vanish, not be tolerated.
//   (c) DIFFERENT REPRESENTATION of the same surface, feeding the integrator
//       differently — the (b) mechanism with a representational cause.
//
// VOLUME CANNOT ANSWER THIS, so this probe never asks volume alone. It measures,
// per part:
//
//  1. THE INTEGRATOR'S OWN CONVERGENCE, per arm. `BRepGProp::VolumeProperties`
//     as the A/B calls it is FIXED-ORDER Gauss quadrature. OCCT ships two
//     adaptive integrators that return the relative error they actually reached:
//     `VolumeProperties(S, P, Eps)` (adaptive Gauss) and `VolumePropertiesGK`
//     (adaptive Gauss-Kronrod). Running all three on the SAME shape says whether
//     the A/B's number is converged for that shape. If the two arms' converged
//     volumes agree while their fixed-order volumes do not, hypothesis (b)/(c)
//     is proven and (a) is refuted, with no appeal to which arm is "right".
//
//  2. WHERE THE VOLUME DIFFERENCE SITS, face by face. `VolumeProperties` on a
//     single FACE is that face's divergence-theorem contribution about the
//     common origin; the contributions sum to the solid's volume, so differencing
//     matched faces localises the delta instead of reporting it as one scalar.
//
//  3. WHETHER THE MATCHED FACES ARE THE SAME SURFACE, by SAMPLED DISTANCE.
//     For every matched pair the native face's surface is sampled on a UV grid
//     and each sample projected onto the other arm's surface. That is a direct
//     geometric comparison of the fillet surfaces (and of every other face),
//     independent of any integral. Two surfaces agreeing to 1e-12 of the part
//     diagonal are the same surface however differently they are spelled.
//
//  4. WHICH ARM RE-USES THE INPUT'S OWN FACES, exactly. `TopoDS_Shape::IsPartner`
//     is TShape identity: it answers "is this literally the input's face" with no
//     tolerance at all.
//
//  5. THE SURFACE AND CURVE KINDS of the input and of both answers, so the
//     representational story is reported rather than assumed.
//
// The derived operation is copied verbatim from `test/corpus_ab_coverage.cpp`
// (longest LINE edge, R = 0.05 * min bbox extent, with the same `flat` fallback
// and the same deterministic tie-break), because the population under study is
// that harness's and a different pick would be a different population.
//
// --selftest runs three controls before any corpus number exists:
//   * a canonical box, filleted on one edge by both arms: both must build, and
//     the sampled surface distance between matched faces must be ~0 while the
//     closed form (1-pi/4)R^2 L must be met by both. A probe that cannot see
//     "identical" is useless for seeing "different".
//   * the SAME box against a deliberately displaced copy of itself: the sampled
//     distance must be the displacement, not zero. The negative control.
//   * an integrator control: a canonical cylinder's fixed-order volume against
//     pi r^2 h, and the adaptive integrators' reported error, so a claim that
//     "the integrator is converged here" is anchored to a case where the answer
//     is known in closed form.
//
// BUILD: test/build_fillet_nearmiss_probe.sh   RUN: test/run_fillet_nearmiss_probe.sh
// Output: one JSON object per part on stdout.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <GProp_GProps.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomAdaptor_Surface.hxx>
#include <Geom_Plane.hxx>
#include <Geom_Surface.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_SurfaceOfLinearExtrusion.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Circ.hxx>
#include <gp_Vec.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <ShapeCustom.hxx>
#include <TopTools_ListOfShape.hxx>

#include "forge/native/brep/NativeFilletChamfer.hpp"

namespace {

// ── the same measurement vocabulary the A/B uses ────────────────────────────
const char* kSurf[] = {"Plane", "Cylinder", "Cone",  "Sphere", "Torus", "Bezier",
                       "BSpline", "SurfRev", "SurfExtr", "Offset", "Other"};
const char* kCurv[] = {"Line", "Circle", "Ellipse", "Hyperbola", "Parabola",
                       "Bezier", "BSpline", "OffsetC", "OtherC"};

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
double edgeLength(const TopoDS_Edge& e) {
    GProp_GProps g;
    try { BRepGProp::LinearProperties(e, g); } catch (...) { return 0.0; }
    return g.Mass();
}
// A single face's divergence-theorem contribution about the global origin. The
// contributions of a closed shell sum to its volume, so differencing MATCHED
// faces localises a volume delta instead of reporting it as one number.
double faceVolContrib(const TopoDS_Face& f) {
    GProp_GProps g;
    try { BRepGProp::VolumeProperties(f, g, Standard_False, Standard_False, Standard_False); }
    catch (...) { return 0.0; }
    return g.Mass();
}
// The face's plane with the OUTWARD normal (flipped for TopAbs_REVERSED).
bool planeOf(const TopoDS_Face& f, gp_Pln& out) {
    Handle(Geom_Surface) sf = BRep_Tool::Surface(f);
    if (sf.IsNull()) return false;
    Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(sf);
    if (pl.IsNull()) return false;
    const gp_Pln p = pl->Pln();
    gp_Dir n = p.Axis().Direction();
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    out = gp_Pln(p.Location(), n);
    return true;
}

int surfKind(const TopoDS_Face& f) {
    try { BRepAdaptor_Surface s(f, Standard_False); return static_cast<int>(s.GetType()); }
    catch (...) { return 10; }
}

struct VolSet {
    double fixed = 0.0;         // what the A/B calls
    double adaptive = 0.0;      // VolumeProperties(S,P,Eps)
    double adaptiveErr = -1.0;  // the relative error IT reports
    double gk = 0.0;            // VolumePropertiesGK
    double gkErr = -1.0;
    double areaFixed = 0.0;
    double areaAdaptive = 0.0;
    double areaErr = -1.0;
};

VolSet measureVol(const TopoDS_Shape& s, double eps) {
    VolSet v;
    { GProp_GProps g;
      try { BRepGProp::VolumeProperties(s, g); v.fixed = g.Mass(); } catch (...) {} }
    { GProp_GProps g;
      try { v.adaptiveErr = BRepGProp::VolumeProperties(s, g, eps); v.adaptive = g.Mass(); }
      catch (...) { v.adaptiveErr = -2.0; } }
    { GProp_GProps g;
      try { v.gkErr = BRepGProp::VolumePropertiesGK(s, g, eps); v.gk = g.Mass(); }
      catch (...) { v.gkErr = -2.0; } }
    { GProp_GProps g;
      try { BRepGProp::SurfaceProperties(s, g); v.areaFixed = g.Mass(); } catch (...) {} }
    { GProp_GProps g;
      try { v.areaErr = BRepGProp::SurfaceProperties(s, g, eps); v.areaAdaptive = g.Mass(); }
      catch (...) { v.areaErr = -2.0; } }
    return v;
}

// ── sampled surface distance: face A's surface sampled on a UV grid, each
//    sample projected onto face B's underlying surface. This is the geometric
//    comparison; it never touches an integral.
struct DistStat { double maxd = 0.0; double meand = 0.0; int n = 0; bool ok = false; };

DistStat surfaceDistance(const TopoDS_Face& a, const TopoDS_Face& b, int grid) {
    DistStat d;
    Handle(Geom_Surface) sa = BRep_Tool::Surface(a);
    Handle(Geom_Surface) sb = BRep_Tool::Surface(b);
    if (sa.IsNull() || sb.IsNull()) return d;
    Standard_Real u0, u1, v0, v1, bu0, bu1, bv0, bv1;
    try {
        BRepTools::UVBounds(a, u0, u1, v0, v1);
        BRepTools::UVBounds(b, bu0, bu1, bv0, bv1);
    } catch (...) { return d; }
    if (!(u1 > u0) || !(v1 > v0)) return d;
    GeomAPI_ProjectPointOnSurf proj;
    double sum = 0.0;
    for (int i = 0; i <= grid; ++i) {
        const double u = u0 + (u1 - u0) * (double(i) / grid);
        for (int j = 0; j <= grid; ++j) {
            const double v = v0 + (v1 - v0) * (double(j) / grid);
            gp_Pnt p;
            try { p = sa->Value(u, v); } catch (...) { continue; }
            try {
                proj.Init(p, sb, bu0, bu1, bv0, bv1, 1.0e-9);
                if (!proj.IsDone() || proj.NbPoints() < 1) continue;
                const double dd = proj.LowerDistance();
                if (dd > d.maxd) d.maxd = dd;
                sum += dd;
                ++d.n;
            } catch (...) { continue; }
        }
    }
    if (d.n > 0) { d.meand = sum / d.n; d.ok = true; }
    return d;
}

// ── DEVIATION FROM THE EXACT ROLLING-BALL SURFACE ───────────────────────────
// A constant-radius rolling-ball fillet surface is, by definition, the locus of
// points at distance exactly R from the ball's spine. For the straight runs of a
// rim that spine is a line and the surface is a CYLINDER of radius R; for the
// corner arcs it is an arc and the surface is a TORUS of minor radius R. Both are
// ANALYTIC and UNBOUNDED in their natural parameters, so a point can be measured
// against them with no reference to how either face happens to be TRIMMED — which
// is what makes this comparison free of the trim artefact that a face-to-face
// projection carries (a sample outside the other face's UV box projects to its
// boundary and reports a distance that is about the trim, not about the surface).
//
// `dev` is the shortest distance from p to ANY of the analytic blend surfaces,
// reported in multiples of R.
struct Analytic {
    int    kind = -1;     // 0 = cylinder, 1 = torus
    gp_Ax1 axis;          // cylinder axis / torus axis
    double r1 = 0.0;      // cylinder radius / torus MAJOR radius
    double r2 = 0.0;      // torus MINOR radius
};

double distToAnalytic(const gp_Pnt& p, const Analytic& a) {
    const gp_Lin ax(a.axis);
    if (a.kind == 0) return std::fabs(ax.Distance(p) - a.r1);
    // torus: distance to the centreline circle of radius r1 about the axis
    const gp_Pnt c = a.axis.Location();
    const gp_Dir n = a.axis.Direction();
    const gp_Vec v(c, p);
    const double h = v.Dot(gp_Vec(n));           // along the axis
    const gp_Vec radial = v - gp_Vec(n) * h;     // in the torus plane
    const double rad = radial.Magnitude();
    const double dr = rad - a.r1;
    return std::fabs(std::sqrt(dr * dr + h * h) - a.r2);
}

bool analyticOf(const TopoDS_Face& f, Analytic& out) {
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return false;
    Handle(Geom_CylindricalSurface) cy = Handle(Geom_CylindricalSurface)::DownCast(s);
    if (!cy.IsNull()) {
        out.kind = 0; out.axis = cy->Cylinder().Axis(); out.r1 = cy->Cylinder().Radius();
        return true;
    }
    Handle(Geom_ToroidalSurface) to = Handle(Geom_ToroidalSurface)::DownCast(s);
    if (!to.IsNull()) {
        out.kind = 1; out.axis = to->Torus().Axis();
        out.r1 = to->Torus().MajorRadius(); out.r2 = to->Torus().MinorRadius();
        return true;
    }
    return false;
}

// max / mean deviation of a face's sampled surface from the nearest analytic
// blend surface, in multiples of R.
struct Dev { double maxd = 0.0, meand = 0.0; int n = 0; };

Dev deviationFromAnalytic(const TopoDS_Face& f, const std::vector<Analytic>& A, int grid) {
    Dev d;
    if (A.empty()) return d;
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    if (s.IsNull()) return d;
    Standard_Real u0, u1, v0, v1;
    try { BRepTools::UVBounds(f, u0, u1, v0, v1); } catch (...) { return d; }
    if (!(u1 > u0) || !(v1 > v0)) return d;
    double sum = 0.0;
    for (int i = 0; i <= grid; ++i) {
        const double u = u0 + (u1 - u0) * (double(i) / grid);
        for (int j = 0; j <= grid; ++j) {
            const double v = v0 + (v1 - v0) * (double(j) / grid);
            gp_Pnt p;
            try { p = s->Value(u, v); } catch (...) { continue; }
            double best = 1e300;
            for (const Analytic& a : A) best = std::min(best, distToAnalytic(p, a));
            if (best >= 1e299) continue;
            if (best > d.maxd) d.maxd = best;
            sum += best; ++d.n;
        }
    }
    if (d.n > 0) d.meand = sum / d.n;
    return d;
}

// ── principal-curvature reading of a blend face ─────────────────────────────
// An exact rolling-ball blend of radius R has a principal curvature of exactly
// 1/R at EVERY point (the cylinder's hoop curvature; the torus's minor one).
// Reported as max | |k| * R - 1 | over the sampled face, so 0 means "this is a
// radius-R rolling-ball surface" and any positive value is how far it is not.
double curvatureMiss(const TopoDS_Face& f, double R, int grid) {
    double worst = 0.0;
    BRepAdaptor_Surface ad;
    try { ad.Initialize(f, Standard_False); } catch (...) { return -1.0; }
    Standard_Real u0, u1, v0, v1;
    try { BRepTools::UVBounds(f, u0, u1, v0, v1); } catch (...) { return -1.0; }
    if (!(u1 > u0) || !(v1 > v0)) return -1.0;
    for (int i = 0; i <= grid; ++i) {
        const double u = u0 + (u1 - u0) * (double(i) / grid);
        for (int j = 0; j <= grid; ++j) {
            const double v = v0 + (v1 - v0) * (double(j) / grid);
            try {
                BRepLProp_SLProps pr(ad, u, v, 2, 1.0e-9);
                if (!pr.IsCurvatureDefined()) continue;
                const double k1 = std::fabs(pr.MaxCurvature()), k2 = std::fabs(pr.MinCurvature());
                const double m1 = std::fabs(k1 * R - 1.0), m2 = std::fabs(k2 * R - 1.0);
                const double m = std::min(m1, m2);
                if (m > worst) worst = m;
            } catch (...) { continue; }
        }
    }
    return worst;
}

// ── THE CLOSED FORM, COMPUTED FROM THE INPUT ALONE ──────────────────────────
// `BRepFilletAPI_MakeFillet::Add` PROPAGATES a contour across tangent junctions,
// so on a part whose cap ring is a G1 loop the operation both arms perform is the
// WHOLE RIM, not the picked edge (measured in
// reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md §2). The material a radius-R
// rolling ball removes from such a rim is exact and elementary:
//
//   |dV| = SUM over straight runs   (1 - pi/4) R^2 L
//        + SUM over corner arcs     theta * [ R^2(2rho-R)/2 - R^3/3 - (rho-R) pi R^2/4 ]
//
// (the second term is Pappus on the same kite-minus-quarter-disc section swept
// about the corner axis at major radius rho-R). Every quantity in it — L, rho,
// theta — is read off the INPUT's own cap ring, so this oracle is independent of
// both arms and can say which one is right rather than only that they differ.
// Returns < 0 if the ring is not a closed loop of lines and circular arcs.
double rimClosedForm(const TopoDS_Face& cap, double R, int& nLine, int& nArc, double& worstTangent) {
    nLine = 0; nArc = 0; worstTangent = 0.0;
    TopoDS_Wire w;
    try { w = BRepTools::OuterWire(cap); } catch (...) { return -1.0; }
    if (w.IsNull()) return -1.0;
    double total = 0.0;
    std::vector<gp_Dir> tanIn, tanOut;
    std::vector<gp_Pnt> pIn, pOut;
    try {
        for (BRepTools_WireExplorer ex(w, cap); ex.More(); ex.Next()) {
            const TopoDS_Edge e = ex.Current();
            BRepAdaptor_Curve ad;
            try { ad.Initialize(e); } catch (...) { return -1.0; }
            const double f = ad.FirstParameter(), l = ad.LastParameter();
            gp_Pnt p0, p1; gp_Vec d0, d1;
            ad.D1(f, p0, d0); ad.D1(l, p1, d1);
            if (d0.Magnitude() < 1e-12 || d1.Magnitude() < 1e-12) return -1.0;
            const bool rev = (e.Orientation() == TopAbs_REVERSED);
            gp_Dir t0(rev ? -d1 : d0), t1(rev ? -d0 : d1);
            pIn.push_back(rev ? p1 : p0); pOut.push_back(rev ? p0 : p1);
            tanIn.push_back(t0); tanOut.push_back(t1);
            if (ad.GetType() == GeomAbs_Line) {
                ++nLine;
                total += (1.0 - M_PI / 4.0) * R * R * edgeLength(e);
            } else if (ad.GetType() == GeomAbs_Circle) {
                ++nArc;
                const double rho = ad.Circle().Radius();
                const double th = std::fabs(l - f);
                if (!(rho > R)) return -1.0;
                total += th * (R * R * (2.0 * rho - R) / 2.0 - R * R * R / 3.0
                               - (rho - R) * M_PI * R * R / 4.0);
            } else {
                return -1.0;
            }
        }
    } catch (...) { return -1.0; }
    if (nLine + nArc < 2 || nArc == 0) return -1.0;
    // G1 test: the ring must be tangent-continuous, or OCCT does not propagate
    // across it and the whole model is the wrong one.
    const size_t n = tanIn.size();
    for (size_t i = 0; i < n; ++i) {
        const size_t j = (i + 1) % n;
        if (pOut[i].Distance(pIn[j]) > 1e-6 * std::max(1.0, R)) return -1.0;
        const double ang = tanOut[i].Angle(tanIn[j]);
        if (ang > worstTangent) worstTangent = ang;
    }
    return total;
}

// The cap face of the picked edge: the adjacent PLANAR face whose outer ring
// carries at least one circular arc. (The other adjacent face is the wall, whose
// ring is straight — reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md §2.)
TopoDS_Face capFaceOf(const TopoDS_Shape& shape, const TopoDS_Edge& e) {
    TopTools_IndexedDataMapOfShapeListOfShape m;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, m);
    const int idx = m.FindIndex(e);
    if (idx < 1) return TopoDS_Face();
    TopoDS_Face best;
    for (TopTools_ListIteratorOfListOfShape it(m(idx)); it.More(); it.Next()) {
        const TopoDS_Face f = TopoDS::Face(it.Value());
        gp_Pln pl;
        if (!planeOf(f, pl)) continue;
        int nc = 0;
        try {
            for (BRepTools_WireExplorer ex(BRepTools::OuterWire(f), f); ex.More(); ex.Next()) {
                BRepAdaptor_Curve ad; ad.Initialize(ex.Current());
                if (ad.GetType() == GeomAbs_Circle) ++nc;
            }
        } catch (...) { continue; }
        if (nc > 0) { best = f; break; }
    }
    return best;
}

// ── the SPELLING EXPERIMENT's two constructions ─────────────────────────────
// One rounded-rectangle prism, built TWICE. `canonical` gives the walls the
// elementary surfaces OCCT's own prism builder gives them (Plane behind each
// straight run, Cylinder behind each corner arc). `extrusion` spells the SAME
// walls as Geom_SurfaceOfLinearExtrusion of the SAME curves along the SAME
// direction — which is how the corpus's STEP files carry them. The two shapes
// are the same point set; only the spelling differs, and --selftest requires
// that (volume identity + sampled face distance) before the experiment runs.
TopoDS_Wire roundedRectWire(double W, double H, double rho, double z) {
    const double xa = W / 2 - rho, ya = H / 2 - rho;
    const gp_Pnt P[8] = {gp_Pnt(W / 2, ya, z),  gp_Pnt(W / 2, -ya, z),
                         gp_Pnt(xa, -H / 2, z), gp_Pnt(-xa, -H / 2, z),
                         gp_Pnt(-W / 2, -ya, z), gp_Pnt(-W / 2, ya, z),
                         gp_Pnt(-xa, H / 2, z), gp_Pnt(xa, H / 2, z)};
    const gp_Pnt C[4] = {gp_Pnt(xa, ya, z), gp_Pnt(xa, -ya, z),
                         gp_Pnt(-xa, -ya, z), gp_Pnt(-xa, ya, z)};
    const double k = rho * 0.70710678118654752;
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(P[0], P[1]).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P[1], gp_Pnt(C[1].X() + k, C[1].Y() - k, z), P[2]).Value()).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(P[2], P[3]).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P[3], gp_Pnt(C[2].X() - k, C[2].Y() - k, z), P[4]).Value()).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(P[4], P[5]).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P[5], gp_Pnt(C[3].X() - k, C[3].Y() + k, z), P[6]).Value()).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(P[6], P[7]).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P[7], gp_Pnt(C[0].X() + k, C[0].Y() + k, z), P[0]).Value()).Edge());
    return mw.Wire();
}

TopoDS_Shape prismCanonical(double W, double H, double rho, double Z) {
    const TopoDS_Face f = BRepBuilderAPI_MakeFace(roundedRectWire(W, H, rho, 0.0)).Face();
    return BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, Z)).Shape();
}

TopoDS_Shape prismExtrusionSpelled(double W, double H, double rho, double Z) {
    const TopoDS_Wire w0 = roundedRectWire(W, H, rho, 0.0);
    const TopoDS_Wire w1 = roundedRectWire(W, H, rho, Z);
    BRepBuilderAPI_Sewing sew(1.0e-7);
    sew.Add(BRepBuilderAPI_MakeFace(w0).Face());
    sew.Add(BRepBuilderAPI_MakeFace(w1).Face());
    for (BRepTools_WireExplorer ex(w0); ex.More(); ex.Next()) {
        const TopoDS_Edge e = ex.Current();
        Standard_Real f0, l0;
        Handle(Geom_Curve) c = BRep_Tool::Curve(e, f0, l0);
        if (c.IsNull()) return TopoDS_Shape();
        Handle(Geom_SurfaceOfLinearExtrusion) su =
            new Geom_SurfaceOfLinearExtrusion(new Geom_TrimmedCurve(c, f0, l0), gp_Dir(0, 0, 1));
        BRepBuilderAPI_MakeFace mf(su, f0, l0, 0.0, Z, 1.0e-9);
        if (!mf.IsDone()) return TopoDS_Shape();
        sew.Add(mf.Face());
    }
    sew.Perform();
    const TopoDS_Shape sh = sew.SewedShape();
    if (sh.IsNull() || sh.ShapeType() != TopAbs_SHELL) return TopoDS_Shape();
    TopoDS_Shell shell = TopoDS::Shell(sh);
    shell.Closed(Standard_True);
    BRepBuilderAPI_MakeSolid ms(shell);
    if (!ms.IsDone()) return TopoDS_Shape();
    return ms.Solid();
}

// ── the derived operation, copied verbatim from test/corpus_ab_coverage.cpp ──
struct PartInfo {
    TopoDS_Shape shape;
    double bb[6] = {0, 0, 0, 0, 0, 0};
    double minExt = 0.0, diag = 0.0;
};

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

TopoDS_Edge pickLineEdge(const TopoDS_Shape& s, double& outLen) {
    TopoDS_Edge best;
    double bestLen = 0.0;
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(s, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em(i));
        BRepAdaptor_Curve ad;
        try { ad.Initialize(e); } catch (...) { continue; }
        if (ad.GetType() != GeomAbs_Line) continue;
        const double L = edgeLength(e);
        if (L > bestLen * (1.0 + 1e-12)) { best = e; bestLen = L; }
    }
    outLen = bestLen;
    return best;
}

// ── JSON helpers ────────────────────────────────────────────────────────────
// The engines' defer reasons carry em-dashes, so a byte-wise substr() can cut a
// UTF-8 sequence in half and emit a JSONL line that json.loads() refuses while
// a lenient reader still parses it. MEASURED: 67 of 600 rows of the first run of
// this probe were invalid UTF-8 for exactly that reason. Truncate on a character
// boundary and escape what JSON requires.
std::string jsonStr(const std::string& in, size_t maxBytes) {
    std::string t = in.substr(0, std::min(in.size(), maxBytes));
    // Walk back to the last LEAD byte and drop it only if its sequence is
    // INCOMPLETE. Popping every trailing non-ASCII byte would also destroy a
    // whole character that happened to end exactly at the cut.
    {
        const size_t n = t.size();
        size_t i = n, back = 0;
        while (i > 0 && back < 4) {
            const unsigned char c = static_cast<unsigned char>(t[i - 1]);
            if ((c & 0xC0) == 0x80) { --i; ++back; continue; }   // continuation byte
            size_t need = 1;
            if ((c & 0x80) == 0)            need = 1;
            else if ((c & 0xE0) == 0xC0)    need = 2;
            else if ((c & 0xF0) == 0xE0)    need = 3;
            else if ((c & 0xF8) == 0xF0)    need = 4;
            else { t.resize(i - 1); break; }                     // not a legal lead
            if ((i - 1) + need > n) t.resize(i - 1);             // sequence cut short
            break;
        }
    }
    std::string o;
    for (unsigned char c : t) {
        if (c == '"' || c == '\\') { o += '\\'; o += char(c); }
        else if (c < 0x20) o += ' ';
        else o += char(c);
    }
    return o;
}
void emitVolSet(std::string& out, const char* key, const VolSet& v) {
    char b[512];
    std::snprintf(b, sizeof b,
        "\"%s\":{\"v_fixed\":%.17g,\"v_adaptive\":%.17g,\"adaptive_err\":%.6g,"
        "\"v_gk\":%.17g,\"gk_err\":%.6g,\"a_fixed\":%.17g,\"a_adaptive\":%.17g,"
        "\"a_err\":%.6g}", key, v.fixed, v.adaptive, v.adaptiveErr, v.gk, v.gkErr,
        v.areaFixed, v.areaAdaptive, v.areaErr);
    out += b;
}

void emitKinds(std::string& out, const char* key, const TopoDS_Shape& s) {
    int fk[11] = {0}, ek[9] = {0};
    TopTools_IndexedMapOfShape m;
    TopExp::MapShapes(s, TopAbs_FACE, m);
    for (int i = 1; i <= m.Extent(); ++i) {
        int k = surfKind(TopoDS::Face(m(i)));
        if (k < 0 || k > 10) k = 10;
        fk[k]++;
    }
    m.Clear();
    TopExp::MapShapes(s, TopAbs_EDGE, m);
    for (int i = 1; i <= m.Extent(); ++i) {
        int k = 8;
        try { BRepAdaptor_Curve c(TopoDS::Edge(m(i))); k = static_cast<int>(c.GetType()); }
        catch (...) { k = 8; }
        if (k < 0 || k > 8) k = 8;
        ek[k]++;
    }
    out += "\"";
    out += key;
    out += "_fk\":[";
    for (int i = 0; i < 11; ++i) { char b[16]; std::snprintf(b, sizeof b, "%s%d", i ? "," : "", fk[i]); out += b; }
    out += "],\"";
    out += key;
    out += "_ek\":[";
    for (int i = 0; i < 9; ++i) { char b[16]; std::snprintf(b, sizeof b, "%s%d", i ? "," : "", ek[i]); out += b; }
    out += "]";
}

// ── face pairing: match arm A's faces to arm B's by centroid, then area. The
//    two arms are already known to have equal face counts on this population;
//    a face that finds no partner within `tol` is reported as unmatched rather
//    than forced onto one, because a forced pair would manufacture a distance.
struct Pair { int ia = -1, ib = -1; double cdist = 0.0; };

std::vector<Pair> pairFaces(const std::vector<TopoDS_Face>& A,
                            const std::vector<TopoDS_Face>& B,
                            const std::vector<gp_Pnt>& CA, const std::vector<gp_Pnt>& CB,
                            const std::vector<double>& AA, const std::vector<double>& AB,
                            double tol, int& unmatched) {
    std::vector<Pair> out;
    std::vector<char> used(B.size(), 0);
    unmatched = 0;
    for (size_t i = 0; i < A.size(); ++i) {
        int best = -1; double bestd = 1e300;
        for (size_t j = 0; j < B.size(); ++j) {
            if (used[j]) continue;
            const double d = CA[i].Distance(CB[j]);
            // area must agree to 1% before a centroid match is believed
            if (AA[i] > 0 && AB[j] > 0 &&
                std::fabs(AA[i] - AB[j]) > 0.01 * std::max(AA[i], AB[j])) continue;
            if (d < bestd) { bestd = d; best = int(j); }
        }
        if (best < 0 || bestd > tol) { ++unmatched; continue; }
        used[best] = 1;
        Pair p; p.ia = int(i); p.ib = best; p.cdist = bestd;
        out.push_back(p);
    }
    return out;
}

int gridN = 12;

// Re-resolve an edge on a shape that is the SAME GEOMETRY differently spelled.
// Matched on (midpoint, length) because ShapeCustom's modifier is not exposed;
// the match is required to be exact to 1e-9 of the length or it is refused, so a
// wrong edge is reported as "not found" rather than silently measured.
TopoDS_Edge matchEdge(const TopoDS_Shape& s, const TopoDS_Edge& want) {
    const double L = edgeLength(want);
    GProp_GProps g;
    try { BRepGProp::LinearProperties(want, g); } catch (...) { return TopoDS_Edge(); }
    const gp_Pnt mid = g.CentreOfMass();
    TopoDS_Edge best;
    double bestScore = 1e300;
    TopTools_IndexedMapOfShape em;
    TopExp::MapShapes(s, TopAbs_EDGE, em);
    for (int i = 1; i <= em.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(em(i));
        GProp_GProps h;
        try { BRepGProp::LinearProperties(e, h); } catch (...) { continue; }
        const double score = std::fabs(h.Mass() - L) + h.CentreOfMass().Distance(mid);
        if (score < bestScore) { bestScore = score; best = e; }
    }
    if (bestScore > 1e-9 * std::max(1.0, L)) return TopoDS_Edge();
    return best;
}

// faces of `res` that are NOT literally faces of `src` (TShape identity) — the
// blend and the retrimmed neighbourhood.
std::vector<TopoDS_Face> newFaces(const TopoDS_Shape& res, const TopoDS_Shape& src) {
    std::vector<TopoDS_Face> out;
    TopTools_IndexedMapOfShape rm, sm;
    TopExp::MapShapes(res, TopAbs_FACE, rm);
    TopExp::MapShapes(src, TopAbs_FACE, sm);
    for (int i = 1; i <= rm.Extent(); ++i) {
        const TopoDS_Face f = TopoDS::Face(rm(i));
        bool found = false;
        for (int j = 1; j <= sm.Extent() && !found; ++j) if (f.IsPartner(TopoDS::Face(sm(j)))) found = true;
        if (!found) out.push_back(f);
    }
    return out;
}


int runPart(const std::string& stepPath, const std::string& name) {
    PartInfo part;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str());
            return 1;
        }
        try { rd.TransferRoots(); } catch (...) {}
        try { part.shape = rd.OneShape(); } catch (...) {}
        if (part.shape.IsNull()) {
            std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str());
            return 1;
        }
    }
    if (!boundsOf(part.shape, part.bb)) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", name.c_str());
        return 1;
    }
    const double dx = part.bb[3] - part.bb[0], dy = part.bb[4] - part.bb[1], dz = part.bb[5] - part.bb[2];
    part.minExt = std::min(dx, std::min(dy, dz));
    part.diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const bool flat = !(part.minExt > 1e-9 * part.diag);
    const double scale = flat ? part.diag * 0.05 : part.minExt;
    const double R = 0.05 * scale;

    double edgeLen = 0.0;
    const TopoDS_Edge e = pickLineEdge(part.shape, edgeLen);
    if (e.IsNull()) {
        std::printf("{\"part\":\"%s\",\"error\":\"no_line_edge\"}\n", name.c_str());
        return 1;
    }

    TopoDS_Shape nat, oc;
    std::string natReason;
    try {
        std::vector<forge::occtfillet::FilletSpec> sp(1);
        sp[0].edge = e; sp[0].radius = R;
        const forge::occtfillet::Result res = forge::occtfillet::makeFillet(part.shape, sp);
        if (res.ok) nat = res.shape; else natReason = res.reason;
    } catch (const Standard_Failure& f) { natReason = std::string("threw: ") + f.GetMessageString(); }
      catch (...) { natReason = "threw"; }
    try {
        BRepFilletAPI_MakeFillet mk(part.shape);
        mk.Add(R, e);
        mk.Build();
        if (mk.IsDone()) oc = mk.Shape();
    } catch (...) {}

    std::string out = "{";
    char hd[512];
    std::snprintf(hd, sizeof hd,
        "\"part\":\"%s\",\"R\":%.17g,\"edge_len\":%.17g,\"diag\":%.17g,\"min_ext\":%.17g,"
        "\"native_ok\":%s,\"occt_ok\":%s,\"native_reason\":\"%s\",",
        name.c_str(), R, edgeLen, part.diag, part.minExt,
        nat.IsNull() ? "false" : "true", oc.IsNull() ? "false" : "true",
        jsonStr(natReason, 160).c_str());
    out += hd;

    const double eps = 1.0e-12;
    const VolSet vin = measureVol(part.shape, eps);
    emitVolSet(out, "input", vin);   out += ",";
    emitKinds(out, "input", part.shape); out += ",";

    if (nat.IsNull() || oc.IsNull()) {
        out += "\"paired\":false}";
        out += "\n";
        std::fputs(out.c_str(), stdout);
        std::fflush(stdout);
        return 0;
    }

    const VolSet vn = measureVol(nat, eps);
    const VolSet vo = measureVol(oc, eps);
    emitVolSet(out, "native", vn); out += ",";
    emitVolSet(out, "occt", vo);   out += ",";
    emitKinds(out, "native", nat); out += ",";
    emitKinds(out, "occt", oc);    out += ",";

    { char b[128];
      int nv = -1, ov = -1;
      try { nv = BRepCheck_Analyzer(nat).IsValid() ? 1 : 0; } catch (...) {}
      try { ov = BRepCheck_Analyzer(oc).IsValid() ? 1 : 0; } catch (...) {}
      std::snprintf(b, sizeof b, "\"native_valid\":%d,\"occt_valid\":%d,", nv, ov);
      out += b; }

    // face inventories
    auto inventory = [](const TopoDS_Shape& s, std::vector<TopoDS_Face>& F,
                        std::vector<gp_Pnt>& C, std::vector<double>& A,
                        std::vector<double>& V, std::vector<int>& K) {
        TopTools_IndexedMapOfShape m;
        TopExp::MapShapes(s, TopAbs_FACE, m);
        for (int i = 1; i <= m.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(m(i));
            F.push_back(f); C.push_back(faceCentroid(f)); A.push_back(faceArea(f));
            V.push_back(faceVolContrib(f)); K.push_back(surfKind(f));
        }
    };
    std::vector<TopoDS_Face> FN, FO, FI;
    std::vector<gp_Pnt> CN, CO, CI;
    std::vector<double> AN, AO, AI, VN, VO, VI;
    std::vector<int> KN, KO, KI;
    inventory(nat, FN, CN, AN, VN, KN);
    inventory(oc, FO, CO, AO, VO, KO);
    inventory(part.shape, FI, CI, AI, VI, KI);

    // how many of each answer's faces are LITERALLY the input's faces (TShape identity)
    auto partnerCount = [&](const std::vector<TopoDS_Face>& F) {
        int n = 0;
        for (const TopoDS_Face& f : F) {
            for (const TopoDS_Face& g : FI) { if (f.IsPartner(g)) { ++n; break; } }
        }
        return n;
    };
    { char b[160];
      std::snprintf(b, sizeof b,
          "\"nf_input\":%d,\"nf_native\":%d,\"nf_occt\":%d,"
          "\"native_faces_from_input\":%d,\"occt_faces_from_input\":%d,",
          int(FI.size()), int(FN.size()), int(FO.size()),
          partnerCount(FN), partnerCount(FO));
      out += b; }

    // ── THE ORACLE: the rim closed form, read off the INPUT's own cap ring ──
    // Independent of both arms, so it says which one is right and not merely
    // that they differ.
    {
        const TopoDS_Face cap = capFaceOf(part.shape, e);
        int nLine = 0, nArc = 0; double worstTan = 0.0;
        double cf = -1.0;
        if (!cap.IsNull()) cf = rimClosedForm(cap, R, nLine, nArc, worstTan);
        const double singleEdge = (1.0 - M_PI / 4.0) * R * R * edgeLen;
        const double remNat = vin.fixed - vn.fixed;
        const double remOcc = vin.fixed - vo.fixed;
        char b2[512];
        std::snprintf(b2, sizeof b2,
            "\"cap_found\":%s,\"ring_lines\":%d,\"ring_arcs\":%d,\"ring_worst_tangent\":%.6g,"
            "\"closed_form\":%.17g,\"single_edge_closed_form\":%.17g,"
            "\"removed_native\":%.17g,\"removed_occt\":%.17g,"
            "\"native_over_closed\":%.12g,\"occt_over_closed\":%.12g,",
            cap.IsNull() ? "false" : "true", nLine, nArc, worstTan,
            cf, singleEdge, remNat, remOcc,
            cf > 0 ? remNat / cf : -1.0, cf > 0 ? remOcc / cf : -1.0);
        out += b2;
    }

    // ── the blend faces, and how far each arm's blend is from the EXACT
    //    rolling-ball surface of radius R. The analytic reference is taken from
    //    the native answer's own cylinder/torus patches; `blenddev_native` is
    //    therefore 0 by construction and is printed as the consistency reading,
    //    NOT as evidence. `blenddev_occt` and `blenddev_occtE` are the evidence.
    {
        const std::vector<TopoDS_Face> BN = newFaces(nat, part.shape);
        const std::vector<TopoDS_Face> BO = newFaces(oc, part.shape);
        // THE REFERENCE. Only the native answer's RADIUS-R rolling-ball patches
        // — a cylinder of radius exactly R, or a torus of minor radius exactly R
        // — go into the analytic set. `newFaces` also returns the RETRIMMED cap
        // and walls, which are not at distance R from the spine and would make
        // the deviation number meaningless if they were included.
        std::vector<Analytic> A;
        for (const TopoDS_Face& f : BN) {
            Analytic a;
            if (!analyticOf(f, a)) continue;
            if (a.kind == 0 && std::fabs(a.r1 - R) < 1e-9 * std::max(1.0, R)) A.push_back(a);
            else if (a.kind == 1 && std::fabs(a.r2 - R) < 1e-9 * std::max(1.0, R)) A.push_back(a);
        }
        // THE SAMPLED SET. On the OCCT side the blend patches are the new faces
        // that are NOT elementary (the corpus's answer spells them BSpline); on
        // the native side they are the analytic patches themselves, whose
        // deviation is 0 BY CONSTRUCTION and is printed as a consistency reading,
        // never as evidence.
        std::vector<TopoDS_Face> SN, SO;
        for (const TopoDS_Face& f : BN) {
            Analytic a;
            if (analyticOf(f, a) &&
                ((a.kind == 0 && std::fabs(a.r1 - R) < 1e-9 * std::max(1.0, R)) ||
                 (a.kind == 1 && std::fabs(a.r2 - R) < 1e-9 * std::max(1.0, R)))) SN.push_back(f);
        }
        for (const TopoDS_Face& f : BO) {
            const int k = surfKind(f);
            if (k == GeomAbs_BSplineSurface || k == GeomAbs_BezierSurface) SO.push_back(f);
        }
        auto worstDev = [&](const std::vector<TopoDS_Face>& F) {
            double w = -1.0;
            for (const TopoDS_Face& f : F) {
                const Dev d = deviationFromAnalytic(f, A, gridN);
                if (d.n > 0 && d.maxd > w) w = d.maxd;
            }
            return w;
        };
        auto meanDev = [&](const std::vector<TopoDS_Face>& F) {
            double sum = 0.0; int n = 0;
            for (const TopoDS_Face& f : F) {
                const Dev d = deviationFromAnalytic(f, A, gridN);
                if (d.n > 0) { sum += d.meand * d.n; n += d.n; }
            }
            return n ? sum / n : -1.0;
        };
        auto worstCurv = [&](const std::vector<TopoDS_Face>& F) {
            double w = -1.0;
            for (const TopoDS_Face& f : F) {
                const double c = curvatureMiss(f, R, gridN);
                if (c > w) w = c;
            }
            return w;
        };
        const double dn = worstDev(SN), doo = worstDev(SO);
        char b[640];
        std::snprintf(b, sizeof b,
            "\"n_new_native\":%d,\"n_new_occt\":%d,\"n_rollingball_native\":%d,"
            "\"n_bspline_blend_occt\":%d,"
            "\"blenddev_native\":%.6g,\"blenddev_occt\":%.6g,"
            "\"blenddev_occt_mean\":%.6g,\"blenddev_occt_over_R\":%.6g,"
            "\"curvmiss_native\":%.6g,\"curvmiss_occt\":%.6g,",
            int(BN.size()), int(BO.size()), int(SN.size()), int(SO.size()),
            dn, doo, meanDev(SO), doo > 0 ? doo / R : doo,
            worstCurv(SN), worstCurv(SO));
        out += b;
    }

    int unmatched = 0;
    const std::vector<Pair> pairs =
        pairFaces(FN, FO, CN, CO, AN, AO, 1e-3 * part.diag, unmatched);

    // Aggregate over pairs, and record every pair whose surface KIND differs or
    // whose sampled distance / volume contribution is not negligible.
    double sumAbsDV = 0.0, sumDV = 0.0, worstDist = 0.0, worstDistRel = 0.0;
    int nKindDiff = 0, nDistOver = 0, nSampled = 0;
    std::string detail = "[";
    bool firstD = true;
    for (const Pair& p : pairs) {
        const double dv = VN[p.ia] - VO[p.ib];
        const double da = AN[p.ia] - AO[p.ib];
        sumAbsDV += std::fabs(dv);
        sumDV += dv;
        const bool kindDiff = KN[p.ia] != KO[p.ib];
        if (kindDiff) ++nKindDiff;
        const bool moved = std::fabs(dv) > 1e-9 * std::max(1.0, std::fabs(VO[p.ib])) ||
                           std::fabs(da) > 1e-9 * std::max(1.0, AO[p.ib]);
        if (!kindDiff && !moved) continue;
        const DistStat ds = surfaceDistance(FN[p.ia], FO[p.ib], gridN);
        ++nSampled;
        if (ds.ok) {
            if (ds.maxd > worstDist) worstDist = ds.maxd;
            const double rel = ds.maxd / std::max(1e-30, part.diag);
            if (rel > worstDistRel) worstDistRel = rel;
            if (ds.maxd > 1e-9 * part.diag) ++nDistOver;
        }
        char b[512];
        std::snprintf(b, sizeof b,
            "%s{\"kn\":\"%s\",\"ko\":\"%s\",\"area_n\":%.12g,\"area_o\":%.12g,"
            "\"dvol\":%.12g,\"maxdist\":%.6g,\"meandist\":%.6g,\"nsamp\":%d}",
            firstD ? "" : ",",
            kSurf[(KN[p.ia] < 0 || KN[p.ia] > 10) ? 10 : KN[p.ia]],
            kSurf[(KO[p.ib] < 0 || KO[p.ib] > 10) ? 10 : KO[p.ib]],
            AN[p.ia], AO[p.ib], dv, ds.maxd, ds.meand, ds.n);
        detail += b;
        firstD = false;
    }
    detail += "]";

    char tail[512];
    std::snprintf(tail, sizeof tail,
        "\"npairs\":%d,\"unmatched\":%d,\"n_kind_diff\":%d,\"n_sampled\":%d,"
        "\"n_dist_over_1e9_diag\":%d,\"worst_surface_dist\":%.6g,"
        "\"worst_surface_dist_rel_diag\":%.6g,\"sum_abs_dvol_faces\":%.12g,"
        "\"sum_dvol_faces\":%.12g,\"paired\":true,\"pairs\":",
        int(pairs.size()), unmatched, nKindDiff, nSampled, nDistOver,
        worstDist, worstDistRel, sumAbsDV, sumDV);
    out += tail;
    out += detail;
    out += "}\n";
    std::fputs(out.c_str(), stdout);
    std::fflush(stdout);
    return 0;
}

// ── E1 ON A REAL PART, IN ITS OWN PROCESS ───────────────────────────────────
// The spelling experiment below runs on a construction. This runs the same idea
// on the corpus part itself: rewrite ONLY the spelling of its walls with
// `ShapeCustom::SweptToElementary` and fillet the same rim with the same OCCT
// call. It lives in its own mode, and the driver gives it its own PROCESS,
// because `SweptToElementary` SIGSEGVs on this corpus (measured: ho1219, and it
// works on a synthetic box) — an in-process call takes the whole part's row with
// it. A crash here is DATA: it is recorded as {"error":"process_rc_139"} and the
// part is counted, not dropped.
int sweptCheck(const std::string& stepPath, const std::string& name) {
    TopoDS_Shape in;
    {
        STEPControl_Reader rd;
        IFSelect_ReturnStatus st = IFSelect_RetFail;
        try { st = rd.ReadFile(stepPath.c_str()); } catch (...) { st = IFSelect_RetFail; }
        if (st != IFSelect_RetDone) { std::printf("{\"part\":\"%s\",\"error\":\"step_read_failed\"}\n", name.c_str()); return 1; }
        try { rd.TransferRoots(); } catch (...) {}
        try { in = rd.OneShape(); } catch (...) {}
    }
    if (in.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"step_transfer_empty\"}\n", name.c_str()); return 1; }
    double bb[6];
    if (!boundsOf(in, bb)) { std::printf("{\"part\":\"%s\",\"error\":\"no_vertices\"}\n", name.c_str()); return 1; }
    const double dx = bb[3] - bb[0], dy = bb[4] - bb[1], dz = bb[5] - bb[2];
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double minExt = std::min(dx, std::min(dy, dz));
    const double R = 0.05 * ((minExt > 1e-9 * diag) ? minExt : diag * 0.05);
    double L = 0.0;
    const TopoDS_Edge e = pickLineEdge(in, L);
    if (e.IsNull()) { std::printf("{\"part\":\"%s\",\"error\":\"no_line_edge\"}\n", name.c_str()); return 1; }

    std::string out = "{";
    char b[320];
    std::snprintf(b, sizeof b, "\"part\":\"%s\",\"R\":%.17g,", name.c_str(), R);
    out += b;
    const VolSet vi = measureVol(in, 1e-12);
    emitVolSet(out, "input", vi); out += ",";
    emitKinds(out, "input", in);  out += ",";
    std::fflush(stdout);

    TopoDS_Shape conv;
    try { conv = ShapeCustom::SweptToElementary(in); } catch (...) {}
    if (conv.IsNull()) { out += "\"converted\":false}\n"; std::fputs(out.c_str(), stdout); return 0; }
    const VolSet vc = measureVol(conv, 1e-12);
    out += "\"converted\":true,";
    emitVolSet(out, "inputE", vc); out += ",";
    emitKinds(out, "inputE", conv); out += ",";
    std::snprintf(b, sizeof b, "\"conv_vol_rel\":%.6g,", std::fabs(vc.fixed - vi.fixed) / std::max(1.0, std::fabs(vi.fixed)));
    out += b;

    const TopoDS_Edge eE = matchEdge(conv, e);
    TopoDS_Shape ocE;
    if (!eE.IsNull()) {
        try {
            BRepFilletAPI_MakeFillet mk(conv);
            mk.Add(R, eE); mk.Build();
            if (mk.IsDone()) ocE = mk.Shape();
        } catch (...) {}
    }
    TopoDS_Shape oc;
    try {
        BRepFilletAPI_MakeFillet mk(in);
        mk.Add(R, e); mk.Build();
        if (mk.IsDone()) oc = mk.Shape();
    } catch (...) {}
    const TopoDS_Face cap = capFaceOf(in, e);
    int nl = 0, na = 0; double wt = 0.0;
    const double cf = cap.IsNull() ? -1.0 : rimClosedForm(cap, R, nl, na, wt);
    std::snprintf(b, sizeof b, "\"edge_matched\":%s,\"closed_form\":%.17g,",
                  eE.IsNull() ? "false" : "true", cf);
    out += b;
    if (!oc.IsNull())  { const VolSet v = measureVol(oc, 1e-12);  emitVolSet(out, "occt", v);  out += ","; emitKinds(out, "occt", oc); out += ","; }
    if (!ocE.IsNull()) { const VolSet v = measureVol(ocE, 1e-12); emitVolSet(out, "occtE", v); out += ","; emitKinds(out, "occtE", ocE); out += ","; }
    std::snprintf(b, sizeof b, "\"occt_ok\":%s,\"occtE_ok\":%s}\n",
                  oc.IsNull() ? "false" : "true", ocE.IsNull() ? "false" : "true");
    out += b;
    std::fputs(out.c_str(), stdout);
    std::fflush(stdout);
    return 0;
}

// ══════════════════════════════════════════════════════════════════════════
// THE SPELLING EXPERIMENT — geometry held fixed, spelling varied, OCCT on BOTH
// sides. No corpus, no native engine, nothing imported: one rounded-rectangle
// prism built twice (elementary walls vs Geom_SurfaceOfLinearExtrusion walls of
// the SAME curves), OCCT's own BRepFilletAPI run on the same rim of each, both
// answers scored against the closed form of §rimClosedForm. If OCCT's answer
// moves when only the spelling moves, the FILLET row's 2-5e-6 is not a tolerance
// question and not an integration artefact — it is OCCT giving a different
// SOLID for the same input geometry depending on how that geometry is written
// down. The identity of the two inputs is asserted first (volume, area, and the
// sampled surface distance face by face), because an experiment whose two arms
// are not the same geometry proves nothing.
int spellingExperiment() {
    const double W = 80.0, H = 50.0, rho = 12.0, Z = 30.0;
    int bad = 0;
    const TopoDS_Shape A = prismCanonical(W, H, rho, Z);
    const TopoDS_Shape B = prismExtrusionSpelled(W, H, rho, Z);
    if (A.IsNull() || B.IsNull()) { std::printf("FAIL: could not build both spellings\n"); return 1; }

    auto kindLine = [](const TopoDS_Shape& s) {
        int k[11] = {0};
        TopTools_IndexedMapOfShape m;
        TopExp::MapShapes(s, TopAbs_FACE, m);
        for (int i = 1; i <= m.Extent(); ++i) { int q = surfKind(TopoDS::Face(m(i))); if (q < 0 || q > 10) q = 10; k[q]++; }
        std::string o;
        for (int i = 0; i < 11; ++i) if (k[i]) { char b[32]; std::snprintf(b, sizeof b, "%s:%d ", kSurf[i], k[i]); o += b; }
        return o;
    };
    const VolSet va = measureVol(A, 1e-12), vb = measureVol(B, 1e-12);
    std::printf("INPUTS\n");
    std::printf("  A elementary spelling  %s vol=%.12f\n", kindLine(A).c_str(), va.fixed);
    std::printf("  B extrusion  spelling  %s vol=%.12f\n", kindLine(B).c_str(), vb.fixed);
    const double relV = std::fabs(va.fixed - vb.fixed) / std::fabs(va.fixed);
    const double relA = std::fabs(va.areaFixed - vb.areaFixed) / std::fabs(va.areaFixed);
    std::printf("  identity: |dV|/V = %.3g   |dA|/A = %.3g\n", relV, relA);

    // face-by-face geometric identity, not just two integrals of it
    std::vector<TopoDS_Face> FA, FB; std::vector<gp_Pnt> CA, CB;
    std::vector<double> AA, AB, VA2, VB2; std::vector<int> KA, KB;
    auto inv = [](const TopoDS_Shape& s, std::vector<TopoDS_Face>& F, std::vector<gp_Pnt>& C,
                  std::vector<double>& A2, std::vector<double>& V2, std::vector<int>& K) {
        TopTools_IndexedMapOfShape m; TopExp::MapShapes(s, TopAbs_FACE, m);
        for (int i = 1; i <= m.Extent(); ++i) {
            const TopoDS_Face f = TopoDS::Face(m(i));
            F.push_back(f); C.push_back(faceCentroid(f)); A2.push_back(faceArea(f));
            V2.push_back(faceVolContrib(f)); K.push_back(surfKind(f));
        }
    };
    inv(A, FA, CA, AA, VA2, KA); inv(B, FB, CB, AB, VB2, KB);
    int un = 0;
    const std::vector<Pair> pr = pairFaces(FA, FB, CA, CB, AA, AB, 1e-6 * W, un);
    double worst = 0.0;
    for (const Pair& q : pr) {
        const DistStat d = surfaceDistance(FA[q.ia], FB[q.ib], 12);
        if (d.ok && d.maxd > worst) worst = d.maxd;
    }
    std::printf("  face pairing: %d pairs, %d unmatched, worst sampled surface distance %.3g\n",
                int(pr.size()), un, worst);
    const bool identical = relV < 1e-9 && relA < 1e-9 && un == 0 && worst < 1e-9;
    std::printf("  SAME GEOMETRY: %s\n", identical ? "yes" : "NO - the experiment is void");
    if (!identical) ++bad;

    // the rim of each, filleted by OCCT
    for (int arm = 0; arm < 2; ++arm) {
        const TopoDS_Shape& S = arm ? B : A;
        const char* nm = arm ? "B extrusion " : "A elementary";
        double L = 0.0;
        const TopoDS_Edge e = pickLineEdge(S, L);
        const double R = 4.0;
        const TopoDS_Face cap = capFaceOf(S, e);
        int nl = 0, na = 0; double wt = 0.0;
        const double cf = cap.IsNull() ? -1.0 : rimClosedForm(cap, R, nl, na, wt);
        TopoDS_Shape res;
        try {
            BRepFilletAPI_MakeFillet mk(S);
            mk.Add(R, e);
            mk.Build();
            if (mk.IsDone()) res = mk.Shape();
        } catch (...) {}
        if (res.IsNull()) { std::printf("  %s: OCCT fillet FAILED\n", nm); ++bad; continue; }
        const VolSet v0 = measureVol(S, 1e-12), v1 = measureVol(res, 1e-12);
        const double removed = v0.fixed - v1.fixed;
        int valid = -1;
        try { valid = BRepCheck_Analyzer(res).IsValid() ? 1 : 0; } catch (...) {}
        std::printf("  %s: cap ring %d lines %d arcs, closed form %.9f\n", nm, nl, na, cf);
        std::printf("     OCCT removed %.9f   removed/closed = %.12f   (1 - that) = %.3e\n",
                    removed, cf > 0 ? removed / cf : -1.0, cf > 0 ? 1.0 - removed / cf : 0.0);
        std::printf("     result %s valid=%d  v_fixed=%.9f v_gk=%.9f (gk_err %.2g)\n",
                    kindLine(res).c_str(), valid, v1.fixed, v1.gk, v1.gkErr);
    }
    std::printf("%s\n", bad ? "EXPERIMENT VOID" : "experiment well-formed");
    return bad;
}

// ── controls, run before any corpus number exists ───────────────────────────
int selftest() {
    int bad = 0;
    auto ck = [&](const char* what, bool okv, const char* got) {
        std::printf("  %-46s %s   %s\n", what, okv ? "ok  " : "FAIL", got);
        if (!okv) ++bad;
    };
    char msg[256];

    // C1. POSITIVE CONTROL for the geometric comparator: the same surface,
    //     spelled the same way, must read as distance zero. A probe that cannot
    //     see "identical" cannot be trusted to report "different".
    const TopoDS_Shape box = BRepPrimAPI_MakeBox(40.0, 30.0, 20.0).Shape();
    TopTools_IndexedMapOfShape bm;
    TopExp::MapShapes(box, TopAbs_FACE, bm);
    const TopoDS_Face f0 = TopoDS::Face(bm(1));
    {
        const DistStat d = surfaceDistance(f0, f0, 8);
        std::snprintf(msg, sizeof msg, "maxdist=%.3g over %d samples", d.maxd, d.n);
        ck("C1 same face reads distance 0", d.ok && d.maxd < 1e-12, msg);
    }

    // C2. NEGATIVE CONTROL: the same face translated by 0.25 must read 0.25,
    //     not zero. Without this, C1 is satisfied by a comparator stuck at 0.
    {
        // along the face's OWN normal — a translation inside the plane would
        // leave the surface where it was and the control would pass by luck.
        gp_Vec n(0.0, 0.0, 1.0);
        {
            Handle(Geom_Surface) sf = BRep_Tool::Surface(f0);
            Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(sf);
            if (!pl.IsNull()) n = gp_Vec(pl->Pln().Axis().Direction());
        }
        gp_Trsf t; t.SetTranslation(n * 0.25);
        const TopoDS_Shape moved = BRepBuilderAPI_Transform(f0, t, Standard_True).Shape();
        TopTools_IndexedMapOfShape mm;
        TopExp::MapShapes(moved, TopAbs_FACE, mm);
        const DistStat d = surfaceDistance(f0, TopoDS::Face(mm(1)), 8);
        std::snprintf(msg, sizeof msg, "maxdist=%.6g (want 0.25)", d.maxd);
        ck("C2 displaced face reads the displacement", d.ok && std::fabs(d.maxd - 0.25) < 1e-9, msg);
    }

    // C3. INTEGRATOR CONTROL, against a closed form. A cylinder's volume is
    //     pi r^2 h exactly; this anchors "the fixed-order integrator is/ is not
    //     converged" to a case where the true answer is known.
    {
        const double r = 7.0, h = 23.0;
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(r, h).Shape();
        const double exact = M_PI * r * r * h;
        const VolSet v = measureVol(cyl, 1.0e-12);
        const double relFixed = std::fabs(v.fixed - exact) / exact;
        const double relGk = std::fabs(v.gk - exact) / exact;
        std::snprintf(msg, sizeof msg, "fixed rel=%.3g  gk rel=%.3g  gk_err=%.3g",
                      relFixed, relGk, v.gkErr);
        ck("C3 cylinder volume vs pi r^2 h", relFixed < 1e-12 && relGk < 1e-9, msg);
    }

    // C4. THE OPERATION'S OWN CLOSED FORM on a canonical box: both arms must
    //     remove (1 - pi/4) R^2 L. This is the control that the derived
    //     operation and both engines are wired up the way the A/B wires them.
    {
        double L = 0.0;
        const TopoDS_Edge e = pickLineEdge(box, L);
        const double R = 0.05 * 20.0;
        const double expect = (1.0 - M_PI / 4.0) * R * R * L;
        TopoDS_Shape nat, oc;
        try {
            std::vector<forge::occtfillet::FilletSpec> sp(1);
            sp[0].edge = e; sp[0].radius = R;
            const forge::occtfillet::Result res = forge::occtfillet::makeFillet(box, sp);
            if (res.ok) nat = res.shape;
        } catch (...) {}
        try {
            BRepFilletAPI_MakeFillet mk(box);
            mk.Add(R, e); mk.Build();
            if (mk.IsDone()) oc = mk.Shape();
        } catch (...) {}
        const double v0 = measureVol(box, 1e-12).fixed;
        const double vn = nat.IsNull() ? 0.0 : measureVol(nat, 1e-12).fixed;
        const double vo = oc.IsNull() ? 0.0 : measureVol(oc, 1e-12).fixed;
        const double rn = nat.IsNull() ? -1.0 : (v0 - vn) / expect;
        const double ro = oc.IsNull() ? -1.0 : (v0 - vo) / expect;
        std::snprintf(msg, sizeof msg, "native dV/closed=%.9f  occt dV/closed=%.9f", rn, ro);
        ck("C4 box edge: both arms remove (1-pi/4)R^2 L",
           !nat.IsNull() && !oc.IsNull() &&
           std::fabs(rn - 1.0) < 1e-6 && std::fabs(ro - 1.0) < 1e-6, msg);
    }

    // C5. The SPELLING EXPERIMENT's two inputs must be the SAME GEOMETRY. An
    //     experiment whose arms differ in geometry proves nothing about spelling,
    //     so this is asserted here rather than reported alongside the result.
    {
        const TopoDS_Shape A = prismCanonical(80.0, 50.0, 12.0, 30.0);
        const TopoDS_Shape B = prismExtrusionSpelled(80.0, 50.0, 12.0, 30.0);
        bool okv = !A.IsNull() && !B.IsNull();
        double relV = 1.0;
        if (okv) {
            const VolSet va = measureVol(A, 1e-12), vb = measureVol(B, 1e-12);
            relV = std::fabs(va.fixed - vb.fixed) / std::fabs(va.fixed);
            okv = relV < 1e-9;
        }
        std::snprintf(msg, sizeof msg, "|dV|/V = %.3g", relV);
        ck("C5 the two spellings are the same geometry", okv, msg);
    }

    // C6. The JSONL this probe writes must be STRICTLY decodable. Its first run
    //     emitted 67 of 600 rows with a UTF-8 sequence cut in half by a byte-wise
    //     truncation of an engine defer reason — a lenient reader parsed them and
    //     a strict one refused. The truncation must land on a character boundary.
    {
        const std::string dash = "\xe2\x80\x94";          // an em-dash, 3 bytes
        const std::string x = std::string(159, 'a') + dash;  // cut would split it
        const std::string cut = jsonStr(x, 160);
        const std::string whole = jsonStr(x, 162);
        const bool okv = cut.size() == 159 && whole.size() == 162 &&
                         jsonStr("a\"b\\c", 16) == "a\\\"b\\\\c";
        std::snprintf(msg, sizeof msg, "cut=%zu (want 159) whole=%zu (want 162)",
                      cut.size(), whole.size());
        ck("C6 JSON strings truncate on a char boundary", okv, msg);
    }

    std::printf("%s: %d control(s) failed\n", bad ? "FAIL" : "PASS", bad);
    return bad;
}

}  // namespace

int main(int argc, char** argv) {
    std::string step, name = "part";
    bool sweptMode = false;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--selftest") return selftest();
        else if (a == "--spelling") return spellingExperiment();
        else if (a == "--sweptcheck") sweptMode = true;
        else if (a.rfind("--name=", 0) == 0) name = a.substr(7);
        else if (a.rfind("--grid=", 0) == 0) gridN = std::max(2, std::atoi(a.c_str() + 7));
        else if (!a.empty() && a[0] != '-') step = a;
    }
    if (step.empty()) {
        std::fprintf(stderr, "usage: fillet_nearmiss_probe <part.step> [--name=X] [--grid=N]\n"
                             "       fillet_nearmiss_probe --selftest\n");
        return 2;
    }
    return sweptMode ? sweptCheck(step, name) : runPart(step, name);
}
