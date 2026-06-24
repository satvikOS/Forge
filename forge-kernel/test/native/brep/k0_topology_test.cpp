// forge/native/brep/k0_topology_test.cpp
//
// Standalone validation gate for the K0 TOPOLOGY FOUNDATION increment (the layer
// the trimmed-NURBS face K1.2 builds on). Pure C++20, no external dependencies,
// no test framework — a tiny hand-rolled harness that prints PASS/FAIL and exits
// non-zero on any failure (mirrors brep_test.cpp).
//
// Build + run:
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/k0_topology_test.cpp \
//     -o /tmp/k0_topology_test && /tmp/k0_topology_test
//
// VALIDATION GATE (asserted below):
//   (1) FACE-WITH-HOLE TOPOLOGY. A genus-1 closed solid — a rectangular block
//       with a polygonal through-hole — is assembled with the new inner-loop
//       API. Its two cap faces each carry one OUTER loop + one INNER (hole) loop.
//       The general Euler-Poincare invariant  V - E + F - R - 2(S - G) = 0  holds
//       with R = 2 inner rings, S = 1 shell, G = 1 genus, and the structural
//       closed-2-manifold check passes. Loop counts on the cap faces are verified.
//   (2) PCURVE <-> 3D EDGE CURVE CONSISTENCY. On the top cap (a Plane surface),
//       each hole-rim coedge carries a 2D Circle PCurve and its edge carries the
//       matching 3D Circle Curve. Composing the Plane surface S(u,v) with the
//       coedge's PCurve P(t) reproduces the edge's 3D Curve C(t) to <= 1e-9 over
//       many samples. The same composition invariant is checked for a straight
//       OUTER edge (Line curve / Line2 pcurve) and for a BSpline curve/pcurve.
//   (3) TOLERANCE ATTRIBUTE. The per-entity tolerance on Vertex/Edge/Coedge is
//       set and read back, and a tolerant-coincidence test behaves per spec.

#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/Nurbs.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) {
        ++g_pass;
        std::printf("  [PASS] %s\n", name.c_str());
    } else {
        std::printf("  [FAIL] %s\n", name.c_str());
    }
}

static bool approx(double a, double b, double tol) {
    return std::fabs(a - b) <= tol;
}
static bool approxPt(const Vec3& a, const Vec3& b, double tol) {
    return approx(a.x, b.x, tol) && approx(a.y, b.y, tol) &&
           approx(a.z, b.z, tol);
}

static constexpr double TWO_PI = 6.283185307179586476925286766559;

// ===========================================================================
// Build a rectangular block (outer [0,W]x[0,D]x[0,H]) with a regular N-gon
// through-hole of radius `r` centred at (cx,cy) running the full height in Z.
// Returns the solid via the builder, and hands back the top cap face + its hole
// loop so the pcurve/curve consistency test can interrogate them.
//
// This is a genuine closed 2-manifold genus-1 solid assembled ENTIRELY through
// the public Euler-operator API (makeVertex / addOuterLoopToFace /
// addInnerLoopToFace). The hole rim edges carry exact circular-arc 3D curves and
// the top-cap coedges carry the matching 2D circular-arc pcurves in the cap's
// plane parameterisation.
// ===========================================================================
struct BlockWithHole {
    Solid* solid = nullptr;
    Face* topCap = nullptr;
    Loop* topHoleLoop = nullptr;
    Surface* topPlane = nullptr;
    std::size_t nHole = 0;
    double r = 0.0, cx = 0.0, cy = 0.0, H = 0.0;
};

