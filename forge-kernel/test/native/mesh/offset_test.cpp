// forge/native/mesh/test/offset_test.cpp
//
// RANDOMIZED standalone gate for forge::native::mesh::offsetMesh — the uniform
// vertex-normal mesh offset / shell. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + named deps, not the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Offset.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/mesh/offset_test.cpp -o /tmp/k_Offset && /tmp/k_Offset
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTIONS (per task brief):
//   (G)  Offsetting a unit sphere (radius r) by d yields enclosed volume about
//        (4/3)·π·(r+d)^3 within a COARSE-MESH tolerance — checked for several
//        signed d (grow and shrink), at two tessellation levels and a fresh
//        random radius/distance each run so it is never cherry-picked.
//   (M)  The offset result stays a 2-manifold closed solid (validate().isValid()).
//   (S)  Negative d (shrink) is handled and returns a VALID smaller solid while
//        the wall is not breached.
//   (C)  A shrink that collapses the solid (|d| >= r) returns an HONEST ok=false
//        — never a fabricated "valid" mesh.
//   (Z)  d == 0 is a faithful no-op (ok=true, volume unchanged).
//   (R)  Degenerate / non-closed / bad input returns ok=false with a reason.
//   (F)  0-FAKES invariant: ok==true ALWAYS implies a validated closed 2-manifold.
//
// The sphere is an icosphere (subdivided icosahedron) — a uniformly tessellated
// closed 2-manifold whose area-weighted vertex normals coincide (to tessellation
// error) with the true radial direction, so the analytic volume law is the right
// target. A COARSE icosphere under-encloses the true sphere volume, so the tol is
// chord-error-aware (it shrinks as the mesh is refined), proving the offset, not
// the mesh, is what we are validating.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Offset.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
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
// Build a radius-`r` icosphere with `subdiv` levels of mid-point subdivision.
// subdiv=0 => 12 verts / 20 faces; each level multiplies faces by 4. All faces
// are CCW-wound as seen from OUTSIDE (outward normals), so signedVolume() > 0.
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

    // Midpoint cache keyed by the ordered pair of endpoint indices.
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

    // Project every vertex onto the sphere of radius r.
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

