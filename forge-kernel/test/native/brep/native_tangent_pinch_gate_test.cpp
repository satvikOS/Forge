// forge/native/brep/native_tangent_pinch_gate_test.cpp
//
// Native gate for the CADGenBench VALIDITY MULTIPLIER on drilled plates —
// auto-discovered by run_native.sh (the `brep` class). Pure C++20, no OCCT.
//
// CONTEXT (investigation 2026-06-29): heal.checkValidity (OCCT) returned
// isManifold=false on the spec135 drilled bracket (254x80x2, 4x Ø19.94 through-
// holes). Independent analysis (edge-incidence on the StepAnalytic-written B-Rep
// that occtFromNativeSolid feeds OCCT) localised it to ONE edge — a VERTICAL
// segment (254,40,0)->(254,40,2) on the plate's right face — shared by FOUR faces
// (two coplanar pieces of the x=254 side PLANE + two pieces of one bore wall).
// The bore is centred at x=244.03, r=9.97, and 244.03 + 9.97 == 254.00 == L: the
// hole is EXACTLY TANGENT to the plate edge, so the material pinches to ZERO
// thickness along that line. That is a GENUINE non-2-manifold edge (a measure-zero
// pinch): the volume is still exact (the pinch has no volume) and the surface still
// tessellates to a clean genus-4 mesh (the welder collapses the pinch), yet the
// B-rep is honestly non-manifold. checkValidity is CORRECT to reject it. The root
// cause is a GENERATOR placement bug (it clamps the last hole to x = L - r), NOT a
// checkValidity false-negative and NOT the holed-face stitch.
//
// WHAT THIS GATE LOCKS IN (so the validity multiplier stays honest):
//   (A) DRILLED-PLATE-IS-VALID: a thin large-hole plate (the b1 regime: 254x80x2
//       with 4 INTERIOR Ø19.94 through-holes) builds via the native analytic
//       holed-face boolean as a CLOSED 2-MANIFOLD, tessellates WATERTIGHT, and has
//       the EXACT through-hole volume. (The check must NOT regress to false-failing
//       good drilled parts.)
//   (B) KNOWN-BAD-IS-NOT-SILENTLY-VALID: a hole placed EXACTLY TANGENT to the plate
//       edge (cx + r == L) must NOT yield a watertight closed-2-manifold native
//       solid. The native analytic boolean honestly DEFERS (ok==false) rather than
//       emitting the pinch; the invariant asserted is the future-proof one — the
//       native path never SILENTLY produces a valid-looking non-manifold pinch.
//   (C) THE CHECK IS NOT ALWAYS-TRUE: an intentionally OPEN shell (one face of the
//       valid plate dropped) is reported NOT watertight / NOT valid by the same
//       native validator that passed (A) — proving the gate has real negative power.

#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/Boolean.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/SolidTessellate.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

#include <algorithm>
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

// Drill the given through-holes (one analytic boolean each) into a thin plate.
// Returns the final result chain (keeps owners alive). `ok` is false on the first
// boolean that DEFERS (ok==false) — the caller inspects that.
struct DrillOut {
    bool   lastBoolOk = true;        // every booleanSolid returned ok
    bool   closed2manifold = false;  // native isClosedTwoManifold on the final solid
    bool   watertight = false;       // HalfEdgeMesh watertight 2-manifold on the tess
    double vol = 0;
    Solid* solid = nullptr;          // final solid (null if first cut deferred)
    std::vector<BooleanResult> keep; // result owners
    std::vector<std::unique_ptr<SolidFactory>> facs;
    std::unique_ptr<SolidFactory> plateFac;
};
static DrillOut drillThinPlate(double L, double W, double T, double r,
                               const std::vector<std::pair<double,double>>& centres,
                               int nSeg = 64) {
    DrillOut o;
    o.plateFac = std::make_unique<SolidFactory>();
    Solid* cur = o.plateFac->buildBox(L, W, T);
    PrimitiveOptions hi; hi.nSeg = nSeg; hi.nBand = 32;
    for (const auto& c : centres) {
        auto fac = std::make_unique<SolidFactory>(hi);
        Solid* drill = fac->buildCylinder(r, T + 4.0);          // overshoot the thickness
        translateSolid(drill, c.first, c.second, -2.0);          // pierce z[-2, T+2]
        BooleanResult br = booleanSolid(*cur, *drill, BoolOp::Cut);
        if (!br.ok) { o.lastBoolOk = false; return o; }          // honest deferral
        o.keep.push_back(std::move(br));
        o.facs.push_back(std::move(fac));
        cur = o.keep.back().solid;
    }
    o.solid = cur;
    o.closed2manifold = o.keep.back().owner->isClosedTwoManifold();
    o.watertight = watertightManifold(*cur);
    o.vol = massProperties(*cur).volume;
    return o;
}

