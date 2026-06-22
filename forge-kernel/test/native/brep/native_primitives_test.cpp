// forge/native/brep/native_primitives_test.cpp
//
// Native gate for IN-HOUSE KERNEL STEP 1: the OCCT-free primitive B-rep SOLIDS
// + exact mass-properties + watertight tessellation. Auto-discovered by
// test/native/run_native.sh (the `brep` class), so it runs with the full native
// suite and needs no CMake/script edit.
//
// For each canonical primitive this asserts, with the live OCCT path untouched:
//   (a) the native B-rep volume / COM / inertia match the ANALYTIC closed form
//       (which equals the OCCT GProp numbers from src/Primitives.cpp +
//        src/MassProps.cpp for the SAME placement) to <1e-6 for analytic faces,
//        <0.5% for the NURBS-skinned ellipsoid;
//   (b) Euler-Poincare V-E+F == 2-2*genus (torus genus 1 => 0) and the closed
//       2-manifold structural invariants;
//   (c) watertight tessellation: the solid triangulates into a mesh that is a
//       closed 2-manifold (every edge shared by exactly 2 triangles) and whose
//       signed volume matches the analytic volume;
//   (d) dimension-change sensitivity (volume scales with the right power).
//
// Pure C++20, no external deps, no test framework.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
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
static bool absClose(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol;
}

constexpr double PI = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Euler + manifold check on a SolidFactory (its builder owns the topology).
// expectedChi = 2 - 2*genus.
// ---------------------------------------------------------------------------
static void checkEuler(SolidFactory& fac, const std::string& tag, long long expectedChi) {
    auto& tb = fac.builder();
    EulerCounts c = tb.counts();
    std::printf("      [%s] V=%zu E=%zu F=%zu L=%zu Sh=%zu  (V-E+F)=%lld (expect %lld)\n",
                tag.c_str(), c.vertices, c.edges, c.faces, c.loops, c.shells,
                c.characteristic(), expectedChi);
    check(c.characteristic() == expectedChi, tag + " Euler-Poincare V-E+F == 2-2g");
    check(tb.isClosedTwoManifold(), tag + " is a closed 2-manifold");
    check(tb.coedgeCount() == 2 * c.edges, tag + " coedge count == 2*E (every edge shared)");
}

// ---------------------------------------------------------------------------
// Watertight tessellation check: build mesh, validate closed 2-manifold, and
// confirm |signedVolume| matches the analytic volume to `volTol` (relative).
// Also explicitly verify every undirected edge is shared by exactly 2 triangles.
// ---------------------------------------------------------------------------
static void checkTessellation(const Solid& solid, const std::string& tag,
                              double analyticVol, double volTol) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx);

    // Manual edge-incidence audit: every undirected edge appears in exactly 2 tris.
    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edgeCount;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        return a < b ? std::make_pair(a, b) : std::make_pair(b, a);
    };
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        std::uint32_t a = idx[t], b = idx[t + 1], c = idx[t + 2];
        edgeCount[key(a, b)]++;
        edgeCount[key(b, c)]++;
        edgeCount[key(c, a)]++;
    }
    bool everyEdgeTwice = !edgeCount.empty();
    for (auto& kv : edgeCount) if (kv.second != 2) everyEdgeTwice = false;
    check(everyEdgeTwice, tag + " watertight: every triangle edge shared by exactly 2 tris");

    forge::native::mesh::HalfEdgeMesh m;
    bool built = m.buildFromSoup(pos, idx);
    check(built, tag + " tessellation builds a half-edge mesh");
    if (built) {
        auto rep = m.validate();
        check(rep.isValid(), tag + " tessellated mesh is closed 2-manifold (validate)");
        double mv = std::fabs(m.signedVolume());
        std::printf("      [%s] tess: %zu verts, %zu tris, meshVol=%.6f analytic=%.6f\n",
                    tag.c_str(), m.vertexCount(), m.faceCount(), mv, analyticVol);
        check(rel(mv, analyticVol, volTol), tag + " tessellated volume ~ analytic volume");
    }
}

