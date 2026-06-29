// forge/native/brep/native_sequential_holes_test.cpp
//
// Native gate for the MARKER-ISOLATED HOLED-PLANAR-FACE boolean path
// (Boolean.cpp inner-loop imprint + stitch; MassProps + SolidTessellate
// hole-awareness gated on Face::boolHoled). Auto-discovered by run_native.sh
// (the `brep` class). Pure C++20, no OCCT, no test framework.
//
// WHAT THIS PROVES (the whole point of the fix):
//   * A drilled face becomes ONE holed analytic planar face (outer loop + the
//     bore as an inner loop), NOT a per-CDT-triangle fan. So k.plane stays at 6
//     (4 sides + 1 holed top + 1 holed bottom) NO MATTER how many holes are
//     drilled — the +388-faces/hole explosion is gone.
//   * SEQUENTIAL drilling (one boolean per hole) succeeds for 6 AND 10 holes —
//     the old path FAILED at the 6th hole (non-conforming T-junction -> analytic
//     stitch manifold pre-check abort -> mesh-fallback buildFromSoup fail).
//   * Each result is a closed 2-manifold, tessellates watertight, takes the
//     ANALYTIC path, and reports the EXACT total volume (relerr < 1e-6): the
//     planar caps contribute 0 to the divergence-volume and the bore walls are
//     integrated analytically, so 50x50x10 - N*(pi*25*10) is exact.
//   * Face count grows by EXACTLY nSeg per hole (the bore wall) — constant per
//     hole, one inner loop per drilled face — not a compounding fan.

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
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
constexpr double PI = 3.14159265358979323846;

// Translate a freshly-built primitive (outer-loop walk; a fresh cylinder has no
// inner loops) — mirrors native_boolean_test's helper so the drill can be placed.
static void translateSolid(Solid* s, double dx, double dy, double dz) {
    std::map<Vertex*, bool> seen;
    std::map<Surface*, bool> seenSurf;
    for (Shell* sh : s->shells)
        for (Face* f : sh->faces) {
            Loop* lp = f->outerLoop;
            if (lp) {
                Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                    Vertex* v = c->originVertex();
                    if (!seen[v]) { seen[v] = true; v->point.x += dx; v->point.y += dy; v->point.z += dz; }
                    c = c->next;
                }
            }
            if (f->surface && !seenSurf[f->surface]) {
                seenSurf[f->surface] = true;
                f->surface->origin.x += dx; f->surface->origin.y += dy; f->surface->origin.z += dz;
            }
        }
}

static double volOf(const Solid& s) { return massProperties(s).volume; }

struct KindCount { int plane = 0, cyl = 0, cone = 0, sphere = 0, torus = 0, nurbs = 0, total = 0; };
static KindCount kindsOf(const Solid& s) {
    KindCount k;
    for (Shell* sh : s.shells) for (Face* f : sh->faces) {
        if (!f->surface) continue;
        ++k.total;
        switch (f->surface->kind) {
        case SurfaceKind::Plane:    ++k.plane;  break;
        case SurfaceKind::Cylinder: ++k.cyl;    break;
        case SurfaceKind::Cone:     ++k.cone;   break;
        case SurfaceKind::Sphere:   ++k.sphere; break;
        case SurfaceKind::Torus:    ++k.torus;  break;
        case SurfaceKind::Nurbs:    ++k.nurbs;  break;
        }
    }
    return k;
}
static int quadricFaces(const KindCount& k) { return k.cyl + k.cone + k.sphere + k.torus; }

static int totalInnerLoops(const Solid& s) {
    int n = 0;
    for (Shell* sh : s.shells) for (Face* f : sh->faces) n += (int)f->innerLoops.size();
    return n;
}
static bool watertightManifold(const Solid& s) {
    std::vector<double> pos; std::vector<std::uint32_t> idx;
    tessellateSolid(s, pos, idx);
    forge::native::mesh::HalfEdgeMesh m;
    if (!m.buildFromSoup(pos, idx)) return false;
    return m.validate().isValid();
}

