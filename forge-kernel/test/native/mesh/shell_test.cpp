// forge/native/mesh/test/shell_test.cpp
//
// RANDOMIZED standalone gate for forge::native::mesh::shellMesh — shell / hollow
// a closed 2-manifold mesh into a constant-thickness solid wall. Pure C++20, no
// external deps.
//
// Build + run (standalone — ONLY this module + named deps, not the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Shell.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/shell_test.cpp -o /tmp/k4_Shell && /tmp/k4_Shell
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTIONS (per task brief):
//   (W)  Shelling a sphere radius R by thickness t yields enclosed WALL volume
//        about  (4/3)·π·(R^3 - (R-t)^3)  within a COARSE-MESH tolerance — checked
//        at two tessellation levels with a fresh random R/t each run so it is
//        never cherry-picked.
//   (M)  The shelled wall is watertight 2-manifold (validate().isValid()).
//   (P)  Genus is preserved (input genus == result per-component genus): sphere
//        (g=0) and torus (g=1) both shell to a wall of the same genus.
//   (O)  Opening a face (mouth) yields a STILL-watertight 2-manifold cup with a
//        real wall-thickness rim; the enclosed wall volume is unchanged by where
//        the single dropped face sat (it is replaced by the rim band).
//   (C)  t >= R collapses the cavity -> HONEST ok=false (never fabricated).
//   (R)  Degenerate / non-closed / bad input / non-positive t -> ok=false.
//   (F)  0-FAKES invariant: ok==true ALWAYS implies a validated closed 2-manifold.
//
// The sphere is an icosphere (subdivided icosahedron) — a uniformly tessellated
// closed 2-manifold whose area-weighted vertex normals coincide (to tessellation
// error) with the true radial direction, so the analytic wall-volume law is the
// right target. A COARSE icosphere under-encloses the true sphere volume, so the
// tol is chord-error-aware (it shrinks as the mesh is refined), proving the
// SHELL, not the mesh, is what we validate.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Shell.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <map>
#include <random>
#include <vector>

using namespace forge::native::mesh;

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[256];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else    std::printf("  [FAIL] %s\n", buf);
}