static bool validClosed(const HalfEdgeMesh& m) { return m.validate().isValid(); }
static double sphereVol(double r) { return (4.0 / 3.0) * M_PI * r * r * r; }

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };

    std::printf("=== forge::native::mesh offsetMesh gate (uniform vertex-normal offset/shell) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    int fakes = 0;
    auto countFake = [&](const OffsetResult& r) {
        if (r.ok && !validClosed(r.mesh)) ++fakes;
    };

    // ── (G/M/S) sphere offset volume law: enclosed vol ≈ (4/3)π(r+d)^3 ────────
    // The icosphere chord error makes a level-L sphere of radius r enclose
    // ~r^3·(1 - k/4^L) of the analytic volume. We compute the realized
    // input-volume ratio empirically and require the OFFSET output to obey the
    // SAME ratio against (r+d)^3 — i.e. the offset reproduces the analytic law to
    // within the mesh's own chord error plus a small slack. This proves the
    // OFFSET (not the tessellation) within a coarse-mesh tolerance.
    std::printf("[G] unit-ish sphere offset volume law  vol(out) ~ (4/3)pi(r+d)^3  (coarse-mesh tol)\n");
    for (int subdiv : {2, 3}) {
        const double r = uni(0.85, 1.25);                 // random radius near unity
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(r, subdiv, pos, idx);

        HalfEdgeMesh base; base.buildFromSoup(pos, idx);
        const double volIn  = base.signedVolume();
        const double ratio  = volIn / sphereVol(r);        // realized fill fraction < 1
        // coarse-mesh tol: how far the *analytic* prediction may sit from the
        // *meshed* output, expressed as a relative volume tolerance. The mesh
        // under-fills by (1-ratio); we allow that plus 1.5% slack for the offset
        // surface curvature change. Tighter for finer mesh => validates the offset.
        const double relTol = (1.0 - ratio) + 0.015;

        // grow distances and shrink distances (shrink kept safely above collapse).
        for (double d : { 0.0, uni(0.15, 0.45), -uni(0.15, 0.40), uni(0.05, 0.10), -uni(0.05, 0.10) }) {
            OffsetResult res = offsetMesh(pos, idx, d);
            countFake(res);
            const double predicted = sphereVol(r + d);
            const double got       = res.ok ? res.mesh.signedVolume() : 0.0;
            const double rel       = std::fabs(got - predicted) / predicted;
            check(res.ok && validClosed(res.mesh),
                  "(G/M) L%d r=%.3f d=%+.3f -> closed 2-manifold (%s)",
                  subdiv, r, d, res.ok ? "ok" : res.reason);
            check(res.ok && rel <= relTol,
                  "(G) L%d r=%.3f d=%+.3f vol=%.5f ~ (4/3)pi(r+d)^3=%.5f  rel=%.4f<=tol=%.4f",
                  subdiv, r, d, got, predicted, rel, relTol);
        }
    }
    std::printf("\n");

    // ── (G-refine) the offset volume error must SHRINK as the mesh refines ────
    // Same r and d across two tessellation levels; the finer mesh must track the
    // analytic (r+d)^3 volume STRICTLY better — proving the residual is the
    // tessellation chord error, not an offset bias.
    std::printf("[G-refine] offset volume error decreases under refinement (offset is unbiased)\n");
    {
        const double r = 1.0, d = 0.30;
        double prevErr = 1e9;
        bool monotone = true;
        for (int subdiv : {1, 2, 3, 4}) {
            std::vector<double> pos; std::vector<std::uint32_t> idx;
            icosphere(r, subdiv, pos, idx);
            OffsetResult res = offsetMesh(pos, idx, d);
            countFake(res);
            if (!res.ok) { monotone = false; break; }
            const double err = std::fabs(res.mesh.signedVolume() - sphereVol(r + d)) / sphereVol(r + d);
            std::printf("    L%d  rel-err=%.5f\n", subdiv, err);
            if (err >= prevErr) monotone = false;
            prevErr = err;
        }
        check(monotone, "(G-refine) offset rel-err strictly decreases L1>L2>L3>L4 (converges to analytic)");
    }
    std::printf("\n");

    // ── (S) negative d (shrink) handled: valid smaller solid, vol(out)<vol(in) ─
    std::printf("[S] shrink (d<0) yields a VALID smaller closed solid (not breached)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        HalfEdgeMesh base; base.buildFromSoup(pos, idx);
        const double volIn = base.signedVolume();
        OffsetResult res = offsetMesh(pos, idx, -0.35);
        countFake(res);
        check(res.ok && validClosed(res.mesh), "(S) shrink -0.35 -> closed 2-manifold (%s)",
              res.ok ? "ok" : res.reason);
        check(res.ok && res.mesh.signedVolume() < volIn && res.mesh.signedVolume() > 0.0,
              "(S) shrink reduces volume %.4f -> %.4f (still positive)",
              volIn, res.ok ? res.mesh.signedVolume() : 0.0);
        check(res.ok && std::fabs(res.mesh.signedVolume() - sphereVol(0.65)) / sphereVol(0.65) <= 0.03,
              "(S) shrunk vol ~ (4/3)pi(0.65)^3 = %.5f", sphereVol(0.65));
    }
    std::printf("\n");

    // ── (C) over-shrink collapse => HONEST ok=false (never fabricated) ────────
    std::printf("[C] over-shrink collapse returns HONEST ok=false (0 fakes)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.0, 3, pos, idx);
        // d = -1.0 == -r drives every vertex to (or through) the centre.
        for (double d : { -1.0, -1.5, -2.0 }) {
            OffsetResult res = offsetMesh(pos, idx, d);
            countFake(res);
            check(!res.ok, "(C) d=%+.2f (|d|>=r) collapses -> ok=false [%s]",
                  d, res.ok ? "FABRICATED!" : res.reason);
        }
    }
    std::printf("\n");

    // ── (Z) d == 0 is a faithful no-op ────────────────────────────────────────
    std::printf("[Z] d==0 is a faithful no-op (volume unchanged)\n");
    {
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        icosphere(1.1, 2, pos, idx);
        HalfEdgeMesh base; base.buildFromSoup(pos, idx);
        OffsetResult res = offsetMesh(pos, idx, 0.0);
        countFake(res);
        check(res.ok && std::fabs(res.mesh.signedVolume() - base.signedVolume()) < 1e-12,
              "(Z) d=0 keeps vol exactly (%.8f)", base.signedVolume());
    }
    std::printf("\n");

    // ── (M-cube) a non-sphere closed solid (cube) also offsets to a valid solid ─
    // The vertex-normal offset is NOT just a sphere trick — a unit cube grows to a
    // larger valid closed 2-manifold (corners under-fill vs a true Minkowski
    // offset, which is the documented honest limit, but topology stays sound).
    std::printf("[M-cube] unit cube grows to a valid closed 2-manifold (topology sound)\n");
    {
        const double s = 1.0;
        std::vector<double> pos = {
            0,0,0, s,0,0, s,s,0, 0,s,0, 0,0,s, s,0,s, s,s,s, 0,s,s };
        std::vector<std::uint32_t> idx = {
            0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
            1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7 };
        OffsetResult res = offsetMesh(pos, idx, 0.2);
        countFake(res);
        check(res.ok && validClosed(res.mesh), "(M-cube) cube grow +0.2 -> closed 2-manifold (%s)",
              res.ok ? "ok" : res.reason);
        check(res.ok && res.mesh.signedVolume() > 1.0,
              "(M-cube) cube grew: vol %.4f > 1.0", res.ok ? res.mesh.signedVolume() : 0.0);
    }
    std::printf("\n");

    // ── (R) degenerate / unsupported input => honest ok=false ─────────────────
    std::printf("[R] degenerate / non-closed / bad input returns honest ok=false\n");
    {
        // (R1) ragged positions length
        OffsetResult r1 = offsetMesh({0,0,0, 1,0}, {0,1,2}, 0.1); countFake(r1);
        check(!r1.ok, "(R1) ragged positions -> ok=false [%s]", r1.reason);

        // (R2) empty input
        OffsetResult r2 = offsetMesh({}, {}, 0.1); countFake(r2);
        check(!r2.ok, "(R2) empty input -> ok=false [%s]", r2.reason);

        // (R3) open mesh (single triangle: not closed) -> not a 2-manifold solid
        OffsetResult r3 = offsetMesh({0,0,0, 1,0,0, 0,1,0}, {0,1,2}, 0.1); countFake(r3);
        check(!r3.ok, "(R3) open single triangle -> ok=false [%s]", r3.reason);

        // (R4) index out of range
        OffsetResult r4 = offsetMesh({0,0,0, 1,0,0, 0,1,0}, {0,1,9}, 0.1); countFake(r4);
        check(!r4.ok, "(R4) out-of-range index -> ok=false [%s]", r4.reason);
    }
    std::printf("\n");

    // ── (F) 0-FAKES invariant ─────────────────────────────────────────────────
    std::printf("[F] 0-FAKES invariant across ALL cases above\n");
    check(fakes == 0, "(F) 0 FAKES — ok==true ALWAYS implies a validated closed 2-manifold (got %d)", fakes);

    std::printf("\n=== HONEST ENVELOPE ===\n");
    std::printf("=== ROBUST: uniform vertex-normal offset of a closed 2-manifold by signed d; sphere\n");
    std::printf("===         enclosed-volume law (4/3)pi(r+d)^3 met within coarse-mesh tol and the\n");
    std::printf("===         residual SHRINKS under refinement (offset unbiased); shrink (d<0) gives a\n");
    std::printf("===         valid smaller solid; topology stays 2-manifold; cube/non-sphere supported.\n");
    std::printf("=== ok=FALSE (honest, never fabricated): non-closed/bad/degenerate input; zero-area\n");
    std::printf("===         vertex normal; over-shrink collapse (volume sign flip / ~0 volume / ANY\n");
    std::printf("===         face inversion = local self-intersection). NOT a Minkowski offset: convex\n");
    std::printf("===         edges/corners under-fill and gross self-intersection is REJECTED, not rounded.\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
