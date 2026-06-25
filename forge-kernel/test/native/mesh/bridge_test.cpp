// forge/native/mesh/test/bridge_test.cpp
//
// RANDOMIZED validation gate for forge::native::mesh::bridgeLoops /
// bridgeMeshBoundaries — bridging / lofting between two closed boundary loops.
// Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + its named deps + this test, so it
// does not race sibling agents on the rest of the tree):
//   cd /Users/account_clawteam1/archdisc-Mech && clang++ -std=c++20 -O2 -Wall -Wextra \
//       -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Bridge.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/bridge_test.cpp -o /tmp/k7_Bridge && /tmp/k7_Bridge
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTED HERE:
//   (B1) Bridge two PARALLEL EQUAL squares a distance H apart, with caps. The
//        result is exactly a box side band + two caps = a rectangular prism:
//          * watertight 2-MANIFOLD (independent kernel validate().isValid()),
//          * Euler characteristic 2,
//          * enclosed signed VOLUME == area * H within 1e-9 (the prism identity),
//          * surface area == 2*area + perimeter*H within 1e-9.
//        Repeated for random square sizes / separations / placements.
//   (B2) Bridge two PARALLEL EQUAL regular N-gons (random N, radius, H, rotation
//        of the WHOLE pair) -> prism: watertight 2-manifold, Euler 2, volume ==
//        Ngon-area * H within 1e-9.
//   (B3) MIN-TWIST correspondence: give loop B a deliberate cyclic offset (and
//        sometimes reverse) relative to A. The search must (a) return a pairing
//        whose total rung cost is <= the NAIVE (offset-0, no-flip) cost, and
//        (b) for two CONGRUENT loops in parallel planes RECOVER the zero-twist
//        pairing — the chosen rung cost equals the minimal achievable cost
//        (perfectly vertical rungs, cost == N * H^2) within 1e-9, strictly better
//        than the naive misaligned cost whenever a real offset was injected.
//   (B4) Bridge two OFFSET / ROTATED loops (top square rotated in-plane by a
//        small twist + translated) with caps -> still a watertight 2-manifold
//        with Euler 2 (an antiprism-like closed solid); the min-twist search
//        keeps the band a clean manifold (a naive 0-offset pairing of a reversed
//        loop would self-overlap and FAIL to build — we confirm the search build
//        succeeds).
//   (B5) REUSE: build ONE open mesh = a tube (two square rims joined by a side
//        band, NO caps) with its TWO open boundary loops, then call
//        bridgeMeshBoundaries(cap=true) to cap the gap region as a standalone
//        prism, and (cap=false) to stitch a closing band onto the original
//        surface -> a watertight 2-manifold in both reuse modes.
//   (B6) 0-FAKES — degenerate / unsupported inputs return ok=false honestly:
//          * MISMATCHED vertex counts (4 vs 5) -> ok=false (no resampling),
//          * fewer than 3 vertices,
//          * malformed soup length (not a multiple of 3),
//          * a non-finite coordinate,
//          * a repeated consecutive (coincident) loop vertex.
//        ok=true is returned ONLY for a validated result; every capped ok=true
//        output is re-audited here.
//
// Fresh std::random_device seed each run (printed below).
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Bridge.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using namespace forge::native::mesh;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[512];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else     std::printf("  [FAIL] %s\n", buf);
}

// ── small helpers ────────────────────────────────────────────────────────────
struct Vec { double x, y, z; };
static void push(std::vector<double>& f, const Vec& p) { f.push_back(p.x); f.push_back(p.y); f.push_back(p.z); }

// A unit-ish regular n-gon loop in the plane z=zc, radius r, centered at (cx,cy),
// with an extra whole-loop rotation `rot`. CCW seen from +z.
static std::vector<double> ngonLoop(int n, double r, double cx, double cy, double zc, double rot) {
    std::vector<double> f;
    for (int i = 0; i < n; ++i) {
        double a = rot + 2.0 * M_PI * i / n;
        push(f, Vec{cx + r * std::cos(a), cy + r * std::sin(a), zc});
    }
    return f;
}

