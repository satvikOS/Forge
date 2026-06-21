// forge/native/mesh/test/inset_test.cpp
//
// RANDOMIZED standalone gate for forge::native::mesh::insetFaces — the per-face
// centroid INSET op on a polygon soup. Pure C++20, no external deps.
//
// Build + run (standalone — ONLY this module + named deps, not the whole tree):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/mesh/Inset.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//       forge-kernel/test/native/mesh/inset_test.cpp -o /tmp/k6_Inset && /tmp/k6_Inset
//
// ─────────────────────────────────────────────────────────────────────────────
// SPEC ASSERTIONS (per task brief):
//   (A)  Insetting the 6 faces of a box of side L by d yields, PER FACE, an inner
//        face whose area == factor^2 · L^2 within 1e-9, where factor=(1-2d/L)
//        (a square scaled about its centroid) — the reduced-area law.
//   (B)  Each inset face produces a BORDER RING of 4 quads whose total area ==
//        L^2 - innerArea (surface area is conserved: ring + inner == original).
//   (V)  The total surface VERTEX COUNT grows correctly: by exactly Σ(face
//        valence) new inset vertices (4 per box face -> +24 over the 8 corners).
//   (F)  The result FACE COUNT grows correctly: each inset face -> (valence ring
//        quads) + (1 inner face) in place of 1 original face.
//   (C)  d >= L/2 (>= half the smallest face extent) is REJECTED/CLAMPED honestly
//        per face (rejected, passed through unchanged, REPORTED) — never a
//        collapsed/inverted panel; with ALL faces rejected and d>0, ok=false.
//   (Z)  d == 0 is a faithful no-op (ok=true, mesh unchanged).
//   (R)  Degenerate / out-of-range / empty / negative-d input -> honest ok=false.
//   (P)  An n-gon (regular polygon) face also insets with the centroid-scaling
//        area law (not just squares).
//   (X)  0-FAKES invariant: every ACCEPTED face has 0 < factor < 1, a strictly
//        smaller inner area, and a non-degenerate ring — across ALL cases.
//
// Randomized each run (fresh std::random_device seed) so nothing is cherry-picked.
// ─────────────────────────────────────────────────────────────────────────────

#include "forge/native/mesh/Inset.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using namespace forge::native::mesh;

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* fmt, ...) {
    ++g_total;
    char buf[320];
    va_list ap; va_start(ap, fmt); std::vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", buf); }
    else    std::printf("  [FAIL] %s\n", buf);
}

// Build a flat regular n-gon face (radius r) in the z=0 plane, CCW from +z.
static PolyMesh makeRegularNgon(int n, double r) {
    PolyMesh m;
    std::vector<std::uint32_t> loop;
    for (int i = 0; i < n; ++i) {
        const double a = 2.0 * M_PI * static_cast<double>(i) / static_cast<double>(n);
        m.positions.push_back(r * std::cos(a));
        m.positions.push_back(r * std::sin(a));
        m.positions.push_back(0.0);
        loop.push_back(static_cast<std::uint32_t>(i));
    }
    m.faces.push_back(loop);
    return m;
}

// 0-FAKES auditor: confirm every face that was ACTUALLY inset (a real border
// ring was emitted, ringBegin set) is a true strict centroid shrink. Rejected
// faces and d==0 no-op pass-throughs (no ring) are not inset and not audited.
static int auditAccepted(const InsetResult& res) {
    int fakes = 0;
    if (!res.ok) return 0;
    for (const auto& fi : res.faceInfo) {
        if (fi.rejected) continue;
        if (fi.ringBegin == kInvalid) continue;   // d==0 no-op: not an inset face
        const bool factorOk = (fi.factor > 0.0 && fi.factor < 1.0);
        const bool shrunk   = (fi.innerArea < fi.originalArea);
        const bool ringOk   = (fi.ringArea > 0.0);
        if (!(factorOk && shrunk && ringOk)) ++fakes;
    }
    return fakes;
}

