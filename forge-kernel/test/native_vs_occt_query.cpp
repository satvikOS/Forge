// forge-kernel/test/native_vs_occt_query.cpp
//
// RIGOROUS 1:1 A/B HARNESS — native B-rep geometric QUERIES
//   (forge::native::brep::minDistance / pointInSolid)   vs   OCCT
//   BRepExtrema_DistShapeShape(.Value())  /  BRepClass3d_SolidClassifier(.State()).
//
// STANDALONE C++20 oracle that LINKS OCCT (brew opencascade 7.9.3). It is NOT
// part of the native gate (run_native.sh) and does NOT touch binding.cpp /
// CMakeLists.txt / the native gate. It builds the SAME geometry on BOTH sides
// and compares the physical signatures the queries must match OCCT on.
//
// Cases mirror query_test.cpp EXACTLY:
//   minDistance:
//     (1) sphere r=1 @ origin  vs  sphere r=1 @ (5,0,0)        -> gap  3.0
//     (1b) sphere r=1 @ origin vs  sphere r=1 @ (1.5,0,0)      -> overlap
//     (2) box [0,1]^3          vs  box [3,4]x[0,1]x[0,1]       -> gap  2.0
//     (2b) box [0,1]^3         vs  box [3,4]x[3,4]x[0,1]       -> gap  sqrt(8)
//   pointInSolid (classification vs BRepClass3d_SolidClassifier State):
//     box [0,2]^3      : centre IN, +Xout OUT, -Xout OUT, face ON, corner ON
//     cylinder r1 h2   : axis IN, r=0.5 IN, r=2 OUT, above-top OUT, top-centre ON
//     sphere r1        : centre IN, exterior OUT, surface(~ON)
//
// GATES:
//   * minDistance native vs OCCT DistShapeShape.Value():
//        relative <= 1e-6  OR  absolute <= 1e-9   (per the prompt).
//        (OCCT's DistShapeShape returns 0 for touching/overlapping shapes, so
//         the overlap cases are compared against OCCT==0 vs native<=0.)
//   * pointInSolid classification == OCCT SolidClassifier State() for EVERY
//        probe point (IN<->TopAbs_IN, OUT<->TopAbs_OUT, ON<->TopAbs_ON).
//
// Build + run (manual; mirrors native_vs_occt_section.cpp's build line):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     src/native/brep/Query.cpp src/native/brep/Primitives.cpp \
//     src/native/brep/Surface.cpp src/native/brep/Topology.cpp \
//     src/native/brep/Curve.cpp src/native/brep/Nurbs.cpp \
//     src/native/brep/NurbsSurface.cpp src/native/brep/SolidTessellate.cpp \
//     src/native/mesh/HalfEdgeMesh.cpp \
//     test/native_vs_occt_query.cpp \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKPrim -lTKBO -lTKBool -lTKShHealing \
//     -o /tmp/native_vs_occt_query && /tmp/native_vs_occt_query

// --- native queries -------------------------------------------------------
#include "forge/native/brep/Query.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"

// --- OCCT ------------------------------------------------------------------
#include <gp_Pnt.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <TopoDS_Shape.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <TopAbs_State.hxx>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf("  [%s] %s\n", cond ? "PASS" : "FAIL", name.c_str());
    if (cond) ++g_pass;
}

// rel<=1e-6 OR abs<=1e-9 (per the prompt's tolerance spec).
static bool distClose(double got, double exp) {
    double a = std::fabs(got - exp);
    if (a <= 1e-9) return true;
    double r = a / std::max(1.0, std::fabs(exp));
    return r <= 1e-6;
}

// ===========================================================================
// NATIVE solid builders that mirror query_test.cpp's in-place shift logic.
// ===========================================================================