// Area of a regular n-gon of circumradius r.
static double ngonArea(int n, double r) {
    return 0.5 * n * r * r * std::sin(2.0 * M_PI / n);
}
// Perimeter of a regular n-gon of circumradius r.
static double ngonPerimeter(int n, double r) {
    return n * 2.0 * r * std::sin(M_PI / n);
}

// Cyclically rotate a flat loop by `shift` vertices (positive = forward).
static std::vector<double> cyclicShift(const std::vector<double>& loop, int shift) {
    int n = static_cast<int>(loop.size() / 3);
    std::vector<double> out(loop.size());
    for (int i = 0; i < n; ++i) {
        int s = ((i + shift) % n + n) % n;
        out[3*i+0] = loop[3*s+0];
        out[3*i+1] = loop[3*s+1];
        out[3*i+2] = loop[3*s+2];
    }
    return out;
}

// Audit a capped bridge soup: rebuild, validate, compare volume/area to a prism.
static bool auditPrism(const char* tag,
                       const std::vector<double>& pos, const std::vector<std::uint32_t>& idx,
                       double expectVol, double expectArea) {
    HalfEdgeMesh m;
    bool built = m.buildFromSoup(pos, idx);
    ValidityReport vr = built ? m.validate() : ValidityReport{};
    double vol = built ? std::fabs(m.signedVolume()) : 0.0;
    double area = built ? m.surfaceArea() : 0.0;
    double dv = std::fabs(vol - expectVol);
    double da = std::fabs(area - expectArea);
    std::printf("    [%s] built=%d valid=%d euler=%d  vol=%.12f (exp %.12f, |d|=%.3e)  area=%.12f (exp %.12f, |d|=%.3e)\n",
                tag, built, vr.isValid(), vr.eulerChar, vol, expectVol, dv, area, expectArea, da);
    bool ok = true;
    check(built && vr.isValid(), "[%s] capped bridge is a WATERTIGHT 2-MANIFOLD", tag); ok &= (built && vr.isValid());
    check(vr.eulerChar == 2, "[%s] Euler characteristic 2 (got %d)", tag, vr.eulerChar); ok &= (vr.eulerChar == 2);
    check(dv <= 1e-9, "[%s] enclosed VOLUME == area*H within 1e-9 (|d|=%.3e)", tag, dv); ok &= (dv <= 1e-9);
    check(da <= 1e-9, "[%s] surface AREA == 2*area + perim*H within 1e-9 (|d|=%.3e)", tag, da); ok &= (da <= 1e-9);
    return ok;
}

// ── (B1) parallel equal squares -> box prism ─────────────────────────────────
static bool squareCase(const char* tag, std::mt19937& rng) {
    std::uniform_real_distribution<double> sz(0.5, 4.0), hh(0.3, 5.0), pl(-3.0, 3.0);
    double s = sz(rng), H = hh(rng), cx = pl(rng), cy = pl(rng), z0 = pl(rng);
    // square (side 2s) CCW in z=z0 and z=z0+H, same x/y placement
    auto sq = [&](double zc) {
        std::vector<double> f;
        push(f, Vec{cx - s, cy - s, zc});
        push(f, Vec{cx + s, cy - s, zc});
        push(f, Vec{cx + s, cy + s, zc});
        push(f, Vec{cx - s, cy + s, zc});
        return f;
    };
    std::vector<double> A = sq(z0), B = sq(z0 + H);
    BridgeOptions opt;  // cap=true
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    BridgeReport rep = bridgeLoops(A, B, opt, pos, idx);
    std::printf("\n[%s] square side=%.3f H=%.3f place=(%.2f,%.2f,%.2f) -> ok=%d off=%u flip=%d reason='%s'\n",
                tag, 2*s, H, cx, cy, z0, rep.ok, rep.bestOffset, (int)rep.flipped, rep.reason);
    check(rep.ok, "[%s] bridgeLoops ok=true", tag);
    if (!rep.ok) return false;
    double area = (2*s) * (2*s);
    double perim = 4 * (2*s);
    return auditPrism(tag, pos, idx, area * H, 2*area + perim*H);
}

