// forge-kernel/test/step_rational_roundtrip_gate.cpp
//
// T-158 — THE RATIONAL-WEIGHT GATE for the native analytic STEP writer.
//
// WHAT IT PROVES. StepAnalytic::write used to emit every NURBS surface as
// B_SPLINE_SURFACE_WITH_KNOTS — the NON-rational STEP entity, which has no field
// in which a control weight can be written. A rational surface written that way
// is a DIFFERENT SURFACE, not a rounded one: the exact rational quadratic quarter
// circle (weights 1, sqrt(2)/2, 1) read back with unit weights has mid-parameter
// radius 3*sqrt(2)/4 * R, so a 1.5 mm feature returns as 1.5909903 mm.
//
// ★ WHY OCCT IS THE ORACLE AND NOT OUR OWN READER. StepAnalytic::read does not
// reconstruct B-spline surfaces at all (see its own "unsupported ... surface
// entity" branch), so a write->read->compare through this codec would compare the
// writer with itself and would stay green on a shared misunderstanding. The file
// is therefore read back by OCCT 7.9.3's STEPControl_Reader — a separately
// authored, standards-conformant implementation — via ReadStream + TransferRoots
// + OneShape, and the geometry is read off the resulting Geom_BSplineSurface.
//
// ★ THE MEASUREMENT IS NOT A SELF-COMPARISON EITHER. Fixture R1 carries a CLOSED
// FORM: it is an exact rational quarter cylinder, so every point OCCT
// reconstructs must satisfy |P - axis| == R. Neither kernel is the judge of that.
//
// FIXTURES (the denominator this gate reports):
//   R1  rational quarter-cylinder wall of a pie wedge   3x2 grid, weights
//       {1,1},{sqrt2/2,sqrt2/2},{1,1}   -> CLOSED FORM |P| == R (R = 1.5 mm)
//   R2  rational (2,2) patch capping a box, 3x3 grid, NINE DISTINCT weights that
//       are NOT symmetric under transpose (so a transposed weight grid is caught)
//   N1  NON-rational bilinear patch capping a box, every weight exactly 1.0
//       -> must keep the SIMPLE entity and must NOT gain a RATIONAL record
//          ("the same surface with more text" is not a fix)
//
// ASSERTIONS — both a PER-SURFACE assertion and an AGGREGATE bar, because a
// mutation can hide from either one alone:
//   per-surface : every OCCT weight == the native weight (<=1e-12), and
//                 max |P_occt(u,v) - P_native(u,v)| <= 1e-9 mm
//   aggregate   : OCCT must return EXACTLY 3 B-spline surfaces, EXACTLY 2 of them
//                 rational, and the corpus-wide worst deviation must be <= 1e-9
//                 mm. The COUNT bars exist because a writer that stopped emitting
//                 the rational record would make OCCT report a non-rational
//                 surface, and a per-surface check that only looks at "surfaces
//                 OCCT says are rational" would then silently examine nothing and
//                 stay green.
//   sensitivity : a control that must FIRE. Evaluating R1's own control net with
//                 the weights forced to 1.0 must move the closed form by >= 0.05
//                 mm. Without it, a tolerance wide enough to pass anything would
//                 also pass this gate.
//
// Build (standalone C++20; OCCT linked):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     -L /opt/homebrew/opt/opencascade/lib \
//     forge-kernel/test/step_rational_roundtrip_gate.cpp \
//     forge-kernel/src/native/brep/{StepAnalytic,Surface,Topology,Nurbs,\
//       NurbsSurface,NurbsCalculus,NurbsAlgebra,Curve,StepRead,Sew,StepWatertight,\
//       MassProps}.cpp forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/src/native/geom/{ConstrainedDelaunay2D,Geom,Delaunay}.cpp \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKDESTEP -lTKXSBase -lTKShHealing -lTKDE

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Nurbs.hpp"

#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <BRep_Tool.hxx>
#include <Geom_BSplineSurface.hxx>
#include <gp_Pnt.hxx>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& what) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", what.c_str());
    if (cond) ++g_pass;
}
static Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

struct Owned { std::shared_ptr<TopologyBuilder> owner; Solid* solid = nullptr; };

