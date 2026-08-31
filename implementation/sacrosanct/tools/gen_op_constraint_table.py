#!/usr/bin/env python3
"""gen_op_constraint_table.py -- compile the Archie op vocabulary into a C++ header.

WHY THIS EXISTS
    implementation/sacrosanct/archie_op_vocabulary.json is the machine-readable
    statement of which feature-IR ops a USER of the Forge app can reach through
    the forge::ui command registry (D-021).  A C++ component that enforces that
    constraint must not carry its own transcription of the list: a hand-copied
    allow-list is a second source of truth, and the two drift silently.

    So the list is COMPILED, not copied.  This script reads the vocabulary and
    writes ui/include/forge/ui/ArchieOpVocabulary.hpp -- constexpr tables with
    no runtime JSON parsing, no file I/O and no allocation at load.  The header
    is committed so that ui/test/run_ui.sh (which compiles ui/src/*.cpp
    directly, with no CMake) and the CMake build see the same bytes.

    --check re-renders the header from the vocabulary and diffs it against the
    committed file.  It is wired into CI and into the CMake build, so an edit to
    the vocabulary that is not accompanied by a regeneration fails.

The generated header deliberately depends on NOTHING first-party: it stores the
vocabulary's own spellings ("SOLID", "Edge") as std::string_view and leaves the
mapping onto forge::ui enums to ui/src/OpConstraintBridge.cpp, where a gate can
prove the mapping is total.  That keeps this file a transcription and not an
interpretation.
"""

import argparse
import difflib
import hashlib
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
VOCAB_REL = "implementation/sacrosanct/archie_op_vocabulary.json"
HEADER_REL = "ui/include/forge/ui/ArchieOpVocabulary.hpp"
GENERATOR_REL = "implementation/sacrosanct/tools/gen_op_constraint_table.py"

# The vocabulary writes an unbounded upper bound as JSON null (LOFT takes 2..n
# sections).  The header spells the same idea as a named constant rather than a
# magic -1 that a reader has to recognise.
UNBOUNDED = "kUnboundedArgs"


class DeriveError(RuntimeError):
    """A construct this generator does not understand. Never swallowed."""


def load_vocabulary():
    path = os.path.join(REPO, VOCAB_REL)
    with open(path, "rb") as fh:
        raw = fh.read()
    return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()


def cxx_string(text):
    """A C++ string literal. Refuses anything it cannot render exactly."""
    out = []
    for ch in text:
        if ord(ch) > 126 or ord(ch) < 32:
            raise DeriveError("non-ASCII or control byte in vocabulary text: %r" % text)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        else:
            out.append(ch)
    return '"%s"' % "".join(out)


def bound(value):
    if value is None:
        return UNBOUNDED
    if not isinstance(value, int) or value < 0:
        raise DeriveError("argument bound is not a non-negative integer: %r" % (value,))
    return str(value)