static BlockWithHole buildBlockWithHole(TopologyBuilder& tb,
                                        double W, double D, double H,
                                        double cx, double cy, double r,
                                        std::size_t N) {
    BlockWithHole out;
    out.nHole = N;
    out.r = r; out.cx = cx; out.cy = cy; out.H = H;

    // --- Outer box corners (bottom z=0, top z=H), CCW in XY seen from +Z. -----
    // bottom: 0..3, top: 4..7
    Vertex* o[8];
    o[0] = tb.makeVertex({0, 0, 0});
    o[1] = tb.makeVertex({W, 0, 0});
    o[2] = tb.makeVertex({W, D, 0});
    o[3] = tb.makeVertex({0, D, 0});
    o[4] = tb.makeVertex({0, 0, H});
    o[5] = tb.makeVertex({W, 0, H});
    o[6] = tb.makeVertex({W, D, H});
    o[7] = tb.makeVertex({0, D, H});

    // --- Hole corners: N at bottom, N at top. Angle theta_i = 2pi i / N. ------
    std::vector<Vertex*> hb(N), ht(N);
    std::vector<double> theta(N + 1);
    for (std::size_t i = 0; i <= N; ++i) theta[i] = TWO_PI * double(i) / double(N);
    for (std::size_t i = 0; i < N; ++i) {
        double x = cx + r * std::cos(theta[i]);
        double y = cy + r * std::sin(theta[i]);
        hb[i] = tb.makeVertex({x, y, 0});
        ht[i] = tb.makeVertex({x, y, H});
    }

    Solid* solid = tb.makeSolid();
    Shell* shell = tb.makeShell();
    tb.addShellToSolid(solid, shell);
    out.solid = solid;

    // --- Bottom cap (z=0, outward normal -Z). Seen from -Z (below), the outer
    //     ring is CCW as 0,3,2,1; the hole ring, to keep material on the LEFT,
    //     winds OPPOSITE the outer (i.e. CCW-in-XY here). ----------------------
    {
        Face* bottom = tb.makeFace();
        tb.addFaceToShell(shell, bottom);
        std::vector<Vertex*> outer = {o[0], o[3], o[2], o[1]};
        tb.addOuterLoopToFace(bottom, outer);
        // inner hole ring (opposite winding to the outer as seen from -Z):
        std::vector<Vertex*> inner(N);
        for (std::size_t i = 0; i < N; ++i) inner[i] = hb[i];
        tb.addInnerLoopToFace(bottom, inner);
    }

    // --- Top cap (z=H, outward normal +Z). Seen from +Z (above), outer ring is
    //     CCW as 4,5,6,7; the hole ring winds opposite (CW-in-XY => reverse). --
    {
        Face* top = tb.makeFace();
        tb.addFaceToShell(shell, top);
        out.topCap = top;
        std::vector<Vertex*> outer = {o[4], o[5], o[6], o[7]};
        tb.addOuterLoopToFace(top, outer);
        std::vector<Vertex*> inner(N);
        for (std::size_t i = 0; i < N; ++i) inner[i] = ht[(N - i) % N]; // reversed
        out.topHoleLoop = tb.addInnerLoopToFace(top, inner);

        // Attach the cap's analytic PLANE surface: S(u,v) = origin + u*refDir +
        // v*binormal, with origin at (0,0,H), refDir = +X, axis = +Z (so the
        // plane parameters (u,v) are just (x,y) world coords on this cap).
        Surface* pl = tb.makeSurface();
        pl->kind = SurfaceKind::Plane;
        pl->origin = {0, 0, H};
        pl->refDir = {1, 0, 0};
        pl->axis   = {0, 0, 1};       // binormal = axis x refDir = +Y
        top->surface = pl;
        out.topPlane = pl;
    }

    // --- 4 outer side walls (each a quad, CCW from outside). ------------------
    const int wall[4][4] = {
        {0, 1, 5, 4}, // front  (y=0, -Y)
        {1, 2, 6, 5}, // right  (x=W, +X)
        {2, 3, 7, 6}, // back   (y=D, +Y)
        {3, 0, 4, 7}, // left   (x=0, -X)
    };
    for (auto& wq : wall) {
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        std::vector<Vertex*> ring = {o[wq[0]], o[wq[1]], o[wq[2]], o[wq[3]]};
        tb.addOuterLoopToFace(f, ring);
    }

    // --- N inner hole walls. Wall i spans bottom edge hb[i]->hb[i+1] and the
    //     two verticals. Oriented so its normal points INTO the hole (toward the
    //     axis), i.e. CCW when viewed from inside the hole looking outward.
    //     Ring: hb[i], ht[i], ht[i+1], hb[i+1]  ... choose the winding that
    //     makes every edge shared with the caps in the OPPOSITE sense. -------
    for (std::size_t i = 0; i < N; ++i) {
        std::size_t j = (i + 1) % N;
        Face* f = tb.makeFace();
        tb.addFaceToShell(shell, f);
        // bottom hole ring on the bottom cap was hb[0..N-1] (CCW-in-XY). The cap
        // coedge runs hb[i]->hb[i+1]; the wall must run the edge in the opposite
        // sense hb[i+1]->hb[i] to mate. Top hole ring was reversed, cap coedge
        // runs ht[i+1]->ht[i]; wall runs ht[i]->ht[i+1] to mate.
        std::vector<Vertex*> ring = {hb[j], hb[i], ht[i], ht[j]};
        tb.addOuterLoopToFace(f, ring);
    }

    return out;
}