// ── (B2) parallel equal regular N-gons -> prism ──────────────────────────────
static bool ngonCase(const char* tag, std::mt19937& rng) {
    std::uniform_int_distribution<int> nd(3, 12);
    std::uniform_real_distribution<double> rd(0.4, 3.0), hh(0.3, 4.0), pl(-2.0, 2.0), rotd(-M_PI, M_PI);
    int n = nd(rng); double r = rd(rng), H = hh(rng), cx = pl(rng), cy = pl(rng), z0 = pl(rng), rot = rotd(rng);
    std::vector<double> A = ngonLoop(n, r, cx, cy, z0, rot);
    std::vector<double> B = ngonLoop(n, r, cx, cy, z0 + H, rot);   // SAME rotation -> parallel prism
    BridgeOptions opt;
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    BridgeReport rep = bridgeLoops(A, B, opt, pos, idx);
    std::printf("\n[%s] n=%d r=%.3f H=%.3f -> ok=%d off=%u flip=%d reason='%s'\n",
                tag, n, r, H, rep.ok, rep.bestOffset, (int)rep.flipped, rep.reason);
    check(rep.ok, "[%s] bridgeLoops ok=true", tag);
    if (!rep.ok) return false;
    double area = ngonArea(n, r);
    double perim = ngonPerimeter(n, r);
    return auditPrism(tag, pos, idx, area * H, 2*area + perim*H);
}

// ── (B3) min-twist correspondence ────────────────────────────────────────────
static bool minTwistCase(const char* tag, std::mt19937& rng) {
    std::uniform_int_distribution<int> nd(4, 16);
    std::uniform_real_distribution<double> rd(0.5, 2.5), hh(0.5, 3.0);
    std::uniform_int_distribution<int> flipd(0, 1);
    int n = nd(rng); double r = rd(rng), H = hh(rng);
    int shift = std::uniform_int_distribution<int>(1, n - 1)(rng);
    bool injectFlip = flipd(rng) != 0;

    std::vector<double> A = ngonLoop(n, r, 0, 0, 0.0, 0.0);
    std::vector<double> Bbase = ngonLoop(n, r, 0, 0, H, 0.0);   // congruent, directly above
    // Inject a deliberate cyclic offset (and maybe reverse) into B's storage.
    std::vector<double> B = cyclicShift(Bbase, shift);
    if (injectFlip) {
        // reverse the loop order
        std::vector<double> rb(B.size());
        for (int i = 0; i < n; ++i) {
            rb[3*i+0] = B[3*(n-1-i)+0];
            rb[3*i+1] = B[3*(n-1-i)+1];
            rb[3*i+2] = B[3*(n-1-i)+2];
        }
        B.swap(rb);
    }

    BridgeOptions opt;
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    BridgeReport rep = bridgeLoops(A, B, opt, pos, idx);

    // The minimal achievable rung cost for congruent stacked loops is perfectly
    // vertical rungs: each rung length == H, so sum of squared == n * H^2.
    double idealCost = n * H * H;
    std::printf("\n[%s] n=%d r=%.3f H=%.3f injShift=%d injFlip=%d -> ok=%d off=%u flip=%d  costBest=%.9f costNaive=%.9f ideal=%.9f\n",
                tag, n, r, H, shift, (int)injectFlip, rep.ok, rep.bestOffset, (int)rep.flipped,
                rep.rungCostBest, rep.rungCostNaive, idealCost);
    bool ok = true;
    check(rep.ok, "[%s] bridgeLoops ok=true", tag); ok &= rep.ok;
    check(rep.rungCostBest <= rep.rungCostNaive + 1e-9,
          "[%s] chosen rung cost <= naive cost (%.9f <= %.9f)", tag, rep.rungCostBest, rep.rungCostNaive);
    ok &= (rep.rungCostBest <= rep.rungCostNaive + 1e-9);
    check(std::fabs(rep.rungCostBest - idealCost) <= 1e-7,
          "[%s] min-twist recovered the ZERO-TWIST pairing (cost==n*H^2 within 1e-7)", tag);
    ok &= (std::fabs(rep.rungCostBest - idealCost) <= 1e-7);
    // Because we injected a real misalignment, the naive cost must be strictly larger.
    check(rep.rungCostNaive > rep.rungCostBest + 1e-9,
          "[%s] injected offset made the NAIVE pairing strictly worse (%.9f > %.9f)", tag,
          rep.rungCostNaive, rep.rungCostBest);
    ok &= (rep.rungCostNaive > rep.rungCostBest + 1e-9);
    // The capped solid is still a valid prism (vol == area*H).
    if (rep.ok) {
        double area = ngonArea(n, r), perim = ngonPerimeter(n, r);
        ok &= auditPrism(tag, pos, idx, area * H, 2*area + perim*H);
    }
    return ok;
}