// Attach a PLANE surface + outer loop to a new face of `shell`.
static Face* addPlane(TopologyBuilder& tb, Shell* shell,
                      std::vector<Vertex*> ring, Vec3 n, Vec3 ref) {
    Face* f = tb.makeFace();
    tb.addFaceToShell(shell, f);
    tb.addOuterLoopToFace(f, ring);
    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Plane;
    s->origin = PV(ring[0]->point);
    s->axis = vnorm(n);
    s->refDir = vnorm(ref);
    f->surface = s;
    const Vec3 bn = s->binormal();
    double u0 = 0, u1 = 0, w0 = 0, w1 = 0;
    f->vertexUV.clear();
    for (std::size_t i = 0; i < ring.size(); ++i) {
        const Vec3 rel = vsub(PV(ring[i]->point), s->origin);
        const double pu = vdot(rel, s->refDir), pv = vdot(rel, bn);
        f->vertexUV.push_back({pu, pv});
        if (i == 0) { u0 = u1 = pu; w0 = w1 = pv; }
        else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
               w0 = std::min(w0, pv); w1 = std::max(w1, pv); }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = w0; f->v1 = w1;
    return f;
}

// ---------------------------------------------------------------------------
// R1 — pie wedge (quarter disc prism) whose curved wall is the EXACT rational
// quadratic quarter cylinder of radius R. Closed form: |P(u,v)| == R for all u,v.
// `unitWeights` builds the SAME control net with every weight 1.0 — the surface
// the old writer was effectively emitting; used by the sensitivity control.
// ---------------------------------------------------------------------------
static Owned buildPieWedge(double R, double H, bool unitWeights) {
    Owned out; out.owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *out.owner;
    Solid* solid = tb.makeSolid(); Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell); out.solid = solid;

    Vertex* O  = tb.makeVertex({0, 0, 0});
    Vertex* A  = tb.makeVertex({R, 0, 0});
    Vertex* B  = tb.makeVertex({0, R, 0});
    Vertex* O2 = tb.makeVertex({0, 0, H});
    Vertex* A2 = tb.makeVertex({R, 0, H});
    Vertex* B2 = tb.makeVertex({0, R, H});

    addPlane(tb, shell, {O, A, B},      {0, 0, -1}, {1, 0, 0});  // bottom z=0
    addPlane(tb, shell, {O2, B2, A2},   {0, 0,  1}, {1, 0, 0});  // top    z=H
    addPlane(tb, shell, {O, O2, A2, A}, {0, -1, 0}, {1, 0, 0});  // radial y=0
    addPlane(tb, shell, {O, B, B2, O2}, {-1, 0, 0}, {0, 1, 0});  // radial x=0
    {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, {A, B, B2, A2});
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Nurbs;
        NurbsSurface& n = s->nurbs;
        n.degreeU = 2;   // the arc
        n.degreeV = 1;   // the height
        n.control = {
            { Vec3{R, 0, 0}, Vec3{R, 0, H} },
            { Vec3{R, R, 0}, Vec3{R, R, H} },   // the square corner
            { Vec3{0, R, 0}, Vec3{0, R, H} },
        };
        const double w = unitWeights ? 1.0 : std::sqrt(2.0) / 2.0;  // cos(45 deg)
        n.weights = { {1.0, 1.0}, {w, w}, {1.0, 1.0} };
        n.knotsU = {0, 0, 0, 1, 1, 1};
        n.knotsV = {0, 0, 1, 1};
        s->reversed = false;
        f->surface = s;
        f->u0 = 0; f->u1 = 1; f->v0 = 0; f->v1 = 1;
        f->vertexUV = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    }
    return out;
}