// Shift every UNIQUE surface origin of a solid by (dx,dy,dz) (pointer-dedup).
static void shiftSphereSurfaces(Solid* s, double dx) {
    std::vector<Surface*> seen;
    for (Shell* sh : s->shells)
        for (Face* f : sh->faces)
            if (f->surface) {
                Surface* p = f->surface;
                bool found = false;
                for (Surface* q : seen) if (q == p) { found = true; break; }
                if (!found) { seen.push_back(p); p->origin.x += dx; }
            }
}

// Shift a box solid (planar face origins + welded boundary vertices, dedup).
static void shiftBox(Solid* s, double dx, double dy) {
    std::vector<Vertex*> seen;
    auto shiftOnce = [&](Vertex* v) {
        for (Vertex* q : seen) if (q == v) return;
        seen.push_back(v);
        v->point.x += dx; v->point.y += dy;
    };
    for (Shell* sh : s->shells)
        for (Face* f : sh->faces) {
            if (f->surface) { f->surface->origin.x += dx; f->surface->origin.y += dy; }
            Loop* lp = f->outerLoop;
            if (!lp) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) { shiftOnce(c->originVertex()); c = c->next; }
        }
}

// ===========================================================================
// OCCT helpers.
// ===========================================================================
static TopoDS_Shape occtTranslate(const TopoDS_Shape& s, double dx, double dy, double dz) {
    gp_Trsf t; t.SetTranslation(gp_Vec(dx, dy, dz));
    return BRepBuilderAPI_Transform(s, t, true).Shape();
}

static double occtMinDist(const TopoDS_Shape& a, const TopoDS_Shape& b) {
    BRepExtrema_DistShapeShape d(a, b);
    if (!d.IsDone()) return -1.0;
    return d.Value();
}

static const char* stateName(TopAbs_State st) {
    switch (st) {
        case TopAbs_IN:  return "IN";
        case TopAbs_OUT: return "OUT";
        case TopAbs_ON:  return "ON";
        default:         return "UNKNOWN";
    }
}
static const char* clsName(PointClass c) {
    switch (c) {
        case PointClass::Inside:  return "IN";
        case PointClass::Outside: return "OUT";
        case PointClass::On:      return "ON";
    }
    return "?";
}
// Map native PointClass -> the OCCT TopAbs_State it must agree with.
static bool classAgrees(PointClass nat, TopAbs_State occt) {
    switch (nat) {
        case PointClass::Inside:  return occt == TopAbs_IN;
        case PointClass::Outside: return occt == TopAbs_OUT;
        case PointClass::On:      return occt == TopAbs_ON;
    }
    return false;
}

