// ============================================================================
// SACROSANCT 3.1 — Appendix B mandatory acceptance tests for the feature DAG (s0)
//
// Three of the twelve, implemented against the EXISTING forge::ft IR
// (include/forge/ft/FeatureTree.hpp, src/ft/FeatureTreeCompiler.cpp):
//
//   OPAQUE-MACRO      s0.5  "insert 'finish remaining holes' or equivalent"
//                           -> parser/schema/policy rejects executable placeholder
//   NOOP-PADDING      s0.4  "add meaningless features to inflate length"
//                           -> graph-quality gate rejects or removes padding
//                              without hiding required intent
//   PATTERN-EXPLICIT  s0.6  "nested patterns with suppression and overrides"
//                           -> exact intended/materialized occurrence counts and
//                              addressable child lineage
//
// SCOPE OF THIS BINARY — stated up front so no result is over-read.
// Every assertion below is made against forge::ft::parse() and the parsed
// FeatureTree ONLY. compile() is never called: it walks into the full OCCT-
// backed kernel, and all three laws under test are PARSE/SCHEMA/GRAPH laws.
// s0.5 says "REJECTED BY THE PARSER"; s0.4's count tables are graph-header
// properties; s0.6's occurrence table is a property of the serialized graph.
// A law that only holds once a solid has been built is not one of these three.
//
// These tests are written to FAIL where the IR does not yet enforce the law.
// A failing assertion here names a real, exact gap. Do not weaken it.
// ============================================================================

#include "forge/ft/FeatureTree.hpp"

#include <cstdio>
#include <exception>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using forge::ft::FeatureTree;
using forge::ft::Op;
using forge::ft::OpCode;
using forge::ft::TokKind;

// ------------------------------------------------------------------ harness
namespace {

int g_pass = 0;
int g_fail = 0;

void group(const char* name) {
    std::printf("\n=== %s ===\n", name);
}

void check(bool cond, const std::string& what, const std::string& detail) {
    if (cond) {
        ++g_pass;
        std::printf("  PASS  %s\n", what.c_str());
    } else {
        ++g_fail;
        std::printf("  FAIL  %s\n", what.c_str());
        std::printf("        %s\n", detail.c_str());
    }
}

struct ParseOutcome {
    bool        threw = false;
    std::string message;
    FeatureTree tree;
};

ParseOutcome tryParse(const std::string& text) {
    ParseOutcome o;
    try {
        o.tree = forge::ft::parse(text);
    } catch (const std::exception& e) {
        o.threw = true;
        o.message = e.what();
    }
    return o;
}

// Number of ops of a given code in a parsed tree.
std::size_t countCode(const FeatureTree& ft, OpCode c) {
    std::size_t n = 0;
    for (const Op& op : ft.ops)
        if (op.code == c) ++n;
    return n;
}

// s0.4 "unexplained orphans ... required value is zero".
// Reachability over the parsed IR: an op is EXPLAINED if it is the result, or a
// (transitive) %ref argument of an explained op, or a VERIFY/TAG (a predicate,
// whose job is to be a leaf). Anything else contributed nothing to the accepted
// part.
//
// Computed HERE, in the test, on purpose: it proves the padding is fully
// detectable from the parsed IR alone. The gap is not "undetectable", it is
// "never checked".
std::vector<int> unexplainedOrphans(const FeatureTree& ft) {
    int last = -1;
    for (const Op& op : ft.ops)
        if (op.code != OpCode::Verify && op.code != OpCode::Tag) last = op.id;
    const int root = (ft.resultId >= 0) ? ft.resultId : last;

    std::set<int> live;
    live.insert(root);
    // Walk backwards: creation order == evaluation order, so a %ref always
    // points at an earlier id and one reverse sweep reaches the whole cone.
    for (auto it = ft.ops.rbegin(); it != ft.ops.rend(); ++it) {
        const Op& op = *it;
        const bool isPredicate = (op.code == OpCode::Verify || op.code == OpCode::Tag);
        if (!live.count(op.id) && !isPredicate) continue;
        for (const auto& a : op.args)
            if (a.kind == TokKind::Ref) live.insert(a.ref);
    }

    std::vector<int> orphans;
    for (const Op& op : ft.ops) {
        if (op.code == OpCode::Verify || op.code == OpCode::Tag) continue;
        if (!live.count(op.id)) orphans.push_back(op.id);
    }
    return orphans;
}

}  // namespace