// Pretty-print + assert volume/COM/inertia of a MassProps against expected.
static void checkMass(const MassProps& mp, const std::string& tag,
                      double V, double cx, double cy, double cz,
                      double Ixx, double Iyy, double Izz, double tol,
                      bool checkProductsZero = true) {
    std::printf("      [%s] V=%.8f (exp %.8f)  COM=(%.6f,%.6f,%.6f)\n",
                tag.c_str(), mp.volume, V, mp.com[0], mp.com[1], mp.com[2]);
    std::printf("      [%s] Ixx=%.6f Iyy=%.6f Izz=%.6f (exp %.6f %.6f %.6f)\n",
                tag.c_str(), mp.inertiaCom[0], mp.inertiaCom[4], mp.inertiaCom[8],
                Ixx, Iyy, Izz);
    check(rel(mp.volume, V, tol), tag + " volume");
    check(absClose(mp.com[0], cx, tol * std::max(1.0, std::fabs(cx)) + tol) ,
          tag + " COM.x");
    check(absClose(mp.com[1], cy, tol * std::max(1.0, std::fabs(cy)) + tol),
          tag + " COM.y");
    check(absClose(mp.com[2], cz, tol * std::max(1.0, std::fabs(cz)) + tol),
          tag + " COM.z");
    check(rel(mp.inertiaCom[0], Ixx, tol), tag + " Ixx");
    check(rel(mp.inertiaCom[4], Iyy, tol), tag + " Iyy");
    check(rel(mp.inertiaCom[8], Izz, tol), tag + " Izz");
    if (checkProductsZero) {
        double off = tol * std::max({std::fabs(Ixx), std::fabs(Iyy), std::fabs(Izz), 1.0});
        check(std::fabs(mp.inertiaCom[1]) < off, tag + " Ixy ~ 0");
        check(std::fabs(mp.inertiaCom[2]) < off, tag + " Izx ~ 0");
        check(std::fabs(mp.inertiaCom[5]) < off, tag + " Iyz ~ 0");
    }
    // symmetry of the stored matrix.
    check(mp.inertiaCom[1] == mp.inertiaCom[3] &&
          mp.inertiaCom[2] == mp.inertiaCom[6] &&
          mp.inertiaCom[5] == mp.inertiaCom[7], tag + " inertia matrix symmetric");
}

// ===========================================================================
// BOX  a x b x c, corner at origin (OCCT BRepPrimAPI_MakeBox placement).
//   V=abc, COM=(a/2,b/2,c/2), I_com = m/12 diag(b²+c², a²+c², a²+b²).
// ===========================================================================
static void testBox() {
    std::printf("[box] analytic planar solid\n");
    const double a = 3, b = 5, c = 7;
    SolidFactory fac;
    Solid* s = fac.buildBox(a, b, c);
    const double V = a * b * c;
    MassProps mp = massProperties(*s);
    checkMass(mp, "box", V, a / 2, b / 2, c / 2,
              V / 12 * (b * b + c * c), V / 12 * (a * a + c * c),
              V / 12 * (a * a + b * b), 1e-9);
    checkEuler(fac, "box", 2);
    checkTessellation(*s, "box", V, 1e-9);

    // dimension-change sensitivity: doubling a doubles volume.
    SolidFactory fac2;
    Solid* s2 = fac2.buildBox(2 * a, b, c);
    check(rel(massProperties(*s2).volume, 2 * V, 1e-9),
          "box dim-sensitivity: 2a => 2V");
}

// ===========================================================================
// CYLINDER r,h, axis +Z, base z=0.  V=pi r² h, COM=(0,0,h/2),
//   Izz=½ m r², Ixx=Iyy = m/12 (3r²+h²).
// ===========================================================================
static void testCylinder() {
    std::printf("[cylinder] analytic cylinder side + planar caps\n");
    const double r = 2, h = 5;
    SolidFactory fac;
    Solid* s = fac.buildCylinder(r, h);
    const double V = PI * r * r * h;
    MassProps mp = massProperties(*s);
    checkMass(mp, "cylinder", V, 0, 0, h / 2,
              V / 12 * (3 * r * r + h * h), V / 12 * (3 * r * r + h * h),
              0.5 * V * r * r, 1e-6);
    checkEuler(fac, "cylinder", 2);
    checkTessellation(*s, "cylinder", V, 5e-3);

    SolidFactory fac2;
    check(rel(massProperties(*fac2.buildCylinder(2 * r, h)).volume, 4 * V, 1e-6),
          "cylinder dim-sensitivity: 2r => 4V");
}

