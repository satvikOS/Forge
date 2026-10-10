// forge-kernel/test/fea_le11_native_gate.cpp
//
// T-310 — NAFEMS LE11 (solid cylinder / taper / sphere, thermal stress), end to end in
// NATIVE C++: geometry through the public registry API (forge::makeSphere / makeCone /
// makeCylinder / translate / fuse / cut / common — the same entry points the JS binding
// wraps), Tet4 mesh through forge::fea::tet::meshShapeFromHandle, thermoelastic solve
// through forge::fea::tet::solveLinearStatic. A minimal C++ port of
// test/fea_nafems_gate.mjs::solveLE11 (READ for its semantics — this program does not
// run Node): same construction, same symmetry/clamp boundary conditions, same
// temperature field, same material, same probe, same two mesh sizes (0.34 coarse,
// 0.26 fine).
//
// NAFEMS LE11 target: sigma_zz = -105 MPa at A = (1, 0, 0), band +-6 %.
//
// WHAT THIS GATE ASSERTS (exit code):
//   * the LE11 geometry BUILDS (it used to throw: "native analytic/mesh boolean deferred
//     on an all-native operand pair" — the case was BLOCKED, not measured);
//   * every boolean result is a NativeSolid (the native analytic path; no OCCT boolean);
//   * the solid volume equals the independent closed form (1e-8 relative);
//   * the tet mesh is a genuine volume mesh (not the shell-tet fallback), the CG solve
//     converged, and sigma_zz at A is finite with the RIGHT SIGN.
// The NAFEMS ACCURACY band (+-6 %) is REPORTED, not asserted: the accuracy of this
// Tet4 + seed-lattice mesher on LE1/LE10 is a separately-tracked, ratcheted gap
// (fea_nafems_ratchet.sh, reports/FEA_NAFEMS_GAP.md); this gate's job is to take LE11
// from BLOCKED to MEASURED. The machine-readable line mirrors the JS gate's
// [nafems-case] format so the ratchet's parser semantics carry over.

#include "forge/Booleans.hpp"
#include "forge/FeaTet.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/Transform.hpp"
#include "forge/native/brep/MassProps.hpp"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <string>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;
int g_fail = 0;
void check(bool ok, const std::string& what) {
    std::printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
    if (!ok) ++g_fail;
}
// fea_nafems_gate.mjs: `const near = (a, b) => Math.abs(a - b) < 1e-6;` — its third
// argument is IGNORED, so the effective BC band is 1e-6 (T-186 notes the defect).
// Mirror the gate as shipped on origin/archdisc.
bool nearV(double a, double b) { return std::fabs(a - b) < 1e-6; }

double le11ClosedFormVolume() {
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4;
    const double R1 = std::sqrt(1.4 * 1.4 - z1 * z1);
    const double zi = std::sqrt(1.0 - 0.7071 * 0.7071);
    auto sph = [](double R, double a, double b) { return R * R * (b - a) - (b * b * b - a * a * a) / 3.0; };
    const double frustumOverPi = 0.69 / 3.0 * (R1 * R1 + R1 * 1.0 + 1.0);
    return kPi / 4.0 * (sph(1.4, 0.0, z1) + frustumOverPi + 0.4 - sph(1.0, 0.0, zi)
                        - 0.7071 * 0.7071 * (zTop - zi));
}

struct Le11Run {
    double sigZZ = NAN;
    std::size_t nodes = 0, tets = 0;
    bool converged = false, shell = true, capped = false;
    double spacing = 0.0, meshS = 0.0, solveS = 0.0;
    double px = 0, py = 0, pz = 0;
    int cgIt = 0;
};

