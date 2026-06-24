// forge/native/brep/pattern_test.cpp
//
// Native gate for the IN-HOUSE ANALYTIC FEATURE PATTERN (Pattern.hpp): linear /
// circular / mirror replication of a rigid tool solid, boolean-merged into ONE
// native brep::Solid. Auto-discovered by test/native/run_native.sh (the `brep`
// class). Pure C++20, no OCCT, no test framework.
//
// VERIFICATION (the feature op every mechanical part uses):
//   * CIRCULAR pattern — a 20x20x2 plate (V=800) drilled with a BOLT CIRCLE of 6
//     holes (cylinder r=1, through the 2mm thickness) on a bolt-circle radius 7
//     centred on the plate. Non-overlapping => the EXACT analytic patterned volume
//     is  800 - 6 * pi * r^2 * t = 800 - 12pi.  Asserted to the boolean's analytic
//     tolerance; the result is a closed 2-manifold every step.
//   * LINEAR pattern — the same plate drilled with a ROW of 4 holes spaced 5mm
//     apart in +X. Non-overlapping => volume = 800 - 4 * pi * r^2 * t = 800 - 8pi.
//   * MIRROR pattern — one hole + its reflection across a plane => 2 holes,
//     volume = 800 - 2 * pi * r^2 * t = 800 - 4pi (sanity that the improper
//     instance is re-oriented to a valid closed 2-manifold cut).
//   Each result is also verified WATERTIGHT (tessellates into a closed 2-manifold
//   half-edge mesh whose signed volume matches) and the bored-hole count is
//   reported (each through-hole contributes ONE cylindrical bore wall = nSeg
//   sectors of one analytic cylinder surface, so #holes = #cyl-wall-sets).

#include <algorithm>
#include "forge/native/brep/Pattern.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <cmath>
#include <cstdint>
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
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
constexpr double PI = 3.14159265358979323846;

static double volOf(const Solid& s) { return massProperties(s).volume; }

// Count the cylindrical bore-wall FACE SETS in a result. The SolidFactory builds a
// cylinder as an equal-radius CONE, so a through-bore wall reports as Cone-kind.
// Each hole = nSeg sectors of one analytic cylinder; we report the raw cyl+cone
// face count and the derived hole count (faceCount / nSeg).
static int curvedFaceCount(const Solid& s) {
    int n = 0;
    for (Shell* sh : s.shells) for (Face* f : sh->faces) {
        if (!f->surface) continue;
        if (f->surface->kind == SurfaceKind::Cylinder ||
            f->surface->kind == SurfaceKind::Cone)
            ++n;
    }
    return n;
}

// Full audit: ok, closed 2-manifold, watertight tess, volume, bore count.
static void audit(const std::string& tag, const BooleanResult& r,
                  double expectVol, double volTol, int nSeg, int expectHoles) {
    check(r.ok, tag + " applyPattern ok (closed 2-manifold, 0 fakes)");
    if (!r.ok) { std::printf("      [%s] reason: %s\n", tag.c_str(), r.reason); return; }

    check(r.owner->isClosedTwoManifold(), tag + " result is a closed 2-manifold (topology)");
    EulerCounts c = r.owner->counts();
    std::printf("      [%s] V=%zu E=%zu F=%zu  fallback=%d  reason=%s\n",
                tag.c_str(), c.vertices, c.edges, c.faces, r.usedMeshFallback, r.reason);

    double v = volOf(*r.solid);
    std::printf("      [%s] vol=%.10f  expect=%.10f  (tol %.3g)\n",
                tag.c_str(), v, expectVol, volTol);
    check(rel(v, expectVol, volTol), tag + " patterned volume = plate - N*pi*r^2*t");

    int cf = curvedFaceCount(*r.solid);
    int holes = (nSeg > 0) ? cf / nSeg : 0;
    std::printf("      [%s] cyl-wall faces=%d  => holes=%d (expect %d)\n",
                tag.c_str(), cf, holes, expectHoles);
    // Analytic-path holes: each bore wall is exactly nSeg sectors of one cylinder.
    // (If the mesh fallback ran, the wall is planar facets and this identity does
    // not hold — we only assert the hole count on the analytic path.)
    if (!r.usedMeshFallback)
        check(holes == expectHoles, tag + " bored-hole count matches the pattern");

    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(*r.solid, pos, idx);
    forge::native::mesh::HalfEdgeMesh m;
    bool built = m.buildFromSoup(pos, idx);
    check(built, tag + " result tessellates into a half-edge mesh");
    if (built) {
        auto rep = m.validate();
        check(rep.isValid(), tag + " tessellated result is closed 2-manifold (validate)");
        double mv = std::fabs(m.signedVolume());
        check(rel(mv, expectVol, volTol), tag + " tessellated result volume matches");
    }
}

