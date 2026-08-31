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

    std::printf("\n[sketch_solve] %d checks, %d failures — %s\n",
                g_checks, g_fails, g_fails ? "FAIL" : "PASS");
    return g_fails ? 1 : 0;
}