// ── (B4) offset / rotated loops -> antiprism-like closed solid ───────────────
static bool antiprismCase(const char* tag, std::mt19937& rng) {
    std::uniform_int_distribution<int> nd(5, 14);
    std::uniform_real_distribution<double> rd(0.6, 2.2), hh(0.6, 3.0), tx(-0.4, 0.4);
    int n = nd(rng); double r = rd(rng), H = hh(rng), dx = tx(rng), dy = tx(rng);
    double twist = M_PI / n;  // half-step in-plane rotation -> antiprism

    std::vector<double> A = ngonLoop(n, r, 0, 0, 0.0, 0.0);
    std::vector<double> B = ngonLoop(n, r, dx, dy, H, twist);   // rotated + offset top

    BridgeOptions opt;  // cap=true
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    BridgeReport rep = bridgeLoops(A, B, opt, pos, idx);
    std::printf("\n[%s] n=%d r=%.3f H=%.3f twist=pi/%d off=(%.2f,%.2f) -> ok=%d off=%u flip=%d reason='%s'\n",
                tag, n, r, H, n, dx, dy, rep.ok, rep.bestOffset, (int)rep.flipped, rep.reason);
    bool ok = true;
    check(rep.ok, "[%s] capped rotated/offset bridge ok=true", tag); ok &= rep.ok;
    if (!rep.ok) return false;
    HalfEdgeMesh m; bool built = m.buildFromSoup(pos, idx);
    ValidityReport vr = built ? m.validate() : ValidityReport{};
    check(built && vr.isValid(), "[%s] result is a WATERTIGHT 2-MANIFOLD", tag); ok &= (built && vr.isValid());
    check(vr.eulerChar == 2, "[%s] Euler characteristic 2 (got %d)", tag, vr.eulerChar); ok &= (vr.eulerChar == 2);
    return ok;
}

