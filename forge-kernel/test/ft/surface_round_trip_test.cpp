// forge-kernel/test/ft/surface_round_trip_test.cpp
//
// THE SURFACE VALUE KIND, ROUND-TRIPPED ACROSS THE SEAM.
//
// forge::ui prints `%N = OP(...)` and forge::ft::parse() reads it. Those are two
// separate transcriptions of one grammar in two libraries, and a new value kind
// is exactly the change that can pass both halves' own gates while the halves
// disagree with each other. ui/test/surface_value_kind_test.cpp proves the
// PRINTING half; this gate takes that half's own output and feeds it to the REAL
// kernel parser.
//
// It links FeatureTreeCompiler.cpp for parse() and leaves compile()'s kernel
// symbols unresolved (build_surface_round_trip.sh explains how) — exactly the
// arrangement s0_acceptance_test.cpp uses. So this is a PARSE-level gate: it
// proves the grammar, the op table, the arities and the tolerant repairs agree.
// It does not build geometry and does not claim to.
#include <cstdio>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/GraphAudit.hpp"
#include "forge/ui/FeatureIr.hpp"

using forge::ft::OpCode;
using forge::ui::IrArg;
using forge::ui::IrLine;

namespace {

int gChecks = 0;
int gFails = 0;

void ok(bool cond, const std::string& what) {
    ++gChecks;
    if (cond) return;
    ++gFails;
    std::printf("  FAIL  %s\n", what.c_str());
}

void eqInt(long long got, long long want, const std::string& what) {
    ++gChecks;
    if (got == want) return;
    ++gFails;
    std::printf("  FAIL  %s (got %lld, want %lld)\n", what.c_str(), got, want);
}

// Parse and report the failure text rather than letting the exception escape:
// a gate that dies on its first surprise tells you one thing and hides the rest.
bool tryParse(const std::string& text, forge::ft::FeatureTree& out, std::string& err) {
    try {
        out = forge::ft::parse(text);
        return true;
    } catch (const std::exception& e) {
        err = e.what();
        return false;
    }
}

}  // namespace

