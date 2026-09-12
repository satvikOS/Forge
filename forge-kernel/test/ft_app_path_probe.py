#!/usr/bin/env python3
# ft_app_path_probe.py -- run the IR a FORGE COMMAND actually emits, and print
# what the user is left looking at.
#
# WHY. The refusals added to FeatureTreeCompiler.cpp were measured on IR written
# by hand. Six of the ops they refuse are wired to buttons -- part.thread,
# part.rib, part.pocket, part.replace_face, part.draft, part.offset_solid -- and
# none of those paths had been run once. "The kernel refuses it" and "the user
# gets a sentence they can act on" are different claims and only the second one
# matters to somebody holding the mouse.
#
# WHERE THE IR COMES FROM. Not from this file. Every statement below is read out
# of implementation/sacrosanct/archie_op_vocabulary.json, whose emitted_forms are
# DERIVED from ui/src/PartCommands.cpp by gen_archie_op_vocabulary.py and gated
# against it. If a command's emission changes, the vocabulary regenerates and
# this probe follows; a command that stops emitting is a hard error here, not a
# quietly skipped row.
#
# WHAT IT RUNS -- BOTH HALVES. `examples` records the LEGAL forms only, and
# narrowing a slot's documented domain (the right fix for a slot the kernel
# refuses) therefore removes the refused forms from this probe as well. MEASURED:
# after that narrowing, FILLET(%body, 2, "bore:r=6") -- the exact statement
# ui/test/part_commands_test.cpp:195 asserts part.fillet emits -- and
# FILLET(%body, 2, CONVEX) were both refused by the kernel and neither was run by
# anything, because the only instrument that runs app IR reads its input out of
# the vocabulary. So this probe runs `refused_app_emissions` too: the statements
# the command CAN still emit that the kernel refuses, derived from the same two
# sources (the app's own ternary domain, and selectEdges' resolvable set).
#
# Usage: ft_app_path_probe.py <forge_verify> <command-id> [<command-id> ...]
# Prints one line per row:  <command>|<source>|<ir_text>|<ok>|<error>
#   source = documented   -- from emitted_forms[].examples: a form the app emits
#                            and the kernel is expected to accept
#            refused      -- from emitted_forms[].refused_app_emissions: a form
#                            the app can emit and the kernel refuses BY DESIGN.
#                            If one of these BUILDS, the refusal has gone and the
#                            silent widening is back.
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
VOCAB = os.path.join(ROOT, "implementation/sacrosanct/archie_op_vocabulary.json")

# One concrete operand per placeholder the emitted forms use. Sized so the
# working rows in the gate have a volume worth comparing: the plate is 60x40x20
# and the tool passes clean through it.
OPERANDS = {
    "%body":      "BOX(60,40,20)",
    "%tool":      "BOX(20,20,40)",
    "%bodyA":     "BOX(60,40,20)",
    "%bodyB":     "BOX(20,20,40)",
    "%surface":   "UNFOLD(@BOX(60,40,2), 0.44)",
    "%toolSheet": "UNFOLD(@BOX(20,20,20), 0.44)",
}


def program(ir_text, produces):
    """A runnable program: one definition per placeholder, then the statement."""
    used = [p for p in OPERANDS if re.search(re.escape(p) + r"\b", ir_text)]
    unknown = set(re.findall(r"%[A-Za-z]\w*", ir_text)) - set(OPERANDS) - {"%<id>"}
    if unknown:
        raise SystemExit("no operand for placeholder(s) %s in %r" % (sorted(unknown), ir_text))
    lines, env, n = [], {}, 0
    for p in sorted(used):
        rhs = OPERANDS[p]
        if "@" in rhs:                      # a surface: its solid comes first
            n += 1
            inner = re.search(r"@(\w+\([^)]*\))", rhs).group(1)
            lines.append("%%%d = %s" % (n, inner))
            rhs = rhs.replace("@" + inner, "%%%d" % n)
        n += 1
        lines.append("%%%d = %s" % (n, rhs))
        env[p] = "%%%d" % n
    stmt = ir_text
    for p, ref in env.items():
        stmt = re.sub(re.escape(p) + r"\b", ref, stmt)
    n += 1
    stmt = stmt.replace("%<id>", "%%%d" % n)
    lines.append(stmt)
    # RESULT must name a SOLID. A SURFACE-producing op (SURFTRIM, SURFEXTEND,
    # UNFOLD) is closed with THICKEN so the probe measures THAT OP and not the
    # walker's "RESULT is not a SOLID" -- which is a fact about this harness, and
    # reporting it as the command's outcome would be a lie about the command.
    if produces == "SURFACE":
        lines.append("%%%d = THICKEN(%%%d, 1)" % (n + 1, n))
        n += 1
    lines.append("RESULT(%%%d)" % n)
    return "\n".join(lines)


def main(argv):
    if len(argv) < 3:
        print("usage: ft_app_path_probe.py <forge_verify> <command-id>...", file=sys.stderr)
        return 2
    verify, wanted = argv[1], argv[2:]
    doc = json.load(open(VOCAB, encoding="utf-8"))
    found = set()
    for op in doc["ops"]:
        for form in op.get("emitted_forms", []):
            if form.get("command") not in wanted:
                continue
            found.add(form["command"])
            rows = [("documented", ex) for ex in form["examples"]]
            rows += [("refused", ex) for ex in form.get("refused_app_emissions", [])]
            for source, ex in rows:
                ir = program(ex["ir_text"], op["produces"])
                p = subprocess.run([verify], input=json.dumps({"id": "p", "ir": ir}),
                                   capture_output=True, text=True)
                out = [l for l in p.stdout.splitlines() if l.strip()]
                d = json.loads(out[-1]) if out else {}
                print("%s|%s|%s|%s|%s" % (form["command"], source, ex["ir_text"],
                                          d.get("ok"),
                                          (d.get("error") or "").replace("|", "/")))
    missing = sorted(set(wanted) - found)
    if missing:
        print("MISSING|documented|%s|None|the vocabulary records no emitted form "
              "for these commands" % ",".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