// ===========================================================================
// CONE (apex)  base r, height h, base z=0, apex z=h.  V=(1/3)pi r² h,
//   COM_z = h/4 (from base), Izz=(3/10) m r²,
//   Ixx=Iyy = m( (3/20) r² + (3/80) h² )  (solid cone about COM).
// ===========================================================================
static void testCone() {
    std::printf("[cone] analytic cone side + planar base\n");
    const double r = 2, h = 6;
    SolidFactory fac;
    Solid* s = fac.buildCone(r, 0.0, h);
    const double V = PI * r * r * h / 3.0;
    const double m = V;
    const double Izz = 3.0 / 10.0 * m * r * r;
    const double Ixx = m * (3.0 / 20.0 * r * r + 3.0 / 80.0 * h * h);
    MassProps mp = massProperties(*s);
    checkMass(mp, "cone", V, 0, 0, h / 4.0, Ixx, Ixx, Izz, 1e-6);
    checkEuler(fac, "cone", 2);
    checkTessellation(*s, "cone", V, 5e-3);

    // frustum cross-check: V = (1/3)pi h (rB²+rB rT+rT²).
    SolidFactory facF;
    const double rB = 3, rT = 1, hF = 4;
    Solid* sf = facF.buildCone(rB, rT, hF);
    const double Vf = PI * hF / 3.0 * (rB * rB + rB * rT + rT * rT);
    check(rel(massProperties(*sf).volume, Vf, 1e-6), "frustum volume closed form");
    checkEuler(facF, "frustum", 2);
}

// ===========================================================================
// SPHERE r, centred origin.  V=4/3 pi r³, COM=0, I=2/5 m r² (isotropic).
// ===========================================================================
static void testSphere() {
    std::printf("[sphere] analytic sphere skin\n");
    const double r = 3;
    SolidFactory fac;
    Solid* s = fac.buildSphere(r);
    const double V = 4.0 / 3.0 * PI * r * r * r;
    const double I = 2.0 / 5.0 * V * r * r;
    MassProps mp = massProperties(*s);
    checkMass(mp, "sphere", V, 0, 0, 0, I, I, I, 1e-6);
    checkEuler(fac, "sphere", 2);
    checkTessellation(*s, "sphere", V, 5e-3);

    SolidFactory fac2;
    check(rel(massProperties(*fac2.buildSphere(2 * r)).volume, 8 * V, 1e-6),
          "sphere dim-sensitivity: 2r => 8V");
}

// ===========================================================================
// TORUS R,r, centred origin, axis +Z. GENUS 1 => chi 0.  V=2 pi² R r²,
//   COM=0; about COM (solid torus, axis Z):
//     Izz = m (R² + ¾ r²) ; Ixx=Iyy = m (½ R² + 5/8 r²).
//   (Standard solid-torus inertia.)
// ===========================================================================
static void testTorus() {
    std::printf("[torus] analytic torus skin (genus 1)\n");
    const double R = 4, r = 1.2;
    SolidFactory fac;
    Solid* s = fac.buildTorus(R, r);
    const double V = 2.0 * PI * PI * R * r * r;
    const double m = V;
    const double Izz = m * (R * R + 0.75 * r * r);
    const double Ixx = m * (0.5 * R * R + 0.625 * r * r);
    MassProps mp = massProperties(*s);
    checkMass(mp, "torus", V, 0, 0, 0, Ixx, Ixx, Izz, 1e-5);
    checkEuler(fac, "torus", 0);  // genus 1
    checkTessellation(*s, "torus", V, 5e-3);
}

// ===========================================================================
// REGULAR PRISM  n,R,h, centred on Z, z in [0,h].  V=½ n R² sin(2π/n) h,
//   COM=(0,0,h/2).
// ===========================================================================
static void testPrism() {
    std::printf("[prism] analytic planar n-gon prism\n");
    const int n = 6;
    const double R = 2, h = 5;
    SolidFactory fac;
    Solid* s = fac.buildPrism(n, R, h);
    const double V = 0.5 * n * R * R * std::sin(2 * PI / n) * h;
    MassProps mp = massProperties(*s);
    std::printf("      [prism] V=%.8f (exp %.8f) COM=(%.6f,%.6f,%.6f)\n",
                mp.volume, V, mp.com[0], mp.com[1], mp.com[2]);
    check(rel(mp.volume, V, 1e-9), "prism volume closed form");
    check(absClose(mp.com[0], 0, 1e-9) && absClose(mp.com[1], 0, 1e-9) &&
          absClose(mp.com[2], h / 2, 1e-9), "prism COM = (0,0,h/2)");
    checkEuler(fac, "prism", 2);
    checkTessellation(*s, "prism", V, 1e-9);
}

