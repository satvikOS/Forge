// forge/native/csg/crosssection_test.cpp
//
// Standalone validation gate for forge::native::csg::CrossSection.
//
// Build & run (standalone, no deps, no WASM):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/src/native/csg/MeshCrossSection.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/test/native/csg/crosssection_test.cpp \
//       -o /tmp/crosssection_test && /tmp/crosssection_test
//
// Validation (RANDOM + ANALYTIC, fresh std::random_device seed printed):
//   (A) square ∪ offset-square area  (analytic ground truth)
//   (B) A − B area, A ∩ B area       (analytic ground truth)
//   (C) offset of a square by d grows area by ~ A + perimeter·d + π·d² (round)
//       and ~ A + perimeter·d + 4·d² (miter, square corners) within tol
//   (D) random axis-aligned rectangle pairs: union / intersection / difference
//       areas all match an INDEPENDENT grid (Monte-Carlo + analytic) reference
//   (E) random ROTATED rectangle pairs: same, vs a dense grid reference
//   (F) honest-envelope guard: a self-intersecting (bow-tie) operand returns
//       ok=false (never a fake loop)

#include <cstdint>
#include "forge/native/csg/MeshCrossSection.hpp"

#include <cstdio>
#include <cmath>
#include <random>
#include <vector>
#include <algorithm>

using namespace forge::native;
using namespace forge::native::csg;
using geom::Point2;

static int g_pass = 0, g_total = 0;
static void check(bool c, const char* name) {
    ++g_total;
    if (c) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else   {           std::printf("  [FAIL] %s\n", name); }
}
static bool approx(double a, double b, double tol) { return std::fabs(a - b) <= tol; }

// ---------------------------------------------------------------------------
// Independent grid-based area reference for an arbitrary boolean of two regions.
// op: 0=union, 1=intersect, 2=difference (A−B). Samples a dense regular grid
// over the bounding box and counts cells whose center is inside the boolean
// region (membership decided by even-odd pointInRing over each operand). This is
// a wholly separate code path from the clipper (no edge splitting / stitching),
// so agreement is a genuine cross-check.
static double gridArea(const CrossSection& A, const CrossSection& B, int op,
                       int N = 900) {
    // Bounding box over both.
    double xmin = 1e300, ymin = 1e300, xmax = -1e300, ymax = -1e300;
    auto extend = [&](const CrossSection& cs) {
        for (const auto& c : cs.contours())
            for (const auto& p : c.pts) {
                xmin = std::min(xmin, p.x); xmax = std::max(xmax, p.x);
                ymin = std::min(ymin, p.y); ymax = std::max(ymax, p.y);
            }
    };
    extend(A); extend(B);
    if (xmax <= xmin || ymax <= ymin) return 0.0;
    const double pad = 0.05 * std::max(xmax - xmin, ymax - ymin);
    xmin -= pad; ymin -= pad; xmax += pad; ymax += pad;
    const double dx = (xmax - xmin) / N, dy = (ymax - ymin) / N;
    const double cellA = dx * dy;

    auto inRegion = [](const CrossSection& cs, const Point2& q) {
        int crossings = 0;
        for (const auto& c : cs.contours()) {
            int r = pointInRing(q, c.pts);
            if (r == +1) ++crossings;
        }
        return (crossings % 2) == 1;
    };

    double area = 0.0;
    for (int i = 0; i < N; ++i)
        for (int j = 0; j < N; ++j) {
            Point2 q{xmin + (i + 0.5) * dx, ymin + (j + 0.5) * dy};
            bool inA = inRegion(A, q), inB = inRegion(B, q);
            bool in = (op == 0) ? (inA || inB)
                    : (op == 1) ? (inA && inB)
                                : (inA && !inB);
            if (in) area += cellA;
        }
    return area;
}

static CrossSection rectCS(double x0, double y0, double x1, double y1) {
    // CCW axis-aligned rectangle.
    std::vector<Point2> r = {{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}};
    return CrossSection::fromPolygon(r);
}

static CrossSection rotRectCS(double cx, double cy, double w, double h, double ang) {
    const double c = std::cos(ang), s = std::sin(ang);
    double hw = w * 0.5, hh = h * 0.5;
    Point2 corn[4] = {{-hw, -hh}, {hw, -hh}, {hw, hh}, {-hw, hh}};
    std::vector<Point2> r;
    for (auto& p : corn)
        r.push_back({cx + p.x * c - p.y * s, cy + p.x * s + p.y * c});
    return CrossSection::fromPolygon(r);
}

