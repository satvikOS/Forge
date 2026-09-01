// sketch_solve_test.cpp — the gate for the 2D sketch + constraint family.
//
// A gate that proves the family SOLVES is worth less than a gate that proves it
// DOES NOT REFUSE. The owner's binding constraint on this whole program is:
//
//     "dont gate anything if you do that then how will Archie generate ultra
//      long feature trees for Kernel to execute"
//
// A SOLVE that throws on one contradictory dimension is a capability gate
// wearing a safety hat, and it fires hardest on the longest trees: one bad
// statement would cost the other 199. So the cases below are weighted toward
// the failure paths, and the central assertion is that a CONTRADICTORY sketch
// still yields usable geometry and NAMES what it demoted.
//
// WHAT THIS GATE DOES NOT COVER, stated so nobody reads it as more than it is:
// it never calls EXTRUDE, so it does not prove a SOLID comes out. It proves the
// step before that — that a solved sketch is a well-formed PROFILE — through
// forge::extractProfileRings, which is the OCCT-free ring bridge the native
// feature ops (forge::native::brep::prism / csg::revolve) actually consume.
// Linking EXTRUDE would drag in the whole OCCT-backed kernel; that belongs in
// the macOS kernel job, not here.

#include "forge/Sketcher.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/GraphAudit.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// ── the ONE link seam, declared in the open ─────────────────────────────────
// forge::ft::compile() resets the per-tree boolean hang-guard budget on entry.
// That lives in Booleans.cpp, which drags in the whole OCCT boolean stack for a
// function whose entire body is "set a counter to zero". This gate performs no
// boolean, so the budget is never consumed and resetting it is genuinely a
// no-op here.
//
// This is a LINK seam, not a weakened assertion: it replaces no check and
// changes no behaviour the gate observes. It is also self-policing — if this
// harness is ever linked against the real Booleans.o the duplicate symbol is a
// hard link error, so the seam cannot silently shadow the real implementation.
namespace forge {
void resetBooleanBudget();
void resetBooleanBudget() {}
}  // namespace forge

namespace {

int g_checks = 0;
int g_fails = 0;

void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) {
        ++g_fails;
        std::printf("  FAIL: %s\n", what.c_str());
    }
}

bool verifyMentions(const forge::ft::CompileResult& r, const std::string& needle) {
    for (const std::string& line : r.verify)
        if (line.find(needle) != std::string::npos) return true;
    return false;
}

void dumpVerify(const forge::ft::CompileResult& r) {
    for (const std::string& line : r.verify) std::printf("    verify| %s\n", line.c_str());
    if (!r.error.empty()) std::printf("    error | %s\n", r.error.c_str());
}

// forge::ft::parse throws ParseError rather than returning a message, so wrap
// it: a THROW here is a gate failure, not an exception the caller handles.
forge::ft::FeatureTree parseOrFail(const char* src, const std::string& what) {
    try {
        return forge::ft::parse(src);
    } catch (const std::exception& e) {
        ++g_checks; ++g_fails;
        std::printf("  FAIL: %s did not parse — %s\n", what.c_str(), e.what());
        return forge::ft::FeatureTree{};
    }
}

// The next SketchHandle compile() will hand out. The registry counter is
// monotonic, so allocating one and releasing it reveals the next value. Every
// use below asserts the sketch actually exists before touching it, so if this
// assumption ever stops holding the gate FAILS rather than silently measuring
// the wrong sketch.
forge::SketchHandle nextSketchHandle() {
    const forge::SketchHandle probe = forge::createSketch();
    forge::destroySketch(probe);
    return probe + 1;
}

// Compile a source and hand back BOTH the result and the sketch it built, so a
// case can measure the geometry the solver actually produced rather than only
// the verify text. Every caller checks `ok` before reading the sketch.
struct Built {
    forge::ft::CompileResult r;
    forge::SketchHandle      sk = 0;
    bool                     ok = false;
};

Built buildSketch(const char* src, const std::string& what) {
    Built b;
    b.sk = nextSketchHandle();
    const forge::ft::FeatureTree ft = parseOrFail(src, what);
    b.r = forge::ft::compile(ft);
    b.ok = forge::SketchRegistry::instance().exists(b.sk);
    if (!b.ok) {
        ++g_checks; ++g_fails;
        std::printf("  FAIL: %s did not leave an addressable sketch\n", what.c_str());
    }
    return b;
}

bool near(double a, double b, double eps) { return std::fabs(a - b) < eps; }

// The radius of a sampled ring, measured from its own centroid. The facade has
// no "read a circle's radius" entry, and inventing one for a test would be
// testing an accessor rather than the constraint; extractProfileRings is the
// bridge the native feature ops consume, so measuring THERE measures what a
// downstream op would actually receive.
bool ringRadius(forge::SketchHandle h, double& out) {
    const std::vector<std::vector<forge::native::geom::Point2>> rings =
        forge::extractProfileRings(h, 96);
    if (rings.empty() || rings[0].size() < 8) return false;
    double cx = 0, cy = 0;
    for (const auto& q : rings[0]) { cx += q.x; cy += q.y; }
    cx /= static_cast<double>(rings[0].size());
    cy /= static_cast<double>(rings[0].size());
    double sum = 0;
    for (const auto& q : rings[0]) sum += std::hypot(q.x - cx, q.y - cy);
    out = sum / static_cast<double>(rings[0].size());
    return true;
}

// The unit direction of the segment p(a) -> p(b), for the angle cases.
void dirOf(forge::SketchHandle h, std::uint32_t a, std::uint32_t b, double& ux, double& uy) {
    const forge::SketchPoint p0 = forge::readPoint(h, a);
    const forge::SketchPoint p1 = forge::readPoint(h, b);
    const double dx = p1.x - p0.x, dy = p1.y - p0.y;
    const double n = std::hypot(dx, dy);
    ux = (n > 1e-12) ? dx / n : 0.0;
    uy = (n > 1e-12) ? dy / n : 0.0;
}

}  // namespace

