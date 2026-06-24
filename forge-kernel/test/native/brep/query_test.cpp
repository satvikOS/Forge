// forge/native/brep/query_test.cpp
//
// Native gate for the in-house B-rep geometric QUERIES (Query.hpp): minimum
// distance / clearance between two solids, and point-in-solid classification.
//
// Mirrors the OCCT A/B oracle the parent verifies at the train pause:
//   * minDistance  vs  BRepExtrema_DistShapeShape(shapeA, shapeB).Value()
//   * pointInSolid  vs  BRepClass3d_SolidClassifier(solid).Perform(pnt,tol).State()
//
// Pure C++20, no external deps, no test framework. Compiled standalone with ONE
// clang++ (NO run_native.sh / NO cmake-js) — see the report for the exact line.

#include <algorithm>
#include "forge/native/brep/Query.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Surface.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool absClose(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol;
}
static const char* clsName(PointClass c) {
    switch (c) {
        case PointClass::Inside:  return "INSIDE";
        case PointClass::Outside: return "OUTSIDE";
        case PointClass::On:      return "ON";
    }
    return "?";
}

int main() {
    std::printf("=== native B-rep query gate (minDistance + pointInSolid) ===\n");

    // -----------------------------------------------------------------------
    // (1) TWO SPHERES r=1, centres 5 apart -> gap == 3.0 EXACT.
    // Build sphere A at origin, sphere B translated +5 along X by re-centring its
    // faces. SolidFactory builds at the origin, so we build a second factory and
    // shift its sphere surfaces + vertices by +5X.
    // -----------------------------------------------------------------------
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildSphere(1.0);
        Solid* B = fb.buildSphere(1.0);
        // Translate sphere B by +5 along X. The sphere-sphere closed form reads
        // ONLY surface->origin + r1 (recogniseSphere). buildSphere attaches ONE
        // shared Surface object to every face, so shift each unique Surface
        // pointer EXACTLY ONCE (pointer-dedup) or it would translate many times.
        const double SHIFT = 5.0;
        std::vector<Surface*> shifted;
        auto shiftSurfX = [&](Surface* s, double dx) {
            for (Surface* p : shifted) if (p == s) return;
            shifted.push_back(s);
            s->origin.x += dx;
        };
        for (Shell* sh : B->shells)
            for (Face* f : sh->faces)
                if (f->surface) shiftSurfX(f->surface, SHIFT);

        MinDistanceResult r = minDistance(*A, *B);
        std::printf("    sphere-sphere: method=%s gap=%.15g (expect 3.0)  reason=%s\n",
                    r.method == DistanceMethod::Analytic ? "Analytic" : "Tessellated",
                    r.distance, r.reason);
        check(r.ok, "sphere-sphere ok");
        check(r.method == DistanceMethod::Analytic, "sphere-sphere used closed form");
        check(absClose(r.distance, 3.0, 1e-12), "sphere-sphere gap == 3.0 exact");
        check(!r.overlapping, "sphere-sphere not overlapping");
        // Closest points: A surface point at (1,0,0), B surface point at (4,0,0).
        check(absClose(r.pointA.x, 1.0, 1e-9) && absClose(r.pointB.x, 4.0, 1e-9),
              "sphere-sphere closest points at (1,0,0)/(4,0,0)");
    }

    // -----------------------------------------------------------------------
    // (1b) TWO OVERLAPPING SPHERES r=1, centres 1.5 apart -> gap == -0.5.
    // -----------------------------------------------------------------------
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildSphere(1.0);
        Solid* B = fb.buildSphere(1.0);
        const double SHIFT = 1.5;
        std::vector<Surface*> shifted;
        for (Shell* sh : B->shells)
            for (Face* f : sh->faces)
                if (f->surface) {
                    Surface* s = f->surface;
                    bool seen = false;
                    for (Surface* p : shifted) if (p == s) { seen = true; break; }
                    if (!seen) { shifted.push_back(s); s->origin.x += SHIFT; }
                }
        MinDistanceResult r = minDistance(*A, *B);
        std::printf("    sphere-sphere (overlap): gap=%.15g (expect -0.5)\n", r.distance);
        check(absClose(r.distance, -0.5, 1e-12), "overlapping spheres gap == -0.5");
        check(r.overlapping, "overlapping spheres flagged overlapping");
    }

    // -----------------------------------------------------------------------
    // (2) TWO AXIS-ALIGNED BOXES, known gap.
    // Box A = [0,1]^3. Box B = [3,4]x[0,1]x[0,1]  -> X-gap = 3-1 = 2.0.
    // Box C = [3,4]x[3,4]x[0,1]                   -> gap = sqrt(2^2+2^2) = 2.828...
    // -----------------------------------------------------------------------
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(1.0, 1.0, 1.0);            // [0,1]^3
        Solid* B = fb.buildBox(1.0, 1.0, 1.0);
        // Shift B to [3,4]x[0,1]x[0,1]. The box recogniser reads the TESSELLATED
        // AABB (built from the welded boundary VERTICES), so we translate each
        // unique vertex exactly once (pointer-dedup) AND the planar face origins.
        const double SX = 3.0;
        std::vector<Vertex*> seen;
        auto shiftOnce = [&](Vertex* v) {
            for (Vertex* s : seen) if (s == v) return;
            seen.push_back(v);
            v->point.x += SX;
        };
        for (Shell* sh : B->shells)
            for (Face* f : sh->faces) {
                if (f->surface) f->surface->origin.x += SX;
                Loop* lp = f->outerLoop;
                if (!lp) continue;
                Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount; ++i) { shiftOnce(c->originVertex()); c = c->next; }
            }
        MinDistanceResult r = minDistance(*A, *B);
        std::printf("    box-box (X): method=%s gap=%.15g (expect 2.0) reason=%s\n",
                    r.method == DistanceMethod::Analytic ? "Analytic" : "Tessellated",
                    r.distance, r.reason);
        check(r.ok, "box-box ok");
        check(r.method == DistanceMethod::Analytic, "box-box used closed form");
        check(absClose(r.distance, 2.0, 1e-12), "box-box X-gap == 2.0 exact");
        check(!r.overlapping, "box-box not overlapping");
    }

    // Diagonal box gap: A=[0,1]^3, B=[3,4]x[3,4]x[0,1] -> sqrt(8) ~ 2.8284271.
    {
        SolidFactory fa, fb;
        Solid* A = fa.buildBox(1.0, 1.0, 1.0);
        Solid* B = fb.buildBox(1.0, 1.0, 1.0);
        const double SX = 3.0, SY = 3.0;
        std::vector<Vertex*> seen;
        auto shiftOnce = [&](Vertex* v) {
            for (Vertex* s : seen) if (s == v) return;
            seen.push_back(v);
            v->point.x += SX; v->point.y += SY;
        };
        for (Shell* sh : B->shells)
            for (Face* f : sh->faces) {
                if (f->surface) { f->surface->origin.x += SX; f->surface->origin.y += SY; }
                Loop* lp = f->outerLoop;
                if (!lp) continue;
                Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount; ++i) { shiftOnce(c->originVertex()); c = c->next; }
            }
        MinDistanceResult r = minDistance(*A, *B);
        double expDiag = std::sqrt(8.0);
        std::printf("    box-box (diag): gap=%.15g (expect %.15g)\n", r.distance, expDiag);
        check(absClose(r.distance, expDiag, 1e-12), "box-box diagonal gap == sqrt(8)");
    }

    // -----------------------------------------------------------------------
    // (3) POINT-IN-SOLID for a BOX [0,2]^3.
    // -----------------------------------------------------------------------
    {
        SolidFactory fb;
        Solid* box = fb.buildBox(2.0, 2.0, 2.0);  // [0,2]^3
        PointClass inC  = pointInSolid(*box, Vec3{1.0, 1.0, 1.0});   // centre -> INSIDE
        PointClass outC = pointInSolid(*box, Vec3{3.0, 1.0, 1.0});   // +X out -> OUTSIDE
        PointClass out2 = pointInSolid(*box, Vec3{-1.0, 1.0, 1.0});  // -X out -> OUTSIDE
        PointClass onC  = pointInSolid(*box, Vec3{0.0, 1.0, 1.0});   // on -X face -> ON
        PointClass onCorner = pointInSolid(*box, Vec3{2.0, 2.0, 2.0}); // corner -> ON
        std::printf("    box[0,2]^3: centre=%s  +Xout=%s  -Xout=%s  face=%s  corner=%s\n",
                    clsName(inC), clsName(outC), clsName(out2), clsName(onC), clsName(onCorner));
        check(inC  == PointClass::Inside,  "box centre -> INSIDE");
        check(outC == PointClass::Outside, "box +X exterior -> OUTSIDE");
        check(out2 == PointClass::Outside, "box -X exterior -> OUTSIDE");
        check(onC  == PointClass::On,      "box face point -> ON");
        check(onCorner == PointClass::On,  "box corner -> ON");
    }

    // -----------------------------------------------------------------------
    // (3b) POINT-IN-SOLID for a CYLINDER r=1, h=2 (axis +Z, base z=0).
    // -----------------------------------------------------------------------
    {
        SolidFactory fc;
        Solid* cyl = fc.buildCylinder(1.0, 2.0);
        PointClass inC   = pointInSolid(*cyl, Vec3{0.0, 0.0, 1.0});    // axis centre -> INSIDE
        PointClass inOff = pointInSolid(*cyl, Vec3{0.5, 0.0, 1.0});    // r=0.5 -> INSIDE
        PointClass outR  = pointInSolid(*cyl, Vec3{2.0, 0.0, 1.0});    // r=2 -> OUTSIDE
        PointClass outZ  = pointInSolid(*cyl, Vec3{0.0, 0.0, 3.0});    // above top -> OUTSIDE
        PointClass onTop = pointInSolid(*cyl, Vec3{0.0, 0.0, 2.0});    // top-face centre -> ON
        std::printf("    cyl r1 h2: axis=%s off=%s outR=%s outZ=%s top=%s\n",
                    clsName(inC), clsName(inOff), clsName(outR), clsName(outZ), clsName(onTop));
        check(inC   == PointClass::Inside,  "cylinder axis centre -> INSIDE");
        check(inOff == PointClass::Inside,  "cylinder r=0.5 -> INSIDE");
        check(outR  == PointClass::Outside, "cylinder r=2 -> OUTSIDE");
        check(outZ  == PointClass::Outside, "cylinder above top -> OUTSIDE");
        check(onTop == PointClass::On,      "cylinder top-face centre -> ON");
    }

    // -----------------------------------------------------------------------
    // (3c) POINT AT THE CENTRE OF A SPHERE r=1 -> INSIDE.
    // -----------------------------------------------------------------------
    {
        SolidFactory fs;
        Solid* sph = fs.buildSphere(1.0);   // centred at origin
        PointClass centre  = pointInSolid(*sph, Vec3{0.0, 0.0, 0.0});  // -> INSIDE
        PointClass outside = pointInSolid(*sph, Vec3{2.0, 0.0, 0.0});  // -> OUTSIDE
        PointClass onSurf  = pointInSolid(*sph, Vec3{1.0, 0.0, 0.0}, 1e-3); // ~ON (faceted)
        std::printf("    sphere r1: centre=%s  outside=%s  surface(tol1e-3)=%s\n",
                    clsName(centre), clsName(outside), clsName(onSurf));
        check(centre  == PointClass::Inside,  "sphere centre -> INSIDE");
        check(outside == PointClass::Outside, "sphere exterior -> OUTSIDE");
    }

    std::printf("=== query gate: %d/%d PASS ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
