// forge-kernel/test/native_hlr_perf.cpp
//
// PERF PROBE for the native orthographic HLR occlusion (K4 attempt-4).
// Reproduces the "drilled-box NativeSolid" case that measured ~5306 ms/view:
// a clean native box - cylinder (ONE cylindrical bore face, 5 planar faces),
// front view, timed. Pure C++20 / native kernel only (NO OCCT, NO WASM).
//
// It ALSO prints the visible/hidden segment counts + per-class projected length
// so a BEFORE/AFTER run proves the acceleration is OUTPUT-PRESERVING (the perf
// change must not move a single classified polyline).
//
// BUILD: test/build_hlr_perf.sh  (compiles every src/native/**.cpp, links this).
// Usage: native_hlr_perf [iters]   (default 3 timed iterations, min reported).

#include "forge/native/brep/Hlr.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Topology.hpp"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

using namespace forge::native::brep;

// Translate a freshly-built primitive (verbatim from native_boolean_test.cpp).
static void translateSolid(Solid* s, double dx, double dy, double dz) {
    std::map<Vertex*, bool> seen;
    std::map<Surface*, bool> seenSurf;
    for (Shell* sh : s->shells) {
        for (Face* f : sh->faces) {
            Loop* lp = f->outerLoop;
            if (!lp) continue;
            Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                Vertex* v = c->originVertex();
                if (!seen[v]) { seen[v] = true;
                    v->point.x += dx; v->point.y += dy; v->point.z += dz; }
                c = c->next;
            }
            if (f->surface && !seenSurf[f->surface]) {
                seenSurf[f->surface] = true;
                f->surface->origin.x += dx;
                f->surface->origin.y += dy;
                f->surface->origin.z += dz;
            }
        }
    }
}

static double ms(std::chrono::steady_clock::duration d) {
    return std::chrono::duration<double, std::milli>(d).count();
}

static int runCase(int nSeg, int iters) {
    // Drilled box: 100 x 60 x 40 minus a r=10 through-bore along +Z at the centre
    // (the "drilled box" of the K4 attempt-3 log). booleanSolid tessellates the
    // bore wall into ~nSeg cylinder-surface strips; nSeg governs the face count.
    PrimitiveOptions hi; hi.nSeg = nSeg; hi.nBand = nSeg / 2;
    SolidFactory fa, fb(hi);
    Solid* A = fa.buildBox(100, 60, 40);
    Solid* B = fb.buildCylinder(10.0, 60.0);
    translateSolid(B, 50, 30, -10);            // pierce z in [-10,50]
    BooleanResult cut = booleanSolid(*A, *B, BoolOp::Cut);
    if (!cut.ok || !cut.solid) {
        std::printf("FATAL: drilled-box native cut failed nSeg=%d (ok=%d)\n",
                    nSeg, (int)cut.ok);
        return 2;
    }
    const Solid& solid = *cut.solid;
    std::size_t nf = 0;
    for (const Shell* sh : solid.shells) nf += sh->faces.size();
    const Vec3 viewDir{0, -1, 0};  // front

    HlrResult r0 = hiddenLineRemoval(solid, viewDir);
    std::printf("\n=== drilled box 100x60x40 bore r10 front(-Y)  nSeg=%d  faces=%zu ===\n",
                nSeg, nf);
    std::printf("  OUTPUT: visSeg=%u hidSeg=%u  V=%.9f H=%.9f  totalEdges=%u  ok=%d\n",
                r0.visibleSegments, r0.hiddenSegments,
                r0.visibleLength2d, r0.hiddenLength2d, r0.totalEdges, (int)r0.ok);
    double best = 1e300, sum = 0.0;
    for (int i = 0; i < iters; ++i) {
        auto t0 = std::chrono::steady_clock::now();
        HlrResult r = hiddenLineRemoval(solid, viewDir);
        auto t1 = std::chrono::steady_clock::now();
        double dt = ms(t1 - t0);
        sum += dt;
        if (dt < best) best = dt;
        if (!r.ok) { std::printf("  iter %d NOT ok\n", i); return 3; }
    }
    std::printf("  --> best %.2f ms  avg %.2f ms over %d iters\n",
                best, sum / iters, iters);
    return 0;
}

int main(int argc, char** argv) {
    int iters = (argc > 1) ? std::atoi(argv[1]) : 3;
    if (iters < 1) iters = 1;
    std::printf("=== NATIVE HLR PERF PROBE (2D-BVH occlusion) ===\n");
    // Sweep the bore tessellation: 64 (default-ish clean), 128 (forge.cut default),
    // 256 (the heavy attempt-3 stress case).
    for (int nSeg : {64, 128, 256}) {
        int rc = runCase(nSeg, iters);
        if (rc != 0) return rc;
    }
    return 0;
}