forge::ShapeHandle buildLE11(double& volOut, bool& allNative) {
    using namespace forge;
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4;
    auto& reg = ShapeRegistry::instance();
    ShapeHandle ballO = makeSphere(1.4), ballI = makeSphere(1.0);
    ShapeHandle coneO = translate(makeCone(std::sqrt(1.4 * 1.4 - z1 * z1), 1.0, 0.69), 0, 0, z1);
    ShapeHandle cylO = translate(makeCylinder(1.0, 0.4), 0, 0, z1 + 0.69);
    ShapeHandle cylI = makeCylinder(0.7071, 2.2);
    ShapeHandle o1 = fuse(ballO, coneO);
    ShapeHandle outer = fuse(o1, cylO);
    ShapeHandle inner = fuse(ballI, cylI);
    ShapeHandle body = cut(outer, inner);
    ShapeHandle clip = makeBox(1.5, 1.5, zTop);
    ShapeHandle le11 = common(body, clip);
    allNative = true;
    for (ShapeHandle h : {o1, outer, inner, body, le11})
        allNative = allNative && reg.kindOf(h) == ShapeKind::NativeSolid;
    volOut = allNative ? native::brep::massProperties(reg.getNativeSolid(le11)).volume : NAN;
    return le11;
}

Le11Run solveLE11(forge::ShapeHandle le11, double edge) {
    using namespace forge::fea::tet;
    const double z1 = std::sin(kPi / 4), zTop = z1 + 0.69 + 0.4, alpha = 2.3e-4;
    Le11Run out;
    std::fprintf(stderr, "  [progress] meshing at edge %.2f ...\n", edge);
    auto t0 = std::chrono::steady_clock::now();
    Mesh m = meshShapeFromHandle(le11, edge);
    std::fprintf(stderr, "  [progress] mesh done: %zu nodes / %zu tets; solving ...\n", m.nodes.size(), m.tets.size());
    out.meshS = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    out.nodes = m.nodes.size(); out.tets = m.tets.size();
    out.shell = m.shellTetsOnly; out.capped = m.seedGridCapped; out.spacing = m.interiorSpacing;
    BC bc;
    for (const Node& n : m.nodes) {
        PrescribedDisp p; p.nodeId = n.id;
        if (nearV(n.x, 0)) p.fx = true;                       // x=0 plane: u_x = 0
        if (nearV(n.y, 0)) p.fy = true;                       // y=0 plane: u_y = 0
        if (nearV(n.z, 0) || nearV(n.z, zTop)) p.fz = true;   // base + top face: u_z = 0
        if (p.fx || p.fy || p.fz) bc.prescribed.push_back(p);
        bc.nodeTemps.push_back({n.id, std::sqrt(n.x * n.x + n.y * n.y) + n.z});
    }
    Material mat{210e9, 0.3, 7850, alpha};
    t0 = std::chrono::steady_clock::now();
    Result r = solveLinearStatic(m, mat, bc);
    out.solveS = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    out.converged = r.converged; out.cgIt = r.cgIterations;
    double best = 1e300; std::size_t bi = 0;
    for (std::size_t k = 0; k < m.nodes.size(); ++k) {
        const Node& n = m.nodes[k];
        const double d = (n.x - 1) * (n.x - 1) + n.y * n.y + n.z * n.z;
        if (d < best) { best = d; bi = k; }
    }
    if (bi < r.nodalStress.size()) out.sigZZ = r.nodalStress[bi][2];
    out.px = m.nodes[bi].x; out.py = m.nodes[bi].y; out.pz = m.nodes[bi].z;
    return out;
}

} // namespace

