// forge/native/brep/assert_input_validation_test.cpp
//
// T-153 GATE — "assert() is not input validation".
//
// WHAT THIS GUARDS. Thirty runtime assert() calls sat under
// forge-kernel/src/native/brep/ (Nurbs.cpp 8, NurbsCalculus.cpp 10,
// Primitives.cpp 9, Topology.cpp 3). The product ships with -DNDEBUG (see
// forge-kernel/build/CMakeCache.txt: CMAKE_CXX_FLAGS_RELEASE = "-O3 -DNDEBUG"),
// where every one of them compiles to nothing and the code then did the very
// thing the assert existed to prevent. MEASURED on the unmodified tree:
//
//   * readForeignStep() on a STEP file whose RATIONAL_B_SPLINE_SURFACE weight
//     grid is 0.0 returned ok=true, reason="" — and 25 of 25 sampled points of
//     the imported surface were NaN.
//   * bezierCurvePoint() with a weights list shorter than the control points
//     returned 4.31078e-314 — uninitialised heap presented as a coordinate.
//   * Nine degenerate inputs SIGSEGV'd / SIGBUS'd outright (empty control net,
//     insertKnot at a clamped end knot, an empty Bezier grid, ...).
//   * buildBox(-5, 10, 10) returned a six-faced "solid" of negative extent, and
//     buildTorus(R=1, r=5) a self-intersecting body — both reported as success.
//   * StepAnalytic::read() on three ADVANCED_FACEs sharing one EDGE_CURVE
//     returned ok=true with a coedge wired into no edge slot at all.
//
// WHAT IT ASSERTS. Two halves, and BOTH have to hold:
//   (A) VALID INPUT IS UNCHANGED — the well-formed cases still produce the same
//       geometry they always did. If a fix ever "passes" by refusing everything,
//       this half goes red.
//   (B) DEGENERATE INPUT IS REFUSED — every converted site reports ok == false
//       with a non-empty reason (or nullptr + declineReason() for the builders),
//       and no raw entry point returns a FINITE FABRICATED number.
//
// This file is auto-discovered by test/native/run_native.sh (the `brep` class),
// which builds WITHOUT -DNDEBUG. The defect lives in the NDEBUG build, so
// test/run_t153_assert_validation_gate.sh compiles this same file BOTH ways and
// additionally mutates the engine to prove each check can go red. Running this
// file alone proves less than that script does.
//
// No test framework: plain main(), [PASS]/[FAIL] per check, exit 0 iff all pass.

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else      {           std::printf("  [FAIL] %s\n", name.c_str()); }
}

static bool finite3(const Vec3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}
// A refusal on a raw Vec3 entry point must be a NaN, never a plausible number.
static bool isRefusedPoint(const Vec3& p) {
    return std::isnan(p.x) && std::isnan(p.y) && std::isnan(p.z);
}

// --------------------------------------------------------------------------
// Fixtures.
// --------------------------------------------------------------------------
// The standard weighted quarter circle: a rational degree-2 NURBS whose every
// point lies exactly on the unit circle. This is the POSITIVE CONTROL.
static NurbsCurve quarterCircle() {
    NurbsCurve c;
    c.degree = 2;
    c.controlPoints = {Vec3{1, 0, 0}, Vec3{1, 1, 0}, Vec3{0, 1, 0}};
    c.weights = {1.0, 0.70710678118654752440, 1.0};
    c.knots = {0, 0, 0, 1, 1, 1};
    return c;
}
// A well-formed bilinear rational patch S(u,v) — the surface POSITIVE CONTROL.
static NurbsSurface bilinearPatch() {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = {{Vec3{0, 0, 0}, Vec3{0, 1, 0}}, {Vec3{1, 0, 0}, Vec3{1, 1, 1}}};
    s.weights = {{1, 1}, {1, 1}};
    s.knotsU = {0, 0, 1, 1};
    s.knotsV = {0, 0, 1, 1};
    return s;
}

