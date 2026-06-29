// forge/native/brep/native_tangent_boolean_gate_test.cpp
//
// Native gate for the BOOLEAN-ROBUSTNESS guard on tangent / near-tangent hole
// cuts — auto-discovered by run_native.sh (the `brep` class). Pure C++20, no OCCT.
//
// THE GAP (diagnosed 2026-06-29): a cylinder cut TANGENT to a planar face
// (cx + r == L, edge-gap 0) is a genuine zero-thickness non-manifold PINCH. The
// native analytic boolean correctly DEFERS (it will not emit the pinch), but the
// pipeline then hands the pair to the OCCT fallback (BRepAlgoAPI + healing), which
// SPINS for minutes on the degeneracy (the 3 CADGenBench fixtures 108/120/143 hung
// in part.finish/healing with no output). The fix is to DETECT the tangent / near-
// tangent condition FAST and deterministically, BEFORE the expensive boolean, so
// the pipeline fails fast (clear error) instead of hanging — and to guard the OCCT
// fallback with a watchdog so no boolean can spin. detectBooleanTangentPinch is the
// detector; src/Booleans.cpp throws a clear diagnostic on it before the OCCT path.
//
// WHAT THIS GATE LOCKS IN:
//   (A) THE 3 HANG CASES RESOLVE IN BOUNDED TIME WITH THE CORRECT VERDICT — each of
//       the three reported tangent configurations (O7.5 @ y=171.25 of dy=175;
//       O5 @ y=55.5 of dy=58; O4.8 @ the edge) is flagged degenerate by the FAST
//       detector AND the native analytic boolean DEFERS — together: no silent bad
//       solid, no hang. The detector returns in microseconds (asserted < 1 s).
//   (B) A NORMAL INTERIOR HOLE IS UNAFFECTED — a well-clear hole is NOT flagged, the
//       native boolean SUCCEEDS, the result is a closed 2-manifold with the EXACT
//       interior-bore volume (A/B identical to the un-guarded path).
//   (C) THE TANGENT CUT IS NOT SILENTLY VALID — for a tangent hole the detector
//       flags it AND the native boolean does not produce a watertight closed solid
//       (the pinch is never papered over).
//   (D) THE DETECTOR HAS REAL NEGATIVE POWER — a near-tangent hole left with a
//       comfortable wall (gap >> eps) is NOT flagged (no false positives on thin-
//       but-manufacturable walls), proving the band is a genuine discriminator.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <map>
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
static bool rel(double got, double exp, double tol) {
    return std::fabs(got - exp) <= tol * std::max(1.0, std::fabs(exp));
}
constexpr double PI = 3.14159265358979323846;

static void translateSolid(Solid* s, double dx, double dy, double dz) {
    std::map<Vertex*, bool> seen; std::map<Surface*, bool> seenSurf;
    for (Shell* sh : s->shells) for (Face* f : sh->faces) {
        if (Loop* lp = f->outerLoop) { Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) { Vertex* v = c->originVertex();
                if (!seen[v]) { seen[v] = true; v->point.x += dx; v->point.y += dy; v->point.z += dz; } c = c->next; } }
        if (f->surface && !seenSurf[f->surface]) { seenSurf[f->surface] = true;
            f->surface->origin.x += dx; f->surface->origin.y += dy; f->surface->origin.z += dz; }
    }
}

static bool watertightManifold(const Solid& s) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(s, pos, idx);
    forge::native::mesh::HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) return false;
    return m.validate().isValid();
}

// One through-drill of radius r at (cx,cy) into an L x W x T plate. Keeps the
// owners alive in `keep`. The cylinder overshoots the thickness so the cut is a
// clean through-hole (for an interior position) or a tangent pinch (for cy+r==W).
struct OneDrill {
    std::unique_ptr<SolidFactory> plateFac, drillFac;
    Solid* plate = nullptr;
    Solid* drill = nullptr;
    BooleanResult br;
};
static OneDrill makeDrill(double L, double W, double T, double r,
                          double cx, double cy, int nSeg = 64) {
    OneDrill d;
    d.plateFac = std::make_unique<SolidFactory>();
    d.plate = d.plateFac->buildBox(L, W, T);
    PrimitiveOptions hi; hi.nSeg = nSeg; hi.nBand = 32;
    d.drillFac = std::make_unique<SolidFactory>(hi);
    d.drill = d.drillFac->buildCylinder(r, T + 4.0);
    translateSolid(d.drill, cx, cy, -2.0);   // pierce z in [-2, T+2]
    return d;
}

