// forge/native/brep/heal_truth_test.cpp
//
// T-137 + T-138 — the HEAL TRUTH gate.
//
// Two defects, both of which shipped GREEN (heal_test 68/68, sew_test 34/34,
// validator_test 54/54, k0_topology_test 26/26 all passed over them), because
// nothing in the suite ever handed healBRep a THIN part or measured how long the
// self-intersection pass took.
//
// ─── T-137: A GREEN REPORT OVER A DESTROYED SOLID ───────────────────────────
// A valid 100 x 100 x 0.001 mm plate, handed to healBRep as the independent-face
// soup every production caller builds, came back:
//     ok = TRUE, reason = "ok", 6 faces -> 2, volume 10 mm^3 -> 3.333,
//     shell OPEN with 8 free edges, checkBRep INVALID (19/21).
// The caller was told the heal SUCCEEDED while holding a destroyed solid.
//
// ROOT CAUSE: the sliver pass's ASPECT rule was a PURE DIMENSIONLESS RATIO,
// longest/meanAltitude > aspectMax (1e4), compared against a hard-coded constant
// and never against a LENGTH. The plate's four side walls are 100 x 0.001 mm ->
// ratio 5.0e4 -> all four dropped as "slivers". Measured cliff: T < L/(2*aspectMax)
// = 0.005 mm, and SCALE-FREE (1 x 1 x 1e-5 died identically), because a ratio
// carries no length. The modelling tolerance played no part: tol = 1e-9 collapsed
// it just the same.
//
// A SECOND, INDEPENDENT COLLAPSE existed when a caller passed a tolerance at or
// above the wall thickness (e.g. precision = 1e-3 on this plate): the weld merges
// the top corners onto the bottom corners and the plate reduces to ONE face with
// volume EXACTLY 0 — and still reported ok = TRUE, reason = "ok".
//
// THE FIX, in two parts, both gated below:
//   (1) the aspect rule is now DIMENSIONAL: a face is an aspect sliver only when its
//       shape is degenerate AND its mean altitude is below the modelling tolerance,
//       i.e. it is thinner than the smallest distance the model resolves. The plate
//       now heals to a closed, checkBRep-VALID shell of volume 10 mm^3.
//   (2) THE SEAL: healBRep is a thin wrapper that re-derives `ok` from the MEASURED
//       result on every return path. A heal whose content was annihilated cannot
//       leave the module carrying ok == true; it returns ok == false with a reason
//       that NAMES the part's thickness and the tolerance that destroyed it.
//
// ─── T-138: THE 297-SECOND CLIFF ────────────────────────────────────────────
// The (7) self-intersection pass ran an exact triangle-triangle scan over every
// pair of faces — O(F^2) pairs x O(T_i * T_j) triangles — with no spatial index.
// Measured: 11.7 s / 50.8 s / 66.1 s / 217.1 s / 430.4 s on five corpus parts,
// 100% of the heal's wall clock in every case, and siRemoved = siPairs = 0 on all
// of them: minutes spent proving a negative.
//
// THE FIX changes WHICH PAIRS ARE TESTED, never the verdict: a face-box filter and
// then a triangle-level sweep-and-prune. Box disjointness is a sound rejection —
// an interpenetration is a point inside BOTH triangles, hence inside both boxes.
// The gates below hold the intersection SET fixed (exact counts on a battery that
// includes real interpenetrations) and put a ceiling on the pair scan's cost.
//
// RED-ON-PARENT (each of these FAILS at the parent commit, measured):
//   plate:*                 the plate is destroyed, volume 3.333 not 10
//   refuse:*                ok is TRUE with volume 0 and reason "ok"
//   unproducible:*          ok=TRUE with an annihilated shell is producible
//   allsliver:*             ok=TRUE over an EMPTY face set
//   perf:pair-scan ceiling  21.8 s at the parent vs a 5.0 s ceiling
// The T-138 identity gates (set:*) pass at BOTH commits by design — they are the
// regression evidence that the speedup did not change the answer.

#include "forge/native/ExactPredicates3D.hpp"
#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Heal.hpp"
#include "forge/native/brep/Sew.hpp"
#include "forge/native/brep/Topology.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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

static double now() {
    using namespace std::chrono;
    return duration<double>(steady_clock::now().time_since_epoch()).count();
}

static Face* faceFromRing(TopologyBuilder& tb, const std::vector<Point3>& ring) {
    Face* f = tb.makeFace();
    std::vector<Vertex*> vs;
    vs.reserve(ring.size());
    for (const Point3& p : ring) vs.push_back(tb.makeVertex(p));
    tb.addOuterLoopToFace(f, vs);
    return f;
}