// ===========================================================================
// (1) Face-with-hole topology + Euler-Poincare(genus 1)
// ===========================================================================
static void testFaceWithHoleTopology() {
    std::printf("[1] face-with-hole / genus-1 Euler-Poincare\n");
    TopologyBuilder tb;
    const std::size_t N = 8; // octagonal hole
    BlockWithHole bh = buildBlockWithHole(tb, 4.0, 3.0, 2.0,
                                          2.0, 1.5, 0.7, N);
    (void)bh.solid;

    EulerCounts c = tb.counts();
    std::printf("      V=%zu E=%zu F=%zu L=%zu(R=%zu) Sh=%zu  (V-E+F)=%lld\n",
                c.vertices, c.edges, c.faces, c.loops, c.innerLoops, c.shells,
                c.characteristic());

    // Closed-form counts for a block with an N-gon through-hole:
    //   V = 8 (box) + 2N (hole)
    //   E = 12 (box) + 3N (hole: N bottom-ring + N top-ring + N verticals)
    //   F = 2 caps + 4 outer walls + N inner walls
    //   L = F outer loops + 2 inner rings  (one hole loop per cap)
    const std::size_t expectV = 8 + 2 * N;
    const std::size_t expectE = 12 + 3 * N;
    const std::size_t expectF = 2 + 4 + N;
    const std::size_t expectL = expectF + 2;
    check(c.vertices == expectV, "V = 8 + 2N");
    check(c.edges    == expectE, "E = 12 + 3N");
    check(c.faces    == expectF, "F = 6 + N");
    check(c.loops    == expectL, "L = F + 2 (two hole rings)");
    check(c.innerLoops == 2, "inner (ring) loop count == 2");
    check(c.shells   == 1, "one shell");

    // The cap faces each carry exactly one outer + one inner loop.
    check(bh.topCap->loopCount() == 2, "top cap face has 2 loops (outer+hole)");
    check(bh.topCap->outerLoop != nullptr && bh.topCap->innerLoops.size() == 1,
          "top cap: 1 outerLoop + 1 innerLoop");
    check(bh.topHoleLoop != nullptr && !bh.topHoleLoop->isOuter,
          "top hole loop isOuter == false");
    check(bh.topHoleLoop->coedgeCount == N, "top hole loop has N coedges");

    // GENERAL Euler-Poincare with rings + genus: V - E + F - R - 2(S - G) = 0.
    check(c.eulerPoincareValid(/*shells*/ 1, /*genus*/ 1),
          "Euler-Poincare V-E+F-R-2(S-G)=0 with R=2,S=1,G=1");
    // And it must NOT validate as genus 0 (proves the genus term is load-bearing).
    check(!c.eulerPoincareValid(/*shells*/ 1, /*genus*/ 0),
          "same counts FAIL the genus-0 form (genus term is real)");

    // Structural closed-2-manifold: every edge shared by exactly two mated
    // opposite-sense coedges, every loop closes. This is the truth beyond the
    // arithmetic and confirms the inner-loop wiring is correct.
    check(tb.isClosedTwoManifold(),
          "block-with-hole is a closed 2-manifold (inner loops mated correctly)");
    check(tb.coedgeCount() == 2 * c.edges,
          "coedge count == 2 * edge count");
}

// ===========================================================================
// (2) PCurve <-> 3D edge Curve consistency: S(P(t)) == C(t) to 1e-9.
// ===========================================================================

// Compose the cap's Plane surface with a coedge's PCurve and compare to the 3D
// edge Curve over many samples. Returns the worst error.
static double maxComposeError(const Surface& S, const PCurve& pc,
                              const Curve& cv, int samples) {
    double worst = 0.0;
    for (int k = 0; k <= samples; ++k) {
        double s = double(k) / double(samples);
        // Map s in [0,1] to each curve's own [t0,t1] trim.
        double tp = pc.t0 + s * (pc.t1 - pc.t0);
        double tc = cv.t0 + s * (cv.t1 - cv.t0);
        UVCoord uv = pc.evaluate(tp);
        Vec3 onSurf = S.evaluate(uv.u, uv.v);  // S(P(t))
        Vec3 on3d   = cv.evaluate(tc);         // C(t)
        double e = std::fabs(onSurf.x - on3d.x);
        e = std::max(e, std::fabs(onSurf.y - on3d.y));
        e = std::max(e, std::fabs(onSurf.z - on3d.z));
        worst = std::max(worst, e);
    }
    return worst;
}

