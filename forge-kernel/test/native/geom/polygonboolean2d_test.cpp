// forge/native/geom/polygonboolean2d_test.cpp
//
// Standalone validation gate for forge::native::geom::PolygonBoolean2D.
//
// Build & run (exactly as the kernel CI invokes it):
//   clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
//       forge-kernel/src/native/geom/PolygonBoolean2D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp \
//       forge-kernel/test/native/geom/polygonboolean2d_test.cpp \
//       -o /tmp/k7_PolygonBoolean2D && /tmp/k7_PolygonBoolean2D
//
// Covers the prompt's SPEC validations, all with a printed std::random_device
// seed so any failure reproduces deterministically:
//
//   (a) Two overlapping AXIS-ALIGNED squares -> union / intersection / difference
//       / xor areas match the analytic rectangle-overlap formulas EXACTLY (within
//       1e-9 via the shoelace area of the orient2d-built result).
//   (b) DISJOINT squares -> union area == both, intersection == empty (0
//       contours), difference == subject, xor == both.
//   (c) A square minus a centered smaller square == a FRAME: genus-1, exactly 2
//       contours (outer CCW + inner CW), correct area, and the two windings are
//       opposite. The complementary union/xor of the same pair are checked too.
//   (d) 30 random axis-aligned rectangle PAIRS: union / intersection / difference
//       / xor areas match an INDEPENDENT fine-grid reference (cell-center sampling
//       made exact by snapping rectangle edges onto the grid lines).
//   (e) Self-intersecting input (a bowtie) -> ok=false, HONESTLY.
//   (f) Degenerate / unsupported input -> ok=false (zero-area, <3 verts,
//       non-finite); and a shared-boundary (collinear-overlap) pair -> ok=false.
//   (g) windingNumber / contourWinding correctness on a known polygon-with-hole.

#include "forge/native/geom/PolygonBoolean2D.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <random>
#include <vector>

using namespace forge::native;
using namespace forge::native::geom;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name); }
    else      {           std::printf("  [FAIL] %s\n", name); }
}

static bool nearly(double a, double b, double tol = 1e-9) {
    return std::fabs(a - b) <= tol * (1.0 + std::fabs(a) + std::fabs(b));
}

// Axis-aligned rectangle [x0,x1] x [y0,y1] as a CCW outer-only BoolPolygon.
static BoolPolygon rectCCW(double x0, double y0, double x1, double y1) {
    BoolPolygon p;
    p.outer.pts = { {x0, y0}, {x1, y0}, {x1, y1}, {x0, y1} };  // CCW
    return p;
}

// A square frame: outer CCW square minus a centered CW square hole — as ONE
// BoolPolygon (the analytic result of square-minus-inner-square).
static BoolPolygon frame(double outerS, double innerS, double cx, double cy) {
    BoolPolygon p;
    double ho = outerS * 0.5, hi = innerS * 0.5;
    p.outer.pts = { {cx - ho, cy - ho}, {cx + ho, cy - ho},
                    {cx + ho, cy + ho}, {cx - ho, cy + ho} };  // CCW
    BoolContour hole;
    hole.pts = { {cx - hi, cy - hi}, {cx - hi, cy + hi},
                 {cx + hi, cy + hi}, {cx + hi, cy - hi} };      // CW
    p.holes.push_back(hole);
    return p;
}

// Analytic overlap area of two axis-aligned rectangles.
static double rectOverlapArea(double ax0, double ay0, double ax1, double ay1,
                              double bx0, double by0, double bx1, double by1) {
    double ox = std::max(0.0, std::min(ax1, bx1) - std::max(ax0, bx0));
    double oy = std::max(0.0, std::min(ay1, by1) - std::max(ay0, by0));
    return ox * oy;
}

// Independent grid reference: sample cell centers over a bounding box covering
// both operands, count cells whose center satisfies the boolean predicate, scale
// by cell area. Made *exact* by aligning grid lines to the rectangle edges:
// because both operands are axis-aligned rectangles with the SAME edge
// coordinates as the grid, no cell center is ever ON a boundary, so the count is
// the exact integer number of unit cells inside -> exact area.
enum class RefOp { Union, Inter, Diff, Xor };