// The 6 faces of an axis-aligned box [0,L]x[0,W]x[0,T] as INDEPENDENT fragments
// (private vertices, 24 free edges) — the raw soup ShapeFix.cpp and
// NativeShapeHealBridge.cpp hand healBRep via cloneFaceIndependent. Every outer
// loop is wound CCW seen from outside, so the divergence-theorem volume is +L*W*T.
static std::vector<Face*> buildPlate(TopologyBuilder& tb, double L, double W, double T) {
    const Point3 P[8] = {
        {0, 0, 0}, {L, 0, 0}, {L, W, 0}, {0, W, 0},
        {0, 0, T}, {L, 0, T}, {L, W, T}, {0, W, T},
    };
    std::vector<Face*> f;
    f.push_back(faceFromRing(tb, {P[0], P[3], P[2], P[1]}));  // bottom -Z
    f.push_back(faceFromRing(tb, {P[4], P[5], P[6], P[7]}));  // top    +Z
    f.push_back(faceFromRing(tb, {P[0], P[1], P[5], P[4]}));  // front  -Y
    f.push_back(faceFromRing(tb, {P[2], P[3], P[7], P[6]}));  // back   +Y
    f.push_back(faceFromRing(tb, {P[0], P[4], P[7], P[3]}));  // left   -X
    f.push_back(faceFromRing(tb, {P[1], P[2], P[6], P[5]}));  // right  +X
    return f;
}

// ---- the observable VECTOR -------------------------------------------------
// Volume alone cannot validate geometry — this repository has four measured cases
// where volume matched and the solid was wrong, and one where NO single observable
// caught it. Every geometric assertion below reads this whole vector.
struct Obs {
    std::size_t nFaces = 0, nEdges = 0, nVerts = 0;
    double vol = 0, area = 0;
    double cx = 0, cy = 0, cz = 0;
    double lo[3]{0, 0, 0}, hi[3]{0, 0, 0};
};

static std::vector<Point3> ringOf(const Loop* lp) {
    std::vector<Point3> r;
    if (!lp || !lp->first) return r;
    const Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) {
        if (c->originVertex()) r.push_back(c->originVertex()->point);
        c = c->next;
    }
    return r;
}

static Obs observe(const std::vector<Face*>& faces) {
    Obs o;
    o.nFaces = faces.size();
    o.vol  = shellSignedVolume(faces);
    o.area = shellSurfaceArea(faces);
    std::vector<const void*> es, vs;
    bool first = true;
    double vv = 0, cxx = 0, cyy = 0, czz = 0;
    for (const Face* f : faces) {
        if (!f) continue;
        std::vector<Point3> r = ringOf(f->outerLoop);
        for (const Point3& p : r) {
            const double c[3] = {p.x, p.y, p.z};
            if (first) { for (int a = 0; a < 3; ++a) o.lo[a] = o.hi[a] = c[a]; first = false; }
            for (int a = 0; a < 3; ++a) { o.lo[a] = std::fmin(o.lo[a], c[a]); o.hi[a] = std::fmax(o.hi[a], c[a]); }
        }
        for (std::size_t i = 1; i + 1 < r.size(); ++i) {
            const Point3 &a = r[0], &b = r[i], &c = r[i + 1];
            const double d = a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) +
                             a.z * (b.x * c.y - b.y * c.x);
            const double tv = d / 6.0;
            vv  += tv;
            cxx += tv * (a.x + b.x + c.x) / 4.0;
            cyy += tv * (a.y + b.y + c.y) / 4.0;
            czz += tv * (a.z + b.z + c.z) / 4.0;
        }
        auto walk = [&](const Loop* lp) {
            if (!lp || !lp->first) return;
            const Coedge* c = lp->first;
            for (std::size_t i = 0; i < lp->coedgeCount && c; ++i) {
                if (c->edge) es.push_back(c->edge);
                if (c->originVertex()) vs.push_back(c->originVertex());
                c = c->next;
            }
        };
        walk(f->outerLoop);
        for (const Loop* il : f->innerLoops) walk(il);
    }
    if (std::fabs(vv) > 1e-300) { o.cx = cxx / vv; o.cy = cyy / vv; o.cz = czz / vv; }
    std::sort(es.begin(), es.end()); es.erase(std::unique(es.begin(), es.end()), es.end());
    std::sort(vs.begin(), vs.end()); vs.erase(std::unique(vs.begin(), vs.end()), vs.end());
    o.nEdges = es.size();
    o.nVerts = vs.size();
    return o;
}

static bool near(double a, double b, double eps) { return std::fabs(a - b) <= eps; }

