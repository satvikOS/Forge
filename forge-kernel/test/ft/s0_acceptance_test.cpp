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

#include "forge/ft/ChunkChain.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "forge/ft/GraphAudit.hpp"

#include <cstdio>
#include <exception>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using forge::ft::ChainFault;
using forge::ft::ChainVerdict;
using forge::ft::ChunkStream;
using forge::ft::FeatureTree;
using forge::ft::GraphAudit;
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
    bool        classified = false;          // threw a typed forge::ft::ParseError
    forge::ft::ParseFailure kind = forge::ft::ParseFailure::Syntax;
    int         line = 0;
    std::string message;
    FeatureTree tree;
};

ParseOutcome tryParse(const std::string& text) {
    ParseOutcome o;
    try {
        o.tree = forge::ft::parse(text);
    } catch (const forge::ft::ParseError& e) {
        o.threw = true;
        o.message = e.what();
        o.classified = true;
        o.kind = e.kind;
        o.line = e.line;
    } catch (const std::exception& e) {
        o.threw = true;
        o.message = e.what();
    }
    return o;
}

const char* kindName(forge::ft::ParseFailure k) {
    switch (k) {
        case forge::ft::ParseFailure::Syntax:            return "Syntax";
        case forge::ft::ParseFailure::OpaquePlaceholder: return "OpaquePlaceholder";
        case forge::ft::ParseFailure::Cardinality:       return "Cardinality";
        case forge::ft::ParseFailure::Incomplete:        return "Incomplete";
    }
    return "?";
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
// TEST 4 — CHUNK-CORRUPTION  (SACROSANCT s0.11 + Appendix B)
//
// "remove, duplicate, reorder, or alter one chunk" -> "hash/count chain detects
// corruption before acceptance".
//
// The chain did not exist when this file was first written; forge::ft had no
// chunked transport at all, so there was nothing to corrupt and nothing to
// detect. It is implemented in include/forge/ft/ChunkChain.hpp +
// src/ft/ChunkChain.cpp to the record layout s0.11 specifies (GraphHeader ->
// FeatureChunk[] -> GraphFooter), and every assertion below is a VALUE against a
// reference: a named ChainFault, an exact op count, or a FIPS 180-4 digest.
//
// "BEFORE acceptance" is asserted, not assumed: each corrupted stream is pushed
// through forge::ft::accept(), the only path from a stream to a FeatureTree, and
// must throw rather than return a graph.
// ============================================================================
void testChunkCorruption() {
    group("CHUNK-CORRUPTION (s0.11 / Appendix B) — hash+count chain before acceptance");

    // ---- 4a: the digest itself, against the FIPS 180-4 vectors --------------
    // A chain is only as good as its hash. Asserting the two standard vectors is
    // what separates "we call it SHA-256" from "it is SHA-256".
    {
        const std::string empty = forge::ft::sha256Hex("");
        const std::string abc   = forge::ft::sha256Hex("abc");
        check(empty == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              "SHA-256(\"\") matches the FIPS 180-4 vector", "got " + empty);
        check(abc == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
              "SHA-256(\"abc\") matches the FIPS 180-4 vector", "got " + abc);
    }

    // 12 source lines -> 11 ops + 1 RESULT terminator, chunked 3 lines at a time
    // into 4 chunks, so a corruption can be placed in the middle of the chain.
    const std::string ir =
        "%1 = BOX(120, 80, 12)\n"
        "%2 = HOLE(%1, 8, 40, 25, 0)\n"
        "%3 = HOLE(%2, 8, -40, 25, 0)\n"
        "%4 = HOLE(%3, 8, 40, -25, 0)\n"
        "%5 = HOLE(%4, 8, -40, -25, 0)\n"
        "%6 = FILLET(%5, 3)\n"
        "%7 = CYL(20, 30)\n"
        "%8 = FUSE(%6, %7)\n"
        "%9 = SHELL(%8, 2)\n"
        "%10 = HEAL(%9)\n"
        "%11 = TAG(%10, \"@boss\", \"cyl:r=20\")\n"
        "RESULT(%11)\n";

    const ChunkStream clean = forge::ft::emitChunked(ir, 3);

    // ---- 4b: control — an intact stream verifies AND accepts ----------------
    {
        const ChainVerdict v = forge::ft::verifyChain(clean);
        check(v.accepted && v.fault == ChainFault::None && clean.chunks.size() == 4,
              "control: intact stream verifies (4 chunks, fault=None)",
              std::string("accepted=") + (v.accepted ? "yes" : "no") + " fault=" +
                  forge::ft::toString(v.fault) + " chunks=" +
                  std::to_string(clean.chunks.size()) + " detail=" + v.detail);

        bool threw = false;
        std::size_t ops = 0;
        try { ops = forge::ft::accept(clean).ops.size(); }
        catch (const std::exception& e) { threw = true; }
        check(!threw && ops == 11,
              "control: accept() of an intact stream yields the 11-op tree",
              "threw=" + std::string(threw ? "yes" : "no") + " ops=" + std::to_string(ops));
    }

    // One corruption per case, each applied to the SAME clean stream.
    struct Case {
        const char* name;
        ChainFault  expect;
        ChunkStream (*corrupt)(ChunkStream);
    };

    const std::vector<Case> cases = {
        // REMOVE chunk 2 of 4.
        {"remove one chunk", ChainFault::SequenceGap,
         [](ChunkStream s) { s.chunks.erase(s.chunks.begin() + 1); return s; }},

        // DUPLICATE chunk 2.
        {"duplicate one chunk", ChainFault::DuplicateSequence,
         [](ChunkStream s) { s.chunks.insert(s.chunks.begin() + 2, s.chunks[1]); return s; }},

        // REORDER chunks 2 and 3.
        {"reorder two chunks", ChainFault::OutOfOrder,
         [](ChunkStream s) { std::swap(s.chunks[1], s.chunks[2]); return s; }},

        // ALTER one line inside chunk 2 — an 8 mm bolt hole silently becomes 12 mm.
        // This is the corruption that would otherwise build a WRONG part with a
        // clean bill of health.
        {"alter one line in a chunk", ChainFault::ChunkAltered,
         [](ChunkStream s) {
             s.chunks[1].lines[0] = "%4 = HOLE(%3, 12, 40, -25, 0)";
             return s;
         }},

        // ALTER a line AND re-hash that chunk, as a forger who knows the format
        // would. The per-chunk digest now agrees with its own content, so only
        // the CHAIN can catch it: chunk 3's back-link no longer matches.
        {"alter a line and re-hash that chunk", ChainFault::LinkBroken,
         [](ChunkStream s) {
             s.chunks[1].lines[0] = "%4 = HOLE(%3, 12, 40, -25, 0)";
             s.chunks[1].chunkHash = s.chunks[1].computeHash();
             return s;
         }},

        // ALTER a line and re-chain the ENTIRE tail, so every back-link agrees.
        // Only the footer's root hash and replay fingerprint are left to catch it.
        {"alter a line and re-chain the whole tail", ChainFault::RootMismatch,
         [](ChunkStream s) {
             s.chunks[1].lines[0] = "%4 = HOLE(%3, 12, 40, -25, 0)";
             std::string prev = s.chunks[0].chunkHash;
             for (std::size_t i = 1; i < s.chunks.size(); ++i) {
                 s.chunks[i].previousChunkHash = prev;
                 s.chunks[i].chunkHash = s.chunks[i].computeHash();
                 prev = s.chunks[i].chunkHash;
             }
             return s;
         }},

        // DROP a line from a chunk without touching the counts: the running
        // count no longer matches the payload it claims to carry.
        {"drop one line inside a chunk", ChainFault::ChunkAltered,
         [](ChunkStream s) {
             s.chunks[1].lines.pop_back();
             return s;
         }},

        // A stream that stopped early must never be accepted (law 5).
        {"stream marked PAUSED_INCOMPLETE", ChainFault::NotComplete,
         [](ChunkStream s) { s.footer.completionStatus = "PAUSED_INCOMPLETE"; return s; }},
    };

    // ---- 4c: NEGATIVE CONTROL — nothing else would have caught the alteration
    // The altered stream reassembles into perfectly well-formed IR: it parses
    // clean, with the right op count, and builds a part whose 8 mm bolt hole is
    // now 12 mm. Without the chain there is no signal at all. This is what makes
    // the detections below attributable to the chain rather than to luck.
    {
        ChunkStream altered = clean;
        altered.chunks[1].lines[0] = "%4 = HOLE(%3, 12, 40, -25, 0)";
        ParseOutcome o = tryParse(forge::ft::reassemble(altered));
        check(!o.threw && o.tree.ops.size() == 11,
              "negative control: the altered payload is VALID IR (only the chain can see it)",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " ops=" + std::to_string(o.tree.ops.size()));
    }

    for (const Case& c : cases) {
        const ChunkStream bad = c.corrupt(clean);
        const ChainVerdict v = forge::ft::verifyChain(bad);
        check(!v.accepted && v.fault == c.expect,
              std::string("detects: ") + c.name + " -> " + forge::ft::toString(c.expect),
              std::string("accepted=") + (v.accepted ? "yes" : "no") +
                  " fault=" + forge::ft::toString(v.fault) +
                  " atChunk=" + std::to_string(v.atChunk) + " detail=" + v.detail);

        // ...and the detection happens BEFORE any IR is accepted.
        bool threw = false;
        std::size_t ops = 0;
        try { ops = forge::ft::accept(bad).ops.size(); }
        catch (const std::exception&) { threw = true; }
        check(threw,
              std::string("rejects BEFORE acceptance: ") + c.name,
              threw ? "" : "accept() returned a " + std::to_string(ops) +
                               "-op tree from a corrupted stream");
    }
}


// ============================================================================
// TEST 5 — GRAPH-QUALITY GATE  (SACROSANCT s0.4, Appendix B NOOP-PADDING)
//
// "The required values for unresolved references, unexplained orphans, opaque
// placeholders, and unapproved failed nodes are zero."
//
// TEST 2 above asserts this law at the PARSER, and it still fails there by
// construction: 2a requires parse() to RETURN the padded tree (so the orphans
// can be computed from it) while 2b requires parse() to THROW on the same text.
// Both cannot hold, so the law is enforced one stage later instead — at the
// point of ACCEPTANCE, where the delivered root is known. forge::ft::auditGraph
// is that gate, it is pure IR (no geometry, no kernel), and compile() refuses
// any graph it does not call clean.
//
// Asserted here as VALUES: the exact orphan/unresolved/duplicate id lists.
// ============================================================================
void testGraphQualityGate() {
    group("GRAPH-QUALITY GATE (s0.4) — zero orphans / unresolved refs at acceptance");

    // ---- 5a: control — the clean 2-feature tree is accepted ----------------
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%2 = HOLE(%1, 6, 25, 0, 0)\n"
            "RESULT(%2)\n");
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && a.clean(),
              "control: the un-padded tree passes the gate (report empty)",
              "threw=" + std::string(o.threw ? o.message : "no") + " report=" + a.report());
    }

    // ---- 5b: the padded tree from TEST 2 is REJECTED, orphans named --------
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%2 = HOLE(%1, 6, 25, 0, 0)\n"
            "%3 = TRANSLATE(%2, 0, 0, 0)\n"
            "%4 = ROTATE(%3, 0, 0, 0, 1)\n"
            "%5 = FUSE(%4, %4)\n"
            "%6 = PATTERN(%5, LINEAR, 1, 0)\n"
            "%7 = HEAL(%6)\n"
            "%8 = COMMON(%7, %7)\n"
            "%20 = CYL(3, 5)\n"
            "%21 = TRANSLATE(%20, 900, 900, 900)\n"
            "RESULT(%8)\n");
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && !a.clean() &&
                  a.unexplainedOrphans == std::vector<int>{20, 21},
              "the dead branch is REJECTED at acceptance with %20,%21 named",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " report=" + a.report());
    }

    // ---- 5c: an unresolved reference is zero-tolerance ---------------------
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%2 = FUSE(%1, %9)\n"          // %9 is never defined
            "RESULT(%2)\n");
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && a.unresolvedRefs == std::vector<int>{9},
              "an unresolved reference %9 is detected before any geometry is built",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " report=" + a.report());
    }

    // ---- 5d: a shadowed id is a duplicate definition, not a silent overwrite
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%2 = HOLE(%1, 6, 25, 0, 0)\n"
            "%2 = HOLE(%1, 9, -25, 0, 0)\n"
            "RESULT(%2)\n");
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && a.duplicateIds == std::vector<int>{2},
              "a duplicate %id definition is detected (one of the two would be lost)",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " report=" + a.report());
    }

    // ---- 5e: intent is not hidden — VERIFY/TAG are never orphans -----------
    // A gate that called predicates padding would push emitters to stop writing
    // assertions, which is the opposite of what s0.4 is for.
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%2 = HOLE(%1, 6, 25, 0, 0)\n"
            "%3 = TAG(%2, \"@bore\", \"bore:r=3\")\n"
            "%4 = VERIFY(%3, \"holes=1\")\n"
            "RESULT(%3)\n");
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && a.clean(),
              "predicates (TAG/VERIFY) are not counted as padding",
              "threw=" + std::string(o.threw ? o.message : "no") + " report=" + a.report());
    }

    // ---- 5f: the implicit-RESULT fallback is audited the same way ----------
    {
        ParseOutcome o = tryParse(
            "%1 = BOX(80, 50, 12)\n"
            "%9 = CYL(3, 5)\n"                  // orphan: nothing consumes it
            "%2 = HOLE(%1, 6, 25, 0, 0)\n");    // no RESULT line at all
        const GraphAudit a = o.threw ? GraphAudit() : forge::ft::auditGraph(o.tree);
        check(!o.threw && a.unexplainedOrphans == std::vector<int>{9},
              "a tree with no RESULT line is audited from the documented fallback root",
              "threw=" + std::string(o.threw ? o.message : "no") +
                  " report=" + a.report());
    }
}

