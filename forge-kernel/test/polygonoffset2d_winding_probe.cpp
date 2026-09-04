// forge-kernel/test/polygonoffset2d_winding_probe.cpp
//
// Twelve lines against PolygonOffset2D alone, no OCCT, that answer ONE question:
// is offsetLoop's signed distance `d` winding-relative?
//
// It is not, and src/Cam.cpp:295-296 assumes it is:
//
//     const double signedDist = loop.isCCW() ? -offsetMm : offsetMm;
//
// with a comment saying that makes it "ALWAYS move inward (into the closed wire)
// regardless of the wire's winding". Measured here on a 10 mm square (area 100),
// both windings shrink on d<0 and grow on d>0 — so a wire that presents CW
// offsets OUTWARD under a function named inwardOffset. The engine header's
// "a CW hole is the mirror" does not describe the code either.
//
// The 600-part corpus A/B cannot see this: all 594 outer wires present CCW in
// their face's plane frame, so the branch is never taken. See
// reports/corpus_ab/MAKEOFFSET_DECOMPOSITION_2026-09-03.md §6, and the pinned
// control in test/corpus_ab_coverage.cpp's --selftest.
//
// build:
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       forge-kernel/test/polygonoffset2d_winding_probe.cpp \
//       forge-kernel/src/native/geom/PolygonOffset2D.cpp \
//       forge-kernel/src/native/Predicates.cpp \
//       forge-kernel/src/native/geom/Geom.cpp -o /tmp/winding && /tmp/winding
//
// It PRINTS; it does not assert. The assertion lives in corpus_ab_coverage
// --selftest, where it is run by the build script on every build.

#include <cstdio>
#include <cmath>
#include "forge/native/geom/PolygonOffset2D.hpp"
using namespace forge::native::geom;
static double area(const Loop2& L){ return L.signedArea(); }
int main(){
    // CCW 10mm square
    Loop2 ccw; ccw.pts = {{0,0},{10,0},{10,10},{0,10}};
    // CW 10mm square (same ring, reversed)
    Loop2 cw;  cw.pts  = {{0,0},{0,10},{10,10},{10,0}};
    printf("source: ccw signedArea %+.6f (isCCW=%d)   cw signedArea %+.6f (isCW=%d)\n",
           area(ccw), (int)ccw.isCCW(), area(cw), (int)cw.isCW());
    OffsetOptions o;
    struct C { const char* n; const Loop2* L; double d; };
    C cases[] = {
        {"CCW  d=-1 (Cam's inward rule)", &ccw, -1.0},
        {"CCW  d=+1",                     &ccw, +1.0},
        {"CW   d=+1 (Cam's inward rule)", &cw,  +1.0},
        {"CW   d=-1",                     &cw,  -1.0},
    };
    for (const C& c : cases) {
        OffsetResult r = PolygonOffset2D::offsetLoop(*c.L, c.d, o);
        double a = 0; for (const Loop2& L : r.loops) a += std::fabs(L.signedArea());
        printf("%-32s ok=%d loops=%zu dropped=%zu |area| %10.5f   %s\n",
               c.n, (int)r.ok, r.loops.size(), r.droppedLoops, a,
               a < 100 ? "SHRANK (inward)" : (a > 100 ? "GREW (outward)" : "same"));
    }
    return 0;
}