int main() {
    std::printf("=== forge::native::brep — TANGENT-PINCH validity gate (b1 / spec135 regime) ===\n");

    const double L = 254.0, W = 80.0, T = 2.0, r = 19.94 / 2.0;  // r = 9.97

    // ---- (A) DRILLED-PLATE-IS-VALID — 4 INTERIOR Ø19.94 holes in 254x80x2 ------
    std::printf("\n[A] thin plate, 4 INTERIOR Ø19.94 through-holes -> closed 2-manifold + watertight + exact volume\n");
    {
        std::vector<std::pair<double,double>> interior =
            {{50, 40}, {110, 40}, {170, 40}, {204, 40}};         // all clear of every edge
        DrillOut o = drillThinPlate(L, W, T, r, interior);
        const double vExp = L * W * T - 4.0 * PI * r * r * T;     // exact: 4 full bores
        check(o.lastBoolOk, "all 4 interior holes drilled (analytic boolean, no deferral)");
        check(o.closed2manifold, "final native solid isClosedTwoManifold()");
        check(o.watertight, "tessellation is watertight + 2-manifold (HalfEdgeMesh validate)");
        std::printf("      vol=%.6f expect=%.6f\n", o.vol, vExp);
        check(rel(o.vol, vExp, 1e-6), "thin-plate 4-hole volume EXACT (relerr < 1e-6)");
    }

    // ---- (B) KNOWN-BAD-IS-NOT-SILENTLY-VALID — a hole TANGENT to the right edge -
    std::printf("\n[B] one hole EXACTLY TANGENT to the plate edge (cx + r == L) -> NOT a silent valid solid\n");
    {
        // cx + r == L  ->  cx = 254 - 9.97 = 244.03 (the generator's clamped pos).
        const double cx = L - r;
        std::printf("      cx=%.5f  cx+r=%.5f  L=%.5f  (tangent iff cx+r==L)\n", cx, cx + r, L);
        std::vector<std::pair<double,double>> tangent = {{cx, 40}};
        DrillOut o = drillThinPlate(L, W, T, r, tangent);
        // The native analytic boolean must NOT silently emit a watertight closed
        // 2-manifold solid for this degenerate pinch. It currently DEFERS (ok=false).
        const bool silentlyValid = o.lastBoolOk && o.closed2manifold && o.watertight;
        std::printf("      booleanOk=%d closed2manifold=%d watertight=%d\n",
                    (int)o.lastBoolOk, (int)o.closed2manifold, (int)o.watertight);
        check(!silentlyValid, "tangent-to-edge hole does NOT yield a silent valid (watertight closed-2-manifold) solid");
        check(!o.lastBoolOk, "native analytic boolean honestly DEFERS on the exact-tangent degeneracy (ok==false)");
    }

    // ---- (C) THE VALIDATOR IS NOT ALWAYS-TRUE — an OPEN shell must be rejected --
    std::printf("\n[C] negative control: an OPEN shell (one face dropped) is reported NOT valid\n");
    {
        // Build the clean interior plate, then drop one face from its tessellation
        // so the mesh has a hole -> the SAME validator that passed (A) must reject it.
        std::vector<std::pair<double,double>> interior =
            {{50, 40}, {110, 40}, {170, 40}, {204, 40}};
        DrillOut o = drillThinPlate(L, W, T, r, interior);
        std::vector<double> pos; std::vector<std::uint32_t> idx;
        tessellateSolid(*o.solid, pos, idx);
        // amputate the last triangle -> a boundary hole.
        if (idx.size() >= 3) idx.resize(idx.size() - 3);
        forge::native::mesh::HalfEdgeMesh m;
        bool built = m.buildFromSoup(pos, idx);
        bool valid = built && m.validate().isValid();
        std::printf("      open-shell buildFromSoup=%d validate.isValid=%d\n", (int)built, (int)valid);
        check(!valid, "open shell (dropped face) is NOT watertight/valid (validator has real negative power)");
    }

    std::printf("\n=== tangent-pinch validity gate: %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