// ============================================================================
// TEST 1 — OPAQUE-MACRO  (SACROSANCT s0.5)
//
// s0.5 forbids these executable statements verbatim and requires the parser /
// schema / policy to REJECT them as executable placeholders. They "omit
// identity, parameters, reference selection, failure behavior, or exact count."
// ============================================================================
void testOpaqueMacro() {
    group("OPAQUE-MACRO (s0.5) — parser must reject executable placeholders");

    // The six forbidden statements, quoted verbatim from SACROSANCT 3.1 s0.5.
    const std::vector<std::string> forbidden = {
        "for each corner: add feet",
        "make curved web and arms",
        "place six mounting tabs",
        "finish the remaining holes",
        "apply appropriate fillets",
        "use standard fasteners",
    };

    // ---- positive control: a legitimate tree must parse cleanly ------------
    // Without this, "everything throws" would look like a pass.
    {
        const std::string good =
            "%1 = BOX(60, 40, 10)\n"
            "%2 = HOLE(%1, 6, 20, 0, 0)\n"
            "RESULT(%2)\n";
        ParseOutcome o = tryParse(good);
        check(!o.threw && o.tree.ops.size() == 2,
              "control: a well-formed 2-op tree parses (2 ops, no throw)",
              std::string("threw=") + (o.threw ? "yes: " + o.message : "no") +
                  ", ops=" + std::to_string(o.tree.ops.size()));
    }

    // ---- 1a: the placeholder ALONE must be rejected ------------------------
    for (const std::string& phrase : forbidden) {
        const std::string text =
            "%1 = BOX(60, 40, 10)\n" + phrase + "\n" + "RESULT(%1)\n";
        ParseOutcome o = tryParse(text);
        check(o.threw,
              "rejects executable placeholder: \"" + phrase + "\"",
              o.threw ? "" :
                  "parse() ACCEPTED it silently and produced " +
                  std::to_string(o.tree.ops.size()) +
                  " ops — the placeholder line was dropped by the "
                  "\"tolerate prose\" branch in FeatureTreeCompiler.cpp "
                  "(`if (line[0] != '%' && ...RESULT... && ...VERIFY...) continue;`). "
                  "No diagnostic is produced anywhere.");
    }

    // ---- 1b: the WORST case — a placeholder inside an otherwise valid tree --
    // This is the one that turns a wrong part green: the six tabs are never
    // built, the tree compiles, and nothing reports that intent was dropped.
    {
        const std::string text =
            "%1 = BOX(120, 80, 12)\n"
            "place six mounting tabs\n"
            "%2 = HOLE(%1, 8, 0, 0, 0)\n"
            "RESULT(%2)\n";
        ParseOutcome o = tryParse(text);
        check(o.threw,
              "rejects a placeholder EMBEDDED in an otherwise-valid tree",
              o.threw ? "" :
                  "parse() returned a clean tree of " + std::to_string(o.tree.ops.size()) +
                  " ops with resultId=" + std::to_string(o.tree.resultId) +
                  ". The six mounting tabs are simply absent from the graph. "
                  "A part missing a declared feature is reported as fully parsed.");
    }

    // ---- 1c: s0.4 cardinality — declared vs parsed --------------------------
    // 4 semantic statements are declared in the text; the parser must not
    // silently reconcile that to 2. N_declared == N_parsed is mandatory.
    {
        const std::string text =
            "%1 = BOX(120, 80, 12)\n"
            "place six mounting tabs\n"
            "finish the remaining holes\n"
            "%2 = HOLE(%1, 8, 0, 0, 0)\n"
            "RESULT(%2)\n";
        ParseOutcome o = tryParse(text);
        const std::size_t declared = 4;
        const std::size_t parsed   = o.threw ? 0 : o.tree.ops.size();
        check(o.threw || parsed == declared,
              "s0.4 N_declared_semantic_features == N_parsed_semantic_features",
              "declared=" + std::to_string(declared) +
                  " parsed=" + std::to_string(parsed) +
                  " — 2 statements vanished with no error, no warning, and no "
                  "count table anywhere in FeatureTree or CompileResult "
                  "(neither struct has a count-ledger field).");
    }

    // ---- 1d: s0.5 "no silent truncation, ever" ------------------------------
    // The parser deliberately drops a malformed FINAL line (the `truncatedTail`
    // branch) so a token-ceiling cutoff still yields a tree. That is silent
    // truncation of an executable graph by construction.
    {
        const std::string text =
            "%1 = BOX(60, 40, 10)\n"
            "%2 = HOLE(%1, 6, 20, 0, 0)\n"
            "%3 = FILLET(%2, 2\n";           // unterminated final statement
        ParseOutcome o = tryParse(text);
        check(o.threw,
              "s0.5 no silent truncation: a malformed FINAL statement is not dropped",
              o.threw ? "" :
                  "parse() swallowed the truncated line and returned " +
                  std::to_string(o.tree.ops.size()) +
                  " ops with no PAUSED_INCOMPLETE, no checkpoint, and no flag on "
                  "FeatureTree. Appendix B RESOURCE-EXHAUSTION requires "
                  "PAUSED_INCOMPLETE with the last valid checkpoint, never success.");
    }
}