int main() {
    std::printf("=== SURFACE value kind — forge::ui prints, forge::ft parses ===\n");

    // ── 1. every surface statement the UI can print, parsed by the kernel ────
    {
        const struct { IrLine line; OpCode code; std::size_t args; } cases[] = {
            {{3, "SKIN", {IrArg::valueRef(1), IrArg::valueRef(2)}}, OpCode::Skin, 2},
            {{4, "SKIN", {IrArg::valueRef(1), IrArg::valueRef(2), IrArg::keyword("RULED")}},
             OpCode::Skin, 3},
            {{2, "FACES", {IrArg::valueRef(1), IrArg::text("bore:r=47.5")}}, OpCode::Faces, 2},
            {{3, "SEW", {IrArg::valueRef(2)}}, OpCode::Sew, 1},
            {{4, "SEW", {IrArg::valueRef(2), IrArg::valueRef(3), IrArg::num(0.01)}},
             OpCode::Sew, 3},
            {{5, "THICKEN", {IrArg::valueRef(4), IrArg::num(2.5)}}, OpCode::Thicken, 2},
            {{6, "THICKEN", {IrArg::valueRef(4), IrArg::num(2.5), IrArg::keyword("OUT")}},
             OpCode::Thicken, 3},
            {{5, "CAP", {IrArg::valueRef(4)}}, OpCode::Cap, 1},
            {{7, "SURFCHECK", {IrArg::valueRef(6), IrArg::text("freeEdges=0")}},
             OpCode::SurfCheck, 2},
        };
        for (const auto& c : cases) {
            const std::string text = c.line.text();
            // The UI must consider its own emission legal before the kernel sees it.
            eqInt(static_cast<int>(forge::ui::validateIr(c.line)),
                  static_cast<int>(forge::ui::IrCheck::Ok), "UI accepts " + text);
            forge::ft::FeatureTree ft;
            std::string err;
            if (!tryParse(text, ft, err)) {
                ok(false, "kernel parses " + text + " — but threw: " + err);
                continue;
            }
            eqInt(static_cast<long long>(ft.ops.size()), 1, "one op from " + text);
            if (ft.ops.empty()) continue;
            eqInt(static_cast<int>(ft.ops[0].code), static_cast<int>(c.code),
                  "op code of " + text);
            ok(ft.ops[0].code != OpCode::Unknown,
               text + " does not resolve to the closed-vocabulary sentinel");
            eqInt(static_cast<long long>(ft.ops[0].args.size()),
                  static_cast<long long>(c.args), "arg count of " + text);
            eqInt(static_cast<long long>(ft.counts.declared),
                  static_cast<long long>(ft.counts.parsed), "s0.4 census reconciles for " + text);
        }
    }

    // ── 2. a WHOLE surfacing tree, printed by the UI, parsed as one program ──
    // Both directions of the kind in one program: SOLID -> SURFACE (FACES) and
    // SURFACE -> SOLID (THICKEN). Either one alone leaves the kind a dead end.
    {
        const std::vector<IrLine> program = {
            {1, "BOX", {IrArg::num(80), IrArg::num(60), IrArg::num(20)}},
            {2, "FACES", {IrArg::valueRef(1), IrArg::text("+z")}},
            {3, "SEW", {IrArg::valueRef(2)}},
            {4, "SURFCHECK", {IrArg::valueRef(3), IrArg::text("faces>=1")}},
            {5, "THICKEN", {IrArg::valueRef(4), IrArg::num(2)}},
            {6, "FUSE", {IrArg::valueRef(1), IrArg::valueRef(5)}},
        };
        std::string text;
        for (const IrLine& l : program) {
            eqInt(static_cast<int>(forge::ui::validateIr(l)),
                  static_cast<int>(forge::ui::IrCheck::Ok), "UI accepts " + l.text());
            text += l.text() + "\n";
        }
        text += "RESULT(%6)\n";

        forge::ft::FeatureTree ft;
        std::string err;
        if (!tryParse(text, ft, err)) {
            ok(false, "the mixed surface/solid program parses — but threw: " + err);
        } else {
            eqInt(static_cast<long long>(ft.ops.size()), 6, "six ops in the mixed program");
            eqInt(ft.resultId, 6, "RESULT binds %6");
            eqInt(static_cast<long long>(ft.counts.declared),
                  static_cast<long long>(ft.counts.parsed), "s0.4 census reconciles");
            ok(ft.counts.reconciles(), "Census::reconciles() agrees");

            // SURFCHECK is a PASS-THROUGH predicate, so it is a legitimate leaf.
            // If GraphAudit did not know that, every tree that measured its own
            // surface would be rejected as carrying an unexplained orphan — a
            // diagnostic op that makes the tree illegal is a refusal by another
            // name, which is exactly what this design forbids.
            const forge::ft::GraphAudit ga = forge::ft::auditGraph(ft, 6);
            ok(ga.clean(), "graph audit is clean: " + ga.report());
            ok(ga.unexplainedOrphans.empty(), "SURFCHECK is not an orphan");
        }
    }

    // ── 3. the TOLERANT parse repairs ────────────────────────────────────────
    // A bare `SURFCHECK "..."` with no `%id =` and no body ref is the form an
    // emitter actually writes (it is how ground-truth trees write VERIFY). The
    // parser binds it to the newest value instead of rejecting it. Losing a whole
    // 200-op tree over missing punctuation on a DIAGNOSTIC op is the precise
    // failure the SURFACE kind exists to avoid.
    {
        const std::string text =
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"+z\")\n"
            "SURFCHECK \"faces>=1\"\n";
        forge::ft::FeatureTree ft;
        std::string err;
        if (!tryParse(text, ft, err)) {
            ok(false, "bare SURFCHECK is repaired — but threw: " + err);
        } else {
            eqInt(static_cast<long long>(ft.ops.size()), 3, "bare SURFCHECK becomes an op");
            if (ft.ops.size() == 3) {
                eqInt(static_cast<int>(ft.ops[2].code), static_cast<int>(OpCode::SurfCheck),
                      "the repaired line is a SURFCHECK");
                ok(!ft.ops[2].args.empty() &&
                       ft.ops[2].args[0].kind == forge::ft::TokKind::Ref,
                   "the repair inserted the implicit %body ref");
                if (!ft.ops[2].args.empty()) {
                    eqInt(ft.ops[2].args[0].ref, 2, "it bound to the newest value %2");
                }
            }
        }
    }
    {
        // The assignment form with the body left implicit gets the same binding.
        const std::string text =
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"+z\")\n"
            "%3 = SURFCHECK(\"freeEdges>=1\")\n";
        forge::ft::FeatureTree ft;
        std::string err;
        if (!tryParse(text, ft, err)) {
            ok(false, "implicit-body SURFCHECK is repaired — but threw: " + err);
        } else if (ft.ops.size() == 3) {
            ok(!ft.ops[2].args.empty() && ft.ops[2].args[0].kind == forge::ft::TokKind::Ref,
               "%3 = SURFCHECK(\"...\") gains its %body");
            if (!ft.ops[2].args.empty()) eqInt(ft.ops[2].args[0].ref, 2, "bound to %2");
        } else {
            ok(false, "implicit-body SURFCHECK produced the wrong op count");
        }
    }

    // ── 4. a selector that will match NOTHING still parses ───────────────────
    // Whether a predicate matches is a question for the live face inventory at
    // compile time, and the documented answer is an EMPTY surface. It must not be
    // a syntax error, or the tolerance is only skin-deep.
    {
        const std::string text =
            "%1 = BOX(20, 20, 20)\n"
            "%2 = FACES(%1, \"bore:r=99999\")\n"
            "%3 = THICKEN(%2, 1)\n";
        forge::ft::FeatureTree ft;
        std::string err;
        ok(tryParse(text, ft, err),
           "an impossible selector is still a legal statement: " + err);
        if (!err.empty()) std::printf("        (%s)\n", err.c_str());
    }

    // ── 5. the closed vocabulary is still closed ─────────────────────────────
    // Adding six names must not widen the door for a seventh nobody wrote. A miss
    // is still a parse error, not a constructive default.
    {
        forge::ft::FeatureTree ft;
        std::string err;
        ok(!tryParse("%1 = SURFACIFY(%0, 2)\n", ft, err),
           "an unknown surface-ish op is REJECTED, not defaulted");
        ok(err.find("SURFACIFY") != std::string::npos,
           "and the error names it: " + err);
    }

    // ── 6. the kernel's own spelling table agrees with the UI's ─────────────
    // Not a count: the actual names. forge::ui::irOpTable() is a transcription of
    // forge::ft's table, and the one thing a transcription cannot be trusted about
    // is a name it was never asked to parse.
    {
        for (const forge::ui::IrOpSpec& spec : forge::ui::irOpTable()) {
            // Arity is not checked by the parser, but a POINT RING is: POLY/WIRE
            // are TRUNCATED, not unknown, without one. So each op gets the
            // smallest argument list its own table says it takes; what is being
            // proved is that the NAME resolves to a real op, in the kernel, for
            // every name the UI is willing to print.
            std::string args;
            if (spec.name == "POLY" || spec.name == "WIRE") {
                args = "[0 0; 10 0; 10 10]";
            } else if (spec.name == "SWEEP") {
                args = "1, [0 0 0; 0 0 10]";
            } else {
                for (std::size_t i = 0; i < spec.minArgs; ++i) {
                    if (i != 0) args += ", ";
                    args += (i == 0 && spec.firstArgIsValueRef) ? "%1" : "1";
                }
            }
            const std::string stmt = "%1 = BOX(10, 10, 10)\n%2 = " + spec.name + "(" + args + ")";
            forge::ft::FeatureTree ft;
            std::string err;
            if (!tryParse(stmt, ft, err)) {
                ok(false, "kernel knows the UI op " + spec.name + ": " + err);
                continue;
            }
            ok(ft.ops.size() == 2 && ft.ops[1].code != OpCode::Unknown,
               "kernel knows the UI op " + spec.name);
        }
    }

    std::printf("---------------------------------------------------------------\n");
    std::printf("TOTAL  checks=%d  fail=%d\n", gChecks, gFails);
    if (gFails == 0) {
        std::printf("RESULT: PASS — forge::ui's SURFACE emissions parse in forge::ft.\n");
        return 0;
    }
    std::printf("RESULT: FAIL — the two halves of the seam disagree.\n");
    return 1;
}