// ===========================================================================
// T-137 (a) — THE PLATE SURVIVES, measured on the whole observable vector.
// ===========================================================================
static void testThinPlateSurvives() {
    std::printf("\n-- T-137 (a): the 100 x 100 x 0.001 mm plate through healBRep --\n");
    TopologyBuilder tb;
    std::vector<Face*> in = buildPlate(tb, 100.0, 100.0, 0.001);

    HealOptions opt;                       // tol = 1e-6, the production default
    HealReport r = healBRep(tb, in, opt);
    const Obs o = observe(r.faces);

    std::printf("     ok=%s reason=\"%s\" slivers=%zu  F=%zu E=%zu V=%zu vol=%.12g area=%.12g\n",
                r.ok ? "TRUE" : "FALSE", r.reason ? r.reason : "(null)",
                r.sliverFacesRemoved, o.nFaces, o.nEdges, o.nVerts, o.vol, o.area);

    check(r.ok,                                  "plate: heal reports ok");
    check(std::strcmp(r.reason, "ok") == 0,      "plate: reason == \"ok\"");
    check(r.sliverFacesRemoved == 0,             "plate: NO face removed as a sliver (the 4 walls survive)");
    check(o.nFaces == 6,                         "plate: 6 faces out (was 2 — the walls were dropped)");
    check(o.nEdges == 12,                        "plate: 12 edges (box topology restored)");
    check(o.nVerts == 8,                         "plate: 8 vertices");
    check(r.after.closed,                        "plate: shell CLOSED");
    check(r.after.freeEdges == 0,                "plate: zero free edges");
    check(r.after.nonManifoldEdges == 0,         "plate: zero non-manifold edges");
    check(r.unfixedFreeEdgeIds.empty(),          "plate: no unfixed free edges");
    check(r.fullyHealed(),                       "plate: fullyHealed() == true");
    // volume: 100 * 100 * 0.001 = 10 mm^3 exactly.
    check(near(r.volumeAfter, 10.0, 1e-9),       "plate: volume == 10 mm^3 (was 3.3333 — DESTROYED)");
    check(near(o.vol, 10.0, 1e-9),               "plate: volume re-measured from the faces == 10");
    // area: 2*100*100 + 4*100*0.001 = 20000.4 mm^2.
    check(near(r.areaAfter, 20000.4, 1e-6),      "plate: area == 20000.4 mm^2");
    // centroid of a uniform plate.
    check(near(o.cx, 50.0, 1e-9),                "plate: centroid X == 50");
    check(near(o.cy, 50.0, 1e-9),                "plate: centroid Y == 50");
    check(near(o.cz, 0.0005, 1e-12),             "plate: centroid Z == 0.0005 (was 0.00075)");
    // all six bbox bounds.
    check(near(o.lo[0], 0.0, 1e-12) && near(o.hi[0], 100.0, 1e-12),   "plate: bbox X == [0,100]");
    check(near(o.lo[1], 0.0, 1e-12) && near(o.hi[1], 100.0, 1e-12),   "plate: bbox Y == [0,100]");
    check(near(o.lo[2], 0.0, 1e-12) && near(o.hi[2], 0.001, 1e-12),   "plate: bbox Z == [0,0.001]");
    // and the kernel's own oracle.
    CheckOptions co; co.tol = 1e-6; co.expectClosed = true;
    CheckReport cr = checkBRep(r.faces, co);
    std::printf("     checkBRep: valid=%s %zu/%zu\n", cr.valid ? "TRUE" : "FALSE", cr.passed(), cr.total());
    check(cr.valid,                              "plate: checkBRep VALID (was INVALID 19/21)");
    check(cr.passed() == cr.total(),             "plate: every checkBRep predicate passes");
    // ok must never contradict the validator — that contradiction was the defect.
    check(!(r.ok && !cr.valid),                  "plate: ok does not contradict checkBRep");
}

// ===========================================================================
// T-137 (b) — the aspect rule is DIMENSIONAL, not a bare ratio.
// ===========================================================================
static void testAspectRuleIsDimensional() {
    std::printf("\n-- T-137 (b): the aspect rule is scaled by the modelling tolerance --\n");
    // The old rule had a measured cliff at T < L/(2*aspectMax) = 0.005 mm for L=100
    // and was SCALE-FREE: the same ratio killed a 1 mm part and a 1 m part alike.
    // A part whose walls are far above tol must survive at every one of these scales.
    struct Case { double L, W, T; const char* tag; };
    const Case cases[] = {
        {100.0, 100.0, 0.001,  "100 x 100 x 0.001 mm"},
        {100.0,  10.0, 0.001,  "100 x 10 x 0.001 mm (the 6->4 shape)"},
        {  1.0,   1.0, 1e-5,   "1 x 1 x 1e-5 mm"},
        {1000.0, 1000.0, 0.01, "1000 x 1000 x 0.01 mm"},
        {100.0, 100.0, 0.00499,"100 x 100 x 0.00499 mm (just under the old cliff)"},
    };
    for (const Case& c : cases) {
        TopologyBuilder tb;
        std::vector<Face*> in = buildPlate(tb, c.L, c.W, c.T);
        HealOptions opt;                      // tol = 1e-6
        HealReport r = healBRep(tb, in, opt);
        const double expect = c.L * c.W * c.T;
        const bool good = r.ok && r.after.closed && r.faces.size() == 6 &&
                          r.sliverFacesRemoved == 0 &&
                          near(r.volumeAfter, expect, std::fabs(expect) * 1e-9 + 1e-15);
        std::printf("     %-42s ok=%d F=%zu closed=%d vol=%.12g (expect %.12g)\n",
                    c.tag, r.ok ? 1 : 0, r.faces.size(), r.after.closed ? 1 : 0, r.volumeAfter, expect);
        check(good, std::string("aspect: ") + c.tag + " heals intact");
    }

    // The rule must still REMOVE a face that is genuinely below the tolerance: a
    // sliver whose mean altitude (2*area/longest) is under tol is unrepresentable.
    //
    // The planted sliver is a TRIANGLE, deliberately. A thin QUAD never reaches the
    // aspect rule — its two short edges are below tol, so the short-edge collapse
    // drops the ring below a triangle and the "ring.size() < 3" arm removes it. A
    // gate built on a thin quad passes whatever the aspect rule does, which is how a
    // mutation that disabled the rule entirely survived the first version of this
    // file. This triangle's edges are 1 mm and two of ~0.5 mm — all far above tol —
    // and ONLY its mean altitude (2 * 2.5e-7 / 1 = 5e-7 mm < tol 1e-6) is sub-tol.
    // Nothing but the aspect rule can drop it.
    {
        TopologyBuilder tb;
        std::vector<Face*> in = buildPlate(tb, 10.0, 10.0, 10.0);   // a healthy cube
        in.push_back(faceFromRing(tb, {{2.0, 2.0, 10.0},
                                       {3.0, 2.0, 10.0},
                                       {2.5, 2.0 + 5e-7, 10.0}}));  // planted sliver
        HealOptions opt;
        HealReport r = healBRep(tb, in, opt);
        std::printf("     cube+sliver: ok=%d slivers=%zu F=%zu vol=%.12g closed=%d\n",
                    r.ok ? 1 : 0, r.sliverFacesRemoved, r.faces.size(), r.volumeAfter,
                    r.after.closed ? 1 : 0);
        check(r.sliverFacesRemoved == 1,   "aspect: a sub-tol sliver IS still removed");
        check(r.faces.size() == 6,         "aspect: the cube keeps its 6 faces");
        check(near(r.volumeAfter, 1000.0, 1e-9), "aspect: the cube's volume survives");
        check(r.after.closed,              "aspect: the cube re-closes after the sliver drop");
    }
}