// A single ADVANCED_FACE on a RATIONAL B_SPLINE_SURFACE whose every weight is
// `w`. w = 1 is a well-formed file; w = 0 is the degenerate one that used to
// import as ok=true with an all-NaN surface.
static std::string ratBSplineStep(double L, double w) {
    std::string s;
    char b[512];
    s += "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('t153'),'2;1');\n";
    s += "FILE_NAME('t153','2026-01-01T00:00:00',(''),(''),'t','t','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
    std::snprintf(b, sizeof b, "#1=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += b;
    std::snprintf(b, sizeof b, "#2=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += b;
    std::snprintf(b, sizeof b, "#3=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += b;
    std::snprintf(b, sizeof b, "#4=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += b;
    std::snprintf(b, sizeof b,
        "#10=(BOUNDED_SURFACE()B_SPLINE_SURFACE(1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.)"
        "B_SPLINE_SURFACE_WITH_KNOTS((2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)"
        "GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE(((%.17g,%.17g),(%.17g,%.17g)))"
        "REPRESENTATION_ITEM('')SURFACE());\n", w, w, w, w); s += b;
    std::snprintf(b, sizeof b, "#21=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += b;
    std::snprintf(b, sizeof b, "#22=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += b;
    std::snprintf(b, sizeof b, "#23=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += b;
    std::snprintf(b, sizeof b, "#24=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += b;
    s += "#31=VERTEX_POINT('',#21);\n#32=VERTEX_POINT('',#22);\n";
    s += "#33=VERTEX_POINT('',#23);\n#34=VERTEX_POINT('',#24);\n";
    auto edge = [&](int ec, int va, int vb, int lp, double ax, double ay,
                    int dir, int vec, int ln, double dx, double dy, double len) {
        char q[256];
        std::snprintf(q, sizeof q, "#%d=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", lp, ax, ay); s += q;
        std::snprintf(q, sizeof q, "#%d=DIRECTION('',(%.17g,%.17g,0.));\n", dir, dx, dy); s += q;
        std::snprintf(q, sizeof q, "#%d=VECTOR('',#%d,%.17g);\n", vec, dir, len); s += q;
        std::snprintf(q, sizeof q, "#%d=LINE('',#%d,#%d);\n", ln, lp, vec); s += q;
        std::snprintf(q, sizeof q, "#%d=EDGE_CURVE('',#%d,#%d,#%d,.T.);\n", ec, va, vb, ln); s += q;
    };
    edge(41, 31, 32, 51, 0., 0., 61, 71, 81,  1.,  0., L);
    edge(42, 32, 33, 52, L,  0., 62, 72, 82,  0.,  1., L);
    edge(43, 33, 34, 53, L,  L,  63, 73, 83, -1.,  0., L);
    edge(44, 34, 31, 54, 0., L,  64, 74, 84,  0., -1., L);
    s += "#91=ORIENTED_EDGE('',*,*,#41,.T.);\n#92=ORIENTED_EDGE('',*,*,#42,.T.);\n";
    s += "#93=ORIENTED_EDGE('',*,*,#43,.T.);\n#94=ORIENTED_EDGE('',*,*,#44,.T.);\n";
    s += "#100=EDGE_LOOP('',(#91,#92,#93,#94));\n";
    s += "#101=FACE_OUTER_BOUND('',#100,.T.);\n";
    s += "#300=ADVANCED_FACE('',(#101),#10,.T.);\n";
    s += "#310=OPEN_SHELL('',(#300));\n#320=SHELL_BASED_SURFACE_MODEL('',(#310));\n";
    s += "#400=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n";
    s += "#401=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n";
    s += "#402=(NAMED_UNIT(*)SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.));\n";
    s += "#403=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#400,'','');\n";
    s += "#404=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#403))"
         "GLOBAL_UNIT_ASSIGNED_CONTEXT((#400,#401,#402))REPRESENTATION_CONTEXT('',''));\n";
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

// ===========================================================================
// (A) VALID INPUT IS UNCHANGED.
// ===========================================================================
static void testValidInputUnchanged() {
    std::printf("[A] valid input is unchanged\n");

    // The quarter circle must still land exactly on the unit circle, and the
    // raw entry point must agree with the checked one bit for bit.
    const NurbsCurve c = quarterCircle();
    bool onCircle = true, rawAgrees = true;
    for (int i = 0; i <= 16; ++i) {
        const double u = i / 16.0;
        const PointEval e = c.evaluateChecked(u);
        if (!e.ok) { onCircle = false; break; }
        const double r = std::sqrt(e.value.x * e.value.x + e.value.y * e.value.y);
        if (std::fabs(r - 1.0) > 1e-15) onCircle = false;
        const Vec3 raw = c.evaluate(u);
        if (!(raw.x == e.value.x && raw.y == e.value.y && raw.z == e.value.z))
            rawAgrees = false;
    }
    check(onCircle, "quarter-circle NURBS still evaluates onto the unit circle (17 samples, 1e-15)");
    check(rawAgrees, "raw evaluate() is bit-identical to evaluateChecked().value on valid input");

    // Bezier and B-spline paths must still cross-check each other exactly.
    {
        const std::vector<Vec3> P = {Vec3{1, 0, 0}, Vec3{1, 1, 0}, Vec3{0, 1, 0}};
        const std::vector<double> W = {1.0, 0.70710678118654752440, 1.0};
        bool agree = true;
        for (int i = 0; i <= 8; ++i) {
            const double t = i / 8.0;
            const PointEval b = bezierCurvePointChecked(P, W, t);
            const PointEval n = c.evaluateChecked(t);
            if (!b.ok || !n.ok) { agree = false; break; }
            if (std::fabs(b.value.x - n.value.x) > 1e-15 ||
                std::fabs(b.value.y - n.value.y) > 1e-15 ||
                std::fabs(b.value.z - n.value.z) > 1e-15) agree = false;
        }
        check(agree, "rational Bezier and B-spline paths still agree to 1e-15 on valid input");
    }

    // A well-formed surface still evaluates, and its derivatives/normal exist.
    {
        const NurbsSurface s = bilinearPatch();
        const PointEval p = s.evaluateChecked(0.5, 0.5);
        check(p.ok && finite3(p.value) &&
              std::fabs(p.value.x - 0.5) < 1e-15 &&
              std::fabs(p.value.y - 0.5) < 1e-15 &&
              std::fabs(p.value.z - 0.25) < 1e-15,
              "valid bilinear patch still evaluates to the exact expected point");
        check(surfaceDerivativesChecked(s, 0.5, 0.5, 1).ok,
              "surfaceDerivatives still accepts a valid surface");
        check(surfaceNormalChecked(s, 0.5, 0.5).ok,
              "surfaceNormal still accepts a valid surface");
        check(curveDerivativesChecked(c, 0.5, 2).ok,
              "curveDerivatives still accepts a valid curve");
        check(curveTangentChecked(c, 0.5).ok,
              "curveTangent still accepts a valid curve");
        check(curveCurvatureChecked(c, 0.5).ok,
              "curveCurvature still accepts a valid curve");
    }

    // Knot insertion at a legal interior parameter must still work AND must
    // leave the geometry identical — the whole point of Boehm insertion.
    {
        const CurveEval ins = insertKnotChecked(c, 0.5);
        bool same = ins.ok && ins.curve.controlPoints.size() == c.controlPoints.size() + 1;
        if (same) {
            for (int i = 0; i <= 16 && same; ++i) {
                const double u = i / 16.0;
                const PointEval a = c.evaluateChecked(u);
                const PointEval b = ins.curve.evaluateChecked(u);
                if (!a.ok || !b.ok) { same = false; break; }
                if (std::fabs(a.value.x - b.value.x) > 1e-12 ||
                    std::fabs(a.value.y - b.value.y) > 1e-12 ||
                    std::fabs(a.value.z - b.value.z) > 1e-12) same = false;
            }
        }
        check(same, "insertKnot at a legal interior knot still adds one control point "
                    "and preserves the curve exactly");
    }

    // Every primitive must still build at sane dimensions, with no decline.
    {
        PrimitiveOptions o; o.nSeg = 12; o.nBand = 6;
        SolidFactory f(o);
        const bool built =
            f.buildBox(10, 20, 30)        != nullptr &&
            f.buildCylinder(5, 10)        != nullptr &&
            f.buildCone(5, 2, 10)         != nullptr &&
            f.buildCone(5, 0, 10)         != nullptr &&   // apex cone: rT == 0 is legal
            f.buildSphere(4)              != nullptr &&
            f.buildTorus(10, 3)           != nullptr &&
            f.buildPrism(6, 5, 10)        != nullptr &&
            f.buildWedge(10, 10, 10, 4)   != nullptr &&
            f.buildWedge(10, 10, 10, 0)   != nullptr &&   // ltx == 0 is legal
            f.buildWedge(10, 10, 10, 10)  != nullptr &&   // ltx == dx is legal
            f.buildTube(10, 4, 20)        != nullptr &&
            f.buildPyramid(10, 10, 12)    != nullptr &&
            f.buildEllipsoid(3, 4, 5)     != nullptr;
        check(built, "all ten primitives still build at valid dimensions (boundary cases included)");
        check(f.declineReason().empty(), "declineReason() is empty after a successful build");
    }

    // The box still has the shape it always had.
    {
        SolidFactory f;
        Solid* s = f.buildBox(2, 3, 4);
        std::size_t faces = 0;
        if (s) for (Shell* sh : s->shells) faces += sh->faces.size();
        check(s != nullptr && faces == 6, "buildBox still produces exactly 6 faces");
    }

    // A MANIFOLD ring pair must still share and mate its edge.
    {
        TopologyBuilder tb;
        Vertex* a = tb.makeVertex({0, 0, 0});
        Vertex* b = tb.makeVertex({1, 0, 0});
        Vertex* c2 = tb.makeVertex({0, 1, 0});
        Vertex* d = tb.makeVertex({0, -1, 0});
        Face* f1 = tb.makeFace(); Loop* l1 = tb.addOuterLoopToFace(f1, {a, b, c2});
        Face* f2 = tb.makeFace(); Loop* l2 = tb.addOuterLoopToFace(f2, {b, a, d});
        bool mated = l1 && l2;
        if (mated) {
            Coedge* ce = l1->first; Coedge* shared = nullptr;
            for (std::size_t i = 0; i < l1->coedgeCount && ce; ++i, ce = ce->next) {
                Edge* e = ce->edge;
                if (e && ((e->start == a && e->end == b) || (e->start == b && e->end == a)))
                    shared = ce;
            }
            mated = shared && shared->mate != nullptr;
        }
        check(mated, "two faces sharing one edge still build and MATE (manifold case unaffected)");
    }

    // A face with an inner (hole) loop must still build both loops.
    {
        TopologyBuilder tb;
        Vertex* o0 = tb.makeVertex({0, 0, 0});
        Vertex* o1 = tb.makeVertex({10, 0, 0});
        Vertex* o2 = tb.makeVertex({10, 10, 0});
        Vertex* o3 = tb.makeVertex({0, 10, 0});
        Vertex* i0 = tb.makeVertex({4, 4, 0});
        Vertex* i1 = tb.makeVertex({6, 4, 0});
        Vertex* i2 = tb.makeVertex({6, 6, 0});
        Face* f = tb.makeFace();
        Loop* outer = tb.addOuterLoopToFace(f, {o0, o1, o2, o3});
        Loop* inner = tb.addInnerLoopToFace(f, {i0, i1, i2});
        check(outer != nullptr && inner != nullptr && f->innerLoops.size() == 1,
              "a face with a hole loop still builds both loops");
    }

    // The well-formed STEP file must still import with real geometry.
    {
        const ForeignReadResult r = readForeignStep(ratBSplineStep(100.0, 1.0), -1.0);
        bool good = r.ok;
        int sampled = 0;
        if (good) {
            for (Shell* sh : r.shells)
                for (Face* f : sh->faces) {
                    Surface* su = f->surface;
                    if (!su || su->kind != SurfaceKind::Nurbs) continue;
                    for (int i = 0; i <= 4; ++i)
                        for (int j = 0; j <= 4; ++j) {
                            const PointEval p = su->nurbs.evaluateChecked(i / 4.0, j / 4.0);
                            ++sampled;
                            if (!p.ok || !finite3(p.value)) good = false;
                        }
                }
        }
        check(good && sampled == 25,
              "a well-formed rational-B-spline STEP file still imports with finite geometry");
    }
}

// ===========================================================================
// (B) DEGENERATE INPUT IS REFUSED.
// ===========================================================================
static void testDegenerateInputRefused() {
    std::printf("[B] degenerate input is refused\n");

    // --- Nurbs.cpp:33 — the canonical site. ---------------------------------
    {
        NurbsCurve c = quarterCircle();
        c.weights = {0.0, 0.0, 0.0};
        const PointEval e = c.evaluateChecked(0.5);
        check(!e.ok && e.reason[0] != '\0',
              "Nurbs.cpp:33 curve with a zero rational denominator is REFUSED with a reason");
        check(isRefusedPoint(c.evaluate(0.5)),
              "Nurbs.cpp:33 raw evaluate() returns a refusal, never a fabricated number");
    }
    {
        NurbsSurface s = bilinearPatch();
        s.weights = {{0, 0}, {0, 0}};
        const PointEval e = s.evaluateChecked(0.5, 0.5);
        check(!e.ok && e.reason[0] != '\0',
              "Nurbs.cpp:33 surface with a zero rational denominator is REFUSED with a reason");
    }
    // --- Nurbs.cpp:108 / :141 — valid() ------------------------------------
    {
        NurbsCurve c;                       // empty: used to SIGSEGV under NDEBUG
        c.degree = 2; c.knots = {0, 0, 0, 1, 1, 1};
        check(!c.evaluateChecked(0.5).ok,
              "Nurbs.cpp:108 empty control points is REFUSED (was SIGSEGV)");
        NurbsCurve d = quarterCircle(); d.degree = 0; d.knots = {0, 0, 0, 1};
        check(!d.evaluateChecked(0.5).ok,
              "Nurbs.cpp:108 degree-0 curve is REFUSED (was a finite WRONG point)");
        NurbsSurface s;                     // empty net: used to SIGSEGV
        s.degreeU = 1; s.degreeV = 1;
        check(!s.evaluateChecked(0.5, 0.5).ok,
              "Nurbs.cpp:141 empty control net is REFUSED (was SIGSEGV)");
    }
    // --- Nurbs.cpp:166 / :167 / :186 ---------------------------------------
    {
        const std::vector<Vec3> none;
        const std::vector<double> nonew;
        check(!bezierCurvePointChecked(none, nonew, 0.5).ok,
              "Nurbs.cpp:166 empty Bezier control points is REFUSED (was SIGSEGV)");
        const std::vector<Vec3> P = {Vec3{0, 0, 0}, Vec3{1, 1, 0}, Vec3{2, 0, 0}};
        const std::vector<double> shortW = {1.0};
        const PointEval e = bezierCurvePointChecked(P, shortW, 0.5);
        check(!e.ok,
              "Nurbs.cpp:167 short Bezier weights list is REFUSED (was 4.31078e-314)");
        check(isRefusedPoint(bezierCurvePoint(P, shortW, 0.5)),
              "Nurbs.cpp:167 raw bezierCurvePoint returns a refusal, not uninitialised heap");
        const std::vector<double> zeroW = {0, 0, 0};
        check(!bezierCurvePointChecked(P, zeroW, 0.5).ok,
              "Nurbs.cpp:186 zero Bezier denominator is REFUSED");
    }
    // --- Nurbs.cpp:193 / :240 ----------------------------------------------
    {
        const std::vector<std::vector<Vec3>> noneC;
        const std::vector<std::vector<double>> noneW;
        check(!bezierSurfacePointChecked(noneC, noneW, 0.5, 0.5).ok,
              "Nurbs.cpp:193 empty Bezier control grid is REFUSED (was SIGSEGV)");
        const std::vector<std::vector<Vec3>> C =
            {{Vec3{0,0,0}, Vec3{0,1,0}}, {Vec3{1,0,0}, Vec3{1,1,0}}};
        const std::vector<std::vector<double>> shortGrid = {{1, 1}};
        check(!bezierSurfacePointChecked(C, shortGrid, 0.5, 0.5).ok,
              "Nurbs.cpp:193 Bezier weights grid missing a row is REFUSED (was SIGSEGV)");
        const std::vector<std::vector<double>> zeroGrid = {{0, 0}, {0, 0}};
        check(!bezierSurfacePointChecked(C, zeroGrid, 0.5, 0.5).ok,
              "Nurbs.cpp:240 zero Bezier surface denominator is REFUSED");
    }
    // --- NurbsCalculus.cpp:170 / :198 / :207 / :214 ------------------------
    {
        NurbsCurve empty; empty.degree = 2; empty.knots = {0, 0, 0, 1, 1, 1};
        check(!curveDerivativesChecked(empty, 0.5, 1).ok,
              "NurbsCalculus.cpp:170 invalid curve is REFUSED (was SIGSEGV)");
        NurbsCurve zw = quarterCircle(); zw.weights = {0, 0, 0};
        check(!curveDerivativesChecked(zw, 0.5, 1).ok,
              "NurbsCalculus.cpp:198 zero rational denominator is REFUSED");
        NurbsCurve cusp;                    // three coincident control points
        cusp.degree = 2;
        cusp.controlPoints = {Vec3{1,1,1}, Vec3{1,1,1}, Vec3{1,1,1}};
        cusp.weights = {1, 1, 1};
        cusp.knots = {0, 0, 0, 1, 1, 1};
        check(!curveTangentChecked(cusp, 0.5).ok,
              "NurbsCalculus.cpp:207 cusp (|C'| == 0) is REFUSED, not NaN");
        check(!curveCurvatureChecked(cusp, 0.5).ok,
              "NurbsCalculus.cpp:214 cusp curvature is REFUSED, not NaN");
        check(std::isnan(curveCurvature(cusp, 0.5)),
              "NurbsCalculus.cpp:214 raw curveCurvature returns NaN, not a fabricated number");
    }
    // --- NurbsCalculus.cpp:226 / :261 / :290 -------------------------------
    {
        NurbsSurface empty; empty.degreeU = 1; empty.degreeV = 1;
        check(!surfaceDerivativesChecked(empty, 0.5, 0.5, 1).ok,
              "NurbsCalculus.cpp:226 invalid surface is REFUSED (was SIGSEGV)");
        NurbsSurface zw = bilinearPatch(); zw.weights = {{0, 0}, {0, 0}};
        check(!surfaceDerivativesChecked(zw, 0.5, 0.5, 1).ok,
              "NurbsCalculus.cpp:261 zero rational surface denominator is REFUSED");
        NurbsSurface flat;                  // whole net collapsed to one point
        flat.degreeU = 1; flat.degreeV = 1;
        flat.control = {{Vec3{2,2,2}, Vec3{2,2,2}}, {Vec3{2,2,2}, Vec3{2,2,2}}};
        flat.weights = {{1, 1}, {1, 1}};
        flat.knotsU = {0, 0, 1, 1}; flat.knotsV = {0, 0, 1, 1};
        check(!surfaceNormalChecked(flat, 0.5, 0.5).ok,
              "NurbsCalculus.cpp:290 degenerate tangent plane is REFUSED, not NaN");
    }
    // --- NurbsCalculus.cpp:299 / :312 / :363 -------------------------------
    {
        NurbsCurve empty; empty.degree = 2; empty.knots = {0, 0, 0, 1, 1, 1};
        check(!insertKnotChecked(empty, 0.5).ok,
              "NurbsCalculus.cpp:299 insertKnot on an invalid curve is REFUSED");
        // A CLAMPED curve's first knot already has multiplicity degree+1.
        const NurbsCurve c = quarterCircle();
        check(!insertKnotChecked(c, c.knots.front()).ok,
              "NurbsCalculus.cpp:312 insertKnot at a full-multiplicity knot is REFUSED "
              "(was SIGSEGV from an unsigned p-s wrap)");
        check(!insertKnot(c, c.knots.front()).valid(),
              "NurbsCalculus.cpp:312 raw insertKnot returns an INVALID curve, not a fabricated one");
        // An INTERIOR knot whose multiplicity already equals the degree. At a
        // clamped END knot findSpan clamps the span so the domain guard fires
        // first; here it does not, so the multiplicity test is the only thing
        // standing between the caller and the unsigned p-s wrap.
        NurbsCurve mult;
        mult.degree = 2;
        mult.controlPoints = {Vec3{0,0,0}, Vec3{1,1,0}, Vec3{2,0,0}, Vec3{3,1,0}, Vec3{4,0,0}};
        mult.weights = {1, 1, 1, 1, 1};
        mult.knots = {0, 0, 0, 0.5, 0.5, 1, 1, 1};
        check(mult.valid(), "the interior-multiplicity fixture is itself a valid curve");
        check(!insertKnotChecked(mult, 0.5).ok,
              "NurbsCalculus.cpp:312 insertKnot at an INTERIOR knot of multiplicity == degree "
              "is REFUSED");
        NurbsCurve zw = quarterCircle(); zw.weights = {0, 0, 0};
        check(!insertKnotChecked(zw, 0.5).ok,
              "NurbsCalculus.cpp:363 insertKnot with a degenerate weight is REFUSED");
    }
    // --- Primitives.cpp — all nine sites ------------------------------------
    {
        struct Case { const char* name; };
        PrimitiveOptions o; o.nSeg = 8; o.nBand = 4;
        int declined = 0, withReason = 0;
        const int kCases = 11;
        for (int i = 0; i < kCases; ++i) {
            SolidFactory f(o);
            Solid* s = nullptr;
            switch (i) {
                case 0:  s = f.buildBox(0, 10, 10); break;
                case 1:  s = f.buildBox(-5, 10, 10); break;
                case 2:  s = f.buildCone(0, 0, 10); break;          // both radii zero
                case 3:  s = f.buildCylinder(-2, 10); break;        // routes to buildCone
                case 4:  s = f.buildSphere(-1); break;
                case 5:  s = f.buildTorus(1, 5); break;             // minor >= major
                case 6:  s = f.buildPrism(2, 1, 1); break;          // fewer than 3 sides
                case 7:  s = f.buildWedge(10, 10, 10, 50); break;   // ltx > dx
                case 8:  s = f.buildTube(1, 5, 10); break;          // rI > rO
                case 9:  s = f.buildPyramid(0, 10, 10); break;
                case 10: s = f.buildEllipsoid(0, 1, 1); break;
            }
            if (s == nullptr) ++declined;
            if (!f.declineReason().empty()) ++withReason;
        }
        check(declined == kCases,
              "Primitives.cpp all 11 degenerate primitive requests DECLINE (return nullptr)");
        check(withReason == kCases,
              "Primitives.cpp every decline carries a non-empty declineReason()");
    }
    // A non-finite dimension must decline too.
    {
        SolidFactory f;
        const double nan = std::nan("");
        const double inf = 1.0 / 0.0;
        check(f.buildBox(nan, 10, 10) == nullptr && f.buildSphere(inf) == nullptr,
              "Primitives.cpp NaN / inf dimensions DECLINE");
    }
    // --- Topology.cpp:84 — the non-manifold third coedge --------------------
    {
        TopologyBuilder tb;
        Vertex* a = tb.makeVertex({0, 0, 0});
        Vertex* b = tb.makeVertex({1, 0, 0});
        Vertex* c = tb.makeVertex({0, 1, 0});
        Vertex* d = tb.makeVertex({0, -1, 0});
        Vertex* e = tb.makeVertex({0, 0, 1});
        Face* f1 = tb.makeFace(); Loop* l1 = tb.addOuterLoopToFace(f1, {a, b, c});
        Face* f2 = tb.makeFace(); Loop* l2 = tb.addOuterLoopToFace(f2, {a, b, d});
        Face* f3 = tb.makeFace(); Loop* l3 = tb.addOuterLoopToFace(f3, {a, b, e});
        check(l1 != nullptr && l2 != nullptr,
              "Topology.cpp:84 the first two uses of an edge are still accepted");
        check(l3 == nullptr && f3->outerLoop == nullptr,
              "Topology.cpp:84 a THIRD use of one edge is REFUSED (was a silent orphan coedge)");
        check(!tb.declineReason().empty(),
              "Topology.cpp:84 the non-manifold refusal carries a reason");
    }
    {
        // One ring that revisits the same vertex pair gives that edge three uses
        // all by itself, and its size (4) slips past the >= 3 assert.
        TopologyBuilder tb;
        Vertex* a = tb.makeVertex({0, 0, 0});
        Vertex* b = tb.makeVertex({1, 0, 0});
        Face* f = tb.makeFace();
        check(tb.addOuterLoopToFace(f, {a, b, a, b}) == nullptr,
              "Topology.cpp:84 a self-revisiting ring {a,b,a,b} is REFUSED");
    }
    {
        // A refusal must leave the builder UNTOUCHED, not half-built.
        TopologyBuilder tb;
        Vertex* a = tb.makeVertex({0, 0, 0});
        Vertex* b = tb.makeVertex({1, 0, 0});
        const std::size_t edgesBefore = tb.edgeCount();
        const std::size_t coedgesBefore = tb.coedgeCount();
        const std::size_t loopsBefore = tb.loopCount();
        Face* f = tb.makeFace();
        tb.addOuterLoopToFace(f, {a, b, a, b});
        check(tb.edgeCount() == edgesBefore &&
              tb.coedgeCount() == coedgesBefore &&
              tb.loopCount() == loopsBefore,
              "Topology.cpp:84 a refused ring creates NO edge, coedge or loop (atomic refusal)");
    }
    // --- END TO END: the public entry point that proved the defect ----------
    {
        const ForeignReadResult r = readForeignStep(ratBSplineStep(100.0, 0.0), -1.0);
        // The reader itself is outside this change's scope; what must hold is
        // that the geometry it hands over REFUSES instead of answering NaN.
        int refused = 0, fabricated = 0, sampled = 0;
        if (r.ok) {
            for (Shell* sh : r.shells)
                for (Face* f : sh->faces) {
                    Surface* su = f->surface;
                    if (!su || su->kind != SurfaceKind::Nurbs) continue;
                    for (int i = 0; i <= 4; ++i)
                        for (int j = 0; j <= 4; ++j) {
                            const PointEval p = su->nurbs.evaluateChecked(i / 4.0, j / 4.0);
                            ++sampled;
                            if (!p.ok) ++refused;
                            else if (finite3(p.value)) ++fabricated;
                        }
                }
        }
        check(sampled == 25 && refused == 25 && fabricated == 0,
              "END TO END: a STEP file with a zero rational weight grid now REFUSES at every "
              "sampled point instead of handing the B-Rep 25 NaNs");
    }
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    std::printf("=== T-153 gate: assert() is not input validation ===\n");
#ifdef NDEBUG
    std::printf("build: NDEBUG (asserts REMOVED - this is the shipped configuration)\n");
#else
    std::printf("build: asserts LIVE (debug configuration)\n");
#endif
    testValidInputUnchanged();
    testDegenerateInputRefused();
    std::printf("=== %d / %d PASS ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
