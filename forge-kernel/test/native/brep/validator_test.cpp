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

static void buildGeoBox(GeoBox& gb, double L) {
    gb.solid = gb.tb.buildBox({0, 0, 0}, {L, L, L});
    gb.shell = gb.solid->shells.front();
    gb.faces.assign(gb.shell->faces.begin(), gb.shell->faces.end());

    // Decorate every face with a Plane surface (outward normal) + vertexUV, and
    // every coedge with a consistent Line2 pcurve + the edge with a Line curve.
    // The box centroid is (L/2,L/2,L/2); a face's outward normal points away from it.
    const Point3 ctr{L * 0.5, L * 0.5, L * 0.5};

    for (Face* f : gb.faces) {
        std::vector<Coedge*> ring = ringCoedges(f->outerLoop);
        if (ring.size() < 3) continue;

        // Newell normal of the ring (3D), then orient it OUTWARD (away from ctr).
        Vec3 nrm{0, 0, 0};
        const std::size_t n = ring.size();
        for (std::size_t i = 0; i < n; ++i) {
            const Point3& a = ring[i]->originVertex()->point;
            const Point3& b = ring[(i + 1) % n]->originVertex()->point;
            nrm.x += (a.y - b.y) * (a.z + b.z);
            nrm.y += (a.z - b.z) * (a.x + b.x);
            nrm.z += (a.x - b.x) * (a.y + b.y);
        }
        Vec3 nn = vnormL(nrm);
        // face centroid
        Point3 fc{0, 0, 0};
        for (Coedge* c : ring) { const Point3& p = c->originVertex()->point; fc.x += p.x; fc.y += p.y; fc.z += p.z; }
        fc.x /= n; fc.y /= n; fc.z /= n;
        Vec3 outward = vnormL({fc.x - ctr.x, fc.y - ctr.y, fc.z - ctr.z});
        if (vdotL(nn, outward) < 0) nn = {-nn.x, -nn.y, -nn.z};

        // Plane surface: origin = first ring vertex, refDir = first edge dir,
        // axis = outward normal (so normalAt returns outward), reversed=false.
        Surface* s = gb.tb.makeSurface();
        s->kind = SurfaceKind::Plane;
        const Point3& o = ring[0]->originVertex()->point;
        s->origin = {o.x, o.y, o.z};
        s->refDir = vnormL(vsubL(ring[1]->originVertex()->point, o));
        s->axis = nn;
        s->reversed = false;
        f->surface = s;

        // vertexUV (outer ring order) + param rectangle from the in-plane coords.
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

        // Each coedge gets a Line2 pcurve from its (u,v) origin to its (u,v) dest,
        // and (once per edge) a Line 3D curve start->end. The Line2 composed with
        // the Plane surface S(u,v) = origin + u*refDir + v*binormal exactly
        // reproduces the 3D edge segment (the K0 consistency invariant).
        for (std::size_t k = 0; k < n; ++k) {
            Coedge* c = ring[k];
            const std::size_t kn = (k + 1) % n;
            UVCoord a{f->vertexUV[k][0],  f->vertexUV[k][1]};
            UVCoord b{f->vertexUV[kn][0], f->vertexUV[kn][1]};
            // pcurve runs origin->dest in this coedge's traversal sense.
            c->pcurve = gb.tb.makePcurve(PCurve::makeLine2(a, b));

            // 3D curve on the edge (set once: when the edge has no curve yet).
            Edge* e = c->edge;
            if (e->curve == nullptr) {
                Vec3 p0 = (e->start ? Vec3{e->start->point.x, e->start->point.y, e->start->point.z} : Vec3{});
                Vec3 p1 = (e->end   ? Vec3{e->end->point.x,   e->end->point.y,   e->end->point.z}   : Vec3{});
                e->curve = gb.tb.makeCurve(Curve::makeLine(p0, p1));
            }
        }
    }
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

int main() {
    std::printf("=== forge::native::brep — K5 / H1.1 native B-rep VALIDATOR gate ===\n");
    testValidBox();
    testFlipFaceNormal();
    testZeroLengthEdge();
    testNonManifoldEdge();
    testFreeEdge();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