// ===========================================================================
// T-137 (c) — THE REFUSAL. A destroyed result must say so, and say WHY.
// ===========================================================================
static void testRefusalNamesThicknessAndTolerance() {
    std::printf("\n-- T-137 (c): a tolerance at/above the wall thickness is REFUSED --\n");
    TopologyBuilder tb;
    std::vector<Face*> in = buildPlate(tb, 100.0, 100.0, 0.001);
    HealOptions opt;
    opt.tol = 1e-3;                        // exactly the wall thickness
    HealReport r = healBRep(tb, in, opt);
    const std::string reason = r.reason ? r.reason : "";
    std::printf("     ok=%s volAfter=%.12g\n     reason=\"%s\"\n",
                r.ok ? "TRUE" : "FALSE", r.volumeAfter, reason.c_str());

    check(!r.ok,                          "refuse: ok == FALSE (was TRUE over volume 0)");
    check(!reason.empty(),                "refuse: the reason is NOT empty");
    check(reason != "ok",                 "refuse: the reason is not the literal \"ok\"");
    // The reason must NAME the thickness that could not be resolved ...
    check(reason.find("0.001") != std::string::npos,
                                          "refuse: the reason names the 0.001 mm thickness");
    check(reason.find("thinnest") != std::string::npos,
                                          "refuse: the reason says it is the thinnest dimension");
    // ... and the TOLERANCE that made it impossible, with what to do about it.
    check(reason.find("tolerance") != std::string::npos,
                                          "refuse: the reason names the tolerance");
    check(reason.find("Re-run with tol <") != std::string::npos,
                                          "refuse: the reason states the actionable bound");
    // WHICH arm of the seal refused, not merely that one did. The volume arm (D3) and
    // the extent arm (D4) both cover this plate, so a gate that only checks "some
    // refusal happened" stays green when either arm is deleted.
    check(reason.find("enclosed volume") != std::string::npos,
                                          "refuse: the VOLUME arm of the seal is the one that fired");
    // And the destroyed result is still reported honestly, not hidden.
    check(near(r.volumeAfter, 0.0, 1e-18), "refuse: the destroyed volume is still reported");
}

// ===========================================================================
// T-137 (d) — "ok = TRUE with V = 0" must be UNPRODUCIBLE. Prove it by trying.
// ===========================================================================
static void testOkZeroIsUnproducible() {
    std::printf("\n-- T-137 (d): sweeping for an ok=TRUE over an annihilated shell --\n");
    const double plans[] = {1.0, 10.0, 100.0, 1000.0};
    const double thicks[] = {1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7};
    const double tols[]   = {1e-9, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1};

    int cases = 0, refused = 0, okZero = 0, okEmpty = 0, contradictions = 0;
    for (double L : plans) {
        for (double T : thicks) {
            for (double tolv : tols) {
                ++cases;
                TopologyBuilder tb;
                std::vector<Face*> in = buildPlate(tb, L, L, T);
                HealOptions opt; opt.tol = tolv;
                HealReport r = healBRep(tb, in, opt);
                if (!r.ok) {
                    ++refused;
                    const std::string why = r.reason ? r.reason : "";
                    if (why.empty() || why == "ok") ++contradictions;   // a refusal with no reason
                    continue;
                }
                if (r.faces.empty()) ++okEmpty;
                // ok == true while the shell's enclosed volume was annihilated.
                const double vb = std::fabs(r.volumeBefore);
                if (vb > 0.0 && std::fabs(r.volumeAfter) <= vb * 1e-12) ++okZero;
            }
        }
    }
    std::printf("     %d cases: %d refused, %d ok-with-empty-faces, %d ok-with-annihilated-volume,"
                " %d refusals without a reason\n", cases, refused, okEmpty, okZero, contradictions);
    check(cases == 224,          "unproducible: the sweep really ran 224 cases");
    check(refused > 0,           "unproducible: the sweep DOES reach destructive tolerances");
    check(okZero == 0,           "unproducible: NO ok=TRUE over an annihilated volume");
    check(okEmpty == 0,          "unproducible: NO ok=TRUE over an empty face set");
    check(contradictions == 0,   "unproducible: every refusal carries a reason");
}