// ===========================================================================
// WEDGE  dx,dy,dz,ltx, min corner at origin.  V=½(dx+ltx) dz dy (OCCT MakeWedge).
// ===========================================================================
static void testWedge() {
    std::printf("[wedge] analytic planar wedge\n");
    const double dx = 4, dy = 3, dz = 2, ltx = 1;
    SolidFactory fac;
    Solid* s = fac.buildWedge(dx, dy, dz, ltx);
    const double V = 0.5 * (dx + ltx) * dz * dy;
    MassProps mp = massProperties(*s);
    std::printf("      [wedge] V=%.8f (exp %.8f)\n", mp.volume, V);
    check(rel(mp.volume, V, 1e-9), "wedge volume closed form");
    checkEuler(fac, "wedge", 2);
    checkTessellation(*s, "wedge", V, 1e-9);
}

// ===========================================================================
// PYRAMID  dx,dy,h, base centred origin z=0, apex z=h.  V=(1/3) dx dy h,
//   COM_z = h/4.
// ===========================================================================
static void testPyramid() {
    std::printf("[pyramid] analytic planar pyramid\n");
    const double dx = 4, dy = 3, h = 6;
    SolidFactory fac;
    Solid* s = fac.buildPyramid(dx, dy, h);
    const double V = dx * dy * h / 3.0;
    MassProps mp = massProperties(*s);
    std::printf("      [pyramid] V=%.8f (exp %.8f) COM=(%.6f,%.6f,%.6f)\n",
                mp.volume, V, mp.com[0], mp.com[1], mp.com[2]);
    check(rel(mp.volume, V, 1e-9), "pyramid volume closed form");
    check(absClose(mp.com[0], 0, 1e-9) && absClose(mp.com[1], 0, 1e-9) &&
          absClose(mp.com[2], h / 4, 1e-9), "pyramid COM = (0,0,h/4)");
    checkEuler(fac, "pyramid", 2);
    checkTessellation(*s, "pyramid", V, 1e-9);
}

// ===========================================================================
// TUBE  rO,rI,h, axis +Z, z in [0,h].  V=pi(rO²-rI²)h, COM=(0,0,h/2),
//   Izz=½ m (rO²+rI²); Ixx=Iyy = m/12 (3(rO²+rI²) + h²).
// ===========================================================================
static void testTube() {
    std::printf("[tube] analytic hollow cylinder (genus 0, two shells via inner skin)\n");
    const double rO = 3, rI = 2, h = 5;
    SolidFactory fac;
    Solid* s = fac.buildTube(rO, rI, h);
    const double V = PI * (rO * rO - rI * rI) * h;
    const double m = V;
    const double Izz = 0.5 * m * (rO * rO + rI * rI);
    const double Ixx = m / 12.0 * (3 * (rO * rO + rI * rI) + h * h);
    MassProps mp = massProperties(*s);
    checkMass(mp, "tube", V, 0, 0, h / 2, Ixx, Ixx, Izz, 1e-6);
    // A solid hollow tube has a through-hole => genus 1 => chi = 0.
    checkEuler(fac, "tube", 0);
    checkTessellation(*s, "tube", V, 5e-3);
}

// ===========================================================================
// ELLIPSOID  rx,ry,rz, centred origin (NURBS/faceted skin).  V=4/3 pi rx ry rz,
//   COM=0; I = m/5 diag(ry²+rz², rx²+rz², rx²+ry²).  (NURBS-tessellated => 0.5%.)
// ===========================================================================
static void testEllipsoid() {
    std::printf("[ellipsoid] faceted/NURBS skin (0.5%% tolerance)\n");
    const double rx = 3, ry = 2, rz = 1.5;
    SolidFactory fac;
    Solid* s = fac.buildEllipsoid(rx, ry, rz);
    const double V = 4.0 / 3.0 * PI * rx * ry * rz;
    const double m = V;
    const double Ixx = m / 5.0 * (ry * ry + rz * rz);
    const double Iyy = m / 5.0 * (rx * rx + rz * rz);
    const double Izz = m / 5.0 * (rx * rx + ry * ry);
    MassProps mp = massProperties(*s);
    // Faceted planar skin under-estimates a convex body; 0.5% tol per the spec.
    checkMass(mp, "ellipsoid", V, 0, 0, 0, Ixx, Iyy, Izz, 5e-3);
    checkEuler(fac, "ellipsoid", 2);
    checkTessellation(*s, "ellipsoid", V, 5e-3);
}

int main() {
    std::printf("=== forge::native::brep — NATIVE PRIMITIVE B-rep + mass-props + tessellation gate ===\n");
    testBox();
    testCylinder();
    testCone();
    testSphere();
    testTorus();
    testPrism();
    testWedge();
    testPyramid();
    testTube();
    testEllipsoid();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
