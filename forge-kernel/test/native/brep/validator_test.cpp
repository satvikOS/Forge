// forge/native/brep/validator_test.cpp
//
// Standalone validation gate for the K5 / H1.1 NATIVE B-REP VALIDATOR
// (Check.hpp / Check.cpp) — the in-house equivalent of Spatial ACIS check_entity
// / OCCT BRepCheck_Analyzer. Pure C++20, NO external dependencies, NO OCCT,
// NO WASM, no test framework — a tiny hand-rolled harness that prints PASS/FAIL
// and exits non-zero on any failure (mirrors sew_test.cpp / k0_topology_test.cpp).
//
// Build + run (run_native.sh discovers this automatically; manual line below):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/Check.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/ExactReal.cpp \
//     forge-kernel/src/native/ExactPredicates3D.cpp \
//     forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
//     forge-kernel/test/native/brep/validator_test.cpp \
//     -o /tmp/validator_test && /tmp/validator_test
//
// VALIDATION GATE (asserted below):
//   (0) VALID SEWN BOX. A geometry-bearing closed box (six Plane faces, each with
//       an outward analytic normal + per-vertex (u,v), and Line 3D curves + Line2
//       pcurves on every edge/coedge) passes EVERY predicate in the battery
//       (TOPOLOGY T1-T8, GEOMETRY G1-G8, ORIENTATION O1-O3). report.valid == true.
//   (1) FLIP ONE FACE NORMAL  -> G3.FaceNormalOutward FAILS, names that face.
//   (2) COLLAPSE AN EDGE TO ZERO LENGTH -> G1.NoZeroLengthEdge FAILS, names it.
//   (3) PUNCH A NON-MANIFOLD EDGE (a 3rd coedge on one edge) ->
//       T1.EveryEdgeHasOneOrTwoCoedges FAILS, names that edge.
//   (4) LEAVE A FREE EDGE (drop one face -> open shell) ->
//       T6.ShellClosureConsistent FAILS, names the rim free edges.
//   Each defect leaves the OTHER families' core predicates intact (the report
//   isolates the one matching status), proving the battery is selective.

#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/TrimmedFace.hpp"   // TrimmedFace self-intersection (G4-trimmed)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0;
static int g_total = 0;

static void check(bool cond, const std::string& name) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else        std::printf("  [FAIL] %s\n", name.c_str());
}

// True iff the named predicate ran and is reported PASSED.
static bool predPassed(const CheckReport& r, const std::string& name) {
    const CheckPredicate* p = r.find(name);
    return p != nullptr && p->passed;
}
// True iff the named predicate ran, FAILED, and its offender list contains `id`.
static bool predFailedNaming(const CheckReport& r, const std::string& name,
                             std::uint32_t id) {
    const CheckPredicate* p = r.find(name);
    if (p == nullptr || p->passed) return false;
    for (const auto& o : p->offenders) if (o.id == id) return true;
    return false;
}

// ===========================================================================
// Build a GEOMETRY-BEARING closed box [0,L]^3 through the public topology API,
// then attach to every face a Plane surface whose analytic normal points OUTWARD,
// the per-vertex (u,v) of its outer-loop ring, and to every edge/coedge a Line 3D
// curve + Line2 pcurve consistent with the geometry. This is the canonical
// "valid sewn box" the validator must pass on every predicate.
//
// We reuse TopologyBuilder::buildBox for the topology (8 V, 12 shared E, 6 F, each
// edge already carrying two opposite-sense coedges), then decorate it with the
// analytic geometry the GEOMETRY/ORIENTATION predicates consume.
// ===========================================================================
struct GeoBox {
    TopologyBuilder tb;
    Solid* solid = nullptr;
    Shell* shell = nullptr;
    std::vector<Face*> faces;   // the 6 box faces, in buildBox order
};