// Tool builder: a cylinder r=1, h=4, placed so its base is at z=-1 (it pierces a
// plate of thickness 2 fully) and its axis is at (cx,cy). buildCylinder builds
// axis +Z, base z=0; we offset via the closure so instance 0 lands at (cx,cy).
static ToolBuilder holeAt(double cx, double cy, double r, double zBase, double h) {
    return [=](SolidFactory& f) -> Solid* {
        Solid* cyl = f.buildCylinder(r, h);   // axis +Z, base z=0
        // translate the freshly-built cylinder to (cx,cy,zBase) by mutating its
        // vertices + the side/cap surface origins (same mechanism the boolean gate
        // uses; here done via the public surface frames + vertex points).
        RigidTransform xf; xf.t = Vec3{cx, cy, zBase}; xf.det = 1.0;
        transformSolidInPlace(xf, cyl, f.builder());
        return cyl;
    };
}

// ===========================================================================
// CIRCULAR PATTERN — a bolt circle of 6 holes (r=1) on radius 7, plate 20x20x2.
// ===========================================================================
static void testCircularBoltCircle() {
    std::printf("[circular pattern] bolt circle: 6 holes r=1 on radius 7 (plate 20x20x2)\n");
    const double plateV = 20.0 * 20.0 * 2.0;            // 800
    const double r = 1.0, t = 2.0;
    const int N = 6;
    const double expect = plateV - N * PI * r * r * t;  // 800 - 12pi
    const int nSeg = 128;

    PrimitiveOptions hi; hi.nSeg = nSeg;
    SolidFactory plateFac;
    Solid* plate = plateFac.buildBox(20, 20, 2);

    // first hole on the bolt circle: centre (10+7, 10), pierce z in [-1,3].
    PatternSpec spec;
    spec.kind = PatternKind::Circular;
    spec.count = N;
    spec.axisOrigin = Vec3{10, 10, 0};   // plate centre, axis +Z
    spec.axisDir = Vec3{0, 0, 1};
    spec.angleStep = 2.0 * PI / N;       // 60 deg

    BooleanResult r6 = applyPattern(*plate, holeAt(17.0, 10.0, r, -1.0, 4.0),
                                    spec, BoolOp::Cut, hi);
    audit("circular-6", r6, expect, 5e-3, nSeg, N);
}

// ===========================================================================
// LINEAR PATTERN — a row of 4 holes (r=1) spaced 5mm in +X, plate 20x20x2.
// ===========================================================================
static void testLinearRow() {
    std::printf("[linear pattern] row: 4 holes r=1 spacing 5 (plate 20x20x2)\n");
    const double plateV = 20.0 * 20.0 * 2.0;            // 800
    const double r = 1.0, t = 2.0;
    const int N = 4;
    const double expect = plateV - N * PI * r * r * t;  // 800 - 8pi
    const int nSeg = 128;

    PrimitiveOptions hi; hi.nSeg = nSeg;
    SolidFactory plateFac;
    Solid* plate = plateFac.buildBox(20, 20, 2);

    // holes at x = 2.5, 7.5, 12.5, 17.5 (all inside [0,20], r=1 non-overlapping).
    PatternSpec spec;
    spec.kind = PatternKind::Linear;
    spec.count = N;
    spec.step = Vec3{5, 0, 0};

    BooleanResult r4 = applyPattern(*plate, holeAt(2.5, 10.0, r, -1.0, 4.0),
                                    spec, BoolOp::Cut, hi);
    audit("linear-4", r4, expect, 5e-3, nSeg, N);
}

// ===========================================================================
// MIRROR PATTERN — one hole + its reflection across the plate's mid-plane x=10
// => 2 symmetric holes. Verifies the improper (reflected) instance is re-oriented
// to a valid closed 2-manifold cut.
// ===========================================================================
static void testMirror() {
    std::printf("[mirror pattern] hole + reflection across x=10 (plate 20x20x2)\n");
    const double plateV = 20.0 * 20.0 * 2.0;            // 800
    const double r = 1.0, t = 2.0;
    const double expect = plateV - 2 * PI * r * r * t;  // 800 - 4pi
    const int nSeg = 128;

    PrimitiveOptions hi; hi.nSeg = nSeg;
    SolidFactory plateFac;
    Solid* plate = plateFac.buildBox(20, 20, 2);

    // hole at x=4 (centre y=10); mirror plane x=10 normal +X => reflection at x=16.
    PatternSpec spec;
    spec.kind = PatternKind::Mirror;
    spec.planeOrigin = Vec3{10, 0, 0};
    spec.planeNormal = Vec3{1, 0, 0};

    BooleanResult rm = applyPattern(*plate, holeAt(4.0, 10.0, r, -1.0, 4.0),
                                    spec, BoolOp::Cut, hi);
    audit("mirror-2", rm, expect, 5e-3, nSeg, 2);
}

int main() {
    std::printf("=== forge::native::brep — FEATURE PATTERN (linear/circular/mirror) gate ===\n");
    testCircularBoltCircle();
    testLinearRow();
    testMirror();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