// ---------------------------------------------------------------------------
// Box [0,L]^3 whose +Z cap is a NURBS patch. Two variants:
//   rational == false -> N1: the bilinear patch, every weight exactly 1.0.
//   rational == true  -> R2: a (2,2) patch on a 3x3 net whose four boundary
//      control triples are COLLINEAR (so all four boundary curves are exactly the
//      box's top rim segments and the solid stays geometrically consistent) and
//      whose NINE weights are distinct and NOT symmetric under transpose.
// ---------------------------------------------------------------------------
static Owned buildBoxWithNurbsCap(double L, bool rational) {
    Owned out; out.owner = std::make_shared<TopologyBuilder>();
    TopologyBuilder& tb = *out.owner;
    Solid* solid = tb.makeSolid(); Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell); out.solid = solid;

    auto V = [&](double x, double y, double z) { return tb.makeVertex(Point3{x, y, z}); };
    Vertex* v000 = V(0, 0, 0); Vertex* v100 = V(L, 0, 0);
    Vertex* v110 = V(L, L, 0); Vertex* v010 = V(0, L, 0);
    Vertex* v001 = V(0, 0, L); Vertex* v101 = V(L, 0, L);
    Vertex* v111 = V(L, L, L); Vertex* v011 = V(0, L, L);

    addPlane(tb, shell, {v000, v010, v110, v100}, {0, 0, -1}, {1, 0, 0});
    addPlane(tb, shell, {v000, v100, v101, v001}, {0, -1, 0}, {1, 0, 0});
    addPlane(tb, shell, {v100, v110, v111, v101}, {1, 0, 0},  {0, 1, 0});
    addPlane(tb, shell, {v110, v010, v011, v111}, {0, 1, 0},  {-1, 0, 0});
    addPlane(tb, shell, {v010, v000, v001, v011}, {-1, 0, 0}, {0, -1, 0});
    {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        tb.addOuterLoopToFace(f, {v001, v101, v111, v011});
        Surface* s = tb.makeSurface();
        s->kind = SurfaceKind::Nurbs;
        NurbsSurface& n = s->nurbs;
        if (!rational) {
            n.degreeU = 1; n.degreeV = 1;
            n.control = { { Vec3{0, 0, L}, Vec3{0, L, L} },
                          { Vec3{L, 0, L}, Vec3{L, L, L} } };
            n.weights = { {1.0, 1.0}, {1.0, 1.0} };
            n.knotsU = {0, 0, 1, 1};
            n.knotsV = {0, 0, 1, 1};
        } else {
            const double h = L / 2.0;
            n.degreeU = 2; n.degreeV = 2;
            // i over U (x), j over V (y). Every boundary triple is collinear, so
            // the four boundary curves ARE the box's top rim segments.
            n.control = {
                { Vec3{0, 0, L}, Vec3{0, h, L}, Vec3{0, L, L} },
                { Vec3{h, 0, L}, Vec3{h, h, L + 0.5}, Vec3{h, L, L} },
                { Vec3{L, 0, L}, Vec3{L, h, L}, Vec3{L, L, L} },
            };
            // Nine distinct weights; the grid is NOT its own transpose, so a
            // writer that emitted the weight grid transposed is caught here.
            n.weights = { {1.00, 0.80, 1.00},
                          {0.60, 0.45, 0.90},
                          {1.00, 0.70, 1.00} };
            n.knotsU = {0, 0, 0, 1, 1, 1};
            n.knotsV = {0, 0, 0, 1, 1, 1};
        }
        s->reversed = false;
        f->surface = s;
        f->u0 = 0; f->u1 = 1; f->v0 = 0; f->v1 = 1;
        f->vertexUV = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    }
    return out;
}