static Vec3 vsubL(const Point3& a, const Point3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static double vlenL(const Vec3& a) { return std::sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
static Vec3 vnormL(const Vec3& a) { double L = vlenL(a); return (L > 0) ? Vec3{a.x/L, a.y/L, a.z/L} : a; }
static Vec3 vcrossL(const Vec3& a, const Vec3& b) {
    return {a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x};
}
static double vdotL(const Vec3& a, const Vec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }

// Walk a loop's coedges (origin order) into a vector.
static std::vector<Coedge*> ringCoedges(Loop* lp) {
    std::vector<Coedge*> out;
    if (!lp || !lp->first) return out;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) { out.push_back(c); c = c->next; }
    return out;
}

// Decorate ONE face with a Plane surface whose analytic normal points OUTWARD
// (away from the supplied body centroid `ctr`), the per-vertex (u,v) of its outer
// ring, a Line2 pcurve on every coedge and a Line 3D curve on every (still-bare)
// edge — exactly the geometry the GEOMETRY/ORIENTATION predicates consume. Shared
// by the box AND the L-block builders so both produce identically-decorated faces.
static void decorateFaceOutward(TopologyBuilder& tb, Face* f, const Point3& ctr) {
    std::vector<Coedge*> ring = ringCoedges(f->outerLoop);
    const std::size_t n = ring.size();
    if (n < 3) return;

    // Newell normal of the ring (3D). The topology is built CONSISTENTLY wound
    // (every face's ring CCW as seen from OUTSIDE), so the right-hand-rule Newell
    // normal already points OUTWARD for EVERY face — including the re-entrant pocket
    // walls of the concave L-block, where a (faceCentroid − bodyCentroid) heuristic
    // would point the wrong way. We therefore take the winding normal directly as
    // the analytic outward axis (no centroid flip — that heuristic is the very thing
    // the robust G3 replaces). `ctr` is retained only for documentation symmetry.
    (void)ctr;
    Vec3 nrm{0, 0, 0};
    for (std::size_t i = 0; i < n; ++i) {
        const Point3& a = ring[i]->originVertex()->point;
        const Point3& b = ring[(i + 1) % n]->originVertex()->point;
        nrm.x += (a.y - b.y) * (a.z + b.z);
        nrm.y += (a.z - b.z) * (a.x + b.x);
        nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    Vec3 nn = vnormL(nrm);

    Surface* s = tb.makeSurface();
    s->kind = SurfaceKind::Plane;
    const Point3& o = ring[0]->originVertex()->point;
    s->origin = {o.x, o.y, o.z};
    s->refDir = vnormL(vsubL(ring[1]->originVertex()->point, o));
    s->axis = nn;
    s->reversed = false;
    f->surface = s;

    Vec3 uDir = s->refDir, vDir = s->binormal();  // binormal = axis x refDir
    f->vertexUV.clear();
    double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
    for (std::size_t k = 0; k < n; ++k) {
        const Point3& p = ring[k]->originVertex()->point;
        Vec3 rel = vsubL(p, o);
        double pu = vdotL(rel, uDir), pv = vdotL(rel, vDir);
        f->vertexUV.push_back({pu, pv});
        if (k == 0) { u0 = u1 = pu; v0 = v1 = pv; }
        else { u0 = std::min(u0, pu); u1 = std::max(u1, pu);
               v0 = std::min(v0, pv); v1 = std::max(v1, pv); }
    }
    f->u0 = u0; f->u1 = u1; f->v0 = v0; f->v1 = v1;

    for (std::size_t k = 0; k < n; ++k) {
        Coedge* c = ring[k];
        const std::size_t kn = (k + 1) % n;
        UVCoord a{f->vertexUV[k][0],  f->vertexUV[k][1]};
        UVCoord b{f->vertexUV[kn][0], f->vertexUV[kn][1]};
        c->pcurve = tb.makePcurve(PCurve::makeLine2(a, b));
        Edge* e = c->edge;
        if (e->curve == nullptr) {
            Vec3 p0 = (e->start ? Vec3{e->start->point.x, e->start->point.y, e->start->point.z} : Vec3{});
            Vec3 p1 = (e->end   ? Vec3{e->end->point.x,   e->end->point.y,   e->end->point.z}   : Vec3{});
            e->curve = tb.makeCurve(Curve::makeLine(p0, p1));
        }
    }
}

static void buildGeoBox(GeoBox& gb, double L) {
    gb.solid = gb.tb.buildBox({0, 0, 0}, {L, L, L});
    gb.shell = gb.solid->shells.front();
    gb.faces.assign(gb.shell->faces.begin(), gb.shell->faces.end());

    // The box centroid is (L/2,L/2,L/2); a face's outward normal points away from it.
    const Point3 ctr{L * 0.5, L * 0.5, L * 0.5};
    for (Face* f : gb.faces) decorateFaceOutward(gb.tb, f, ctr);
}

// ===========================================================================
// Build a GEOMETRY-BEARING closed L-BLOCK (a DEEP NON-CONVEX solid) so the robust
// G3 divergence/signed-volume test is exercised on the exact case the old centroid
// heuristic mis-called: a face whose true outward normal points TOWARD the body
// centroid (the inner faces of the re-entrant pocket).
//
// L-shaped cross-section in the XY plane (CCW), extruded in Z over [0,H]:
//
//   y=W ┌────────┐(b,W)
//       │        │
//   y=N │   ┌────┘(b,N)          The pocket is the rectangle [a,b]×[N,W]; the two
//       │   │                    re-entrant inner side faces (x=a above y=N, and
//   y=0 └───┘(a,0)               y=N right of x=a) point INTO the body centroid.
//      x=0 a    b
//
// Cross-section vertices CCW: (0,0)(a,0)(a,N)(b,N)(b,W)(0,W).  6 verts -> the prism
// has 6 side quad faces + 2 hexagonal caps = 8 faces, closed 2-manifold.
// ===========================================================================
struct LBlock {
    TopologyBuilder tb;
    Shell* shell = nullptr;
    std::vector<Face*> faces;
    Point3 centroid{};
};

static void buildLBlock(LBlock& lb) {
    // Concrete dimensions giving a DEEP pocket (re-entrant faces clearly inward).
    const double a = 1.0, b = 4.0, N = 1.0, W = 4.0, H = 2.0;
    // CCW cross-section (as seen from +Z, the top cap looking down is CW; we list
    // the bottom-cap ring CCW-from-outside below).
    struct P2 { double x, y; };
    const P2 cs[6] = { {0,0}, {a,0}, {a,N}, {b,N}, {b,W}, {0,W} };

    lb.shell = lb.tb.makeShell();

    // Two layers of 6 vertices: bottom z=0, top z=H.
    Vertex* vb[6]; Vertex* vt[6];
    for (int i = 0; i < 6; ++i) {
        vb[i] = lb.tb.makeVertex({cs[i].x, cs[i].y, 0.0});
        vt[i] = lb.tb.makeVertex({cs[i].x, cs[i].y, H});
    }

    // Body centroid (approximate, just to seed outward orientation): the area
    // centroid of the L in XY at z=H/2. We use the simple vertex mean of all 12 —
    // good enough to orient each face outward (decorateFaceOutward flips per face).
    Point3 ctr{0, 0, 0};
    for (int i = 0; i < 6; ++i) {
        ctr.x += cs[i].x; ctr.y += cs[i].y;
    }
    ctr.x /= 6.0; ctr.y /= 6.0; ctr.z = H * 0.5;
    lb.centroid = ctr;

    auto addFace = [&](const std::vector<Vertex*>& ring) -> Face* {
        Face* f = lb.tb.makeFace();
        lb.tb.addFaceToShell(lb.shell, f);
        lb.tb.addOuterLoopToFace(f, ring);
        lb.faces.push_back(f);
        return f;
    };

    // 6 SIDE faces (one per cross-section edge i -> i+1), each a vertical quad.
    // Wound bottom_i -> bottom_{i+1} -> top_{i+1} -> top_i (decorate flips outward).
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        addFace({ vb[i], vb[j], vt[j], vt[i] });
    }
    // BOTTOM cap (z=0): outward normal is −Z, so its ring is CCW viewed from BELOW,
    // i.e. the REVERSE of the +Z-CCW cross-section order (vb[5]..vb[0]). This keeps
    // every shared vertical edge traversed oppositely by cap and side (O1) and the
    // cap loop CCW in its own outward (u,v) frame (O2).
    addFace({ vb[5], vb[4], vb[3], vb[2], vb[1], vb[0] });   // bottom (reversed)
    // TOP cap (z=H): outward normal +Z, CCW viewed from above == cross-section order.
    addFace({ vt[0], vt[1], vt[2], vt[3], vt[4], vt[5] });   // top

    // Decorate every face outward (the divergence test does not even need the
    // analytic surface, but we attach it so G3 runs the analytic branch too).
    for (Face* f : lb.faces) decorateFaceOutward(lb.tb, f, ctr);
}

// ===========================================================================
// (0) VALID SEWN BOX -> every predicate passes.
// ===========================================================================
static void testValidBox() {
    std::printf("[0] valid geometry-bearing sewn box -> ALL predicates pass\n");
    GeoBox gb;
    buildGeoBox(gb, 4.0);

    CheckReport r = checkBRep(gb.shell);
    std::printf("      battery: %zu predicates, %zu passed, %zu failed\n",
                r.total(), r.passed(), r.failed());
    // List any failures explicitly for diagnosis.
    for (const auto& p : r.predicates) {
        if (!p.passed) std::printf("      [report] FAIL %s (%s) %s\n",
                                   p.name.c_str(), checkStatusName(p.status), p.detail.c_str());
    }
    check(r.total() >= 20, "battery has >= 20 predicates");
    check(r.valid, "report.valid == true (no defect)");
    check(r.failed() == 0, "0 predicates failed on the clean box");
    // Spot-check EVERY predicate of each family explicitly.
    check(predPassed(r, "T1.EveryEdgeHasOneOrTwoCoedges"), "T1 passes");
    check(predPassed(r, "T2.NoDanglingCoedge"),            "T2 passes");
    check(predPassed(r, "T3.NoDuplicateEdge"),             "T3 passes");
    check(predPassed(r, "T4.WireClosure"),                 "T4 passes");
    check(predPassed(r, "T5.FaceHasOuterLoop"),            "T5 passes");
    check(predPassed(r, "T6.ShellClosureConsistent"),      "T6 passes");
    check(predPassed(r, "T7.ShellConnected"),              "T7 passes");
    check(predPassed(r, "T8.EulerPoincareConsistent"),     "T8 passes");
    check(predPassed(r, "T9.NoNonManifoldEdge"),           "T9 passes");
    check(predPassed(r, "G1.NoZeroLengthEdge"),            "G1 passes");
    check(predPassed(r, "G2.NoDegenerateFace"),            "G2 passes");
    check(predPassed(r, "G3.FaceNormalOutward"),           "G3 passes");
    check(predPassed(r, "G4.NoSelfIntersectingFace"),      "G4 passes");
    check(predPassed(r, "G5.PCurveMatches3DEdge"),         "G5 passes");
    check(predPassed(r, "G6.VertexOnEdge"),                "G6 passes");
    check(predPassed(r, "G7.EdgeOnFace"),                  "G7 passes");
    check(predPassed(r, "G8.ToleranceValid"),              "G8 passes");
    check(predPassed(r, "G9.EdgeSameParameter"),           "G9 passes");
    check(predPassed(r, "O1.CoedgePairsOpposite"),         "O1 passes");
    check(predPassed(r, "O2.OuterLoopCCW"),                "O2 passes");
    check(predPassed(r, "O3.CoedgeMateConsistent"),        "O3 passes");
}

// ===========================================================================
// (1) FLIP ONE FACE NORMAL -> G3 fails and names that face.
// We reverse the analytic surface (Surface::reversed) on face 0 so its outward
// normal now points INWARD. G3 must catch exactly that face; T/other-G predicates
// stay green.
// ===========================================================================
static void testFlipFaceNormal() {
    std::printf("[1] flip one face normal -> G3.FaceNormalOutward fails, names it\n");
    GeoBox gb;
    buildGeoBox(gb, 4.0);

    Face* victim = gb.faces[0];
    victim->surface->reversed = !victim->surface->reversed;  // flip the analytic normal inward

    CheckReport r = checkBRep(gb.shell);
    check(!r.valid, "report.valid == false (defect present)");
    check(predFailedNaming(r, "G3.FaceNormalOutward", victim->id),
          "G3 fails AND names the flipped face id");
    // The flip must not corrupt the purely-topological predicates.
    check(predPassed(r, "T1.EveryEdgeHasOneOrTwoCoedges"), "T1 still passes (topology intact)");
    check(predPassed(r, "T6.ShellClosureConsistent"),      "T6 still passes (still closed)");
    check(predPassed(r, "O1.CoedgePairsOpposite"),         "O1 still passes");
    const CheckPredicate* g3 = r.find("G3.FaceNormalOutward");
    std::printf("      -> G3 offenders: %zu (expect 1), detail '%s'\n",
                g3 ? g3->offenders.size() : 0, g3 ? g3->detail.c_str() : "");
}

// ===========================================================================
// (2) COLLAPSE AN EDGE TO ZERO LENGTH -> G1 fails and names it.
// We move both endpoint vertices of one edge to the same point (and collapse its
// Line curve), making the edge degenerate. G1 must catch exactly that edge.
// ===========================================================================
static void testZeroLengthEdge() {
    std::printf("[2] collapse an edge to zero length -> G1.NoZeroLengthEdge fails, names it\n");
    GeoBox gb;
    buildGeoBox(gb, 4.0);

    // Pick edge of the first coedge of face 0.
    std::vector<Coedge*> ring = ringCoedges(gb.faces[0]->outerLoop);
    Edge* victim = ring[0]->edge;
    // Collapse: snap end onto start, and collapse the edge's 3D curve trim.
    victim->end->point = victim->start->point;
    if (victim->curve) {
        Vec3 p = {victim->start->point.x, victim->start->point.y, victim->start->point.z};
        *victim->curve = Curve::makeLine(p, p);   // zero-length line
    }

    CheckReport r = checkBRep(gb.shell);
    check(!r.valid, "report.valid == false (defect present)");
    check(predFailedNaming(r, "G1.NoZeroLengthEdge", victim->id),
          "G1 fails AND names the collapsed edge id");
    const CheckPredicate* g1 = r.find("G1.NoZeroLengthEdge");
    std::printf("      -> G1 offenders: %zu (>=1), detail '%s'\n",
                g1 ? g1->offenders.size() : 0, g1 ? g1->detail.c_str() : "");
}

// ===========================================================================
// (3) PUNCH A NON-MANIFOLD EDGE -> T1 fails and names it.
// We graft a THIRD coedge onto one of the box's manifold edges (a duplicate use
// of an adjacent face's loop boundary). The validator's per-edge coedge count
// then reads 3 -> T1.EveryEdgeHasOneOrTwoCoedges must flag exactly that edge.
//
// To create a clean extra coedge that the loop-walk WILL see, we splice a tiny
// extra face (a triangle) whose outer loop reuses the victim edge, giving the
// edge a 3rd coedge use within the validated face set.
// ===========================================================================
static void testNonManifoldEdge() {
    std::printf("[3] punch a non-manifold edge -> T1.EveryEdgeHasOneOrTwoCoedges fails, names it\n");
    GeoBox gb;
    buildGeoBox(gb, 4.0);

    // Victim edge: the first edge of face 0's loop (currently 2 coedges).
    std::vector<Coedge*> ring = ringCoedges(gb.faces[0]->outerLoop);
    Edge* victim = ring[0]->edge;
    Vertex* a = victim->start;
    Vertex* b = victim->end;

    // Build an extra triangular face with its OWN fresh edges (so makeCoedge's
    // two-coedge-per-edge invariant is never tripped), then RE-POINT the triangle
    // coedge that runs a->b at the VICTIM edge. The validator counts coedge USES
    // across the face set by walking loops, so the victim edge now reads THREE
    // uses (box face 0, box face's neighbour, this triangle) -> non-manifold.
    // This is exactly the radial-edge fan the non-manifold representation (H2.2)
    // will own; here we exercise the validator's DETECTION of it.
    Face* extra = gb.tb.makeFace();
    gb.tb.addFaceToShell(gb.shell, extra);
    Vertex* apex = gb.tb.makeVertex({a->point.x, a->point.y, a->point.z - 2.0});
    // Fresh duplicate endpoints so addOuterLoopToFace makes private edges.
    Vertex* a2 = gb.tb.makeVertex(a->point);
    Vertex* b2 = gb.tb.makeVertex(b->point);
    std::vector<Vertex*> tri = {a2, b2, apex};
    gb.tb.addOuterLoopToFace(extra, tri);
    // Re-point the first triangle coedge (a2->b2) onto the victim edge so the
    // validator sees a 3rd use of the victim edge in the walked loop set.
    Coedge* tc0 = extra->outerLoop->first;
    tc0->edge = victim;

    CheckReport r = checkBRep(gb.shell);
    check(!r.valid, "report.valid == false (defect present)");
    check(predFailedNaming(r, "T1.EveryEdgeHasOneOrTwoCoedges", victim->id),
          "T1 fails AND names the non-manifold edge id");
    check(predFailedNaming(r, "T9.NoNonManifoldEdge", victim->id),
          "T9 (explicit non-manifold) fails AND names the edge id");
    const CheckPredicate* t1 = r.find("T1.EveryEdgeHasOneOrTwoCoedges");
    std::printf("      -> T1 offenders: %zu (>=1) including edge %u\n",
                t1 ? t1->offenders.size() : 0, victim->id);
}

// ===========================================================================
// (4) LEAVE A FREE EDGE -> T6 fails and names the rim free edges.
// We validate FIVE of the box's six faces (drop the top face). The four rim edges
// of the missing face are now free (1 coedge each) -> the shell is OPEN, and
// T6.ShellClosureConsistent (expectClosed default) must fail and name those
// free edges.
// ===========================================================================
static void testFreeEdge() {
    std::printf("[4] leave a free edge (drop a face) -> T6.ShellClosureConsistent fails, names rim\n");
    GeoBox gb;
    buildGeoBox(gb, 4.0);

    // Drop the top face (index 1 in buildBox order). Validate the remaining 5.
    std::vector<Face*> five;
    for (std::size_t i = 0; i < gb.faces.size(); ++i) if (i != 1) five.push_back(gb.faces[i]);

    CheckReport r = checkBRep(five);  // default opt: expectClosed == true
    check(!r.valid, "report.valid == false (open shell)");
    const CheckPredicate* t6 = r.find("T6.ShellClosureConsistent");
    check(t6 != nullptr && !t6->passed, "T6 fails on the open shell");
    check(t6 != nullptr && t6->offenders.size() == 4, "T6 names EXACTLY 4 free rim edges");
    // The free-edge defect must not be mistaken for non-manifold or a flipped face.
    check(predPassed(r, "T1.EveryEdgeHasOneOrTwoCoedges"), "T1 still passes (no edge has 3 coedges)");
    check(predPassed(r, "G3.FaceNormalOutward"),           "G3 still passes (faces still outward)");
    std::printf("      -> T6 offenders (free edges): %zu (expect 4)\n",
                t6 ? t6->offenders.size() : 0);
}

// ===========================================================================
// (5) TRIMMED-NURBS FACE self-intersection (the exhaustive G4 completion).
//
// Build a PLANAR trimmed face S(u,v)=(L·u, L·v, 0) over the unit (u,v) square with
// an INNER hole loop. Three sub-cases:
//   (5a) VALID: a small hole fully inside the outer square -> NO self-intersection.
//   (5b) HOLE POKES OUTSIDE the outer loop (a hole whose boundary crosses the outer
//        square edge) -> checkTrimmedFaceSelfIntersection FAILS, names both loops.
//   (5c) CURVED PCURVE self-crossing (a figure-eight outer loop) -> FAILS, names it.
// ===========================================================================
static NurbsSurface makePlaneSurf(double L) {
    NurbsSurface s;
    s.degreeU = 1; s.degreeV = 1;
    s.control = { { {0,0,0}, {0,L,0} }, { {L,0,0}, {L,L,0} } };
    s.weights = { {1,1}, {1,1} };
    s.knotsU = {0,0,1,1};
    s.knotsV = {0,0,1,1};
    return s;
}
static TrimLoop squareOuter() {
    TrimLoop lp; lp.isOuter = true;
    lp.segments.push_back(PCurve::makeLine2({0,0},{1,0}));
    lp.segments.push_back(PCurve::makeLine2({1,0},{1,1}));
    lp.segments.push_back(PCurve::makeLine2({1,1},{0,1}));
    lp.segments.push_back(PCurve::makeLine2({0,1},{0,0}));
    return lp;
}
// A square hole [u0,u1]x[v0,v1], wound CW (opposite the CCW outer).
static TrimLoop squareHole(double u0, double u1, double v0, double v1) {
    TrimLoop lp; lp.isOuter = false;
    lp.segments.push_back(PCurve::makeLine2({u0,v0},{u0,v1}));
    lp.segments.push_back(PCurve::makeLine2({u0,v1},{u1,v1}));
    lp.segments.push_back(PCurve::makeLine2({u1,v1},{u1,v0}));
    lp.segments.push_back(PCurve::makeLine2({u1,v0},{u0,v0}));
    return lp;
}

static void testTrimmedSelfIntersect() {
    std::printf("[5] trimmed-NURBS face self-intersection (G4-trimmed)\n");

    // (5a) VALID: hole [0.3,0.6]x[0.3,0.6] fully inside the unit square.
    {
        TrimmedFace f;
        f.surface = makePlaneSurf(4.0);
        f.loops.push_back(squareOuter());
        f.loops.push_back(squareHole(0.3, 0.6, 0.3, 0.6));
        const char* vr = nullptr;
        check(f.valid(&vr), std::string("5a face valid (") + (vr ? vr : "") + ")");
        TrimSelfIntersectResult r = checkTrimmedFaceSelfIntersection(f);
        check(!r.selfIntersects, "5a VALID interior hole -> NO self-intersection");
    }

    // (5b) HOLE POKES OUTSIDE: hole [0.7,1.3]x[0.4,0.6] straddles the u=1 edge of the
    //      outer square, so its boundary CROSSES the outer loop -> imbrication.
    {
        TrimmedFace f;
        f.surface = makePlaneSurf(4.0);
        f.loops.push_back(squareOuter());
        f.loops.push_back(squareHole(0.7, 1.3, 0.4, 0.6));
        TrimSelfIntersectResult r = checkTrimmedFaceSelfIntersection(f);
        check(r.selfIntersects, "5b hole poking outside outer loop -> self-intersection FAILS");
        check(r.status == CheckStatus::SelfIntersectingWire,
              "5b status == SelfIntersectingWire");
        // It must NAME the two participating loops (outer idx 0 + the hole idx 1).
        bool names01 = (r.loops.size() == 2) &&
            ((r.loops[0] == 0 && r.loops[1] == 1) || (r.loops[0] == 1 && r.loops[1] == 0));
        check(names01, "5b names the outer (0) and hole (1) loops");
        std::printf("      -> 5b detail: '%s'\n", r.detail.c_str());
    }

    // (5b') WHOLLY-OUTSIDE hole: hole [1.2,1.5]x[0.4,0.6] sits entirely outside the
    //       outer square (no boundary crossing) -> still flagged by containment.
    {
        TrimmedFace f;
        f.surface = makePlaneSurf(4.0);
        f.loops.push_back(squareOuter());
        f.loops.push_back(squareHole(1.2, 1.5, 0.4, 0.6));
        TrimSelfIntersectResult r = checkTrimmedFaceSelfIntersection(f);
        check(r.selfIntersects, "5b' hole wholly outside outer loop -> self-intersection FAILS");
        std::printf("      -> 5b' detail: '%s'\n", r.detail.c_str());
    }

    // (5c) FIGURE-EIGHT / bowtie outer loop whose two strands cross TRANSVERSALLY at
    //      a point that is NOT a flattening vertex: segment 0 (0,0)->(0.9,0.9) and
    //      segment 2 (0.9,0.1)->(0,0.8) cross near (0.1..,0.1..) at unequal fractions
    //      along each, so adjacent flattened sub-edges straddle (exact proper-cross
    //      path), AND the pinch is also caught by the non-adjacent-vertex test. The
    //      single loop is a non-simple wire either way.
    {
        TrimmedFace f;
        f.surface = makePlaneSurf(4.0);
        TrimLoop bow; bow.isOuter = true;
        bow.segments.push_back(PCurve::makeLine2({0.0, 0.0}, {1.0, 1.0}));
        bow.segments.push_back(PCurve::makeLine2({1.0, 1.0}, {1.0, 0.2}));
        bow.segments.push_back(PCurve::makeLine2({1.0, 0.2}, {0.0, 0.5}));
        bow.segments.push_back(PCurve::makeLine2({0.0, 0.5}, {0.0, 0.0}));
        f.loops.push_back(bow);
        TrimSelfIntersectResult r = checkTrimmedFaceSelfIntersection(f);
        check(r.selfIntersects, "5c figure-eight outer pcurve -> self-intersection FAILS");
        check(r.loops.size() == 1 && r.loops[0] == 0, "5c names loop 0 (intra-loop self-cross)");
        std::printf("      -> 5c detail: '%s'\n", r.detail.c_str());
    }
}

// ===========================================================================
// (6) DEEP-CONCAVE L-BLOCK G3 — the case the centroid heuristic mis-called.
//
//   (6a) VALID L-block (all faces outward) -> G3.FaceNormalOutward PASSES. The old
//        centroid heuristic FAILED this (a re-entrant inner face's true outward
//        normal points toward the body centroid).
//   (6b) FLIP one re-entrant inner face -> G3 FAILS and names exactly that face,
//        with the other families intact.
// ===========================================================================
static void testLBlockG3() {
    std::printf("[6] deep-concave L-block -> robust G3.FaceNormalOutward\n");

    // (6a) VALID L-block: every predicate (esp. G3) passes.
    {
        LBlock lb;
        buildLBlock(lb);
        CheckReport r = checkBRep(lb.shell);
        for (const auto& p : r.predicates)
            if (!p.passed) std::printf("      [report] FAIL %s (%s) %s\n",
                                       p.name.c_str(), checkStatusName(p.status), p.detail.c_str());
        check(predPassed(r, "G3.FaceNormalOutward"),
              "6a VALID concave L-block PASSES G3 (centroid heuristic would mis-call)");
        check(predPassed(r, "T6.ShellClosureConsistent"), "6a L-block is closed (T6)");
        check(predPassed(r, "T1.EveryEdgeHasOneOrTwoCoedges"), "6a L-block is 2-manifold (T1)");
    }

    // (6b) FLIP a re-entrant inner face. The two re-entrant side faces are side
    //      faces #2 (edge (a,N)->(b,N)) and #1 (edge (a,0)->(a,N)) — the pocket
    //      walls. Flip side face #2's analytic surface and confirm G3 names it.
    {
        LBlock lb;
        buildLBlock(lb);
        // Side faces are lb.faces[0..5] in cross-section-edge order; index 2 is the
        // re-entrant pocket wall edge (a,N)->(b,N).
        Face* victim = lb.faces[2];
        victim->surface->reversed = !victim->surface->reversed;

        CheckReport r = checkBRep(lb.shell);
        check(!r.valid, "6b report.valid == false (inverted re-entrant face)");
        check(predFailedNaming(r, "G3.FaceNormalOutward", victim->id),
              "6b G3 FAILS and names the inverted re-entrant face");
        check(predPassed(r, "T1.EveryEdgeHasOneOrTwoCoedges"), "6b topology intact (T1)");
        check(predPassed(r, "T6.ShellClosureConsistent"),      "6b still closed (T6)");
        const CheckPredicate* g3 = r.find("G3.FaceNormalOutward");
        std::printf("      -> 6b G3 offenders: %zu (expect 1), detail '%s'\n",
                    g3 ? g3->offenders.size() : 0, g3 ? g3->detail.c_str() : "");
    }
}

int main() {
    std::printf("=== forge::native::brep — K5 / H1.1 native B-rep VALIDATOR gate ===\n");
    testValidBox();
    testFlipFaceNormal();
    testZeroLengthEdge();
    testNonManifoldEdge();
    testFreeEdge();
    testTrimmedSelfIntersect();
    testLBlockG3();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