// ===========================================================================
// T-137 (e) — the all-slivers early return is sealed too.
// ===========================================================================
static void testAllSliverPathIsSealed() {
    std::printf("\n-- T-137 (e): the 'all faces removed as slivers' path --\n");
    // Every face genuinely below the modelling tolerance: mean altitude 2e-9 << tol.
    // The core takes its early return with an EMPTY face set and ok = true; the seal
    // must turn that into an honest refusal.
    TopologyBuilder tb;
    std::vector<Face*> in;
    for (int k = 0; k < 3; ++k) {
        const double y = 5.0 * k;
        in.push_back(faceFromRing(tb, {{0.0, y, 0.0},
                                       {1.0, y, 0.0},
                                       {1.0, y + 1e-9, 0.0},
                                       {0.0, y + 1e-9, 0.0}}));
    }
    HealOptions opt;                       // tol = 1e-6
    HealReport r = healBRep(tb, in, opt);
    const std::string reason = r.reason ? r.reason : "";
    std::printf("     ok=%s faces=%zu slivers=%zu\n     reason=\"%s\"\n",
                r.ok ? "TRUE" : "FALSE", r.faces.size(), r.sliverFacesRemoved, reason.c_str());
    check(r.faces.empty(),        "allsliver: the core did remove every face");
    check(!r.ok,                  "allsliver: ok == FALSE (was TRUE with an empty face set)");
    check(!reason.empty(),        "allsliver: the refusal carries a reason");
    check(reason.find("tolerance") != std::string::npos,
                                  "allsliver: the reason names the tolerance");
    check(reason.find("every face was removed") != std::string::npos,
                                  "allsliver: the reason says what happened");
}