static const NurbsSurface* onlyNurbs(const Solid& s) {
    for (const Shell* sh : s.shells) { if (!sh) continue;
        for (const Face* f : sh->faces)
            if (f && f->surface && f->surface->kind == SurfaceKind::Nurbs)
                return &f->surface->nurbs; }
    return nullptr;
}
static bool nativeIsRational(const NurbsSurface& n) {
    for (const auto& r : n.weights) for (double w : r) if (w != 1.0) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Write a fixture, read it back with OCCT, and score its one B-spline surface.
// ---------------------------------------------------------------------------
struct SurfScore {
    bool ok = false;
    bool weightsExact = false;   // every OCCT weight == the native weight
    double maxDev = 0.0;         // max |P_occt(u,v) - P_native(u,v)| in mm
    double maxWeightErr = 0.0;
    bool textHasRational = false;
    std::string why;
};

static SurfScore roundTrip(const char* label, const Solid& src, const NurbsSurface& nat,
                           int& occtBSplineCount, int& occtRationalCount) {
    SurfScore r;
    AnalyticWriteResult wr = StepAnalytic::write(src, label);
    if (!wr.ok) { r.why = "StepAnalytic::write failed: " + wr.reason; return r; }
    r.textHasRational = wr.text.find("RATIONAL_B_SPLINE_SURFACE") != std::string::npos;

    STEPControl_Reader rd;                       // ★ THE ORACLE: OCCT 7.9.3
    std::istringstream iss(wr.text);
    if (rd.ReadStream(label, iss) != IFSelect_RetDone) {
        r.why = "OCCT STEPControl_Reader.ReadStream refused the file"; return r; }
    if (rd.TransferRoots() <= 0) { r.why = "OCCT TransferRoots produced 0 roots"; return r; }
    TopoDS_Shape shape = rd.OneShape();
    if (shape.IsNull()) { r.why = "OCCT OneShape is null"; return r; }

    Handle(Geom_BSplineSurface) bs;
    for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
        Handle(Geom_BSplineSurface) c = Handle(Geom_BSplineSurface)::DownCast(
            BRep_Tool::Surface(TopoDS::Face(ex.Current())));
        if (c.IsNull()) continue;
        ++occtBSplineCount;
        bool anyNonUnit = false;
        for (int i = 1; i <= c->NbUPoles(); ++i)
            for (int j = 1; j <= c->NbVPoles(); ++j)
                if (c->Weight(i, j) != 1.0) anyNonUnit = true;
        if (anyNonUnit) ++occtRationalCount;
        if (bs.IsNull()) bs = c;
    }
    if (bs.IsNull()) { r.why = "OCCT returned no Geom_BSplineSurface for this body"; return r; }

    const std::size_t nU = nat.control.size(), nV = nat.control[0].size();
    if ((std::size_t)bs->NbUPoles() != nU || (std::size_t)bs->NbVPoles() != nV) {
        r.why = "OCCT pole-grid shape differs from the native net"; return r; }

    r.weightsExact = true;
    for (std::size_t i = 0; i < nU; ++i)
        for (std::size_t j = 0; j < nV; ++j) {
            const double e = std::fabs(bs->Weight((int)i + 1, (int)j + 1) - nat.weights[i][j]);
            r.maxWeightErr = std::max(r.maxWeightErr, e);
            if (e > 1e-12) r.weightsExact = false;
        }

    double u0, u1, v0, v1; bs->Bounds(u0, u1, v0, v1);
    const double a0 = nat.knotsU.front(), a1 = nat.knotsU.back();
    const double b0 = nat.knotsV.front(), b1 = nat.knotsV.back();
    for (int i = 0; i <= 16; ++i)
        for (int j = 0; j <= 16; ++j) {
            const double s = i / 16.0, t = j / 16.0;
            const gp_Pnt P = bs->Value(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t);
            const Vec3  Q = nat.evaluate(a0 + (a1 - a0) * s, b0 + (b1 - b0) * t);
            r.maxDev = std::max(r.maxDev, std::sqrt((P.X() - Q.x) * (P.X() - Q.x) +
                                                    (P.Y() - Q.y) * (P.Y() - Q.y) +
                                                    (P.Z() - Q.z) * (P.Z() - Q.z)));
        }
    // Closed form, where the fixture has one: R1 is an exact cylinder of radius R.
    r.ok = true;
    return r;
}