static void testPcurveCurveConsistency() {
    std::printf("[2] pcurve(coedge) composed with surface == 3D edge curve\n");
    TopologyBuilder tb;
    const std::size_t N = 12;
    const double H = 2.0, r = 0.7, cx = 2.0, cy = 1.5;
    BlockWithHole bh = buildBlockWithHole(tb, 4.0, 3.0, H, cx, cy, r, N);

    const Surface& plane = *bh.topPlane;
    const double tol = 1e-9;

    // --- (2a) Attach an exact CIRCLE 3D curve to each hole-rim edge, and the
    //     matching 2D CIRCLE pcurve to each top-cap hole coedge. The cap plane's
    //     (u,v) are world (x,y), so the circle's parameter-space centre is
    //     (cx,cy) and radius r. The top hole loop was wound REVERSED (ht[N-i]),
    //     so coedge k of the hole loop traverses angle decreasing; we attach the
    //     analytic arc over that coedge's own [t0,t1] and verify composition. ---
    Coedge* ce = bh.topHoleLoop->first;
    double worstCircle = 0.0;
    std::size_t checkedArcs = 0;
    for (std::size_t k = 0; k < bh.topHoleLoop->coedgeCount; ++k, ce = ce->next) {
        // This coedge runs origin->dest; recover the two angular params from the
        // 3D positions of its end vertices (exact, since they lie on the circle).
        Vertex* a = ce->originVertex();
        Vertex* b = ce->destVertex();
        double ta = std::atan2(a->point.y - cy, a->point.x - cx);
        double tb2 = std::atan2(b->point.y - cy, b->point.x - cx);
        // Keep the arc short (no +/-2pi wrap): if the jump exceeds pi, fold it.
        if (tb2 - ta >  M_PI) tb2 -= TWO_PI;
        if (tb2 - ta < -M_PI) tb2 += TWO_PI;

        // 3D edge curve: circle in the z=H plane, centre (cx,cy,H), refDir +X,
        // normal +Z, swept over [ta, tb2] (this coedge's traversal sense).
        Curve cv = Curve::makeCircle({cx, cy, H}, {1, 0, 0}, {0, 0, 1}, r,
                                     ta, tb2);
        Curve* cvp = tb.makeCurve(cv);
        ce->edge->curve = cvp;

        // 2D pcurve in the cap's (u,v)=(x,y) plane: circle centre (cx,cy),
        // radius r, same angular trim.
        PCurve pc = PCurve::makeCircle2({cx, cy}, r, ta, tb2);
        PCurve* pcp = tb.makePcurve(pc);
        ce->pcurve = pcp;

        double e = maxComposeError(plane, *pcp, *cvp, 16);
        worstCircle = std::max(worstCircle, e);
        ++checkedArcs;
    }
    std::printf("      circle arcs checked = %zu, worst |S(P(t)) - C(t)| = %.3e\n",
                checkedArcs, worstCircle);
    check(checkedArcs == N, "attached a circle pcurve+curve to every hole coedge");
    check(worstCircle <= tol,
          "S(P(t)) == C(t) to 1e-9 for every circular hole arc");

    // --- (2b) A straight OUTER edge: Line 3D curve + Line2 pcurve. Pick the top
    //     cap's outer loop first coedge (origin->dest along the cap rim). -------
    Coedge* oc = bh.topCap->outerLoop->first;
    Vertex* a = oc->originVertex();
    Vertex* b = oc->destVertex();
    Curve line = Curve::makeLine({a->point.x, a->point.y, a->point.z},
                                 {b->point.x, b->point.y, b->point.z});
    Curve* linep = tb.makeCurve(line);
    oc->edge->curve = linep;
    // In the cap plane (u,v)=(x,y): segment from (a.x,a.y) to (b.x,b.y).
    PCurve line2 = PCurve::makeLine2({a->point.x, a->point.y},
                                     {b->point.x, b->point.y});
    PCurve* line2p = tb.makePcurve(line2);
    oc->pcurve = line2p;
    double worstLine = maxComposeError(plane, *line2p, *linep, 16);
    std::printf("      outer line edge worst |S(P(t)) - C(t)| = %.3e\n", worstLine);
    check(worstLine <= tol, "straight outer edge: S(P(t)) == C(t) to 1e-9");

    // --- (2c) A BSpline 3D curve + matching BSpline2 pcurve. Build a cubic
    //     Bezier in the cap plane (z=H), express it as a 3D BSpline curve and as
    //     a 2D BSpline2 pcurve (z=0 in param space). Composition must agree
    //     because the plane maps (u,v)->(u,v,H). -----------------------------
    {
        NurbsCurve c3d;
        c3d.degree = 3;
        c3d.controlPoints = {
            {0.5, 0.5, H}, {1.5, 2.5, H}, {2.5, 2.5, H}, {3.5, 0.5, H}};
        c3d.weights = {1, 1, 1, 1};
        c3d.knots   = bezierKnotVector(3); // [0,0,0,0,1,1,1,1]
        Curve cv = Curve::makeBSpline(c3d);
        Curve* cvp = tb.makeCurve(cv);

        NurbsCurve c2d;
        c2d.degree = 3;
        c2d.controlPoints = {
            {0.5, 0.5, 0}, {1.5, 2.5, 0}, {2.5, 2.5, 0}, {3.5, 0.5, 0}};
        c2d.weights = {1, 1, 1, 1};
        c2d.knots   = bezierKnotVector(3);
        PCurve pc = PCurve::makeBSpline2(c2d);
        PCurve* pcp = tb.makePcurve(pc);

        double worstSpline = maxComposeError(plane, *pcp, *cvp, 24);
        std::printf("      bspline edge worst |S(P(t)) - C(t)| = %.3e\n",
                    worstSpline);
        check(worstSpline <= tol, "bspline edge: S(P(t)) == C(t) to 1e-9");
        // sanity: the bspline actually moved (not a degenerate point).
        Vec3 mid = cvp->evaluate(0.5);
        check(!approxPt(mid, cvp->evaluate(0.0), 1e-6),
              "bspline curve is non-degenerate (endpoints differ from mid)");
    }
}

