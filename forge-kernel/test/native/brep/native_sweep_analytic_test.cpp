// forge/native/brep/native_sweep_analytic_test.cpp
//
// Native gate for the ANALYTIC SWEPT SOLIDS — the OCCT-free replacements for
// BRepPrimAPI_MakePrism (linear extrude) and BRepPrimAPI_MakeRevol (rotational
// sweep): SolidFactory::buildPrismFromProfile / buildRevolveProfile. Each returns
// a REAL analytic brep::Solid (Plane/Cylinder/Cone faces), NOT a mesh.
//
// This is the A/B gate: for the SAME profile + parameters, the native analytic
// mass properties are compared against the CLOSED FORM, which is EXACTLY the OCCT
// GProp volume for that MakePrism/MakeRevol placement (see test/ab_native_sweep_occt.cpp
// for the live-OCCT confirmation that the closed form == BRepPrimAPI + BRepGProp).
//
// For each case this asserts:
//   (a) native massProperties().volume == closed form to <1e-9 relative
//       (analytic; a NON-CONVEX L-profile prism integrates EXACTLY via Green's
//        theorem, which a fan tessellation could not);
//   (b) Euler-Poincare V-E+F == 2-2*genus and the closed-2-manifold invariants;
//   (c) watertight tessellation (closed 2-manifold triangle soup);
//   (d) planar-only PRISMs match the OCCT analytic FACE COUNT exactly
//       (n edges -> n side faces + 2 caps); revolves are faceted (over exact
//        analytic geometry) so only volume/Euler/watertight are gated there.
//
// Auto-discovered by test/native/run_native.sh (the `brep` class). Pure C++20,
// no external deps, no test framework.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
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

constexpr double PI = 3.14159265358979323846;

// Signed area of a 2D loop (shoelace).
static double loopArea(const std::vector<std::array<double, 2>>& p) {
    double a = 0.0;
    for (std::size_t i = 0; i < p.size(); ++i) {
        const auto& u = p[i];
        const auto& v = p[(i + 1) % p.size()];
        a += u[0] * v[1] - v[0] * u[1];
    }
    return 0.5 * a;
}

// Euler + closed-2-manifold structural checks.
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

// Watertight tessellation. The UNDIRECTED "every triangle edge shared by exactly
// 2 tris" check (no boundary edge => closed surface) is asserted for ALL solids.
// `halfEdge` additionally asserts the stricter half-edge weld builds + validates +
// (when `checkVol`) matches the analytic volume.
//
// These two were previously turned OFF for the NON-CONVEX L cap, with a comment
// blaming an inherent limitation: "a fan of a reflex polygon self-overlaps at the
// notch, so the DISPLAY soup is not orientable-weldable (a pre-existing display-mesh
// limitation)". That diagnosis was wrong, and the waiver hid a real defect for as
// long as it stood. A fan self-overlaps GEOMETRICALLY but is exact as a 2-chain: the
// diagonals (0,t) cancel in pairs, so its boundary is the loop and the welded soup IS
// orientable — as long as the triangles keep the loop's winding. What made it
// non-weldable was tessellateSolid re-winding each fan triangle individually against
// the surface normal; that is fixed, and a reflex cap now welds and integrates to the
// EXACT analytic volume. Both flags are on for every case here.
// The property has its own dedicated gate in brep/tessellate_closure_test.cpp.
static void checkTess(const Solid& solid, const std::string& tag,
                      double analyticVol, bool halfEdge, bool checkVol, double volTol) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    tessellateSolid(solid, pos, idx);

    std::map<std::pair<std::uint32_t, std::uint32_t>, int> edgeCount;
    auto key = [](std::uint32_t a, std::uint32_t b) {
        return a < b ? std::make_pair(a, b) : std::make_pair(b, a);
    };
    for (std::size_t t = 0; t + 2 < idx.size(); t += 3) {
        edgeCount[key(idx[t], idx[t + 1])]++;
        edgeCount[key(idx[t + 1], idx[t + 2])]++;
        edgeCount[key(idx[t + 2], idx[t])]++;
    }
    bool everyEdgeTwice = !edgeCount.empty();
    for (auto& kv : edgeCount) if (kv.second != 2) everyEdgeTwice = false;
    check(everyEdgeTwice, tag + " watertight: every triangle edge shared by exactly 2 tris");

    if (!halfEdge) return;

    forge::native::mesh::HalfEdgeMesh m;
    bool built = m.buildFromSoup(pos, idx);
    check(built, tag + " tessellation builds a half-edge mesh");
    if (built) {
        auto rep = m.validate();
        check(rep.isValid(), tag + " tessellated mesh is closed 2-manifold");
        if (checkVol) {
            double mv = std::fabs(m.signedVolume());
            std::printf("      [%s] tess vol=%.6f analytic=%.6f\n", tag.c_str(), mv, analyticVol);
            check(rel(mv, analyticVol, volTol), tag + " tessellated volume ~ analytic volume");
        }
    }
}