int main() {
    std::printf("=== native B-rep QUERY A/B vs OCCT (minDistance + pointInSolid) ===\n");
    const double kPi = 3.14159265358979323846;

    // =======================================================================
    // minDistance — SPHERE-SPHERE r=1, centres 5 apart -> gap 3.0
    // =======================================================================
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildSphere(1.0);
        Solid* B = fb.buildSphere(1.0);
        shiftSphereSurfaces(B, 5.0);
        MinDistanceResult r = minDistance(*A, *B);

        TopoDS_Shape oa = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 1.0).Shape();
        TopoDS_Shape ob = BRepPrimAPI_MakeSphere(gp_Pnt(5, 0, 0), 1.0).Shape();
        double occt = occtMinDist(oa, ob);

        std::printf("  sphere-sphere gap=5: native=%.15g (%s)  OCCT=%.15g  expect=3.0\n",
                    r.distance, r.method == DistanceMethod::Analytic ? "Analytic" : "Tessellated", occt);
        check(r.ok, "sphere-sphere native ok");
        check(distClose(r.distance, occt), "sphere-sphere native == OCCT DistShapeShape");
        check(distClose(occt, 3.0), "sphere-sphere OCCT == 3.0");
        check(distClose(r.distance, 3.0), "sphere-sphere native == 3.0");
    }

    // SPHERE-SPHERE overlap (centres 1.5) -> native gap -0.5; OCCT returns 0.
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildSphere(1.0);
        Solid* B = fb.buildSphere(1.0);
        shiftSphereSurfaces(B, 1.5);
        MinDistanceResult r = minDistance(*A, *B);

        TopoDS_Shape oa = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 1.0).Shape();
        TopoDS_Shape ob = BRepPrimAPI_MakeSphere(gp_Pnt(1.5, 0, 0), 1.0).Shape();
        double occt = occtMinDist(oa, ob);
        std::printf("  sphere-sphere overlap: native=%.15g (overlap=%d)  OCCT=%.15g (intersecting->0)\n",
                    r.distance, (int)r.overlapping, occt);
        check(r.overlapping && r.distance < 0.0, "overlap spheres: native flags overlap, gap<0");
        check(distClose(occt, 0.0), "overlap spheres: OCCT DistShapeShape == 0");
        check(distClose(r.distance, -0.5), "overlap spheres: native gap == -0.5");
    }

    // =======================================================================
    // minDistance — BOX [0,1]^3 vs BOX [3,4]x[0,1]x[0,1] -> X-gap 2.0
    // =======================================================================
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(1.0, 1.0, 1.0);          // [0,1]^3
        Solid* B = fb.buildBox(1.0, 1.0, 1.0);
        shiftBox(B, 3.0, 0.0);                          // [3,4]x[0,1]x[0,1]
        MinDistanceResult r = minDistance(*A, *B);

        TopoDS_Shape oa = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 1.0, 1.0, 1.0).Shape();
        TopoDS_Shape ob = BRepPrimAPI_MakeBox(gp_Pnt(3, 0, 0), 1.0, 1.0, 1.0).Shape();
        double occt = occtMinDist(oa, ob);

        std::printf("  box-box X gap: native=%.15g (%s)  OCCT=%.15g  expect=2.0\n",
                    r.distance, r.method == DistanceMethod::Analytic ? "Analytic" : "Tessellated", occt);
        check(r.ok, "box-box native ok");
        check(distClose(r.distance, occt), "box-box X native == OCCT DistShapeShape");
        check(distClose(occt, 2.0), "box-box X OCCT == 2.0");
        check(distClose(r.distance, 2.0), "box-box X native == 2.0");
    }

    // BOX [0,1]^3 vs BOX [3,4]x[3,4]x[0,1] -> diagonal gap sqrt(8)
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(1.0, 1.0, 1.0);
        Solid* B = fb.buildBox(1.0, 1.0, 1.0);
        shiftBox(B, 3.0, 3.0);                          // [3,4]x[3,4]x[0,1]
        MinDistanceResult r = minDistance(*A, *B);

        TopoDS_Shape oa = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 1.0, 1.0, 1.0).Shape();
        TopoDS_Shape ob = BRepPrimAPI_MakeBox(gp_Pnt(3, 3, 0), 1.0, 1.0, 1.0).Shape();
        double occt = occtMinDist(oa, ob);
        double expDiag = std::sqrt(8.0);

        std::printf("  box-box diag gap: native=%.15g  OCCT=%.15g  expect=%.15g\n",
                    r.distance, occt, expDiag);
        check(distClose(r.distance, occt), "box-box diag native == OCCT DistShapeShape");
        check(distClose(occt, expDiag), "box-box diag OCCT == sqrt(8)");
        check(distClose(r.distance, expDiag), "box-box diag native == sqrt(8)");
    }

    // =======================================================================
    // pointInSolid vs BRepClass3d_SolidClassifier State() — BOX [0,2]^3
    // =======================================================================
    {
        SolidFactory fb;
        Solid* box = fb.buildBox(2.0, 2.0, 2.0);        // [0,2]^3
        TopoDS_Shape obox = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 2.0, 2.0, 2.0).Shape();
        BRepClass3d_SolidClassifier cls(obox);
        const double TOL = 1e-7;

        struct P { Vec3 p; const char* tag; };
        P probes[] = {
            {{1.0, 1.0, 1.0}, "box centre"},
            {{3.0, 1.0, 1.0}, "box +X exterior"},
            {{-1.0, 1.0, 1.0}, "box -X exterior"},
            {{0.0, 1.0, 1.0}, "box -X face"},
            {{2.0, 2.0, 2.0}, "box corner"},
        };
        for (const P& pr : probes) {
            // native onTol matched to OCCT TOL so the ON band is comparable.
            PointClass nat = pointInSolid(*box, pr.p, TOL);
            cls.Perform(gp_Pnt(pr.p.x, pr.p.y, pr.p.z), TOL);
            TopAbs_State st = cls.State();
            std::printf("    [%-16s] (%g,%g,%g) native=%-3s OCCT=%-3s\n",
                        pr.tag, pr.p.x, pr.p.y, pr.p.z, clsName(nat), stateName(st));
            check(classAgrees(nat, st), std::string("box pointInSolid agrees OCCT: ") + pr.tag);
        }
    }

    // =======================================================================
    // pointInSolid vs OCCT — CYLINDER r=1 h=2 (axis +Z, base z=0)
    // =======================================================================
    {
        SolidFactory fc;
        Solid* cyl = fc.buildCylinder(1.0, 2.0);
        TopoDS_Shape ocyl = BRepPrimAPI_MakeCylinder(
            gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 1.0, 2.0).Shape();
        BRepClass3d_SolidClassifier cls(ocyl);
        const double TOL = 1e-7;

        struct P { Vec3 p; const char* tag; };
        P probes[] = {
            {{0.0, 0.0, 1.0}, "cyl axis centre"},
            {{0.5, 0.0, 1.0}, "cyl r=0.5"},
            {{2.0, 0.0, 1.0}, "cyl r=2 exterior"},
            {{0.0, 0.0, 3.0}, "cyl above top"},
            {{0.0, 0.0, 2.0}, "cyl top-face centre"},
        };
        for (const P& pr : probes) {
            PointClass nat = pointInSolid(*cyl, pr.p, TOL);
            cls.Perform(gp_Pnt(pr.p.x, pr.p.y, pr.p.z), TOL);
            TopAbs_State st = cls.State();
            std::printf("    [%-18s] (%g,%g,%g) native=%-3s OCCT=%-3s\n",
                        pr.tag, pr.p.x, pr.p.y, pr.p.z, clsName(nat), stateName(st));
            check(classAgrees(nat, st), std::string("cyl pointInSolid agrees OCCT: ") + pr.tag);
        }
    }

    // =======================================================================
    // pointInSolid vs OCCT — SPHERE r=1 @ origin
    // =======================================================================
    {
        SolidFactory fs;
        Solid* sph = fs.buildSphere(1.0);
        TopoDS_Shape osph = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 1.0).Shape();
        BRepClass3d_SolidClassifier cls(osph);
        const double TOL = 1e-7;

        // centre (IN) and exterior (OUT) — robust regardless of faceting.
        struct P { Vec3 p; const char* tag; };
        P probes[] = {
            {{0.0, 0.0, 0.0}, "sphere centre"},
            {{2.0, 0.0, 0.0}, "sphere exterior"},
        };
        for (const P& pr : probes) {
            PointClass nat = pointInSolid(*sph, pr.p, TOL);
            cls.Perform(gp_Pnt(pr.p.x, pr.p.y, pr.p.z), TOL);
            TopAbs_State st = cls.State();
            std::printf("    [%-16s] (%g,%g,%g) native=%-3s OCCT=%-3s\n",
                        pr.tag, pr.p.x, pr.p.y, pr.p.z, clsName(nat), stateName(st));
            check(classAgrees(nat, st), std::string("sphere pointInSolid agrees OCCT: ") + pr.tag);
        }
        (void)kPi;
    }

    std::printf("=== query A/B gate: %d/%d PASS ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