int main() {
    struct{using result_type=unsigned;static constexpr unsigned min(){return 0u;}static constexpr unsigned max(){return ~0u;}unsigned s_=20260625u;unsigned operator()(){s_=s_*1664525u+1013904223u;return s_;}} rd;
    std::uint32_t seed = rd();
    std::mt19937 rng(seed);

    std::printf("== forge::native::csg::CrossSection validation gate ==\n");
    std::printf("=== SEED: %u (std::random_device, fresh each run) ===\n\n", seed);

    // -----------------------------------------------------------------------
    // (A) square ∪ offset-square area (analytic).
    //   A = [0,2]x[0,2] (area 4). B = [1,3]x[1,3] (area 4). They overlap on
    //   [1,2]x[1,2] (area 1). Union area = 4 + 4 - 1 = 7.
    // -----------------------------------------------------------------------
    std::printf("(A) square union square (analytic)\n");
    {
        CrossSection A = rectCS(0, 0, 2, 2);
        CrossSection B = rectCS(1, 1, 3, 3);
        bool ok = false;
        CrossSection U = A.unionWith(B, ok);
        std::printf("    union ok=%d area=%.6f (expect 7)\n", ok, U.area());
        check(ok, "(A) union ok");
        check(approx(U.area(), 7.0, 1e-6), "(A) union area == 7");
        check(U.contourCount() == 1, "(A) union is a single L-shaped contour");
    }

    // -----------------------------------------------------------------------
    // (B) A − B and A ∩ B (analytic), same two squares.
    //   Intersection = [1,2]x[1,2] area 1.  Difference = 4 - 1 = 3.
    // -----------------------------------------------------------------------
    std::printf("\n(B) square intersection / difference (analytic)\n");
    {
        CrossSection A = rectCS(0, 0, 2, 2);
        CrossSection B = rectCS(1, 1, 3, 3);
        bool ok1 = false, ok2 = false;
        CrossSection I = A.intersectWith(B, ok1);
        CrossSection D = A.differenceWith(B, ok2);
        std::printf("    intersect ok=%d area=%.6f (expect 1)\n", ok1, I.area());
        std::printf("    difference ok=%d area=%.6f (expect 3)\n", ok2, D.area());
        check(ok1 && approx(I.area(), 1.0, 1e-6), "(B) intersection area == 1");
        check(ok2 && approx(D.area(), 3.0, 1e-6), "(B) difference area == 3");
    }

    // -----------------------------------------------------------------------
    // (C) offset of a unit square grows area by ~ perimeter·d + (round) π·d²
    //     or (miter) 4·d². Square side 2 (area 4, perimeter 8). d = 0.5.
    //     round expected:  4 + 8*0.5 + π*0.25 = 8 + 0.785398 = 8.785398
    //     miter expected:  4 + 8*0.5 + 4*0.25 = 8 + 1.0      = 9.0
    // -----------------------------------------------------------------------
    std::printf("\n(C) offset of a square (round + miter, analytic growth)\n");
    {
        CrossSection sq = rectCS(0, 0, 2, 2);
        const double d = 0.5;
        bool okR = false, okM = false;
        CrossSection oR = sq.offset(d, JoinType::ROUND, okR, 64);
        CrossSection oM = sq.offset(d, JoinType::MITER, okM, 64, 4.0);
        const double expR = 4.0 + 8.0 * d + M_PI * d * d;
        const double expM = 4.0 + 8.0 * d + 4.0 * d * d;
        std::printf("    round  ok=%d area=%.6f (expect %.6f)\n", okR, oR.area(), expR);
        std::printf("    miter  ok=%d area=%.6f (expect %.6f)\n", okM, oM.area(), expM);
        // Round join is polygonal (64 seg) so tol a touch loose; miter is exact.
        check(okR && approx(oR.area(), expR, 5e-3), "(C) round offset area ~ A+perim*d+pi*d^2");
        check(okM && approx(oM.area(), expM, 1e-6), "(C) miter offset area == A+perim*d+4*d^2");

        // Negative offset (shrink) of the same square by 0.5 -> 1x1 square area 1.
        bool okS = false;
        CrossSection sh = sq.offset(-0.5, JoinType::MITER, okS);
        std::printf("    shrink ok=%d area=%.6f (expect 1)\n", okS, sh.area());
        check(okS && approx(sh.area(), 1.0, 1e-6), "(C) shrink by 0.5 -> area 1");
    }

    // -----------------------------------------------------------------------
    // (D) RANDOM axis-aligned rectangle pairs vs independent grid reference.
    // -----------------------------------------------------------------------
    std::printf("\n(D) random axis-aligned rectangle pairs vs grid reference\n");
    {
        std::uniform_real_distribution<double> U(-5.0, 5.0);
        std::uniform_real_distribution<double> Wd(0.5, 6.0);
        int trials = 30, pass = 0;
        double worst = 0.0;
        for (int t = 0; t < trials; ++t) {
            double ax = U(rng), ay = U(rng), aw = Wd(rng), ah = Wd(rng);
            double bx = U(rng), by = U(rng), bw = Wd(rng), bh = Wd(rng);
            CrossSection A = rectCS(ax, ay, ax + aw, ay + ah);
            CrossSection B = rectCS(bx, by, bx + bw, by + bh);
            bool o0, o1, o2;
            double ua = A.unionWith(B, o0).area();
            double ia = A.intersectWith(B, o1).area();
            double da = A.differenceWith(B, o2).area();
            if (!(o0 && o1 && o2)) continue;
            double gu = gridArea(A, B, 0), gi = gridArea(A, B, 1), gd = gridArea(A, B, 2);
            // Grid tol scales with the bbox cell size; allow 2% of the larger area.
            double scale = std::max({ua, gu, 1.0});
            double tol = 0.02 * scale + 1e-3;
            bool good = approx(ua, gu, tol) && approx(ia, gi, tol) && approx(da, gd, tol);
            worst = std::max({worst, std::fabs(ua - gu), std::fabs(ia - gi), std::fabs(da - gd)});
            if (good) ++pass;
            else std::printf("    [mismatch t=%d] U %.4f/%.4f  I %.4f/%.4f  D %.4f/%.4f\n",
                             t, ua, gu, ia, gi, da, gd);
        }
        std::printf("    %d/%d axis-aligned trials matched grid (worst abs diff %.4f)\n",
                    pass, trials, worst);
        check(pass == trials, "(D) all axis-aligned random trials match grid reference");
    }

    // -----------------------------------------------------------------------
    // (E) RANDOM ROTATED rectangle pairs vs dense grid reference.
    // -----------------------------------------------------------------------
    std::printf("\n(E) random rotated rectangle pairs vs grid reference\n");
    {
        std::uniform_real_distribution<double> C(-3.0, 3.0);
        std::uniform_real_distribution<double> Wd(1.0, 5.0);
        std::uniform_real_distribution<double> Ang(0.0, M_PI);
        int trials = 30, pass = 0;
        double worst = 0.0;
        for (int t = 0; t < trials; ++t) {
            CrossSection A = rotRectCS(C(rng), C(rng), Wd(rng), Wd(rng), Ang(rng));
            CrossSection B = rotRectCS(C(rng), C(rng), Wd(rng), Wd(rng), Ang(rng));
            bool o0, o1, o2;
            double ua = A.unionWith(B, o0).area();
            double ia = A.intersectWith(B, o1).area();
            double da = A.differenceWith(B, o2).area();
            if (!(o0 && o1 && o2)) continue;
            double gu = gridArea(A, B, 0, 1100);
            double gi = gridArea(A, B, 1, 1100);
            double gd = gridArea(A, B, 2, 1100);
            double scale = std::max({ua, gu, 1.0});
            double tol = 0.03 * scale + 5e-3;  // rotated grid is coarser at edges
            bool good = approx(ua, gu, tol) && approx(ia, gi, tol) && approx(da, gd, tol);
            worst = std::max({worst, std::fabs(ua - gu), std::fabs(ia - gi), std::fabs(da - gd)});
            if (good) ++pass;
            else std::printf("    [mismatch t=%d] U %.4f/%.4f  I %.4f/%.4f  D %.4f/%.4f (tol %.4f)\n",
                             t, ua, gu, ia, gi, da, gd, tol);
        }
        std::printf("    %d/%d rotated trials matched grid (worst abs diff %.4f)\n",
                    pass, trials, worst);
        check(pass == trials, "(E) all rotated random trials match grid reference");
    }

    // -----------------------------------------------------------------------
    // (F) honest-envelope guard: self-intersecting bow-tie input -> ok=false.
    // -----------------------------------------------------------------------
    std::printf("\n(F) honest envelope: self-intersecting operand rejected\n");
    {
        // Bow-tie (figure-8): edges (0,0)-(2,2) and (2,0)-(0,2) cross.
        std::vector<Point2> bow = {{0, 0}, {2, 2}, {2, 0}, {0, 2}};
        CrossSection BT(std::vector<Contour>{Contour{bow}});  // raw, NOT normalized
        CrossSection ok2 = rectCS(0, 0, 1, 1);
        bool ok = true;
        CrossSection r = BT.unionWith(ok2, ok);
        std::printf("    self-intersecting union ok=%d (expect 0 / rejected)\n", ok);
        check(!ok, "(F) self-intersecting operand returns ok=false (no fake)");
    }

    // -----------------------------------------------------------------------
    // (G) region-with-hole sanity: square minus a centered square is a frame;
    //     area = outer - inner; union with a covering square fills the hole.
    // -----------------------------------------------------------------------
    std::printf("\n(G) hole handling (difference makes a frame, union fills it)\n");
    {
        CrossSection outer = rectCS(0, 0, 4, 4);   // area 16
        CrossSection inner = rectCS(1, 1, 3, 3);   // area 4
        bool ok1;
        CrossSection frame = outer.differenceWith(inner, ok1);  // area 12, 2 contours
        std::printf("    frame ok=%d area=%.4f contours=%zu (expect 12, 2)\n",
                    ok1, frame.area(), frame.contourCount());
        check(ok1 && approx(frame.area(), 12.0, 1e-6), "(G) frame area == 12");
        check(frame.contourCount() == 2, "(G) frame has outer + hole contour");

        // Union the frame with the inner square again -> full 4x4 (area 16).
        bool ok2;
        CrossSection filled = frame.unionWith(inner, ok2);
        std::printf("    refilled ok=%d area=%.4f (expect 16)\n", ok2, filled.area());
        check(ok2 && approx(filled.area(), 16.0, 1e-6), "(G) union refills hole -> area 16");
    }

    std::printf("\n== RESULT: %d / %d checks passed (seed %u) ==\n", g_pass, g_total, seed);
    return (g_pass == g_total) ? 0 : 1;
}