// ===========================================================================
// T-138 (a) — SET IDENTITY. The index must not change a single verdict.
// ===========================================================================
// These pass at BOTH commits by construction — that is the point. They pin the
// intersection SET so a future "speedup" cannot quietly move it. Each case is a
// layout that exercises a different arm of the two-level index:
//   disjoint : face boxes never overlap        -> rejected at the face level
//   nested   : face boxes overlap, no pierce   -> the sweep runs, the predicate says no
//   cross    : two full-size faces interpenetrate -> 1 UNFIXED structural pair
//   blade    : a small sliver pierces a big face  -> 1 face dropped
//   many     : three blades through one big face  -> 3 faces dropped
static void testSelfIntersectionSetIdentity() {
    std::printf("\n-- T-138 (a): the intersection SET the index must preserve --\n");

    auto bigQuad = [](TopologyBuilder& tb, double z) {
        return faceFromRing(tb, {{0, 0, z}, {100, 0, z}, {100, 100, z}, {0, 100, z}});
    };
    // A vertical blade of half-width w centred at (x,y), spanning z in [-h,+h].
    auto blade = [](TopologyBuilder& tb, double x, double y, double w, double h) {
        return faceFromRing(tb, {{x - w, y, -h}, {x + w, y, -h}, {x + w, y, h}, {x - w, y, h}});
    };

    // (1) DISJOINT face boxes — the face-level filter's fast path.
    {
        TopologyBuilder tb;
        std::vector<Face*> in;
        for (int k = 0; k < 40; ++k)
            in.push_back(faceFromRing(tb, {{10.0 * k, 0, 0}, {10.0 * k + 1, 0, 0},
                                           {10.0 * k + 1, 1, 0}, {10.0 * k, 1, 0}}));
        HealReport r = healBRep(tb, in, HealOptions{});
        check(r.selfIntersectingFacesRemoved == 0 && r.unfixedSelfIntersectionFacePairs.empty(),
              "set: 40 disjoint quads -> zero intersections");
        check(r.faces.size() == 40, "set: 40 disjoint quads -> all 40 survive");
    }
    // (2) OVERLAPPING boxes, NO interpenetration — two parallel sheets.
    {
        TopologyBuilder tb;
        std::vector<Face*> in{bigQuad(tb, 0.0), bigQuad(tb, 5.0)};
        HealReport r = healBRep(tb, in, HealOptions{});
        check(r.selfIntersectingFacesRemoved == 0 && r.unfixedSelfIntersectionFacePairs.empty(),
              "set: two stacked full-size sheets -> zero intersections");
        check(r.faces.size() == 2, "set: two stacked sheets -> both survive");
    }
    // (3) CROSS — two full-size faces that genuinely interpenetrate. Neither is
    //     small, so the honest answer is ONE UNFIXED structural pair, nothing dropped.
    {
        TopologyBuilder tb;
        std::vector<Face*> in{
            bigQuad(tb, 0.0),
            faceFromRing(tb, {{10, 30, -50}, {90, 30, -50}, {90, 30, 50}, {10, 30, 50}}),
        };
        HealReport r = healBRep(tb, in, HealOptions{});
        std::printf("     cross: siRemoved=%zu siPairs=%zu faces=%zu\n",
                    r.selfIntersectingFacesRemoved, r.unfixedSelfIntersectionFacePairs.size(),
                    r.faces.size());
        check(r.unfixedSelfIntersectionFacePairs.size() == 1,
              "set: two full-size crossing faces -> exactly 1 UNFIXED pair");
        check(r.selfIntersectingFacesRemoved == 0,
              "set: a structural self-intersection is NOT silently trimmed");
        check(r.faces.size() == 2, "set: both crossing faces are kept");
    }
    // (4) BLADE — a small offender is trimmed. maxArea = 10000, smallAreaCut = 10,
    //     the blade is 2 x 2 = 4 mm^2 -> removable.
    {
        TopologyBuilder tb;
        std::vector<Face*> in{bigQuad(tb, 0.0), blade(tb, 50.0, 30.0, 1.0, 1.0)};
        HealReport r = healBRep(tb, in, HealOptions{});
        std::printf("     blade: siRemoved=%zu siPairs=%zu faces=%zu\n",
                    r.selfIntersectingFacesRemoved, r.unfixedSelfIntersectionFacePairs.size(),
                    r.faces.size());
        check(r.selfIntersectingFacesRemoved == 1, "set: a small piercing blade IS trimmed");
        check(r.unfixedSelfIntersectionFacePairs.empty(), "set: blade leaves no unfixed pair");
        check(r.faces.size() == 1, "set: the big face survives the trim");
    }
    // (5) MANY — three blades through one big face, all small: exactly 3 dropped.
    {
        TopologyBuilder tb;
        std::vector<Face*> in{bigQuad(tb, 0.0),
                              blade(tb, 20.0, 10.0, 1.0, 1.0),
                              blade(tb, 50.0, 30.0, 1.0, 1.0),
                              blade(tb, 80.0, 60.0, 1.0, 1.0)};
        HealReport r = healBRep(tb, in, HealOptions{});
        std::printf("     many: siRemoved=%zu siPairs=%zu faces=%zu\n",
                    r.selfIntersectingFacesRemoved, r.unfixedSelfIntersectionFacePairs.size(),
                    r.faces.size());
        check(r.selfIntersectingFacesRemoved == 3, "set: three small blades -> exactly 3 trimmed");
        check(r.faces.size() == 1, "set: only the big face is left");
    }
    // (6) The index must not depend on WHICH axis is longest. The same crossing pair,
    //     rotated so the sweep axis changes, must give the identical verdict.
    {
        for (int axis = 0; axis < 3; ++axis) {
            TopologyBuilder tb;
            auto P = [axis](double a, double b, double c) -> Point3 {
                if (axis == 0) return {a, b, c};
                if (axis == 1) return {c, a, b};
                return {b, c, a};
            };
            std::vector<Face*> in{
                faceFromRing(tb, {P(0, 0, 0), P(100, 0, 0), P(100, 100, 0), P(0, 100, 0)}),
                faceFromRing(tb, {P(10, 30, -50), P(90, 30, -50), P(90, 30, 50), P(10, 30, 50)}),
            };
            HealReport r = healBRep(tb, in, HealOptions{});
            check(r.unfixedSelfIntersectionFacePairs.size() == 1 &&
                      r.selfIntersectingFacesRemoved == 0,
                  std::string("set: the crossing verdict is axis-independent (perm ") +
                      std::to_string(axis) + ")");
        }
    }
    // (7) The pass can still be turned OFF, and then finds nothing.
    {
        TopologyBuilder tb;
        std::vector<Face*> in{bigQuad(tb, 0.0), blade(tb, 50.0, 30.0, 1.0, 1.0)};
        HealOptions opt; opt.repairSelfIntersection = false;
        HealReport r = healBRep(tb, in, opt);
        check(r.selfIntersectingFacesRemoved == 0 && r.unfixedSelfIntersectionFacePairs.empty(),
              "set: repairSelfIntersection=false still disables the pass");
        check(r.faces.size() == 2, "set: with the pass off nothing is trimmed");
    }
}

