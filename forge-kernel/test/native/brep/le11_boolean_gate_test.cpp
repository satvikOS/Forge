// forge/native/brep/le11_boolean_gate_test.cpp
//
// T-310 — NAFEMS LE11 geometry through the NATIVE boolean, deterministically, in C++.
//
// NAFEMS LE11 (solid cylinder / taper / sphere, thermal stress) was BLOCKED: building
// its geometry refused with "native analytic/mesh boolean deferred on an all-native
// operand pair" (K2 removed the OCCT BRepAlgoAPI fallback for that class), and the
// JS NAFEMS gate could only report it as BLOCKED. This gate rebuilds the EXACT
// construction of test/fea_nafems_gate.mjs::solveLE11 (read for semantics, not run):
//
//     z1 = sin(pi/4), zTop = z1 + 0.69 + 0.4
//     ballO = sphere(1.4)                 ballI = sphere(1.0)
//     coneO = translate(cone(sqrt(1.4^2 - z1^2), 1.0, 0.69), 0, 0, z1)
//     cylO  = translate(cylinder(1.0, 0.4), 0, 0, z1 + 0.69)
//     cylI  = cylinder(0.7071, 2.2)
//     outer = fuse(fuse(ballO, coneO), cylO)      inner = fuse(ballI, cylI)
//     body  = cut(outer, inner)                    le11  = common(body, box(1.5,1.5,zTop))
//
// with the operands built EXACTLY as the registry builds them (src/Primitives.cpp
// registerNative: a default-option SolidFactory per primitive; src/Transform.cpp
// translate: transformSolid) and combined with the SAME entry the registry calls for a
// NativeSolid x NativeSolid pair (src/Booleans.cpp tryNativeBoolean -> booleanSolid with
// default options). Pure C++20, no OCCT, no JS; auto-discovered by run_native.sh.
//
// ACCEPTANCE (every step, and the final solid):
//   (1) booleanSolid ok, on the ANALYTIC path (usedMeshFallback == false): the mesh
//       fallback is time-budgeted (MeshBooleanExact's 5 s wall clock) and is what this
//       operand class used to fall into and fail;
//   (2) a closed 2-manifold (TopologyBuilder::isClosedTwoManifold, 2E coedges);
//   (3) VOLUME equal to an INDEPENDENT closed form (solids of revolution: spherical
//       caps, frustum, cylinder) to 1e-8 relative;
//   (4) a watertight tessellation (HalfEdgeMesh validate) whose volume agrees with (3)
//       to the faceting chord error;
//   (5) the analytic surface kinds survive (sphere, cone, cylinder walls are not facets);
//   (6) DETERMINISM: the whole chain run twice gives bit-identical volumes and
//       identical face/edge/vertex counts;
//   (7) METAMORPHIC: operand permutation of every fuse leaves every volume unchanged,
//       and a rigid translation commutes with the boolean (f(T(x)) == T(f(x))).
// SSI unit checks: coaxial cone∩sphere / cone∩cylinder / cone∩cone circles lie on BOTH
// surfaces; the non-coaxial and coincident pairs still DEFER (ok=false), never faked.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/SurfaceIntersect.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/NativeRoute.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static double relErr(double got, double exp) {
    return std::fabs(got - exp) / std::max(1e-300, std::fabs(exp));
}
constexpr double kPi = 3.14159265358979323846;