// ============================================================================

// ============================================================================
// TEST 6 — CLOSED VOCABULARY  (SACROSANCT s0.5 "rejected by the parser", s9.1)
//
// THE DEFECT THIS PINS DOWN, as measured, not as suspected.
//
// `opFromName()` used to answer OpCode::Box for any name it did not know, and
// `fail()` treats anything on the FINAL line of the text as a truncated emission.
// Together those two make an op name that means nothing at all into a BOX built
// from that statement's own arguments — with no error anywhere. Measured through
// the pinned scoring verifier (archdisc-Models tools/pinned/forge_verify, the
// binary every published composite was taken with):
//
//   %1 = BOX(20,20,20,0,0,0)                          ok  volume 8000   6 faces
//   %1 = CUBE(20,20,20,0,0,0)                         ok  volume 8000   6 faces
//   %1 = ZZZNOTANOP(20,20,20,0,0,0)                   ok  volume 8000   6 faces
//   %1 = BOX(20,20,20,0,0,0)
//   %2 = CUBE(5,5,5,0,0,0)                            ok  volume  125   6 faces
//
// The last one is the sharpest: it is NOT a single-statement program, and the
// whole 20 mm box is gone — the tree's result is a nonsense 5 mm box. Any
// composite taken on those rows is a number the emission did not earn.
//
// The three cases below are the ones named in the defect report, plus the
// tail-position variants, plus a control proving TRUNCATION tolerance is intact.
// Every assertion is against a reference value, not against "it didn't crash".
// ============================================================================
void testClosedVocabulary() {
    group("CLOSED-VOCABULARY (s0.5 / s9.1) — an unknown op is REJECTED, never a box");

    // Reference values for the one legal program. `X` in the defect report is a
    // score; a score is a property of the built solid, and this suite never calls
    // compile(). What the PARSER owes is stated instead, exactly: one op, code
    // Box, six numeric arguments with these values. If any of that moves, the
    // thing being scored moved.
    const std::string kBoxIR = "%1 = BOX(20,20,20,0,0,0)";
    const double kBoxArgs[6] = {20, 20, 20, 0, 0, 0};

    // ---- 6a: the legal program parses, to a KNOWN value --------------------
    {
        ParseOutcome o = tryParse(kBoxIR);
        bool ok = !o.threw && o.tree.ops.size() == 1 &&
                  o.tree.ops[0].code == OpCode::Box &&
                  o.tree.ops[0].args.size() == 6;
        if (ok)
            for (std::size_t i = 0; i < 6; ++i)
                ok = ok && o.tree.ops[0].args[i].kind == TokKind::Number &&
                     o.tree.ops[0].args[i].num == kBoxArgs[i];
        check(ok,
              "BOX(20,20,20,0,0,0) parses to exactly 1 Box op with args 20,20,20,0,0,0",
              o.threw ? "threw: " + o.message
                      : "ops=" + std::to_string(o.tree.ops.size()) +
                            " args=" + std::to_string(o.tree.ops.empty()
                                                          ? 0
                                                          : o.tree.ops[0].args.size()));
    }

    // ---- 6b/6c: CUBE and ZZZNOTANOP are REJECTED, single statement ---------
    // CUBE is the dangerous one: it is a plausible thing for a model to write and
    // it is NOT in the op table. ZZZNOTANOP is the control that nothing about the
    // name matters.
    for (const char* bad : {"CUBE", "ZZZNOTANOP"}) {
        const std::string ir = std::string("%1 = ") + bad + "(20,20,20,0,0,0)";
        ParseOutcome o = tryParse(ir);
        check(o.threw,
              std::string("single statement `") + bad + "(...)` is a parse ERROR",
              o.threw ? "" :
                  "parse() ACCEPTED it and returned " + std::to_string(o.tree.ops.size()) +
                      " op(s), code=" +
                      (o.tree.ops.empty()
                           ? std::string("-")
                           : std::to_string(static_cast<int>(o.tree.ops[0].code))) +
                      ". An unknown op became a BOX built from this statement's own "
                      "arguments — the silent default in opFromName().");
        check(o.threw && o.message.find(bad) != std::string::npos &&
                  o.message.find("unknown op") != std::string::npos,
              std::string("the error NAMES the unknown op `") + bad + "`",
              "message: " + o.message);
        check(o.classified && o.kind == forge::ft::ParseFailure::Syntax,
              std::string("`") + bad +
                  "` is classified Syntax, NOT Incomplete (it is not truncated)",
              o.classified
                  ? std::string("kind=") + kindName(o.kind) +
                        " — a structurally complete OP(...) misfiled as a truncated "
                        "emission hands a caller a salvage checkpoint it must not have"
                  : "did not throw a typed forge::ft::ParseError");
    }

    // ---- 6d: the unknown op in TAIL position, inside a valid tree ----------
    // This is the case the defect report believed was already caught. It is not:
    // `fail()`'s truncated-tail branch is keyed on the LINE NUMBER, not on the
    // statement count, so the last line of ANY tree took the silent path.
    {
        const std::string ir =
            "%1 = BOX(20,20,20,0,0,0)\n"
            "%2 = CUBE(5,5,5,0,0,0)";
        ParseOutcome o = tryParse(ir);
        check(o.threw && o.message.find("CUBE") != std::string::npos,
              "an unknown op on the LAST line of a multi-statement tree is rejected",
              o.threw ? "message: " + o.message :
                  "parse() returned " + std::to_string(o.tree.ops.size()) +
                      " ops. Under the pinned verifier this same text builds and "
                      "reports volume 125 — the 20 mm box silently replaced by a "
                      "5 mm box, scored as if it were the emission.");
        check(o.classified && o.kind == forge::ft::ParseFailure::Syntax && o.line == 2,
              "and it is reported at line 2, as Syntax",
              o.classified ? std::string("kind=") + kindName(o.kind) +
                                 " line=" + std::to_string(o.line)
                           : "no typed ParseError");
    }

    // ---- 6e: position independence -----------------------------------------
    // The same unknown op FIRST was always caught. Both positions must agree, or
    // the vocabulary is a function of where you stand in the file.
    {
        ParseOutcome first = tryParse("%1 = ZZZNOTANOP(20,20,20,0,0,0)\n"
                                      "%2 = TRANSLATE(%1,1,1,1)");
        ParseOutcome last  = tryParse("%1 = BOX(20,20,20,0,0,0)\n"
                                      "%2 = ZZZNOTANOP(5,5,5,0,0,0)");
        check(first.threw && last.threw &&
                  first.classified && last.classified &&
                  first.kind == last.kind,
              "rejection does not depend on the op's POSITION in the tree",
              "first: " + std::string(first.threw ? kindName(first.kind) : "ACCEPTED") +
                  "  last: " + std::string(last.threw ? kindName(last.kind) : "ACCEPTED"));
    }

    // ---- 6f: no parsed tree may ever carry the sentinel ---------------------
    {
        ParseOutcome o = tryParse("%1 = BOX(20,20,20,0,0,0)\n"
                                  "%2 = HOLE(%1, 6, 20, 0, 0)\n"
                                  "RESULT(%2)\n");
        check(!o.threw && countCode(o.tree, OpCode::Unknown) == 0 &&
                  o.tree.ops.size() == 2,
              "a valid tree parses with ZERO OpCode::Unknown ops",
              o.threw ? "threw: " + o.message
                      : "unknown=" +
                            std::to_string(countCode(o.tree, OpCode::Unknown)));
    }

    // ---- 6g: CONTROL — truncation tolerance is NOT what was removed --------
    // A genuine token-ceiling cutoff still reports Incomplete and still carries
    // its checkpoint. If this ever flips to Syntax the fix has gone too far and
    // long emissions lose their salvage.
    {
        const std::string truncated =
            "%1 = BOX(60, 40, 10)\n"
            "%2 = HOLE(%1, 6, 20, 0, 0)\n"
            "%3 = FILLET(%2, 2\n";          // stops mid-statement: no ')'
        ParseOutcome o = tryParse(truncated);
        check(o.threw && o.classified &&
                  o.kind == forge::ft::ParseFailure::Incomplete,
              "control: a genuinely TRUNCATED final statement is still Incomplete",
              o.classified ? std::string("kind=") + kindName(o.kind)
                           : "no typed ParseError: " + o.message);
    }
}

int main() {
    std::printf("SACROSANCT 3.1 Appendix B — feature-DAG acceptance tests (s0)\n");
    std::printf("target: forge::ft IR (parse-level; compile() is not invoked)\n");

    testOpaqueMacro();
    testNoopPadding();
    testPatternExplicit();
    testChunkCorruption();
    testGraphQualityGate();
    testClosedVocabulary();

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