// ── icosphere builder ────────────────────────────────────────────────────────
// Radius-`r` icosphere with `subdiv` levels of mid-point subdivision. subdiv=0
// => 12 verts / 20 faces; each level multiplies faces by 4. All faces are CCW as
// seen from OUTSIDE (outward normals), so signedVolume() > 0.
static void icosphere(double r, int subdiv,
                      std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    const double t = (1.0 + std::sqrt(5.0)) / 2.0;
    std::vector<std::array<double, 3>> v = {
        {-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0},
        {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t},
        {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}
    };
    std::vector<std::array<std::uint32_t, 3>> f = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1}
    };
    for (int s = 0; s < subdiv; ++s) {
        std::map<std::uint64_t, std::uint32_t> mid;
        auto midpoint = [&](std::uint32_t a, std::uint32_t b) -> std::uint32_t {
            std::uint64_t key = (static_cast<std::uint64_t>(std::min(a, b)) << 32) | std::max(a, b);
            auto it = mid.find(key);
            if (it != mid.end()) return it->second;
            std::array<double, 3> m = {
                0.5 * (v[a][0] + v[b][0]),
                0.5 * (v[a][1] + v[b][1]),
                0.5 * (v[a][2] + v[b][2])
            };
            std::uint32_t newIdx = static_cast<std::uint32_t>(v.size());
            v.push_back(m);
            mid.emplace(key, newIdx);
            return newIdx;
        };
        std::vector<std::array<std::uint32_t, 3>> nf;
        nf.reserve(f.size() * 4);
        for (auto& tri : f) {
            std::uint32_t a = midpoint(tri[0], tri[1]);
            std::uint32_t b = midpoint(tri[1], tri[2]);
            std::uint32_t c = midpoint(tri[2], tri[0]);
            nf.push_back({tri[0], a, c});
            nf.push_back({tri[1], b, a});
            nf.push_back({tri[2], c, b});
            nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    pos.clear(); pos.reserve(v.size() * 3);
    for (auto& p : v) {
        double n = std::sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
        pos.push_back(p[0] / n * r);
        pos.push_back(p[1] / n * r);
        pos.push_back(p[2] / n * r);
    }
    idx.clear(); idx.reserve(f.size() * 3);
    for (auto& tri : f) { idx.push_back(tri[0]); idx.push_back(tri[1]); idx.push_back(tri[2]); }
}

// ── torus builder (genus 1) ──────────────────────────────────────────────────
// A (R, rTube) torus tessellated nu x nv. CCW-wound from outside (outward
// normals => signedVolume() > 0). Exact closed 2-manifold of genus 1.
static void torus(double R, double rTube, int nu, int nv,
                  std::vector<double>& pos, std::vector<std::uint32_t>& idx) {
    pos.clear(); idx.clear();
    pos.reserve(static_cast<std::size_t>(nu) * nv * 3);
    for (int i = 0; i < nu; ++i) {
        const double u = 2.0 * M_PI * i / nu;          // around the main ring
        const double cu = std::cos(u), su = std::sin(u);
        for (int j = 0; j < nv; ++j) {
            const double vv = 2.0 * M_PI * j / nv;      // around the tube
            const double cv = std::cos(vv), sv = std::sin(vv);
            const double x = (R + rTube * cv) * cu;
            const double y = (R + rTube * cv) * su;
            const double z = rTube * sv;
            pos.push_back(x); pos.push_back(y); pos.push_back(z);
        }
    }
    auto vid = [&](int i, int j) -> std::uint32_t {
        return static_cast<std::uint32_t>((i % nu) * nv + (j % nv));
    };
    for (int i = 0; i < nu; ++i) {
        for (int j = 0; j < nv; ++j) {
            std::uint32_t v00 = vid(i, j);
            std::uint32_t v10 = vid(i + 1, j);
            std::uint32_t v01 = vid(i, j + 1);
            std::uint32_t v11 = vid(i + 1, j + 1);
            // CCW from outside: (v00, v10, v11) + (v00, v11, v01)
            idx.push_back(v00); idx.push_back(v10); idx.push_back(v11);
            idx.push_back(v00); idx.push_back(v11); idx.push_back(v01);
        }
    }
}

static bool validClosed(const HalfEdgeMesh& m) { return m.validate().isValid(); }
static double sphereVol(double r) { return (4.0 / 3.0) * M_PI * r * r * r; }
static double shellVol(double R, double t) { return sphereVol(R) - sphereVol(R - t); }

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };

    std::printf("=== forge::native::mesh shellMesh gate (hollow to a constant-thickness wall) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    int fakes = 0;
    auto countFake = [&](const ShellResult& r) {
        if (r.ok && !validClosed(r.mesh)) ++fakes;
    };

    // ── (W/M) sphere shell wall-volume law: vol ≈ (4/3)π(R^3-(R-t)^3) ─────────
    std::printf("[W] sphere shell wall volume  ~ (4/3)pi(R^3-(R-t)^3)  (coarse-mesh tol)\n");
    for (int subdiv : {2, 3}) {
        const double R = uni(0.90, 1.30);                  // random radius near unity
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(R, subdiv, pos, idx);

        HalfEdgeMesh base; base.buildFromSoup(pos, idx);
        const double volIn = base.signedVolume();
        const double ratio = volIn / sphereVol(R);          // realized fill < 1
        // coarse-mesh tol: the mesh under-fills BOTH outer and inner shells by
        // ~(1-ratio); the wall volume is a difference so the same relative error
        // applies, plus 2% slack for the inner-surface curvature change.
        const double relTol = (1.0 - ratio) + 0.02;

        for (double t : { uni(0.12, 0.30), uni(0.05, 0.10), uni(0.30, 0.45) }) {
            ShellResult res = shellMesh(pos, idx, t);
            countFake(res);
            const double predicted = shellVol(R, t);
            const double got       = res.ok ? res.mesh.signedVolume() : 0.0;
            const double rel       = std::fabs(got - predicted) / predicted;
            check(res.ok && validClosed(res.mesh),
                  "(W/M) L%d R=%.3f t=%.3f -> watertight 2-manifold (%s)",
                  subdiv, R, t, res.ok ? "ok" : res.reason);
            check(res.ok && rel <= relTol,
                  "(W) L%d R=%.3f t=%.3f wall=%.5f ~ (4/3)pi(R^3-(R-t)^3)=%.5f  rel=%.4f<=tol=%.4f",
                  subdiv, R, t, got, predicted, rel, relTol);
            check(res.ok && res.wallVolume > 0.0 && res.mesh.signedVolume() > 0.0,
                  "(W) L%d wall encloses positive volume (wall=%.5f, mesh=%.5f)",
                  subdiv, res.wallVolume, res.ok ? res.mesh.signedVolume() : 0.0);
        }
    }
    std::printf("\n");

    // ── (W-refine) wall-volume error SHRINKS under refinement (shell unbiased) ─
    std::printf("[W-refine] wall-volume error decreases under refinement (shell is unbiased)\n");
    {
        const double R = 1.0, t = 0.25;
        double prevErr = 1e9;
        bool monotone = true;
        for (int subdiv : {1, 2, 3, 4}) {
            std::vector<double> pos; std::vector<std::uint32_t> idx;
            icosphere(R, subdiv, pos, idx);
            ShellResult res = shellMesh(pos, idx, t);
            countFake(res);
            if (!res.ok) { monotone = false; break; }
            const double err = std::fabs(res.mesh.signedVolume() - shellVol(R, t)) / shellVol(R, t);
            std::printf("    L%d  rel-err=%.5f\n", subdiv, err);
            if (err >= prevErr) monotone = false;
            prevErr = err;
        }
        check(monotone, "(W-refine) wall rel-err strictly decreases L1>L2>L3>L4 (converges to analytic)");
    }
    std::printf("\n");

    // ── (P) genus preserved: sphere (g=0) and torus (g=1) ─────────────────────
    std::printf("[P] genus preserved by the shell (sphere g=0, torus g=1)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        ShellResult res = shellMesh(pos, idx, 0.2);
        countFake(res);
        check(res.ok && res.inputGenus == 0 && res.resultGenus == 0,
              "(P) sphere: input g=%u, result g=%u (both 0)", res.inputGenus, res.resultGenus);

        std::vector<double> tpos; std::vector<std::uint32_t> tidx;
        torus(1.0, 0.35, 40, 24, tpos, tidx);
        HalfEdgeMesh tbase; tbase.buildFromSoup(tpos, tidx);
        check(validClosed(tbase) && tbase.validate().eulerChar == 0,
              "(P) torus fixture is a valid genus-1 closed 2-manifold (chi=%d)",
              tbase.validate().eulerChar);
        ShellResult tres = shellMesh(tpos, tidx, 0.10);
        countFake(tres);
        check(tres.ok && validClosed(tres.mesh),
              "(P) torus shell -> watertight 2-manifold (%s)", tres.ok ? "ok" : tres.reason);
        check(tres.ok && tres.inputGenus == 1 && tres.resultGenus == 1,
              "(P) torus: input g=%u, result g=%u (both 1)", tres.inputGenus, tres.resultGenus);
        // torus wall volume: 2*pi^2*R*(rTube^2-(rTube-t)^2) analytic; coarse tol.
        const double wallAnalytic = 2.0 * M_PI * M_PI * 1.0 * (0.35 * 0.35 - 0.25 * 0.25);
        check(tres.ok && std::fabs(tres.mesh.signedVolume() - wallAnalytic) / wallAnalytic <= 0.05,
              "(P) torus wall vol %.5f ~ 2pi^2 R (rt^2-(rt-t)^2)=%.5f",
              tres.ok ? tres.mesh.signedVolume() : 0.0, wallAnalytic);
    }
    std::printf("\n");

    // ── (O) opening a face yields a watertight cup with a real rim ────────────
    std::printf("[O] open a face (mouth) -> watertight 2-manifold cup with wall-thickness rim\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        const double t = 0.18;
        ShellResult closedRes = shellMesh(pos, idx, t, -1);
        countFake(closedRes);
        // Open three DIFFERENT faces (distinct mouths) — never cherry-pick one.
        const std::size_t numF = idx.size() / 3;
        for (int openFace : { 0, static_cast<int>(numF / 2), static_cast<int>(numF - 1) }) {
            ShellResult res = shellMesh(pos, idx, t, openFace);
            countFake(res);
            check(res.ok && validClosed(res.mesh),
                  "(O) openFace=%d -> watertight 2-manifold cup (%s)",
                  openFace, res.ok ? "ok" : res.reason);
            // Opening replaces 1 outer + 1 inner tri with a 6-tri rim band, so the
            // enclosed wall volume changes by at most the volume those tris bounded
            // — negligible vs the wall. Require it within 2% of the closed wall.
            check(res.ok && closedRes.ok &&
                  std::fabs(res.mesh.signedVolume() - closedRes.mesh.signedVolume())
                      / closedRes.mesh.signedVolume() <= 0.02,
                  "(O) openFace=%d wall vol %.5f ~ closed wall %.5f (rim conserves wall)",
                  openFace, res.ok ? res.mesh.signedVolume() : 0.0,
                  closedRes.ok ? closedRes.mesh.signedVolume() : 0.0);
            // The cup is genus 0 (a hollow ball with a hole through the wall is a
            // topological sphere — the rim closes it).
            check(res.ok && res.resultGenus == 0,
                  "(O) openFace=%d cup result genus=%u (0)", openFace, res.resultGenus);
        }
    }
    std::printf("\n");

    // ── (C) t >= R collapses the cavity => HONEST ok=false (never fabricated) ──
    std::printf("[C] over-thick wall (t >= R) collapses -> HONEST ok=false (0 fakes)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        for (double t : { 1.0, 1.5, 2.0 }) {  // t == R drives the inner wall to the centre
            ShellResult res = shellMesh(pos, idx, t);
            countFake(res);
            check(!res.ok, "(C) t=%.2f (>=R) collapses -> ok=false [%s]",
                  t, res.ok ? "FABRICATED!" : res.reason);
        }
    }
    std::printf("\n");

    // ── (R) degenerate / non-closed / bad input => honest ok=false ────────────
    std::printf("[R] degenerate / non-closed / bad input / non-positive t -> honest ok=false\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 2, pos, idx);

        // (R1) non-positive thickness
        ShellResult r1 = shellMesh(pos, idx, 0.0); countFake(r1);
        check(!r1.ok, "(R1) t=0 -> ok=false [%s]", r1.reason);
        ShellResult r1b = shellMesh(pos, idx, -0.1); countFake(r1b);
        check(!r1b.ok, "(R1b) t<0 -> ok=false [%s]", r1b.reason);

        // (R2) ragged positions length
        ShellResult r2 = shellMesh({0,0,0, 1,0}, {0,1,2}, 0.1); countFake(r2);
        check(!r2.ok, "(R2) ragged positions -> ok=false [%s]", r2.reason);

        // (R3) empty input
        std::vector<double> emptyPos;
        std::vector<std::uint32_t> emptyIdx;
        ShellResult r3 = shellMesh(emptyPos, emptyIdx, 0.1); countFake(r3);
        check(!r3.ok, "(R3) empty input -> ok=false [%s]", r3.reason);

        // (R4) open mesh (single triangle: not closed)
        ShellResult r4 = shellMesh({0,0,0, 1,0,0, 0,1,0}, {0,1,2}, 0.1); countFake(r4);
        check(!r4.ok, "(R4) open single triangle -> ok=false [%s]", r4.reason);

        // (R5) index out of range
        ShellResult r5 = shellMesh({0,0,0, 1,0,0, 0,1,0}, {0,1,9}, 0.1); countFake(r5);
        check(!r5.ok, "(R5) out-of-range index -> ok=false [%s]", r5.reason);

        // (R6) openFace index out of range
        ShellResult r6 = shellMesh(pos, idx, 0.1, 100000); countFake(r6);
        check(!r6.ok, "(R6) openFace out of range -> ok=false [%s]", r6.reason);
    }
    std::printf("\n");

    // ── (HEM) HalfEdgeMesh overload parity ────────────────────────────────────
    std::printf("[HEM] HalfEdgeMesh overload matches the soup overload\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        HalfEdgeMesh m; m.buildFromSoup(pos, idx);
        ShellResult viaSoup = shellMesh(pos, idx, 0.2);
        ShellResult viaHem  = shellMesh(m, 0.2);
        countFake(viaSoup); countFake(viaHem);
        check(viaSoup.ok && viaHem.ok &&
              std::fabs(viaSoup.mesh.signedVolume() - viaHem.mesh.signedVolume()) < 1e-9,
              "(HEM) overload parity: soup wall=%.6f, hem wall=%.6f",
              viaSoup.ok ? viaSoup.mesh.signedVolume() : 0.0,
              viaHem.ok ? viaHem.mesh.signedVolume() : 0.0);
        // The HalfEdgeMesh overload must reject a non-closed mesh too.
        HalfEdgeMesh openTri; openTri.buildFromSoup({0,0,0, 1,0,0, 0,1,0}, {0,1,2});
        ShellResult ro = shellMesh(openTri, 0.1); countFake(ro);
        check(!ro.ok, "(HEM) open HalfEdgeMesh -> ok=false [%s]", ro.reason);
    }
    std::printf("\n");

    // ── (F) 0-FAKES invariant ─────────────────────────────────────────────────
    std::printf("[F] 0-FAKES invariant across ALL cases above\n");
    check(fakes == 0, "(F) 0 FAKES — ok==true ALWAYS implies a validated closed 2-manifold (got %d)", fakes);

    std::printf("\n=== HONEST ENVELOPE ===\n");
    std::printf("=== ROBUST: shell/hollow a closed 2-manifold by thickness t>0 -> a watertight\n");
    std::printf("===         2-manifold WALL (outer surface + inward-offset, flipped inner surface).\n");
    std::printf("===         Sphere wall volume (4/3)pi(R^3-(R-t)^3) met within coarse-mesh tol and the\n");
    std::printf("===         residual SHRINKS under refinement (shell unbiased); genus preserved\n");
    std::printf("===         (sphere g=0, torus g=1); a face can be OPENED as a mouth, stitched by a\n");
    std::printf("===         real wall-thickness rim band, staying watertight 2-manifold.\n");
    std::printf("=== ok=FALSE (honest, never fabricated): non-closed/bad/degenerate/empty input;\n");
    std::printf("===         non-positive t; zero-area vertex normal; over-thick t>=R collapse\n");
    std::printf("===         (inner volume sign flip / ~0 cavity / ANY inner face inversion =\n");
    std::printf("===         wall self-intersection); openFace out of range. NOT a Minkowski/medial\n");
    std::printf("===         shell: inner edges/corners under-fill and gross self-intersection is\n");
    std::printf("===         REJECTED, not rounded.\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