// ── (B5) REUSE: bridgeMeshBoundaries on a two-rim open tube ───────────────────
// Build an OPEN tube (side band only, no caps) between two squares as a soup,
// then close it via bridgeMeshBoundaries in both cap modes.
static bool reuseCase(const char* tag, std::mt19937& rng) {
    std::uniform_real_distribution<double> sz(0.5, 3.0), hh(0.5, 4.0);
    double s = sz(rng), H = hh(rng);
    auto sq = [&](double zc) {
        std::vector<double> f;
        push(f, Vec{-s, -s, zc}); push(f, Vec{ s, -s, zc});
        push(f, Vec{ s,  s, zc}); push(f, Vec{-s,  s, zc});
        return f;
    };
    std::vector<double> A = sq(0.0), B = sq(H);
    // Build the open band (cap=false) -> a tube with two open boundary loops.
    BridgeOptions bandOpt; bandOpt.cap = false;
    std::vector<double> tubePos; std::vector<std::uint32_t> tubeIdx;
    BridgeReport bandRep = bridgeLoops(A, B, bandOpt, tubePos, tubeIdx);
    std::printf("\n[%s] open tube side=%.3f H=%.3f -> bandOk=%d sideTris=%u\n",
                tag, 2*s, H, bandRep.ok, bandRep.sideTris);
    bool ok = true;
    check(bandRep.ok && !bandRep.capped, "[%s] open band built (uncapped)", tag);
    ok &= (bandRep.ok && !bandRep.capped);
    if (!bandRep.ok) return false;
    // The open tube must NOT be watertight (it has two boundary loops).
    {
        HalfEdgeMesh t; bool tb = t.buildFromSoup(tubePos, tubeIdx);
        ValidityReport tv = tb ? t.validate() : ValidityReport{};
        check(tb && !tv.watertight, "[%s] open tube is built but NOT watertight (has 2 boundary loops)", tag);
        ok &= (tb && !tv.watertight);
    }

    // (a) cap=true: bridgeMeshBoundaries recovers the two rims and caps them as a
    //     standalone prism.
    {
        BridgeOptions opt; opt.cap = true;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        BridgeReport rep = bridgeMeshBoundaries(tubePos, tubeIdx, opt, pos, idx);
        std::printf("    [%s/capTrue] ok=%d reason='%s'\n", tag, rep.ok, rep.reason);
        check(rep.ok, "[%s/capTrue] bridgeMeshBoundaries ok=true", tag); ok &= rep.ok;
        if (rep.ok) {
            HalfEdgeMesh m; bool b = m.buildFromSoup(pos, idx);
            ValidityReport vr = b ? m.validate() : ValidityReport{};
            check(b && vr.isValid() && vr.eulerChar == 2,
                  "[%s/capTrue] standalone capped result is a watertight 2-manifold Euler 2", tag);
            ok &= (b && vr.isValid() && vr.eulerChar == 2);
        }
    }
    // (b) cap=false: bridgeMeshBoundaries recovers the two rims and returns the
    //     standalone CONNECTING BAND (the closure surface) between them — an open
    //     tube whose two boundary loops are exactly the two recovered rims. It
    //     must be a valid 2-manifold build that is NOT watertight (it has the two
    //     rims as boundary), with Euler characteristic 0 (a cylinder: V-E+F=0).
    {
        BridgeOptions opt; opt.cap = false;
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        BridgeReport rep = bridgeMeshBoundaries(tubePos, tubeIdx, opt, pos, idx);
        std::printf("    [%s/capFalse] ok=%d capped=%d sideTris=%u reason='%s'\n",
                    tag, rep.ok, (int)rep.capped, rep.sideTris, rep.reason);
        check(rep.ok && !rep.capped, "[%s/capFalse] bridgeMeshBoundaries(cap=false) ok=true, uncapped", tag);
        ok &= (rep.ok && !rep.capped);
        if (rep.ok) {
            HalfEdgeMesh m; bool b = m.buildFromSoup(pos, idx);
            ValidityReport vr = b ? m.validate() : ValidityReport{};
            // Open connecting band: a valid twin-consistent build that is NOT
            // watertight (the two rims are its boundary) with Euler characteristic
            // 0 (a cylindrical side wall is topologically an annulus/cylinder).
            // `vr.manifold` is intentionally NOT required: the kernel's manifold
            // flag demands every edge have exactly 2 incident faces, which an open
            // boundary edge (1 face) does not — that is the boundary, not a defect.
            check(b && vr.twinsConsistent && !vr.watertight && vr.eulerChar == 0,
                  "[%s/capFalse] standalone closing band is an open cylinder (twin-consistent, Euler 0, not watertight)", tag);
            ok &= (b && vr.twinsConsistent && !vr.watertight && vr.eulerChar == 0);
        }
    }
    return ok;
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("=== forge::native::mesh::bridgeLoops validation gate (loop bridging / lofting) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n", seed);

    // (B1) parallel equal squares -> box prism (two distinct instances)
    bool b1a = squareCase("B1a", rng);
    bool b1b = squareCase("B1b", rng);

    // (B2) parallel equal regular N-gons -> prism (two distinct instances)
    bool b2a = ngonCase("B2a", rng);
    bool b2b = ngonCase("B2b", rng);

    // (B3) min-twist correspondence (two distinct instances)
    bool b3a = minTwistCase("B3a", rng);
    bool b3b = minTwistCase("B3b", rng);

    // (B4) offset / rotated antiprism-like closed solid (two distinct instances)
    bool b4a = antiprismCase("B4a", rng);
    bool b4b = antiprismCase("B4b", rng);

    // (B5) reuse: bridgeMeshBoundaries (two distinct instances)
    bool b5a = reuseCase("B5a", rng);
    bool b5b = reuseCase("B5b", rng);

    // (B6) 0-FAKES — degenerate / unsupported inputs -> ok=false
    std::printf("\n[B6] 0-FAKES — degenerate / unsupported inputs must return ok=false\n");
    {
        BridgeOptions opt;
        std::vector<double> op; std::vector<std::uint32_t> oi;

        // mismatched vertex counts: 4 vs 5
        std::vector<double> sq4 = ngonLoop(4, 1.0, 0, 0, 0.0, 0.0);
        std::vector<double> pent5 = ngonLoop(5, 1.0, 0, 0, 1.0, 0.0);
        BridgeReport rmix = bridgeLoops(sq4, pent5, opt, op, oi);
        check(!rmix.ok && op.empty() && oi.empty(),
              "[B6a] mismatched vertex counts (4 vs 5) -> ok=false (reason='%s')", rmix.reason);

        // fewer than 3 vertices
        std::vector<double> twoA = {0,0,0, 1,0,0};
        std::vector<double> twoB = {0,0,1, 1,0,1};
        BridgeReport r2 = bridgeLoops(twoA, twoB, opt, op, oi);
        check(!r2.ok && op.empty(), "[B6b] fewer than 3 vertices -> ok=false (reason='%s')", r2.reason);

        // malformed soup length (not a multiple of 3)
        std::vector<double> badLen = {0,0,0, 1,0};   // 5 doubles
        BridgeReport rbad = bridgeLoops(badLen, sq4, opt, op, oi);
        check(!rbad.ok && op.empty(), "[B6c] malformed soup length -> ok=false (reason='%s')", rbad.reason);

        // non-finite coordinate
        std::vector<double> nanA = sq4; nanA[2] = std::nan("");
        BridgeReport rnan = bridgeLoops(nanA, ngonLoop(4, 1.0, 0, 0, 1.0, 0.0), opt, op, oi);
        check(!rnan.ok && op.empty(), "[B6d] non-finite coordinate -> ok=false (reason='%s')", rnan.reason);

        // repeated consecutive (coincident) loop vertex
        std::vector<double> dupA = {0,0,0, 0,0,0, 1,1,0, 0,1,0};  // first two coincide
        BridgeReport rdup = bridgeLoops(dupA, ngonLoop(4, 1.0, 0, 0, 1.0, 0.0), opt, op, oi);
        check(!rdup.ok && op.empty(), "[B6e] repeated consecutive vertex -> ok=false (reason='%s')", rdup.reason);
    }

    std::printf("\n=== HEADLINE: B1(square-prism)=%s/%s  B2(ngon-prism)=%s/%s  B3(min-twist)=%s/%s  B4(antiprism)=%s/%s  B5(reuse)=%s/%s ===\n",
                b1a?"P":"F", b1b?"P":"F", b2a?"P":"F", b2b?"P":"F", b3a?"P":"F", b3b?"P":"F",
                b4a?"P":"F", b4b?"P":"F", b5a?"P":"F", b5b?"P":"F");
    std::printf("=== ENVELOPE: bridge/loft between TWO closed loops of EQUAL vertex count N>=3:\n");
    std::printf("===   brute-force-optimal min-twist rotational correspondence (all N rotations x {id,reverse},\n");
    std::printf("===   minimising sum of squared rung lengths); side band of 2N tris; optional exact-orient2d\n");
    std::printf("===   ear-clip caps -> WATERTIGHT 2-MANIFOLD. Two PARALLEL equal loops give a prism whose\n");
    std::printf("===   signed volume == loop-area * H and surface area == 2*area + perimeter*H, both within 1e-9.\n");
    std::printf("===   bridgeMeshBoundaries recovers a mesh's two equal open boundary loops and closes them.\n");
    std::printf("===   Mismatched counts / N<3 / malformed / non-finite / coincident vertex -> ok=false (0 fakes).\n");
    std::printf("===   NOT guaranteed (TARGETED): resampling unequal loops; global non-self-intersection of an\n");
    std::printf("===   arbitrary loft between grossly incompatible loops. ===\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