int main() {
    // Unbuffered: this gate links kernel geometry symbols as UNRESOLVED on
    // purpose, so a case that reaches one dies by jumping to address 0. With a
    // buffered stdout that crash prints NOTHING and looks like a failure in the
    // first case rather than the last one that ran. Silence must not be able to
    // misreport where the gate got to.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    using namespace forge::ft;

    // ── 1. the grammar parses, and every op resolves to a REAL opcode ────────
    // OpCode::Unknown is the closed-vocabulary sentinel: if any of the seven
    // names were missing from opFromName they would land there, and a tree that
    // "parsed" would build nothing.
    {
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 60, 1)\n"
            "%4 = SLINE(%2, %3)\n"
            "%5 = SCIRC(%2, 12.5)\n"
            "%6 = CON(%4, HORIZ)\n"
            "%7 = CON(%2, DIST, %3, 60)\n"
            "%8 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "the sketch grammar");
        check(ft.ops.size() == 8, "8 statements parsed, got " + std::to_string(ft.ops.size()));
        const OpCode want[] = {OpCode::Sketch, OpCode::SPt,  OpCode::SPt, OpCode::SLine,
                               OpCode::SCirc,  OpCode::Con,  OpCode::Con, OpCode::Solve};
        for (std::size_t i = 0; i < ft.ops.size() && i < 8; ++i)
            check(ft.ops[i].code == want[i],
                  "op " + std::to_string(i) + " resolved to the right opcode");
        for (const Op& op : ft.ops)
            check(op.code != OpCode::Unknown, op.name + " is not the Unknown sentinel");
    }

    // ── 2. ★ THE CENTRAL CASE: a CONTRADICTORY sketch must not be refused ───
    // Two points are made COINCIDENT and 40 mm apart. That cannot hold. The
    // tree must still compile every statement, and the demotion must be NAMED
    // so a repair loop can act on it.
    {
        const forge::SketchHandle sk = nextSketchHandle();
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 5, 5)\n"
            "%4 = CON(%2, COINC, %3)\n"
            "%5 = CON(%2, DIST, %3, 40)\n"
            "%6 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "a contradictory sketch");
        const CompileResult r = compile(ft);
        std::printf("  [contradictory] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 6, "all 6 statements compiled despite the contradiction");
        // The ONLY error a sketch-only tree may carry is the compiler's
        // pre-existing "a tree must end in a solid" rule. Anything else here
        // would mean a sketch op refused, which is the whole point of the gate.
        check(r.error.empty() || r.error.find("no SOLID produced") != std::string::npos,
              "no sketch op refused; the only error is the benign no-SOLID one: " + r.error);
        check(verifyMentions(r, "DEMOTED"), "the demoted constraint is NAMED on the verify channel");
        // The solver must have left usable geometry behind.
        check(forge::SketchRegistry::instance().exists(sk), "the tree's sketch is addressable");
        if (forge::SketchRegistry::instance().exists(sk)) {
            const forge::SketchPoint a = forge::readPoint(sk, 0);
            const forge::SketchPoint b = forge::readPoint(sk, 1);
            check(std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(b.x) && std::isfinite(b.y),
                  "geometry survived the contradiction (no NaN)");
        }
    }

    // ── 2b. ★ THE RANK-BLIND CASE — the one a conflict-only repair MISSES ───
    // A triangle with sides 10, 10 and 100 violates the triangle inequality, so
    // it cannot be built. But it is STRUCTURALLY fine: 3 points is 6 parameters,
    // 3 distances is rank 3, nothing is over-determined. planegcs's diagnosis is
    // a JACOBIAN-RANK analysis, so it reports class="under", conflicting=[] and
    // sees no problem at all. Only solve()'s status and the RESIDUAL vector
    // (which puts -95 on the 100 mm constraint) name the offender.
    //
    // This case exists because the obvious repair — "if conflicting is
    // non-empty, drop one" — demotes NOTHING here and hands back a silently
    // broken sketch. It is the positive control for solveOrRepair's second pass.
    {
        const forge::SketchHandle sk = nextSketchHandle();
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 5, 0)\n"
            "%4 = SPT(%1, 0, 5)\n"
            "%5 = CON(%2, DIST, %3, 10)\n"
            "%6 = CON(%3, DIST, %4, 10)\n"
            "%7 = CON(%2, DIST, %4, 100)\n"
            "%8 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "an infeasible triangle");
        const CompileResult r = compile(ft);
        std::printf("  [rank-blind infeasible] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 8, "all 8 statements compiled");
        check(r.error.empty() || r.error.find("no SOLID produced") != std::string::npos,
              "no sketch op refused: " + r.error);
        // THE assertion: the repair must fire even though NO tag is conflicting.
        check(verifyMentions(r, "DEMOTED"),
              "a rank-BLIND infeasibility was still repaired (what the residual pass buys)");
        check(verifyMentions(r, "RESIDUAL"),
              "and it was repaired by RESIDUAL, since rank analysis reported no conflict");
        check(forge::SketchRegistry::instance().exists(sk), "the triangle's sketch is addressable");
        if (forge::SketchRegistry::instance().exists(sk)) {
            const forge::SketchPoint a = forge::readPoint(sk, 0);
            const forge::SketchPoint b = forge::readPoint(sk, 1);
            const double d = std::hypot(b.x - a.x, b.y - a.y);
            std::printf("    after repair |p1-p0| = %.10f (the 10mm side survived)\n", d);
            check(std::isfinite(d), "geometry is finite after the repair");
            check(std::fabs(d - 10.0) < 1e-6,
                  "the FIRST-declared constraint survived — demotion is last-declared-loses");
        }
    }

    // ── 3. ★ THE PAYOFF: relations replace arithmetic, and the ring proves it ─
    // The four corners are entered SLOPPY — (0,0) (57,3) (61,44) (-2,38). No
    // coordinate is correct. Four HORIZ/VERT constraints plus two dimensions
    // say what the shape IS, and the solver computes where the corners GO.
    // Then the solved sketch is read back as a PROFILE ring.
    //
    // This is the measured answer to "derived placement is the unlearnable
    // sub-task": the model states DIST 60, not the coordinate 60.
    {
        const forge::SketchHandle sk = nextSketchHandle();
        const char* src =
            "%1  = SKETCH(XY)\n"
            "%2  = SPT(%1, 0, 0)\n"
            "%3  = SPT(%1, 57, 3)\n"
            "%4  = SPT(%1, 61, 44)\n"
            "%5  = SPT(%1, -2, 38)\n"
            "%6  = SLINE(%2, %3)\n"
            "%7  = SLINE(%3, %4)\n"
            "%8  = SLINE(%4, %5)\n"
            "%9  = SLINE(%5, %2)\n"
            "%10 = CON(%6, HORIZ)\n"
            "%11 = CON(%7, VERT)\n"
            "%12 = CON(%8, HORIZ)\n"
            "%13 = CON(%9, VERT)\n"
            "%14 = CON(%2, DIST, %3, 60)\n"
            "%15 = CON(%2, DIST, %5, 40)\n"
            "%16 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "a constrained rectangle");
        const CompileResult r = compile(ft);
        std::printf("  [constrained rect] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 16, "all 16 statements compiled");
        check(r.error.empty() || r.error.find("no SOLID produced") != std::string::npos,
              "no sketch op refused: " + r.error);
        check(!verifyMentions(r, "DEMOTED"), "a CONSISTENT sketch demotes nothing");

        check(forge::SketchRegistry::instance().exists(sk), "the rectangle's sketch is addressable");
        if (forge::SketchRegistry::instance().exists(sk)) {
            // The exit to PROFILE: the ring form the native feature ops consume.
            const std::vector<std::vector<forge::native::geom::Point2>> rings =
                forge::extractProfileRings(sk);
            check(!rings.empty(), "the solved sketch yields a PROFILE ring");
            if (!rings.empty()) {
                double lo[2] = {1e300, 1e300}, hi[2] = {-1e300, -1e300};
                for (const auto& p : rings[0]) {
                    lo[0] = std::fmin(lo[0], p.x); hi[0] = std::fmax(hi[0], p.x);
                    lo[1] = std::fmin(lo[1], p.y); hi[1] = std::fmax(hi[1], p.y);
                }
                const double w = hi[0] - lo[0], h = hi[1] - lo[1];
                std::printf("    ring: %zu pts  bbox %.6f x %.6f  (want 60 x 40)\n",
                            rings[0].size(), w, h);
                check(rings[0].size() >= 4, "the ring closed over all four corners");
                // A VECTOR of observables, not one number: width AND height AND
                // squareness. A bbox alone cannot tell a solved rectangle from a
                // parallelogram that happens to span the same box.
                check(std::fabs(w - 60.0) < 1e-6, "solver produced the CONSTRAINED width 60");
                check(std::fabs(h - 40.0) < 1e-6, "solver produced the CONSTRAINED height 40");
                double worstOffAxis = 0.0;
                for (std::size_t i = 0; i < rings[0].size(); ++i) {
                    const auto& p = rings[0][i];
                    const auto& q = rings[0][(i + 1) % rings[0].size()];
                    worstOffAxis = std::fmax(worstOffAxis,
                                             std::fmin(std::fabs(p.x - q.x), std::fabs(p.y - q.y)));
                }
                std::printf("    worst off-axis edge deviation = %.3e\n", worstOffAxis);
                check(worstOffAxis < 1e-6, "every edge is truly axis-aligned (not a parallelogram)");
            }
        }
    }

    // ── 4. an UNKNOWN constraint keyword is skipped and named, never fatal ───
    // One statement's worth of information must not cost the whole tree.
    {
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 10, 0)\n"
            "%4 = CON(%2, NOTACONSTRAINT, %3)\n"
            "%5 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "a tree with an unknown CON keyword");
        const CompileResult r = compile(ft);
        std::printf("  [unknown CON kind] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 5, "the other 4 statements survived one bad keyword");
        check(r.error.empty() || r.error.find("no SOLID produced") != std::string::npos,
              "one bad keyword did not refuse the tree: " + r.error);
        check(verifyMentions(r, "SKIPPED"), "the skipped constraint is NAMED, not silently dropped");
    }

    // ── 4b. a KNOWN keyword on the WRONG OPERANDS is also skipped ───────────
    // TANG is a real constraint kind, but the facade wants {line, circle} and
    // THROWS when handed two points. Case 4 covers an unknown keyword; this
    // covers a known one misapplied, which is the likelier model error of the
    // two. Both must behave identically — otherwise the contract has a hole
    // exactly where a model is most likely to fall in, and a 200-statement tree
    // dies on one mistyped operand.
    {
        const forge::SketchHandle sk4 = nextSketchHandle();
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SPT(%1, 0, 0)\n"
            "%3 = SPT(%1, 10, 0)\n"
            "%4 = CON(%2, TANG, %3)\n"
            "%5 = CON(%2, DIST, %3, 25)\n"
            "%6 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "TANG between two points");
        const CompileResult r = compile(ft);
        std::printf("  [known kind, wrong operands] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 6, "a misapplied constraint did not cost the tree");
        check(r.error.empty() || r.error.find("no SOLID produced") != std::string::npos,
              "no sketch op refused: " + r.error);
        check(verifyMentions(r, "SKIPPED"), "the rejected constraint is NAMED");
        // and the GOOD constraint after it must still have been applied
        check(forge::SketchRegistry::instance().exists(sk4), "the sketch is addressable");
        if (forge::SketchRegistry::instance().exists(sk4)) {
            const forge::SketchPoint a = forge::readPoint(sk4, 0);
            const forge::SketchPoint b = forge::readPoint(sk4, 1);
            const double d = std::hypot(b.x - a.x, b.y - a.y);
            std::printf("    |p1-p0| = %.10f (the DIST 25 after it still applied)\n", d);
            check(std::fabs(d - 25.0) < 1e-6,
                  "the statement AFTER the bad one still took effect");
        }
    }

    // ── 4c. a CROSS-SKETCH trailing operand on CON is skipped, not fatal ────
    // The last hole of the shape 4 and 4b close. Those two arms tolerate a bad
    // constraint once its operands have RESOLVED; until this case the operand
    // resolution feeding them still threw, so `CON(%a, COINC, %b)` naming an
    // entity of another sketch killed the whole tree — through the OpError arm
    // of the compile loop, which returns on the first failure and discards
    // every statement after it.
    //
    // CON is the one op in the family where skipping has a DEFINED answer: it
    // is pass-through, so the answer is the sketch as it already stood. Case 5
    // holds the other side of that line — SLINE across two sketches must still
    // refuse, because it has to PRODUCE an entity and has no such answer. The
    // two cases together are what make the line a decision rather than an
    // accident.
    {
        const forge::SketchHandle sk5 = nextSketchHandle();
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SKETCH(XY)\n"
            "%3 = SPT(%1, 0, 0)\n"
            "%4 = SPT(%1, 10, 0)\n"
            "%5 = SPT(%2, 99, 99)\n"
            "%6 = CON(%3, DIST, %5, 40)\n"   // operand from the OTHER sketch
            "%7 = CON(%3, DIST, %4, 25)\n"   // and a good one after it
            "%8 = SOLVE(%1)\n";
        const FeatureTree ft = parseOrFail(src, "CON across two sketches");
        const CompileResult r = compile(ft);
        std::printf("  [CON across two sketches] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 8, "a cross-sketch operand did not cost the tree");
        check(verifyMentions(r, "different SKETCHes"), "the skipped constraint is NAMED");
        check(forge::SketchRegistry::instance().exists(sk5), "the sketch is addressable");
        if (forge::SketchRegistry::instance().exists(sk5)) {
            const forge::SketchPoint a = forge::readPoint(sk5, 0);
            const forge::SketchPoint b = forge::readPoint(sk5, 1);
            const double d = std::hypot(b.x - a.x, b.y - a.y);
            std::printf("    |p1-p0| = %.10f (the DIST 25 after it still applied)\n", d);
            check(std::fabs(d - 25.0) < 1e-6,
                  "the statement AFTER the cross-sketch one still took effect");
        }
    }

    // ── 5. ★ NEGATIVE CONTROLS — TYPE errors must STILL refuse ──────────────
    // Cases 2 and 4 prove the compiler is TOLERANT. On their own they would be
    // equally consistent with a compiler that is merely PERMISSIVE, which is a
    // different and much worse thing. These two prove the line is drawn in the
    // right place: a geometry OUTCOME is tolerated, a TYPE error is refused.
    //
    // Both are deliberately OCCT-free (they use only sketch ops), so the gate's
    // negative half runs everywhere its positive half does. An earlier draft
    // used SOLVE on a BOX and CRASHED here on the unresolved makeBox — a
    // negative control that cannot run is not a control.
    {
        // an entity from sketch A used in a line of sketch B
        const char* src =
            "%1 = SKETCH(XY)\n"
            "%2 = SKETCH(XY)\n"
            "%3 = SPT(%1, 0, 0)\n"
            "%4 = SPT(%2, 10, 0)\n"
            "%5 = SLINE(%3, %4)\n";
        const FeatureTree ft = parseOrFail(src, "a line across two sketches");
        const CompileResult r = compile(ft);
        std::printf("  [SLINE across two sketches] error=\"%s\"\n", r.error.c_str());
        check(!r.error.empty(), "an entity from another sketch is REFUSED");
        check(r.error.find("same SKETCH") != std::string::npos, "the refusal says why");
    }
    {
        // SOLVE on a value that is not a sketch at all. RECT is used rather
        // than BOX because RECT is built entirely by the sketcher and needs no
        // OCCT symbol, so this control actually executes.
        const char* src =
            "%1 = RECT(40, 30)\n"
            "%2 = SPT(%1, 0, 0)\n";
        const FeatureTree ft = parseOrFail(src, "a sketch point on a baked PROFILE");
        const CompileResult r = compile(ft);
        std::printf("  [SPT on a PROFILE] error=\"%s\"\n", r.error.c_str());
        check(!r.error.empty(), "a sketch op on a non-SKETCH value is REFUSED");
        check(r.error.find("not a SKETCH") != std::string::npos, "the refusal names the kind mismatch");
    }

    // ── 6. ★ THE s0.4 GRAPH AUDIT MUST SEE SIDE-EFFECT DATAFLOW ─────────────
    // Every other op in the IR delivers its value THROUGH its id. The sketch
    // family does not: SPT/SLINE/SCIRC/SARC/CON mutate the SketchHandle their
    // operand belongs to, and nothing outside the family ever names them. So
    // the audit's reverse sweep reached the SKETCH (SOLVE references it) and
    // stopped, and all fourteen entities and constraints of a solved rectangle
    // were reported as `unexplained_orphans`.
    //
    // It was invisible until something EXTRUDED a solved sketch. Every tree in
    // this file ends at SOLVE, which yields a PROFILE and no SOLID, so compile()
    // returned before the graph gate ever ran. The first case to take that step
    // -- ir_pipeline_gate.cpp phase 2 -- failed on it immediately.
    //
    // These cases are auditGraph() directly rather than compile(): parse() and
    // the audit are both pure std C++, so the harness needs no kernel symbol,
    // and case B below deliberately names a BOX whose makeBox is unresolved here.
    {
        auto orphanCount = [](const char* src, const char* what) -> std::size_t {
            const FeatureTree ft = parseOrFail(src, what);
            const GraphAudit a = auditGraph(ft);
            std::printf("  [graph audit] %-28s orphans=%zu %s\n", what,
                        a.unexplainedOrphans.size(),
                        a.unexplainedOrphans.empty() ? "" : a.report().c_str());
            return a.unexplainedOrphans.size();
        };

        // A. the payoff shape: solved, then extruded. Nothing is dead.
        check(orphanCount(
                  "%1  = SKETCH(XY)\n%2  = SPT(%1, 0, 0)\n%3  = SPT(%1, 60, 0)\n"
                  "%4  = SPT(%1, 60, 40)\n%5  = SPT(%1, 0, 40)\n"
                  "%6  = SLINE(%2, %3)\n%7  = SLINE(%3, %4)\n"
                  "%8  = SLINE(%4, %5)\n%9  = SLINE(%5, %2)\n"
                  "%10 = CON(%6, HORIZ)\n%11 = CON(%7, VERT)\n"
                  "%12 = CON(%2, DIST, %3, 60)\n"
                  "%13 = SOLVE(%1)\n%14 = EXTRUDE(%13, 10)\nRESULT(%14)\n",
                  "solved and extruded") == 0,
              "a solved+extruded sketch has ZERO orphans");

        // B. ★ THE TEETH. Built, never solved, and the part is a BOX. Every
        // sketch op is genuinely dead and must STILL be named -- otherwise the
        // fix above is just an exemption wearing a dataflow hat.
        check(orphanCount("%1 = SKETCH(XY)\n%2 = SPT(%1, 0, 0)\n%3 = SPT(%1, 10, 0)\n"
                          "%4 = SLINE(%2, %3)\n%5 = CON(%4, HORIZ)\n"
                          "%6 = BOX(10, 10, 10)\nRESULT(%6)\n",
                          "built, never solved") == 5,
              "a sketch that is never solved is STILL five orphans");

        // C. liveness must be PER SKETCH, not global: one sketch is solved and
        // extruded, the other is abandoned, and only the abandoned one's ops
        // may be named.
        check(orphanCount("%1 = SKETCH(XY)\n%2 = SKETCH(XY)\n"
                          "%3 = SPT(%1, 0, 0)\n%4 = SPT(%2, 0, 0)\n"
                          "%5 = CON(%3, HORIZ)\n%6 = CON(%4, HORIZ)\n"
                          "%7 = SOLVE(%1)\n%8 = EXTRUDE(%7, 10)\nRESULT(%8)\n",
                          "one of two sketches used") == 3,
              "the ABANDONED sketch's three ops are still orphans");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. THE TEN KEYWORDS THE CENSUS DESIGNED AND THE FACADE NEVER WIRED.
    //
    // Nine keywords shipped first. The census's table (SKETCH_AND_CONSTRAINTS.md
    // §4) specifies nineteen, and closes: "Every one of those routes to a
    // primitive that ALREADY EXISTS in GCS.h. This is facade exposure, not
    // numerics."
    //
    // WHY THESE ARE MEASURED AND NOT MERELY CALLED. "It did not throw" is what
    // a keyword mapped to the WRONG primitive also looks like, and three of the
    // arms below (RADIUS/DIAM, DISTX/DISTY, ANGLE) have a wrong version that
    // compiles, solves, converges and reports a clean DOF while producing the
    // wrong part. So every case asserts a NUMBER the constraint had to move.
    // ═══════════════════════════════════════════════════════════════════════
    {
        // ---- A. RADIUS applies its value -----------------------------------
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SCIRC(%2, 5)\n"
                                  "%4 = CON(%3, RADIUS, 12)\n"
                                  "%5 = SOLVE(%1)\n", "RADIUS");
            double r = 0;
            if (b.ok && ringRadius(b.sk, r)) {
                std::printf("  [RADIUS]  seeded 5 -> solved %.6f (want 12)\n", r);
                check(near(r, 12.0, 1e-6), "RADIUS 12 moved the circle from 5 to 12");
            } else { check(false, "RADIUS: no ring to measure"); }
        }

        // ---- B. DIAM is a DIAMETER, not a second spelling of radius --------
        // The whole content of this case: 30 must give radius 15, not 30. The
        // wrong wiring (routing DIAM to CircleRadius) converges just as cleanly.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SCIRC(%2, 5)\n"
                                  "%4 = CON(%3, DIAM, 30)\n"
                                  "%5 = SOLVE(%1)\n", "DIAM");
            double r = 0;
            if (b.ok && ringRadius(b.sk, r)) {
                std::printf("  [DIAM]    DIAM 30 -> radius %.6f (want 15, NOT 30)\n", r);
                check(near(r, 15.0, 1e-6), "DIAM 30 gives radius 15");
            } else { check(false, "DIAM: no ring to measure"); }
        }

        // ---- C. ★ ANGLE — THE POSITIVE CONTROL FOR THE UNIT SEAM -----------
        // The IR says degrees; planegcs wants radians. A missing conversion
        // BUILDS, SOLVES and CONVERGES — it just aims at 90 radians, which is
        // 2.035 rad after wrapping, or 116.6°. So this case does not ask "did
        // it solve", it asks whether the second line came out PERPENDICULAR.
        // The unconverted answer gives |cos| = 0.447 and fails loudly.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 10, 0)\n"
                                  "%4 = SPT(%1, 0, 2)\n"
                                  "%5 = SPT(%1, 8, 5)\n"
                                  "%6 = SLINE(%2, %3)\n"
                                  "%7 = SLINE(%4, %5)\n"
                                  "%8 = CON(%6, HORIZ)\n"
                                  "%9 = CON(%2, FIX)\n"
                                  "%10 = CON(%6, ANGLE, %7, 90)\n"
                                  "%11 = SOLVE(%1)\n", "ANGLE 90");
            if (b.ok) {
                double ax, ay, bx, by;
                dirOf(b.sk, 0, 1, ax, ay);   // line %6
                dirOf(b.sk, 2, 3, bx, by);   // line %7
                const double dot = std::fabs(ax * bx + ay * by);
                std::printf("  [ANGLE]   |cos| between the two lines = %.9f "
                            "(want 0; 90 RADIANS would give 0.447)\n", dot);
                check(dot < 1e-6, "ANGLE 90 made the lines perpendicular — degrees "
                                  "were converted to radians at the IR boundary");
            }
        }

        // ---- D. FIX anchors, and DISTX / DISTY are SIGNED -------------------
        // Three keywords in one measurement, because the measurement needs all
        // three: without FIX the solver is free to satisfy a relative offset by
        // moving EITHER point, so an absolute assertion would be measuring the
        // solver's step preference rather than the constraints.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 3, 3)\n"
                                  "%4 = CON(%2, FIX)\n"
                                  "%5 = CON(%2, DISTX, %3, 25)\n"
                                  "%6 = CON(%2, DISTY, %3, -7)\n"
                                  "%7 = SOLVE(%1)\n", "FIX + DISTX + DISTY");
            if (b.ok) {
                const forge::SketchPoint a = forge::readPoint(b.sk, 0);
                const forge::SketchPoint c = forge::readPoint(b.sk, 1);
                std::printf("  [FIX]     anchor stayed at (%.9f, %.9f) (want 0, 0)\n", a.x, a.y);
                std::printf("  [DISTXY]  partner at (%.9f, %.9f) (want 25, -7)\n", c.x, c.y);
                check(near(a.x, 0.0, 1e-9) && near(a.y, 0.0, 1e-9),
                      "FIX pinned the anchor where it was drawn");
                check(near(c.x, 25.0, 1e-6), "DISTX 25 is SIGNED and put the partner at +25");
                check(near(c.y, -7.0, 1e-6), "DISTY -7 is SIGNED and put the partner at -7");
            }
        }

        // ---- E. CONC brings two centres together ---------------------------
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 20, 14)\n"
                                  "%4 = SCIRC(%2, 10)\n"
                                  "%5 = SCIRC(%3, 4)\n"
                                  "%6 = CON(%2, FIX)\n"
                                  "%7 = CON(%4, CONC, %5)\n"
                                  "%8 = SOLVE(%1)\n", "CONC");
            if (b.ok) {
                const forge::SketchPoint a = forge::readPoint(b.sk, 0);
                const forge::SketchPoint c = forge::readPoint(b.sk, 1);
                const double d = std::hypot(c.x - a.x, c.y - a.y);
                std::printf("  [CONC]    centre separation %.9f (was 24.41, want 0)\n", d);
                check(d < 1e-6, "CONC collapsed a 24.41 mm centre offset to zero");
            }
        }

        // ---- F. COLL is parallel AND on the same line ----------------------
        // Parallel alone would pass a "same direction" check while leaving the
        // second line offset, so the assertion is the OFFSET, not the angle.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 10, 0)\n"
                                  "%4 = SPT(%1, 20, 6)\n"
                                  "%5 = SPT(%1, 30, 9)\n"
                                  "%6 = SLINE(%2, %3)\n"
                                  "%7 = SLINE(%4, %5)\n"
                                  "%8 = CON(%2, FIX)\n"
                                  "%9 = CON(%3, FIX)\n"
                                  "%10 = CON(%6, COLL, %7)\n"
                                  "%11 = SOLVE(%1)\n", "COLL");
            if (b.ok) {
                // %6 is pinned along y = 0, so collinearity means both of %7's
                // endpoints are on y = 0 too.
                const forge::SketchPoint c = forge::readPoint(b.sk, 2);
                const forge::SketchPoint d = forge::readPoint(b.sk, 3);
                std::printf("  [COLL]    the other line's endpoints y = %.9f, %.9f (want 0, 0)\n",
                            c.y, d.y);
                check(std::fabs(c.y) < 1e-6 && std::fabs(d.y) < 1e-6,
                      "COLL put the second line ON the first, not merely parallel to it");
            }
        }

        // ---- G. MIDPT bisects -----------------------------------------------
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 40, 20)\n"
                                  "%4 = SPT(%1, 3, 31)\n"
                                  "%5 = CON(%2, FIX)\n"
                                  "%6 = CON(%3, FIX)\n"
                                  "%7 = CON(%2, MIDPT, %3, %4)\n"
                                  "%8 = SOLVE(%1)\n", "MIDPT");
            if (b.ok) {
                const forge::SketchPoint m = forge::readPoint(b.sk, 2);
                std::printf("  [MIDPT]   midpoint at (%.9f, %.9f) (want 20, 10)\n", m.x, m.y);
                check(near(m.x, 20.0, 1e-6) && near(m.y, 10.0, 1e-6),
                      "MIDPT put the third point at the midpoint of the other two");
            }
        }

        // ---- H. SYMM mirrors about a LINE -----------------------------------
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 0, 50)\n"
                                  "%4 = SPT(%1, -12, 20)\n"
                                  "%5 = SPT(%1, 5, 33)\n"
                                  "%6 = SLINE(%2, %3)\n"
                                  "%7 = CON(%2, FIX)\n"
                                  "%8 = CON(%3, FIX)\n"
                                  "%9 = CON(%4, FIX)\n"
                                  "%10 = CON(%4, SYMM, %5, %6)\n"
                                  "%11 = SOLVE(%1)\n", "SYMM about a line");
            if (b.ok) {
                // The mirror is the y axis, so the partner of (-12, 20) is (12, 20).
                const forge::SketchPoint q = forge::readPoint(b.sk, 3);
                std::printf("  [SYMM]    mirrored point at (%.9f, %.9f) (want 12, 20)\n", q.x, q.y);
                check(near(q.x, 12.0, 1e-6) && near(q.y, 20.0, 1e-6),
                      "SYMM mirrored the point about the line");
            }
        }

        // ---- I. PTON onto a CIRCLE — this THREW before -----------------------
        // PTON was wired to PointOnLine alone, so a point on a circle raised and
        // the statement was skipped. planegcs has PointOnCircle and PointOnArc;
        // the target's kind says which, and the caller does not pick.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SCIRC(%2, 10)\n"
                                  "%4 = SPT(%1, 30, 1)\n"
                                  "%5 = CON(%2, FIX)\n"
                                  "%6 = CON(%3, RADIUS, 10)\n"
                                  "%7 = CON(%4, PTON, %3)\n"
                                  "%8 = SOLVE(%1)\n", "PTON onto a circle");
            if (b.ok) {
                check(!verifyMentions(b.r, "PTON rejected"),
                      "PTON onto a circle is no longer rejected");
                const forge::SketchPoint q = forge::readPoint(b.sk, 1);
                const double d = std::hypot(q.x, q.y);
                std::printf("  [PTON]    point distance from centre %.9f (want 10)\n", d);
                check(near(d, 10.0, 1e-6), "PTON put the point ON the circle");
            }
        }

        // ---- J. EQUAL on two ARCS — this THREW before ------------------------
        // The old arm ended "Equal not supported for arcs (use circles)" with
        // EqualRadius(Arc,Arc) declared in the header it was calling into.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 10, 0)\n"
                                  "%4 = SPT(%1, 0, 10)\n"
                                  "%5 = SARC(%2, %3, %4)\n"
                                  "%6 = SPT(%1, 60, 0)\n"
                                  "%7 = SPT(%1, 64, 0)\n"
                                  "%8 = SPT(%1, 60, 4)\n"
                                  "%9 = SARC(%6, %7, %8)\n"
                                  "%10 = CON(%5, EQUAL, %9)\n"
                                  "%11 = SOLVE(%1)\n", "EQUAL on two arcs");
            if (b.ok) {
                check(!verifyMentions(b.r, "EQUAL rejected"),
                      "EQUAL on two arcs is no longer rejected");
                check(!verifyMentions(b.r, "not supported for arcs"),
                      "the 'not supported for arcs' refusal is gone");
            }
        }

        // ---- K. TANG line-to-ARC — this THREW before -------------------------
        // A fillet arc tangent to the wall it fillets is what tangency is FOR,
        // and it was the one pairing the facade did not have.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 40, 0)\n"
                                  "%4 = SLINE(%2, %3)\n"
                                  "%5 = SPT(%1, 20, 9)\n"
                                  "%6 = SPT(%1, 28, 9)\n"
                                  "%7 = SPT(%1, 20, 17)\n"
                                  "%8 = SARC(%5, %6, %7)\n"
                                  "%9 = CON(%4, TANG, %8)\n"
                                  "%10 = SOLVE(%1)\n", "TANG line to arc");
            check(!verifyMentions(b.r, "TANG rejected"),
                  "TANG line-to-arc is no longer rejected");
        }

        // ---- L. NEVER REFUSE still holds for the new kinds -------------------
        // MIDPT handed a LINE as its third operand is a real mistake with a
        // confusable neighbour (SYMM). It must be NAMED, and it must not kill
        // the tree — the statement after it still has to apply.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 10, 0)\n"
                                  "%4 = SPT(%1, 0, 10)\n"
                                  "%5 = SLINE(%3, %4)\n"
                                  "%6 = CON(%2, MIDPT, %3, %5)\n"
                                  "%7 = CON(%2, FIX)\n"
                                  "%8 = CON(%2, DISTX, %3, 33)\n"
                                  "%9 = SOLVE(%1)\n", "MIDPT with a line");
            std::printf("  [MIDPT/bad] nCompiled=%zu\n", b.r.nCompiled);
            dumpVerify(b.r);
            check(b.r.nCompiled == 9, "the whole tree still compiled");
            check(verifyMentions(b.r, "MIDPT rejected"), "the bad MIDPT is NAMED, not swallowed");
            check(verifyMentions(b.r, "not a line"), "the diagnostic says WHICH operand was wrong");
            if (b.ok) {
                const forge::SketchPoint q = forge::readPoint(b.sk, 1);
                std::printf("  [MIDPT/bad] the statement AFTER it still applied: x = %.9f "
                            "(want 33)\n", q.x);
                check(near(q.x, 33.0, 1e-6),
                      "one bad statement did not cost the statements after it");
            }
        }

        // ---- L2. ★ ONE TAG, TWO SOLVER CONSTRAINTS, ONE DEMOTION -----------
        // COLL registers addConstraintParallel AND addConstraintPointOnLine, and
        // FIX registers CoordinateX AND CoordinateY. Both share a single tag on
        // purpose, and the Sketcher.cpp comment claims what that buys: a repair
        // demotes the statement the author WROTE, never half of it. This case
        // measures the claim instead of asserting it in a comment.
        //
        // Line A is pinned along y = 0. Line B is pinned from (0,5) to (10,9) —
        // OFFSET from A and at a DIFFERENT ANGLE, so BOTH halves of COLL are
        // independently impossible. That double conflict is the whole design of
        // the case, and the first version of it did not have it: with B pinned
        // horizontal at y = 5 the Parallel half was already satisfied, so
        // splitting the tag STILL needed only one demotion and the case passed
        // against a mutant. An unfalsifiable check is not a check. Measured
        // against the split-tag mutant, this geometry gives 2 demotions.
        //
        // So the two observables are: exactly ONE demotion, and all four pinned
        // points still where they were drawn.
        {
            Built b = buildSketch("%1 = SKETCH(XY)\n"
                                  "%2 = SPT(%1, 0, 0)\n"
                                  "%3 = SPT(%1, 10, 0)\n"
                                  "%4 = SLINE(%2, %3)\n"
                                  "%5 = SPT(%1, 0, 5)\n"
                                  "%6 = SPT(%1, 10, 9)\n"
                                  "%7 = SLINE(%5, %6)\n"
                                  "%8 = CON(%2, FIX)\n"
                                  "%9 = CON(%3, FIX)\n"
                                  "%10 = CON(%5, FIX)\n"
                                  "%11 = CON(%6, FIX)\n"
                                  "%12 = CON(%4, COLL, %7)\n"
                                  "%13 = SOLVE(%1)\n", "COLL against four FIXes");
            std::printf("  [COLL/repair] nCompiled=%zu\n", b.r.nCompiled);
            dumpVerify(b.r);
            check(b.r.nCompiled == 13, "all 13 statements compiled");
            // Count the demotions the verify line names.
            std::size_t demotions = 0;
            for (const std::string& line : b.r.verify) {
                std::size_t at = 0;
                while ((at = line.find("DEMOTED", at)) != std::string::npos) { ++demotions; at += 7; }
            }
            std::printf("  [COLL/repair] demotions = %zu (want 1)\n", demotions);
            check(demotions == 1,
                  "ONE demotion freed BOTH of COLL's solver constraints — a half-demoted "
                  "COLL would have left the system inconsistent and cost a second tag");
            if (b.ok) {
                const forge::SketchPoint p0 = forge::readPoint(b.sk, 0);
                const forge::SketchPoint p1 = forge::readPoint(b.sk, 1);
                const forge::SketchPoint p2 = forge::readPoint(b.sk, 2);
                const forge::SketchPoint p3 = forge::readPoint(b.sk, 3);
                std::printf("  [COLL/repair] pinned points (%.6f,%.6f) (%.6f,%.6f) "
                            "(%.6f,%.6f) (%.6f,%.6f)\n",
                            p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
                check(near(p0.y, 0.0, 1e-9) && near(p1.y, 0.0, 1e-9) &&
                      near(p2.y, 5.0, 1e-9) && near(p3.y, 9.0, 1e-9),
                      "every FIXed point is still where it was drawn — the repair spent "
                      "the impossible statement and nothing else");
            }
        }

        // ---- M. EVERY DOCUMENTED KEYWORD IS DISPATCHED -----------------------
        // The defect this closes by construction: "a vocabulary that names a
        // keyword the compiler skips is a worse defect than a short vocabulary"
        // (FeatureTree.hpp, the CON contract). The list below is that contract's
        // list. Each is PROBED through the compiler rather than read out of a
        // table, so it measures dispatch and not documentation.
        //
        // NOTACONSTRAINT is the probe's own positive control: if the probe could
        // not detect an absent keyword, every row above it would pass vacuously.
        {
            const char* kKeywords[] = {
                "COINC", "PARA", "PERP", "TANG", "EQUAL", "CONC", "COLL", "SYMM",
                "MIDPT", "HORIZ", "VERT", "PTON", "FIX",
                "DIST", "DISTX", "DISTY", "ANGLE", "RADIUS", "DIAM",
            };
            const std::size_t n = sizeof(kKeywords) / sizeof(kKeywords[0]);
            check(n == 19, "the CON contract lists 19 keywords");
            std::size_t dispatched = 0;
            for (const char* kw : kKeywords) {
                const std::string src =
                    std::string("%1 = SKETCH(XY)\n"
                                "%2 = SPT(%1, 0, 0)\n"
                                "%3 = SPT(%1, 10, 4)\n"
                                "%4 = SLINE(%2, %3)\n"
                                "%5 = CON(%2, ") + kw + ", %3, 5)\n%6 = SOLVE(%1)\n";
                const CompileResult r = compile(parseOrFail(src.c_str(), kw));
                const bool unknown = verifyMentions(r, std::string("unknown kind '") + kw + "'");
                if (!unknown) ++dispatched;
                check(!unknown, std::string("CON keyword ") + kw + " is DISPATCHED, not unknown");
            }
            std::printf("  [keywords] %zu of %zu documented CON keywords dispatch\n",
                        dispatched, n);

            // The probe's falsifiability control.
            const CompileResult bad = compile(parseOrFail(
                "%1 = SKETCH(XY)\n%2 = SPT(%1, 0, 0)\n%3 = SPT(%1, 10, 4)\n"
                "%4 = CON(%2, NOTACONSTRAINT, %3)\n%5 = SOLVE(%1)\n", "the probe control"));
            check(verifyMentions(bad, "unknown kind 'NOTACONSTRAINT'"),
                  "the probe CAN see an absent keyword — the 19 rows above are not vacuous");
        }
    }

    std::printf("\n[sketch_solve] %d checks, %d failures — %s\n",
                g_checks, g_fails, g_fails ? "FAIL" : "PASS");
    return g_fails ? 1 : 0;
}