// ============================================================================
// TEST 2 — NOOP-PADDING  (SACROSANCT s0.4)
//
// "add meaningless features to inflate length" -> "graph-quality gate rejects
// or removes padding without hiding required intent", and s0.4: "The required
// values for unresolved references, unexplained orphans, opaque placeholders,
// and unapproved failed nodes are zero."
// ============================================================================
void testNoopPadding() {
    group("NOOP-PADDING (s0.4) — graph-quality gate must reject inflated graphs");

    // The real part: 2 semantic features.
    const std::string real =
        "%1 = BOX(80, 50, 12)\n"
        "%2 = HOLE(%1, 6, 25, 0, 0)\n";

    // 8 padding ops. Every one is either a provable identity or a dead branch.
    const std::string padding =
        "%3 = TRANSLATE(%2, 0, 0, 0)\n"          // identity translation
        "%4 = ROTATE(%3, 0, 0, 0, 1)\n"          // zero-angle rotation
        "%5 = FUSE(%4, %4)\n"                    // self-fuse
        "%6 = PATTERN(%5, LINEAR, 1, 0)\n"       // count-1, zero-step pattern
        "%7 = HEAL(%6)\n"                        // heal of an unmodified solid
        "%8 = COMMON(%7, %7)\n"                  // self-intersection
        "%20 = CYL(3, 5)\n"                      // dead branch: never referenced
        "%21 = TRANSLATE(%20, 900, 900, 900)\n"  // dead branch: never referenced
        "RESULT(%8)\n";

    // ---- control: the clean tree has zero orphans ---------------------------
    {
        ParseOutcome o = tryParse(real + "RESULT(%2)\n");
        std::vector<int> orph = o.threw ? std::vector<int>{} : unexplainedOrphans(o.tree);
        check(!o.threw && orph.empty(),
              "control: the un-padded 2-feature tree has 0 unexplained orphans",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " orphans=" + std::to_string(orph.size()));
    }

    ParseOutcome o = tryParse(real + padding);

    // ---- 2a: the padding is DETECTABLE from the parsed IR alone -------------
    // Proving this first is what makes 2b/2c a gap in enforcement rather than a
    // gap in information.
    {
        std::vector<int> orph = o.threw ? std::vector<int>{} : unexplainedOrphans(o.tree);
        std::string ids;
        for (int id : orph) ids += (ids.empty() ? "" : ",") + std::to_string(id);
        check(!o.threw && orph == std::vector<int>{20, 21},
              "the two dead-branch ops (%20, %21) are computable orphans from the parsed IR",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " orphans=[" + ids + "] (expected 20,21)");
    }

    // ---- 2b: s0.4 unexplained orphans must be ZERO in an ACCEPTED graph -----
    {
        std::vector<int> orph = o.threw ? std::vector<int>{} : unexplainedOrphans(o.tree);
        check(o.threw || orph.empty(),
              "s0.4 accepted graph has 0 unexplained orphans (rejected otherwise)",
              "parse() ACCEPTED a graph carrying " + std::to_string(orph.size()) +
                  " orphan ops. forge::ft has no reachability pass: compile() "
                  "evaluates every op in creation order and simply never uses the "
                  "results. Nothing in FeatureTree or CompileResult reports them.");
    }

    // ---- 2c: the quality gate must reject or strip the identity padding -----
    {
        const std::size_t declaredSemantic = 2;                       // BOX + HOLE
        const std::size_t parsed = o.threw ? 0 : o.tree.ops.size();   // 10
        check(o.threw || parsed == declaredSemantic,
              "graph-quality gate rejects or removes 8 no-op features "
              "(2 semantic features declared)",
              "parsed=" + std::to_string(parsed) + " ops for a 2-feature part — a 5x "
              "length inflation accepted verbatim. There is no quality gate in "
              "forge::ft: parse() is purely syntactic and compile() has no "
              "no-op/identity/orphan analysis (grep of FeatureTreeCompiler.cpp for "
              "cardinal|orphan|padding|quality returns 0 hits).");
    }

    // ---- 2d: "without hiding required intent" -------------------------------
    // The 2 real features must still be present and addressable after any gate.
    {
        check(!o.threw &&
                  countCode(o.tree, OpCode::Box) == 1 &&
                  countCode(o.tree, OpCode::Hole) == 1,
              "padding removal must not hide required intent (BOX + HOLE survive)",
              "box=" + std::to_string(o.threw ? 0 : countCode(o.tree, OpCode::Box)) +
                  " hole=" + std::to_string(o.threw ? 0 : countCode(o.tree, OpCode::Hole)));
    }
}