int main() {
    std::printf("step_rational_roundtrip_gate — T-158\n");
    std::printf("ORACLE: Open CASCADE 7.9.3 STEPControl_Reader "
                "(ReadStream + TransferRoots + OneShape); the geometry is read off "
                "the reconstructed Geom_BSplineSurface.\n");
    std::printf("CORPUS: 3 bodies / 3 B-spline surfaces — R1 rational quarter "
                "cylinder (closed form), R2 rational (2,2) patch with 9 distinct "
                "weights, N1 non-rational bilinear patch.\n\n");

    const double R = 1.5, H = 2.0, L = 3.0;
    int occtBSpline = 0, occtRational = 0;
    double worst = 0.0;
    int ratSurfaces = 0, ratWeightsKept = 0;

    // ---- R1: rational quarter cylinder, with a CLOSED FORM ------------------
    std::printf("=== R1 rational quarter cylinder (R=%.3f, weights 1, sqrt2/2, 1) ===\n", R);
    {
        Owned f = buildPieWedge(R, H, /*unitWeights=*/false);
        const NurbsSurface* nat = onlyNurbs(*f.solid);
        check(nat && nativeIsRational(*nat), "R1: the fixture really is rational (a non-rational fixture proves nothing)");
        SurfScore sc = roundTrip("t158_R1", *f.solid, *nat, occtBSpline, occtRational);
        check(sc.ok, std::string("R1: OCCT read the written file") + (sc.ok ? "" : " — " + sc.why));
        if (sc.ok) {
            ++ratSurfaces;
            check(sc.textHasRational, "R1: the file carries a RATIONAL_B_SPLINE_SURFACE record");
            check(sc.weightsExact, "R1 [per-surface]: every OCCT weight == the native weight (max err " +
                  std::to_string(sc.maxWeightErr) + ")");
            if (sc.weightsExact) ++ratWeightsKept;
            check(sc.maxDev <= 1e-9, "R1 [per-surface]: max |P_occt - P_native| <= 1e-9 mm (got " +
                  std::to_string(sc.maxDev) + ")");
            worst = std::max(worst, sc.maxDev);

            // CLOSED FORM: re-read the file and assert |P| == R on OCCT's surface.
            AnalyticWriteResult wr = StepAnalytic::write(*f.solid, "t158_R1");
            STEPControl_Reader rd; std::istringstream iss(wr.text);
            double cf = 0.0; bool got = false;
            if (rd.ReadStream("t158_R1", iss) == IFSelect_RetDone && rd.TransferRoots() > 0) {
                TopoDS_Shape sh = rd.OneShape();
                for (TopExp_Explorer ex(sh, TopAbs_FACE); ex.More(); ex.Next()) {
                    Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(
                        BRep_Tool::Surface(TopoDS::Face(ex.Current())));
                    if (bs.IsNull()) continue;
                    got = true;
                    double u0, u1, v0, v1; bs->Bounds(u0, u1, v0, v1);
                    for (int i = 0; i <= 32; ++i) for (int j = 0; j <= 4; ++j) {
                        gp_Pnt P = bs->Value(u0 + (u1 - u0) * i / 32.0, v0 + (v1 - v0) * j / 4.0);
                        cf = std::max(cf, std::fabs(std::hypot(P.X(), P.Y()) - R));
                    }
                    gp_Pnt M = bs->Value(0.5 * (u0 + u1), 0.5 * (v0 + v1));
                    std::printf("  R1 mid-parameter radius from OCCT = %.7f (exact %.7f)\n",
                                std::hypot(M.X(), M.Y()), R);
                }
            }
            check(got && cf <= 1e-9,
                  "R1 [closed form]: max | |P_occt| - R | <= 1e-9 mm over 165 samples (got " +
                  std::to_string(cf) + ")");
        }
    }

    // ---- SENSITIVITY CONTROL: it must FIRE ----------------------------------
    // The same control net evaluated with the weights forced to 1.0 is the surface
    // the non-rational entity encodes. If that does NOT move the closed form by a
    // large margin, this fixture cannot detect a lost weight and the gate above is
    // vacuous — so this control failing is a RED gate, by design.
    std::printf("\n=== sensitivity control (must FIRE) ===\n");
    {
        Owned f = buildPieWedge(R, H, /*unitWeights=*/true);
        const NurbsSurface* nat = onlyNurbs(*f.solid);
        double cf = 0.0;
        for (int i = 0; i <= 32; ++i) for (int j = 0; j <= 4; ++j) {
            Vec3 P = nat->evaluate(i / 32.0, j / 4.0);
            cf = std::max(cf, std::fabs(std::hypot(P.x, P.y) - R));
        }
        std::printf("  the SAME control net with unit weights deviates by %.7f mm "
                    "(mid-parameter radius %.7f vs %.7f)\n",
                    cf, std::hypot(nat->evaluate(0.5, 0.5).x, nat->evaluate(0.5, 0.5).y), R);
        check(cf >= 0.05, "sensitivity: dropping R1's weights moves the closed form by >= 0.05 mm (got " +
              std::to_string(cf) + ") — a fixture that cannot see a lost weight is not a fixture");
    }

    // ---- R2: rational (2,2) patch, 9 distinct non-transpose-symmetric weights
    std::printf("\n=== R2 rational (2,2) cap, nine distinct weights ===\n");
    {
        Owned f = buildBoxWithNurbsCap(L, /*rational=*/true);
        const NurbsSurface* nat = onlyNurbs(*f.solid);
        check(nat && nativeIsRational(*nat), "R2: the fixture really is rational");
        SurfScore sc = roundTrip("t158_R2", *f.solid, *nat, occtBSpline, occtRational);
        check(sc.ok, std::string("R2: OCCT read the written file") + (sc.ok ? "" : " — " + sc.why));
        if (sc.ok) {
            ++ratSurfaces;
            check(sc.textHasRational, "R2: the file carries a RATIONAL_B_SPLINE_SURFACE record");
            check(sc.weightsExact, "R2 [per-surface]: every one of the 9 OCCT weights == the native "
                  "weight (max err " + std::to_string(sc.maxWeightErr) + ")");
            if (sc.weightsExact) ++ratWeightsKept;
            check(sc.maxDev <= 1e-9, "R2 [per-surface]: max |P_occt - P_native| <= 1e-9 mm (got " +
                  std::to_string(sc.maxDev) + ")");
            worst = std::max(worst, sc.maxDev);
        }
    }

    // ---- N1: non-rational control -------------------------------------------
    std::printf("\n=== N1 NON-rational bilinear cap (every weight exactly 1.0) ===\n");
    {
        Owned f = buildBoxWithNurbsCap(L, /*rational=*/false);
        const NurbsSurface* nat = onlyNurbs(*f.solid);
        check(nat && !nativeIsRational(*nat), "N1: the fixture really is NON-rational");
        SurfScore sc = roundTrip("t158_N1", *f.solid, *nat, occtBSpline, occtRational);
        check(sc.ok, std::string("N1: OCCT read the written file") + (sc.ok ? "" : " — " + sc.why));
        if (sc.ok) {
            // "the same surface with more text" is not a fix: a genuinely
            // non-rational surface must keep the compact simple entity.
            check(!sc.textHasRational,
                  "N1: a NON-rational surface does NOT gain a RATIONAL_B_SPLINE_SURFACE record");
            check(sc.maxDev <= 1e-9, "N1: max |P_occt - P_native| <= 1e-9 mm (got " +
                  std::to_string(sc.maxDev) + ")");
            worst = std::max(worst, sc.maxDev);
        }
    }

    // ---- AGGREGATE BARS ------------------------------------------------------
    // These exist because the per-surface assertions above only run on surfaces
    // that came back at all: a writer that stopped emitting the rational record
    // would make OCCT report a NON-rational surface, and a check phrased as "for
    // each rational surface ..." would then examine nothing and stay green.
    std::printf("\n=== aggregate bars (denominator: %d B-spline surfaces over 3 bodies) ===\n",
                occtBSpline);
    check(occtBSpline == 3, "aggregate: OCCT returned exactly 3 B-spline surfaces (got " +
          std::to_string(occtBSpline) + ")");
    check(occtRational == 2, "aggregate: exactly 2 of them came back RATIONAL, i.e. with a "
          "non-unit weight (got " + std::to_string(occtRational) + " — 0 means every weight was lost)");
    check(ratSurfaces == 2 && ratWeightsKept == 2,
          "aggregate: rational surfaces whose weights SURVIVED the round trip = " +
          std::to_string(ratWeightsKept) + " / " + std::to_string(ratSurfaces));
    check(worst <= 1e-9, "aggregate: corpus-wide worst |P_occt - P_native| <= 1e-9 mm (got " +
          std::to_string(worst) + ")");

    std::printf("\nstep_rational_roundtrip_gate RESULT: %d/%d passed -> %s\n",
                g_pass, g_total, (g_pass == g_total) ? "GREEN" : "RED");
    return (g_pass == g_total) ? 0 : 1;
}