// ===========================================================================
// (3) Per-entity tolerance (tolerant-entity semantics).
// ===========================================================================
static void testToleranceAttribute() {
    std::printf("[3] per-entity tolerance attribute\n");
    TopologyBuilder tb;
    Vertex* va = tb.makeVertex({0, 0, 0});
    Vertex* vb = tb.makeVertex({0, 0, 0});

    // Default: exact entities.
    check(va->tolerance == 0.0, "vertex default tolerance is 0 (exact)");
    Edge* e = tb.makeEdge(va, vb);
    check(e->tolerance == 0.0, "edge default tolerance is 0 (exact)");
    Coedge* ce = tb.makeCoedge(e, true);
    check(ce->tolerance == 0.0, "coedge default tolerance is 0 (exact)");

    // Set tolerances; tolerant-coincidence: |p_a - p_b| <= tol_a + tol_b.
    Vertex* p1 = tb.makeVertex({0, 0, 0});
    Vertex* p2 = tb.makeVertex({0, 0, 1e-6});
    p1->tolerance = 3e-7;
    p2->tolerance = 4e-7;
    e->tolerance = 1e-5;
    ce->tolerance = 2e-5;
    check(p1->tolerance == 3e-7 && p2->tolerance == 4e-7,
          "vertex tolerance stored/read-back");
    check(e->tolerance == 1e-5 && ce->tolerance == 2e-5,
          "edge/coedge tolerance stored/read-back");

    auto dist = [](const Vertex* a, const Vertex* b) {
        double dx = a->point.x - b->point.x;
        double dy = a->point.y - b->point.y;
        double dz = a->point.z - b->point.z;
        return std::sqrt(dx * dx + dy * dy + dz * dz);
    };
    double d = dist(p1, p2);                  // == 1e-6
    // Summed tolerance 3e-7 + 4e-7 = 7e-7 < 1e-6 -> NOT tolerantly coincident.
    bool coincidentTight = d <= (p1->tolerance + p2->tolerance);
    check(!coincidentTight,
          "1e-6 apart with 7e-7 summed tol -> NOT coincident");
    p1->tolerance = 7e-7;                     // sum 1.1e-6 >= 1e-6 -> coincident
    bool coincidentLoose = d <= (p1->tolerance + p2->tolerance);
    check(coincidentLoose,
          "widening tolerance makes them tolerantly coincident");
}

// ===========================================================================
int main() {
    std::printf("=== forge::native::brep — K0 topology FOUNDATION gate ===\n");
    testFaceWithHoleTopology();
    testPcurveCurveConsistency();
    testToleranceAttribute();

    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