int main() {
    std::printf("== native analytic swept-solid A/B gate (prism + revolve vs OCCT closed form) ==\n");

    // ---------------------------------------------------------------- PRISM 1:
    // rectangle 2 x 3 extruded +Z by 5  ==  OCCT MakePrism  ==  box  V = 30.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rect = {{0, 0}, {2, 0}, {2, 3}, {0, 3}};
        Solid* s = fac.buildPrismFromProfile(rect, 0, 0, 5);
        check(s != nullptr, "prism/rect: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [prism/rect] V=%.9f (exp 30)\n", mp.volume);
            check(rel(mp.volume, 30.0, 1e-9), "prism/rect: volume == 2*3*5 (== OCCT MakePrism)");
            check(fac.builder().faceCount() == 6, "prism/rect: 6 faces (4 side + 2 caps == OCCT box)");
            checkEuler(fac, "prism/rect", 2);
            checkTess(*s, "prism/rect", 30.0, /*halfEdge*/ true, /*checkVol*/ true, 1e-3);
        }
    }

    // ---------------------------------------------------------------- PRISM 2:
    // NON-CONVEX L-profile extruded +Z by 3. Area via shoelace; V = area * 3.
    // OCCT MakePrism of the same L-face gives the same 6 side + 2 cap = 8 faces.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> Lp = {{0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}};
        const double area = std::fabs(loopArea(Lp));           // = 12
        const double expV = area * 3.0;
        Solid* s = fac.buildPrismFromProfile(Lp, 0, 0, 3);
        check(s != nullptr, "prism/L: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [prism/L] area=%.9f  V=%.9f (exp %.9f)\n", area, mp.volume, expV);
            check(rel(mp.volume, expV, 1e-9), "prism/L: analytic volume == area*h (non-convex, EXACT)");
            check(fac.builder().faceCount() == 8, "prism/L: 8 faces (6 side + 2 caps == OCCT)");
            checkEuler(fac, "prism/L", 2);
            // Non-convex cap: an all-planar prism has NO chordal error, so the
            // tessellated volume is the analytic volume EXACTLY (1e-9), not
            // approximately. See the header note on the waiver this replaces.
            checkTess(*s, "prism/L", expV, /*halfEdge*/ true, /*checkVol*/ true, 1e-9);
        }
    }

    // ---------------------------------------------------------------- REVOLVE 1:
    // rectangle (r:0..2, z:0..5) revolved 2*pi  ==  OCCT MakeRevol  ==  cylinder.
    // V = pi r^2 h = pi*4*5.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rz = {{0, 0}, {2, 0}, {2, 5}, {0, 5}};
        const double expV = PI * 2.0 * 2.0 * 5.0;
        Solid* s = fac.buildRevolveProfile(rz, 2.0 * PI);
        check(s != nullptr, "revolve/cyl: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [revolve/cyl] V=%.9f (exp %.9f)\n", mp.volume, expV);
            check(rel(mp.volume, expV, 1e-9), "revolve/cyl: volume == pi*r^2*h (== OCCT MakeRevol)");
            checkEuler(fac, "revolve/cyl", 2);
            checkTess(*s, "revolve/cyl", expV, /*halfEdge*/ true, /*checkVol*/ true, 5e-3);
        }
    }

    // ---------------------------------------------------------------- REVOLVE 2:
    // trapezoid (0,0)-(3,0)-(1,4)-(0,4) revolved 2*pi  ==  cone frustum.
    // V = pi*h/3 (R1^2 + R1 R2 + R2^2), R1=3 (z=0), R2=1 (z=4), h=4.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rz = {{0, 0}, {3, 0}, {1, 4}, {0, 4}};
        const double R1 = 3, R2 = 1, h = 4;
        const double expV = PI * h / 3.0 * (R1 * R1 + R1 * R2 + R2 * R2);
        Solid* s = fac.buildRevolveProfile(rz, 2.0 * PI);
        check(s != nullptr, "revolve/frustum: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [revolve/frustum] V=%.9f (exp %.9f)\n", mp.volume, expV);
            check(rel(mp.volume, expV, 1e-9), "revolve/frustum: volume == cone frustum (== OCCT)");
            checkEuler(fac, "revolve/frustum", 2);
            checkTess(*s, "revolve/frustum", expV, /*halfEdge*/ true, /*checkVol*/ true, 5e-3);
        }
    }

    // ---------------------------------------------------------------- REVOLVE 3:
    // offset rectangle (r:1..3, z:0..4) revolved 2*pi  ==  tube (genus 1, chi 0).
    // V = pi(rO^2 - rI^2) h = pi*(9-1)*4.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rz = {{1, 0}, {3, 0}, {3, 4}, {1, 4}};
        const double expV = PI * (9.0 - 1.0) * 4.0;
        Solid* s = fac.buildRevolveProfile(rz, 2.0 * PI);
        check(s != nullptr, "revolve/tube: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [revolve/tube] V=%.9f (exp %.9f)\n", mp.volume, expV);
            check(rel(mp.volume, expV, 1e-9), "revolve/tube: volume == pi(rO^2-rI^2)h (== OCCT)");
            checkEuler(fac, "revolve/tube", 0);   // capped tube boundary is a torus
            checkTess(*s, "revolve/tube", expV, /*halfEdge*/ true, /*checkVol*/ true, 5e-3);
        }
    }

    // ---------------------------------------------------------------- REVOLVE 4:
    // rectangle (r:0..2, z:0..5) revolved PARTIAL angle 90deg -> pie of a cylinder.
    // Two planar end walls close it. V = (theta/2pi) pi r^2 h = theta r^2 h / 2.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rz = {{0, 0}, {2, 0}, {2, 5}, {0, 5}};
        const double ang = PI / 2.0;
        const double expV = ang * 2.0 * 2.0 * 5.0 / 2.0;
        Solid* s = fac.buildRevolveProfile(rz, ang);
        check(s != nullptr, "revolve/partial: builds");
        if (s) {
            MassProps mp = massProperties(*s);
            std::printf("      [revolve/partial] V=%.9f (exp %.9f)\n", mp.volume, expV);
            check(rel(mp.volume, expV, 1e-9), "revolve/partial: volume == theta*r^2*h/2 (== OCCT)");
            checkEuler(fac, "revolve/partial", 2);
            checkTess(*s, "revolve/partial", expV, /*halfEdge*/ true, /*checkVol*/ true, 5e-3);
        }
    }

    // ---------------------------------------------------------------- DECLINE:
    // honest nullptr on cases the analytic path does not accept.
    {
        SolidFactory fac;
        std::vector<std::array<double, 2>> rect = {{0, 0}, {2, 0}, {2, 3}, {0, 3}};
        check(fac.buildPrismFromProfile(rect, 1, 1, 0) == nullptr,
              "prism: declines a zero-Z (in-plane) extrude vector");
        std::vector<std::array<double, 2>> two = {{0, 0}, {1, 1}};
        check(fac.buildRevolveProfile(two, PI) == nullptr,
              "revolve: declines a < 3-point profile");
    }

    std::printf("== native swept-solid A/B: %d/%d checks passed ==\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