int main() {
    std::printf("=== forge::native::brep — TANGENT-CUT boolean-robustness gate ===\n");

    // ---- (A) THE 3 HANG CASES — flagged degenerate, FAST, native boolean defers ---
    std::printf("\n[A] the 3 reported tangent fixtures -> FAST degenerate verdict + analytic deferral\n");
    struct Case { const char* tag; double L, W, T, r, cx, cy; };
    const Case cases[3] = {
        // 108: O7.5 (r=3.75) tangent to dy=175 at y=171.25  (171.25 + 3.75 == 175)
        {"108: O7.5 @ y=171.25 of dy=175", 100.0, 175.0, 10.0, 3.75, 50.0, 171.25},
        // 120: O5   (r=2.5)  tangent to dy=58  at y=55.5    (55.5  + 2.5  == 58)
        {"120: O5 @ y=55.5 of dy=58",        60.0,  58.0, 10.0, 2.5,  30.0,  55.5},
        // 143: O4.8 (r=2.4)  tangent to the edge of dy=50   (47.6  + 2.4  == 50)
        {"143: O4.8 @ the edge of dy=50",    40.0,  50.0, 10.0, 2.4,  20.0,  47.6},
    };
    for (const Case& c : cases) {
        OneDrill d = makeDrill(c.L, c.W, c.T, c.r, c.cx, c.cy);

        const auto t0 = std::chrono::steady_clock::now();
        TangentPinchReport tp = detectBooleanTangentPinch(*d.plate, *d.drill, BoolOp::Cut);
        const auto t1 = std::chrono::steady_clock::now();
        const double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

        BooleanResult br = booleanSolid(*d.plate, *d.drill, BoolOp::Cut);

        std::printf("      %s: degenerate=%d wall=%.3g eps=%.3g detect=%.3f ms  analytic.ok=%d\n",
                    c.tag, (int)tp.degenerate, tp.wall, tp.eps, ms, (int)br.ok);
        check(tp.degenerate, std::string("[") + c.tag + "] flagged tangent/degenerate by the FAST detector");
        check(ms < 1000.0,   std::string("[") + c.tag + "] detector returns in bounded time (< 1 s)");
        check(!br.ok,        std::string("[") + c.tag + "] native analytic boolean DEFERS (no silent pinch)");
    }

    // ---- (B) NORMAL INTERIOR HOLE — UNAFFECTED ----------------------------------
    std::printf("\n[B] a well-clear interior hole -> NOT flagged, boolean OK, manifold, EXACT volume\n");
    {
        const double L = 100.0, W = 175.0, T = 10.0, r = 3.75;
        OneDrill d = makeDrill(L, W, T, r, 50.0, 80.0);   // 80 is far from every edge
        TangentPinchReport tp = detectBooleanTangentPinch(*d.plate, *d.drill, BoolOp::Cut);
        BooleanResult br = booleanSolid(*d.plate, *d.drill, BoolOp::Cut);
        const double vExp = L * W * T - PI * r * r * T;    // exact single through-bore
        const double vGot = br.ok ? massProperties(*br.solid).volume : 0.0;
        const bool   wt   = br.ok && watertightManifold(*br.solid);
        std::printf("      degenerate=%d boolean.ok=%d watertight=%d vol=%.6f expect=%.6f\n",
                    (int)tp.degenerate, (int)br.ok, (int)wt, vGot, vExp);
        check(!tp.degenerate, "interior hole is NOT flagged (no false positive)");
        check(br.ok,          "native analytic boolean SUCCEEDS on the interior hole");
        check(wt,             "interior-hole result is watertight closed 2-manifold");
        check(br.ok && rel(vGot, vExp, 1e-6), "interior-hole volume EXACT (relerr < 1e-6) — A/B unaffected");
    }

    // ---- (C) TANGENT CUT IS NOT SILENTLY VALID ----------------------------------
    std::printf("\n[C] tangent cut -> detector flags it AND no watertight closed solid is produced\n");
    {
        const double L = 100.0, W = 175.0, T = 10.0, r = 3.75;
        OneDrill d = makeDrill(L, W, T, r, 50.0, W - r);   // cy + r == W (tangent)
        TangentPinchReport tp = detectBooleanTangentPinch(*d.plate, *d.drill, BoolOp::Cut);
        BooleanResult br = booleanSolid(*d.plate, *d.drill, BoolOp::Cut);
        const bool silentlyValid = br.ok && br.solid && watertightManifold(*br.solid);
        std::printf("      degenerate=%d boolean.ok=%d silentlyValid=%d\n",
                    (int)tp.degenerate, (int)br.ok, (int)silentlyValid);
        check(tp.degenerate,    "tangent cut is flagged degenerate");
        check(!silentlyValid,   "tangent cut does NOT yield a silent watertight closed-2-manifold solid");
    }

    // ---- (D) NEGATIVE POWER — a comfortable wall is NOT flagged ------------------
    std::printf("\n[D] negative control: a hole left with a comfortable wall (gap >> eps) is NOT flagged\n");
    {
        const double L = 100.0, W = 175.0, T = 10.0, r = 3.75;
        // cy so the wall to the y=W face is 1.0 mm (>> eps ~ 1e-5 for this 175 mm part).
        OneDrill d = makeDrill(L, W, T, r, 50.0, W - r - 1.0);
        TangentPinchReport tp = detectBooleanTangentPinch(*d.plate, *d.drill, BoolOp::Cut);
        BooleanResult br = booleanSolid(*d.plate, *d.drill, BoolOp::Cut);
        std::printf("      degenerate=%d eps=%.3g boolean.ok=%d (1.0 mm wall)\n",
                    (int)tp.degenerate, tp.eps, (int)br.ok);
        check(!tp.degenerate, "a 1.0 mm-wall hole is NOT flagged (no false positive on a manufacturable wall)");
        check(br.ok,          "the 1.0 mm-wall hole cuts cleanly via the native analytic boolean");
    }

    std::printf("\n=== tangent-cut boolean-robustness gate: %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