// ---------------------------------------------------------------------------
// Registry-equivalent construction helpers.
// ---------------------------------------------------------------------------
struct H {
    std::shared_ptr<TopologyBuilder> owner;
    Solid* s = nullptr;
};
template <class F> static H prim(F&& fn) {
    auto fac = std::make_shared<SolidFactory>();   // default options == registerNative
    Solid* s = fn(*fac);
    return {std::shared_ptr<TopologyBuilder>(fac, &fac->builder()), s};
}
static H xlate(const H& h, double dx, double dy, double dz) {
    const double R[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    const double t[3] = {dx, dy, dz};
    H o;
    o.s = transformSolid(*h.s, R, t, o.owner);
    return o;
}

struct StepOut {
    H h;
    bool ok = false, mesh = true;
    double vol = 0.0;
    std::size_t V = 0, E = 0, F = 0;
    const char* reason = "";
};
static StepOut runOp(const H& a, const H& b, BoolOp op) {
    StepOut o;
    if (!a.s || !b.s) { o.reason = "missing operand"; return o; }
    BooleanResult r = booleanSolid(*a.s, *b.s, op);
    o.ok = r.ok; o.mesh = r.usedMeshFallback; o.reason = r.reason ? r.reason : "";
    if (!r.ok || !r.solid || !r.owner) return o;
    o.h = {r.owner, r.solid};
    o.vol = massProperties(*r.solid).volume;
    EulerCounts c = r.owner->counts();
    o.V = c.vertices; o.E = c.edges; o.F = c.faces;
    return o;
}

// ---------------------------------------------------------------------------
// Independent closed forms (solids of revolution about z).
// ---------------------------------------------------------------------------
struct Truth { double o1, outer, inner, body, le11; };
static Truth closedForm() {
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4;
    const double R1 = std::sqrt(1.4 * 1.4 - z1 * z1);
    const double zi = std::sqrt(1.0 - 0.7071 * 0.7071);       // inner sphere meets r=0.7071
    const double zc = z1 + 0.69;                                // cone top plane
    auto cap = [](double R, double h) { return kPi * h * h * (3 * R - h) / 3.0; };
    const double frustum = kPi * 0.69 / 3.0 * (R1 * R1 + R1 * 1.0 + 1.0);
    const double ballO = 4.0 / 3.0 * kPi * 1.4 * 1.4 * 1.4;
    Truth t{};
    // ballO ∪ coneO: the cap above z1 is inside the taper except its tip above the
    // cone's top plane (z > zc), which pokes out and stays.
    t.o1 = ballO - cap(1.4, 1.4 - z1) + frustum + cap(1.4, 1.4 - zc);
    t.outer = ballO - cap(1.4, 1.4 - z1) + frustum + kPi * 1.0 * 1.0 * 0.4;
    t.inner = 4.0 / 3.0 * kPi - cap(1.0, 1.0 - zi) + kPi * 0.7071 * 0.7071 * (2.2 - zi);
    t.body = t.outer - (t.inner - kPi * 0.7071 * 0.7071 * (2.2 - zTop));
    // quarter sector, z in [0, zTop]: (pi/4) * integral of (r_out^2 - r_in^2) dz
    auto sph = [](double R, double a, double b) { return R * R * (b - a) - (b * b * b - a * a * a) / 3.0; };
    t.le11 = kPi / 4.0 * (sph(1.4, 0.0, z1) + frustum / kPi + 1.0 * 0.4
                          - sph(1.0, 0.0, zi) - 0.7071 * 0.7071 * (zTop - zi));
    return t;
}

// ---------------------------------------------------------------------------
// The LE11 chain. `off` rigidly translates EVERY operand (metamorphic check);
// `swapFuse` builds every fuse with its operands swapped.
// ---------------------------------------------------------------------------
struct Chain { StepOut o1, outer, inner, body, le11; };
static Chain buildLE11(double ox, double oy, double oz, bool swapFuse) {
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4;
    H ballO = xlate(prim([](SolidFactory& f) { return f.buildSphere(1.4); }), ox, oy, oz);
    H ballI = xlate(prim([](SolidFactory& f) { return f.buildSphere(1.0); }), ox, oy, oz);
    H coneO = xlate(prim([&](SolidFactory& f) {
                        return f.buildCone(std::sqrt(1.4 * 1.4 - z1 * z1), 1.0, 0.69); }),
                    ox, oy, oz + z1);
    H cylO = xlate(prim([](SolidFactory& f) { return f.buildCylinder(1.0, 0.4); }),
                   ox, oy, oz + z1 + 0.69);
    H cylI = xlate(prim([](SolidFactory& f) { return f.buildCylinder(0.7071, 2.2); }), ox, oy, oz);
    H clip = xlate(prim([&](SolidFactory& f) { return f.buildBox(1.5, 1.5, zTop); }), ox, oy, oz);
    auto fuse = [&](const H& a, const H& b) {
        return swapFuse ? runOp(b, a, BoolOp::Fuse) : runOp(a, b, BoolOp::Fuse);
    };
    Chain c;
    c.o1 = fuse(ballO, coneO);
    c.outer = fuse(c.o1.h, cylO);
    c.inner = fuse(ballI, cylI);
    c.body = runOp(c.outer.h, c.inner.h, BoolOp::Cut);
    c.le11 = runOp(c.body.h, clip, BoolOp::Common);
    return c;
}

static void auditStep(const char* tag, const StepOut& s, double truth) {
    std::printf("    [%s] ok=%d meshFallback=%d V=%zu E=%zu F=%zu vol=%.12f truth=%.12f rel=%.2e%s%s\n",
                tag, (int)s.ok, (int)s.mesh, s.V, s.E, s.F, s.vol, truth,
                s.ok ? relErr(s.vol, truth) : 0.0, s.ok ? "" : "  reason=", s.ok ? "" : s.reason);
    check(s.ok, std::string(tag) + ": native boolean ok (closed 2-manifold, no OCCT)");
    if (!s.ok) return;
    check(!s.mesh, std::string(tag) + ": ANALYTIC path (usedMeshFallback == false)");
    check(s.h.owner->isClosedTwoManifold() && s.h.owner->coedgeCount() == 2 * s.E,
          std::string(tag) + ": closed 2-manifold, every edge has 2 coedges");
    check(relErr(s.vol, truth) < 1e-8, std::string(tag) + ": volume == independent closed form (1e-8)");
}

static void testChain(const Truth& T) {
    std::printf("[LE11 chain] registry-equivalent operands, default-option primitives\n");
    Chain c = buildLE11(0, 0, 0, false);
    auditStep("fuse(ballO,coneO)", c.o1, T.o1);
    auditStep("fuse(o1,cylO)", c.outer, T.outer);
    auditStep("fuse(ballI,cylI)", c.inner, T.inner);
    auditStep("cut(outer,inner)", c.body, T.body);
    auditStep("common(body,clip)", c.le11, T.le11);
    if (!c.le11.ok) return;

    // (4) watertight tessellation of the final LE11 solid.
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(*c.le11.h.s, pos, idx);
    forge::native::mesh::HalfEdgeMesh m;
    const bool built = m.buildFromSoup(pos, idx);
    check(built, "LE11: result tessellates into a half-edge mesh");
    if (built) {
        auto rep = m.validate();
        check(rep.isValid(), "LE11: tessellation is a closed 2-manifold (validate)");
        const double tv = std::fabs(m.signedVolume());
        std::printf("    [LE11 tess] tris=%zu vol=%.9f rel=%.2e (chordal)\n", idx.size() / 3, tv, relErr(tv, T.le11));
        check(relErr(tv, T.le11) < 2e-3, "LE11: tessellated volume within chord error (2e-3) of the closed form");
    }

    // (5) analytic surface kinds survive: sphere (outer ball + inner cavity), the
    // taper cone, the two cylinder walls (factory cylinders are equal-radius Cones),
    // and the symmetry / base / top planes.
    int nPlane = 0, nSphere = 0, nTaper = 0, nCylWall = 0, other = 0;
    for (Shell* sh : c.le11.h.s->shells)
        for (Face* f : sh->faces) {
            if (!f->surface) { ++other; continue; }
            switch (f->surface->kind) {
            case SurfaceKind::Plane:  ++nPlane; break;
            case SurfaceKind::Sphere: ++nSphere; break;
            case SurfaceKind::Cone:
                if (std::fabs(f->surface->r1 - f->surface->r2) < 1e-12) ++nCylWall; else ++nTaper;
                break;
            case SurfaceKind::Cylinder: ++nCylWall; break;
            default: ++other; break;
            }
        }
    std::printf("    [LE11 faces] plane=%d sphere=%d taper(cone)=%d cylinder-wall=%d other=%d\n",
                nPlane, nSphere, nTaper, nCylWall, other);
    check(nSphere > 0 && nTaper > 0 && nCylWall > 0 && nPlane > 0 && other == 0,
          "LE11: sphere, taper-cone, cylinder and plane faces are ANALYTIC (no facet soup)");
    // the quarter sector keeps a quarter of each 128-sector analytic wall
    check(nTaper == 32, "LE11: the taper keeps exactly its 32 quarter-sector analytic cone faces");

    // (6) DETERMINISM — a second, independent run of the whole chain.
    Chain d = buildLE11(0, 0, 0, false);
    const StepOut* a[5] = {&c.o1, &c.outer, &c.inner, &c.body, &c.le11};
    const StepOut* b[5] = {&d.o1, &d.outer, &d.inner, &d.body, &d.le11};
    bool same = true;
    for (int k = 0; k < 5; ++k)
        same = same && a[k]->ok == b[k]->ok && std::memcmp(&a[k]->vol, &b[k]->vol, sizeof(double)) == 0 &&
               a[k]->V == b[k]->V && a[k]->E == b[k]->E && a[k]->F == b[k]->F;
    check(same, "DETERMINISM: a second run gives bit-identical volumes and identical V/E/F at every step");

    // (7a) METAMORPHIC — every fuse with its operands swapped.
    Chain p = buildLE11(0, 0, 0, true);
    std::printf("    [swapped fuses] o1=%d outer=%d inner=%d body=%d le11=%d vol=%.12f\n",
                (int)p.o1.ok, (int)p.outer.ok, (int)p.inner.ok, (int)p.body.ok, (int)p.le11.ok, p.le11.vol);
    check(p.le11.ok && !p.le11.mesh && relErr(p.o1.vol, T.o1) < 1e-8 && relErr(p.outer.vol, T.outer) < 1e-8 &&
              relErr(p.inner.vol, T.inner) < 1e-8 && relErr(p.le11.vol, T.le11) < 1e-8,
          "METAMORPHIC: fuse operand permutation leaves every volume unchanged (analytic, 1e-8)");

    // (7b) METAMORPHIC — rigid translation T of the whole construction (every operand,
    // including the clip box, moved by the same off-axis vector). The relation is
    // f(T(x)) == T(f(x)): the translated result, moved back by T^-1, must be the SAME
    // solid — same V/E/F, and the closed-form volume. (The volume measured IN the
    // translated frame is NOT asserted: MassProps integrates V = ∮ x n_x dA and treats a
    // planar face bounded by curved edges as its chord POLYGON while the curved
    // neighbours are integrated exactly, so the in-frame volume drifts by
    // t_x * (polygon-vs-arc area) — measured 1.5e-5 rel at t=(0.37,-1.21,2.5), 4.1e-3
    // at t_x=100, while the back-translated volume stays at 2e-14. That is a
    // mass-properties model limitation tracked separately (ledger T-311), not a boolean
    // error; it is printed so a change in it is visible.)
    const double t[3] = {0.37, -1.21, 2.5};
    Chain q = buildLE11(t[0], t[1], t[2], false);
    std::printf("    [translated]    o1=%d outer=%d inner=%d body=%d le11=%d V/E/F=%zu/%zu/%zu (in-frame vol %.12f, informative)\n",
                (int)q.o1.ok, (int)q.outer.ok, (int)q.inner.ok, (int)q.body.ok, (int)q.le11.ok,
                q.le11.V, q.le11.E, q.le11.F, q.le11.vol);
    bool equi = q.le11.ok && !q.le11.mesh && q.le11.V == c.le11.V && q.le11.E == c.le11.E && q.le11.F == c.le11.F;
    if (equi) {
        H backB = xlate(q.body.h, -t[0], -t[1], -t[2]);
        H backL = xlate(q.le11.h, -t[0], -t[1], -t[2]);
        const double vb = massProperties(*backB.s).volume, vl = massProperties(*backL.s).volume;
        std::printf("    [translated back] body vol=%.12f rel=%.2e  le11 vol=%.12f rel=%.2e\n",
                    vb, relErr(vb, T.body), vl, relErr(vl, T.le11));
        equi = relErr(vb, T.body) < 1e-10 && relErr(vl, T.le11) < 1e-10;
    }
    check(equi, "METAMORPHIC: translate-then-boolean == boolean-then-translate (same V/E/F, closed-form volume 1e-10)");
}

// ---------------------------------------------------------------------------
// SSI unit checks for the new coaxial-revolution pairs.
// ---------------------------------------------------------------------------
static Surface coneS(Vec3 o, Vec3 ax, double r1, double r2, double h) {
    Surface s; s.kind = SurfaceKind::Cone; s.origin = o; s.axis = ax; s.refDir = {1, 0, 0};
    s.r1 = r1; s.r2 = r2; s.param = h; return s;
}
static Surface sphS(Vec3 c, double R) {
    Surface s; s.kind = SurfaceKind::Sphere; s.origin = c; s.axis = {0, 0, 1}; s.refDir = {1, 0, 0};
    s.r1 = R; return s;
}
static Surface cylS(Vec3 o, double r) {
    Surface s; s.kind = SurfaceKind::Cylinder; s.origin = o; s.axis = {0, 0, 1}; s.refDir = {1, 0, 0};
    s.r1 = r; s.param = 1.0; return s;
}
// residual of a point on the double cone (radius |r_lin(s)| at axial coordinate s)
static double coneRes(const Surface& c, const Vec3& p) {
    const double s = vdot(vsub(p, c.origin), c.axis);
    const double rl = c.r1 + (c.r2 - c.r1) * s / c.param;
    const Vec3 rad = vsub(vsub(p, c.origin), vscale(c.axis, s));
    return std::fabs(vlen(rad) - std::fabs(rl));
}
static double maxRes(const SurfaceIntersectResult& r, auto fn) {
    double m = 0.0;
    for (const auto& c : r.curves) for (const Vec3& p : c.samples) m = std::max(m, fn(p));
    return m;
}

static void testSSI() {
    std::printf("[SSI] coaxial revolution pairs -> exact circles; the rest still DEFER\n");
    const double z1 = std::sin(kPi / 4);
    // LE11's own pair: the taper against the outer ball.
    {
        Surface c = coneS({0, 0, z1}, {0, 0, 1}, std::sqrt(1.4 * 1.4 - z1 * z1), 1.0, 0.69);
        Surface s = sphS({0, 0, 0}, 1.4);
        auto r = intersectSurfaces(c, s);
        const double rc = maxRes(r, [&](const Vec3& p) { return coneRes(c, p); });
        const double rs = maxRes(r, [&](const Vec3& p) { return std::fabs(vlen(p) - 1.4); });
        bool hasZ1 = false;
        for (const auto& cu : r.curves) hasZ1 = hasZ1 || std::fabs(cu.origin.z - z1) < 1e-12;
        std::printf("    [taper∩ball] ok=%d closed=%d curves=%zu resCone=%.2e resSphere=%.2e\n",
                    (int)r.ok, (int)r.allClosedForm, r.curves.size(), rc, rs);
        check(r.ok && r.allClosedForm && r.curves.size() == 2 && hasZ1 && rc < 1e-12 && rs < 1e-12,
              "taper∩ball: two exact circles (one at z1), every sample on BOTH surfaces (<1e-12)");
    }
    // The pair the old suites asserted deferred: apex cone r 2->0 over 4, ball R3.
    {
        Surface c = coneS({0, 0, 0}, {0, 0, 1}, 2, 0, 4);
        Surface s = sphS({0, 0, 0}, 3);
        auto r = intersectSurfaces(c, s);
        const double rc = maxRes(r, [&](const Vec3& p) { return coneRes(c, p); });
        const double rs = maxRes(r, [&](const Vec3& p) { return std::fabs(vlen(p) - 3.0); });
        check(r.ok && r.allClosedForm && r.curves.size() == 2 && rc < 1e-12 && rs < 1e-12,
              "coaxial cone∩sphere: 2 circles at the profile roots, on BOTH surfaces (<1e-12)");
    }
    // cone ∩ cylinder (coaxial): r = 2 - 0.5 s = ±1  ->  s = 2 (r=1) and s = 6 (other nappe).
    {
        Surface c = coneS({0, 0, 0}, {0, 0, 1}, 2, 0, 4);
        Surface y = cylS({0, 0, -5}, 1.0);
        auto r = intersectSurfaces(c, y);
        const double rc = maxRes(r, [&](const Vec3& p) { return coneRes(c, p); });
        const double ry = maxRes(r, [&](const Vec3& p) { return std::fabs(std::hypot(p.x, p.y) - 1.0); });
        bool s2 = false, s6 = false;
        for (const auto& cu : r.curves) { s2 = s2 || std::fabs(cu.origin.z - 2) < 1e-12; s6 = s6 || std::fabs(cu.origin.z - 6) < 1e-12; }
        check(r.ok && r.curves.size() == 2 && s2 && s6 && rc < 1e-12 && ry < 1e-12,
              "coaxial cone∩cylinder: circles at s=2 and s=6 (both nappes), on BOTH surfaces");
    }
    // cone ∩ cone (coaxial, opposite axis direction): exercised through the sign σ.
    {
        Surface a = coneS({0, 0, 0}, {0, 0, 1}, 2, 1, 2);      // r = 2 - 0.5 z
        Surface b = coneS({0, 0, 4}, {0, 0, -1}, 0.5, 1.5, 2); // r = 0.5 + 0.5 (4 - z)
        auto r = intersectSurfaces(a, b);
        const double ra = maxRes(r, [&](const Vec3& p) { return coneRes(a, p); });
        const double rb = maxRes(r, [&](const Vec3& p) { return coneRes(b, p); });
        check(r.ok && !r.curves.empty() && ra < 1e-12 && rb < 1e-12,
              "coaxial cone∩cone (antiparallel axes): circles on BOTH cones (<1e-12)");
    }
    // HONESTY: genuinely unsupported pairs must still DEFER.
    {
        Surface c = coneS({0, 0, 0}, {0, 0, 1}, 2, 0, 4);
        Surface s = sphS({0.5, 0, 0}, 3);                       // centre OFF the axis
        check(!intersectSurfaces(c, s).ok, "NON-coaxial cone∩sphere is still DEFERRED (ok=false), not faked");
        Surface y = cylS({0.25, 0, 0}, 1.0);                    // parallel but offset axis
        check(!intersectSurfaces(c, y).ok, "NON-coaxial cone∩cylinder is still DEFERRED (ok=false)");
        Surface same = coneS({0, 0, 1}, {0, 0, 1}, 1.5, 0, 3); // the SAME cone surface
        check(!intersectSurfaces(c, same).ok, "coincident coaxial cones DEFER (no fake curve)");
    }
}

int main() {
    std::printf("== T-310 NAFEMS LE11 native boolean gate ==\n");
    const Truth T = closedForm();
    testSSI();
    testChain(T);
    std::printf("\nRESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