int main(int argc, char** argv) {
    std::setvbuf(stdout, nullptr, _IOLBF, 0);   // line-buffered: progress is visible in logs
    // `geometry` stops after the geometry assertions (no mesh, no solve): the mode a CI
    // job can afford while the Tet4 mesher's cost on LE11's ~900 cospherical sphere-patch
    // vertices is open (T-310 report). `all` (default) also meshes and solves.
    const std::string mode = argc > 1 ? argv[1] : "all";
    if (mode != "all" && mode != "geometry") {
        std::fprintf(stderr, "usage: %s [all|geometry]\n", argv[0]);
        return 2;
    }
    std::printf("== T-310 NAFEMS LE11 — native geometry + native Tet4 thermoelastic solve (%s) ==\n", mode.c_str());
    double vol = NAN; bool allNative = false;
    forge::ShapeHandle le11 = forge::kInvalidHandle;
    try {
        auto t0 = std::chrono::steady_clock::now();
        le11 = buildLE11(vol, allNative);
        const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        std::printf("  geometry built in %.1f s, volume %.12f (closed form %.12f)\n", s, vol, le11ClosedFormVolume());
    } catch (const std::exception& e) {
        std::printf("  BLOCKED — the kernel refused to build the LE11 geometry:\n    %s\n", e.what());
        std::printf("[nafems-case] name=LE11 measured=nan target=-105 errPct=nan band=6 order=nan verdict=BLOCKED\n");
        check(false, "LE11 geometry builds natively");
        return 1;
    }
    check(true, "LE11 geometry builds natively (no refusal)");
    check(allNative, "every LE11 boolean result is a NativeSolid (native analytic path, no OCCT boolean)");
    check(std::fabs(vol - le11ClosedFormVolume()) <= 1e-8 * le11ClosedFormVolume(),
          "LE11 volume == independent closed form (1e-8)");
    if (mode == "geometry") {
        std::printf("RESULT: %s (%d hard failures, geometry only)\n", g_fail ? "FAIL" : "PASS", g_fail);
        return g_fail ? 1 : 0;
    }

    Le11Run c, f;
    try {
        c = solveLE11(le11, 0.34);
        f = solveLE11(le11, 0.26);
    } catch (const std::exception& e) {
        std::printf("  mesh/solve threw: %s\n", e.what());
        check(false, "LE11 meshes and solves");
        return 1;
    }
    for (const auto* r : {&c, &f})
        std::printf("  edge %.2f: %zu nodes / %zu tets, shellOnly=%d seedCapped=%d spacing=%.4f, "
                    "mesh %.1f s, solve %.1f s (CG %d, converged=%d), probe (%.3f,%.3f,%.3f) sigma_zz = %.3f MPa\n",
                    r == &c ? 0.34 : 0.26, r->nodes, r->tets, (int)r->shell, (int)r->capped, r->spacing,
                    r->meshS, r->solveS, r->cgIt, (int)r->converged, r->px, r->py, r->pz, r->sigZZ / 1e6);
    check(!c.shell && !f.shell, "tet mesher returned a VOLUME mesh (not the shell-tet fallback) at both sizes");
    check(c.converged && f.converged, "CG converged at both sizes");
    check(std::isfinite(f.sigZZ) && f.sigZZ < 0.0, "sigma_zz at A is finite and COMPRESSIVE (the NAFEMS sign)");

    const double target = -105.0;
    const double measMPa = f.sigZZ / 1e6;
    const double errPct = (measMPa - target) / std::fabs(target) * 100.0;
    const double ec = std::fabs(c.sigZZ / 1e6 - target), ef = std::fabs(measMPa - target);
    const double rr = std::cbrt(static_cast<double>(f.tets) / static_cast<double>(c.tets));
    const double p = (rr > 1.0001 && ec > 0 && ef > 0) ? std::log(ec / ef) / std::log(rr) : NAN;
    const bool inBand = std::fabs(errPct) <= 6.0;
    std::printf("  LE11 sigma_zz(A): coarse %.3f -> fine %.3f MPa vs -105 MPa: error %+.2f %% (band +-6 %%) -> %s;"
                " |err| %.1f%% -> %.1f%%, %s\n",
                c.sigZZ / 1e6, measMPa, errPct, inBand ? "PASS" : "MISS",
                ec / 105.0 * 100.0, ef / 105.0 * 100.0, ef < ec ? "converging" : "NOT converging");
    std::printf("[nafems-case] name=LE11 measured=%.4f target=-105 errPct=%.2f band=6 order=%.3f verdict=%s\n",
                measMPa, errPct, p, inBand ? "PASS" : "MISS");
    std::printf("RESULT: %s (%d hard failures)\n", g_fail ? "FAIL" : "PASS", g_fail);
    return g_fail ? 1 : 0;
}