def render(doc, vocab_sha):
    ops = sorted(doc["ops"], key=lambda o: o["op"])
    forbidden = sorted(doc["forbidden_ops"], key=lambda o: o["op"])
    emitting = sorted([c for c in doc["commands"] if c["emits_feature_ir"]],
                      key=lambda c: c["id"])

    # The vocabulary's own allowed_ops list is the authority on membership; the
    # `ops` array must agree with it or one of the two is stale.
    policy = sorted(doc["emission_policy"]["allowed_ops"])
    if policy != [o["op"] for o in ops]:
        raise DeriveError("emission_policy.allowed_ops disagrees with the ops array: %s vs %s"
                          % (policy, [o["op"] for o in ops]))

    # Flat side tables + (offset, count) slices: a constexpr row cannot own a
    # variable-length array, and a nested std::array per row would fix the
    # widest case for every row.
    consumes, forms, op_commands = [], [], []
    op_rows = []
    for op in ops:
        c_first, f_first, k_first = len(consumes), len(forms), len(op_commands)
        consumes.extend(op["consumes_value_kinds"])
        for form in op["emitted_forms"]:
            forms.append((form["argument_count"]["min"], form["argument_count"]["max"]))
        op_commands.extend(op["user_commands"])
        arity = op["arity"]
        op_rows.append((
            op["op"], op["produces"],
            c_first, len(op["consumes_value_kinds"]),
            bound(arity["min_args"]), bound(arity["max_args"]),
            "true" if arity["first_argument_is_value_ref"] else "false",
            f_first, len(op["emitted_forms"]),
            k_first, len(op["user_commands"]),
        ))

    L = []
    a = L.append
    a("// %s -- GENERATED FILE. DO NOT EDIT." % HEADER_REL)
    a("//")
    a("// Written by %s" % GENERATOR_REL)
    a("// from %s" % VOCAB_REL)
    a("// sha256(vocabulary) = %s" % vocab_sha)
    a("//")
    a("// This is the ALLOWED OP SET made compilable: the feature-IR ops a USER of the")
    a("// Forge app can reach through the forge::ui command registry, and the reason each")
    a("// of the remaining kernel ops is out of reach.  forge::ui::OpConstraintBridge is")
    a("// the only intended consumer.  Regenerate with:")
    a("//")
    a("//     python3 %s --write" % GENERATOR_REL)
    a("//")
    a("// `--check` is run by CI and by the CMake build, so an edit to the vocabulary")
    a("// that is not accompanied by a regeneration fails rather than drifts.")
    a("//")
    a("// Everything here is the vocabulary's OWN SPELLING, kept as string_view on")
    a("// purpose: mapping \"SOLID\" onto forge::ui::IrValueKind and \"Edge\" onto")
    a("// forge::ui::EntityKind happens once, in ui/src/OpConstraintBridge.cpp, where")
    a("// ui/test/op_constraint_bridge_test.cpp proves the mapping is TOTAL.  A")
    a("// generated file that interprets its source cannot be diffed against it.")
    a("#ifndef FORGE_UI_ARCHIEOPVOCABULARY_HPP")
    a("#define FORGE_UI_ARCHIEOPVOCABULARY_HPP")
    a("")
    a("#include <array>")
    a("#include <cstddef>")
    a("// <string> is carried deliberately: ui/test/check_includes_ui.sh matches")
    a("// `std::string` as a prefix, so std::string_view reads as std::string to it.")
    a("#include <string>")
    a("#include <string_view>")
    a("")
    a("namespace forge::ui::vocab {")
    a("")
    a("// LOFT(%w0, %w1 [, %w2 ...]) has no upper bound; every other op does.")
    a("inline constexpr std::size_t %s = static_cast<std::size_t>(-1);" % UNBOUNDED)
    a("")
    a("inline constexpr std::string_view kVocabularyPath = %s;" % cxx_string(VOCAB_REL))
    a("inline constexpr std::string_view kVocabularySha256 = %s;" % cxx_string(vocab_sha))
    a("inline constexpr std::string_view kVocabularySchema = %s;" % cxx_string(doc["schema"]))
    a("")
    a("// The counts the vocabulary computes about itself.  A gate that re-derives")
    a("// these from the LIVE registry is the check that the file is not merely")
    a("// self-consistent.")
    for key in ("kernel_ops", "registry_commands", "commands_emitting_ir",
                "user_invocable_ops", "forbidden_ops"):
        camel = "".join(p.capitalize() for p in key.split("_"))
        a("inline constexpr std::size_t k%sCount = %d;" % (camel, doc["counts"][key]))
    a("")
    a("// ---------------------------------------------------------------- side tables")
    a("// Sliced by the (first, count) pairs in the rows below.")
    a("inline constexpr std::array<std::string_view, %d> kConsumedValueKinds = {{" % len(consumes))
    for v in consumes:
        a("    %s," % cxx_string(v))
    a("}};")
    a("")
    a("// An argument COUNT a user command can actually emit.  Deliberately narrower")
    a("// than the kernel arity: the kernel would accept EXTRUDE with 4 arguments and")
    a("// no command in the app can produce that form.")
    a("struct ArgCountRange {")
    a("  std::size_t min = 0;")
    a("  std::size_t max = 0;  // kUnboundedArgs when the op is variadic")
    a("};")
    a("inline constexpr std::array<ArgCountRange, %d> kEmittedArgCounts = {{" % len(forms))
    for lo, hi in forms:
        a("    ArgCountRange{%s, %s}," % (bound(lo), bound(hi)))
    a("}};")
    a("")
    a("inline constexpr std::array<std::string_view, %d> kOpCommandIds = {{" % len(op_commands))
    for cid in op_commands:
        a("    %s," % cxx_string(cid))
    a("}};")
    a("")
    a("// ---------------------------------------------------------------- allowed ops")
    a("struct OpRow {")
    a("  std::string_view op;                 // UPPERCASE feature-IR op name")
    a("  std::string_view produces;           // \"PROFILE\" | \"WIRE\" | \"SOLID\"")
    a("  std::size_t consumesFirst = 0;       // slice of kConsumedValueKinds")
    a("  std::size_t consumesCount = 0;")
    a("  std::size_t kernelMinArgs = 0;       // what forge::ft would accept")
    a("  std::size_t kernelMaxArgs = 0;")
    a("  bool firstArgIsValueRef = false;     // OP(%body, ...) -- false means a CREATOR")
    a("  std::size_t formFirst = 0;           // slice of kEmittedArgCounts")
    a("  std::size_t formCount = 0;")
    a("  std::size_t commandFirst = 0;        // slice of kOpCommandIds")
    a("  std::size_t commandCount = 0;")
    a("};")
    a("inline constexpr std::array<OpRow, %d> kAllowedOps = {{" % len(op_rows))
    for row in op_rows:
        a("    OpRow{%s, %s, %d, %d, %s, %s, %s, %d, %d, %d, %d},"
          % (cxx_string(row[0]), cxx_string(row[1]), row[2], row[3], row[4], row[5],
             row[6], row[7], row[8], row[9], row[10]))
    a("}};")
    a("")
    a("// ------------------------------------------------------------- forbidden ops")
    a("// A REAL kernel op that no forge::ui command emits.  The reason is carried so a")
    a("// refusal can say WHY rather than \"not allowed\".")
    a("struct ForbiddenRow {")
    a("  std::string_view op;")
    a("  std::string_view reason;")
    a("};")
    a("inline constexpr std::array<ForbiddenRow, %d> kForbiddenOps = {{" % len(forbidden))
    for f in forbidden:
        a("    ForbiddenRow{%s," % cxx_string(f["op"]))
        a("                 %s}," % cxx_string(f["reason"]))
    a("}};")
    a("")
    a("// --------------------------------------------------- the commands that emit IR")
    a("// Selection spellings are EntityKind's names as the vocabulary writes them.")
    a("struct CommandRow {")
    a("  std::string_view id;")
    a("  std::string_view op;")
    a("  std::string_view selectionKind;      // \"None\" | \"Edge\" | \"Face\" | \"Body\" | ...")
    a("  std::size_t selectionMin = 0;")
    a("  std::size_t selectionMax = 0;        // kUnboundedArgs when open-ended")
    a("  std::string_view producesValueKind;  // \"Profile\" | \"Wire\" | \"Solid\"")
    a("};")
    a("inline constexpr std::array<CommandRow, %d> kEmittingCommands = {{" % len(emitting))
    for c in emitting:
        sel = c["selection"]
        a("    CommandRow{%s, %s, %s, %s, %s, %s},"
          % (cxx_string(c["id"]), cxx_string(c["feature_ir_op"]),
             cxx_string(sel["kind"]), bound(sel["min"]), bound(sel["max"]),
             cxx_string(str(c["produces_value_kind"]))))
    a("}};")
    a("")
    a("}  // namespace forge::ui::vocab")
    a("")
    a("#endif  // FORGE_UI_ARCHIEOPVOCABULARY_HPP")
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="write the header")
    ap.add_argument("--check", action="store_true",
                    help="fail if the committed header has drifted from the vocabulary")
    args = ap.parse_args()
    if args.write == args.check:
        sys.stderr.write("[op-table] pick exactly one of --write / --check\n")
        return 2

    doc, vocab_sha = load_vocabulary()
    text = render(doc, vocab_sha)
    path = os.path.join(REPO, HEADER_REL)

    if args.write:
        with open(path, "w", encoding="ascii") as fh:
            fh.write(text)
        print("[op-table] wrote %s -- %d allowed ops, %d forbidden, %d emitting commands"
              % (HEADER_REL, len(doc["ops"]), len(doc["forbidden_ops"]),
                 len([c for c in doc["commands"] if c["emits_feature_ir"]])))
        return 0

    if not os.path.exists(path):
        sys.stderr.write("[op-table] MISSING -- %s has never been generated\n" % HEADER_REL)
        sys.stderr.write("[op-table] generate with: python3 %s --write\n" % GENERATOR_REL)
        return 1
    with open(path, "r", encoding="ascii") as fh:
        committed = fh.read()
    if committed == text:
        print("[op-table] OK -- %s matches %s (%d allowed ops, sha %s)"
              % (HEADER_REL, VOCAB_REL, len(doc["ops"]), vocab_sha[:12]))
        return 0
    diff = list(difflib.unified_diff(committed.splitlines(True), text.splitlines(True),
                                     fromfile="%s (committed)" % HEADER_REL,
                                     tofile="%s (implied by the vocabulary)" % HEADER_REL))
    sys.stderr.write("[op-table] DRIFT -- the committed header is not what the vocabulary implies\n")
    sys.stderr.writelines(diff[:80])
    sys.stderr.write("[op-table] regenerate with: python3 %s --write\n" % GENERATOR_REL)
    return 1


if __name__ == "__main__":
    sys.exit(main())
