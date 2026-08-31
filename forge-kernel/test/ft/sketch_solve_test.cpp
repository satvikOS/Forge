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
        std::string err;
        const FeatureTree ft = parse(src, err);
        check(err.empty(), "sketch grammar parses: " + err);
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
        std::string err;
        const FeatureTree ft = parse(src, err);
        check(err.empty(), "contradictory sketch parses: " + err);
        const CompileResult r = compile(ft);
        std::printf("  [contradictory] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 6, "all 6 statements compiled despite the contradiction");
        check(!verifyMentions(r, "REFUSED"), "nothing was refused");
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
        std::string err;
        const FeatureTree ft = parse(src, err);
        check(err.empty(), "constrained rectangle parses: " + err);
        const CompileResult r = compile(ft);
        std::printf("  [constrained rect] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 16, "all 16 statements compiled");
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
        std::string err;
        const FeatureTree ft = parse(src, err);
        check(err.empty(), "tree with an unknown CON keyword still parses: " + err);
        const CompileResult r = compile(ft);
        std::printf("  [unknown CON kind] nCompiled=%zu\n", r.nCompiled);
        dumpVerify(r);
        check(r.nCompiled == 5, "the other 4 statements survived one bad keyword");
        check(verifyMentions(r, "SKIPPED"), "the skipped constraint is NAMED, not silently dropped");
    }

    // ── 5. NEGATIVE CONTROL — a GRAMMAR error must STILL refuse ─────────────
    // Without this the gate above only proves the compiler is permissive, which
    // is not the same as proving it is tolerant of the right things. SOLVE on a
    // BOX is a type error, not a geometry outcome, and must fail loudly.
    {
        const char* src =
            "%1 = BOX(10, 10, 10)\n"
            "%2 = SOLVE(%1)\n";
        std::string err;
        const FeatureTree ft = parse(src, err);
        check(err.empty(), "the malformed tree parses (the error is semantic): " + err);
        const CompileResult r = compile(ft);
        std::printf("  [SOLVE on a SOLID] error=\"%s\"\n", r.error.c_str());
        check(!r.error.empty(), "SOLVE on a SOLID is REFUSED — a type error is not a geometry outcome");
        check(r.error.find("SOLVE") != std::string::npos, "the refusal names the offending op");
    }

    std::printf("\n[sketch_solve] %d checks, %d failures — %s\n",
                g_checks, g_fails, g_fails ? "FAIL" : "PASS");
    return g_fails ? 1 : 0;
}