// Drill N Ø10 (r=5) through-holes ONE AT A TIME into a 50x50x10 plate. Returns a
// per-hole report; `outFaceCounts[h]` is the result face count after hole h.
struct DrillReport {
    bool        ok = true;          // every hole succeeded + manifold + watertight
    bool        allAnalytic = true; // no mesh fallback on any hole
    std::string fail;
    double      vol = 0;
    int         planes = 0, quadrics = 0, innerLoops = 0;
    int         V = 0, E = 0, F = 0;
    std::vector<int> faceCounts;
};
static DrillReport drillSequential(int N, int nSeg) {
    DrillReport rep;
    PrimitiveOptions hi; hi.nSeg = nSeg; hi.nBand = 32;

    // Hole centres: a 4x4 grid spaced 12mm (Ø10 holes -> 2mm clear; the drill
    // AABBs never overlap so no spurious face-pair imprints). First N taken.
    std::vector<std::pair<double,double>> centres;
    const double g[4] = {7.0, 19.0, 31.0, 43.0};
    for (double y : g) for (double x : g) centres.push_back({x, y});

    SolidFactory plateFac;                       // owns the plate for the 1st cut
    Solid* cur = plateFac.buildBox(50.0, 50.0, 10.0);
    std::vector<BooleanResult> keep;             // keep result owners alive
    std::vector<std::unique_ptr<SolidFactory>> facs;

    for (int h = 0; h < N; ++h) {
        auto fac = std::make_unique<SolidFactory>(hi);
        Solid* drill = fac->buildCylinder(5.0, 14.0);          // r=5, h=14
        translateSolid(drill, centres[h].first, centres[h].second, -2.0); // pierce z[-2,12]
        BooleanResult r = booleanSolid(*cur, *drill, BoolOp::Cut);
        if (!r.ok) { rep.ok = false; rep.fail = "hole " + std::to_string(h) + " booleanSolid: " + r.reason; return rep; }
        if (r.usedMeshFallback) rep.allAnalytic = false;
        if (!r.owner->isClosedTwoManifold()) { rep.ok = false; rep.fail = "hole " + std::to_string(h) + " not closed 2-manifold"; return rep; }
        if (!watertightManifold(*r.solid)) { rep.ok = false; rep.fail = "hole " + std::to_string(h) + " not watertight"; return rep; }
        rep.faceCounts.push_back(kindsOf(*r.solid).total);
        keep.push_back(std::move(r));
        facs.push_back(std::move(fac));
        cur = keep.back().solid;
    }

    KindCount k = kindsOf(*cur);
    rep.planes = k.plane; rep.quadrics = quadricFaces(k);
    rep.innerLoops = totalInnerLoops(*cur);
    rep.vol = volOf(*cur);
    EulerCounts c = keep.back().owner->counts();
    rep.V = (int)c.vertices; rep.E = (int)c.edges; rep.F = (int)c.faces;
    return rep;
}