// ============================================================================
// TEST 3 — PATTERN-EXPLICIT  (SACROSANCT s0.6)
//
// "A pattern is one semantic feature plus exact, addressable instances."
// Required fields include "exact occurrence list with OccurrenceId, transform,
// suppression state, and expected result body" and "per-instance overrides with
// provenance". "A later edit may address hole_pattern.instance[4] without
// relying on a volatile face index."
// ============================================================================
void testPatternExplicit() {
    group("PATTERN-EXPLICIT (s0.6) — occurrence table + addressable child lineage");

    // A NESTED pattern: 6 polar instances, replicated 3x linearly = 18 intended.
    const std::string nested =
        "%1 = BOX(200, 120, 15)\n"
        "%2 = CYL(4, 20, 40, 0, -1)\n"
        "%3 = PATTERN(%2, POLAR, 6, 360, 0, 0, 0, 0, 0, 1)\n"   // 6 occurrences
        "%4 = PATTERN(%3, LINEAR, 3, 60)\n"                     // x3 = 18 occurrences
        "%5 = CUT(%1, %4)\n"
        "RESULT(%5)\n";

    ParseOutcome o = tryParse(nested);
    check(!o.threw, "control: the nested-pattern tree parses",
          o.threw ? o.message : "");

    // ---- 3a: exact INTENDED occurrence count --------------------------------
    // s0.6: "the graph must prove six intended instances". Here: 6 * 3 = 18.
    {
        const int intended = 18;
        // What the IR actually records for a pattern: one Op producing one value.
        // An occurrence table would live on the Op. forge::ft::Op is exactly
        // {id, code, name, args, poly, srcLine} — there is no occurrence field to
        // read, so the recorded addressable-child count is structurally 0.
        int addressableChildren = 0;
        if (!o.threw)
            for (const Op& op : o.tree.ops)
                if (op.code == OpCode::Pattern) addressableChildren += 0;
        check(addressableChildren == intended,
              "s0.6 nested pattern records 18 intended occurrences with OccurrenceIds",
              "recorded addressable occurrences = " + std::to_string(addressableChildren) +
                  " of " + std::to_string(intended) + ". forge::ft::Op has no occurrence "
                  "table field at all (FeatureTree.hpp: struct Op { id, code, name, args, "
                  "poly, srcLine }), and the IR value model states \"Every op produces "
                  "exactly one value\" — so a 6-instance pattern is ONE fused solid handle. "
                  "opPattern() calls forge::part::circularPattern once and returns a single "
                  "Handle; the instances are unrecoverable after the call.");
    }

    // ---- 3b: SUPPRESSION must be expressible in the grammar -----------------
    // s0.6 requires a "suppression map" and an "occurrence list with ...
    // suppression state". Try the most natural spelling the IR could support.
    {
        const std::string withSuppress =
            "%1 = BOX(200, 120, 15)\n"
            "%2 = CYL(4, 20, 40, 0, -1)\n"
            "%3 = PATTERN(%2, POLAR, 6, 360, SUPPRESS, [4])\n"
            "%4 = CUT(%1, %3)\n"
            "RESULT(%4)\n";
        ParseOutcome s = tryParse(withSuppress);
        // Pass condition: the grammar ACCEPTS a suppression map and the parsed
        // PATTERN op carries it. Not "throws" — a throw means it cannot be said.
        bool carriesSuppression = false;
        if (!s.threw)
            for (const Op& op : s.tree.ops)
                if (op.code == OpCode::Pattern)
                    for (const auto& a : op.args)
                        if (a.kind == TokKind::Keyword && a.kw == "SUPPRESS")
                            carriesSuppression = true;
        check(carriesSuppression,
              "s0.6 grammar can express a pattern suppression map",
              s.threw ? "parse() REJECTED it: " + s.message +
                            " — there is no suppression syntax in the PATTERN grammar "
                            "(PATTERN(%a, POLAR, n, totalAngleDeg [, ox,oy,oz, axx,axy,axz]) "
                            "— every trailing slot is a number)."
                      : "parse() accepted the text but no PATTERN op carries a SUPPRESS "
                        "token; the suppression map is not represented.");
    }

    // ---- 3c: PER-INSTANCE OVERRIDE must be expressible -----------------------
    // s0.6: "per-instance overrides with provenance".
    {
        const std::string withOverride =
            "%1 = BOX(200, 120, 15)\n"
            "%2 = CYL(4, 20, 40, 0, -1)\n"
            "%3 = PATTERN(%2, POLAR, 6, 360)\n"
            "%4 = RESIZEBORE(%3, \"%3.instance[4]\", 6.5)\n"
            "RESULT(%4)\n";
        ParseOutcome v = tryParse(withOverride);
        // Parse-level a selector is an opaque Str token, so this SHOULD survive.
        // If it does not even survive tokenisation, per-instance override cannot
        // be written down at all.
        bool selectorPresent = false;
        if (!v.threw)
            for (const Op& op : v.tree.ops)
                for (const auto& a : op.args)
                    if (a.kind == TokKind::Str && a.str.find(".instance[") != std::string::npos)
                        selectorPresent = true;
        check(!v.threw && selectorPresent,
              "an instance-lineage selector \"%3.instance[4]\" survives parsing as a token",
              v.threw ? v.message : "no .instance[] selector token found");
    }

    // ---- 3d: the addressing must NOT be a volatile geometric index ----------
    // The IR's only repeated-feature selector is "radial:k" / "radial:all",
    // resolved against the LIVE faceInventory by angular clustering at compile
    // time (FeatureTreeCompiler.cpp resolveSelector, "REPEATED RADIAL FEATURES").
    // s0.6 explicitly forbids relying on a volatile face index; "radial:k" is
    // ordered by the measured angle of whatever faces happen to exist, which is
    // exactly a volatile geometric ordering, not a stable child ID minted by the
    // pattern definition.
    {
        // A stable child lineage would mean the pattern op itself names its
        // children. Assert that a parsed PATTERN op declares child IDs.
        bool declaresChildIds = false;   // structurally impossible: Op has no such field
        check(declaresChildIds,
              "s0.6 pattern declares stable child IDs (not resolved by geometry)",
              "The PATTERN op declares no child IDs. The only repeated-feature "
              "addressing in forge::ft is the compile-time selector \"radial:k\", "
              "which orders faces by measured angular cluster against the live "
              "faceInventory — a volatile geometric ordering. s0.6: a later edit "
              "must address hole_pattern.instance[4] \"without relying on a volatile "
              "face index\". TAG/@name gives persistent names to a WHOLE feature, "
              "not to individual pattern occurrences.");
    }
}

// ============================================================================
int main() {
    std::printf("SACROSANCT 3.1 Appendix B — feature-DAG acceptance tests (s0)\n");
    std::printf("target: forge::ft IR (parse-level; compile() is not invoked)\n");

    testOpaqueMacro();
    testNoopPadding();
    testPatternExplicit();

    std::printf("\n---------------------------------------------------------------\n");
    std::printf("TOTAL  pass=%d  fail=%d\n", g_pass, g_fail);
    if (g_fail) {
        std::printf("RESULT: FAIL — the assertions above name gaps in s0 conformance.\n");
        std::printf("These failures are the deliverable. Do not weaken them.\n");
    } else {
        std::printf("RESULT: PASS\n");
    }
    return g_fail ? 1 : 0;
}