// ===========================================================================
// T-138 (b) — THE COST CEILING. This is the gate that was 21.8 s at the parent.
// ===========================================================================
static void testPairScanCostCeiling() {
    std::printf("\n-- T-138 (b): the pair scan's cost, measured --\n");
    // K independent quads on a lattice, none sharing a corner, so EVERY pair used to
    // reach the exact tri-tri predicate. Parent-commit wall clock, measured on this
    // machine: K=800 -> 9.70 s, K=1200 -> 21.79 s, textbook O(K^2) at ~30 us a pair.
    // With the index the face boxes are disjoint and the whole pass collapses.
    auto buildLattice = [](TopologyBuilder& tb, std::size_t K, bool withCross) {
        std::vector<Face*> f;
        const std::size_t side = static_cast<std::size_t>(std::ceil(std::sqrt((double)K)));
        for (std::size_t i = 0; i < K; ++i) {
            const double ox = 10.0 * (double)(i % side);
            const double oy = 10.0 * (double)(i / side);
            f.push_back(faceFromRing(tb, {{ox, oy, 0}, {ox + 1, oy, 0},
                                          {ox + 1, oy + 1, 0}, {ox, oy + 1, 0}}));
        }
        if (withCross)  // ONE genuine interpenetration, sharing no corner with anything
            f.push_back(faceFromRing(tb, {{0.25, 0.5, -1}, {0.75, 0.5, -1},
                                          {0.75, 0.5, 1}, {0.25, 0.5, 1}}));
        return f;
    };

    const double kCeiling = 5.0;   // seconds. Parent: 21.79 s. Fixed: ~0.01 s.
    double tOn = 0.0, tOff = 0.0;
    std::size_t sOn = 0, sOff = 0;
    {
        TopologyBuilder tb;
        std::vector<Face*> in = buildLattice(tb, 1200, false);
        HealOptions opt; opt.repairSelfIntersection = false;
        const double t0 = now();
        HealReport r = healBRep(tb, in, opt);
        tOff = now() - t0; sOff = r.faces.size();
    }
    {
        TopologyBuilder tb;
        std::vector<Face*> in = buildLattice(tb, 1200, false);
        HealOptions opt;                       // pass ON
        const double t0 = now();
        HealReport r = healBRep(tb, in, opt);
        tOn = now() - t0; sOn = r.faces.size();
    }
    std::printf("     K=1200 quads: pass OFF %.4f s, pass ON %.4f s (ceiling %.1f s)\n",
                tOff, tOn, kCeiling);
    check(sOn == 1200 && sOff == 1200, "perf: the lattice heals to 1200 faces either way");
    check(tOn < kCeiling,
          "perf: the 1200-face pair scan is under the 5 s ceiling (parent: 21.79 s)");

    // The speedup must not have bought its time by stopping looking: the SAME scale
    // with one real interpenetration planted must still find exactly that one. The
    // blade (0.5 x 2 = 1 mm^2) is NOT small against the lattice quads (1 mm^2, so
    // smallAreaCut = 1e-3 mm^2), so the honest verdict is one UNFIXED structural
    // pair, not a silent trim — which is also what the parent commit reports.
    {
        TopologyBuilder tb;
        std::vector<Face*> in = buildLattice(tb, 1200, true);
        const double t0 = now();
        HealReport r = healBRep(tb, in, HealOptions{});
        const double dt = now() - t0;
        std::printf("     K=1200 + one planted crossing: %.4f s  siRemoved=%zu siPairs=%zu\n",
                    dt, r.selfIntersectingFacesRemoved, r.unfixedSelfIntersectionFacePairs.size());
        check(r.unfixedSelfIntersectionFacePairs.size() == 1,
              "perf: the planted interpenetration is STILL found at K=1200");
        check(r.selfIntersectingFacesRemoved == 0,
              "perf: and it is reported, not silently trimmed");
        check(dt < kCeiling, "perf: finding it also stays under the ceiling");
    }
}

// ===========================================================================
// T-138 (c) — FILTER SOUNDNESS, fuzzed against an INDEPENDENT exact oracle.
// ===========================================================================
// The index has three levels, and the third one REASONS: it proves "the exact
// classifier will say false" from adaptive-exact orient3d signs. A reasoning filter
// is exactly the kind of thing that is right on the cases you thought of and wrong on
// the ones you did not, and a wrong rejection is INVISIBLE — it looks like a clean
// part. So it is fuzzed, not argued.
//
// The oracle is built here, in the test, directly on the public exact predicate layer
// (segmentTriangleClassify through ExactReal). It shares no code with the filter
// chain: it is the same six-edge-pierce definition trisInterpenetrate uses,
// re-derived, with NO box test, NO sweep and NO sign proof in front of it. Every
// generated pair goes through healBRep — the whole chain — and through the oracle,
// and the two verdicts must agree. The failure that matters is one-sided: the filter
// saying NO where the oracle says YES is a silently lost self-intersection.
//
// The generator is built to hit the cases a reasoning filter gets wrong: a COARSE
// INTEGER LATTICE, so exact coplanarity, exact vertex-on-edge T-junctions and edge-on
// contact are common rather than measure-zero, plus a scattering of off-lattice pairs.
static bool oracleInterpenetrate(const Point3* A, const Point3* B) {
    using forge::native::ExactPoint3;
    using forge::native::ExactReal;
    auto EP = [](const Point3& p) {
        return ExactPoint3(ExactReal(p.x), ExactReal(p.y), ExactReal(p.z));
    };
    const ExactPoint3 a0 = EP(A[0]), a1 = EP(A[1]), a2 = EP(A[2]);
    const ExactPoint3 b0 = EP(B[0]), b1 = EP(B[1]), b2 = EP(B[2]);
    auto pierce = [](const ExactPoint3& p0, const ExactPoint3& p1,
                     const ExactPoint3& q0, const ExactPoint3& q1, const ExactPoint3& q2) {
        return forge::native::segmentTriangleClassify(p0, p1, q0, q1, q2).crosses;
    };
    return pierce(a0, a1, b0, b1, b2) || pierce(a1, a2, b0, b1, b2) ||
           pierce(a2, a0, b0, b1, b2) || pierce(b0, b1, a0, a1, a2) ||
           pierce(b1, b2, a0, a1, a2) || pierce(b2, b0, a0, a1, a2);
}