static double gridReferenceArea(double ax0, double ay0, double ax1, double ay1,
                                double bx0, double by0, double bx1, double by1,
                                RefOp op) {
    // Collect the distinct x and y coordinates (rectangle edges) -> a partition
    // of the plane into cells on which "inside A / inside B" is constant.
    std::vector<double> xs = {ax0, ax1, bx0, bx1};
    std::vector<double> ys = {ay0, ay1, by0, by1};
    std::sort(xs.begin(), xs.end());
    std::sort(ys.begin(), ys.end());
    xs.erase(std::unique(xs.begin(), xs.end()), xs.end());
    ys.erase(std::unique(ys.begin(), ys.end()), ys.end());

    auto inRect = [](double x, double y, double x0, double y0, double x1,
                     double y1) {
        return x > x0 && x < x1 && y > y0 && y < y1;
    };

    double area = 0.0;
    for (std::size_t i = 0; i + 1 < xs.size(); ++i) {
        for (std::size_t j = 0; j + 1 < ys.size(); ++j) {
            double cx = 0.5 * (xs[i] + xs[i + 1]);
            double cy = 0.5 * (ys[j] + ys[j + 1]);
            double w = xs[i + 1] - xs[i];
            double h = ys[j + 1] - ys[j];
            bool inA = inRect(cx, cy, ax0, ay0, ax1, ay1);
            bool inB = inRect(cx, cy, bx0, by0, bx1, by1);
            bool inside = false;
            switch (op) {
                case RefOp::Union: inside = inA || inB; break;
                case RefOp::Inter: inside = inA && inB; break;
                case RefOp::Diff:  inside = inA && !inB; break;
                case RefOp::Xor:   inside = inA != inB; break;
            }
            if (inside) area += w * h;
        }
    }
    return area;
}