int main() {
    std::printf("=== forge::native::brep — SEQUENTIAL MULTI-HOLE drilled-plate gate ===\n");

    // ---- (1) SINGLE Ø10 hole in a 50x50x10 plate: EXACT + ONE holed face -------
    std::printf("\n[1] single Ø10 hole — exact analytic holed planar face\n");
    {
        const int nSeg = 128;
        DrillReport r = drillSequential(1, nSeg);
        const double vExp = 50.0 * 50.0 * 10.0 - PI * 25.0 * 10.0; // 24214.6017...
        check(r.ok, "single hole succeeds (closed 2-manifold + watertight)");
        if (!r.ok) std::printf("      reason: %s\n", r.fail.c_str());
        check(r.allAnalytic, "single hole took the ANALYTIC path (not mesh fallback)");
        std::printf("      planes=%d quadrics=%d innerLoops=%d  vol=%.8f expect=%.8f\n",
                    r.planes, r.quadrics, r.innerLoops, r.vol, vExp);
        check(r.planes == 6, "drilled plate has EXACTLY 6 planar faces (4 sides + holed top + holed bottom — NO fan)");
        check(r.quadrics == nSeg, "bore wall == nSeg sectors of ONE analytic cylinder");
        check(r.innerLoops == 2, "exactly 2 inner (hole) loops (top + bottom each hold ONE)");
        check(rel(r.vol, vExp, 1e-6), "single-hole analytic volume exact to relerr < 1e-6 (24214.60)");
    }

    // ---- (2) SIX holes one-by-one: the historic 6th-hole failure is gone -------
    std::printf("\n[2] SIX Ø10 holes drilled one-at-a-time (was: FAIL at the 6th hole)\n");
    {
        const int nSeg = 64;
        DrillReport r = drillSequential(6, nSeg);
        const double vExp = 50.0 * 50.0 * 10.0 - 6.0 * PI * 25.0 * 10.0; // 20287.6093...
        check(r.ok, "all 6 holes succeed one-by-one (no 6th-hole failure)");
        if (!r.ok) std::printf("      reason: %s\n", r.fail.c_str());
        check(r.allAnalytic, "all 6 cuts took the ANALYTIC path");
        std::printf("      planes=%d quadrics=%d innerLoops=%d V=%d E=%d F=%d vol=%.6f expect=%.6f\n",
                    r.planes, r.quadrics, r.innerLoops, r.V, r.E, r.F, r.vol, vExp);
        check(r.planes == 6, "still EXACTLY 6 planar faces after 6 holes (no face explosion)");
        check(r.quadrics == 6 * nSeg, "6 bore walls == 6*nSeg analytic sectors");
        check(r.innerLoops == 12, "12 inner loops (top + bottom each carry 6 holes)");
        check(rel(r.vol, vExp, 1e-6), "6-hole total volume exact to relerr < 1e-6");
        // face count grows by EXACTLY nSeg per hole (the bore wall) — constant, not a fan.
        bool constGrowth = (r.faceCounts.size() == 6);
        for (std::size_t i = 1; i < r.faceCounts.size(); ++i) {
            int d = r.faceCounts[i] - r.faceCounts[i - 1];
            std::printf("      hole %zu: faces=%d (delta=%d, expect %d)\n", i, r.faceCounts[i], d, nSeg);
            if (d != nSeg) constGrowth = false;
        }
        check(constGrowth, "face count grows by EXACTLY nSeg per hole (one bore wall; top/bottom stay single faces)");
    }

    // ---- (3) TEN holes one-by-one: dense-hole non-manifold case ----------------
    std::printf("\n[3] TEN Ø10 holes drilled one-at-a-time (the dense-hole case)\n");
    {
        const int nSeg = 64;
        DrillReport r = drillSequential(10, nSeg);
        const double vExp = 50.0 * 50.0 * 10.0 - 10.0 * PI * 25.0 * 10.0; // 17146.0183...
        check(r.ok, "all 10 holes succeed one-by-one (watertight, closed 2-manifold)");
        if (!r.ok) std::printf("      reason: %s\n", r.fail.c_str());
        check(r.allAnalytic, "all 10 cuts took the ANALYTIC path");
        std::printf("      planes=%d quadrics=%d innerLoops=%d V=%d E=%d F=%d vol=%.6f expect=%.6f\n",
                    r.planes, r.quadrics, r.innerLoops, r.V, r.E, r.F, r.vol, vExp);
        check(r.planes == 6, "still EXACTLY 6 planar faces after 10 holes");
        check(r.quadrics == 10 * nSeg, "10 bore walls == 10*nSeg analytic sectors");
        check(r.innerLoops == 20, "20 inner loops (top + bottom each carry 10 holes)");
        check(rel(r.vol, vExp, 1e-6), "10-hole total volume exact to relerr < 1e-6");
    }

    std::printf("\n=== sequential-multi-hole gate: %d/%d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