static void testFilterSoundnessFuzz() {
    std::printf("\n-- T-138 (c): fuzzing the index against an independent exact oracle --\n");
    std::uint64_t st = 0x9E3779B97F4A7C15ull;
    auto rnd = [&]() { st ^= st << 13; st ^= st >> 7; st ^= st << 17; return st; };

    // The oracle is the SLOW arm on purpose (the full exact classifier, ~8 ms a pair),
    // so the in-gate sample is bounded to keep this test well inside run_native.sh's
    // 300 s per-test timeout even when eight gates share the machine. Raise it for a
    // deeper sweep with FORGE_HEAL_FUZZ=<n> (200,000 was run out of band: 0 false
    // negatives, 0 false positives).
    int kTarget = 4000;
    if (const char* env = std::getenv("FORGE_HEAL_FUZZ")) {
        const long v = std::strtol(env, nullptr, 10);
        if (v > 0) kTarget = static_cast<int>(v);
    }
    int generated = 0, tested = 0, hits = 0, falseNegatives = 0, falsePositives = 0;

    auto triArea = [](const Point3* T) {
        const double ux = T[1].x - T[0].x, uy = T[1].y - T[0].y, uz = T[1].z - T[0].z;
        const double vx = T[2].x - T[0].x, vy = T[2].y - T[0].y, vz = T[2].z - T[0].z;
        const double cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        return 0.5 * std::sqrt(cx * cx + cy * cy + cz * cz);
    };

    while (tested < kTarget && generated < kTarget * 40) {
        ++generated;
        Point3 A[3], B[3];
        // ~80% lattice (exact coincidence, coplanarity, T-junctions), ~20% off-lattice.
        const bool lattice = ((rnd() % 5) != 0);
        auto coord = [&]() -> double {
            if (lattice) return (double)(long long)(rnd() % 7) * 0.5;   // 0 .. 3.0, step 0.5
            return (double)(rnd() % 6001) * 0.0005;                     // 0 .. 3.0, fine
        };
        for (int k = 0; k < 3; ++k) A[k] = {coord(), coord(), coord()};
        for (int k = 0; k < 3; ++k) B[k] = {coord(), coord(), coord()};

        // healBRep drops a zero-area face as a sliver before the pass, and skips a pair
        // that shares a welded corner — neither reaches the filter, so neither can be
        // compared. Exclude them from the sample rather than mis-attribute them.
        const double aA = triArea(A), aB = triArea(B);
        if (!(aA > 1e-9) || !(aB > 1e-9)) continue;
        // Keep both faces above the small/removable gauge (maxArea * 1e-3) so a hit is
        // always reported as an UNFIXED pair and never as a silent trim.
        if (std::fmin(aA, aB) <= std::fmax(aA, aB) * 1e-3) continue;
        bool shares = false;
        for (int i = 0; i < 3 && !shares; ++i)
            for (int j = 0; j < 3 && !shares; ++j)
                if (A[i].x == B[j].x && A[i].y == B[j].y && A[i].z == B[j].z) shares = true;
        if (shares) continue;

        const bool expect = oracleInterpenetrate(A, B);

        TopologyBuilder tb;
        std::vector<Face*> in{faceFromRing(tb, {A[0], A[1], A[2]}),
                              faceFromRing(tb, {B[0], B[1], B[2]})};
        HealReport r = healBRep(tb, in, HealOptions{});
        const bool got = !r.unfixedSelfIntersectionFacePairs.empty() ||
                         r.selfIntersectingFacesRemoved > 0;
        ++tested;
        if (expect) ++hits;
        if (expect && !got) ++falseNegatives;     // THE dangerous direction
        if (!expect && got) ++falsePositives;
    }
    std::printf("     %d pairs tested (%d generated): oracle says intersecting on %d;"
                " filter false-NEGATIVES=%d false-positives=%d\n",
                tested, generated, hits, falseNegatives, falsePositives);
    check(tested >= kTarget,   "filter: the fuzz really ran its full sample");
    check(hits > 100,          "filter: the sample DOES contain real intersections");
    check(falseNegatives == 0, "filter: the index NEVER hides a real intersection");
    check(falsePositives == 0, "filter: the index never invents one either");
}

int main() {
    std::printf("=== forge::native::brep — T-137/T-138 HEAL TRUTH gate ===\n");
    testThinPlateSurvives();
    testAspectRuleIsDimensional();
    testRefusalNamesThicknessAndTolerance();
    testOkZeroIsUnproducible();
    testAllSliverPathIsSealed();
    testSelfIntersectionSetIdentity();
    testPairScanCostCeiling();
    testFilterSoundnessFuzz();
    std::printf("\n=== RESULT: %d / %d checks passed ===\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