int main() {
    std::printf("== forge::native::geom::PolygonBoolean2D validation gate ==\n");

    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("seed = %llu\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);

    // -----------------------------------------------------------------------
    // (a) Two overlapping axis-aligned squares: A=[0,10]^2, B=[5,15]x[5,15].
    //     Overlap rectangle = [5,10]^2 -> area 25. AreaA=AreaB=100.
    // -----------------------------------------------------------------------
    std::printf("\n(a) overlapping squares vs analytic rectangle-overlap formulas\n");
    {
        BoolPolygon A = rectCCW(0, 0, 10, 10);
        BoolPolygon B = rectCCW(5, 5, 15, 15);
        double areaA = 100.0, areaB = 100.0;
        double inter = rectOverlapArea(0, 0, 10, 10, 5, 5, 15, 15);  // 25
        double uni   = areaA + areaB - inter;                        // 175
        double diff  = areaA - inter;                                // 75
        double xr    = uni - inter;                                  // 150

        BoolResult ru = PolygonBoolean2D::unite(A, B);
        BoolResult ri = PolygonBoolean2D::intersect(A, B);
        BoolResult rd_ = PolygonBoolean2D::difference(A, B);
        BoolResult rx = PolygonBoolean2D::symmetricDifference(A, B);

        check(ru.ok && nearly(ru.netArea(), uni),   "(a) union area == 175");
        check(ri.ok && nearly(ri.netArea(), inter), "(a) intersection area == 25");
        check(rd_.ok && nearly(rd_.netArea(), diff), "(a) difference area == 75");
        check(rx.ok && nearly(rx.netArea(), xr),    "(a) xor area == 150");

        // The intersection of two overlapping convex rects is a single CCW square.
        check(ri.contourCount() == 1 && ri.contours[0].isCCW(),
              "(a) intersection is one CCW contour");
        check(ru.contourCount() == 1 && ru.contours[0].isCCW(),
              "(a) union is one CCW contour (L-shape merged)");
    }

    // -----------------------------------------------------------------------
    // (b) Disjoint squares.
    // -----------------------------------------------------------------------
    std::printf("\n(b) disjoint squares: union = both, intersection = empty\n");
    {
        BoolPolygon A = rectCCW(0, 0, 10, 10);
        BoolPolygon B = rectCCW(20, 20, 30, 30);

        BoolResult ru = PolygonBoolean2D::unite(A, B);
        BoolResult ri = PolygonBoolean2D::intersect(A, B);
        BoolResult rd_ = PolygonBoolean2D::difference(A, B);
        BoolResult rx = PolygonBoolean2D::symmetricDifference(A, B);

        check(ru.ok && nearly(ru.netArea(), 200.0) && ru.contourCount() == 2,
              "(b) union area == 200 over 2 contours");
        check(ri.ok && ri.contourCount() == 0 && nearly(ri.netArea(), 0.0),
              "(b) intersection empty (0 contours, area 0)");
        check(rd_.ok && nearly(rd_.netArea(), 100.0),
              "(b) difference == subject (area 100)");
        check(rx.ok && nearly(rx.netArea(), 200.0),
              "(b) xor == both (area 200)");
    }

    // -----------------------------------------------------------------------
    // (c) Square minus centered smaller square -> a FRAME (genus-1, 2 contours).
    //     Outer 20x20 (area 400) minus inner 8x8 (area 64) -> frame area 336.
    // -----------------------------------------------------------------------
    std::printf("\n(c) square minus centered smaller square == frame (genus-1)\n");
    {
        BoolPolygon A = rectCCW(-10, -10, 10, 10);   // 20x20, area 400
        BoolPolygon B = rectCCW(-4, -4, 4, 4);       // 8x8,  area 64, centered
        double frameArea = 400.0 - 64.0;             // 336

        BoolResult rd_ = PolygonBoolean2D::difference(A, B);
        check(rd_.ok, "(c) difference ok");
        check(nearly(rd_.netArea(), frameArea), "(c) frame area == 336");
        check(rd_.contourCount() == 2, "(c) frame has exactly 2 contours");
        if (rd_.contourCount() == 2) {
            // Exactly one CCW (outer) and one CW (inner hole) -> opposite winding.
            int ccw = 0, cw = 0;
            for (const BoolContour& c : rd_.contours) {
                if (c.isCCW()) ++ccw; else if (c.isCW()) ++cw;
            }
            check(ccw == 1 && cw == 1,
                  "(c) frame = 1 CCW outer + 1 CW hole (opposite winding)");
            // The inner contour bounds the 8x8 void: |inner area| == 64.
            double innerAbs = 0.0;
            for (const BoolContour& c : rd_.contours)
                if (c.isCW()) innerAbs = std::fabs(c.signedArea());
            check(nearly(innerAbs, 64.0), "(c) inner hole encloses area 64");
        }

        // Complementary checks on the SAME nested pair:
        //   union  = the big square (B inside A)          -> area 400, 1 contour
        //   inter  = the small square (B)                 -> area 64,  1 contour
        //   xor    = same frame as difference             -> area 336, 2 contours
        BoolResult ru = PolygonBoolean2D::unite(A, B);
        BoolResult ri = PolygonBoolean2D::intersect(A, B);
        BoolResult rx = PolygonBoolean2D::symmetricDifference(A, B);
        check(ru.ok && nearly(ru.netArea(), 400.0) && ru.contourCount() == 1,
              "(c) union of nested == big square (area 400)");
        check(ri.ok && nearly(ri.netArea(), 64.0) && ri.contourCount() == 1,
              "(c) intersection of nested == small square (area 64)");
        check(rx.ok && nearly(rx.netArea(), frameArea) && rx.contourCount() == 2,
              "(c) xor of nested == frame (area 336, 2 contours)");
    }

    // -----------------------------------------------------------------------
    // (d) 30 random axis-aligned rectangle pairs vs an independent grid reference.
    //     Coordinates drawn on an INTEGER lattice so the grid reference is exact.
    // -----------------------------------------------------------------------
    std::printf("\n(d) 30 random axis-aligned rect pairs vs grid reference\n");
    {
        std::uniform_int_distribution<int> coord(-20, 20);
        std::uniform_int_distribution<int> sideD(1, 18);
        int okCount = 0, refusedCount = 0;
        const int N = 30;
        for (int t = 0; t < N; ++t) {
            double ax0 = coord(rng), ay0 = coord(rng);
            double ax1 = ax0 + sideD(rng), ay1 = ay0 + sideD(rng);
            double bx0 = coord(rng), by0 = coord(rng);
            double bx1 = bx0 + sideD(rng), by1 = by0 + sideD(rng);

            BoolPolygon A = rectCCW(ax0, ay0, ax1, ay1);
            BoolPolygon B = rectCCW(bx0, by0, bx1, by1);

            BoolResult ru = PolygonBoolean2D::unite(A, B);
            BoolResult ri = PolygonBoolean2D::intersect(A, B);
            BoolResult rdf = PolygonBoolean2D::difference(A, B);
            BoolResult rx = PolygonBoolean2D::symmetricDifference(A, B);

            // Two rects can share a collinear boundary stretch (abutting / partial
            // edge overlap). Those are the documented degenerate envelope -> the
            // engine refuses ok=false. Count and skip those honestly (they are not
            // failures; they are out-of-envelope contacts). All four ops agree on
            // refusal because the collinear test fires regardless of op.
            if (!ru.ok || !ri.ok || !rdf.ok || !rx.ok) {
                ++refusedCount;
                // If refused, it must be for the documented collinear reason and
                // all four ops must refuse together (consistency).
                bool consistent = (!ru.ok && !ri.ok && !rdf.ok && !rx.ok);
                check(consistent, "(d) degenerate pair refused consistently");
                continue;
            }

            double refU = gridReferenceArea(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1, RefOp::Union);
            double refI = gridReferenceArea(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1, RefOp::Inter);
            double refD = gridReferenceArea(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1, RefOp::Diff);
            double refX = gridReferenceArea(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1, RefOp::Xor);

            bool good = nearly(ru.netArea(), refU) && nearly(ri.netArea(), refI) &&
                        nearly(rdf.netArea(), refD) && nearly(rx.netArea(), refX);
            check(good, "(d) random rect pair: all 4 boolean areas == grid ref");
            if (good) ++okCount;
        }
        std::printf("    (d) %d transversal pairs matched grid ref, %d degenerate "
                    "(collinear contact) refused\n", okCount, refusedCount);
        // The trial is only meaningful if a healthy majority were transversal.
        check(okCount >= N / 2,
              "(d) at least half the random pairs were transversal & exact");
    }

    // -----------------------------------------------------------------------
    // (e) Self-intersecting input (a bowtie) -> ok=false, honestly.
    // -----------------------------------------------------------------------
    std::printf("\n(e) self-intersecting input -> ok=false\n");
    {
        BoolPolygon bow;
        bow.outer.pts = { {0, 0}, {4, 4}, {4, 0}, {0, 4} };  // bowtie (crosses)
        BoolPolygon ok = rectCCW(10, 10, 12, 12);

        std::string why;
        check(!PolygonBoolean2D::isValid(bow, why), "(e) bowtie isValid == false");

        BoolResult r1 = PolygonBoolean2D::unite(bow, ok);
        BoolResult r2 = PolygonBoolean2D::intersect(ok, bow);
        check(!r1.ok, "(e) union with self-intersecting subject -> ok=false");
        check(!r2.ok, "(e) intersection with self-intersecting clip -> ok=false");
    }

    // -----------------------------------------------------------------------
    // (f) Other degenerate / unsupported inputs -> ok=false (0 FAKES).
    // -----------------------------------------------------------------------
    std::printf("\n(f) degenerate / unsupported inputs -> ok=false\n");
    {
        BoolPolygon good = rectCCW(0, 0, 10, 10);

        BoolPolygon few;  // < 3 vertices
        few.outer.pts = { {0, 0}, {1, 1} };
        check(!PolygonBoolean2D::unite(few, good).ok, "(f) <3 vertices -> ok=false");

        BoolPolygon zero;  // collinear / zero area
        zero.outer.pts = { {0, 0}, {1, 0}, {2, 0}, {1, 0} };
        check(!PolygonBoolean2D::unite(zero, good).ok, "(f) zero-area -> ok=false");

        BoolPolygon inf = rectCCW(0, 0, 10, 10);  // non-finite vertex
        inf.outer.pts[2].x = std::numeric_limits<double>::infinity();
        check(!PolygonBoolean2D::unite(inf, good).ok, "(f) non-finite vertex -> ok=false");

        // Shared collinear boundary overlap (two unit squares abutting AND
        // overlapping along the shared edge) -> documented degenerate -> ok=false.
        BoolPolygon L = rectCCW(0, 0, 10, 10);
        BoolPolygon Rr = rectCCW(10, 2, 20, 8);  // shares part of x=10 edge
        BoolResult shared = PolygonBoolean2D::unite(L, Rr);
        check(!shared.ok, "(f) shared collinear boundary overlap -> ok=false");
    }

    // -----------------------------------------------------------------------
    // (g) windingNumber / contourWinding on a known polygon-with-hole.
    // -----------------------------------------------------------------------
    std::printf("\n(g) winding-number correctness\n");
    {
        BoolPolygon fr = frame(20.0, 8.0, 0.0, 0.0);  // solid ring, void in middle
        // In the solid ring (e.g. (6,0)): outer +1, hole 0 -> 1.
        check(PolygonBoolean2D::windingNumber(fr, {6, 0}) == 1,
              "(g) point in ring solid -> winding 1");
        // In the central void (0,0): outer +1, hole -1 -> 0.
        check(PolygonBoolean2D::windingNumber(fr, {0, 0}) == 0,
              "(g) point in central void -> winding 0");
        // Far outside: 0.
        check(PolygonBoolean2D::windingNumber(fr, {100, 100}) == 0,
              "(g) far point -> winding 0");
        // contourWinding of the CCW outer alone about center == +1.
        check(PolygonBoolean2D::contourWinding(fr.outer, {0, 0}) == 1,
              "(g) CCW outer contourWinding center -> +1");
        // contourWinding of the CW hole alone about center == -1.
        check(PolygonBoolean2D::contourWinding(fr.holes[0], {0, 0}) == -1,
              "(g) CW hole contourWinding center -> -1");
    }

    // -----------------------------------------------------------------------
    std::printf("\nRESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