int main() {
    std::random_device rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);
    std::uniform_real_distribution<double> U(0.0, 1.0);
    auto uni = [&](double lo, double hi) { return lo + (hi - lo) * U(rng); };

    std::printf("=== forge::native::mesh insetFaces gate (per-face centroid inset / paneling) ===\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    int fakes = 0;

    // ── (A/B/V/F) box inset: per-face reduced-area law + ring + counts ───────
    std::printf("[A/B/V/F] box(L) inset by d: inner area == (1-2d/L)^2 L^2; ring conserves area; counts grow\n");
    for (int trial = 0; trial < 4; ++trial) {
        const double L = uni(0.6, 4.0);
        const Vec3 origin{uni(-2.0, 2.0), uni(-2.0, 2.0), uni(-2.0, 2.0)};
        // keep d safely below L/2 so every face is accepted
        const double d = uni(0.05, 0.40) * (L * 0.5);   // in (0, L/2)
        const double factor = 1.0 - 2.0 * d / L;
        const double expectInner = factor * factor * L * L;

        PolyMesh box = makeBox(L, origin);
        InsetResult res = insetFaces(box, d);
        fakes += auditAccepted(res);

        check(res.ok, "(A) box L=%.4f d=%.4f -> ok (%s)", L, d, res.ok ? "ok" : res.reason);
        check(res.insetFaces == 6 && res.rejectedFaces == 0,
              "(A) all 6 faces inset, 0 rejected (inset=%u rejected=%u)",
              res.insetFaces, res.rejectedFaces);

        // per-face inner-area law within 1e-9
        bool allArea = true, allRing = true;
        for (const auto& fi : res.faceInfo) {
            if (std::fabs(fi.innerArea - expectInner) > 1e-9) allArea = false;
            // ring conserves: ring + inner == original (== L^2) within 1e-9
            if (std::fabs((fi.ringArea + fi.innerArea) - (L * L)) > 1e-9) allRing = false;
            // factor matches the square law within 1e-12
            if (std::fabs(fi.factor - factor) > 1e-12) allArea = false;
        }
        check(allArea, "(A) every face inner area == (1-2d/L)^2 L^2 = %.10f within 1e-9", expectInner);
        check(allRing, "(B) every face ring area == L^2 - inner = %.10f within 1e-9", L * L - expectInner);

        // (V) vertex count: 8 box corners + 6*4 inset vertices = 32
        check(res.outputVertices == 8u + 6u * 4u,
              "(V) vertex count 8 -> %u (expected 32 = 8 + 6*4 inset)", res.outputVertices);
        // (F) face count: each box face -> 4 ring quads + 1 inner = 5; 6*5 = 30
        check(res.outputFaces == 6u * 5u,
              "(F) face count 6 -> %u (expected 30 = 6*(4 ring + 1 inner))", res.outputFaces);

        // total surface area conserved: outputArea == inputArea (== 6 L^2)
        check(std::fabs(res.outputArea - res.inputArea) < 1e-9 &&
              std::fabs(res.inputArea - 6.0 * L * L) < 1e-9,
              "(B) total area conserved out=%.8f in=%.8f (6L^2=%.8f)",
              res.outputArea, res.inputArea, 6.0 * L * L);
    }
    std::printf("\n");

    // ── (C) d >= L/2 rejected/clamped honestly per face; all-reject => ok=false ─
    std::printf("[C] d >= half smallest face extent: REJECTED honestly (no collapsed/inverted panel)\n");
    {
        const double L = uni(1.0, 3.0);
        PolyMesh box = makeBox(L);
        // d exactly L/2 -> factor == 0 -> reject; d > L/2 -> factor < 0 -> reject.
        for (double mult : { 0.5, 0.75, 1.0, 1.5 }) {
            const double d = mult * L;          // d >= L/2 for all of these (>=0.5L)
            InsetResult res = insetFaces(box, d);
            fakes += auditAccepted(res);
            // every face rejected -> ok=false, all 6 reported as rejected
            check(!res.ok, "(C) d=%.4f (=%.2fL >= L/2) -> ok=false honestly [%s]",
                  d, mult, res.ok ? "FABRICATED!" : res.reason);
            check(res.rejectedFaces == 6 && res.insetFaces == 0,
                  "(C) d=%.4f all 6 faces reported rejected (rejected=%u inset=%u)",
                  d, res.rejectedFaces, res.insetFaces);
            // honesty: every rejected face has a collapsed factor recorded
            // (factor <= 1e-9: at d==L/2 factor is exactly 0 up to rounding; for
            // d>L/2 it is strictly negative — either way the inner face is a
            // collapsed/inverted point and is honestly rejected, not fabricated).
            bool honest = true;
            for (const auto& fi : res.faceInfo)
                if (!(fi.rejected && fi.factor <= 1e-9)) honest = false;
            check(honest, "(C) d=%.4f every rejected face records collapsed factor<=1e-9 (no fake)", d);
        }
    }
    std::printf("\n");

    // ── (C-mixed) a MIX where some faces accept and some reject is honest ─────
    // Build a box of side L, then stretch one pair of faces (a thin slab) so the
    // small faces reject for a d that the big faces still accept.
    std::printf("[C-mixed] a thin slab: small faces reject, big faces accept -> honest mixed report\n");
    {
        const double big = 3.0, thin = 0.30;   // slab thin in z
        // 8 corners of a [0,big]x[0,big]x[0,thin] box
        PolyMesh slab;
        slab.positions = {
            0,0,0,  big,0,0,  big,big,0,  0,big,0,
            0,0,thin, big,0,thin, big,big,thin, 0,big,thin };
        slab.faces = {
            {0,3,2,1}, {4,5,6,7},        // bottom/top: big*big squares
            {0,1,5,4}, {1,2,6,5},        // sides: big x thin rectangles
            {2,3,7,6}, {3,0,4,7} };
        // choose d so big*big faces accept (extent=big -> need d<big/2=1.5) but
        // the side faces (smallest extent == thin=0.30 -> need d<0.15) reject.
        const double d = 0.20;           // 0.15 < d < 1.5
        InsetResult res = insetFaces(slab, d);
        fakes += auditAccepted(res);
        check(res.ok, "(C-mixed) d=%.2f slab -> ok (some accepted) [%s]", d, res.ok ? "ok" : res.reason);
        check(res.insetFaces == 2 && res.rejectedFaces == 4,
              "(C-mixed) 2 big faces inset, 4 thin sides rejected (inset=%u rejected=%u)",
              res.insetFaces, res.rejectedFaces);
    }
    std::printf("\n");

    // ── (Z) d == 0 faithful no-op ─────────────────────────────────────────────
    std::printf("[Z] d==0 is a faithful no-op (mesh unchanged, ok=true)\n");
    {
        const double L = uni(1.0, 2.0);
        PolyMesh box = makeBox(L);
        InsetResult res = insetFaces(box, 0.0);
        fakes += auditAccepted(res);
        check(res.ok && res.outputVertices == 8u && res.outputFaces == 6u,
              "(Z) d=0 keeps 8 verts / 6 faces (%u/%u)", res.outputVertices, res.outputFaces);
        check(res.ok && std::fabs(res.outputArea - 6.0 * L * L) < 1e-9,
              "(Z) d=0 area unchanged %.8f (6L^2=%.8f)", res.outputArea, 6.0 * L * L);
    }
    std::printf("\n");

    // ── (P) regular n-gon inset obeys the centroid-scaling area law ───────────
    std::printf("[P] regular n-gon inset: inner area == factor^2 * original (centroid scaling)\n");
    for (int n : { 3, 5, 6, 8 }) {
        const double r = uni(0.8, 2.0);
        PolyMesh ng = makeRegularNgon(n, r);
        const double origArea = polygonArea(ng.positions, ng.faces[0]);
        // apothem (in-radius) = r*cos(pi/n); extent = 2*apothem; pick d < apothem
        const double apothem = r * std::cos(M_PI / n);
        const double d = uni(0.15, 0.55) * apothem;     // strictly < apothem
        const double factor = 1.0 - 2.0 * d / (2.0 * apothem);  // = 1 - d/apothem
        const double expectInner = factor * factor * origArea;

        InsetResult res = insetFaces(ng, d);
        fakes += auditAccepted(res);
        check(res.ok && res.insetFaces == 1,
              "(P) n=%d r=%.3f d=%.4f -> inset ok (%s)", n, r, d, res.ok ? "ok" : res.reason);
        const double gotInner = res.ok ? res.faceInfo[0].innerArea : -1.0;
        check(res.ok && std::fabs(gotInner - expectInner) < 1e-9,
              "(P) n=%d inner area %.10f == factor^2*orig %.10f within 1e-9", n, gotInner, expectInner);
        // ring conserves the n-gon area
        const double ring = res.ok ? res.faceInfo[0].ringArea : -1.0;
        check(res.ok && std::fabs((ring + gotInner) - origArea) < 1e-9,
              "(P) n=%d ring+inner == orig %.10f within 1e-9", n, origArea);
        // count: 1 face -> n ring quads + 1 inner
        check(res.ok && res.outputFaces == static_cast<std::uint32_t>(n) + 1u,
              "(P) n=%d face count -> %u (n ring + 1 inner)", n, res.outputFaces);
        // count: n original verts + n inset verts
        check(res.ok && res.outputVertices == static_cast<std::uint32_t>(2 * n),
              "(P) n=%d vertex count -> %u (n + n inset)", n, res.outputVertices);
    }
    std::printf("\n");

    // ── (R) degenerate / bad input => honest ok=false ─────────────────────────
    std::printf("[R] degenerate / out-of-range / empty / negative-d input -> honest ok=false\n");
    {
        // (R1) empty input
        InsetResult r1 = insetFaces({}, {}, 0.1);
        check(!r1.ok, "(R1) empty input -> ok=false [%s]", r1.reason);

        // (R2) ragged positions length
        InsetResult r2 = insetFaces({0,0,0, 1,0}, {{0,1}}, 0.1);
        check(!r2.ok, "(R2) ragged positions -> ok=false [%s]", r2.reason);

        // (R3) index out of range
        InsetResult r3 = insetFaces({0,0,0, 1,0,0, 0,1,0}, {{0,1,9}}, 0.1);
        check(!r3.ok, "(R3) out-of-range index -> ok=false [%s]", r3.reason);

        // (R4) negative d
        PolyMesh box = makeBox(2.0);
        InsetResult r4 = insetFaces(box, -0.1);
        check(!r4.ok, "(R4) negative d -> ok=false [%s]", r4.reason);

        // (R5) a single degenerate (collinear / zero-area) face, d>0 -> all reject
        //   three collinear points -> zero area -> rejected -> no accepted -> false
        InsetResult r5 = insetFaces({0,0,0, 1,0,0, 2,0,0}, {{0,1,2}}, 0.1);
        check(!r5.ok, "(R5) degenerate collinear face (zero area) -> ok=false [%s]", r5.reason);
        check(r5.rejectedFaces == 1, "(R5) the degenerate face is reported rejected (%u)", r5.rejectedFaces);
    }
    std::printf("\n");

    // ── (X) 0-FAKES invariant across ALL cases ────────────────────────────────
    std::printf("[X] 0-FAKES invariant: every accepted face is a true strict centroid shrink\n");
    check(fakes == 0,
          "(X) 0 FAKES — every accepted face had 0<factor<1, inner<orig, ring>0 (got %d)", fakes);

    std::printf("\n=== HONEST ENVELOPE ===\n");
    std::printf("=== ROBUST: per-face CENTROID INSET of a polygon soup by planar distance d; each face\n");
    std::printf("===         shrinks about its centroid in-plane by factor=(1-2d/extent), producing the\n");
    std::printf("===         shrunken inner face + a ring of border quads (one per edge). EXACT for the\n");
    std::printf("===         box's square faces: inner area == (1-2d/L)^2 L^2 within 1e-9; ring+inner\n");
    std::printf("===         conserves the original area; vertex/face counts grow exactly. Regular\n");
    std::printf("===         n-gons obey the same centroid-scaling law. Surface area conserved.\n");
    std::printf("=== ok=FALSE / per-face REJECT (honest, never fabricated): empty/ragged/out-of-range/\n");
    std::printf("===         negative-d input; degenerate (zero-area/collinear/repeated-index) faces;\n");
    std::printf("===         d >= half the smallest face extent (factor<=0 collapse/invert) -> that face\n");
    std::printf("===         is rejected & passed through UNCHANGED and REPORTED; all-reject => ok=false.\n");
    std::printf("===   LIMIT: centroid inset is exact for centroid-symmetric faces; a constant-distance\n");
    std::printf("===          (straight-skeleton) inset on arbitrary non-symmetric convex faces is TARGETED.\n");
    std::printf("=== RESULT: %d / %d passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
